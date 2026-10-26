/**
 * Input: keyboard, pointer (mouse + touch), optional gamepad stub.
 * Pointer alternatives (WCAG 2.5.1): every drag has on-screen button equivalents
 * provided by the UI layer; this module exposes the primitives.
 * @module core/input
 */

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pointer = { down: false, x: 0, y: 0, dx: 0, dy: 0, button: 0 };
    this.pointerActive = false; // true while dragging/orbiting
    this._onKey = [];
    this._onPointer = [];

    this._kd = (e) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      for (const fn of this._onKey) fn(e.code, e, 'down');
    };
    this._ku = (e) => { this.keys.delete(e.code); for (const fn of this._onKey) fn(e.code, e, 'up'); };
    this._pd = (e) => {
      this.pointer.down = true; this.pointerActive = true;
      this.pointer.button = e.button;
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
      for (const fn of this._onPointer) fn(this.pointer, 'down');
    };
    this._pm = (e) => {
      this.pointer.dx = e.clientX - this.pointer.x;
      this.pointer.dy = e.clientY - this.pointer.y;
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
      for (const fn of this._onPointer) fn(this.pointer, 'move');
    };
    this._pu = (e) => {
      this.pointer.down = false; this.pointerActive = false;
      this.pointer.dx = 0; this.pointer.dy = 0;
      for (const fn of this._onPointer) fn(this.pointer, 'up');
    };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    this.dom.addEventListener('pointerdown', this._pd);
    window.addEventListener('pointermove', this._pm);
    window.addEventListener('pointerup', this._pu);
    // Two-finger touch -> zoom handled by UI rotate/zoom buttons too.
    this.dom.style.touchAction = 'none';
  }

  onKey(fn) { this._onKey.push(fn); }
  onPointer(fn) { this._onPointer.push(fn); }
  isDown(code) { return this.keys.has(code); }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('pointermove', this._pm);
    window.removeEventListener('pointerup', this._pu);
    this.dom?.removeEventListener('pointerdown', this._pd);
  }
}

/**
 * Smooth camera orbit around a target point, with clamp and button-step support.
 * Keyboard: arrows rotate, +/- zoom (bound by the app via steps()).
 */
import { Vector3 } from 'three';

export class OrbitController {
  constructor(camera, dom, target = new Vector3()) {
    this.camera = camera;
    this.target = target;
    this.spherical = { radius: 10, theta: Math.PI / 4, phi: Math.PI / 3 };
    this.minRadius = 0.5; this.maxRadius = 100;
    this.minPhi = 0.05; this.maxPhi = Math.PI / 2 - 0.02;
    this.enabled = true;
    this._pending = { theta: 0, phi: 0, radius: 0 };
    this.update();
  }

  drag(dx, dy) {
    if (!this.enabled) return;
    this.spherical.theta -= dx * 0.005;
    this.spherical.phi = Math.min(this.maxPhi, Math.max(this.minPhi, this.spherical.phi - dy * 0.005));
    this.update();
  }

  zoom(delta) {
    if (!this.enabled) return;
    this.spherical.radius = Math.min(this.maxRadius, Math.max(this.minRadius, this.spherical.radius * (1 + delta)));
    this.update();
  }

  /** Discrete steps for keyboard / on-screen buttons. */
  steps({ rotX = 0, rotY = 0, zoom = 0 } = {}) {
    if (!this.enabled) return;
    if (rotX) this.spherical.theta += rotX * 0.2;
    if (rotY) this.spherical.phi = Math.min(this.maxPhi, Math.max(this.minPhi, this.spherical.phi + rotY * 0.2));
    if (zoom) this.spherical.radius = Math.min(this.maxRadius, Math.max(this.minRadius, this.spherical.radius * (1 + zoom * 0.15)));
    this.update();
  }

  update() {
    const sp = this.spherical;
    const sinPhi = Math.sin(sp.phi);
    this.camera.position.set(
      this.target.x + sp.radius * sinPhi * Math.sin(sp.theta),
      this.target.y + sp.radius * Math.cos(sp.phi),
      this.target.z + sp.radius * sinPhi * Math.cos(sp.theta),
    );
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
  }
}
