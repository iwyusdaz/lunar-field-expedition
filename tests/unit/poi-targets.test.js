import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TerrainField } from '../../src/scenes/terrain.js';
import { patchTarget, resolveTarget } from '../../src/systems/poi-targets.js';

const json = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const meta = json('public/assets/terrain/terrain-meta.json');
const craters = json('content/craters.json');
const features = json('content/features.json');
const stations = json('content/stations.json');

// Same projection the app uses: lon/lat <-> site metres on the 10 m/px grid.
const terrain = new TerrainField();
terrain.meta = meta;
const l1 = meta.lods[1];
terrain.rawGrid = { width: l1.width, height: l1.height, mPerPx: l1.mPerPx, data: new Float32Array(1) };
const fromLonLat = (lon, lat) => terrain.fromLonLat(lon, lat);
const widthM = (l1.width - 1) * l1.mPerPx;
const heightM = (l1.height - 1) * l1.mPerPx;
const inside = (P) => P.xM >= 0 && P.xM <= widthM && P.yM >= 0 && P.yM <= heightM;

describe('points-of-interest targets', () => {
  it('every crater patch resolves to a finite point inside the site', () => {
    for (const p of craters.patches) {
      const P = resolveTarget(patchTarget(p), fromLonLat);
      expect(P, p.id).not.toBeNull();
      expect(Number.isFinite(P.xM) && Number.isFinite(P.yM)).toBe(true);
      expect(inside(P)).toBe(true);
    }
  });

  it('a patch object passed directly (the old bug) does not resolve to NaN', () => {
    // patch objects have no top-level xM or lon; this used to yield NaN
    expect(resolveTarget(craters.patches[0], fromLonLat)).toBeNull();
  });

  it('every feature and station resolves to a finite point inside the site', () => {
    for (const f of [...features.features, ...stations.stations]) {
      const P = resolveTarget(f, fromLonLat);
      expect(P, f.id).not.toBeNull();
      expect(inside(P), f.id).toBe(true);
    }
  });

  it('patch metre centres agree with their stored lon/lat (within 30 m)', () => {
    for (const p of craters.patches) {
      const P = fromLonLat(p.centerLonLat.lon, p.centerLonLat.lat);
      expect(Math.hypot(P.xM - p.center.xM, P.yM - p.center.yM)).toBeLessThan(30);
    }
  });
});
