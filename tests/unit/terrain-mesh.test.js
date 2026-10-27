import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TerrainField } from '../../src/scenes/terrain.js';

// GPU drivers reject a whole drawElements call (INVALID_OPERATION) when any
// index points past the vertex buffer; software WebGL tolerates it, so headless
// browser tests never noticed the terrain rendering black on a real GPU.
function meshFor(width, height, step) {
  const t = new TerrainField();
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = -1900 + (i % 7);
  t.grid = { width, height, mPerPx: 10, data };
  t.material = new THREE.MeshBasicMaterial();
  return t._buildMesh(step);
}

describe('terrain mesh', () => {
  for (const [w, h, step] of [[51, 41, 1], [51, 41, 2], [64, 37, 4], [9, 9, 2]]) {
    it(`keeps every index inside the vertex buffer (${w}x${h}, step ${step})`, () => {
      const geo = meshFor(w, h, step).geometry;
      const count = geo.attributes.position.count;
      let max = 0;
      for (const i of geo.index.array) if (i > max) max = i;
      expect(max).toBeLessThan(count);
      expect(geo.index.count % 3).toBe(0);
    });
  }

  it('drops skirt vertices below the surface', () => {
    const geo = meshFor(21, 21, 2).geometry;
    const pos = geo.attributes.position;
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
    expect(minY).toBeLessThanOrEqual(-1900 - 80);
  });

  it('has finite positions, normals and uvs', () => {
    const geo = meshFor(33, 25, 2).geometry;
    for (const name of ['position', 'normal', 'uv']) {
      for (const v of geo.attributes[name].array) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
