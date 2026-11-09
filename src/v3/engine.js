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

/** Camera zoom for a viewport aspect: 1 on landscape, sqrt(aspect) on portrait. */
export function portraitZoom(aspect) { return aspect > 0 && aspect < 1 ? Math.sqrt(aspect) : 1; }

export const READING_SCALE = 0.8;

/**
 * Software WebGL (no GPU: SwiftShader, llvmpipe, Microsoft Basic Render...).
 * Returns the renderer string, or null on a real GPU.
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
 */
export function detectSoftwareGL(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) ? name : null;
  } catch { return null; }
}
/** Without a GPU: loop interval while the scene is covered (updates run, nothing is drawn). */
export const SOFTWARE_MIN_FRAME_MS = 200;
/** Without a GPU: after a frame slower than this, wait as long as it took before the next one. */
export const VERY_SLOW_FRAME_MS = 500;

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
    // Without a GPU one frame can take seconds and block every click, including
    // the title screen's "Use text mode". Detect it once so the loop can skip
    // drawing (but not updating) while the title screen or text mode covers the scene.
    this.softwareGL = detectSoftwareGL(this.renderer.getContext());

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
    // The field of view is vertical, so a portrait phone (aspect about 0.46)
    // would see only a 30 deg wide slice of a view composed for a landscape
    // screen: landmarks a step asks for fall out of frame. On portrait screens
    // widen the view half-way (in log terms) toward the same horizontal field:
    // zoom = sqrt(aspect), so at 390x844 about 43 deg wide and 81 deg tall.
    this.camera.zoom = portraitZoom(w / h);
    this.camera.updateProjectionMatrix();
  }

  /** Register fn(dt, elapsed) to run every frame before rendering. Returns an unsubscribe. */
  onUpdate(fn) { this._updateFns.push(fn); return () => { this._updateFns = this._updateFns.filter((f) => f !== fn); }; }

  start() {
    if (this._running) return;
    this._running = true;
    this.clock.start();
    // Frames are scheduled with requestAnimationFrame. Only without a GPU, and
    // only while nothing of the scene can be seen, the loop runs every
    // SOFTWARE_MIN_FRAME_MS and updates the scene without drawing it; and after
    // a frame slower than VERY_SLOW_FRAME_MS it waits as long as that frame took,
    // so clicks and focus still get through between very slow frames.
    const next = (ms) => { if (ms > 0) setTimeout(() => requestAnimationFrame(tick), ms); else requestAnimationFrame(tick); };
    const tick = () => {
      if (!this._running) return;
      if (this._paused || !this._visible) { this.clock.getDelta(); next(0); return; }
      const covered = this.softwareGL && this.sceneCovered();
      next(covered ? SOFTWARE_MIN_FRAME_MS : (this.softwareGL && this._lastCost > VERY_SLOW_FRAME_MS ? this._lastCost : 0)); // scheduled first, as before, so an error in one frame never stops the loop
      const frameStart = performance.now();
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this._t += dt;
      for (const fn of this._updateFns) fn(dt, this._t);
      if (covered) { this.scene.updateMatrixWorld(); this.camera.updateMatrixWorld(); return; } // logic runs, drawing waits
      this.renderer.info.reset();
      // The benchmark owns the only TIME_ELAPSED query while it runs; ui-audit
      // brackets frames with its own query, so never time while it samples.
      const timing = this.autoPick?.active && !window.__uiaudit?.sampling;
      if (timing) this.timer.begin();
      this.chain.render(dt);
      if (timing) { this.timer.end(); this.timer.poll(); }
      if (this.autoPick && this.autoPick.phase !== 'done') this.autoPick.frame(dt);
      this._dynamicResolution(dt);
      this._lastCost = performance.now() - frameStart;
    };
    this._lastCost = 0;
    requestAnimationFrame(tick);
  }

  /**
   * True while nothing of the 3D view can be seen: the title screen (a
   * full-screen page) is up, or text mode / a fallback has hidden the canvas.
   * Used only without a GPU, where skipping those frames keeps the page usable.
   */
  sceneCovered() {
    if (this.canvas.checkVisibility && !this.canvas.checkVisibility({ visibilityProperty: true })) return true;
    // A page counts only if it is really shown and fills the viewport; a
    // partial card over the scene leaves the scene visible, so keep drawing.
    const fills = (el) => {
      if (!el || el.hidden || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))) return false;
      const r = el.getBoundingClientRect();
      return r.width * r.height >= 0.9 * innerWidth * innerHeight && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
    };
    return fills(document.querySelector('[data-ui="title-screen"]')) || fills(document.getElementById('textmode'));
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
