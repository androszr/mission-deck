// ── Mission Deck — js/loading-animations.js ───────────────────────────────
// Loading scene: Pip, the Mission Deck mascot, at work while a long operation
// (a git fetch, a respawn, a lazy view import) runs. The artwork is the
// committed SVG assets/mascot/pip-working.svg; this module only builds the box
// around it plus three pulsing dots and an optional caption.
//
// Two modes, one call:
//   full (default)    - a soft panel behind the mascot. For a modal that
//                       makes somebody wait on a fetch and a respawn.
//   { minimal: true } - transparent background. For an inline wait inside a
//                       view that has its own background.
//
// The SVG animates itself (CSS inside the file) and honours
// prefers-reduced-motion on its own; the dots are styled in styles.css
// (.mascot-loader__dots) with the same reduced-motion guard. No rAF loop, no
// canvas, no listeners - stop() only removes the markup.
//
// Free of `document` at module top level, so importing this from a Node test
// never touches it; startLoadingAnimation() degrades to a callable no-op when
// createElement is missing.

export const LOADER_MASCOT_SRC = '/assets/mascot/pip-working.svg';

/** host element -> stop function of the scene currently painted into it */
const _running = new WeakMap();

function _stopFor(el) {
  const prev = _running.get(el);
  if (prev) { _running.delete(el); prev(); }
}

/**
 * Paint the mascot loading scene into `el`, replacing its content.
 *
 * @param {Element|null} el host element
 * @param {{ minimal?: boolean, label?: string }} [opts]
 *   `minimal` drops the panel background for an inline wait.
 *   `label` renders caption text under the mascot.
 * @returns {() => void} stop function; idempotent, and safe to call after the
 *   host has left the document
 */
export function startLoadingAnimation(el, opts = {}) {
  if (!el) return function () {};
  _stopFor(el);

  // Node / fake-document path: some test doubles stub only part of `document`
  // (getElementById but not createElement). Nothing to build, so hand back a
  // callable no-op rather than throwing inside a view's render.
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    const noop = function () { if (_running.get(el) === noop) _running.delete(el); };
    _running.set(el, noop);
    return noop;
  }

  const wrap = document.createElement('div');
  wrap.className = 'mascot-loader' + (opts.minimal ? ' mascot-loader--minimal' : '');

  const img = document.createElement('img');
  img.className = 'mascot-loader__img';
  img.src = LOADER_MASCOT_SRC;
  img.alt = '';
  // Decoration. A screen reader gets nothing from the picture, and the modal
  // (or the label below) already says what is being waited on.
  img.setAttribute('aria-hidden', 'true');
  wrap.appendChild(img);

  const dots = document.createElement('span');
  dots.className = 'mascot-loader__dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('span'));
  wrap.appendChild(dots);

  if (opts.label) {
    const labelEl = document.createElement('span');
    labelEl.className = 'mascot-loader__label';
    labelEl.textContent = opts.label;
    wrap.appendChild(labelEl);
  }
  el.replaceChildren(wrap);

  const stop = function () {
    if (_running.get(el) === stop) _running.delete(el);
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  };
  _running.set(el, stop);
  return stop;
}
