/**
 * surface.js — the v3 Hadley–Apennine surface scene (plan 10 §6.1).
 *
 * Real terrain at true scale (streamed 3D Tiles, terrain-v3.js), the airless
 * sky (sky.js), the field team's site around the LM (fictional mission:
 * LM descent stage, rover, flag, two suited geologists, ALSEP instruments,
 * boulders, bootprints and rover tracks) and invisible pick volumes for the
 * landforms, so every catalog object can be clicked.
 *
 * World frame is the v2 one (+x east, +y up in LROC datum metres, +z south),
 * so the module tools, crater patches, stations and cinematics keep their data.
 *
 * Motion systems (plan §5; every one accurate or labelled on its card):
 *   sky:          sun time-lapse (shadows sweep), Earth spin + clouds (time-lapse),
 *                 orbiter pass (time-compressed)
 *   environment:  rover dust (ballistic), micrometeoroid flashes (illustrative
 *                 frequency), bootstep dust (ballistic)
 *   agents:       rover drive loop, geologist sampling, geologist loping walk
 *   objects:      rover TV camera panning, sample bag swinging at lunar gravity
 * @module lunar/surface
 */
import * as THREE from 'three';
import { TerrainField } from '../scenes/terrain.js';
import { createDustBurst } from '../scenes/hadley-props.js';
import { buildLunarModuleV3, buildRoverV3 } from '../scenes/hadley-hardware.js';
import { createSun } from '../v3/render-chain.js';
import { createGlint } from '../v3/inspect.js';
import { StreamedTerrain, loadRegolithTextures } from './terrain-v3.js';
import { LunarSky, SKY_RADIUS, glowTexture } from './sky.js';
import { createAstronaut } from './astronaut.js';
import { loadGLB, loadKTX2 } from './loaders.js';
import { hourAngleForElevation, curvatureDrop, LUNAR_G, SITE } from './frame.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const REGOLITH_SPOT = [1.2, 5.9]; // bare soil just west of the bootprints (m east, south of the LM)
const LAPSE_DEG_PER_S = 0.5; // sun time-lapse: about one lunar hour per second
const LAPSE_SPAN_DEG = 22;   // then the time-lapse loops back (about 43 hours of lunar morning)
// Landform and ground cards: the Sun angle (deg) that shows each one. Low for
// small relief (craters, prints, soil); higher for big slopes, whose
// sun-facing sides would otherwise sit in shadow in the early morning.
const CARD_SUN = { 'craterlets': 9, 'dune-crater': 9, 'mare-plain': 9, 'footprints': 9, 'rover-tracks': 9, 'regolith': 9, 'spur-crater': 12,
  'elbow-crater': 12, 'st-george-crater': 15, 'mount-hadley': 35, 'hadley-delta': 35, 'apennine-front': 35 };

/** Invisible pick volume (raycast still works; nothing is drawn). */
function pickMaterial() { const m = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }); m.userData.pickVolume = true; return m; }

export class SurfaceScene {
  /** @param {object} app  the v3 app (engine, inspect, motion, catalog) */
  /**
   * @param {object} app
   * @param {{ stations: object[], craters: object }} content  content/stations.json stations, content/craters.json
   */
  constructor(app, content) {
    this.app = app;
    this.stations = Object.fromEntries(content.stations.map((s) => [s.id, s]));
    this.craterPatches = Object.fromEntries(content.craters.patches.map((p) => [p.id, { ...p.center, radiusM: p.radiusM }]));
    this.active = false;
    this.engine = app.engine;
    this.group = new THREE.Group();
    this.group.name = 'hadley-surface';
    this.terrain = new TerrainField(); // v2 CPU heightfield (tools, text mode, fallback ground)
    this.markers = new Map();
    this.registered = [];
    this.sunHold = false;
    this.sunBaseElevation = 12;
    this.lapse = 0;
    this.started = false;
  }

  /** @param {Promise<TerrainField>} [terrainReady]  a heightfield already loading (shared with the lessons) */
  async load(terrainReady) {
    if (terrainReady) this.terrain = await terrainReady;
    else await this.terrain.load('medium', { mesh: false });
    const lm = this.terrain.fromLonLat(SITE.lon, SITE.lat);
    this.lm = V(lm.xM, this.terrain.elevationAt(lm.xM, lm.yM), lm.yM);
    return this;
  }

  /** Ground under (x, z): finest streamed tile, else the v2 heightfield minus curvature. */
  groundY(x, z) {
    const y = this.streamed ? this.streamed.heightAt(x, z) : NaN;
    if (Number.isFinite(y)) return y;
    const f = this.terrain.elevationAt(x, z);
    return Number.isFinite(f) ? f - curvatureDrop(Math.hypot(x - this.lm.x, z - this.lm.z)) : this.lm.y;
  }

  /** Ground under (x, z), bilinear on exact 0.5 m samples: what feet stand on (G2 fix). */
  groundFine(x, z) {
    const y = this.streamed ? this.streamed.heightSmooth(x, z) : NaN;
    return Number.isFinite(y) ? y : this.groundY(x, z);
  }
  /** World position from lon/lat at ground height (+ lift). */
  at(lon, lat, lift = 0) { const p = this.terrain.fromLonLat(lon, lat); return V(p.xM, this.groundY(p.xM, p.yM) + lift, p.yM); }
  /** World position from metres east/south of the LM. */
  rel(dx, dz, lift = 0) { const x = this.lm.x + dx, z = this.lm.z + dz; return V(x, this.groundY(x, z) + lift, z); }

  async build() {
    const { engine } = this;
    const r = engine.renderer;
    this.engine.scene.add(this.group);
    // Lights: the Sun (cascaded shadows on Medium and up) and a faint fill for
    // earthshine and light scattered off the regolith.
    this._makeSun();
    this.fill = new THREE.HemisphereLight(0x8a93a5, 0x2c2c30, 0.1);
    this.group.add(this.fill);
    this.environment = lunarEnvironment(r);
    engine.quality.onChange(() => this._makeSun());
    // Sky
    this.sky = new LunarSky(r);
    this.group.add(this.sky.shell);
    await this.sky.load();
    // Streamed terrain (starts on the first interaction)
    this.streamed = new StreamedTerrain({ camera: engine.camera, renderer: r, lm: this.lm, fallbackHeight: (x, z) => this.terrain.elevationAt(x, z) });
    this.group.add(this.streamed.group);
    let settleT = null;
    this.streamed.onSettle = () => { clearTimeout(settleT); settleT = setTimeout(() => this.groundAll(), 250); };
    this._buildSite();
    this.applyEnvironment();
    this._buildProxies();
    this.setSunElevation(this.sunBaseElevation);
    window.addEventListener('resize', () => this.streamed.resize());
    // While a card is open, the motion systems that move its object pause (the
    // template's card hold, motion-layers.js): the Sun stays in its telephoto
    // frame, the rover and the walking geologist stay beside their cards.
    // A station crater's card shows its Apollo 15 station flag; the impact
    // card shows a flash in its framed spot soon after it opens.
    // Hadley Delta's card shows the Station 2 flag at St. George crater on its flank (review pass 2 F7).
    // The Genesis Rock's card shows the Station 7 flag beside it (review F6).
    const STATION_OF = { 'spur-crater': 'spur', 'genesis-rock': 'spur', 'dune-crater': 'dune', 'elbow-crater': 'elbow', 'st-george-crater': 'stgeorge', 'hadley-delta': 'stgeorge' };
    this.app.inspect?.on('open', (id) => {
      this.removeMarker('card-station');
      const sid = STATION_OF[id];
      if (sid) {
        const p = this.terrain.fromLonLat(this.stations[sid].lon, this.stations[sid].lat);
        const m = this.addMarker('card-station', p.xM, p.yM, this.stations[sid].apolloStation || '', '#ffffff');
        m.userData.marker = { label: 'Station survey flag' };
      }
      this._flashSoon = id === 'micrometeoroid-flash' ? 0.9 : null;
      // Landform and ground cards: the time-lapse moves to the Sun angle that
      // shows the landform (CARD_SUN); the Sun's card says so.
      const want = CARD_SUN[id] && !this.sunHold ? CARD_SUN[id] : 0;
      if (want && !this._sunBefore) this._sunBefore = { base: this.sunBaseElevation, lapse: this.lapse };
      if (!want) this._restoreSun();
      this._lowSun = want;
      if (this._lowSun && this.app.motionPrefs?.reduced) this.setSunElevation(this._lowSun);
    });
    this.app.inspect?.on('close', () => { this.removeMarker('card-station'); this._flashSoon = null; this._lowSun = 0; this._restoreSun(); });
    return this;
  }

  /** After a landform card: the time-lapse carries on from where it was before the card. */
  _restoreSun() {
    const b = this._sunBefore;
    if (!b) return;
    this._sunBefore = null;
    this.sunBaseElevation = b.base; this.lapse = b.lapse;
    this._applySun();
  }

  /** Start streaming the terrain and the detail textures and models (first interaction). */
  async startStreaming() {
    if (this.started) return;
    this.started = true;
    this.streamed.start();
    const r = this.engine.renderer;
    loadRegolithTextures(r, this.streamed.material).catch((e) => console.warn('regolith detail not loaded:', e.message));
    await Promise.all([this._loadModels(), this._loadDecals()]).catch((e) => console.warn('site models not loaded:', e.message));
    this.applyEnvironment();
    this.groundAll();
  }

  _makeSun() {
    const preset = this.engine.quality.presetDef;
    const want = preset.shadowMapSize > 0 && preset.features.cascades ? 'cascades' : preset.shadowMapSize > 0 ? 'single' : 'none';
    if (this._sunKind === want && this.sun) return;
    if (this.sun) { this.group.remove(this.sun); this.sun.dispose?.(); }
    this.sun = createSun(preset, { large: true, far: 3000, intensity: 3.2, color: 0xffffff });
    if (this.sun.isSunLight) { this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.4; }
    else if (this.sun.castShadow) {
      const c = this.sun.shadow.camera; c.left = -600; c.right = 600; c.top = 600; c.bottom = -600; c.near = 1; c.far = 9000; c.updateProjectionMatrix();
      this.sun.shadow.normalBias = 2;
      this.group.add(this.sun.target);
    }
    this._sunKind = want;
    this.group.add(this.sun);
    if (this.sky) this._placeSun();
  }

  _placeSun() {
    const d = this.sky.sunDir;
    if (this.sun.isSunLight) this.sun.position.copy(d);
    else { const t = this._focus || this.lm; this.sun.position.copy(t).addScaledVector(d, 4000); this.sun.target.position.copy(t); }
    this.sun.intensity = d.y > 0 ? 3.2 * THREE.MathUtils.smoothstep(d.y, -0.01, 0.03) : 0;
  }

  /** Sun elevation (deg, morning branch). The time-lapse runs from here unless held. */
  setSunElevation(e) {
    this.sunBaseElevation = e;
    this.lapse = 0;
    this._applySun();
  }
  get sunElevation() { return this.sky.sunElevationDeg; }
  _applySun() {
    this.sky.setHourAngle(hourAngleForElevation(this.sunBaseElevation) - this.lapse);
    this._placeSun();
    this.app.onSun?.(this.sky.sunElevationDeg);
  }

  // ------------------------------------------------------------------ site
  _buildSite() {
    const g = this.group;
    const lm = buildLunarModuleV3();
    lm.position.copy(this.rel(0, 0, -0.05));
    this.lmProp = lm; g.add(lm);
    const flag = buildFlagV3();
    flag.position.copy(this.rel(-9, 8, -0.25));
    this.flag = flag; g.add(flag);
    const rover = buildRoverV3();
    this.rover = rover.group; this.roverWheels = rover.wheels; this.roverChassis = rover.chassis;
    this.tvCam = this._buildTvCamera();
    rover.lcru.add(this.tvCam);
    g.add(this.rover);
    // Field crew (fictional field team): A samples a boulder, B lopes between the LM, flag and ALSEP.
    // Each figure stands on the streamed ground under its feet every frame (G2 fix: crew A
    // was placed once at build time on the v2 heightfield, 0.37 m below the tiles).
    const ground = (x, z) => this.groundFine(x, z);
    this.crewA = createAstronaut({ name: 'crew-a', commander: true, phase: 0, tongs: true, ground });
    this.crewB = createAstronaut({ name: 'crew-b', phase: 3, ground });
    this.crew = new THREE.Group(); this.crew.name = 'field-crew';
    this.crew.add(this.crewA.root, this.crewB.root);
    g.add(this.crew);
    this.crewA.root.position.copy(this.rel(6.4, 4.2));
    this.crewA.root.rotation.y = -2.4;
    this.crewA.setAction('sample');
    this.crewB.setAction('lope');
    // Dust: rover wheels and bootsteps, one draw call each, ballistic at 1.62 m/s^2.
    this.roverDust = createDustBurst(220);
    this.bootDust = createDustBurst(120);
    g.add(this.roverDust.points, this.bootDust.points);
    // Micrometeoroid flash and its dust puff.
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)'), transparent: true, depthWrite: false, opacity: 0 }));
    this.flash.scale.setScalar(6);
    this.flash.userData.noOutline = true;
    this.flash.raycast = () => {};
    this.puff = createDustBurst(90);
    this.puff.points.material.size = 0.9;
    g.add(this.flash, this.puff.points);
    this.grounded = [
      { obj: lm, dx: 0, dz: 0, sink: 0.05 }, { obj: flag, dx: -9, dz: 8, sink: 0.2 },
    ];
  }

  /** The rover's ground-commanded TV camera (it panned under control from Earth). */
  _buildTvCamera() {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const x = c.getContext('2d'); x.fillStyle = '#d9d7d0'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#2b2d31'; x.fillRect(4, 10, 24, 12);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.3 });
    const head = new THREE.Group(); head.name = 'tv-camera';
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.28), mat);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.08, 12), mat);
    lens.rotation.x = Math.PI / 2; lens.position.z = 0.17;
    head.add(body, lens);
    head.position.set(0, 1.12, 0.95);
    for (const m of [body, lens]) m.castShadow = true;
    return head;
  }

  async _loadModels() {
    const r = this.engine.renderer;
    const [alsep, ...rocks] = await Promise.all([
      loadGLB(r, 'assets/v3/models/alsep-set.glb'),
      ...[4, 5, 6, 7].map((n) => loadGLB(r, `assets/v3/models/moon-rock-0${n}.glb`)),
    ]);
    const node = (id) => alsep.scene.getObjectByName(id);
    // ALSEP, about 110 m west-north-west of the LM as on Apollo 15; the instruments
    // spread around the central station (layout simplified to fit one view).
    const C = [-104, -38];
    const place = [
      ['alsep-central-station', 0, 0, 0], ['rtg', 3.2, 1.6, 0], ['alsep-seismometer', -4.2, 2.6, 0],
      ['alsep-magnetometer', 2.5, -4.4, 0], ['alsep-heat-flow', -2.4, -3.8, Math.PI / 2], ['alsep-retroreflector', 6.0, -1.2, 0],
    ];
    this.alsep = {};
    for (const [id, dx, dz, ry] of place) {
      const src = node(id);
      if (!src) { console.warn(`ALSEP part ${id} missing`); continue; }
      const o = src.clone(true);
      o.position.set(0, 0, 0); o.rotation.set(0, ry, 0);
      const grp = new THREE.Group(); grp.name = id; grp.add(o);
      grp.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      this.group.add(grp);
      this.alsep[id] = grp;
      this.grounded.push({ obj: grp, dx: C[0] + dx, dz: C[1] + dz, sink: 0 });
    }
    this.alsepCenter = C;
    this._cableMat = new THREE.MeshStandardMaterial({ color: 0xcfcac0, metalness: 0.45, roughness: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    this._cableMat.userData.surfaceDetail = true;
    const skirt = node('pse-skirt');
    if (skirt) { const s = skirt.clone(true); s.position.set(0, 0, 0); this.group.add(s); this.grounded.push({ obj: s, dx: C[0] - 4.2, dz: C[1] + 2.6, sink: -0.005 }); }
    const bagSrc = node('sample-bag');
    if (bagSrc) {
      const b = new THREE.Group(); b.name = 'sample-bag'; const m = bagSrc.clone(true); m.position.set(0, 0, 0); b.add(m);
      this.group.add(b); this.sampleBag = b; this.grounded.push({ obj: b, dx: 4.6, dz: 2.6, sink: -0.002, rotY: 0 });
    }
    // Boulders: Poly Haven CC0 scans of hand-sized rocks, scaled up (illustrative sizes).
    this.boulders = [];
    const rng = mulberry(1971);
    const spec = [[1, 1.6, 1.2, 2.0, 17, -15, 0]];
    for (let i = 0; i < 13; i++) {
      const a = rng() * Math.PI * 2, d = 12 + rng() * 55;
      const dx = Math.cos(a) * d, dz = Math.sin(a) * d;
      if (Math.hypot(dx - 22, dz) < 13 || Math.hypot(dx + 6, dz - 12) < 5) continue;
      const s = 0.3 + rng() ** 2 * 1.3;
      spec.push([i % 4, s * (0.8 + rng() * 0.4), s * 0.7, s * (0.8 + rng() * 0.5), dx, dz, rng() * Math.PI * 2]);
    }
    // The first boulder is its own mesh (the catalog's reference size); the rest
    // are one instanced mesh per scan, re-grounded with the site (fewer draw calls).
    const meshOf = (k) => { let m = null; rocks[k].scene.traverse((c) => { if (!m && c.isMesh) m = c; }); return m; };
    const inst = new Map();
    spec.forEach(([k, sx, sy, sz, dx, dz, ry], j) => {
      const src = meshOf(k);
      src.geometry.computeBoundingBox();
      const size = src.geometry.boundingBox.getSize(V());
      const sc = V(sx / size.x, sy / size.y, sz / size.z);
      if (j === 0) {
        const o = new THREE.Mesh(src.geometry, src.material);
        o.scale.copy(sc); o.position.y = -src.geometry.boundingBox.min.y * sc.y;
        const wrap = new THREE.Group(); wrap.name = 'boulder'; wrap.add(o);
        o.castShadow = true; o.receiveShadow = true;
        this.group.add(wrap); this.boulders.push(wrap);
        this.grounded.push({ obj: wrap, dx, dz, sink: sy * 0.15 });
        return;
      }
      if (!inst.has(k)) inst.set(k, { src, items: [] });
      inst.get(k).items.push({ sc, dx, dz, ry, sink: sy * 0.15, lift: -src.geometry.boundingBox.min.y * sc.y });
    });
    this.boulderSets = [];
    for (const { src, items } of inst.values()) {
      const im = new THREE.InstancedMesh(src.geometry, src.material, items.length);
      im.name = 'boulders-instanced'; im.castShadow = true; im.receiveShadow = true;
      im.userData.items = items;
      this.group.add(im);
      this.boulderSets.push(im);
    }
    // Pebbles (3-15 cm) scattered round the site and thicker on the regolith
    // patch: low-poly stones with the scans' materials, one instanced mesh per
    // scan, no shadow casting (illustrative sizes and spacing).
    const prng = mulberry(4242);
    const pebbleGeo = (() => { const g = new THREE.IcosahedronGeometry(0.5, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.75 + 0.4 * prng(); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); } g.computeVertexNormals(); g.computeBoundingBox(); return g; })();
    const pebbles = [[]]; // one instanced mesh (one draw call) with the first scan's material
    for (let i = 0; i < 420; i++) {
      const a = prng() * Math.PI * 2, d = 3 + Math.sqrt(prng()) * 36;
      const dx = Math.cos(a) * d, dz = Math.sin(a) * d;
      if (Math.hypot(dx, dz) < 5.2) continue; // not under the LM
      if (Math.hypot(dx - REGOLITH_SPOT[0], dz - REGOLITH_SPOT[1]) < 2.2) continue; // the regolith card shows bare soil
      const sz = 0.03 + prng() ** 2.2 * 0.12;
      pebbles[0].push({ sc: V(sz, sz, sz), dx, dz, ry: prng() * 6.28, sink: sz * 0.25, lift: sz * 0.35 });
    }
    pebbles.forEach((items, k) => {
      const im = new THREE.InstancedMesh(pebbleGeo, meshOf(k).material, items.length);
      im.name = 'pebbles-instanced'; im.castShadow = false; im.receiveShadow = true;
      im.userData.items = items;
      this.group.add(im);
      this.boulderSets.push(im);
    });
    // The Genesis Rock (reconstructed shape), on the rim of Spur crater (Station 7).
    const gen = await loadGLB(r, 'assets/v3/models/genesis-rock-reconstructed.glb');
    const gr = new THREE.Group(); gr.name = 'genesis-rock';
    const go = gen.scene; const gb = new THREE.Box3().setFromObject(go); go.position.y = -gb.min.y; gr.add(go);
    gr.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.group.add(gr);
    this.genesis = gr;
    // On the rim at Station 7 (where the crew stopped): 0.5 m from the station point
    // toward the bowl, so the station flag stands just behind it (review F6).
    const sp = this.terrain.fromLonLat(this.stations.spur.lon, this.stations.spur.lat);
    const sb = this._findBowl(this.stations.spur, 80), sl = Math.hypot(sb.x - sp.xM, sb.z - sp.yM) || 1;
    const su = [(sb.x - sp.xM) / sl, (sb.z - sp.yM) / sl];
    this.genesisAt = { x: sp.xM + su[0] * 0.5 - su[1] * 0.18, z: sp.yM + su[1] * 0.5 + su[0] * 0.18, toBowl: su };
    this.grounded.push({ obj: gr, x: this.genesisAt.x, z: this.genesisAt.z, sink: 0.012 });
    this._registerModels();
  }

  async _loadDecals() {
    const r = this.engine.renderer;
    const [ba, bn] = await Promise.all([
      loadKTX2(r, 'assets/v3/decals/bootprints-albedo.ktx2'), loadKTX2(r, 'assets/v3/decals/bootprints-normal.ktx2', { srgb: false }),
    ]);
    // Rover tracks: both wheel tracks drawn here (the Poly Haven strip held a single track).
    const { map: ta, normalMap: tn, alphaMap: tAlpha } = roverTrackTextures();
    const edge = edgeMask();
    // A thin slab 2 cm deep (the depth of the prints): only its top face draws the decal.
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const mk = (w, l, map, nrm, rep = 1, alpha = edge) => {
      if (rep > 1) { map.repeat.set(1, rep); nrm.repeat.set(1, rep); }
      // The scans are brighter than this regolith: tone them down so the prints read as disturbed soil, not a mat.
      const top = new THREE.MeshStandardMaterial({ map, normalMap: nrm, alphaMap: alpha, color: 0x8a8782, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, l), [hidden, hidden, top, hidden, hidden, hidden]);
      m.position.y = -0.008; m.receiveShadow = true; m.renderOrder = 1;
      const grp = new THREE.Group(); grp.add(m); return grp;
    };
    this.footprints = mk(1.55, 3.1, ba, bn); this.footprints.name = 'bootprints';
    this.tracks = mk(2.06, 10, ta, tn, 1, tAlpha); this.tracks.name = 'rover-tracks';
    this.group.add(this.footprints, this.tracks);
    this.grounded.push({ obj: this.footprints, dx: 3.2, dz: 5.6, sink: -0.01 }, { obj: this.tracks, dx: 24, dz: -16, sink: -0.01 }); // leading north out of the rover's loop
    this._registerModels();
  }

  /**
   * Reflections for the hardware only (metal, foil, suits). The regolith does not
   * get the environment: it would pay for image-based lighting on every terrain
   * pixel for a reflection of a black sky.
   */
  applyEnvironment() {
    const roots = [this.lmProp, this.rover, this.flag, this.crew, this.genesis, this.sampleBag, ...Object.values(this.alsep || {}), ...(this.boulders || []), ...(this.boulderSets || [])];
    for (const r of roots) r?.traverse((m) => { for (const mat of [m.material].flat()) if (mat?.isMeshStandardMaterial && !mat.envMap) { mat.envMap = this.environment; mat.needsUpdate = true; } });
  }

  /** Re-ground every placed object on the best ground we have now. */
  groundAll() {
    for (const it of this.grounded) {
      const x = it.x ?? this.lm.x + it.dx, z = it.z ?? this.lm.z + it.dz;
      it.obj.position.set(x, this.groundY(x, z) - (it.sink || 0), z);
    }
    if (this.sampleBag) this.sampleBag.position.y += 0.026;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V(0, 1, 0);
    for (const im of this.boulderSets || []) {
      im.userData.items.forEach((it, i) => {
        const x = this.lm.x + it.dx, z = this.lm.z + it.dz;
        im.setMatrixAt(i, m4.compose(V(x, this.groundY(x, z) - it.sink + it.lift, z), q.setFromAxisAngle(up, it.ry), it.sc));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    this._placeProxies?.();
    this._buildCables();
  }

  /**
   * ALSEP flat cables on the ground (as in AS15-87-11847): from the central
   * station to the RTG, seismometer, magnetometer and heat flow electronics,
   * and from the heat flow box to its two probes in their drill holes (white
   * probe tops). Not catalog objects (they sit outside the instrument roots);
   * they make the station read as the hub and the heat flow experiment as
   * "a box with probes in the ground". Layout simplified.
   */
  _buildCables() {
    if (!this.alsepCenter || !this._cableMat) return;
    if (this.cables) { this.group.remove(this.cables); this.cables.traverse((m) => m.geometry?.dispose?.()); }
    const [cx, cz] = this.alsepCenter;
    const hfe = [cx - 2.4, cz - 3.8];
    const probes = [[hfe[0] - 4.6, hfe[1] - 1.2], [hfe[0] + 0.8, hfe[1] - 5.2]];
    const runs = [
      [[cx + 0.2, cz + 0.15], [cx + 3.0, cz + 1.4]], [[cx - 0.2, cz + 0.15], [cx - 3.95, cz + 2.45]],
      [[cx + 0.15, cz - 0.15], [cx + 2.35, cz - 4.2]], [[cx - 0.15, cz - 0.15], [hfe[0] + 0.1, hfe[1] + 0.12]],
      [[hfe[0] - 0.15, hfe[1]], probes[0]], [[hfe[0] + 0.1, hfe[1] - 0.1], probes[1]],
    ];
    const pos = [], idx = [], w = 0.03; // flat ribbon cables, silvery (AS15-92-12407); 6 cm wide here so they read at a few metres
    for (const [[x0, z0], [x1, z1]] of runs) {
      const n = 24, len = Math.hypot(x1 - x0, z1 - z0), tx = (x1 - x0) / len, tz = (z1 - z0) / len;
      const base = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const t = i / n, wig = Math.sin(t * Math.PI * 3 + x0) * 0.12 * Math.sin(t * Math.PI); // laid by hand, not taut
        const x = this.lm.x + x0 + (x1 - x0) * t - tz * wig, z = this.lm.z + z0 + (z1 - z0) * t + tx * wig;
        const y = this.groundY(x, z) + 0.025;
        pos.push(x - tz * w, y, z + tx * w, x + tz * w, y, z - tx * w);
        if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const grp = new THREE.Group(); grp.name = 'alsep-cables';
    const ribbon = new THREE.Mesh(g, this._cableMat); ribbon.receiveShadow = true; ribbon.raycast = () => {};
    grp.add(ribbon);
    const capMat = this._probeMat || (this._probeMat = Object.assign(new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.6 }), { userData: { surfaceDetail: true } }));
    // Each borehole: the white probe top in a low mound of darker drill
    // cuttings (the crew drilled 1.6-m holes; the cuttings piled round them).
    const cutMat = this._cutMat || (this._cutMat = Object.assign(new THREE.MeshStandardMaterial({ color: 0x4a4844, roughness: 1 }), { userData: { surfaceDetail: true } }));
    for (const [px, pz] of probes) {
      const x = this.lm.x + px, z = this.lm.z + pz, y = this.groundY(x, z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 12), capMat);
      cap.position.set(x, y + 0.03, z); cap.raycast = () => {};
      const pile = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), cutMat);
      pile.scale.y = 0.12; pile.position.set(x, y - 0.005, z); pile.raycast = () => {}; pile.receiveShadow = true;
      grp.add(pile, cap);
    }
    this.cables = grp;
    this.group.add(grp);
  }

  // ------------------------------------------------------------------ catalog
  _registerModels() { if (this.active) this.registerAll(); }

  /** Register everything built so far with the inspect system (idempotent). */
  registerAll() {
    const ins = this.app.inspect;
    if (!ins) return;
    // Every catalog root is measured in its own axes (headings, billboards and the
    // turning sky must not inflate the scale check); the crew use their rest pose.
    // Registered once each: decorative entries (DECISIONS #63) only tag their roots as
    // occluders and never appear in ins.items (inspect.clear() empties both).
    const has = (id) => ins.items.has(id) || (ins.occluders || []).some((r) => r.userData.objectId === id);
    const reg = (id, roots, opts) => {
      if (!roots || (Array.isArray(roots) && !roots.length) || has(id)) return;
      for (const r of [roots].flat()) r.userData.scaleFrame = 'local';
      ins.register(id, roots, opts);
    };
    reg('lm-descent-stage', this.lmProp);
    reg('lrv', this.roverChassis);
    reg('flag', this.flag);
    reg('field-crew', [this.crewA.root, this.crewB.root]);
    reg('earth', this.sky.earth, { frame: { look: true, fitFov: true, heightFrac: 0.4 } });
    reg('sun', this.sky.sun, { frame: { look: true, fitFov: true, heightFrac: 0.35 } });
    // The orbiter: a telephoto look (like a long lens) that resolves the real-size spacecraft.
    reg('endeavour', this.sky.orbiter, { frame: { look: true, fitFov: true, heightFrac: 0.3, minFov: 0.002 } });
    reg('starfield', this.starPatch, { frame: { look: true } });
    const views = this._inspectViews();
    for (const [id, o, frame] of this.proxyList) reg(id, o, views[id] ? { frame: { view: views[id] } } : frame ? { frame } : {});
    for (const [id, o] of Object.entries(this.alsep || {})) reg(id, o, id === 'alsep-heat-flow' ? { frame: { view: views['alsep-heat-flow'] } } : id === 'alsep-central-station' ? { frame: { heightFrac: 0.22 } } : undefined);
    reg('sample-bag', this.sampleBag);
    reg('boulders', this.boulders);
    reg('genesis-rock', this.genesis, { frame: { view: views['genesis-rock'] } });
    reg('footprints', this.footprints, { frame: { view: views.footprints } });
    reg('rover-tracks', this.tracks, { frame: { view: views['rover-tracks'] } });
  }

  /**
   * Authored inspect views (review F13-F27): where a box framing cannot show
   * what an object is (a landform kilometres wide, a line, a layer, a patch of
   * ground), the camera goes to a chosen spot and looks at it, beside the card.
   * Positions are metres east (x) and south (z) of the LM; heights are above
   * the ground there. Each view is computed when the card opens (streamed
   * ground heights).
   */
  _inspectViews() {
    const lm = this.lm;
    const P = (dx, dz, lift = 0) => { const x = lm.x + dx, z = lm.z + dz; return [x, this.groundY(x, z) + lift, z]; };
    // An eye above the higher of its own ground and the target's (slopes).
    const H = (dx, dz, tx, tz, lift) => { const e = P(dx, dz, 0), t = P(tx, tz, 0); e[1] = Math.max(e[1], t[1]) + lift; return e; };
    const A = (dx, dz, y) => [lm.x + dx, lm.y + y, lm.z + dz]; // absolute height above the LM datum (far targets)
    const fit = (size, eye, center) => THREE.MathUtils.radToDeg(2 * Math.atan(size / 2 / Math.hypot(eye[0] - center[0], eye[1] - center[1], eye[2] - center[2])));
    const v = (eye, center, fov) => () => ({ eye: eye(), center: center(), fov: typeof fov === 'function' ? fov() : fov });
    const st = (id) => { const p = this.terrain.fromLonLat(this.stations[id].lon, this.stations[id].lat); return [p.xM - lm.x, p.yM - lm.z]; };
    const [sgx, sgz] = st('stgeorge'), [spx, spz] = [this.bowls.spur.x - lm.x, this.bowls.spur.z - lm.z];
    const [elx, elz] = [this.bowls.elbow.x - lm.x, this.bowls.elbow.z - lm.z], [dux, duz] = [this.bowls.dune.x - lm.x, this.bowls.dune.z - lm.z];
    const mp = this.craterPatches?.mare ? [this.craterPatches.mare.xM - lm.x, this.craterPatches.mare.yM - lm.z] : [480, -350];
    return {
      // Eye level 30 m south-east of the LM, looking north-west past it over open
      // mare: the LM (7 m tall) at the left for scale, the curved skyline about
      // 2.4 km away, black sky above (review pass 2 F8, G1 F4).
      horizon: v(() => P(24, 19, 1.7), () => P(24 - 1540, 19 - 1840, 40), 50),
      // Close over bare soil beside the bootprints: grains, tiny pits and the
      // edge of a print at the right; no rock at the centre (review pass 2 F6).
      regolith: v(() => P(REGOLITH_SPOT[0] - 0.3, REGOLITH_SPOT[1] + 1.3, 0.75), () => P(REGOLITH_SPOT[0] + 0.25, REGOLITH_SPOT[1], 0), 40),
      // Low along the line of prints, so the tread relief catches the Sun.
      footprints: v(() => P(3.4, 7.9, 1.25), () => P(3.2, 5.0, 0), 42),
      // Low along both wheel tracks.
      'rover-tracks': v(() => P(24, -12.5, 1.3), () => P(24, -18.5, 0), 46), // looking north, the rover's loop behind the camera
      // Looking down at a cluster of small craters on the mare (no mountains in view).
      craterlets: v(() => P(mp[0] - 190, mp[1] + 40, 210), () => P(mp[0], mp[1], 0), 52),
      // From above the plain north of the site, looking south over it: the open,
      // dark plain runs past the LM to the foot of the Apennine Front, Hadley
      // Delta rising beyond; no crater at the centre (G1 F3).
      'mare-plain': v(() => P(-350, -1500, 90), () => P(250, 1500, 0), 60),
      // From just behind the Station 4 flag on the rim, looking across the
      // 380 m bowl: the flag in front, the rim and far wall beyond (review pass 2 F11).
      'dune-crater': (() => {
        const [sx, sz] = st('dune'), l = Math.hypot(sx - dux, sz - duz) || 1, ux = (sx - dux) / l, uz = (sz - duz) / l;
        const e = () => H(sx + ux * 140, sz + uz * 140, dux, duz, 110), c = () => P(dux, duz, 0);
        return v(e, c, () => fit(380 * 1.4, e(), c()));
      })(),
      // From the rille edge above Elbow crater.
      // G2 recognition fix: crater views were lit from behind the camera (eye east,
      // morning Sun east), so the bowls showed no shadow and read as grey smudges.
      // Each crater is now seen from the south across the Sun's direction, with a
      // low card Sun (CARD_SUN): the east inner wall in shadow, the west wall lit.
      'elbow-crater': (() => { const e = () => H(elx + 40, elz + 470, elx, elz, 210), c = () => P(elx, elz, 0); return v(e, c, () => fit(340 * 1.7, e(), c())); })(), // the bowl on the rille's edge, the rille beyond
      // The Genesis Rock on the rim of Spur, through a long lens from 8 m inside
      // the rim, looking out: the white rock large in front, the foot of the
      // Station 7 flag pole just behind it (G1 F6). A 7.5 cm rock and a 2 m flag
      // cannot both fill the view, so the lens shows the rock and the pole's foot.
      'genesis-rock': (() => {
        const e = () => { const g = this.genesisAt, u = g.toBowl, x = g.x + u[0] * 8, z = g.z + u[1] * 8; return [x, Math.max(this.groundY(x, z), this.groundY(g.x, g.z)) + 1.3, z]; };
        const ctr = () => { const g = this.genesisAt, u = g.toBowl; return [g.x - u[0] * 0.2, this.groundY(g.x, g.z) + 0.06, g.z - u[1] * 0.2]; };
        return v(e, ctr, 2.2);
      })(),
      // Spur crater on the Front slope, its station flag and the Genesis Rock on its rim.
      'spur-crater': (() => { const e = () => H(spx + 15, spz + 125, spx, spz, 55), c = () => P(spx, spz, 0); return v(e, c, () => fit(80 * 2.2, e(), c())); })(), // from the south on the Front slope
      // St. George on the flank of Hadley Delta, seen from south-west of the site (the LM behind the camera).
      // (its centre lies up the Delta flank, south-west of the station on its rim)
      'st-george-crater': (() => { const e = () => H(sgx - 650, sgz + 650 - 2900, sgx - 650, sgz + 650, 650), c = () => P(sgx - 650, sgz + 650, 0); return v(e, c, () => fit(2420 * 1.5, e(), c())); })(), // from the north, above the plain: the bowl on the Delta's flank
      // Mount Hadley to the north-east, seen across Hadley Rille from above its
      // west rim: the channel in front, the massif beyond (review pass 2 F7).
      'mount-hadley': v(() => H(-3350, 300, -2700, 0, 90), () => A(13440 * 0.6, -14960 * 0.6, 1300), 56),
      // Hadley Delta to the south, from just north of the LM: the LM in front,
      // St. George crater (its Station 2 flag) on the Delta's north-west flank.
      'hadley-delta': v(() => P(6, -24, 2.4), () => A((3520 * 0.6 + sgx - 650) / 2, (17200 * 0.6 + sgz + 650) / 2, 1000), 60),
      // The Apennine Front: the arc of mountains east and south of the plain, from above the plain.
      'apennine-front': v(() => P(-900, -900, 520), () => A(5200, 4200, 500), 76),
      // Hadley Rille from its east rim: the channel, about 1 km wide and 300 m deep.
      'hadley-rille': v(() => H(-2050, -700, -2700, 900, 260), () => P(-2720, 900, 0), 60),
      // The heat flow electronics box with its two cables running to the probes in their drill holes.
      'alsep-heat-flow': (() => { const [cx, cz] = this.alsepCenter || [-104, -38]; return v(() => P(cx - 2.4 + 1.5, cz - 3.8 + 1.6, 3.0), () => P(cx - 2.4 - 1.9, cz - 3.8 - 3.0, 0), 62); })(), // both probe cables and boreholes in view (review pass 2 F9)
      // Close on the impact area: the flash and its dust puff (frequency illustrative).
      'micrometeoroid-flash': v(() => P(this.flashArea.x - lm.x - 22, this.flashArea.z - lm.z + 26, 7), () => [this.flashArea.x, this.groundY(this.flashArea.x, this.flashArea.z) + 0.5, this.flashArea.z], 34),
    };
  }

  /** Landform pick volumes (invisible, draped on the CPU heightfield, real extents). */
  // (REGOLITH_SPOT: module constant, metres east/south of the LM)
  _buildProxies() {
    const P = (id, mesh) => { mesh.name = `pick-${id}`; mesh.userData.noOutline = true; this.group.add(mesh); return mesh; };
    const st = this.stations;
    const disc = (id, lon, lat, diam, lift) => {
      const c = this.terrain.fromLonLat(lon, lat);
      return P(id, this._drape(c.xM, c.yM, diam / 2, lift, 'disc'));
    };
    const look = { look: true, fitFov: true, heightFrac: 0.45 };
    // The station coordinates (Davies & Colvin 2000) are where the crew stopped,
    // on a crater's rim. Dune and Elbow are big enough for the 10 m elevation
    // grid: their pick discs sit on the bowl found nearest the station.
    this.bowls = { dune: this._findBowl(st.dune, 380), elbow: this._findBowl(st.elbow, 340), spur: this._findBowl(st.spur, 80) };
    const bowlDisc = (id, b, diam, lift) => P(id, this._drape(b.x, b.z, diam / 2, lift, 'disc'));
    this.proxyList = [
      ['st-george-crater', disc('st-george-crater', st.stgeorge.lon, st.stgeorge.lat, 2420, 4), look],
      ['spur-crater', bowlDisc('spur-crater', this.bowls.spur, 80, 0.4), { heightFrac: 0.4 }],
      ['elbow-crater', bowlDisc('elbow-crater', this.bowls.elbow, 340, 9), look], // above the rille ribbon: Elbow sits on the rille
      ['dune-crater', bowlDisc('dune-crater', this.bowls.dune, 380, 1.5), look],
    ];
    const mp = this.craterPatches?.mare || { xM: this.lm.x + 480, yM: this.lm.z - 350, radiusM: 150 };
    this.proxyList.push(['craterlets', P('craterlets', this._drape(mp.xM, mp.yM, mp.radiusM, 0.6, 'disc')), look]);
    this.proxyList.push(['mare-plain', P('mare-plain', this._drape(this.lm.x + 1350, this.lm.z - 1700, 650, 1.0, 'disc')), look]);
    this.proxyList.push(['regolith', P('regolith', this._drape(this.lm.x + REGOLITH_SPOT[0], this.lm.z + REGOLITH_SPOT[1], 1.2, 0.03, 'disc')), { heightFrac: 0.5 }]);
    this.proxyList.push(['hadley-rille', P('hadley-rille', this._rilleRibbon()), look]);
    this.proxyList.push(['apennine-front', P('apennine-front', this._frontPatch()), look]);
    // Massifs beyond the v2 heightfield: cones at their gazetteer footprints (build-meta.json).
    const cone = (id, east, north, diam, rise) => {
      const d = Math.hypot(east, north);
      const m = new THREE.Mesh(new THREE.ConeGeometry(diam / 2, rise, 24, 1, true), pickMaterial());
      m.position.set(this.lm.x + east, this.lm.y - curvatureDrop(d) + rise / 2 - 300, this.lm.z - north);
      return P(id, m);
    };
    this.proxyList.push(['mount-hadley', cone('mount-hadley', 13440, 14960, 26400, 4366), look]);
    this.proxyList.push(['hadley-delta', cone('hadley-delta', 3520, -17200, 17240, 3813), look]);
    // Close horizon: a strip at the horizon distance north over the flat mare.
    const hz = new THREE.Mesh(new THREE.PlaneGeometry(900, 28), pickMaterial());
    this.horizonStrip = P('horizon', hz);
    this.proxyList.push(['horizon', hz, { look: true }]);
    // Micrometeoroid impact area (flashes happen at random points inside it).
    this.flashArea = { x: this.lm.x + 380, z: this.lm.z - 520, r: 220 };
    this.proxyList.push(['micrometeoroid-flash', P('micrometeoroid-flash', this._drape(this.flashArea.x, this.flashArea.z, this.flashArea.r, 0.8, 'disc')), look]);
    // Starfield: a patch of the northern sky on the sky shell (follows the camera).
    const cap = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS.stars * 0.98, 24, 12, Math.PI * 1.3, Math.PI * 0.4, Math.PI * 0.2, Math.PI * 0.25), pickMaterial()); // northern sky, 20-55 deg up
    cap.material.side = THREE.BackSide;
    cap.name = 'pick-starfield';
    cap.userData.noOutline = true;
    this.sky.shell.add(cap);
    this.starPatch = cap;
    this._placeProxies = () => {
      const x = this.lm.x, z = this.lm.z - 2400;
      hz.position.set(x, this.groundY(x, z) + 10, z);
    };
    this._placeProxies();
  }

  /**
   * Centre of the deepest bowl of diameter `diam` within 2.2 radii of a station:
   * mean height on a ring of that radius minus the centre height, on the v2
   * elevation grid. Falls back to the station point. @returns {{ x: number, z: number }}
   */
  _findBowl(station, diam) {
    const T = this.terrain, p = T.fromLonLat(station.lon, station.lat), r = diam / 2, step = Math.max(5, r / 12);
    let best = { x: p.xM, z: p.yM, dep: 0 };
    for (let x = p.xM - 2.2 * r; x <= p.xM + 2.2 * r; x += step) for (let z = p.yM - 2.2 * r; z <= p.yM + 2.2 * r; z += step) {
      const c = T.elevationAt(x, z);
      if (!Number.isFinite(c)) continue;
      let sum = 0, n = 0;
      for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; const e = T.elevationAt(x + Math.cos(a) * r, z + Math.sin(a) * r); if (Number.isFinite(e)) { sum += e; n++; } }
      if (n >= 20 && sum / n - c > best.dep) best = { x, z, dep: sum / n - c };
    }
    return best;
  }

  /** A disc of radius r (m) draped on the heightfield, `lift` metres up. */
  _drape(cx, cz, r, lift, kind = 'disc') {
    const segR = 10, segA = 36;
    const pos = [], idx = [];
    pos.push(cx, this.groundY(cx, cz) + lift, cz);
    for (let i = 1; i <= segR; i++) for (let a = 0; a < segA; a++) {
      const ang = (a / segA) * Math.PI * 2, rr = (i / segR) * r;
      const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
      pos.push(x, this.groundY(x, z) + lift, z);
    }
    for (let a = 0; a < segA; a++) idx.push(0, 1 + ((a + 1) % segA), 1 + a);
    for (let i = 1; i < segR; i++) for (let a = 0; a < segA; a++) {
      const p = 1 + (i - 1) * segA + a, q = 1 + (i - 1) * segA + ((a + 1) % segA), p2 = p + segA, q2 = q + segA;
      idx.push(p, q, p2, q, q2, p2);
    }
    void kind;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, pickMaterial());
  }

  /** Hadley Rille: a 1.2 km ribbon along the lowest line of the channel, found in the heightfield. */
  _rilleRibbon() {
    const g = this.terrain.grid, mpp = g.mPerPx;
    const pts = [];
    const zEnd = this.terrain.fromLonLat(3.601, 26.03).yM;
    for (let z = 600; z < zEnd; z += 250) {
      let best = null;
      for (let x = 600; x < this.lm.x - 250; x += mpp * 2) {
        const e = this.terrain.elevationAt(x, z);
        if (Number.isFinite(e) && (!best || e < best.e)) best = { x, e };
      }
      if (best) pts.push(V(best.x, 0, z));
    }
    this.rilleLine = pts;
    const pos = [], idx = [];
    pts.forEach((p, i) => {
      const n = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
      const side = V(-n.z, 0, n.x);
      for (const s of [-600, -300, 0, 300, 600]) {
        const x = p.x + side.x * s, z = p.z + side.z * s;
        pos.push(x, this.groundY(x, z) + 6, z);
      }
      if (i) for (let k = 0; k < 4; k++) { const a = (i - 1) * 5 + k, b = a + 1, c = a + 5, d = c + 1; idx.push(a, c, b, b, c, d); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, pickMaterial()); m.material.side = THREE.DoubleSide;
    return m;
  }

  /** The lower Apennine Front inside the v2 heightfield: ground more than 120 m above the plain. */
  _frontPatch() {
    const g = this.terrain.grid, mpp = g.mPerPx;
    const zMin = this.terrain.fromLonLat(SITE.lon, 26.0).yM;
    const zMax = (g.height - 1) * mpp - 50;
    const x0 = 700, x1 = (g.width - 1) * mpp - 400, step = 150;
    const cols = Math.floor((x1 - x0) / step) + 1, rows = Math.floor((zMax - zMin) / step) + 1;
    const pos = [], idx = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = x0 + i * step, z = zMin + j * step;
      const e = this.terrain.elevationAt(x, z);
      const up = Number.isFinite(e) && e > this.lm.y + 120;
      pos.push(x, (up ? this.groundY(x, z) : this.lm.y - 400) + 8, z);
    }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      if (pos[a * 3 + 1] > this.lm.y - 300 && pos[d * 3 + 1] > this.lm.y - 300) idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return new THREE.Mesh(geo, pickMaterial());
  }

  // ------------------------------------------------------------------ motion
  addMotion(motion) {
    const rng = mulberry(15);
    const sky = this.sky;
    motion.add({
      id: 'sun-time-lapse', layer: 'sky', label: 'time-lapse', objects: ['sun'],
      description: 'The Sun climbs through the lunar morning at about one lunar hour a second; shadows sweep the terrain. It loops back after about 43 hours of lunar time.',
      update: (dt) => {
        if (this.sunHold) return;
        if (this._lowSun) {
          const e = this.sky.sunElevationDeg;
          const goal = this._lowSun;
          if (Math.abs(e - goal) > 0.05) { const keep = this._sunBefore; this.setSunElevation(e + (goal - e) * Math.min(1, dt * 2.5) + Math.sign(goal - e) * Math.min(Math.abs(goal - e), dt * 2)); this._sunBefore = keep; }
          return;
        }
        this.lapse += dt * LAPSE_DEG_PER_S;
        if (this.lapse > LAPSE_SPAN_DEG) this.lapse = 0;
        this._applySun();
      },
    });
    motion.add({
      id: 'earth-spin', layer: 'sky', label: 'time-lapse', objects: ['earth'], holdWithCard: false,
      description: 'Earth turns once in about 90 s (time-lapse) with its cloud layer drifting; it stays at the same place in the sky.',
      update: (dt) => { sky.earthSpin += dt * (Math.PI * 2 / 90); sky.cloudShift = (sky.cloudShift + dt * 0.0012) % 1; },
    });
    motion.add({
      id: 'orbiter-pass', layer: 'sky', label: 'time-lapse', objects: ['endeavour'],
      description: 'The field team\'s orbiter crosses from the eastern to the western horizon in 60 s, about ten times faster than real.',
      update: (dt) => { sky.orbiterPhase = (sky.orbiterPhase + dt / 90) % 1; },
    });
    // Rover: a slow loop east of the LM; wheels turn, rear wheels throw ballistic dust.
    const loop = new THREE.CatmullRomCurve3(Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return V(this.lm.x + 22 + Math.cos(a) * 9, 0, this.lm.z + Math.sin(a) * 10); }), true);
    const len = loop.getLength();
    let u = 0.5;
    const pt = V(), tan = V(), wp = V();
    let emit = 0;
    motion.add({
      id: 'rover-drive', layer: 'agents', label: 'illustrative', objects: ['lrv'],
      description: 'The rover drives a short loop near the LM at about 2 m/s (the real top speed was about 3.6 m/s); the loop is illustrative.',
      update: (dt) => {
        u = (u + (2.0 * dt) / len) % 1;
        loop.getPointAt(u, pt); loop.getTangentAt(u, tan);
        this.rover.position.set(pt.x, this.groundY(pt.x, pt.z), pt.z);
        this.rover.rotation.y = Math.atan2(tan.x, tan.z);
        for (const w of this.roverWheels || []) w.rotation.x += (2.0 * dt) / 0.41;
        emit += 2.0 * dt * 7;
      },
    });
    motion.add({
      id: 'rover-dust', layer: 'environment', label: 'accurate', objects: ['lrv'], holdWithCard: false, // grains in flight land; none are thrown while the rover is held
      description: 'Dust thrown by the wheels flies in clean ballistic arcs at lunar gravity and falls straight back: no air, no billowing cloud.',
      onFreeze: (f) => { if (f) this.roverDust.clear(); this.roverDust.points.visible = !f; },
      update: (dt) => {
        if (emit >= 1) {
          for (const w of [this.roverWheels?.[2], this.roverWheels?.[3]].filter(Boolean)) { w.getWorldPosition(wp); wp.y = this.groundY(wp.x, wp.z); this.roverDust.emit(wp, Math.floor(emit / 2) + 1, rng); }
          emit = 0;
        }
        this.roverDust.update(dt, (x, z) => this.groundY(x, z));
      },
    });
    motion.add({
      id: 'tv-camera-pan', layer: 'objects', label: 'accurate', objects: ['lrv'], holdWithCard: false,
      description: 'The rover\'s TV camera pans slowly left and right, as Mission Control steered it from Earth.',
      update: (dt, t) => { this.tvCam.rotation.y = Math.sin(t * 0.25) * 1.0; },
    });
    // Crew
    const walk = new THREE.CatmullRomCurve3([[-2, 6], [-8, 10], [-30, 2], [-70, -22], [-98, -34], [-60, -12], [-20, 4]].map(([dx, dz]) => V(this.lm.x + dx, 0, this.lm.z + dz)), true);
    const wlen = walk.getLength();
    let wu = 0.05, hold = 0;
    this.crewB.onFootfall = () => {
      const p = this.crewB.root.position;
      for (const L of this.crewB.legs) this.bootDust.emit(V(L.world.x, this.groundFine(L.world.x, L.world.z), L.world.z), 3, rng);
    };
    motion.add({
      id: 'crew-lope', layer: 'agents', label: 'accurate', objects: ['field-crew'], holdWithCard: false,
      description: 'A geologist lopes between the LM and the ALSEP in skips: a short stance with both feet planted, then a ballistic flight at lunar gravity (push-off and stance timing approximate), the gait Apollo crews used at one-sixth gravity; the route is the field team\'s.',
      update: (dt) => {
        const c = this.crewB;
        // Card hold: while the crew's card is open the geologist stops and stands
        // where they are (no frozen mid-air hop), then lopes on.
        if (this.app.motion?.held.has('field-crew')) {
          if (c.action !== 'idle') c.setAction('idle');
          c.update(dt);
          return;
        }
        if (c.action === 'idle') c.setAction(hold > 0 ? 'point' : 'lope');
        if (hold > 0) { hold -= dt; if (hold <= 0) c.setAction('lope'); c.update(dt); return; }
        wu = (wu + (1.3 * dt) / wlen) % 1;
        if (Math.abs(wu - 0.55) < 0.0015) { hold = 5; c.setAction('point'); }
        walk.getPointAt(wu, pt); walk.getTangentAt(wu, tan);
        // The figure poses its own height from the ground under each foot (astronaut.js).
        c.root.position.set(pt.x, c.root.position.y, pt.z);
        c.root.rotation.y = Math.atan2(tan.x, tan.z);
        c.update(dt);
      },
    });
    motion.add({
      id: 'crew-sampling', layer: 'agents', label: 'accurate', objects: ['field-crew'], holdWithCard: false,
      description: 'A geologist leans and bends the knees a little to reach the ground with the sample tongs, then stands again (the pressurised suit allowed little more).',
      update: (dt) => { this.crewA.update(dt); },
    });
    motion.add({
      id: 'boot-dust', layer: 'environment', label: 'accurate', objects: ['footprints'], holdWithCard: false,
      description: 'Each footfall kicks a few grains that arc and drop at lunar gravity.',
      onFreeze: (f) => { if (f) this.bootDust.clear(); this.bootDust.points.visible = !f; },
      update: (dt) => this.bootDust.update(dt, (x, z) => this.groundY(x, z)),
    });
    motion.add({
      id: 'sample-bag-swing', layer: 'objects', label: 'accurate', objects: ['sample-bag'],
      description: 'The sample bag on the geologist\'s tongs swings as a pendulum at lunar gravity: about 2.5 times slower than on Earth, and with no air it hardly slows down.',
      update: (dt) => { this.crewA.updateBag(dt); this.crewB.updateBag(dt); },
    });
    let nextFlash = 2 + rng() * 4, flashT = -1;
    const fp = V();
    motion.add({
      id: 'micrometeoroid-flashes', layer: 'environment', label: 'illustrative', objects: ['micrometeoroid-flash'], holdWithCard: false,
      description: 'Now and then a tiny flash and a dust puff on distant ground. The frequency is illustrative; there are no meteor streaks because there is no air.',
      onFreeze: (f) => { if (f) { this.puff.clear(); this.flash.material.opacity = 0; } },
      update: (dt) => {
        nextFlash -= dt;
        // With the impact card open, flashes land near the framed spot every few seconds.
        const near = this._flashSoon != null;
        if (near) { this._flashSoon -= dt; if (this._flashSoon <= 0) { nextFlash = 0; this._flashSoon = 3.5; } }
        if (nextFlash <= 0) {
          const a = rng() * Math.PI * 2, d = near ? rng() * 3 : Math.sqrt(rng()) * this.flashArea.r;
          const x = this.flashArea.x + Math.cos(a) * d, z = this.flashArea.z + Math.sin(a) * d;
          fp.set(x, this.groundY(x, z) + 0.3, z);
          this.flash.position.copy(fp);
          flashT = 0;
          for (let i = 0; i < 3; i++) this.puff.emit(fp, 14, () => rng());
          nextFlash = 7 + rng() * 8;
        }
        if (flashT >= 0) { flashT += dt; this.flash.material.opacity = Math.max(0, 1 - flashT / 0.15); if (flashT > 0.15) flashT = -1; }
        this.puff.update(dt * 2.2, (x, z) => this.groundY(x, z));
      },
    });
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const cam = this.engine.camera;
    this.streamed.update();
    if (!this.active) return;
    const reduced = this.app.motionPrefs?.reduced;
    this.sky.groundY = this.groundY(cam.position.x, cam.position.z);
    this.sky.update(dt, cam, { reduced });
    // Near plane follows the distance to the ground and the orbit target (depth precision over 200 km).
    const h = Math.max(0.5, cam.position.y - this.sky.groundY);
    const r = this.app.rig ? this.app.rig.state.radius : h;
    const near = THREE.MathUtils.clamp(Math.min(h * 0.25, r * 0.15), 0.03, 60);
    if (Math.abs(cam.near - near) > near * 0.1 || cam.far !== 260000) { cam.near = near; cam.far = 260000; cam.updateProjectionMatrix(); }
    if (!this.sun.isSunLight) { this._focus = V(cam.position.x, this.sky.groundY, cam.position.z); this._placeSun(); }
    // Props stop casting into the two shadow cascades beyond a range where their
    // shadow would be a few pixels (each caster costs two draw calls).
    this._castT = (this._castT || 0) - dt;
    if (this._castT <= 0) {
      this._castT = 0.4;
      const ranges = [[this.lmProp, 600], [this.rover, 400], [this.flag, 150], [this.crew, 160], [this.genesis, 20], [this.sampleBag, 25],
        ...Object.values(this.alsep || {}).map((o) => [o, 60]), ...(this.boulders || []).map((o) => [o, 90]), ...(this.boulderSets || []).map((o) => [o, 70])];
      for (const [root, range] of ranges) {
        if (!root) continue;
        const p = root.isInstancedMesh ? this.lm : root.getWorldPosition(this._wp || (this._wp = V()));
        const on = cam.position.distanceTo(p) < range;
        if (root.userData.castOn === on) continue;
        root.userData.castOn = on;
        root.traverse((m) => { if (m.isMesh) { if (m.userData.castDefault === undefined) m.userData.castDefault = m.castShadow; m.castShadow = on && m.userData.castDefault; } });
      }
    }
  }

  // ------------------------------------------------------------------ tool facade (Module 2-4 tools)
  /** Raycast the streamed surface (falls back to the heightfield plane). */
  pickTerrain(ndcX, ndcY) {
    const p = this.streamed.pick(new THREE.Vector2(ndcX, ndcY), this.engine.camera);
    if (!p) return null;
    return { xM: p.x, yM: p.z, elev: p.y, world: p };
  }

  /**
   * Lettered survey tag on a landform: a real 2 m survey flag in the ground and
   * a screen-size tag with its letter above it, so it reads from kilometres away.
   * It is a lesson cue: labelled for the legend (ui-audit abstract-marker gate).
   */
  addMarker(id, xM, yM, label = '', color = '#ffb347') {
    this.removeMarker(id);
    const grp = new THREE.Group(); grp.name = `marker-${id}`;
    grp.userData.marker = { label: 'Lettered survey tag' };
    const y = this.groundY(xM, yM);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2, 6), new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 0.7, roughness: 0.4 }));
    pole.material.userData.surfaceDetail = true;
    pole.position.set(xM, y + 1, yM);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture(label, color), depthTest: false, transparent: true, sizeAttenuation: false }));
    tag.center.set(0.5, 0);
    tag.scale.set(0.036, 0.05, 1);
    tag.position.set(xM, y + 2.2, yM);
    tag.renderOrder = 10;
    grp.add(pole, tag);
    this.group.add(grp);
    this.markers.set(id, grp);
    return grp;
  }
  removeMarker(id) { const m = this.markers.get(id); if (m) { this.group.remove(m); this.markers.delete(id); } }
  clearMarkers() { for (const id of [...this.markers.keys()]) this.removeMarker(id); }

  /** A task glint above a world point (stays visible; legend-labelled). */
  glint(label, pos, size = 6) {
    const s = createGlint(label, { size });
    s.position.copy(pos);
    this.group.add(s);
    return s;
  }
}

/**
 * Flag on its horizontal rod (Lunar Flag Assembly, research/apollo15-facts.md):
 * a 0.91 x 1.52 m nylon flag held out by a top rod, 1.9 m pole (height
 * approximate). No air: it never moves; the creases are fixed.
 */
function buildFlagV3() {
  const c = document.createElement('canvas'); c.width = 190; c.height = 114;
  const x = c.getContext('2d');
  for (let i = 0; i < 13; i++) { x.fillStyle = i % 2 ? '#f2ede4' : '#b22234'; x.fillRect(0, (i * 114) / 13, 190, 114 / 13 + 1); }
  x.fillStyle = '#3c3b6e'; x.fillRect(0, 0, 76, 61);
  x.fillStyle = '#f2ede4';
  for (let r = 0; r < 9; r++) for (let k = 0; k < (r % 2 ? 5 : 6); k++) { x.beginPath(); x.arc(6 + k * 12.6 + (r % 2 ? 6.3 : 0), 5 + r * 6.4, 1.6, 0, Math.PI * 2); x.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group(); g.name = 'flag';
  const metal = new THREE.MeshStandardMaterial({ color: 0xd8d6d0, metalness: 0.8, roughness: 0.35 });
  metal.userData.surfaceDetail = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0127, 0.0127, 1.9, 8), metal); pole.position.y = 0.95;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0127, 0.0127, 1.52, 8), metal); rod.rotation.z = Math.PI / 2; rod.position.set(0.76, 1.88, 0);
  const geo = new THREE.PlaneGeometry(1.52, 0.91, 12, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.76) * 9) * 0.025); // fixed creases from the folded storage
  geo.computeVertexNormals();
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
  cloth.position.set(0.76, 1.88 - 0.455, 0);
  for (const m of [pole, rod, cloth]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}

function tagTexture(label, color) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color; g.strokeStyle = '#111'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(8, 8); g.lineTo(88, 8); g.lineTo(88, 88); g.lineTo(56, 88); g.lineTo(48, 124); g.lineTo(40, 88); g.lineTo(8, 88); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#111'; g.font = 'bold 56px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 48, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * Both LRV wheel tracks on a 2.06 x 10 m strip (own work): two 23 cm bands
 * 1.83 m apart (centre to centre), pressed a centimetre or two into the soil,
 * with the chevron print of the wheels' titanium tread every 10 cm. Returns
 * albedo, normal and alpha (bands only, ends faded) canvases.
 */
function roverTrackTextures() {
  const W = 128, H = 1024;
  const height = new Float32Array(W * H), mask = new Float32Array(W * H);
  const bandC = [W * (0.11 / 2.06), W * (1 - 0.11 / 2.06)], half = W * (0.115 / 2.06);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let h = 0, m = 0;
    for (const c of bandC) {
      const u = (x - c) / half; // -1..1 across the band
      if (Math.abs(u) > 1.35) continue;
      const inBand = Math.abs(u) <= 1;
      const v = (y / H) * 100 + Math.abs(u) * 0.5; // chevrons every 10 cm, V-shaped
      const chevron = Math.abs((v % 1) - 0.5) < 0.12 ? 0.5 : 0;
      h = inBand ? -1 + chevron : 0.35 * (1 - (Math.abs(u) - 1) / 0.35); // a small berm of pushed soil at the edges
      m = Math.max(m, inBand ? 1 : 0.6 * (1 - (Math.abs(u) - 1) / 0.35));
    }
    const end = Math.min(1, y / (H * 0.06), (H - y) / (H * 0.06));
    height[y * W + x] = h; mask[y * W + x] = m * end;
  }
  const canvas = (fill) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) img.data.set(fill(i), i * 4);
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  };
  const map = canvas((i) => { const v = 150 + 40 * height[i] + 10 * (((i * 2654435761) >>> 0) % 7 - 3) / 3; return [v, v * 0.98, v * 0.95, 255]; });
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = canvas((i) => {
    const x = i % W, y = (i / W) | 0, at = (a, b) => height[Math.min(H - 1, Math.max(0, b)) * W + Math.min(W - 1, Math.max(0, a))];
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2, l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255];
  });
  const alphaMap = canvas((i) => { const v = 255 * mask[i]; return [v, v, v, 255]; });
  return { map, normalMap, alphaMap };
}

/** Soft edges on all four sides (alpha), so a decal blends into the ground. */
function edgeMask() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const e = Math.min(x, 63 - x, y, 63 - y) / 14;
    const v = Math.round(255 * Math.min(1, e * e * (3 - 2 * Math.min(1, e))));
    img.data.set([v, v, v, 255], (y * 64 + x) * 4);
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

/**
 * Reflection environment for metal and foil: black sky above the horizon, sunlit
 * grey regolith below. That is what a shiny lander or instrument reflects on
 * the Moon (no sky light), so foil and metal no longer render black.
 */
function lunarEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float y = normalize(vP).y; gl_FragColor = vec4(vec3(0.36, 0.35, 0.33) * smoothstep(0.04, -0.2, y), 1.0); }',
  })));
  const env = pm.fromScene(sc, 0.02).texture;
  pm.dispose();
  return env;
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export { LUNAR_G };
