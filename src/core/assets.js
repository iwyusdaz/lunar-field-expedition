/**
 * Asset helpers: JSON and textures loaded relative to import.meta.env.BASE_URL so
 * the build works at any sub-path (build contract 08 5.1). The project loads no
 * glTF/KTX2/Draco assets, so no decoders are shipped.
 * @module core/assets
 */
import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL || './';

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
