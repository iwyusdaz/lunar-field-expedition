/**
 * analyze-craters.mjs — derives the Module 3 crater-counting patches from the
 * real LROC DTM (data/work/height-l2.*, gitignored input) and writes
 * content/craters.json:
 *   - two equal-area patches (mare plain vs. Apennine Front lower slopes),
 *   - reference crater lists (automated detection: rim-minus-floor at several
 *     radial scales, plane-fit removed so slopes do not bias the count; only
 *     craters >= 80 m whose relief is >= 5 m and >= 10 x the patch's DTM noise
 *     are listed),
 *   - size-frequency tables used by the text-mode equivalent task.
 *
 * HONESTY: the reference counts are AUTOMATED and approximate. The app labels
 * them "a computer count of the same patch — real counters disagree; that
 * uncertainty is part of the method". Detection cannot be cited as a geologic
 * crater-size-frequency distribution production measurement.
 *
 * No npm dependencies. Run: node scripts/analyze-craters.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { gridPixelOfLonLat, lonLatOfGridPixel } from '../src/scenes/grid-registration.js';

const WORK = 'data/work';
const AOI = { lonWest: 3.5026368, lonEast: 3.6901291, latSouth: 25.93, latNorth: 26.32 };
const LM = { lat: 26.13239, lon: 3.6333 };

// ---------- PNG decode (gray 16-bit) ----------------------------------------
function decodePNG(buf) {
  let off = 8, w, h, bitDepth, colorType, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (colorType !== 0 || bitDepth !== 16) throw new Error('expected 16-bit gray PNG');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 2;
  const out = new Float32Array(w * h);
  const prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = Uint8Array.prototype.slice.call(raw.subarray(p, p + stride)); p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 2 ? line[x - 2] : 0, b = prev[x], c = x >= 2 ? prev[x - 2] : 0;
      let v = line[x];
      switch (filter) {
        case 1: v = v + a; break;
        case 2: v = v + b; break;
        case 3: v = v + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break;
        }
      }
      line[x] = v & 0xff;
    }
    prev.set(line);
    for (let x = 0; x < w; x++) {
      const val = (line[x * 2] << 8) | line[x * 2 + 1];
      out[y * w + x] = val === 0 ? NaN : val; // scale applied below via meta
    }
  }
  return { w, h, raw: out };
}

const meta = JSON.parse(readFileSync(`${WORK}/height-l2.meta.json`, 'utf8'));
const png = decodePNG(readFileSync(`${WORK}/height-l2.png`));
const { width: w, height: h } = meta;
if (png.w !== w || png.h !== h) throw new Error('size mismatch');
const span = meta.elevMax - meta.elevMin;
const elev = new Float32Array(w * h);
for (let i = 0; i < w * h; i++) elev[i] = png.raw[i] === 0 ? NaN : meta.elevMin + (png.raw[i] / 65535) * span;
const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? NaN : elev[y * w + x];
const mPerPx = meta.mPerPx;

// Grid pixels <-> true lon/lat (the grids sit ~207 m north of their labelled AOI;
// src/scenes/grid-registration.js, DECISIONS #60).
const toPx = (lat, lon) => gridPixelOfLonLat(AOI, w, h, lon, lat);
const pxToLonLat = (x, y) => lonLatOfGridPixel(AOI, w, h, x, y);
// The app's scene frame (TerrainField.fromLonLat on the shipped L1 grid): metres
// east of the AOI west edge, south of its north edge. Patch centres are stored in it.
const L1 = JSON.parse(readFileSync('public/assets/terrain/terrain-meta.json', 'utf8')).lods[1];
const SCENE = { widthM: (L1.width - 1) * L1.mPerPx, heightM: (L1.height - 1) * L1.mPerPx };
const sceneOf = (lon, lat) => ({ xM: ((lon - AOI.lonWest) / (AOI.lonEast - AOI.lonWest)) * SCENE.widthM, yM: ((AOI.latNorth - lat) / (AOI.latNorth - AOI.latSouth)) * SCENE.heightM });
const lonLatOfScene = (xM, yM) => ({ lon: AOI.lonWest + (xM / SCENE.widthM) * (AOI.lonEast - AOI.lonWest), lat: AOI.latNorth - (yM / SCENE.heightM) * (AOI.latNorth - AOI.latSouth) });
const pxOfScene = (c) => { const q = lonLatOfScene(c.xM, c.yM); return toPx(q.lat, q.lon); };

// ---------- crater detection (rim-minus-floor, plane-fit removed) ------------
/**
 * Score each pixel by how bowl-like it is at radius r: mean(elev on ring r) -
 * plane-fitted elev at centre. Plane fit over the ring removes regional slope.
 * Returns list of candidate craters with diameter and depth.
 */
function detectCraters(x0, y0, radiusPx, minDiameterPx, maxDiameterPx) {
  const out = [];
  const scales = [];
  const maxR = Math.round(maxDiameterPx / 2);
  for (let r = Math.max(2, Math.round(minDiameterPx / 2)); r <= maxR; r++) scales.push(r);

  /** Least-squares plane fit; returns plane value at (0,0) plus slope, or null. */
  function planeAt(pts) {
    let s1 = pts.length, sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
    for (const [dx, dy, v] of pts) { sx += dx; sy += dy; sz += v; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * v; syz += dy * v; }
    const xb = sx / s1, yb = sy / s1, zb = sz / s1;
    const Sxx = sxx - s1 * xb * xb, Syy = syy - s1 * yb * yb, Sxy = sxy - s1 * xb * yb;
    const Sxz = sxz - s1 * xb * zb, Syz = syz - s1 * yb * zb;
    const den = Sxx * Syy - Sxy * Sxy;
    if (Math.abs(den) < 1e-6) return null;
    const b = (Sxz * Syy - Syz * Sxy) / den, c = (Syz * Sxx - Sxz * Sxy) / den;
    return { a: zb - b * xb - c * yb, b, c };
  }

  /** Ring sample values around (cx, cy) at radius r; null if any nodata. */
  function ring(cx, cy, r) {
    const n = Math.max(12, Math.round(2 * Math.PI * r / 2));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      const v = at(cx + Math.round(r * Math.cos(a)), cy + Math.round(r * Math.sin(a)));
      if (Number.isNaN(v)) return null;
      pts.push([Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a)), v]);
    }
    return pts;
  }

  for (let cy = y0; cy < y0 + 2 * radiusPx; cy += 2) {
    for (let cx = x0; cx < x0 + 2 * radiusPx; cx += 2) {
      if (Number.isNaN(at(cx, cy))) continue;
      let best = null;
      for (const r of scales) {
        // Local terrain plane from an OUTER annulus (1.3r), so the crater's own
        // rim/floor cannot leak into the reference level.
        const outer = ring(cx, cy, Math.round(r * 1.3));
        if (!outer) continue;
        const pl = planeAt(outer);
        if (!pl) continue;
        const floor = at(cx, cy);
        const depth = pl.a - floor;                     // floor below local terrain
        if (depth < 2.0) continue;
        const rimPts = ring(cx, cy, r);
        if (!rimPts) continue;
        let rimSum = 0; for (const [, , v] of rimPts) rimSum += v;
        const rim = rimSum / rimPts.length - pl.a;      // rim crest above local terrain
        if (rim < 0.4) continue;
        if (!best || depth > best.depth) best = { r, depth, rim };
      }
      // diameter = 2 * argmax_r(depth) (ring on the rim crest there). Reject
      // candidates at the largest scale: on open slopes "depth" grows
      // monotonically with radius, so the peak at the cap is not a bowl.
      if (best && best.r < maxR) {
        out.push({ x: cx, y: cy, rPx: best.r, depthM: best.depth, rimM: best.rim, diameterM: best.r * 2 * mPerPx });
      }
    }
  }
  // non-maximum suppression: keep the deepest candidate within 0.7*diameter
  out.sort((p, q) => q.depthM - p.depthM);
  const kept = [];
  for (const c of out) {
    if (!kept.some(k => Math.hypot(k.x - c.x, k.y - c.y) < 0.7 * Math.max(k.rPx, c.rPx))) kept.push(c);
  }
  return kept;
}

/** Count candidates whose centre lies inside the patch circle. */
function inPatch(craters, cx, cy, radiusPx) {
  return craters.filter(c => Math.hypot(c.x - cx, c.y - cy) <= radiusPx);
}

// ---------- choose patches ---------------------------------------------------
const lmScene = sceneOf(LM.lon, LM.lat);
// Mare patch: 150 m radius, flat plain east of the rille, fully inside valid data
// (valid cols 89..972 at L2), clear of the LM. G1 (owner approved, 2026-11-01,
// DECISIONS #60): moved from 550 m E / 350 m N of the LM, where every detection
// was DTM noise and the patch was drawn 207 m off the ground it was counted on,
// to 684 m E / 381 m N. A scan of the plain within 2.3 km E-W of the LM (patch
// centres every 20 m, median slope < 9 %) found this the nearest patch whose
// clear craters lie well inside the circle, with none on its edge.
const MARE = { id: 'mare', center: { xM: Math.round(lmScene.xM + 684), yM: Math.round(lmScene.yM - 381) }, radiusM: 150 };
// Front patch: lower slopes of the Apennine Front, southwest of the LM. Its centre
// is the one the v2 search placed (the highest ground in the -1750..-1400 m band
// with a 6-37 deg slope), kept at the same place in the scene: G1 re-derives its
// count from the ground actually drawn there (DECISIONS #60).
const FRONT = { id: 'front', center: { xM: 2760, yM: 11401 }, radiusM: 150 };

/**
 * DTM noise of a patch: robust sigma (1.4826 x median absolute deviation) of the
 * residual between each pixel and the mean of its 11 x 11 px (55 m) window.
 * Craters cover a small part of the patch, so the median ignores them.
 */
function patchNoise(cx, cy, rPx) {
  const k = 5, vals = [];
  for (let y = cy - rPx; y <= cy + rPx; y++) for (let x = cx - rPx; x <= cx + rPx; x++) {
    if (Math.hypot(x - cx, y - cy) > rPx) continue;
    let s = 0, n = 0;
    for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) { const v = at(x + dx, y + dy); if (!Number.isNaN(v)) { s += v; n++; } }
    vals.push(at(x, y) - s / n);
  }
  const med = vals.slice().sort((a, b) => a - b)[vals.length >> 1];
  return 1.4826 * vals.map(v => Math.abs(v - med)).sort((a, b) => a - b)[vals.length >> 1];
}
// Listed craters: at least the lesson's 80 m threshold, a rim-to-floor relief at
// least RELIEF_K x the patch noise and at least MIN_RELIEF_M, so every listed
// crater stands out in a hillshade and in the low-Sun count view (review F1, G1).
// In the G1 hillshade and headed checks, 80-200 m bowls of 5 m relief or more
// showed; bowls of 2-4.3 m did not, on the plain or on the Front's smooth slope
// (whose low noise alone would pass a 3.5 m bowl). Fainter detections are DTM
// artefacts or too degraded to see, and are not listed.
const THRESHOLD_M = 80, RELIEF_K = 10, MIN_RELIEF_M = 5;
const det = [];
for (const patch of [MARE, FRONT]) {
  const cp = pxOfScene(patch.center), cx = Math.round(cp.x), cy = Math.round(cp.y);
  const rPx = Math.round(patch.radiusM / mPerPx);
  const noiseM = patchNoise(cx, cy, rPx);
  const craters = detectCraters(cx - rPx, cy - rPx, 2 * rPx, 4, 40); // 20 m .. 200 m diameter
  const inside = inPatch(craters, cx, cy, rPx)
    .filter(c => c.diameterM >= THRESHOLD_M && c.depthM + c.rimM >= Math.max(MIN_RELIEF_M, RELIEF_K * noiseM))
    .map(c => ({
      diameterM: Math.round(c.diameterM),
      depthM: Math.round(c.depthM * 10) / 10,
      reliefM: Math.round((c.depthM + c.rimM) * 10) / 10,
      offsetM: Math.round(Math.hypot(c.x - cx, c.y - cy) * mPerPx),
      lonLat: pxToLonLat(c.x, c.y),
    })).sort((a, b) => b.diameterM - a.diameterM);
  const areaKm2 = (Math.PI * patch.radiusM * patch.radiusM) / 1e6;
  det.push({
    ...patch,
    centerLonLat: lonLatOfScene(patch.center.xM, patch.center.yM),
    areaKm2: Math.round(areaKm2 * 1000) / 1000,
    noiseM: Math.round(noiseM * 100) / 100,
    reliefK: RELIEF_K,
    minReliefM: MIN_RELIEF_M,
    craters: inside,
    densityPerKm2: Math.round(inside.length / areaKm2),
    medianSlopePct: null,
  });
}
// slope stats (for the traverse cost model + docs)
function slopeStats(patch) {
  const cp = pxOfScene(patch.center), cx = Math.round(cp.x), cy = Math.round(cp.y);
  const rPx = Math.round(patch.radiusM / mPerPx);
  const slopes = [];
  for (let y = cy - rPx; y <= cy + rPx; y += 2) {
    for (let x = cx - rPx; x <= cx + rPx; x += 2) {
      const dz = Math.abs(at(x + 2, y) - at(x - 2, y)) + Math.abs(at(x, y + 2) - at(x, y - 2));
      const dx = 4 * mPerPx;
      if (!Number.isNaN(dz)) slopes.push(Math.hypot(at(x + 2, y) - at(x - 2, y), at(x, y + 2) - at(x, y - 2)) / dx);
    }
  }
  slopes.sort((a, b) => a - b);
  return Math.round(slopes[slopes.length >> 1] * 1000) / 10;
}
for (const p of det) p.medianSlopePct = slopeStats(p);

const content = {
  _meta: {
    generatedBy: 'scripts/analyze-craters.mjs from LROC NAC_DTM_APOLLO15 (data/work, gitignored)',
    method: 'automated rim-minus-floor detection (plane fit removes slope); listed: diameter >= 80 m and rim-to-floor relief >= max(minReliefM, reliefK x noiseM), noiseM = robust sigma of the residual from a 55 m moving mean in the patch; grid pixels registered to true lon/lat (src/scenes/grid-registration.js); counts are approximate — the app labels them as a computer count, and real counters disagree',
    accessDate: '2026-10-27',
    regenerated: '2026-11-01 (G1: mare patch moved, relief-over-noise rule added; owner approved)',
  },
  patches: det,
};
mkdirSync('content', { recursive: true });
writeFileSync('content/craters.json', JSON.stringify(content, null, 2));
console.log(JSON.stringify(det.map(({ id, centerLonLat, areaKm2, densityPerKm2, medianSlopePct, craters }) => ({ id, ...centerLonLat, areaKm2, densityPerKm2, medianSlopePct, n: craters.length, diameters: craters.map(c => c.diameterM) })), null, 2));
