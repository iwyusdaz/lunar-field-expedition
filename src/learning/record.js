/**
 * Local-only, xAPI-shaped learning record (standards section 7).
 * Events: experienced / answered / completed. Stored in localStorage under a
 * slug-prefixed key. Nothing is sent anywhere. Viewable and downloadable as JSON
 * on the "My progress" page, with "Clear my data" clearing ONLY this project's keys.
 * @module learning/record
 */

const VERBS = { experienced: 'experienced', answered: 'answered', completed: 'completed', attempted: 'attempted' };

export class LearningRecord {
  constructor(slug) {
    this.slug = slug;
    this.key = `${slug}:progress`;
    this.events = this._load();
    this.listeners = new Set();
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch { return []; }
  }

  _save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.events)); } catch { /* private mode */ }
    for (const fn of this.listeners) fn(this.events);
  }

  onChange(fn) { this.listeners.add(fn); }

  /** @param {'experienced'|'answered'|'completed'|'attempted'} verb */
  log(verb, object, result = null) {
    this.events.push({
      timestamp: new Date().toISOString(),
      actor: { account: { homePage: 'urn:local-device', name: 'anonymous-learner' } },
      verb: { display: { 'en-US': VERBS[verb] || verb } },
      object: { id: `urn:${this.slug}:${object.id}`, definition: { name: { 'en-US': object.name || object.id }, description: object.description ? { 'en-US': object.description } : undefined } },
      ...(result ? { result } : {}),
    });
    this._save();
  }

  /** Latest answer per object id (for resume + progress). */
  latestAnswers() {
    const out = {};
    for (const e of this.events) {
      if (e.verb.display['en-US'] === 'answered' && e.result?.response != null) {
        out[e.object.id] = e.result.response;
      }
    }
    return out;
  }

  clear() {
    this.events = [];
    try { localStorage.removeItem(this.key); } catch { /* ignore */ }
    this._save();
  }

  /** Clear ONLY this project's keys (build contract: slug prefix). */
  clearProjectData() {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${this.slug}:`)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
    this.events = [];
    this._save();
    return toRemove.length;
  }

  toJSON() { return JSON.stringify({ slug: this.slug, exportedAt: new Date().toISOString(), statements: this.events }, null, 2); }

  download() {
    const blob = new Blob([this.toJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.slug}-progress.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}
