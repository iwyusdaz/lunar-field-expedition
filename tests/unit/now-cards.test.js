// Every Now card, rendered as the shell renders it (tool controls included),
// before and after its step is done: at most 60 words and an action or a
// question in each (plan 10 §2.1; S5 G1 F9: ui-audit only measures the state
// it opens, so m2 step 2's done card slipped through at 61-64 words).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Lessons, SUPERPOSITION, CLOCKS } from '../../src/lunar/lessons.js';
import { nowCardIssues } from '../../src/v3/shell.js';
import modules from '../../content/modules.json';
import items from '../../content/items.json';
import stations from '../../content/stations.json';
import cinematics from '../../content/cinematics.json';
import report from '../../content/report.json';
import features from '../../content/features.json';
import craters from '../../content/craters.json';

/** A minimal element: enough for the lesson tools to build their controls; text() reads what a learner would see. */
function fakeElement(tag) {
  const e = {
    tagName: tag.toUpperCase(), children: [], textContent: '', style: {}, dataset: {}, attributes: {}, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append(...k) { for (const c of k) e.children.push(typeof c === 'string' ? { text: () => c } : c); },
    appendChild(c) { e.append(c); return c; },
    setAttribute(k, v) { e.attributes[k] = String(v); }, getAttribute: (k) => e.attributes[k] ?? null, removeAttribute(k) { delete e.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    text() { return e.hidden ? '' : [e.textContent, ...(tag === 'input' ? [] : e.children.map((c) => c.text?.() ?? ''))].filter(Boolean).join(' '); },
  };
  return e;
}

const cardText = (n, toolBox) => [n.step ? `Step ${n.step} of ${n.total}` : n.kicker, n.goal, n.action, n.result, n.question?.prompt,
  ...(n.question?.choices || []).map((c) => c.text), toolBox?.text(), n.hint, n.primary?.label, n.secondary?.label, n.readMore?.label].filter(Boolean).join(' ');

describe('every Now card: at most 60 words and an action (G1 F9)', () => {
  const saved = globalThis.document;
  beforeAll(() => { globalThis.document = { createElement: fakeElement, createElementNS: (_, t) => fakeElement(t), activeElement: null }; });
  afterAll(() => { globalThis.document = saved; });

  const L = new Lessons({ slug: 'unit-now', content: { modules, items, stations, cinematics, report, features, craters } });
  const mods = L.modules();
  const app = { engine: null, record: { log() {} }, shell: { touch: false, setNow() {}, toast() {}, setModuleDone() {}, now: { querySelector: () => null } }, module: 0, goModule() {}, completeModule() {} };
  L.app = app; L.record = app.record;
  // The answers a learner ends with, for the done pass.
  const ANSWERS = { 'm3-superposition': SUPERPOSITION.correct, 'm3-debrief': CLOCKS.correct, 'm4-hypothesis': 'h-front' };
  const render = (i, k) => {
    L.step[i] = k;
    const n = L.nowFor(i);
    let box = null;
    if (n.tool) { box = fakeElement('div'); n.tool(box, app.shell); }
    return { n, text: cardText(n, box) };
  };
  for (const pass of ['fresh', 'done']) {
    for (const [i, steps] of L.steps.entries()) {
      for (const [k, st] of steps.entries()) {
        it(`${pass}: ${mods[i].id} step ${k + 1} (${st.id})`, () => {
          if (pass === 'done') {
            for (const f of features.features || []) L.state.completeStep(`${st.id}-${f.id}`, true);
            if (st.id === 'm3-count') { L.cc.submitted = true; L.cc.result = { counts: { mare: 0, front: 0 }, densities: { mare: 0, front: 0 } }; }
            L.state.completeStep(st.id, ANSWERS[st.id] ?? true);
          }
          const { n, text } = render(i, k);
          const r = nowCardIssues(text, n);
          if (process.env.NOW_DEBUG) console.log(st.id, pass, r.words);
          expect(r.issues, `"${text}"`).toEqual([]);
        });
      }
    }
  }
});
