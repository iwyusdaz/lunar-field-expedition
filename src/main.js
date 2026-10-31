/**
 * Lunar Field Expedition v3 — entry point (plan 10, scene-first revamp).
 * The v3 template shell (src/v3/, synced with _tools/sync-v3-core.mjs) runs the
 * orbit view and the Hadley surface (src/lunar/), the five modules
 * (src/lunar/lessons.js) and the object catalog (content/objects.json).
 */
import './v3/layers.css';
import './v3/type.css';
import './v3/shell.css';
import './styles/case-fonts.css';
import './styles/lunar-v3.css';
import { createSceneApp } from './v3/app.js';
import catalog from '../content/objects.json';
import modules from '../content/modules.json';
import items from '../content/items.json';
import stations from '../content/stations.json';
import cinematics from '../content/cinematics.json';
import report from '../content/report.json';
import features from '../content/features.json';
import craters from '../content/craters.json';
import { Lessons } from './lunar/lessons.js';
import { OrbitScene } from './lunar/orbit.js';
import { SurfaceScene } from './lunar/surface.js';

const SLUG = window.__SLUG__ || 'lunar-field-expedition';
window.__SLUG__ = SLUG;

const lessons = new Lessons({ slug: SLUG, content: { modules, items, stations, cinematics, report, features, craters } });
const mods = lessons.modules();

const app = await createSceneApp({
  slug: SLUG,
  title: 'Lunar Field Expedition',
  shortTitle: 'Lunar Field',
  modules: mods,
  catalog,
  home: { target: [0, 0, 0], radius: 1737400 * 3.1, theta: Math.PI * 0.94, phi: Math.PI * 0.42 },
  walkable: true,
  titleScreen: { kicker: 'Apollo 15 landing site · real NASA terrain', oneLiner: 'Land at Hadley, read the real landscape, and work out which is older: the lava plain or the mountains.' },
  practiceObject: 'mare-imbrium',
  lut: `${import.meta.env.BASE_URL}assets/v3/grade/hadley-ektachrome-33.png`,
  limits: { minRadius: 1737400 * 1.25, maxRadius: 1737400 * 6, minPhi: 0.15, maxPhi: Math.PI - 0.15, minEye: 0, eyeHeight: 0 },
  buildScene: async (a) => {
    const orbit = new OrbitScene(a);
    // The globe as during the Apollo 15 surface stay: Sun about 34 deg up at Hadley
    // (the third EVA; it was 12 deg at landing), so all of Mare Imbrium is in daylight.
    await orbit.load(34);
    a.engine.scene.add(orbit.group);
    const surface = new SurfaceScene(a, { stations: stations.stations, craters });
    await surface.load(lessons._terrainReady);
    await surface.build();
    surface.group.visible = false;
    surface.addMotion(a.motion);
    orbit.addMotion(a.motion);
    lessons.bind(a, { surface, orbit });
    a.scene = { orbit, surface };
    a.lessons = lessons;
    lessons.useScene('orbit');
    // Stream the surface detail after the learner's first interaction (plan §7).
    const first = () => { surface.startStreaming(); for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, first, true); };
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, first, true);
    return { legend: lessons.legend(), update: (dt) => { orbit.update(a.engine.camera); surface.update(dt); } };
  },
});

// The first-run practice happens in orbit: look, zoom, click and close (walking is taught on landing).
if (app.onboarding) {
  const steps = app.onboarding.steps.bind(app.onboarding);
  app.onboarding.steps = () => { const w = app.shell.walkable; app.shell.walkable = false; const s = steps(); app.shell.walkable = w; return s; };
  const start = app.onboarding.start.bind(app.onboarding);
  app.onboarding.start = () => { lessons.useScene('orbit'); app.rig.flyTo(lessons.orbit.view(), 0.6); start(); };
}
if (__TEST_HOOKS__ && window.__TEST__) Object.assign(window.__TEST__, { lessons, scene: app.scene });
window.__app = app;
