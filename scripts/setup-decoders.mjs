/**
 * Copies three.js decoder files from node_modules into public/decoders/ so every
 * decoder is self-hosted in the build (build contract 08 5.1 — no CDN loads).
 * Run once at install time: node scripts/setup-decoders.mjs
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public', 'decoders');

for (const d of ['draco', 'basis']) mkdirSync(join(pub, d), { recursive: true });

// three's exports map does not expose './package.json', so locate the package
// directly under node_modules (works for a normal install of this repo).
let threeDir = null;
for (const candidate of [
  join(root, 'node_modules', 'three'),
  join(root, '..', '..', 'node_modules', 'three'),
]) {
  if (existsSync(join(candidate, 'package.json'))) { threeDir = candidate; break; }
}
if (!threeDir) {
  console.error('could not locate the three package under node_modules');
  process.exit(1);
}

for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
  const src = join(threeDir, 'examples', 'jsm', 'libs', 'draco', f);
  if (existsSync(src)) copyFileSync(src, join(pub, 'draco', f));
  else console.warn(`missing decoder file: ${f}`);
}

for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  const src = join(threeDir, 'examples', 'jsm', 'libs', 'basis', f);
  if (existsSync(src)) copyFileSync(src, join(pub, 'basis', f));
  else console.warn(`missing decoder file: ${f}`);
}

console.log('decoders copied to public/decoders/');
