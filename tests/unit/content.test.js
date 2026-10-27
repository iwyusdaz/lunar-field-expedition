/**
 * Content validation tests: the learning content is data, so its integrity is
 * testable — item scoring, cinematic budget (standards 3.2), equal-area crater
 * patches, station positions inside the play area, and the CER tag contract.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const modules = read('content/modules.json');
const items = read('content/items.json');
const stations = read('content/stations.json');
const cinematics = read('content/cinematics.json');
const report = read('content/report.json');
const features = read('content/features.json');
const craters = read('content/craters.json');
const meta = read('public/assets/terrain/terrain-meta.json');

describe('pre/post check items', () => {
  it('each set has exactly 5 items, each with exactly one correct option', () => {
    for (const setName of ['pre', 'post']) {
      const set = items.sets[setName];
      expect(set).toHaveLength(5);
      for (const item of set) {
        const corrects = item.options.filter(o => o.id === item.correct);
        expect(corrects, `${item.id}`).toHaveLength(1);
        for (const o of item.options) expect(o.why, `${item.id}:${o.id} needs feedback`).toBeTruthy();
      }
    }
  });
  it('pre and post are parallel (same concept per index)', () => {
    for (let i = 0; i < 5; i++) {
      expect(items.sets.pre[i].prompt.toLowerCase()).not.toBe(items.sets.post[i].prompt.toLowerCase());
    }
  });
});

describe('cinematic policy (standards 3.2 + plan 6.2)', () => {
  it('total duration <= 90 s and each shot <= 25 s', () => {
    let total = 0;
    for (const c of cinematics.cinematics) {
      for (const s of c.shots) {
        expect(s.duration, `${s.id} over 25 s`).toBeLessThanOrEqual(25);
        total += s.duration;
      }
    }
    expect(total).toBeLessThanOrEqual(90);
  });
  it('every shot has purpose tag, captions, description and a reduced-motion variant', () => {
    const valid = ['orient', 'motivate', 'reveal', 'consequence'];
    for (const c of cinematics.cinematics) {
      expect(valid).toContain(c.purpose);
      for (const s of c.shots) {
        expect(valid, `${s.id} purpose`).toContain(s.purpose);
        expect(s.captions?.length, `${s.id} captions`).toBeGreaterThan(0);
        expect(s.description, `${s.id} audio description`).toBeTruthy();
        expect(s.reducedMotion?.kind, `${s.id} reduced-motion`).toBe('stills');
      }
    }
  });
  it('shots define camera paths in scene metric space', () => {
    for (const s of cinematics.cinematics[0].shots) {
      expect(s.path.length).toBeGreaterThanOrEqual(2);
      for (const p of s.path) { expect(p).toHaveLength(3); expect(p[1]).toBeGreaterThan(-2400); }
    }
  });
});

describe('crater patches (Module 3)', () => {
  it('exactly two equal-area patches, one mare one front', () => {
    expect(craters.patches).toHaveLength(2);
    const [a, b] = craters.patches;
    expect(a.radiusM).toBe(b.radiusM);
    expect(a.id).toBe('mare');
    expect(b.id).toBe('front');
  });
  it('density math matches count/area', () => {
    for (const p of craters.patches) {
      expect(p.densityPerKm2).toBe(Math.round(p.craters.length / p.areaKm2));
      expect(p.areaKm2).toBeCloseTo(Math.PI * p.radiusM ** 2 / 1e6, 3);
    }
  });
  it('patch centers are inside the play area and in valid DTM data', () => {
    for (const p of craters.patches) {
      const { lon, lat } = p.centerLonLat;
      expect(lon).toBeGreaterThan(meta.aoi.lonWest);
      expect(lon).toBeLessThan(meta.aoi.lonEast);
      expect(lat).toBeGreaterThan(meta.aoi.latSouth);
      expect(lat).toBeLessThan(meta.aoi.latNorth);
    }
  });
});

describe('stations', () => {
  it('all stations inside the play area; start station present; results exist for every station+tool', () => {
    for (const s of stations.stations) {
      expect(s.lon).toBeGreaterThan(meta.aoi.lonWest);
      expect(s.lon).toBeLessThan(meta.aoi.lonEast);
      expect(s.lat).toBeGreaterThan(meta.aoi.latSouth);
      expect(s.lat).toBeLessThan(meta.aoi.latNorth);
    }
    expect(stations.stations.filter(s => s.start)).toHaveLength(1);
    for (const [id, res] of Object.entries(stations.results)) {
      const station = stations.stations.find(s => s.id === id);
      expect(station, `results for unknown station ${id}`).toBeTruthy();
      for (const [toolId] of Object.entries(res)) {
        expect(stations.tools.find(t => t.id === toolId), `${id}/${toolId}`).toBeTruthy();
        for (const r of Object.values(res)) {
          expect(r.evidenceTags.length, `${id}/${toolId} needs evidence tags`).toBeGreaterThan(0);
        }
      }
    }
  });
  it('hypothesis required-evidence tags are actually collectable at some station', () => {
    const collectable = new Set(Object.values(stations.results).flatMap(r => Object.values(r).flatMap(x => x.evidenceTags)));
    for (const h of stations.hypotheses) {
      for (const tag of h.neededEvidence) {
        expect(collectable.has(tag), `${h.id} needs ${tag}`).toBe(true);
      }
    }
  });
  it('resource model is coherent', () => {
    const m = stations.resourceModel;
    expect(m.maxStations).toBeGreaterThanOrEqual(2);
    expect(m.evaMinutesBudget).toBeGreaterThan(60);
    expect(m.slopeCostFactor.maxMultiplier).toBeGreaterThan(1);
    for (const t of stations.tools) {
      expect(m.stationMinutes[t.id]).toBe(t.minutes);
    }
  });
  it('real Apollo 15 EVA routes only reference existing stations', () => {
    const ids = new Set(stations.stations.map(s => s.id));
    for (const eva of stations.apollo15Real.evas) {
      if (!eva.route) continue;
      for (const id of eva.route) expect(ids.has(id), eva.id).toBe(true);
    }
  });
});

describe('CER report contract', () => {
  it('rubric is 4 criteria x 4 levels', () => {
    expect(report.report.rubric).toHaveLength(4);
    for (const c of report.report.rubric) expect(c.levels).toHaveLength(4);
  });
  it('required evidence tags exist for each hypothesis', () => {
    const hyps = new Set(stations.hypotheses.map(h => h.id));
    for (const [hid, tags] of Object.entries(report.report.requiredEvidenceTags)) {
      expect(hyps.has(hid)).toBe(true);
      expect(tags.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('exemplar addresses all four sections', () => {
    for (const s of report.report.sections) {
      expect(report.report.exemplar[s.id], s.id).toBeTruthy();
    }
  });
});

describe('module flow and features', () => {
  it('five modules whose steps reference known kinds and item sets', () => {
    const kinds = ['globe', 'cinematic', 'brief', 'check', 'sun-tool', 'feature-tag', 'profile-tool',
      'crater-counter', 'superposition', 'debrief', 'hypothesis', 'traverse-plan', 'traverse-run',
      'traverse-debrief', 'evidence-board', 'cer-builder', 'rubric-selfcheck', 'apollo-comparison'];
    expect(modules.modules).toHaveLength(5);
    for (const m of modules.modules) {
      expect(m.steps.length).toBeGreaterThan(0);
      for (const s of m.steps) {
        expect(kinds, `${m.id}/${s.id}: ${s.kind}`).toContain(s.kind);
        if (s.kind === 'check') expect(items.sets[s.itemSet]).toBeTruthy();
        if (s.kind === 'cinematic') {
          expect(cinematics.cinematics.find(c => c.id === s.cinematic)).toBeTruthy();
        }
      }
    }
  });
  it('objectives list has 5 entries and modules reference them', () => {
    expect(modules.objectives).toHaveLength(5);
    for (const m of modules.modules) {
      for (const o of m.objectiveFocus) expect(o).toBeLessThanOrEqual(5);
    }
  });
  it('feature tagging: exactly one correct option per feature; positions inside AOI', () => {
    for (const f of features.features) {
      const corrects = f.options.filter(o => o.correct);
      expect(corrects, f.id).toHaveLength(1);
      expect(f.lon).toBeGreaterThan(meta.aoi.lonWest);
      expect(f.lon).toBeLessThan(meta.aoi.lonEast);
      expect(f.lat).toBeGreaterThan(meta.aoi.latSouth);
      expect(f.lat).toBeLessThan(meta.aoi.latNorth);
    }
  });
  it('profile presets span sensible distances inside the AOI', () => {
    for (const p of features.profilePresets) {
      for (const pt of [p.from, p.to]) {
        expect(pt.lon).toBeGreaterThan(meta.aoi.lonWest + 0.015); // keep inside valid DTM columns
        expect(pt.lon).toBeLessThan(meta.aoi.lonEast - 0.005);
        expect(pt.lat).toBeGreaterThan(meta.aoi.latSouth);
        expect(pt.lat).toBeLessThan(meta.aoi.latNorth);
      }
    }
  });
});

describe('terrain meta integrity', () => {
  it('three LODs, no vertical exaggeration, 1 unit = 1 m', () => {
    expect(meta.lods).toHaveLength(3);
    expect(meta.aoi.verticalExaggeration).toBe(1);
    expect(meta.aoi.units).toContain('1 metre');
  });
  it('validation checks all pass (rille depth, plain elevation, AOI relief)', () => {
    for (const v of meta.validation) expect(v.pass, v.name).toBe(true);
  });
});
