/**
 * TerrainField: the real Hadley–Apennine surface from LROC NAC_DTM_APOLLO15.
 *
 * Loads the committed 16-bit heightmap (L1, 10 m/px) on the CPU for geometry and
 * tool queries (elevation profiles, traverse costing) and the finer L2 normal map
 * (5 m/px) plus the WAC albedo crop as GPU textures. 1 unit = 1 metre, no
 * vertical exaggeration. World axes: +x = metres east from the AOI west edge,
 * +z = metres south from the AOI north edge, y = elevation in metres (LROC datum).
 *
 * The DTM has nodata at the west/east edges of its footprint (0 in the PNG).
 * Rendering edge-fills those columns with the nearest valid row value; tool
 * queries (profile, costing) see NaN and treat nodata as unsampleable.
 * @module scenes/terrain
 */
import * as THREE from 'three';
import { decodeHeightmap } from '../core/png.js';
import { loadJSON } from '../core/assets.js';

const BASE = import.meta.env.BASE_URL || './';

export class TerrainField {
  constructor() {
    this.ready = false;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.meta = null;
    this.grid = null; // { width, height, mPerPx, data: Float32Array (edge-filled) }
    this.rawGrid = null; // same, without edge fill (tool queries)
    this.mesh = null;
    this._gridStep = 2;
    this._currentStep = 0;
  }

  /**
   * @param {'low'|'medium'|'high'|'ultra'} presetName
   */
  async load(presetName = 'medium') {
    this.meta = await loadJSON('assets/terrain/terrain-meta.json');
    const l1 = this.meta.lods[1];
    const [pngBuf, metaRes] = await Promise.all([
      fetch(`${BASE}assets/terrain/height-l1.png`).then(r => r.arrayBuffer()),
      Promise.resolve(l1),
    ]);
    void metaRes;
    const decoded = await decodeHeightmap(pngBuf, l1);
    this.rawGrid = { width: decoded.width, height: decoded.height, mPerPx: l1.mPerPx, data: decoded.data };
    // Edge fill for rendering (nearest valid value in the row).
    const data = new Float32Array(decoded.data);
    const { width: w, height: h } = decoded;
    for (let y = 0; y < h; y++) {
      let first = -1, last = -1;
      for (let x = 0; x < w; x++) { if (!Number.isNaN(data[y * w + x])) { if (first < 0) first = x; last = x; } }
      if (first < 0) continue;
      for (let x = 0; x < first; x++) data[y * w + x] = data[y * w + first];
      for (let x = last + 1; x < w; x++) data[y * w + x] = data[y * w + last];
    }
    this.grid = { width: w, height: h, mPerPx: l1.mPerPx, data };
    this.ready = true;
    this.setQuality(presetName);
    return this;
  }

  /** Rebuild the mesh at a grid step suited to the preset. */
  setQuality(presetName) {
    this._gridStep = presetName === 'low' ? 4 : presetName === 'ultra' ? 1 : 2;
    if (this._currentStep === this._gridStep) return;
    this._currentStep = this._gridStep;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.mesh = this._buildMesh(this._gridStep);
    this.group.add(this.mesh);
  }

  _buildMesh(step) {
    const { width: w, height: h, mPerPx, data } = this.grid;
    const cols = Math.floor((w - 1) / step) + 1;
    const rows = Math.floor((h - 1) / step) + 1;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const elevAt = (x, y) => data[y * w + x];
    // vertex rows: 0..rows-1 are the surface, rows..rows+3 are skirt rings
    const idx = (ix, iy) => iy * cols + ix;
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const px = Math.min(w - 1, ix * step), py = Math.min(h - 1, iy * step);
        const x = px * mPerPx, z = py * mPerPx, y = elevAt(px, py);
        positions.push(x, y, z);
        // normal from central differences of the raw grid (10 m baseline)
        const hl = elevAt(Math.max(0, px - 1), py), hr = elevAt(Math.min(w - 1, px + 1), py);
        const hu = elevAt(px, Math.max(0, py - 1)), hd = elevAt(px, Math.min(h - 1, py + 1));
        const nx = -(hr - hl) / (2 * mPerPx), nz = -(hd - hu) / (2 * mPerPx);
        const len = Math.hypot(nx, 1, nz);
        normals.push(nx / len, 1 / len, nz / len);
        uvs.push(px / (w - 1), py / (h - 1));
      }
    }
    for (let iy = 0; iy < rows - 1; iy++) {
      for (let ix = 0; ix < cols - 1; ix++) {
        const a = idx(ix, iy), b = idx(ix + 1, iy), c = idx(ix, iy + 1), d = idx(ix + 1, iy + 1);
        indices.push(a, c, b, b, c, d);
      }
    }
    // skirts: drop each boundary vertex 80 m so LOD/frame edges never show gaps
    const skirtDepth = 80;
    const edges = [];
    for (let ix = 0; ix < cols; ix++) edges.push([ix, 0]);
    for (let ix = 0; ix < cols; ix++) edges.push([ix, rows - 1]);
    for (let iy = 1; iy < rows - 1; iy++) edges.push([0, iy]);
    for (let iy = 1; iy < rows - 1; iy++) edges.push([cols - 1, iy]);
    const skirtStart = positions.length / 3;
    for (const [ix, iy] of edges) {
      const i3 = idx(ix, iy) * 3;
      positions.push(positions[i3], positions[i3 + 1] - skirtDepth, positions[i3 + 2]);
      normals.push(normals[i3], normals[i3 + 1], normals[i3 + 2]);
      uvs.push(uvs[idx(ix, iy) * 2], uvs[idx(ix, iy) * 2 + 1]);
    }
    // connect each surface boundary vertex to its skirt twin; the skirt strip is
    // stitched to the boundary row by re-triangulating with the skirt copy
    const boundaryQuads = [];
    for (let ix = 0; ix < cols - 1; ix++) { boundaryQuads.push([idx(ix, 0), idx(ix + 1, 0), skirtStart + ix, skirtStart + ix + 1]); }
    for (let ix = 0; ix < cols - 1; ix++) { const base = cols; boundaryQuads.push([idx(ix, rows - 1), skirtStart + base + ix, idx(ix + 1, rows - 1), skirtStart + base + ix + 1]); }
    for (let iy = 1; iy < rows - 1; iy++) {
      const baseW = 2 * cols; boundaryQuads.push([idx(0, iy), skirtStart + baseW + (iy - 1), idx(0, iy + 1), skirtStart + baseW + iy]);
      const baseE = 2 * cols + (rows - 2); boundaryQuads.push([idx(cols - 1, iy), skirtStart + baseE + iy, idx(cols - 1, iy + 1), skirtStart + baseE + iy + 1]);
    }
    for (const [a, b, c, d] of boundaryQuads) {
      indices.push(a, c, d, a, d, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, this.material || this._buildMaterial());
  }

  _buildMaterial() {
    const albedo = new THREE.TextureLoader().load(`${BASE}assets/terrain/albedo-wac.png`);
    albedo.colorSpace = THREE.SRGBColorSpace;
    const normalMap = new THREE.TextureLoader().load(`${BASE}assets/terrain/normal-l2.png`);
    this.material = new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap,
      roughness: 0.96,
      metalness: 0.0,
    });
    return this.material;
  }

  /** Swap the normal map for a coarser one on the Low preset (texture budget). */
  useCoarseNormalMap() {
    if (!this.material) return;
    const coarse = new THREE.TextureLoader().load(`${BASE}assets/terrain/normal-l1.png`);
    this.material.normalMap = coarse;
    this.material.needsUpdate = true;
  }

  // ---------- metric queries (tools) -----------------------------------------

  /** Bilinear elevation (metres) at metric x east / y south from the AOI NW corner. */
  elevationAt(xM, yM) {
    const g = this.rawGrid;
    const fx = xM / g.mPerPx, fy = yM / g.mPerPx;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= g.width - 1 || y0 >= g.height - 1) return NaN;
    const tx = fx - x0, ty = fy - y0;
    const g00 = g.data[y0 * g.width + x0], g10 = g.data[y0 * g.width + x0 + 1];
    const g01 = g.data[(y0 + 1) * g.width + x0], g11 = g.data[(y0 + 1) * g.width + x0 + 1];
    if ([g00, g10, g01, g11].some(Number.isNaN)) return NaN;
    return (g00 * (1 - tx) + g10 * tx) * (1 - ty) + (g01 * (1 - tx) + g11 * tx) * ty;
  }

  /** Terrain world position (THREE.Vector3, y = elevation). */
  worldAt(xM, yM, out = new THREE.Vector3()) {
    return out.set(xM, this.elevationAt(xM, yM), yM);
  }

  /** Mean slope (fraction, rise/run) along the straight segment, NaN if unsampleable. */
  slopeBetween(x0, y0, x1, y1, samples = 24) {
    const e0 = this.elevationAt(x0, y0), e1 = this.elevationAt(x1, y1);
    if (Number.isNaN(e0) || Number.isNaN(e1)) return NaN;
    let worst = 0, sum = 0, n = 0;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const e = this.elevationAt(x, y);
      if (Number.isNaN(e)) return NaN;
      if (i > 0) {
        const d = Math.abs(e - prevE) / Math.hypot(x1 - x0, y1 - y0) * samples;
        worst = Math.max(worst, d); sum += d; n++;
      }
      var prevE = e;
    }
    return { average: sum / n, worst };
  }

  /** Longitude/latitude of a metric point (for labels and research cross-checks). */
  toLonLat(xM, yM) {
    const a = this.meta.aoi;
    const widthM = (this.rawGrid.width - 1) * this.rawGrid.mPerPx;
    const heightM = (this.rawGrid.height - 1) * this.rawGrid.mPerPx;
    return {
      lon: a.lonWest + (xM / widthM) * (a.lonEast - a.lonWest),
      lat: a.latNorth - (yM / heightM) * (a.latNorth - a.latSouth),
    };
  }

  /** Metric point of a lon/lat (inverse of toLonLat). */
  fromLonLat(lon, lat) {
    const a = this.meta.aoi;
    const widthM = (this.rawGrid.width - 1) * this.rawGrid.mPerPx;
    const heightM = (this.rawGrid.height - 1) * this.rawGrid.mPerPx;
    return {
      xM: ((lon - a.lonWest) / (a.lonEast - a.lonWest)) * widthM,
      yM: ((a.latNorth - lat) / (a.latNorth - a.latSouth)) * heightM,
    };
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.material?.dispose();
  }
}
