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
});
