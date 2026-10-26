/**
 * Reduced motion: respects prefers-reduced-motion, offers an in-game toggle.
 * When enabled: no camera flights (stills/cuts), no head bob, no screen shake,
 * snap camera transitions (standards section 5, item 6).
 * @module a11y/motion
 */

const listeners = new Set();

export class MotionPrefs {
  constructor(slug) {
    this.slug = slug;
    this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this._system = this.media.matches;
    try {
      const saved = localStorage.getItem(`${slug}:motion`);
      this.toggle = saved === null ? null : saved === 'reduced';
    } catch { this.toggle = null; }
    this.media.addEventListener?.('change', () => {
      this._system = this.media.matches;
      for (const fn of listeners) fn(this.reduced);
    });
  }

  /** Effective reduced-motion state (system preference unless the user overrides). */
  get reduced() { return this.toggle === null ? this._system : this.toggle; }

  setToggle(reduced) {
    this.toggle = reduced;
    try { localStorage.setItem(`${this.slug}:motion`, reduced ? 'reduced' : 'full'); } catch { /* ignore */ }
    for (const fn of listeners) fn(this.reduced);
  }

  onChange(fn) { listeners.add(fn); }

  /** Map a duration: 0 when reduced (snap), else the given seconds. */
  dur(seconds) { return this.reduced ? 0 : seconds; }
}
