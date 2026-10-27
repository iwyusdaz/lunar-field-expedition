/**
 * Sub-path test (build contract, 08-vercel-deployment.md section 5.6):
 * copy dist/ to tmp/play/<slug>/, serve tmp/, load /play/<slug>/ and check:
 * no failed network requests, no console errors, canvas or WebGL fallback present,
 * text mode opens, "All projects" link points to '/'.
 * Run with: npm run build && npx playwright test tests/sub-path.spec.js
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const SLUG = process.env.SLUG || 'app';
const ROOT = 'tmp';
const DIST = 'dist';
const PLAY_DIR = join(ROOT, 'play', SLUG);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.bin': 'application/octet-stream',
};

let server;
let port = 4180;

test.beforeAll(async () => {
  expect(existsSync(DIST), 'dist/ must exist — run `npm run build` first').toBe(true);
  rmSync(join(ROOT, 'play'), { recursive: true, force: true });
  mkdirSync(PLAY_DIR, { recursive: true });
  cpSync(DIST, PLAY_DIR, { recursive: true });
  server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = urlPath.replace(/^\/+/, '') || 'index.html';
    let file = join(ROOT, rel);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // directory-style URL: try its index.html (e.g. /play/<slug>/)
      const withIndex = join(file, 'index.html');
      if (existsSync(withIndex)) file = withIndex;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(port, resolve));
});

test.afterAll(() => new Promise((r) => server.close(r)));

test('sub-path /play/<slug>/ loads with no failed requests or console errors', async ({ page }) => {
  const failed = [];
  const errors = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.url()} -> ${r.status()}`); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/play/${SLUG}/`, { waitUntil: 'networkidle', timeout: 30_000 });

  expect(failed, `failed requests: ${failed.join('\n')}`).toEqual([]);
  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);

  // Canvas renders (has non-zero size) or the WebGL fallback message is present.
  const canvas = page.locator('canvas');
  const fallback = page.locator('[data-webgl-fallback]');
  const canvasOk = (await canvas.count()) > 0 && ((await canvas.first().boundingBox())?.height ?? 0) > 0;
  expect(canvasOk || (await fallback.count()) > 0).toBe(true);

  // Text mode opens.
  await page.getByRole('button', { name: /text mode/i }).first().click();
  await expect(page.locator('#textmode')).toBeVisible();
  await expect(page.locator('#textmode')).not.toBeEmpty();

  // "All projects" link points to '/'.
  const link = page.getByRole('link', { name: /all projects/i }).first();
  await expect(link).toHaveAttribute('href', '/');
});
