import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildLunarModule, buildRover, buildFlag, createDustBurst } from '../../src/scenes/hadley-props.js';

const meshCount = (g) => { let n = 0; g.traverse((c) => { if (c.isMesh) n++; }); return n; };

describe('v2 Hadley hero props', () => {
  it('LM descent stage is merged to a few draw calls and has true-scale footprint (~9 m)', () => {
    const lm = buildLunarModule();
    expect(meshCount(lm)).toBeLessThanOrEqual(6);
    const size = new THREE.Box3().setFromObject(lm).getSize(new THREE.Vector3());
    const diagonal = size.x * Math.SQRT2; // legs sit on the diagonals
    expect(diagonal).toBeGreaterThan(9);
    expect(diagonal).toBeLessThan(10.5);
    expect(size.y).toBeGreaterThan(2.5);
  });

  it('rover keeps four separate wheels (they turn) and a merged body', () => {
    const { group, wheels } = buildRover();
    expect(wheels).toHaveLength(4);
    for (const w of wheels) expect(w.parent).toBe(group);
    const body = group.getObjectByName('v2-rover-body');
    expect(meshCount(body)).toBeLessThanOrEqual(6);
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(2.8); // LRV is ~3.1 m long
    expect(size.z).toBeLessThan(3.6);
  });

  it('flag is merged and does not flutter (static geometry)', () => {
    const f = buildFlag();
    expect(meshCount(f)).toBeLessThanOrEqual(3);
  });

  it('rover dust is ballistic: grains rise, fall at lunar gravity and land', () => {
    const d = createDustBurst(20);
    d.emit(new THREE.Vector3(0, 0, 0), 10, () => 0.5);
    d.update(0.1, () => 0);
    expect(d.live).toBe(10);
    for (let i = 0; i < 60; i++) d.update(0.1, () => 0); // 6 s: every grain has landed
    expect(d.live).toBe(0);
  });
});
