/**
 * Live-region announcer: state changes (object selected, feedback, task complete)
 * go to an aria-live region (standards section 5, item 5).
 * @module a11y/announcer
 */

let container = null;
let politeNode = null;
let assertiveNode = null;

function ensure() {
  if (container) return;
  container = document.createElement('div');
  container.className = 'visually-hidden';
  container.setAttribute('aria-live', 'off');
  politeNode = document.createElement('div');
  politeNode.setAttribute('aria-live', 'polite');
  assertiveNode = document.createElement('div');
  assertiveNode.setAttribute('aria-live', 'assertive');
  container.append(politeNode, assertiveNode);
  document.body.appendChild(container);
}

/** Announce a message politely (default) or assertively (errors, critical state). */
export function announce(message, { assertive = false } = {}) {
  ensure();
  const node = assertive ? assertiveNode : politeNode;
  // Clear then set on next tick so repeated identical messages are re-announced.
  node.textContent = '';
  requestAnimationFrame(() => { node.textContent = message; });
}
