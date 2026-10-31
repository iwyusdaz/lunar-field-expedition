// v3 scene maths, motion labels and Now-card limits (plan 10 §2.1, §5, §6.1).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  earthDirection, elevAz, sunDirectionForHourAngle, hourAngleForElevation, MAX_SUN_ELEVATION_DEG,
  curvatureDrop, horizonDistance, angularDiameter, equatorialToWorldMatrix, applyMatrix3,
  pendulumPeriod, hopHeight, OBLIQUITY_DEG, SUN_ECLIPTIC_LON_DEG,
  EARTH_DIAMETER_M, EARTH_DISTANCE_M, SUN_DIAMETER_M, SUN_DISTANCE_M,
} from '../../src/lunar/frame.js';
import { SKY_RADIUS } from '../../src/lunar/sky.js';
import { SurfaceScene } from '../../src/lunar/surface.js';
import { Lessons, short } from '../../src/lunar/lessons.js';
import { MotionLayerManager } from '../../src/v3/motion-layers.js';
import { createCatalog, countWords } from '../../src/v3/catalog.js';
import catalogRaw from '../../content/objects.json';
import modules from '../../content/modules.json';
import items from '../../content/items.json';
import stations from '../../content/stations.json';
import cinematics from '../../content/cinematics.json';
import report from '../../content/report.json';
import features from '../../content/features.json';
import craters from '../../content/craters.json';

const deg = (r) => (r * 180) / Math.PI;

describe('Hadley sky geometry (frame.js)', () => {
  it('Earth stands about 63.5 deg up, a little west of south, and never moves with the Sun', () => {
    const e = elevAz(earthDirection());
    expect(e.elevationDeg).toBeCloseTo(63.5, 0);
    expect(e.azimuthDeg).toBeGreaterThan(180);
    expect(e.azimuthDeg).toBeLessThan(195);
  });
  it('the morning Sun rises in the east and its elevation round-trips', () => {
    for (const el of [6, 12, 28, 55]) {
      const s = elevAz(sunDirectionForHourAngle(hourAngleForElevation(el)));
      expect(s.elevationDeg).toBeCloseTo(el, 4);
      expect(s.azimuthDeg).toBeGreaterThan(80);
      expect(s.azimuthDeg).toBeLessThan(180);
    }
    expect(MAX_SUN_ELEVATION_DEG).toBeCloseTo(63.87, 1);
  });
  it('stars and the Sun share one frame: the Sun\'s J2000 position lands on the Sun direction', () => {
    const h = hourAngleForElevation(15);
    const L = (SUN_ECLIPTIC_LON_DEG * Math.PI) / 180, e = (OBLIQUITY_DEG * Math.PI) / 180;
    const eq = [Math.cos(L), Math.sin(L) * Math.cos(e), Math.sin(L) * Math.sin(e)];
    const w = applyMatrix3(equatorialToWorldMatrix(h), eq);
    const s = sunDirectionForHourAngle(h);
    expect(w.x).toBeCloseTo(s.x, 6); expect(w.y).toBeCloseTo(s.y, 6); expect(w.z).toBeCloseTo(s.z, 6);
  });
  it('true angular sizes on the sky shell and the close horizon', () => {
    const earth = 2 * SKY_RADIUS.earth * Math.tan(Math.atan(EARTH_DIAMETER_M / 2 / EARTH_DISTANCE_M));
    expect(deg(angularDiameter(earth, SKY_RADIUS.earth))).toBeCloseTo(1.9, 1);
    const sun = 2 * SKY_RADIUS.sun * Math.tan(Math.atan(SUN_DIAMETER_M / 2 / SUN_DISTANCE_M));
    expect(deg(angularDiameter(sun, SKY_RADIUS.sun))).toBeCloseTo(0.533, 2);
    expect(curvatureDrop(20000)).toBeCloseTo(115, 0);
    expect(horizonDistance(1.7) / 1000).toBeCloseTo(2.43, 1); // the catalog says about 2.4 km
  });
  it('lunar-gravity motion: the sample-bag pendulum is 2.46 x slower than on Earth; a lope hop is ~0.37 m', () => {
    expect(pendulumPeriod(0.12)).toBeCloseTo(1.71, 2);
    expect(pendulumPeriod(0.12) / (2 * Math.PI * Math.sqrt(0.12 / 9.81))).toBeCloseTo(2.46, 1);
    expect(hopHeight(1.1)).toBeCloseTo(0.373, 2);
  });
});

describe('surface motion systems (plan 10 §5)', () => {
  const catalog = createCatalog(catalogRaw);
  const s = new SurfaceScene({}, { stations: stations.stations, craters });
  s.lm = new THREE.Vector3(3600, -1923, 5700);
  s.crewB = {};
  const m = new MotionLayerManager({ root: null });
  s.addMotion(m);
  it('at least eight systems over all four layers', () => {
    const r = m.report();
    expect(r.ok).toBe(true);
    expect(r.total).toBeGreaterThanOrEqual(8);
    expect(r.missing).toEqual([]);
  });
  it('every time-lapse or illustrative motion is named on a card that says so', () => {
    expect(m.checkLabels(catalog)).toEqual([]);
  });
  it('no twinkle, no meteor streaks, no flag flutter in the motion list (decision 8)', () => {
    const text = m.report().systems.map((x) => `${x.id} ${x.description}`).join(' ').toLowerCase();
    expect(text).not.toMatch(/twinkl|streak(?!s because)|flutter|wave/);
  });
});

describe('Now cards (plan 10 §2.1: at most 60 words)', () => {
  const L = new Lessons({ slug: 'unit', content: { modules, items, stations, cinematics, report, features, craters } });
  const mods = L.modules();
  const app = { engine: null, record: { log() {} }, shell: { touch: false, setNow() {}, toast() {}, setModuleDone() {} }, module: 0, goModule() {}, completeModule() {} };
  L.app = app; L.record = app.record;
  const words = (n) => countWords([n.kicker, n.goal, n.action, n.hint, n.question?.prompt, ...(n.question?.choices || []).map((c) => c.text), n.primary?.label, n.secondary?.label, n.readMore?.label].filter(Boolean).join(' '));
  for (const [i, steps] of L.steps.entries()) {
    for (const [k, st] of steps.entries()) {
      it(`${mods[i].id} step ${k + 1} (${st.id})`, () => {
        L.step[i] = k;
        const n = L.nowFor(i);
        // Compact tools (slider, letters, counters) add a few words on top, so cards with a tool
        // keep a margin; ui-audit measures the real card at every viewport.
        expect(words(n)).toBeLessThanOrEqual(n.tool && st.id !== 'm2-tag' ? 52 : 60);
      });
    }
  }
  it('short() keeps feedback to one sentence', () => {
    expect(short('Correct. The low Sun casts long shadows. More text here.')).toBe('The low Sun casts long shadows.');
  });
});
describe('orbit globe geography (review F1)', async () => {
  const { globePoint, START_SPIN } = await import('../../src/lunar/orbit.js');
  /** Texture lat/lon at the SphereGeometry vertex nearest a direction. */
  const geo = new THREE.SphereGeometry(1, 360, 180);
  const P = geo.attributes.position, UV = geo.attributes.uv;
  const sample = (v) => {
    let best = -2, k = 0;
    for (let i = 0; i < P.count; i++) { const d = P.getX(i) * v.x + P.getY(i) * v.y + P.getZ(i) * v.z; if (d > best) { best = d; k = i; } }
    return { lon: UV.getX(k) * 360 - 180, lat: (UV.getY(k) - 0.5) * 180 };
  };
  it('globePoint(lat, lon) lands on the same lat/lon of the map', () => {
    for (const [lat, lon] of [[26.13, 3.63], [32.8, -15.6], [17, 59], [-10, -120], [0, 0], [45, 90]]) {
      const s = sample(globePoint(lat, lon, 1));
      expect(Math.abs(s.lat - lat)).toBeLessThan(1.1);
      expect(Math.abs(((s.lon - lon + 540) % 360) - 180)).toBeLessThan(1.1);
    }
  });
  it('east is to the right of a viewer facing the near side, and the start view sees Hadley and Imbrium', () => {
    // Facing 0 N 0 E from outside: screen right = up x back.
    const back = globePoint(0, 0, 1);
    const right = new THREE.Vector3(0, 1, 0).cross(back);
    expect(globePoint(0, 60, 1).dot(right)).toBeGreaterThan(0.8); // Mare Crisium side
    const view = { theta: Math.PI * 0.94, phi: Math.PI * 0.42 };
    const cam = new THREE.Vector3(Math.sin(view.phi) * Math.sin(view.theta), Math.cos(view.phi), Math.sin(view.phi) * Math.cos(view.theta));
    const spun = (lat, lon) => globePoint(lat, lon, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), START_SPIN);
    expect(spun(26.13, 3.63).dot(cam)).toBeGreaterThan(0.9);
    expect(spun(32.8, -15.6).dot(cam)).toBeGreaterThan(0.75);
  });
});
