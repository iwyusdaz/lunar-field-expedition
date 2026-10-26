/**
 * Global Moon scene (Module 1): the whole Moon from the NASA SVS CGI Moon Kit
 * LROC WAC color map + LOLA elevation displacement (assets in public/assets/globe/).
 * NOTE: this scene uses 1 unit = 1 kilometre (documented deviation from the
 * site scene's metres) so one camera serves both scenes without depth problems.
 * @module scenes/global-moon
 */
import * as THREE from 'three';
import { loadJSON, loadTexture } from '../core/assets.js';

export class GlobalMoon {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'global-moon';
    this.ready = false;
    this._spin = 0;
  }

  async load() {
    const meta = await loadJSON('assets/globe/displacement-1k.meta.json');
    const span = meta.elevMax - meta.elevMin; // metres, relative to 1737400 m sphere
    const geo = new THREE.SphereGeometry(1737.4, 512, 256); // km
    const color = loadTexture('assets/globe/lroc-color-2k.jpg');
    const disp = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL || './'}assets/globe/displacement-1k.png`);
    this.material = new THREE.MeshStandardMaterial({
      map: color,
      displacementMap: disp,
      displacementScale: span / 1000,      // metres -> km
      displacementBias: meta.elevMin / 1000,
      roughness: 0.97,
      metalness: 0,
    });
    this.moon = new THREE.Mesh(geo, this.material);
    this.moon.rotation.z = 0; // north pole up
    this.group.add(this.moon);

    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.position.set(-2600, 900, 1500); // terminator visible from the default camera
    this.group.add(this.sun);
    this.group.add(this.sun.target);
    this.ambient = new THREE.HemisphereLight(0x555a66, 0x111114, 0.10);
    this.group.add(this.ambient);

    // Landing-site marker: a small cone pinned to the surface at Hadley
    // (26.1324 N, 3.6333 E) using the sphere's equirectangular UV mapping.
    const lat = 26.1324 * Math.PI / 180, lon = 3.6333 * Math.PI / 180;
    const r = 1737.4 + 1.2;
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(14, 42, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, depthTest: false }),
    );
    marker.position.set(
      r * Math.cos(lat) * Math.sin(lon),
      r * Math.sin(lat),
      -r * Math.cos(lat) * Math.cos(lon),
    );
    marker.renderOrder = 10;
    marker.name = 'marker-hadley';
    // orient outward
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), marker.position.clone().normalize());
    this.group.add(marker);

    // starfield (km scale)
    const N = 2200;
    const pos = new Float32Array(N * 3), mag = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([16000 * s * Math.cos(t), 16000 * u, 16000 * s * Math.sin(t)], i * 3);
      mag[i] = 0.4 + Math.pow(Math.random(), 3) * 1.4;
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g2.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    this.stars = new THREE.Points(g2, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aMag; varying float vMag;
        void main(){ vMag=aMag; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=clamp(90.0/-mv.z*(0.7+aMag),0.6,2.4); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying float vMag; void main(){ float d=length(gl_PointCoord-0.5);
        gl_FragColor=vec4(vec3(0.92,0.94,1.0), smoothstep(0.5,0.1,d)*vMag*0.6); }`,
    }));
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    this.ready = true;
    this.placeCamera();
    return this;
  }

  placeCamera() {
    if (!this.engine) return; // no-WebGL path: scene data is still used by text mode
    const cam = this.engine.camera;
    cam.position.set(2600, 1200, 3100); // km — a classic three-quarter view
    cam.lookAt(0, 0, 0);
    cam.far = 40000;
    cam.updateProjectionMatrix();
  }

  /** Per-frame: slow rotation only when motion is allowed. */
  update(dt, motionReduced) {
    if (!this.ready) return;
    if (!motionReduced) {
      this._spin += dt * 0.02;
      this.moon.rotation.y = this._spin;
    }
  }
}
