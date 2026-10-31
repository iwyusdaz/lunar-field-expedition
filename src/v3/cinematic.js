/**
 * cinematic.js — cinematics that never block controls (plan 10 §2.1).
 * Wraps the template ShotPlayer: during a shot only the caption and the Skip
 * button exist on top of the scene. The caption passes clicks through; the
 * shell hides the top bar, Now card, labels and camera cluster (phase
 * "cinematic") and the task UI comes back after the shot ends or is skipped.
 * @module v3/cinematic
 */
import { ShotPlayer } from '../cinematics/shot-player.js';

export class CinematicV3 extends ShotPlayer {
  /**
   * @param {object} o
   * @param {import('./shell.js').SceneShell} o.shell
   * @param {import('three').PerspectiveCamera} o.camera
   * @param {import('../a11y/motion.js').MotionPrefs} o.motion
   * @param {{ setEnabled: (on: boolean) => void }[]} [o.pause]  systems to switch off during a shot (rig, inspect)
   * @param {Function} [o.onDone]  @param {Function} [o.onSkip]
   */
  constructor(o) {
    super({ container: o.shell.cinematicHost, camera: o.camera, motion: o.motion, onSkip: o.onSkip });
    this.shell = o.shell;
    this.pauseList = o.pause || [];
    this._after = o.onDone;
    this.onDone = () => this._end();
    const skip = this.root.querySelector('.cinematic-skip');
    skip.dataset.ui = 'skip';
    skip.className = 'v3-btn v3-skip';
    skip.textContent = 'Skip (Esc)';
    this.progress.hidden = true;
    this.root.classList.add('v3-cinematic');
  }

  play() {
    this._prevPhase = this.shell.phase;
    this.shell.setPhase('cinematic');
    for (const s of this.pauseList) s.setEnabled(false);
    super.play();
  }

  _end() {
    for (const s of this.pauseList) s.setEnabled(true);
    this.shell.setPhase(this._prevPhase && this._prevPhase !== 'cinematic' ? this._prevPhase : 'explore');
    this._after?.();
    // One-shot repo callback for the shot that just ended or was skipped.
    const f = this.onFinish; this.onFinish = null; f?.();
  }
}
