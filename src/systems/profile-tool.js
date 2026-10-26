/**
 * Elevation-profile tool (objective 1/2 support): pick two points on the terrain
 * (pointer) or choose a preset transect (keyboard/text equivalent), draw the
 * profile as an inline SVG chart WITH its data table (numeric text equivalent
 * always present — standards section 5 item 2 and plan section 11).
 * @module systems/profile-tool
 */
import { announce } from '../a11y/announcer.js';

export class ProfileTool {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container
   * @param {import('../scenes/hadley-site.js').HadleySite} opts.site
   * @param {Array<{id:string,label:string,from:{lon:number,lat:number},to:{lon:number,lat:number},teaches:string}>} opts.presets
   * @param {Function} [opts.onComplete] called with {distanceM, elevGainM, depthBelowRimM} when a profile is measured
   */
  constructor({ container, site, presets, onComplete }) {
    this.site = site;
    this.presets = presets;
    this.onComplete = onComplete;
    this.points = [];
    this.picking = false;
    this.root = this._build(container);
  }

  _build(container) {
    const root = document.createElement('section');
    root.className = 'tool profile-tool';
    root.setAttribute('aria-label', 'Elevation profile tool');
    root.innerHTML = `
      <h3>Elevation profile</h3>
      <p class="tool-hint">Click two points on the terrain (or use a preset transect). The chart and the data table both show the real LROC terrain data.</p>
      <div class="profile-controls">
        <button type="button" class="btn profile-pick">Pick points on terrain</button>
        <label class="visually-hidden" for="profile-preset">Preset transects</label>
        <select id="profile-preset">
          <option value="">Choose a preset transect…</option>
          ${this.presets.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}
        </select>
      </div>
      <p class="profile-status" role="status">No points picked yet.</p>
      <div class="profile-chart" role="img" aria-label="Elevation profile chart"></div>
      <details class="profile-table-wrap">
        <summary>Profile data table (numeric values)</summary>
        <div class="profile-table"></div>
      </details>
      <p class="profile-note"></p>`;
    container.appendChild(root);
    root.querySelector('.profile-pick').addEventListener('click', () => {
      this.picking = !this.picking;
      this.points = [];
      this.root.querySelector('.profile-status').textContent = this.picking
        ? 'Pick mode on: click point A on the terrain.'
        : 'Pick mode off.';
      this.root.querySelector('.profile-pick').setAttribute('aria-pressed', String(this.picking));
      announce(this.root.querySelector('.profile-status').textContent);
    });
    root.querySelector('#profile-preset').addEventListener('change', (e) => {
      const p = this.presets.find(x => x.id === e.target.value);
      if (!p) return;
      const A = this.site.terrain.fromLonLat(p.from.lon, p.from.lat);
      const B = this.site.terrain.fromLonLat(p.to.lon, p.to.lat);
      this._measure(A, B, p);
    });
    return root;
  }

  /** Called by the app when the learner clicks the canvas while picking. */
  handleCanvasClick(ndcX, ndcY) {
    if (!this.picking) return false;
    const hit = this.site.pickTerrain(ndcX, ndcY);
    if (!hit) return true;
    this.points.push({ xM: hit.xM, yM: hit.yM });
    const status = this.root.querySelector('.profile-status');
    if (this.points.length === 1) {
      status.textContent = 'Point A set. Now click point B.';
      announce('Point A set. Now click point B.');
    } else if (this.points.length >= 2) {
      this.picking = false;
      this._measure(this.points[0], this.points[1], null);
    }
    return true;
  }

  _measure(A, B, preset) {
    const steps = 60;
    const rows = [];
    let minE = Infinity, maxE = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = A.xM + (B.xM - A.xM) * t;
      const y = A.yM + (B.yM - A.yM) * t;
      const e = this.site.terrain.elevationAt(x, y);
      rows.push({ distM: Math.round(Math.hypot(B.xM - A.xM, B.yM - A.yM) * t), elevM: e });
      if (!Number.isNaN(e)) { minE = Math.min(minE, e); maxE = Math.max(maxE, e); }
    }
    const valid = rows.filter(r => !Number.isNaN(r.elevM));
    if (valid.length < 5) {
      this.root.querySelector('.profile-status').textContent = 'That line crosses an area with no terrain data (the DTM edge). Pick points closer to the landing site.';
      announce('That line crosses an area with no terrain data. Pick points closer to the landing site.');
      return;
    }
    const distM = Math.round(Math.hypot(B.xM - A.xM, B.yM - A.yM));
    const elevGainM = Math.round(maxE - valid[0].elevM);
    const reliefM = Math.round(maxE - minE);
    this._drawChart(rows, minE, maxE);
    this._drawTable(rows);
    const note = this.root.querySelector('.profile-note');
    const summary = `Distance ${distM} m; highest point ${Math.round(maxE)} m, lowest ${Math.round(minE)} m (elevations relative to the lunar reference sphere); relief along the line ${reliefM} m.`;
    note.textContent = preset ? `${summary} ${preset.teaches}` : summary;
    this.root.querySelector('.profile-status').textContent = 'Profile measured.';
    announce(summary);
    this.onComplete?.({ distanceM: distM, elevGainM, reliefM, minE: Math.round(minE), maxE: Math.round(maxE) });
  }

  _drawChart(rows, minE, maxE) {
    const wrap = this.root.querySelector('.profile-chart');
    const W = 640, H = 220, pad = 34;
    const span = Math.max(1, maxE - minE);
    const n = rows.length;
    let d = '';
    rows.forEach((r, i) => {
      const x = pad + (W - 2 * pad) * (i / (n - 1));
      const y = H - pad - (H - 2 * pad) * ((r.elevM - minE) / span);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + (Number.isNaN(y) ? H - pad : y).toFixed(1) + ' ';
    });
    wrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-hidden="true">
        <rect x="0" y="0" width="${W}" height="${H}" fill="#141419" stroke="#3a3a44"></rect>
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#555"></line>
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="#555"></line>
        <text x="${W / 2}" y="${H - 6}" fill="#bbb" font-size="12" text-anchor="middle">distance along line (m) — start ${rows[0].distM}, end ${rows[n - 1].distM}</text>
        <text x="10" y="${pad - 8}" fill="#bbb" font-size="12">${Math.round(maxE)} m</text>
        <text x="10" y="${H - pad + 14}" fill="#bbb" font-size="12">${Math.round(minE)} m</text>
        <path d="${d}" fill="none" stroke="#ffd24a" stroke-width="2"></path>
      </svg>`;
  }

  _drawTable(rows) {
    const wrap = this.root.querySelector('.profile-table');
    const step = Math.max(1, Math.floor(rows.length / 20));
    const sel = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    const table = document.createElement('table');
    table.innerHTML = `<caption>Elevation along the profile (every ${step}th sample)</caption>
      <thead><tr><th scope="col">Distance (m)</th><th scope="col">Elevation (m)</th></tr></thead>
      <tbody>${sel.map(r => `<tr><td>${r.distM}</td><td>${Number.isNaN(r.elevM) ? 'no data' : Math.round(r.elevM)}</td></tr>`).join('')}</tbody>`;
    wrap.innerHTML = '';
    wrap.appendChild(table);
  }
}
