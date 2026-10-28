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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { groundProp } from './cinematic-grade.js';

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';

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
          (gltf) => resolve(gltf.scene || null),
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
    });

    if (opts.position) wrapper.position.set(...opts.position);
    if (opts.rotationY) wrapper.rotation.y = opts.rotationY;
    parent.add(wrapper);
    return wrapper;
  }
}
