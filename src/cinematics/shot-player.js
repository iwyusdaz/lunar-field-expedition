/**
 * Data-driven cinematic shot player (standards section 3.2).
 * Shots come from content/cinematics.json: camera path points, target, duration,
 * easing, captions, purpose tag. Every shot is skippable from the first frame
 * (Skip button + Esc), captioned, with a text description, and has a reduced-motion
 * version (still frames + captions). Cinematics never play during assessment.
 * @module cinematics/shot-player
 */
import { Vector3, CatmullRomCurve3 } from 'three';

export const EASINGS = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeOut: (t) => 1 - (1 - t) ** 3,
};

/** Caption text: captions are `{at, text}` (at = fraction of the shot) or plain strings. */
export function captionText(c) { return typeof c === 'string' ? c : c?.text || ''; }

/**
 * Index of the caption showing at shot time t (0-1): the last caption whose
 * `at` is <= t. Plain-string captions are spread evenly across the shot.
 */
export function captionIndexAt(captions, t) {
  if (!captions?.length) return -1;
  let idx = 0;
  captions.forEach((c, i) => {
    const at = typeof c === 'string' ? i / captions.length : (c.at ?? 0);
    if (at <= t) idx = i;
  });
  return idx;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container   overlay that hosts captions/skip UI
 * @param {import('three').PerspectiveCamera} opts.camera
 * @param {import('../a11y/motion.js').MotionPrefs} opts.motion
 * @param {Function} [opts.onDone]
 * @param {Function} [opts.onSkip]       called when skipped (logged as experienced)
 */
export class ShotPlayer {
  constructor({ container, camera, motion, onDone, onSkip }) {
    this.container = container;
    this.camera = camera;
    this.motion = motion;
    this.onDone = onDone;
    this.onSkip = onSkip;
    this.shots = [];
    this.index = -1;
    this.playing = false;
    this._t = 0;
    this._raf = null;
    this._buildUI();
  }

  _buildUI() {
    this.root = document.createElement('div');
    this.root.className = 'cinematic-overlay';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Cinematic');
    this.caption = document.createElement('p');
    this.caption.className = 'cinematic-caption';
    this.caption.setAttribute('aria-live', 'polite');
    this.desc = document.createElement('p');
    this.desc.className = 'cinematic-audio-description visually-hidden';
    this.progress = document.createElement('p');
    this.progress.className = 'cinematic-progress';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'cinematic-skip';
    skip.textContent = 'Skip cinematic (Esc)';
    skip.addEventListener('click', () => this.skip());
    this.root.append(this.progress, this.caption, this.desc, skip);
    this.container.appendChild(this.root);
    this.root.hidden = true;
    this._esc = (e) => { if (e.key === 'Escape' && this.playing) this.skip(); };
    document.addEventListener('keydown', this._esc);
  }

  /** Load a cinematic definition { id, title, shots: [...] } from content JSON. */
  load(def) {
    this.def = def;
    this.shots = def.shots || [];
    this.index = -1;
  }

  play() {
    if (!this.shots.length) { this.onDone?.(); return; }
    this.playing = true;
    this.root.hidden = false;
    this.index = -1;
    this._nextShot();
  }

  _nextShot() {
    this.index++;
    if (this.index >= this.shots.length) return this._finish();
    const shot = this.shots[this.index];
    this.progress.textContent = `Shot ${this.index + 1} of ${this.shots.length} — purpose: ${shot.purpose}`;
    this._captionIdx = -1;
    this._showCaptionAt(shot, 0);
    this.desc.textContent = shot.description || '';
    this._t = 0;
    const rm = shot.reducedMotion;
    if (this.motion.reduced && rm?.kind === 'stills') {
      // Reduced-motion version: still frames along the path + per-still captions.
      const stills = rm.stills?.length ? rm.stills : [1];
      const caps = rm.captionsPerStill || [];
      let i = 0;
      const showStill = () => {
        if (!this.playing) return;
        const frac = stills[Math.min(i, stills.length - 1)];
        if (caps[i]) this.caption.textContent = caps[i];
        this._placeAt(shot, frac);
        this.onProgress?.(shot, frac);
        i++;
        if (i < stills.length) this._stillTimer = setTimeout(showStill, 4200);
        else this._stillTimer = setTimeout(() => this._nextShot(), 4200);
      };
      showStill();
    } else {
      if (this.motion.reduced) {
        // no reducedMotion data: still at the end of the path
        this._placeAt(shot, 1);
        this.onProgress?.(shot, 1);
        this._stillTimer = setTimeout(() => this._nextShot(), Math.max(2500, (shot.duration || 10) * 700));
        return;
      }
      this._start = performance.now();
      cancelAnimationFrame(this._raf);
      const step = () => {
        if (!this.playing) return;
        const elapsed = (performance.now() - this._start) / 1000;
        const dur = shot.duration || 10;
        const t = Math.min(1, elapsed / dur);
        this._placeAt(shot, t);
        this._showCaptionAt(shot, t);
        this.onProgress?.(shot, t);
        if (t >= 1) { this._nextShot(); return; }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }
  }

  /** Swap to the caption due at shot time t (0-1); only touches the DOM on a change. */
  _showCaptionAt(shot, t) {
    const i = captionIndexAt(shot.captions, t);
    if (i === this._captionIdx) return;
    this._captionIdx = i;
    this.caption.textContent = i >= 0 ? captionText(shot.captions[i]) : '';
  }

  _placeAt(shot, t) {
    const ease = EASINGS[shot.easing] || EASINGS.easeInOut;
    const k = ease(t);
    const pts = (shot.path || []).map(p => new Vector3(...p));
    const target = new Vector3(...(shot.target || [0, 0, 0]));
    let pos;
    if (pts.length === 0) pos = this.camera.position.clone();
    else if (pts.length === 1) pos = pts[0];
    else if (pts.length === 2) pos = pts[0].clone().lerp(pts[1], k);
    else pos = new CatmullRomCurve3(pts).getPoint(k);
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }

  skip() {
    if (!this.playing) return;
    clearTimeout(this._stillTimer);
    cancelAnimationFrame(this._raf);
    this.playing = false;
    this.root.hidden = true;
    this.onSkip?.(this.def?.id);
    this.onDone?.();
  }

  _finish() {
    this.playing = false;
    this.root.hidden = true;
    this.onDone?.();
  }

  dispose() {
    document.removeEventListener('keydown', this._esc);
    clearTimeout(this._stillTimer);
    cancelAnimationFrame(this._raf);
    this.root?.remove();
  }
}
