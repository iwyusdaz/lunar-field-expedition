// Astronaut ground contact (G2 owner feedback, screenshot 1): feet on the
// ground, boots turned to the slope, no part of a sole below the surface.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';

beforeAll(() => {
  // Node has no canvas: a stub 2D context is enough to build the textures.
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set: () => true,
  });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

/** Rolling ground: a 14 degree slope across x with 0.3 m bumps along z. */
const ground = (x, z) => Math.tan(THREE.MathUtils.degToRad(14)) * x + 0.3 * Math.sin(z * 0.8) + 0.1 * Math.sin(x * 1.7 + z);

async function figure(o) {
  const { createAstronaut } = await import('../../src/lunar/astronaut.js');
  const a = createAstronaut({ ground, ...o });
  new THREE.Group().add(a.root);
  return a;
}
const soleGap = (a, L) => {
  L.boot.updateWorldMatrix(true, false);
  const w = new THREE.Vector3();
  let lo = Infinity;
  for (const p of [[0, -0.09, -0.1], [0, -0.09, 0.19], [-0.065, -0.09, 0.05], [0.065, -0.09, 0.05]]) { L.boot.localToWorld(w.set(...p)); lo = Math.min(lo, w.y - ground(w.x, w.z)); }
  return lo;
};

describe('astronaut ground contact', () => {
  it('rest size matches the catalog figure (about 1.9 m to the top of the backpack)', async () => {
    const a = await figure();
    const [, h] = a.root.userData.restSize;
    expect(h).toBeGreaterThan(1.84);
    expect(h).toBeLessThan(1.95);
  });

  it('lope along a curved path over rolling ground: no sole below the surface, planted feet touch it, the boot follows the slope', async () => {
    const a = await figure({ phase: 0 });
    a.setAction('lope');
    let worst = Infinity, plantedMax = 0, frames = 0, flights = 0, tilt = 0;
    let wasPlanted = true;
    for (let i = 0; i < 900; i++) { // 15 s at 60 fps
      const t = i / 60, x = 6 * Math.sin(t * 0.2), z = 6 * Math.cos(t * 0.2) - 6;
      a.root.position.set(x, a.root.position.y, z);
      a.root.rotation.y = Math.atan2(Math.cos(t * 0.2), -Math.sin(t * 0.2));
      a.update(1 / 60);
      for (const L of a.legs) {
        const g = soleGap(a, L);
        worst = Math.min(worst, g);
        if (L.planted) {
          plantedMax = Math.max(plantedMax, g);
          frames++;
          // Sole normal against the ground normal at the foot.
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(L.boot.getWorldQuaternion(new THREE.Quaternion()));
          const d = 0.25, p = L.world;
          const n = new THREE.Vector3(-(ground(p.x + d, p.z) - ground(p.x - d, p.z)) / (2 * d), 1, -(ground(p.x, p.z + d) - ground(p.x, p.z - d)) / (2 * d)).normalize();
          tilt = Math.max(tilt, up.angleTo(n));
        }
      }
      const pl = a.legs[0].planted;
      if (wasPlanted && !pl) flights++;
      wasPlanted = pl;
    }
    expect(worst).toBeGreaterThan(-0.003); // no overlap anywhere along the path
    expect(plantedMax).toBeLessThan(0.03); // a planted sole rests on the ground
    expect(frames).toBeGreaterThan(100);
    expect(flights).toBeGreaterThan(8); // about one skip per second
    expect(THREE.MathUtils.radToDeg(tilt)).toBeLessThan(6);
  });

  it('standing and sampling with the tongs on a slope: feet on the ground, tongs tip never below it', async () => {
    const a = await figure({ tongs: true });
    a.root.position.set(2, 0, 1);
    a.root.rotation.y = 1.1;
    a.setAction('sample');
    let worst = Infinity, gapMax = 0, tipLow = Infinity, tipMin = Infinity;
    let tip = null;
    a.root.traverse((m) => { if (m.name === 'tongs-hard') tip = m; });
    for (let i = 0; i < 7 * 60; i++) {
      a.update(1 / 60);
      for (const L of a.legs) { const g = soleGap(a, L); worst = Math.min(worst, g); gapMax = Math.max(gapMax, g); }
      const w = new THREE.Vector3(0, -0.84, 0);
      tip.parent.localToWorld(w);
      tipLow = Math.min(tipLow, w.y - ground(w.x, w.z));
      tipMin = Math.min(tipMin, tipLow);
    }
    expect(worst).toBeGreaterThan(-0.003);
    expect(gapMax).toBeLessThan(0.03);
    expect(tipMin).toBeGreaterThan(-0.01);
    expect(tipMin).toBeLessThan(0.08); // the tongs do reach the ground
  });
});
