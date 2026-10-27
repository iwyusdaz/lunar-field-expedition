import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeGrayPNG, decodeHeightmap, sampleElevation } from '../../src/core/png.js';

describe('png.decodeGrayPNG', () => {
  it('decodes a synthetic 8-bit gray PNG', async () => {
    // build a tiny valid 4x2 grayscale PNG by hand (filter 0 rows)
    const { deflateSync } = await import('node:zlib');
    const w = 4, h = 2;
    const raw = Buffer.alloc((w + 1) * h);
    raw[0] = 0; raw.set([10, 20, 30, 40], 1);
    raw[w + 1] = 1; raw.set([1, 2, 3, 4], w + 2); // filter 1 (sub)
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 0; // 8-bit gray
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const crcBuf = Buffer.concat([Buffer.from(type), data]);
      let c = ~0;
      for (const b of crcBuf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
      const crc = Buffer.alloc(4); crc.writeUInt32BE((~c) >>> 0);
      return Buffer.concat([len, Buffer.from(type), data, crc]);
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const out = await decodeGrayPNG(png);
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
    expect([...out.data.slice(0, 4)]).toEqual([10, 20, 30, 40]);
    expect([...out.data.slice(4, 8)]).toEqual([1, 3, 6, 10]); // sub-filter reconstruction
  });

  it('rejects non-PNG data', async () => {
    await expect(decodeGrayPNG(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow('not a PNG');
  });
});

describe('png.decodeHeightmap on the real committed LROC asset', () => {
  const meta = JSON.parse(readFileSync('public/assets/terrain/terrain-meta.json', 'utf8'));
  const l0 = meta.lods[0];
  const buf = readFileSync('public/assets/terrain/height-l0.png');

  it('matches the meta dimensions and elevation bounds', async () => {
    const hm = await decodeHeightmap(buf, l0);
    expect(hm.width).toBe(l0.width);
    expect(hm.height).toBe(l0.height);
    expect(hm.elevMin).toBe(l0.elevMin);
    expect(hm.elevMax).toBe(l0.elevMax);
    const valid = [...hm.data].filter(v => !Number.isNaN(v));
    expect(valid.length).toBeGreaterThan(0);
    expect(Math.min(...valid)).toBeGreaterThanOrEqual(l0.elevMin - 0.01);
    expect(Math.max(...valid)).toBeLessThanOrEqual(l0.elevMax + 0.01);
  });

  it('reproduces the validated relief (rille floor to front slopes, ~900 m in the AOI)', async () => {
    const hm = await decodeHeightmap(buf, l0);
    const valid = [...hm.data].filter(v => !Number.isNaN(v));
    const relief = Math.max(...valid) - Math.min(...valid);
    // L0 is coarser; the validated AOI relief at L2 is 932 m — L0 should be in the same band
    expect(relief).toBeGreaterThan(700);
    expect(relief).toBeLessThan(1100);
  });

  it('zero pixel value encodes nodata (NaN) in the output', async () => {
    const hm = await decodeHeightmap(buf, l0);
    // LOD0 valid columns 15..161 of 170 — column 0 is outside the footprint
    expect(Number.isNaN(hm.data[0])).toBe(true);
  });
});

describe('sampleElevation', () => {
  const grid = { width: 3, height: 3, mPerPx: 10, data: Float32Array.from([100, 110, 120, 200, 210, 220, 300, 310, 320]) };
  it('interpolates bilinearly', () => {
    expect(sampleElevation(grid, 0, 0)).toBe(100);
    expect(sampleElevation(grid, 10, 0)).toBe(110);
    expect(sampleElevation(grid, 5, 5)).toBeCloseTo(155, 5);
    expect(sampleElevation(grid, 15, 10)).toBeCloseTo(215, 5); // between 210 and 220
  });
  it('returns NaN outside the grid or at nodata', () => {
    expect(Number.isNaN(sampleElevation(grid, 25, 0))).toBe(true);
    const g2 = { ...grid, data: Float32Array.from([100, 110, NaN, 200, 210, 220, 300, 310, 320]) };
    expect(Number.isNaN(sampleElevation(g2, 0, 0))).toBe(false); // cell (0,0) does not touch the nodata px
    expect(Number.isNaN(sampleElevation(g2, 12, 0))).toBe(true); // cell (1,0) touches it
    expect(sampleElevation(g2, 12, 12)).toBeCloseTo(232, 5); // bilinear inside the clean cell
  });
});
