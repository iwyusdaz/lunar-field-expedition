import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sunDirection, shadowLengthFactor, validatePresets } from '../../src/systems/sun-model.js';
import { segmentCost, planAccounting, scoreTraverse, buildSegmentTable } from '../../src/systems/traverse-model.js';
import { scoreAnswers } from '../../src/learning/assess.js';

const features = JSON.parse(readFileSync('content/features.json', 'utf8'));
const stations = JSON.parse(readFileSync('content/stations.json', 'utf8'));

describe('sun model', () => {
  it('points up at zenith and east at 90/0', () => {
    const up = sunDirection(89, 0);
    expect(up.y).toBeGreaterThan(0.99);
    const east = sunDirection(0.01, 90);
    expect(east.x).toBeGreaterThan(0.99);
    expect(east.y).toBeLessThan(0.02);
  });
  it('south means +z (the scene uses +z = south)', () => {
    const s = sunDirection(45, 180);
    expect(s.z).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });
  it('unit length for arbitrary angles', () => {
    for (const [e, a] of [[12, 90], [55, 100], [6, 88], [33, 217]]) {
      const v = sunDirection(e, a);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
    }
  });
  it('shadow length factor matches 1/tan(elevation)', () => {
    expect(shadowLengthFactor(45)).toBeCloseTo(1, 5);
    expect(shadowLengthFactor(12)).toBeCloseTo(4.70, 2); // near-sunrise preset
    expect(shadowLengthFactor(6)).toBeGreaterThan(9);
  });
  it('validates the content presets and rejects broken ones', () => {
    expect(validatePresets(features.sunPresets)).toBe(true);
    expect(() => validatePresets([{ id: 'x', elevationDeg: 120, azimuthDeg: 90 }])).toThrow();
    expect(() => validatePresets([{ id: 'x', elevationDeg: 30, azimuthDeg: 400 }])).toThrow();
  });
});

const model = stations.resourceModel;

describe('traverse cost model', () => {
  it('flat segments cost distance/speed; slopes cost more up to the cap', () => {
    const flat = segmentCost(1000, 0.0, model);
    expect(flat.minutes).toBeCloseTo((1 / 8) * 60, 3); // 1 km at 8 km/h = 7.5 min
    expect(flat.slopeMultiplier).toBe(1);
    const steep = segmentCost(1000, 0.25, model);
    // mult = 1 + 9 * (0.25 - 0.05) = 2.8
    expect(steep.slopeMultiplier).toBeCloseTo(2.8, 5);
    expect(steep.minutes).toBeCloseTo(flat.minutes * 2.8, 5);
    const capped = segmentCost(1000, 0.9, model);
    expect(capped.slopeMultiplier).toBe(model.slopeCostFactor.maxMultiplier);
  });

  it('planAccounting sums drive + dwell and computes consumables', () => {
    const route = [{ id: 'lm', toolId: null }, { id: 'elbow', toolId: 'sample' }];
    const segments = [
      { fromId: 'lm', toId: 'elbow', distanceM: 3200, worstSlope: 0.02, sampleable: true },
    ];
    const acc = planAccounting(route, segments, model);
    expect(acc.error).toBeUndefined();
    expect(acc.driveMinutes).toBeCloseTo((3.2 / 8) * 60, 3);
    expect(acc.stationMinutes).toBe(model.stationMinutes.sample);
    expect(acc.totalMinutes).toBeCloseTo(acc.driveMinutes + 20, 3);
    expect(acc.withinBudget).toBe(true);
    expect(acc.consumablesLeft).toBeCloseTo(100 - (acc.totalMinutes / 60) * 6, 1);
  });

  it('flags missing segments and over-budget plans', () => {
    const acc = planAccounting([{ id: 'lm' }, { id: 'spur' }], [{ fromId: 'lm', toId: 'elbow', distanceM: 1, worstSlope: 0 }], model);
    expect(acc.error).toContain('lm>spur');
    const long = planAccounting(
      [{ id: 'lm' }, { id: 'x', toolId: 'sample' }],
      [{ fromId: 'lm', toId: 'x', distanceM: 40000, worstSlope: 0 }],
      model,
    );
    expect(long.withinBudget).toBe(false);
  });

  it('scoreTraverse checks evidence coverage, budget, station count and method variety', () => {
    const hyp = { neededEvidence: ['front-material', 'mare-material'], maxStations: 4 };
    const good = scoreTraverse({
      hypothesis: 'h-front',
      route: [{ id: 'lm' }, { id: 'a', toolId: 'sample' }, { id: 'b', toolId: 'photograph' }],
      accounting: { withinBudget: true, totalMinutes: 100 },
      evidenceTags: ['front-material', 'mare-material'],
    }, hyp);
    expect(good.metCount).toBe(4);
    const bad = scoreTraverse({
      hypothesis: 'h-front',
      route: [{ id: 'lm' }, { id: 'a', toolId: 'sample' }],
      accounting: { withinBudget: false, totalMinutes: 300 },
      evidenceTags: ['mare-material'],
    }, hyp);
    // only the station-count criterion passes (1 station is within the limit)
    expect(bad.metCount).toBe(1);
    expect(bad.criteria.find(c => c.id === 'evidence-coverage').met).toBe(false);
    expect(bad.criteria.find(c => c.id === 'budget').met).toBe(false);
    expect(bad.criteria.find(c => c.id === 'method-variety').met).toBe(false);
  });

  it('buildSegmentTable produces both directions with slope data', () => {
    const segs = buildSegmentTable(
      [{ id: 'a', xM: 0, yM: 0 }, { id: 'b', xM: 100, yM: 0 }],
      () => ({ average: 0.1, worst: 0.2 }),
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ fromId: 'a', toId: 'b', distanceM: 100, worstSlope: 0.2, sampleable: true });
  });
});

describe('assessment scoring', () => {
  it('scores answered items and reports per-item results', () => {
    const s = scoreAnswers([
      { itemId: 'a', correct: true },
      { itemId: 'b', correct: false },
      { itemId: 'c', correct: true },
    ]);
    expect(s.correct).toBe(2);
    expect(s.total).toBe(3);
    expect(s.ratio).toBeCloseTo(2 / 3, 5);
    expect(s.byItem.b).toBe(false);
  });
});
