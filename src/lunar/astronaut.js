/**
 * astronaut.js — a suited lunar field geologist (own procedural model, CC0;
 * G2 fix round 2026-11-07, replaces the v2 capsule figure).
 *
 * Modelled in code from NASA Apollo-era photographs of the A7L-B suit
 * (Apollo Lunar Surface Journal image library): a shaped torso with the waist
 * convolute, convoluted shoulder, elbow and knee joints, the LEVA helmet shell
 * with its gold visor over the neck ring, the life-support backpack (PLSS) with
 * the oxygen purge unit (OPS) on top and the antenna stub, the chest remote
 * control unit (RCU) with its knobs, the oxygen hoses with red and blue
 * connectors, gauntlet gloves with fingers, and lunar overshoes with ribbed
 * blue-grey soles. Commander's red bands on arms and legs (from Apollo 13 on;
 * the helmet band is left out). Fabric has a beta-cloth weave and quilting seams in its normal map,
 * with regolith dust rising up the legs. Real proportions: 1.88 m to the top of
 * the backpack. Simplified and approximate; not a portrait of Scott or Irwin.
 *
 * Ground contact (owner screenshot 1): the figure is posed every frame against
 * the terrain it stands on. Each foot samples the ground height under it
 * (bilinear on a 0.5 m grid of the streamed tiles), the boot is turned to the
 * local slope, the hips drop only as far as the planted feet need, and two-bone
 * IK bends hip and knee to reach. A clamp then checks the heel, toe and both
 * sole edges against the ground and lifts the foot out of any overlap, so no
 * part of a boot is ever below the surface along the walk path.
 *
 * Gaits follow lunar gravity (1.62 m/s^2): the "lope" is a skip with a short
 * stance and a ballistic flight phase (the flight is exact for the push-off
 * speed; the timings are approximate). Feet stay planted in the world while
 * on the ground, so they do not slide. Sampling uses the 80 cm tongs with a
 * small knee bend and a lean, as the A7L-B suit allowed. Animation is a joint
 * hierarchy, no skinning. The crew belongs to the app's fictional field team.
 * @module lunar/astronaut
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LUNAR_G } from './frame.js';

/** Leg geometry (m): hip joint to knee, knee to ankle, ankle above the sole. */
export const LEG = Object.freeze({ thigh: 0.44, shin: 0.43, ankle: 0.09 });
const HIPS_REST = 0.98; // hips group height in the root (hip joints 2 cm below)
const REACH = LEG.thigh + LEG.shin - 0.004;
/** Lope: push-off speed (m/s) and stance time (s). Flight = 2 v / g = 0.80 s, apex 0.13 m. */
export const LOPE = Object.freeze({ vy: 0.65, stance: 0.22, lead: 0.15, trail: 0.0 });
/** Sole points in the boot's frame (ankle at the origin): heel, toe, both edges. */
const SOLE = [[0, -LEG.ankle, -0.1], [0, -LEG.ankle, 0.19], [-0.065, -LEG.ankle, 0.05], [0.065, -LEG.ankle, 0.05]];

const C = {
  suit: new THREE.Color(0xe9e7e0), dusty: new THREE.Color(0xb7b1a5), red: new THREE.Color(0xa8262b),
  glove: new THREE.Color(0x7d8794), sole: new THREE.Color(0x5b6674), pack: new THREE.Color(0xdcdad3),
  metal: new THREE.Color(0xa7abb0), dark: new THREE.Color(0x3a3d42), blue: new THREE.Color(0x2f5aa8),
  shell: new THREE.Color(0xf3f2ee),
};

// ------------------------------------------------------------ textures
let shared = null;
function canvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')]; }
/** Beta-cloth weave with quilting seams: a height field, turned into colour and normal maps. */
function fabricMaps() {
  const N = 256;
  const h = new Float32Array(N * N);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const weave = 0.25 * Math.sin(x * 1.6) * Math.sin(y * 1.6);
    const seam = Math.exp(-(((y % 64) - 32) ** 2) / 3) + 0.6 * Math.exp(-(((x % 128) - 64) ** 2) / 2.5);
    const quilt = 0.5 * Math.sin(((y % 64) / 64) * Math.PI); // puffed between seams
    h[y * N + x] = weave + quilt - 1.3 * seam + (rnd() - 0.5) * 0.15;
  }
  const [cc, g] = canvas(N); const img = g.createImageData(N, N);
  const [nc, gn] = canvas(N); const nimg = gn.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, v = h[i];
    const shade = 236 + v * 10;
    img.data.set([shade, shade - 1, shade - 5, 255], i * 4);
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
    const dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const nx = -dx * 0.9, ny = -dy * 0.9, nz = 1, l = Math.hypot(nx, ny, nz);
    nimg.data.set([(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (nz / l * 0.5 + 0.5) * 255, 255], i * 4);
  }
  g.putImageData(img, 0, 0); gn.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nc);
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.anisotropy = 4; }
  return { map, normalMap };
}
/** Soft contact shadow under a boot (ambient occlusion where the sole meets the ground). */
function contactTexture() {
  const [c, g] = canvas(64);
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(0,0,0,0.75)'); r.addColorStop(0.6, 'rgba(0,0,0,0.35)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function materials() {
  if (shared) return shared;
  const f = fabricMaps();
  shared = {
    fabric: new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 0.9 }),
    hard: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xc89a3c, metalness: 1, roughness: 0.08 }),
    contact: new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  for (const k of ['fabric', 'hard', 'visor']) shared[k].userData.surfaceDetail = true;
  return shared;
}

// ------------------------------------------------------------ geometry helpers
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
/** One part: geometry, a colour (or a per-vertex colour function of the rest-pose y), placement. */
function part(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(M4.compose(P.set(...pos), Q.setFromEuler(E.set(...rot)), S.set(...scale)));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    if (typeof color === 'function') color(g.attributes.position.getY(i), c); else c.copy(color);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
/** A merged segment: one mesh per material that has parts. */
function segment(parent, parts, name) {
  const M = materials();
  for (const [key, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list, false), M[key]);
    m.name = `${name}-${key}`; m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
  }
}
/**
 * A tapered suit tube hanging down from its joint (y = 0 to -len), radius r0 at
 * the top to r1 at the bottom, with convolute ridges over [c0, c1] (fractions of
 * the length). Lathe UVs wrap the fabric weave round the limb.
 */
function tube(r0, r1, len, { c0 = -1, c1 = -1, ridges = 0, amp = 0.008, bulge = 0.006, segs = 18 } = {}) {
  const pts = [];
  const n = 28;
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    let r = r0 + (r1 - r0) * t + bulge * Math.sin(t * Math.PI);
    if (ridges && t >= c0 && t <= c1) r += amp * (0.5 + 0.5 * Math.cos(((t - c0) / (c1 - c0)) * ridges * Math.PI * 2));
    pts.push(new THREE.Vector2(r, -len * t));
  }
  pts.unshift(new THREE.Vector2(0.001, -len - 0.002));
  pts.push(new THREE.Vector2(0.001, 0.002));
  return new THREE.LatheGeometry(pts, segs);
}
/** Colour bands along a tube (rest-pose y in the segment's frame). */
const bands = (base, list) => (y, c) => { c.copy(base); for (const [a, b, col] of list) if (y <= a && y >= b) { c.copy(col); break; } };
const dustUp = (top, bottom) => (y, c) => c.copy(C.suit).lerp(C.dusty, THREE.MathUtils.clamp((top - y) / (top - bottom), 0, 1));

function buildGlove(side) {
  const parts = [];
  // Gauntlet cuff (white beta cloth), palm, four fingers and the thumb (blue-grey rubber tips).
  parts.push(part(tube(0.058, 0.05, 0.08, { bulge: 0 }), C.suit, [0, 0, 0]));
  parts.push(part(new RoundedBoxGeometry(0.085, 0.095, 0.04, 2, 0.016), C.glove, [0, -0.12, 0]));
  for (let f = 0; f < 4; f++) {
    const x = (-0.03 + f * 0.02) * side;
    parts.push(part(new THREE.CapsuleGeometry(0.0095, 0.05 - Math.abs(f - 1.5) * 0.006, 2, 6), C.glove, [x, -0.2, 0.006], [0.25, 0, 0]));
  }
  parts.push(part(new THREE.CapsuleGeometry(0.011, 0.04, 2, 6), C.glove, [0.048 * side, -0.13, 0.014], [0.2, 0, 0.6 * side]));
  return parts;
}
function buildBoot() {
  // Lunar overshoe: a side profile (toe to heel) extruded across the foot, with a
  // ribbed blue-grey silicone sole. Ankle at the origin, sole at y = -0.09.
  const s = new THREE.Shape();
  const A = -LEG.ankle;
  s.moveTo(-0.1, A + 0.012);
  s.lineTo(0.15, A + 0.012);
  s.quadraticCurveTo(0.2, A + 0.014, 0.2, A + 0.05);
  s.quadraticCurveTo(0.195, A + 0.1, 0.11, A + 0.11);
  s.lineTo(0.05, A + 0.15);
  s.lineTo(0.06, 0.06);
  s.lineTo(-0.07, 0.06);
  s.quadraticCurveTo(-0.11, A + 0.08, -0.1, A + 0.012);
  const shell = new THREE.ExtrudeGeometry(s, { depth: 0.11, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 8 });
  shell.translate(0, 0, -0.055);
  const fabric = [part(shell, dustUp(0.06, A), [0, 0, 0], [0, -Math.PI / 2, 0])];
  fabric.push(part(tube(0.072, 0.07, 0.07, { bulge: 0.004 }), C.dusty, [0, 0.07, -0.01]));
  const hard = [part(new RoundedBoxGeometry(0.135, 0.022, 0.31, 2, 0.008), C.sole, [0, A + 0.011, 0.045])];
  for (let i = 0; i < 7; i++) hard.push(part(new THREE.BoxGeometry(0.13, 0.01, 0.012), C.dark, [0, A + 0.004, -0.08 + i * 0.042]));
  return { fabric, hard };
}

/**
 * @param {{ commander?: boolean, name?: string, phase?: number, tongs?: boolean,
 *   ground?: (x: number, z: number) => number }} [o]  ground: terrain height under (x, z)
 * @returns {{ root: THREE.Group, setAction: (a: string) => void, update: (dt: number) => void, action: string, onFootfall?: Function, bag: THREE.Object3D }}
 */
export function createAstronaut(o = {}) {
  const M = materials();
  const cmd = Boolean(o.commander);
  const root = new THREE.Group();
  root.name = o.name || 'astronaut';
  const hips = new THREE.Group(); hips.position.y = HIPS_REST; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);

  // Pelvis (trunk below the waist convolute)
  segment(hips, { fabric: [part(tube(0.165, 0.15, 0.2, { bulge: 0.02 }), C.suit, [0, 0.1, 0], [0, 0, 0], [1.18, 1, 0.86])] }, 'pelvis');
  // Torso: waist convolute, chest, shoulders; RCU, PLSS, OPS, hoses, neck ring.
  const t = { fabric: [], hard: [] };
  t.fabric.push(part(tube(0.13, 0.168, 0.56, { c0: 0.78, c1: 0.98, ridges: 3, amp: 0.01, bulge: 0.05 }), C.suit, [0, 0.66, 0], [0, 0, 0], [1.2, 1, 0.82]));
  t.hard.push(part(new RoundedBoxGeometry(0.24, 0.14, 0.1, 2, 0.02), C.pack, [0, 0.42, 0.2]));
  for (let k = 0; k < 4; k++) t.hard.push(part(new THREE.CylinderGeometry(0.014, 0.014, 0.025, 10), k === 1 ? C.red : C.dark, [-0.075 + k * 0.05, 0.5, 0.21]));
  t.hard.push(part(new RoundedBoxGeometry(0.06, 0.05, 0.04, 2, 0.008), C.dark, [0, 0.42, 0.265])); // camera bracket
  t.hard.push(part(new RoundedBoxGeometry(0.5, 0.62, 0.24, 3, 0.04), C.pack, [0, 0.42, -0.27])); // PLSS against the back
  t.hard.push(part(new RoundedBoxGeometry(0.46, 0.16, 0.2, 3, 0.03), C.pack, [0, 0.82, -0.26]));
  t.hard.push(part(new THREE.BoxGeometry(0.52, 0.03, 0.26), C.dark, [0, 0.72, -0.27])); // OPS strap
  for (const s of [-1, 1]) {
    // Oxygen hoses from the chest connectors round to the backpack.
    const curve = new THREE.CatmullRomCurve3([[0.07 * s, 0.33, 0.17], [0.2 * s, 0.31, 0.12], [0.26 * s, 0.34, -0.05], [0.22 * s, 0.38, -0.16]].map((p) => new THREE.Vector3(...p)));
    t.fabric.push(part(new THREE.TubeGeometry(curve, 16, 0.019, 8), C.suit));
    t.hard.push(part(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 12), s < 0 ? C.blue : C.red, [0.07 * s, 0.33, 0.175], [Math.PI / 2, 0, 0]));
  }
  t.hard.push(part(new THREE.TorusGeometry(0.125, 0.022, 8, 24), C.metal, [0, 0.645, 0], [Math.PI / 2, 0, 0]));
  segment(torso, t, 'torso');

  // Helmet: LEVA shell over the bubble, gold visor down, commander's red band.
  const head = new THREE.Group(); head.position.y = 0.66; torso.add(head);
  const h = { hard: [], visor: [] };
  const R = 0.172, FRONT = Math.PI / 2;
  const HC = 0.08; // helmet centre above the neck ring's group origin: top at 1.89 m
  h.hard.push(part(new THREE.SphereGeometry(R, 24, 8, 0, Math.PI * 2, 0, 0.55), C.shell, [0, HC, 0]));
  h.hard.push(part(new THREE.SphereGeometry(R, 24, 10, FRONT + 0.95, Math.PI * 2 - 1.9, 0.55, 1.2), C.shell, [0, HC, 0]));
  h.visor.push(part(new THREE.SphereGeometry(R - 0.004, 24, 12, FRONT - 0.95, 1.9, 0.5, 1.2), C.shell, [0, HC, 0]));
  segment(head, h, 'helmet');

  // Arms
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0.255 * s, 0.53, -0.01); torso.add(sh);
    const upper = cmd ? bands(C.suit, [[-0.1, -0.15, C.red]]) : C.suit;
    segment(sh, { fabric: [
      part(new THREE.SphereGeometry(0.088, 14, 10), C.suit),
      part(tube(0.084, 0.066, 0.3, { c0: 0, c1: 0.25, ridges: 3, amp: 0.009 }), upper),
    ] }, `upper-arm-${s}`);
    const el = new THREE.Group(); el.position.y = -0.31; sh.add(el);
    segment(el, {
      fabric: [part(new THREE.SphereGeometry(0.066, 12, 8), C.suit), part(tube(0.066, 0.052, 0.25, { c0: 0, c1: 0.22, ridges: 2, amp: 0.008 }), C.suit)],
      hard: [part(new THREE.CylinderGeometry(0.056, 0.056, 0.025, 16), C.metal, [0, -0.255, 0])],
    }, `forearm-${s}`);
    const hand = new THREE.Group(); hand.position.y = -0.27; el.add(hand);
    segment(hand, { fabric: buildGlove(s) }, `glove-${s}`);
    arms.push({ sh, el, hand, s });
    // Legs
    const hip = new THREE.Group(); hip.position.set(0.1 * s, -0.02, 0); hip.rotation.order = 'ZXY'; hips.add(hip);
    const thigh = cmd ? bands(C.suit, [[-0.2, -0.26, C.red]]) : C.suit;
    segment(hip, { fabric: [part(tube(0.1, 0.082, LEG.thigh, { c0: 0.86, c1: 1, ridges: 2, amp: 0.008 }), thigh)] }, `thigh-${s}`);
    const kn = new THREE.Group(); kn.position.y = -LEG.thigh; hip.add(kn);
    segment(kn, { fabric: [part(new THREE.SphereGeometry(0.083, 12, 8), C.suit), part(tube(0.083, 0.07, LEG.shin, { c0: 0, c1: 0.16, ridges: 2, amp: 0.009 }), dustUp(0, -LEG.shin))] }, `shin-${s}`);
    const ankle = new THREE.Group(); ankle.position.y = -LEG.shin; kn.add(ankle);
    const bootG = new THREE.Group(); bootG.name = `boot-${s < 0 ? 'L' : 'R'}`; ankle.add(bootG);
    segment(bootG, buildBoot(), bootG.name);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.42).rotateX(-Math.PI / 2), M.contact);
    contact.name = `contact-${s}`; contact.raycast = () => {}; contact.renderOrder = 1;
    root.add(contact);
    legs.push({ hip, kn, ankle, boot: bootG, contact, s, planted: false, world: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3() });
  }
  // Sample bag on the left hand (swings as a lunar pendulum); tongs in the right.
  const bagPivot = new THREE.Group(); bagPivot.position.y = -0.12; arms[0].hand.add(bagPivot);
  segment(bagPivot, { hard: [part(new RoundedBoxGeometry(0.12, 0.16, 0.05, 2, 0.01), C.pack, [0, -0.12, 0])] }, 'bag');
  let tongsTip = null;
  if (o.tongs) {
    const tg = new THREE.Group(); tg.position.y = -0.13; arms[1].hand.add(tg);
    segment(tg, { hard: [
      part(new THREE.CylinderGeometry(0.007, 0.007, 0.8, 8), C.metal, [0, -0.4, 0]),
      part(new THREE.BoxGeometry(0.03, 0.06, 0.012), C.metal, [0, -0.81, 0.008]),
      part(new THREE.BoxGeometry(0.03, 0.06, 0.012), C.metal, [0, -0.81, -0.008]),
    ] }, 'tongs');
    tongsTip = new THREE.Object3D(); tongsTip.position.y = -0.84; tg.add(tongsTip);
  }
  // Rest-pose size, measured from the geometry now (before any animation), in
  // the figure's own axes: the scale check compares this with the catalog.
  root.updateWorldMatrix(true, true);
  const rest = new THREE.Box3();
  const inv = root.matrixWorld.clone().invert();
  root.traverse((m) => { if (m.isMesh && !m.name.startsWith('contact')) { m.geometry.computeBoundingBox(); rest.union(m.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld))); } });
  root.userData.restSize = rest.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(3));

  // ---------------------------------------------------------- posing
  const ground = o.ground || (() => 0);
  const v = new THREE.Vector3(), w = new THREE.Vector3(), n = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const q = new THREE.Quaternion(), qp = new THREE.Quaternion(), mb = new THREE.Matrix4();
  /** Ground normal at (x, z) from the height samples 0.25 m either side. */
  const normalAt = (x, z, out) => {
    const d = 0.25;
    const hx = ground(x + d, z) - ground(x - d, z), hz = ground(x, z + d) - ground(x, z - d);
    return out.set(-hx / (2 * d), 1, -hz / (2 * d)).normalize();
  };
  const toLocal = (p) => root.worldToLocal(p);
  /** Two-bone IK: put the ankle of leg L at the root-local point a. */
  const solve = (L, a) => {
    const hx = L.hip.position.x, hy = hips.position.y + L.hip.position.y;
    const dx = a.x - hx, dy = a.y - hy, dz = a.z - hips.position.z - L.hip.position.z;
    const dist = THREE.MathUtils.clamp(Math.hypot(dx, dy, dz), 0.25, REACH);
    const phi = Math.atan2(-dz, Math.hypot(dx, dy));
    const al = Math.acos(THREE.MathUtils.clamp((LEG.thigh ** 2 + dist ** 2 - LEG.shin ** 2) / (2 * LEG.thigh * dist), -1, 1));
    const kneeIn = Math.acos(THREE.MathUtils.clamp((LEG.thigh ** 2 + LEG.shin ** 2 - dist ** 2) / (2 * LEG.thigh * LEG.shin), -1, 1));
    L.hip.rotation.z = Math.atan2(dx, -dy);
    L.hip.rotation.x = phi - al;
    L.kn.rotation.x = Math.PI - kneeIn;
  };
  /** Turn the boot to the ground normal nrm (world), facing the body's way; tip: extra toe-down pitch. */
  const alignBoot = (L, nrm, tip = 0) => {
    fwd.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(q));
    fwd.addScaledVector(nrm, -fwd.dot(nrm)).normalize();
    right.crossVectors(nrm, fwd).normalize();
    mb.makeBasis(right, nrm, fwd);
    qp.setFromRotationMatrix(mb);
    if (tip) qp.multiply(q.setFromAxisAngle(v.set(1, 0, 0), tip));
    L.kn.updateWorldMatrix(true, false);
    L.kn.getWorldQuaternion(q);
    L.ankle.quaternion.copy(q.invert().multiply(qp));
  };
  /** Deepest sole point below the ground (m, > 0 means overlap). */
  const overlap = (L) => {
    L.boot.updateWorldMatrix(true, false);
    let worst = -Infinity;
    for (const s of SOLE) { L.boot.localToWorld(w.set(...s)); worst = Math.max(worst, ground(w.x, w.z) - w.y); }
    return worst;
  };
  /** Place both feet: world sole points (y on the ground for planted feet), then IK, align, clamp. */
  const placeFeet = (targets, airborne) => {
    root.updateWorldMatrix(true, false);
    // Hips: no lower than the rest pose allows, low enough that every planted foot reaches.
    let hy = st.hipsY;
    for (let i = 0; i < 2; i++) {
      if (airborne[i] > 0.02) continue;
      const a = toLocal(v.copy(targets[i])); a.y += LEG.ankle;
      const horiz = Math.hypot(a.x - legs[i].hip.position.x, a.z);
      hy = Math.min(hy, a.y + 0.02 + Math.sqrt(Math.max(0.01, REACH ** 2 - horiz ** 2)));
    }
    hips.position.y = Math.max(hy, 0.55);
    for (let i = 0; i < 2; i++) {
      const L = legs[i], T = targets[i];
      normalAt(T.x, T.z, n);
      if (airborne[i] > 0.02) n.lerp(v.set(0, 1, 0), 0.6).normalize();
      for (let pass = 0; pass < 6; pass++) {
        const a = toLocal(v.copy(T).addScaledVector(n, LEG.ankle));
        solve(L, a);
        alignBoot(L, n, airborne[i] > 0.02 ? 0.2 : 0);
        // Collision clamp: lift the foot out of any overlap with the ground (re-solved).
        const d = overlap(L);
        if (d <= 0.001 || pass === 5) break;
        T.y += d + 0.001;
      }
      // Contact shadow: on the ground under the boot, fading as the foot lifts.
      const gy = ground(T.x, T.z), lift = Math.max(0, T.y - gy);
      L.contact.position.copy(toLocal(v.set(T.x, gy + 0.01, T.z)));
      L.contact.quaternion.copy(root.getWorldQuaternion(q).invert()).multiply(qp.setFromUnitVectors(w.set(0, 1, 0), n)).multiply(q.setFromAxisAngle(w.set(0, 1, 0), root.rotation.y));
      L.contact.scale.setScalar(1 + lift * 2);
      L.contact.visible = lift < 0.45;
    }
  };
  /** Stance foot targets (root-local x, z) turned into world sole points on the ground. */
  const standTargets = (pts) => pts.map(([x, z]) => { const p = root.localToWorld(new THREE.Vector3(x, 0, z)); p.y = ground(p.x, p.z); return p; });

  const st = { action: 'idle', t: o.phase ?? 0, hop: 0, vy: 0, swing: 0.15, swingV: 0, hipsY: HIPS_REST, stance: 0, airT: 0, reach: 0 };
  const api = {
    root, bag: bagPivot, action: 'idle', legs,
    setAction(a) { st.action = a; api.action = a; if (a !== 'lope') { st.hop = 0; st.vy = 0; } },
    /** Height of the current hop above the ground (lope flight phase). */
    get lift() { return st.hop; },
    /** Lowest sole point above the ground, both feet (m); negative would be an overlap. */
    clearance() { return Math.min(-overlap(legs[0]), -overlap(legs[1])); },
    update(dt) {
      st.t += dt;
      const t = st.t;
      // The root stands on the ground under it; the body stays upright on slopes.
      root.position.y = ground(root.position.x, root.position.z);
      root.updateWorldMatrix(true, false);
      let lean = 0.04, armF = 0.12, armB = 0.12, raise = 0, compress = 0;
      let targets, airborne = [0, 0];
      if (st.action === 'lope') {
        if (st.hop <= 0 && st.vy <= 0 && st.stance <= 0) {
          // Touchdown: plant both feet in the world (lead foot ahead, trail beside), short stance.
          st.stance = LOPE.stance;
          const pts = standTargets([[-0.12, LOPE.trail], [0.12, LOPE.lead]]);
          legs.forEach((L, i) => { L.planted = true; L.world.copy(pts[i]); });
          api.onFootfall?.();
        }
        if (st.stance > 0) {
          st.stance -= dt;
          compress = 0.05 * Math.sin(Math.PI * (1 - Math.max(0, st.stance) / LOPE.stance));
          if (st.stance <= 0) {
            // Push off: ballistic flight at lunar gravity.
            st.vy = LOPE.vy; st.airT = 0;
            legs.forEach((L) => { L.planted = false; L.from.copy(toLocal(v.copy(L.world))); });
          }
        } else {
          st.vy -= LUNAR_G * dt;
          st.hop = Math.max(0, st.hop + st.vy * dt);
          st.airT += dt;
          if (st.hop <= 0) { st.vy = 0; }
        }
        const flight = (2 * LOPE.vy) / LUNAR_G;
        targets = legs.map((L, i) => {
          if (L.planted) { L.world.y = ground(L.world.x, L.world.z); return L.world.clone(); }
          const s = THREE.MathUtils.smoothstep(st.airT / flight, 0, 1);
          const land = i ? LOPE.lead : LOPE.trail;
          const p = root.localToWorld(v.set(L.s * 0.12, 0, THREE.MathUtils.lerp(L.from.z, land, s)).clone());
          const air = st.hop + 0.07 * Math.sin(Math.PI * s);
          p.y = ground(p.x, p.z) + air;
          airborne[i] = air;
          return p;
        });
        lean = 0.16; armF = 0.4; armB = 0.3;
      } else if (st.action === 'sample') {
        // Reach down with the tongs: a small knee bend and a lean (the suit allowed little more).
        const ph = t % 7;
        const k = ph < 2.5 ? 0.5 - 0.5 * Math.cos((ph / 2.5) * Math.PI) : ph < 5 ? 1 : 1 - (ph - 5) / 2;
        compress = 0.1 * k; lean = 0.04 + 0.3 * k;
        st.reach = k;
        targets = standTargets([[-0.13, -0.06], [0.13, 0.08]]);
      } else {
        if (st.action === 'point') { raise = 1; lean = -0.03; }
        targets = standTargets([[-0.13, 0], [0.13, 0.02]]);
      }
      // Breathing sway; hips height before the feet decide how low they must go.
      torso.rotation.x = lean + Math.sin(t * 1.7) * 0.01;
      st.hipsY = HIPS_REST - compress + st.hop;
      hips.position.z = -Math.sin(lean) * 0.12; // the pelvis moves back as the torso leans
      // Arms: held a little forward and out, as the pressurised suit held them.
      arms[0].sh.rotation.set(-armB, 0, -0.2); arms[0].el.rotation.x = -0.45;
      arms[1].sh.rotation.set(-armF, 0, 0.2); arms[1].el.rotation.x = -0.55;
      if (raise) { arms[0].sh.rotation.set(-1.5, 0, -0.3); arms[0].el.rotation.x = -0.1; }
      placeFeet(targets, airborne);
      if (tongsTip && st.action === 'sample') {
        // Tongs tip to the ground at full reach (search the shoulder pitch), never below it.
        // Tip height rises with the forward pitch on [0, 1.4]; keep the side at or above the goal.
        const goal = st.reach;
        let lo = 0, hi = 1.4;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) / 2;
          arms[1].sh.rotation.x = -mid; arms[1].el.rotation.x = -0.2;
          tongsTip.updateWorldMatrix(true, false); tongsTip.getWorldPosition(w);
          const above = w.y - ground(w.x, w.z) - 0.02 - (1 - goal) * 0.45;
          if (above > 0) hi = mid; else lo = mid;
        }
        arms[1].sh.rotation.x = -hi;
      }
    },
    /** The sample bag swings as a pendulum at lunar gravity, driven by the arm (a separate motion system). */
    updateBag(dt) {
      // Sample bag: a damped-free pendulum at lunar gravity (L = 0.12 m, period 1.7 s), driven by the arm.
      const L = 0.12;
      const a0 = arms[0].sh.rotation.x;
      const acc = -(LUNAR_G / L) * Math.sin(st.swing) - (a0 - (st.prevArm ?? a0)) / Math.max(dt, 1e-3) * 2;
      st.prevArm = a0;
      st.swingV += acc * dt;
      st.swingV *= 1 - 0.02 * dt; // almost no damping without air
      st.swing = THREE.MathUtils.clamp(st.swing + st.swingV * dt, -0.9, 0.9);
      bagPivot.rotation.x = st.swing - a0 - arms[0].el.rotation.x - torso.rotation.x;
    },
  };
  return api;
}
