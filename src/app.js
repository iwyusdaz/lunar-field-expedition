/**
 * Lunar Field Expedition — app controller.
 * Wires the engine, the two scenes (global Moon for Module 1, Hadley site for
 * Modules 2-5), the five module flows, the four tools, the evidence board, the
 * CER report builder, cinematics, text mode, POI list, learning record and the
 * pre/post checks. Learning content lives in content/*.json.
 * @module app
 */
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { loadJSON, hasWebGL2 } from './core/assets.js';
import { Shell } from './ui/shell.js';
import { Settings } from './ui/settings.js';
import { ProgressPage } from './ui/progress.js';
import { LearningRecord } from './learning/record.js';
import { TextMode, dataTable, choiceItem } from './a11y/text-mode.js';
import { MotionPrefs } from './a11y/motion.js';
import { ShotPlayer } from './cinematics/shot-player.js';
import { PoiList, openDialog, closeDialog } from './a11y/focus.js';
import { announce } from './a11y/announcer.js';
import { mcItem, scoreAnswers, rubricSelfCheck } from './learning/assess.js';
import { OrbitController, Input } from './core/input.js';
import { HadleySite } from './scenes/hadley-site.js';
import { GlobalMoon } from './scenes/global-moon.js';
import { SunTool } from './systems/sun-tool.js';
import { ProfileTool } from './systems/profile-tool.js';
import { CraterCounter } from './systems/crater-counter.js';
import { TraversePlanner } from './systems/traverse.js';
import { EvidenceBoard } from './systems/evidence.js';
import { AppState } from './systems/state.js';
import { planAccounting } from './systems/traverse-model.js';

const SLUG = window.__SLUG__ || 'lunar-field-expedition';
window.__SLUG__ = SLUG;

export class App {
  constructor() {
    this.content = {};
    this.stepEl = null;
    this.moduleIndex = 0;
  }

  async init() {
    // content
    [this.content.modules, this.content.items, this.content.stations, this.content.cinematics,
      this.content.report, this.content.features, this.content.craters] = await Promise.all([
      loadJSON('content/modules.json'), loadJSON('content/items.json'), loadJSON('content/stations.json'),
      loadJSON('content/cinematics.json'), loadJSON('content/report.json'), loadJSON('content/features.json'),
      loadJSON('content/craters.json'),
    ]);
    this.moduleDefs = this.content.modules.modules;
    this.allSteps = this.moduleDefs.flatMap(m => m.steps.map(s => ({ ...s, moduleId: m.id })));

    this.record = new LearningRecord(SLUG);
    this.state = new AppState(SLUG, this.moduleDefs.map(m => m.id));
    this.motion = new MotionPrefs(SLUG);
    this.board = new EvidenceBoard(`${SLUG}:evidence`);

    const webgl = hasWebGL2();
    if (webgl) {
      this.canvas = document.getElementById('app');
      this.engine = new Engine(this.canvas);
      window.__engine = this.engine;
      this.input = new Input(this.canvas);
      this.orbit = new OrbitController(this.engine.camera, this.canvas);
      this.orbit.maxRadius = 12000; this.orbit.minRadius = 3;
      this.input.onPointer((p, kind) => {
        if (kind === 'down') this._dragging = true;
        if (kind === 'up') this._dragging = false;
        if (kind === 'move' && this._dragging && this.activeScene === 'site') this.orbit.drag(p.dx, p.dy);
      });
      this.input.onKey((code) => {
        if (code === 'ArrowLeft') this.orbit.steps({ rotX: -1 });
        if (code === 'ArrowRight') this.orbit.steps({ rotX: 1 });
        if (code === 'ArrowUp') this.orbit.steps({ rotY: -0.6 });
        if (code === 'ArrowDown') this.orbit.steps({ rotY: 0.6 });
        if (code === 'Equal' || code === 'NumpadAdd') this.orbit.steps({ zoom: -1 });
        if (code === 'Minus' || code === 'NumpadSubtract') this.orbit.steps({ zoom: 1 });
      });
      this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));
    }

    // CPU-side terrain (independent of WebGL; text mode uses it for parity data)
    this.site = new HadleySite(this.engine ?? { camera: new THREE.PerspectiveCamera(), quality: { presetDef: null, onChange: () => {}, name: 'low' } }, 'medium');
    await this.site.load();
    this.globeScene = new GlobalMoon(this.engine ?? null);
    await this.globeScene.load();
    if (webgl) {
      this.engine.scene.add(this.site.group);
      this.engine.scene.add(this.globeScene.group);
      this.globeScene.group.visible = false;
      this.site.group.visible = false;
      this.engine.quality.restore();
      this.engine.onUpdate((dt) => {
        if (this.activeScene === 'site') this.site.update();
        else this.globeScene.update(dt, this.motion.reduced);
      });
    }

    this._buildShell();
    this._buildTextMode();
    this._buildCinematics();
    this._applySavedSettings();
    if (webgl) this.engine.start();
    this.showModule(this.state.state.module || this.moduleDefs[0].id, { resume: true });
  }

  // ---------- shell -----------------------------------------------------------
  _buildShell() {
    this.shell = new Shell({
      slug: SLUG,
      title: 'Lunar Field Expedition',
      moduleLabels: this.moduleDefs.map(m => m.title),
      onModuleChange: (i) => this.showModule(this.moduleDefs[i].id),
    });
    this.settingsDialog = document.getElementById('settings-dialog');
    this.progressDialog = document.getElementById('progress-dialog');
    this.settings = new Settings({
      slug: SLUG, dialog: this.settingsDialog,
      quality: this.engine?.quality, motion: this.motion,
      onFov: (fov) => { if (this.engine) { this.engine.camera.fov = fov; this.engine.camera.updateProjectionMatrix(); } },
    });
    this.shell.on('settings', (btn) => this.settings.open(btn));
    this.progress = new ProgressPage({ slug: SLUG, dialog: this.progressDialog, record: this.record });
    this.shell.on('progress', (btn) => this.progress.open(btn));
    this.shell.on('menu', () => {});
    this.shell.on('restart', () => {
      this.state.reset();
      this.board.clear();
      this.showModule(this.moduleDefs[0].id);
      announce('Progress cleared for this module run.');
    });
    this.shell.on('textmode', () => this.shell.toggleTextMode());

    // task panel: the HTML overlay where each step renders
    const panel = document.createElement('div');
    panel.id = 'task-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Task');
    document.getElementById('overlays').appendChild(panel);
    this.stepEl = panel;

    // POI list (keyboard jump list) + camera buttons (pointer alternatives)
    const poiWrap = document.createElement('div');
    poiWrap.id = 'poi-wrap';
    poiWrap.innerHTML = `
      <div class="cam-buttons" role="group" aria-label="Camera controls">
        <button type="button" data-cam="left" aria-label="Rotate view left">⟲</button>
        <button type="button" data-cam="right" aria-label="Rotate view right">⟳</button>
        <button type="button" data-cam="zin" aria-label="Zoom in">+</button>
        <button type="button" data-cam="zout" aria-label="Zoom out">−</button>
      </div>`;
    document.getElementById('overlays').appendChild(poiWrap);
    for (const b of poiWrap.querySelectorAll('[data-cam]')) {
      b.addEventListener('click', () => {
        const d = b.dataset.cam;
        if (d === 'left') this.orbit?.steps({ rotX: -1 });
        if (d === 'right') this.orbit?.steps({ rotX: 1 });
        if (d === 'zin') this.orbit?.steps({ zoom: -1 });
        if (d === 'zout') this.orbit?.steps({ zoom: 1 });
      });
    }
    this.poi = new PoiList(poiWrap, { label: 'Points of interest' });
  }

  // ---------- module flow -----------------------------------------------------
  showModule(moduleId, { resume = false } = {}) {
    this.moduleIndex = this.moduleDefs.findIndex(m => m.id === moduleId);
    this.shell.setModule(this.moduleIndex);
    this.state.goToModule(moduleId);
    const def = this.moduleDefs[this.moduleIndex];
    this.activeScene = moduleId === 'm1' ? 'globe' : 'site';
    if (this.engine) {
      this.globeScene.group.visible = this.activeScene === 'globe';
      this.site.group.visible = this.activeScene === 'site';
      if (this.activeScene === 'site') {
        const t = this.site._target;
        this.orbit.target.copy(t);
        this.orbit.spherical = { radius: 1400, theta: Math.PI * 0.75, phi: Math.PI / 3.2 };
        this.orbit.update();
      } else {
        this.globeScene.placeCamera();
      }
    }
    if (this.motion.reduced || resume) {
      // no auto cinematic on resume or reduced motion; show a replay affordance instead
      this._renderModuleSteps(def, { skipCinematic: resume });
    } else {
      this._renderModuleSteps(def, {});
    }
    this.shell.setStatus(`Module ${this.moduleIndex + 1}: ${def.coreQuestion}`);
  }

  _renderModuleSteps(def, { skipCinematic }) {
    this.stepEl.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = def.title;
    this.stepEl.appendChild(h);
    const intro = document.createElement('p');
    intro.className = 'module-intro';
    intro.textContent = def.coreQuestion;
    this.stepEl.appendChild(intro);
    this.stepContainer = document.createElement('div');
    this.stepEl.appendChild(this.stepContainer);
    this.stepQueue = def.steps.filter(s => !(skipCinematic && s.kind === 'cinematic'));
    this.stepPtr = 0;
    this._nextStep();
  }

  _nextStep() {
    if (this.stepPtr >= this.stepQueue.length) {
      this._moduleComplete();
      return;
    }
    const step = this.stepQueue[this.stepPtr];
    this.currentStep = step;
    this.stepContainer.innerHTML = '';
    const renderer = this._renderers[step.kind];
    if (!renderer) {
      this.stepContainer.textContent = `Step ${step.kind} (not implemented)`;
      return;
    }
    renderer.call(this, step, this.stepContainer);
    this.stepContainer.scrollIntoView({ block: 'nearest' });
  }

  /** Advance after a step's decision; logs completion. */
  _stepDone(step, payload, feedbackText) {
    this.state.completeStep(step.id, payload);
    this.record.log('completed', { id: step.id, name: step.id }, payload ? { response: payload } : undefined);
    this.stepPtr++;
    if (feedbackText) {
      const fb = document.createElement('p');
      fb.className = 'feedback-step';
      fb.textContent = feedbackText;
      this.stepContainer.appendChild(fb);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary';
      btn.textContent = 'Continue';
      btn.addEventListener('click', () => this._nextStep());
      this.stepContainer.appendChild(btn);
      btn.focus();
    } else {
      this._nextStep();
    }
  }

  _moduleComplete() {
    this.record.log('completed', { id: `module-${this.currentModuleId()}`, name: this.moduleDefs[this.moduleIndex].title });
    const wrap = document.createElement('div');
    wrap.className = 'module-complete';
    const p = document.createElement('p');
    p.textContent = this.moduleIndex < this.moduleDefs.length - 1
      ? 'Module complete. The next module continues the field work.'
      : 'Expedition complete. Your field report and learning record stay in this browser.';
    wrap.appendChild(p);
    if (this.moduleIndex < this.moduleDefs.length - 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary';
      btn.textContent = `Continue to ${this.moduleDefs[this.moduleIndex + 1].title}`;
      btn.addEventListener('click', () => this.showModule(this.moduleDefs[this.moduleIndex + 1].id));
      wrap.appendChild(btn);
    }
    this.stepContainer.appendChild(wrap);
  }

  currentModuleId() { return this.moduleDefs[this.moduleIndex].id; }

  // ---------- step renderers ---------------------------------------------------
  get _renderers() {
    return {
      globe: (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        this._continueBtn(el, 'Descend to the site');
      },
      cinematic: (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        const row = document.createElement('div');
        row.className = 'cinematic-choice';
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn primary';
        play.textContent = this.motion.reduced ? 'Show the approach (stills)' : 'Play the approach';
        play.addEventListener('click', () => {
          if (this.engine) this._playCinematic('approach', () => this._stepDone(step, { skipped: false }));
          else this._stepDone(step, { skipped: false });
        });
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'btn';
        skip.textContent = 'Skip — go straight to the brief';
        skip.addEventListener('click', () => {
          this.record.log('experienced', { id: 'cinematic-approach-skipped', name: 'Approach cinematic (skipped)' });
          this._stepDone(step, { skipped: true });
        });
        row.append(play, skip);
        el.appendChild(row);
      },
      brief: (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        this._continueBtn(el, 'Open the pre-check');
      },
      check: (step, el) => this._renderCheck(step, el),
      'sun-tool': (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        this.sunTool = new SunTool({
          container: el,
          presets: this.content.features.sunPresets,
          onSun: (e, a) => this.site.setSun(e, a),
          onUse: () => this.record.log('experienced', { id: 'sun-tool-used', name: 'Sun-angle tool used' }),
        });
        this._continueBtn(el, 'Continue');
      },
      'feature-tag': (step, el) => this._renderFeatureTag(step, el),
      'profile-tool': (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        this.profileTool = new ProfileTool({
          container: el, site: this.site,
          presets: this.content.features.profilePresets,
          onComplete: (m) => {
            this.board.add({
              kind: 'measurement', title: 'Elevation profile',
              text: `${m.distanceM} m line: relief ${m.reliefM} m (from ${m.minE} to ${m.maxE} m).`,
              evidenceTags: ['profile'], source: 'Elevation-profile tool', moduleId: 'm2',
            });
            this.state.completeStep(step.id, m);
            this.record.log('completed', { id: step.id, name: 'Elevation profile measured' }, { response: m });
            this._continueBtn(el, 'Continue');
          },
        });
      },
      'crater-counter': (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        const patches = this.content.craters.patches.map(p => ({ ...p, name: p.id === 'mare' ? 'Mare plain patch' : 'Apennine Front patch' }));
        this.craterCounter = new CraterCounter({
          container: el, site: this.site, patches, thresholdM: 80,
          onSubmit: ({ counts }) => {
            this.state.completeStep(step.id, counts);
            this.record.log('completed', { id: step.id, name: 'Crater counts submitted' }, { response: counts });
          },
        });
        this.poi.set('patch-mare', { label: 'Mare patch (crater counting)', onSelect: () => this._flyTo('patch-mare', patches[0]) });
        this.poi.set('patch-front', { label: 'Front patch (crater counting)', onSelect: () => this._flyTo('patch-front', patches[1]) });
        this._continueBtn(el, 'Continue to superposition');
      },
      superposition: (step, el) => this._renderSuperposition(step, el),
      debrief: (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        this._continueBtn(el, 'Continue to the field traverse');
      },
      hypothesis: (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        this._continueBtn(el, 'Open the planner');
      },
      'traverse-plan': (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        this.traverse = new TraversePlanner({
          container: el, site: this.site,
          stationsContent: this.content.stations,
          board: this.board,
          resultFor: (stationId) => this._stationResults(stationId),
          onPlanned: (plan) => { this.plan = plan; },
          onDebrief: ({ score }) => {
            this.state.completeStep(step.id, { route: this.plan.route, score: score.metCount });
            this.record.log('completed', { id: step.id, name: 'Traverse planned and run' }, { response: { stations: this.plan.route.length - 1 } });
          },
        });
        for (const s of this.traverse.points.values()) {
          this.poi.set(`st-${s.id}`, { label: s.name, onSelect: () => this._flyTo(`st-${s.id}`, s) });
        }
        this._continueBtn(el, 'Continue to the field report');
      },
      'traverse-run': () => { /* integrated into planner run phase */ this._stepDone(this.currentStep); },
      'traverse-debrief': () => { this._stepDone(this.currentStep); },
      'evidence-board': (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        const boardEl = document.createElement('div');
        el.appendChild(boardEl);
        this.board.render(boardEl);
        this._continueBtn(el, 'Build the report');
      },
      'cer-builder': (step, el) => this._renderCerBuilder(step, el),
      'rubric-selfcheck': (step, el) => {
        const p = document.createElement('p');
        p.textContent = step.text;
        el.appendChild(p);
        const ex = this.content.report.report.exemplar;
        const details = document.createElement('details');
        details.innerHTML = `<summary>Show the exemplar report (top band of the rubric)</summary><div class="exemplar">
          <p><strong>Claim.</strong> ${ex.claim}</p><p><strong>Evidence.</strong> ${ex.evidence}</p>
          <p><strong>Reasoning.</strong> ${ex.reasoning}</p><p><strong>Uncertainty.</strong> ${ex.uncertainty}</p>
          <p class="note">${ex.note}</p></div>`;
        el.appendChild(details);
        rubricSelfCheck({
          criteria: this.content.report.report.rubric, container: el,
          onComplete: (ratings) => {
            this.state.state.report = { ...(this.state.state.report || {}), selfCheck: ratings };
            this.state.save();
            this.record.log('completed', { id: step.id, name: 'Rubric self-check' }, { response: ratings });
            this._stepDone(step, ratings, 'Self-check saved. Remember: it is a mirror, not a grade.');
          },
        });
      },
      'apollo-comparison': (step, el) => this._renderComparison(step, el),
    };
  }

  _continueBtn(el, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn primary continue-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => this._stepDone(this.currentStep));
    el.appendChild(btn);
  }

  // ---------- specific steps ----------------------------------------------------
  async _renderCheck(step, el) {
    const set = this.content.items.sets[step.itemSet];
    const answers = [];
    const h = document.createElement('h3');
    h.textContent = step.itemSet === 'pre' ? 'Pre-check (5 concept items)' : 'Post-check (5 concept items)';
    el.appendChild(h);
    const p = document.createElement('p');
    p.textContent = 'These check your understanding — they are not graded against your traverse.';
    el.appendChild(p);
    for (const item of set) {
      await new Promise((resolve) => {
        mcItem({
          item, container: el,
          onAnswered: (res) => { answers.push(res); resolve(); },
        });
      });
    }
    const score = scoreAnswers(answers);
    if (step.itemSet === 'pre') this.state.state.preCheck = score;
    else this.state.state.postCheck = score;
    this.state.save();
    this.record.log('completed', { id: step.id, name: `${step.itemSet}-check` }, {
      response: { correct: score.correct, total: score.total },
      'success': score.ratio,
    });
    const out = document.createElement('p');
    out.className = 'feedback-step';
    out.textContent = `You answered ${score.correct} of ${score.total}. The feedback under each item explains the why — use it for the field work.`;
    el.appendChild(out);
    this._stepDone(step, { correct: score.correct, total: score.total });
  }

  _renderFeatureTag(step, el) {
    const p = document.createElement('p');
    p.textContent = step.text;
    el.appendChild(p);
    const list = document.createElement('div');
    el.appendChild(list);
    let done = 0;
    for (const f of this.content.features.features) {
      this.site.addMarker(f.id, this.site.terrain.fromLonLat(f.lon, f.lat).xM, this.site.terrain.fromLonLat(f.lon, f.lat).yM);
      this.poi.set(`feat-${f.id}`, {
        label: f.name,
        onSelect: () => {
          const P = this.site.terrain.fromLonLat(f.lon, f.lat);
          this._flyTo(`feat-${f.id}`, { xM: P.xM, yM: P.yM });
          this.site.setSun(Math.min(this.sunTool?.elevation ?? 12, 15), this.sunTool?.azimuth ?? 90);
          announce(`${f.name} selected. Sun set low so the relief is visible.`);
        },
      });
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = f.name;
      fieldset.appendChild(legend);
      const answerZone = document.createElement('div');
      fieldset.appendChild(answerZone);
      list.appendChild(fieldset);
      const ask = () => {
        answerZone.innerHTML = '';
        const q = document.createElement('p');
        q.textContent = 'What is it, and how did it most likely form?';
        answerZone.appendChild(q);
        for (const opt of f.options) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'choice-btn';
          b.textContent = opt.text;
          b.addEventListener('click', () => {
            const fb = document.createElement('div');
            fb.className = 'feedback';
            fb.innerHTML = `<p><strong>${opt.correct ? 'Correct.' : 'Not quite.'}</strong> ${opt.why}</p>`;
            answerZone.appendChild(fb);
            for (const x of answerZone.querySelectorAll('.choice-btn')) x.disabled = true;
            if (opt.correct) {
              done++;
              this.record.log('answered', { id: `tag-${f.id}`, name: `Feature tag: ${f.name}` }, { response: opt.id, success: true });
              this.state.completeStep(`${step.id}-${f.id}`, opt.id);
              if (done === this.content.features.features.length) {
                this.state.completeStep(step.id, { allTagged: true });
                this._continueBtn(list, 'Continue to the profile tool');
              }
            } else {
              const retry = document.createElement('button');
              retry.type = 'button';
              retry.className = 'btn';
              retry.textContent = 'Try again';
              retry.addEventListener('click', ask);
              answerZone.appendChild(retry);
              this.record.log('answered', { id: `tag-${f.id}`, name: `Feature tag: ${f.name}` }, { response: opt.id, success: false });
            }
          });
          answerZone.appendChild(b);
        }
      };
      ask();
    }
  }

  _renderSuperposition(step, el) {
    const p = document.createElement('p');
    p.textContent = step.text;
    el.appendChild(p);
    const item = {
      id: 'superposition-1',
      prompt: 'At the boundary between the mare plain and the Apennine Front, the flat lavas run up TO the mountain and thin out against its slopes. Which unit is younger?',
      options: [
        { id: 'a', text: 'The mare lavas — they lie against the Front, so they arrived after the Front existed', why: 'Correct: superposition. The lavas embay the Front; younger material is the one lying on/against the older.' },
        { id: 'b', text: 'The Apennine Front — it is taller', 'why': 'Height says nothing about age here; the contact direction does.', why: 'Height says nothing about age here; the contact direction does.' },
        { id: 'c', text: 'You cannot tell without samples', why: 'You CAN read the order in the field — superposition is the direct evidence. Samples then give the ages in years.' },
      ],
      correct: 'a',
    };
    mcItem({
      item, container: el,
      onAnswered: (res) => {
        this.board.add({
          kind: 'observation', title: 'Superposition at the Front',
          text: 'The mare lavas lap against the Apennine Front: the plain is younger than the mountains.',
          evidenceTags: ['superposition', 'superposition-or-count'], source: 'Module 3 observation', moduleId: 'm3',
        });
        this.state.completeStep(step.id, res.chosen);
        this.record.log('answered', { id: step.id, name: 'Superposition puzzle' }, { response: res.chosen, success: res.correct });
        this._continueBtn(el, 'Continue to the debrief');
      },
    });
  }

  _stationResults(stationId) {
    const res = this.content.stations.results[stationId];
    if (!res) return [];
    return Object.entries(res).map(([toolId, r]) => ({ toolId, ...r, kind: toolId === 'sample' ? 'sample' : toolId === 'profile' ? 'measurement' : 'photo' }));
  }

  // ---------- CER report --------------------------------------------------------
  _renderCerBuilder(step, el) {
    const rep = this.content.report.report;
    const p = document.createElement('p');
    p.textContent = step.text;
    el.appendChild(p);

    // evidence tag picker (structured check — not text grading)
    const hypDef = this.content.stations.hypotheses.find(h => h.id === (this.plan?.hypothesis || 'h-front'));
    const required = rep.requiredEvidenceTags[hypDef.id] || [];
    const tagZone = document.createElement('fieldset');
    tagZone.innerHTML = `<legend>Cite evidence from your board (structured tags)</legend>
      <p class="tool-hint">Tick the evidence you are citing in the report. The app checks that the required evidence TYPES for your question were cited — it never grades your writing.</p>`;
    const boardTags = this.board.tags();
    const checked = new Set();
    for (const t of [...new Set([...boardTags])]) {
      const label = document.createElement('label');
      label.className = 'choice';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = t;
      cb.addEventListener('change', () => { cb.checked ? checked.add(t) : checked.delete(t); });
      label.append(cb, Object.assign(document.createElement('span'), { textContent: ' ' + t }));
      tagZone.appendChild(label);
    }
    if (!boardTags.length) tagZone.appendChild(Object.assign(document.createElement('p'), { textContent: 'Your evidence board is empty — the report needs evidence. Complete the earlier modules.' }));
    el.appendChild(tagZone);

    const draft = this.state.state.report?.draft || {};
    const fields = [];
    for (const s of rep.sections) {
      const label = document.createElement('label');
      label.textContent = `${s.label} — ${s.prompt}`;
      const ta = document.createElement('textarea');
      ta.value = draft[s.id] || '';
      ta.rows = 4;
      ta.id = `cer-${s.id}`;
      ta.setAttribute('aria-describedby', `cer-${s.id}-count`);
      ta.addEventListener('input', () => {
        draft[s.id] = ta.value;
        el.querySelector(`#cer-${s.id}-count`).textContent = `${ta.value.length} characters`;
      });
      const count = document.createElement('output');
      count.id = `cer-${s.id}-count`;
      count.textContent = `${ta.value.length} characters`;
      label.appendChild(ta);
      label.appendChild(count);
      el.appendChild(label);
      fields.push({ id: s.id, ta, min: s.minChars });
    }

    const rubricDetails = document.createElement('details');
    rubricDetails.innerHTML = `<summary>Show the rubric (4 criteria × 4 levels)</summary>
      <div class="rubric">${rep.rubric.map(c => `<h4>${c.name}</h4><ol>${c.levels.map(l => `<li>${l}</li>`).join('')}</ol>`).join('')}</div>`;
    el.appendChild(rubricDetails);

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn primary';
    submit.textContent = 'Save report';
    submit.addEventListener('click', () => {
      const missing = required.filter(t => !checked.has(t));
      const short = fields.filter(f => f.ta.value.trim().length < f.min).map(f => f.id);
      const msg = document.createElement('div');
      msg.className = 'feedback';
      if (missing.length) {
        msg.innerHTML = `<p><strong>Evidence types not yet cited:</strong> ${missing.join(', ')}. Tick them from your board (or collect them in the traverse) and save again.</p>`;
      } else if (short.length) {
        msg.innerHTML = `<p><strong>These sections look shorter than the guide length:</strong> ${short.join(', ')}. You can still save — length is a guide, not a rule.</p>`;
      } else {
        msg.innerHTML = '<p><strong>All required evidence types cited.</strong> Your report is saved. Now compare it with the exemplar in the self-check.</p>';
      }
      el.querySelectorAll('.cer-msg').forEach(x => x.remove());
      msg.classList.add('cer-msg');
      el.insertBefore(msg, submit);
      const reportState = { draft: { ...draft }, citedTags: [...checked], hypothesis: hypDef.id };
      this.state.state.report = { ...(this.state.state.report || {}), ...reportState };
      this.state.save();
      this.record.log('completed', { id: step.id, name: 'Field report saved' }, { response: { cited: checked.size, missing } });
      if (!missing.length) this._stepDone(step, { saved: true }, 'Report saved. Next: the self-check.');
    });
    el.appendChild(submit);
  }

  // ---------- comparison ---------------------------------------------------------
  _renderComparison(step, el) {
    const p = document.createElement('p');
    p.textContent = step.text;
    el.appendChild(p);
    const real = this.content.stations.apollo15Real;
    const table = dataTable(
      ['EVA', 'Duration', 'Route', 'What they found'],
      real.evas.filter(e => e.route).map(e => [
        e.label.split('(')[0].trim(),
        e.label.match(/\(([^)]+)\)/)?.[1] || '',
        e.route.map(id => this.traverse?.points.get(id)?.name || id).join(' → '),
        e.found,
      ]),
      'The real Apollo 15 surface operations (source: research/apollo15-facts.md)',
    );
    el.appendChild(table);
    const img = document.createElement('img');
    img.src = `${import.meta.env.BASE_URL || './'}assets/photos/as15-89-12100.jpg`;
    img.alt = 'NASA Apollo 15 photograph AS15-89-12100: the mountain-front station area where the crew sampled and photographed during EVA 2.';
    img.className = 'apollo-photo';
    el.appendChild(img);
    const cap = document.createElement('p');
    cap.className = 'photo-caption';
    cap.textContent = 'NASA photo AS15-89-12100 (public domain). The nearby frames of the same magazine include the "Genesis Rock" find at Spur crater.';
    el.appendChild(cap);
    const genesis = document.createElement('div');
    genesis.className = 'found-card';
    genesis.innerHTML = `<h4>The 'Genesis Rock' story (sample 15415)</h4>
      <p>At Spur crater on EVA 2, Scott and Irwin spotted a glinting rock partly buried in the regolith and pulled it free: a 270-gram anorthosite — almost pure plagioclase feldspar from the Moon's early crust. Early analyses dated it to about 4.1 billion years; later work on related anorthosites suggests about 4.46 Ga. The crew believed they had a piece of the primordial crust; it turned out younger than the very first crust — but still exceptionally ancient, and exactly the kind of deep-crust material your traverse targeted. (Sources: research/apollo15-facts.md.)</p>`;
    el.appendChild(genesis);
    this._continueBtn(el, 'Finish with the post-check');
  }

  // ---------- cinematics ----------------------------------------------------------
  _buildCinematics() {
    this.player = new ShotPlayer({
      container: document.getElementById('cinematic-host'),
      camera: this.engine?.camera,
      motion: this.motion,
      onDone: () => {},
      onSkip: (id) => this.record.log('experienced', { id: `cinematic-${id}-skipped`, name: 'Cinematic skipped' }),
    });
    // replay from menu
    const menuList = document.querySelector('#menu-dialog .menu-list');
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.action = 'replay-cinematic';
    btn.textContent = 'Replay the intro cinematic';
    li.appendChild(btn);
    menuList.insertBefore(li, menuList.children[1]);
    this.shell.on('replay-cinematic', () => {
      closeDialog(document.getElementById('menu-dialog'));
      if (this.engine) this._playCinematic('approach');
    });
  }

  _playCinematic(id, onDone) {
    const def = this.content.cinematics.cinematics.find(c => c.id === id);
    if (!def) { onDone?.(); return; }
    this.player.load(def);
    if (this.activeScene !== 'site') { this.showModule('m1'); }
    this.player.play();
    // wire shot effects (sun sweep, overlays) to the scene
    this.player.onProgress = (shot, t) => {
      if (shot.effect?.type === 'sun' && this.site) {
        const [e0, a0] = shot.effect.from, [e1, a1] = shot.effect.to;
        this.site.setSun(e0 + (e1 - e0) * t, a0 + (a1 - a0) * t);
      }
      if (shot.effect?.type === 'overlay' && shot.effect.id === 'traverse-map') {
        this._showTraverseOverlay(t > 0.15);
      }
    };
    const origDone = onDone;
    this.player.onDone = () => {
      this._showTraverseOverlay(false);
      this.player.onProgress = null;
      this.player.onDone = () => {};
      this.record.log('experienced', { id: `cinematic-${id}`, name: 'Cinematic watched' });
      this.state.state.cinematicSeen[id] = true;
      this.state.save();
      origDone?.();
    };
  }

  _showTraverseOverlay(show) {
    if (!this.engine || !this.site) return;
    if (show && !this._realRoutes) {
      const g = new THREE.Group();
      g.name = 'real-routes';
      const lm = this.site.terrain.fromLonLat(3.6333, 26.13239);
      for (const eva of this.content.stations.apollo15Real.evas.filter(e => e.route)) {
        const pts = eva.route.map(id => {
          const s = this.content.stations.stations.find(x => x.id === id);
          const P = this.site.terrain.fromLonLat(s.lon, s.lat);
          const e = this.site.terrain.elevationAt(P.xM, P.yM);
          return new THREE.Vector3(P.xM, (Number.isNaN(e) ? -1900 : e) + 12, P.yM);
        });
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(lm.xM, -1900, lm.yM), ...pts.slice(1)]);
        void curve;
        const geo = new THREE.BufferGeometry().setFromPoints(pts.length > 2 ? new THREE.CatmullRomCurve3(pts).getPoints(60) : pts);
        g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false })));
      }
      this.site.group.add(g);
      this._realRoutes = g;
    }
    if (this._realRoutes) this._realRoutes.visible = show;
  }

  // ---------- canvas interaction ----------------------------------------------------
  _onCanvasClick(e) {
    if (!this.engine) return;
    if (this.activeScene !== 'site') return;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (this.profileTool?.picking && this.profileTool.handleCanvasClick(ndcX, ndcY)) return;
    if (this.craterCounter && !this.craterCounter.submitted && this.currentStep?.kind === 'crater-counter') {
      this.craterCounter.handleCanvasClick(ndcX, ndcY);
      return;
    }
  }

  _flyTo(_id, pos) {
    if (!this.orbit) return;
    const P = pos.xM !== undefined ? pos : this.site.terrain.fromLonLat(pos.lon, pos.lat);
    const e = this.site.terrain.elevationAt(P.xM, P.yM);
    this.orbit.target.set(P.xM, (Number.isNaN(e) ? -1900 : e), P.yM);
    this.orbit.spherical.radius = Math.max(this.orbit.minRadius, pos.radiusM ? pos.radiusM * 2.6 : 600);
    this.orbit.update();
    if (this.motion.reduced) this.orbit.update();
  }

  // ---------- text mode ----------------------------------------------------------------
  _buildTextMode() {
    this.textMode = new TextMode({
      root: document.getElementById('textmode'),
      slug: SLUG,
      onDecision: () => {},
    });
    this.shell.on('textmode', () => {
      if (!document.getElementById('textmode').hidden) {
        this.textMode.show(this.currentModuleId());
      }
    });
    // module renderers (parity per plan section 11)
    this.textMode.register('m1', (body, api) => this._textM1(body, api));
    this.textMode.register('m2', (body, api) => this._textM2(body, api));
    this.textMode.register('m3', (body, api) => this._textM3(body, api));
    this.textMode.register('m4', (body, api) => this._textM4(body, api));
    this.textMode.register('m5', (body, api) => this._textM5(body, api));
  }

  _textM1(body) {
    const def = this.moduleDefs[0];
    body.innerHTML = '';
    const brief = def.steps.find(s => s.kind === 'brief');
    const p = document.createElement('p');
    p.textContent = brief.text;
    body.appendChild(p);
    const g = document.createElement('p');
    g.textContent = def.steps.find(s => s.kind === 'globe').text;
    body.appendChild(g);
    const h = document.createElement('h3');
    h.textContent = 'Pre-check';
    body.appendChild(h);
    this._textCheck('pre', body);
  }

  _textCheck(setName, body) {
    const set = this.content.items.sets[setName];
    for (const item of set) {
      body.appendChild(choiceItem({
        prompt: item.prompt,
        options: item.options,
        onAnswer: (opt) => {
          const correct = opt.id === item.correct;
          const fb = document.createElement('p');
          fb.className = 'feedback';
          fb.textContent = `${correct ? 'Correct.' : 'Not quite.'} ${opt.why || item.why || ''}`;
          body.appendChild(fb);
          this.record.log('answered', { id: item.id, name: item.prompt.slice(0, 60) }, { response: opt.id, success: correct });
        },
      }));
    }
  }

  _textM2(body) {
    const tm = this.content.features.textMode;
    const h = document.createElement('h3');
    h.textContent = 'The same task without the 3D view';
    body.appendChild(h);
    for (const im of tm.orthoImages) {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = `${import.meta.env.BASE_URL || './'}${im.src}`;
      img.alt = im.alt;
      img.className = 'ortho';
      const cap = document.createElement('figcaption');
      cap.textContent = im.label;
      fig.append(img, cap);
      // annotations
      for (const a of tm.annotations) {
        const pos = im.id === 'low' ? a.onLow : a.onHigh;
        const marker = document.createElement('span');
        marker.className = 'ortho-marker';
        marker.style.left = `${pos.xPct}%`;
        marker.style.top = `${pos.yPct}%`;
        marker.textContent = '◈';
        marker.title = a.text;
        fig.style.position = 'relative';
        fig.appendChild(marker);
      }
      body.appendChild(fig);
    }
    const list = document.createElement('ul');
    for (const a of tm.annotations) {
      const li = document.createElement('li');
      li.textContent = a.text;
      list.appendChild(li);
    }
    body.appendChild(list);

    const h2 = document.createElement('h3');
    h2.textContent = 'Feature tagging (same choices as the 3D task)';
    body.appendChild(h2);
    for (const f of this.content.features.features) {
      body.appendChild(choiceItem({
        prompt: `${f.name}: what is it and how did it form?`,
        options: f.options,
        onAnswer: (opt) => {
          const fb = document.createElement('p');
          fb.className = 'feedback';
          fb.textContent = `${opt.correct ? 'Correct.' : 'Not quite.'} ${opt.why}`;
          body.appendChild(fb);
          this.record.log('answered', { id: `tag-${f.id}`, name: `Feature tag: ${f.name}` }, { response: opt.id, success: opt.correct });
        },
      }));
    }

    const h3 = document.createElement('h3');
    h3.textContent = 'Elevation profiles as data tables (same measurements)';
    body.appendChild(h3);
    for (const preset of this.content.features.profilePresets) {
      const A = this.site.terrain.fromLonLat(preset.from.lon, preset.from.lat);
      const B = this.site.terrain.fromLonLat(preset.to.lon, preset.to.lat);
      const rows = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const e = this.site.terrain.elevationAt(A.xM + (B.xM - A.xM) * t, A.yM + (B.yM - A.yM) * t);
        rows.push([Math.round(Math.hypot(B.xM - A.xM, B.yM - A.yM) * t), Number.isNaN(e) ? 'no data' : Math.round(e)]);
      }
      body.appendChild(dataTable(['Distance (m)', 'Elevation (m)'], rows, `${preset.label} — ${preset.teaches}`));
    }
  }

  _textM3(body) {
    const h = document.createElement('h3');
    h.textContent = 'Crater size-frequency tables (the same patches)';
    body.appendChild(h);
    const p = document.createElement('p');
    p.textContent = 'Instead of counting craters on the 3D terrain, compare the measured size-frequency data for the two equal-area patches (0.071 km² each, diameters ≥ 80 m, from the NASA terrain model). The counting task and this data task lead to the same conclusion step.';
    body.appendChild(p);
    for (const patch of this.content.craters.patches) {
      const rows = patch.craters.map(c => [c.diameterM, c.depthM, patch.densityPerKm2]);
      body.appendChild(dataTable(
        ['Diameter (m)', 'Depth (m)', 'Patch density (craters/km²)'],
        rows.length ? rows : [['— none detected ≥ 80 m —', '', patch.densityPerKm2]],
        `${patch.id === 'mare' ? 'Mare plain patch' : 'Apennine Front patch'} (0.071 km²)`,
      ));
    }
    const note = document.createElement('p');
    note.textContent = 'Question: which patch shows more craters per area? Note it down — then do the superposition item below, and read the method note before concluding anything about age.';
    body.appendChild(note);
    this._renderSuperpositionText(body);
    const method = document.createElement('div');
    method.className = 'feedback';
    method.innerHTML = '<p><strong>Method note (same as the 3D reveal).</strong> The Front patch shows fewer craters, yet the Front is the OLDER material (about 3.9 Ga vs. the plain basalts about 3.3 Ga). Steep slopes erode and bury craters, so the crater clock only works on flat, stable surfaces; the Front\'s age comes from samples.</p>';
    body.appendChild(method);
  }

  _renderSuperpositionText(body) {
    const item = {
      prompt: 'The flat mare lavas run up TO the Apennine Front and thin out against its slopes. Which unit is younger?',
      options: [
        { id: 'a', text: 'The mare lavas — they lie against the Front', why: 'Correct: superposition.' },
        { id: 'b', text: 'The Apennine Front — it is taller', why: 'Height is not age; the contact direction is.' },
        { id: 'c', text: 'Cannot tell without samples', why: 'Superposition reads the order directly in the field.' },
      ],
      onAnswer: () => {},
    };
    body.appendChild(choiceItem({
      prompt: item.prompt, options: item.options,
      onAnswer: (opt) => {
        const fb = document.createElement('p');
        fb.className = 'feedback';
        const correct = opt.id === 'a';
        fb.textContent = `${correct ? 'Correct.' : 'Not quite.'} ${opt.why}`;
        body.appendChild(fb);
        this.record.log('answered', { id: 'superposition-1-text', name: 'Superposition (text mode)' }, { response: opt.id, success: correct });
      },
    }));
  }

  _textM4(body) {
    const h = document.createElement('h3');
    h.textContent = 'The traverse as a station choice list (same costs)';
    body.appendChild(h);
    const planner = new TraversePlanner({
      container: body, site: this.site,
      stationsContent: this.content.stations,
      board: this.board,
      resultFor: (id) => this._stationResults(id),
    });
    void planner;
    const note = document.createElement('p');
    note.textContent = 'The planner above is the full keyboard-operable planner (map + station buttons + numeric meters) — the same cost model as the 3D module.';
    body.appendChild(note);
  }

  _textM5(body) {
    const def = this.moduleDefs[4];
    const stepBoard = def.steps.find(s => s.kind === 'evidence-board');
    const h = document.createElement('h3');
    h.textContent = 'Evidence board';
    body.appendChild(h);
    const p = document.createElement('p');
    p.textContent = stepBoard.text;
    body.appendChild(p);
    const div = document.createElement('div');
    body.appendChild(div);
    this.board.render(div);
    const h2 = document.createElement('h3');
    h2.textContent = 'Field report builder (the same builder)';
    body.appendChild(h2);
    const cerEl = document.createElement('div');
    body.appendChild(cerEl);
    this._renderCerBuilder({ id: 'm5-cer-text', text: '' }, cerEl);
    const h3 = document.createElement('h3');
    h3.textContent = 'Post-check';
    body.appendChild(h3);
    this._textCheck('post', body);
  }

  // ---------- settings/persist -----------------------------------------------------
  _applySavedSettings() {
    this.settings._apply();
  }
}

/** Bootstrap. */
export async function boot() {
  const app = new App();
  window.__app = app;
  await app.init();
  if (__TEST_HOOKS__) {
    window.__TEST__ = {
      app,
      shell: app.shell,
      record: app.record,
      textMode: app.textMode,
      settings: app.settings,
      state: app.state,
      board: app.board,
      hooks: {
        showModule: (id) => app.showModule(id),
        nextStep: () => app._nextStep(),
        stepDone: (payload) => app._stepDone(app.currentStep, payload),
        answerCurrentCheck: (chosenIdx = 0) => {
          const btn = [...document.querySelectorAll('.assessment-item .choice-btn')].find(b => !b.disabled);
          btn?.click();
          return btn?.textContent;
        },
        addStation: (id) => app.traverse?._addStation(id),
        drivePlan: () => app.traverse?._run(),
        submitCounts: (n = 2) => {
          if (!app.craterCounter) return null;
          app.craterCounter.marks.mare = Array.from({ length: n }, (_, i) => ({ xM: 3700 + i * 20, yM: 5700 + i * 20 }));
          app.craterCounter.marks.front = [{ xM: 2900, yM: 9300 }];
          app.craterCounter._submit();
          return app.craterCounter.marks;
        },
        revealReference: () => app.craterCounter?._revealReference(),
        saveReport: () => document.querySelector('.cer-msg ~ button.btn.primary, #task-panel button.btn.primary')?.click(),
      },
    };
  }
  return app;
}
