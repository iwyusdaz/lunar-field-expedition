/**
 * build-v3-terrain.mjs — streamed terrain for v3 (plan 10 §6.1, DECISIONS #3 restored):
 * a 3D Tiles 1.1 tileset with two independent quadtrees.
 *
 *  near/  LROC NAC_DTM_APOLLO15 (2 m/px, public domain) resampled to 5 m. One column of
 *         five 5,120 m roots (25.6 km N-S, 5.12 km E-W) over the landing site, Hadley
 *         Rille, Elbow, St. George, Spur and the lower Front. L0 80 m ... L4 5 m.
 *         Where the NAC strip has no data, heights come from SLDEM2015 (below), shifted
 *         onto the NAC datum and faded in over 300 m, so the strip edge has no cliff.
 *  far/   SLDEM2015 (LOLA + Kaguya TC, 512 px/deg, ~59 m, public domain) resampled to
 *         80 m over an 81.92 km square centred on the LM: the whole Apennine Front,
 *         Mons Hadley and Mons Hadley Delta. L0 1280 m ... L4 80 m. Cells inside the
 *         near footprint are removed; vertices just inside it are lowered 50 m so the
 *         far mesh tucks under the near mesh instead of z-fighting with it.
 *
 * Format (from _templates/spikes/RESULTS.md): 64 x 64 cells per tile + one skirt ring,
 * geometricError = measured max vertical error of the tile against its source grid,
 * GLB with KHR_mesh_quantization + EXT_meshopt_compression (meshopt level high,
 * 8-bit normals). Tileset frame: Z-up (x east, y north, z up), origin at the LM
 * (26.13239 N, 3.63330 E, as in the app), 1 unit = 1 m, no vertical exaggeration.
 * Lunar curvature IS applied: z = h - h_LM - (x^2 + y^2) / (2 R), R = 1,737,400 m
 * (about 65 m lower at 15 km, 260 m at 30 km), so the close horizon is real.
 * glTF content is Y-up: (x, z, -y).
 *
 * Inputs (gitignored): data/raw/NAC_DTM_APOLLO15.TIF (scripts/fetch-lroc-dtm.sh),
 * data/raw/v3/sldem2015-hadley-window.f32 (scripts/fetch-v3-assets.mjs).
 * Output: public/assets/terrain-v3/{tileset.json, build-meta.json, near/, far/}
 * Run: node scripts/build-v3-terrain.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAC = join(ROOT, 'data/raw/NAC_DTM_APOLLO15.TIF');
const SLD = join(ROOT, 'data/raw/v3/sldem2015-hadley-window.f32');
const WORK = join(ROOT, 'data/work/v3');
const OUT = join(ROOT, 'public/assets/terrain-v3');
for (const f of [NAC, SLD]) if (!existsSync(f)) { console.error(`missing ${f}; run the fetch scripts first`); process.exit(1); }
mkdirSync(WORK, { recursive: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const R = 1737400, D = Math.PI / 180;
const LM = { lat: 26.13239, lon: 3.6333 };
const COS0 = Math.cos(LM.lat * D);
const toLonLat = (e, n) => [LM.lon + e / (R * COS0) / D, LM.lat + n / R / D];
const CELLS = 64, LEVELS = 5;

// ---------------------------------------------------------------- SLDEM sampler
const sMeta = JSON.parse(readFileSync(SLD.replace(/\.f32$/, '.json'), 'utf8'));
const sDem = new Float32Array(readFileSync(SLD).buffer.slice(0));
function sldemAt(e, n) {
  const [lon, lat] = toLonLat(e, n);
  const c = (lon - sMeta.lonW) * sMeta.pixelsPerDegree - 0.5;
  const r = (sMeta.latN - lat) * sMeta.pixelsPerDegree - 0.5;
  const c0 = Math.max(0, Math.min(sMeta.width - 2, Math.floor(c))), r0 = Math.max(0, Math.min(sMeta.height - 2, Math.floor(r)));
  const a = Math.min(1, Math.max(0, c - c0)), b = Math.min(1, Math.max(0, r - r0));
  const W = sMeta.width, z = (i, j) => sDem[j * W + i];
  return (z(c0, r0) * (1 - a) + z(c0 + 1, r0) * a) * (1 - b) + (z(c0, r0 + 1) * (1 - a) + z(c0 + 1, r0 + 1) * a) * b;
}

// ---------------------------------------------------------------- near grid (NAC 5 m)
const NEAR = { step: 5, roots: 5, rootCells: CELLS * 2 ** (LEVELS - 1) }; // 1024 cells = 5120 m
NEAR.e0 = -715 * 5; // west edge; the NAC strip spans about -3.56 km .. +1.55 km east of the LM
NEAR.n1 = 10240; // north edge
NEAR.W = NEAR.rootCells + 1;
NEAR.H = NEAR.rootCells * NEAR.roots + 1;
NEAR.e1 = NEAR.e0 + NEAR.rootCells * NEAR.step;
NEAR.n0 = NEAR.n1 - NEAR.rootCells * NEAR.roots * NEAR.step;
const LOCAL = `+proj=eqc +lat_ts=${LM.lat} +lat_0=${LM.lat} +lon_0=${LM.lon} +x_0=0 +y_0=0 +R=${R} +units=m +no_defs`;
const nacTif = join(WORK, 'nac-local-5m.tif'), nacRaw = join(WORK, 'nac-local-5m.f32');
if (!existsSync(nacRaw)) {
  const h = NEAR.step / 2;
  execFileSync('gdalwarp', ['-q', '-overwrite', '-t_srs', LOCAL, '-te', String(NEAR.e0 - h), String(NEAR.n0 - h), String(NEAR.e1 + h), String(NEAR.n1 + h),
    '-ts', String(NEAR.W), String(NEAR.H), '-r', 'average', '-ot', 'Float32', '-dstnodata', '-32767', NAC, nacTif]);
  execFileSync('gdal_translate', ['-q', '-of', 'ENVI', nacTif, nacRaw]);
}
const nac = new Float32Array(readFileSync(nacRaw).buffer.slice(0));
if (nac.length !== NEAR.W * NEAR.H) throw new Error('unexpected NAC grid size');
const valid = (v) => v > -10000;
const nearE = (i) => NEAR.e0 + i * NEAR.step, nearN = (j) => NEAR.n1 - j * NEAR.step;

// Datum check between the two DEMs over NAC pixels (median of NAC - SLDEM).
const diffs = [];
for (let j = 0; j < NEAR.H; j += 8) for (let i = 0; i < NEAR.W; i += 8) {
  const v = nac[j * NEAR.W + i];
  if (valid(v)) diffs.push(v - sldemAt(nearE(i), nearN(j)));
}
diffs.sort((a, b) => a - b);
const q = (p) => diffs[Math.floor(p * (diffs.length - 1))];
const datum = { medianNacMinusSldemM: +q(0.5).toFixed(2), p10: +q(0.1).toFixed(2), p90: +q(0.9).toFixed(2), samples: diffs.length };
const OFFSET = datum.medianNacMinusSldemM;

// Fill NAC nodata from SLDEM (+offset), fading the local edge difference out over 300 m.
const FADE = 300 / NEAR.step;
const nearH = new Float32Array(NEAR.W * NEAR.H);
let filled = 0;
for (let j = 0; j < NEAR.H; j++) {
  const row = nac.subarray(j * NEAR.W, (j + 1) * NEAR.W);
  let first = -1, last = -1;
  for (let i = 0; i < NEAR.W; i++) if (valid(row[i])) { if (first < 0) first = i; last = i; }
  const edge = (i) => row[i] - (sldemAt(nearE(i), nearN(j)) + OFFSET);
  const dFirst = first >= 0 ? edge(first) : 0, dLast = last >= 0 ? edge(last) : 0;
  for (let i = 0; i < NEAR.W; i++) {
    const v = row[i];
    if (valid(v)) { nearH[j * NEAR.W + i] = v; continue; }
    let corr = 0;
    if (first >= 0 && i < first) corr = dFirst * Math.max(0, 1 - (first - i) / FADE);
    else if (last >= 0 && i > last) corr = dLast * Math.max(0, 1 - (i - last) / FADE);
    else if (first >= 0) { // interior hole: interpolate the two edge differences
      let a = i, b = i;
      while (a > 0 && !valid(row[a])) a--;
      while (b < NEAR.W - 1 && !valid(row[b])) b++;
      const t = (i - a) / Math.max(1, b - a);
      corr = edge(a) * (1 - t) + edge(b) * t;
    }
    nearH[j * NEAR.W + i] = sldemAt(nearE(i), nearN(j)) + OFFSET + corr;
    filled++;
  }
}
const hLM = nearH[Math.round(NEAR.n1 / NEAR.step) * NEAR.W + Math.round(-NEAR.e0 / NEAR.step)];

// ---------------------------------------------------------------- far grid (SLDEM at 80 m)
const FAR = { step: 80, cells: CELLS * 2 ** (LEVELS - 1) }; // 1024 cells = 81,920 m
FAR.W = FAR.H = FAR.cells + 1;
FAR.e0 = -FAR.cells * FAR.step / 2; FAR.n1 = FAR.cells * FAR.step / 2;
const farE = (i) => FAR.e0 + i * FAR.step, farN = (j) => FAR.n1 - j * FAR.step;
const farH = new Float32Array(FAR.W * FAR.H);
for (let j = 0; j < FAR.H; j++) for (let i = 0; i < FAR.W; i++) farH[j * FAR.W + i] = sldemAt(farE(i), farN(j)) + OFFSET;
{ // the window must cover the far square
  const [lw, ls] = toLonLat(FAR.e0, -FAR.n1), [le, ln] = toLonLat(-FAR.e0, FAR.n1);
  if (lw < sMeta.lonW || le > sMeta.lonE || ls < sMeta.latS || ln > sMeta.latN) throw new Error('SLDEM window too small for the far grid');
}

// ---------------------------------------------------------------- tile writer
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;
const curv = (e, n) => (e * e + n * n) / (2 * R);
const stats = { near: { tiles: 0, bytes: 0, largest: 0 }, far: { tiles: 0, bytes: 0, largest: 0, droppedCells: 0 } };

async function buildTile(G, name, rootOff, level, tx, ty, mask) {
  const st = stats[name];
  const spanCells = G.rootCells / 2 ** level, stride = spanCells / CELLS;
  const i0 = tx * spanCells, j0 = rootOff + ty * spanCells, n = CELLS + 1;
  const zAt = (i, j) => {
    const ii = Math.max(0, Math.min(G.W - 1, i)), jj = Math.max(0, Math.min(G.H - 1, j));
    const e = G.e(ii), nn = G.n(jj);
    return G.h[jj * G.W + ii] - hLM - curv(e, nn);
  };
  const hs = new Float32Array(n * n);
  let zmin = Infinity, zmax = -Infinity;
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
    const z = zAt(i0 + a * stride, j0 + b * stride);
    hs[b * n + a] = z; zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
  }
  let err = 0;
  if (stride > 1) {
    for (let pv = 0; pv <= spanCells; pv++) for (let pu = 0; pu <= spanCells; pu++) {
      const fi = pu / stride, fj = pv / stride;
      const a0 = Math.min(CELLS - 1, Math.floor(fi)), b0 = Math.min(CELLS - 1, Math.floor(fj)), a = fi - a0, b = fj - b0;
      const hb = (hs[b0 * n + a0] * (1 - a) + hs[b0 * n + a0 + 1] * a) * (1 - b) + (hs[(b0 + 1) * n + a0] * (1 - a) + hs[(b0 + 1) * n + a0 + 1] * a) * b;
      err = Math.max(err, Math.abs(zAt(i0 + pu, j0 + pv) - hb));
    }
  }
  const skirt = Math.max(5, err * 2 + stride * G.step);
  const pos = [], nrm = [], inside = [];
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
    const i = i0 + a * stride, j = j0 + b * stride, e = G.e(i), nn = G.n(j);
    let z = hs[b * n + a];
    const dzdx = (zAt(i + stride, j) - zAt(i - stride, j)) / (2 * stride * G.step);
    const dzdn = (zAt(i, j - stride) - zAt(i, j + stride)) / (2 * stride * G.step);
    const len = Math.hypot(dzdx, dzdn, 1);
    const ins = mask ? mask(e, nn, stride * G.step) : false;
    if (ins) z -= 50;
    inside.push(ins);
    pos.push(e, z, -nn);
    nrm.push(-dzdx / len, 1 / len, dzdn / len);
  }
  const idx = [];
  for (let b = 0; b < CELLS; b++) for (let a = 0; a < CELLS; a++) {
    const p = b * n + a, q1 = p + 1, r = p + n, s = r + 1;
    if (mask && inside[p] && inside[q1] && inside[r] && inside[s]) { st.droppedCells++; continue; }
    idx.push(p, r, q1, q1, r, s);
  }
  // Skirt ring: hides cracks between neighbouring tiles at different LODs.
  const border = [];
  for (let a = 0; a < n; a++) border.push(a);
  for (let b = 1; b < n; b++) border.push(b * n + n - 1);
  for (let a = n - 2; a >= 0; a--) border.push((n - 1) * n + a);
  for (let b = n - 2; b > 0; b--) border.push(b * n);
  const base = pos.length / 3;
  for (const k of border) { pos.push(pos[k * 3], pos[k * 3 + 1] - skirt, pos[k * 3 + 2]); nrm.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]); }
  for (let s = 0; s < border.length; s++) {
    const a = border[s], b2 = border[(s + 1) % border.length], a2 = base + s, b3 = base + ((s + 1) % border.length);
    idx.push(a, b2, a2, b2, b3, a2, a, a2, b2, b2, a2, b3);
  }
  let content = null;
  if (idx.length) {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
      .setMaterial(doc.createMaterial('regolith').setBaseColorFactor([0.42, 0.41, 0.4, 1]).setRoughnessFactor(1).setMetallicFactor(0));
    doc.createScene().addChild(doc.createNode(`${name}-L${level}`).setMesh(doc.createMesh(`${name}-L${level}`).addPrimitive(prim)));
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizeNormal: 8 }));
    const glb = await io.writeBinary(doc);
    const rel = `${name}/${level}/${rootOff / G.rootCells}_${tx}_${ty}.glb`;
    mkdirSync(join(OUT, name, String(level)), { recursive: true });
    writeFileSync(join(OUT, rel), glb);
    st.tiles++; st.bytes += glb.length; st.largest = Math.max(st.largest, glb.length);
    content = { uri: rel };
  }
  const e0 = G.e(i0), e1 = G.e(i0 + spanCells), nN = G.n(j0), nS = G.n(j0 + spanCells);
  const zlo = zmin - skirt - (mask ? 50 : 0), zhi = zmax;
  const tile = {
    boundingVolume: { box: [(e0 + e1) / 2, (nS + nN) / 2, (zlo + zhi) / 2, (e1 - e0) / 2, 0, 0, 0, (nN - nS) / 2, 0, 0, 0, (zhi - zlo) / 2 + 0.5] },
    geometricError: level === LEVELS - 1 ? 0 : Math.max(0.5, +err.toFixed(2)),
    refine: 'REPLACE',
  };
  if (content) tile.content = content;
  if (level < LEVELS - 1) {
    tile.children = [];
    for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) tile.children.push(await buildTile(G, name, rootOff, level + 1, tx * 2 + cx, ty * 2 + cy, mask));
    let lo = Infinity, hi = -Infinity;
    for (const c of [tile, ...tile.children]) { const b = c.boundingVolume.box; lo = Math.min(lo, b[2] - b[11]); hi = Math.max(hi, b[2] + b[11]); }
    tile.boundingVolume.box[2] = (lo + hi) / 2; tile.boundingVolume.box[11] = (hi - lo) / 2;
  }
  return tile;
}

const t0 = Date.now();
const nearG = { h: nearH, W: NEAR.W, H: NEAR.H, step: NEAR.step, rootCells: NEAR.rootCells, e: nearE, n: nearN };
const farG = { h: farH, W: FAR.W, H: FAR.H, step: FAR.step, rootCells: FAR.cells, e: farE, n: farN };
// A far vertex is "inside" when it lies at least one far cell inside the near footprint.
const farMask = (e, n, inset) => e > NEAR.e0 + inset && e < NEAR.e1 - inset && n > NEAR.n0 + inset && n < NEAR.n1 - inset;
const roots = [await buildTile(farG, 'far', 0, 0, 0, 0, farMask)];
for (let r = 0; r < NEAR.roots; r++) roots.push(await buildTile(nearG, 'near', r * NEAR.rootCells, 0, 0, 0, null));

let lo = Infinity, hi = -Infinity, w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
for (const t of roots) {
  const b = t.boundingVolume.box;
  lo = Math.min(lo, b[2] - b[11]); hi = Math.max(hi, b[2] + b[11]);
  s = Math.min(s, b[1] - b[7]); nn = Math.max(nn, b[1] + b[7]); w = Math.min(w, b[0] - b[3]); e = Math.max(e, b[0] + b[3]);
}
const tileset = {
  asset: { version: '1.1', gltfUpAxis: 'Y', generator: 'lunar-field-expedition scripts/build-v3-terrain.mjs' },
  geometricError: 2000,
  root: {
    boundingVolume: { box: [(w + e) / 2, (s + nn) / 2, (lo + hi) / 2, (e - w) / 2, 0, 0, 0, (nn - s) / 2, 0, 0, 0, (hi - lo) / 2] },
    geometricError: Math.max(...roots.map((r) => r.geometricError)) * 2,
    refine: 'ADD',
    children: roots,
  },
};
writeFileSync(join(OUT, 'tileset.json'), JSON.stringify(tileset));

// ---------------------------------------------------------------- landmarks (for the catalog and S5)
const lmk = {};
// Highest point inside each feature's IAU Gazetteer bounds (planetarynames.wr.usgs.gov,
// read 2026-10-31): Mons Hadley 26.32-27.13 N, 3.74-4.40 E; Mons Hadley Delta 25.44-25.99 N,
// 3.46-3.86 E. Height is reported above the LM and above the lowest far-grid point within
// 10 km of the massif's bounds (the adjacent plain).
const toEN = (lon, lat) => [(lon - LM.lon) * D * R * COS0, (lat - LM.lat) * D * R];
function peak(name, latS, latN, lonW, lonE) {
  const [e0, n0] = toEN(lonW, latS), [e1, n1] = toEN(lonE, latN);
  let best = { z: -Infinity }, low = Infinity;
  for (let j = 0; j < FAR.H; j++) for (let i = 0; i < FAR.W; i++) {
    const ee = farE(i), n2 = farN(j), z = farH[j * FAR.W + i];
    if (ee >= e0 && ee <= e1 && n2 >= n0 && n2 <= n1 && z > best.z) best = { z, e: ee, n: n2 };
    if (ee >= e0 - 10000 && ee <= e1 + 10000 && n2 >= n0 - 10000 && n2 <= n1 + 10000) low = Math.min(low, z);
  }
  const [lon, lat] = toLonLat(best.e, best.n);
  lmk[name] = { gazetteerBounds: { latS, latN, lonW, lonE }, east: best.e, north: best.n, lat: +lat.toFixed(4), lon: +lon.toFixed(4), elevationM: Math.round(best.z), heightAboveLmM: Math.round(best.z - hLM), heightAboveLowestNearbyM: Math.round(best.z - low), distanceKm: +(Math.hypot(best.e, best.n) / 1000).toFixed(1) };
}
peak('monsHadleySummit', 26.32, 27.13, 3.74, 4.40);
peak('monsHadleyDeltaSummit', 25.44, 25.99, 3.46, 3.86);
const meta = {
  generatedBy: 'scripts/build-v3-terrain.mjs', frame: 'Z-up tileset frame: x east, y north, z up (glTF content Y-up); origin at the LM 26.13239 N 3.63330 E; 1 unit = 1 m; no vertical exaggeration',
  curvature: 'applied: z = h - hLM - (x^2 + y^2) / (2 * 1737400)',
  lmElevationM: +hLM.toFixed(2), datumCheck: datum, sldemOffsetAppliedM: OFFSET, nearCellsFilledFromSldem: filled, nearCellsTotal: NEAR.W * NEAR.H,
  near: { source: 'LROC NAC_DTM_APOLLO15 (2 m) averaged to 5 m; gaps from SLDEM2015 + offset', extentM: { west: NEAR.e0, east: NEAR.e1, south: NEAR.n0, north: NEAR.n1 }, levels: 'L0 80 m ... L4 5 m', ...stats.near },
  far: { source: 'SLDEM2015 512 ppd (~59 m) bilinear to 80 m', extentM: { west: FAR.e0, east: -FAR.e0, south: -FAR.n1, north: FAR.n1 }, levels: 'L0 1280 m ... L4 80 m', ...stats.far },
  landmarks: lmk, seconds: (Date.now() - t0) / 1000,
};
writeFileSync(join(OUT, 'build-meta.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(JSON.stringify(meta, null, 1));
