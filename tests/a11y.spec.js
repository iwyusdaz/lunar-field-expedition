/**
 * Accessibility: axe on the HTML overlay (menus, HUD, dialogs, text mode).
 * Gate: zero critical or serious issues (push gate in CI).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('overlay UI has no critical or serious axe issues', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas, [data-webgl-fallback]').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500); // let the menu/HUD settle

  const scan = async (label) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('canvas')
      .analyze();
    const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    if (bad.length) console.log(`axe violations (${label}):`, JSON.stringify(bad, null, 2));
    expect(bad, label).toEqual([]);
  };

  await scan('initial view');

  // Settings dialog
  await page.getByRole('button', { name: 'Settings' }).click();
  await scan('settings dialog');
  await page.keyboard.press('Escape');

  // Menu dialog
  await page.getByRole('button', { name: 'Menu' }).click();
  await scan('menu dialog');
  await page.keyboard.press('Escape');

  // Text mode
  await page.getByRole('button', { name: /text mode/i }).first().click();
  await scan('text mode');

  // My progress dialog (from text mode the header is still present)
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'My progress' }).click();
  await scan('progress dialog');

  // Tool-heavy task states (hooks available in the test build only)
  if (await page.evaluate(() => Boolean(window.__TEST__))) {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#task-panel h2', { timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__TEST__.hooks.showModule('m2'));
    await page.waitForTimeout(900);
    await scan('module 2 (sun tool)');
    await page.evaluate(() => {
      const s = window.__TEST__.state.state;
      for (const id of ['m2-sun']) s.completed.push(id);
      window.__TEST__.state.save();
      window.__TEST__.hooks.showModule('m3');
    });
    await page.waitForTimeout(900);
    await scan('module 3 (crater counter)');
    await page.evaluate(() => {
      const s = window.__TEST__.state.state;
      for (const id of ['m3-count', 'm3-superposition', 'm3-debrief', 'm4-hypothesis']) s.completed.push(id);
      window.__TEST__.state.save();
      window.__TEST__.hooks.showModule('m4');
    });
    await page.waitForTimeout(1200);
    await scan('module 4 (traverse planner)');
    // text-mode parity state for module 3 (data tables)
    await page.getByRole('button', { name: 'Text mode' }).first().click();
    await scan('text mode (module 4 planner)');
  }
});

test('collapsed HUD drawer: no serious axe issues and nothing focusable left inside it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#task-panel h2', { timeout: 30000 });
  await page.waitForTimeout(1200);
  // Module 2 puts real controls (sun sliders, presets) in the panel
  if (await page.evaluate(() => Boolean(window.__TEST__))) {
    await page.evaluate(() => window.__TEST__.hooks.showModule('m2'));
    await page.waitForTimeout(900);
  }
  expect(await page.locator('#task-panel button, #task-panel input').count()).toBeGreaterThan(0);

  const toggle = page.locator('[data-action="toggle-drawer"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-drawer-collapsed', 'true');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('canvas')
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  if (bad.length) console.log('axe violations (collapsed drawer):', JSON.stringify(bad, null, 2));
  expect(bad, 'collapsed drawer').toEqual([]);

  // Tab through the whole page: focus never lands inside the collapsed panel
  await toggle.focus();
  const total = await page.evaluate(() => document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length);
  const landed = [];
  for (let i = 0; i < total + 5; i++) {
    await page.keyboard.press('Tab');
    const inPanel = await page.evaluate(() => {
      const a = document.activeElement;
      return a && a.closest('#task-panel') ? (a.id || a.textContent.trim().slice(0, 30)) : null;
    });
    if (inPanel) landed.push(inPanel);
  }
  expect(landed).toEqual([]);

  // expanding restores the panel to the tab order and the a11y tree
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => {
    const p = document.getElementById('task-panel');
    return { inert: p.inert, hidden: p.getAttribute('aria-hidden') };
  })).toEqual({ inert: false, hidden: null });
});
