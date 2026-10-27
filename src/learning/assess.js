/**
 * Assessment engine shared by 3D mode and text mode: item players + scoring +
 * "why" feedback. Used for pre-checks, embedded performance items, post-checks
 * and transfer tasks. No automated grading of free text anywhere.
 * @module learning/assess
 */
import { announce } from '../a11y/announcer.js';

/**
 * Render a scored multiple-choice item. Calls onAnswered(result) with
 * { itemId, correct, chosen } and logs through the record by the caller.
 */
export function mcItem({ item, container, onAnswered, showFeedback = true }) {
  const wrap = document.createElement('section');
  wrap.className = 'assessment-item';
  const h = document.createElement('h3');
  h.textContent = item.prompt;
  wrap.appendChild(h);
  const options = document.createElement('div');
  options.setAttribute('role', 'radiogroup');
  options.setAttribute('aria-label', item.prompt);
  const buttons = [];
  for (const opt of item.options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice-btn';
    b.textContent = opt.text;
    b.addEventListener('click', () => {
      const correct = opt.id === item.correct;
      if (showFeedback) {
        for (const x of buttons) x.disabled = true;
        b.classList.add(correct ? 'correct' : 'incorrect');
        const why = opt.why || item.why || '';
        const prefix = correct && /^correct/i.test(why) ? '' : (correct ? 'Correct.' : 'Not quite.');
        const fb = document.createElement('div');
        fb.className = 'feedback';
        fb.innerHTML = `<p><strong>${prefix}</strong> ${why}</p>`;
        wrap.appendChild(fb);
      }
      announce(correct ? 'Correct' : 'Answer recorded');
      onAnswered?.({ itemId: item.id, correct, chosen: opt.id });
    });
    buttons.push(b);
    options.appendChild(b);
  }
  wrap.appendChild(options);
  container.appendChild(wrap);
  return wrap;
}

/** Score a set of answered items: returns { correct, total, byItem }. */
export function scoreAnswers(answers) {
  const byItem = {};
  let correct = 0;
  for (const a of answers) {
    byItem[a.itemId] = a.correct;
    if (a.correct) correct++;
  }
  return { correct, total: answers.length, byItem, ratio: answers.length ? correct / answers.length : 0 };
}

/**
 * Structured rubric self-check (used by CER report, label writer, methods report):
 * learner rates their own draft against each criterion; the app shows the rubric
 * and an exemplar. No auto-grading of the text itself.
 */
export function rubricSelfCheck({ criteria, container, onComplete }) {
  const wrap = document.createElement('section');
  wrap.className = 'rubric-selfcheck';
  wrap.innerHTML = '<h3>Self-check against the rubric</h3><p>Rate your own draft for each criterion. This self-check is not a grade.</p>';
  const ratings = {};
  for (const c of criteria) {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = c.name;
    fs.appendChild(lg);
    c.levels.forEach((level, i) => {
      const label = document.createElement('label');
      label.className = 'choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `rubric-${c.id}`;
      input.value = String(i);
      label.append(input, Object.assign(document.createElement('span'), { textContent: ` ${i + 1}. ${level}` }));
      fs.appendChild(label);
    });
    wrap.appendChild(fs);
  }
  const done = document.createElement('button');
  done.type = 'button';
  done.textContent = 'Finish self-check';
  done.addEventListener('click', () => {
    for (const c of criteria) {
      const sel = wrap.querySelector(`input[name="rubric-${c.id}"]:checked`);
      ratings[c.id] = sel ? parseInt(sel.value, 10) : null;
    }
    onComplete?.(ratings);
  });
  wrap.appendChild(done);
  container.appendChild(wrap);
  return wrap;
}
