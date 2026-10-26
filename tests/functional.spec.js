/**
 * Functional template: module navigation + keyboard playability smoke.
 * Each repo extends this with scripted playthroughs of every path and ending
 * via the test hooks exposed when the build sets VITE_TEST_HOOKS=1.
 */
import { test, expect } from '@playwright/test';

test('menu and settings open by keyboard', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);
  await page.keyboard.press('Tab'); // focus first interactive element
  await page.getByRole('button', { name: 'Menu' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-dialog')).not.toBeVisible();
});

test('all module tabs are reachable and activate by keyboard', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);
  const tabs = page.locator('.module-nav button');
  const count = await tabs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).focus();
    await page.keyboard.press('Enter');
    await expect(tabs.nth(i)).toHaveAttribute('aria-current', 'page');
  }
});
