// -- Mission Deck - js/data-events.js ----------------------------------
// One tiny bus for ONE fact: the team data on THIS disk just changed. A pull
// rewrites the plaintext tree, a decrypt fills it, "Discard changes" reverts it,
// a push moves the sync state - and every view painted from that tree (the
// team directory, Academy, the wizard, a module reading ds-data) was
// showing the state from before. Until this bus the only way to see the new
// data was F5, with the sync modal still open on top of a stale page.
//
// Same shape and the same reasoning as js/secrets-events.js, one axis over:
// a third module rather than direct calls, because the emitters (the streamed
// sync in js/sub-repo-sync-stream.js, the JSON ops in js/data-tier-0-sync.js)
// must not know who repaints what, and the sync modal can be opened from the
// top bar, from Settings or from the wizard.
//
// Deliberately NOT a state store: `detail` is for debugging only. Every
// listener re-fetches its own endpoint - no second copy of a dataset to go
// stale, the rule js/state.js states for the shell.

/** Event name. An id, so ASCII. */
export const DATA_CHANGED_EVENT = 'cockpit:data-changed';

/**
 * The bus itself. Read at call time (not at import time) so this module stays
 * importable under plain Node, where `document` does not exist.
 * @returns {EventTarget|null}
 */
function _bus() {
  return (typeof globalThis !== 'undefined' && globalThis.document) ? globalThis.document : null;
}

/**
 * Announce that the local team data changed. Safe to call from anywhere; a
 * missing document is a no-op rather than a throw. Call it ONLY on a successful
 * operation - a failed pull changed nothing and a repaint would just cost a
 * round of fetches.
 * @param {{repo?: string, op?: string}} [detail] free-form, for debugging only
 */
export function emitDataChanged(detail = {}) {
  const bus = _bus();
  if (!bus) return;
  bus.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail }));
}

/**
 * Subscribe to local team data changes.
 * @param {(ev: Event) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onDataChanged(handler) {
  const bus = _bus();
  if (!bus) return () => {};
  bus.addEventListener(DATA_CHANGED_EVENT, handler);
  return () => bus.removeEventListener(DATA_CHANGED_EVENT, handler);
}
