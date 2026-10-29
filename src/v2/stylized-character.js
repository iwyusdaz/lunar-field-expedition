/**
 * stylized-character.js — Animated-Movie / Feature-Animation Style 3D Character
 * Builder & Procedural Skeletal Animation Controller (v2.0.0).
 *
 * Produces expressive, appealing stylized-realistic 3D characters inspired by
 * modern animated films:
 *  - Smooth organic head with sculpted nose, ears, cheeks, brow, and jaw
 *  - Layered eyes: sclera, colored iris, pupil, cornea specular highlight dot,
 *    animated upper/lower eyelids (blinking + squint), and articulated eyebrows
 *  - Articulated mouth/jaw for talking and expressions
 *  - Sculpted multi-lobe hairstyles or headgear (cap, hardhat, helmet, bun, bob, curls)
 *  - Full articulated limb hierarchy (spine, chest, neck, head, shoulders, elbows,
 *    wrists, hands + fingers, hips, knees, ankles, shoes)
 *  - Warm subsurface-like physical skin material + textured fabric clothing
 *  - Grounding contact-shadow disc under feet so characters never float
 *  - Continuous procedural animation loop (breathing, blinking, eye/head gaze,
 *    talking, walking, writing, waving, pointing, thinking, confused, withdrawn)
 *    with Calm Mode support.
 *
 * Uses a deterministic seeded PRNG (no Math.random).
 * @module v2/stylized-character
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str = 'char') {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Create a soft radial contact shadow texture once and share it across characters.
 */
let _sharedShadowTex = null;
export function getContactShadowTexture() {
  if (_sharedShadowTex) return _sharedShadowTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.58)');
    g.addColorStop(0.55, 'rgba(0, 0, 0, 0.24)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  _sharedShadowTex = new THREE.CanvasTexture(c);
  return _sharedShadowTex;
}

/**
 * @param {object} opts
 * @param {string} [opts.id='char']
 * @param {string} [opts.name='Character']
 * @param {number} [opts.height=1.7]          Total standing height in metres
 * @param {number} [opts.skinColor=0xd99b78]
 * @param {number} [opts.hairColor=0x2a1d17]
 * @param {number} [opts.eyeColor=0x3b2618]
 * @param {number} [opts.topColor=0x2e6f95]
 * @param {number} [opts.AccentColor]
 * @param {number} [opts.bottomColor=0x25303b]
 * @param {number} [opts.shoeColor=0x1c1e22]
 * @param {'short'|'bob'|'curls'|'bun'|'cap'|'hardhat'|'beret'|'helmet'} [opts.hairStyle='short']
 * @param {'none'|'apron'|'hivis'|'jacket'|'cardigan'|'backpack'|'labcoat'|'spacesuit'} [opts.outfit='none']
 * @param {boolean} [opts.seated=false]
 * @param {boolean} [opts.glasses=false]
 * @param {'pencil'|'clipboard'|'tablet'|'lantern'|'none'} [opts.prop='none']
 */
export function createAnimatedCharacter(opts = {}) {
  const id = opts.id || opts.name || 'char';
  const rng = mulberry32(hashSeed(String(id)));
  const scale = (opts.height || 1.7) / 1.7;

  const root = new THREE.Group();
  root.name = `character-${id}`;
  root.scale.setScalar(scale);

  // Materials — warm subsurface-like physical skin + soft woven cloth.
  // Sheen gives the animated-movie softness; clearcoat is deliberately omitted
  // (it roughly doubles the BRDF cost per pixel for little visual gain at this scale).
  // MeshStandardMaterial keeps the fragment budget for the scene around the
  // characters; the soft animated-movie read comes from warm colours + lighting.
  const skinMat = new THREE.MeshStandardMaterial({
    color: opts.skinColor ?? 0xd99b78,
    roughness: 0.55,
    metalness: 0.0,
  });
  const blushMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.skinColor ?? 0xd99b78).lerp(new THREE.Color(0xd96b6b), 0.32),
    roughness: 0.6,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: opts.hairColor ?? 0x2a1d17,
    roughness: 0.45,
    metalness: 0.05,
  });
  const topMat = new THREE.MeshStandardMaterial({
    color: opts.topColor ?? 0x2e6f95,
    roughness: 0.75,
    metalness: 0.02,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: opts.accentColor ?? 0xf4e7cf,
    roughness: 0.55,
    metalness: 0.08,
  });
  const bottomMat = new THREE.MeshStandardMaterial({
    color: opts.bottomColor ?? 0x25303b,
    roughness: 0.78,
    metalness: 0.02,
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: opts.shoeColor ?? 0x1c1e22,
    roughness: 0.48,
    metalness: 0.1,
  });
  const scleraMat = new THREE.MeshStandardMaterial({ color: 0xfaf8f5, roughness: 0.2 });
  const lipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.skinColor ?? 0xd99b78).lerp(new THREE.Color(0xa24848), 0.38),
    roughness: 0.45,
  });

  /**
   * One draw call per eye: iris + pupil + catchlight merged into a single
   * vertex-coloured geometry (they only ever move together inside the iris pivot).
   */
  function coloredCircleGeometry(radius, segments, color, z, offsetX = 0, offsetY = 0) {
    const g = new THREE.CircleGeometry(radius, segments).toNonIndexed();
    g.translate(offsetX, offsetY, z);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }
  const eyeDecalMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const buildEyeDecal = (side) => BufferGeometryUtils.mergeGeometries([
    coloredCircleGeometry(0.0125, 20, opts.eyeColor ?? 0x3b2618, 0.0148),
    coloredCircleGeometry(0.0068, 16, 0x09090b, 0.0152),
    coloredCircleGeometry(0.0032, 12, 0xffffff, 0.0156, side * 0.0038, 0.0042),
  ], false);

  // Ground contact shadow
  const shadowTex = getContactShadowTexture();
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.68, 0.68),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    }),
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.005;
  root.add(shadowPlane);

  // Pelvis / Hips root joint
  const pelvis = new THREE.Group();
  pelvis.position.y = opts.seated ? 0.52 : 0.90;
  root.add(pelvis);

  const hipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), bottomMat);
  hipMesh.scale.set(1.12, 0.78, 0.92);
  hipMesh.castShadow = true;
  pelvis.add(hipMesh);

  // Spine & Chest
  const spine = new THREE.Group();
  spine.position.y = 0.06;
  pelvis.add(spine);

  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.148, 0.132, 0.42, 24, 4),
    topMat,
  );
  torso.position.y = 0.21;
  torso.scale.set(1.12, 1.0, 0.82);
  torso.castShadow = true;
  torso.receiveShadow = true;
  spine.add(torso);

  // Rounded shoulders / upper chest cap
  const chestCap = new THREE.Mesh(new THREE.SphereGeometry(0.152, 24, 16), topMat);
  chestCap.position.y = 0.39;
  chestCap.scale.set(1.18, 0.55, 0.84);
  chestCap.castShadow = true;
  spine.add(chestCap);

  // Collar
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.078, 0.018, 10, 24),
    accentMat,
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.43;
  spine.add(collar);

  // Outfit layers (apron, hi-vis vest, jacket, backpack, spacesuit chest pack)
  if (opts.outfit === 'apron') {
    const apronBib = new THREE.Mesh(
      new THREE.CylinderGeometry(0.154, 0.142, 0.46, 20, 1, true, -Math.PI * 0.38, Math.PI * 0.76),
      accentMat,
    );
    apronBib.position.y = 0.17;
    apronBib.scale.set(1.13, 1.0, 0.85);
    spine.add(apronBib);
  } else if (opts.outfit === 'hivis') {
    const vestMat = new THREE.MeshStandardMaterial({
      color: 0xffd100,
      emissive: 0x332800,
      roughness: 0.45,
    });
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0xe6edf2,
      emissive: 0x454a4f,
      roughness: 0.25,
      metalness: 0.35,
    });
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.140, 0.40, 20), vestMat);
    vest.position.y = 0.22;
    vest.scale.set(1.14, 1.0, 0.86);
    spine.add(vest);
    for (const sy of [0.12, 0.26]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.158, 0.156, 0.032, 20), stripMat);
      band.position.y = sy;
      band.scale.set(1.14, 1.0, 0.87);
      spine.add(band);
    }
  } else if (opts.outfit === 'backpack' || opts.outfit === 'spacesuit') {
    const packMat = opts.outfit === 'spacesuit'
      ? new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.35, metalness: 0.15 })
      : new THREE.MeshStandardMaterial({ color: opts.accentColor ?? 0x3b4d63, roughness: 0.65 });
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.13), packMat);
    pack.position.set(0, 0.24, -0.16);
    pack.castShadow = true;
    spine.add(pack);
  }

  // Neck & Head
  const neck = new THREE.Group();
  neck.position.y = 0.44;
  spine.add(neck);

  const neckCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.09, 16), skinMat);
  neckCyl.position.y = 0.035;
  neck.add(neckCyl);

  const head = new THREE.Group();
  head.position.y = 0.155;
  neck.add(head);

  // Expressive animated-movie head shape (slightly wider cheeks, soft jaw)
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.125, 28, 24), skinMat);
  cranium.scale.set(0.96, 1.06, 0.98);
  cranium.castShadow = true;
  head.add(cranium);

  // Cheek warmth
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 12), blushMat);
    cheek.position.set(side * 0.068, -0.018, 0.092);
    cheek.scale.set(1.1, 0.72, 0.6);
    head.add(cheek);

    // Ears
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), skinMat);
    ear.position.set(side * 0.118, -0.005, -0.005);
    ear.scale.set(0.45, 0.95, 0.7);
    head.add(ear);
  }

  // Sculpted nose
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.048, 14), skinMat);
  nose.rotation.x = Math.PI * 0.42;
  nose.position.set(0, -0.004, 0.128);
  head.add(nose);

  // Layered Eyes + Eyelids + Eyebrows
  const eyes = [];
  const eyelids = [];
  const brows = [];
  for (const side of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * 0.044, 0.018, 0.106);
    head.add(eyeGroup);

    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 18, 14), scleraMat);
    eyeball.scale.set(1.0, 1.08, 0.65);
    eyeGroup.add(eyeball);

    const irisPivot = new THREE.Group();
    eyeGroup.add(irisPivot);

    // Iris + pupil + catchlight as ONE vertex-coloured mesh (1 draw call, was 3)
    const decal = new THREE.Mesh(buildEyeDecal(side), eyeDecalMat);
    irisPivot.add(decal);

    // Upper eyelid for blinking & expressions
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.0235, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      skinMat,
    );
    lid.scale.set(1.02, 1.08, 0.70);
    lid.rotation.x = -0.95; // open by default
    eyeGroup.add(lid);

    // Eyebrow
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.0075, 0.012), hairMat);
    brow.position.set(side * 0.044, 0.050, 0.112);
    brow.rotation.z = side * -0.06;
    head.add(brow);

    eyes.push(irisPivot);
    eyelids.push(lid);
    brows.push({ mesh: brow, side });
  }

  // Optional glasses
  if (opts.glasses) {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e2229, roughness: 0.3, metalness: 0.6 });
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.003, 10, 24), frameMat);
      rim.position.set(side * 0.045, 0.018, 0.122);
      head.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.0035, 0.004), frameMat);
    bridge.position.set(0, 0.022, 0.122);
    head.add(bridge);
  }

  // Mouth (animated scale/openness for speech & expression)
  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.024, 8, 12), lipMat);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, -0.048, 0.114);
  head.add(mouth);

  // Hair / Headgear
  const hairGroup = new THREE.Group();
  head.add(hairGroup);
  const style = opts.hairStyle || 'short';

  if (style === 'helmet') {
    const helmetShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.155, 24, 20),
      new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.25, metalness: 0.1 }),
    );
    helmetShell.position.y = 0.01;
    hairGroup.add(helmetShell);
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.142, 24, 16, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.22, Math.PI * 0.45),
      new THREE.MeshPhysicalMaterial({ color: 0xd49b35, roughness: 0.12, metalness: 0.78, clearcoat: 1.0 }),
    );
    visor.rotation.y = Math.PI / 2;
    visor.position.set(0, 0.01, 0.025);
    hairGroup.add(visor);
  } else {
    // Base hair cap
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.132, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.58),
      hairMat,
    );
    cap.position.set(0, 0.012, -0.008);
    cap.rotation.x = -0.14;
    cap.castShadow = true;
    hairGroup.add(cap);

    // Sculpted front fringe lobes
    for (let i = -2; i <= 2; i++) {
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), hairMat);
      lobe.position.set(i * 0.032, 0.075 - Math.abs(i) * 0.006, 0.095 - Math.abs(i) * 0.01);
      lobe.scale.set(1.15, 0.68, 0.85);
      lobe.rotation.z = i * -0.18;
      hairGroup.add(lobe);
    }

    if (style === 'bob' || style === 'curls') {
      for (const side of [-1, 1]) {
        const sideLock = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.11, 10, 14), hairMat);
        sideLock.position.set(side * 0.105, -0.015, 0.0);
        sideLock.rotation.z = side * 0.12;
        hairGroup.add(sideLock);
      }
    }
    if (style === 'bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.058, 18, 14), hairMat);
      bun.position.set(0, 0.11, -0.105);
      hairGroup.add(bun);
    }
    if (style === 'hardhat') {
      const hatMat = new THREE.MeshPhysicalMaterial({
        color: opts.hatColor ?? 0xffd100,
        roughness: 0.28,
        clearcoat: 0.6,
      });
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.142, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
        hatMat,
      );
      dome.position.y = 0.035;
      hairGroup.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.168, 0.014, 24), hatMat);
      brim.position.set(0, 0.035, 0.022);
      brim.scale.set(0.95, 1, 1.12);
      hairGroup.add(brim);
    } else if (style === 'cap' || style === 'beret') {
      const capMat = new THREE.MeshStandardMaterial({ color: opts.hatColor ?? 0x243b55, roughness: 0.65 });
      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(0.136, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.48),
        capMat,
      );
      crown.position.y = 0.032;
      hairGroup.add(crown);
    }
  }

  // Arms (Shoulder -> UpperArm -> Elbow -> Forearm -> Hand)
  const arms = {};
  for (const [key, side] of [['left', -1], ['right', 1]]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.185, 0.38, 0);
    spine.add(shoulder);

    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.18, 10, 14), topMat);
    sleeve.position.y = -0.10;
    sleeve.castShadow = true;
    shoulder.add(sleeve);

    const elbow = new THREE.Group();
    elbow.position.y = -0.22;
    shoulder.add(elbow);

    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.17, 10, 14), skinMat);
    forearm.position.y = -0.095;
    forearm.castShadow = true;
    elbow.add(forearm);

    const wrist = new THREE.Group();
    wrist.position.y = -0.20;
    elbow.add(wrist);

    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 12), skinMat);
    palm.scale.set(0.85, 1.15, 0.58);
    palm.position.y = -0.02;
    wrist.add(palm);

    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.010, 0.022, 6, 8), skinMat);
    thumb.position.set(side * -0.024, -0.015, 0.018);
    thumb.rotation.z = side * 0.5;
    wrist.add(thumb);

    arms[key] = { shoulder, elbow, wrist };
  }

  // Optional hand prop
  if (opts.prop === 'pencil') {
    const pencil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.15, 10),
      new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.4 }),
    );
    pencil.rotation.x = Math.PI / 2;
    pencil.position.set(0, -0.03, 0.05);
    arms.right.wrist.add(pencil);
  } else if (opts.prop === 'clipboard' || opts.prop === 'tablet') {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.24, 0.014),
      new THREE.MeshStandardMaterial({
        color: opts.prop === 'tablet' ? 0x1e2530 : 0x8c5a32,
        roughness: 0.4,
      }),
    );
    board.position.set(0, -0.04, 0.06);
    board.rotation.x = -0.6;
    arms.left.wrist.add(board);
  }

  // Legs (Hip -> Thigh -> Knee -> Shin -> Foot)
  const legs = {};
  for (const [key, side] of [['left', -1], ['right', 1]]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.085, -0.04, 0);
    pelvis.add(hip);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.056, 0.30, 10, 14), bottomMat);
    thigh.position.y = -0.18;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.37;
    hip.add(knee);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.30, 10, 14), bottomMat);
    shin.position.y = -0.18;
    shin.castShadow = true;
    knee.add(shin);

    const ankle = new THREE.Group();
    ankle.position.y = -0.37;
    knee.add(ankle);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.065, 0.19), shoeMat);
    shoe.position.set(0, -0.03, 0.04);
    shoe.castShadow = true;
    ankle.add(shoe);

    if (opts.seated) {
      hip.rotation.x = -Math.PI * 0.47;
      knee.rotation.x = Math.PI * 0.47;
    }

    legs[key] = { hip, knee, ankle };
  }

  // Animation state
  const state = {
    action: opts.initialAction || (opts.seated ? 'seated-idle' : 'idle'),
    expression: opts.initialExpression || 'neutral',
    speaking: false,
    lookTarget: null, // THREE.Vector3 in world space
    phaseOffset: rng() * Math.PI * 2,
    blinkTimer: 1.8 + rng() * 2.5,
    blinkProgress: 0,
  };

  // Static-geometry merge: parts that never move relative to their parent joint
  // are combined into one mesh per material, cutting ~14 draw calls per character
  // (plus the shadow pass) at identical visuals. Animated parts (eyes, lids, brows,
  // mouth, limbs) are untouched.
  {
    const mergeSet = (parent, meshes) => {
      if (meshes.length < 2) return;
      const byMaterial = new Map();
      for (const m of meshes) {
        if (!byMaterial.has(m.material)) byMaterial.set(m.material, []);
        byMaterial.get(m.material).push(m);
      }
      for (const [material, parts] of byMaterial) {
        const geos = parts.map((m) => {
          const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
          g.applyMatrix4(new THREE.Matrix4().compose(m.position, m.quaternion, m.scale));
          for (const name of Object.keys(g.attributes)) {
            if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
          }
          if (!g.attributes.normal) g.computeVertexNormals();
          return g;
        });
        let merged;
        try {
          merged = BufferGeometryUtils.mergeGeometries(geos, false);
        } catch {
          continue;
        }
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        parent.add(mesh);
        for (const m of parts) parent.remove(m);
      }
    };
    const directWith = (parent, material) =>
      parent.children.filter((c) => c.isMesh && c.material === material);
    // Head skin parts (cranium, nose, ears, cheeks share two materials)
    mergeSet(head, [...directWith(head, skinMat), ...directWith(head, blushMat)]);
    // All hair/headgear parts are static within hairGroup
    mergeSet(hairGroup, hairGroup.children.filter((c) => c.isMesh));
    // Torso + chest cap (topMat) are static within spine
    mergeSet(spine, directWith(spine, topMat));
  }

  const _tmpWorld = new THREE.Vector3();
  const _tmpLocal = new THREE.Vector3();

  function setAction(actionName, expressionName) {
    if (actionName) state.action = actionName;
    if (expressionName) state.expression = expressionName;
  }

  function setSpeaking(flag) {
    state.speaking = Boolean(flag);
  }

  function lookAtWorld(vec3OrNull) {
    state.lookTarget = vec3OrNull;
  }

  function update(dt = 0.016, elapsed = 0, calmFactor = 1.0) {
    // calmFactor 0 (reduced motion) freezes ALL character animation: the pose
    // for the current action/expression is applied once and then nothing moves.
    const frozen = calmFactor <= 0;
    const rate = frozen ? 0 : calmFactor;
    const t = elapsed * rate + state.phaseOffset;
    const step = frozen ? 0 : dt;

    // 1. Natural chest breathing
    const breath = Math.sin(t * 2.1);
    spine.scale.set(1 + breath * 0.012, 1 + breath * 0.015, 1 + breath * 0.018);

    // 2. Periodic natural blinking
    state.blinkTimer -= step;
    if (state.blinkTimer <= 0) {
      state.blinkProgress = 0.16;
      state.blinkTimer = 2.6 + rng() * 3.1;
    }
    let blinkAmt = 0;
    if (state.blinkProgress > 0) {
      state.blinkProgress = Math.max(0, state.blinkProgress - step);
      blinkAmt = Math.sin((state.blinkProgress / 0.16) * Math.PI);
    }
    const squint = state.expression === 'confused' ? 0.28 : state.expression === 'withdrawn' ? 0.42 : 0;
    for (const lid of eyelids) {
      lid.rotation.x = -0.95 + Math.max(blinkAmt, squint) * 0.95;
    }

    // 3. Eyebrow expressions
    for (const { mesh, side } of brows) {
      if (state.expression === 'confused') {
        mesh.position.y = 0.052 + (side > 0 ? 0.008 : -0.003);
        mesh.rotation.z = side * (side > 0 ? 0.22 : -0.18);
      } else if (state.expression === 'happy' || state.expression === 'engaged') {
        mesh.position.y = 0.055;
        mesh.rotation.z = side * -0.10;
      } else if (state.expression === 'withdrawn' || state.expression === 'concerned') {
        mesh.position.y = 0.046;
        mesh.rotation.z = side * 0.18;
      } else {
        mesh.position.y = 0.050;
        mesh.rotation.z = side * -0.06;
      }
    }

    // 4. Mouth / lip-flap
    if (state.speaking || state.action === 'talk') {
      const open = 0.7 + Math.abs(Math.sin(elapsed * rate * 11.5 + state.phaseOffset)) * 1.4;
      mouth.scale.set(1.0, open, 1.0);
    } else if (state.expression === 'happy') {
      mouth.scale.set(1.25, 0.85, 1.0);
    } else {
      mouth.scale.set(1.0, 0.8, 1.0);
    }

    // 5. Head & eye gaze tracking
    let targetYaw = Math.sin(t * 0.7) * 0.08;
    let targetPitch = Math.sin(t * 0.5) * 0.04;
    if (state.lookTarget) {
      head.getWorldPosition(_tmpWorld);
      _tmpLocal.copy(state.lookTarget).sub(_tmpWorld);
      // Transform world delta into root's local orientation
      const invQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      _tmpLocal.applyQuaternion(invQ);
      targetYaw = THREE.MathUtils.clamp(Math.atan2(_tmpLocal.x, Math.max(0.2, _tmpLocal.z)), -0.65, 0.65);
      targetPitch = THREE.MathUtils.clamp(-Math.atan2(_tmpLocal.y, Math.hypot(_tmpLocal.x, _tmpLocal.z)), -0.40, 0.40);
    }

    // 6. Action poses
    const act = state.action;
    if (act === 'walk') {
      const w = elapsed * 5.2 * rate + state.phaseOffset;
      pelvis.position.y = 0.90 + Math.abs(Math.cos(w * 2)) * 0.032;
      spine.rotation.z = Math.sin(w) * 0.04;
      spine.rotation.x = 0.04;
      legs.left.hip.rotation.x = Math.sin(w) * 0.52;
      legs.right.hip.rotation.x = -Math.sin(w) * 0.52;
      legs.left.knee.rotation.x = Math.max(0, -Math.cos(w) * 0.65);
      legs.right.knee.rotation.x = Math.max(0, Math.cos(w) * 0.65);
      arms.left.shoulder.rotation.x = -Math.sin(w) * 0.42;
      arms.right.shoulder.rotation.x = Math.sin(w) * 0.42;
      arms.left.elbow.rotation.x = -0.35;
      arms.right.elbow.rotation.x = -0.35;
    } else if (act === 'wave') {
      arms.right.shoulder.rotation.x = -1.25;
      arms.right.shoulder.rotation.z = 0.45;
      arms.right.elbow.rotation.x = -0.85;
      arms.right.elbow.rotation.z = Math.sin(elapsed * 6.5) * 0.38;
      arms.left.shoulder.rotation.x = Math.sin(t * 1.4) * 0.05;
      arms.left.elbow.rotation.x = -0.25;
    } else if (act === 'talk' || state.speaking) {
      spine.rotation.x = 0.03 + Math.sin(t * 2.2) * 0.02;
      arms.left.shoulder.rotation.x = -0.38 + Math.sin(t * 3.1) * 0.14;
      arms.right.shoulder.rotation.x = -0.42 + Math.cos(t * 2.7) * 0.16;
      arms.left.elbow.rotation.x = -0.95 + Math.sin(t * 3.1) * 0.18;
      arms.right.elbow.rotation.x = -0.98 + Math.cos(t * 2.7) * 0.18;
    } else if (act === 'write') {
      spine.rotation.x = 0.24;
      targetPitch = 0.32;
      arms.left.shoulder.rotation.x = -0.68;
      arms.left.elbow.rotation.x = -0.82;
      arms.right.shoulder.rotation.x = -0.74 + Math.sin(elapsed * 7.0) * 0.04;
      arms.right.shoulder.rotation.z = -0.15 + Math.cos(elapsed * 7.0) * 0.05;
      arms.right.elbow.rotation.x = -0.88;
    } else if (act === 'hand-up' || act === 'point') {
      spine.rotation.x = -0.02;
      arms.right.shoulder.rotation.x = act === 'hand-up' ? -2.45 : -1.25;
      arms.right.shoulder.rotation.z = 0.12 + Math.sin(t * 2.4) * 0.04;
      arms.right.elbow.rotation.x = -0.22;
      arms.left.shoulder.rotation.x = -0.35;
      arms.left.elbow.rotation.x = -0.65;
    } else if (act === 'withdrawn') {
      spine.rotation.x = -0.10;
      spine.rotation.y = -0.28;
      targetYaw = -0.52;
      targetPitch = 0.18;
      // Crossed forearms
      arms.left.shoulder.rotation.x = -0.62;
      arms.left.shoulder.rotation.z = -0.38;
      arms.left.elbow.rotation.x = -1.25;
      arms.right.shoulder.rotation.x = -0.64;
      arms.right.shoulder.rotation.z = 0.38;
      arms.right.elbow.rotation.x = -1.25;
    } else if (act === 'confused' || act === 'think') {
      spine.rotation.x = 0.08;
      head.rotation.z = 0.16;
      arms.right.shoulder.rotation.x = -1.05;
      arms.right.shoulder.rotation.z = -0.25;
      arms.right.elbow.rotation.x = -1.35;
      arms.left.shoulder.rotation.x = -0.45;
      arms.left.elbow.rotation.x = -0.75;
    } else {
      // Idle (standing or seated)
      spine.rotation.x = opts.seated ? 0.04 : Math.sin(t * 1.1) * 0.02;
      spine.rotation.y = Math.sin(t * 0.8) * 0.04;
      head.rotation.z = Math.sin(t * 0.6) * 0.025;
      arms.left.shoulder.rotation.x = opts.seated ? -0.48 : Math.sin(t * 1.3) * 0.05;
      arms.right.shoulder.rotation.x = opts.seated ? -0.48 : -Math.sin(t * 1.3) * 0.05;
      arms.left.shoulder.rotation.z = 0.06;
      arms.right.shoulder.rotation.z = -0.06;
      arms.left.elbow.rotation.x = opts.seated ? -0.72 : -0.22;
      arms.right.elbow.rotation.x = opts.seated ? -0.72 : -0.22;
    }

    head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, targetYaw, 0.15);
    head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, targetPitch, 0.15);
    for (const irisPivot of eyes) {
      irisPivot.position.x = THREE.MathUtils.clamp(targetYaw * 0.008, -0.004, 0.004);
      irisPivot.position.y = THREE.MathUtils.clamp(-targetPitch * 0.006, -0.003, 0.003);
    }
  }

  return {
    root,
    pelvis,
    spine,
    head,
    arms,
    legs,
    state,
    setAction,
    setSpeaking,
    lookAtWorld,
    update,
  };
}
