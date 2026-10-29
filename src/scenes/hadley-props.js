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

/**
 * Lunar Module descent stage (what stays on the surface after lift-off):
 * gold-foil octagonal body, four splayed legs with footpads, descent engine
 * bell, ladder on the forward (+x) leg. ~9.4 m across the footpads.
 */
export function buildLunarModule() {
  const g = new THREE.Group();
  g.name = 'v2-lunar-module';
  // Own materials per prop so hover highlights only this prop.
  const foil = new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 0.85, roughness: 0.38 });
  const blackFoil = new THREE.MeshStandardMaterial({ color: 0x2a2826, metalness: 0.4, roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xbfb8a8, metalness: 0.7, roughness: 0.42 });
  const engine = new THREE.MeshStandardMaterial({ color: 0x4a4744, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.6, 8), foil);
  body.rotation.y = Math.PI / 8;
  body.position.y = 2.0;
  g.add(body);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.1, 0.12, 8), blackFoil);
  deck.rotation.y = Math.PI / 8;
  deck.position.y = 2.86;
  g.add(deck);
  // dark thermal-blanket quadrant panels between the legs
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const p = box(1.5, 1.1, 0.06, blackFoil, Math.sin(a) * 2.0, 2.0, Math.cos(a) * 2.0);
    p.rotation.y = a;
    g.add(p);
  }
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.82, 0.95, 20, 1, true), engine);
  bell.position.y = 0.72;
  g.add(bell);
  // legs on the diagonals
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const s = Math.sin(a), c = Math.cos(a);
    const top = [s * 2.0, 2.5, c * 2.0];
    const pad = [s * 4.4, 0.32, c * 4.4];
    g.add(strut(top, pad, 0.09, legMat));
    g.add(strut([s * 2.05, 1.25, c * 2.05], [s * 3.6, 0.75, c * 3.6], 0.05, legMat));
    g.add(strut([s * 1.4 + c * 0.9, 1.22, c * 1.4 - s * 0.9], [s * 3.3, 0.9, c * 3.3], 0.04, legMat));
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.42, 0.14, 16), legMat);
    fp.position.set(s * 4.45, 0.07, c * 4.45);
    g.add(fp);
  }
  // ladder on the forward leg (+x, +z diagonal) and the porch
  const la = Math.PI / 4, ls = Math.sin(la), lc = Math.cos(la);
  for (const off of [-0.22, 0.22]) {
    g.add(strut([ls * 2.2 + lc * off, 2.45, lc * 2.2 - ls * off], [ls * 4.1 + lc * off, 0.45, lc * 4.1 - ls * off], 0.025, legMat));
  }
  for (let r = 0; r < 8; r++) {
    const t = (r + 0.5) / 8;
    const cx = ls * (2.2 + 1.9 * t), cz = lc * (2.2 + 1.9 * t), cy = 2.45 - 2.0 * t;
    const rung = strut([cx - lc * 0.22, cy, cz + ls * 0.22], [cx + lc * 0.22, cy, cz - ls * 0.22], 0.018, legMat);
    g.add(rung);
  }
  const porch = box(0.9, 0.06, 0.7, legMat, ls * 2.25, 2.6, lc * 2.25);
  porch.rotation.y = la;
  g.add(porch);
  shadowed(g);
  mergeStaticGroup(g);
  return g;
}

/** Chevron-mesh tyre texture so wheel rotation reads on screen. */
function tyreTexture() {
  if (typeof document === 'undefined') return null; // unit tests (node)
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#7d7973';
  x.fillRect(0, 0, 128, 32);
  x.strokeStyle = '#3f3c38';
  x.lineWidth = 3;
  for (let i = 0; i < 128; i += 10) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 5, 16); x.lineTo(i, 32); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
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
  const fender = new THREE.MeshStandardMaterial({ color: 0x8f949b, metalness: 0.3, roughness: 0.6 });
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

  const tyreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tyreTexture(), metalness: 0.5, roughness: 0.6 });
  const wheelGeo = new THREE.CylinderGeometry(0.41, 0.41, 0.23, 20);
  const wheels = [];
  for (const [x, z] of [[-0.92, 1.15], [0.92, 1.15], [-0.92, -1.15], [0.92, -1.15]]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
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
