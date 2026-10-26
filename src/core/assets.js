/**
 * Asset loader: GLTF/GLB (+ DRACO, Meshopt, KTX2) with SELF-HOSTED decoders.
 * The build contract (08-vercel-deployment.md 5.1) forbids CDN loads: decoders are
 * copied into public/decoders/ by scripts/setup-decoders.mjs and loaded relative
 * to the page via import.meta.env.BASE_URL, so any sub-path works.
 * @module core/assets
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL || './';

let _sharedLoader = null;

/**
 * A shared GLTFLoader configured with self-hosted decoders and renderer-based KTX2 support.
 * @param {THREE.WebGLRenderer} renderer
 */
export function getGLTFLoader(renderer) {
  if (_sharedLoader) return _sharedLoader;
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${BASE}decoders/draco/`);
  loader.setDRACOLoader(draco);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(`${BASE}decoders/basis/`);
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);
  loader.setMeshoptDecoder(MeshoptDecoder);
  _sharedLoader = loader;
  return loader;
}

/** Fetch JSON relative to BASE_URL (works at any sub-path). */
export async function loadJSON(path) {
  const res = await fetch(`${BASE}${path.replace(/^\//, '')}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

/** Fetch a texture relative to BASE_URL. */
export function loadTexture(path) {
  const tex = new THREE.TextureLoader().load(`${BASE}${path.replace(/^\//, '')}`);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Small helper for chunked/on-demand loading with retries (per 08 6.2 retry guidance).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [retries=3]
 */
export async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 400 * 2 ** i)); }
  }
  throw lastErr;
}

/** WebGL2 support check -> friendly fallback message handled by the app shell. */
export function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2'));
  } catch { return false; }
}
