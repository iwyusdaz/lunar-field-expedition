/**
 * journal.js — discovery journal (plan 10 §4.2).
 *
 * Records which catalog objects the learner has opened (by mouse, keyboard
 * list or text mode). Finding things is optional and never blocks progress.
 * Saved under a slug-prefixed localStorage key (shared origin with the other
 * projects), cleared by the template's "Clear my data".
 * @module v3/journal
 */

export class DiscoveryJournal {
  /**
   * @param {object} opts
   * @param {string} opts.slug
   * @param {{ objects: object[], has: (id: string) => boolean }} opts.catalog
   * @param {Storage} [opts.storage]  defaults to window.localStorage when present
   */
  constructor({ slug, catalog, storage }) {
    this.slug = slug;
    this.catalog = catalog;
    this.key = `${slug}:discovered`;
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this.found = new Map(); // id -> ISO time first opened
    this._listeners = new Set();
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(this.storage?.getItem(this.key) || '{}');
      for (const [id, at] of Object.entries(raw)) if (this.catalog.has(id)) this.found.set(id, at);
    } catch { /* private mode or bad JSON: start empty */ }
  }

  _save() {
    try { this.storage?.setItem(this.key, JSON.stringify(Object.fromEntries(this.found))); } catch { /* ignore */ }
  }

  /** Mark an object found. Returns true the first time. */
  discover(id) {
    if (!this.catalog.has(id) || this.found.has(id)) return false;
    this.found.set(id, new Date().toISOString());
    this._save();
    for (const fn of this._listeners) fn(this.count, this.total, id);
    return true;
  }

  has(id) { return this.found.has(id); }
  get count() { return this.found.size; }
  get total() { return this.catalog.objects.length; }
  /** Found catalog entries in the order they were found. */
  entries() {
    return [...this.found.keys()].map((id) => this.catalog.objects.find((o) => o.id === id)).filter(Boolean);
  }
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  /** "Discovered 12 of 31" */
  label() { return `Discovered ${this.count} of ${this.total}`; }

  clear() {
    this.found.clear();
    try { this.storage?.removeItem(this.key); } catch { /* ignore */ }
    for (const fn of this._listeners) fn(0, this.total, null);
  }
}
