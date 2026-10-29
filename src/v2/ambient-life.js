/**
 * ambient-life.js — Living World & Calm-Mode Ambient Animation System (v2.0.0).
 *
 * Keeps every 3D scene visibly alive at all times while respecting cognitive load:
 *  - Normal mode: 100% ambient speed and particle/beam intensity
 *  - Calm mode (active during focused learning decisions): slows ambient motion to
 *    30% and dims particles so learning cues remain the most salient thing on screen
 *  - Reduced motion (`prefers-reduced-motion: reduce`): pauses non-essential motion
 *
 * Includes:
 *  - Floating atmospheric particle volume (dust motes, pollen, snow, embers)
 *  - Volumetric sunbeams / light shafts
 *  - Spline movers (pedestrians, forklifts, rovers, boats, trains) with automatic
 *    proximity slow-down / stop when the camera or learner is nearby
 *  - Continuous prop oscillators (clock pendulums, fans, swaying plants, bobbing boats)
 *
 * Uses a deterministic seeded PRNG (no Math.random).
 * @module v2/ambient-life
 */
import * as THREE from 'three';

function mulberry32(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _softParticleTex = null;
const _sharedVec = new THREE.Vector3();
function getSoftParticleTexture() {
  if (_softParticleTex) return _softParticleTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    g.addColorStop(0.45, 'rgba(255, 255, 255, 0.45)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  _softParticleTex = new THREE.CanvasTexture(c);
  return _softParticleTex;
}

export class AmbientLifeManager {
  /**
   * @param {THREE.Scene|THREE.Group} host
   * @param {object} [opts]
   * @param {boolean} [opts.reducedMotion=false]
   * @param {number} [opts.seed=101]
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.reducedMotion = Boolean(opts.reducedMotion);
    this.rng = mulberry32(opts.seed || 101);
    this.calm = false;
    this.calmFactor = 1.0;
    this.elapsed = 0;

    this.characters = [];
    this.splineMovers = [];
    this.oscillators = [];
    this.particleVolumes = [];
    this.lightShafts = [];
    this.customUpdaters = [];
  }

  /**
   * Enter or leave Calm Mode (slows ambient motion to ~30% during focused tasks).
   * @param {boolean} active
   */
  setCalmMode(active) {
    this.calm = Boolean(active);
  }

  setReducedMotion(reduced) {
    this.reducedMotion = Boolean(reduced);
  }

  /**
   * Register an animated character created by `createAnimatedCharacter`.
   */
  addCharacter(charCtrl) {
    if (charCtrl && typeof charCtrl.update === 'function') {
      this.characters.push(charCtrl);
    }
    return charCtrl;
  }

  /**
   * Add a floating dust / pollen / snow particle volume to the scene.
   * @param {object} opts
   * @param {[number,number,number]} [opts.center=[0, 2.2, 0]]
   * @param {[number,number,number]} [opts.extents=[12, 4, 12]]
   * @param {number} [opts.count=180]
   * @param {number} [opts.color=0xfff4d6]
   * @param {number} [opts.size=0.055]
   * @param {number} [opts.opacity=0.48]
   * @param {[number,number,number]} [opts.drift=[0.06, 0.03, 0.04]]
   */
  addParticleVolume(opts = {}) {
    const count = opts.count ?? 180;
    const [cx, cy, cz] = opts.center || [0, 2.2, 0];
    const [ex, ey, ez] = opts.extents || [12, 4, 12];
    const [dx, dy, dz] = opts.drift || [0.06, 0.03, 0.04];

    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = cx + (this.rng() - 0.5) * ex;
      positions[i * 3 + 1] = cy + (this.rng() - 0.5) * ey;
      positions[i * 3 + 2] = cz + (this.rng() - 0.5) * ez;
      phases[i] = this.rng() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const baseOpacity = opts.opacity ?? 0.48;
    const mat = new THREE.PointsMaterial({
      color: opts.color ?? 0xfff4d6,
      map: getSoftParticleTexture(),
      size: opts.size ?? 0.055,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.name = opts.name || 'ambient-particles';
    this.host.add(points);

    const vol = { points, geo, mat, baseOpacity, cx, cy, cz, ex, ey, ez, dx, dy, dz, phases, count };
    this.particleVolumes.push(vol);
    return points;
  }

  /**
   * Add soft volumetric sunbeams / light shafts from windows or skylights.
   * @param {object} opts
   * @param {Array<[number,number,number]>} [opts.positions]
   * @param {[number,number,number]} [opts.rotation=[0, 0, -0.35]]
   * @param {number} [opts.radiusTop=0.35]
   * @param {number} [opts.radiusBottom=1.35]
   * @param {number} [opts.height=4.8]
   * @param {number} [opts.color=0xffe6a3]
   * @param {number} [opts.opacity=0.11]
   */
  addLightShafts(opts = {}) {
    const group = new THREE.Group();
    group.name = 'volumetric-light-shafts';
    const positions = opts.positions || [[0, 2.4, 0]];
    const [rx, ry, rz] = opts.rotation || [0, 0, -0.35];
    const baseOpacity = opts.opacity ?? 0.11;

    const geo = new THREE.CylinderGeometry(
      opts.radiusTop ?? 0.35,
      opts.radiusBottom ?? 1.35,
      opts.height ?? 4.8,
      20,
      1,
      true,
    );
    const mat = new THREE.MeshBasicMaterial({
      color: opts.color ?? 0xffe6a3,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    for (const [x, y, z] of positions) {
      const beam = new THREE.Mesh(geo, mat);
      beam.position.set(x, y, z);
      beam.rotation.set(rx, ry, rz);
      group.add(beam);
    }

    this.host.add(group);
    this.lightShafts.push({ group, mat, baseOpacity, phase: this.rng() * 6.28 });
    return group;
  }

  /**
   * Move a 3D object or character along a closed or ping-pong CatmullRom spline path.
   * Supports automatic wheel rotation, beacon flashing, and safety slow-down near camera.
   * @param {THREE.Object3D} object3d
   * @param {Array<[number,number,number]>} waypoints
   * @param {object} [opts]
   */
  addSplineMover(object3d, waypoints, opts = {}) {
    const pts = waypoints.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
    const closed = opts.closed !== false;
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.35);
    const length = Math.max(0.1, curve.getLength());
    const mover = {
      object3d,
      curve,
      length,
      closed,
      speed: opts.speed ?? 1.4, // m/s
      u: opts.startU ?? this.rng(),
      dir: 1,
      character: opts.character || null,
      wheels: opts.wheels || [],
      beaconLight: opts.beaconLight || null,
      beaconMesh: opts.beaconMesh || null,
      stopRadius: opts.stopRadius ?? 2.4,
      yOffset: opts.yOffset ?? 0,
    };
    // Place the mover on its path immediately so reduced-motion (which pauses
    // updates) never leaves it standing at the world origin.
    mover.curve.getPointAt(mover.u, _sharedVec);
    object3d.position.set(_sharedVec.x, _sharedVec.y + mover.yOffset, _sharedVec.z);
    this.splineMovers.push(mover);
    return mover;
  }

  /**
   * Add a continuous harmonic oscillator (clock pendulum, ceiling fan, swaying plant, bobbing boat).
   */
  addOscillator(object3d, opts = {}) {
    const basePos = object3d.position.clone();
    const baseRot = object3d.rotation.clone();
    const osc = {
      object3d,
      basePos,
      baseRot,
      axis: opts.axis || 'z',
      mode: opts.mode || 'rotate', // 'rotate' | 'bob' | 'spin'
      amplitude: opts.amplitude ?? 0.15,
      frequency: opts.frequency ?? 1.2,
      phase: opts.phase ?? this.rng() * Math.PI * 2,
    };
    this.oscillators.push(osc);
    return osc;
  }

  addUpdater(fn) {
    if (typeof fn === 'function') this.customUpdaters.push(fn);
  }

  /**
   * Advance all ambient life systems by `dt` seconds.
   * @param {number} dt
   * @param {THREE.Camera} [camera]
   */
  update(dt = 0.016, camera = null) {
    const targetCalm = this.reducedMotion ? 0.0 : this.calm ? 0.30 : 1.0;
    // Time-based convergence (frame-rate independent): settles in ~0.35 s.
    this.calmFactor += (targetCalm - this.calmFactor) * (1 - Math.exp(-dt / 0.35));
    const effDt = dt * this.calmFactor;
    this.elapsed += effDt;

    // 1. Characters
    for (const c of this.characters) {
      if (this.reducedMotion) continue;
      if (camera && c.state && !c.state.lookTarget && c.state.action === 'idle') {
        c.lookAtWorld(camera.position);
      }
      c.update(dt, this.elapsed, this.calmFactor);
    }

    if (this.reducedMotion) return;

    // 2. Particle volumes
    for (const v of this.particleVolumes) {
      v.mat.opacity = v.baseOpacity * (0.45 + 0.55 * this.calmFactor);
      const pos = v.geo.attributes.position.array;
      for (let i = 0; i < v.count; i++) {
        const i3 = i * 3;
        const ph = v.phases[i];
        pos[i3] += Math.sin(this.elapsed * 0.7 + ph) * v.dx * effDt;
        pos[i3 + 1] += (v.dy + Math.cos(this.elapsed * 0.5 + ph) * 0.015) * effDt;
        pos[i3 + 2] += Math.cos(this.elapsed * 0.6 + ph) * v.dz * effDt;

        if (pos[i3 + 1] > v.cy + v.ey * 0.5) pos[i3 + 1] = v.cy - v.ey * 0.5;
        if (pos[i3 + 1] < v.cy - v.ey * 0.5) pos[i3 + 1] = v.cy + v.ey * 0.5;
      }
      v.geo.attributes.position.needsUpdate = true;
    }

    // 3. Volumetric light shafts subtle pulse
    for (const s of this.lightShafts) {
      const shimmer = 0.85 + 0.15 * Math.sin(this.elapsed * 0.9 + s.phase);
      s.mat.opacity = s.baseOpacity * shimmer * (0.5 + 0.5 * this.calmFactor);
    }

    // 4. Spline movers (vehicles, background walkers, boats)
    const _pt = new THREE.Vector3();
    const _tan = new THREE.Vector3();
    for (const m of this.splineMovers) {
      let proximityFactor = 1.0;
      if (camera && m.stopRadius > 0) {
        const d = camera.position.distanceTo(m.object3d.position);
        if (d < m.stopRadius) proximityFactor = 0.0;
        else if (d < m.stopRadius + 2.0) proximityFactor = (d - m.stopRadius) / 2.0;
      }
      const step = (m.speed * effDt * proximityFactor) / m.length;
      if (m.closed) {
        m.u = (m.u + step) % 1.0;
      } else {
        m.u += step * m.dir;
        if (m.u >= 1.0) { m.u = 1.0; m.dir = -1; }
        if (m.u <= 0.0) { m.u = 0.0; m.dir = 1; }
      }
      m.curve.getPointAt(m.u, _pt);
      m.curve.getTangentAt(m.u, _tan);
      if (!m.closed && m.dir < 0) _tan.negate();

      m.object3d.position.set(_pt.x, _pt.y + m.yOffset, _pt.z);
      if (_tan.lengthSq() > 1e-4) {
        m.object3d.rotation.y = Math.atan2(_tan.x, _tan.z);
      }

      if (m.character) {
        m.character.setAction(proximityFactor > 0.15 ? 'walk' : 'idle');
      }
      for (const w of m.wheels) {
        w.rotation.x += m.speed * effDt * proximityFactor * 3.2;
      }
      if (m.beaconLight || m.beaconMesh) {
        const flash = Math.sin(this.elapsed * 9.0) > 0 ? 1.0 : 0.15;
        if (m.beaconLight) m.beaconLight.intensity = flash * 1.8;
        if (m.beaconMesh?.material?.emissiveIntensity !== undefined) {
          m.beaconMesh.material.emissiveIntensity = flash * 2.2;
        }
      }
    }

    // 5. Oscillators
    for (const o of this.oscillators) {
      const w = this.elapsed * o.frequency * Math.PI * 2 + o.phase;
      if (o.mode === 'spin') {
        o.object3d.rotation[o.axis] += o.amplitude * effDt;
      } else if (o.mode === 'bob') {
        o.object3d.position[o.axis] = o.basePos[o.axis] + Math.sin(w) * o.amplitude;
      } else {
        o.object3d.rotation[o.axis] = o.baseRot[o.axis] + Math.sin(w) * o.amplitude;
      }
    }

    // 6. Custom updaters
    for (const fn of this.customUpdaters) {
      fn(effDt, this.elapsed, this.calmFactor);
    }
  }
}
