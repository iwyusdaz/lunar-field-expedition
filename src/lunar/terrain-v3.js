/**
 * terrain-v3.js — the streamed Hadley terrain (DECISIONS #23, #24, #26).
 *
 * One 3D Tiles 1.1 tileset (public/assets/terrain-v3/): a near quadtree from the
 * LROC NAC DTM at 5 m and a far quadtree from SLDEM2015 at 80 m that holds the
 * whole ~4.6 km Apennine Front, Mons Hadley and Hadley Delta. Lunar curvature
 * is baked into the tiles. Streaming starts after the learner's first
 * interaction (plan §7 download budget), so the title screen shows the orbit view.
 *
 * The tileset frame is Z-up with the LM at its origin. The group is placed so
 * the LM lands on its v2 world position (DECISIONS #20 frame): every tool,
 * crater patch, station and cinematic keeps its coordinates.
 *
 * Material: one shared MeshStandardMaterial with world-space regolith detail
 * (Poly Haven CC0 moon_01 at 3.1 m and moon_dusted_02 at 0.4 m, faded with
 * distance) on top of the Clementine 750 nm albedo for the far field.
 * @module lunar/terrain-v3
 */
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GLTFExtensionsPlugin } from '3d-tiles-renderer/plugins';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BASE, loadKTX2 } from './loaders.js';
import { curvatureDrop } from './frame.js';

export const LM_TILE_ELEVATION = -1923.37; // build-meta.json lmElevationM
const FAR_HALF = 40960;

/** Regolith material: world-position detail textures (no UVs in the tiles). */
export function createRegolithMaterial(lm) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8e8b86, roughness: 1, metalness: 0 });
  const uniforms = {
    uMacro: { value: null }, uMeso: { value: null }, uMacroN: { value: null }, uMesoN: { value: null },
    uAlbedo: { value: null }, uHasTex: { value: 0 }, uLm: { value: new THREE.Vector2(lm.x, lm.z) },
    uMid: { value: 1 }, // scan detail beyond arm's reach (0 while counting craters: only the real relief shades)
  };
  mat.userData.uniforms = uniforms;
  mat.userData.surfaceDetail = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRegWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRegWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRegWorld;
uniform sampler2D uMacro; uniform sampler2D uMeso; uniform sampler2D uMacroN; uniform sampler2D uMesoN; uniform sampler2D uAlbedo;
uniform float uHasTex; uniform vec2 uLm; uniform float uMid;`)
      .replace('#include <map_fragment>', `
float regDist = length(vRegWorld - cameraPosition);
if (uHasTex > 0.5) {
  vec2 wxz = vRegWorld.xz;
  vec2 rel = vec2(wxz.x - uLm.x, uLm.y - wxz.y); // east, north of the LM
  vec2 auv = vec2((rel.x + ${FAR_HALF}.0) / ${2 * FAR_HALF}.0, (${FAR_HALF}.0 - rel.y) / ${2 * FAR_HALF}.0);
  float reg = texture2D(uAlbedo, auv).r / 0.42; // Clementine relative albedo around the mare mean
  float fMacro = (1.0 - smoothstep(350.0, 900.0, regDist)) * uMid;
  float fMeso = 1.0 - smoothstep(18.0, 60.0, regDist);
  float fMid = smoothstep(60.0, 300.0, regDist) * (1.0 - smoothstep(2500.0, 6000.0, regDist)) * uMid;
  // Detail as brightness only: the scans are warmer than Apollo-photo regolith.
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  // Each layer is sampled only where it shows (most of a wide view is far ground).
  float det = 1.0;
  if (fMacro > 0.0) det *= mix(1.0, dot(texture2D(uMacro, wxz / 3.1).rgb, LUMA) / 0.42, fMacro * 0.85);
  if (fMeso > 0.0) det *= mix(1.0, dot(texture2D(uMeso, wxz / 0.4).rgb, LUMA) / 0.42, fMeso * 0.7);
  // Mid-distance variation: the same scan at 37 m and 230 m tiles breaks up the smooth 5 m terrain.
  if (fMid > 0.0) det *= mix(1.0, dot(texture2D(uMacro, wxz / 37.0).rgb, LUMA) / 0.42 * dot(texture2D(uMacro, wxz / 230.0 + 0.37).rgb, LUMA) / 0.42, fMid * 0.55);
  diffuseColor.rgb *= clamp(reg, 0.55, 1.6) * clamp(det, 0.3, 1.9);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (uHasTex > 0.5) {
  vec2 wxz = vRegWorld.xz;
  float fMacro = (1.0 - smoothstep(250.0, 700.0, regDist)) * uMid;
  float fMeso = 1.0 - smoothstep(12.0, 45.0, regDist);
  float fMid = smoothstep(40.0, 250.0, regDist) * (1.0 - smoothstep(2000.0, 5000.0, regDist)) * uMid;
  vec3 d = vec3(0.0);
  if (fMacro > 0.0) { vec3 nA = texture2D(uMacroN, wxz / 3.1).xyz * 2.0 - 1.0; d += vec3(nA.x, 0.0, -nA.y) * 0.9 * fMacro; }
  if (fMeso > 0.0) { vec3 nB = texture2D(uMesoN, wxz / 0.4).xyz * 2.0 - 1.0; d += vec3(nB.x, 0.0, -nB.y) * 0.8 * fMeso; }
  if (fMid > 0.0) { vec3 nC = texture2D(uMacroN, wxz / 37.0).xyz * 2.0 - 1.0; d += vec3(nC.x, 0.0, -nC.y) * 0.6 * fMid; }
  normal = normalize(normal + mat3(viewMatrix) * d);
}`);
  };
  mat.customProgramCacheKey = () => 'lunar-regolith-v3';
  return mat;
}

export async function loadRegolithTextures(renderer, mat) {
  const u = mat.userData.uniforms;
  const [macro, meso, macroN, mesoN, albedo] = await Promise.all([
    loadKTX2(renderer, 'assets/v3/regolith/regolith-macro-albedo-1024.ktx2', { repeat: true }),
    loadKTX2(renderer, 'assets/v3/regolith/regolith-meso-albedo-1024.ktx2', { repeat: true }),
    loadKTX2(renderer, 'assets/v3/regolith/regolith-macro-normal-1024.ktx2', { repeat: true, srgb: false }),
    loadKTX2(renderer, 'assets/v3/regolith/regolith-meso-normal-1024.ktx2', { repeat: true, srgb: false }),
    loadKTX2(renderer, 'assets/v3/terrain/albedo-clementine-750nm-1024.ktx2', { srgb: false }),
  ]);
  // The compiled program holds these uniform objects: set their values in place.
  u.uMacro.value = macro; u.uMeso.value = meso; u.uMacroN.value = macroN; u.uMesoN.value = mesoN; u.uAlbedo.value = albedo;
  u.uHasTex.value = 1;
}

export class StreamedTerrain {
  /**
   * @param {{ camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, lm: THREE.Vector3, fallbackHeight: (x: number, z: number) => number }} o
   */
  constructor(o) {
    Object.assign(this, o);
    this.group = new THREE.Group();
    this.group.name = 'terrain-v3';
    this.material = createRegolithMaterial(o.lm);
    this.leaves = new Set(); // loaded finest-level meshes (5 m near, 80 m far)
    this.started = false;
    this._ray = new THREE.Raycaster();
    this._ray.firstHitOnly = true;
    this._down = new THREE.Vector3(0, -1, 0);
    this._o = new THREE.Vector3();
    this._cache = new Map();
    this.onSettle = null;
  }

  /** Begin streaming (called on the first interaction). */
  start() {
    if (this.started) return;
    this.started = true;
    const tiles = new TilesRenderer(`${BASE}assets/terrain-v3/tileset.json`);
    tiles.registerPlugin(new GLTFExtensionsPlugin({ meshoptDecoder: MeshoptDecoder }));
    tiles.errorTarget = 10; // spike RESULTS kept 8 px; 10 px leaves GPU headroom for the cascades and regolith detail (DECISIONS)
    tiles.group.rotation.x = -Math.PI / 2; // tileset is Z-up
    tiles.group.position.set(this.lm.x, LM_TILE_ELEVATION, this.lm.z);
    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    tiles.addEventListener('load-model', ({ scene, tile }) => {
      scene.traverse((m) => {
        if (!m.isMesh) return;
        m.material?.dispose?.();
        m.material = this.material;
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.terrain = true;
        m.userData.noOutline = true;
        if (!tile.children?.length || tile.geometricError === 0) { m.userData.leaf = true; this.leaves.add(m); }
      });
      this._cache.clear();
    });
    tiles.addEventListener('dispose-model', ({ scene }) => { scene.traverse((m) => { if (m.isMesh) this.leaves.delete(m); }); this._cache.clear(); });
    tiles.addEventListener('tiles-load-end', () => { this._cache.clear(); this.onSettle?.(); });
    this.tiles = tiles;
    this.group.add(tiles.group);
  }

  update() {
    if (!this.tiles) return;
    this.camera.updateMatrixWorld();
    this.tiles.update();
  }

  resize() { this.tiles?.setResolutionFromRenderer(this.camera, this.renderer); }

  /** Is the streamed ground loaded under (x, z)? */
  hasGround(x, z) { return Number.isFinite(this._raycastLeaves(x, z)); }

  /**
   * Ground height under (x, z): the finest loaded tile surface, or the v2
   * heightfield with the curvature drop while tiles are still streaming.
   * Cached on a 0.5 m grid until the next tile load.
   */
  heightAt(x, z) {
    const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
    const c = this._cache.get(key);
    if (c !== undefined) return c;
    let y = this._raycastLeaves(x, z);
    if (!Number.isFinite(y)) {
      const f = this.fallbackHeight(x, z);
      y = Number.isFinite(f) ? f - curvatureDrop(Math.hypot(x - this.lm.x, z - this.lm.z)) : NaN;
    }
    if (this._cache.size > 20000) this._cache.clear();
    this._cache.set(key, y);
    return y;
  }

  _raycastLeaves(x, z) {
    if (!this.leaves.size) return NaN;
    this._o.set(x, 6000, z);
    this._ray.set(this._o, this._down);
    this._ray.far = 12000;
    let best = NaN;
    for (const m of this.leaves) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const hit = this._ray.intersectObject(m, false)[0];
      if (hit && !(hit.point.y < best)) best = hit.point.y;
    }
    return best;
  }

  /** Pick the streamed surface under a screen point (NDC). */
  pick(ndc, camera) {
    if (!this.tiles) return null;
    this._ray.setFromCamera(ndc, camera);
    this._ray.far = Infinity;
    const hit = this._ray.intersectObject(this.tiles.group, true)[0];
    return hit ? hit.point : null;
  }
}
