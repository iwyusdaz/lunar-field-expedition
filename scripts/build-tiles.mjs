/**
 * build-tiles.mjs — turns the GDAL outputs in data/work/ into engine-ready
 * terrain assets in public/assets/terrain/:
 *   height-l{0,1,2}.png   16-bit heightmaps (copied through)
 *   normal-l{0,1,2}.png   8-bit RGB tangent-space normal maps (computed here)
 *   albedo-wac.png        real LROC WAC color crop (copied through)
 *   terrain-meta.json     dimensions, encodings, AOI bounds
 * and validates in-scene relief against published values, logging the check to
 * evaluation/results/terrain-validation.json (plan phase 3, step 5).
 *
 * No npm dependencies: PNG decode/encode is hand-rolled on node:zlib.
 * 1 unit = 1 metre; no vertical exaggeration anywhere.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const WORK = 'data/work';
const OUT = 'public/assets/terrain';
mkdirSync(OUT, { recursive: true });

// ---------- minimal PNG (non-interlaced, grayscale/RGB, 8/16-bit) ------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Decode a non-interlaced PNG (gray 8/16-bit or RGB 8-bit) into {w,h,bitDepth,colorType,rows:Buffer[]} */
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w, h, bitDepth, colorType, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : null;
  if (channels == null) throw new Error(`unsupported colorType ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels * (bitDepth / 8);
  const stride = w * bpp;
  const rows = [];
  let p = 0;
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      switch (filter) {
        case 1: line[x] = (line[x] + a) & 0xff; break;
        case 2: line[x] = (line[x] + b) & 0xff; break;
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[x] = (line[x] + pred) & 0xff; break;
        }
      }
    }
    rows.push(line);
    prev.set(line);
  }
  return { w, h, bitDepth, colorType, rows };
}

/** Encode an 8-bit RGB PNG (filter 0). */
export function encodeRGBPNG(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', (() => { const b = Buffer.alloc(13); b.writeUInt32BE(w); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 2; return b; })()),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 16-bit gray PNG -> Float32 array using the meta scale/offset. */
function readHeights(pngPath, metaPath) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const png = decodePNG(readFileSync(pngPath));
  const { width: w, height: h } = meta;
  if (png.w !== w || png.h !== h) throw new Error(`${pngPath}: size mismatch`);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = png.rows[y];
    for (let x = 0; x < w; x++) {
      const v = row.readUInt16BE(x * 2);
      out[y * w + x] = v === 0 ? NaN : meta.elevMin + (v / 65535) * (meta.elevMax - meta.elevMin);
    }
  }
  return { ...meta, data: out };
}

/** Central-difference normals for a height grid (Y up, x east, z south). */
function computeNormals(grid) {
  const { width: w, height: h, mPerPx, data } = grid;
  const rgb = Buffer.alloc(w * h * 3);
  const at = (x, y) => data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * mPerPx); // dh/dx (east)
      const dz = (at(x, y + 1) - at(x, y - 1)) / (2 * mPerPx); // dh/dy row = south
      let nx = -dx, ny = 1, nz = -dz;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 3;
      rgb[i] = Math.round((nx * 0.5 + 0.5) * 255);
      rgb[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      rgb[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return rgb;
}

// ---------- build the three LODs ---------------------------------------------
const lods = [];
for (const i of [0, 1, 2]) {
  const grid = readHeights(`${WORK}/height-l${i}.png`, `${WORK}/height-l${i}.meta.json`);
  copyFileSync(`${WORK}/height-l${i}.png`, `${OUT}/height-l${i}.png`);
  writeFileSync(`${OUT}/normal-l${i}.png`, encodeRGBPNG(grid.width, grid.height, computeNormals(grid)));
  // Valid-footprint bounding box: the NAC DTM does not cover the full crop on the
  // west/east edges (0 encodes nodata). The renderer edge-fills for display; the
  // tools use raw values and treat nodata as untraversable/unsampleable.
  let minX = Infinity, maxX = -Infinity;
  for (let x = 0; x < grid.width; x++) {
    let any = false;
    for (let y = 0; y < grid.height; y++) if (!Number.isNaN(grid.data[y * grid.width + x])) { any = true; break; }
    if (any) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  }
  lods.push({ level: i, width: grid.width, height: grid.height, mPerPx: grid.mPerPx, elevMin: grid.elevMin, elevMax: grid.elevMax, validPx: { xMin: minX, xMax: maxX } });
  console.log(`LOD${i}: ${grid.width}x${grid.height} @ ${grid.mPerPx} m/px, elev ${grid.elevMin}..${grid.elevMax} m, valid cols ${minX}..${maxX}`);
}
copyFileSync(`${WORK}/albedo-wac.png`, `${OUT}/albedo-wac.png`);

// ---------- AOI metadata ------------------------------------------------------
const AOI = {
  lonWest: 3.5026368, lonEast: 3.6901291, latSouth: 25.93, latNorth: 26.32,
  crs: 'equirectangular, Moon sphere R=1737400 m, standard parallel 26N (planetocentric)',
  elevationsRelativeTo: '1737400 m lunar reference sphere (LROC NAC DTM datum)',
  verticalExaggeration: 1.0,
  units: '1 scene unit = 1 metre',
};

// ---------- validation against published values (plan 01, phase 3 step 5) ----
// Profile across the rille on the LOD2 grid at the latitude of the landing site.
function profileAt(grid, latDeg, lonDeg, halfLenM) {
  const { width: w, height: h, mPerPx, data } = grid;
  const px = Math.round(((lonDeg - AOI.lonWest) / (AOI.lonEast - AOI.lonWest)) * (w - 1));
  const py = Math.round(((AOI.latNorth - latDeg) / (AOI.latNorth - AOI.latSouth)) * (h - 1));
  const stepPx = Math.max(1, Math.round(halfLenM / mPerPx / 40));
  const out = [];
  for (let d = -stepPx * 40; d <= stepPx * 40; d += stepPx) {
    const x = Math.min(w - 1, Math.max(0, px + d));
    const v = data[py * w + x];
    if (!Number.isNaN(v)) out.push({ distM: d * mPerPx, elevM: v });
  }
  return out;
}

const l2 = readHeights(`${WORK}/height-l2.png`, `${WORK}/height-l2.meta.json`);
const rilleProfile = profileAt(l2, 26.1295, 3.537, 900); // across the channel at the LM latitude
const rilleFloor = Math.min(...rilleProfile.map(p => p.elevM));
const rilleRim = Math.max(...rilleProfile.filter(p => Math.abs(p.distM) > 500).map(p => p.elevM));
const rilleDepth = rilleRim - rilleFloor;

// plains elevation in a box around the LM
const LM = { lat: 26.13239, lon: 3.6333 };
function boxStats(grid, lat, lon, halfM) {
  const { width: w, height: h, mPerPx, data } = grid;
  const px = Math.round(((lon - AOI.lonWest) / (AOI.lonEast - AOI.lonWest)) * (w - 1));
  const py = Math.round(((AOI.latNorth - lat) / (AOI.latNorth - AOI.latSouth)) * (h - 1));
  const r = Math.round(halfM / mPerPx);
  const vals = [];
  for (let y = Math.max(0, py - r); y <= Math.min(h - 1, py + r); y++)
    for (let x = Math.max(0, px - r); x <= Math.min(w - 1, px + r); x++) {
      const v = data[y * w + x];
      if (!Number.isNaN(v)) vals.push(v);
    }
  vals.sort((a, b) => a - b);
  return { min: vals[0], max: vals[vals.length - 1], median: vals[vals.length >> 1], n: vals.length };
}
const lmBox = boxStats(l2, LM.lat, LM.lon, 100);
let aoiMax = -Infinity; for (const v of l2.data) if (!Number.isNaN(v) && v > aoiMax) aoiMax = v;

const validation = {
  checkedAt: new Date().toISOString(),
  source: 'LROC NAC_DTM_APOLLO15 (2 m/px), NASA PDS',
  checks: [
    {
      name: 'Hadley Rille depth near the landing site',
      measured: `${rilleDepth.toFixed(0)} m (rim ${rilleRim.toFixed(0)} m, floor ${rilleFloor.toFixed(0)} m)`,
      published: 'about 370 m deep at the Apollo 15 site (typical 180-270 m elsewhere)',
      source: 'research/apollo15-facts.md — Hadley Rille (en.wikipedia.org/wiki/Hadley_Rille)',
      tolerance: '±25%',
      pass: Math.abs(rilleDepth - 370) / 370 <= 0.25,
    },
    {
      name: 'Mare plain elevation near the LM',
      measured: `${lmBox.median.toFixed(0)} m (median over a 200 m box; min ${lmBox.min.toFixed(0)}, max ${lmBox.max.toFixed(0)})`,
      published: 'the mare surface sits about 1.7-1.9 km below the 1737.4 km reference sphere at this site',
      source: 'DTM datum; consistent with published site elevation maps (UNVERIFIED precise number — informational check)',
      tolerance: 'informational',
      pass: lmBox.median > -2000 && lmBox.median < -1700,
    },
    {
      name: 'Relief inside the play area',
      measured: `${(aoiMax - rilleFloor).toFixed(0)} m (Apennine Front lower slopes ${aoiMax.toFixed(0)} m down to the rille floor ${rilleFloor.toFixed(0)} m)`,
      published: 'the full Apennine escarpment rises about 4,600 m above the Hadley plain; the play area contains its lower ~1 km (upper slopes are outside the cropped area, documented in DECISIONS.md)',
      source: 'https://en.wikipedia.org/wiki/Hadley%E2%80%93Apennine',
      tolerance: 'informational (documented crop)',
      pass: aoiMax - rilleFloor > 800 && aoiMax - rilleFloor < 1200,
    },
  ],
};
writeFileSync('evaluation/results/terrain-validation.json', JSON.stringify(validation, null, 2));

const meta = {
  slug: 'lunar-field-expedition',
  generatedBy: 'scripts/build-tiles.mjs (from scripts/fetch-lroc-dtm.sh + scripts/process-terrain.sh)',
  dataSources: {
    dtm: 'NASA/LRO LROC NAC_DTM_APOLLO15, 2 m/px, public domain, credit NASA/GSFC/ASU',
    albedo: 'NASA SVS CGI Moon Kit color map (LROC WAC Hapke-normalized mosaic), global resolution (~44x31 px over this area), credit NASA/SVS',
    normalMaps: 'derived in-repo from the DTM (no vertical exaggeration)',
  },
  aoi: AOI,
  lods,
  validation: validation.checks.map(c => ({ name: c.name, measured: c.measured, pass: c.pass })),
};
writeFileSync(`${OUT}/terrain-meta.json`, JSON.stringify(meta, null, 2));
console.log('validation:');
for (const c of validation.checks) console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.measured}`);
if (validation.checks.some(c => !c.pass)) process.exit(1);
console.log('done ->', OUT);
