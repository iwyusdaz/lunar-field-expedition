/**
 * cinematic-grade.js — Per-Case Cinematic Colour Grading, Atmospheric Fog,
 * Sky Dome, Anti-Greenscreen Prop Grounding, and Full-Bleed HUD Theme Controller (v2.0.0).
 *
 * Gives each of the 7 cases its own distinct visual mood, colour theme,
 * lighting warmth, and grounded realism:
 *  - AgX tone mapping (fallback ACESFilmic) + tuned exposure per case
 *  - Procedural gradient sky dome + exponential height/distance fog
 *  - Contact-shadow + base-wear grounding under every prop and loaded GLB
 *  - CSS theme custom properties (--v2-bg, --v2-surface, --v2-accent, etc.)
 *    with guaranteed >= 4.5:1 WCAG AA text contrast
 *  - Collapsible floating HUD drawer + Plain-Font accessibility toggle
 *
 * @module v2/cinematic-grade
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getContactShadowTexture } from './stylized-character.js';

/**
 * Merge all descendant meshes of a STATIC scene group into one mesh per material.
 * Use it on architecture and set dressing (walls, floors, furniture, props) that
 * never moves — a room built from 100+ small meshes renders in ~10 draw calls
 * after merging, which is what keeps Medium inside the 300-draw-call budget.
 * Animated children (characters, particles, rings) must NOT live in this group.
 * Returns the number of source meshes merged into the group; untouched children
 * keep their transforms. Containers kept as-is (wrappers, empties, lights) lose
 * the descendants that were merged — otherwise the merged geometry would draw twice.
 */
export function mergeStaticGroup(group) {
  if (!group) return 0;
  group.updateMatrixWorld(true);
  const groupInverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMaterial = new Map();
  const animated = [];
  const mergedNodes = new Set();

  // Manual walk (instead of traverse()) so whole subtrees can opt out with
  // `userData.v2NoMerge` — animated wrappers like bobbing boats and swinging
  // pendant lamps keep their meshes, otherwise they would be merged away and
  // their oscillators would animate empty groups. Sign planes (canvas textures
  // that act as raycast/hover targets) and InstancedMeshes are kept whole too.
  const collect = (node) => {
    for (const child of node.children) {
      if (child.userData?.v2NoMerge) { animated.push(child); continue; }
      if (!child.isMesh || child.isSkinnedMesh || child.isInstancedMesh
          || child.userData?.sign || Array.isArray(child.material)) {
        animated.push(child);
      } else {
        const geom = child.geometry;
        if (!geom || (geom.morphAttributes && Object.keys(geom.morphAttributes).length)) {
          animated.push(child);
        } else {
          if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
          byMaterial.get(child.material).push(child);
        }
      }
      collect(child);
    }
  };
  collect(group);
  if (byMaterial.size === 0) return 0;

  const KEEP = ['position', 'normal', 'uv'];
  let mergedCount = 0;
  const mergedRoot = new THREE.Group();
  mergedRoot.name = `${group.name || 'static'}-merged`;
  for (const [material, nodes] of byMaterial) {
    const geos = nodes.map((mesh) => {
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(groupInverse, mesh.matrixWorld));
      for (const name of Object.keys(g.attributes)) {
        if (!KEEP.includes(name)) g.deleteAttribute(name);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      return g;
    });
    for (const name of [...KEEP]) {
      if (!geos.every((g) => g.attributes[name])) {
        for (const g of geos) g.deleteAttribute(name);
      }
    }
    let merged;
    try {
      merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
    } catch {
      animated.push(...nodes);
      continue;
    }
    if (!merged) { animated.push(...nodes); continue; }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `merged-${material.uuid.slice(0, 8)}`;
    mesh.castShadow = nodes.some((n) => n.castShadow);
    mesh.receiveShadow = true;
    mergedRoot.add(mesh);
    for (const n of nodes) mergedNodes.add(n);
    mergedCount += nodes.length;
  }
  for (const node of animated) {
    // Containers kept as-is (prop wrappers, empties, lights) must NOT keep the
    // descendants we just merged: their geometry already lives in the merged
    // meshes, so leaving the originals attached would draw everything twice.
    const drop = [];
    node.traverse((d) => { if (d !== node && mergedNodes.has(d)) drop.push(d); });
    for (const d of drop) d.removeFromParent();
    node.updateMatrixWorld(true);
    const relative = new THREE.Matrix4().multiplyMatrices(groupInverse, node.matrixWorld);
    node.matrix.copy(relative);
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    node.matrixWorldNeedsUpdate = true;
    mergedRoot.add(node);
  }
  group.clear();
  group.add(mergedRoot);
  return mergedCount;
}

export const CASE_THEMES = {
  'lunar-field-expedition': {
    name: 'Hasselblad at Hadley',
    skyZenith: 0x030407,
    skyHorizon: 0x0b0e14,
    skyGround: 0x1a1917,
    fogColor: 0x0c0d10,
    fogDensity: 0.00018,
    exposure: 1.18,
    hemiSky: 0xd8e2f0,
    hemiGround: 0x3b3834,
    hemiIntensity: 0.28,
    css: {
      '--v2-surface': 'rgba(14, 17, 23, 0.88)',
      '--v2-surface-solid': '#0e1117',
      '--v2-text': '#f2ede4',
      '--v2-muted': '#b8b2a8',
      '--v2-accent': '#e87722',
      '--v2-accent-strong': '#c45d0e',
      '--v2-border': 'rgba(232, 119, 34, 0.42)',
      '--v2-badge-bg': '#241a12',
    },
  },
  'object-detective': {
    name: 'The Lantern Museum After Hours',
    skyZenith: 0x0f1624,
    skyHorizon: 0x1f2b3e,
    skyGround: 0x17120e,
    fogColor: 0x161d29,
    fogDensity: 0.022,
    exposure: 1.12,
    hemiSky: 0xffd79e,
    hemiGround: 0x261d18,
    hemiIntensity: 0.45,
    css: {
      '--v2-surface': 'rgba(24, 19, 17, 0.90)',
      '--v2-surface-solid': '#181311',
      '--v2-text': '#f7efe2',
      '--v2-muted': '#d1c2ab',
      '--v2-accent': '#f2b25c',
      '--v2-accent-strong': '#8c2d35',
      '--v2-border': 'rgba(242, 178, 92, 0.42)',
      '--v2-badge-bg': '#2c1f18',
    },
  },
  'field-ecologist': {
    name: 'Ashcombe Meadow at Dawn',
    skyZenith: 0x5c88b5,
    skyHorizon: 0xf6c28b,
    skyGround: 0x3f5930,
    fogColor: 0xd8ccb8,
    fogDensity: 0.009,
    exposure: 1.15,
    hemiSky: 0xffe4b8,
    hemiGround: 0x4a6335,
    hemiIntensity: 0.65,
    css: {
      '--v2-surface': 'rgba(250, 246, 236, 0.92)',
      '--v2-surface-solid': '#faf6ec',
      '--v2-text': '#1f291a',
      '--v2-muted': '#4a5742',
      '--v2-accent': '#3d6b2c',
      '--v2-accent-strong': '#2d5220',
      '--v2-border': 'rgba(61, 107, 44, 0.38)',
      '--v2-badge-bg': '#e7efe0',
    },
  },
  'hazard-hunt': {
    name: 'Northwind Logistics, Bay 4',
    skyZenith: 0x16202b,
    skyHorizon: 0x2b3947,
    skyGround: 0x1c2024,
    fogColor: 0x222c36,
    fogDensity: 0.014,
    exposure: 1.16,
    hemiSky: 0xdcebf7,
    hemiGround: 0x383c40,
    hemiIntensity: 0.58,
    css: {
      '--v2-surface': 'rgba(18, 24, 31, 0.90)',
      '--v2-surface-solid': '#12181f',
      '--v2-text': '#f3f6f8',
      '--v2-muted': '#b8c4ce',
      '--v2-accent': '#ffd100',
      '--v2-accent-strong': '#b84300',
      '--v2-border': 'rgba(255, 209, 0, 0.45)',
      '--v2-badge-bg': '#262210',
    },
  },
  'arrival-english': {
    name: 'Harbour City Golden Hour',
    skyZenith: 0x2c6ca0,
    skyHorizon: 0xf5b882,
    skyGround: 0x3b424c,
    fogColor: 0xe6cbb2,
    fogDensity: 0.012,
    exposure: 1.15,
    hemiSky: 0xffe6c7,
    hemiGround: 0x454d59,
    hemiIntensity: 0.65,
    css: {
      '--v2-surface': 'rgba(252, 246, 236, 0.93)',
      '--v2-surface-solid': '#fcf6ec',
      '--v2-text': '#18222c',
      '--v2-muted': '#465462',
      '--v2-accent': '#166969',
      '--v2-accent-strong': '#105252',
      '--v2-border': 'rgba(22, 105, 105, 0.36)',
      '--v2-badge-bg': '#e2f0ee',
    },
  },
  'glacier-time-machine': {
    name: 'Muir Inlet Then and Now',
    skyZenith: 0x3c668c,
    skyHorizon: 0xc2d8e8,
    skyGround: 0x2d3c47,
    fogColor: 0xb8cfe0,
    fogDensity: 0.00009,
    exposure: 1.12,
    hemiSky: 0xdff0ff,
    hemiGround: 0x3a4752,
    hemiIntensity: 0.62,
    css: {
      '--v2-surface': 'rgba(15, 25, 36, 0.90)',
      '--v2-surface-solid': '#0f1924',
      '--v2-text': '#edf5fa',
      '--v2-muted': '#b2c7d6',
      '--v2-accent': '#7fb7d6',
      '--v2-accent-strong': '#1f5a7a',
      '--v2-border': 'rgba(127, 183, 214, 0.42)',
      '--v2-badge-bg': '#162938',
    },
  },
  'first-session-tutor-sim': {
    name: 'Room 12, Tuesday 3:30 pm',
    skyZenith: 0x4a82b8,
    skyHorizon: 0xf7d29c,
    skyGround: 0x4b5c43,
    fogColor: 0xefe3ce,
    fogDensity: 0.015,
    exposure: 1.14,
    hemiSky: 0xffe4b5,
    hemiGround: 0x4d4337,
    hemiIntensity: 0.62,
    css: {
      '--v2-surface': 'rgba(251, 246, 236, 0.93)',
      '--v2-surface-solid': '#fbf6ec',
      '--v2-text': '#1c2621',
      '--v2-muted': '#495950',
      '--v2-accent': '#23473b',
      '--v2-accent-strong': '#1b382e',
      '--v2-border': 'rgba(35, 71, 59, 0.36)',
      '--v2-badge-bg': '#e4ede9',
    },
  },
};

/**
 * Apply the case's colour grade, tone mapping, atmospheric fog, sky dome, and CSS variables.
 * @param {string} slug
 * @param {object} ctx
 * @param {THREE.WebGLRenderer} [ctx.renderer]
 * @param {THREE.Scene} [ctx.scene]
 * @param {boolean} [ctx.addSkyDome=true]
 * @param {number} [ctx.skyRadius=900]
 */
export function applyCaseGrade(slug, ctx = {}) {
  const theme = CASE_THEMES[slug] || CASE_THEMES['hazard-hunt'];

  if (typeof document !== 'undefined') {
    const rootEl = document.documentElement;
    rootEl.dataset.caseTheme = slug;
    for (const [k, v] of Object.entries(theme.css)) {
      rootEl.style.setProperty(k, v);
    }
  }

  if (ctx.renderer) {
    ctx.renderer.toneMapping = THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping;
    ctx.renderer.toneMappingExposure = theme.exposure;
  }

  if (ctx.scene) {
    if (theme.fogDensity > 0 && !ctx.scene.fog) {
      ctx.scene.fog = new THREE.FogExp2(theme.fogColor, theme.fogDensity);
    }
    if (ctx.addSkyDome !== false && !ctx.scene.getObjectByName('v2-sky-dome')) {
      const dome = createGradientSkyDome({
        zenithColor: theme.skyZenith,
        horizonColor: theme.skyHorizon,
        groundColor: theme.skyGround,
        radius: ctx.skyRadius ?? 900,
      });
      ctx.scene.add(dome);
    }
  }

  return theme;
}

/**
 * Create a smooth gradient sky sphere so windows and horizons never show a flat void.
 */
export function createGradientSkyDome(opts = {}) {
  const radius = opts.radius ?? 900;
  const geo = new THREE.SphereGeometry(radius, 32, 24);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const cZenith = new THREE.Color(opts.zenithColor ?? 0x2c6ca0);
  const cHorizon = new THREE.Color(opts.horizonColor ?? 0xf5b882);
  const cGround = new THREE.Color(opts.groundColor ?? 0x2b3036);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;
    if (y >= 0) {
      tmp.copy(cHorizon).lerp(cZenith, Math.pow(y, 0.55));
    } else {
      tmp.copy(cHorizon).lerp(cGround, Math.min(1, Math.pow(-y, 0.45)));
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'v2-sky-dome';
  mesh.renderOrder = -10;
  return mesh;
}

/**
 * Ground a 3D prop or loaded GLB model so it blends naturally with the environment
 * (enables shadows, envMapIntensity, and attaches a soft contact-shadow disc at its base).
 */
export function groundProp(object3d, opts = {}) {
  if (!object3d) return object3d;
  // Small props rely on their contact-shadow disc for grounding; reserving
  // real shadow casting for large props keeps the shadow pass cheap.
  let castsShadows = opts.castShadow !== false;
  if (castsShadows && opts.minShadowSize) {
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(object3d).getSize(size);
    castsShadows = Math.max(size.x, size.y, size.z) >= opts.minShadowSize;
  }
  object3d.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = castsShadows;
      c.receiveShadow = opts.receiveShadow !== false;
      if (c.material && 'envMapIntensity' in c.material) {
        c.material.envMapIntensity = opts.envMapIntensity ?? 1.15;
      }
    }
  });

  if (opts.contactShadow !== false) {
    const box = new THREE.Box3().setFromObject(object3d);
    const size = new THREE.Vector3();
    box.getSize(size);
    const rx = Math.max(0.22, Math.min(3.5, size.x * 0.62));
    const rz = Math.max(0.22, Math.min(3.5, size.z * 0.62));
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(rx, rz),
      new THREE.MeshBasicMaterial({
        map: getContactShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: opts.shadowOpacity ?? 0.62,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.006;
    shadow.name = 'v2-contact-shadow';
    object3d.add(shadow);
  }
  return object3d;
}

/** Task panels the HUD drawer collapses (matches the selectors in hud-shell.css). */
const DRAWER_SELECTORS = '#task-panel, #panel, #session-panel, .course-panel, .dlg-panel, #overlays > section, #overlays > .panel';

/**
 * Wire the v2 Full-Bleed Collapsible HUD Drawer and Plain-Font Accessibility Toggle.
 */
export function initFloatingHud(opts = {}) {
  if (typeof document === 'undefined') return {};
  const slug = opts.slug || 'app';
  const nav = document.querySelector('.app-header nav');
  const panel = opts.panel || document.querySelector('#task-panel, #panel, #session-panel, .fieldwork-panel, #overlays');

  // Restore saved plain-font preference
  try {
    if (localStorage.getItem(`${slug}:plain-font`) === 'on') {
      document.documentElement.dataset.plainFont = 'on';
    }
  } catch { /* ignore */ }

  if (nav && !nav.querySelector('[data-action="toggle-drawer"]')) {
    const drawerBtn = document.createElement('button');
    drawerBtn.type = 'button';
    drawerBtn.dataset.action = 'toggle-drawer';
    drawerBtn.setAttribute('aria-expanded', 'true');
    drawerBtn.textContent = 'Hide panel';
    drawerBtn.addEventListener('click', () => {
      const collapsed = document.documentElement.dataset.drawerCollapsed === 'true';
      document.documentElement.dataset.drawerCollapsed = collapsed ? 'false' : 'true';
      drawerBtn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
      drawerBtn.textContent = collapsed ? 'Hide panel' : 'Show panel';
      // A collapsed drawer is visually gone, so its controls must leave the tab
      // order and the accessibility tree too (WCAG 2.4.3 / 1.3.1).
      const targets = new Set(document.querySelectorAll(DRAWER_SELECTORS));
      if (opts.panel) targets.add(opts.panel);
      for (const el of targets) {
        el.toggleAttribute('inert', !collapsed);
        if (!collapsed) el.setAttribute('aria-hidden', 'true');
        else el.removeAttribute('aria-hidden');
      }
      opts.onDrawerChange?.(!collapsed);
    });
    nav.insertBefore(drawerBtn, nav.firstChild);

    const fontBtn = document.createElement('button');
    fontBtn.type = 'button';
    fontBtn.dataset.action = 'plain-font';
    const isPlain = document.documentElement.dataset.plainFont === 'on';
    fontBtn.setAttribute('aria-pressed', isPlain ? 'true' : 'false');
    fontBtn.textContent = 'Plain font';
    fontBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.plainFont === 'on' ? 'off' : 'on';
      document.documentElement.dataset.plainFont = next;
      fontBtn.setAttribute('aria-pressed', next === 'on' ? 'true' : 'false');
      try { localStorage.setItem(`${slug}:plain-font`, next); } catch { /* ignore */ }
    });
    nav.insertBefore(fontBtn, drawerBtn.nextSibling);
  }

  return { panel };
}
