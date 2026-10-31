/**
 * make-lut.mjs — writes a 33^3 case grade (own work, CC0) as
 *   design/lut/<name>-33.cube   .cube text, the source (grading tools read and write it; not shipped)
 *   public/lut/<name>-33.png    PNG strip, 1089 x 33 RGB8, what the app ships (~100 KB)
 * Adapted from _templates/spikes/scripts/make-lut.mjs (S2). The grade works in
 * display space after AgX (v3/render-chain.js). Repos either export their own
 * .cube from a grading tool and convert it with this script's PNG writer, or
 * edit grade() below.
 *
 * Usage: node scripts/make-lut.mjs [name]      (default name: template-grade)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = process.argv[2] || 'template-grade';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/lut');
const SRC = join(ROOT, 'design/lut');
mkdirSync(OUT, { recursive: true });
mkdirSync(SRC, { recursive: true });
const N = 33;
const clamp = (x) => Math.min(1, Math.max(0, x));

/** Template grade: +4% contrast around mid-grey, slightly warm highlights, cool shadows, -5% saturation. */
function grade(r, g, b) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = 0.95;
  r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
  const c = 1.04;
  r = 0.5 + (r - 0.5) * c; g = 0.5 + (g - 0.5) * c; b = 0.5 + (b - 0.5) * c;
  const sh = (1 - l) ** 3, hi = l ** 2;
  r += -0.006 * sh + 0.02 * hi;
  g += 0.004 * sh + 0.008 * hi;
  b += 0.016 * sh - 0.018 * hi;
  return [clamp(r), clamp(g), clamp(b)];
}

let cube = `TITLE "${NAME}"\nLUT_3D_SIZE ${N}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n`;
for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
  const [r, g, b] = grade(ri / (N - 1), gi / (N - 1), bi / (N - 1));
  cube += `${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}\n`;
}
writeFileSync(join(SRC, `${NAME}-33.cube`), cube);

// PNG strip: width N*N (blue selects the slice), height N (green), x within slice = red.
const w = N * N, h = N;
const raw = Buffer.alloc((w * 3 + 1) * h);
for (let y = 0; y < h; y++) {
  raw[y * (w * 3 + 1)] = 0;
  for (let x = 0; x < w; x++) {
    const bi = Math.floor(x / N), ri = x % N, gi = y;
    const c = grade(ri / (N - 1), gi / (N - 1), bi / (N - 1));
    for (let k = 0; k < 3; k++) raw[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.round(c[k] * 255);
  }
}
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(join(OUT, `${NAME}-33.png`), png);
console.log({ name: NAME, cubeBytes: cube.length, pngBytes: png.length });
