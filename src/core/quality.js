/**
 * Quality presets, warm-up auto-selection, dynamic resolution.
 * Budgets (standards 4.5): >= 55 fps on Medium; Low usable on phones.
 * @module core/quality
 */

export const PRESETS = {
  low: {
    label: 'Low (phones, older laptops)',
    resolutionScale: 0.75,
    shadowMapSize: 0,            // no real-time shadows
    maxLights: 2,
    drawDistance: 400,
    vegetationDensity: 0.4,
    post: ['tone'],              // tone mapping only
    textureMaxSize: 1024,
    aoEnabled: false,
  },
  medium: {
    label: 'Medium (default, integrated GPUs)',
    resolutionScale: 1.0,
    shadowMapSize: 2048,
    maxLights: 4,
    drawDistance: 800,
    vegetationDensity: 0.7,
    post: ['tone', 'smaa', 'bloom-light'],
    textureMaxSize: 2048,
    aoEnabled: false,
  },
  high: {
    label: 'High (discrete GPUs, Apple Pro chips)',
    resolutionScale: 1.0,
    shadowMapSize: 2048,
    maxLights: 6,
    drawDistance: 1600,
    vegetationDensity: 1.0,
    post: ['tone', 'smaa', 'bloom-light', 'ao'],
    textureMaxSize: 4096,
    aoEnabled: true,
  },
  ultra: {
    label: 'Ultra (strong desktops)',
    resolutionScale: 1.0,
    shadowMapSize: 4096,
    maxLights: 8,
    drawDistance: 3000,
    vegetationDensity: 1.0,
    post: ['tone', 'smaa', 'bloom-light', 'ao'],
    textureMaxSize: 4096,
    aoEnabled: true,
  },
};

const ORDER = ['low', 'medium', 'high', 'ultra'];

export class QualityManager {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {string|undefined} forcedPreset
   */
  constructor(renderer, forcedPreset) {
    this.renderer = renderer;
    this.auto = !forcedPreset;
    this.dynamic = true;
    // Default guess: mobile / small screens start at Low, desktops at Medium.
    const isSmall = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.name = forcedPreset || (isSmall ? 'low' : 'medium');
    this.resolutionScale = this.presetDef.resolutionScale;
    this.listeners = [];
  }

  get presetDef() { return PRESETS[this.name]; }

  /** Apply a preset by name; fires change listeners (used by scenes to adjust density). */
  set(name) {
    if (!PRESETS[name]) return;
    this.name = name;
    this.auto = false;
    this.resolutionScale = PRESETS[name].resolutionScale;
    for (const fn of this.listeners) fn(this.presetDef, name);
    try { localStorage.setItem(this.storageKey(), name); } catch { /* private mode */ }
  }

  storageKey() { return (window.__SLUG__ || 'app') + ':quality'; }

  restore() {
    try {
      const saved = localStorage.getItem(this.storageKey());
      if (saved && PRESETS[saved]) this.set(saved);
    } catch { /* ignore */ }
  }

  /** Warm-up benchmark: pick the highest preset that keeps >= 55 fps. */
  autoSelect(measuredFps) {
    if (!this.auto || measuredFps <= 0) return;
    const idx = ORDER.indexOf(this.name);
    if (measuredFps < 45 && idx > 0) {
      this.name = ORDER[idx - 1];
      this.resolutionScale = PRESETS[this.name].resolutionScale;
      for (const fn of this.listeners) fn(this.presetDef, this.name);
    } else if (measuredFps > 70 && idx < ORDER.length - 1) {
      this.name = ORDER[idx + 1];
      this.resolutionScale = PRESETS[this.name].resolutionScale;
      for (const fn of this.listeners) fn(this.presetDef, this.name);
    }
  }

  onChange(fn) { this.listeners.push(fn); }
}
