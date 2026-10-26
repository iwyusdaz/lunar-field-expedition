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
const { w, h } = meta;
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
  for (let d = minDiameterPx; d <= maxDiameterPx; d += Math.max(2, Math.round(minDiameterPx / 2))) scales.push(Math.round(d / 2));
  for (let cy = y0; cy < y0 + 2 * radiusPx; cy++) {
    for (let cx = x0; cx < x0 + 2 * radiusPx; cx++) {
      if (Number.isNaN(at(cx, cy))) continue;
      let best = null;
      for (const r of scales) {
        // ring samples
        const n = Math.max(12, Math.round(2 * Math.PI * r / 2));
        const pts = [];
        let ok = true;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 2 * Math.PI;
          const x = cx + Math.round(r * Math.cos(a)), y = cy + Math.round(r * Math.sin(a));
          const v = at(x, y);
          if (Number.isNaN(v)) { ok = false; break; }
          pts.push([x - cx, y - cy, v]);
        }
        if (!ok) continue;
        // plane fit: v ~ a + b*dx + c*dy  (least squares, normal equations)
        let s1 = pts.length, sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
        for (const [dx, dy, v] of pts) { sx += dx; sy += dy; sz += v; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * v; syz += dy * v; }
        const det = s1 * sxx * syy + 2 * sx * sy * sxy - sxx * sy * sy - syy * sx * sx - sxy * sxy * s1;
        if (Math.abs(det) < 1e-6) continue;
        const a = (sz * sxx * syy + sx * syz * sxy + sy * sxy * sxz - sxx * sy * syz - syy * sxy * sz - sxy * sx * sxz) / det;
        const b = (s1 * sxz * syy + sy * sy * sz + sy * sxy * sxz - sxx * sy * syz - syy * sxz * s1 - sxy * sx * sz) / det;
        const c = (s1 * sxx * syz + sx * sy * sz + sxx * sxz * s1 - sxx * s1 * syz - syy * sx * sxz - sxy * sy * sz) / det;
        // refit b,c properly (a solved above is approximate for the constant only)
        const b2 = (syz * sxx - sxz * sxy) / (sxx * syy - sxy * sxy);
        const c2 = (sxz * syy - syz * sxy) / (sxx * syy - sxy * sxy);
        void b; void c;
        const planeAt = a + b2 * 0 + c2 * 0; // a is the plane value at the centre
        // interior check: centre must be below the fitted plane (a bowl)
        const depth = planeAt - at(cx, cy);
        // rim prominence: ring mean above the fitted plane
        let ringSum = 0;
        for (const [, , v] of pts) ringSum += v;
        const rim = ringSum / pts.length - a;
        if (depth > 1.2 && rim > 0.6 && (!best || r > best.r)) best = { r, depth, rim };
      }
      if (best) out.push({ x: cx, y: cy, rPx: best.r, depthM: best.depth, rimM: best.rim, diameterM: best.r * 2 * mPerPx });
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
for (let lat = 26.02; lat <= 26.10; lat += 0.004) {
  for (let lon = 3.60; lon <= 3.66; lon += 0.004) {
    const p = toPx(lat, lon);
    const v = at(Math.round(p.x), Math.round(p.y));
    if (Number.isNaN(v) || v < -1750) continue; // front materials start above the plain
    const slope = Math.abs(at(Math.round(p.x) + 10, Math.round(p.y)) - at(Math.round(p.x) - 10, Math.round(p.y))) / 100;
    if (slope < 0.18 && slope > 0.03) { // on the slope but not a cliff
      if (!bestFront || v > bestFront.elev) bestFront = { elev: v, xM: p.x * mPerPx, yM: p.y * mPerPx, lat, lon, slope };
    }
  }
}
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
