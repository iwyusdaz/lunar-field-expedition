/**
 * model-placer.js — Loads and places curated Poly Haven CC0 GLB models from
 * `assets/models/manifest.json` with automatic caching, cloning, real-world
 * height/scale normalization, shadow setup, and contact-shadow grounding (v2.0.0).
 *
 * Because our GLB files are packed as standard uncompressed glTF 2.0 binary
 * with resized JPEG textures, GLTFLoader loads them directly without needing
 * Draco or Basis WASM decoders.
 *
 * @module v2/model-placer
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { groundProp } from './cinematic-grade.js';

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';

/**
 * Static-geometry merge: rebuild a loaded GLB scene as one mesh per material.
 * Props never animate, so per-material merging cuts their draw-call cost by ~4x
 * (including the shadow pass) while keeping the identical visual result.
 * Skinned/morph-target/multi-material meshes are kept as-is.
 */
function mergeTemplateByMaterial(root) {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMaterial = new Map();
  const keepNodes = [];

  root.traverse((node) => {
    if (!node.isMesh || node.isSkinnedMesh) return;
    if (Array.isArray(node.material)) { keepNodes.push(node); return; }
    const geom = node.geometry;
    if (!geom || (geom.morphAttributes && Object.keys(geom.morphAttributes).length)) {
      keepNodes.push(node);
      return;
    }
    if (!byMaterial.has(node.material)) byMaterial.set(node.material, []);
    byMaterial.get(node.material).push(node);
  });
  if (byMaterial.size === 0) return false;

  const KEEP = ['position', 'normal', 'uv'];
  const bake = (mesh) => {
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld));
    for (const name of Object.keys(g.attributes)) {
      if (!KEEP.includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  };

  const mergedRoot = new THREE.Group();
  mergedRoot.name = root.name || 'model';
  for (const [material, nodes] of byMaterial) {
    const geos = nodes.map(bake);
    // Attribute sets must match exactly across the group; drop extras unevenly present.
    for (const name of [...KEEP]) {
      if (!geos.every((g) => g.attributes[name])) {
        for (const g of geos) g.deleteAttribute(name);
      }
    }
    let merged;
    try {
      merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
    } catch {
      keepNodes.push(...nodes);
      continue;
    }
    if (!merged) { keepNodes.push(...nodes); continue; }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `merged-${material.uuid.slice(0, 8)}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mergedRoot.add(mesh);
  }
  // Re-add any nodes we could not merge (skinned, morph, multi-material).
  for (const node of keepNodes) {
    node.updateMatrixWorld(true);
    const relative = new THREE.Matrix4().multiplyMatrices(rootInverse, node.matrixWorld);
    node.matrix.copy(relative);
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    node.matrixWorldNeedsUpdate = true;
    mergedRoot.add(node);
  }

  root.clear();
  root.add(mergedRoot);
  return true;
}

export class ModelLibrary {
  constructor(baseUrl = BASE) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.loader = new GLTFLoader();
    this.manifest = null;
    this.cache = new Map(); // id -> Promise<THREE.Group>
  }

  async loadManifest() {
    if (this.manifest) return this.manifest;
    try {
      const res = await fetch(`${this.baseUrl}assets/models/manifest.json`);
      if (!res.ok) {
        this.manifest = {};
        return this.manifest;
      }
      this.manifest = await res.json();
    } catch {
      this.manifest = {};
    }
    return this.manifest;
  }

  /**
   * Load (or retrieve from cache) a model by its Poly Haven asset ID.
   * @param {string} id
   * @returns {Promise<THREE.Group|null>}
   */
  async getTemplate(id) {
    await this.loadManifest();
    const entry = this.manifest?.[id];
    if (!entry?.file) return null;
    if (!this.cache.has(id)) {
      const url = `${this.baseUrl}${entry.file}`;
      const p = new Promise((resolve) => {
        this.loader.load(
          url,
          (gltf) => {
            const scene = gltf.scene || null;
            if (scene) mergeTemplateByMaterial(scene);
            resolve(scene);
          },
          undefined,
          () => resolve(null),
        );
      });
      this.cache.set(id, p);
    }
    return this.cache.get(id);
  }

  /**
   * Place an instance of `id` into `parent` with optional targetHeight (metres),
   * position, rotationY, and grounding contact shadow.
   * @param {THREE.Object3D} parent
   * @param {string} id
   * @param {object} [opts]
   * @param {[number,number,number]} [opts.position=[0,0,0]]
   * @param {number} [opts.rotationY=0]
   * @param {number} [opts.targetHeight]
   * @param {number} [opts.scale=1]
   * @param {boolean} [opts.contactShadow=true]
   */
  async place(parent, id, opts = {}) {
    const tpl = await this.getTemplate(id);
    if (!tpl || !parent) return null;
    const clone = tpl.clone(true);
    clone.name = `model-${id}`;

    // Normalize scale if targetHeight is specified, and align bottom to y=0
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    let s = opts.scale ?? 1;
    if (opts.targetHeight && size.y > 1e-4) {
      s = (opts.targetHeight / size.y) * (opts.scale ?? 1);
    }
    clone.scale.setScalar(s);

    const scaledBox = new THREE.Box3().setFromObject(clone);
    const wrapper = new THREE.Group();
    wrapper.name = `prop-${id}`;
    clone.position.y = -scaledBox.min.y;
    wrapper.add(clone);

    groundProp(wrapper, {
      contactShadow: opts.contactShadow !== false,
      castShadow: opts.castShadow !== false,
      receiveShadow: opts.receiveShadow !== false,
      minShadowSize: opts.minShadowSize ?? 0.6,
    });

    if (opts.position) wrapper.position.set(...opts.position);
    if (opts.rotationY) wrapper.rotation.y = opts.rotationY;
    parent.add(wrapper);
    return wrapper;
  }
}
