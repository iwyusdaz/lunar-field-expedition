/**
 * inspect.js — the clickable world (plan 10 §4.2, owner label rule 2026-10-30).
 *
 * - Labels are hidden at rest. A name label shows while the pointer is over an
 *   object, while it has keyboard focus (the "Objects in view" list), or with
 *   its open card (touch: a tap opens the card directly). Fade ~150 ms; instant
 *   under reduced motion. "Show all labels" (menu, saved) and holding Alt or L
 *   show every label in view; a declutter pass keeps labels from stacking and
 *   hides lower-priority ones when crowded.
 * - Hover/focus: an outline (inverted hull, drawn only while shown). Task
 *   objects get the case's strong highlight; explore objects a subtle one.
 * - Click / Enter: the camera eases to frame the object (>= 35% of the viewport
 *   height) and the info card opens beside it, never over it. Esc, the close
 *   button or a click on empty scene closes it and eases back to the view the
 *   learner had. With several roots under one card (two people, a row of
 *   trees) a click frames the root that was hit. A repo can give an object an
 *   authored view instead (opts.frame.view: a rig view or a function that
 *   returns one) where a box framing would not show what the object is (a
 *   landform, a line, a layer).
 * - setCue(id): a lesson cue (the practice target): outline and name label
 *   stay on until the cue is cleared; emits 'cue'.
 * - Every opened object is recorded in the discovery journal.
 * Scene contract (ui-audit): userData.objectId on each catalog object's root.
 * @module v3/inspect
 */
import * as THREE from 'three';
import { announce } from '../a11y/announcer.js';
import { declutter, placeCard, rect } from './layout-math.js';
import { HONESTY_LABELS } from './catalog.js';

const HULL_VS = /* glsl */`
uniform float uThickness;
uniform vec2 uResolution;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 clip = projectionMatrix * modelViewMatrix * local;
  vec3 vn = normalize(normalMatrix * n);
  vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
  float l = length(dir);
  if (l > 1e-5) clip.xy += (dir / l) * uThickness * clip.w * 2.0 / uResolution;
  gl_Position = clip;
}`;
const HULL_FS = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }`;

const cssVar = (name, fallback) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};

export class InspectSystem {
  /**
   * @param {object} o
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {THREE.Scene} o.scene
   * @param {HTMLCanvasElement} o.canvas
   * @param {import('./camera-rig.js').CameraRig} o.rig
   * @param {ReturnType<import('./catalog.js').createCatalog>} o.catalog
   * @param {import('./journal.js').DiscoveryJournal} o.journal
   * @param {import('./shell.js').SceneShell} o.shell
   * @param {() => boolean} [o.reducedMotion]
   */
  constructor(o) {
    Object.assign(this, { camera: o.camera, scene: o.scene, canvas: o.canvas, rig: o.rig, catalog: o.catalog, journal: o.journal, shell: o.shell });
    this.reducedMotion = o.reducedMotion || (() => false);
    this.items = new Map(); // id -> { id, entry, roots, label, hulls, priority }
    this.roots = [];
    this.hovered = null;
    this.focused = null;
    this.selected = null;
    this.cued = null;
    this.showAll = this._loadShowAll();
    this.holdAll = false;
    this.enabled = true;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.camera = this.camera;
    this._ndc = new THREE.Vector2();
    this._box = new THREE.Box3();
    this._v = new THREE.Vector3();
    this._pointer = null;
    this._labelLayer = this.shell.labelLayer;
    this._listeners = {};
    const accent = new THREE.Color(cssVar('--v3-accent', '#ffb347'));
    this.hullStyles = {
      task: { color: accent.clone().multiplyScalar(1.6), thickness: 3.2, opacity: 1 },
      explore: { color: new THREE.Color(1.4, 1.4, 1.4), thickness: 1.6, opacity: 0.75 },
    };
    this._buildCard();
    this._bind();
    this.shell.onEscape(() => (this.selected ? (this.close(), true) : false), 20);
    this.shell.on('layout', () => this._placeCard(true));
  }

  on(ev, fn) { (this._listeners[ev] ||= new Set()).add(fn); return () => this._listeners[ev].delete(fn); }
  _emit(ev, ...a) { for (const fn of this._listeners[ev] || []) fn(...a); }

  /**
   * Make a catalog object inspectable.
   * @param {string} id               catalog id
   * @param {THREE.Object3D|THREE.Object3D[]} roots  one root, or several copies sharing a card (a row of trees)
   * @param {{ priority?: number, frame?: object }} [opts] priority for label declutter; frame options for rig.frame()
   */
  register(id, roots, opts = {}) {
    const entry = this.catalog.get(id);
    if (!entry) throw new Error(`inspect: "${id}" is not in content/objects.json`);
    const list = [roots].flat();
    for (const r of list) { r.userData.objectId = id; this.roots.push(r); }
    const label = document.createElement('div');
    label.className = `v3-label is-${entry.role}`;
    label.dataset.ui = 'world-label';
    label.dataset.objectId = id;
    label.setAttribute('aria-hidden', 'true');
    label.textContent = entry.name;
    this._labelLayer.appendChild(label);
    const item = { id, entry, roots: list, active: list[0], label, hulls: null, priority: opts.priority ?? (entry.role === 'task' ? 2 : 1), frame: opts.frame || {}, size: null };
    this.items.set(id, item);
    this._emit('change');
    return item;
  }

  unregister(id) {
    const it = this.items.get(id);
    if (!it) return;
    it.label.remove();
    this._setHulls(it, false);
    this.roots = this.roots.filter((r) => !it.roots.includes(r));
    this.items.delete(id);
    if (this.selected === id) this.close({ restore: false });
    if (this.cued === id) this.cued = null;
    this._emit('change');
  }

  clear() { for (const id of [...this.items.keys()]) this.unregister(id); }

  /** Ids registered in the current scene, sorted by name. */
  ids() { return [...this.items.values()].sort((a, b) => a.entry.name.localeCompare(b.entry.name)).map((i) => i.id); }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!on) { this._hover(null); this.focus(null); }
  }

  setShowAll(on) {
    this.showAll = Boolean(on);
    try { localStorage.setItem(`${this.shell.slug}:show-all-labels`, on ? 'on' : 'off'); } catch { /* ignore */ }
    this._emit('show-all', this.showAll);
  }
  _loadShowAll() { try { return localStorage.getItem(`${this.shell.slug}:show-all-labels`) === 'on'; } catch { return false; } }

  /** Keyboard focus from the objects list: label + outline, no camera move. */
  focus(id) {
    const prev = this.focused;
    this.focused = id && this.items.has(id) ? id : null;
    if (prev && prev !== this.focused && !this._keep(prev)) this._setHulls(this.items.get(prev), false);
    if (this.focused) this._setHulls(this.items.get(this.focused), true);
  }

  /** A lesson cue (e.g. the practice target): outline and label stay on until setCue(null). */
  setCue(id) {
    const prev = this.cued;
    this.cued = id && this.items.has(id) ? id : null;
    if (prev && prev !== this.cued && !this._keep(prev)) this._setHulls(this.items.get(prev), false);
    if (this.cued) this._setHulls(this.items.get(this.cued), true);
    if (prev !== this.cued) this._emit('cue', this.cued);
  }

  /** True while something still wants this object's outline (hover, focus, open card, cue). */
  _keep(id) { return id === this.hovered || id === this.focused || id === this.selected || id === this.cued; }

  /** Open an object's card: frame it, record the discovery, place the card beside it. */
  async open(id, { via = 'pointer', trigger = null, onClose = null, root = null } = {}) {
    const it = this.items.get(id);
    if (!it || !this.enabled) return;
    // The root that was clicked (several roots can share one card); else the first.
    it.active = root && it.roots.includes(root) ? root : it.roots[0];
    if (this.selected && this.selected !== id) this._deselect();
    if (!this.selected) this._returnView = this.rig.view();
    this.selected = id;
    this._trigger = trigger;
    this._onClose = onClose;
    this._setHulls(it, true);
    this._fillCard(it.entry);
    this.shell.setCardOpen(true);
    this.card.hidden = false;
    this._placeCard(true);
    const first = this.journal.discover(id);
    if (first) this.shell.toast(`Discovered: ${it.entry.name} (${this.journal.count} of ${this.journal.total})`);
    announce(`${it.entry.name}. ${it.entry.short}`);
    if (via === 'keyboard') this.card.querySelector('[data-action="card-close"]').focus();
    this._emit('open', id, via);
    this._userMoved = false;
    const lay = this.shell.layout;
    const frameOpts = lay === 'phone-portrait' ? { offsetX: 0, offsetY: 0.36, heightFrac: 0.4, maxWidthFrac: 0.8 }
      : lay === 'phone-landscape' ? { offsetX: -0.32, offsetY: -0.05, heightFrac: 0.45, maxWidthFrac: 0.45 }
        : { offsetX: -0.24, offsetY: -0.02, heightFrac: 0.45, maxWidthFrac: 0.4 };
    // Authored view: { eye, center, fov? } (the camera at eye, center beside the
    // card) or a plain rig view; a function gets the layout name.
    const view = typeof it.frame.view === 'function' ? it.frame.view(lay) : it.frame.view;
    if (view) {
      const v = view.eye ? this.rig.viewFrom(view.eye, view.center, { offsetX: frameOpts.offsetX, offsetY: frameOpts.offsetY, fov: view.fov }) : view;
      await this.rig.flyTo(v, it.frame.duration ?? 0.9);
      return;
    }
    this._box.setFromObject(it.active);
    await this.rig.frame(this._box, { ...frameOpts, ...it.frame });
  }

  close({ restore = true } = {}) {
    if (!this.selected) return;
    const id = this.selected;
    this._deselect();
    this.card.hidden = true;
    this.shell.setCardOpen(false);
    if (restore && this._returnView && !this._userMoved) this.rig.flyTo(this._returnView, 0.35);
    this._returnView = null;
    const after = this._onClose;
    this._onClose = null;
    if (after) after(id); else this._trigger?.focus?.();
    this._trigger = null;
    this._emit('close', id);
  }

  _deselect() {
    const it = this.items.get(this.selected);
    this.selected = null;
    if (it && !this._keep(it.id)) this._setHulls(it, false);
  }

  /** Object under a screen point: ray first, then (for small objects) the screen box. */
  pick(x, y) { return this.pickHit(x, y)?.id || null; }

  /** Like pick(), with the registered root that was hit: { id, root } or null. */
  pickHit(x, y) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.roots, true);
    for (const h of hits) {
      if (!this._visibleChain(h.object)) continue;
      for (let p = h.object; p; p = p.parent) if (p.userData?.objectId && this.items.has(p.userData.objectId)) return { id: p.userData.objectId, root: this.items.get(p.userData.objectId).roots.includes(p) ? p : null };
    }
    // Thin or small objects (poles, tools) are hard to hit exactly: accept a
    // click inside their on-screen box when nothing registered was hit.
    let best = null;
    const vw = r.width, vh = r.height;
    for (const it of this.items.values()) for (const root of it.roots) {
      const s = this._screenBox(it, root);
      if (!s || (s.right - s.left) * (s.bottom - s.top) > 0.06 * vw * vh) continue;
      const m = 8;
      if (x >= s.left - m && x <= s.right + m && y >= s.top - m && y <= s.bottom + m) {
        // Nearest box centre, relative to the box size: a click in the middle of
        // one object's box wins over the edge of a neighbour's.
        const w = Math.max(8, s.right - s.left), h = Math.max(8, s.bottom - s.top);
        const d = Math.max(Math.abs(x - (s.left + s.right) / 2) / w, Math.abs(y - (s.top + s.bottom) / 2) / h);
        if (!best || d < best.d) best = { id: it.id, root, d };
      }
    }
    return best ? { id: best.id, root: best.root } : null;
  }

  _visibleChain(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

  /** Projected screen box of an object (CSS px), or null when off screen / behind. */
  _screenBox(it, root = it.active || it.roots[0]) {
    if (!this._visibleChain(root)) return null;
    this._box.setFromObject(root);
    if (this._box.isEmpty()) return null;
    const r = this.canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    const b = this._box;
    for (let i = 0; i < 8; i++) {
      this._v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camera);
      if (this._v.z < -1 || this._v.z > 1) continue;
      any = true;
      const sx = r.left + (this._v.x + 1) / 2 * r.width, sy = r.top + (1 - this._v.y) / 2 * r.height;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    if (!any || x1 < r.left || x0 > r.right || y1 < r.top || y0 > r.bottom) return null;
    return { left: x0, top: y0, right: x1, bottom: y1 };
  }

  _hover(id) {
    if (id === this.hovered) return;
    const prev = this.hovered;
    this.hovered = id;
    if (prev && !this._keep(prev)) this._setHulls(this.items.get(prev), false);
    if (id) this._setHulls(this.items.get(id), true);
    this.canvas.style.cursor = id ? 'pointer' : '';
  }

  /** Outline hulls: built on first use, shown only while the object is hovered, focused or open. */
  _setHulls(it, on) {
    if (!it) return;
    if (on && !it.hulls) {
      const st = this.hullStyles[it.entry.role] || this.hullStyles.explore;
      const mat = new THREE.ShaderMaterial({
        vertexShader: HULL_VS, fragmentShader: HULL_FS, side: THREE.BackSide, transparent: st.opacity < 1, depthWrite: false,
        uniforms: { uThickness: { value: st.thickness }, uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) }, uColor: { value: st.color }, uOpacity: { value: st.opacity } },
      });
      it.hulls = [];
      for (const root of it.roots) {
        const meshes = [];
        // Flat meshes (a decal slab, a ground patch) get no hull: an inverted hull
        // of a sheet draws its underside as a filled sheet, not an outline.
        const flat = (m) => { const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox(); const s = g.boundingBox.getSize(this._v); return Math.min(s.x, s.y, s.z) < 0.03 * Math.max(s.x, s.y, s.z); };
        root.traverse((m) => { if (m.isMesh && !m.isSkinnedMesh && m.geometry?.attributes?.normal && !m.userData.noOutline && !flat(m)) meshes.push(m); });
        for (const m of meshes) {
          const h = m.isInstancedMesh ? new THREE.InstancedMesh(m.geometry, mat, m.count) : new THREE.Mesh(m.geometry, mat);
          if (m.isInstancedMesh) h.instanceMatrix = m.instanceMatrix;
          h.raycast = () => {};
          h.userData.noOutline = true;
          h.userData.outlineHull = true;
          h.castShadow = false; h.receiveShadow = false;
          h.renderOrder = 2;
          h.visible = false;
          m.add(h);
          it.hulls.push(h);
        }
      }
      it.hullMat = mat;
    }
    if (it.hulls) {
      it.hullMat?.uniforms.uResolution.value.set(innerWidth, innerHeight);
      for (const h of it.hulls) h.visible = on;
    }
  }

  _bind() {
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this._pointer = { x: e.clientX, y: e.clientY }; });
    this.canvas.addEventListener('pointerleave', () => { this._pointer = null; this._hover(null); });
    this.rig.on('tap', (x, y) => {
      if (!this.enabled) return;
      const hit = this.pickHit(x, y);
      if (hit) this.open(hit.id, { via: 'pointer', root: hit.root });
      else if (this.selected) this.close();
    });
    this.rig.on('drag', () => { if (this.selected) this._userMoved = true; });
    const holdKey = (e) => e.key === 'Alt' || (e.key && e.key.toLowerCase() === 'l' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || ''));
    window.addEventListener('keydown', (e) => { if (holdKey(e) && !e.repeat) { this.holdAll = true; if (e.key === 'Alt') e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (holdKey(e)) this.holdAll = false; });
    window.addEventListener('blur', () => { this.holdAll = false; });
  }

  _buildCard() {
    const c = document.createElement('section');
    c.className = 'v3-info-card';
    c.dataset.ui = 'info-card';
    c.setAttribute('role', 'dialog');
    c.setAttribute('aria-modal', 'false');
    c.setAttribute('aria-labelledby', 'v3-card-title');
    c.hidden = true;
    c.innerHTML = `
      <div class="v3-card-head"><p class="v3-tag" data-card="tag"></p>
        <button type="button" class="v3-icon-btn" data-action="card-close" aria-label="Close card">✕</button></div>
      <h2 id="v3-card-title" data-card="name"></h2>
      <div class="v3-card-body">
        <p data-card="short"></p>
        <p data-card="more" hidden></p>
        <p data-card="why" class="v3-why"></p>
      </div>
      <div class="v3-card-actions">
        <button type="button" class="v3-btn" data-action="card-more" aria-expanded="false">Read more</button>
        <a data-card="source" target="_blank" rel="noopener">Source</a>
      </div>`;
    this.shell.cardLayer.appendChild(c);
    c.querySelector('[data-action="card-close"]').addEventListener('click', () => this.close());
    const more = c.querySelector('[data-action="card-more"]');
    more.addEventListener('click', () => {
      const p = c.querySelector('[data-card="more"]');
      p.hidden = !p.hidden;
      more.setAttribute('aria-expanded', String(!p.hidden));
      more.textContent = p.hidden ? 'Read more' : 'Show less';
      this._placeCard(true);
    });
    this.card = c;
  }

  _fillCard(e) {
    const c = this.card;
    c.dataset.objectId = e.id;
    c.dataset.role = e.role;
    c.querySelector('[data-card="tag"]').textContent = `${HONESTY_LABELS[e.honesty] || e.honesty} · ${e.role === 'task' ? 'Task object' : 'To explore'}`;
    c.querySelector('[data-card="name"]').textContent = e.name;
    c.querySelector('[data-card="short"]').textContent = e.short;
    const more = c.querySelector('[data-card="more"]');
    more.textContent = e.more;
    more.hidden = true;
    const btn = c.querySelector('[data-action="card-more"]');
    btn.textContent = 'Read more';
    btn.setAttribute('aria-expanded', 'false');
    btn.hidden = !e.more;
    const why = c.querySelector('[data-card="why"]');
    why.textContent = e.whyItMatters ? `Why it matters: ${e.whyItMatters}` : '';
    why.hidden = !e.whyItMatters;
    const src = c.querySelector('[data-card="source"]');
    src.hidden = !e.source;
    if (e.source) src.href = e.source;
    c.querySelector('.v3-card-body').scrollTop = 0;
  }

  /** Desktop: beside the object; phones: the CSS bottom/side sheet. */
  _placeCard(force = false) {
    if (!this.selected || this.card.hidden) return;
    if (this.shell.layout !== 'desktop') { this.card.style.transform = ''; return; }
    const it = this.items.get(this.selected);
    const s = this._screenBox(it);
    const w = this.card.offsetWidth, h = this.card.offsetHeight;
    const vw = innerWidth, vh = innerHeight, top = this.shell.topBarHeight();
    const obj = s || { left: vw * 0.3, top: vh * 0.3, right: vw * 0.45, bottom: vh * 0.6 };
    const p = placeCard(obj, { w, h }, rect(12, top + 12, vw - 24, vh - top - 24), this.shell.reservedRects({ exclude: 'card' }));
    if (!force && this._cardPos && Math.abs(this._cardPos.x - p.x) < 2 && Math.abs(this._cardPos.y - p.y) < 2) return;
    this._cardPos = p;
    this.card.style.transform = `translate(${p.x}px, ${p.y}px)`;
    this.card.dataset.side = p.side;
  }

  /** Per frame: hover pick, labels with declutter, card position. */
  update() {
    if (this.enabled && this._pointer && !document.querySelector('dialog[open]')) this._hover(this.pick(this._pointer.x, this._pointer.y));
    else if (!this._pointer) this._hover(null);
    const all = this.showAll || this.holdAll;
    const want = [];
    for (const it of this.items.values()) {
      const forced = this._keep(it.id);
      if (!forced && !all) continue;
      if (!this.enabled && !forced) continue;
      const s = this._screenBox(it);
      if (!s) continue;
      if (!it.size || it.size.text !== it.label.textContent) {
        it.label.classList.add('is-measuring');
        it.size = { w: it.label.offsetWidth || 120, h: it.label.offsetHeight || 30, text: it.label.textContent };
        it.label.classList.remove('is-measuring');
      }
      want.push({ id: it.id, x: (s.left + s.right) / 2, y: s.top, w: it.size.w, h: it.size.h, priority: it.priority, forced });
    }
    const top = this.shell.topBarHeight();
    const placed = declutter(want, { bounds: rect(0, top, innerWidth, innerHeight - top), reserved: this.shell.reservedRects() });
    for (const it of this.items.values()) {
      const p = placed.get(it.id);
      const on = !!p?.visible && this.shell.phase !== 'cinematic';
      it.label.classList.toggle('is-on', on);
      if (on) it.label.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
    if (this.selected) this._placeCard();
    this.labelsShown = [...placed.values()].filter((p) => p.visible).length;
  }
}

/**
 * Objects list (keyboard and screen-reader parity, plan 10 §4.2): one button per
 * object in the current scene. Focus shows the label and outline; Enter opens
 * the card. Discovered objects carry a tick.
 */
export function renderObjectsList(container, inspect, journal, onOpen = (id, via, b) => inspect.open(id, { via, trigger: b })) {
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'v3-objects-list';
  ul.dataset.ui = 'objects-list';
  for (const id of inspect.ids()) {
    const e = inspect.items.get(id).entry;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'v3-list-btn';
    b.dataset.objectId = id;
    const found = journal.has(id);
    b.innerHTML = `<span class="v3-list-name"></span><span class="v3-list-meta"></span>`;
    b.querySelector('.v3-list-name').textContent = e.name;
    b.querySelector('.v3-list-meta').textContent = `${e.role === 'task' ? 'Task' : 'Explore'}${found ? ' · found ✓' : ''}`;
    b.addEventListener('focus', () => inspect.focus(id));
    b.addEventListener('blur', () => inspect.focus(null));
    b.addEventListener('click', (ev) => onOpen(id, ev.detail === 0 ? 'keyboard' : 'pointer', b));
    li.appendChild(b);
    ul.appendChild(li);
  }
  container.appendChild(ul);
  return ul;
}

/**
 * A task cue that stays visible at rest (plan 10 §4.2: lesson-critical cues
 * stay; only their text labels follow the hover rule): a soft glint sprite above
 * the object, labelled for the legend (ui-audit abstract-marker gate).
 * @returns {THREE.Sprite}
 */
export function createGlint(label, { color = '#fff2c4', size = 0.5 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(32, 4); g.lineTo(32, 60); g.moveTo(4, 32); g.lineTo(60, 32); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }));
  s.scale.setScalar(size);
  s.userData.marker = { label };
  s.userData.noOutline = true;
  s.raycast = () => {};
  return s;
}
