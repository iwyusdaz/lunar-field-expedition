/**
 * v3 browser tests (headless Chromium, software WebGL, Low preset): the
 * scene-first shell on the lunar scenes, the clickable world, keyboard-only
 * completion of all five modules, text-mode parity, reduced motion, touch, and
 * the no-WebGL fallback. GPU gates (performance, alive) run headed in ui-audit.
 */
import { test, expect } from '@playwright/test';
import { ready, visibleLabels, pointOn } from './helpers.js';

const T = (page, fn, arg) => page.evaluate(fn, arg);

/** Press Tab until `locator` has focus (the real keyboard path), then press `key`. */
async function kb(page, locator, key = "Enter", max = 250) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  await expect(el).toBeVisible();
  for (let i = 0; i < max; i++) {
    // 0: focused; 1: focus is before the target (Tab); -1: after it (Shift+Tab)
    const where = await el.evaluate((e) => { const a = document.activeElement; if (a === e) return 0; if (!a || a === document.body) return 1; return a.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1; });
    if (where === 0) { await page.keyboard.press(key); return; }
    await page.keyboard.press(where > 0 ? 'Tab' : 'Shift+Tab');
  }
  throw new Error(`could not reach ${locator} by Tab`);
}
const now = (page, re) => page.locator('[data-ui="now-card"] button').filter({ hasText: re }).first();
const drawer = (page) => page.locator('[data-ui="drawer"]');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('kept')) { localStorage.clear(); sessionStorage.setItem('kept', '1'); } });
});

test('title, practice in orbit, then Module 1 in orbit with the landing-site glint', async ({ page }) => {
  await ready(page);
  await expect(page.locator('[data-ui="title-screen"]')).toBeVisible();
  await page.getByRole('button', { name: /^start$/i }).click();
  await expect(page.locator('[data-ui="now-card"]')).toContainText(/Practice 1 of 4/);
  // Practice 3 (review F5): only Mare Imbrium (outlined and named) advances it.
  await T(page, () => { const o = window.__TEST__.app.onboarding; o.i = 2; o._show(); });
  await expect(page.locator('[data-ui="now-card"]')).toContainText('Click the Mare Imbrium');
  expect(await T(page, () => window.__TEST__.inspect.cued)).toBe('mare-imbrium');
  await T(page, () => window.__TEST__.inspect.open('moon-globe'));
  await expect(page.locator('[data-ui="now-card"]')).toContainText('Practice 3 of 4');
  await T(page, () => { window.__TEST__.inspect.close(); window.__TEST__.inspect.open('mare-imbrium'); });
  await expect(page.locator('[data-ui="now-card"]')).toContainText('Practice 4 of 4');
  await page.getByRole('button', { name: /skip practice/i }).click();
  await expect(page.locator('[data-ui="now-card"]')).toContainText('Find the landing site');
  const s = await T(page, () => ({ scene: window.__TEST__.lessons.sceneName, ids: window.__TEST__.inspect.ids(), legend: document.querySelector('[data-ui="legend"]').textContent }));
  expect(s.scene).toBe('orbit');
  expect(s.ids.sort()).toEqual(['mare-imbrium', 'moon-globe', 'terminator']);
  expect(s.legend).toMatch(/Landing site glint/);
});

test('labels are hidden at rest; hover shows one; a click opens the card beside the object', async ({ page }) => {
  await ready(page);
  await T(page, () => window.__TEST__.app.goModule(0));
  await page.waitForTimeout(2500);
  expect(await visibleLabels(page)).toEqual([]);
  const p = await pointOn(page, 'moon-globe');
  expect(p).not.toBeNull();
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(600);
  expect(await visibleLabels(page)).toContain('moon-globe');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('[data-ui="info-card"][data-object-id="moon-globe"]')).toBeVisible();
  await expect(page.locator('[data-ui="discovered"]')).toContainText('1 of 35');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-ui="info-card"]')).toBeHidden();
});

test('landing streams the surface; every surface object is in the keyboard list and opens by Enter', async ({ page }) => {
  await ready(page);
  await T(page, () => window.__TEST__.app.goModule(0));
  await page.waitForTimeout(1500);
  await now(page, /Land at Hadley/).click();
  await page.waitForFunction(() => window.__TEST__.scene.surface.streamed.leaves.size > 0 && window.__TEST__.inspect.ids().length === 32, null, { timeout: 120_000 });
  const ids = await T(page, () => window.__TEST__.inspect.ids());
  expect(ids.length).toBe(32);
  await page.locator('[data-action="menu"]').click();
  await page.locator('[data-ui="objects-list-toggle"]').click();
  const list = page.locator('[data-ui="objects-list"] [data-object-id]');
  await expect(list).toHaveCount(32);
  await list.filter({ hasText: 'Lunar Module descent stage' }).focus();
  await page.waitForTimeout(400);
  expect(await visibleLabels(page)).toContain('lm-descent-stage');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-ui="info-card"][data-object-id="lm-descent-stage"]')).toBeVisible();
  // Sky bodies frame by turning the camera (and narrowing the view), never by flying into space.
  await page.keyboard.press('Escape');
  await T(page, () => window.__TEST__.inspect.open('earth'));
  await page.waitForTimeout(1500);
  const fov = await T(page, () => window.__TEST__.engine.camera.fov);
  expect(fov).toBeLessThan(10);
  // Closing the card (the objects list reopened behind it closes first) restores the field of view.
  await T(page, () => window.__TEST__.shell.closeDrawer());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-ui="info-card"]')).toBeHidden();
  expect(await T(page, () => window.__TEST__.engine.camera.fov)).toBeCloseTo(60, 0);
});

test('keyboard-only completion of all five modules', async ({ page }) => {
  test.setTimeout(1_200_000);
  await ready(page);
  await kb(page, page.getByRole('button', { name: /^start$/i }));
  await kb(page, page.getByRole('button', { name: /skip practice/i }));
  // Module 1
  await kb(page, now(page, /Land at Hadley/));
  await kb(page, now(page, /Start the pre-check/));
  for (let q = 0; q < 5; q++) {
    await kb(page, page.locator('[data-ui="now-card"] [data-choice]').first());
    await kb(page, now(page, q < 4 ? /Next question/ : /Finish the pre-check/));
  }
  // Module 2: the Sun slider by arrow keys, then the four landforms, then a profile.
  await expect(page.locator('[data-ui="now-card"]')).toContainText('See how sunlight');
  await kb(page, page.locator('[data-ui="now-card"] input[type="range"]'), 'ArrowRight');
  await kb(page, now(page, /Next step/));
  for (let f = 0; f < 4; f++) {
    for (let c = 0; c < 3; c++) {
      const choices = page.locator('[data-ui="now-card"] [data-choice]');
      if (!(await choices.count())) break;
      await kb(page, choices.nth(c));
      await page.waitForTimeout(400);
      if (await page.locator('[data-ui="now-card"] .v3-feedback[data-correct="true"]').count()) { await page.waitForTimeout(2200); break; }
    }
  }
  await kb(page, now(page, /Next step/));
  await kb(page, now(page, /Rille crossing/));
  await kb(page, now(page, /Next module/));
  // Module 3
  await kb(page, now(page, /Start counting/));
  await kb(page, now(page, /Submit counts/));
  await kb(page, now(page, /See the results/));
  await expect(drawer(page)).toContainText('Computer count');
  await page.keyboard.press('Escape');
  await kb(page, now(page, /Next step/));
  await kb(page, page.locator('[data-ui="now-card"] [data-choice="a"]'));
  await kb(page, now(page, /Next step/));
  // Step 4 asks which clock to trust (review F8): an answer, then Next module.
  await kb(page, page.locator('[data-ui="now-card"] [data-choice="b"]'));
  await kb(page, now(page, /Next module/));
  // Module 4: question, planner in the drawer (stations, drive, stops), debrief
  await kb(page, page.locator('[data-ui="now-card"] [data-choice="h-front"]'));
  await kb(page, now(page, /Next step/));
  await kb(page, now(page, /Open the traverse planner/));
  for (const name of [/Spur/, /Dune/]) await kb(page, drawer(page).locator('.tp-add').filter({ hasText: name }));
  await kb(page, drawer(page).locator('.tp-drive'));
  for (let i = 0; i < 4; i++) {
    const b = drawer(page).locator('.station-card .btn').last();
    if (!(await b.count()) || !(await b.isVisible())) break;
    await kb(page, b);
    if (await drawer(page).locator('.tp-debrief').isVisible()) break;
  }
  await expect(drawer(page).locator('.tp-debrief')).toBeVisible();
  await page.keyboard.press('Escape');
  await kb(page, now(page, /Next step/));
  await kb(page, now(page, /Next module/));
  // Module 5: notebook, report, self-check, comparison, post-check
  await kb(page, now(page, /Open the field notebook/));
  await kb(page, drawer(page).getByRole('button', { name: /I have reviewed it/ }));
  await kb(page, now(page, /Next step/));
  await kb(page, now(page, /Write the report/));
  for (const cb of await drawer(page).locator('input[type="checkbox"]').all()) await kb(page, cb, 'Space');
  for (const ta of await drawer(page).locator('textarea').all()) {
    await kb(page, ta, 'End');
    await page.keyboard.type('The Front rocks are older than the mare lavas, because the lavas lap against the Front and the Front samples are about 3.9 billion years old while the mare basalts are about 3.3 billion years old.');
  }
  await kb(page, drawer(page).getByRole('button', { name: /Save report/ }));
  await expect(drawer(page)).toBeHidden({ timeout: 5000 });
  await kb(page, now(page, /Next step/));
  await kb(page, now(page, /Open the self-check/));
  // A radio group takes one Tab stop; arrow keys move within it (native behaviour).
  for (const fs of await drawer(page).locator('.rubric-selfcheck fieldset').all()) {
    await kb(page, fs.locator('input[type="radio"]').first(), 'Space');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  }
  await kb(page, drawer(page).getByRole('button', { name: /Finish self-check/ }));
  await kb(page, now(page, /Next step/));
  await kb(page, now(page, /Read the comparison/));
  await kb(page, drawer(page).getByRole('button', { name: /Done reading/ }));
  await kb(page, now(page, /Next step/));
  for (let q = 0; q < 5; q++) {
    await kb(page, page.locator('[data-ui="now-card"] [data-choice]').first());
    await kb(page, now(page, q < 4 ? /Next question/ : /Finish the post-check/));
  }
  await expect(page.locator('[data-ui="now-card"]')).toContainText('Expedition complete');
  const st = await T(page, () => ({ done: [...window.__TEST__.shell.done].sort(), report: window.__TEST__.lessons.state.state.report?.citedTags?.length, post: window.__TEST__.lessons.state.state.postCheck?.total }));
  expect(st.done).toEqual([0, 1, 2, 3, 4]);
  expect(st.report).toBeGreaterThan(0);
  expect(st.post).toBe(5);
  expect(await T(page, () => Object.values(window.__TEST__.lessons.state.state.report.selfCheck))).toEqual([2, 2, 2, 2]);
});

test('text mode: every module renders, every catalog object is listed, decisions write the same state', async ({ page }) => {
  await ready(page);
  await T(page, () => window.__TEST__.app.goModule(2));
  await page.waitForTimeout(1500);
  await T(page, () => window.__TEST__.ui.toggleTextMode());
  const tm = page.locator('#textmode');
  await expect(tm).toContainText('Crater size-frequency tables');
  const names = await T(page, () => window.__TEST__.catalog.objects.map((o) => o.name));
  const text = await tm.innerText();
  for (const n of names) expect(text).toContain(n);
  const fs = tm.locator('fieldset', { hasText: /Which is younger/ });
  await fs.getByRole('radio', { name: /mare lavas: they lie against/i }).check();
  await fs.getByRole('button', { name: /Submit answer/ }).click();
  await page.waitForTimeout(300);
  expect(await T(page, () => window.__TEST__.lessons.state.state.decisions['m3-superposition'])).toBe('a');
  const fc = tm.locator('fieldset', { hasText: /Which clock do you trust/ });
  await fc.getByRole('radio', { name: /Rock samples for the Front/i }).check();
  await fc.getByRole('button', { name: /Submit answer/ }).click();
  await page.waitForTimeout(300);
  expect(await T(page, () => window.__TEST__.lessons.state.state.decisions['m3-debrief'])).toBe('b');
  expect(await T(page, () => window.__TEST__.shell.done.has(2))).toBe(true);
  for (const [i, re] of [[0, /Pre-check/], [1, /Elevation profiles as data tables/], [3, /traverse planner/i], [4, /Field report/]]) {
    await T(page, (n) => window.__TEST__.app.goModule(n), i);
    await page.waitForTimeout(1200);
    await expect(tm).toContainText(re);
  }
});

test('reduced motion stops the sun time-lapse, the rover and the crew', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await T(page, () => window.__TEST__.app.goModule(4));
  await page.waitForTimeout(2500);
  const snap = () => T(page, () => { const s = window.__TEST__.scene.surface; return [s.rover.position.x, s.crewB.root.position.x, s.sky.hourAngle, s.sky.earthSpin]; });
  const a = await snap();
  await page.waitForTimeout(2000);
  expect(await snap()).toEqual(a);
  expect(await T(page, () => window.__TEST__.motion.factor)).toBe(0);
});

test('card hold: the rover and the walking geologist stay in their inspect frame (review F2)', async ({ page }) => {
  await ready(page);
  await T(page, () => window.__TEST__.app.goModule(4));
  await page.waitForTimeout(3000);
  await T(page, () => window.__TEST__.inspect.open('lrv'));
  const pos = () => T(page, () => window.__TEST__.scene.surface.rover.position.toArray());
  const a = await pos();
  await page.waitForTimeout(1500);
  expect(await pos()).toEqual(a);
  await T(page, () => { const T2 = window.__TEST__; T2.inspect.close({ restore: false }); T2.inspect.open('field-crew', { root: T2.scene.surface.crewB.root }); });
  const it = await T(page, () => window.__TEST__.inspect.items.get('field-crew').active.name);
  expect(it).toBe('crew-b');
  const b = await T(page, () => window.__TEST__.scene.surface.crewB.root.position.toArray());
  await page.waitForTimeout(1500);
  expect(await T(page, () => window.__TEST__.scene.surface.crewB.root.position.toArray())).toEqual(b);
  await T(page, () => window.__TEST__.inspect.close());
  await page.waitForTimeout(1500);
  expect(await pos()).not.toEqual(a);
});
test('Sun time-lapse runs on after every landform card (review pass 2 F1)', async ({ page }) => {
  await ready(page);
  await T(page, () => window.__TEST__.app.goModule(4));
  await page.waitForTimeout(3000);
  const cards = ['craterlets', 'dune-crater', 'mare-plain', 'footprints', 'rover-tracks', 'regolith', 'spur-crater', 'elbow-crater', 'st-george-crater', 'mount-hadley', 'hadley-delta', 'apennine-front'];
  // Each card on its own (open, close), then card to card without closing, then a card left open across a module change.
  for (const id of cards) { await T(page, (x) => window.__TEST__.inspect.open(x), id); await page.waitForTimeout(250); await T(page, () => window.__TEST__.inspect.close()); }
  for (const id of cards) await T(page, (x) => window.__TEST__.inspect.open(x), id);
  await T(page, () => window.__TEST__.inspect.open('lm-descent-stage'));
  await T(page, () => window.__TEST__.inspect.open('hadley-delta'));
  await T(page, () => window.__TEST__.app.goModule(3));
  await page.waitForTimeout(1500);
  await T(page, () => { window.__TEST__.inspect.close(); window.__TEST__.app.goModule(4); });
  await page.waitForTimeout(1500);
  const sun = () => T(page, () => { const s = window.__TEST__.scene.surface; return { e: s.sky.sunElevationDeg, low: s._lowSun, before: s._sunBefore, hold: s.sunHold, held: [...window.__TEST__.motion.held] }; });
  const a = await sun();
  expect(a).toMatchObject({ low: 0, before: null, hold: false, held: [] });
  await page.waitForTimeout(3000);
  const b = await sun();
  expect(b.e).not.toBeCloseTo(a.e, 1);
});

test('motion report: at least eight systems on four layers, every label on a card', async ({ page }) => {
  await ready(page);
  const r = await T(page, () => ({ rep: window.__TEST__.motion.report(), problems: window.__TEST__.motion.checkLabels(window.__TEST__.catalog) }));
  expect(r.rep.ok).toBe(true);
  expect(r.problems).toEqual([]);
});

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('a tap on an object opens its card in the bottom sheet', async ({ page }) => {
    await ready(page);
    await T(page, () => window.__TEST__.app.goModule(0));
    await page.waitForTimeout(2500);
    const p = await pointOn(page, 'moon-globe');
    await page.touchscreen.tap(p.x, p.y);
    await expect(page.locator('[data-ui="info-card"][data-object-id="moon-globe"]')).toBeVisible();
  });
});

test('without WebGL2 the app runs in text mode with every objective', async ({ page }) => {
  await page.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return t === 'webgl2' ? null : g.call(this, t, ...a); }; });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => window.__APP_READY__, null, { timeout: 60_000 });
  await expect(page.locator('#textmode')).toBeVisible();
  await expect(page.locator('#textmode')).toContainText('Pre-check');
  expect(errors).toEqual([]);
});
