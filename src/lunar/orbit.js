/**
 * orbit.js — the orbit view (Module 1 and the title screen), in metres.
 *
 * The whole Moon from the NASA SVS CGI Moon Kit (LROC WAC colour, LOLA relief),
 * true radius 1,737.4 km. The Sun direction matches the morning Sun at Hadley
 * during the Apollo 15 surface stay (main.js: about 34 deg up, as on the third
 * EVA; 12 deg at landing), so the day-night line (terminator) lies west of
 * Mare Imbrium. The globe turns under the fixed Sun in time-lapse:
 * that is the lunar day passing, so the terminator creeps across the surface.
 * Stars: the same BSC5P catalogue as the surface sky.
 * @module lunar/orbit
 */
import * as THREE from 'three';
import { loadJSON, loadTexture } from '../core/assets.js';
import { createGlint } from '../v3/inspect.js';
import { BASE } from './loaders.js';
import { hourAngleForElevation, MOON_RADIUS_M, SITE, bvToRgb } from './frame.js';

const R = MOON_RADIUS_M;
/**
 * Selenographic lat/lon (deg) -> globe-local position, in the frame of three's
 * SphereGeometry with an equirectangular map: 0 E faces +x, 90 E faces -z,
 * north is +y. (The v2 formula swapped the axes, so lon landed on texture
 * longitude 90 - lon; tests/unit/lunar-v3.test.js samples the sphere's UV.)
 */
export function globePoint(lat, lon, r = R) {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
  return new THREE.Vector3(r * Math.cos(p) * Math.cos(l), r * Math.sin(p), -r * Math.cos(p) * Math.sin(l));
}

/** Start spin (rad): Hadley a little left of the view centre, near side toward the camera. */
export const START_SPIN = 1.14;

function pickMat() { return new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }); }

/** A spherical cap (pick volume) centred on lat/lon with an angular radius (deg). */
function capMesh(lat, lon, radDeg, lift) {
  const g = new THREE.SphereGeometry(R + lift, 32, 8, 0, Math.PI * 2, 0, radDeg * Math.PI / 180);
  const m = new THREE.Mesh(g, pickMat());
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), globePoint(lat, lon, 1).normalize());
  return m;
}

export class OrbitScene {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'orbit-view';
    this.spin = 0;
  }

  async load(sunElevation = 12) {
    const meta = await loadJSON('assets/globe/displacement-1k.meta.json');
    const span = meta.elevMax - meta.elevMin;
    const disp = new THREE.TextureLoader().load(`${BASE}assets/globe/displacement-1k.png`);
    this.material = new THREE.MeshStandardMaterial({
      map: loadTexture('assets/globe/lroc-color-2k.jpg'), displacementMap: disp,
      displacementScale: span, displacementBias: meta.elevMin, roughness: 0.97, metalness: 0,
    });
    this.globe = new THREE.Group(); this.globe.name = 'moon-globe';
    const moon = new THREE.Mesh(new THREE.SphereGeometry(R, 384, 192), this.material);
    moon.userData.noOutline = true;
    this.globe.add(moon);
    // Start with the near side toward the camera and Hadley a little left of centre.
    this.spin = START_SPIN;
    this.globe.rotation.y = this.spin;
    this.group.add(this.globe);
    // Sun: subsolar point on the equator, east of Hadley by the morning hour
    // angle, on the globe as it starts (the Sun then stays fixed while the globe turns).
    const ls = SITE.lon + hourAngleForElevation(sunElevation);
    this.sunDir = globePoint(0, ls, 1).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), START_SPIN);
    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.position.copy(this.sunDir).multiplyScalar(R * 4);
    this.group.add(this.sun, this.sun.target);
    this.group.add(new THREE.HemisphereLight(0x555a66, 0x111114, 0.06));
    // Earthshine: sunlight reflected by Earth dimly lights the near side's
    // night half. Earth stays over the near side (0 N, 0 E), so the light turns
    // with the globe. Brightness illustrative (far brighter than real, so the eye can see it).
    this.earthshine = new THREE.DirectionalLight(0xb8c6e0, 0.22);
    this.earthshine.position.copy(globePoint(0, 0, R * 4));
    this.earthshine.target.position.set(0, 0, 0);
    this.globe.add(this.earthshine, this.earthshine.target);
    // Landing-site cue: a glint at Hadley (labelled in the legend).
    this.siteGlint = createGlint('Landing site glint: Hadley, where Apollo 15 landed', { size: 90000 });
    this.siteGlint.position.copy(globePoint(SITE.lat, SITE.lon, R + 30000));
    this.globe.add(this.siteGlint);
    // Pick volumes: Mare Imbrium (centre 32.8 N, 15.6 W, about 1,146 km across) and the terminator band.
    this.imbrium = capMesh(32.8, -15.6, 18.9, 2500);
    this.imbrium.name = 'mare-imbrium';
    this.globe.add(this.imbrium);
    // A thin line round the basin rim, shown while Mare Imbrium is the practice
    // target or its card is open (legend: "Mare Imbrium outline").
    const rim = [];
    const c = globePoint(32.8, -15.6, 1).normalize();
    const e1 = new THREE.Vector3(0, 1, 0).cross(c).normalize(), e2 = c.clone().cross(e1);
    const a = 18.9 * Math.PI / 180;
    for (let i = 0; i <= 128; i++) {
      const t = (i / 128) * Math.PI * 2;
      rim.push(c.clone().multiplyScalar(Math.cos(a)).addScaledVector(e1, Math.sin(a) * Math.cos(t)).addScaledVector(e2, Math.sin(a) * Math.sin(t)).multiplyScalar(R + 9000));
    }
    this.imbriumRim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rim), new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 }));
    this.imbriumRim.userData.marker = { label: 'Mare Imbrium outline' };
    this.imbriumRim.raycast = () => {};
    this.imbriumRim.visible = false;
    this.globe.add(this.imbriumRim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 12000, R + 12000, 160000, 96, 1, true), pickMat()); // about 5 deg wide, above the highest relief
    band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.sunDir);
    band.name = 'terminator';
    band.userData.noOutline = true; // a pick band: its outline would draw bars at the poles
    this.terminator = band;
    this.group.add(band);
    await this._stars();
    return this;
  }

  async _stars() {
    const raw = new Int16Array(await fetch(`${BASE}assets/v3/sky/stars-bsc5p.bin`).then((r) => r.arrayBuffer()));
    const pos = [], col = [];
    for (let i = 0; i < raw.length / 5; i++) {
      const m = raw[i * 5 + 3] / 100;
      if (m > 6.0) continue;
      const k = 3.0e7;
      // equatorial -> ecliptic (lunar pole close to the ecliptic pole); ecliptic north = +y here
      const x = raw[i * 5] / 32767, y = raw[i * 5 + 1] / 32767, z = raw[i * 5 + 2] / 32767;
      const e = 23.44 * Math.PI / 180;
      const ye = y * Math.cos(e) + z * Math.sin(e), ze = -y * Math.sin(e) + z * Math.cos(e);
      pos.push(ye * k, ze * k, -x * k);
      const b = Math.min(1, 10 ** (-0.4 * (m - 0.5)));
      const c = bvToRgb(raw[i * 5 + 4] / 1000).map((v) => v * (0.25 + 0.75 * Math.sqrt(b)));
      col.push(...c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }));
    pts.frustumCulled = false;
    pts.raycast = () => {};
    this.stars = pts;
    this.group.add(pts);
  }

  register(inspect) {
    for (const o of [this.globe, this.imbrium, this.terminator]) o.userData.scaleFrame = 'local';
    if (!inspect.items.has('moon-globe')) inspect.register('moon-globe', this.globe, { frame: { look: true, heightFrac: 0.6 } });
    const cam = inspect.camera;
    // Imbrium: a telephoto view of the whole dark basin (about 1,150 km across)
    // edge to edge with a margin, its rim outlined while the card is open (review pass 2 F5).
    const imbriumView = () => {
      const c = this.globe.localToWorld(globePoint(32.8, -15.6, R));
      const d = cam.position.distanceTo(c);
      return { eye: cam.position.toArray(), center: c.toArray(), fov: THREE.MathUtils.radToDeg(2 * Math.atan(1146000 / 2 / d)) / 0.55 };
    };
    if (!inspect.items.has('mare-imbrium')) inspect.register('mare-imbrium', this.imbrium, { frame: { view: imbriumView } });
    if (!this._cueBound) {
      this._cueBound = true;
      const show = () => { this.imbriumRim.visible = inspect.cued === 'mare-imbrium' || inspect.selected === 'mare-imbrium'; };
      inspect.on('cue', show); inspect.on('open', show); inspect.on('close', show);
    }
    // Terminator: the day-night line where it crosses the side facing the
    // camera, framed wide enough to show it curving across the disc, the lit
    // side and the earthshine-lit night side (review pass 2 F10).
    // The camera moves round to where the Sun is side-on (half-moon phase), so
    // the line runs across the middle of the disc instead of along its edge.
    const terminatorView = () => {
      const dist = cam.position.length();
      const d = cam.position.clone().normalize();
      const n = d.addScaledVector(this.sunDir, -d.dot(this.sunDir)).normalize();
      const eye = n.clone().multiplyScalar(dist);
      const p = n.clone().multiplyScalar(R);
      return { eye: eye.toArray(), center: p.toArray(), fov: THREE.MathUtils.radToDeg(2 * Math.atan(0.8 * R / eye.distanceTo(p))) };
    };
    if (!inspect.items.has('terminator')) inspect.register('terminator', this.terminator, { frame: { view: terminatorView } });
  }

  addMotion(motion) {
    motion.add({
      id: 'globe-day', layer: 'sky', label: 'time-lapse', objects: ['moon-globe', 'terminator', 'mare-imbrium'],
      description: 'The Moon turns under the Sun once in about 10 minutes (time-lapse of the 29.5-day lunar day), so the day-night line creeps across the surface.',
      update: (dt) => { if (!this.group.visible) return; this.spin += dt * (Math.PI * 2 / 600); this.globe.rotation.y = this.spin; },
    });
  }

  /** Per frame: the site glint keeps its start-view screen size when the view narrows. */
  update(camera) {
    if (!this.group.visible || !this.siteGlint) return;
    const d = camera.position.distanceTo(this.siteGlint.getWorldPosition(this._gp || (this._gp = new THREE.Vector3())));
    const k = (d / (R * 2.1)) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(Math.PI / 6);
    this.siteGlint.scale.setScalar(90000 * Math.min(1, k));
  }

  /** Back to the start orientation (entering the orbit view again). */
  resetSpin() { this.spin = START_SPIN; if (this.globe) this.globe.rotation.y = this.spin; }

  /** The orbit camera view (rig spherical around the globe centre). */
  view() { return { target: [0, 0, 0], radius: R * 3.1, theta: Math.PI * 0.94, phi: Math.PI * 0.42 }; }
}
