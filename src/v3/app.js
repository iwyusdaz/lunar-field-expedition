/**
 * app.js — wires the v3 template together for a repo: shell, engine (render
 * chain + preset auto-pick), camera rig, inspect system, catalog and journal,
 * motion layers, onboarding, cinematics, settings, progress, text mode and the
 * VITE_TEST_HOOKS test hooks (ui-audit contract).
 *
 * Without WebGL2 (or when the renderer cannot start) the app runs sceneless:
 * no engine, rig, inspect or motion; text mode opens with the module content
 * and the catalog, and every objective works there (plan 00, text-mode parity).
 *
 *   const app = await createSceneApp({ slug, title, modules, catalog, buildScene, home });
 *
 * A repo supplies its scene (buildScene registers objects and motion systems)
 * and its modules (camera view, Now card, text-mode content). See README.md.
 * @module v3/app
 */
import { EngineV3 } from './engine.js';
import { SceneShell } from './shell.js';
import { CameraRig, bindJoystick } from './camera-rig.js';
import { InspectSystem, renderObjectsList } from './inspect.js';
import * as THREE from 'three';
import { createCatalog, checkSceneScale } from './catalog.js';
import { DiscoveryJournal } from './journal.js';
import { MotionLayerManager } from './motion-layers.js';
import { Onboarding } from './onboarding.js';
import { CinematicV3 } from './cinematic.js';
import { renderCatalogText, renderJournal } from './catalog-views.js';
import { MotionPrefs } from '../a11y/motion.js';
import { Settings } from '../ui/settings.js';
import { ProgressPage } from '../ui/progress.js';
import { LearningRecord } from '../learning/record.js';
import { hasWebGL2 } from '../core/assets.js';

/**
 * @typedef {object} ModuleDef
 * @property {string} id
 * @property {string} label                          stepper label
 * @property {{ target: number[], radius: number, theta: number, phi: number }} view
 * @property {(app: object) => object} now           Now card spec (shell.setNow)
 * @property {(el: HTMLElement, app: object) => void} text  text-mode content with the same decisions
 * @property {boolean} [calm]                        calm mode during this module's task
 * @property {(app: object) => void} [enter]
 */

/**
 * @param {object} o
 * @param {string} o.slug
 * @param {string} o.title  @param {string} [o.shortTitle]
 * @param {ModuleDef[]} o.modules
 * @param {object} o.catalog                         raw content/objects.json
 * @param {(app: object) => Promise<object>|object} o.buildScene  returns { groundHeight?, colliders?, bounds?, legend?, update? }
 * @param {{ target: number[], radius: number, theta: number, phi: number }} o.home
 * @param {boolean} [o.walkable=true]
 * @param {{ kicker?: string, oneLiner: string }} o.titleScreen
 * @param {string} [o.practiceObject]
 * @param {object} [o.cinematic]                     { id, title, shots } for the "Watch" button
 * @param {string} [o.lut]                           URL of the case LUT strip
 * @param {object} [o.limits]                        camera rig limits
 * @param {number} [o.exposure]
 */
export async function createSceneApp(o) {
  const shell = new SceneShell({ slug: o.slug, title: o.title, shortTitle: o.shortTitle, modules: o.modules.map((m) => m.label), walkable: o.walkable });
  const motionPrefs = new MotionPrefs(o.slug);
  const syncMotionAttr = () => { document.documentElement.dataset.motion = motionPrefs.reduced ? 'reduced' : 'full'; };
  syncMotionAttr();
  // Test-hooks builds accept ?preset=low|medium|high|ultra (headless functional tests run on Low).
  const forcedPreset = __TEST_HOOKS__ ? new URLSearchParams(location.search).get('preset') || undefined : undefined;
  let engine = null;
  if (hasWebGL2()) {
    try { engine = new EngineV3(shell.canvas, { slug: o.slug, exposure: o.exposure, preset: forcedPreset }); }
    catch (e) { console.warn('3D view not started, using text mode:', e.message); }
  }
  const sceneless = !engine;
  if (o.lut && engine) engine.chain.loadLut(o.lut).catch((e) => console.warn('LUT not loaded:', e.message));
  const catalog = createCatalog(o.catalog, { strict: import.meta.env?.DEV || __TEST_HOOKS__ });
  const journal = new DiscoveryJournal({ slug: o.slug, catalog });
  shell.bindJournal(journal);
  const record = new LearningRecord(o.slug);
  let motion = null, rig = null, inspect = null;
  if (!sceneless) {
    motion = new MotionLayerManager({ reducedMotion: motionPrefs.reduced });
    rig = new CameraRig({ camera: engine.camera, dom: shell.canvas, home: o.home, walkable: o.walkable, limits: o.limits, reducedMotion: () => motionPrefs.reduced });
    shell.bindRig(rig);
    bindJoystick(shell.joystick, rig);
    inspect = new InspectSystem({ camera: engine.camera, scene: engine.scene, canvas: shell.canvas, rig, catalog, journal, shell, reducedMotion: () => motionPrefs.reduced });
    shell.setShowAllPressed(inspect.showAll);
    // Card hold (motion-layers.js): what the open card frames stops moving out of
    // the frame. Synced from inspect.selected every frame (below), so a hold can
    // never outlive its card whichever way the card closed.
  } else {
    // Only text mode exists: hide the menu items that need the 3D view.
    for (const a of ['practice', 'show-labels', 'camera-controls', 'hide-panel', 'textmode']) shell.menu.querySelector(`[data-action="${a}"]`).closest('li').hidden = true;
  }
  motionPrefs.onChange((r) => { motion?.setReducedMotion(r); syncMotionAttr(); });

  const app = { slug: o.slug, shell, engine, rig, inspect, catalog, journal, motion, motionPrefs, record, modules: o.modules, module: -1, sceneless };

  // Scene
  let player = null;
  if (!sceneless) {
    const scene = (await o.buildScene(app)) || {};
    if (scene.groundHeight) rig.groundHeight = scene.groundHeight;
    if (scene.colliders) rig.colliders = scene.colliders;
    if (scene.bounds) rig.bounds = scene.bounds;
    shell.setLegend(scene.legend || []);
    rig.apply();
    engine.onUpdate((dt, t) => {
      rig.update(dt);
      if ((motion.held.values().next().value ?? null) !== inspect.selected) motion.setHeld(inspect.selected ? [inspect.selected] : []);
      motion.update(dt);
      scene.update?.(dt, t, app);
      inspect.update();
    });

    // Double-click / double-tap a surface to fly there (plan 10 §9). Objects
    // keep their click (the card); the sky and see-through effects
    // (depthWrite off: clouds, smoke, glints) are not surfaces.
    const flyRay = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const visible = (ob) => { for (let p = ob; p; p = p.parent) if (!p.visible) return false; return true; };
    const isSurface = (ob) => ob.isMesh && !ob.userData.outlineHull && [ob.material].flat()[0]?.depthWrite !== false && visible(ob);
    rig.on('dbltap', (x, y) => {
      if (!inspect.enabled || inspect.pick(x, y)) return;
      const r = shell.canvas.getBoundingClientRect();
      flyRay.setFromCamera(ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), engine.camera);
      const hit = flyRay.intersectObjects(engine.scene.children, true).find((h) => isSurface(h.object));
      if (!hit) return;
      for (let p = hit.object; p; p = p.parent) if (p.userData?.objectId) return;
      inspect.close({ restore: false });
      rig.flyToPoint(hit.point);
    });

    // Cinematic ("Watch" buttons call app.playCinematic)
    player = new CinematicV3({ shell, camera: engine.camera, motion: motionPrefs, pause: [rig, inspect], onSkip: (id) => record.log('experienced', { id: `cinematic-${id}`, name: 'Cinematic (skipped)' }) });
  }
  // Repos hook shot effects and the end of a shot here (player.onProgress, player.onFinish).
  app.player = player;
  app.playCinematic = (def = o.cinematic) => { if (!def || !player) return; inspect.close({ restore: false }); shell.closeDrawer(); player.load(def); player.play(); };

  // Dialogs. Settings restores the saved text size, contrast and field of view now.
  const settings = new Settings({
    slug: o.slug, dialog: shell.settingsDialog, quality: engine?.quality, motion: motionPrefs,
    onFov: (fov) => {
      if (!engine) return;
      rig.setBaseFov(fov); // during an inspect zoom the setting applies when the zoom ends
      inspect._placeCard(true);
    },
  });
  settings._apply();
  app.settings = settings;
  const progress = new ProgressPage({ slug: o.slug, dialog: shell.progressDialog, record });
  shell.on('action:settings', (b) => settings.open(b));
  shell.on('action:progress', (b) => progress.open(b));
  shell.on('action:show-labels', () => { inspect.setShowAll(!inspect.showAll); shell.setShowAllPressed(inspect.showAll); });

  // Drawers: objects list (keyboard parity) and journal
  const openObjects = (focusId = null, trigger = null) => {
    shell.openDrawer({
      title: 'Objects in view',
      key: 'objects',
      trigger,
      render: (body) => {
        body.insertAdjacentHTML('beforeend', '<p class="v3-hint">Tab to an object to see it in the scene. Press Enter to open its card.</p>');
        const ul = renderObjectsList(body, inspect, journal, (id, via, btn) => {
          shell.closeDrawer();
          inspect.open(id, { via, onClose: () => openObjects(id) });
          void btn;
        });
        if (focusId) ul.querySelector(`[data-object-id="${CSS.escape(focusId)}"]`)?.focus();
      },
    });
  };
  app.openObjects = openObjects;
  // Sceneless: the text-mode page already lists every object.
  shell.on('action:objects', () => {
    if (!sceneless) { openObjects(null, shell.root.querySelector('[data-action="menu"]')); return; }
    const h = shell.textModeRoot.querySelector('#v3-tm-objects-h');
    if (h) { h.tabIndex = -1; h.focus(); }
  });
  // Reading mode (engine.setReading): a lighter render while a drawer is open.
  shell.on('drawer', (open) => engine?.setReading(open));
  shell.on('action:journal', () => shell.openDrawer({ title: 'Discovery journal', key: 'journal', trigger: shell.root.querySelector('[data-action="menu"]'), render: (b) => renderJournal(b, journal) }));
  inspect?.on('change', () => { if (shell.drawerKey === 'objects') openObjects(); });

  // Modules
  const goModule = (i, { fly = true } = {}) => {
    const m = o.modules[i];
    if (!m) return;
    if (onboarding?.active) onboarding.finish(true);
    shell.hideTitle();
    shell.closeDrawer();
    app.module = i;
    shell.setModule(i);
    if (sceneless) {
      shell.setTextModeRenderer(renderText);
      record.log('experienced', { id: m.id, name: m.label });
      return;
    }
    rig.attract = false;
    inspect.close({ restore: false });
    motion.setCalm(Boolean(m.calm));
    if (fly) rig.flyTo(m.view, 1.2);
    m.enter?.(app);
    shell.setNow(m.now(app));
    if (!shell.textModeRoot.hidden) shell.setTextModeRenderer(renderText);
    record.log('experienced', { id: m.id, name: m.label });
    shell.showChapter(`Module ${i + 1} of ${o.modules.length}`, m.label);
  };
  app.goModule = goModule;
  app.completeModule = (i = app.module) => {
    shell.setModuleDone(i, true);
    record.log('completed', { id: o.modules[i].id, name: o.modules[i].label });
    if (i + 1 < o.modules.length) goModule(i + 1);
  };
  shell.on('module', (i) => goModule(i));

  // Onboarding (first run) and title screen
  const onboarding = sceneless ? null : new Onboarding({ shell, rig, inspect, practiceObject: o.practiceObject, onFinish: () => goModule(0, { fly: true }) });
  app.onboarding = onboarding;
  shell.on('action:practice', () => { if (!onboarding) return; inspect.close({ restore: false }); shell.hideTitle(); onboarding.start(); });

  // Text mode: the current module's content, then every catalog object.
  const renderText = (el) => {
    const wrap = document.createElement('div');
    wrap.className = 'v3-tm';
    const m = o.modules[Math.max(0, app.module)];
    const h = document.createElement('h2');
    h.textContent = `${o.title}: text mode`;
    const nav = document.createElement('p');
    nav.innerHTML = '<a href="/">All projects</a>';
    wrap.append(h, nav);
    const sec = document.createElement('section');
    sec.setAttribute('aria-label', m.label);
    const h3 = document.createElement('h3');
    h3.textContent = `Module ${Math.max(0, app.module) + 1}: ${m.label}`;
    sec.append(h3);
    m.text(sec, app);
    wrap.append(sec);
    renderCatalogText(wrap, catalog, journal);
    el.append(wrap);
  };
  shell.setTextModeRenderer(renderText);

  if (sceneless) {
    goModule(0);
    shell.toggleTextMode(true);
    shell.toast('3D is not available in this browser. Every objective works here in text mode.', 8000);
    if (__TEST_HOOKS__) window.__TEST__ = { engine, shell, app, journal, catalog, record, ui: { toggleTextMode: () => shell.toggleTextMode() } };
    window.__APP_READY__ = true;
    return app;
  }

  shell.showTitle({
    title: o.title,
    kicker: o.titleScreen.kicker,
    oneLiner: o.titleScreen.oneLiner,
    onStart: (opt) => {
      rig.attract = false;
      if (opt?.text) { goModule(0, { fly: false }); return; }
      if (!onboarding.done) onboarding.start(); else goModule(0);
    },
  });
  rig.attract = true;

  if (__TEST_HOOKS__) {
    window.__TEST__ = { engine, shell, app, inspect, rig, motion, journal, catalog, record, player, ui: { toggleTextMode: () => shell.toggleTextMode() }, scaleReport: () => checkSceneScale(catalog, engine.scene, THREE, undefined, { camera: engine.camera }) };
  }
  window.__APP_READY__ = true;
  engine.start();
  return app;
}
