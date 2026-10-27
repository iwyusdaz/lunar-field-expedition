/**
 * Settings dialog: quality preset (with manual override), text size, contrast,
 * cinematic captions on/off, reduced motion, FOV comfort. No audio controls:
 * the project has no audio.
 * Persisted under slug-prefixed keys (shared origin with other projects).
 * @module ui/settings
 */
import { openDialog, closeDialog } from '../a11y/focus.js';

export class Settings {
  /**
   * @param {object} opts
   * @param {string} opts.slug
   * @param {HTMLDialogElement} opts.dialog  a <dialog> in the DOM
   * @param {import('../core/quality.js').QualityManager} [opts.quality]
   * @param {import('../a11y/motion.js').MotionPrefs} [opts.motion]
   * @param {Function} [opts.onFov]  receives fov degrees
   */
  constructor({ slug, dialog, quality, motion, onFov }) {
    this.slug = slug;
    this.dialog = dialog;
    this.quality = quality;
    this.motion = motion;
    this.onFov = onFov;
    this.state = this._load();
    this._build();
  }

  _load() {
    const d = {
      textSize: 'normal',
      contrast: 'normal',
      captions: true,
      fov: 60,
    };
    try { Object.assign(d, JSON.parse(localStorage.getItem(`${this.slug}:settings`) || '{}')); } catch { /* ignore */ }
    // older saves carried audio settings for audio that never existed
    for (const k of ['volumeMaster', 'volumeVoice', 'volumeAmbient', 'muted']) delete d[k];
    return d;
  }

  save() {
    try { localStorage.setItem(`${this.slug}:settings`, JSON.stringify(this.state)); } catch { /* ignore */ }
  }

  _build() {
    const q = this.dialog;
    q.innerHTML = `
      <h2>Settings</h2>
      <form method="dialog">
        <fieldset>
          <legend>Graphics quality</legend>
          <label>Quality preset
            <select id="set-quality">
              <option value="low">Low (phones, older laptops)</option>
              <option value="medium">Medium (integrated GPUs)</option>
              <option value="high">High (discrete GPUs)</option>
              <option value="ultra">Ultra (strong desktops)</option>
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Display</legend>
          <label>Text size
            <select id="set-textsize">
              <option value="normal">Normal</option>
              <option value="large">Large</option>
              <option value="xlarge">Extra large</option>
            </select>
          </label>
          <label>Contrast
            <select id="set-contrast">
              <option value="normal">Normal</option>
              <option value="high">High contrast</option>
            </select>
          </label>
          <label>Field of view (comfort) <output id="set-fov-out">${this.state.fov}°</output>
            <input type="range" id="set-fov" min="40" max="90" step="5" value="${this.state.fov}">
          </label>
        </fieldset>
        <fieldset>
          <legend>Captions</legend>
          <p class="tool-hint">This project has no audio. The cinematic tells its story in on-screen captions.</p>
          <label><input type="checkbox" id="set-captions" ${this.state.captions ? 'checked' : ''}> Show cinematic captions</label>
        </fieldset>
        <fieldset>
          <legend>Motion</legend>
          <label><input type="checkbox" id="set-motion" ${this.motion?.reduced ? 'checked' : ''}> Reduce motion (no camera flights; still frames and cuts instead)</label>
        </fieldset>
        <menu>
          <button value="cancel" type="button" id="set-cancel">Cancel</button>
          <button value="confirm" type="submit" id="set-save">Save settings</button>
        </menu>
      </form>`;
    const $ = (id) => q.querySelector(id);
    if (this.quality) $('select#set-quality').value = this.quality.name;
    $('select#set-textsize').value = this.state.textSize;
    $('select#set-contrast').value = this.state.contrast;
    $('input#set-captions').checked = this.state.captions;
    $('input#set-motion').checked = Boolean(this.motion?.reduced);
    $('input#set-fov').addEventListener('input', (e) => { $('output#set-fov-out').textContent = `${e.target.value}°`; });
    $('button#set-cancel').addEventListener('click', () => closeDialog(q));
    q.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.quality) {
        const v = $('select#set-quality').value;
        if (v !== this.quality.name) this.quality.set(v);
      }
      this.state.textSize = $('select#set-textsize').value;
      this.state.contrast = $('select#set-contrast').value;
      this.state.captions = $('input#set-captions').checked;
      this.state.fov = parseFloat($('input#set-fov').value);
      if (this.motion) this.motion.setToggle($('input#set-motion').checked);
      this.save();
      this._apply();
      closeDialog(q);
    });
  }

  _apply() {
    const root = document.documentElement;
    root.dataset.textSize = this.state.textSize;
    root.dataset.contrast = this.state.contrast;
    // read by CSS: [data-captions="off"] .cinematic-caption { display: none }
    root.dataset.captions = this.state.captions ? 'on' : 'off';
    this.onFov?.(this.state.fov);
  }

  /** Open via the shell's Settings button. */
  open(trigger) { this._build(); openDialog(this.dialog, trigger); this._apply(); }
}
