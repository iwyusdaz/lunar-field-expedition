/**
 * App state: module progression, decisions, traverse plan and report draft.
 * Saved under a slug-prefixed localStorage key (shared-origin rule) so learners
 * can resume across sittings. Nothing leaves the browser.
 * @module systems/state
 */

export class AppState {
  /**
   * @param {string} slug
   * @param {string[]} moduleIds ordered module ids
   */
  constructor(slug, moduleIds) {
    this.slug = slug;
    this.key = `${slug}:state`;
    this.moduleIds = moduleIds;
    this.state = this._load() || this._fresh();
  }

  _fresh() {
    return {
      module: this.moduleIds[0],
      completed: [],        // step ids
      decisions: {},        // stepId -> payload
      traverse: null,       // {hypothesis, route, accounting, evidenceTags, scored}
      report: null,         // {claim,evidence,reasoning,uncertainty,selfCheck}
      cinematicSeen: {},
      preCheck: null,       // {answers, score}
      postCheck: null,
    };
  }

  _load() {
    try {
      const s = JSON.parse(localStorage.getItem(this.key) || 'null');
      if (!s) return null;
      // merge forward-compatible
      return { ...this._fresh(), ...s };
    } catch { return null; }
  }

  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch { /* private mode */ }
  }

  goToModule(id) {
    this.state.module = id;
    this.save();
  }

  completeStep(stepId, payload) {
    if (!this.state.completed.includes(stepId)) this.state.completed.push(stepId);
    if (payload !== undefined) this.state.decisions[stepId] = payload;
    this.save();
  }

  isComplete(stepId) { return this.state.completed.includes(stepId); }

  reset() {
    this.state = this._fresh();
    this.save();
  }
}
