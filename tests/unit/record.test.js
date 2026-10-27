import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LearningRecord } from '../../src/learning/record.js';
import { EvidenceBoard } from '../../src/systems/evidence.js';
import { AppState } from '../../src/systems/state.js';

const SLUG = 'lunar-field-expedition';

describe('learning record (local-only, xAPI-shaped)', () => {
  it('logs statements under the slug key and reads them back', () => {
    localStorage.clear();
    const rec = new LearningRecord(SLUG);
    rec.log('completed', { id: 'm1-precheck', name: 'Pre-check' }, { response: { correct: 3, total: 5 } });
    rec.log('answered', { id: 'pre-1', name: 'Rille formation' }, { response: 'b', success: true });
    expect(rec.events).toHaveLength(2);
    expect(rec.events[0].verb.display['en-US']).toBe('completed');
    expect(rec.events[1].object.id).toBe(`urn:${SLUG}:pre-1`);
    expect(JSON.parse(localStorage.getItem(`${SLUG}:progress`))).toHaveLength(2);
  });

  it('latestAnswers returns the last response per object', () => {
    localStorage.clear();
    const rec = new LearningRecord(SLUG);
    rec.log('answered', { id: 'q1' }, { response: 'a' });
    rec.log('answered', { id: 'q1' }, { response: 'c' });
    rec.log('answered', { id: 'q2' }, { response: 'b' });
    expect(rec.latestAnswers()).toEqual({ 'urn:lunar-field-expedition:q1': 'c', 'urn:lunar-field-expedition:q2': 'b' });
  });

  it('clearProjectData removes ONLY this project slug-prefixed keys', () => {
    localStorage.clear();
    localStorage.setItem('other-project:state', 'keep-me');
    const rec = new LearningRecord(SLUG);
    rec.log('completed', { id: 'x' });
    localStorage.setItem(`${SLUG}:settings`, '{}');
    const removed = rec.clearProjectData();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(localStorage.getItem('other-project:state')).toBe('keep-me');
    expect(rec.events).toHaveLength(0);
  });

  it('toJSON produces a valid export envelope', () => {
    localStorage.clear();
    const rec = new LearningRecord(SLUG);
    rec.log('experienced', { id: 'cinematic-approach' });
    const parsed = JSON.parse(rec.toJSON());
    expect(parsed.slug).toBe(SLUG);
    expect(parsed.statements).toHaveLength(1);
  });
});

describe('evidence board', () => {
  it('adds, dedupes and reports tags', () => {
    localStorage.clear();
    const board = new EvidenceBoard(`${SLUG}:evidence`);
    board.add({ kind: 'sample', title: 'Mare basalt', text: 'x', evidenceTags: ['mare-material', 'age-contrast'], source: 'Elbow', moduleId: 'm4' });
    board.add({ kind: 'sample', title: 'Mare basalt', text: 'x again', evidenceTags: ['mare-material'], source: 'Elbow', moduleId: 'm4' });
    expect(board.items).toHaveLength(1);
    board.add({ kind: 'observation', title: 'Superposition', text: 'y', evidenceTags: ['superposition'], source: 'm3', moduleId: 'm3' });
    expect(board.tags().sort()).toEqual(['age-contrast', 'mare-material', 'superposition']);
    expect(board.hasAllTags(['mare-material', 'superposition'])).toBe(true);
    expect(board.hasAllTags(['front-material'])).toBe(false);
  });

  it('persists to localStorage and clears', () => {
    localStorage.clear();
    const board = new EvidenceBoard(`${SLUG}:evidence`);
    board.add({ kind: 'photo', title: 'T', text: 'x', evidenceTags: ['craters'], source: 'Dune', moduleId: 'm4' });
    const board2 = new EvidenceBoard(`${SLUG}:evidence`);
    expect(board2.items).toHaveLength(1);
    board2.clear();
    expect(board2.items).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(`${SLUG}:evidence`))).toHaveLength(0);
  });
});

describe('app state (save/resume)', () => {
  it('completes steps, stores decisions and resumes', () => {
    localStorage.clear();
    const state = new AppState(SLUG, ['m1', 'm2']);
    expect(state.state.module).toBe('m1');
    state.goToModule('m2');
    state.completeStep('m2-sun', { elevation: 12 });
    expect(state.isComplete('m2-sun')).toBe(true);
    const reloaded = new AppState(SLUG, ['m1', 'm2']);
    expect(reloaded.state.module).toBe('m2');
    expect(reloaded.state.decisions['m2-sun']).toEqual({ elevation: 12 });
  });

  it('reset returns a fresh state', () => {
    localStorage.clear();
    const state = new AppState(SLUG, ['m1', 'm2']);
    state.completeStep('m1-globe');
    state.reset();
    expect(state.state.completed).toHaveLength(0);
    expect(new AppState(SLUG, ['m1', 'm2']).state.completed).toHaveLength(0);
  });
});
