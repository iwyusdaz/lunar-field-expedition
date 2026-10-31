/**
 * camera-rig.js — the v3 camera rig (plan 10 §9 "Camera rig", §2.2, §5.1).
 *
 * - Orbit, pan and zoom everywhere, with limits.
 *   Mouse: drag orbits, right-drag or Shift+drag pans, wheel zooms.
 *   Touch: one finger orbits, two fingers pan and pinch to zoom.
 *   Keys: Q/E turn, R/F tilt, +/- zoom (and the on-screen camera cluster).
 * - Free walk in walkable scenes: W A S D or the arrow keys, the on-screen
 *   joystick on touch. Walking moves the orbit target over the ground.
 * - Double-click (double-tap) a point to fly there; "Reset view" eases home.
 * - Ground clamping and collision: the camera never goes under groundHeight()
 *   + minEye, never ends inside a collider box, and pulls in when a collider
 *   sits between it and the target, so the learner can't get lost.
 * - frame(box): eases to frame an inspected object at >= 35% of the viewport
 *   height, offset so the info card fits beside it (§4.2, §4.3).
 *   frame(box, { look: true }) keeps the camera where it is and turns toward
 *   the object instead (sky bodies, distant mountains, things too far to fly
 *   to); with fitFov it narrows the field of view like a telephoto lens so the
 *   object reads at its true angular size. The object is never scaled. The
 *   view (and field of view) returns when the card closes.
 * - viewFrom(eye, center): an authored inspect view (the camera at a chosen
 *   spot, the object beside the card), for landforms and other things a box
 *   framing cannot show.
 * - Idle breathing (after 12 s without input) and the title-screen attract
 *   orbit; both off under reduced motion. The 12 s delay keeps breathing out
 *   of ui-audit's 5 s "alive" sample, which must come from the scene itself.
 * @module v3/camera-rig
 */
import * as THREE from 'three';
import { frameDistance } from './layout-math.js';

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp = THREE.MathUtils.clamp;
const isTyping = () => {
  const el = document.activeElement;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
};

export class CameraRig {
  /**
   * @param {object} o
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {HTMLElement} o.dom                 the canvas
   * @param {{ target: number[], radius: number, theta: number, phi: number }} o.home
   * @param {boolean} [o.walkable=true]
   * @param {(x: number, z: number) => number} [o.groundHeight]
   * @param {THREE.Box3[]} [o.colliders]
   * @param {[number, number, number, number]} [o.bounds]   [minX, maxX, minZ, maxZ] for the target
   * @param {{ minRadius?: number, maxRadius?: number, minPhi?: number, maxPhi?: number, minEye?: number, eyeHeight?: number }} [o.limits]
   * @param {() => boolean} [o.reducedMotion]
   */
  constructor(o) {
    this.camera = o.camera;
    this.dom = o.dom;
    this.walkable = o.walkable !== false;
    this.groundHeight = o.groundHeight || (() => 0);
    this.colliders = o.colliders || [];
    this.bounds = o.bounds || [-50, 50, -50, 50];
    const L = o.limits || {};
    this.limits = { minRadius: L.minRadius ?? 1.2, maxRadius: L.maxRadius ?? 60, minPhi: L.minPhi ?? 0.12, maxPhi: L.maxPhi ?? 1.52, minEye: L.minEye ?? 0.4, eyeHeight: L.eyeHeight ?? 1.5 };
    this.reducedMotion = o.reducedMotion || (() => false);
    this.walkSpeed = 3.2;
    this.enabled = true;
    this.attract = false;
    this.home = { target: new THREE.Vector3(...o.home.target), radius: o.home.radius, theta: o.home.theta, phi: o.home.phi };
    this.state = { target: this.home.target.clone(), radius: this.home.radius, theta: this.home.theta, phi: this.home.phi };
    this.anim = null;
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.idleFor = 0;
    this._breath = 0;
    this._listeners = {};
    this._pointers = new Map();
    this._ray = new THREE.Ray();
    this._v = new THREE.Vector3();
    this.baseFov = null;  // set while an inspect zoom narrows the field of view
    this._lookMode = false; // a look-mode frame may tilt past maxPhi (looking up at the sky)
    this._bind();
    this.apply();
  }

  on(ev, fn) { (this._listeners[ev] ||= new Set()).add(fn); return () => this._listeners[ev].delete(fn); }
  _emit(ev, ...a) { for (const fn of this._listeners[ev] || []) fn(...a); }
  _input(kind, amount = 0) { this.idleFor = 0; this._emit('interact', kind, amount); }

  setHome(home) { this.home = { target: new THREE.Vector3(...home.target), radius: home.radius, theta: home.theta, phi: home.phi }; }
  /** Snapshot of the view, for restoring after an inspect. */
  view() { return { target: this.state.target.toArray(), radius: this.state.radius, theta: this.state.theta, phi: this.state.phi }; }

  /** The learner's field of view (Settings). During an inspect zoom it applies when the zoom ends. */
  setBaseFov(fov) {
    if (this.baseFov != null) { this.baseFov = fov; return; }
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Ease (or cut, under reduced motion) to a view. */
  flyTo(v, duration = 1.0) {
    const to = { target: new THREE.Vector3(...(v.target.toArray ? v.target.toArray() : v.target)), radius: v.radius ?? this.state.radius, theta: v.theta ?? this.state.theta, phi: v.phi ?? this.state.phi };
    // Field of view: a look-mode frame sets v.fov; any other view ends the zoom.
    let fovTo = null;
    if (v.fov != null) { if (this.baseFov == null) this.baseFov = this.camera.fov; fovTo = v.fov; }
    else if (this.baseFov != null) { fovTo = this.baseFov; this.baseFov = null; }
    this._lookMode = Boolean(v.look);
    // Shortest way round.
    while (to.theta - this.state.theta > Math.PI) to.theta -= 2 * Math.PI;
    while (to.theta - this.state.theta < -Math.PI) to.theta += 2 * Math.PI;
    if (this.reducedMotion() || duration <= 0.05) {
      this.anim = null;
      Object.assign(this.state, { radius: to.radius, theta: to.theta, phi: to.phi });
      this.state.target.copy(to.target);
      if (fovTo != null) { this.camera.fov = fovTo; this.camera.updateProjectionMatrix(); }
      this.apply();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.anim = { from: { target: this.state.target.clone(), radius: this.state.radius, theta: this.state.theta, phi: this.state.phi }, to, t: 0, duration, resolve, fovFrom: this.camera.fov, fovTo };
    });
  }

  resetView() { this._input('reset'); return this.flyTo(this.home, 1.1); }

  /**
   * Double-click / double-tap: fly the orbit target to a picked surface point,
   * kept inside `bounds`, on the ground (as when walking) and out of colliders.
   * Heading, tilt and distance stay as they are. Reduced motion cuts.
   * @param {{ x: number, y: number, z: number }} p  world point
   */
  flyToPoint(p, duration = 0.9) {
    let x = clamp(p.x, this.bounds[0], this.bounds[1]);
    let z = clamp(p.z, this.bounds[2], this.bounds[3]);
    const lift = this.limits.eyeHeight * 0.6;
    for (const b of this.colliders) {
      if (!b.containsPoint(this._v.set(x, this.groundHeight(x, z) + lift, z))) continue;
      // Push out through the nearest side wall (in the ground plane).
      const out = [[b.min.x - 0.3 - x, 0], [b.max.x + 0.3 - x, 0], [0, b.min.z - 0.3 - z], [0, b.max.z + 0.3 - z]]
        .sort((a, c) => Math.hypot(...a) - Math.hypot(...c))[0];
      x = clamp(x + out[0], this.bounds[0], this.bounds[1]);
      z = clamp(z + out[1], this.bounds[2], this.bounds[3]);
    }
    const y = this.groundHeight(x, z) + lift;
    const t = this.state.target;
    this._input('move', Math.hypot(x - t.x, z - t.z));
    return this.flyTo({ target: [x, y, z] }, duration);
  }

  /**
   * Frame an object's world box so it fills `heightFrac` of the viewport height,
   * centred at NDC (offsetX, offsetY) so the info card fits beside it.
   */
  frame(box, { offsetX = -0.24, offsetY = 0, heightFrac = 0.45, maxWidthFrac = 0.45, duration = 0.9, look = false, fitFov = false, minFov = 1.5 } = {}) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const cam = this.camera;
    if (look) return this._frameLook(center, size, { offsetX, offsetY, heightFrac, duration, fitFov, minFov });
    let radius = frameDistance(size, cam.fov, cam.aspect, { heightFrac, maxWidthFrac, minDistance: this.limits.minRadius });
    radius = Math.max(radius, size.length() * 0.5 + 0.4);
    // Keep the current heading; look slightly down onto the object.
    const theta = Math.atan2(cam.position.x - center.x, cam.position.z - center.z);
    const phi = clamp(1.32 - Math.min(0.35, size.y / 40), this.limits.minPhi, this.limits.maxPhi);
    const basis = this._basis(theta, phi);
    const th = Math.tan((cam.fov * Math.PI) / 360);
    const target = center.clone()
      .addScaledVector(basis.right, -offsetX * radius * th * cam.aspect)
      .addScaledVector(basis.up, -offsetY * radius * th);
    return this.flyTo({ target, radius, theta, phi }, duration);
  }

  /**
   * Look-mode frame: the camera stays put and turns toward `center`; the orbit
   * target moves along the line of sight at the current radius. With fitFov
   * the field of view narrows (never widens) until the object's angular size
   * fills `heightFrac` of the view height, but not below `minFov` degrees.
   */
  _frameLook(center, size, { offsetX, offsetY, heightFrac, duration, fitFov, minFov }) {
    const cam = this.camera;
    const P = cam.position.clone();
    const d = center.clone().sub(P);
    const dist = Math.max(1e-3, d.length());
    const dir = d.divideScalar(dist);
    const base = this.baseFov ?? cam.fov;
    let fov = base;
    if (fitFov) {
      const ang = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(size.x, size.y, size.z) / 2 / dist));
      fov = clamp(ang / heightFrac, minFov, base);
    }
    const back = dir.clone().negate();
    const theta = Math.atan2(back.x, back.z);
    const phi = Math.acos(clamp(back.y, -1, 1));
    const r = this.state.radius;
    const basis = this._basis(theta, phi);
    const th = Math.tan((fov * Math.PI) / 360);
    const target = P.clone().addScaledVector(dir, r)
      .addScaledVector(basis.right, -offsetX * r * th * cam.aspect)
      .addScaledVector(basis.up, -offsetY * r * th);
    const off = target.clone().sub(P).negate().normalize();
    return this.flyTo({ target, radius: r, theta: Math.atan2(off.x, off.z), phi: Math.acos(clamp(off.y, -1, 1)), look: true, fov: fov < base - 0.01 ? fov : undefined }, duration);
  }

  /**
   * A rig view with the camera at `eye`, turned so `center` shows at NDC
   * (offsetX, offsetY) (beside the info card). `fov` (degrees) narrows the view
   * like a telephoto lens; it never widens past the learner's field of view.
   * The orbit target sits on the line of sight at the object's distance (within
   * the radius limits), so turning the view afterwards circles the object.
   * @param {number[]} eye  @param {number[]} center
   */
  viewFrom(eye, center, { offsetX = 0, offsetY = 0, fov = null } = {}) {
    const cam = this.camera;
    const P = new THREE.Vector3(...eye), C = new THREE.Vector3(...center);
    const d = C.clone().sub(P);
    const dir = d.clone().normalize();
    const r = clamp(d.length(), this.limits.minRadius, this.limits.maxRadius / 1.25); // headroom for the card offset
    const base = this.baseFov ?? cam.fov;
    const f = fov ? Math.min(fov, base) : base;
    const back = dir.clone().negate();
    const basis = this._basis(Math.atan2(back.x, back.z), Math.acos(clamp(back.y, -1, 1)));
    const th = Math.tan((f * Math.PI) / 360);
    const target = P.clone().addScaledVector(dir, r)
      .addScaledVector(basis.right, -offsetX * r * th * cam.aspect)
      .addScaledVector(basis.up, -offsetY * r * th);
    const off = P.clone().sub(target).normalize();
    return { target: target.toArray(), radius: target.distanceTo(P), theta: Math.atan2(off.x, off.z), phi: Math.acos(clamp(off.y, -1, 1)), look: true, fov: f < base - 0.01 ? f : undefined };
  }

  _basis(theta, phi) {
    const back = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    const right = new THREE.Vector3(0, 1, 0).cross(back).normalize();
    const up = back.clone().cross(right).normalize();
    return { back, right, up };
  }

  orbitBy(dTheta, dPhi) {
    this.anim = null;
    this.state.theta += dTheta;
    this.state.phi = clamp(this.state.phi + dPhi, this.limits.minPhi, this._lookMode ? Math.PI - 0.05 : this.limits.maxPhi);
    this._input('look', Math.abs(dTheta) + Math.abs(dPhi));
  }

  zoomBy(f) {
    this.anim = null;
    this.state.radius = clamp(this.state.radius * f, this.limits.minRadius, this.limits.maxRadius);
    this._input('zoom', Math.abs(Math.log(f)));
  }

  /** Move the target in the ground plane, relative to the view heading (metres). */
  panBy(right, forward, kind = 'pan') {
    this.anim = null;
    const s = Math.sin(this.state.theta), c = Math.cos(this.state.theta);
    const t = this.state.target;
    t.x = clamp(t.x + right * c - forward * s, this.bounds[0], this.bounds[1]);
    t.z = clamp(t.z - right * s - forward * c, this.bounds[2], this.bounds[3]);
    if (kind === 'move') t.y = this.groundHeight(t.x, t.z) + this.limits.eyeHeight * 0.6;
    this._input(kind, Math.hypot(right, forward));
  }

  setJoystick(x, y) { this.joy.x = x; this.joy.y = y; if (x || y) this._input('move', 0); }

  /** Per-frame update: keys, joystick, easing, breathing, clamping. */
  update(dt) {
    this.idleFor += dt;
    if (!this.enabled) return; // a cinematic or tool owns the camera
    if (this.walkable && !isTyping() && !document.querySelector('dialog[open]')) {
      let f = 0, r = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1;
      f += -this.joy.y; r += this.joy.x;
      const len = Math.hypot(f, r);
      if (len > 0.05) {
        const k = (this.walkSpeed * dt) / Math.max(1, len);
        this.panBy(r * k, f * k, 'move');
      }
    }
    if (this.enabled && !isTyping()) {
      if (this.keys.has('KeyQ')) this.orbitBy(1.4 * dt, 0);
      if (this.keys.has('KeyE')) this.orbitBy(-1.4 * dt, 0);
      if (this.keys.has('KeyR')) this.orbitBy(0, -0.9 * dt);
      if (this.keys.has('KeyF')) this.orbitBy(0, 0.9 * dt);
    }
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = ease(Math.min(1, a.t / a.duration));
      this.state.target.lerpVectors(a.from.target, a.to.target, k);
      this.state.radius = a.from.radius + (a.to.radius - a.from.radius) * k;
      this.state.theta = a.from.theta + (a.to.theta - a.from.theta) * k;
      this.state.phi = a.from.phi + (a.to.phi - a.from.phi) * k;
      if (a.fovTo != null) { this.camera.fov = a.fovFrom + (a.fovTo - a.fovFrom) * k; this.camera.updateProjectionMatrix(); }
      if (k >= 1) { this.anim = null; a.resolve(); }
    } else if (this.attract && !this.reducedMotion()) {
      this.state.theta += 0.035 * dt;
    }
    const breathe = !this.reducedMotion() && !this.anim && !this.attract && this.idleFor > 12;
    this._breath = breathe ? this._breath + dt : 0;
    this.apply();
  }

  /** Place the camera from the state, with breathing, ground clamp and collisions. */
  apply() {
    const s = this.state;
    s.phi = clamp(s.phi, this.limits.minPhi, this._lookMode ? Math.PI - 0.05 : this.limits.maxPhi);
    s.radius = clamp(s.radius, this.limits.minRadius, this.limits.maxRadius);
    let theta = s.theta, phi = s.phi;
    if (this._breath > 0) {
      // Scaled by the zoom: through a telephoto inspect view the drift stays as small on screen.
      const ramp = Math.min(1, this._breath / 4) * (this.baseFov ? this.camera.fov / this.baseFov : 1);
      theta += Math.sin(this._breath * 0.45) * 0.006 * ramp;
      phi += Math.sin(this._breath * 0.31 + 1.3) * 0.004 * ramp;
    }
    const dir = this._v.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    let r = s.radius;
    // Collision: pull in when a collider is between the target and the camera.
    this._ray.set(s.target, dir);
    for (const b of this.colliders) {
      if (b.containsPoint(s.target)) continue;
      const hit = this._ray.intersectBox(b, new THREE.Vector3());
      if (hit) r = Math.min(r, Math.max(this.limits.minRadius * 0.5, hit.distanceTo(s.target) - 0.3));
    }
    const p = this.camera.position.copy(s.target).addScaledVector(dir, r);
    const g = this.groundHeight(p.x, p.z) + this.limits.minEye;
    if (p.y < g) p.y = g;
    this.camera.lookAt(s.target);
    this.camera.updateMatrixWorld();
  }

  _bind() {
    const dom = this.dom;
    dom.style.touchAction = 'none';
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      dom.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), type: e.pointerType, button: e.button, shift: e.shiftKey });
      if (this._pointers.size === 2) this._pinch = this._pinchState();
    });
    dom.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p || !this.enabled) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) p.moved = true;
      if (!p.moved) return;
      if (this._pointers.size >= 2) {
        const now = this._pinchState();
        if (this._pinch) {
          const k = this.state.radius / Math.max(200, dom.clientHeight);
          this.panBy(-(now.cx - this._pinch.cx) * k * 1.6, (now.cy - this._pinch.cy) * k * 1.6);
          if (this._pinch.d > 10 && now.d > 10) this.zoomBy(this._pinch.d / now.d);
        }
        this._pinch = now;
        return;
      }
      if (p.button === 2 || p.shift) {
        const k = this.state.radius / Math.max(200, dom.clientHeight);
        this.panBy(-dx * k * 1.6, dy * k * 1.6);
      } else {
        this.orbitBy(-dx * 0.0055, -dy * 0.0045);
      }
      this._emit('drag');
    });
    const up = (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      if (!p.moved && e.type === 'pointerup' && performance.now() - p.t0 < 600 && this._pointers.size === 0 && p.button === 0) {
        this._input('tap');
        this._emit('tap', e.clientX, e.clientY, p.type);
        // Touch has no dblclick event: two taps within 300 ms and 24 px.
        if (p.type !== 'mouse') {
          const last = this._lastTap;
          const now = performance.now();
          if (last && now - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 24) { this._emit('dbltap', e.clientX, e.clientY); this._lastTap = null; }
          else this._lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('dblclick', (e) => { if (this.enabled) this._emit('dbltap', e.clientX, e.clientY); });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoomBy(Math.exp(clamp(e.deltaY, -120, 120) * 0.0015));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const walkKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      // Arrow keys belong to the focused control (sliders, lists) when one has focus.
      const onControl = document.activeElement?.closest?.('[role=slider], [role=listbox], [role=tablist], [role=radiogroup], [role=menu], [data-arrow-keys]');
      if (e.code.startsWith('Arrow') && onControl) return;
      if (walkKeys.includes(e.code) || ['KeyQ', 'KeyE', 'KeyR', 'KeyF'].includes(e.code)) {
        this.keys.add(e.code);
        this._input(walkKeys.includes(e.code) ? 'move' : 'look');
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
      if (e.key === '+' || e.key === '=') this.zoomBy(0.85);
      if (e.key === '-' || e.key === '_') this.zoomBy(1 / 0.85);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _pinchState() {
    const [a, b] = [...this._pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  setEnabled(on) { this.enabled = Boolean(on); if (!on) { this.keys.clear(); this._pointers.clear(); this.joy.x = this.joy.y = 0; } }
}

/**
 * On-screen joystick for touch walking (walkable scenes). Pointer-only by
 * design: keyboard users walk with W A S D, so it is aria-hidden.
 * @param {HTMLElement} el  an empty element; the stick is drawn inside it
 * @param {CameraRig} rig
 */
export function bindJoystick(el, rig) {
  el.innerHTML = '<span class="v3-joystick-knob"></span>';
  el.setAttribute('aria-hidden', 'true');
  const knob = el.firstChild;
  let id = null;
  const set = (e) => {
    const r = el.getBoundingClientRect();
    const R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    knob.style.transform = `translate(${x * R * 0.55}px, ${y * R * 0.55}px)`;
    rig.setJoystick(x, y);
  };
  el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.setPointerCapture?.(id); set(e); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; rig.setJoystick(0, 0); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
