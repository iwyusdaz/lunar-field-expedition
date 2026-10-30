/**
 * build-v3-models.mjs — v3 (plan 10, S4) models. Format from _templates/spikes/RESULTS.md:
 * GLB, KHR_mesh_quantization + EXT_meshopt_compression, textures KTX2 (KHR_texture_basisu).
 * 1 unit = 1 m, +Y up, origin at the centre of the ground contact. Every object is a root
 * node with an identity transform (named by its catalog id, extras.objectId) and a child
 * mesh node that holds the KHR_mesh_quantization transform: move the root, not the child.
 *
 * public/assets/v3/models/
 *   alsep-set.glb     Own work (this script): the Apollo 15 ALSEP instruments as separate
 *                     root nodes, each named by its catalog id with extras.objectId:
 *                     alsep-central-station, alsep-seismometer (+ pse-skirt, not part of the
 *                     catalog bounds), alsep-retroreflector, alsep-magnetometer,
 *                     alsep-heat-flow, rtg, sample-bag. Dimensions from the sources in
 *                     research/apollo15-facts.md ("v3 S4" table); geometry simplified.
 *                     Textures are procedural (own work): crinkled foil, dusty thermal
 *                     paint, the 300-cube retroreflector array, Teflon, a bag tag.
 *                     When unrotated, antennas and the retroreflector face +Z (glTF) =
 *                     south in the terrain-v3 frame, toward Earth at about 64 deg elevation.
 *   moon-rock-0N.glb  Poly Haven CC0 moon_rock_04..07 at their scanned size (5-17 cm),
 *                     textures re-encoded to KTX2. Boulders are instances scaled in the app.
 *   genesis-rock-reconstructed.glb
 *                     Poly Haven CC0 moon_rock_07, uniformly scaled (on the root node) to 7.5 cm long and
 *                     recoloured to a white anorthosite tone. The real sample 15415's shape
 *                     is NOT reproduced (catalog honesty: reconstructed).
 * Run: node scripts/build-v3-models.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data/raw/v3');
const WORK = join(ROOT, 'data/work/v3/models');
const OUT = join(ROOT, 'public/assets/v3/models');
const TOKTX = process.env.TOKTX || join(homedir(), 'ktx-software/bin/toktx');
const ENV = { ...process.env, DYLD_LIBRARY_PATH: join(homedir(), 'ktx-software/lib') };
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;
const report = [];

// ---------------------------------------------------------------- image helpers (own work)
function png(w, h, px) { // px: Uint8Array RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const L = Buffer.alloc(4); L.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const C = Buffer.alloc(4); C.writeUInt32BE(crc(body)); return Buffer.concat([L, body, C]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hash(i, j, seed) { let h = (i * 374761393 + j * 668265263 + seed * 2147483647) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, period, seed) { // tileable value noise
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const w = (a) => ((a % period) + period) % period;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed), c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, period, seed, oct = 4) { let s = 0, amp = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += amp * vnoise(x * f, y * f, period * f, seed + o); amp *= 0.5; f *= 2; } return s; }
function voronoiFacet(x, y, period, seed) { // crinkled foil: random facet normal per cell
  const xi = Math.floor(x), yi = Math.floor(y); let best = 9, id = [0, 0];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, w = (a) => ((a % period) + period) % period;
    const px = cx + hash(w(cx), w(cy), seed), py = cy + hash(w(cx), w(cy), seed + 7);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < best) { best = d; id = [w(cx), w(cy)]; }
  }
  return [hash(id[0], id[1], seed + 13) * 2 - 1, hash(id[0], id[1], seed + 29) * 2 - 1];
}
function texture(name, size, fn) { // fn(u, v) -> [r, g, b] in 0..1
  const px = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = fn(x / size, y / size);
    for (let k = 0; k < 3; k++) px[(y * size + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(c[k] * 255)));
  }
  const f = join(WORK, `${name}.png`);
  writeFileSync(f, png(size, size, px));
  return f;
}
function normalFromHeight(name, size, height, strength) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  return texture(name, size, (u, v) => {
    const x = Math.round(u * size), y = Math.round(v * size), at = (i, j) => h[((j + size) % size) * size + ((i + size) % size)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l) * 0.5 + 0.5, (dy / l) * 0.5 + 0.5, (1 / l) * 0.5 + 0.5]; // OpenGL convention (+Y up in UV v-down image)
  });
}
function ktx2(pngFile, srgb, uastc) {
  const out = pngFile.replace(/\.png$/, '.ktx2');
  const enc = uastc ? ['--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1.5', '--zcmp', '18'] : ['--encode', 'etc1s', '--clevel', '2', '--qlevel', '192'];
  execFileSync(TOKTX, ['--t2', '--genmipmap', '--assign_oetf', srgb ? 'srgb' : 'linear', ...enc, out, pngFile], { env: ENV, stdio: ['ignore', 'ignore', 'inherit'] });
  return readFileSync(out);
}

// ---------------------------------------------------------------- materials (own work)
const dust = (u, v, s) => 0.75 + 0.25 * fbm(u * 6, v * 6, 6, s); // dusty variation
const MATS = {
  'foil-gold': {
    metal: 1, rough: 0.32, size: 512,
    albedo: (u, v) => { const n = fbm(u * 8, v * 8, 8, 3); return [0.86 * (0.85 + 0.2 * n), 0.62 * (0.85 + 0.2 * n), 0.25 * (0.8 + 0.2 * n)]; },
    normal: { height: (u, v) => { const f = voronoiFacet(u * 24, v * 24, 24, 5); return f[0] * 0.6 + f[1] * 0.4 + 0.6 * fbm(u * 16, v * 16, 16, 9); }, strength: 1.4 },
  },
  'foil-silver': {
    metal: 1, rough: 0.28, size: 512,
    albedo: (u, v) => { const n = fbm(u * 8, v * 8, 8, 4); const g = 0.82 * (0.88 + 0.16 * n); return [g, g, g * 0.98]; },
    normal: { height: (u, v) => { const f = voronoiFacet(u * 20, v * 20, 20, 6); return f[0] * 0.6 + f[1] * 0.4 + 0.6 * fbm(u * 16, v * 16, 16, 10); }, strength: 1.2 },
  },
  'paint-white': { // white thermal paint with grey regolith dust settling low
    metal: 0, rough: 0.65, size: 256,
    albedo: (u, v) => { const d = dust(u, v, 11) - 0.25 * Math.max(0, v - 0.6); return [0.86 * d, 0.85 * d, 0.82 * d]; },
    normal: { height: (u, v) => 0.3 * fbm(u * 32, v * 32, 32, 12), strength: 1.2 },
  },
  'paint-dark': { // SNAP-27 fins: high-emissivity dark coating
    metal: 0.2, rough: 0.55, size: 256,
    albedo: (u, v) => { const d = 0.9 + 0.2 * fbm(u * 10, v * 10, 10, 13); return [0.14 * d, 0.14 * d, 0.15 * d]; },
    normal: { height: (u, v) => 0.3 * fbm(u * 24, v * 24, 24, 14), strength: 1 },
  },
  aluminium: {
    metal: 0.9, rough: 0.42, size: 256,
    albedo: (u, v) => { const g = 0.72 + 0.06 * fbm(u * 2, v * 40, 2, 15); return [g, g, g * 1.01]; }, // brushed streaks
    normal: { height: (u, v) => 0.2 * fbm(u * 2, v * 64, 2, 16), strength: 0.8 },
  },
  'black-anodized': {
    metal: 0.5, rough: 0.5, size: 256,
    albedo: (u, v) => { const d = 0.9 + 0.2 * fbm(u * 8, v * 8, 8, 17); return [0.05 * d, 0.05 * d, 0.055 * d]; },
    normal: { height: (u, v) => 0.2 * fbm(u * 24, v * 24, 24, 18), strength: 0.6 },
  },
  'corner-cubes': { // 300 fused-silica corner cubes, 3.8 cm, hexagonal rows: 25 x 12 on the 1.04 x 0.61 m panel
    metal: 0.8, rough: 0.12, size: 1024,
    albedo: (u, v) => { const c = cube(u, v); return c.inCube ? [0.06 + 0.1 * c.facet, 0.07 + 0.1 * c.facet, 0.09 + 0.12 * c.facet] : [0.7, 0.7, 0.71]; },
    normal: { height: (u, v) => { const c = cube(u, v); return c.inCube ? -0.4 + 0.15 * c.facet : (c.d < 0.52 ? -0.1 : 0); }, strength: 6 },
  },
  teflon: {
    metal: 0, rough: 0.7, size: 256,
    albedo: (u, v) => { const d = 0.92 + 0.08 * fbm(u * 5, v * 5, 5, 19); return [0.9 * d, 0.89 * d, 0.86 * d]; },
    normal: { height: (u, v) => fbm(u * 3, v * 9, 3, 20) * 1.2, strength: 2.5 },
  },
};
function cube(u, v) {
  const cols = 25, rows = 12;
  const row = Math.floor(v * rows), off = row % 2 ? 0.5 : 0;
  const fx = u * cols - off, col = Math.floor(fx);
  const cx = (fx - col) - 0.5, cy = (v * rows - row) - 0.5;
  const d = Math.hypot(cx, cy * (rows / cols) * (1.04 / 0.61) * 1);
  const ang = Math.atan2(cy, cx), facet = ((Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 3) % 3) / 2);
  return { inCube: d < 0.46, d, facet };
}

const doc = new Document();
const buffer = doc.createBuffer();
const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);
const gMats = {};
function material(name) {
  if (gMats[name]) return gMats[name];
  const m = MATS[name];
  const alb = ktx2(texture(`${name}-albedo`, m.size, m.albedo), true, false);
  const nor = ktx2(normalFromHeight(`${name}-normal`, m.size, m.normal.height, m.normal.strength), false, true);
  const tA = doc.createTexture(`${name}-albedo`).setImage(alb).setMimeType('image/ktx2');
  const tN = doc.createTexture(`${name}-normal`).setImage(nor).setMimeType('image/ktx2');
  gMats[name] = doc.createMaterial(name).setBaseColorTexture(tA).setNormalTexture(tN).setMetallicFactor(m.metal).setRoughnessFactor(m.rough);
  return gMats[name];
}
function primitiveFrom(geo, matName) {
  const g = geo.index ? geo : geo; // three geometries are indexed (except tubes after merge — handled)
  const p = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.position.array)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.normal.array)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.attributes.uv.array)).setBuffer(buffer))
    .setMaterial(material(matName));
  if (g.index) p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.index.array)).setBuffer(buffer));
  return p;
}
// A part is [geometry, materialName, matrix]. Parts of one prop are merged per material.
const at = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, h, seg = 24, rt = r) => new THREE.CylinderGeometry(rt, r, h, seg);
function rod(a, b, r, seg = 10) { // cylinder between two points
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), len = dir.length();
  const g = cyl(r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return [g, new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))];
}
function prop(id, parts, extras) {
  const byMat = {};
  for (const [geo, mat, mtx] of parts) {
    const g = (geo.index ? geo : geo).clone().applyMatrix4(mtx || new THREE.Matrix4());
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    (byMat[mat] ||= []).push(g.index ? g : g); // all inputs here are indexed
  }
  const mesh = doc.createMesh(id);
  const bb = new THREE.Box3();
  for (const [mat, gs] of Object.entries(byMat)) {
    const merged = mergeGeometries(gs, false);
    merged.computeBoundingBox(); bb.union(merged.boundingBox);
    mesh.addPrimitive(primitiveFrom(merged, mat));
  }
  const size = bb.getSize(new THREE.Vector3());
  // Root node with an identity transform (the app may move it); the mesh sits on a child
  // node, which carries the KHR_mesh_quantization dequantization transform.
  const node = doc.createNode(id).setExtras({ objectId: extras.catalog ? id : undefined, ...extras, boundsM: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)] });
  node.addChild(doc.createNode(`${id}-mesh`).setMesh(mesh));
  report.push({ id, boundsM: node.getExtras().boundsM, triangles: Object.values(byMat).flat().reduce((a, g) => a + g.index.count / 3, 0) });
  return node;
}

// Earth direction for antennas and the reflector: south (+Z in glTF), 64 deg up (approximate).
const EARTH_EL = 64 * Math.PI / 180;

// ---------------------------------------------------------------- ALSEP central station
const cs = [];
cs.push([box(0.40, 0.25, 0.30), 'foil-silver', at(0, 0.125, 0)]);
cs.push([box(0.41, 0.03, 0.31), 'paint-white', at(0, 0.265, 0)]); // thermal plate
cs.push([box(0.62, 0.012, 0.46), 'foil-silver', at(0, 0.58, 0)]); // raised sunshield
for (const [x, z] of [[-0.19, -0.14], [0.19, -0.14], [-0.19, 0.14], [0.19, 0.14]]) { const [g, m] = rod([x, 0.28, z], [x * 1.3, 0.574, z * 1.4], 0.006); cs.push([g, 'aluminium', m]); }
cs.push([box(0.07, 0.05, 0.07), 'black-anodized', at(-0.13, 0.305, 0.09)]); // dust detector
{ const [g, m] = rod([0.17, 0.28, -0.12], [0.17, 0.80, -0.12], 0.016); cs.push([g, 'aluminium', m]); } // carry-bar mast
cs.push([box(0.07, 0.07, 0.07), 'black-anodized', at(0.17, 0.83, -0.12)]); // antenna gimbal
{
  const base = new THREE.Vector3(0.17, 0.86, -0.12), dir = new THREE.Vector3(0, Math.sin(EARTH_EL), Math.cos(EARTH_EL));
  const tip = base.clone().add(dir.clone().multiplyScalar(0.58));
  const [g, m] = rod(base.toArray(), tip.toArray(), 0.019, 16); cs.push([g, 'paint-white', m]); // 58 cm x 3.8 cm helical antenna
  const turns = 14, pts = [];
  const side = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3().crossVectors(dir, side).normalize();
  for (let k = 0; k <= turns * 16; k++) { const t = k / (turns * 16), a = t * turns * 2 * Math.PI; pts.push(base.clone().add(dir.clone().multiplyScalar(0.58 * t)).add(side.clone().multiplyScalar(0.024 * Math.cos(a))).add(up.clone().multiplyScalar(0.024 * Math.sin(a)))); }
  cs.push([new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 16, 0.0025, 5), 'aluminium', null]);
}

// ---------------------------------------------------------------- passive seismometer
const pse = [
  [cyl(0.115, 0.29, 32), 'foil-silver', at(0, 0.145, 0)], // 23 cm x 29 cm drum (NSSDC)
  [cyl(0.118, 0.012, 32), 'paint-white', at(0, 0.296, 0)],
  [new THREE.SphereGeometry(0.012, 12, 8), 'black-anodized', at(0.05, 0.302, 0.03)], // bubble level
];
const skirtGeo = (() => { // aluminized Mylar skirt spread on the ground (radius approximate)
  const g = new THREE.RingGeometry(0.115, 0.62, 48, 6);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); p.setY(i, 0.004 + 0.012 * fbm(x * 6 + 10, z * 6 + 10, 64, 21) * (r > 0.13 ? 1 : 0) + (r < 0.14 ? 0.02 : 0)); }
  g.computeVertexNormals();
  return g;
})();

// ---------------------------------------------------------------- laser ranging retroreflector (Apollo 15: 1.04 x 0.61 m, 300 cubes)
const lr = [];
{
  const tilt = Math.PI / 2 - EARTH_EL; // panel normal points at Earth
  const panel = at(0, 0.24, 0, tilt, 0, 0);
  const frame = box(1.04, 0.045, 0.61).applyMatrix4(panel);
  lr.push([frame, 'aluminium', null]);
  const face = new THREE.PlaneGeometry(1.0, 0.57); face.rotateX(-Math.PI / 2); face.translate(0, 0.0235, 0); face.applyMatrix4(panel);
  lr.push([face, 'corner-cubes', null]);
  lr.push([box(0.9, 0.025, 0.5), 'aluminium', at(0, 0.0125, 0)]); // pallet base
  for (const x of [-0.42, 0.42]) {
    const [g1, m1] = rod([x, 0.025, 0.2], [x, 0.24 + 0.27 * Math.sin(tilt), -0.27 * Math.cos(tilt) + 0.02], 0.012); lr.push([g1, 'aluminium', m1]);
    const [g2, m2] = rod([x, 0.025, -0.2], [x, 0.24 - 0.27 * Math.sin(tilt), 0.27 * Math.cos(tilt) - 0.02], 0.012); lr.push([g2, 'aluminium', m2]);
  }
  lr.push([box(0.12, 0.08, 0.06), 'black-anodized', at(0.38, 0.065, 0.18)]); // alignment handle / sun compass
}

// ---------------------------------------------------------------- lunar surface magnetometer (sensors ~0.72 m up, ~1.5 m apart, booms ~35 deg)
const lsm = [
  [box(0.26, 0.18, 0.26), 'foil-silver', at(0, 0.12, 0)],
  [box(0.27, 0.02, 0.27), 'paint-white', at(0, 0.215, 0)],
];
for (const a of [Math.PI / 2, Math.PI / 2 + 2.094, Math.PI / 2 + 4.189]) {
  const r = 0.866, x = r * Math.cos(a), z = r * Math.sin(a);
  const [g, m] = rod([0.11 * Math.cos(a), 0.2, 0.11 * Math.sin(a)], [x, 0.66, z], 0.014); lsm.push([g, 'paint-white', m]);
  lsm.push([cyl(0.05, 0.12, 20), 'paint-white', at(x, 0.72, z)]);
  lsm.push([cyl(0.051, 0.02, 20), 'black-anodized', at(x, 0.785, z)]);
  const [lg, lm] = rod([0.1 * Math.cos(a + 0.5), 0.05, 0.1 * Math.sin(a + 0.5)], [0.16 * Math.cos(a + 0.5), 0.0, 0.16 * Math.sin(a + 0.5)], 0.01); lsm.push([lg, 'aluminium', lm]);
}

// ---------------------------------------------------------------- heat flow experiment electronics box (size approximate)
const hfe = [
  [box(0.28, 0.16, 0.22), 'paint-white', at(0, 0.08, 0)],
  [box(0.30, 0.012, 0.24), 'foil-gold', at(0, 0.166, 0)],
  [cyl(0.012, 0.03, 8), 'black-anodized', at(0.1, 0.19, 0.05)],
];
for (const s of [-1, 1]) { const [g, m] = rod([0.14 * s, 0.03, 0.0], [0.30 * s, 0.006, 0.02], 0.004, 6); hfe.push([g, 'black-anodized', m]); } // cable stubs toward the probe holes

// ---------------------------------------------------------------- SNAP-27 RTG (46 cm x 39.9 cm with fins, NASM)
const rtg = [
  [cyl(0.105, 0.40, 32), 'paint-dark', at(0, 0.24, 0)],
  [cyl(0.09, 0.03, 24), 'aluminium', at(0, 0.445, 0)],
  [cyl(0.06, 0.015, 24), 'paint-dark', at(0, 0.4525, 0)],
  [box(0.30, 0.04, 0.30), 'aluminium', at(0, 0.02, 0)], // subpackage mount
];
for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; rtg.push([box(0.095, 0.38, 0.006), 'paint-dark', at(Math.cos(a) * 0.1525, 0.24, Math.sin(a) * 0.1525, 0, -a, 0)]); }

// ---------------------------------------------------------------- sample bag (fictional field team; size approximate)
const bag = [];
{
  const g = new THREE.BoxGeometry(0.19, 0.045, 0.2, 6, 2, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setY(i, y * (1 - 0.6 * (Math.abs(x) / 0.095) ** 2) + 0.004 * Math.sin(z * 60)); }
  g.computeVertexNormals();
  bag.push([g, 'teflon', at(0, 0.0225, 0)]);
  bag.push([box(0.19, 0.012, 0.03), 'aluminium', at(0, 0.03, -0.095)]); // folded closure strip
  bag.push([box(0.05, 0.003, 0.03), 'paint-white', at(0.05, 0.047, 0.04)]); // tag
}

const sceneNode = doc.createScene('alsep-set');
const items = [
  ['alsep-central-station', cs, 'Apollo 15 ALSEP central station (own-work reconstruction)'],
  ['alsep-seismometer', pse, 'Passive seismic experiment drum, 23 x 29 cm (own-work reconstruction)'],
  ['alsep-retroreflector', lr, 'Apollo 15 laser ranging retroreflector, 1.04 x 0.61 m, 300 corner cubes (own-work reconstruction)'],
  ['alsep-magnetometer', lsm, 'Lunar surface magnetometer (own-work reconstruction)'],
  ['alsep-heat-flow', hfe, 'Heat flow experiment electronics box (own-work reconstruction, size approximate)'],
  ['rtg', rtg, 'SNAP-27 radioisotope thermoelectric generator, 46 x 39.9 cm (own-work reconstruction)'],
  ['sample-bag', bag, 'Sample bag of the fictional field team (own work, size approximate)'],
];
for (const [id, parts, desc] of items) sceneNode.addChild(prop(id, parts, { catalog: true, description: desc, honesty: 'reconstructed' }));
sceneNode.addChild(prop('pse-skirt', [[skirtGeo, 'foil-silver', null]], { catalog: false, description: 'Thermal skirt around the seismometer drum; radius approximate; place outside the alsep-seismometer root so it does not count in its bounds' }));
await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
writeFileSync(join(OUT, 'alsep-set.glb'), await io.writeBinary(doc));

// ---------------------------------------------------------------- Poly Haven rocks (CC0) -> KTX2 + meshopt
async function rock(phId, outName, opts = {}) {
  const d = await io.read(join(RAW, phId, `${phId}_1k.gltf`));
  d.createExtension(KHRTextureBasisu).setRequired(true);
  for (const t of d.getRoot().listTextures()) {
    const uri = t.getURI() || t.getName();
    const isColor = /diff/.test(uri), isNormal = /nor/.test(uri);
    const src = join(WORK, `${outName}-${uri.split('/').pop().replace(/\.\w+$/, '')}.png`);
    const inFile = join(RAW, phId, uri);
    const resize = ['-resize', opts.texSize ? `${opts.texSize}x${opts.texSize}` : '1024x1024'];
    if (isColor && opts.whiten) execFileSync('magick', [inFile, ...resize, '-colorspace', 'Gray', '-level', '0%,70%', '-fill', '#efece6', '-tint', '100', '-modulate', '118,8', '-colorspace', 'sRGB', '-type', 'TrueColor', src]);
    else execFileSync('magick', [inFile, ...resize, '-type', 'TrueColor', src]);
    t.setImage(ktx2(src, isColor, isNormal || !isColor)).setMimeType('image/ktx2').setURI(`${outName}-${uri.split('/').pop().replace(/\.\w+$/, '.ktx2')}`);
  }
  // Wrap the scan in a root node (identity transform unless scaled) so the quantization
  // transform lands on the child mesh node, never on the node the app positions.
  const scene = d.getRoot().listScenes()[0];
  const top = d.createNode(opts.id || outName);
  for (const c of scene.listChildren()) { scene.removeChild(c); top.addChild(c); }
  scene.addChild(top);
  if (opts.scaleTo) {
    const { min, max } = getBounds(scene);
    top.setScale(Array(3).fill(opts.scaleTo / Math.max(...max.map((v, i) => v - min[i]))));
  }
  top.setName(opts.id || outName).setExtras({ ...(opts.id ? { objectId: opts.id } : {}), source: `https://polyhaven.com/a/${phId}`, licence: 'CC0 1.0', honesty: opts.honesty || 'scan of a real rock styled as lunar (Poly Haven moon collection)' });
  const { min, max } = getBounds(scene);
  const boundsM = max.map((v, i) => +(v - min[i]).toFixed(4));
  top.setExtras({ ...top.getExtras(), boundsM });
  await d.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  writeFileSync(join(OUT, `${outName}.glb`), await io.writeBinary(d));
  const scan = JSON.parse(readFileSync(join(ROOT, 'evaluation/results/asset-licence-check.json'), 'utf8')).sources.find((x) => x.id === phId)?.dimensionsMm;
  report.push({ id: opts.id || outName, file: `${outName}.glb`, boundsM, polyhavenDimensionsMm: scan, scaledTo: opts.scaleTo || null });
}
for (const n of [4, 5, 6, 7]) await rock(`moon_rock_0${n}`, `moon-rock-0${n}`, { texSize: 512 });
await rock('moon_rock_07', 'genesis-rock-reconstructed', { id: 'genesis-rock', scaleTo: 0.075, whiten: true, texSize: 512, honesty: 'reconstructed: Poly Haven CC0 rock scan recoloured and scaled; not the real shape of sample 15415' });

for (const f of ['alsep-set.glb', 'moon-rock-04.glb', 'moon-rock-05.glb', 'moon-rock-06.glb', 'moon-rock-07.glb', 'genesis-rock-reconstructed.glb']) report.push({ file: `public/assets/v3/models/${f}`, bytes: statSync(join(OUT, f)).size });
writeFileSync(join(OUT, 'models-meta.json'), JSON.stringify({ generatedBy: 'scripts/build-v3-models.mjs', units: 'metres, +Y up, origin at ground contact', items: report }, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
