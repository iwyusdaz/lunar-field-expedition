/**
 * orbit.js — the orbit view (Module 1 and the title screen), in metres.
 *
 * The whole Moon from the NASA SVS CGI Moon Kit (LROC WAC colour, LOLA relief),
 * true radius 1,737.4 km. The Sun direction matches the morning Sun at Hadley,
 * so the day-night line (terminator) lies just west of the landing site, as on
 * the Apollo 15 landing day. The globe turns under the fixed Sun in time-lapse:
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
/** Selenographic lat/lon (deg) -> globe-local position (v2 mapping: 0 E faces -z, north is +y). */
export function globePoint(lat, lon, r = R) {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
  return new THREE.Vector3(r * Math.cos(p) * Math.sin(l), r * Math.sin(p), -r * Math.cos(p) * Math.cos(l));
}

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
    this.spin = -0.32;
    this.globe.rotation.y = this.spin;
    this.group.add(this.globe);
    // Sun: subsolar point on the equator, east of Hadley by the morning hour angle.
    const ls = SITE.lon + hourAngleForElevation(sunElevation);
    this.sunDir = globePoint(0, ls, 1).normalize();
    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.position.copy(this.sunDir).multiplyScalar(R * 4);
    this.group.add(this.sun, this.sun.target);
    this.group.add(new THREE.HemisphereLight(0x555a66, 0x111114, 0.06));
    // Landing-site cue: a glint at Hadley (labelled in the legend).
    this.siteGlint = createGlint('Landing site glint: Hadley, where Apollo 15 landed', { size: 90000 });
    this.siteGlint.position.copy(globePoint(SITE.lat, SITE.lon, R + 30000));
    this.globe.add(this.siteGlint);
    // Pick volumes: Mare Imbrium (centre 32.8 N, 15.6 W, about 1,146 km across) and the terminator band.
    this.imbrium = capMesh(32.8, -15.6, 18.9, 2500);
    this.imbrium.name = 'mare-imbrium';
    this.globe.add(this.imbrium);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 12000, R + 12000, 160000, 96, 1, true), pickMat()); // about 5 deg wide, above the highest relief
    band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.sunDir);
    band.name = 'terminator';
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
    if (!inspect.items.has('mare-imbrium')) inspect.register('mare-imbrium', this.imbrium, { frame: { look: true } });
    if (!inspect.items.has('terminator')) inspect.register('terminator', this.terminator, { frame: { look: true } });
  }

  addMotion(motion) {
    motion.add({
      id: 'globe-day', layer: 'sky', label: 'time-lapse', objects: ['moon-globe', 'terminator'],
      description: 'The Moon turns under the Sun once in about 10 minutes (time-lapse of the 29.5-day lunar day), so the day-night line creeps across the surface.',
      update: (dt) => { if (!this.group.visible) return; this.spin += dt * (Math.PI * 2 / 600); this.globe.rotation.y = this.spin; },
    });
  }

  /** The orbit camera view (rig spherical around the globe centre). */
  view() { return { target: [0, 0, 0], radius: R * 3.1, theta: Math.PI * 0.94, phi: Math.PI * 0.42 }; }
}
