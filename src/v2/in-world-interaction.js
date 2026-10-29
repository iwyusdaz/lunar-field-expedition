/**
 * in-world-interaction.js — In-World 3D Interaction, Hover Highlights,
 * Projected 3D Callouts / Speech Bubbles, and Cinematic Hotspot Glide +
 * Free WASD/Orbit Camera Navigator (v2.0.0).
 *
 * Makes the 3D environment the primary interface:
 *  - Raycasts interactive 3D props, tools, NPCs, and floor hotspot rings
 *  - Applies an emissive hover highlight + pointer cursor + projected 3D tooltip
 *  - Smoothly glides the camera to frame clicked objects/hotspots (cubic ease-in-out)
 *  - Supports free mouse-drag look/orbit and WASD/arrow movement anytime
 *  - Renders projected 3D speech bubbles and diegetic callout pins over objects
 *
 * @module v2/in-world-interaction
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Floating height of the hotspot diamond beacon. Raised from 0.36 m (arrival-english
// V-3): the default cameras sit at y ~1.6 with a 55 deg FOV, so a floor-level beacon
// was below the frustum edge until you dragged to look down. At ~0.9 m the glow is
// inside the default view for every hotspot ring, while the floor ring still marks
// the exact glide target.
const BEACON_Y = 0.9;

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export class InWorldInteractionManager {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {THREE.Camera} opts.camera
   * @param {THREE.Scene} opts.scene
   * @param {HTMLElement} [opts.overlayRoot]
   * @param {[number,number,number,number]} [opts.bounds=[-18, 18, -18, 18]]  [minX, maxX, minZ, maxZ]
   * @param {number} [opts.walkSpeed=3.8]
   * @param {boolean} [opts.reducedMotion=false]
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.scene = opts.scene;
    this.overlayRoot = opts.overlayRoot || document.body;
    this.bounds = opts.bounds || [-22, 22, -22, 22];
    this.walkSpeed = opts.walkSpeed ?? 3.8;
    this.reducedMotion = Boolean(opts.reducedMotion);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.items = new Map(); // id -> entry
    this.pickables = [];
    this.hotspotRings = [];
    this.hovered = null;
    this.calmFactor = 1; // set via setCalmMode to quiet ring pulses during focused tasks
    this.enabled = true; // set via setEnabled while inspection tools own the camera

    // Camera navigation state (look target + spherical/free walk)
    this.target = new THREE.Vector3(0, 1.3, 0);
    this.glide = null;
    this.keys = new Set();
    this._dragging = false;
    this._downPos = { x: 0, y: 0 };
    this._lastPos = { x: 0, y: 0 };
    this._yaw = 0;
    this._pitch = 0;
    this._syncAnglesFromCamera();

    this._buildOverlayElements();
    this._bindEvents();
  }

  _buildOverlayElements() {
    if (typeof document === 'undefined') return;
    // Projected hover tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'v2-world-tooltip';
    this.tooltip.setAttribute('aria-hidden', 'true');
    this.tooltip.hidden = true;
    this.overlayRoot.appendChild(this.tooltip);

    // Projected persistent speech bubble / diegetic callout container
    this.bubbleHost = document.createElement('div');
    this.bubbleHost.className = 'v2-world-bubbles';
    this.overlayRoot.appendChild(this.bubbleHost);
    this.bubbles = new Map();
  }

  _syncAnglesFromCamera() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this._yaw = Math.atan2(-dir.x, -dir.z);
    this._pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.92, 0.92));
  }

  _bindEvents() {
    if (!this.canvas || typeof window === 'undefined') return;

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (!this.enabled) return;
      if (document.querySelector('dialog[open]')) return;
      this._dragging = true;
      this._downPos = { x: e.clientX, y: e.clientY };
      this._lastPos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointermove', (e) => {
      if (this._dragging) {
        const dx = e.clientX - this._lastPos.x;
        const dy = e.clientY - this._lastPos.y;
        this._lastPos = { x: e.clientX, y: e.clientY };
        if (Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y) > 4) {
          this.glide = null;
          this._yaw -= dx * 0.0042;
          this._pitch = THREE.MathUtils.clamp(this._pitch - dy * 0.0034, -1.05, 1.05);
          this._applyLookAngles();
        }
        return;
      }
      this._onHoverMove(e);
    });

    window.addEventListener('pointerup', (e) => {
      if (!this._dragging) return;
      this._dragging = false;
      const dist = Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y);
      if (dist <= 6 && e.target === this.canvas) {
        this._onCanvasClick(e);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) {
        this.keys.add(k);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
  }

  _applyLookAngles() {
    const dist = Math.max(1.5, this.camera.position.distanceTo(this.target));
    const dx = -Math.sin(this._yaw) * Math.cos(this._pitch);
    const dy = Math.sin(this._pitch);
    const dz = -Math.cos(this._yaw) * Math.cos(this._pitch);
    this.target.set(
      this.camera.position.x + dx * dist,
      this.camera.position.y + dy * dist,
      this.camera.position.z + dz * dist,
    );
    this.camera.lookAt(this.target);
  }

  /**
   * Quiet the hotspot-ring pulse during focused tasks (0.3) or restore it (1).
   */
  setCalmMode(active) {
    this.calmFactor = active ? 0.3 : 1;
  }

  /**
   * Register an interactive 3D object (prop, hazard, artifact, station, NPC).
   * @param {THREE.Object3D} object3d
   * @param {object} meta
   * @param {string} meta.id
   * @param {string} meta.label
   * @param {string} [meta.hint]
   * @param {[number,number,number]} [meta.cameraPos]
   * @param {[number,number,number]} [meta.cameraTarget]
   * @param {Function} [meta.onClick]
   * @param {number} [meta.highlightColor=0xffd100]
   */
  registerInteractive(object3d, meta) {
    if (!object3d || !meta?.id) return;
    object3d.userData.v2InteractiveId = meta.id;
    object3d.traverse((child) => {
      child.userData.v2InteractiveId = meta.id;
    });
    const entry = {
      id: meta.id,
      object3d,
      label: meta.label || meta.id,
      hint: meta.hint || 'Click to inspect',
      cameraPos: meta.cameraPos ? new THREE.Vector3(...meta.cameraPos) : null,
      cameraTarget: meta.cameraTarget ? new THREE.Vector3(...meta.cameraTarget) : null,
      onClick: meta.onClick || null,
      highlightColor: new THREE.Color(meta.highlightColor ?? 0xffd100),
      savedEmissive: new Map(),
    };
    this.items.set(meta.id, entry);
    this.pickables.push(object3d);
    return entry;
  }

  /**
   * Enable/disable all in-world interaction (pointer, keys, glide, walk).
   * While disabled the camera and pointer belong to another system (inspection
   * tools, cinematics, text mode); hover is cleared so no tooltip lingers.
   */
  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.enabled) {
      this.keys.clear();
      this.glide = null;
      this._dragging = false;
      this._setHovered(null);
    } else {
      // Another system moved the camera while we were off; resume from where it is.
      this._syncAnglesFromCamera();
    }
  }

  clearInteractives() {
    this._setHovered(null);
    this.items.clear();
    this.pickables.length = 0;
    for (const r of this.hotspotRings) {
      r.group.parent?.remove(r.group);
    }
    this.hotspotRings.length = 0;
  }

  /**
   * Create a glowing, pulsing 3D floor/object hotspot ring in the scene and register it.
   */
  addHotspotRing(position, opts = {}) {
    const group = new THREE.Group();
    const [x, y, z] = Array.isArray(position) ? position : [position.x, position.y, position.z];
    group.position.set(x, y, z);

    const color = opts.color ?? 0x38bdf8;
    // Outer ring + inner disc as ONE mesh (one draw call instead of two). They
    // share a hue but not an opacity, so alpha is baked per vertex in an RGBA
    // colour attribute (three.js reads vertex alpha when itemSize is 4).
    const tint = new THREE.Color(color);
    const withAlpha = (geo, alpha, yPos) => {
      const g = geo.toNonIndexed();
      g.rotateX(-Math.PI / 2);
      g.translate(0, yPos, 0);
      const count = g.attributes.position.count;
      const rgba = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        rgba[i * 4] = tint.r;
        rgba[i * 4 + 1] = tint.g;
        rgba[i * 4 + 2] = tint.b;
        rgba[i * 4 + 3] = alpha;
      }
      g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
      return g;
    };
    const outer = new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries([
        withAlpha(new THREE.RingGeometry(0.28, 0.38, 32), 0.85, 0.02),
        withAlpha(new THREE.CircleGeometry(0.26, 28), 0.22, 0.015),
      ], false),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    group.add(outer);

    // Floating diamond beacon above the ring
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.085, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.65,
        roughness: 0.2,
      }),
    );
    diamond.position.y = BEACON_Y;
    group.add(diamond);

    (opts.parent || this.scene).add(group);
    this.hotspotRings.push({ group, outer, diamond, phase: this.hotspotRings.length * 1.1 });

    this.registerInteractive(group, {
      id: opts.id || `hotspot-${this.hotspotRings.length}`,
      label: opts.label || 'Move here',
      hint: opts.hint || 'Click to move & inspect',
      cameraPos: opts.cameraPos || [x, y + 1.6, z + 2.2],
      cameraTarget: opts.cameraTarget || [x, y + 1.1, z],
      highlightColor: color,
      onClick: opts.onClick,
    });
    return group;
  }

  /**
   * Show or update an in-world projected speech bubble / callout card anchored to a 3D position.
   */
  setSpeechBubble(id, opts) {
    if (!this.bubbleHost) return;
    if (!opts) {
      const old = this.bubbles.get(id);
      if (old) { old.el.remove(); this.bubbles.delete(id); }
      return;
    }
    let rec = this.bubbles.get(id);
    if (!rec) {
      const el = document.createElement('div');
      el.className = 'v2-speech-bubble';
      this.bubbleHost.appendChild(el);
      rec = { el, position: new THREE.Vector3(), object3d: null, offset: new THREE.Vector3(0, 1.85, 0) };
      this.bubbles.set(id, rec);
    }
    rec.object3d = opts.object3d || null;
    if (opts.position) rec.position.set(...opts.position);
    if (opts.offset) rec.offset.set(...opts.offset);

    rec.el.replaceChildren();
    if (opts.speaker) {
      const sp = document.createElement('strong');
      sp.className = 'v2-bubble-speaker';
      sp.textContent = opts.speaker;
      rec.el.appendChild(sp);
    }
    const body = document.createElement('span');
    body.className = 'v2-bubble-text';
    body.textContent = opts.text || '';
    rec.el.appendChild(body);
  }

  /**
   * Smoothly glide the camera to a new position and look-at target.
   * @param {THREE.Vector3|[number,number,number]} toPos
   * @param {THREE.Vector3|[number,number,number]} toTarget
   * @param {number} [durationSec=1.15]
   */
  glideTo(toPos, toTarget, durationSec = 1.15) {
    const destPos = Array.isArray(toPos) ? new THREE.Vector3(...toPos) : toPos.clone();
    const destTarget = Array.isArray(toTarget) ? new THREE.Vector3(...toTarget) : toTarget.clone();
    if (this.reducedMotion || durationSec <= 0.05) {
      this.camera.position.copy(destPos);
      this.target.copy(destTarget);
      this.camera.lookAt(this.target);
      this._syncAnglesFromCamera();
      this.glide = null;
      return;
    }
    this.glide = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.target.clone(),
      toPos: destPos,
      toTarget: destTarget,
      elapsed: 0,
      duration: durationSec,
    };
  }

  _pickAtClient(clientX, clientY) {
    if (!this.canvas || !this.pickables.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let cur = h.object;
      while (cur) {
        const id = cur.userData?.v2InteractiveId;
        if (id && this.items.has(id) && cur.visible !== false) {
          return { entry: this.items.get(id), point: h.point };
        }
        cur = cur.parent;
      }
    }
    return null;
  }

  _setHovered(entry, clientX = 0, clientY = 0) {
    if (this.hovered && this.hovered !== entry) {
      for (const [mat, orig] of this.hovered.savedEmissive.entries()) {
        if (mat.emissive) mat.emissive.copy(orig);
      }
      this.hovered.savedEmissive.clear();
    }
    this.hovered = entry;
    if (!entry) {
      if (this.canvas) this.canvas.style.cursor = '';
      if (this.tooltip) this.tooltip.hidden = true;
      return;
    }
    if (this.canvas) this.canvas.style.cursor = 'pointer';
    entry.object3d.traverse((c) => {
      const m = c.material;
      if (m && m.emissive && !entry.savedEmissive.has(m)) {
        entry.savedEmissive.set(m, m.emissive.clone());
        m.emissive.lerp(entry.highlightColor, 0.38);
      }
    });
    if (this.tooltip) {
      this.tooltip.hidden = false;
      this.tooltip.textContent = `${entry.label} — ${entry.hint}`;
      this.tooltip.style.left = `${Math.min(window.innerWidth - 220, Math.max(16, clientX + 14))}px`;
      this.tooltip.style.top = `${Math.max(16, clientY - 36)}px`;
    }
  }

  _onHoverMove(e) {
    // While another tool owns the pointer (crater counter, magnifier), no hover
    // tooltip may promise a click that won't happen.
    if (!this.enabled) {
      this._setHovered(null);
      return;
    }
    if (!this.canvas || e.target !== this.canvas || this.canvas.style.visibility === 'hidden') {
      this._setHovered(null);
      return;
    }
    if (document.querySelector('dialog[open]')) {
      this._setHovered(null);
      return;
    }
    const picked = this._pickAtClient(e.clientX, e.clientY);
    this._setHovered(picked?.entry || null, e.clientX, e.clientY);
  }

  _onCanvasClick(e) {
    if (this.canvas.style.visibility === 'hidden') return;
    const picked = this._pickAtClient(e.clientX, e.clientY);
    if (!picked) return;
    const { entry, point } = picked;
    if (entry.cameraPos && entry.cameraTarget) {
      this.glideTo(entry.cameraPos, entry.cameraTarget, 1.05);
    } else if (point) {
      const dir = this.camera.position.clone().sub(point).setY(0).normalize();
      if (dir.lengthSq() > 0.01) {
        const camDest = point.clone().addScaledVector(dir, 2.2);
        camDest.y = Math.max(1.35, point.y + 0.55);
        this.glideTo(camDest, point, 0.95);
      }
    }
    entry.onClick?.(entry, point);
  }

  /**
   * Update camera glides, WASD movement, hotspot ring pulses, and projected bubbles.
   */
  update(dt = 0.016, elapsed = 0) {
    // 1. Camera glide. While disabled another camera mode owns the camera, so
    // glide/walk stop — but rings and bubbles below still animate and project.
    if (!this.enabled) {
      // no camera movement
    } else if (this.glide) {
      this.glide.elapsed += dt;
      const u = Math.min(1, this.glide.elapsed / this.glide.duration);
      const k = easeInOutCubic(u);
      this.camera.position.lerpVectors(this.glide.fromPos, this.glide.toPos, k);
      this.target.lerpVectors(this.glide.fromTarget, this.glide.toTarget, k);
      this.camera.lookAt(this.target);
      if (u >= 1) {
        this._syncAnglesFromCamera();
        this.glide = null;
      }
    } else if (this.keys.size > 0) {
      // 2. Free WASD / Arrow walking & Q/E turning
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() > 1e-4) fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

      const move = new THREE.Vector3();
      if (this.keys.has('w') || this.keys.has('arrowup')) move.add(fwd);
      if (this.keys.has('s') || this.keys.has('arrowdown')) move.sub(fwd);
      if (this.keys.has('d')) move.add(right);
      if (this.keys.has('a')) move.sub(right);

      if (this.keys.has('arrowleft') || this.keys.has('q')) {
        this._yaw += 1.45 * dt;
        this._applyLookAngles();
      }
      if (this.keys.has('arrowright') || this.keys.has('e')) {
        this._yaw -= 1.45 * dt;
        this._applyLookAngles();
      }

      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(this.walkSpeed * dt);
        this.camera.position.add(move);
        this.target.add(move);
        const [minX, maxX, minZ, maxZ] = this.bounds;
        this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, minX, maxX);
        this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, minZ, maxZ);
      }
    }

    // 3. Animate hotspot rings (scaled by the calm factor so focused tasks stay quiet)
    if (!this.reducedMotion) {
      const pulseScale = this.calmFactor ?? 1;
      for (const r of this.hotspotRings) {
        const s = 1 + Math.sin(elapsed * 2.6 + r.phase) * 0.08 * pulseScale;
        r.outer.scale.setScalar(s);
        r.diamond.position.y = BEACON_Y + Math.sin(elapsed * 2.6 + r.phase) * 0.04 * pulseScale;
        r.diamond.rotation.y = elapsed * 1.4 * Math.max(0.3, pulseScale) + r.phase;
      }
    }

    // 4. Project persistent 3D speech bubbles / callouts (clamped to the canvas
    // so high anchors never overlap the app header).
    if (this.bubbles?.size && this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      const _v = new THREE.Vector3();
      for (const rec of this.bubbles.values()) {
        if (rec.object3d) {
          rec.object3d.getWorldPosition(_v);
          _v.add(rec.offset);
        } else {
          _v.copy(rec.position);
        }
        _v.project(this.camera);
        if (_v.z > 1 || _v.z < -1) {
          rec.el.hidden = true;
          continue;
        }
        rec.el.hidden = false;
        const x = THREE.MathUtils.clamp(((_v.x * 0.5 + 0.5) * rect.width) + rect.left, rect.left + 130, rect.right - 130);
        const y = Math.max(rect.top + 92, ((-_v.y * 0.5 + 0.5) * rect.height) + rect.top);
        rec.el.style.transform = `translate(-50%, -100%) translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    }
  }
}
