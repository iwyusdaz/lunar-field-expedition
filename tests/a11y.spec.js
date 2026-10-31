/**
 * axe-core checks (0 critical or serious) on the v3 states: title, practice,
 * orbit, surface modules, an open info card, the objects list, the traverse
 * planner and the field report in the drawer, the menu, and text mode.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ready } from './helpers.js';

async function scan(page, label) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => ['critical', 'serious'].includes(v.impact));
  expect(bad.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('axe: 0 critical/serious on every v3 state', async ({ page }) => {
  test.setTimeout(400_000);
  await page.addInitScript(() => localStorage.clear());
  await ready(page);
  await scan(page, 'title');
  await page.getByRole('button', { name: /^start$/i }).click();
  await scan(page, 'practice');
  await page.getByRole('button', { name: /skip practice/i }).click();
  await page.waitForTimeout(1200);
  await scan(page, 'm1 orbit');
  await page.evaluate(() => window.__TEST__.inspect.open('moon-globe'));
  await page.waitForTimeout(800);
  await scan(page, 'info card');
  await page.keyboard.press('Escape');
  for (const i of [1, 2, 3, 4]) {
    await page.evaluate((n) => window.__TEST__.app.goModule(n), i);
    await page.waitForTimeout(2200);
    await scan(page, `m${i + 1}`);
  }
  await page.evaluate(() => window.__TEST__.app.goModule(3));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__TEST__.lessons._openPlanner());
  await page.waitForTimeout(1200);
  await scan(page, 'planner drawer');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__TEST__.app.goModule(4));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const L = window.__TEST__.lessons; window.__TEST__.shell.openDrawer({ title: 'Field report', render: (b) => L._cer(b) }); });
  await page.waitForTimeout(600);
  await scan(page, 'report drawer');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="menu"]').click();
  await scan(page, 'menu');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__TEST__.ui.toggleTextMode());
  await page.waitForTimeout(1200);
  await scan(page, 'text mode');
});
