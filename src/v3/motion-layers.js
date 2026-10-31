/**
 * motion-layers.js — the living-world motion manager (plan 10 §5).
 *
 * Every independent motion system in a scene registers here with its layer
 * (sky, environment, agents, objects) and an accuracy label (§5.2):
 *   'accurate'     physically correct at real speed
 *   'time-lapse'   correct but sped up; the catalog card must say so
 *   'illustrative' simplified or invented frequency; the card must say so
 * Each main scene needs at least eight systems across the four layers
 * (`report().ok`). Calm mode (09 decision 1) slows non-essential motion to 30%
 * during focused tasks and sets data-calm="on" on <html>; reduced motion stops
 * every non-essential system, including camera drift.
 * Card hold: while an object's info card is open, the systems that move that
 * object (s.objects lists its id) pause, so the framed object stays in the
 * frame beside its card (a driving vehicle, a walking person, the Sun in
 * time-lapse). A system that changes the object in place and is part of what
 * the card shows (a spinning globe, a flicker) sets holdWithCard: false.
 * @module v3/motion-layers
 */

export const MOTION_LAYERS = Object.freeze(['sky', 'environment', 'agents', 'objects']);
export const MOTION_LABELS = Object.freeze(['accurate', 'time-lapse', 'illustrative']);
export const MIN_SYSTEMS = 8;

export class MotionLayerManager {
  /** @param {{ reducedMotion?: boolean, calmFactor?: number, root?: HTMLElement|null }} [opts] */
  constructor(opts = {}) {
    this.systems = new Map();
    this.reducedMotion = Boolean(opts.reducedMotion);
    this.calm = false;
    this.calmTarget = opts.calmFactor ?? 0.3;
    this.factor = this.reducedMotion ? 0 : 1;
    this.root = opts.root === undefined ? (typeof document !== 'undefined' ? document.documentElement : null) : opts.root;
    this.time = 0; // scene time, advanced by dt * factor
    this.held = new Set(); // catalog ids whose card is open (card hold)
  }

  /** Card hold: pause the systems that move these catalog ids (empty to release). */
  setHeld(ids = []) { this.held = new Set(ids); }

  /** True while a system is paused by an open card. */
  isHeld(s) { return s.holdWithCard !== false && this.held.size > 0 && s.objects.some((id) => this.held.has(id)); }

  /**
   * Register a motion system.
   * @param {object} s
   * @param {string} s.id
   * @param {'sky'|'environment'|'agents'|'objects'} s.layer
   * @param {'accurate'|'time-lapse'|'illustrative'} s.label
   * @param {string} s.description          what moves, for review and text mode
   * @param {(dt: number, t: number, factor: number) => void} s.update
   * @param {string[]} [s.objects]           catalog ids whose cards explain this motion
   * @param {boolean} [s.essential=false]    keeps running under reduced motion (lesson-critical only)
   * @param {(frozen: boolean) => void} [s.onFreeze]  called when reduced motion stops or restarts it
   * @param {boolean} [s.holdWithCard=true]  pause while a card of one of s.objects is open
   */
  add(s) {
    if (!MOTION_LAYERS.includes(s.layer)) throw new Error(`motion ${s.id}: layer must be one of ${MOTION_LAYERS.join(', ')}`);
    if (!MOTION_LABELS.includes(s.label)) throw new Error(`motion ${s.id}: label must be one of ${MOTION_LABELS.join(', ')}`);
    if (typeof s.update !== 'function') throw new Error(`motion ${s.id}: update() is required`);
    if (this.systems.has(s.id)) throw new Error(`motion ${s.id}: duplicate id`);
    this.systems.set(s.id, { essential: false, objects: [], description: '', ...s });
    return s;
  }

  remove(id) { this.systems.delete(id); }

  setCalm(on) {
    this.calm = Boolean(on);
    if (this.root) this.root.dataset.calm = this.calm ? 'on' : 'off';
  }

  setReducedMotion(on) {
    const was = this.reducedMotion;
    this.reducedMotion = Boolean(on);
    if (was !== this.reducedMotion) for (const s of this.systems.values()) if (!s.essential) s.onFreeze?.(this.reducedMotion);
  }

  /** Advance every system. Essential systems ignore calm and reduced motion. */
  update(dt) {
    const target = this.reducedMotion ? 0 : (this.calm ? this.calmTarget : 1);
    this.factor += (target - this.factor) * (1 - Math.exp(-dt / 0.35));
    if (this.reducedMotion) this.factor = 0;
    const eff = dt * this.factor;
    this.time += eff;
    for (const s of this.systems.values()) {
      if (s.essential) { s.update(dt, this.time, 1); continue; }
      if (this.reducedMotion || this.isHeld(s)) continue;
      s.update(eff, this.time, this.factor);
    }
  }

  /** Counts per layer and the plan §5.1 check (>= 8 systems, all four layers used). */
  report() {
    const byLayer = Object.fromEntries(MOTION_LAYERS.map((l) => [l, 0]));
    const list = [];
    for (const s of this.systems.values()) {
      byLayer[s.layer]++;
      list.push({ id: s.id, layer: s.layer, label: s.label, description: s.description, objects: s.objects, essential: s.essential, holdWithCard: s.holdWithCard !== false });
    }
    const total = list.length;
    const missing = MOTION_LAYERS.filter((l) => !byLayer[l]);
    return { total, byLayer, missing, ok: total >= MIN_SYSTEMS && !missing.length, systems: list };
  }

  /**
   * Accuracy check (§5.2): every time-lapse or illustrative system must name at
   * least one catalog object whose card carries the same word ('time-lapse' or
   * 'illustrative') in its honesty field or text.
   * @returns {string[]} problems
   */
  checkLabels(catalog) {
    const problems = [];
    for (const s of this.systems.values()) {
      if (s.label === 'accurate') continue;
      if (!s.objects.length) { problems.push(`${s.id}: ${s.label} motion names no catalog object`); continue; }
      const ok = s.objects.some((id) => {
        const o = catalog.get(id);
        if (!o) return false;
        const text = `${o.honesty} ${o.short} ${o.more}`.toLowerCase();
        return text.includes(s.label);
      });
      if (!ok) problems.push(`${s.id}: no card among ${s.objects.join(', ')} says "${s.label}"`);
    }
    return problems;
  }
}
