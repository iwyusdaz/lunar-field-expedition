/**
 * layers.js — JS mirror of the z-index registry in layers.css, plus the check
 * that keeps ad-hoc z-index values out of repo CSS and JS (plan 10 §2.1).
 * @module v3/layers
 */

/** Same order and values as layers.css. Use the CSS tokens in stylesheets. */
export const LAYERS = Object.freeze({
  scene: 0,
  'world-label': 10,
  hud: 20,
  card: 30,
  drawer: 40,
  title: 50,
  cinematic: 60,
  toast: 70,
  'skip-link': 80,
});

/**
 * Find z-index values that do not come from the registry.
 * Allowed: `z-index: var(--z-<layer>)` (with or without a fallback), `auto`,
 * `inherit`, `initial`, `unset`, and 0/-1 (local stacking inside a component).
 * In JS, any `style.zIndex = <number>` or `zIndex: <number>` is reported.
 * @param {string} text  file contents
 * @param {'css'|'js'} kind
 * @returns {{ line: number, text: string }[]}
 */
export function findAdHocZIndex(text, kind = 'css') {
  const out = [];
  const lines = String(text).split('\n');
  const tokenNames = Object.keys(LAYERS).map((k) => `--z-${k}`);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, kind === 'js' ? '' : '$&');
    if (kind === 'css') {
      const m = line.match(/z-index\s*:\s*([^;}]+)/i);
      if (!m) return;
      const v = m[1].trim();
      if (/^(auto|inherit|initial|unset|revert|0|-1)$/i.test(v)) return;
      const tok = v.match(/^var\(\s*(--z-[a-z-]+)\s*(?:,\s*-?\d+\s*)?\)$/i);
      if (tok && tokenNames.includes(tok[1])) return;
      out.push({ line: i + 1, text: raw.trim() });
    } else {
      if (/zIndex\s*[:=]\s*['"]?-?\d{1,}/.test(line) && !/zIndex\s*[:=]\s*['"]?(0|-1)['"]?\s*[,;)}]/.test(line)) {
        out.push({ line: i + 1, text: raw.trim() });
      }
    }
  });
  return out;
}
