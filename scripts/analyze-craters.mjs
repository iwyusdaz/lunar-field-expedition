/**
 * analyze-craters.mjs — derives the Module 3 crater-counting patches from the
 * real LROC DTM (data/work/height-l2.*, gitignored input) and writes
 * content/craters.json:
 *   - two equal-area patches (mare plain vs. Apennine Front lower slopes),
 *   - reference crater lists (automated detection: rim-minus-floor at several
 *     radial scales, plane-fit removed so slopes do not bias the count),
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

function toPx(lat, lon) {
  return {
    x: ((lon - AOI.lonWest) / (AOI.lonEast - AOI.lonWest)) * (w - 1),
    y: ((AOI.latNorth - lat) / (AOI.latNorth - AOI.latSouth)) * (h - 1),
  };
}
function toLonLat(xM, yM) { // metres east from west edge, metres south from north edge
  return {
    lon: AOI.lonWest + (xM / (w * mPerPx)) * (AOI.lonEast - AOI.lonWest),
    lat: AOI.latNorth - (yM / (h * mPerPx)) * (AOI.latNorth - AOI.latSouth),
  };
}

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
const lmPx = toPx(LM.lat, LM.lon);
// Mare patch: 150 m radius, flat plain east of the rille, fully inside valid data
// (valid cols 89..972 at L2), clear of the LM.
const MARE = { id: 'mare', center: { xM: Math.round(lmPx.x * mPerPx + 550), yM: Math.round(lmPx.y * mPerPx - 350) }, radiusM: 150 };
// Front patch: lower slopes of the Apennine Front, southeast of the LM (higher ground).
// Search for the highest-elevation flat-ish area in the valid region to place it.
let bestFront = null;
for (let lat = 25.932; lat <= 26.00; lat += 0.003) {
  for (let lon = 3.55; lon <= 3.68; lon += 0.003) {
    const p = toPx(lat, lon);
    const v = at(Math.round(p.x), Math.round(p.y));
    if (Number.isNaN(v) || v < -1750 || v > -1400) continue; // on the Front, below the ragged crests
    const slope = Math.abs(at(Math.round(p.x) + 10, Math.round(p.y)) - at(Math.round(p.x) - 10, Math.round(p.y))) / 100;
    if (slope < 0.10 || slope > 0.75) continue; // on the slope band (6..37 deg), not a cliff, not the plain
    if (!bestFront || v > bestFront.elev) bestFront = { elev: v, xM: p.x * mPerPx, yM: p.y * mPerPx, lat, lon, slope };
  }
}
if (!bestFront) throw new Error('no Apennine Front patch found in the search band');
const FRONT = { id: 'front', center: { xM: Math.round(bestFront.xM), yM: Math.round(bestFront.yM) }, radiusM: 150 };

const det = [];
for (const patch of [MARE, FRONT]) {
  const cx = Math.round(patch.center.xM / mPerPx), cy = Math.round(patch.center.yM / mPerPx);
  const rPx = Math.round(patch.radiusM / mPerPx);
  const craters = detectCraters(cx - rPx, cy - rPx, 2 * rPx, 4, 40); // 20 m .. 200 m diameter
  const inside = inPatch(craters, cx, cy, rPx).map(c => ({
    diameterM: Math.round(c.diameterM),
    depthM: Math.round(c.depthM * 10) / 10,
    offsetM: Math.round(Math.hypot(c.x - cx, c.y - cy) * mPerPx),
    lonLat: toLonLat(c.x * mPerPx, c.y * mPerPx),
  })).sort((a, b) => b.diameterM - a.diameterM);
  const areaKm2 = (Math.PI * patch.radiusM * patch.radiusM) / 1e6;
  det.push({
    ...patch,
    centerLonLat: toLonLat(patch.center.xM, patch.center.yM),
    areaKm2: Math.round(areaKm2 * 1000) / 1000,
    craters: inside,
    densityPerKm2: Math.round(inside.length / areaKm2),
    medianSlopePct: null,
  });
}
// slope stats (for the traverse cost model + docs)
function slopeStats(patch) {
  const cx = Math.round(patch.center.xM / mPerPx), cy = Math.round(patch.center.yM / mPerPx);
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
    method: 'automated rim-minus-floor detection (plane fit removes slope), diameters >= 20 m; counts are approximate — the app labels them as a computer count, and real counters disagree',
    accessDate: '2026-10-27',
  },
  patches: det,
};
mkdirSync('content', { recursive: true });
writeFileSync('content/craters.json', JSON.stringify(content, null, 2));
console.log(JSON.stringify(det.map(({ id, centerLonLat, areaKm2, densityPerKm2, medianSlopePct, craters }) => ({ id, ...centerLonLat, areaKm2, densityPerKm2, medianSlopePct, n: craters.length, diameters: craters.map(c => c.diameterM) })), null, 2));
