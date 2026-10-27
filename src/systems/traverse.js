/**
 * Traverse planner (objective 4): map view + 3D view, slope-cost routing from
 * the real DTM, station selection (up to 4), tool choice per station, and
 * time/consumables meters shown as BOTH bars and numbers (never color alone).
 * The run phase visits stations in order and adds results to the evidence
 * board; the debrief overlays the learner's route on the real Apollo 15 routes.
 * @module systems/traverse
 */
import { planAccounting, buildSegmentTable, scoreTraverse } from './traverse-model.js';
import { announce } from '../a11y/announcer.js';

export class TraversePlanner {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container
   * @param {import('../scenes/hadley-site.js').HadleySite} opts.site
   * @param {object} opts.stationsContent content/stations.json
   * @param {(stationId:string, toolId:string)=>Array} opts.resultFor returns evidence entries for a station+tool
   * @param {import('../systems/evidence.js').EvidenceBoard} opts.board
   * @param {Function} [opts.onPlanned] called with the plan when planned
   * @param {Function} [opts.onDebrief] called when the debrief was shown
   */
  constructor({ container, site, stationsContent, resultFor, board, onPlanned, onDebrief }) {
    this.site = site;
    this.content = stationsContent;
    this.model = stationsContent.resourceModel;
    this.resultFor = resultFor;
    this.board = board;
    this.onPlanned = onPlanned;
    this.onDebrief = onDebrief;
    this.route = [{ id: 'lm', toolId: null }]; // starts at the LM
    this.hypothesis = null;
    this.phase = 'hypothesis';
    this.points = new Map(stationsContent.stations.map(s => {
      const p = site.terrain.fromLonLat(s.lon, s.lat);
      return [s.id, { ...s, xM: p.xM, yM: p.yM }];
    }));
    this.segments = buildSegmentTable([...this.points.values()], (x0, y0, x1, y1) => site.terrain.slopeBetween(x0, y0, x1, y1));
    this.root = this._build(container);
  }

  _build(container) {
    const root = document.createElement('section');
    root.className = 'tool traverse-planner';
    root.setAttribute('aria-label', 'Traverse planner');
    root.innerHTML = `
      <h3>Traverse planner</h3>
      <p class="tool-hint">Pick up to ${this.model.maxStations} stations and one tool per station. Slopes cost extra driving time — the planner reads them from the real terrain model. Simplified EVA model.</p>
      <div class="tp-columns">
        <div class="tp-map-col">
          <canvas class="tp-map" width="260" height="600" aria-label="Top-down map of the area; stations are marked. Use the station buttons for keyboard planning."></canvas>
        </div>
        <div class="tp-plan-col">
          <fieldset class="tp-hypothesis">
            <legend>Your traverse must answer:</legend>
            ${this.content.hypotheses.map((h, i) => `
              <label class="choice"><input type="radio" name="tp-hyp" value="${h.id}" ${i === 0 ? 'checked' : ''}> ${h.text}</label>`).join('')}
          </fieldset>
          <fieldset>
            <legend>Stations</legend>
            <div class="tp-stations" role="group" aria-label="Add stations to the route"></div>
          </fieldset>
          <h4>Route</h4>
          <ol class="tp-route" aria-label="Planned route"></ol>
          <div class="tp-meters" role="status">
            <div class="meter"><label for="m-time">EVA time used</label>
              <progress id="m-time" max="${this.model.evaMinutesBudget}" value="0"></progress>
              <output id="m-time-out">0 / ${this.model.evaMinutesBudget} min</output></div>
            <div class="meter"><label for="m-cons">Consumables left</label>
              <progress id="m-cons" max="${this.model.consumablesStart}" value="${this.model.consumablesStart}"></progress>
              <output id="m-cons-out">${this.model.consumablesStart} %</output></div>
            <p class="tp-budget-note" role="status"></p>
          </div>
          <div class="tp-actions">
            <button type="button" class="btn tp-drive" disabled>Drive the plan</button>
            <button type="button" class="btn tp-reset">Clear route</button>
          </div>
        </div>
      </div>
      <div class="tp-run" hidden></div>
      <div class="tp-debrief" hidden></div>`;
    container.appendChild(root);
    this.root = root; // available to helpers during construction

    const map = root.querySelector('.tp-map');
    this._paintMap(map);
    this._buildStationButtons();
    root.querySelectorAll('input[name=tp-hyp]').forEach(r =>
      r.addEventListener('change', () => { this.hypothesis = r.value; this._recalc(); }));
    this.hypothesis = root.querySelector('input[name=tp-hyp]:checked').value;
    root.querySelector('.tp-reset').addEventListener('click', () => {
      this.route = [{ id: 'lm', toolId: null }];
      this._recalc();
    });
    root.querySelector('.tp-drive').addEventListener('click', () => this._run());
    this._recalc();
    return root;
  }

  _paintMap(canvas) {
    const g = this.site.terrain.grid;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const img = ctx.createImageData(W, H);
    let min = Infinity, max = -Infinity;
    for (const v of g.data) { if (!Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; } }
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const gx = Math.floor((px / W) * (g.width - 1));
        const gy = Math.floor((py / H) * (g.height - 1));
        const v = g.data[gy * g.width + gx];
        const shade = Number.isNaN(v) ? 8 : Math.round(30 + 200 * (v - min) / (max - min));
        const o = (py * W + px) * 4;
        img.data[o] = shade; img.data[o + 1] = shade; img.data[o + 2] = Math.round(shade * 1.02); img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this._mapCtx = ctx;
    this._mapCanvas = canvas;
    this._paintOverlays();
  }

  /** Map (metres) -> canvas px. */
  _toMap(xM, yM) {
    const wM = (this.site.terrain.grid.width - 1) * this.site.terrain.grid.mPerPx;
    const hM = (this.site.terrain.grid.height - 1) * this.site.terrain.grid.mPerPx;
    return { x: (xM / wM) * this._mapCanvas.width, y: (yM / hM) * this._mapCanvas.height };
  }

  _paintOverlays() {
    const ctx = this._mapCtx;
    if (!ctx) return;
    // re-paint base
    this._paintBase();
    // real Apollo 15 EVAs (reference)
    const real = this.content.apollo15Real.evas.filter(e => e.route);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    for (const eva of real) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      eva.route.forEach((id, i) => {
        const p = this.points.get(id);
        const m = this._toMap(p.xM, p.yM);
        if (i === 0) ctx.moveTo(m.x, m.y); else ctx.lineTo(m.x, m.y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // learner route
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    this.route.forEach((r, i) => {
      const p = this.points.get(r.id);
      const m = this._toMap(p.xM, p.yM);
      if (i === 0) ctx.moveTo(m.x, m.y); else ctx.lineTo(m.x, m.y);
    });
    ctx.stroke();
    // stations
    for (const [id, p] of this.points) {
      const m = this._toMap(p.xM, p.yM);
      ctx.fillStyle = id === 'lm' ? '#ffffff' : '#ffd24a';
      ctx.beginPath(); ctx.arc(m.x, m.y, id === 'lm' ? 4 : 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = '9px sans-serif';
      ctx.fillText(p.mapLabel || id, m.x + 5, m.y + 3);
    }
  }

  _paintBase() {
    // keep a copy of the base image from first paint
    if (!this._baseImage) {
      this._baseImage = this._mapCtx.getImageData(0, 0, this._mapCanvas.width, this._mapCanvas.height);
    }
    this._mapCtx.putImageData(this._baseImage, 0, 0);
  }

  _buildStationButtons() {
    const wrap = this.root.querySelector('.tp-stations');
    wrap.innerHTML = '';
    for (const [id, s] of this.points) {
      if (s.start) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn tp-add';
      b.dataset.station = id;
      b.textContent = s.name + (s.approximate ? ' (approx. position)' : '');
      b.setAttribute('aria-label', `Add ${s.name} to the route`);
      b.addEventListener('click', () => this._addStation(id));
      wrap.appendChild(b);
    }
  }

  _addStation(id) {
    if (this.route.some(r => r.id === id)) {
      announce('That station is already in the route.');
      return;
    }
    if (this.route.length - 1 >= this.model.maxStations) {
      announce(`Route limit reached: ${this.model.maxStations} stations.`);
      return;
    }
    const toolId = this._pickTool(id);
    this.route.push({ id, toolId });
    this._recalc();
    const s = this.points.get(id);
    announce(`${s.name} added to the route.`);
  }

  _pickTool(id) {
    const results = this.resultFor(id, null) || [];
    const toolIds = [...new Set(results.map(r => r.toolId))];
    return toolIds[0] || 'sample';
  }

  _recalc() {
    const routeEls = this.root.querySelector('.tp-route');
    routeEls.innerHTML = '';
    this.route.forEach((r, i) => {
      const s = this.points.get(r.id);
      const li = document.createElement('li');
      if (i === 0) {
        li.textContent = `${s.name} (start)`;
      } else {
        const seg = this.segments.find(x => x.fromId === this.route[i - 1].id && x.toId === r.id);
        const tool = this.content.tools.find(t => t.id === r.toolId);
        li.innerHTML = `<strong>${s.name}</strong> — ${tool ? tool.label : 'no tool'}`;
        if (seg) {
          const cost = document.createElement('span');
          cost.className = 'tp-seg-cost';
          cost.textContent = ` ${seg.fromId}→${seg.toId}: ${(seg.distanceM / 1000).toFixed(1)} km` +
            (seg.slopeMultiplier > 1.05 ? `, slope ×${seg.slopeMultiplier.toFixed(1)}` : '') +
            (seg.sampleable ? '' : ' (crosses no-data area — cost estimated)');
          li.appendChild(cost);
        }
        // tool selector
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', `Tool to use at ${s.name}`);
        const avail = [...new Set((this.resultFor(r.id, null) || []).map(x => x.toolId))];
        for (const t of this.content.tools.filter(t => avail.includes(t.id))) {
          const o = document.createElement('option');
          o.value = t.id;
          o.textContent = `${t.label} (${t.minutes} min)`;
          if (t.id === r.toolId) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => { r.toolId = sel.value; this._recalc(); });
        li.appendChild(sel);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.textContent = 'Remove';
        rm.setAttribute('aria-label', `Remove ${s.name} from the route`);
        rm.addEventListener('click', () => { this.route = this.route.filter(x => x !== r); this._recalc(); });
        li.appendChild(rm);
      }
      routeEls.appendChild(li);
    });

    const acc = planAccounting(this.route, this.segments, this.model);
    this.accounting = acc;
    if (!acc.error) {
      this.root.querySelector('#m-time').value = Math.round(acc.totalMinutes);
      this.root.querySelector('#m-time-out').textContent = `${Math.round(acc.totalMinutes)} / ${this.model.evaMinutesBudget} min`;
      this.root.querySelector('#m-cons').value = acc.consumablesLeft;
      this.root.querySelector('#m-cons-out').textContent = `${acc.consumablesLeft} %`;
      const note = this.root.querySelector('.tp-budget-note');
      note.textContent = acc.withinBudget
        ? `Fits the budget with ${Math.round(this.model.evaMinutesBudget - acc.totalMinutes)} min spare.`
        : `OVER BUDGET by ${Math.round(acc.totalMinutes - this.model.evaMinutesBudget)} min — the EVA would end early with partial data.`;
      note.setAttribute('role', 'status');
    }
    this.root.querySelector('.tp-drive').disabled = this.route.length < 2 || !acc.withinBudget;
    this._paintOverlays();
    this.onPlanned?.(this.plan());
  }

  plan() {
    const hypDef = this.content.hypotheses.find(h => h.id === this.hypothesis);
    const tags = [];
    for (const r of this.route.slice(1)) {
      for (const res of (this.resultFor(r.id, r.toolId) || [])) tags.push(...res.evidenceTags);
    }
    return {
      hypothesis: this.hypothesis,
      hypothesisText: hypDef.text,
      route: this.route.map(r => ({ id: r.id, toolId: r.toolId })),
      accounting: this.accounting,
      evidenceTags: [...new Set(tags)],
    };
  }

  /** Run phase: visit stations in order; each stop shows its results and adds them to the board. */
  _run() {
    this.phase = 'run';
    const runEl = this.root.querySelector('.tp-run');
    runEl.hidden = false;
    runEl.innerHTML = '<h4>EVA in progress</h4>';
    const plan = this.plan();
    const stops = plan.route.slice(1);
    let i = 0;
    const next = () => {
      if (i >= stops.length) {
        runEl.innerHTML += '<p><strong>EVA complete.</strong> All results are on your evidence board.</p>';
        this._debrief();
        return;
      }
      const stop = stops[i++];
      const s = this.points.get(stop.id);
      const results = this.resultFor(stop.id, stop.toolId) || [];
      const card = document.createElement('div');
      card.className = 'station-card';
      const h = document.createElement('h5');
      h.textContent = `${s.name} — ${this.content.tools.find(t => t.id === stop.toolId)?.label || ''}`;
      card.appendChild(h);
      for (const r of results) {
        const p = document.createElement('p');
        p.innerHTML = `<strong>${r.title}.</strong> ${r.text}`;
        card.appendChild(p);
        this.board.add({
          kind: r.kind || (stop.toolId === 'sample' ? 'sample' : stop.toolId === 'profile' ? 'measurement' : 'photo'),
          title: r.title,
          text: r.text,
          evidenceTags: r.evidenceTags,
          source: s.name,
          moduleId: 'm4',
        });
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = i < stops.length ? 'Continue to next stop' : 'Finish the EVA';
      btn.addEventListener('click', next);
      card.appendChild(btn);
      runEl.appendChild(card);
      announce(`${s.name}: results recorded.`);
    };
    next();
  }

  /** Debrief: learner route vs. real Apollo 15 EVAs + found cards. */
  _debrief() {
    const el = this.root.querySelector('.tp-debrief');
    el.hidden = false;
    const hypDef = this.content.hypotheses.find(h => h.id === this.hypothesis);
    const score = scoreTraverse({ ...this.plan(), accounting: this.accounting }, { neededEvidence: hypDef.neededEvidence, maxStations: this.model.maxStations });
    const cards = this.content.apollo15Real.evas.map(e => `
      <div class="found-card"><h5>${e.label}</h5><p>${e.found}</p></div>`).join('');
    el.innerHTML = `
      <h4>Debrief — your traverse beside theirs</h4>
      <p>The dashed white lines on the map are the real Apollo 15 EVA routes. Solid yellow is yours.
         The map legend: white = landing site, yellow = stations.</p>
      <div class="tp-score"><strong>Traverse quality: ${score.metCount}/${score.criteria.length} criteria met.</strong>
        <ul>${score.criteria.map(c => `<li>${c.met ? '✓' : '✗'} ${c.detail}</li>`).join('')}</ul></div>
      <h5>What the crew actually found</h5>
      <div class="found-cards">${cards}</div>`;
    announce('Debrief ready: your traverse beside the real Apollo 15 routes.');
    this.onDebrief?.({ score, plan: this.plan() });
  }
}
