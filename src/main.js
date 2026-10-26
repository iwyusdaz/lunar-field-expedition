/**
 * App entry point: engine -> shell -> settings -> record -> text mode ->
 * cinematics -> scenes, per the template structure. All wiring lives in App.
 */
import { hasWebGL2 } from './core/assets.js';
import { boot } from './app.js';

export const SLUG = window.__SLUG__ || 'lunar-field-expedition';
window.__SLUG__ = SLUG;

function main() {
  if (!hasWebGL2()) {
    document.getElementById('stage')?.insertAdjacentHTML(
      'beforeend',
      '<div data-webgl-fallback role="alert"><p>WebGL is not available in this browser. ' +
      'You can still complete every objective in <strong>Text mode</strong> (button above) — ' +
      'it carries the same tasks, data and assessments.</p></div>',
    );
  }
  boot().catch((err) => {
    console.error(err);
    document.getElementById('task-panel')?.insertAdjacentHTML(
      'beforeend',
      `<div role="alert"><p>The experience failed to load (${String(err.message || err)}).
       Try reloading; if it persists, use Text mode from the header.</p></div>`,
    );
  });
}

main();
