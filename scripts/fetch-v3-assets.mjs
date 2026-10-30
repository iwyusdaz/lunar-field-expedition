/**
 * fetch-v3-assets.mjs — downloads the third-party sources for the v3 (plan 10, S4)
 * assets into data/raw/v3/ (gitignored) and refuses anything whose licence it
 * cannot confirm.
 *
 * Licence check (plan 09 decision 2, plan 10 §12), per source, fail-closed:
 *   1. The declared licence must be one of ALLOWED (CC0 1.0, public domain,
 *      CC BY 4.0) and must not mention NC / ND / SA / non-commercial / research-only.
 *   2. Every download URL must be on a host allowed for that licence family
 *      (Poly Haven hosts for CC0; NASA / USGS / NASA PDS hosts for public domain).
 *   3. The licence evidence page is fetched and must contain the expected phrase
 *      (for example "CC0" on polyhaven.com/license, "public domain" on the USGS
 *      Astropedia product page, "government-works" on data.nasa.gov).
 *   4. Poly Haven files are checked against the md5 published by its API; every
 *      file's sha256 is recorded.
 * Result log: evaluation/results/asset-licence-check.json (committed).
 *
 * Usage: node scripts/fetch-v3-assets.mjs [--only id,id] [--force]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data/raw/v3');
const LOG = join(ROOT, 'evaluation/results/asset-licence-check.json');
const UA = { 'User-Agent': 'ImmersiveLearningPortfolio/3.0 (lunar-field-expedition asset fetch)' };
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const force = args.includes('--force');

// ---------------------------------------------------------------- licence rules
export const ALLOWED = {
  'CC0-1.0': { hosts: [/^(dl|api|cdn)\.polyhaven\.(org|com)$/, /^polyhaven\.com$/] },
  'public-domain': {
    hosts: [/(^|\.)nasa\.gov$/, /(^|\.)usgs\.gov$/, /^pds-geosciences\.wustl\.edu$/],
  },
  'CC-BY-4.0': { hosts: [] }, // allowed with attribution; no CC BY source is used yet
};
const FORBIDDEN = /\b(NC|ND|SA)\b|non-?commercial|no-?deriv|share-?alike|research (or evaluation )?purposes only/i;

export function checkDeclaredLicence(src) {
  const rule = ALLOWED[src.licence];
  if (!rule) throw new Error(`${src.id}: licence "${src.licence}" is not on the allowed list`);
  if (FORBIDDEN.test(src.licenceText)) throw new Error(`${src.id}: licence text "${src.licenceText}" contains a forbidden term`);
  for (const f of src.files) {
    const host = new URL(f.url).hostname;
    if (!rule.hosts.some((re) => re.test(host))) throw new Error(`${src.id}: host ${host} is not allowed for ${src.licence}`);
  }
}

// ---------------------------------------------------------------- sources
const PH = (id) => `https://polyhaven.com/a/${id}`;
const PH_LICENCE = { url: 'https://polyhaven.com/license', mustContain: /CC0/ };
const NASA_MEDIA = { url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/', mustContain: /not subject to copyright/i };

function polyhavenTexture(id, maps, res = '2k') {
  return { id, kind: 'polyhaven-texture', phId: id, maps, res, page: PH(id), licence: 'CC0-1.0', licenceText: 'CC0 1.0 Universal (Poly Haven)', evidence: PH_LICENCE, files: [] };
}
function polyhavenModel(id) {
  return { id, kind: 'polyhaven-model', phId: id, res: '1k', page: PH(id), licence: 'CC0-1.0', licenceText: 'CC0 1.0 Universal (Poly Haven)', evidence: PH_LICENCE, files: [] };
}

// Far-field DEM window and albedo window (degrees). The LM is at 26.1322 N, 3.6339 E;
// the far tileset is an 81.92 km square centred on it (scripts/build-v3-terrain.mjs).
export const WINDOW = { latS: 24.75, latN: 27.5, lonW: 2.1, lonE: 5.17 };

const SOURCES = [
  polyhavenTexture('moon_01', ['Diffuse', 'nor_gl', 'arm', 'Displacement']),
  polyhavenTexture('moon_dusted_02', ['Diffuse', 'nor_gl', 'arm', 'Displacement']),
  polyhavenTexture('moon_footprints_01', ['Diffuse', 'nor_gl', 'arm', 'Displacement']),
  polyhavenTexture('moon_track_04', ['Diffuse', 'nor_gl', 'arm', 'Displacement']),
  polyhavenModel('moon_rock_04'),
  polyhavenModel('moon_rock_05'),
  polyhavenModel('moon_rock_06'),
  polyhavenModel('moon_rock_07'),
  {
    id: 'sldem2015-window', kind: 'sldem-window',
    page: 'https://astrogeology.usgs.gov/search/map/moon_lro_lola_selene_kaguya_tc_dem_merge_60n60s_59m',
    author: 'NASA LOLA Team and JAXA SELENE/Kaguya Team (Barker et al. 2016)',
    licence: 'public-domain', licenceText: 'Public domain (USGS Astropedia: access constraints "public domain"; please cite authors)',
    evidence: { url: 'https://astrogeology.usgs.gov/search/map/moon_lro_lola_selene_kaguya_tc_dem_merge_60n60s_59m', mustContain: /public domain/i },
    files: [
      { url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/float_img/SLDEM2015_512_00N_30N_000_045_FLOAT.LBL', dest: 'SLDEM2015_512_00N_30N_000_045_FLOAT.LBL' },
      { url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/float_img/SLDEM2015_512_00N_30N_000_045_FLOAT.IMG', dest: 'sldem2015-hadley-window.f32', window: true },
    ],
  },
  {
    id: 'clementine-750nm-window', kind: 'gdal-window',
    page: 'https://astrogeology.usgs.gov/search/map/moon_clementine_uvvis_global_mosaic_118m',
    author: 'USGS Astrogeology Science Center / Clementine UVVIS (Lee et al. 2009)',
    licence: 'public-domain', licenceText: 'Public domain (USGS Astropedia product page)',
    evidence: { url: 'https://astrogeology.usgs.gov/search/map/moon_clementine_uvvis_global_mosaic_118m', mustContain: /public domain/i },
    files: [{ url: 'https://planetarymaps.usgs.gov/mosaic/Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2.1.tif', dest: 'clementine-750nm-hadley-window.tif', window: true }],
  },
  {
    id: 'bluemarble-2048', kind: 'file',
    page: 'https://visibleearth.nasa.gov/images/57752/blue-marble-land-surface-shallow-water-and-shaded-topography',
    author: 'NASA Goddard Space Flight Center (Visible Earth)',
    licence: 'public-domain', licenceText: 'Public domain (NASA media usage guidelines)', evidence: NASA_MEDIA,
    files: [{ url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg', dest: 'land_shallow_topo_2048.jpg' }],
  },
  {
    id: 'bluemarble-clouds-2048', kind: 'file',
    page: 'https://visibleearth.nasa.gov/images/57747/blue-marble-clouds',
    author: 'NASA Goddard Space Flight Center (Visible Earth)',
    licence: 'public-domain', licenceText: 'Public domain (NASA media usage guidelines)', evidence: NASA_MEDIA,
    files: [{ url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg', dest: 'cloud_combined_2048.jpg' }],
  },
  {
    id: 'bsc5p', kind: 'file',
    page: 'https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html',
    author: 'Hoffleit & Warren, Yale Bright Star Catalogue 5th ed. (preliminary); NASA HEASARC table',
    licence: 'public-domain', licenceText: 'Public domain (U.S. Government work, data.nasa.gov licence https://www.usa.gov/government-works)',
    evidence: { url: 'https://data.nasa.gov/dataset/bright-star-catalog', mustContain: /government-works/ },
    files: [{ url: 'https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_bsc5p.tdat.gz', dest: 'heasarc_bsc5p.tdat.gz' }],
  },
];

// ---------------------------------------------------------------- helpers
async function get(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(120000) });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

async function checkEvidence(src) {
  const text = await (await get(src.evidence.url)).text();
  if (!src.evidence.mustContain.test(text)) throw new Error(`${src.id}: licence evidence ${src.evidence.url} does not contain ${src.evidence.mustContain}`);
  return { url: src.evidence.url, matched: String(src.evidence.mustContain) };
}

async function resolvePolyhaven(src) {
  const info = await (await get(`https://api.polyhaven.com/info/${src.phId}`)).json();
  const files = await (await get(`https://api.polyhaven.com/files/${src.phId}`)).json();
  src.author = Object.keys(info.authors || {}).join(', ');
  src.name = info.name;
  src.dimensionsMm = info.dimensions;
  if (src.kind === 'polyhaven-texture') {
    for (const map of src.maps) {
      const e = files[map]?.[src.res]?.jpg;
      if (!e) throw new Error(`${src.id}: no ${src.res} jpg for ${map}`);
      src.files.push({ url: e.url, dest: `${src.phId}/${e.url.split('/').pop()}`, md5: e.md5 });
    }
  } else {
    const g = files.gltf?.[src.res]?.gltf;
    if (!g) throw new Error(`${src.id}: no ${src.res} glTF`);
    src.files.push({ url: g.url, dest: `${src.phId}/${g.url.split('/').pop()}`, md5: g.md5 });
    for (const [rel, m] of Object.entries(g.include)) src.files.push({ url: m.url, dest: `${src.phId}/${rel}`, md5: m.md5 });
  }
}

// SLDEM2015 tile: 15360 lines x 23040 samples of float32 (km above 1737.4 km), 0..45 E,
// 30 N at the top, pixel-registered at 512 px/deg. Reads only the window, one HTTP range
// request per line, and writes metres as float32 (row 0 = north edge).
async function fetchSldemWindow(src, file, outPath) {
  const lbl = readFileSync(join(RAW, src.files[0].dest), 'utf8');
  const recBytes = +/RECORD_BYTES\s*=\s*(\d+)/.exec(lbl)[1];
  const samples = +/LINE_SAMPLES\s*=\s*(\d+)/.exec(lbl)[1];
  if (recBytes !== 92160 || samples !== 23040 || !/UNIT\s*=\s*KILOMETER/.test(lbl)) throw new Error('unexpected SLDEM label');
  const PPD = 512, LAT_TOP = 30, LON_LEFT = 0;
  const row0 = Math.floor((LAT_TOP - WINDOW.latN) * PPD), row1 = Math.ceil((LAT_TOP - WINDOW.latS) * PPD);
  const col0 = Math.floor((WINDOW.lonW - LON_LEFT) * PPD), col1 = Math.ceil((WINDOW.lonE - LON_LEFT) * PPD);
  const W = col1 - col0, H = row1 - row0;
  const out = new Float32Array(W * H);
  let next = 0;
  async function worker() {
    for (;;) {
      const r = next++;
      if (r >= H) return;
      const start = (row0 + r) * recBytes + col0 * 4;
      const buf = Buffer.from(await (await get(file.url, { headers: { Range: `bytes=${start}-${start + W * 4 - 1}` } })).arrayBuffer());
      if (buf.length !== W * 4) throw new Error(`short range read at row ${r}`);
      for (let c = 0; c < W; c++) out[r * W + c] = buf.readFloatLE(c * 4) * 1000;
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  const bytes = Buffer.from(out.buffer);
  writeFileSync(outPath, bytes);
  const meta = {
    source: file.url, units: 'metres above a 1,737,400 m sphere', layout: 'float32 little-endian, row-major, row 0 = north',
    width: W, height: H, pixelsPerDegree: PPD, registration: 'pixel centres at (col0 + i + 0.5) / 512 deg E, 30 - (row0 + j + 0.5) / 512 deg N',
    col0, row0, lonW: col0 / PPD, lonE: col1 / PPD, latN: LAT_TOP - row0 / PPD, latS: LAT_TOP - row1 / PPD,
  };
  writeFileSync(outPath.replace(/\.f32$/, '.json'), JSON.stringify(meta, null, 1) + '\n');
  return bytes;
}

// Clementine 750 nm mosaic: equirectangular (lat_ts 0, lon_0 0), 118.45 m/px, Byte.
// GDAL reads the needed strips over HTTP ranges; the output is the window as GeoTIFF.
function fetchGdalWindow(file, outPath) {
  const R = 1737400, d = Math.PI / 180;
  const x = (lon) => R * lon * d, y = (lat) => R * lat * d;
  execFileSync('gdal_translate', ['-q', '-projwin', String(x(WINDOW.lonW)), String(y(WINDOW.latN)), String(x(WINDOW.lonE)), String(y(WINDOW.latS)),
    `/vsicurl/${file.url}`, outPath], { env: { ...process.env, GDAL_HTTP_MULTIRANGE: 'YES', CPL_VSIL_CURL_CHUNK_SIZE: '1048576', GDAL_DISABLE_READDIR_ON_OPEN: 'EMPTY_DIR' }, stdio: 'inherit' });
  return readFileSync(outPath);
}

// ---------------------------------------------------------------- main
mkdirSync(RAW, { recursive: true });
const prior = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : { sources: [] };
const results = new Map(prior.sources.map((s) => [s.id, s]));
let failed = 0;
for (const src of SOURCES) {
  if (only && !only.includes(src.id)) continue;
  try {
    if (src.kind.startsWith('polyhaven')) await resolvePolyhaven(src);
    checkDeclaredLicence(src);
    const evidence = await checkEvidence(src);
    const files = [];
    for (const f of src.files) {
      const out = join(RAW, f.dest);
      mkdirSync(dirname(out), { recursive: true });
      let buf;
      if (existsSync(out) && !force) buf = readFileSync(out);
      else if (src.kind === 'sldem-window' && f.window) buf = await fetchSldemWindow(src, f, out);
      else if (src.kind === 'gdal-window' && f.window) buf = fetchGdalWindow(f, out);
      else { buf = Buffer.from(await (await get(f.url)).arrayBuffer()); writeFileSync(out, buf); }
      if (f.md5 && md5(buf) !== f.md5) throw new Error(`${src.id}: md5 mismatch for ${f.dest}`);
      files.push({ url: f.url, dest: `data/raw/v3/${f.dest}`, bytes: statSync(out).size, sha256: sha256(buf), md5Checked: !!f.md5, window: f.window ? WINDOW : undefined });
    }
    results.set(src.id, {
      id: src.id, name: src.name, author: src.author, page: src.page, licence: src.licence, licenceText: src.licenceText,
      checks: { allowedLicence: true, forbiddenTerms: false, hostsAllowed: true, evidence, md5: files.every((f) => !src.files.find((s) => s.url === f.url)?.md5 || f.md5Checked) },
      dimensionsMm: src.dimensionsMm, checkedAt: new Date().toISOString(), files,
    });
    console.log(`ok   ${src.id} (${src.licence}; ${files.length} files)`);
  } catch (e) {
    failed++;
    results.delete(src.id);
    console.error(`FAIL ${src.id}: ${e.message}`);
  }
}
mkdirSync(dirname(LOG), { recursive: true });
writeFileSync(LOG, JSON.stringify({
  tool: 'scripts/fetch-v3-assets.mjs', note: 'Agent-run licence check. Every source passed the four checks listed in the script header; failures are not recorded as sources.',
  allowed: Object.keys(ALLOWED), sources: [...results.values()],
}, null, 1) + '\n');
if (failed) { console.error(`${failed} source(s) failed the licence or download check`); process.exit(1); }
