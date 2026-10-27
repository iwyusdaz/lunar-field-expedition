import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scaleRingPoints, densityComparison } from '../../src/systems/crater-counter.js';
import { captionIndexAt, captionText } from '../../src/cinematics/shot-player.js';

describe('timed cinematic captions', () => {
  const cin = JSON.parse(readFileSync(new URL('../../content/cinematics.json', import.meta.url), 'utf8'));
  it('every caption has an "at" time in [0,1), the first at 0, in increasing order', () => {
    for (const c of cin.cinematics) for (const s of c.shots) {
      const ats = s.captions.map(x => x.at);
      expect(ats[0], s.id).toBe(0);
      for (let i = 0; i < ats.length; i++) {
        expect(ats[i]).toBeGreaterThanOrEqual(0);
        expect(ats[i]).toBeLessThan(1);
        if (i) expect(ats[i]).toBeGreaterThan(ats[i - 1]);
      }
    }
  });
  it('shows one caption at a time, switching at its "at" time', () => {
    const caps = [{ at: 0, text: 'one' }, { at: 0.62, text: 'two' }];
    expect(captionText(caps[captionIndexAt(caps, 0)])).toBe('one');
    expect(captionText(caps[captionIndexAt(caps, 0.61)])).toBe('one');
    expect(captionText(caps[captionIndexAt(caps, 0.62)])).toBe('two');
    expect(captionText(caps[captionIndexAt(caps, 1)])).toBe('two');
    expect(captionIndexAt([], 0.5)).toBe(-1);
    // plain strings are spread evenly
    expect(captionIndexAt(['a', 'b'], 0.49)).toBe(0);
    expect(captionIndexAt(['a', 'b'], 0.5)).toBe(1);
  });
  it('the landing-site caption of s1 does not show while the camera is still over the Front', () => {
    const s1 = cin.cinematics[0].shots[0];
    const i = s1.captions.findIndex(c => /landing site/.test(c.text));
    expect(s1.captions[i].at).toBeGreaterThan(0.5);
  });
});

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
