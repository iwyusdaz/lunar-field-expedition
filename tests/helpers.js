/** Shared helpers for the v3 browser tests (test-hooks build). */

// Software WebGL is slow: functional tests force the Low preset (test-hooks builds only).
export async function ready(page, path = '/?preset=low') {
  await page.goto(path);
  await page.waitForFunction(() => window.__TEST__ && window.__APP_READY__, null, { timeout: 60_000 });
}

/** Jump straight to a module (skips title and practice) and wait for the chapter card and flight. */
export async function toModule(page, i) {
  await page.evaluate((n) => window.__TEST__.app.goModule(n), i);
  await page.waitForTimeout(2200);
}

/** Ids of the in-world labels that are visible now. */
export function visibleLabels(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-ui="world-label"]')]
    .filter((e) => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    .map((e) => e.dataset.objectId));
}

/** A screen point on the canvas where the inspect pick returns `id` (null when not on screen). */
export function pointOn(page, id) {
  return page.evaluate((oid) => {
    const T = window.__TEST__;
    const s = T.inspect._screenBox(T.inspect.items.get(oid));
    if (!s) return null;
    for (let gy = 2; gy < 10; gy++) for (let gx = 2; gx < 9; gx++) {
      const x = s.left + ((s.right - s.left) * gx) / 10, y = s.top + ((s.bottom - s.top) * gy) / 10;
      if (document.elementFromPoint(x, y)?.id !== 'app') continue;
      if (T.inspect.pick(x, y) === oid) return { x, y };
    }
    return null;
  }, id);
}
