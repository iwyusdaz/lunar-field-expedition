/**
 * Minimal PNG decoding (non-interlaced, grayscale/RGB 8/16-bit) without any
 * dependency, used to load the 16-bit heightmaps produced by
 * scripts/build-tiles.mjs on the CPU (elevation queries, traverse costing,
 * profile tool). Inflation uses the standard browser DecompressionStream;
 * under Node (vitest, scripts) it falls back to node:zlib.
 * @module core/png
 */

/**
 * Inflate zlib-wrapped data (PNG IDAT payload).
 * @param {Uint8Array} u8
 * @returns {Promise<Uint8Array>}
 */
async function inflateZlib(u8) {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // Node fallback (vitest / scripts). The computed specifier keeps bundlers
  // from trying to resolve node:zlib in browser builds; this branch never runs there.
  const mod = await import(/* @vite-ignore */ 'node:' + 'zlib');
  return new Uint8Array(mod.inflateSync(u8));
}

/**
 * Decode a non-interlaced PNG (gray 8/16-bit or RGB 8-bit).
 * @param {Uint8Array|ArrayBuffer} buf
 * @returns {Promise<{width:number,height:number,bitDepth:number,colorType:number,data:Uint8Array}>}
 *   data is the unfiltered pixel stream (row-major, stride = width * bpp).
 */
export async function decodeGrayPNG(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8[0] !== 0x89 || u8[1] !== 0x50) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < u8.length) {
    const len = (u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3];
    const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
    if (type === 'IHDR') {
      w = (u8[off + 8] << 24) | (u8[off + 9] << 16) | (u8[off + 10] << 8) | u8[off + 11];
      h = (u8[off + 12] << 24) | (u8[off + 13] << 16) | (u8[off + 14] << 8) | u8[off + 15];
      bitDepth = u8[off + 16];
      colorType = u8[off + 17];
      const interlace = u8[off + 20];
      if (interlace !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      idat.push(u8.subarray(off + 8, off + 8 + len));
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : null;
  if (channels == null) throw new Error(`unsupported colorType ${colorType}`);
  const raw = await inflateZlib(concat(idat));
  const bpp = channels * (bitDepth / 8);
  const stride = w * bpp;
  const out = new Uint8Array(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const rawv = raw[p + x];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[rowStart - stride + x] : 0;
      const c = y > 0 && x >= bpp ? out[rowStart - stride + x - bpp] : 0;
      let v = rawv;
      switch (filter) {
        case 1: v = rawv + a; break;
        case 2: v = rawv + b; break;
        case 3: v = rawv + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = rawv + pred; break;
        }
      }
      out[rowStart + x] = v & 0xff;
    }
    p += stride;
  }
  return { width: w, height: h, bitDepth, colorType, data: out };
}

function concat(list) {
  let n = 0;
  for (const u of list) n += u.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const u of list) { out.set(u, o); o += u.length; }
  return out;
}

/**
 * Decode a 16-bit grayscale heightmap PNG into Float32 metres using the
 * meta encoding { elevMin, elevMax }; 0 encodes nodata (NaN in the output).
 * @param {Uint8Array|ArrayBuffer} u8 PNG file bytes
 * @param {{width:number,height:number,elevMin:number,elevMax:number}} meta
 * @returns {Promise<{width:number,height:number,data:Float32Array,elevMin:number,elevMax:number}>}
 */
export async function decodeHeightmap(u8, meta) {
  const png = await decodeGrayPNG(u8);
  const { width: w, height: h } = meta;
  if (png.width !== w || png.height !== h) throw new Error('heightmap size mismatch');
  const out = new Float32Array(w * h);
  const span = meta.elevMax - meta.elevMin;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 2;
      const v = (png.data[i] << 8) | png.data[i + 1];
      out[y * w + x] = v === 0 ? NaN : meta.elevMin + (v / 65535) * span;
    }
  }
  return { width: w, height: h, data: out, elevMin: meta.elevMin, elevMax: meta.elevMax };
}

/**
 * Bilinear elevation sample at metric (x, y) offsets from the grid's top-left
 * corner; NaN at nodata. Used by the profile tool and traverse costing.
 * @param {{width:number,height:number,mPerPx:number,data:Float32Array}} grid
 */
export function sampleElevation(grid, xMeters, yMeters) {
  const fx = xMeters / grid.mPerPx;
  const fy = yMeters / grid.mPerPx;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 >= grid.width - 1 || y0 >= grid.height - 1) return NaN;
  const tx = fx - x0, ty = fy - y0;
  const g = grid.data;
  const v00 = g[y0 * grid.width + x0], v10 = g[y0 * grid.width + x0 + 1];
  const v01 = g[(y0 + 1) * grid.width + x0], v11 = g[(y0 + 1) * grid.width + x0 + 1];
  if (Number.isNaN(v00) || Number.isNaN(v10) || Number.isNaN(v01) || Number.isNaN(v11)) return NaN;
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}
