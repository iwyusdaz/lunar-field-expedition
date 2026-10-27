/**
 * Evidence board store: observations, measurements, photos and samples
 * collected during the modules; tagged so the CER builder can check which
 * evidence TYPES were cited (structured tags — never graded prose).
 * Persisted with the app state under a slug-prefixed key.
 * @module systems/evidence
 */

export class EvidenceBoard {
  constructor(storageKey) {
    this.storageKey = storageKey;
    this.items = this._load();
    this.listeners = new Set();
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(this.storageKey) || '[]'); } catch { return []; }
  }

  _save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.items)); } catch { /* private mode */ }
    for (const fn of this.listeners) fn(this.items);
  }

  onChange(fn) { this.listeners.add(fn); }

  /**
   * @param {{kind:'observation'|'measurement'|'photo'|'sample', title:string, text:string,
   *           evidenceTags:string[], source:string, moduleId:string}} item
   */
  add(item) {
    const entry = { id: `ev-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, addedAt: new Date().toISOString(), ...item };
    if (this.items.some(e => e.title === entry.title && e.source === entry.source)) return entry; // dedupe
    this.items.push(entry);
    this._save();
    return entry;
  }

  remove(id) {
    this.items = this.items.filter(e => e.id !== id);
    this._save();
  }

  tags() {
    const out = new Set();
    for (const e of this.items) for (const t of e.evidenceTags) out.add(t);
    return [...out];
  }

  /** Remove the evidence one module added (used when that module is redone). */
  removeModule(moduleId) {
    this.items = this.items.filter(e => e.moduleId !== moduleId);
    this._save();
  }

  hasAllTags(tags) { return tags.every(t => this.tags().includes(t)); }

  clear() { this.items = []; this._save(); }

  /** Render into a container (used by Module 5 board view). */
  render(container) {
    container.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = `Evidence board (${this.items.length})`;
    container.appendChild(h);
    if (!this.items.length) {
      const p = document.createElement('p');
      p.textContent = 'No evidence yet. It fills as you complete the modules.';
      container.appendChild(p);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'evidence-list';
    for (const e of this.items) {
      const li = document.createElement('li');
      li.className = `evidence evidence-${e.kind}`;
      const kind = document.createElement('span');
      kind.className = 'evidence-kind';
      kind.textContent = { observation: 'Observation', measurement: 'Measurement', photo: 'Photo', sample: 'Sample' }[e.kind] || e.kind;
      const title = document.createElement('strong');
      title.textContent = ` ${e.title} — `;
      const text = document.createElement('span');
      text.textContent = e.text;
      const src = document.createElement('span');
      src.className = 'evidence-source';
      src.textContent = ` (${e.source})`;
      li.append(kind, title, text, src);
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }
}
