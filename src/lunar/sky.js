/**
 * sky.js — the airless Hadley sky (plan 10 §6.1, decision 8: accuracy over spectacle).
 *
 * - Stars: the Yale Bright Star Catalogue (BSC5P, real positions, magnitudes and
 *   colours) to V 6.5. They never twinkle (no air). Their visibility follows a
 *   simple exposure model: they show when the view is mostly black sky and fade
 *   when sunlit ground or the Sun fills it, as in the Apollo photographs.
 * - Sun: a disc at its true angular size (0.53 deg), in the direction set by
 *   the hour angle (frame.js). It moves in time-lapse (motion system in surface.js).
 * - Earth: a sphere at its true angular size (1.9 deg), lit by the same Sun
 *   direction, so its phase is correct by construction. It spins (time-lapse)
 *   with a cloud layer that drifts over it. It stays at the same place in the
 *   sky: it never rises or sets at Hadley.
 * - Orbiter: the field team's orbiter (fictional mission) as a real-size
 *   command-and-service-module shape with the point of sunlight it shows from
 *   the ground. Its pass is time-compressed.
 *
 * Sky bodies sit on a shell that follows the camera, so they behave as if at
 * infinity; the shell radius is inside the camera's far plane. Sizes on the
 * shell keep the true angular diameters (ui-audit angular scale check).
 * @module lunar/sky
 */
import * as THREE from 'three';
import {
  earthDirection, sunDirectionForHourAngle, equatorialToWorldMatrix, earthAxis, bvToRgb,
  EARTH_DIAMETER_M, EARTH_DISTANCE_M, SUN_DIAMETER_M, SUN_DISTANCE_M, MOON_RADIUS_M,
} from './frame.js';
import { BASE, loadKTX2 } from './loaders.js';

export const SKY_RADIUS = { stars: 210_000, sun: 195_000, earth: 180_000, orbiter: 175_000 };
const ORBIT_ALT_M = 110_000;

function glowTexture(inner = 'rgba(255,250,240,0.9)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.2, 'rgba(255,245,230,0.35)');
  grad.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Surface detail for the orbiter's tiny real-size model (never more than a pixel or two). */
function orbiterTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#9aa0a6';
  for (let i = 0; i < 64; i += 8) g.fillRect(i, 0, 3, 32); // radiator panels
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const EARTH_VS = /* glsl */`
varying vec3 vN; varying vec3 vView;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
// The mesh never rotates (its bounding box stays a true sphere); the spin and
// the axis tilt are applied to the texture lookup instead (uEarthInv).
const EARTH_FS = /* glsl */`
uniform sampler2D uDay; uniform sampler2D uClouds; uniform vec3 uSun; uniform float uCloudShift; uniform float uHasTex; uniform mat3 uEarthInv;
varying vec3 vN; varying vec3 vView;
vec2 eqUv(vec3 e) { float u = atan(e.z, -e.x) / 6.2831853; return vec2(u < 0.0 ? u + 1.0 : u, 1.0 - acos(clamp(e.y, -1.0, 1.0)) / 3.1415927); }
void main() {
  vec3 n = normalize(vN);
  vec2 uv = eqUv(normalize(uEarthInv * n));
  float mu = dot(n, normalize(uSun));
  float day = smoothstep(-0.06, 0.12, mu);
  vec3 col = uHasTex > 0.5 ? texture2D(uDay, uv).rgb : vec3(0.18, 0.32, 0.55);
  float cloud = uHasTex > 0.5 ? texture2D(uClouds, vec2(fract(uv.x + uCloudShift), uv.y)).r : 0.0;
  float ocean = smoothstep(0.02, 0.12, col.b - max(col.r, col.g));
  vec3 h = normalize(normalize(uSun) + vView);
  float spec = pow(max(dot(n, h), 0.0), 60.0) * ocean * 0.6;
  col = mix(col, vec3(0.92), smoothstep(0.15, 0.85, cloud) * 0.75);
  float rim = pow(1.0 - max(dot(n, vView), 0.0), 3.0);
  vec3 lit = col * (0.25 + 1.05 * max(mu, 0.0)) * day + spec * day + vec3(0.25, 0.45, 1.0) * rim * day * 0.55;
  gl_FragColor = vec4(lit * 1.25, 1.0);
}`;
const SUN_VS = /* glsl */`varying vec3 vN; varying vec3 vView;
void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vView = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
// Limb darkening: the solar disc is dimmer and warmer toward its edge.
const SUN_FS = /* glsl */`varying vec3 vN; varying vec3 vView;
void main() { float mu = clamp(dot(normalize(vN), vView), 0.0, 1.0); float l = 0.55 + 0.45 * pow(mu, 0.6); gl_FragColor = vec4(vec3(1.0, 0.99, 0.97) * 6.0 * l, 1.0); }`;

const STAR_VS = /* glsl */`
attribute float aBright; attribute vec3 aColor;
uniform mat3 uEq; uniform float uRadius; uniform float uPx; uniform float uDip;
varying float vB; varying vec3 vC; varying float vUp;
void main() {
  vec3 d = uEq * position; // position holds the J2000 unit vector
  vUp = d.y + uDip;
  vB = aBright; vC = aColor;
  vec4 mv = modelViewMatrix * vec4(d * uRadius, 1.0);
  gl_PointSize = (1.0 + 1.9 * sqrt(aBright)) * uPx;
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FS = /* glsl */`
uniform float uVis;
varying float vB; varying vec3 vC; varying float vUp;
void main() {
  if (vUp < 0.0) discard; // below the horizon
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, r) * clamp(0.18 + sqrt(vB), 0.0, 1.0) * uVis;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC, a);
}`;

export class LunarSky {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.shell = new THREE.Group();
    this.shell.name = 'sky-shell';
    this.hourAngle = 76;
    this.sunDir = new THREE.Vector3(1, 0.2, 0).normalize();
    this.earthDir = new THREE.Vector3().copy(earthDirection());
    this.starVis = 0;
    this.earthSpin = 0;
    this.cloudShift = 0;
    this.orbiterPhase = 0.35; // 0..1 over one time-compressed cycle
    this._v = new THREE.Vector3();
    this._buildSun();
    this._buildEarth();
    this._buildOrbiter();
  }

  async load() {
    const [buf, earthTex] = await Promise.all([
      fetch(`${BASE}assets/v3/sky/stars-bsc5p.bin`).then((r) => r.arrayBuffer()),
      Promise.all([
        loadKTX2(this.renderer, 'assets/v3/sky/earth-day-2048.ktx2'),
        loadKTX2(this.renderer, 'assets/v3/sky/earth-clouds-2048.ktx2', { srgb: false }),
      ]).catch((e) => { console.warn('Earth textures not loaded:', e.message); return null; }),
    ]);
    this._buildStars(new Int16Array(buf));
    if (earthTex) {
      const u = this.earth.material.uniforms;
      u.uDay.value = earthTex[0];
      u.uClouds.value = earthTex[1];
      earthTex[1].wrapS = THREE.RepeatWrapping;
      u.uHasTex.value = 1;
    }
    this.setHourAngle(this.hourAngle);
    return this;
  }

  _buildStars(raw) {
    const n = raw.length / 5;
    const pos = [], bright = [], col = [];
    for (let i = 0; i < n; i++) {
      const m = raw[i * 5 + 3] / 100;
      if (m > 6.5) continue;
      pos.push(raw[i * 5] / 32767, raw[i * 5 + 1] / 32767, raw[i * 5 + 2] / 32767);
      bright.push(Math.min(1, 10 ** (-0.4 * (m - 0.5))));
      col.push(...bvToRgb(raw[i * 5 + 4] / 1000));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SKY_RADIUS.stars);
    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false,
      uniforms: { uEq: { value: new THREE.Matrix3() }, uRadius: { value: SKY_RADIUS.stars }, uPx: { value: 1 }, uVis: { value: 0 }, uDip: { value: 0.002 } },
    });
    this.stars = new THREE.Points(g, this.starMaterial);
    this.stars.name = 'starfield-points';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -2;
    this.stars.userData.noOutline = true;
    this.stars.raycast = () => {};
    this.shell.add(this.stars);
    this.starCount = pos.length / 3;
  }

  _buildSun() {
    const g = new THREE.Group();
    g.name = 'sun';
    const r = SKY_RADIUS.sun * Math.tan(Math.atan(SUN_DIAMETER_M / 2 / SUN_DISTANCE_M));
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 32), new THREE.ShaderMaterial({ vertexShader: SUN_VS, fragmentShader: SUN_FS }));
    this.sunDisc.renderOrder = -1;
    g.add(this.sunDisc);
    // Glare around the disc (a camera and eye effect, not a sky glow: there is no air).
    this.sunGlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, opacity: 0.55 }));
    this._glare0 = r * 2 * 7;
    this.sunGlare.scale.setScalar(this._glare0);
    this.sunGlare.userData.noOutline = true;
    this.sunGlare.raycast = () => {};
    this.sunGlare.renderOrder = -1;
    this.sun = g;
    this.shell.add(g, this.sunGlare);
  }

  _buildEarth() {
    const r = SKY_RADIUS.earth * Math.tan(Math.atan(EARTH_DIAMETER_M / 2 / EARTH_DISTANCE_M));
    const mat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VS, fragmentShader: EARTH_FS,
      uniforms: { uDay: { value: null }, uClouds: { value: null }, uSun: { value: this.sunDir }, uCloudShift: { value: 0 }, uHasTex: { value: 0 }, uEarthInv: { value: new THREE.Matrix3() } },
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 40), mat);
    this.earth.name = 'earth';
    this.earthRadius = r;
    this.shell.add(this.earth);
  }

  _buildOrbiter() {
    // Command and service module at real size (3.9 m wide, 11 m long), seen from
    // the ground only as the point of sunlight it reflects.
    const g = new THREE.Group();
    g.name = 'orbiter';
    const mat = new THREE.MeshStandardMaterial({ map: orbiterTexture(), metalness: 0.6, roughness: 0.4 });
    const sm = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 7.5, 16), mat);
    sm.position.y = -1.6;
    const cm = new THREE.Mesh(new THREE.ConeGeometry(1.95, 3.5, 16), mat);
    cm.position.y = 3.9;
    const body = new THREE.Group();
    body.add(sm, cm);
    body.rotation.z = Math.PI / 2; // long axis east-west, along the pass (the group never turns: its box stays true)
    g.add(body);
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)'), transparent: true, depthWrite: false, sizeAttenuation: false }));
    glint.scale.setScalar(0.011);
    glint.userData.noOutline = true;
    glint.raycast = () => {};
    g.add(glint);
    // Pick volume so a click on the point of light reaches the card (invisible).
    const pick = new THREE.Mesh(new THREE.SphereGeometry(1.9, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    pick.userData.noOutline = true;
    g.add(pick);
    this.orbiterPick = pick;
    this.orbiter = g;
    this.shell.add(g);
  }

  /** Sun hour angle (deg): moves the Sun, the stars and Earth's lighting together. */
  setHourAngle(h) {
    this.hourAngle = h;
    this.sunDir.copy(sunDirectionForHourAngle(h)).normalize();
    if (this.starMaterial) {
      const m = equatorialToWorldMatrix(h);
      this.starMaterial.uniforms.uEq.value.set(m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]);
    }
    const ax = earthAxis(h);
    this._earthAxis = new THREE.Vector3(ax.x, ax.y, ax.z).normalize();
  }

  get sunElevationDeg() { return THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y)); }

  /**
   * Orbiter direction for a cycle phase (0..1). The first 2/3 of the cycle is
   * the pass from the eastern to the western horizon; the rest is below it.
   */
  orbiterDirection(phase, out = new THREE.Vector3()) {
    const pass = 2 / 3;
    const u = phase / pass; // 0..1 during the pass
    const R = MOON_RADIUS_M, Rh = R + ORBIT_ALT_M;
    const span = 0.52; // orbit angle (rad) from horizon to horizon, about +-15 deg of orbit
    const a = (u - 0.5) * span;
    const off = 0.012; // the ground track passes about 20 km south of the site
    // Orbit point relative to the site (site at (0, R, 0)); east = +x, south = +z.
    const px = -Rh * Math.sin(a) * Math.cos(off), py = Rh * Math.cos(a) * Math.cos(off) - R, pz = Rh * Math.sin(off);
    out.set(-px, py, pz); // moves from east (+x) to west (-x)
    this._orbiterVisible = u >= 0 && u <= 1 && py > 0;
    return out.normalize();
  }

  /** Per frame: follow the camera, star exposure, Earth spin, orbiter. */
  update(dt, camera, { reduced = false, sunVisible = true } = {}) {
    const cp = camera.getWorldPosition(this._v);
    this.shell.position.copy(cp);
    // Sun disc and glare: billboards on the shell.
    this.sun.position.copy(this.sunDir).multiplyScalar(SKY_RADIUS.sun);
    this.sunGlare.position.copy(this.sun.position);
    this.sun.visible = this.sunGlare.visible = sunVisible && this.sunDir.y > -0.01;
    // Glare is a lens and eye effect: it keeps its size on screen when the view narrows.
    this.sunGlare.scale.setScalar(this._glare0 * Math.min(1, camera.fov / 60));
    // Earth: fixed place in the sky, spin axis from the celestial pole.
    this.earth.position.copy(this.earthDir).multiplyScalar(SKY_RADIUS.earth);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._earthAxis || new THREE.Vector3(0, 1, 0));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.earthSpin));
    this.earth.material.uniforms.uEarthInv.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q.invert()));
    this.earth.material.uniforms.uCloudShift.value = this.cloudShift;
    // Orbiter
    const od = this.orbiterDirection(this.orbiterPhase);
    this.orbiter.position.copy(od).multiplyScalar(SKY_RADIUS.orbiter);
    this.orbiter.visible = this._orbiterVisible;
    // Stars: exposure from how much of the view is sunlit ground or Sun.
    if (this.starMaterial) {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const fovV = THREE.MathUtils.degToRad(camera.fov);
      const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      const ground = THREE.MathUtils.clamp(0.5 - pitch / fovV, 0, 1);
      const sunlit = THREE.MathUtils.smoothstep(this.sunDir.y, -0.02, 0.05);
      const diag = Math.atan(Math.tan(fovV / 2) * Math.hypot(1, camera.aspect));
      const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(this.sunDir), -1, 1));
      const glare = this.sun.visible ? 1 - THREE.MathUtils.smoothstep(ang, Math.max(0.05, diag - 0.1), diag + 0.15) : 0;
      const target = THREE.MathUtils.clamp(1 - 1.7 * ground * sunlit, 0, 1) * (1 - 0.9 * glare * sunlit);
      this.starTarget = Math.max(0, target);
      this.starVis = reduced ? this.starTarget : this.starVis + (this.starTarget - this.starVis) * (1 - Math.exp(-dt / 0.9));
      const u = this.starMaterial.uniforms;
      u.uVis.value = this.starVis;
      u.uPx.value = this.renderer.getPixelRatio();
      const h = Math.max(1, cp.y - (this.groundY ?? cp.y - 2));
      u.uDip.value = Math.sqrt(2 * h / MOON_RADIUS_M);
    }
  }
}

/** Glow texture, shared with the micrometeoroid flash. */
export { glowTexture };
