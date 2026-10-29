/**
 * Procedural hero props for the Hadley site (v2.0.0), built in three.js from
 * public-domain NASA Apollo 15 surface photographs (Apollo Lunar Surface Journal).
 * Simplified, approximate geometry at true scale (1 unit = 1 m). No third-party
 * model files. Each prop's static parts are merged per material with
 * mergeStaticGroup so a prop costs a handful of draw calls.
 *
 * Forward axis for vehicles is +z (matches atan2(tangent.x, tangent.z) steering).
 * @module scenes/hadley-props
 */
import * as THREE from 'three';
import { mergeStaticGroup } from '../v2/cinematic-grade.js';

/** Cylinder strut between two points. */
function strut(a, b, radius, material) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function shadowed(group) {
  group.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return group;
}

/** Irregular octagon (long sides on the axes, short clipped corners) in the xz plane. */
const LM_HALF = 2.1; // apothem of the long sides (m): ~4.2 m across the flats
const LM_CORNER = 0.95; // half-length of a long side; short diagonal sides join them
function lmOutline() {
  const A = LM_HALF, B = LM_CORNER;
  // counter-clockwise, starting on the +z long side
  return [[-B, A], [B, A], [A, B], [A, -B], [B, -A], [-B, -A], [-A, -B], [-A, B]];
}

/** Octagonal prism from the outline, `h` tall, base at y0. */
function lmPrism(h, y0, inset, material) {
  const shape = new THREE.Shape();
  lmOutline().forEach(([x, z], i) => {
    const s = 1 - inset;
    // Shape is in xy; after rotateX(-PI/2) shape-y becomes -z
    if (i === 0) shape.moveTo(x * s, -z * s); else shape.lineTo(x * s, -z * s);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = y0;
  return m;
}

/**
 * Lunar Module descent stage (what stays on the surface after lift-off), after
 * AS15-86-11603 / AS15-87-11839 (NASA PD): a faceted octagonal stage with four
 * long and four short sides, wrapped in a patchwork of black and amber Kapton
 * thermal blankets with gold foil only in places; the descent engine sits up in
 * the central bay; four splayed silver legs with primary and secondary struts
 * meeting the deck rim, dish footpads; ladder and porch on the forward (+z) leg.
 * ~9.4 m across the footpads. Simplified, approximate geometry.
 */
export function buildLunarModule() {
  const g = new THREE.Group();
  g.name = 'v2-lunar-module';
  // Own materials per prop so hover highlights only this prop.
  const amber = new THREE.MeshStandardMaterial({ color: 0xa8732c, metalness: 0.55, roughness: 0.42 });
  const blackFoil = new THREE.MeshStandardMaterial({ color: 0x1c1b1a, metalness: 0.35, roughness: 0.5 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd2ab45, metalness: 0.85, roughness: 0.32 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xc9c4b8, metalness: 0.7, roughness: 0.4 });
  const engine = new THREE.MeshStandardMaterial({ color: 0x3e3b38, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });

  const Y0 = 1.45, H = 1.55; // stage sits ~1.45 m up on its legs
  g.add(lmPrism(H, Y0, 0.02, blackFoil)); // structure under the blankets
  g.add(lmPrism(0.1, Y0 + H, 0.04, blackFoil)); // top deck
  // Blanket panels, one per face, slightly proud of the structure: long faces in
  // amber with a black centre strip (where the leg outrigger is), short corner
  // faces in black with a gold band; a thin gold skirt along the bottom edge.
  const V = lmOutline();
  for (let i = 0; i < 8; i++) {
    const [x0, z0] = V[i], [x1, z1] = V[(i + 1) % 8];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const nLen = Math.hypot(mx, mz), nx = mx / nLen, nz = mz / nLen;
    const yaw = Math.atan2(nx, nz);
    const long = i % 2 === 0;
    const at = (w, h, y, along, out, mat) => {
      const tx = (x1 - x0) / len, tz = (z1 - z0) / len;
      const p = box(w, h, 0.04, mat, mx + nx * out + tx * along, y, mz + nz * out + tz * along);
      p.rotation.y = yaw;
      g.add(p);
    };
    if (long) {
      at(len * 0.38, H * 0.86, Y0 + H * 0.5, -len * 0.29, 0.03, amber);
      at(len * 0.38, H * 0.86, Y0 + H * 0.5, len * 0.29, 0.03, amber);
      at(len * 0.18, H * 0.92, Y0 + H * 0.5, 0, 0.05, blackFoil);
    } else {
      at(len * 0.9, H * 0.9, Y0 + H * 0.5, 0, 0.03, blackFoil);
      at(len * 0.92, 0.22, Y0 + H * 0.72, 0, 0.05, gold);
    }
    at(len * 0.96, 0.12, Y0 + 0.06, 0, 0.06, gold);
  }
  // descent engine: bell up inside the central bay, only its lower lip shows
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.78, 0.9, 20, 1, true), engine);
  bell.position.y = Y0 + 0.15;
  g.add(bell);
  // four legs on the axes (mid long sides), splayed out to dish footpads
  const PAD_R = 4.25, rim = LM_HALF + 0.05;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const s = Math.sin(a), c = Math.cos(a);
    const P = (r, y, side = 0) => [s * r + c * side, y, c * r - s * side];
    g.add(strut(P(rim, Y0 + H - 0.2), P(PAD_R, 0.34), 0.085, legMat)); // primary strut
    g.add(strut(P(rim, Y0 + 0.05, -LM_CORNER), P(PAD_R - 0.95, 0.88), 0.045, legMat)); // secondary struts
    g.add(strut(P(rim, Y0 + 0.05, LM_CORNER), P(PAD_R - 0.95, 0.88), 0.045, legMat));
    g.add(strut(P(rim, Y0 + 0.02), P(PAD_R - 0.95, 0.88), 0.04, legMat)); // down-lock strut
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.4, 0.16, 18), legMat);
    fp.position.set(s * PAD_R, 0.08, c * PAD_R);
    g.add(fp);
  }
  // ladder on the forward (+z) leg, below the porch and hatch
  for (const off of [-0.22, 0.22]) {
    g.add(strut([off, Y0 + H - 0.1, rim + 0.15], [off, 0.5, PAD_R - 0.35], 0.025, legMat));
  }
  for (let r = 0; r < 8; r++) {
    const t = (r + 0.5) / 8;
    const z = rim + 0.15 + (PAD_R - 0.5 - rim) * t, y = Y0 + H - 0.1 - (Y0 + H - 0.6) * t;
    g.add(strut([-0.22, y, z], [0.22, y, z], 0.018, legMat));
  }
  g.add(box(0.95, 0.06, 0.7, legMat, 0, Y0 + H + 0.05, rim + 0.3)); // porch
  shadowed(g);
  mergeStaticGroup(g);
  return g;
}

/**
 * Wire-mesh tyre tread: a dark woven zinc-coated steel mesh with bright titanium
 * chevrons (as in AS15-88-11866), so the wheels read open and dark and their
 * rotation shows on screen.
 */
function tyreTexture() {
  if (typeof document === 'undefined') return null; // unit tests (node)
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#26282b';
  x.fillRect(0, 0, 256, 64);
  // woven mesh: two fine diagonal line sets
  x.strokeStyle = '#6a6c6e';
  x.lineWidth = 1;
  for (let i = -64; i < 256 + 64; i += 6) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke();
    x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke();
  }
  // titanium chevrons
  x.strokeStyle = '#c9c6bf';
  x.lineWidth = 4;
  for (let i = 0; i < 256; i += 21) {
    x.beginPath(); x.moveTo(i, 4); x.lineTo(i + 9, 32); x.lineTo(i, 60); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Wheel side: dark rim ring, open spoked/mesh hub (alpha) so the wheel reads open. */
function wheelSideTexture() {
  if (typeof document === 'undefined') return null; // unit tests (node)
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  const C = 64;
  x.strokeStyle = '#1d1e20';
  x.lineWidth = 10;
  x.beginPath(); x.arc(C, C, 58, 0, Math.PI * 2); x.stroke(); // tyre edge
  x.strokeStyle = '#8d8f91';
  x.lineWidth = 3;
  x.beginPath(); x.arc(C, C, 50, 0, Math.PI * 2); x.stroke(); // bump-stop ring
  x.lineWidth = 2.5;
  for (let k = 0; k < 12; k++) { // spokes
    const a = (k / 12) * Math.PI * 2;
    x.beginPath(); x.moveTo(C + Math.cos(a) * 12, C + Math.sin(a) * 12); x.lineTo(C + Math.cos(a) * 52, C + Math.sin(a) * 52); x.stroke();
  }
  x.fillStyle = '#b8b5ae';
  x.beginPath(); x.arc(C, C, 13, 0, Math.PI * 2); x.fill(); // hub
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Lunar Roving Vehicle (Apollo 15 type): 3.1 m long, 2.06 m track, 0.82 m wire-mesh
 * wheels, two seats, console, umbrella high-gain antenna. Returns { group, wheels }.
 * Wheels stay separate (they turn); the rest is merged.
 */
export function buildRover() {
  const group = new THREE.Group();
  group.name = 'v2-rover';
  const body = new THREE.Group();
  body.name = 'v2-rover-body';
  const frame = new THREE.MeshStandardMaterial({ color: 0xb9b6b0, metalness: 0.75, roughness: 0.4 });
  // Apollo 15 fenders read orange / salmon in AS15-88-11866 (fibreglass)
  const fender = new THREE.MeshStandardMaterial({ color: 0xc8643a, metalness: 0.1, roughness: 0.65 });
  const seat = new THREE.MeshStandardMaterial({ color: 0x5a6f8a, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222326, metalness: 0.3, roughness: 0.6 });
  const dish = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide });

  body.add(box(1.25, 0.14, 2.3, frame, 0, 0.55, 0));
  for (const [x, z] of [[-0.92, 1.15], [0.92, 1.15], [-0.92, -1.15], [0.92, -1.15]]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.3, 14, 1, true, 0, Math.PI), fender);
    f.rotation.z = Math.PI / 2;
    f.position.set(x, 0.42, z);
    body.add(f);
    body.add(box(0.5, 0.05, 0.12, frame, x * 0.72, 0.5, z)); // suspension arm
  }
  for (const x of [-0.32, 0.32]) {
    body.add(box(0.5, 0.06, 0.5, seat, x, 0.72, -0.15));
    body.add(box(0.5, 0.45, 0.06, seat, x, 0.95, -0.42));
  }
  body.add(box(0.5, 0.35, 0.18, dark, 0, 0.92, 0.55)); // control console
  body.add(box(0.9, 0.3, 0.45, dark, 0, 0.72, -1.0)); // rear pallet / tool carrier
  body.add(strut([0.35, 0.62, 0.95], [0.35, 1.7, 0.95], 0.02, frame)); // high-gain mast
  const hga = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.06, 0.18, 16, 1, true), dish);
  hga.position.set(0.35, 1.78, 0.95);
  hga.rotation.x = -0.5;
  body.add(hga);
  body.add(strut([-0.4, 0.62, 0.95], [-0.4, 1.6, 0.95], 0.012, frame)); // low-gain antenna
  body.add(box(0.14, 0.14, 0.2, dark, 0, 1.12, 0.95)); // TV camera
  shadowed(body);
  mergeStaticGroup(body);
  group.add(body);

  // One mesh per wheel (two material groups: mesh tread on the side wall, spoked
  // open disc on the caps) so each wheel is still one object that turns.
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tyreTexture(), metalness: 0.5, roughness: 0.6 });
  const sideMap = wheelSideTexture();
  const sideMat = new THREE.MeshStandardMaterial({
    color: sideMap ? 0xffffff : 0x2a2b2d, map: sideMap, alphaTest: 0.5, transparent: false,
    side: THREE.DoubleSide, metalness: 0.5, roughness: 0.55,
  });
  const wheelGeo = new THREE.CylinderGeometry(0.41, 0.41, 0.23, 24);
  const wheels = [];
  for (const [x, z] of [[-0.92, 1.15], [0.92, 1.15], [-0.92, -1.15], [0.92, -1.15]]) {
    const w = new THREE.Mesh(wheelGeo, [tyreMat, sideMat, sideMat]);
    w.rotation.z = Math.PI / 2; // axle along x; spinning rotation.x turns it about the axle
    w.position.set(x, 0.41, z);
    w.castShadow = true;
    w.name = 'v2-rover-wheel';
    group.add(w);
    wheels.push(w);
  }
  return { group, wheels };
}

/** US flag canvas (13 stripes, canton with star dots), as flown on Apollo. */
function flagTexture() {
  if (typeof document === 'undefined') return null; // unit tests (node)
  const c = document.createElement('canvas');
  c.width = 190; c.height = 100;
  const x = c.getContext('2d');
  for (let i = 0; i < 13; i++) {
    x.fillStyle = i % 2 ? '#f2ede4' : '#b22234';
    x.fillRect(0, (i * 100) / 13, 190, 100 / 13 + 1);
  }
  x.fillStyle = '#3c3b6e';
  x.fillRect(0, 0, 76, 54);
  x.fillStyle = '#f2ede4';
  for (let r = 0; r < 9; r++) {
    for (let k = 0; k < (r % 2 ? 5 : 6); k++) {
      x.beginPath();
      x.arc(6 + k * 12.6 + (r % 2 ? 6.3 : 0), 4 + r * 5.8, 1.6, 0, Math.PI * 2);
      x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Flag on a pole with a horizontal top rod (no air on the Moon, so it never
 * flutters; the creases are fixed, as in the Apollo photographs).
 */
export function buildFlag() {
  const g = new THREE.Group();
  g.name = 'v2-flag';
  const pole = new THREE.MeshStandardMaterial({ color: 0xd8d6d0, metalness: 0.8, roughness: 0.3 });
  g.add(strut([0, -0.25, 0], [0, 2.2, 0], 0.016, pole));
  g.add(strut([0, 2.18, 0], [0.95, 2.18, 0], 0.01, pole));
  const geo = new THREE.PlaneGeometry(0.92, 0.6, 14, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.46) * 9) * 0.025);
  geo.computeVertexNormals();
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTexture(), roughness: 0.9, side: THREE.DoubleSide }));
  cloth.position.set(0.48, 1.87, 0);
  g.add(cloth);
  shadowed(g);
  mergeStaticGroup(g);
  return g;
}

/**
 * Ballistic dust (no atmosphere: grains arc and fall at lunar gravity, no drift).
 * One draw call. emit(worldPos, count) spawns grains; update(dt, groundY) moves them.
 */
export function createDustBurst(max = 160) {
  const pos = new Float32Array(max * 3).fill(-1e6);
  const vel = new Float32Array(max * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xb8b2a8, size: 0.09, transparent: true, opacity: 0.75, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.name = 'v2-rover-dust';
  points.frustumCulled = false;
  let next = 0;
  let live = 0;
  return {
    points,
    get live() { return live; },
    /** Drop every grain (used when motion freezes, so nothing hangs mid-air). */
    clear() {
      pos.fill(-1e6);
      vel.fill(0);
      live = 0;
      geo.attributes.position.needsUpdate = true;
    },
    emit(at, count, rng = Math.random) {
      for (let k = 0; k < count; k++) {
        const i = next; next = (next + 1) % max;
        pos[i * 3] = at.x + (rng() - 0.5) * 0.3;
        pos[i * 3 + 1] = at.y + 0.05;
        pos[i * 3 + 2] = at.z + (rng() - 0.5) * 0.3;
        vel[i * 3] = (rng() - 0.5) * 1.2;
        vel[i * 3 + 1] = 0.8 + rng() * 1.6;
        vel[i * 3 + 2] = (rng() - 0.5) * 1.2;
      }
    },
    /** @param {number} dt @param {(x:number,z:number)=>number} groundY */
    update(dt, groundY) {
      live = 0;
      for (let i = 0; i < max; i++) {
        const i3 = i * 3;
        if (pos[i3 + 1] < -1e5) continue;
        vel[i3 + 1] -= 1.62 * dt; // lunar surface gravity, m/s²
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        if (vel[i3 + 1] < 0 && pos[i3 + 1] < groundY(pos[i3], pos[i3 + 2])) pos[i3 + 1] = -1e6;
        else live++;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
