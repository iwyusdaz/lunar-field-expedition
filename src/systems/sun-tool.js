/**
 * Sun-angle tool (objective 2): labeled sliders with keyboard steps and named
 * presets. Fully keyboard operable; every change is announced to the live
 * region and shown as a numeric readout (never color alone).
 * @module systems/sun-tool
 */
import { announce } from '../a11y/announcer.js';
import { shadowLengthFactor } from './sun-model.js';

export class SunTool {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container
   * @param {Array<{id:string,label:string,elevationDeg:number,azimuthDeg:number}>} opts.presets
   * @param {(elevationDeg:number, azimuthDeg:number)=>void} opts.onSun
   * @param {Function} [opts.onUse] called when the learner actively uses the tool
   */
  constructor({ container, presets, onSun, onUse }) {
    this.presets = presets;
    this.onSun = onSun;
    this.onUse = onUse;
    // Start at the low-sun preset: relief is visible and the scene matches the
    // mission story (the crew landed just after local sunrise).
    const start = presets.find(p => p.id === 'low') || presets[0];
    this.elevation = start.elevationDeg;
    this.azimuth = start.azimuthDeg;
    this.root = this._build(container);
    this.apply();
  }

  _build(container) {
    const root = document.createElement('section');
    root.className = 'tool sun-tool';
    root.setAttribute('aria-label', 'Sun-angle tool');
    root.innerHTML = `
      <h3>Sun-angle tool</h3>
      <p class="tool-hint">Move the Sun. A 1 m rock casts a shadow
        <output id="sun-shadow-out">—</output> m long at this angle.</p>
      <label>Elevation above the horizon: <output id="sun-elev-out">${this.elevation}°</output>
        <input type="range" id="sun-elev" min="3" max="70" step="1" value="${this.elevation}"
               aria-describedby="sun-elev-help"></label>
      <p class="visually-hidden" id="sun-elev-help">Left and right arrow keys change the sun elevation in 1 degree steps; Page Up and Page Down in 10 degree steps.</p>
      <label>Azimuth (direction): <output id="sun-az-out">${this.azimuth}°</output>
        <input type="range" id="sun-az" min="0" max="359" step="2" value="${this.azimuth}"></label>
      <fieldset>
        <legend>Presets</legend>
        <div class="preset-row" role="group" aria-label="Sun angle presets"></div>
      </fieldset>`;
    container.appendChild(root);
    const elev = root.querySelector('#sun-elev');
    const az = root.querySelector('#sun-az');
    elev.addEventListener('input', () => { this.elevation = +elev.value; this.onUse?.(); this.apply(true); });
    az.addEventListener('input', () => { this.azimuth = +az.value; this.onUse?.(); this.apply(true); });
    const row = root.querySelector('.preset-row');
    for (const p of this.presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset-btn';
      b.dataset.preset = p.id;
      b.textContent = `${p.label} (${p.elevationDeg}°)`;
      b.addEventListener('click', () => {
        this.elevation = p.elevationDeg;
        this.azimuth = p.azimuthDeg;
        this.onUse?.();
        this.apply(true);
      });
      row.appendChild(b);
    }
    return root;
  }

  apply(announceChange = false) {
    const elevOut = this.root.querySelector('#sun-elev-out');
    const azOut = this.root.querySelector('#sun-az-out');
    const shOut = this.root.querySelector('#sun-shadow-out');
    elevOut.textContent = `${this.elevation}°`;
    azOut.textContent = `${this.azimuth}°`;
    shOut.textContent = shadowLengthFactor(this.elevation).toFixed(1);
    elevOut.setAttribute('value', String(this.elevation));
    azOut.setAttribute('value', String(this.azimuth));
    for (const b of this.root.querySelectorAll('.preset-btn')) {
      const p = this.presets.find(x => x.id === b.dataset.preset);
      b.setAttribute('aria-pressed', String(p && p.elevationDeg === this.elevation && p.azimuthDeg === this.azimuth));
    }
    this.root.querySelector('#sun-elev').value = String(this.elevation);
    this.root.querySelector('#sun-az').value = String(this.azimuth);
    this.onSun?.(this.elevation, this.azimuth);
    if (announceChange) announce(`Sun elevation ${this.elevation} degrees, shadow length ${shadowLengthFactor(this.elevation).toFixed(1)} times object height`);
  }

  /** Programmatic control (tests, cinematics sync). */
  set(elevationDeg, azimuthDeg) {
    this.elevation = Math.round(elevationDeg);
    this.azimuth = Math.round(azimuthDeg);
    this.apply();
  }
}
