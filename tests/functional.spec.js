/**
 * Functional: scripted playthrough of the core path (menu → modules → one full
 * objective per module → assessment), driving the real UI with the __TEST__
 * hooks only where a step needs 3D pointer input (crater marking). Uses the
 * test build (VITE_TEST_HOOKS=1); release builds strip the hooks.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function next(page, text) {
  await page.locator('#task-panel button', { hasText: text }).first().click();
  await page.waitForTimeout(350);
}

async function answerAllChoiceButtons(page) {
  // click the correct option of every pending assessment item (content-driven)
  const items = await page.evaluate(() => window.__TEST__.app.content.items.sets);
  for (let guard = 0; guard < 12; guard++) {
    const pending = page.locator('.assessment-item:not(:has(.feedback))');
    if ((await pending.count()) === 0) break;
    const prompt = await pending.first().locator('h3').innerText();
    const item = [...items.pre, ...items.post].find(i => i.prompt === prompt);
    const correctText = item ? item.options.find(o => o.id === item.correct).text : null;
    if (correctText) {
      await pending.first().locator('.choice-btn', { hasText: correctText.slice(0, 40) }).first().click();
    } else {
      await pending.first().locator('.choice-btn').first().click();
    }
    await page.waitForTimeout(250);
  }
}

test('menu, settings and text mode open from the header', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#task-panel h2', { timeout: 30000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await expect(page.locator('#menu-dialog').getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Text mode' }).first().click();
  await expect(page.locator('#textmode')).toBeVisible();
  await expect(page.locator('#textmode')).not.toBeEmpty();
});

test('scripted playthrough: all five modules to the post-check', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#task-panel h2', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // ---- Module 1: Arrival (objective 1 path + pre-check) ----
  await next(page, 'Descend to the site');
  await page.locator('#task-panel button', { hasText: 'Play the approach' }).click();
  await expect(page.locator('.cinematic-caption')).toBeVisible();
  await page.locator('.cinematic-skip').click();
  await next(page, 'Open the pre-check');
  await answerAllChoiceButtons(page);
  await expect(page.locator('#task-panel')).toContainText('You answered');
  await page.locator('#task-panel button', { hasText: 'Continue to 2. Reading the landscape' }).click();

  // ---- Module 2: Reading the landscape (objectives 1-2) ----
  // sun tool: use a preset (drives the scene light)
  await page.locator('.sun-tool .preset-btn', { hasText: 'First light' }).click();
  await expect(page.locator('#sun-shadow-out')).toHaveText(/9\.\d/);
  await page.locator('#task-panel button', { hasText: 'Continue' }).click();
  await page.waitForTimeout(400);
  // feature tagging: answer each feature with its correct option (from content)
  for (let f = 0; f < 4; f++) {
    const features = await page.evaluate(() => window.__TEST__.app.content.features.features);
    const feat = features[f];
    const correct = feat.options.find(o => o.correct);
    const fieldset = page.locator('#task-panel fieldset', { hasText: feat.name }).first();
    await fieldset.locator('.choice-btn', { hasText: correct.text.slice(0, 40) }).first().click();
    await expect(fieldset.locator('.feedback')).toBeVisible();
  }
  await page.locator('#task-panel button', { hasText: 'Continue to the profile tool' }).click();
  // elevation profile via preset transect (real DTM data + table)
  await page.selectOption('#profile-preset', 'rille-crossing');
  await expect(page.locator('.profile-note')).toContainText(/relief along the line \d+ m/);
  expect(await page.locator('.profile-table tbody tr').count()).toBeGreaterThan(10);
  await page.locator('#task-panel button', { hasText: 'Continue' }).last().click();
  await page.locator('#task-panel button', { hasText: 'Continue to 3. Which is older' }).click();

  // ---- Module 3: Which is older? (objective 3) ----
  // crater counter: mark craters via hook (3D pointer input needs vision),
  // submit, compare densities, reveal the reference count
  await page.evaluate(() => window.__TEST__.hooks.submitCounts(4));
  await expect(page.locator('.cc-results')).toContainText('craters/km');
  await page.locator('.cc-reference').click();
  await expect(page.locator('.cc-reference-panel')).toContainText('erases the crater record');
  await page.locator('#task-panel button', { hasText: 'Continue to superposition' }).click();
  await page.locator('.assessment-item .choice-btn', { hasText: 'The mare lavas' }).click();
  await next(page, 'Continue to the debrief');
  await next(page, 'Continue to the field traverse');
  await page.locator('#task-panel button', { hasText: 'Continue to 4. Field traverse' }).click();

  // ---- Module 4: Field traverse (objective 4) ----
  await next(page, 'Open the planner');
  await page.locator('.tp-stations button', { hasText: 'Elbow crater' }).click();
  await page.locator('.tp-stations button', { hasText: 'St. George crater' }).click();
  await expect(page.locator('#m-time-out')).toContainText(/\d+ \/ 200 min/);
  // choose the sample tool at Elbow (brings mare-material), default at St. George
  await page.getByLabel('Tool to use at Elbow crater').selectOption('sample');
  await expect(page.locator('.tp-budget-note')).toContainText(/Fits the budget/);
  await page.locator('.tp-drive').click();
  for (let i = 0; i < 3; i++) {
    const c = page.locator('.tp-run .station-card button').last();
    if ((await c.count()) === 0) break;
    await c.click();
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.tp-debrief')).toContainText('Traverse quality');
  await next(page, 'Continue to the field report');
  await page.locator('#task-panel button', { hasText: 'Continue to 5. Field report' }).click();

  // ---- Module 5: Field report (objective 5) ----
  await next(page, 'Build the report');
  // evidence collected by the traverse must include the required tags
  await page.locator('#cer-claim').fill('The Apennine Front is older than the mare plain: its rocks date to about 3.9 Ga and the plain lavas lap up against it.');
  await page.locator('#cer-evidence').fill('At St. George, Front breccia samples date to about 3.85-3.9 Ga while mare basalts from Elbow date to about 3.3 Ga. The low-sun view shows the plains lavas embaying the Front rather than cutting it.');
  await page.locator('#cer-reasoning').fill('Superposition gives the field order: the lavas lie against the Front, so the Front came first. The sample ages agree. The crater-density clock cannot be used on the Front itself because steep slopes destroy the crater record.');
  await page.locator('#cer-uncertainty').fill('The crater counts are automated and real counters disagree; a next check is to sample the contact zone directly.');
  await page.evaluate(() => document.querySelectorAll('#task-panel input[type=checkbox]').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change')); }));
  await page.locator('#task-panel button', { hasText: 'Save report' }).click();
  await expect(page.locator('.cer-msg')).toContainText('All required evidence types cited');
  await next(page, 'Continue');
  // rubric self-check: rate every criterion at the top level
  for (const fs of await page.locator('.rubric-selfcheck fieldset').all()) {
    await fs.locator('input[type=radio]').last().check();
  }
  await page.locator('.rubric-selfcheck button', { hasText: 'Finish self-check' }).click();
  await page.waitForTimeout(300);
  await page.locator('#task-panel button', { hasText: 'Continue' }).click();
  // comparison with the real Apollo 15 traverse
  await expect(page.locator('#task-panel table')).toContainText('EVA 2');
  await expect(page.locator('.apollo-photo')).toBeVisible();
  await next(page, 'Finish with the post-check');
  await answerAllChoiceButtons(page);
  await expect(page.locator('#task-panel')).toContainText('Expedition complete');

  // learning record captured the journey; nothing leaves the browser
  const record = await page.evaluate(() => JSON.parse(window.__TEST__.record.toJSON()));
  expect(record.statements.length).toBeGreaterThan(25);
  expect(record.statements.some(s => s.verb.display['en-US'] === 'completed' && s.object.id.includes('m1-precheck'))).toBe(true);
  expect(record.statements.some(s => s.verb.display['en-US'] === 'answered')).toBe(true);
});

test('Module 4 cannot be skipped before driving, and a finished module can be redone', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#task-panel h2', { timeout: 30000 });
  await page.evaluate(() => window.__TEST__.hooks.showModule('m4'));
  await next(page, 'Open the planner');
  await expect(page.locator('.traverse-planner')).toBeVisible();
  // no way on to the report until the plan has been driven
  await expect(page.locator('#task-panel button', { hasText: 'Continue to the field report' })).toHaveCount(0);
  await page.locator('.tp-stations button', { hasText: 'Elbow crater' }).click();
  await page.getByLabel('Tool to use at Elbow crater').selectOption('sample');
  await page.locator('.tp-drive').click();
  for (let i = 0; i < 3; i++) {
    const c = page.locator('.tp-run .station-card button').last();
    if ((await c.count()) === 0) break;
    await c.click();
    await page.waitForTimeout(250);
  }
  await next(page, 'Continue to the field report');
  await expect(page.locator('#task-panel .module-complete')).toBeVisible();
  const before = await page.evaluate(() => window.__TEST__.board.items.filter(e => e.moduleId === 'm4').length);
  expect(before).toBeGreaterThan(0);
  // redo: the planner comes back and the module's evidence is cleared
  await page.locator('#task-panel button', { hasText: 'Redo this module' }).click();
  await next(page, 'Open the planner');
  await expect(page.locator('.traverse-planner')).toBeVisible();
  const after = await page.evaluate(() => ({
    m4: window.__TEST__.board.items.filter(e => e.moduleId === 'm4').length,
    done: window.__TEST__.state.isComplete('m4-plan'),
  }));
  expect(after).toEqual({ m4: 0, done: false });
});

test('POI jumps to the crater patches keep the camera finite', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#task-panel h2', { timeout: 30000 });
  await page.evaluate(() => window.__TEST__.hooks.showModule('m3'));
  for (const poi of ['patch-mare', 'patch-front']) {
    await page.locator(`#poi-wrap [data-poi="${poi}"]`).click();
    const cam = await page.evaluate(() => {
      const c = window.__engine.camera.position;
      const t = window.__TEST__.app.orbit.target;
      return [c.x, c.y, c.z, t.x, t.y, t.z];
    });
    for (const v of cam) expect(Number.isFinite(v)).toBe(true);
  }
});

test('text mode covers all five modules with parity content', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#task-panel h2', { timeout: 30000 });
  await page.getByRole('button', { name: 'Text mode' }).first().click();
  const titles = await page.evaluate(() => window.__TEST__.app.moduleDefs.map(m => m.title));
  for (let i = 0; i < titles.length; i++) {
    await page.locator('.module-nav button').nth(i).click();
    await page.waitForTimeout(700);
    const tm = page.locator('#textmode');
    if ((await tm.isHidden()) || !(await tm.innerText()).length) {
      await page.getByRole('button', { name: 'Text mode' }).first().click();
    }
    await expect(tm).toContainText(/the|The/);
    const len = await page.evaluate(() => document.getElementById('textmode').innerText.length);
    expect(len).toBeGreaterThan(80);
  }
  // m2 text mode: annotated orthoimages + data tables present
  await page.locator('.module-nav button').nth(1).click();
  await page.waitForTimeout(600);
  if (!(await page.locator('#textmode img.ortho').count())) {
    await page.getByRole('button', { name: 'Text mode' }).first().click();
    await page.waitForTimeout(300);
  }
  await expect(page.locator('#textmode img.ortho')).toHaveCount(2);
  expect(await page.locator('#textmode table').count()).toBeGreaterThan(0);
});

test('text mode: Module 4 and Module 5 can be completed, using the hypothesis chosen in text mode', async ({ page }) => {
  test.setTimeout(150000);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#task-panel h2', { timeout: 30000 });
  await page.evaluate(() => window.__TEST__.hooks.showModule('m4'));
  await page.getByRole('button', { name: 'Text mode' }).first().click();
  const tm = page.locator('#textmode');
  await expect(tm.locator('h2.textmode-title')).toHaveText(/4\. Field traverse/);
  // the 3D overlays are hidden and inert while text mode is open
  await expect(page.locator('#task-panel')).toBeHidden();
  await expect(page.locator('#poi-wrap')).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('task-panel').inert)).toBe(true);

  // choose the rille hypothesis and plan a route that answers it
  await tm.getByLabel(/The rille is/).check();
  await tm.locator('.tp-stations button', { hasText: 'Elbow crater' }).click();
  await tm.getByLabel('Tool to use at Elbow crater').selectOption('profile');
  await tm.locator('.tp-stations button', { hasText: 'Hadley Rille rim' }).click();
  await tm.getByLabel('Tool to use at Hadley Rille rim').selectOption('sample');
  await tm.locator('.tp-drive').click();
  for (let i = 0; i < 3; i++) {
    const c = tm.locator('.tp-run .station-card button').last();
    if ((await c.count()) === 0) break;
    await c.click();
    await page.waitForTimeout(200);
  }
  await expect(tm.locator('.textmode-done')).toContainText('Module 4 is complete');
  expect(await page.evaluate(() => window.__TEST__.state.isComplete('m4-plan'))).toBe(true);

  // Module 5 in text mode
  await page.locator('.module-nav button').nth(4).click();
  await page.waitForTimeout(500);
  await expect(tm.locator('h2.textmode-title')).toHaveText(/5\. Field report/);
  await tm.locator('#cer-claim').fill('The rille was cut by lava into the mare plain after its first lava flows had formed and cooled.');
  await tm.locator('#cer-evidence').fill('At the rille rim the basalt is the same plain material, and the Elbow profile shows a steep channel cut down into it, about 280 m deep in our model.');
  await tm.locator('#cer-reasoning').fill('Cross-cutting relations: a feature that cuts a unit is younger than that unit. The channel cuts the plain lavas, so it formed after them.');
  await tm.locator('#cer-uncertainty').fill('Whether it was an open channel or a collapsed lava tube is still debated; samples from the floor would help.');
  await page.evaluate(() => document.querySelectorAll('#textmode input[type=checkbox]').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change')); }));
  const stepPtrBefore = await page.evaluate(() => window.__TEST__.app.stepPtr);
  await tm.locator('button', { hasText: 'Save report' }).click();
  await expect(tm.locator('.cer-msg')).toContainText('All required evidence types cited');
  // the hidden 3D flow did not advance
  expect(await page.evaluate(() => window.__TEST__.app.stepPtr)).toBe(stepPtrBefore);
  for (const fs of await tm.locator('.rubric-selfcheck fieldset').all()) {
    await fs.locator('input[type=radio]').last().check();
  }
  await tm.locator('.rubric-selfcheck button', { hasText: 'Finish self-check' }).click();
  // post-check: answer each item with its correct option
  const post = await page.evaluate(() => window.__TEST__.app.content.items.sets.post);
  for (const item of post) {
    const fs = tm.locator('fieldset', { has: page.locator('legend', { hasText: item.prompt.slice(0, 50) }) }).first();
    const correct = item.options.find(o => o.id === item.correct);
    await fs.getByLabel(correct.text.slice(0, 40)).check();
    await fs.getByRole('button', { name: 'Submit answer' }).click();
  }
  await expect(tm.locator('.textmode-done').last()).toContainText(`You answered ${post.length} of ${post.length}`);
  const st = await page.evaluate(() => window.__TEST__.state.state);
  expect(st.report.hypothesis).toBe('h-rille');
  expect(st.postCheck.correct).toBe(post.length);
  for (const id of ['m5-cer', 'm5-selfcheck', 'm5-postcheck']) expect(st.completed).toContain(id);
  // leaving text mode brings the 3D panel back
  await page.getByRole('button', { name: 'Text mode' }).first().click();
  await expect(page.locator('#task-panel')).toBeVisible();
});

test('reduced motion: cinematic renders as stills with captions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#task-panel h2', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('#task-panel button', { hasText: 'Descend to the site' }).click();
  const stills = page.locator('#task-panel button', { hasText: 'Show the approach (stills)' });
  await expect(stills).toBeVisible();
  await stills.click();
  await expect(page.locator('.cinematic-caption')).toBeVisible();
  await page.locator('.cinematic-skip').click();
});
