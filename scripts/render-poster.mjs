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
// wait for the site scene + terrain + the v2 living layer (boulders, LM, rover, crew)
await page.waitForFunction(() => window.__app?.site?.terrain?.ready === true && window.__app.site.rocks?.length > 0, null, { timeout: 60000 });
// switch from the Module-1 globe to the Hadley site scene
await page.evaluate(() => window.__app.showModule('m2'));
await page.waitForTimeout(1500);
// v2 hero shot: low morning sun, camera at crew height near the LM, the rover
// driving past and the Apennine Front on the horizon
const stage = () => page.evaluate(() => {
  const app = window.__app;
  app.site.clearMarkers();
  app.site.ambient.intensity = 0.3;          // earthshine + interreflection, lifted for the still
  app.engine.renderer.toneMappingExposure = 1.25;
  app.site.setSun(14, 100);                  // morning light from the east
  const L = app.site.lmPos;
  const tx = L.x + 6, tz = L.z + 3;
  app.orbit.target.set(tx, app.site.meshHeightAt(tx, tz) + 2.2, tz);
  app.orbit.spherical = { radius: 17, theta: 0.95, phi: 1.47 };
  for (const r of app.world?.hotspotRings || []) r.group.visible = false; // interaction affordances off for the still
  app.orbit.update();
  // hide overlay UI for the clean scene shot
  for (const id of ['task-panel', 'poi-wrap']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  for (const sel of ['.hud', '.app-header', '.module-nav', '.v2-world-tooltip', '#status']) {
    document.querySelector(sel)?.style.setProperty('display', 'none');
  }
  document.body.style.background = '#000';
});
await stage();
await page.waitForTimeout(2500); // let a few frames render at the staged pose
// blank-frame guard: a frame captured before the GPU presents is near-uniform black
let jpgB64;
for (let attempt = 1; attempt <= 4; attempt++) {
  jpgB64 = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 }, type: 'jpeg', quality: 84 });
  const spread = await page.evaluate(async (b64) => {
    const img = document.createElement('img');
    await new Promise((r) => { img.onload = r; img.src = `data:image/jpeg;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = 120; c.height = 63;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 120, 63);
    const d = g.getImageData(0, 0, 120, 63).data;
    let mn = 255, mx = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { const v = d[i]; mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; }
    return { range: mx - mn, mean: sum / (d.length / 4) };
  }, jpgB64.toString('base64'));
  console.log(`poster attempt ${attempt}: luminance range ${spread.range}, mean ${spread.mean.toFixed(1)}`);
  if (spread.range > 60 && spread.mean > 12) break;
  if (attempt === 4) { console.error('poster frame still blank after 4 attempts'); process.exit(1); }
  await stage();
  await page.waitForTimeout(2500);
}
// encode the webp variant in-page from the captured frame (Playwright cannot encode webp directly)
const webpB64 = await page.evaluate(async (b64) => {
  const img = document.createElement('img');
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = `data:image/jpeg;base64,${b64}`; });
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 630;
  c.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/webp', 80));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}, jpgB64.toString('base64'));
await browser.close();
server.close();

const { writeFileSync } = await import('node:fs');
writeFileSync('public/poster-2.0.0.jpg', jpgB64);
writeFileSync('public/poster-2.0.0.webp', Buffer.from(webpB64, 'base64'));
for (const f of ['public/poster-2.0.0.webp', 'public/poster-2.0.0.jpg']) {
  const kb = Math.round(statSync(f).size / 102.4) / 10;
  console.log(`${f}: ${kb} KB`);
  if (kb > 200) { console.error('poster over 200 KB budget'); process.exit(1); }
}
console.log('posters rendered');
