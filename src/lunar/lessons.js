/**
 * lessons.js — the five modules in the v3 scene-first shell (plan 10 §2).
 *
 * Each module is a short run of steps. A step shows in the Now card: the goal,
 * one action, a control hint and one primary button (at most 60 words). Tools
 * that need more room (the traverse planner, the evidence board, the field
 * report, the rubric, the Apollo comparison, the crater results) open in the
 * drawer on demand. Every decision has a text-mode equivalent that writes the
 * same state (text-mode parity); the text renderers are the v2 ones.
 *
 * Learning content stays in content/*.json. Step ids match v2, so saved
 * progress carries over.
 * @module lunar/lessons
 */
import * as THREE from 'three';
import { AppState } from '../systems/state.js';
import { EvidenceBoard } from '../systems/evidence.js';
import { TraversePlanner } from '../systems/traverse.js';
import { densityComparison, scaleRingPoints } from '../systems/crater-counter.js';
import { scoreAnswers, rubricSelfCheck } from '../learning/assess.js';
import { dataTable, choiceItem } from '../a11y/text-mode.js';
import { announce } from '../a11y/announcer.js';
import { TerrainField } from '../scenes/terrain.js';
import { SITE, MAX_SUN_ELEVATION_DEG } from './frame.js';

const BASE = import.meta.env?.BASE_URL || './';
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
const btn = (label, onClick, cls = 'v3-btn') => { const b = el('button', { type: 'button', className: cls, textContent: label }); b.addEventListener('click', onClick); return b; };
const para = (parent, text) => parent.appendChild(el('p', { textContent: text }));

export class Lessons {
  /**
   * @param {{ slug: string, content: object }} o  content: modules, items, stations, cinematics, report, features, craters
   */
  constructor({ slug, content }) {
    this.slug = slug;
    this.content = content;
    this.defs = content.modules.modules;
    this.state = new AppState(slug, this.defs.map((m) => m.id));
    this.board = new EvidenceBoard(`${slug}:evidence`);
    this.terrain = new TerrainField();
    this.step = {}; // module id -> current step index
    this.answers = {}; // check set -> Map(itemId -> result)
    this.app = null;
    this.surface = null;
    this.orbit = null;
  }

  /** The v2 heightfield (tools and text mode), loaded once on first use. */
  get _terrainReady() { return (this._tr ||= this.terrain.load('medium', { mesh: false }).then(() => this.terrain)); }

  bind(app, { surface, orbit }) {
    this.app = app;
    this.surface = surface;
    this.orbit = orbit;
    this.record = app.record;
    app.rig?.on('tap', (x, y) => this._onTap(x, y));
  }

  // ------------------------------------------------------------ scenes and views
  useScene(which) {
    const a = this.app;
    if (!a.engine || this.sceneName === which) return;
    this.sceneName = which;
    const orbitOn = which === 'orbit';
    this.orbit.group.visible = orbitOn;
    this.surface.group.visible = !orbitOn;
    this.surface.active = !orbitOn;
    a.inspect.clear();
    if (orbitOn) { this.orbit.resetSpin(); this.orbit.register(a.inspect); }
    else this.surface.registerAll();
    const R = 1737400;
    a.rig.walkable = !orbitOn;
    a.rig.limits = orbitOn
      ? { minRadius: R * 1.25, maxRadius: R * 6, minPhi: 0.15, maxPhi: Math.PI - 0.15, minEye: 0, eyeHeight: 0 }
      : { minRadius: 1.2, maxRadius: 9000, minPhi: 0.1, maxPhi: 1.5, minEye: 1.2, eyeHeight: 1.7 };
    a.rig.groundHeight = orbitOn ? () => -1e9 : (x, z) => this.surface.groundY(x, z);
    a.rig.bounds = orbitOn ? [-1, 1, -1, 1] : [this.surface.lm.x - 3400, this.surface.lm.x + 1450, this.surface.lm.z - 5400, this.surface.lm.z + 6100];
    const cam = a.engine.camera;
    if (orbitOn) { cam.near = 20000; cam.far = 6e7; cam.updateProjectionMatrix(); }
    a.rig.setHome(orbitOn ? this.orbit.view() : this.viewRel(10, 9, 28, 0.85, 1.3, 1.2));
    a.shell.setLegend(this.legend());
    if (!orbitOn) this.surface.startStreaming();
  }

  legend() {
    if (this.sceneName === 'orbit') return [
      { label: 'Landing site glint: Hadley, where Apollo 15 landed', text: 'A soft star on the Moon marks the landing site.' },
      { label: 'Mare Imbrium outline', text: 'A thin gold line round the rim of Mare Imbrium while the practice asks you to click it or its card is open.' },
    ];
    return [
      { label: 'Lettered survey tag', text: 'A flag with a letter (A to D) on a landform you name in Module 2.' },
      { label: 'Station survey flag', text: 'A tag with the Apollo 15 station number, at a station you can add to your traverse in Module 4 (it also shows while a station crater’s card is open).' },
      { label: 'Crater mark (your count)', text: 'A ring you placed on a crater in Module 3. Click it again to remove it.' },
      { label: 'Counting patch circle', text: 'Blue: the mare patch. Orange: the Front patch. The white ring is 80 m across.' },
      { label: 'Task glint', text: 'A soft star above the object the current step asks about.' },
      { label: 'Profile line', text: 'The line you measure in Module 2, with a flag at each end.' },
      { label: 'Apollo 15 routes', text: 'White lines: the real crew’s drives, shown in the Module 4 debrief.' },
    ];
  }

  /** A rig view of a ground point (metres east/south of the LM, or world x/z). */
  viewRel(dx, dz, radius, theta, phi, lift = 1.5) {
    const s = this.surface;
    const x = s.lm.x + dx, z = s.lm.z + dz;
    return { target: [x, s.groundY(x, z) + lift, z], radius, theta, phi };
  }
  viewWorld(x, z, radius, theta, phi, lift = 1.5) {
    const s = this.surface;
    return { target: [x, s.groundY(x, z) + lift, z], radius, theta, phi };
  }
  fly(v, d = 1.4) { if (this.app.rig && v) this.app.rig.flyTo(v, d); }

  /** Stand at a ground point (m east/south of the LM) and look toward a world direction (the sky, a mountain). */
  lookToward(dir, dx = 14, dz = 12, d = 1.0) {
    const s = this.surface;
    const eye = new THREE.Vector3(s.lm.x + dx, 0, s.lm.z + dz);
    eye.y = s.groundY(eye.x, eye.z) + 1.7;
    const n = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const r = 30;
    const back = n.clone().negate();
    this.fly({ target: eye.clone().addScaledVector(n, r).toArray(), radius: r, theta: Math.atan2(back.x, back.z), phi: Math.acos(back.y), look: true }, d);
  }

  // ------------------------------------------------------------ module defs
  modules() {
    const L = this;
    const use = (app) => { if (!L.app && app) { L.app = app; L.record = app.record; } };
    const mk = (i, id, label, steps, view) => ({
      id, label,
      get view() { return view(); },
      enter: (app) => { use(app); L.enterModule(i); },
      now: (app) => { use(app); return L.nowFor(i); },
      text: (body, app) => { use(app); L.textFor(i, body); },
    });
    this.steps = [
      this._m1Steps(), this._m2Steps(), this._m3Steps(), this._m4Steps(), this._m5Steps(),
    ];
    const surfaceOr = (fn) => () => (this.surface?.lm ? fn() : { target: [0, 0, 0], radius: 10, theta: 0, phi: 1 });
    return [
      mk(0, 'm1', 'Arrival', this.steps[0], () => this.orbit?.view() || { target: [0, 0, 0], radius: 5.4e6, theta: 3, phi: 1.3 }),
      mk(1, 'm2', 'Read the land', this.steps[1], surfaceOr(() => this.viewRel(-1350, 260, 2300, 1.2, 1.18, 0))),
      mk(2, 'm3', 'Which is older?', this.steps[2], surfaceOr(() => this.viewRel(250, 1400, 3300, 0.35, 1.08, 0))),
      mk(3, 'm4', 'Field traverse', this.steps[3], surfaceOr(() => this.viewRel(-600, 1900, 5200, -0.25, 0.98, 0))),
      mk(4, 'm5', 'Field report', this.steps[4], surfaceOr(() => this.viewRel(2, 2, 26, 2.45, 1.32, 1.2))),
    ];
  }

  /** Called by the shell when a module opens (after the camera starts flying to module.view). */
  enterModule(i) {
    const id = this.defs[i].id;
    this.state.goToModule(id);
    if (this.app.engine) this.useScene(i === 0 && !this._m1Landed() ? 'orbit' : 'surface');
    if (i === 0 && this.app.engine && this._m1Landed()) this.fly(this.viewRel(10, 9, 28, 0.85, 1.3, 1.2), 0.05);
    const steps = this.steps[i];
    let k = steps.findIndex((s) => !s.done());
    if (k < 0) k = steps.length; // all done: the module-complete card
    this.step[i] = k;
    this._enterStep(i);
  }

  _m1Landed() { return this.state.isComplete('m1-globe'); }

  _enterStep(i) {
    const prev = this._active;
    prev?.leave?.();
    const s = this.steps[i][this.step[i]];
    this._active = s || null;
    const a = this.app;
    if (a.engine) {
      a.inspect.setEnabled(!s?.noInspect);
      a.motion.setCalm(Boolean(s?.calm));
      this.surface.sunHold = Boolean(s?.sunHold);
      if (this.surface && this.stationFlagsOn !== Boolean(s?.flags)) { this.stationFlagsOn = Boolean(s?.flags); this._stationFlags(this.stationFlagsOn); }
    }
    s?.enter?.();
  }

  refresh() { if (this.app.module >= 0) this.app.shell.setNow(this.nowFor(this.app.module)); }

  /** Finish the current step and move on (or complete the module). */
  next(i = this.app.module) {
    this.step[i] = (this.step[i] ?? 0) + 1;
    if (this.step[i] >= this.steps[i].length) { this._finishModule(i); return; }
    this._enterStep(i);
    this.refresh();
  }

  _finishModule(i) {
    this._active?.leave?.();
    this._active = null;
    const def = this.defs[i];
    this.record.log('completed', { id: `module-${def.id}`, name: def.title });
    if (i + 1 < this.defs.length) this.app.completeModule(i);
    else { this.app.shell.setModuleDone(i, true); this.refresh(); this.app.shell.toast('Expedition complete. Your report stays in this browser.', 5000); }
  }

  nowFor(i) {
    const steps = this.steps[i];
    const k = this.step[i] ?? 0;
    if (k >= steps.length) return this._doneCard(i);
    const s = steps[k];
    return { step: k + 1, total: steps.length, ...s.now() };
  }

  _doneCard(i) {
    const last = i === this.defs.length - 1;
    return {
      kicker: 'Module complete',
      goal: last ? 'Expedition complete' : `${this.defs[i].title.replace(/^\d+\.\s*/, '')} is done`,
      action: last ? 'Your report and record stay in this browser. Keep exploring, or redo a module.' : 'Go on to the next module, or redo this one.',
      primary: last ? { label: 'Open my progress', onClick: () => this.app.shell.root.querySelector('[data-action="progress"]')?.click() } : { label: 'Next module', onClick: () => this.app.goModule(i + 1) },
      secondary: { label: 'Redo this module', onClick: () => this.redo(i) },
    };
  }

  redo(i) {
    const def = this.defs[i];
    this.state.resetModule(def.steps.map((s) => s.id).concat(i === 2 ? ['m3-intro'] : []));
    this.board.removeModule(def.id);
    if (def.id === 'm4') { this.state.state.traverse = null; this.state.save(); }
    if (def.id === 'm5') { this.state.state.report = null; this.state.state.postCheck = null; this.state.save(); }
    if (def.id === 'm1') { this.state.state.preCheck = null; this.state.save(); delete this.answers.pre; }
    if (def.id === 'm5') delete this.answers.post;
    this.app.shell.setModuleDone(i, false);
    this.record.log('experienced', { id: `module-${def.id}-redo`, name: `Redo: ${def.title}` });
    this.app.goModule(i);
  }

  done(id) { return this.state.isComplete(id); }
  complete(id, payload, name = id) {
    this.state.completeStep(id, payload);
    this.record.log('completed', { id, name }, payload !== undefined ? { response: payload } : undefined);
  }
  stepText(id) { return this.defs.flatMap((m) => m.steps).find((s) => s.id === id)?.text || ''; }
  touch() { return this.app.shell.touch; }
  hint(desktop, touch) { return this.touch() ? touch : desktop; }

  // ------------------------------------------------------------ Module 1
  _m1Steps() {
    const L = this;
    return [
      {
        id: 'm1-globe', done: () => L.done('m1-globe'),
        enter: () => { if (L.app.engine) L.useScene('orbit'); },
        now: () => ({
          goal: 'Find the landing site',
          action: 'Find the soft star on the Moon. It marks Hadley, where Apollo 15 landed in 1971. Then press Land at Hadley.',
          hint: L.hint('Optional: click the Moon, Mare Imbrium or the day-night line to read about them.', 'Optional: tap the Moon, Mare Imbrium or the day-night line to read about them.'),
          primary: { label: 'Land at Hadley', onClick: () => L.land(false) },
          secondary: L.app.engine ? { label: 'Watch the descent', play: true, onClick: () => L.land(true) } : undefined,
          readMore: { label: 'About this mission', title: 'Arrival', render: (b) => { para(b, L.stepText('m1-globe')); para(b, L.content.modules._meta.fictionFraming); } },
        }),
      },
      {
        id: 'm1-brief', done: () => L.done('m1-brief'),
        now: () => ({
          goal: 'Your mission question',
          action: 'Find out which is older: the dark plain or the mountains. First, look around the landing site.',
          hint: L.hint('Drag to look. W A S D to move. Click anything to learn what it is.', 'Drag to look. Use the joystick to move. Tap anything to learn what it is.'),
          primary: { label: 'Start the pre-check', onClick: () => { L.complete('m1-brief'); L.next(0); } },
          readMore: { label: 'Read the mission brief', title: 'Mission brief', render: (b) => { para(b, L.stepText('m1-brief')); para(b, 'The mission is fictional. The terrain, the geology and the Apollo 15 history are real and sourced.'); } },
        }),
      },
      L._checkStep('pre', 'm1-precheck', 0),
    ];
  }

  /** Leave orbit for the surface: straight to the LM, or by the approach cinematic. */
  land(withCinematic) {
    const a = this.app;
    const finish = () => {
      this.complete('m1-globe');
      if (!this.done('m1-cinematic')) this.complete('m1-cinematic', { skipped: !withCinematic });
      this.useScene('surface');
      this.fly(this.viewRel(10, 9, 28, 0.85, 1.3, 1.2), 0.05);
      this.next(0);
    };
    if (!a.engine) { finish(); return; }
    if (!withCinematic) { finish(); return; }
    this.useScene('surface');
    const def = this.content.cinematics.cinematics.find((c) => c.id === 'approach');
    a.player.onProgress = (shot, t) => {
      if (shot.effect?.type === 'sun') {
        const [e0] = shot.effect.from, [e1] = shot.effect.to;
        this.surface.setSunElevation(e0 + (e1 - e0) * t);
      }
    };
    a.player.onFinish = () => { a.player.onProgress = null; this.surface.setSunElevation(12); this.record.log('experienced', { id: 'cinematic-approach', name: 'Approach cinematic' }); this.state.state.cinematicSeen.approach = true; this.state.save(); finish(); };
    a.playCinematic(def);
  }

  /** Pre- or post-check: one question at a time in the Now card. */
  _checkStep(set, stepId, moduleIndex) {
    const L = this;
    const items = L.content.items.sets[set];
    const st = () => (L.answers[set] ||= { k: 0, res: new Map() });
    return {
      id: stepId, done: () => L.done(stepId), calm: true, noInspect: false,
      enter: () => { const s = st(); s.k = Math.min(s.k, items.length - 1); if (L.app.engine && moduleIndex === 0) L.surface.sunHold = false; },
      now: () => {
        const s = st();
        const item = items[s.k];
        const answered = s.res.get(item.id);
        const label = set === 'pre' ? 'Pre-check' : 'Post-check';
        const chosen = answered && item.options.find((o) => o.id === answered.chosen);
        return {
          kicker: `${label} · ${s.k + 1} of ${items.length}`,
          goal: answered ? `Your answer: ${chosen.text}` : item.prompt,
          question: answered ? undefined : {
            prompt: 'Choose one answer.',
            choices: item.options.map((o) => ({ id: o.id, text: o.text })),
            onAnswer: (choice) => {
              if (s.res.has(item.id)) return {};
              const correct = choice === item.correct;
              s.res.set(item.id, { itemId: item.id, chosen: choice, correct });
              L.record.log('answered', { id: item.id, name: item.prompt.slice(0, 60) }, { response: choice, success: correct });
              setTimeout(() => L.refresh(), 0);
              return { correct, feedback: '' };
            },
          },
          action: answered ? `${answered.correct ? 'Correct.' : 'Not quite.'} ${short(item.options.find((o) => o.id === answered.chosen)?.why || '')}` : undefined,
          primary: answered ? {
            label: s.k + 1 < items.length ? 'Next question' : `Finish the ${label.toLowerCase()}`,
            onClick: () => {
              if (s.k + 1 < items.length) { s.k++; L.refresh(); return; }
              const score = scoreAnswers([...s.res.values()]);
              if (set === 'pre') L.state.state.preCheck = score; else L.state.state.postCheck = score;
              L.state.save();
              L.record.log('completed', { id: stepId, name: `${set}-check` }, { response: { correct: score.correct, total: score.total }, success: score.ratio });
              L.state.completeStep(stepId, { correct: score.correct, total: score.total });
              L.app.shell.toast(`You answered ${score.correct} of ${score.total}.`, 3500);
              L.next(moduleIndex);
            },
          } : undefined,
          readMore: answered ? { label: 'Why?', title: item.prompt, render: (b) => { for (const o of item.options) para(b, `${o.text}: ${o.why}`); } } : undefined,
        };
      },
    };
  }

  // ------------------------------------------------------------ Module 2
  _m2Steps() {
    const L = this;
    const feats = L.content.features.features;
    let cur = 0;
    return [
      {
        id: 'm2-sun', done: () => L.done('m2-sun'),
        enter: () => { if (L.app.engine) { L.surface.setSunElevation(12); L.fly(L.viewRel(-1350, 260, 2300, 1.2, 1.18, 0)); } },
        now: () => ({
          goal: 'See how sunlight shows the land',
          action: 'Move the Sun. Watch the shadows in the rille and on the slopes. A low Sun shows the most relief.',
          tool: (box) => L._sunTool(box),
          hint: 'The Sun also moves on its own, in time-lapse.',
          primary: { label: 'Next step', onClick: () => { L.complete('m2-sun'); L.next(1); } },
          readMore: { label: 'Why a low Sun?', title: 'Sun angle and relief', render: (b) => para(b, L.stepText('m2-sun')) },
        }),
      },
      {
        id: 'm2-tag', done: () => L.done('m2-tag'), sunHold: true,
        enter: () => {
          if (!L.app.engine) return;
          L.surface.setSunElevation(10);
          for (const f of feats) { const p = L.terrain.fromLonLat(f.lon, f.lat); L.surface.addMarker(`feat-${f.id}`, p.xM, p.yM, f.label); }
          cur = Math.max(0, feats.findIndex((f) => !L.done(`m2-tag-${f.id}`)));
          L._flyFeature(feats[cur]);
        },
        leave: () => { if (L.app.engine) for (const f of feats) L.surface.removeMarker(`feat-${f.id}`); },
        now: () => {
          const f = feats[cur];
          const tagged = L.done(`m2-tag-${f.id}`);
          const all = feats.every((x) => L.done(`m2-tag-${x.id}`));
          return {
            goal: all ? 'All four landforms named' : `What is landform ${f.label}?`,
            tool: (box) => {
              for (const [j, x] of feats.entries()) {
                const b = btn(`${x.label}${L.done(`m2-tag-${x.id}`) ? ' ✓' : ''}`, () => { cur = j; L._flyFeature(x); L.refresh(); }, 'v3-btn lfe-letter');
                b.setAttribute('aria-pressed', String(j === cur));
                b.setAttribute('aria-label', `Fly to landform ${x.label}${L.done(`m2-tag-${x.id}`) ? ', named' : ''}`);
                box.append(b);
              }
            },
            question: tagged || all ? undefined : {
              prompt: 'Choose what it is and how it formed.',
              choices: f.options.map((o) => ({ id: o.id, text: o.text })),
              onAnswer: (id) => {
                const opt = f.options.find((o) => o.id === id);
                L.record.log('answered', { id: `tag-${f.id}`, name: `Feature tag: ${f.name}` }, { response: id, success: !!opt.correct });
                if (opt.correct) {
                  L.state.completeStep(`m2-tag-${f.id}`, id);
                  if (feats.every((x) => L.done(`m2-tag-${x.id}`))) L.complete('m2-tag', { allTagged: true }, 'All four landforms tagged');
                  setTimeout(() => { const n = feats.findIndex((x) => !L.done(`m2-tag-${x.id}`)); if (n >= 0) { cur = n; L._flyFeature(feats[n]); } L.refresh(); }, 1800);
                }
                return { correct: !!opt.correct, feedback: `${opt.correct ? 'Correct.' : 'Not quite. Try again.'} ${short(opt.why)}` };
              },
            },
            hint: all ? undefined : 'Pick a letter to fly there. Tap the land to learn its name later.',
            primary: { label: 'Next step', disabled: !all, onClick: () => L.next(1) },
          };
        },
      },
      {
        id: 'm2-profile', done: () => L.done('m2-profile'), sunHold: true, noInspect: true,
        enter: () => { if (L.app.engine) { L.surface.setSunElevation(12); L._profilePreset(0); } },
        leave: () => L._clearProfile(),
        now: () => ({
          goal: 'Measure the rille',
          action: L.profile ? L.hint('Try another line, or press Pick two points and click two spots. Then press Next module.', 'Try another line, or press Pick two points and tap two spots. Then press Next module.') : 'Pick a line. The chart shows the real height along it.',
          result: L.profile ? `Relief ${L.profile.reliefM} m along ${(L.profile.distanceM / 1000).toFixed(1)} km of real NASA height data.` : undefined,
          tool: (box) => L._profileTool(box),
          hint: L.picking ? L.hint('Click the ground twice: start, then end.', 'Tap the ground twice: start, then end.') : undefined,
          primary: { label: 'Next module', disabled: !L.done('m2-profile'), onClick: () => L.next(1) },
          readMore: { label: 'About the profile', title: 'Elevation profiles', render: (b) => { para(b, L.stepText('m2-profile')); for (const p of L.content.features.profilePresets) para(b, `${p.label}: ${p.teaches}`); } },
        }),
      },
    ];
  }

  _flyFeature(f) {
    if (!this.app.engine) return;
    const p = this.terrain.fromLonLat(f.lon, f.lat);
    const r = f.id === 'mare' ? 260 : f.id === 'crater' ? 700 : 1500;
    this.fly(this.viewWorld(p.xM, p.yM, r, f.id === 'front' ? 0.2 : 1.0, f.id === 'mare' ? 1.15 : 1.05, 0));
    announce(`Flying to landform ${f.label}.`);
  }

  _sunTool(box) {
    const s = this.surface;
    if (!s) return;
    const lab = el('label', { className: 'lfe-slider' });
    const out = el('output', { textContent: `${Math.round(s.sunElevation)}°` });
    const r = el('input', { type: 'range', min: '2', max: String(Math.floor(MAX_SUN_ELEVATION_DEG)), step: '1', value: String(Math.round(s.sunElevation)) });
    r.dataset.arrowKeys = 'true';
    r.setAttribute('aria-valuetext', `${Math.round(s.sunElevation)} degrees above the horizon`);
    lab.append('Sun height ', r, out);
    const play = btn(s.sunHold ? 'Play time-lapse' : 'Pause time-lapse', () => {
      s.sunHold = !s.sunHold;
      if (!s.sunHold) s.setSunElevation(s.sunElevation);
      play.textContent = s.sunHold ? 'Play time-lapse' : 'Pause time-lapse';
      play.setAttribute('aria-pressed', String(!s.sunHold));
    });
    play.setAttribute('aria-pressed', String(!s.sunHold));
    r.addEventListener('input', () => {
      s.sunHold = true;
      s.setSunElevation(Number(r.value));
      play.textContent = 'Play time-lapse'; play.setAttribute('aria-pressed', 'false');
      if (!this._sunUsed) { this._sunUsed = true; this.record.log('experienced', { id: 'sun-tool-used', name: 'Sun-angle tool used' }); }
    });
    this.app.onSun = (e) => { out.textContent = `${Math.round(e)}°`; if (document.activeElement !== r) r.value = String(Math.round(e)); r.setAttribute('aria-valuetext', `${Math.round(e)} degrees above the horizon`); };
    box.append(lab, play);
  }

  // ---- elevation profile
  _profileTool(box) {
    for (const [j, p] of this.content.features.profilePresets.entries()) {
      const b = btn(p.label.replace(/\s*\(.*\)$/, ''), () => this._profilePreset(j));
      b.setAttribute('aria-pressed', String(this._profileIdx === j));
      box.append(b);
    }
    if (this.app.engine) {
      const pick = btn(this.picking ? 'Cancel picking' : 'Pick two points', () => { this.picking = !this.picking; this._pickPts = []; this.refresh(); });
      pick.setAttribute('aria-pressed', String(!!this.picking));
      box.append(pick);
    }
    if (this.profile) box.append(profileChart(this.profile));
  }

  _profilePreset(j) {
    const p = this.content.features.profilePresets[j];
    const A = this.terrain.fromLonLat(p.from.lon, p.from.lat), B = this.terrain.fromLonLat(p.to.lon, p.to.lat);
    this._profileIdx = j;
    this.picking = false;
    this._measure(A.xM, A.yM, B.xM, B.yM, p.label);
  }

  _measure(x0, z0, x1, z1, label = 'Your line') {
    const n = 120, samples = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const e = this.terrain.elevationAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (Number.isFinite(e)) samples.push({ d: Math.hypot(x1 - x0, z1 - z0) * t, e });
    }
    if (samples.length < n * 0.8) { this.app.shell.toast('That line leaves the terrain data. Pick points nearer the landing site.'); return; }
    const es = samples.map((s) => s.e);
    const m = { label, distanceM: Math.round(Math.hypot(x1 - x0, z1 - z0)), reliefM: Math.round(Math.max(...es) - Math.min(...es)), minE: Math.round(Math.min(...es)), maxE: Math.round(Math.max(...es)), samples };
    this.profile = m;
    this.board.add({ kind: 'measurement', title: 'Elevation profile', text: `${m.label}: ${m.distanceM} m line, relief ${m.reliefM} m (from ${m.minE} to ${m.maxE} m).`, evidenceTags: ['profile'], source: 'Elevation-profile tool', moduleId: 'm2' });
    if (!this.done('m2-profile')) this.complete('m2-profile', { distanceM: m.distanceM, reliefM: m.reliefM }, 'Elevation profile measured');
    announce(`Profile measured: relief ${m.reliefM} metres over ${m.distanceM} metres.`);
    if (this.app.engine) {
      this._clearProfile();
      const s = this.surface;
      const pts = samples.map((q, i) => { const t = i / (samples.length - 1); const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; return new THREE.Vector3(x, s.groundY(x, z) + 4, z); });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffb347, depthTest: false, transparent: true }));
      line.renderOrder = 9; line.name = 'profile-line';
      s.group.add(line);
      this._profileLine = line;
      s.addMarker('prof-a', x0, z0, '1'); s.addMarker('prof-b', x1, z1, '2');
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      this.fly(this.viewWorld(mx, mz, Math.max(900, m.distanceM * 1.1), Math.atan2(-(z1 - z0), x1 - x0) + Math.PI / 2, 1.1, 0));
    }
    this.refresh();
  }

  _clearProfile() {
    if (!this.surface) return;
    if (this._profileLine) { this.surface.group.remove(this._profileLine); this._profileLine = null; }
    this.surface.removeMarker('prof-a'); this.surface.removeMarker('prof-b');
    this.picking = false;
  }

  // ------------------------------------------------------------ Module 3
  _m3Steps() {
    const L = this;
    const patches = L.content.craters.patches.map((p) => ({ ...p, name: p.id === 'mare' ? 'Mare patch' : 'Front patch' }));
    L.cc = { marks: Object.fromEntries(patches.map((p) => [p.id, []])), active: 'mare', submitted: false, patches };
    return [
      {
        id: 'm3-intro', done: () => L.done('m3-intro'),
        enter: () => { if (L.app.engine) { L.surface.setSunElevation(14); } },
        now: () => ({
          goal: 'Two clocks for surface age',
          action: 'Craters pile up over time. More craters in the same area usually means an older surface. Next you count craters in two patches.',
          hint: L.hint('Click the plain or the mountains to learn about them.', 'Tap the plain or the mountains to learn about them.'),
          primary: { label: 'Start counting', onClick: () => { L.complete('m3-intro'); L.next(2); } },
          readMore: { label: 'How crater clocks work', title: 'Crater counting', render: (b) => para(b, L.stepText('m3-count')) },
        }),
      },
      {
        id: 'm3-count', done: () => L.done('m3-count'), calm: true, sunHold: true, noInspect: true,
        // A low Sun (6 deg): the listed 110-130 m craters (9-12 m relief) show
        // as shadowed bowls. The Now card says when the close-up ground is still loading.
        enter: () => {
          if (!L.app.engine) return;
          L.surface.setSunElevation(6); L._drawPatches(); L._flyPatch(L.cc.active);
          // The finest terrain tiles (5 m) under the patch while counting (calm step, small view),
          // and no mid-distance scan texture: only the real relief casts the shadows you count.
          if (L.surface.streamed.tiles) L.surface.streamed.tiles.errorTarget = 3;
          L.surface.streamed.material.userData.uniforms.uMid.value = 0;
          L._patchWasReady = false;
          clearInterval(L._patchPoll);
          L._patchPoll = setInterval(() => { const r = L._patchReady(); if (r !== L._patchWasReady) { L._patchWasReady = r; L.refresh(); } }, 400);
        },
        leave: () => { clearInterval(L._patchPoll); L._clearPatches(); if (L.surface?.streamed?.tiles) L.surface.streamed.tiles.errorTarget = 10; if (L.surface?.streamed) L.surface.streamed.material.userData.uniforms.uMid.value = 1; },
        now: () => {
          const c = L.cc;
          const loading = !c.submitted && !L._patchReady();
          return {
            goal: c.submitted ? 'Counts saved' : 'Count the craters',
            action: c.submitted ? 'Compare your counts with a computer count before you decide.' : loading ? 'Loading the close-up ground for this patch. The craters show in a few seconds.' : L.hint('Click each crater at least 80 m wide inside the circle. The white ring is 80 m.', 'Tap each crater at least 80 m wide inside the circle. The white ring is 80 m.'),
            tool: (box) => {
              for (const p of patches) {
                const b = btn(`${p.name}: ${c.marks[p.id].length}`, () => { c.active = p.id; L._patchWasReady = false; L._flyPatch(p.id); L.refresh(); });
                b.setAttribute('aria-pressed', String(c.active === p.id));
                box.append(b);
              }
              if (!c.submitted) {
                box.append(btn('Undo', () => { c.marks[c.active].pop(); L._drawMarks(); L.refresh(); }));
                box.append(btn('Submit counts', () => L._submitCounts()));
              } else box.append(btn('See the results', (e) => L._openResults(e.currentTarget)));
            },
            hint: c.submitted ? undefined : 'Click a mark again to remove it.',
            primary: { label: 'Next step', disabled: !c.submitted, onClick: () => L.next(2) },
          };
        },
      },
      {
        id: 'm3-superposition', done: () => L.done('m3-superposition'),
        enter: () => { if (L.app.engine) { L.surface.setSunElevation(8); L.fly(L.viewRel(-400, 3600, 2600, 0.2, 1.22, 0)); } },
        now: () => {
          const item = SUPERPOSITION;
          const ans = L.state.state.decisions['m3-superposition'];
          return {
            goal: 'Read the order of the layers',
            action: ans ? short(item.options.find((o) => o.id === ans).why) : undefined,
            question: ans ? undefined : {
              prompt: item.prompt,
              choices: item.options.map((o) => ({ id: o.id, text: o.text })),
              onAnswer: (id) => {
                L._superposition(id);
                setTimeout(() => L.refresh(), 1600);
                const o = item.options.find((x) => x.id === id);
                return { correct: id === item.correct, feedback: '' + (id === item.correct ? 'Correct.' : 'Not quite.') + ' ' + short(o.why) };
              },
            },
            primary: ans ? { label: 'Next step', onClick: () => L.next(2) } : undefined,
          };
        },
      },
      {
        id: 'm3-debrief', done: () => L.done('m3-debrief'),
        now: () => {
          const ans = L.state.state.decisions['m3-debrief'];
          const o = ans && CLOCKS.options.find((x) => x.id === ans);
          return {
            goal: 'Which clock do you trust?',
            action: o ? `${ans === CLOCKS.correct ? 'Correct.' : 'Not quite.'} ${short(o.why)}` : 'Your counts may disagree with the rock ages.',
            question: ans ? undefined : {
              prompt: CLOCKS.prompt,
              choices: CLOCKS.options.map((x) => ({ id: x.id, text: x.text })),
              onAnswer: (id) => { L._clocks(id); setTimeout(() => L.refresh(), 1600); const x = CLOCKS.options.find((y) => y.id === id); return { correct: id === CLOCKS.correct, feedback: `${id === CLOCKS.correct ? 'Correct.' : 'Not quite.'} ${short(x.why)}` }; },
            },
            primary: ans ? { label: 'Next module', onClick: () => L.next(2) } : undefined,
            readMore: { label: 'Read the method note', title: 'Method note', render: (b) => { para(b, L.stepText('m3-debrief')); para(b, METHOD_NOTE); } },
          };
        },
      },
    ];
  }

  _superposition(id) {
    const correct = id === SUPERPOSITION.correct;
    this.board.add({ kind: 'observation', title: 'Superposition at the Front', text: 'The mare lavas lap against the Apennine Front: the plain is younger than the mountains.', evidenceTags: ['superposition', 'superposition-or-count'], source: 'Module 3 observation', moduleId: 'm3' });
    this.state.completeStep('m3-superposition', id);
    this.record.log('answered', { id: 'm3-superposition', name: 'Superposition puzzle' }, { response: id, success: correct });
  }

  /** Module 3 debrief answer (scene and text mode write the same state). */
  _clocks(id) {
    this.state.completeStep('m3-debrief', id);
    this.record.log('answered', { id: 'm3-debrief', name: 'Which clock do you trust' }, { response: id, success: id === CLOCKS.correct });
  }

  /** Is the close-up terrain under the counting patch loaded (and the camera there)? */
  _patchReady() {
    const t = this.surface?.streamed?.tiles;
    if (!this.app?.engine || !t) return true;
    // The camera must have arrived, and the tile queue stayed empty for a moment
    // (right after a move it is briefly empty before the new tiles are requested).
    const now = performance.now();
    if (this.app.rig.anim || t.loadProgress < 1) { this._patchBusyAt = now; return false; }
    return now - (this._patchBusyAt ?? 0) > 1200 && now - (this._patchFlownAt ?? 0) > 2500;
  }

  _flyPatch(id) {
    this._patchFlownAt = performance.now();
    const p = this.cc.patches.find((q) => q.id === id);
    this.fly(this.viewWorld(p.center.xM, p.center.yM, 400, PATCH_THETA, 0.5, 0)); // closer and steeper than v2, so the finest tiles load and each shadowed bowl reads
  }

  _drawPatches() {
    const s = this.surface;
    this._clearPatches();
    const g = new THREE.Group(); g.name = 'crater-patches';
    for (const p of this.cc.patches) {
      const pts = [];
      for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; const x = p.center.xM + p.radiusM * Math.cos(a), z = p.center.yM + p.radiusM * Math.sin(a); pts.push(new THREE.Vector3(x, s.groundY(x, z) + 3, z)); }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: p.id === 'mare' ? 0x66d9e8 : 0xffb347, depthTest: false, transparent: true })));
      // The 80 m ring sits beside the patch on the screen's right, at the same
      // distance from the camera (review F13: placed toward the camera it fell below the view).
      const ref = scaleRingPoints(p, 80, (x, z) => s.groundY(x, z), 64, { x: Math.cos(PATCH_THETA), z: -Math.sin(PATCH_THETA) });
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ref.points.map((q) => new THREE.Vector3(q.x, q.y + 1, q.z))), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true })));
    }
    for (const c of g.children) c.renderOrder = 9;
    s.group.add(g);
    this._patchGroup = g;
    this._drawMarks();
  }

  _clearPatches() {
    const s = this.surface;
    if (!s) return;
    for (const k of ['_patchGroup', '_markGroup']) if (this[k]) { s.group.remove(this[k]); this[k] = null; }
  }

  _drawMarks() {
    const s = this.surface;
    if (!s) return;
    if (this._markGroup) s.group.remove(this._markGroup);
    const g = new THREE.Group(); g.name = 'crater-marks';
    g.userData.marker = { label: 'Crater mark (your count)' };
    for (const [pid, list] of Object.entries(this.cc.marks)) for (const m of list) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 1.8, 6, 24), new THREE.MeshBasicMaterial({ color: m.onCrater === false ? 0x9a9a9a : pid === 'mare' ? 0x66d9e8 : 0xffb347, depthTest: false }));
      ring.position.set(m.xM, s.groundY(m.xM, m.yM) + 2, m.yM); ring.rotation.x = Math.PI / 2; ring.renderOrder = 9;
      g.add(ring);
    }
    s.group.add(g);
    this._markGroup = g;
  }

  _onTap(x, y) {
    const a = this.app;
    const r = a.shell.canvas.getBoundingClientRect();
    const ndcX = ((x - r.left) / r.width) * 2 - 1, ndcY = -((y - r.top) / r.height) * 2 + 1;
    if (this._active?.id === 'm3-count' && !this.cc.submitted) {
      const hit = this.surface.pickTerrain(ndcX, ndcY);
      if (!hit) return;
      const p = this.cc.patches.find((q) => q.id === this.cc.active);
      if (Math.hypot(hit.xM - p.center.xM, hit.yM - p.center.yM) > p.radiusM) { announce(`Outside the ${p.name}. Tap inside the circle.`); a.shell.toast(`Outside the ${p.name.toLowerCase()} circle.`); return; }
      const list = this.cc.marks[this.cc.active];
      const k = list.findIndex((m) => Math.hypot(m.xM - hit.xM, m.yM - hit.yM) < 14);
      // Review F12: every mark is kept (it is the learner's count), but a mark that is not on a
      // crater of the computer count is flagged at once, so a click on bare ground does not pass silently.
      const onCrater = k < 0 && this._onListedCrater(p, hit.xM, hit.yM);
      if (k >= 0) list.splice(k, 1); else list.push({ xM: hit.xM, yM: hit.yM, onCrater });
      if (k < 0 && !onCrater) a.shell.toast('Marked, but the computer count has no crater of 80 m or more there. Look for a round, shadowed bowl.', 4500);
      announce(k >= 0 ? 'Mark removed.' : `Crater marked${onCrater ? '' : ', not on a computer-counted crater'}. ${list.length} in this patch.`);
      this._drawMarks();
      this.refresh();
    } else if (this._active?.id === 'm2-profile' && this.picking) {
      const hit = this.surface.pickTerrain(ndcX, ndcY);
      if (!hit) return;
      this._pickPts.push(hit);
      if (this._pickPts.length === 1) { this.surface.addMarker('prof-a', hit.xM, hit.yM, '1'); a.shell.toast('Start set. Now the end point.'); }
      else { const [A, B] = this._pickPts; this.picking = false; this._profileIdx = -1; this._measure(A.xM, A.yM, B.xM, B.yM); }
    }
  }

  /** Is (x, z) inside a crater of the patch's computer count (its rim plus 10 m)? */
  _onListedCrater(patch, x, z) {
    return patch.craters.some((c) => { const q = this.terrain.fromLonLat(c.lonLat.lon, c.lonLat.lat); return Math.hypot(q.xM - x, q.yM - z) <= c.diameterM / 2 + 10; });
  }

  _submitCounts() {
    const c = this.cc;
    if (c.submitted) return;
    c.submitted = true;
    const counts = {}, densities = {};
    for (const p of c.patches) { counts[p.id] = c.marks[p.id].length; densities[p.id] = Math.round(c.marks[p.id].length / p.areaKm2); }
    c.result = { counts, densities };
    this.board.add({ kind: 'measurement', title: 'Crater counts', text: `Your counts (≥ 80 m): mare ${counts.mare}, Front ${counts.front} in equal 0.071 km² patches.`, evidenceTags: ['crater-count'], source: 'Module 3 count', moduleId: 'm3' });
    this.complete('m3-count', counts, 'Crater counts submitted');
    announce('Counts submitted.');
    this.refresh();
  }

  _openResults(trigger) {
    const c = this.cc;
    this.app.shell.openDrawer({
      title: 'Crater counts', trigger, render: (b) => {
        const names = c.patches.map((p) => p.name);
        b.append(dataTable(['Patch', 'Your count', 'Area', 'Density (per km²)'], c.patches.map((p) => [p.name, c.result.counts[p.id], `${p.areaKm2} km²`, c.result.densities[p.id]]), 'Your counts. The patches have the same area.'));
        para(b, densityComparison(names, c.result.densities.mare, c.result.densities.front));
        for (const p of c.patches) { const m = c.marks[p.id]; if (m.length) para(b, `${p.name}: ${m.filter((x) => x.onCrater).length} of your ${m.length} marks are on a crater of the computer count.`); }
        b.append(dataTable(['Patch', 'Computer count', 'Density (per km²)', 'Diameters (m)'], c.patches.map((p) => [p.name, p.craters.length, p.densityPerKm2, p.craters.map((q) => q.diameterM).join(', ') || 'none']), 'Computer count (approximate) from the NASA terrain model. Real counters disagree.'));
        para(b, METHOD_NOTE);
        this.record.log('experienced', { id: 'crater-reference', name: 'Reference count revealed' });
      },
    });
  }

  // ------------------------------------------------------------ Module 4
  _m4Steps() {
    const L = this;
    const hyps = L.content.stations.hypotheses;
    return [
      {
        id: 'm4-hypothesis', done: () => L.done('m4-hypothesis'), flags: true,
        now: () => {
          const chosen = L.state.state.decisions['m4-hypothesis'];
          return {
            goal: 'Choose your field question',
            question: chosen ? undefined : {
              prompt: 'Your traverse must answer one question. Which one?',
              choices: hyps.map((h) => ({ id: h.id, text: h.text })),
              onAnswer: (id) => { L.complete('m4-hypothesis', id, 'Hypothesis chosen'); setTimeout(() => L.refresh(), 0); return { correct: true, feedback: '' }; },
            },
            action: chosen ? `Your question: ${hyps.find((h) => h.id === chosen).text}` : undefined,
            hint: chosen ? undefined : 'The numbered flags are the stations you can visit.',
            primary: chosen ? { label: 'Next step', onClick: () => L.next(3) } : undefined,
            secondary: chosen ? { label: 'Change question', onClick: () => { delete L.state.state.decisions['m4-hypothesis']; L.state.resetModule(['m4-hypothesis']); L.refresh(); } } : undefined,
          };
        },
      },
      {
        id: 'm4-plan', done: () => L.done('m4-plan'), flags: true,
        now: () => ({
          goal: L.done('m4-plan') ? 'Traverse driven' : 'Plan your traverse',
          action: L.done('m4-plan') ? 'Press Next step. Your results are in the field notebook.' : 'Open the traverse planner. Pick up to four stations and one tool at each, then drive.',
          hint: L.done('m4-plan') ? undefined : 'Slopes cost more time. It is a simple model of a moonwalk.',
          primary: L.done('m4-plan') ? { label: 'Next step', onClick: () => L.next(3) } : { label: 'Open the traverse planner', onClick: () => L._openPlanner() },
          secondary: L.done('m4-plan') ? { label: 'Open the traverse planner', onClick: () => L._openPlanner(L.app.shell.now.querySelector('[data-action="now-secondary"]')) } : undefined,
          readMore: L.done('m4-plan') ? { label: 'Open the field notebook', title: 'Field notebook', render: (b) => { const d = el('div'); b.append(d); L.board.render(d); } } : undefined,
        }),
      },
      {
        id: 'm4-debrief', done: () => L.done('m4-debrief'), flags: true,
        enter: () => { if (L.app.engine) { L._realRoutes(true); L.fly(L.viewRel(-500, 2300, 6200, -0.2, 0.95, 0)); } },
        leave: () => L._realRoutes(false),
        now: () => ({
          goal: 'Compare with Apollo 15',
          action: 'The white lines show the real crew’s drives in 1971. Did your stations match theirs?',
          primary: { label: 'Next module', onClick: () => { for (const id of ['m4-run', 'm4-debrief']) L.complete(id); L.next(3); } },
          readMore: { label: 'See the real routes', title: 'Apollo 15 surface traverses', render: (b) => L._realRoutesTable(b) },
        }),
      },
    ];
  }

  _stationFlags(on) {
    const s = this.surface;
    for (const st of this.content.stations.stations) {
      if (st.id === 'lm') continue;
      if (!on) { s.removeMarker(`st-${st.id}`); continue; }
      const p = this.terrain.fromLonLat(st.lon, st.lat);
      const m = s.addMarker(`st-${st.id}`, p.xM, p.yM, st.apolloStation || String(this.content.stations.stations.indexOf(st)), '#ffffff'); // Apollo 15 station numbers
      m.userData.marker = { label: 'Station survey flag' };
    }
  }

  _openPlanner(trigger) {
    this._terrainReady.then(() => {
      this.app.shell.openDrawer({
        title: 'Traverse planner', trigger: trigger || this.app.shell.now.querySelector('[data-action="now-primary"]'), key: 'planner', render: (b) => {
          const planner = this._planner(b, { onDone: () => { this.complete('m4-plan', { route: planner.plan?.()?.route }); this.refresh(); } });
          const chosen = this.state.state.decisions['m4-hypothesis'];
          const r = b.querySelector(`input[name="tp-hyp"][value="${chosen}"]`);
          if (r) r.checked = true;
        },
      });
    });
  }

  _planner(container, { onDone }) {
    const planner = new TraversePlanner({
      container, site: { terrain: this.terrain },
      stationsContent: this.content.stations, board: this.board,
      // The chosen tool decides what a stop records (null lists every tool's results, for the tool menu).
      resultFor: (id, toolId) => this._stationResults(id, toolId),
      needs: (hyp) => this._neededTypes(hyp),
      haveTags: () => this.board.tags(),
      reveal: (node) => (this.app.shell.drawer.contains(node) ? this.app.shell.revealInDrawer(node) : (node.tabIndex = -1, node.scrollIntoView?.({ block: 'start' }), node.focus({ preventScroll: true }))),
      onPlanned: (plan) => { this.plan = plan; },
      onDebrief: ({ score, plan }) => {
        this.plan = plan || this.plan;
        this.state.state.traverse = { hypothesis: this.plan.hypothesis, route: this.plan.route, evidenceTags: this.plan.evidenceTags };
        this.state.save();
        this.record.log('completed', { id: 'm4-plan', name: 'Traverse planned and run' }, { response: { stations: this.plan.route.length - 1, score: score?.metCount } });
        onDone?.();
      },
    });
    this.traverse = planner;
    return planner;
  }

  _stationResults(stationId, toolId = null) {
    const res = this.content.stations.results[stationId];
    if (!res) return [];
    return Object.entries(res).filter(([t]) => !toolId || t === toolId).map(([toolId, r]) => ({ toolId, ...r, kind: toolId === 'sample' ? 'sample' : toolId === 'profile' ? 'measurement' : 'photo' }));
  }

  _realRoutes(show) {
    const s = this.surface;
    if (show && !this._routes) {
      const g = new THREE.Group(); g.name = 'apollo15-routes';
      for (const eva of this.content.stations.apollo15Real.evas.filter((e) => e.route)) {
        const pts = eva.route.map((id) => { const st = this.content.stations.stations.find((x) => x.id === id); const p = this.terrain.fromLonLat(st.lon, st.lat); return new THREE.Vector3(p.xM, s.groundY(p.xM, p.yM) + 14, p.yM); });
        const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts).getPoints(80) : pts;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
        line.renderOrder = 9;
        g.add(line);
      }
      s.group.add(g);
      this._routes = g;
    }
    if (this._routes) this._routes.visible = show;
  }

  _realRoutesTable(b) {
    const real = this.content.stations.apollo15Real;
    b.append(dataTable(['EVA', 'Duration', 'Route', 'What they found'], real.evas.filter((e) => e.route).map((e) => [
      e.label.split('(')[0].trim(), e.label.match(/\(([^)]+)\)/)?.[1] || '',
      e.route.map((id) => this.content.stations.stations.find((s) => s.id === id)?.name || id).join(' → '), e.found,
    ]), 'The real Apollo 15 surface operations (source: NASA, “50 Years Ago: Apollo 15 on the Moon at Hadley-Apennine”, 2021)'));
  }

  // ------------------------------------------------------------ Module 5
  _m5Steps() {
    const L = this;
    // A drawer step: the button opens its drawer (one name for both). With
    // `completeOnClose`, closing the drawer (✕, Esc or its own button) finishes
    // the step, so the card always offers Next step afterwards (review F19).
    const drawerStep = (id, goal, action, open, title, render, { after, completeOnClose } = {}) => {
      const show = (trigger) => L.app.shell.openDrawer({
        title, key: id, trigger, render: (b) => render(b),
        onClose: completeOnClose ? () => { if (!L.done(id)) { L.complete(id); L.refresh(); L.app.shell.now.querySelector('[data-action="now-primary"]')?.focus(); } } : null,
      });
      return {
        id, done: () => L.done(id),
        now: () => ({
          goal: L.done(id) ? `${goal}: done` : goal,
          action: L.done(id) ? 'Press Next step to go on.' : action,
          result: L.done(id) && !completeOnClose ? 'Saved.' : undefined,
          primary: L.done(id) ? { label: 'Next step', onClick: () => L.next(4) } : { label: open, onClick: () => show(L.app.shell.now.querySelector('[data-action="now-primary"]')) },
          secondary: L.done(id) ? { label: open, onClick: () => show(L.app.shell.now.querySelector('[data-action="now-secondary"]')) } : after?.(),
        }),
      };
    };
    return [
      {
        ...drawerStep('m5-board', 'Review your evidence', 'Open the field notebook. Each card is an observation, a measurement or a sample you collected.', 'Open the field notebook', 'Field notebook', (b) => {
          para(b, L.stepText('m5-board'));
          const d = el('div'); b.append(d); L.board.render(d);
          b.append(btn('I have reviewed it', () => { L.complete('m5-board'); L.app.shell.closeDrawer(); L.refresh(); }, 'v3-btn v3-primary'));
        }),
        enter: () => { if (L.app.engine) L.fly(L.viewRel(2, 2, 26, 2.45, 1.32, 1.2)); },
      },
      drawerStep('m5-cer', 'Write your field report', 'Write a claim, your evidence, your reasoning and what is still uncertain.', 'Write the report', 'Field report', (b) => L._cer(b, () => { L.app.shell.closeDrawer(); L.refresh(); })),
      drawerStep('m5-selfcheck', 'Check your report', 'Compare it with an example report. Then rate yourself. This is a mirror, not a grade.', 'Open the self-check', 'Self-check', (b) => L._selfCheck(b, () => { L.app.shell.closeDrawer(); L.refresh(); })),
      {
        ...drawerStep('m5-comparison', 'Compare with history', 'See what the Apollo 15 crew did here, and the story of the Genesis Rock.', 'Read the comparison', 'The comparison: Apollo 15 at Hadley', (b) => {
          L._comparison(b);
          b.append(btn('Done reading', () => L.app.shell.closeDrawer(), 'v3-btn v3-primary'));
        }, { completeOnClose: true, after: () => (L.app.engine ? { label: 'Go to Spur crater', onClick: () => L.goSpur() } : undefined) }),
      },
      L._checkStep('post', 'm5-postcheck', 4),
    ];
  }

  /** Fly to the Genesis Rock on the rim of Spur crater. */
  goSpur() {
    const s = this.surface;
    if (!s?.genesisAt) return;
    const { x, z } = s.genesisAt;
    this.fly(this.viewWorld(x, z, 0.9, 2.6, 1.05, 0.05), 1.6);
    // The fine terrain under Spur streams in as the camera arrives: settle the
    // view (and the rock) on it once the tiles are there.
    clearTimeout(this._spurT);
    this._spurT = setTimeout(() => { s.groundAll(); this.fly(this.viewWorld(x, z, 0.9, 2.6, 1.05, 0.05), 0.5); }, 3500);
  }

  /** The evidence types the field report requires for a question (report.json), in plain words. */
  _neededTypes(hypId) {
    const rep = this.content.report.report;
    const types = rep.evidenceTypes || [];
    const typeOf = (tag) => types.find((t) => t.tags.includes(tag)) || { id: tag, tags: [tag], label: tag };
    return [...new Set((rep.requiredEvidenceTags[hypId] || []).map(typeOf))];
  }

  /** From the field report back to the traverse planner (Module 4), to collect what is missing. */
  backToTraverse() {
    this.app.shell.closeDrawer();
    this.app.goModule(3);
    this.step[3] = 1;
    this._enterStep(3);
    this.refresh();
    if (this.app.engine) this._openPlanner(); else this.app.shell.toast('The traverse planner is in the text for Module 4.');
  }

  _cer(el0, onSaved) {
    const rep = this.content.report.report;
    para(el0, this.stepText('m5-cer'));
    const hypId = this.state.state.traverse?.hypothesis || this.state.state.decisions['m4-hypothesis'] || 'h-front';
    const required = rep.requiredEvidenceTags[hypId] || [];
    // One checkbox per evidence type, in plain words, with the notebook cards it
    // comes from. The types your question needs are listed first and marked.
    const types = rep.evidenceTypes || [];
    const typeOf = (tag) => types.find((t) => t.tags.includes(tag)) || { id: tag, tags: [tag], label: tag };
    const neededTypes = [...new Set(required.map((t) => typeOf(t)))];
    const onBoard = new Set(this.board.tags());
    const shown = [...neededTypes, ...types.filter((t) => !neededTypes.includes(t) && t.tags.some((x) => onBoard.has(x)))];
    const checked = new Set(this.state.state.report?.citedTags || []);
    const intro = el('p', { className: 'lfe-needed' }, el('strong', { textContent: 'Your question needs: ' }), neededTypes.map((t) => t.label.split(':')[0]).join('; ') + '.');
    el0.append(intro);
    const fs = el('fieldset', {}, el('legend', { textContent: 'Tick the evidence you cite' }));
    for (const t of shown) {
      const need = neededTypes.includes(t);
      const have = t.tags.some((x) => onBoard.has(x));
      const from = this.board.items.filter((e) => e.evidenceTags.some((x) => t.tags.includes(x))).map((e) => e.title);
      const cb = el('input', { type: 'checkbox', value: t.id, checked: t.tags.some((x) => checked.has(x)) });
      cb.addEventListener('change', () => { for (const x of t.tags) { if (cb.checked) checked.add(x); else checked.delete(x); } });
      const text = el('span', {}, el('span', { textContent: t.label }), el('span', { className: 'lfe-from', textContent: have ? ` (from: ${[...new Set(from)].join(', ')})` : ' (not collected yet: visit a station that gives it in Module 4)' }));
      if (need) text.prepend(el('strong', { className: 'lfe-need', textContent: 'Needed · ' }));
      fs.append(el('label', { className: 'lfe-check' }, cb, text));
    }
    if (!this.board.items.length) para(fs, 'Your field notebook is empty. Finish the earlier modules first.');
    el0.append(fs);
    const draft = { ...(this.state.state.report?.draft || {}) };
    const fields = [];
    for (const s of rep.sections) {
      const ta = el('textarea', { rows: 4, value: draft[s.id] || '', id: `cer-${s.id}` });
      ta.addEventListener('input', () => { draft[s.id] = ta.value; });
      el0.append(el('label', { className: 'lfe-field', htmlFor: ta.id }, el('strong', { textContent: s.label }), el('span', { textContent: ` ${s.prompt}` })), ta);
      fields.push({ id: s.id, ta, min: s.minChars });
    }
    const det = el('details', {}, el('summary', { textContent: 'Show the rubric' }));
    for (const c of rep.rubric) { det.append(el('h4', { textContent: c.name })); const ol = el('ol'); for (const l of c.levels) ol.append(el('li', { textContent: l })); det.append(ol); }
    el0.append(det);
    const msg = el('p', { role: 'status' });
    const back = btn('Go back to the traverse', () => this.backToTraverse());
    back.hidden = true;
    el0.append(msg, back, btn('Save report', () => {
      const missing = required.filter((t) => !checked.has(t));
      const shortF = fields.filter((f) => f.ta.value.trim().length < f.min).map((f) => f.id);
      this.state.state.report = { ...(this.state.state.report || {}), draft: { ...draft }, citedTags: [...checked], hypothesis: hypId };
      this.state.save();
      this.record.log('completed', { id: 'm5-cer', name: 'Field report saved' }, { response: { cited: checked.size, missing } });
      back.hidden = !missing.length;
      if (missing.length) { msg.textContent = `Still needed: ${[...new Set(missing.map((t) => typeOf(t).label.split(':')[0]))].join('; ')}. Tick them, or go back to the traverse to collect them, then save again.`; return; }
      msg.textContent = shortF.length ? `Saved. These sections are shorter than the guide length: ${shortF.join(', ')}.` : 'Saved. All required evidence types are cited.';
      this.state.completeStep('m5-cer', { saved: true });
      setTimeout(() => onSaved?.(), 1200);
    }, 'v3-btn v3-primary'));
  }

  _selfCheck(b, onDone) {
    const ex = this.content.report.report.exemplar;
    para(b, this.stepText('m5-selfcheck'));
    const det = el('details', {}, el('summary', { textContent: 'Show the example report (top band of the rubric)' }));
    for (const [k, v] of [['Claim', ex.claim], ['Evidence', ex.evidence], ['Reasoning', ex.reasoning], ['Uncertainty', ex.uncertainty]]) det.append(el('p', {}, el('strong', { textContent: `${k}. ` }), v));
    para(det, ex.note);
    b.append(det);
    rubricSelfCheck({
      criteria: this.content.report.report.rubric, container: b,
      onComplete: (ratings) => {
        this.state.state.report = { ...(this.state.state.report || {}), selfCheck: ratings };
        this.state.save();
        this.complete('m5-selfcheck', ratings, 'Rubric self-check');
        onDone?.();
      },
    });
  }

  _comparison(b) {
    para(b, this.stepText('m5-comparison'));
    this._realRoutesTable(b);
    b.append(el('img', { src: `${BASE}assets/photos/as15-89-12100.jpg`, className: 'lfe-photo', alt: 'NASA Apollo 15 photograph AS15-89-12100: telephoto view looking across Hadley Rille during the third EVA. The blocky outcrop at the top of the debris-covered west wall is about 1.9 km from the camera.' }));
    para(b, 'NASA photo AS15-89-12100, "Telephoto view across Hadley Rille photographed during Apollo 15 EVA" (2 Aug. 1971, EVA 3; public domain). The layered outcrops in the rille wall are the ones the crew photographed from Stations 9a and 10.');
    b.append(el('h3', { textContent: 'The Genesis Rock (sample 15415)' }));
    para(b, 'At Spur crater (Station 7) on EVA 2, Scott and Irwin found a white crystalline rock later called the Genesis Rock: a 270-gram anorthosite, almost pure plagioclase feldspar from the Moon’s early crust. Early analyses dated it to about 4.1 billion years; later work on related anorthosites suggests about 4.46 billion. It was not the very first crust, but it is exceptionally ancient: the kind of deep-crust material a traverse to the Front looks for. (Sources: NASA Apollo 15 history article; NASA lunar sample compendium, sample 15415.)');
    para(b, 'In the scene, a reconstructed model of it lies on the rim of Spur crater. Use “Go to Spur crater” to see it.');
  }

  // ------------------------------------------------------------ text mode (v2 parity renderers)
  textFor(i, body) {
    const f = [this._textM1, this._textM2, this._textM3, this._textM4, this._textM5][i];
    const wait = el('p', { textContent: 'Loading the terrain data…' });
    body.append(wait);
    this._terrainReady.then(() => { wait.remove(); f.call(this, body); }).catch(() => { wait.textContent = 'The terrain data could not be loaded.'; });
  }

  _textComplete(moduleId, stepIds, payload) {
    for (const id of stepIds) this.state.completeStep(id, payload?.[id]);
    const i = this.defs.findIndex((m) => m.id === moduleId);
    const all = this.steps[i].every((s) => s.done());
    if (all) {
      this.record.log('completed', { id: `module-${moduleId}`, name: `${this.defs[i].title} (text mode)` });
      this.app.shell.setModuleDone(i, true);
    }
    return all;
  }

  _textM1(body) {
    const def = this.defs[0];
    para(body, def.steps.find((s) => s.kind === 'brief').text);
    para(body, def.steps.find((s) => s.kind === 'globe').text);
    body.append(el('h3', { textContent: 'Pre-check' }));
    this.state.completeStep('m1-globe'); this.state.completeStep('m1-brief');
    this._textCheck('pre', body, { stepId: 'm1-precheck', moduleId: 'm1' });
  }

  _textCheck(setName, body, { stepId, moduleId }) {
    const set = this.content.items.sets[setName];
    const answers = new Map();
    for (const item of set) {
      const fs = choiceItem({
        prompt: item.prompt, options: item.options,
        onAnswer: (opt) => {
          if (answers.has(item.id)) return;
          const correct = opt.id === item.correct;
          answers.set(item.id, { itemId: item.id, chosen: opt.id, correct });
          fs.appendChild(el('p', { className: 'feedback', textContent: `${correct ? 'Correct.' : 'Not quite.'} ${opt.why || ''}` }));
          this.record.log('answered', { id: item.id, name: item.prompt.slice(0, 60) }, { response: opt.id, success: correct });
          if (answers.size === set.length) {
            const score = scoreAnswers([...answers.values()]);
            if (setName === 'pre') this.state.state.preCheck = score; else this.state.state.postCheck = score;
            this.state.save();
            this.record.log('completed', { id: stepId, name: `${setName}-check (text mode)` }, { response: { correct: score.correct, total: score.total }, success: score.ratio });
            body.appendChild(el('p', { className: 'feedback-step textmode-done', textContent: `You answered ${score.correct} of ${score.total}.` }));
            this._textComplete(moduleId, [stepId], { [stepId]: { correct: score.correct, total: score.total } });
          }
        },
      });
      body.appendChild(fs);
    }
  }

  _textM2(body) {
    const tm = this.content.features.textMode;
    body.append(el('h3', { textContent: 'The same task without the 3D view' }));
    for (const im of tm.orthoImages) {
      const fig = el('figure', { className: 'lfe-ortho' });
      fig.append(el('img', { src: `${BASE}${im.src}`, alt: im.alt }), el('figcaption', { textContent: im.label }));
      for (const a of tm.annotations) {
        const pos = im.id === 'low' ? a.onLow : a.onHigh;
        const m = el('span', { className: 'lfe-ortho-marker', textContent: this.content.features.features.find((f) => f.id === a.feature)?.label || '•', title: a.text });
        m.style.left = `${pos.xPct}%`; m.style.top = `${pos.yPct}%`;
        fig.append(m);
      }
      body.append(fig);
    }
    const ul = el('ul'); for (const a of tm.annotations) ul.append(el('li', { textContent: a.text })); body.append(ul);
    body.append(el('h3', { textContent: 'Name the landforms (the same choices as the 3D task)' }));
    const tagged = new Set();
    for (const f of this.content.features.features) {
      const fs = choiceItem({
        prompt: `${f.name} (marker ${f.label} on the images): what is it and how did it form?`, options: f.options,
        onAnswer: (opt) => {
          fs.querySelectorAll('.feedback').forEach((x) => x.remove());
          fs.appendChild(el('p', { className: 'feedback', textContent: `${opt.correct ? 'Correct.' : 'Not quite. Try another option.'} ${opt.why}` }));
          this.record.log('answered', { id: `tag-${f.id}`, name: `Feature tag: ${f.name}` }, { response: opt.id, success: !!opt.correct });
          if (opt.correct) {
            tagged.add(f.id); this.state.completeStep(`m2-tag-${f.id}`, opt.id);
            if (tagged.size === this.content.features.features.length) this._textComplete('m2', ['m2-sun', 'm2-tag', 'm2-profile'], { 'm2-tag': { allTagged: true } });
          }
        },
      });
      body.append(fs);
    }
    body.append(el('h3', { textContent: 'Elevation profiles as data tables (the same measurements)' }));
    for (const p of this.content.features.profilePresets) {
      const A = this.terrain.fromLonLat(p.from.lon, p.from.lat), B = this.terrain.fromLonLat(p.to.lon, p.to.lat);
      const rows = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; const e = this.terrain.elevationAt(A.xM + (B.xM - A.xM) * t, A.yM + (B.yM - A.yM) * t); rows.push([Math.round(Math.hypot(B.xM - A.xM, B.yM - A.yM) * t), Number.isNaN(e) ? 'no data' : Math.round(e)]); }
      body.append(dataTable(['Distance (m)', 'Elevation (m)'], rows, `${p.label}: ${p.teaches}`));
    }
  }

  _textM3(body) {
    body.append(el('h3', { textContent: 'Crater size-frequency tables (the same patches)' }));
    para(body, 'Instead of counting craters on the 3D terrain, compare the measured data for the two equal-area patches (0.071 km² each, diameters at least 80 m, from the NASA terrain model). It leads to the same conclusion step.');
    for (const p of this.content.craters.patches) {
      const rows = p.craters.map((c) => [c.diameterM, c.depthM, p.densityPerKm2]);
      body.append(dataTable(['Diameter (m)', 'Depth (m)', 'Patch density (craters/km²)'], rows.length ? rows : [['none detected at 80 m or more', '', p.densityPerKm2]], `${p.id === 'mare' ? 'Mare plain patch' : 'Apennine Front patch'} (0.071 km²)`));
    }
    para(body, 'Question: which patch shows more craters per area? Note it down, then answer the superposition item below and read the method note before concluding anything about age.');
    const finish = () => { if (this.done('m3-superposition') && this.done('m3-debrief')) this._textComplete('m3', ['m3-intro', 'm3-count']); };
    const fs = choiceItem({
      prompt: SUPERPOSITION.prompt, options: SUPERPOSITION.options,
      onAnswer: (opt) => {
        fs.querySelectorAll('.feedback').forEach((x) => x.remove());
        fs.appendChild(el('p', { className: 'feedback', textContent: `${opt.id === SUPERPOSITION.correct ? 'Correct.' : 'Not quite.'} ${opt.why}` }));
        this._superposition(opt.id);
        finish();
      },
    });
    body.append(fs);
    body.append(el('p', { className: 'feedback' }, el('strong', { textContent: 'Method note. ' }), METHOD_NOTE));
    const fc = choiceItem({
      prompt: CLOCKS.prompt, options: CLOCKS.options,
      onAnswer: (opt) => {
        fc.querySelectorAll('.feedback').forEach((x) => x.remove());
        fc.appendChild(el('p', { className: 'feedback', textContent: `${opt.id === CLOCKS.correct ? 'Correct.' : 'Not quite.'} ${opt.why}` }));
        this._clocks(opt.id);
        finish();
      },
    });
    body.append(fc);
  }

  _textM4(body) {
    body.append(el('h3', { textContent: 'The traverse planner (the same costs)' }));
    this._planner(body, {
      onDone: () => {
        const route = this.plan?.route;
        this._textComplete('m4', ['m4-hypothesis', 'm4-plan', 'm4-run', 'm4-debrief'], { 'm4-plan': { route } });
        body.append(el('p', { className: 'feedback-step textmode-done', textContent: 'Traverse recorded. Module 4 is complete; the field report in Module 5 uses this question and evidence.' }));
      },
    });
    body.append(el('h3', { textContent: 'The real Apollo 15 routes' }));
    this._realRoutesTable(body);
  }

  _textM5(body) {
    body.append(el('h3', { textContent: 'Field notebook' }));
    para(body, this.stepText('m5-board'));
    const d = el('div'); body.append(d); this.board.render(d);
    body.append(el('h3', { textContent: 'Field report' }));
    const cer = el('div'); body.append(cer);
    this._cer(cer, () => { this.state.completeStep('m5-board'); this._textComplete('m5', ['m5-cer']); announce('Report saved.'); });
    body.append(el('h3', { textContent: 'Self-check' }));
    const sc = el('div'); body.append(sc);
    this._selfCheck(sc, () => this._textComplete('m5', ['m5-selfcheck']));
    body.append(el('h3', { textContent: 'Your traverse beside the real Apollo 15 one' }));
    const cmp = el('div'); body.append(cmp); this._comparison(cmp);
    this.state.completeStep('m5-comparison');
    body.append(el('h3', { textContent: 'Post-check' }));
    this._textCheck('post', body, { stepId: 'm5-postcheck', moduleId: 'm5' });
  }
}

/**
 * The first whole sentence of an answer's explanation (the Now card keeps
 * feedback short; "Why?" opens the rest). A leading "Correct" with its
 * punctuation is dropped (the card adds its own "Correct." or "Not quite.").
 * A fragment shorter than four words takes the next sentence too. Never cut
 * mid-sentence: content tests keep every result a whole sentence of at most
 * 30 words.
 */
export function short(text) {
  let t = String(text || '').trim().replace(/^Correct\s*[.:,;—–-]*\s*/i, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z“"'‘(])/);
  let s = sentences[0].trim();
  if (s.split(/\s+/).length < 4 && sentences[1]) s = `${s} ${sentences[1].trim()}`;
  return s;
}

/** Tiny SVG chart of an elevation profile (decorative; the numbers are in the card). */
function profileChart(m) {
  const w = 240, h = 64;
  const d = m.samples.at(-1).d || 1;
  const pts = m.samples.map((s) => `${((s.d / d) * w).toFixed(1)},${(h - 4 - ((s.e - m.minE) / Math.max(1, m.maxE - m.minE)) * (h - 8)).toFixed(1)}`).join(' ');
  const svg = `<svg class="lfe-chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Height along the line: from ${m.minE} to ${m.maxE} metres"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = svg;
  return wrap.firstChild;
}

export const SUPERPOSITION = {
  id: 'superposition-1',
  prompt: 'The flat lavas run up to the mountains and thin out on their slopes. Which is younger?',
  options: [
    { id: 'a', text: 'The mare lavas: they lie against the Front', why: 'The lavas lap against the Front, so they arrived after the Front was there and are younger. This is superposition: the younger material lies on or against the older.' },
    { id: 'b', text: 'The Apennine Front: it is taller', why: 'Height tells you nothing about age here. The way the layers touch does.' },
    { id: 'c', text: 'You cannot tell without samples', why: 'You can read the order in the field: superposition is direct evidence. Samples then give the ages in years.' },
  ],
  correct: 'a',
};

export const CLOCKS = {
  id: 'clocks-1',
  prompt: 'Which clock do you trust for each surface?',
  options: [
    { id: 'a', text: 'Crater counts for both surfaces', why: 'Steep slopes erase craters, so the Front’s low count does not make it young. Its rocks are older than the plain’s.' },
    { id: 'b', text: 'Rock samples for the Front, crater counts for the plain', why: 'Crater counting works on flat, stable ground like the mare plain. On the steep Front, craters are erased, so its age comes from rock samples.' },
    { id: 'c', text: 'Neither: crater counts never tell age', why: 'On flat, stable ground a crater count is a good relative clock: more craters, older surface.' },
  ],
  correct: 'b',
};

/** Camera azimuth over a counting patch (rig theta: the camera sits east of the patch, looking west). */
const PATCH_THETA = 1.3;

export const METHOD_NOTE = 'The Front patch shows fewer craters, yet the Front is the older material (about 3.9 billion years, against about 3.3 billion for the plain’s lavas). Steep slopes erode and bury craters, so crater counting works as a clock only on flat, stable ground. The Front’s age comes from rock samples. The plain’s count is the meaningful clock reading.';

export { SITE };
