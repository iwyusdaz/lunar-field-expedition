/**
 * onboarding.js — first-run practice (plan 10 §9 "First-run onboarding").
 *
 * A skippable 30-60 s in-world practice in the Now card that teaches look,
 * move, click and inspect, each step finished by doing it, then hands over to
 * the first real task. It runs once per browser (slug-prefixed flag); "Replay
 * the practice" in the menu runs it again. The "?" key and the menu show the
 * controls cheat sheet at any time (shell.openControls).
 * @module v3/onboarding
 */

export class Onboarding {
  /**
   * @param {object} o
   * @param {import('./shell.js').SceneShell} o.shell
   * @param {import('./camera-rig.js').CameraRig} o.rig
   * @param {import('./inspect.js').InspectSystem} o.inspect
   * @param {string} [o.practiceObject]  catalog id suggested in the click step
   * @param {() => void} o.onFinish       start the first real task
   */
  constructor(o) {
    Object.assign(this, o);
    this.key = `${o.shell.slug}:onboarded`;
    this.active = false;
    this._offs = [];
  }

  get done() { try { return localStorage.getItem(this.key) === 'yes'; } catch { return false; } }

  steps() {
    const touch = this.shell.touch;
    const name = this.practiceObject ? this.inspect.catalog.get(this.practiceObject)?.name : null;
    const list = [
      { id: 'look', goal: 'Look around', action: touch ? 'Drag one finger across the scene to turn the view.' : 'Drag the scene with the mouse to turn the view.', hint: touch ? 'Pinch to zoom.' : 'Keys: Q and E turn, R and F tilt.' },
    ];
    if (this.shell.walkable) list.push({ id: 'move', goal: 'Move', action: touch ? 'Push the joystick to walk a few steps.' : 'Walk a few steps with W A S D or the arrow keys.', hint: 'Double-click the ground to fly there.' });
    else list.push({ id: 'move', goal: 'Zoom', action: touch ? 'Pinch to zoom in or out.' : 'Zoom in or out with the mouse wheel.', hint: 'Keys: + and -.' });
    list.push({ id: 'click', goal: 'Click an object', action: name ? `Point at the ${name} and click it. Any object works.` : 'Point at any object and click it.', hint: touch ? 'Tap an object.' : 'Its name shows when the pointer is over it.' });
    list.push({ id: 'inspect', goal: 'Read and close the card', action: 'The card tells you what the object is. Close it with ✕ or Esc.', hint: 'Every object you open goes into your journal.' });
    return list;
  }

  start() {
    this.active = true;
    this.i = 0;
    this._list = this.steps();
    this._moved = 0;
    this._looked = 0;
    this._offs.push(this.rig.on('interact', (kind, amount) => {
      if (!this.active) return;
      const s = this._list[this.i]?.id;
      if (s === 'look' && kind === 'look') { this._looked += amount; if (this._looked > 0.6) this._next(); }
      if (s === 'move' && (kind === 'move' || kind === 'zoom' || kind === 'pan')) { this._moved += amount || 0.05; if (this._moved > (kind === 'zoom' ? 0.4 : 2)) this._next(); }
    }));
    this._offs.push(this.inspect.on('open', () => { if (this.active && this._list[this.i]?.id === 'click') this._next(); }));
    this._offs.push(this.inspect.on('close', () => { if (this.active && this._list[this.i]?.id === 'inspect') this._next(); }));
    this._show();
  }

  _show() {
    const s = this._list[this.i];
    this.shell.setNow({
      kicker: `Practice ${this.i + 1} of ${this._list.length}`,
      goal: s.goal, action: s.action, hint: s.hint,
      primary: { label: 'Skip practice', onClick: () => this.finish(true) },
    });
  }

  _next() {
    this.i++;
    if (this.i >= this._list.length) { this.finish(false); return; }
    this._show();
  }

  /** End the practice (also called when the learner jumps to a module). */
  finish(skipped = false) {
    if (!this.active) return;
    this.active = false;
    for (const off of this._offs) off();
    this._offs = [];
    try { localStorage.setItem(this.key, 'yes'); } catch { /* ignore */ }
    if (!skipped) this.shell.toast('Practice done. Here is your first task.');
    this.onFinish?.(skipped);
  }
}
