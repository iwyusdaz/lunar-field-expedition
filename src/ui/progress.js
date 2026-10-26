/**
 * "My progress" page: shows the local-only xAPI-shaped record, download as JSON,
 * "Clear my data" clearing only this project's slug-prefixed keys.
 * Nothing is ever sent anywhere (standards section 7).
 * @module ui/progress
 */
import { openDialog, closeDialog } from '../a11y/focus.js';

export class ProgressPage {
  /**
   * @param {object} opts
   * @param {string} opts.slug
   * @param {HTMLDialogElement} opts.dialog
   * @param {import('../learning/record.js').LearningRecord} opts.record
   */
  constructor({ slug, dialog, record }) {
    this.slug = slug;
    this.dialog = dialog;
    this.record = record;
  }

  open(trigger) {
    const d = this.dialog;
    const events = this.record.events;
    const byVerb = {};
    for (const e of events) {
      const v = e.verb.display['en-US'];
      byVerb[v] = (byVerb[v] || 0) + 1;
    }
    d.innerHTML = `
      <h2>My progress</h2>
      <p>Your learning record is saved only in this browser. Nothing is sent anywhere.</p>
      <p>Events recorded: <strong>${events.length}</strong>
        (${Object.entries(byVerb).map(([v, n]) => `${v}: ${n}`).join(', ') || 'none yet'})</p>
      <details>
        <summary>View the full record</summary>
        <pre class="progress-json" tabindex="0">${events.length ? escapeHTML(JSON.stringify(events.slice(-50), null, 2)) : 'No events yet.'}</pre>
      </details>
      <menu>
        <button type="button" id="prog-download">Download as JSON</button>
        <button type="button" id="prog-clear">Clear my data</button>
        <button type="button" id="prog-close">Close</button>
      </menu>`;
    d.querySelector('#prog-download').addEventListener('click', () => this.record.download());
    d.querySelector('#prog-clear').addEventListener('click', () => {
      const n = this.record.clearProjectData();
      d.querySelector('p').textContent = `Cleared ${n} saved item(s) for this project. Your record is now empty.`;
      this.record.onChange?.(() => {});
    });
    d.querySelector('#prog-close').addEventListener('click', () => closeDialog(d));
    openDialog(d, trigger);
  }
}

function escapeHTML(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
