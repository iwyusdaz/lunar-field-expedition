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

  update() { this.frame(); }
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
