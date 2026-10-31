/**
 * quality.js — v3 quality presets and the GPU-time preset auto-pick
 * (plan 10 §10 decision 1; numbers from _templates/spikes/RESULTS.md).
 *
 * Medium is the fixed target on an Apple M1-class laptop: GPU time <= 12 ms at
 * p95, >= 55 fps, <= 300 draw calls, <= 1.5 M triangles. A short startup
 * benchmark (EXT_disjoint_timer_query_webgl2) moves stronger machines up to
 * High or Ultra and keeps each step only if it still meets the 12 ms / 55 fps
 * budget. Weak machines step down to Low. A preset the learner picks in
 * Settings always wins and stops the benchmark (so does ui-audit's
 * `engine.quality.set('medium')`).
 *
 * Pixel ratio (RESULTS finding 1): Medium caps the drawing buffer at 1.5x CSS
 * pixels. On the M1 Retina screen that is 2160x1350 instead of 2880x1800 (56%
 * of the pixels), which keeps full-screen passes inside the budget. High and
 * Ultra render at the full device pixel ratio (up to 2).
 * @module v3/quality
 */
import { percentile } from './gpu-timer.js';

/**
 * `post` lists the render-chain effects (v3/render-chain.js). `features` are
 * flags repos read to switch costly libraries on or off per preset; each one
 * follows a "Keep"/"Fallback" decision in spikes/RESULTS.md.
 */
export const PRESETS = {
  low: {
    label: 'Low (phones, older laptops)',
    pixelRatioMax: 1,
    resolutionScale: 0.85,
    shadowMapSize: 0,
    drawDistance: 400,
    vegetationDensity: 0.4,
    textureMaxSize: 1024,
    post: ['tone', 'lut'],
    features: { cascades: false, lightProbes: false, atmosphere: false, clouds: false, splatsMax: 0, impostorFar: 150 },
  },
  medium: {
    label: 'Medium (default, integrated GPUs)',
    pixelRatioMax: 1.5,
    resolutionScale: 1.0,
    shadowMapSize: 2048,
    drawDistance: 800,
    vegetationDensity: 0.7,
    textureMaxSize: 2048,
    post: ['tone', 'lut'],
    features: { cascades: true, lightProbes: true, atmosphere: false, clouds: false, splatsMax: 150_000, impostorFar: 250 },
  },
  high: {
    label: 'High (discrete GPUs, Apple Pro chips)',
    pixelRatioMax: 2,
    resolutionScale: 1.0,
    shadowMapSize: 2048,
    drawDistance: 1600,
    vegetationDensity: 1.0,
    textureMaxSize: 4096,
    post: ['bloom', 'tone', 'lut', 'smaa'],
    features: { cascades: true, lightProbes: true, atmosphere: true, clouds: false, splatsMax: 150_000, impostorFar: 400 },
  },
  ultra: {
    label: 'Ultra (strong desktops)',
    pixelRatioMax: 2,
    resolutionScale: 1.0,
    shadowMapSize: 4096,
    drawDistance: 3000,
    vegetationDensity: 1.0,
    textureMaxSize: 4096,
    post: ['bloom', 'tone', 'lut', 'smaa'],
    features: { cascades: true, lightProbes: true, atmosphere: true, clouds: true, splatsMax: 300_000, impostorFar: 600 },
  },
};

export const ORDER = ['low', 'medium', 'high', 'ultra'];
export const BUDGET = Object.freeze({ gpuMsP95: 12, fpsMin: 55 });

/**
 * Decide the next benchmark step from one measurement window.
 * @param {string} name  preset that was measured
 * @param {{ p50: number, p95: number, fps: number, samples: number }} m
 * @param {{ verifying?: boolean }} [opts]  verifying = this preset was just stepped up to
 * @returns {'up'|'down'|'stay'|'revert'}
 */
export function decidePreset(name, m, { verifying = false } = {}) {
  const i = ORDER.indexOf(name);
  const timer = m.samples >= 20 && Number.isFinite(m.p95);
  const overBudget = timer ? (m.p95 > BUDGET.gpuMsP95 || m.fps < BUDGET.fpsMin) : m.fps < BUDGET.fpsMin;
  if (verifying) return overBudget ? 'revert' : (i < ORDER.length - 1 && headroom(m, timer) ? 'up' : 'stay');
  if (timer ? (m.p95 > 20 || m.fps < 45) : m.fps < 45) return i > 0 ? 'down' : 'stay';
  if (i < ORDER.length - 1 && headroom(m, timer)) return 'up';
  return 'stay';
}
// Room to step up: well under budget now. Without a timer we never step up
// (fps is capped by vsync and says nothing about headroom).
const headroom = (m, timer) => timer && m.p95 <= 8 && m.p50 <= 5 && m.fps >= 58;

export class QualityManagerV3 {
  /**
   * @param {object} opts
   * @param {string} opts.slug
   * @param {string} [opts.forced]  preset name from a URL or test (skips the benchmark)
   */
  constructor({ slug, forced } = {}) {
    this.slug = slug || 'app';
    this.listeners = new Set();
    const small = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;
    this.name = PRESETS[forced] ? forced : (small ? 'low' : 'medium');
    this.source = PRESETS[forced] ? 'forced' : 'default';
    this.resolutionScale = this.presetDef.resolutionScale;
    this.dynamic = true;
    this.auto = !PRESETS[forced];
    const saved = this._read('quality');
    if (this.auto && PRESETS[saved]) { this.name = saved; this.source = 'user'; this.auto = false; this.resolutionScale = this.presetDef.resolutionScale; }
    const picked = this.auto ? this._readJSON('quality-auto') : null;
    if (picked && PRESETS[picked.preset]) { this.name = picked.preset; this.source = 'benchmark (saved)'; this.auto = false; this.resolutionScale = this.presetDef.resolutionScale; }
  }

  get presetDef() { return PRESETS[this.name]; }
  /** Pixel ratio for renderer.setPixelRatio(). */
  pixelRatio(devicePixelRatio = (typeof window !== 'undefined' ? window.devicePixelRatio : 1)) {
    return Math.min(devicePixelRatio || 1, this.presetDef.pixelRatioMax) * this.resolutionScale;
  }

  /** A preset chosen by the learner (Settings) or a tool: saved, stops the benchmark. */
  set(name) {
    if (!PRESETS[name]) return;
    this.auto = false;
    this.source = 'user';
    this._apply(name);
    try { localStorage.setItem(`${this.slug}:quality`, name); } catch { /* private mode */ }
  }

  /** Used by the benchmark only (not saved as a user choice). */
  _apply(name) {
    this.name = name;
    this.resolutionScale = PRESETS[name].resolutionScale;
    for (const fn of this.listeners) fn(this.presetDef, name);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _read(k) { try { return localStorage.getItem(`${this.slug}:${k}`); } catch { return null; } }
  _readJSON(k) { try { return JSON.parse(this._read(k) || 'null'); } catch { return null; } }
}

/**
 * Startup benchmark. Call `frame(dt)` once per rendered frame with the timer
 * begun/ended around the render; it advances through warm-up and sampling
 * windows and applies presets through the manager. Total run: ~6-12 s.
 */
export class PresetAutoPick {
  /**
   * @param {QualityManagerV3} quality
   * @param {import('./gpu-timer.js').GpuTimer} timer
   * @param {{ warmMs?: number, sampleMs?: number, onDone?: Function }} [opts]
   */
  constructor(quality, timer, { warmMs = 1500, sampleMs = 2500, onDone } = {}) {
    this.q = quality;
    this.timer = timer;
    this.warmMs = warmMs;
    this.sampleMs = sampleMs;
    this.onDone = onDone;
    this.phase = quality.auto ? 'warm' : 'done';
    this.t = 0;
    this.frames = 0;
    this.verifying = false;
    this.history = [];
  }

  get active() { return this.phase !== 'done' && this.q.auto; }

  frame(dtSec) {
    if (!this.active) { if (this.phase !== 'done') this._finish('stopped (preset set by the learner or a tool)'); return; }
    this.t += dtSec * 1000;
    if (this.phase === 'warm') {
      if (this.t >= this.warmMs) { this.phase = 'sample'; this.t = 0; this.frames = 0; this.timer.reset(); }
      return;
    }
    this.frames++;
    if (this.t < this.sampleMs) return;
    const s = this.timer.samples;
    const m = { p50: percentile(s, 0.5), p95: percentile(s, 0.95), fps: this.frames / (this.t / 1000), samples: s.length };
    const step = decidePreset(this.q.name, m, { verifying: this.verifying });
    this.history.push({ preset: this.q.name, ...round(m), step });
    const i = ORDER.indexOf(this.q.name);
    if (step === 'up') { this.verifying = true; this.q._apply(ORDER[i + 1]); this._restart(1000); return; }
    if (step === 'down') { this.verifying = false; this.q._apply(ORDER[i - 1]); this._restart(1000); return; }
    if (step === 'revert') { this.q._apply(ORDER[i - 1]); }
    this._finish(step);
  }

  _restart(warmMs) { this.phase = 'warm'; this.warmMs = warmMs; this.t = 0; }

  _finish(reason) {
    this.phase = 'done';
    if (this.q.auto) {
      this.q.auto = false;
      this.q.source = 'benchmark';
      try { localStorage.setItem(`${this.q.slug}:quality-auto`, JSON.stringify({ preset: this.q.name, at: new Date().toISOString(), history: this.history })); } catch { /* ignore */ }
    }
    this.onDone?.(this.q.name, this.history, reason);
  }
}
const round = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number.isFinite(v) ? +v.toFixed(2) : v]));
