/**
 * astronaut.js — a suited lunar field geologist (own procedural work, CC0).
 *
 * Built from NASA Apollo-era photographs of the A7L-B suit: white layered
 * fabric with joint bellows, a life-support backpack (PLSS) with the oxygen
 * purge unit on top, a gold visor, grey-blue gloves and lunar boots, a chest
 * control box. Real proportions: 1.88 m to the top of the backpack.
 *
 * Gaits follow lunar gravity (1.62 m/s^2): the "lope" is a bounding skip with
 * a short flight phase, as the Apollo crews moved; nothing billows or sways in
 * air because there is none. Animation is a joint hierarchy, no skinning.
 * The crew belongs to the app's fictional field-team mission.
 * @module lunar/astronaut
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LUNAR_G } from './frame.js';

let shared = null;
function fabricTexture(stripe) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ecebe6'; g.fillRect(0, 0, 128, 128);
  // Beta-cloth weave and seams
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 1); }
  g.strokeStyle = 'rgba(90,90,90,0.35)'; g.lineWidth = 1.5;
  for (let y = 16; y < 128; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  // Regolith dust on the lower part
  const dust = g.createLinearGradient(0, 64, 0, 128);
  dust.addColorStop(0, 'rgba(120,112,100,0)'); dust.addColorStop(1, 'rgba(120,112,100,0.35)');
  g.fillStyle = dust; g.fillRect(0, 64, 128, 64);
  if (stripe) { g.fillStyle = '#b3262d'; g.fillRect(0, 52, 128, 12); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function materials() {
  if (shared) return shared;
  const plain = fabricTexture(false), red = fabricTexture(true);
  shared = {
    suit: new THREE.MeshStandardMaterial({ map: plain, roughness: 0.92 }),
    stripe: new THREE.MeshStandardMaterial({ map: red, roughness: 0.92 }),
    pack: new THREE.MeshStandardMaterial({ map: plain, color: 0xdedcd6, roughness: 0.8 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.12 }),
    shell: new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.35, metalness: 0.05 }),
    glove: new THREE.MeshStandardMaterial({ map: plain, color: 0x7f8b99, roughness: 0.7 }),
    boot: new THREE.MeshStandardMaterial({ map: plain, color: 0xb9b6ad, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8e9196, metalness: 0.8, roughness: 0.35 }),
  };
  for (const m of Object.values(shared)) m.userData.surfaceDetail = true;
  return shared;
}

const cap = (r, len, segs = 10) => new THREE.CapsuleGeometry(r, len, 4, segs);
function limb(mat, r, len, y = -len / 2) {
  const m = new THREE.Mesh(cap(r, len), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}
function merged(parts, mat) {
  const m = new THREE.Mesh(mergeGeometries(parts.map(([g, pos, rot]) => {
    const q = g.index ? g.toNonIndexed() : g;
    q.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), new THREE.Vector3(1, 1, 1)));
    for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
    return q;
  }), false), mat);
  m.castShadow = true;
  return m;
}

/**
 * @param {{ commander?: boolean, name?: string }} [o]
 * @returns {{ root: THREE.Group, setAction: (a: string) => void, update: (dt: number) => void, action: string, onFootfall?: Function, bag: THREE.Object3D }}
 */
export function createAstronaut(o = {}) {
  const M = materials();
  const root = new THREE.Group();
  root.name = o.name || 'astronaut';
  const hips = new THREE.Group(); hips.position.y = 0.98; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const suit = o.commander ? M.stripe : M.suit;
  torso.add(merged([[cap(0.2, 0.32, 12), [0, 0.3, 0]], [new THREE.SphereGeometry(0.17, 12, 8), [0, 0.05, 0]]], M.suit));
  // Chest control box and the hoses
  torso.add(merged([[new THREE.BoxGeometry(0.22, 0.13, 0.1), [0, 0.38, 0.2]]], M.pack));
  // Backpack (PLSS) with the oxygen purge unit on top
  torso.add(merged([[new THREE.BoxGeometry(0.5, 0.62, 0.24), [0, 0.42, -0.3]], [new THREE.BoxGeometry(0.44, 0.17, 0.2), [0, 0.82, -0.3]]], M.pack));
  // Helmet: shell, gold visor, neck ring
  const head = new THREE.Group(); head.position.y = 0.66; torso.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), M.shell); helmet.castShadow = true;
  head.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.172, 20, 12, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.22, Math.PI * 0.42), M.visor);
  head.add(visor);
  head.add(merged([[new THREE.TorusGeometry(0.15, 0.025, 6, 18), [0, -0.13, 0], [Math.PI / 2, 0, 0]]], M.metal));
  // Arms
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0.27 * s, 0.5, 0); torso.add(sh);
    sh.add(limb(suit, 0.075, 0.24));
    const el = new THREE.Group(); el.position.y = -0.31; sh.add(el);
    el.add(limb(M.suit, 0.068, 0.22));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), M.glove); hand.scale.set(1, 1.3, 0.8); hand.position.y = -0.33; hand.castShadow = true;
    el.add(hand);
    arms.push({ sh, el, s });
    const hip = new THREE.Group(); hip.position.set(0.11 * s, -0.02, 0); hips.add(hip);
    hip.add(limb(suit, 0.09, 0.3));
    const kn = new THREE.Group(); kn.position.y = -0.44; hip.add(kn);
    kn.add(limb(M.suit, 0.08, 0.3));
    const boot = merged([[new THREE.BoxGeometry(0.15, 0.1, 0.3), [0, -0.47, 0.05]]], M.boot); kn.add(boot);
    legs.push({ hip, kn, s });
  }
  // Sample bag hanging from the right hand's tongs (swings as a lunar pendulum).
  const bagPivot = new THREE.Group(); bagPivot.position.y = -0.36; arms[1].el.add(bagPivot);
  const bag = merged([[new THREE.BoxGeometry(0.12, 0.16, 0.05), [0, -0.12, 0]]], M.pack);
  bagPivot.add(bag);
  // Shadow casters: torso, backpack, helmet and legs (arms and small parts skip
  // the two shadow cascades; their shadows are a few pixels and cost draw calls).
  root.traverse((m) => { if (m.isMesh) { m.receiveShadow = true; m.castShadow = false; } });
  for (const m of [...torso.children, helmet, ...legs.flatMap((l) => [l.hip.children[0], l.kn.children[0]])]) if (m.isMesh) m.castShadow = true;
  // Rest-pose size, measured from the geometry now (before any animation), in
  // the figure's own axes: the scale check compares this with the catalog.
  root.updateWorldMatrix(true, true);
  const rest = new THREE.Box3();
  const inv = root.matrixWorld.clone().invert();
  root.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); rest.union(m.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld))); } });
  root.userData.restSize = rest.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(3));

  const st = { action: 'idle', t: o.phase ?? 0, hop: 0, vy: 0, swing: 0.15, swingV: 0 };
  const api = {
    root, bag: bagPivot, action: 'idle',
    setAction(a) { st.action = a; api.action = a; },
    /** Height of the current hop above the ground (lope flight phase). */
    get lift() { return st.hop; },
    update(dt) {
      st.t += dt;
      const t = st.t;
      let lean = 0, armF = 0, armB = 0, kneeA = 0, kneeB = 0, hipA = 0, hipB = 0, crouch = 0, raise = 0;
      if (st.action === 'lope') {
        // A bounding skip: push off every 0.75 s with ~1.1 m/s upward speed (about 0.37 m of flight at 1.62 m/s^2).
        if (st.hop <= 0 && st.vy <= 0) { st.vy = 1.1; api.onFootfall?.(); }
        st.vy -= LUNAR_G * dt;
        st.hop = Math.max(0, st.hop + st.vy * dt);
        const ph = Math.sin(t * 8.4);
        lean = 0.22; hipA = 0.35 * ph; hipB = -0.35 * ph; kneeA = 0.5 + 0.3 * ph; kneeB = 0.5 - 0.3 * ph;
        armF = 0.35; armB = 0.25;
      } else if (st.action === 'sample') {
        // Bend at the knees and reach down with the tongs, then stand.
        const k = 0.5 - 0.5 * Math.cos(Math.min(1, (t % 7) / 2.5) * Math.PI) * (t % 7 < 5 ? 1 : 1 - (t % 7 - 5) / 2);
        crouch = 0.28 * k; lean = 0.45 * k; kneeA = kneeB = 0.9 * k; hipA = hipB = -0.7 * k; armF = 0.9 * k;
        st.hop = 0; st.vy = 0;
      } else if (st.action === 'point') {
        raise = 1; lean = -0.05; st.hop = 0; st.vy = 0;
      } else { st.hop = 0; st.vy = 0; }
      // breathing sway
      torso.rotation.x = lean + Math.sin(t * 1.7) * 0.012;
      hips.position.y = 0.98 - crouch + st.hop;
      legs[0].hip.rotation.x = -hipA; legs[1].hip.rotation.x = -hipB;
      legs[0].kn.rotation.x = kneeA; legs[1].kn.rotation.x = kneeB;
      arms[0].sh.rotation.x = -armB; arms[0].el.rotation.x = -0.35;
      arms[1].sh.rotation.x = -armF; arms[1].el.rotation.x = -0.5;
      arms[0].sh.rotation.z = -0.18; arms[1].sh.rotation.z = 0.18;
      if (raise) { arms[0].sh.rotation.x = -1.45; arms[0].el.rotation.x = -0.1; arms[0].sh.rotation.z = -0.3; }
    },
    /** The sample bag swings as a pendulum at lunar gravity, driven by the arm (a separate motion system). */
    updateBag(dt) {
      // Sample bag: a damped-free pendulum at lunar gravity (L = 0.12 m, period 1.7 s), driven by the arm.
      const L = 0.12;
      const acc = -(LUNAR_G / L) * Math.sin(st.swing) - (arms[1].sh.rotation.x - (st.prevArm ?? arms[1].sh.rotation.x)) / Math.max(dt, 1e-3) * 2;
      st.prevArm = arms[1].sh.rotation.x;
      st.swingV += acc * dt;
      st.swingV *= 1 - 0.02 * dt; // almost no damping without air
      st.swing = THREE.MathUtils.clamp(st.swing + st.swingV * dt, -0.9, 0.9);
      bagPivot.rotation.x = st.swing - arms[1].sh.rotation.x - arms[1].el.rotation.x;
    },
  };
  return api;
}
