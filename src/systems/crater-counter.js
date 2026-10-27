/**
 * Crater-counting tool (objective 3): two equal-area patches from the real DTM.
 * Click inside the active patch to mark craters at/above the size threshold;
 * undo; submit for a density comparison; a "show the reference count" reveal
 * exposes the DTM-derived computer count. The 3D task needs vision — the
 * documented equivalent is the text-mode size-frequency data task.
 * @module systems/crater-counter
 */
import * as THREE from 'three';
import { announce } from '../a11y/announcer.js';

/**
 * Points of a reference ring `diameterM` across, centred just outside a patch's
 * east rim. Pure (elevation passed in) so it can be unit-tested.
 */
export function scaleRingPoints(patch, diameterM, elevationAt, segments = 64) {
  const r = diameterM / 2;
  const cx = patch.center.xM + patch.radiusM + r + 20;
  const cy = patch.center.yM;
  const lift = (x, y) => { const e = elevationAt(x, y); return (Number.isNaN(e) ? -1900 : e) + 3; };
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    points.push({ x, y: lift(x, y), z: y });
  }
  return { center: { x: cx, y: lift(cx, cy), z: cy }, radiusM: r, points };
}

/** Plain-language comparison of two densities (a tie is reported as a tie). */
export function densityComparison(names, d0, d1) {
  if (d0 === d1) return `Your counts give the two patches the same density${d0 === 0 ? ' (no craters marked)' : ''}.`;
  return `Your counts say the ${(d0 > d1 ? names[0] : names[1]).toLowerCase()} carries more craters per area.`;
}

export class CraterCounter {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container
   * @param {import('../scenes/hadley-site.js').HadleySite} opts.site
   * @param {Array<{id:string,center:{lon:number,lat:number},radiusM:number,craters:Array,densityPerKm2:number,areaKm2:number}>} opts.patches
   * @param {number} opts.thresholdM minimum crater diameter to count
   * @param {Function} [opts.onSubmit] called with {counts:{patchId:n}, densities:{patchId:n}}
   */
  constructor({ container, site, patches, thresholdM, onSubmit }) {
    this.site = site;
    this.patches = patches;
    this.thresholdM = thresholdM;
    this.onSubmit = onSubmit;
    this.marks = { [patches[0].id]: [], [patches[1].id]: [] };
    this.active = patches[0].id;
    this.submitted = false;
    this.root = this._build(container);
    this._drawPatches();
  }

  _build(container) {
    const root = document.createElement('section');
    root.className = 'tool crater-counter';
    root.setAttribute('aria-label', 'Crater counting tool');
    root.innerHTML = `
      <h3>Crater counter</h3>
      <p class="tool-hint">Count every crater about ${this.thresholdM} m across or larger inside the marked patch.
        The white ring labelled "${this.thresholdM} m" beside each patch is a size reference: count craters at least that wide.
        Click a crater to mark it; click a mark to remove it. You can switch between the two patches.</p>
      <div class="patch-tabs" role="tablist" aria-label="Counting patches">
        ${this.patches.map(p => `<button type="button" role="tab" data-patch="${p.id}" aria-selected="${p.id === this.active}">${p.name}</button>`).join('')}
      </div>
      <p class="count-status" role="status"></p>
      <div class="counter-actions">
        <button type="button" class="btn cc-undo">Undo last mark</button>
        <button type="button" class="btn cc-submit">Submit counts</button>
        <button type="button" class="btn cc-reference" hidden>Show the reference count</button>
      </div>
      <div class="cc-results" aria-live="polite"></div>`;
    container.appendChild(root);
    for (const b of root.querySelectorAll('[role=tab]')) {
      b.addEventListener('click', () => {
        this.active = b.dataset.patch;
        for (const t of root.querySelectorAll('[role=tab]')) t.setAttribute('aria-selected', String(t.dataset.patch === this.active));
        this._updateStatus();
      });
    }
    root.querySelector('.cc-undo').addEventListener('click', () => {
      this.marks[this.active].pop();
      announce(`Mark removed. ${this.marks[this.active].length} marks in this patch.`);
      this._updateStatus();
    });
    root.querySelector('.cc-submit').addEventListener('click', () => this._submit());
    root.querySelector('.cc-reference').addEventListener('click', () => this._revealReference());
    this.root = root; // available to _updateStatus during construction
    this._updateStatus();
    return root;
  }

  _drawPatches() {
    // circle outlines on the terrain (visible rings)
    for (const p of this.patches) {
      const A = p.center; // content/craters.json stores patch centres in site metres ({ xM, yM })
      const pts = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const x = A.xM + p.radiusM * Math.cos(a);
        const y = A.yM + p.radiusM * Math.sin(a);
        const e = this.site.terrain.elevationAt(x, y);
        pts.push(new THREE.Vector3(x, (Number.isNaN(e) ? -1900 : e) + 3, y));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const color = p.id === 'mare' ? 0x66d9e8 : 0xffb347;
      this.site.group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })));
      this._drawScaleRing(p);
    }
  }

  /**
   * Scale reference: a white ring exactly `thresholdM` across, just outside the
   * patch's east rim, with a screen-size label, so learners can judge which
   * craters are "about 80 m or larger".
   */
  _drawScaleRing(p) {
    const ref = scaleRingPoints(p, this.thresholdM, (x, y) => this.site.terrain.elevationAt(x, y));
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ref.points.map(q => new THREE.Vector3(q.x, q.y, q.z))),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    ring.renderOrder = 9;
    ring.name = `scale-ring-${p.id}`;
    this.site.group.add(ring);
    if (this.site.makeLabel) {
      const label = this.site.makeLabel(`${this.thresholdM} m`);
      label.position.set(ref.center.x, ref.center.y + 4, ref.center.z);
      label.name = `scale-label-${p.id}`;
      this.site.group.add(label);
    }
  }

  /** Click handling: mark/unmark craters inside the active patch. */
  handleCanvasClick(ndcX, ndcY) {
    if (this.submitted) return false;
    const hit = this.site.pickTerrain(ndcX, ndcY);
    if (!hit) return false;
    const patch = this.patches.find(p => p.id === this.active);
    const A = patch.center;
    const d = Math.hypot(hit.xM - A.xM, hit.yM - A.yM);
    if (d > patch.radiusM) {
      announce(`Outside the ${patch.name} patch. Click inside the marked circle.`);
      return true;
    }
    // unmark if within 12 m of an existing mark
    const existing = this.marks[this.active].findIndex(m => Math.hypot(m.xM - hit.xM, m.yM - hit.yM) < 12);
    if (existing >= 0) {
      this.marks[this.active].splice(existing, 1);
      announce('Mark removed.');
    } else {
      this.marks[this.active].push({ xM: hit.xM, yM: hit.yM });
      announce(`Crater marked. ${this.marks[this.active].length} in this patch.`);
    }
    this._updateMarks();
    this._updateStatus();
    return true;
  }

  _updateMarks() {
    if (this._markGroup) {
      this.site.group.remove(this._markGroup);
      for (const c of this._markGroup.children) { c.geometry.dispose(); c.material.dispose(); }
    }
    const g = new THREE.Group();
    g.name = 'crater-marks';
    for (const [patchId, list] of Object.entries(this.marks)) {
      for (const m of list) {
        const e = this.site.terrain.elevationAt(m.xM, m.yM);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(8, 1.6, 6, 20),
          new THREE.MeshBasicMaterial({ color: patchId === 'mare' ? 0x66d9e8 : 0xffb347, depthTest: false }),
        );
        ring.position.set(m.xM, (Number.isNaN(e) ? -1900 : e) + 2, m.yM);
        ring.rotation.x = Math.PI / 2;
        ring.renderOrder = 9;
        g.add(ring);
      }
    }
    this.site.group.add(g);
    this._markGroup = g;
  }

  _updateStatus() {
    const status = this.root.querySelector('.count-status');
    const parts = this.patches.map(p =>
      `${p.name}: ${this.marks[p.id].length} marked${p.id === this.active ? ' (active)' : ''}`);
    status.textContent = parts.join(' · ');
  }

  _submit() {
    if (this.submitted) return;
    this.submitted = true;
    const counts = {}, densities = {};
    for (const p of this.patches) {
      counts[p.id] = this.marks[p.id].length;
      densities[p.id] = Math.round(this.marks[p.id].length / p.areaKm2);
    }
    const res = this.root.querySelector('.cc-results');
    const rows = this.patches.map(p => `<tr><td>${p.name}</td><td>${counts[p.id]}</td><td>${p.areaKm2} km²</td><td>${densities[p.id]} craters/km²</td></tr>`).join('');
    res.innerHTML = `
      <h4>Your counts</h4>
      <table><caption>Crater density: count ÷ area (patches are equal-area, so comparing counts directly is fair)</caption>
      <thead><tr><th scope="col">Patch</th><th scope="col">Your count</th><th scope="col">Area</th><th scope="col">Density</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p>${densityComparison(this.patches.map(p => p.name), densities[this.patches[0].id], densities[this.patches[1].id])}
        Before you conclude anything about age, reveal the computer's reference count and read the method notes.</p>`;
    this.root.querySelector('.cc-reference').hidden = false;
    this.root.querySelector('.cc-submit').disabled = true;
    announce('Counts submitted.');
    this.onSubmit?.({ counts, densities });
  }

  _revealReference() {
    const res = this.root.querySelector('.cc-results');
    const rows = this.patches.map(p => `<tr><td>${p.name}</td><td>${p.craters.length}</td><td>${p.densityPerKm2} craters/km²</td><td>${p.craters.map(c => c.diameterM).join(', ') || '—'}</td></tr>`).join('');
    const div = document.createElement('div');
    div.className = 'cc-reference-panel';
    div.innerHTML = `
      <h4>Reference count (automated)</h4>
      <table><caption>A computer count of the same patches from the NASA terrain model. Real counters disagree — that uncertainty is part of the method.</caption>
      <thead><tr><th scope="col">Patch</th><th scope="col">Computer count</th><th scope="col">Density</th><th scope="col">Diameters (m)</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p><strong>Method note — read before concluding.</strong> The Front's patch shows <em>fewer</em> craters, yet the Front's rocks are the OLDER material (about 3.9 Ga vs. the plain's about 3.3 Ga basalts). Why? Crater counting is a clock only on flat, stable surfaces: the Front's roughly 25° slopes erode, bury and destroy the crater record. Its age comes from rock samples, not from counting on its slopes. The plain's density is the meaningful clock reading.</p>`;
    res.appendChild(div);
    div.open = true;
    announce('Reference count revealed. Note the method caveat: slopes destroy the crater record.');
  }
}
