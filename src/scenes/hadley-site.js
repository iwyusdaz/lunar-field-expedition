/**
 * Hadley site scene: the local play area at the Apollo 15 landing site.
 * Terrain from the real LROC DTM (scenes/terrain.js), sun-angle-driven
 * DirectionalLight with real-scale shadows, dim starfield, Earth at its
 * approximate sky position, and a sun disc. All positions follow
 * 1 unit = 1 metre; no vertical exaggeration.
 * @module scenes/hadley-site
 */
import * as THREE from 'three';
import { TerrainField } from './terrain.js';
import { loadTexture } from '../core/assets.js';
import { sunDirection } from '../systems/sun-model.js';
import { AmbientLifeManager } from '../v2/ambient-life.js';
import { createAnimatedCharacter } from '../v2/stylized-character.js';
import { ModelLibrary } from '../v2/model-placer.js';
import { buildLunarModule, buildRover, buildFlag, createDustBurst } from './hadley-props.js';

const BASE = import.meta.env.BASE_URL || './';

/** Earth's approximate sky direction at the site: ~64° elevation, due south.
 *  Derived (approximate) — see research/apollo15-facts.md. */
const EARTH_ELEV_DEG = 64;
const EARTH_AZ_DEG = 180; // 0 = north (+z north is -z here), 90 = east

export class HadleySite {
  /**
   * @param {import('../core/engine.js').Engine} engine
   * @param {string} presetName
   */
  constructor(engine, presetName) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'hadley-site';
    this.terrain = new TerrainField();
    this.group.add(this.terrain.group);
    this._buildLights();
    this._buildSky();
    this.presetName = presetName;
    this.quality = engine.quality;
    this.quality.onChange(() => this.applyQuality());
    this._sun = { elevationDeg: 12, azimuthDeg: 90 }; // near-sunrise default (low sun reveals relief)
    this._target = new THREE.Vector3(3600, 0, 5800); // near the landing site; refined after load
    this.applyQuality();
  }

  async load() {
    await this.terrain.load(this.presetName);
    const lm = this.terrain.fromLonLat(3.6333, 26.13239);
    const lmElev = this.terrain.elevationAt(lm.xM, lm.yM);
    this._target.set(lm.xM, (Number.isNaN(lmElev) ? -1924 : lmElev), lm.yM);
    this.setSun(this._sun.elevationDeg, this._sun.azimuthDeg);
    return this;
  }

  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -1300; c.right = 1300; c.top = 1300; c.bottom = -1300;
    c.near = 1; c.far = 9000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 2.5; // metres-scale terrain needs a large normal bias
    this.group.add(this.sun);
    this.group.add(this.sun.target);
    // Night-side fill: earthshine + regolith interreflection, kept very low so
    // shadowed relief still reads without washing out the hard shadows.
    this.ambient = new THREE.HemisphereLight(0x8a93a5, 0x2c2c30, 0.16);
    this.group.add(this.ambient);
  }

  _buildSky() {
    // Stars: a few thousand dim points on a far sphere (cameras at the site would
    // capture stars only with long exposures; they are dimmed per the realism matrix).
    const N = 2600;
    const pos = new Float32Array(N * 3);
    const mag = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // uniform on sphere
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = 15000 * s * Math.cos(t);
      pos[i * 3 + 1] = Math.abs(15000 * u) * 0.6 + 200; // keep most above the horizon plane
      pos[i * 3 + 2] = 15000 * s * Math.sin(t);
      mag[i] = 0.35 + Math.pow(Math.random(), 3) * 1.3; // most stars dim
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    this.stars = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uDim: { value: 0.55 } },
      vertexShader: `
        attribute float aMag; varying float vMag; uniform float uDim;
        void main(){ vMag = aMag * uDim;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(120.0 / -mv.z * (0.6 + aMag), 0.5, 2.6);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vMag;
        void main(){ float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.12, d) * vMag;
          gl_FragColor = vec4(vec3(0.92, 0.94, 1.0), a); }`,
    }));
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Sun disc (physically motivated: the light source is visible).
    const sunTex = _discTexture('#ffffff', 1.0);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0.95,
    }));
    this.sunSprite.scale.set(700, 700, 1);
    this.group.add(this.sunSprite);

    // Earth: small textured sphere at a reduced distance with the real angular
    // size (~1.9°). Radius/distance ratio preserves the angular diameter.
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(260, 48, 32),
      new THREE.MeshStandardMaterial({ map: loadTexture('assets/sky/earth-bluemarble-1k.jpg'), roughness: 0.9 }),
    );
    const dir = sunDirection(EARTH_ELEV_DEG, EARTH_AZ_DEG);
    this.earthDir = new THREE.Vector3(dir.x, dir.y, dir.z);
    this.earth.position.copy(this.earthDir).multiplyScalar(13500); // angular size ≈ 2°
    this.earth.rotation.y = -Math.PI / 2; // face the site with the near side
    this.group.add(this.earth);
  }

  /** Sun elevation (deg above horizon) and azimuth (0 = north, clockwise). */
  setSun(elevationDeg, azimuthDeg) {
    this._sun = { elevationDeg, azimuthDeg };
    const d = sunDirection(elevationDeg, azimuthDeg);
    this.sunDir = new THREE.Vector3(d.x, d.y, d.z);
    const t = this._target;
    this.sun.position.copy(t).addScaledVector(this.sunDir, 3500);
    this.sun.target.position.copy(t);
    this.sunSprite.position.copy(t).addScaledVector(this.sunDir, 14000);
    this.sunSprite.visible = elevationDeg > 2;
    this.stars.material.uniforms.uDim.value = elevationDeg > 25 ? 0.35 : 0.6;
  }

  /** Keep the shadow frustum on the area the camera is looking at. */
  frame() {
    const cam = this.engine.camera;
    const t = cam.getWorldDirection(new THREE.Vector3());
    const focus = cam.position.clone().addScaledVector(t, Math.min(1500, cam.position.distanceTo(this._target)));
    focus.y = this.terrain.ready ? this.terrain.elevationAt(focus.x, focus.z) || focus.y - 50 : focus.y - 50;
    this._target.copy(focus);
    // Close to the ground (crew/LM views) the 2.6 km shadow frustum gives ~1.3 m
    // texels; shrink it with camera distance so props cast crisp shadows.
    const half = THREE.MathUtils.clamp(cam.position.distanceTo(focus) * 1.4, 60, 1300);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - half) > half * 0.15) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    this.setSun(this._sun.elevationDeg, this._sun.azimuthDeg);
  }

  applyQuality() {
    const p = this.quality.presetDef;
    if (!p) return;
    this.sun.castShadow = p.shadowMapSize > 0;
    if (p.shadowMapSize > 0 && this.sun.shadow.mapSize.x !== p.shadowMapSize) {
      this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.terrain.ready) {
      this.terrain.setQuality(this.quality.name);
      if (this.quality.name === 'low') this.terrain.useCoarseNormalMap();
      this._groundAll?.();
    }
    this.stars.visible = true;
    this.engine.camera.far = 20000;
    this.engine.camera.updateProjectionMatrix();
  }

  /** Raycast a pointer event into the terrain (tools). Returns metric {xM, yM, elev} or null. */
  pickTerrain(ndcX, ndcY) {
    if (!this.terrain.mesh) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.engine.camera);
    const hit = ray.intersectObject(this.terrain.mesh, false)[0];
    if (!hit) return null;
    const p = hit.point;
    return { xM: p.x, yM: p.z, elev: p.y, world: p.clone() };
  }

  /**
   * Labelled feature marker: a screen-size pin sprite (sizeAttenuation off), so it
   * stays the same size on screen at any camera distance (a 6 m cone was
   * sub-pixel at 1400 m). `label` is a short neutral tag such as "A"; the POI
   * list is the keyboard equivalent.
   */
  addMarker(id, xM, yM, label = '', color = '#ffd24a') {
    this.removeMarker(id);
    const e = this.terrain.elevationAt(xM, yM);
    const mat = new THREE.SpriteMaterial({ map: makeLabelTexture(label, color, 'pin'), depthTest: false, transparent: true, sizeAttenuation: false });
    const s = new THREE.Sprite(mat);
    s.center.set(0.5, 0); // pin tip sits on the ground point
    s.scale.set(0.045, 0.06, 1); // fraction of the viewport height
    s.position.set(xM, (Number.isNaN(e) ? -1900 : e) + 2, yM);
    s.renderOrder = 10;
    s.name = `marker-${id}`;
    this.group.add(s);
    return s;
  }

  /** Screen-size text tag (e.g. the "80 m" scale label); caller positions it. */
  makeLabel(text, color = '#ffffff') {
    const mat = new THREE.SpriteMaterial({ map: makeLabelTexture(text, color, 'tag'), depthTest: false, transparent: true, sizeAttenuation: false });
    const s = new THREE.Sprite(mat);
    s.center.set(0.5, 0);
    s.scale.set(0.09, 0.03, 1);
    s.renderOrder = 11;
    return s;
  }

  removeMarker(id) {
    const old = this.group.getObjectByName(`marker-${id}`);
    if (!old) return;
    this.group.remove(old);
    old.material.map?.dispose();
    old.material.dispose();
  }

  clearMarkers() {
    for (const child of [...this.group.children]) {
      if (child.name?.startsWith('marker-')) this.removeMarker(child.name.slice(7));
    }
  }

  update(dt = 0.016) {
    this.frame();
    if (this.life) this.life.update(dt, this.engine.camera);
  }

  // ---------- v2.0.0 living site ---------------------------------------------------

  /**
   * Exact height of the rendered terrain mesh at (x, z): bilinear on the DTM is
   * not the same surface as the triangulated mesh (20 m cells on Medium), so
   * props grounded with elevationAt() would float or sink by up to a metre.
   * This follows the mesh's own triangle split (a,c,b / b,c,d).
   */
  meshHeightAt(x, z) {
    const g = this.terrain.grid;
    const step = this.terrain._currentStep || 2;
    if (!g) return NaN;
    const cell = step * g.mPerPx;
    const ix = Math.floor(x / cell), iy = Math.floor(z / cell);
    const fx = x / cell - ix, fz = z / cell - iy;
    const at = (cx, cy) => g.data[Math.min(g.height - 1, Math.max(0, cy * step)) * g.width + Math.min(g.width - 1, Math.max(0, cx * step))];
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Landing-site position in world metres (fixed; `_target` follows the camera). */
  get lmPos() { return this._lm; }

  /**
   * Build the close-range living layer around the landing site: Poly Haven boulders,
   * procedural LM descent stage / rover / flag, two suited crew and ambient life.
   * Everything sits ON the real terrain (grounded to the mesh); the DTM is untouched.
   * @param {{ reducedMotion?: boolean }} [opts]
   */
  async buildLiving({ reducedMotion = false } = {}) {
    const lm = this.terrain.fromLonLat(3.6333, 26.13239);
    this._lm = new THREE.Vector3(lm.xM, 0, lm.yM);
    const v2 = new THREE.Group();
    v2.name = 'v2-living-site';
    this.v2 = v2;
    this.group.add(v2);
    this._grounded = [];
    const L = this._lm;
    const put = (obj, dx, dz, sink = 0) => {
      obj.position.set(L.x + dx, 0, L.z + dz);
      this._grounded.push({ obj, sink });
      v2.add(obj);
      return obj;
    };

    this.lmProp = put(buildLunarModule(), 0, 0, 0.05);
    this.lmProp.rotation.y = 0.35;
    this.flag = put(buildFlag(), -9, 8, 0.25);
    this.flag.rotation.y = -0.6;
    const rover = buildRover();
    this.rover = put(rover.group, 30, 0, 0);
    this.roverWheels = rover.wheels;

    // Crew (future-mission field team, consistent with the fictional-mission label)
    const suit = {
      outfit: 'spacesuit', hairStyle: 'helmet', height: 1.86,
      topColor: 0xeceae4, bottomColor: 0xe2dfd8, shoeColor: 0xc9c4ba,
      skinColor: 0xe6e2da, accentColor: 0xd9d4ca,
    };
    this.crewA = createAnimatedCharacter({ ...suit, id: 'crew-a', name: 'Crew member A' });
    put(this.crewA.root, 5.4, 3.2, 0.02);
    this.crewA.root.rotation.y = 2.2;
    this.crewB = createAnimatedCharacter({ ...suit, id: 'crew-b', name: 'Crew member B', accentColor: 0xb22234 });
    put(this.crewB.root, 4, 5, 0.02);

    this._groundAll();

    // Ambient life
    this.life = new AmbientLifeManager(v2, { reducedMotion, seed: 1971 });
    this.life.addCharacter(this.crewA);
    this.life.addCharacter(this.crewB);
    this.life.addOscillator(this.earth, { mode: 'spin', axis: 'y', amplitude: 0.025 });
    this.life.addSplineMover(this.rover, _loop(L.x + 22, L.z, 9, 10), {
      closed: true, speed: 2.2, wheels: this.roverWheels, stopRadius: 0, startU: 0.5,
    });
    this.dust = createDustBurst(180);
    v2.add(this.dust.points);
    const ground = (x, z) => this.meshHeightAt(x, z);
    const back = new THREE.Vector3();
    let emitAcc = 0;
    const prevRover = this.rover.position.clone();
    this.dust.points.visible = !reducedMotion; // frozen grains would hang mid-air (M-2)
    const dustBase = this.dust.points.material.opacity;
    this.life.addUpdater((dt, _t, calm = 1) => {
      // calm mode dims the dust with the rest of the ambient motion (M-1)
      this.dust.points.material.opacity = dustBase * (0.2 + 0.8 * calm);
      // rover follows the mesh surface; rear wheels throw ballistic dust while it moves
      const r = this.rover.position;
      r.y = ground(r.x, r.z);
      const moved = Math.hypot(r.x - prevRover.x, r.z - prevRover.z);
      prevRover.copy(r);
      emitAcc += moved * 6;
      if (emitAcc >= 1) {
        for (const w of [this.roverWheels[2], this.roverWheels[3]]) {
          w.getWorldPosition(back);
          back.sub(v2.position);
          back.y = ground(back.x, back.z);
          this.dust.emit(back, Math.floor(emitAcc / 2) + 1, this.life.rng);
        }
        emitAcc = 0;
      }
      this.dust.update(dt, ground);
    });
    this._buildWalker(ground);

    // Close-range boulders (Poly Haven CC0), grounded and varied
    this.rocks = [];
    this.models = new ModelLibrary();
    const ids = ['moon_rock_01', 'moon_rock_02', 'moon_rock_03'];
    const rng = this.life.rng;
    const spots = [];
    let guard = 0;
    while (spots.length < 12 && guard++ < 200) {
      const ang = rng() * Math.PI * 2, rad = 7 + rng() * 38;
      const dx = Math.cos(ang) * rad, dz = Math.sin(ang) * rad;
      const dRover = Math.hypot(dx - 22, dz);
      if (dRover > 6 && dRover < 13) continue; // keep the rover loop clear
      if (Math.hypot(dx + 4.5, dz - 10.5) < 5) continue; // and the crew walk
      spots.push([dx, dz]);
    }
    await Promise.all(spots.map(async ([dx, dz], i) => {
      const h = 0.3 + Math.pow(rng(), 2) * 1.3;
      const w = await this.models.place(v2, ids[i % 3], { targetHeight: h, rotationY: rng() * Math.PI * 2, position: [L.x + dx, 0, L.z + dz] });
      if (!w) return;
      w.traverse((c) => { if (c.isMesh && c.name !== 'v2-contact-shadow') c.material = c.material.clone(); });
      w.rotation.x = (rng() - 0.5) * 0.25;
      w.userData.rockHeight = h;
      this._grounded.push({ obj: w, sink: h * 0.18 });
      this.rocks.push(w);
    }));
    this._groundAll();
    return this;
  }

  /** Crew member B walks a short path to a viewpoint, points at the Front, walks back. */
  _buildWalker(ground) {
    const L = this._lm;
    const pts = [[4, 5], [1, 9], [-3, 12], [-7, 15], [-11, 16]].map(([dx, dz]) => new THREE.Vector3(L.x + dx, 0, L.z + dz));
    const curve = new THREE.CatmullRomCurve3(pts);
    const len = curve.getLength();
    const st = { phase: 'walk', u: 0, dir: 1, hold: 0 };
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    const c = this.crewB;
    this._walker = st;
    const place = () => {
      curve.getPointAt(st.u, p);
      curve.getTangentAt(st.u, t);
      if (st.dir < 0) t.negate();
      c.root.position.set(p.x, ground(p.x, p.z) - 0.02, p.z);
      c.root.rotation.y = Math.atan2(t.x, t.z);
    };
    place();
    c.setAction('walk');
    this.life.addUpdater((dt) => {
      if (st.phase === 'walk') {
        st.u += (st.dir * 0.85 * dt) / len;
        if (st.u >= 1 || st.u <= 0) {
          st.u = THREE.MathUtils.clamp(st.u, 0, 1);
          st.phase = st.dir > 0 ? 'point' : 'rest';
          st.hold = st.dir > 0 ? 6 : 4;
          c.setAction(st.dir > 0 ? 'point' : 'idle');
          if (st.dir > 0) c.root.rotation.y = 2.6; // face south-east, toward the Apennine Front
          return;
        }
        place();
      } else {
        st.hold -= dt;
        if (st.hold <= 0) {
          st.dir = st.phase === 'point' ? -1 : 1;
          st.phase = 'walk';
          c.setAction('walk');
          place();
        }
      }
    });
  }

  /** Re-ground every v2 prop on the current mesh (the mesh is rebuilt per preset). */
  _groundAll() {
    for (const { obj, sink } of this._grounded || []) {
      const y = this.meshHeightAt(obj.position.x, obj.position.z);
      if (!Number.isNaN(y)) obj.position.y = y - sink;
    }
  }

  setCalmMode(on) { this.life?.setCalmMode(on); }

  setReducedMotion(on) {
    this.life?.setReducedMotion(on);
    // Ambient updates stop under reduced motion, so in-flight dust would freeze
    // in mid-air: drop it and hide the points until motion resumes (M-2).
    if (this.dust) {
      if (on) this.dust.clear();
      this.dust.points.visible = !on;
    }
  }
}

/** Closed elliptical loop (rover drive) as CatmullRom waypoints. */
function _loop(cx, cz, rx, rz, n = 10) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(new THREE.Vector3(cx + Math.cos(a) * rx, 0, cz + Math.sin(a) * rz));
  }
  return out;
}

function _discTexture(color, intensity) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, 'rgba(255,250,240,0.9)');
  grad.addColorStop(1, 'rgba(255,245,220,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Canvas texture for screen-size labels. shape 'pin' draws a map pin with the
 * label inside; 'tag' draws a rounded label box. Dark outline on a bright fill
 * keeps contrast on both the dark mare and the bright Front.
 */
export function makeLabelTexture(label, color = '#ffd24a', shape = 'pin') {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (shape === 'pin') {
    c.width = 96; c.height = 128;
    g.lineWidth = 6;
    g.strokeStyle = '#111';
    g.fillStyle = color;
    g.beginPath();
    g.arc(48, 44, 38, Math.PI * 0.8, Math.PI * 2.2);
    g.lineTo(48, 124);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#111';
    g.font = 'bold 50px system-ui, sans-serif';
  } else {
    c.width = 192; c.height = 64;
    g.fillStyle = 'rgba(17,17,17,0.85)';
    g.fillRect(0, 0, 192, 64);
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.strokeRect(2, 2, 188, 60);
    g.fillStyle = color;
    g.font = 'bold 36px system-ui, sans-serif';
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, c.width / 2, shape === 'pin' ? 46 : 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { BASE as _base };
