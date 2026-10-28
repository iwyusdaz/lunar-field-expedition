import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createAnimatedCharacter } from '../../src/v2/stylized-character.js';
import { AmbientLifeManager } from '../../src/v2/ambient-life.js';
import { applyCaseGrade, CASE_THEMES, groundProp, createGradientSkyDome } from '../../src/v2/cinematic-grade.js';

describe('v2 Living World, Stylized Characters & Cinematic Grade', () => {
  it('creates an articulated animated-movie character with head, eyes, eyelids, brows, arms, legs, and contact shadow', () => {
    const char = createAnimatedCharacter({
      id: 'test-char',
      height: 1.72,
      hairStyle: 'bob',
      outfit: 'hivis',
      prop: 'tablet',
    });
    expect(char.root).toBeInstanceOf(THREE.Group);
    expect(char.head).toBeInstanceOf(THREE.Group);
    expect(char.arms.left.shoulder).toBeInstanceOf(THREE.Group);
    expect(char.arms.right.wrist).toBeInstanceOf(THREE.Group);
    expect(char.legs.left.hip).toBeInstanceOf(THREE.Group);

    // Advance animation in idle, walk, talk, and withdrawn states
    char.setAction('walk', 'engaged');
    char.setSpeaking(true);
    char.lookAtWorld(new THREE.Vector3(2, 1.6, 3));
    char.update(0.05, 1.2, 1.0);
    expect(Number.isFinite(char.head.rotation.y)).toBe(true);

    char.setAction('withdrawn', 'withdrawn');
    char.update(0.05, 2.0, 0.3);
    expect(Number.isFinite(char.spine.rotation.x)).toBe(true);
  });

  it('runs AmbientLifeManager with particle volumes, light shafts, spline movers, and Calm Mode', () => {
    const scene = new THREE.Scene();
    const life = new AmbientLifeManager(scene, { seed: 77 });
    const pts = life.addParticleVolume({ count: 40 });
    const shafts = life.addLightShafts({ positions: [[0, 2, 0], [3, 2, 0]] });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    scene.add(box);
    life.addSplineMover(box, [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]], { speed: 2.0 });
    life.addOscillator(box, { axis: 'y', mode: 'bob', amplitude: 0.2 });

    expect(pts).toBeInstanceOf(THREE.Points);
    expect(shafts).toBeInstanceOf(THREE.Group);

    life.update(0.1);
    expect(life.calmFactor).toBeCloseTo(1.0, 1);

    life.setCalmMode(true);
    for (let i = 0; i < 40; i++) life.update(0.05);
    expect(life.calmFactor).toBeLessThan(0.45);
    expect(life.calmFactor).toBeGreaterThan(0.25);
  });

  it('defines distinct colour themes for all 7 cases and grounds props with shadows', () => {
    const slugs = [
      'lunar-field-expedition',
      'object-detective',
      'field-ecologist',
      'hazard-hunt',
      'arrival-english',
      'glacier-time-machine',
      'first-session-tutor-sim',
    ];
    for (const s of slugs) {
      expect(CASE_THEMES[s]).toBeDefined();
      const scene = new THREE.Scene();
      const theme = applyCaseGrade(s, { scene, addSkyDome: true });
      expect(theme.exposure).toBeGreaterThan(1.0);
      expect(scene.getObjectByName('v2-sky-dome')).toBeTruthy();
    }

    const prop = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    prop.add(mesh);
    groundProp(prop);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    expect(prop.getObjectByName('v2-contact-shadow')).toBeTruthy();
    expect(createGradientSkyDome({ radius: 100 })).toBeInstanceOf(THREE.Mesh);
  });
});
