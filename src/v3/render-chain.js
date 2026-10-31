/**
 * render-chain.js — the v3 render chain (plan 10 §9 S3, from spikes/RESULTS.md).
 *
 *   RenderPass -> one EffectPass [ (Bloom) , ToneMapping(AgX), LUT3D, (SMAA) ]
 *
 * - HalfFloat composer, no multisampling. AgX tone mapping moves from the
 *   renderer into the pass (renderer.toneMapping = NoToneMapping) so the case
 *   LUT grades the tone-mapped image in display space (RESULTS "LUT"):
 *   +0.9 ms for the composer, +0.9 ms for the LUT at 2880x1800 on the M1.
 * - The LUT ships as a PNG strip (33 slices side by side, ~100 KB); author and
 *   keep the .cube as the source. A neutral LUT is used until one is loaded.
 * - SMAA and bloom only on High/Ultra (SMAA p95 15.2 ms and bloom +10 ms at
 *   DPR 2 on the M1), per the preset's `post` list.
 * - Finding 5: inside the composer scene.background IS tone-mapped (natively
 *   it is not), so re-pick background and fog colours when moving a scene here.
 * @module v3/render-chain
 */
import * as THREE from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, LUT3DEffect, LookupTexture, RenderPass,
  SMAAEffect, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import { SunLight } from 'three/addons/lights/SunLight.js';

export class RenderChain {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {{ exposure?: number, bloom?: object }} [opts]
   */
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.opts = opts;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = opts.exposure ?? 1.0;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.lut = LookupTexture.createNeutral(32);
    this.post = [];
    this.effectPass = null;
  }

  /** Load the case grade from a PNG strip (N*N x N) or pass a ready LookupTexture. */
  async loadLut(urlOrTexture) {
    let lut = urlOrTexture;
    if (typeof urlOrTexture === 'string') {
      const strip = await new THREE.TextureLoader().loadAsync(urlOrTexture);
      lut = LookupTexture.from(strip);
    }
    this.lut = lut;
    if (this._lutEffect) this._lutEffect.lut = lut;
    return lut;
  }

  /** Rebuild the effect pass for a preset's post list (cheap; only on preset change). */
  setPost(post) {
    const key = post.join(',');
    if (key === this.post.join(',') && this.effectPass) return;
    this.post = [...post];
    if (this.effectPass) { this.composer.removePass(this.effectPass); this.effectPass.dispose(); }
    const effects = [];
    if (post.includes('bloom')) effects.push(new BloomEffect({ intensity: 0.35, luminanceThreshold: 0.9, mipmapBlur: true, ...(this.opts.bloom || {}) }));
    if (post.includes('tone')) effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
    this._lutEffect = null;
    if (post.includes('lut')) { this._lutEffect = new LUT3DEffect(this.lut, { tetrahedralInterpolation: true }); effects.push(this._lutEffect); }
    if (post.includes('smaa')) effects.push(new SMAAEffect());
    this.effectPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.effectPass);
    this.scene.traverse((o) => { if (o.material) [o.material].flat().forEach((m) => { m.needsUpdate = true; }); });
  }

  setSize(w, h) { this.composer.setSize(w, h, false); }
  render(dt) { this.composer.render(dt); }
  dispose() { this.composer.dispose(); }
}

/**
 * The scene's sun for a preset (RESULTS "SunLight cascades": keep 2 x 2048, far
 * 1,500 m for large outdoor scenes; +1.0-1.6 ms over one DirectionalLight).
 * Small scenes (a room, a yard) keep one DirectionalLight with a fitted box.
 * Low has no real-time shadows.
 * @param {object} preset    PRESETS entry
 * @param {{ large?: boolean, color?: number, intensity?: number, box?: number, far?: number }} [o]
 * @returns {THREE.Light}  position it with `.position` (direction from the origin)
 */
export function createSun(preset, o = {}) {
  const color = o.color ?? 0xfff1df;
  const intensity = o.intensity ?? 3;
  const shadows = preset.shadowMapSize > 0;
  if (o.large && shadows && preset.features.cascades) {
    const sun = new SunLight(color, intensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    sun.shadow.camera.far = o.far ?? 1500;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    return sun;
  }
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.castShadow = shadows;
  if (shadows) {
    const b = o.box ?? 40;
    sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    Object.assign(sun.shadow.camera, { left: -b, right: b, top: b, bottom: -b, near: 0.5, far: o.far ?? 200 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
  }
  return sun;
}
