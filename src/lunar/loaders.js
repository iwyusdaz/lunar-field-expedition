/**
 * loaders.js — shared KTX2 and glTF loaders with self-hosted decoders
 * (build contract 08 §5.1; DECISIONS #26). The Basis transcoder is served from
 * `${BASE_URL}decoders/basis/` by vite-plugin-decoders.js; the meshopt decoder
 * is bundled from the pinned three package.
 * @module lunar/loaders
 */
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as THREE from 'three';

export const BASE = import.meta.env?.BASE_URL || './';
let ktx2 = null, gltf = null;

export function getKTX2(renderer) {
  if (ktx2) return ktx2;
  ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}decoders/basis/`).detectSupport(renderer);
  return ktx2;
}

export function getGLTF(renderer) {
  if (gltf) return gltf;
  gltf = new GLTFLoader().setKTX2Loader(getKTX2(renderer)).setMeshoptDecoder(MeshoptDecoder);
  return gltf;
}

/** Load a KTX2 texture (colour textures in sRGB, data textures linear). */
export async function loadKTX2(renderer, path, { srgb = true, repeat = false, anisotropy = 8 } = {}) {
  const tex = await getKTX2(renderer).loadAsync(`${BASE}${path}`);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

export async function loadGLB(renderer, path) {
  return getGLTF(renderer).loadAsync(`${BASE}${path}`);
}
