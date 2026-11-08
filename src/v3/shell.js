/**
 * shell.js — the scene-first shell (plan 10 §2).
 *
 * The 3D view fills the window. On top of it, in layer order (layers.css):
 * - one top bar (<= 56 px): Back, project name, module stepper with
 *   checkmarks, "Discovered x of y", one Menu button. Plain font, Settings,
 *   Text mode, Hide panel, Show all labels, camera controls, Journal, Objects,
 *   Controls (?), My progress and Back to start live in the menu. There is no
 *   link to the showcase from a project page (owner, 2026-11-07).
 * - Back (shell.backButton, data-ui="back") emits 'action:back': the app
 *   returns to the previous screen or step. Back to start
 *   (shell.backToStartButton, data-ui="back-to-start", in the menu) emits
 *   'action:back-to-start': the app shows the title screen again. Repo layouts
 *   with their own bar (a rail, a bottom bar) move these two elements where
 *   they want them; the handlers are bound on the shell root, so they keep
 *   working wherever the elements sit inside it;
 * - the Now card (bottom-left; phone: a one-line peek that expands into a
 *   bottom sheet, landscape phone: a side sheet <= 35% wide): step x of y, the
 *   goal, the one action, its control hint and one primary button, <= 60 words.
 *   Longer text opens in the drawer ("Read more"). "Hide panel" (menu, saved)
 *   or the peek button collapses it to its one-line peek on every layout;
 * - a camera control cluster (touch, or the "Show camera controls" setting) and
 *   a joystick (touch, walkable scenes);
 * - the info card layer, the drawer, the title screen, chapter cards, the
 *   cinematic caption + Skip (nothing else during a shot) and toasts.
 * Markup follows the ui-audit contract (data-ui attributes, see TOOLS.md).
 * @module v3/shell
 */
import { openDialog, closeDialog } from '../a11y/focus.js';
import { announce } from '../a11y/announcer.js';
import { countWords } from './catalog.js';

export const NOW_CARD_MAX_WORDS = 60;

/**
 * The Now-card rules (plan 10 §2.1, T-17): at most NOW_CARD_MAX_WORDS visible
 * words, and an action (or a question) that says what to do next. `text` is
 * the card's rendered text (tool controls included). Pure, so repo unit tests
 * can render every step and check it (S5 G1 F9); setNow warns with it in dev.
 * @param {string} text  @param {{ action?: string, question?: object }} spec
 */
export function nowCardIssues(text, spec) {
  const words = countWords(text);
  const issues = [];
  if (words > NOW_CARD_MAX_WORDS) issues.push(`${words} words (max ${NOW_CARD_MAX_WORDS}); move text to readMore`);
  if (!spec.action && !spec.question) issues.push('no action: say what to do next');
  return { words, issues };
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * One name per drawer: a button labelled "Open …" must contain every word of
 * the drawer title it opens ("Open the field notebook" → "Field notebook").
 * Other labels ("Why?", "Read more") are not checked.
 */
export function drawerNamed(label, title) {
  if (!/^open\b/i.test(String(label).trim())) return true;
  const words = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  const have = new Set(words(label));
  return words(title).filter((w) => !['the', 'a', 'an', 'my', 'your'].includes(w)).every((w) => have.has(w));
}

export class SceneShell {
  /**
   * @param {object} o
   * @param {string} o.slug
   * @param {string} o.title          full project name
   * @param {string} [o.shortTitle]   name for narrow screens
   * @param {string[]} o.modules      stepper labels
   * @param {boolean} [o.walkable=true]
   */
  constructor(o) {
    this.slug = o.slug;
    this.title = o.title;
    this.walkable = o.walkable !== false;
    this._listeners = {};
    this._escape = [];
    this.phase = 'explore';
    this.module = -1;
    this.done = new Set();
    document.documentElement.classList.add('v3');
    this.root = document.getElementById('ui') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'ui' }));
    this.root.classList.add('v3-shell');
    this.root.innerHTML = `
      <header class="v3-topbar" data-ui="top-bar">
        <button type="button" class="v3-btn v3-back-btn" data-action="back" data-ui="back" aria-label="Back: previous step"><span aria-hidden="true">←</span><span class="v3-back-label"> Back</span></button>
        <p class="v3-brand"><span class="v3-brand-full">${esc(o.title)}</span><span class="v3-brand-short" aria-hidden="true">${esc(o.shortTitle || o.title)}</span></p>
        <nav class="v3-stepper" aria-label="Modules"><ol></ol></nav>
        <p class="v3-discovered" data-ui="discovered" aria-live="polite"></p>
        <button type="button" class="v3-btn v3-menu-btn" data-action="menu" aria-haspopup="dialog">Menu</button>
      </header>
      <main class="v3-stage" id="stage">
        <canvas id="app" aria-label="${esc(o.title)}: 3D scene. Use the Objects list in the menu to reach every object by keyboard."></canvas>
        <div id="textmode" class="v3-textmode" data-ui="textmode" hidden tabindex="-1"></div>
      </main>
      <div class="v3-labels" data-ui="labels" aria-hidden="true"></div>
      <section class="v3-now" id="v3-now" data-ui="now-card" aria-label="Current step" hidden></section>
      <div class="v3-cluster" data-ui="camera-cluster" role="group" aria-label="Camera controls" hidden>
        <button type="button" class="v3-icon-btn" data-cam="left" aria-label="Turn left">⟲</button>
        <button type="button" class="v3-icon-btn" data-cam="right" aria-label="Turn right">⟳</button>
        <button type="button" class="v3-icon-btn" data-cam="up" aria-label="Tilt up">↥</button>
        <button type="button" class="v3-icon-btn" data-cam="down" aria-label="Tilt down">↧</button>
        <button type="button" class="v3-icon-btn" data-cam="in" aria-label="Zoom in">＋</button>
        <button type="button" class="v3-icon-btn" data-cam="out" aria-label="Zoom out">－</button>
        <button type="button" class="v3-icon-btn v3-cluster-wide" data-cam="reset" aria-label="Reset view">Reset</button>
      </div>
      <div class="v3-joystick" data-ui="joystick" hidden></div>
      <div class="v3-card-layer"></div>
      <aside class="v3-drawer" data-ui="drawer" aria-labelledby="v3-drawer-title" hidden>
        <div class="v3-drawer-head"><h2 id="v3-drawer-title" tabindex="-1"></h2>
          <button type="button" class="v3-icon-btn" data-action="drawer-close" aria-label="Close drawer">✕</button></div>
        <div class="v3-drawer-body"></div>
      </aside>
      <div class="v3-cinematic-host" id="cinematic-host"></div>
      <section class="v3-title" data-ui="title-screen" aria-labelledby="v3-title-h" hidden></section>
      <div class="v3-chapter" data-ui="chapter-card" role="status" hidden></div>
      <div class="v3-toasts" aria-live="polite"></div>
      <dialog class="v3-menu" id="menu-dialog" aria-labelledby="v3-menu-h">
        <div class="v3-dialog-head"><h2 id="v3-menu-h">Menu</h2><button type="button" class="v3-icon-btn" data-action="menu-close" aria-label="Close menu">✕</button></div>
        <ul class="v3-menu-list">
          <li><button type="button" class="v3-btn" data-action="objects" data-ui="objects-list-toggle" aria-controls="v3-drawer">Objects in view</button></li>
          <li><button type="button" class="v3-btn" data-action="journal">Discovery journal</button></li>
          <li><button type="button" class="v3-btn" data-action="controls">Controls and legend (?)</button></li>
          <li><button type="button" class="v3-btn" data-action="practice">Replay the practice</button></li>
          <li><button type="button" class="v3-btn" data-action="show-labels" aria-pressed="false">Show all labels</button></li>
          <li><button type="button" class="v3-btn" data-action="camera-controls" aria-pressed="false">Show camera controls</button></li>
          <li><button type="button" class="v3-btn" data-action="hide-panel" aria-controls="v3-now">Hide panel</button></li>
          <li><button type="button" class="v3-btn" data-action="plain-font" aria-pressed="false">Plain font</button></li>
          <li><button type="button" class="v3-btn" data-action="textmode" data-ui="textmode-toggle" aria-pressed="false">Text mode</button></li>
          <li><button type="button" class="v3-btn" data-action="settings">Settings</button></li>
          <li><button type="button" class="v3-btn" data-action="progress">My progress</button></li>
          <li><button type="button" class="v3-btn" data-action="back-to-start" data-ui="back-to-start">Back to start</button></li>
        </ul>
      </dialog>
      <dialog class="v3-controls" id="controls-dialog" aria-labelledby="v3-controls-h">
        <div class="v3-dialog-head"><h2 id="v3-controls-h">Controls</h2><button type="button" class="v3-icon-btn" data-action="controls-close" aria-label="Close controls">✕</button></div>
        <div class="v3-controls-body"></div>
        <h3>Legend</h3>
        <ul class="v3-legend" data-ui="legend"></ul>
      </dialog>
      <dialog id="settings-dialog" aria-labelledby="settings-h"></dialog>
      <dialog id="progress-dialog" aria-labelledby="progress-h"></dialog>`;
    const $ = (s) => this.root.querySelector(s);
    this.topBar = $('.v3-topbar');
    this.backButton = $('[data-ui="back"]');
    this.backToStartButton = $('[data-ui="back-to-start"]');
    this.stepper = $('.v3-stepper ol');
    this.discovered = $('[data-ui="discovered"]');
    this.canvas = $('#app');
    this.textModeRoot = $('#textmode');
    this.labelLayer = $('.v3-labels');
    this.now = $('[data-ui="now-card"]');
    this.cluster = $('[data-ui="camera-cluster"]');
    this.joystick = $('[data-ui="joystick"]');
    this.cardLayer = $('.v3-card-layer');
    this.drawer = $('[data-ui="drawer"]');
    this.drawer.id = 'v3-drawer';
    this.cinematicHost = $('#cinematic-host');
    this.titleScreen = $('[data-ui="title-screen"]');
    this.chapter = $('[data-ui="chapter-card"]');
    this.toasts = $('.v3-toasts');
    this.menu = $('#menu-dialog');
    this.controls = $('#controls-dialog');
    this.legend = $('[data-ui="legend"]');
    this.settingsDialog = $('#settings-dialog');
    this.progressDialog = $('#progress-dialog');

    this.setModules(o.modules || []);
    this._prefs();
    this._bind();
    this._layout();
    this.setControlsHelp();
  }

  on(ev, fn) { (this._listeners[ev] ||= new Set()).add(fn); return () => this._listeners[ev].delete(fn); }
  _emit(ev, ...a) { for (const fn of this._listeners[ev] || []) fn(...a); }

  /** Register an Escape handler; higher priority runs first; return true when handled. */
  onEscape(fn, priority = 0) { this._escape.push({ fn, priority }); this._escape.sort((a, b) => b.priority - a.priority); }

  // ---------- layout ----------
  _layout() {
    const w = innerWidth, h = innerHeight;
    const phone = Math.min(w, h) < 600;
    const next = phone ? (w > h ? 'phone-landscape' : 'phone-portrait') : 'desktop';
    const changed = next !== this.layout;
    this.layout = next;
    this.root.dataset.layout = next;
    this.touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    this._applyCluster();
    if (changed) this._emit('layout', next);
  }

  topBarHeight() { return this.topBar.offsetParent ? this.topBar.getBoundingClientRect().bottom : 0; }

  /** Visible UI rectangles that labels and the info card must avoid. */
  reservedRects({ exclude } = {}) {
    const els = [this.now, this.cluster, this.drawer, this.joystick, ...(exclude === 'card' ? [] : [this.cardLayer.firstElementChild])];
    const out = [];
    for (const el of els) {
      if (!el || el.hidden || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ left: r.left - 8, top: r.top - 8, right: r.right + 8, bottom: r.bottom + 8 });
    }
    return out;
  }

  /** Phases: title | explore | chapter | cinematic | text. CSS hides what each phase must not show. */
  setPhase(p) {
    this.phase = p;
    this.root.dataset.phase = p;
    this._emit('phase', p);
  }

  setCardOpen(on) { this.root.dataset.cardOpen = on ? 'true' : 'false'; }

  // ---------- stepper ----------
  setModules(labels) {
    this.modules = labels;
    this.stepper.innerHTML = '';
    labels.forEach((label, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'v3-step';
      b.dataset.ui = 'module-step';
      b.dataset.index = String(i);
      b.innerHTML = `<span class="v3-step-dot" aria-hidden="true">${i + 1}</span><span class="visually-hidden">Module ${i + 1} of ${labels.length}: </span><span class="v3-step-label">${esc(label)}</span><span class="visually-hidden v3-step-state"></span>`;
      b.addEventListener('click', () => this._emit('module', i));
      li.appendChild(b);
      this.stepper.appendChild(li);
    });
  }

  setModule(i) {
    this.module = i;
    [...this.stepper.querySelectorAll('[data-ui="module-step"]')].forEach((b, j) => {
      b.classList.toggle('is-current', i === j);
      if (i === j) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      // A narrow top bar scrolls the stepper: keep the current module in view.
      if (i === j) { const ol = this.stepper; const l = b.offsetLeft, r = l + b.offsetWidth; if (l < ol.scrollLeft || r > ol.scrollLeft + ol.clientWidth) ol.scrollLeft = Math.max(0, r - ol.clientWidth); }
    });
  }

  setModuleDone(i, done = true) {
    if (done) this.done.add(i); else this.done.delete(i);
    const b = this.stepper.querySelectorAll('[data-ui="module-step"]')[i];
    if (!b) return;
    b.classList.toggle('is-done', done);
    b.querySelector('.v3-step-dot').textContent = done ? '✓' : String(i + 1);
    b.querySelector('.v3-step-state').textContent = done ? ' (done)' : '';
  }

  // ---------- journal counter ----------
  bindJournal(journal) {
    const upd = () => {
      this.discovered.innerHTML = `<span class="v3-disc-long">Discovered ${journal.count} of ${journal.total}</span><span class="v3-disc-short" aria-hidden="true">${journal.count}/${journal.total}<span class="v3-disc-word"> found</span></span>`;
    };
    journal.onChange(upd);
    upd();
  }

  // ---------- Now card ----------
  /**
   * @param {object} n
   * @param {number} [n.step]  @param {number} [n.total]
   * @param {string} n.goal    heading
   * @param {string} [n.action] the one action to take, action first ("Press Next step", "Click two
   *   spots"); a card with no question always says what to do next
   * @param {string} [n.result] a readout or outcome of what the learner just did (a measurement,
   *   "Saved"), shown under the action, never in place of it
   * @param {string} [n.hint]   control hint for it
   * @param {{ label: string, onClick: Function, disabled?: boolean }} [n.primary]
   * @param {{ label: string, onClick: Function, play?: boolean }} [n.secondary]  e.g. Watch (sets data-ui="play-cinematic" when play)
   * @param {{ label?: string, title: string, render: (el: HTMLElement) => void }} [n.readMore]
   * @param {{ prompt: string, choices: { id: string, text: string }[], onAnswer: (id: string) => ({ correct: boolean, feedback: string }) }} [n.question]
   * @param {string} [n.kicker]  replaces "Step x of y" (e.g. "Practice 1 of 4")
   * @param {(el: HTMLElement, shell: SceneShell) => void} [n.tool]  compact task controls (a slider,
   *   a few buttons, a readout) rendered inside the card, above the hint; they count toward the
   *   60-word limit, so longer tools belong in the drawer
   */
  setNow(n) {
    this._nowSpec = n;
    const kicker = n.kicker || (n.step ? `Step ${n.step} of ${n.total}` : '');
    const q = n.question;
    this.now.innerHTML = `
      <button type="button" class="v3-now-peek" data-action="now-toggle" aria-expanded="true">
        <span class="v3-now-peek-text"><span class="v3-kicker">${esc(kicker)}</span> ${esc(n.goal)}</span><span class="v3-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="v3-now-body">
        ${kicker ? `<p class="v3-kicker">${esc(kicker)}</p>` : ''}
        <h2 class="v3-now-goal">${esc(n.goal)}</h2>
        ${n.action ? `<p class="v3-now-action">${esc(n.action)}</p>` : ''}
        ${n.result ? `<p class="v3-now-result" role="status">${esc(n.result)}</p>` : ''}
        ${q ? `<fieldset class="v3-question"><legend>${esc(q.prompt)}</legend>${q.choices.map((c) => `<button type="button" class="v3-btn v3-choice" data-choice="${esc(c.id)}">${esc(c.text)}</button>`).join('')}</fieldset><p class="v3-feedback" role="status"></p>` : ''}
        ${n.tool ? '<div class="v3-now-tool" data-now-tool></div>' : ''}
        ${n.hint ? `<p class="v3-hint">${esc(n.hint)}</p>` : ''}
        <div class="v3-now-actions">
          ${n.primary ? `<button type="button" class="v3-btn v3-primary" data-action="now-primary" ${n.primary.disabled ? 'disabled' : ''}>${esc(n.primary.label)}</button>` : ''}
          ${n.secondary ? `<button type="button" class="v3-btn" data-action="now-secondary" ${n.secondary.play ? 'data-ui="play-cinematic"' : ''}>${esc(n.secondary.label)}</button>` : ''}
          ${n.readMore ? `<button type="button" class="v3-btn v3-link-btn" data-action="now-more" aria-controls="v3-drawer">${esc(n.readMore.label || 'Read more')}</button>` : ''}
        </div>
      </div>`;
    if (n.tool) n.tool(this.now.querySelector('[data-now-tool]'), this);
    const body = this.now.querySelector('.v3-now-body');
    for (const issue of nowCardIssues(body.innerText || body.textContent, n).issues) console.warn(`Now card "${n.goal}": ${issue}.`);
    this.now.querySelector('[data-action="now-primary"]')?.addEventListener('click', () => n.primary.onClick());
    this.now.querySelector('[data-action="now-secondary"]')?.addEventListener('click', () => n.secondary.onClick());
    this.now.querySelector('[data-action="now-more"]')?.addEventListener('click', (e) => this.openDrawer({ title: n.readMore.title, render: n.readMore.render, trigger: e.currentTarget }));
    this.now.querySelector('[data-action="now-toggle"]').addEventListener('click', () => this.setPanelHidden(this.nowExpanded));
    if (q) {
      for (const b of this.now.querySelectorAll('[data-choice]')) {
        b.addEventListener('click', () => {
          const r = q.onAnswer(b.dataset.choice) || {};
          const fb = this.now.querySelector('.v3-feedback');
          fb.textContent = r.feedback || '';
          fb.dataset.correct = r.correct ? 'true' : 'false';
          b.dataset.result = r.correct ? 'correct' : 'incorrect';
          b.setAttribute('aria-pressed', 'true');
        });
      }
    }
    this.now.hidden = false;
    this.setNowExpanded(!this.panelHidden);
  }

  /** Words the Now card shows (the ui-audit instruction-length gate counts the same text). */
  nowWords() { return countWords(this.now.innerText); }

  setNowExpanded(on) {
    this.nowExpanded = Boolean(on);
    this.now.dataset.expanded = this.nowExpanded ? 'true' : 'false';
    this.now.querySelector('[data-action="now-toggle"]')?.setAttribute('aria-expanded', String(this.nowExpanded));
  }

  /**
   * The learner's "Hide panel" choice (menu or peek button), saved per slug:
   * the Now card stays a one-line peek until they show it again. Gestures
   * (a drag on the phone scene) collapse it without saving.
   */
  setPanelHidden(on) {
    this.panelHidden = Boolean(on);
    this._setPref('hide-panel', this.panelHidden ? 'on' : 'off');
    this.menu.querySelector('[data-action="hide-panel"]').textContent = this.panelHidden ? 'Show panel' : 'Hide panel';
    if (this.now.querySelector('[data-action="now-toggle"]')) this.setNowExpanded(!this.panelHidden);
  }

  // ---------- drawer ----------
  /**
   * @param {object} d
   * @param {string} d.title   the drawer's one name: the buttons that open it use the same words
   *   ("Open the field notebook" opens "Field notebook"); a dev warning names any mismatch
   * @param {(el: HTMLElement) => void} d.render
   * @param {HTMLElement} [d.trigger]  focus returns here on close
   * @param {string} [d.key]
   * @param {() => void} [d.onClose]  called once when this drawer closes (✕, Esc, closeDrawer or
   *   another drawer replacing it), e.g. to finish a "read this" step without a button at the bottom
   */
  openDrawer({ title, render, trigger = null, key = null, onClose = null }) {
    this._finishDrawer();
    this._drawerOnClose = onClose;
    const said = (trigger?.innerText || trigger?.textContent || '').trim();
    if (said && !drawerNamed(said, title)) console.warn(`Drawer "${title}" is opened by "${said}": use one name for a drawer.`);
    this.drawerKey = key;
    this.drawer.querySelector('#v3-drawer-title').textContent = title;
    const body = this.drawer.querySelector('.v3-drawer-body');
    body.innerHTML = '';
    this.drawer.hidden = false;
    this.root.dataset.drawerOpen = 'true';
    this._drawerTrigger = trigger;
    render(body);
    // Always start at the top (heading, intro, first item), also when the
    // content is rebuilt while open (the observer below).
    body.scrollTop = 0;
    if (trigger) this.drawer.querySelector('#v3-drawer-title').focus({ preventScroll: true });
    this._watchDrawer(body);
    announce(`${title} opened`);
    this._emit('drawer', true, key);
  }

  /** Scroll the drawer back to the top whenever its top-level content is replaced. */
  _watchDrawer(body) {
    if (this._drawerObs || typeof MutationObserver === 'undefined') return;
    this._drawerObs = new MutationObserver((list) => {
      if (list.some((m) => m.removedNodes.length)) body.scrollTop = 0; // content replaced, not only added to
    });
    this._drawerObs.observe(body, { childList: true });
  }

  closeDrawer() {
    if (this.drawer.hidden) return false;
    this.drawer.hidden = true;
    this.drawerKey = null;
    this.root.dataset.drawerOpen = 'false';
    this._drawerTrigger?.focus?.();
    this._drawerTrigger = null;
    this._finishDrawer();
    this._emit('drawer', false, null);
    return true;
  }

  _finishDrawer() { const f = this._drawerOnClose; this._drawerOnClose = null; f?.(); }

  /**
   * Show the learner a result that just appeared in the drawer (a debrief, a
   * saved message): scroll it into view and move focus to it, so a press that
   * adds content below the fold visibly does something.
   * @param {HTMLElement} el
   */
  revealInDrawer(el) {
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    el.scrollIntoView?.({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }

  // ---------- title, chapter, toast ----------
  showTitle({ title, kicker = '', oneLiner = '', startLabel = 'Start', onStart }) {
    this.titleScreen.innerHTML = `
      <div class="v3-title-inner">
        ${kicker ? `<p class="v3-title-kicker">${esc(kicker)}</p>` : ''}
        <h1 id="v3-title-h" class="v3-display">${esc(title)}</h1>
        <p class="v3-title-line">${esc(oneLiner)}</p>
        <div class="v3-title-actions">
          <button type="button" class="v3-btn v3-primary" data-action="title-start">${esc(startLabel)}</button>
          <button type="button" class="v3-btn" data-action="title-text">Use text mode</button>
        </div>
      </div>`;
    this.titleScreen.hidden = false;
    this.setPhase('title');
    this.titleScreen.querySelector('[data-action="title-start"]').addEventListener('click', () => { this.hideTitle(); onStart?.(); });
    this.titleScreen.querySelector('[data-action="title-text"]').addEventListener('click', () => { this.hideTitle(); onStart?.({ text: true }); this.toggleTextMode(true); });
  }

  hideTitle() {
    if (this.titleScreen.hidden) return;
    this.titleScreen.hidden = true;
    if (this.phase === 'title') this.setPhase('explore');
  }

  /** Chapter card for ~1.6 s (tap or Esc dismisses it sooner). */
  showChapter(kicker, title, ms = 1600) {
    clearTimeout(this._chapterT);
    this.chapter.innerHTML = `<p class="v3-chapter-kicker">${esc(kicker)}</p><p class="v3-chapter-title">${esc(title)}</p>`;
    this.chapter.hidden = false;
    this.setPhase('chapter');
    return new Promise((resolve) => {
      const done = () => { clearTimeout(this._chapterT); if (this.chapter.hidden) return; this.chapter.hidden = true; if (this.phase === 'chapter') this.setPhase('explore'); this._chapterDone = null; resolve(); };
      this._chapterDone = done;
      this._chapterT = setTimeout(done, ms);
    });
  }

  toast(text, ms = 2600) {
    const t = document.createElement('p');
    t.className = 'v3-toast';
    t.dataset.ui = 'toast';
    t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 2) this.toasts.firstElementChild.remove();
    setTimeout(() => t.remove(), ms);
  }

  // ---------- legend and controls help ----------
  /** @param {{ label: string, text: string }[]} items  every in-world cue and marker, by its userData.marker label */
  setLegend(items) {
    this.legend.innerHTML = items.length ? items.map((i) => `<li><strong>${esc(i.label)}</strong>: ${esc(i.text)}</li>`).join('') : '<li>No markers in this scene.</li>';
  }

  setControlsHelp(extra = []) {
    const rows = [
      ['Look around', 'Drag the scene. Keys: Q and E turn, R and F tilt.'],
      ...(this.walkable ? [['Walk', 'W A S D or the arrow keys. On touch: the joystick.']] : []),
      ['Zoom', 'Mouse wheel, pinch, or + and -.'],
      ['Pan', 'Right-drag, Shift + drag, or two fingers.'],
      ['Fly to a spot', 'Double-click or double-tap the ground.'],
      ['Inspect', 'Click or tap an object. Esc closes its card.'],
      ['All labels', 'Hold Alt or L, or turn on Show all labels in the menu.'],
      ['Keyboard list', 'Menu, then Objects in view. Tab to an object, Enter opens it.'],
      ['This help', 'Press ? at any time.'],
      ...extra,
    ];
    this.controls.querySelector('.v3-controls-body').innerHTML = `<dl class="v3-keys">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }

  openControls(trigger) { if (this.menu.open) closeDialog(this.menu); openDialog(this.controls, trigger || document.activeElement); }

  // ---------- text mode ----------
  /** @param {(el: HTMLElement) => void} render  fills text mode with the same content and decisions as the scene */
  setTextModeRenderer(render) { this._textRender = render; if (!this.textModeRoot.hidden) this._renderText(); }
  _renderText() { this.textModeRoot.innerHTML = ''; this._textRender?.(this.textModeRoot); }

  toggleTextMode(force) {
    const on = force ?? this.textModeRoot.hidden;
    if (on) this._renderText();
    this.textModeRoot.hidden = !on;
    this.canvas.style.visibility = on ? 'hidden' : 'visible';
    this.root.dataset.text = on ? 'on' : 'off';
    this.menu.querySelector('[data-action="textmode"]').setAttribute('aria-pressed', String(on));
    if (on) { if (this.menu.open) closeDialog(this.menu); this.textModeRoot.focus(); }
    announce(on ? 'Text mode on' : 'Text mode off');
    this._emit('textmode', on);
    return on;
  }

  // ---------- camera cluster / joystick ----------
  bindRig(rig) {
    this.rig = rig;
    const act = { left: () => rig.orbitBy(0.25, 0), right: () => rig.orbitBy(-0.25, 0), up: () => rig.orbitBy(0, -0.15), down: () => rig.orbitBy(0, 0.15), in: () => rig.zoomBy(0.8), out: () => rig.zoomBy(1.25), reset: () => rig.resetView() };
    this.cluster.addEventListener('click', (e) => { const b = e.target.closest('[data-cam]'); if (b) act[b.dataset.cam](); });
  }

  _applyCluster() {
    const on = this.touch || this.cameraControls;
    this.cluster.hidden = !on;
    this.joystick.hidden = !(this.touch && this.walkable);
    this.menu?.querySelector('[data-action="camera-controls"]')?.setAttribute('aria-pressed', String(Boolean(on)));
  }

  // ---------- preferences ----------
  _prefs() {
    const get = (k) => { try { return localStorage.getItem(`${this.slug}:${k}`); } catch { return null; } };
    this.cameraControls = get('camera-controls') === 'on';
    if (get('plain-font') === 'on') document.documentElement.dataset.plainFont = 'on';
    this.menu.querySelector('[data-action="plain-font"]').setAttribute('aria-pressed', String(document.documentElement.dataset.plainFont === 'on'));
    this.panelHidden = get('hide-panel') === 'on';
    this.menu.querySelector('[data-action="hide-panel"]').textContent = this.panelHidden ? 'Show panel' : 'Hide panel';
  }
  _setPref(k, v) { try { localStorage.setItem(`${this.slug}:${k}`, v); } catch { /* ignore */ } }

  /** Reflect the inspect system's "Show all labels" state on the menu toggle. */
  setShowAllPressed(on) { this.menu.querySelector('[data-action="show-labels"]').setAttribute('aria-pressed', String(Boolean(on))); }

  // ---------- events ----------
  _bind() {
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const a = b.dataset.action;
      if (a === 'menu') openDialog(this.menu, b);
      else if (a === 'menu-close') closeDialog(this.menu);
      else if (a === 'controls') this.openControls(this.root.querySelector('[data-action="menu"]'));
      else if (a === 'controls-close') closeDialog(this.controls);
      else if (a === 'drawer-close') this.closeDrawer();
      else if (a === 'textmode') this.toggleTextMode();
      else if (a === 'plain-font') {
        const on = document.documentElement.dataset.plainFont !== 'on';
        document.documentElement.dataset.plainFont = on ? 'on' : 'off';
        b.setAttribute('aria-pressed', String(on));
        this._setPref('plain-font', on ? 'on' : 'off');
      } else if (a === 'camera-controls') {
        this.cameraControls = !this.cameraControls;
        this._setPref('camera-controls', this.cameraControls ? 'on' : 'off');
        this._applyCluster();
      } else if (a === 'hide-panel') {
        if (this.menu.open) closeDialog(this.menu);
        this.setPanelHidden(!this.panelHidden);
        announce(this.panelHidden ? 'Panel hidden. Open it again from the Menu or its one-line bar.' : 'Panel shown');
      } else if (['objects', 'journal', 'practice', 'show-labels', 'settings', 'progress', 'back-to-start'].includes(a)) {
        if (this.menu.open && a !== 'show-labels') closeDialog(this.menu);
      }
      this._emit(`action:${a}`, b);
    });
    this.now.addEventListener('pointerdown', (e) => { this._swipe = { y: e.clientY, t: performance.now() }; });
    this.now.addEventListener('pointerup', (e) => {
      if (!this._swipe || this.layout !== 'phone-portrait') return;
      const dy = e.clientY - this._swipe.y;
      if (Math.abs(dy) > 36) this.setNowExpanded(dy < 0);
      this._swipe = null;
    });
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (e.key === 'Escape') {
        if (document.querySelector('dialog[open]')) return; // native dialogs close themselves
        if (this._chapterDone) { this._chapterDone(); return; }
        if (!this.drawer.hidden) { this.closeDrawer(); return; }
        for (const h of this._escape) if (h.fn()) return;
      }
      if (e.key === '?' && !typing && !document.querySelector('dialog[open]')) { e.preventDefault(); this.openControls(); }
    });
    this.chapter.addEventListener('click', () => this._chapterDone?.());
    addEventListener('resize', () => this._layout());
    // Drag on the scene collapses the phone Now card so the view is free.
    this.canvas.addEventListener('pointerdown', () => { if (this.layout === 'phone-portrait' && this.phase === 'explore') this.setNowExpanded(false); });
  }
}
