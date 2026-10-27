/**
 * render-poster.mjs — renders the release poster (1200x630, webp + jpg, each
 * <= 200 KB) from the REAL scene (build contract, 08 section 5.3). It loads the
 * production build in headless Chromium, stages the hero shot through the
 * public app handle (window.__app: low sun, camera over the rille toward the
 * mountain front), and screenshots the canvas.
 *
 * Usage: npm run build && node scripts/render-poster.mjs
 * (starts its own preview server on port 4199)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from '@playwright/test';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};
if (!existsSync('dist')) { console.error('dist/ missing — run `npm run build` first'); process.exit(1); }

const server = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = join('dist', rel);
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(4199, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:4199/', { waitUntil: 'networkidle' });
// wait for the site scene + terrain
await page.waitForFunction(() => window.__app?.site?.terrain?.ready === true, null, { timeout: 60000 });
// switch from the Module-1 globe to the Hadley site scene
await page.evaluate(() => window.__app.showModule('m2'));
await page.waitForTimeout(1500);
// stage the hero shot: low sun, camera low over the rille toward the mountain front
await page.evaluate(() => {
  const app = window.__app;
  app.site.clearMarkers();
  app.site.ambient.intensity = 0.3;          // earthshine + interreflection, lifted for the still
  app.engine.renderer.toneMappingExposure = 1.32;
  app.site.setSun(11, 105);                  // first light from the east
  const A = app.site.terrain.fromLonLat(3.560, 26.115); // over the rille, looking along the plain
  app.orbit.target.set(A.xM, app.site.terrain.elevationAt(A.xM, A.yM) + 30, A.yM);
  app.orbit.spherical = { radius: 3400, theta: Math.PI * 0.58, phi: 1.24 };
  app.orbit.update();
  // hide overlay UI for the clean scene shot
  for (const id of ['task-panel', 'poi-wrap']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.querySelector('.hud')?.style.setProperty('display', 'none');
  document.querySelector('.app-header')?.style.setProperty('display', 'none');
  document.querySelector('.module-nav')?.style.setProperty('display', 'none');
  document.body.style.background = '#000';
});
await page.waitForTimeout(2500); // let a few frames render at the staged pose
const jpgB64 = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 }, type: 'jpeg', quality: 88 });
// encode the webp variant in-page from the captured frame (Playwright cannot encode webp directly)
const webpB64 = await page.evaluate(async (b64) => {
  const img = document.createElement('img');
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = `data:image/jpeg;base64,${b64}`; });
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 630;
  c.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/webp', 82));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}, jpgB64.toString('base64'));
await browser.close();
server.close();

const { writeFileSync } = await import('node:fs');
writeFileSync('public/poster-1.0.0.jpg', jpgB64);
writeFileSync('public/poster-1.0.0.webp', Buffer.from(webpB64, 'base64'));
for (const f of ['public/poster-1.0.0.webp', 'public/poster-1.0.0.jpg']) {
  const kb = Math.round(statSync(f).size / 102.4) / 10;
  console.log(`${f}: ${kb} KB`);
  if (kb > 200) { console.error('poster over 200 KB budget'); process.exit(1); }
}
console.log('posters rendered');
