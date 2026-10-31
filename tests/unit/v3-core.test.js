/**
 * v3 template core: catalog, scale check, layer registry, journal, motion
 * layers, preset auto-pick, layout maths and the Now-card word limit.
 * Repos keep this file and add their own (catalog and scene-specific) tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as THREE from 'three';
import { validateCatalog, createCatalog, scaleError, checkSceneScale, countWords, angularScaleError, measureObject } from '../../src/v3/catalog.js';
import { findAdHocZIndex, LAYERS } from '../../src/v3/layers.js';
import { DiscoveryJournal } from '../../src/v3/journal.js';
import { MotionLayerManager } from '../../src/v3/motion-layers.js';
import { decidePreset, PresetAutoPick, QualityManagerV3, PRESETS } from '../../src/v3/quality.js';
import { declutter, placeCard, frameDistance, heightFraction, overlap, rect } from '../../src/v3/layout-math.js';

const ROOT = join(import.meta.dirname, '..', '..');
const catalogRaw = JSON.parse(readFileSync(join(ROOT, 'content', 'objects.json'), 'utf8'));

const entry = (o = {}) => ({ id: 'thing', name: 'Thing', short: 'A short line.', more: 'More text.', whyItMatters: '', realSize: 1, honesty: 'real', source: 'https://example.org/x', role: 'explore', ...o });
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('catalog (plan 10 §4.1)', () => {
  it('accepts content/objects.json with at least 20 objects', () => {
    const { errors, objects } = validateCatalog(catalogRaw);
    expect(errors).toEqual([]);
    expect(objects.length).toBeGreaterThanOrEqual(20);
  });

  it('reports each kind of mistake', () => {
    const long = Array.from({ length: 26 }, () => 'word').join(' ');
    const { errors } = validateCatalog([
      entry({ id: 'a', honesty: 'maybe' }),
      entry({ id: 'b', short: long }),
      entry({ id: 'c', realSize: 0 }),
      entry({ id: 'd', source: '' }),
      entry({ id: 'e', role: 'decor' }),
      entry({ id: 'e' }),
      entry({ id: 'f', source: 'ftp://nope' }),
    ]);
    expect(errors.some((e) => e.includes('(a)') && e.includes('honesty'))).toBe(true);
    expect(errors.some((e) => e.includes('(b)') && e.includes('26 words'))).toBe(true);
    expect(errors.some((e) => e.includes('(c)') && e.includes('realSize'))).toBe(true);
    expect(errors.some((e) => e.includes('(d)') && e.includes('fictional'))).toBe(true);
    expect(errors.some((e) => e.includes('(e)') && e.includes('role'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
    expect(errors.some((e) => e.includes('(f)') && e.includes('URL'))).toBe(true);
    expect(validateCatalog([entry({ honesty: 'fictional', source: '' })]).errors).toEqual([]);
  });

  it('throws in strict mode and serves lookups', () => {
    expect(() => createCatalog([entry({ honesty: 'x' })])).toThrow(/problem/);
    const c = createCatalog(catalogRaw);
    expect(c.get('lrv').name).toBe('Lunar Roving Vehicle');
    expect(c.has('nope')).toBe(false);
  });

  it('counts words like ui-audit', () => {
    expect(countWords('Walk with W A S D, then click it.')).toBe(9);
    expect(countWords('4.6 km of the Front’s slope')).toBe(7); // like ui-audit, "4.6" counts as two
  });
});

describe('scale check (plan 10 §4.3)', () => {
  it('compares numbers with the largest side and arrays side by side', () => {
    expect(scaleError([1.8, 0.45, 0.85], 1.8).ok).toBe(true);
    expect(scaleError([2.2, 0.5, 0.5], 1.8).ok).toBe(false);
    expect(scaleError([3.4, 4.4, 3.4], [4.4, 3.4, 3.4]).ok).toBe(true);
    expect(scaleError([4.4, 1.0, 3.4], [4.4, 3.4, 3.4]).ok).toBe(false);
  });

  it('measures objects in a scene by userData.objectId', () => {
    const scene = new THREE.Scene();
    const bench = new THREE.Group();
    bench.userData.objectId = 'thing';
    bench.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.4)));
    scene.add(bench);
    scene.updateMatrixWorld(true);
    const rows = checkSceneScale(createCatalog([entry(), entry({ id: 'missing' })]), scene, THREE);
    expect(rows[0]).toMatchObject({ id: 'thing', ok: true });
    expect(rows[1]).toMatchObject({ id: 'missing', ok: false });
  });
  it('exempts realSize null only with a realSizeNote, and checks sky bodies by angle', () => {
    expect(validateCatalog([entry({ realSize: null })]).errors.join()).toMatch(/realSizeNote/);
    expect(validateCatalog([entry({ realSize: null, realSizeNote: 'a line, not an object' })]).errors).toEqual([]);
    expect(validateCatalog([entry({ realSize: [1, 2, 3], realDistance: 10 })]).errors.join()).toMatch(/single-number/);
    // Earth: 12,742 km at 384,400 km drawn as a 5,966.6 m sphere 180 km away
    expect(angularScaleError(5966.6, 180000, 12742000, 384400000).ok).toBe(true);
    expect(angularScaleError(9000, 180000, 12742000, 384400000).ok).toBe(false);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(); scene.add(cam);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2983.3, 16, 8)); sky.position.set(0, 0, -180000); sky.userData.objectId = 'thing';
    scene.add(sky); scene.updateMatrixWorld(true);
    const rows = checkSceneScale(createCatalog([entry({ realSize: 12742000, realDistance: 384400000 }), entry({ id: 'line', realSize: null, realSizeNote: 'a line' })]), scene, THREE, undefined, { camera: cam });
    expect(rows[0]).toMatchObject({ id: 'thing', ok: true, angular: true });
    expect(rows[1]).toMatchObject({ id: 'line', ok: true, exempt: true });
  });
  it('measures in the object\'s own axes or its rest pose when asked', () => {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1)); g.add(box);
    g.rotation.y = Math.PI / 4; g.updateMatrixWorld(true);
    expect(measureObject(g, THREE).frame).toBe('world');
    expect(measureObject(g, THREE).size[0]).toBeGreaterThan(2.8); // a turned box looks bigger on world axes
    g.userData.scaleFrame = 'local';
    expect(measureObject(g, THREE).size.map((x) => +x.toFixed(2))).toEqual([3, 1, 1]);
    g.userData.restSize = [0.8, 1.9, 0.6];
    expect(measureObject(g, THREE)).toEqual({ size: [0.8, 1.9, 0.6], frame: 'rest pose' });
  });
});

describe('layer registry (plan 10 §2.1)', () => {
  it('flags numeric z-index outside layers.css and accepts tokens', () => {
    expect(findAdHocZIndex('.a { z-index: 5; }\n.b { z-index: var(--z-card); }\n.c { z-index: var(--z-hud, 20) }\n.d { z-index: auto }')).toEqual([{ line: 1, text: '.a { z-index: 5; }' }]);
    expect(findAdHocZIndex('.x { z-index: var(--z-made-up); }')).toHaveLength(1);
    expect(findAdHocZIndex("el.style.zIndex = '30';", 'js')).toHaveLength(1);
    expect(findAdHocZIndex('el.style.zIndex = 0;', 'js')).toHaveLength(0);
  });

  it('layers.css and LAYERS agree', () => {
    const css = readFileSync(join(ROOT, 'src', 'v3', 'layers.css'), 'utf8');
    for (const [k, v] of Object.entries(LAYERS)) expect(css).toContain(`--z-${k}: ${v};`);
  });

  it('no file under src/ sets an ad-hoc z-index', () => {
    const bad = [];
    (function walk(d) {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { if (!f.startsWith('.') && f !== 'node_modules') walk(p); continue; }
        if (p.endsWith(join('v3', 'layers.css')) || p.endsWith(join('v3', 'layers.js'))) continue;
        if (!/\.(css|js)$/.test(f)) continue;
        for (const hit of findAdHocZIndex(readFileSync(p, 'utf8'), f.endsWith('.css') ? 'css' : 'js')) bad.push(`${relative(ROOT, p)}:${hit.line} ${hit.text}`);
      }
    })(join(ROOT, 'src'));
    expect(bad).toEqual([]);
  });
});

describe('discovery journal (plan 10 §4.2)', () => {
  it('records each object once, persists, ignores unknown ids', () => {
    const catalog = createCatalog(catalogRaw);
    const storage = memStorage();
    const j = new DiscoveryJournal({ slug: 't', catalog, storage });
    const seen = [];
    j.onChange((n) => seen.push(n));
    expect(j.discover('lrv')).toBe(true);
    expect(j.discover('lrv')).toBe(false);
    expect(j.discover('not-in-catalog')).toBe(false);
    expect(j.label()).toBe(`Discovered 1 of ${catalog.size}`);
    expect(seen).toEqual([1]);
    const again = new DiscoveryJournal({ slug: 't', catalog, storage });
    expect(again.has('lrv')).toBe(true);
    again.clear();
    expect(new DiscoveryJournal({ slug: 't', catalog, storage }).count).toBe(0);
  });
});

describe('motion layers (plan 10 §5)', () => {
  const sys = (id, layer, extra = {}) => ({ id, layer, label: 'accurate', description: id, update: () => {}, ...extra });

  it('needs >= 8 systems across all four layers', () => {
    const m = new MotionLayerManager({ root: null });
    ['sky', 'environment', 'agents'].forEach((l, i) => m.add(sys(`s${i}`, l)));
    for (let i = 0; i < 5; i++) m.add(sys(`e${i}`, 'environment'));
    let r = m.report();
    expect(r.total).toBe(8);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['objects']);
    m.add(sys('o1', 'objects'));
    r = m.report();
    expect(r.ok).toBe(true);
  });

  it('rejects unknown layers and labels', () => {
    const m = new MotionLayerManager({ root: null });
    expect(() => m.add(sys('x', 'weather'))).toThrow(/layer/);
    expect(() => m.add(sys('y', 'sky', { label: 'fast' }))).toThrow(/label/);
  });

  it('calm slows, reduced motion stops all but essential systems', () => {
    const root = { dataset: {} };
    const m = new MotionLayerManager({ root });
    const got = { a: 0, b: 0 };
    m.add(sys('a', 'sky', { update: (dt) => { got.a += dt; } }));
    m.add(sys('b', 'objects', { essential: true, update: (dt) => { got.b += dt; } }));
    m.setCalm(true);
    expect(root.dataset.calm).toBe('on');
    for (let i = 0; i < 100; i++) m.update(0.02);
    expect(m.factor).toBeGreaterThan(0.25);
    expect(m.factor).toBeLessThan(0.35);
    m.setReducedMotion(true);
    const before = got.a;
    for (let i = 0; i < 10; i++) m.update(0.02);
    expect(got.a).toBe(before);
    expect(got.b).toBeCloseTo(2.2, 5);
  });

  it('time-lapse and illustrative motion must be named on a card', () => {
    const m = new MotionLayerManager({ root: null });
    m.add(sys('sun', 'sky', { label: 'time-lapse', objects: ['sun'] }));
    m.add(sys('walk', 'agents', { label: 'illustrative', objects: ['boulders'] }));
    m.add(sys('bad', 'objects', { label: 'illustrative', objects: [] }));
    const problems = m.checkLabels(createCatalog(catalogRaw));
    expect(problems).toEqual(['bad: illustrative motion names no catalog object']);
  });
});

describe('GPU-time preset auto-pick (plan 10 decision 1)', () => {
  it('steps up only with headroom, reverts over budget, steps down when slow', () => {
    expect(decidePreset('medium', { p50: 3, p95: 6, fps: 60, samples: 150 })).toBe('up');
    expect(decidePreset('medium', { p50: 7, p95: 11, fps: 60, samples: 150 })).toBe('stay');
    expect(decidePreset('high', { p50: 9, p95: 14, fps: 60, samples: 150 }, { verifying: true })).toBe('revert');
    expect(decidePreset('high', { p50: 6, p95: 10, fps: 59, samples: 150 }, { verifying: true })).toBe('stay');
    expect(decidePreset('medium', { p50: 18, p95: 25, fps: 40, samples: 150 })).toBe('down');
    expect(decidePreset('medium', { p50: NaN, p95: NaN, fps: 60, samples: 0 })).toBe('stay');
    expect(decidePreset('ultra', { p50: 2, p95: 3, fps: 60, samples: 150 })).toBe('stay');
  });

  it('runs the benchmark: medium -> high, high over budget -> back to medium', () => {
    const q = new QualityManagerV3({ slug: 'unit' });
    expect(q.name).toBe('medium');
    const costs = { medium: 4, high: 15 };
    const timer = { samples: [], reset() { this.samples = []; } };
    let done = null;
    const pick = new PresetAutoPick(q, timer, { warmMs: 100, sampleMs: 500, onDone: (n, h) => { done = { n, h }; } });
    for (let f = 0; f < 600 && !done; f++) { if (pick.phase === 'sample') timer.samples.push(costs[q.name] * (f % 10 === 0 ? 1.4 : 1)); pick.frame(1 / 60); }
    expect(done.n).toBe('medium');
    expect(done.h.map((s) => s.step)).toEqual(['up', 'revert']);
  });

  it('a preset set by the learner or a tool stops the benchmark', () => {
    const q = new QualityManagerV3({ slug: 'unit2' });
    const pick = new PresetAutoPick(q, { samples: [], reset() {} }, { warmMs: 100 });
    q.set('high');
    pick.frame(0.016);
    expect(pick.phase).toBe('done');
    expect(q.name).toBe('high');
  });

  it('caps the Medium pixel ratio at 1.5 and keeps High at the device ratio', () => {
    const q = new QualityManagerV3({ slug: 'unit3', forced: 'medium' });
    expect(q.pixelRatio(2)).toBe(1.5);
    q._apply('high');
    expect(q.pixelRatio(2)).toBe(2);
    expect(PRESETS.medium.post).toEqual(['tone', 'lut']);
    expect(PRESETS.high.post).toContain('smaa');
  });
});

describe('layout maths (plan 10 §2.2, §4.2, §4.3)', () => {
  it('declutter: no two shown labels overlap; forced labels always show', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, x: 400 + (i % 3) * 10, y: 300, w: 120, h: 28, priority: i % 2 }));
    items.push({ id: 'hovered', x: 405, y: 300, w: 120, h: 28, forced: true, priority: -1 });
    const out = declutter(items, { bounds: rect(0, 56, 1280, 664) });
    const shown = [...out.entries()].filter(([, p]) => p.visible).map(([id, p]) => ({ id, r: rect(p.x, p.y, 120, 28) }));
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(overlap(shown[i].r, shown[j].r)).toBe(0);
    expect(out.get('hovered').visible).toBe(true);
    expect([...out.values()].some((p) => p.crowded)).toBe(true);
  });

  it('placeCard: beside the object, inside the bounds, away from reserved UI', () => {
    const obj = { left: 500, top: 250, right: 640, bottom: 520 };
    const bounds = rect(12, 68, 1256, 640);
    const p = placeCard(obj, { w: 340, h: 380 }, bounds, [{ left: 0, top: 440, right: 450, bottom: 720 }]);
    expect(p.side).toBe('right');
    expect(p.coversObject).toBe(0);
    expect(p.x).toBeGreaterThanOrEqual(640);
    const edge = placeCard({ left: 1000, top: 250, right: 1200, bottom: 500 }, { w: 340, h: 380 }, bounds);
    expect(edge.side).toBe('left');
    expect(edge.x + 340).toBeLessThanOrEqual(1000);
  });

  it('frameDistance: a framed object fills at least 35% of the viewport height', () => {
    for (const size of [{ x: 0.5, y: 1.6, z: 0.25 }, { x: 1.8, y: 0.85, z: 0.45 }, { x: 0.37, y: 0.1, z: 0.37 }]) {
      const d = frameDistance(size, 55, 16 / 9, { heightFrac: 0.45, maxWidthFrac: 0.4 });
      const nearFace = d - Math.min(size.x, size.z) / 2;
      const wFrac = Math.max(size.x, size.z) / (2 * nearFace * Math.tan((55 * Math.PI) / 360) * (16 / 9));
      // Height-limited objects reach the target; wide ones stop at the width limit.
      expect(heightFraction(size.y, nearFace, 55) >= 0.35 || wFrac >= 0.39).toBe(true);
    }
  });
});

// Template demo only (repos replace src/demo/ and test their own Now cards).
if (existsSync(join(ROOT, 'src', 'demo', 'content.js'))) describe('demo Now cards stay within 60 words (plan 10 §2.1)', async () => {
  const demo = '../../src/demo/content.js'; // a variable: repos have no demo, so no static import
  const { modules, windQuestion } = await import(/* @vite-ignore */ demo);
  const app = { shell: { touch: false, setModuleDone() {} }, journal: { has: () => false }, record: { log() {} }, completeModule() {}, playCinematic() {} };
  for (const touch of [false, true]) for (const read of [false, true]) {
    it(`touch=${touch} read=${read}`, () => {
      app.shell.touch = touch;
      app.journal.has = () => read;
      for (const m of modules()) {
        const n = m.now(app);
        const parts = [n.step ? `Step ${n.step} of ${n.total}` : '', n.goal, n.action, n.hint, n.primary?.label, n.secondary?.label, n.readMore ? 'Read more' : '',
          ...(n.question ? [n.question.prompt, ...n.question.choices.map((c) => c.text)] : [])];
        expect(countWords(parts.join(' ')), m.id).toBeLessThanOrEqual(60);
      }
    });
  }
  it('the check question has exactly one right answer', () => {
    const q = windQuestion(app);
    expect(q.choices.filter((c) => q.onAnswer(c.id).correct).map((c) => c.id)).toEqual(['anemometer']);
  });
});

it('ships the case LUT strip and the font licences', () => {
  expect(existsSync(join(ROOT, 'public', 'assets', 'v3', 'grade', 'hadley-ektachrome-33.png'))).toBe(true);
  expect(readFileSync(join(ROOT, 'src', 'v3', 'fonts', 'LICENSE-Inter.txt'), 'utf8')).toMatch(/SIL Open Font License/);
  expect(readFileSync(join(ROOT, 'src', 'styles', 'fonts', 'LICENSE-Jost.txt'), 'utf8')).toMatch(/SIL Open Font License/);
});
