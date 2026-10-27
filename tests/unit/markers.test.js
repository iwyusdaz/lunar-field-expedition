import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scaleRingPoints, densityComparison } from '../../src/systems/crater-counter.js';

const json = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const craters = json('content/craters.json');
const features = json('content/features.json');

describe('crater-count scale reference', () => {
  it('draws an 80 m ring (radius 40 m) outside each patch, at finite heights', () => {
    for (const p of craters.patches) {
      const ref = scaleRingPoints(p, 80, () => -1900);
      expect(ref.radiusM).toBe(40);
      for (const q of ref.points) {
        expect(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z)).toBe(true);
        expect(Math.hypot(q.x - ref.center.x, q.z - ref.center.z)).toBeCloseTo(40, 6);
      }
      // the whole ring sits outside the counting patch
      expect(Math.hypot(ref.center.x - p.center.xM, ref.center.z - p.center.yM) - 40).toBeGreaterThan(p.radiusM);
    }
  });

  it('falls back to the plain level where the terrain has no data', () => {
    const ref = scaleRingPoints(craters.patches[0], 80, () => NaN);
    expect(ref.points.every(q => q.y === -1897)).toBe(true);
  });
});

describe('density feedback', () => {
  it('reports a tie as a tie, not as "the Front carries more craters"', () => {
    expect(densityComparison(['Mare plain patch', 'Apennine Front patch'], 0, 0)).toMatch(/same density/);
    expect(densityComparison(['Mare plain patch', 'Apennine Front patch'], 14, 14)).toMatch(/same density/);
    expect(densityComparison(['Mare plain patch', 'Apennine Front patch'], 28, 14)).toMatch(/mare plain patch carries more/);
    expect(densityComparison(['Mare plain patch', 'Apennine Front patch'], 0, 14)).toMatch(/apennine front patch carries more/);
  });
});

describe('feature markers', () => {
  it('feature names are neutral and do not give the answer away', () => {
    const giveaways = /channel|rille|bowl|crater|rim|mountain|massif|plain|mare|volcan|impact/i;
    for (const f of features.features) {
      expect(f.name, f.id).not.toMatch(giveaways);
      expect(f.label, f.id).toMatch(/^[A-Z]$/);
    }
  });

  it('pins are far enough apart to read separately (> 400 m)', () => {
    const R = 1737400, d2r = Math.PI / 180;
    const fs = features.features;
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const dx = (fs[i].lon - fs[j].lon) * d2r * R * Math.cos(26.1 * d2r);
        const dy = (fs[i].lat - fs[j].lat) * d2r * R;
        expect(Math.hypot(dx, dy), `${fs[i].id}-${fs[j].id}`).toBeGreaterThan(400);
      }
    }
  });
});
