/**
 * Text mode shell with parity: covers the SAME learning objectives and assessment
 * decisions as the 3D mode (standards section 5, item 2).
 *
 * The app supplies, per module/state, a renderer that produces DOM sections from
 * content/*.json (descriptions, data tables, structured choice lists). This shell
 * provides the container, navigation, and the same decision/answer API surface as
 * the 3D mode so shared assessment code drives both.
 * @module a11y/text-mode
 */

export class TextMode {
  constructor({ root, slug, onDecision }) {
    this.root = root;
    this.slug = slug;
    this.onDecision = onDecision;
    this.sections = new Map(); // moduleId -> render function
    this.activeId = null;
    this.root.hidden = true;
  }

  /** Register a module renderer: fn(container, api). api.answer(id, payload) routes decisions. */
  register(moduleId, renderFn) {
    this.sections.set(moduleId, renderFn);
  }

  show(moduleId) {
    this.activeId = moduleId;
    this.root.hidden = false;
    const fn = this.sections.get(moduleId);
    this.root.innerHTML = '';
    if (!fn) {
      this.root.innerHTML = `<p>Text mode for this section is not available.</p>`;
      return;
    }
    const h = document.createElement('h2');
    h.className = 'textmode-title';
    this.root.appendChild(h);
    const body = document.createElement('div');
    body.className = 'textmode-body';
    this.root.appendChild(body);
    fn(body, { answer: (id, payload) => this.onDecision?.(id, payload), setTitle: (t) => { h.textContent = t; } });
    this.root.scrollTop = 0;
  }

  hide() { this.root.hidden = true; this.activeId = null; }
}

/** Build a data table from rows (used everywhere in text mode). */
export function dataTable(headers, rows, caption) {
  const table = document.createElement('table');
  if (caption) {
    const cap = document.createElement('caption');
    cap.textContent = caption;
    table.appendChild(cap);
  }
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = String(cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/** Standard multiple-choice item usable in both modes (shared assessment). */
export function choiceItem({ prompt, options, onAnswer, announceEl }) {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = prompt;
  fieldset.appendChild(legend);
  for (const opt of options) {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `q-${hashCode(prompt)}`;
    input.value = opt.id;
    label.append(input, Object.assign(document.createElement('span'), { textContent: ' ' + opt.text }));
    fieldset.appendChild(label);
  }
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = 'Submit answer';
  submit.addEventListener('click', () => {
    const sel = fieldset.querySelector('input:checked');
    if (!sel) return;
    const opt = options.find(o => o.id === sel.value);
    onAnswer(opt);
  });
  fieldset.appendChild(submit);
  return fieldset;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
