/**
 * attribution.json contract (review H-2): every entry carries its own licence
 * under `license`, the retrieval date under `retrieved`, and the keys line up
 * with the ATTRIBUTION.md table columns.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync('public/attribution.json', 'utf8'));
const LICENCE = /(CC0|CC BY|Public domain|\bPD\b|MIT|OFL|Apache|BSD)/i;

describe('public/attribution.json', () => {
  it('has one entry per ATTRIBUTION.md table row', () => {
    const md = readFileSync('ATTRIBUTION.md', 'utf8');
    const tableRows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(rows.length).toBe(tableRows.length);
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('every entry has a non-empty licence that looks like a licence', () => {
    for (const r of rows) {
      expect(r.license, r.asset).toBeTruthy();
      expect(r.license, r.asset).toMatch(LICENCE);
      expect(r.license, r.asset).not.toMatch(/^https?:\/\//);
    }
  });

  it('asset names are not row numbers and retrieved fields are dates', () => {
    for (const r of rows) {
      expect(r.asset).not.toMatch(/^\d+$/);
      // original work (favicon, procedural props) has no retrieval date: "—"
      expect(r.retrieved, r.asset).toMatch(/^(\d{4}-\d{2}-\d{2}|—)$/);
      expect(r.changes, r.asset).toBeTruthy();
    }
  });
});
