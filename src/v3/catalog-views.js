/**
 * catalog-views.js — DOM views of the catalog for parity (plan 10 §4.2):
 * the text-mode objects page and the discovery journal drawer.
 * @module v3/catalog-views
 */
import { HONESTY_LABELS, ROLE_LABELS } from './catalog.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/**
 * Text-mode page listing every course-relevant catalog object (role task or
 * learn) with its full card; decorative objects get no card (owner decision
 * 2026-11-07). Opening an entry counts as a discovery, so the journal works
 * without the 3D view.
 * @param {HTMLElement} container
 * @param {ReturnType<import('./catalog.js').createCatalog>} catalog
 * @param {import('./journal.js').DiscoveryJournal} journal
 * @param {{ heading?: string, ids?: string[] }} [opts]  ids limits the list (default: every course-relevant object)
 */
export function renderCatalogText(container, catalog, journal, { heading = 'Objects in this place', ids } = {}) {
  const sec = el('section', 'v3-tm-objects');
  sec.setAttribute('aria-labelledby', 'v3-tm-objects-h');
  const h = el('h3', null, heading);
  h.id = 'v3-tm-objects-h';
  const count = el('p', 'v3-tm-count', journal.label());
  count.setAttribute('aria-live', 'polite');
  sec.append(h, count);
  const course = catalog.inspectable || catalog.objects;
  const list = ids ? ids.map((id) => catalog.get(id)).filter((o) => o && course.includes(o)) : course;
  for (const o of list) {
    const d = el('details');
    d.dataset.objectId = o.id;
    const s = el('summary', null, `${o.name}${journal.has(o.id) ? ' (found)' : ''}`);
    d.append(s);
    d.append(el('p', 'v3-tag', `${HONESTY_LABELS[o.honesty] || o.honesty} · ${ROLE_LABELS[o.role] || o.role}`));
    d.append(el('p', null, o.short));
    d.append(el('p', null, o.more));
    if (o.whyItMatters) d.append(el('p', null, `Why it matters: ${o.whyItMatters}`));
    if (o.source) {
      const p = el('p');
      const a = el('a', null, 'Source');
      a.href = o.source; a.target = '_blank'; a.rel = 'noopener';
      p.append(a);
      d.append(p);
    }
    d.addEventListener('toggle', () => {
      if (d.open && journal.discover(o.id)) { s.textContent = `${o.name} (found)`; count.textContent = journal.label(); }
    });
    sec.append(d);
  }
  container.append(sec);
  return sec;
}

/** Journal drawer: the counter, then every found object with its short card text. */
export function renderJournal(container, journal) {
  container.append(el('p', null, `${journal.label()}. Finding objects is optional; it never blocks your progress.`));
  const found = journal.entries();
  if (!found.length) { container.append(el('p', null, 'Nothing yet. Click or tap any object in the scene, or use Objects in view.')); return; }
  const ul = el('ul', 'v3-journal');
  for (const o of found) {
    const li = el('li');
    li.append(el('h3', null, o.name), el('p', 'v3-tag', HONESTY_LABELS[o.honesty] || o.honesty), el('p', null, o.short));
    ul.append(li);
  }
  container.append(ul);
}
