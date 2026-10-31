/**
 * hadley-hardware.js — the v3 Lunar Module descent stage and Lunar Roving
 * Vehicle (S5 review finding F3), own work (MIT code, textures generated here,
 * CC0). They replace the v2 flat-colour assemblies in the v3 scene.
 *
 * Built at true scale (1 unit = 1 m) after public-domain NASA Apollo 15 surface
 * photographs (Apollo Lunar Surface Journal: AS15-86-11603, AS15-87-11839,
 * AS15-88-11866, AS15-85-11471). Simplified, approximate geometry; the details
 * that make each one readable are there:
 * - LM: crinkled amber and black Kapton blankets and gold foil with facet
 *   normals and roughness variation, taped blanket seams, the "UNITED STATES"
 *   lettering and flag on the descent stage, the ladder and porch, the MESA
 *   (equipment bay) folded down beside the ladder, dish footpads with bent
 *   surface-contact probes, and the engine bell in its bay.
 * - LRV: an open tubular chassis with floor panels, two tubular seats with
 *   webbing, a console with gauges, the T-handle hand controller, the orange
 *   fibreglass fenders, wire-mesh wheels, a rear tool pallet with tongs, scoop
 *   and rake, and grey dust worn into the lower parts.
 * Static parts are merged per material (a few draw calls each). The rover's
 * wheels stay separate (they turn) and its relay masts sit apart from the
 * chassis, so the chassis keeps the published 3.1 x 2.06 x 1.14 m.
 * @module scenes/hadley-hardware
 */
import * as THREE from 'three';
import { mergeStaticGroup } from '../v2/cinematic-grade.js';

const hasDOM = typeof document !== 'undefined';
const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Canvas texture from an RGBA image filled by fn(x, y) -> [r, g, b, a] (0..255). */
function canvasTex(size, fn, { srgb = true, repeat = 1 } = {}) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) img.data.set(fn(x, y), (y * size + x) * 4);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/**
 * Crinkled foil: Voronoi facets, each a small tilted plane (the creases of a
 * thermal blanket), plus taped seams. Returns height (0..1) per pixel.
 */
function crinkleField(size, seed, cells = 70, seams = 3) {
  const rnd = rngOf(seed);
  const pts = Array.from({ length: cells }, () => ({ x: rnd() * size, y: rnd() * size, a: (rnd() - 0.5) * 0.06, b: (rnd() - 0.5) * 0.06, h: rnd() }));
  const h = new Float32Array(size * size);
  const seamAt = Array.from({ length: seams }, () => Math.floor(rnd() * size));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let best = 1e9, bp = null, second = 1e9;
    for (const p of pts) {
      // wrap so the texture tiles
      const dx = Math.min(Math.abs(x - p.x), size - Math.abs(x - p.x)), dy = Math.min(Math.abs(y - p.y), size - Math.abs(y - p.y));
      const d = dx * dx + dy * dy;
      if (d < best) { second = best; best = d; bp = p; } else if (d < second) second = d;
    }
    const edge = Math.min(1, (Math.sqrt(second) - Math.sqrt(best)) / 3); // crease line between facets
    let v = 0.5 + bp.h * 0.3 + (x - bp.x) * bp.a + (y - bp.y) * bp.b;
    v = v * (0.75 + 0.25 * edge);
    for (const s of seamAt) if (Math.abs(y - s) < 3) v = 0.62; // tape: flat strip
    h[y * size + x] = Math.max(0, Math.min(1, v));
  }
  return { h, seamAt };
}

function normalFromField(h, size, strength) {
  return canvasTex(size, (x, y) => {
    const at = (i, j) => h[((j + size) % size) * size + ((i + size) % size)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255];
  }, { srgb: false });
}

/** A foil or blanket material: base colour, crinkle normals, roughness from the facets. */
function foilMaterial(rgb, { seed, metal = 0.6, rough = 0.4, strength = 9, size = 256, seamRgb = null, repeat = 1, dust = 0, cells = 70, contrast = 0.5 }) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: metal, roughness: 1 });
  m.userData.surfaceDetail = true;
  if (!hasDOM) { m.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); m.roughness = rough; return m; }
  const { h, seamAt } = crinkleField(size, seed, cells);
  const seam = (y) => seamAt.some((s) => Math.abs(y - s) < 3);
  m.map = canvasTex(size, (x, y) => {
    const k = 1 - contrast * 0.56 + contrast * h[y * size + x];
    const d = dust * Math.max(0, y / size - 0.55) * 1.6; // regolith dust settles low on each panel
    const c = seam(y) && seamRgb ? seamRgb : rgb;
    return [c[0] * k * (1 - d) + 120 * d, c[1] * k * (1 - d) + 116 * d, c[2] * k * (1 - d) + 110 * d, 255];
  }, { repeat });
  m.normalMap = normalFromField(h, size, strength);
  m.normalMap.repeat.set(repeat, repeat);
  m.roughnessMap = canvasTex(size, (x, y) => { const v = (rough + (h[y * size + x] - 0.5) * 0.35) * 255; return [v, v, v, 255]; }, { srgb: false, repeat });
  return m;
}

/** Brushed or dusty metal with fine streaks (struts, frames, ladders). */
function metalMaterial(rgb, { seed = 1, metal = 0.75, rough = 0.42, dust = 0.3 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: metal, roughness: 1 });
  m.userData.surfaceDetail = true;
  if (!hasDOM) { m.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); return m; }
  const rnd = rngOf(seed), size = 128;
  const streak = Array.from({ length: size }, () => rnd());
  m.map = canvasTex(size, (x, y) => {
    const s = 0.88 + 0.16 * streak[x];
    const d = dust * (0.4 + 0.6 * rnd()) * (y / size);
    return [rgb[0] * s * (1 - d) + 125 * d, rgb[1] * s * (1 - d) + 120 * d, rgb[2] * s * (1 - d) + 112 * d, 255];
  });
  m.roughnessMap = canvasTex(size, (x, y) => { const v = (rough + 0.2 * (streak[(x + y) % size] - 0.5)) * 255; return [v, v, v, 255]; }, { srgb: false });
  return m;
}

/** A texture drawn with the 2D canvas API (lettering, gauges, webbing). */
function drawnTex(w, h, draw, { srgb = true } = {}) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function strut(a, b, r, mat, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
function box(w, h, d, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}
function shadowed(g) { g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return g; }

// ------------------------------------------------------------------ Lunar Module descent stage
const LM_HALF = 2.1, LM_CORNER = 0.95;
const lmOutline = () => { const A = LM_HALF, B = LM_CORNER; return [[-B, A], [B, A], [A, B], [A, -B], [B, -A], [-B, -A], [-A, -B], [-A, B]]; };

/** "UNITED STATES" and the flag, painted on the descent stage (as flown from Apollo 11 on). */
function lmDecal() {
  return drawnTex(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // flag
    const fx = 150, fy = 20, fw = 212, fh = 112;
    for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#ece7dc' : '#a8262f'; g.fillRect(fx, fy + (i * fh) / 13, fw, fh / 13 + 1); }
    g.fillStyle = '#2f3466'; g.fillRect(fx, fy, fw * 0.4, fh * 7 / 13);
    g.fillStyle = '#ece7dc';
    for (let r = 0; r < 9; r++) for (let k = 0; k < (r % 2 ? 5 : 6); k++) { g.beginPath(); g.arc(fx + 7 + k * 14 + (r % 2 ? 7 : 0), fy + 6 + r * 6.3, 1.7, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#ece7dc';
    g.font = 'bold 54px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('UNITED', w / 2, 170);
    g.fillText('STATES', w / 2, 226);
  });
}

/**
 * Lunar Module descent stage, ~9.4 m across the footpads, 3.23 m tall
 * (catalog lm-descent-stage). Forward (+z) is the ladder side.
 */
export function buildLunarModuleV3() {
  const g = new THREE.Group();
  g.name = 'lm-descent-stage-v3';
  const amber = foilMaterial([196, 128, 52], { seed: 11, metal: 0.55, rough: 0.38, seamRgb: [150, 96, 40], dust: 0.25 });
  const black = foilMaterial([40, 38, 36], { seed: 23, metal: 0.45, rough: 0.45, seamRgb: [74, 70, 64], dust: 0.15, cells: 180, contrast: 0.22, strength: 6 });
  const gold = foilMaterial([214, 172, 72], { seed: 37, metal: 0.9, rough: 0.28, strength: 12 });
  const legs = metalMaterial([205, 200, 190], { seed: 5, dust: 0.35 });
  const engine = metalMaterial([70, 66, 62], { seed: 9, metal: 0.6, rough: 0.55, dust: 0.1 });
  engine.side = THREE.DoubleSide;
  const decal = new THREE.MeshStandardMaterial({ map: lmDecal(), transparent: true, alphaTest: 0.3, roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 });
  decal.userData.surfaceDetail = true;

  const Y0 = 1.45, H = 1.55;
  // Structure under the blankets and the top deck.
  const prism = (h, y0, inset, mat) => {
    const shape = new THREE.Shape();
    lmOutline().forEach(([x, z], i) => { const s = 1 - inset; if (i === 0) shape.moveTo(x * s, -z * s); else shape.lineTo(x * s, -z * s); });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.y = y0; return m;
  };
  g.add(prism(H, Y0, 0.02, black), prism(0.1, Y0 + H, 0.04, black));
  // Blanket panels: long faces amber in two quilted halves with a black centre
  // strip (the leg outrigger), short corner faces black with a gold band; gold skirt.
  const V = lmOutline();
  for (let i = 0; i < 8; i++) {
    const [x0, z0] = V[i], [x1, z1] = V[(i + 1) % 8];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const nL = Math.hypot(mx, mz), nx = mx / nL, nz = mz / nL, yaw = Math.atan2(nx, nz);
    const tx = (x1 - x0) / len, tz = (z1 - z0) / len;
    const at = (w, h, y, along, out, mat, d = 0.04) => g.add(box(w, h, d, mat, mx + nx * out + tx * along, y, mz + nz * out + tz * along, yaw));
    if (i % 2 === 0) {
      // quilted blanket: four pillows per half, slightly different depths
      for (const s of [-1, 1]) for (let q = 0; q < 2; q++) for (let r = 0; r < 2; r++) {
        at(len * 0.18, H * 0.42, Y0 + H * (0.28 + r * 0.44), s * len * (0.2 + q * 0.18), 0.03 + 0.012 * ((q + r + i) % 2), amber, 0.05);
      }
      at(len * 0.16, H * 0.92, Y0 + H * 0.5, 0, 0.055, black);
      // painted lettering and flag on the two long side faces (east and west)
      if (i === 2 || i === 6) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.62, len * 0.31), decal);
        p.position.set(mx + nx * 0.075, Y0 + H * 0.52, mz + nz * 0.075); p.rotation.y = yaw;
        p.userData.v2NoMerge = true; p.castShadow = false;
        g.add(p);
      }
    } else {
      at(len * 0.9, H * 0.9, Y0 + H * 0.5, 0, 0.03, black);
      at(len * 0.92, 0.22, Y0 + H * 0.72, 0, 0.05, gold);
    }
    at(len * 0.96, 0.12, Y0 + 0.06, 0, 0.06, gold);
  }
  // Descent engine bell (up in its bay) and the gold heat shield under the stage.
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.78, 0.9, 28, 1, true), engine);
  bell.position.y = Y0 + 0.15; g.add(bell);
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.03, 8), gold);
  shield.position.y = Y0 - 0.01; shield.rotation.y = Math.PI / 8; g.add(shield);
  // Four legs: primary strut, two secondary struts, down-lock strut, dish footpad,
  // and a surface-contact probe bent back under three pads (the ladder leg had none).
  const PAD_R = 4.25, rim = LM_HALF + 0.05;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, s = Math.sin(a), c = Math.cos(a);
    const P = (r, y, side = 0) => [s * r + c * side, y, c * r - s * side];
    g.add(strut(P(rim, Y0 + H - 0.2), P(PAD_R, 0.34), 0.085, legs));
    g.add(strut(P(rim, Y0 + 0.05, -LM_CORNER), P(PAD_R - 0.95, 0.88), 0.045, legs));
    g.add(strut(P(rim, Y0 + 0.05, LM_CORNER), P(PAD_R - 0.95, 0.88), 0.045, legs));
    g.add(strut(P(rim, Y0 + 0.02), P(PAD_R - 0.95, 0.88), 0.04, legs));
    g.add(strut(P(PAD_R - 0.1, 0.36), P(PAD_R - 0.02, 0.2), 0.07, legs)); // shock absorber
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.36, 0.18, 24), legs);
    fp.position.set(s * PAD_R, 0.09, c * PAD_R); g.add(fp);
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.025, 6, 24), legs);
    rimRing.rotation.x = Math.PI / 2; rimRing.position.set(s * PAD_R, 0.17, c * PAD_R); g.add(rimRing);
    if (i !== 0) { // probes: 1.7 m long, folded back on landing
      g.add(strut(P(PAD_R, 0.05), P(PAD_R + 0.5, 0.02, 0.2), 0.012, legs));
      g.add(strut(P(PAD_R + 0.5, 0.02, 0.2), P(PAD_R + 0.25, 0.015, 0.9), 0.012, legs));
    }
  }
  // Ladder on the forward leg, porch with handrails above it.
  for (const off of [-0.22, 0.22]) g.add(strut([off, Y0 + H - 0.1, rim + 0.15], [off, 0.5, PAD_R - 0.35], 0.025, legs));
  for (let r = 0; r < 9; r++) {
    const t = (r + 0.5) / 9, z = rim + 0.15 + (PAD_R - 0.5 - rim) * t, y = Y0 + H - 0.1 - (Y0 + H - 0.6) * t;
    g.add(strut([-0.22, y, z], [0.22, y, z], 0.016, legs));
  }
  g.add(box(0.95, 0.05, 0.75, legs, 0, Y0 + H + 0.05, rim + 0.32));
  for (const off of [-0.45, 0.45]) {
    g.add(strut([off, Y0 + H + 0.07, rim + 0.05], [off, Y0 + H + 0.5, rim + 0.05], 0.014, legs));
    g.add(strut([off, Y0 + H + 0.5, rim + 0.05], [off, Y0 + H + 0.5, rim + 0.62], 0.014, legs));
  }
  // MESA, the equipment bay, folded down on the left of the ladder (silver box, open tray).
  const mesa = foilMaterial([176, 176, 172], { seed: 51, metal: 0.8, rough: 0.35, cells: 160, contrast: 0.2, strength: 5 });
  g.add(box(0.95, 0.85, 0.08, mesa, -1.15, Y0 - 0.2, rim + 0.04, 0));
  g.add(box(0.9, 0.05, 0.45, legs, -1.15, Y0 - 0.62, rim + 0.28));
  shadowed(g);
  mergeStaticGroup(g);
  return g;
}

// ------------------------------------------------------------------ Lunar Roving Vehicle
function tyreTexture() {
  return drawnTex(256, 64, (x) => {
    x.fillStyle = '#26282b'; x.fillRect(0, 0, 256, 64);
    x.strokeStyle = '#6a6c6e'; x.lineWidth = 1;
    for (let i = -64; i < 320; i += 6) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke(); }
    x.strokeStyle = '#c9c6bf'; x.lineWidth = 4;
    for (let i = 0; i < 256; i += 21) { x.beginPath(); x.moveTo(i, 4); x.lineTo(i + 9, 32); x.lineTo(i, 60); x.stroke(); }
    x.fillStyle = 'rgba(140,134,124,0.35)'; for (let i = 0; i < 400; i++) x.fillRect((i * 97) % 256, (i * 31) % 64, 2, 2); // dust caught in the mesh
  });
}
function wheelSideTexture() {
  return drawnTex(128, 128, (x) => {
    x.clearRect(0, 0, 128, 128);
    x.strokeStyle = '#1d1e20'; x.lineWidth = 10; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#8d8f91'; x.lineWidth = 3; x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 2.5;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; x.beginPath(); x.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12); x.lineTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52); x.stroke(); }
    x.fillStyle = '#b8b5ae'; x.beginPath(); x.arc(64, 64, 13, 0, Math.PI * 2); x.fill();
  });
}
/** Seat webbing: woven nylon straps on a light frame (alpha cut-out between the straps). */
function webbingTexture() {
  return drawnTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#5d7391';
    for (let i = 0; i < 6; i++) g.fillRect(4 + i * 21, 0, 14, 128);
    g.fillStyle = '#6f86a5';
    for (let j = 0; j < 6; j++) g.fillRect(0, 4 + j * 21, 128, 12);
    g.strokeStyle = 'rgba(30,36,46,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 128; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); }
  });
}
/** Control and display console: dials, gauges and the attitude indicator, labelled. */
function consoleTexture() {
  return drawnTex(256, 192, (g, w, h) => {
    g.fillStyle = '#2b2c2f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a8c90'; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
    const dial = (x, y, r, k) => {
      g.fillStyle = '#0f1012'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#d8d6d0'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      for (let t = 0; t < 10; t++) { const a = Math.PI * (0.8 + 1.4 * t / 9); g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75); g.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); g.stroke(); }
      g.strokeStyle = '#f2a33a'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(Math.PI * (0.8 + 1.4 * k)) * r * 0.8, y + Math.sin(Math.PI * (0.8 + 1.4 * k)) * r * 0.8); g.stroke();
    };
    dial(60, 64, 34, 0.3); dial(196, 64, 34, 0.6); dial(128, 56, 26, 0.45);
    g.fillStyle = '#d8d6d0'; g.font = 'bold 14px Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('HEADING', 60, 118); g.fillText('SPEED', 196, 118); g.fillText('PITCH', 128, 100);
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#c74b3c' : '#bfbcb4'; g.fillRect(28 + i * 36, 140, 22, 32); }
    g.fillStyle = '#bfbcb4'; g.font = '11px Arial, sans-serif'; g.fillText('POWER / TEMP', 128, 186);
  });
}

/**
 * Lunar Roving Vehicle (Apollo 15 type): 3.1 m long, 2.06 m track, 0.82 m
 * wire-mesh wheels, 1.14 m high. Returns { group, wheels, chassis, lcru }
 * like the v2 builder (forward is +z).
 */
export function buildRoverV3() {
  const group = new THREE.Group(); group.name = 'lrv-v3';
  const body = new THREE.Group(); body.name = 'lrv-v3-body';
  const frame = metalMaterial([196, 192, 184], { seed: 3, dust: 0.45 });
  const floor = foilMaterial([150, 148, 142], { seed: 61, metal: 0.7, rough: 0.5, strength: 3, dust: 0.5 });
  const fender = metalMaterial([200, 104, 62], { seed: 7, metal: 0.05, rough: 0.65, dust: 0.55 });
  const dark = metalMaterial([42, 43, 46], { seed: 13, metal: 0.3, rough: 0.6, dust: 0.25 });
  const web = new THREE.MeshStandardMaterial({ map: webbingTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  web.userData.surfaceDetail = true;
  const panel = new THREE.MeshStandardMaterial({ map: consoleTexture(), roughness: 0.6, metalness: 0.2 });
  panel.userData.surfaceDetail = true;
  if (!hasDOM) { web.color.set(0x5a6f8a); panel.color.set(0x2b2c2f); }

  // Chassis: two long tubular rails, cross members, three floor panels (fore, centre, aft).
  for (const x of [-0.6, 0.6]) body.add(strut([x, 0.52, -1.5], [x, 0.52, 1.5], 0.03, frame));
  for (const z of [-1.5, -0.75, 0, 0.75, 1.5]) body.add(strut([-0.62, 0.52, z], [0.62, 0.52, z], 0.022, frame));
  for (const [z, l] of [[-1.05, 0.8], [0, 1.1], [1.05, 0.8]]) body.add(box(1.16, 0.035, l, floor, 0, 0.55, z));
  // Fenders over the wheels and the suspension arms.
  for (const [x, z] of [[-0.92, 1.15], [0.92, 1.15], [-0.92, -1.15], [0.92, -1.15]]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.3, 18, 1, true, 0, Math.PI), fender);
    f.rotation.z = Math.PI / 2; f.position.set(x, 0.42, z); body.add(f);
    body.add(strut([x * 0.66, 0.5, z - 0.18], [x * 0.95, 0.41, z], 0.025, frame));
    body.add(strut([x * 0.66, 0.5, z + 0.18], [x * 0.95, 0.41, z], 0.025, frame));
  }
  // Seats: tubular frames with webbing, side by side, with footrests.
  for (const x of [-0.32, 0.32]) {
    const seat = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), web); seat.rotation.x = -Math.PI / 2; seat.position.set(x, 0.72, -0.15); body.add(seat);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.42), web); back.rotation.x = -0.18; back.position.set(x, 0.95, -0.4); body.add(back);
    for (const sx of [-0.23, 0.23]) {
      body.add(strut([x + sx, 0.55, -0.38], [x + sx, 0.72, -0.38], 0.014, frame));
      body.add(strut([x + sx, 0.72, 0.08], [x + sx, 0.72, -0.38], 0.014, frame));
      body.add(strut([x + sx, 0.72, -0.38], [x + sx, 1.16 - 0.03, -0.44], 0.014, frame));
      body.add(strut([x + sx, 0.55, 0.08], [x + sx, 0.72, 0.08], 0.014, frame));
    }
    body.add(strut([x - 0.23, 1.13, -0.44], [x + 0.23, 1.13, -0.44], 0.014, frame));
    body.add(strut([x - 0.18, 0.6, 0.5], [x + 0.18, 0.6, 0.5], 0.012, frame)); // footrest
  }
  // Console on a post, the T-handle hand controller between the seats.
  body.add(strut([0, 0.55, 0.62], [0, 0.86, 0.62], 0.02, frame));
  const cons = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.08), [dark, dark, dark, dark, panel, dark]);
  cons.position.set(0, 0.95, 0.62); cons.rotation.x = 0.35; cons.userData.v2NoMerge = true; body.add(cons);
  body.add(strut([0, 0.55, 0.05], [0, 0.82, 0.05], 0.012, dark));
  body.add(strut([-0.08, 0.83, 0.05], [0.08, 0.83, 0.05], 0.012, dark));
  // Rear tool pallet: a frame with sample-bag rack, tongs, scoop and rake (stowed upright).
  body.add(box(0.9, 0.04, 0.45, frame, 0, 0.6, -1.25));
  body.add(box(0.86, 0.3, 0.05, dark, 0, 0.77, -1.03));
  for (const [x, len] of [[-0.3, 0.45], [-0.1, 0.42], [0.12, 0.48], [0.32, 0.44]]) body.add(strut([x, 0.62, -1.4], [x + 0.02, 0.62 + len, -1.42], 0.01, frame));
  body.add(box(0.12, 0.04, 0.02, frame, 0.34, 1.08, -1.42)); // rake head
  body.add(box(0.08, 0.06, 0.06, frame, -0.28, 1.06, -1.4)); // scoop
  const bags = foilMaterial([214, 212, 204], { seed: 70, metal: 0, rough: 0.8, strength: 4 }); // Teflon sample-bag dispenser
  for (const x of [-0.25, 0, 0.25]) body.add(box(0.18, 0.16, 0.14, bags, x, 0.71, -1.28));
  // Battery covers and front electronics box.
  body.add(box(0.7, 0.14, 0.3, dark, 0, 0.62, 1.32));
  shadowed(body);
  mergeStaticGroup(body);

  // Relay unit (LCRU) masts, apart from the chassis (see module doc).
  const lcru = new THREE.Group(); lcru.name = 'lrv-v3-lcru';
  const dish = metalMaterial([232, 228, 220], { seed: 17, metal: 0.4, rough: 0.35, dust: 0.1 }); dish.side = THREE.DoubleSide;
  lcru.add(strut([0.35, 0.62, 0.95], [0.35, 1.7, 0.95], 0.02, frame));
  const hga = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.06, 0.18, 20, 1, true), dish); hga.position.set(0.35, 1.78, 0.95); hga.rotation.x = -0.5; lcru.add(hga);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; lcru.add(strut([0.35, 1.7, 0.95], [0.35 + Math.cos(a) * 0.48, 1.78 + Math.sin(a) * 0.2, 0.95 + Math.sin(a) * 0.12], 0.004, frame)); }
  lcru.add(strut([-0.4, 0.62, 0.95], [-0.4, 1.6, 0.95], 0.012, frame));
  lcru.add(box(0.36, 0.22, 0.2, foilMaterial([210, 208, 200], { seed: 81, metal: 0.6, rough: 0.4 }), -0.4, 0.72, 1.0));
  shadowed(lcru);
  mergeStaticGroup(lcru);

  const chassis = new THREE.Group(); chassis.name = 'lrv-v3-chassis';
  chassis.add(body);
  group.add(chassis, lcru);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tyreTexture(), metalness: 0.5, roughness: 0.6 });
  const sideMap = wheelSideTexture();
  const sideMat = new THREE.MeshStandardMaterial({ color: sideMap ? 0xffffff : 0x2a2b2d, map: sideMap, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.55 });
  tyreMat.userData.surfaceDetail = sideMat.userData.surfaceDetail = true;
  const wheelGeo = new THREE.CylinderGeometry(0.41, 0.41, 0.23, 28);
  const wheels = [];
  for (const [x, z] of [[-0.92, 1.15], [0.92, 1.15], [-0.92, -1.15], [0.92, -1.15]]) {
    const w = new THREE.Mesh(wheelGeo, [tyreMat, sideMat, sideMat]);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.41, z); w.castShadow = true; w.name = 'lrv-wheel';
    chassis.add(w); wheels.push(w);
  }
  return { group, wheels, chassis, lcru };
}
