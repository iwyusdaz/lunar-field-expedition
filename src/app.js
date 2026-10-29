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
// Learning content is authored in content/*.json and bundled at build time
// (single source of truth, separate from code).
import modulesContent from '../content/modules.json';
import itemsContent from '../content/items.json';
import stationsContent from '../content/stations.json';
import cinematicsContent from '../content/cinematics.json';
import reportContent from '../content/report.json';
import featuresContent from '../content/features.json';
import cratersContent from '../content/craters.json';
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
import { patchTarget, resolveTarget } from './systems/poi-targets.js';
import { applyCaseGrade, initFloatingHud } from './v2/cinematic-grade.js';
import { InWorldInteractionManager } from './v2/in-world-interaction.js';

const SLUG = window.__SLUG__ || 'lunar-field-expedition';
window.__SLUG__ = SLUG;

export class App {
  constructor() {
    this.content = {};
    this.stepEl = null;
    this.moduleIndex = 0;
  }

  async init() {
    // content (bundled from content/*.json)
    this.content.modules = modulesContent;
    this.content.items = itemsContent;
    this.content.stations = stationsContent;
    this.content.cinematics = cinematicsContent;
    this.content.report = reportContent;
    this.content.features = featuresContent;
    this.content.craters = cratersContent;
    this.moduleDefs = this.content.modules.modules;
    this.allSteps = this.moduleDefs.flatMap(m => m.steps.map(s => ({ ...s, moduleId: m.id })));

    this.record = new LearningRecord(SLUG);
    this.state = new AppState(SLUG, this.moduleDefs.map(m => m.id));
    this.motion = new MotionPrefs(SLUG);
    this.board = new EvidenceBoard(`${SLUG}:evidence`);

    const webgl = hasWebGL2();
    this._buildShellBase(); // creates #app canvas + task panel + POI (before Engine)
    initFloatingHud({ slug: SLUG });
    if (webgl) {
      this.canvas = document.getElementById('app');
      this.engine = new Engine(this.canvas);
      window.__engine = this.engine;
      // v2 grade: AgX + case exposure. Black sky: no dome, and no fog (no atmosphere).
      applyCaseGrade(SLUG, { renderer: this.engine.renderer, scene: this.engine.scene, addSkyDome: false });
      this.engine.scene.fog = null;
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
      await this.site.buildLiving({ reducedMotion: this.motion.reduced });
      this._buildInWorld();
      this.motion.onChange((reduced) => {
        this.site.setReducedMotion(reduced);
        if (this.world) this.world.reducedMotion = reduced;
      });
      this.engine.onUpdate((dt, t) => {
        if (this.activeScene === 'site') {
          this.site.update(dt);
          if (this.world) {
            const gliding = Boolean(this.world.glide);
            this.world.update(dt, t);
            if (gliding && !this.world.glide) this._syncOrbitToCamera();
          }
        } else this.globeScene.update(dt, this.motion.reduced);
      });
    }

    this._buildShellWiring();
    this._buildTextMode();
    this._buildCinematics();
    this._applySavedSettings();
    if (webgl) this.engine.start();
    this.showModule(this.state.state.module || this.moduleDefs[0].id, { resume: true });
  }

  // ---------- v2 in-world interaction ---------------------------------------------
  /**
   * Hover highlight + Plex Mono tooltip on the LM, rover, flag, crew and boulders;
   * glowing viewpoint rings (landing-site close-ups and every station) that glide
   * the camera. Drag-look and arrow keys stay with the OrbitController; WASD pans
   * the orbit target. The crater-marking click handler is untouched.
   */
  _buildInWorld() {
    const site = this.site;
    const world = new InWorldInteractionManager({
      canvas: this.canvas, camera: this.engine.camera, scene: site.v2,
      bounds: [-1e7, 1e7, -1e7, 1e7], reducedMotion: this.motion.reduced,
    });
    // Orbit owns drag-look and arrow keys; the manager only does hover, rings and glides.
    world._applyLookAngles = () => {};
    world.keys = new Set();
    world.keys.add = function add() { return this; };
    this.world = world;
    const L = site.lmPos;
    const g = (dx, dz) => site.meshHeightAt(L.x + dx, L.z + dz);
    const view = (dx, dz, ux, uz, h, dist) => {
      // camera `dist` m from (dx,dz) along (ux,uz), `h` m above the ground there
      const tx = L.x + dx, tz = L.z + dz, ty = g(dx, dz);
      const cx = tx + ux * dist, cz = tz + uz * dist;
      return { cameraPos: [cx, site.meshHeightAt(cx, cz) + h, cz], cameraTarget: [tx, ty + 1.6, tz] };
    };
    const orange = 0xe87722;
    world.registerInteractive(site.lmProp, { id: 'lm', label: 'Lunar Module descent stage', hint: 'Click to glide closer', highlightColor: orange, ...view(0, 0, 0.8, 0.6, 3.5, 17) });
    world.registerInteractive(site.rover, { id: 'rover', label: 'Lunar Roving Vehicle', hint: 'Click to watch it drive', highlightColor: orange, ...view(22, 0, -0.2, 1, 6, 24) });
    world.registerInteractive(site.flag, { id: 'flag', label: 'Flag', hint: 'No air: it never flutters', highlightColor: orange, ...view(-9, 8, 0.7, 0.7, 1.8, 6) });
    world.registerInteractive(site.crewA.root, { id: 'crew-a', label: 'Crew member A (fictional mission)', hint: 'Click to glide closer', highlightColor: orange, ...view(5.4, 3.2, 0.9, 0.4, 1.8, 6) });
    world.registerInteractive(site.crewB.root, { id: 'crew-b', label: 'Crew member B (fictional mission)', hint: 'Walking to a viewpoint', highlightColor: orange, ...view(-11, 16, 0.6, -0.8, 2.2, 9) });
    site.rocks.forEach((r, i) => {
      const dx = r.position.x - L.x, dz = r.position.z - L.z;
      world.registerInteractive(r, { id: `rock-${i}`, label: `Boulder ${i + 1} (${(r.userData.rockHeight || 0.5).toFixed(1)} m)`, hint: 'Click to inspect', highlightColor: orange, ...view(dx, dz, 0.6, 0.8, 1.6, 4) });
    });
    // Viewpoint rings: two landing-site close-ups (ring scaled x6) and one per station (x45)
    const ring = (id, label, x, z, scale, v) => {
      const r = world.addHotspotRing([x, site.meshHeightAt(x, z) + 0.05, z], { id, label, hint: 'Click to glide here', color: orange, ...v });
      r.scale.setScalar(scale);
      return r;
    };
    ring('vp-lm', 'Viewpoint: landing site', L.x + 12, L.z + 10, 6, view(0, 3, 0.75, 0.66, 5, 26));
    ring('vp-front', 'Viewpoint: crew walk', L.x - 6, L.z + 20, 6, view(-8, 14, 0.2, 1, 4, 14));
    for (const s of this.content.stations.stations.filter((x) => x.id !== 'lm')) {
      const P = site.terrain.fromLonLat(s.lon, s.lat);
      const y = site.meshHeightAt(P.xM, P.yM);
      if (Number.isNaN(y)) continue;
      const cx = P.xM + 160, cz = P.yM + 220;
      ring(`vp-${s.id}`, `Station: ${s.name}`, P.xM, P.yM, 45, {
        cameraPos: [cx, site.meshHeightAt(cx, cz) + 140, cz], cameraTarget: [P.xM, y, P.yM],
      });
    }
    // WASD pans the orbit target across the ground (arrows keep rotating the view)
    const pan = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
    this.engine.onUpdate((dt) => {
      if (this.activeScene !== 'site' || !this.world?.enabled || this.world.glide) return;
      if (document.querySelector('dialog[open]') || !document.getElementById('textmode')?.hidden) return;
      let fx = 0, fz = 0;
      for (const [code, [px, pz]] of Object.entries(pan)) if (this.input.isDown(code)) { fx += px; fz += pz; }
      if (!fx && !fz) return;
      const th = this.orbit.spherical.theta;
      const speed = Math.max(4, this.orbit.spherical.radius * 0.6) * dt;
      // forward (W) = away from the camera, in the ground plane
      const fwdX = -Math.sin(th), fwdZ = -Math.cos(th);
      const rgtX = Math.cos(th), rgtZ = -Math.sin(th);
      this.orbit.target.x += (fwdX * -fz + rgtX * fx) * speed;
      this.orbit.target.z += (fwdZ * -fz + rgtZ * fx) * speed;
      const y = this.site.meshHeightAt(this.orbit.target.x, this.orbit.target.z);
      if (!Number.isNaN(y)) this.orbit.target.y = y;
      this.orbit.update();
    });
  }

  /** After a glide, hand the camera back to the OrbitController without a jump. */
  _syncOrbitToCamera() {
    const cam = this.engine.camera;
    const t = this.world.target;
    this.orbit.target.copy(t);
    const off = cam.position.clone().sub(t);
    const r = Math.max(this.orbit.minRadius, off.length());
    this.orbit.spherical = {
      radius: r,
      theta: Math.atan2(off.x, off.z),
      phi: THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(off.y / r, -1, 1)), this.orbit.minPhi, this.orbit.maxPhi),
    };
    this.orbit.update();
  }

  /** Calm mode during focused module tasks; in-world clicks off while the canvas is a tool. */
  _syncWorldForStep(step) {
    const focused = step && !['brief', 'cinematic', 'debrief', 'globe'].includes(step.kind);
    this.site?.setCalmMode(Boolean(focused));
    this.world?.setCalmMode(Boolean(focused));
    this.world?.setEnabled(!step || !['crater-counter', 'profile-tool'].includes(step.kind));
  }

  // ---------- shell -----------------------------------------------------------
  _buildShellBase() {
    document.body.insertAdjacentHTML('afterbegin',
      '<dialog id="settings-dialog" aria-labelledby="settings-h"></dialog><dialog id="progress-dialog" aria-labelledby="progress-h"></dialog>');
    this.shell = new Shell({
      slug: SLUG,
      title: 'Lunar Field Expedition',
      moduleLabels: this.moduleDefs.map(m => m.title),
      onModuleChange: (i) => this.showModule(this.moduleDefs[i].id),
    });

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
    // honesty labels that belong to the 3D view itself
    const note = document.createElement('p');
    note.className = 'scene-note';
    note.textContent = 'Terrain: real NASA LROC elevation model, no exaggeration. Earth\'s position in the sky is approximate. The field-team mission is fictional.';
    poiWrap.appendChild(note);
  }

  _buildShellWiring() {
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
    this.shell.on('restart', () => {
      this.state.reset();
      this.board.clear();
      this.showModule(this.moduleDefs[0].id);
      announce('Progress cleared for this module run.');
    });
    this.shell.on('textmode', () => this.shell.toggleTextMode());
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
    if (resume) {
      // no auto cinematic on resume if it was already seen; show a replay affordance instead
      const seen = this.state.state.cinematicSeen;
      this._renderModuleSteps(def, { skipCinematic: def.steps.some(s => s.kind === 'cinematic' && seen[s.cinematic]) });
    } else {
      this._renderModuleSteps(def, {});
    }
    // keep text mode in sync when the learner switches modules while it is open
    if (this.textMode && !document.getElementById('textmode').hidden) {
      this.textMode.show(moduleId);
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
    // Resume at the first incomplete step.
    this.stepPtr = this.stepQueue.findIndex(s => !this.state.isComplete(s.id));
    if (this.stepPtr < 0) this.stepPtr = this.stepQueue.length; // all done
    this._nextStep();
  }

  _nextStep() {
    if (this.stepPtr >= this.stepQueue.length) {
      this._moduleComplete();
      return;
    }
    const step = this.stepQueue[this.stepPtr];
    this.currentStep = step;
    this._syncWorldForStep(step);
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
    this._syncWorldForStep(null);
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
    const redo = document.createElement('button');
    redo.type = 'button';
    redo.className = 'btn redo-module';
    redo.textContent = 'Redo this module';
    redo.addEventListener('click', () => this.redoModule(this.currentModuleId()));
    wrap.appendChild(redo);
    this.stepContainer.appendChild(wrap);
  }

  /**
   * Reopen a finished module: clear only its steps and the evidence it added,
   * then start it again. Other modules keep their progress.
   */
  redoModule(moduleId) {
    const def = this.moduleDefs.find(m => m.id === moduleId);
    if (!def) return;
    this.state.resetModule(def.steps.filter(s => s.kind !== 'cinematic').map(s => s.id));
    this.board.removeModule(moduleId);
    if (moduleId === 'm4') { this.plan = null; this.state.state.traverse = null; this.state.save(); }
    if (moduleId === 'm5') { this.state.state.report = null; this.state.state.postCheck = null; this.state.save(); }
    if (moduleId === 'm1') { this.state.state.preCheck = null; this.state.save(); }
    this.record.log('experienced', { id: `module-${moduleId}-redo`, name: `Redo: ${def.title}` });
    this.showModule(moduleId, { resume: true });
    announce(`${def.title} reopened.`);
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
            cont.disabled = false;
          },
        });
        // Patch centres are stored in site metres (center.xM/yM), not lon/lat.
        this.poi.set('patch-mare', { label: 'Mare patch (crater counting)', onSelect: () => this._flyTo('patch-mare', patchTarget(patches[0])) });
        this.poi.set('patch-front', { label: 'Front patch (crater counting)', onSelect: () => this._flyTo('patch-front', patchTarget(patches[1])) });
        const cont = document.createElement('button');
        cont.type = 'button';
        cont.className = 'btn primary continue-btn';
        cont.textContent = 'Continue to superposition';
        cont.disabled = true;
        cont.addEventListener('click', () => this._stepDone(step));
        el.appendChild(cont);
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
            // keep the driven plan so the report (also after a reload or in text mode) uses its hypothesis
            this.state.state.traverse = { hypothesis: this.plan.hypothesis, route: this.plan.route, evidenceTags: this.plan.evidenceTags };
            this.state.save();
            this.state.completeStep(step.id, { route: this.plan.route, score: score.metCount });
            this.record.log('completed', { id: step.id, name: 'Traverse planned and run' }, { response: { stations: this.plan.route.length - 1 } });
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn primary continue-btn';
            btn.textContent = 'Continue to the field report';
            btn.addEventListener('click', () => this._stepDone(step));
            el.appendChild(btn);
            btn.focus();
          },
        });
        for (const s of this.traverse.points.values()) {
          this.poi.set(`st-${s.id}`, { label: s.name, onSelect: () => this._flyTo(`st-${s.id}`, s) });
        }
        // No Continue here: the only way on is to drive the plan (onDebrief adds the button),
        // so Module 4 can't be marked complete without traverse evidence.
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
      // screen-size lettered pin; names stay neutral ("Feature A") so the list doesn't give the answer away
      const FP = this.site.terrain.fromLonLat(f.lon, f.lat);
      if (this.engine) this.site.addMarker(f.id, FP.xM, FP.yM, f.label || '');
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
            const why = opt.why || '';
            const prefix = opt.correct && /^correct/i.test(why) ? '' : (opt.correct ? 'Correct.' : 'Not quite.');
            const fb = document.createElement('div');
            fb.className = 'feedback';
            fb.innerHTML = `<p><strong>${prefix}</strong> ${why}</p>`;
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
        { id: 'b', text: 'The Apennine Front — it is taller', why: 'Height says nothing about age here; the contact direction does.' },
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
  _renderCerBuilder(step, el, { onSaved } = {}) {
    const rep = this.content.report.report;
    const p = document.createElement('p');
    p.textContent = step.text;
    el.appendChild(p);

    // evidence tag picker (structured check — not text grading)
    const hypId = this.state.state.traverse?.hypothesis || this.plan?.hypothesis || 'h-front';
    const hypDef = this.content.stations.hypotheses.find(h => h.id === hypId) || this.content.stations.hypotheses[0];
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
      if (missing.length) return;
      if (onSaved) onSaved({ saved: true });
      else this._stepDone(step, { saved: true }, 'Report saved. Next: the self-check.');
    });
    el.appendChild(submit);
  }

  // ---------- comparison ---------------------------------------------------------
  _renderComparison(step, el, { textMode = false } = {}) {
    const p = document.createElement('p');
    p.textContent = step.text;
    el.appendChild(p);
    const real = this.content.stations.apollo15Real;
    const table = dataTable(
      ['EVA', 'Duration', 'Route', 'What they found'],
      real.evas.filter(e => e.route).map(e => [
        e.label.split('(')[0].trim(),
        e.label.match(/\(([^)]+)\)/)?.[1] || '',
        e.route.map(id => this.content.stations.stations.find(s => s.id === id)?.name || id).join(' → '),
        e.found,
      ]),
      'The real Apollo 15 surface operations (source: research/apollo15-facts.md)',
    );
    el.appendChild(table);
    const img = document.createElement('img');
    img.src = `${import.meta.env.BASE_URL || './'}assets/photos/as15-89-12100.jpg`;
    // alt text follows NASA's own caption for this frame (images.nasa.gov, as15-89-12100)
    img.alt = 'NASA Apollo 15 photograph AS15-89-12100: telephoto view looking across Hadley Rille during the third EVA. The blocky outcrop at the top of the debris-covered west wall is about 1.9 km from the camera.';
    img.className = 'apollo-photo';
    el.appendChild(img);
    const cap = document.createElement('p');
    cap.className = 'photo-caption';
    cap.textContent = 'NASA photo AS15-89-12100, "Telephoto view across Hadley Rille photographed during Apollo 15 EVA" (2 Aug. 1971, EVA 3; public domain). The layered outcrops in the rille wall are the ones the crew photographed from Stations 9a and 10.';
    el.appendChild(cap);
    const genesis = document.createElement('div');
    genesis.className = 'found-card';
    genesis.innerHTML = `<h4>The 'Genesis Rock' story (sample 15415)</h4>
      <p>At Spur crater (Station 7) on EVA 2, Scott and Irwin found, among many other samples, a white crystalline rock later called the Genesis Rock: a 270-gram anorthosite — almost pure plagioclase feldspar from the Moon's early crust. Early analyses dated it to about 4.1 billion years; later work on related anorthosites suggests about 4.46 Ga. The crew believed they had a piece of the primordial crust; it turned out younger than the very first crust — but still exceptionally ancient, and exactly the kind of deep-crust material your traverse targeted. (Sources: research/apollo15-facts.md.)</p>`;
    el.appendChild(genesis);
    if (!textMode) this._continueBtn(el, 'Finish with the post-check');
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
      if (!this.engine) return;
      // cinematics never play during assessment (pre/post-check) steps
      if (this.currentStep?.kind === 'check') return;
      // if replay was started while the Moon globe was up, put the globe back afterwards
      const wasGlobe = this.activeScene === 'globe';
      this._playCinematic('approach', () => {
        if (wasGlobe) {
          this.activeScene = 'globe';
          this.site.group.visible = false;
          this.globeScene.group.visible = true;
          this.globeScene.placeCamera();
        }
      });
    });
  }

  _playCinematic(id, onDone) {
    const def = this.content.cinematics.cinematics.find(c => c.id === id);
    if (!def) { onDone?.(); return; }
    this.player.load(def);
    // The approach plays over the site scene; switch the scene WITHOUT
    // re-rendering the module flow.
    if (this.engine && this.activeScene !== 'site') {
      this.activeScene = 'site';
      this.globeScene.group.visible = false;
      this.site.group.visible = true;
      const t = this.site._target;
      this.orbit.target.copy(t);
      this.orbit.spherical = { radius: 2600, theta: Math.PI * 0.72, phi: Math.PI / 3.4 };
      this.orbit.update();
    }
    // The task panel would cover the cinematic captions; it returns when the shot ends or is skipped.
    if (this.stepEl) this.stepEl.hidden = true;
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
      if (this.stepEl) this.stepEl.hidden = false;
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
    const P = resolveTarget(pos, (lon, lat) => this.site.terrain.fromLonLat(lon, lat));
    if (!P) return; // never send the camera to NaN
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
      } else if (this._textDirty) {
        // text-mode work changed step state: rebuild the 3D panel once, on the way out
        this._textDirty = false;
        this.showModule(this.currentModuleId(), { resume: true });
      }
    });
    // module renderers (parity per plan section 11)
    const title = (i) => this.moduleDefs[i].title;
    this.textMode.register('m1', (body, api) => this._textM1(body, api), title(0));
    this.textMode.register('m2', (body, api) => this._textM2(body, api), title(1));
    this.textMode.register('m3', (body, api) => this._textM3(body, api), title(2));
    this.textMode.register('m4', (body, api) => this._textM4(body, api), title(3));
    this.textMode.register('m5', (body, api) => this._textM5(body, api), title(4));
  }

  /**
   * Record text-mode completion with the same state keys the 3D flow writes
   * (step ids, decisions, module-complete statement), without touching the
   * hidden 3D step queue.
   */
  _textComplete(moduleId, stepIds, payload) {
    for (const id of stepIds) this.state.completeStep(id, payload?.[id]);
    const def = this.moduleDefs.find(m => m.id === moduleId);
    const all = def.steps.filter(s => s.kind !== 'cinematic').every(s => this.state.isComplete(s.id));
    if (all) this.record.log('completed', { id: `module-${moduleId}`, name: `${def.title} (text mode)` });
    // the 3D panel is rebuilt from this state when text mode closes
    this._textDirty = true;
    return all;
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
    // the globe and brief are read above; answering every pre-check item completes the module
    this.state.completeStep('m1-globe');
    this.state.completeStep('m1-brief');
    this._textCheck('pre', body, { stepId: 'm1-precheck', moduleId: 'm1' });
  }

  _textCheck(setName, body, { stepId, moduleId } = {}) {
    const set = this.content.items.sets[setName];
    const answers = new Map();
    for (const item of set) {
      const fs = choiceItem({
        prompt: item.prompt,
        options: item.options,
        onAnswer: (opt) => {
          if (answers.has(item.id)) return; // first answer counts, as in the 3D check
          const correct = opt.id === item.correct;
          answers.set(item.id, { itemId: item.id, chosen: opt.id, correct });
          const fb = document.createElement('p');
          fb.className = 'feedback';
          fb.textContent = `${correct ? 'Correct.' : 'Not quite.'} ${opt.why || item.why || ''}`;
          fs.appendChild(fb); // feedback next to the answered item
          this.record.log('answered', { id: item.id, name: item.prompt.slice(0, 60) }, { response: opt.id, success: correct });
          if (answers.size === set.length && stepId) {
            const score = scoreAnswers([...answers.values()]);
            if (setName === 'pre') this.state.state.preCheck = score;
            else this.state.state.postCheck = score;
            this.state.save();
            this.record.log('completed', { id: stepId, name: `${setName}-check (text mode)` }, {
              response: { correct: score.correct, total: score.total }, success: score.ratio,
            });
            const out = document.createElement('p');
            out.className = 'feedback-step textmode-done';
            out.textContent = `You answered ${score.correct} of ${score.total}.`;
            body.appendChild(out);
            this._textComplete(moduleId, [stepId], { [stepId]: { correct: score.correct, total: score.total } });
          }
        },
      });
      body.appendChild(fs);
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
        // same letter as the 3D pin, so "marker A" in the question matches the image
        marker.textContent = this.content.features.features.find(f => f.id === a.feature)?.label || '◈';
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
    const tagged = new Set();
    for (const f of this.content.features.features) {
      const ann = tm.annotations.find(a => a.feature === f.id);
      const fs = choiceItem({
        prompt: `${f.name}${ann ? ` (marker ${f.label || ''} on the images)` : ''}: what is it and how did it form?`,
        options: f.options,
        onAnswer: (opt) => {
          const fb = document.createElement('p');
          fb.className = 'feedback';
          fb.textContent = `${opt.correct ? 'Correct.' : 'Not quite. Try another option.'} ${opt.why}`;
          fs.querySelectorAll('.feedback').forEach(x => x.remove());
          fs.appendChild(fb);
          this.record.log('answered', { id: `tag-${f.id}`, name: `Feature tag: ${f.name}` }, { response: opt.id, success: !!opt.correct });
          if (opt.correct) {
            tagged.add(f.id);
            this.state.completeStep(`m2-tag-${f.id}`, opt.id);
            if (tagged.size === this.content.features.features.length) {
              this._textComplete('m2', ['m2-sun', 'm2-tag', 'm2-profile'], { 'm2-tag': { allTagged: true } });
            }
          }
        },
      });
      body.appendChild(fs);
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
    const fs = choiceItem({
      prompt: item.prompt, options: item.options,
      onAnswer: (opt) => {
        const fb = document.createElement('p');
        fb.className = 'feedback';
        const correct = opt.id === 'a';
        fb.textContent = `${correct ? 'Correct.' : 'Not quite.'} ${opt.why}`;
        fs.querySelectorAll('.feedback').forEach(x => x.remove());
        fs.appendChild(fb);
        this.record.log('answered', { id: 'superposition-1-text', name: 'Superposition (text mode)' }, { response: opt.id, success: correct });
        // same evidence and step state as the 3D superposition step
        this.board.add({
          kind: 'observation', title: 'Superposition at the Front',
          text: 'The mare lavas lap against the Apennine Front: the plain is younger than the mountains.',
          evidenceTags: ['superposition', 'superposition-or-count'], source: 'Module 3 observation', moduleId: 'm3',
        });
        this._textComplete('m3', ['m3-count', 'm3-superposition', 'm3-debrief'], { 'm3-superposition': opt.id });
      },
    });
    body.appendChild(fs);
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
      onPlanned: (plan) => { this.plan = plan; },
      onDebrief: ({ score, plan }) => {
        // same state as the 3D planner: the report then uses THIS hypothesis
        this.plan = plan;
        this.state.state.traverse = { hypothesis: plan.hypothesis, route: plan.route, evidenceTags: plan.evidenceTags };
        this.state.save();
        this.record.log('completed', { id: 'm4-plan', name: 'Traverse planned and run (text mode)' }, { response: { stations: plan.route.length - 1 } });
        this._textComplete('m4', ['m4-hypothesis', 'm4-plan', 'm4-run', 'm4-debrief'], { 'm4-plan': { route: plan.route, score: score.metCount } });
        const done = document.createElement('p');
        done.className = 'feedback-step textmode-done';
        done.textContent = 'Traverse recorded. Module 4 is complete; the field report (Module 5) uses this hypothesis and evidence.';
        body.appendChild(done);
      },
    });
    this.textTraverse = planner;
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
    // same builder, but saving records text-mode completion instead of advancing the hidden 3D flow
    this._renderCerBuilder({ id: 'm5-cer', text: '' }, cerEl, {
      onSaved: (payload) => {
        this.state.completeStep('m5-board');
        this._textComplete('m5', ['m5-cer'], { 'm5-cer': payload });
        announce('Report saved.');
      },
    });
    // rubric self-check (same component as the 3D step)
    const hs = document.createElement('h3');
    hs.textContent = 'Rubric self-check';
    body.appendChild(hs);
    const selfEl = document.createElement('div');
    body.appendChild(selfEl);
    rubricSelfCheck({
      criteria: this.content.report.report.rubric, container: selfEl,
      onComplete: (ratings) => {
        this.state.state.report = { ...(this.state.state.report || {}), selfCheck: ratings };
        this.state.save();
        this.record.log('completed', { id: 'm5-selfcheck', name: 'Rubric self-check (text mode)' }, { response: ratings });
        this._textComplete('m5', ['m5-selfcheck'], { 'm5-selfcheck': ratings });
      },
    });
    // the real Apollo 15 comparison (same table, photo and story)
    const hc = document.createElement('h3');
    hc.textContent = 'Your traverse beside the real Apollo 15 one';
    body.appendChild(hc);
    const cmpEl = document.createElement('div');
    body.appendChild(cmpEl);
    const cmpDef = def.steps.find(s => s.kind === 'apollo-comparison');
    this._renderComparison(cmpDef, cmpEl, { textMode: true });
    this.state.completeStep('m5-comparison');
    const h3 = document.createElement('h3');
    h3.textContent = 'Post-check';
    body.appendChild(h3);
    this._textCheck('post', body, { stepId: 'm5-postcheck', moduleId: 'm5' });
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
