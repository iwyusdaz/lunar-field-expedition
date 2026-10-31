/**
 * engine.js — v3 renderer + loop: WebGLRenderer (three 0.186), the v3 render
 * chain, v3 quality presets with the GPU-time auto-pick, dynamic resolution.
 * Conventions: 1 unit = 1 metre, sRGB output, AgX in the render chain.
 *
 * Test hooks (ui-audit contract): the engine exposes `scene`, `camera`,
 * `renderer`, `quality.set(name)` and `resize()`. The app puts it on
 * `window.__TEST__.engine` in VITE_TEST_HOOKS builds.
 * @module v3/engine
 */
import * as THREE from 'three';
import { QualityManagerV3, PresetAutoPick } from './quality.js';
import { RenderChain } from './render-chain.js';
import { GpuTimer } from './gpu-timer.js';

export const READING_SCALE = 0.8;

export class EngineV3 {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {string} opts.slug
   * @param {string} [opts.preset]       force a preset (skips the benchmark)
   * @param {number} [opts.exposure=1]
   * @param {number} [opts.fov=60]   same default as the Settings comfort slider
   * @param {boolean} [opts.autoPick=true]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 60, 1, 0.1, 2000);
    this.quality = new QualityManagerV3({ slug: opts.slug, forced: opts.preset });
    this.chain = new RenderChain(this.renderer, this.scene, this.camera, { exposure: opts.exposure ?? 1 });
    this.chain.setPost(this.quality.presetDef.post);
    this.quality.onChange((def) => { this.chain.setPost(def.post); this.renderer.shadowMap.enabled = def.shadowMapSize > 0; this.resize(); });

    const gl = this.renderer.getContext();
    this.timer = new GpuTimer(gl);
    this.autoPick = opts.autoPick === false ? null : new PresetAutoPick(this.quality, this.timer, {
      onDone: (name, history, reason) => { this.autoPickResult = { name, history, reason }; },
    });

    this._updateFns = [];
    this._running = false;
    this._paused = false;
    this._visible = true;
    this.frames = 0;
    this.fps = 0;
    this._fpsT = 0;
    this._fpsFrames = 0;
    this._t = 0;
    this.readingScale = 1;
    this.clock = new THREE.Clock(false);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => { this._visible = !document.hidden; });
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.quality.pixelRatio() * this.readingScale);
    this.renderer.setSize(w, h, false);
    this.chain.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Register fn(dt, elapsed) to run every frame before rendering. Returns an unsubscribe. */
  onUpdate(fn) { this._updateFns.push(fn); return () => { this._updateFns = this._updateFns.filter((f) => f !== fn); }; }

  start() {
    if (this._running) return;
    this._running = true;
    this.clock.start();
    const tick = () => {
      if (!this._running) return;
      requestAnimationFrame(tick);
      if (this._paused || !this._visible) { this.clock.getDelta(); return; }
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this._t += dt;
      for (const fn of this._updateFns) fn(dt, this._t);
      this.renderer.info.reset();
      // The benchmark owns the only TIME_ELAPSED query while it runs; ui-audit
      // brackets frames with its own query, so never time while it samples.
      const timing = this.autoPick?.active && !window.__uiaudit?.sampling;
      if (timing) this.timer.begin();
      this.chain.render(dt);
      if (timing) { this.timer.end(); this.timer.poll(); }
      if (this.autoPick && this.autoPick.phase !== 'done') this.autoPick.frame(dt);
      this._dynamicResolution(dt);
    };
    requestAnimationFrame(tick);
  }

  _dynamicResolution(dt) {
    this.frames++; this._fpsFrames++; this._fpsT += dt;
    if (this._fpsT < 1) return;
    this.fps = this._fpsFrames / this._fpsT;
    this._fpsT = 0; this._fpsFrames = 0;
    // Only after the benchmark, and only as a safety net for sustained drops.
    if (!this.quality.dynamic || this.autoPick?.active || this._t < 8) return;
    const q = this.quality;
    if (this.fps < 45 && q.resolutionScale > 0.6) { q.resolutionScale = Math.max(0.6, q.resolutionScale - 0.05); this.resize(); }
    else if (this.fps > 58 && q.resolutionScale < q.presetDef.resolutionScale) { q.resolutionScale = Math.min(q.presetDef.resolutionScale, q.resolutionScale + 0.05); this.resize(); }
  }

  /**
   * Reading mode: while a drawer covers part of the view the learner is
   * reading, so the scene renders at 80% of its pixel ratio (about 36% fewer
   * pixels). The S5 pilot measured drawer states at the edge of the 12 ms GPU
   * budget with spikes unrelated to streaming; this keeps them inside it.
   * @param {boolean} on
   */
  setReading(on) {
    const s = on ? READING_SCALE : 1;
    if (s === this.readingScale) return;
    this.readingScale = s;
    this.resize();
  }

  pause() { this._paused = true; }
  resume() { this._paused = false; this.clock.getDelta(); }

  dispose() {
    this._running = false;
    window.removeEventListener('resize', this._onResize);
    this.chain.dispose();
    this.renderer.dispose();
  }
}
