// -- Mission Deck - js/secrets-events.js -------------------------------
// One tiny bus for ONE fact: the set of credentials the SERVER holds in memory
// just changed (a Bitwarden unlock, a secrets refresh). Everything painted from
// a token - the top bar avatar, the "Active" chip, the Keys cards, the tools
// probe - is derived state, and before this bus the only way to re-derive it
// was a page reload.
//
// A third module rather than a direct call: js/settings.js already imports
// js/topbar.js and the top bar dynamic-imports settings for the modal, so a
// second static edge would close a cycle. It is also one-to-many by nature -
// the unlock can be started from the top bar pill, from Settings or from the
// onboarding wizard, and none of them should have to know who repaints what.
//
// Deliberately NOT a state store: the event carries no payload worth trusting.
// Every listener re-fetches its own endpoint, which is the same rule js/state.js
// states for the shell - no second copy of a dataset to go stale.

/** Event name. An id, so ASCII. */
export const SECRETS_CHANGED_EVENT = 'cockpit:secrets-changed';

/**
 * The bus itself. Read at call time (not at import time) so this module stays
 * importable under plain Node, where `document` does not exist.
 * @returns {EventTarget|null}
 */
function _bus() {
  return (typeof globalThis !== 'undefined' && globalThis.document) ? globalThis.document : null;
}

/**
 * Announce that the server's credentials changed. Safe to call from anywhere;
 * a missing document is a no-op rather than a throw.
 * @param {{reason?: string}} [detail] free-form, for debugging only
 */
export function emitSecretsChanged(detail = {}) {
  const bus = _bus();
  if (!bus) return;
  bus.dispatchEvent(new CustomEvent(SECRETS_CHANGED_EVENT, { detail }));
}

/**
 * Subscribe to credential changes.
 * @param {(ev: Event) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onSecretsChanged(handler) {
  const bus = _bus();
  if (!bus) return () => {};
  bus.addEventListener(SECRETS_CHANGED_EVENT, handler);
  return () => bus.removeEventListener(SECRETS_CHANGED_EVENT, handler);
}
