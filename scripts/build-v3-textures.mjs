/**
 * build-v3-textures.mjs — v3 (plan 10, S4) textures, sky data and grade.
 *
 * Writes public/assets/v3/:
 *   regolith/   Poly Haven CC0 "moon_01" (3.1 m tile, meso detail) and "moon_dusted_02"
 *               (0.4 m tile, macro detail): albedo (KTX2 ETC1S sRGB), normal (KTX2 UASTC
 *               linear, OpenGL convention), ard (KTX2 ETC1S linear: R = ambient occlusion,
 *               G = roughness, B = displacement; metalness is 0 for regolith). The 512 px
 *               set is the first-load tier; the 1024 px set streams after the first click.
 *   decals/     Poly Haven CC0 "moon_footprints_01" (trampled bootprint patch) and
 *               "moon_track_04" (chevron tyre-track strip), same three maps, 1024 px wide.
 *   sky/        NASA Blue Marble 2048 x 1024 day map (ETC1S sRGB) and cloud layer (ETC1S, grey);
 *               Yale Bright Star Catalogue (BSC5P, NASA HEASARC) as a binary star list.
 *   terrain/    Clementine UVVIS 750 nm albedo (USGS, public domain) resampled onto the far
 *               terrain square (81.92 km, 80 m/px, 1024 px), grey KTX2 ETC1S linear.
 *   grade/      Own-work 33^3 LUT "hadley-ektachrome" as a PNG strip (1089 x 33);
 *               the .cube source is kept in design/grade/.
 * KTX2 is written by toktx 4.4.2 (~/ktx-software, TOOLS.md); KTX2 needs the Basis
 * transcoder at runtime (S5 self-hosts it, plan 08 §5).
 * Run: node scripts/build-v3-textures.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync, deflateSync } from 'node:zlib';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data/raw/v3');
const WORK = join(ROOT, 'data/work/v3/tex');
const OUT = join(ROOT, 'public/assets/v3');
const TOKTX = process.env.TOKTX || join(homedir(), 'ktx-software/bin/toktx');
const ENV = { ...process.env, DYLD_LIBRARY_PATH: join(homedir(), 'ktx-software/lib') };
mkdirSync(WORK, { recursive: true });
const made = [];

const magick = (...a) => execFileSync('magick', a.flat().map(String), { stdio: ['ignore', 'ignore', 'inherit'] });
function ktx(png, out, mode) {
  mkdirSync(dirname(out), { recursive: true });
  const common = ['--t2', '--genmipmap', '--assign_oetf', mode.srgb ? 'srgb' : 'linear'];
  const enc = mode.uastc ? ['--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1.5', '--zcmp', '18'] : ['--encode', 'etc1s', '--clevel', '2', '--qlevel', mode.srgb ? '192' : '255'];
  execFileSync(TOKTX, [...common, ...enc, ...(mode.mono ? ['--target_type', 'R'] : []), out, png], { env: ENV, stdio: ['ignore', 'ignore', 'inherit'] });
  made.push({ file: out.slice(ROOT.length + 1), bytes: statSync(out).size });
}
const need = (f) => { if (!existsSync(f)) { console.error(`missing ${f}; run node scripts/fetch-v3-assets.mjs`); process.exit(1); } return f; };

// ---------------------------------------------------------------- PBR sets
function pbrSet(phId, outDir, outName, sizes, geometry) {
  const src = (m) => need(join(RAW, phId, `${phId}_${m}_2k.jpg`));
  for (const size of sizes) {
    const g = geometry(size);
    const tag = sizes.length > 1 ? `-${size}` : '';
    const p = (n) => join(WORK, `${outName}-${n}-${size}.png`);
    magick(src('diff'), '-resize', `${g}!`, '-strip', p('albedo'));
    magick(src('nor_gl'), '-resize', `${g}!`, '-strip', p('normal'));
    // ard: R = AO (arm.R), G = roughness (arm.G), B = displacement
    magick(src('arm'), src('disp'), '-resize', `${g}!`, '-colorspace', 'sRGB',
      '(', '-clone', '0', '-channel', 'R', '-separate', ')',
      '(', '-clone', '0', '-channel', 'G', '-separate', ')',
      '(', '-clone', '1', '-colorspace', 'Gray', ')',
      '-delete', '0,1', '-set', 'colorspace', 'sRGB', '-combine', '-strip', p('ard'));
    ktx(p('albedo'), join(OUT, outDir, `${outName}-albedo${tag}.ktx2`), { srgb: true });
    ktx(p('normal'), join(OUT, outDir, `${outName}-normal${tag}.ktx2`), { uastc: true });
    ktx(p('ard'), join(OUT, outDir, `${outName}-ard${tag}.ktx2`), {}); // low-frequency data: ETC1S is enough
  }
}
const square = (s) => `${s}x${s}`;
pbrSet('moon_01', 'regolith', 'regolith-meso', [1024, 512], square);
pbrSet('moon_dusted_02', 'regolith', 'regolith-macro', [1024, 512], square);
// Decals keep the source aspect (rounded to a multiple of 4 px).
const aspect = (f) => { const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', f]).toString().split(' ').map(Number); return h / w; };
const fpA = aspect(join(RAW, 'moon_footprints_01/moon_footprints_01_diff_2k.jpg'));
const trA = aspect(join(RAW, 'moon_track_04/moon_track_04_diff_2k.jpg'));
pbrSet('moon_footprints_01', 'decals', 'bootprints', [1024], (s) => `${s}x${Math.round((s * fpA) / 4) * 4}`);
pbrSet('moon_track_04', 'decals', 'rover-track', [512], (s) => `${s}x${Math.round((s * trA) / 4) * 4}`);

// ---------------------------------------------------------------- Earth
magick(need(join(RAW, 'land_shallow_topo_2048.jpg')), '-resize', '2048x1024!', '-strip', join(WORK, 'earth-day.png'));
ktx(join(WORK, 'earth-day.png'), join(OUT, 'sky/earth-day-2048.ktx2'), { srgb: true });
magick(need(join(RAW, 'cloud_combined_2048.jpg')), '-resize', '2048x1024!', '-colorspace', 'Gray', '-strip', join(WORK, 'earth-clouds.png'));
ktx(join(WORK, 'earth-clouds.png'), join(OUT, 'sky/earth-clouds-2048.ktx2'), { mono: true });

// ---------------------------------------------------------------- stars (BSC5P)
{
  const tdat = gunzipSync(readFileSync(need(join(RAW, 'heasarc_bsc5p.tdat.gz')))).toString('latin1');
  const fields = /^line\[1\] = (.*)$/m.exec(tdat)[1].trim().split(/\s+/);
  const ix = (k) => fields.indexOf(k);
  const rows = tdat.split('<DATA>')[1].split('<END>')[0].trim().split('\n');
  const stars = [];
  for (const line of rows) {
    const c = line.split('|');
    const ra = parseFloat(c[ix('ra')]), dec = parseFloat(c[ix('dec')]), v = parseFloat(c[ix('vmag')]);
    const bv = parseFloat(c[ix('bv_color')]);
    const cls = c[ix('name')] || '';
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(v)) continue;
    stars.push({ ra, dec, v, bv: Number.isFinite(bv) ? bv : 0.6, hr: parseInt(c[ix('hr')], 10), name: cls.trim() });
  }
  stars.sort((a, b) => a.v - b.v);
  // 5 x int16 per star: x, y, z (J2000 equatorial unit vector * 32767), V mag * 100, B-V * 1000.
  const buf = Buffer.alloc(stars.length * 10);
  const d = Math.PI / 180;
  stars.forEach((s, k) => {
    const x = Math.cos(s.dec * d) * Math.cos(s.ra * d), y = Math.cos(s.dec * d) * Math.sin(s.ra * d), z = Math.sin(s.dec * d);
    [x, y, z].forEach((u, a) => buf.writeInt16LE(Math.round(u * 32767), k * 10 + a * 2));
    buf.writeInt16LE(Math.round(s.v * 100), k * 10 + 6);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s.bv * 1000))), k * 10 + 8);
  });
  mkdirSync(join(OUT, 'sky'), { recursive: true });
  writeFileSync(join(OUT, 'sky/stars-bsc5p.bin'), buf);
  writeFileSync(join(OUT, 'sky/stars-bsc5p.json'), JSON.stringify({
    source: 'Yale Bright Star Catalogue, 5th revised ed. (preliminary), NASA HEASARC table BSC5P', count: stars.length,
    layout: 'little-endian int16 x 5 per star, brightest first: x, y, z = J2000 equatorial unit vector * 32767 (x toward RA 0, z toward the north celestial pole); V magnitude * 100; B-V colour index * 1000 (0.6 where the catalogue has none)',
    vmagRange: [stars[0].v, stars[stars.length - 1].v], brightest: stars.slice(0, 5).map((s) => s.name),
  }, null, 1) + '\n');
  made.push({ file: 'public/assets/v3/sky/stars-bsc5p.bin', bytes: buf.length });
}

// ---------------------------------------------------------------- regional albedo (Clementine 750 nm)
{
  const tif = need(join(RAW, 'clementine-750nm-hadley-window.tif'));
  const LM = { lat: 26.13239, lon: 3.6333 }, R = 1737400, HALF = 40960;
  const LOCAL = `+proj=eqc +lat_ts=${LM.lat} +lat_0=${LM.lat} +lon_0=${LM.lon} +x_0=0 +y_0=0 +R=${R} +units=m +no_defs`;
  const warped = join(WORK, 'clementine-local.tif');
  rmSync(warped, { force: true });
  execFileSync('gdalwarp', ['-q', '-overwrite', '-t_srs', LOCAL, '-te', String(-HALF), String(-HALF), String(HALF), String(HALF), '-ts', '1024', '1024', '-r', 'cubic', tif, warped]);
  execFileSync('gdal_translate', ['-q', '-of', 'PNG', warped, join(WORK, 'albedo-clementine.png')]);
  ktx(join(WORK, 'albedo-clementine.png'), join(OUT, 'terrain/albedo-clementine-750nm-1024.ktx2'), { mono: true });
  writeFileSync(join(OUT, 'terrain/albedo-clementine-750nm-1024.json'), JSON.stringify({
    source: 'Clementine UVVIS 750 nm global mosaic v2.1, 118 m/px (USGS Astrogeology)', meaning: 'relative albedo at 750 nm (grey, linear DN 0-255 as published); use as a brightness multiplier, not as colour',
    extentM: { west: -HALF, east: HALF, south: -HALF, north: HALF }, frame: 'terrain-v3 tileset frame (x east, y north, origin at the LM); row 0 = north edge',
    pixelM: 80, resampling: 'GDAL cubic from 118 m to 80 m (no new detail; upsampled)',
  }, null, 1) + '\n');
}

// ---------------------------------------------------------------- grade LUT (own work)
{
  // "Hasselblad at Hadley": crisp contrast, faintly warm highlights, cool neutral shadows,
  // slight Ektachrome saturation in the mids (art bible §1, §3). Display space, after AgX.
  const N = 33, clamp = (x) => Math.min(1, Math.max(0, x));
  const grade = (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = 1.06;
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    const s = (x) => x - (0.12 * Math.sin(2 * Math.PI * x)) / (2 * Math.PI); // gentle S-curve: slope 1.12 in the mids
    r = s(r); g = s(g); b = s(b);
    const sh = (1 - l) ** 3, hi = l ** 2;
    r += -0.006 * sh + 0.018 * hi; g += 0.0 * sh + 0.008 * hi; b += 0.012 * sh - 0.014 * hi;
    return [clamp(r), clamp(g), clamp(b)];
  };
  let cube = `TITLE "hadley-ektachrome-33 (own work, CC0)"\nLUT_3D_SIZE ${N}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n`;
  for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) cube += grade(ri / (N - 1), gi / (N - 1), bi / (N - 1)).map((v) => v.toFixed(6)).join(' ') + '\n';
  mkdirSync(join(ROOT, 'design/grade'), { recursive: true });
  writeFileSync(join(ROOT, 'design/grade/hadley-ektachrome-33.cube'), cube);
  const w = N * N, h = N, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = grade((x % N) / (N - 1), y / (N - 1), Math.floor(x / N) / (N - 1));
    for (let k = 0; k < 3; k++) raw[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.round(c[k] * 255);
  }
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const L = Buffer.alloc(4); L.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const C = Buffer.alloc(4); C.writeUInt32BE(crc(body)); return Buffer.concat([L, body, C]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  mkdirSync(join(OUT, 'grade'), { recursive: true });
  writeFileSync(join(OUT, 'grade/hadley-ektachrome-33.png'), png);
  made.push({ file: 'public/assets/v3/grade/hadley-ektachrome-33.png', bytes: png.length });
}

for (const m of made) console.log(`${String(m.bytes).padStart(9)}  ${m.file}`);
console.log(`total ${(made.reduce((a, m) => a + m.bytes, 0) / 1048576).toFixed(2)} MB in ${made.length} files`);
