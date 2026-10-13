// -- Mission Deck - js/infra-events.js ---------------------------------
// The third tiny bus, one axis over from js/secrets-events.js: the cockpit's
// infrastructure (GitLab behind the VPN) just became reachable again after
// being down. Everything painted from a GitLab answer - the avatar, the
// "Aktywni" chip, the MR chips, the update banner - memoised a FAILURE while
// the VPN was off, and before this bus the only way to re-derive it was F5,
// which is exactly what "I turned the VPN on and nothing changed" means.
//
// Emitted by js/infra-banner.js when the network reading flips from
// `unreachable` to `reachable` (the pure `infraRecovered`), and by nothing
// else. Same rules as the secrets bus: the event carries no payload worth
// trusting, every listener re-fetches its own endpoint, and a missing document is
// a no-op so the module stays importable under plain Node.

/** Event name. An id, so ASCII. */
export const INFRA_CHANGED_EVENT = 'cockpit:infra-changed';

function _bus() {
  return (typeof globalThis !== 'undefined' && globalThis.document) ? globalThis.document : null;
}

/**
 * Announce that the infrastructure came back.
 * @param {{reason?: string}} [detail] free-form, for debugging only
 */
export function emitInfraChanged(detail = {}) {
  const bus = _bus();
  if (!bus) return;
  bus.dispatchEvent(new CustomEvent(INFRA_CHANGED_EVENT, { detail }));
}

/**
 * Subscribe to infrastructure recoveries.
 * @param {(ev: Event) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onInfraChanged(handler) {
  const bus = _bus();
  if (!bus) return () => {};
  bus.addEventListener(INFRA_CHANGED_EVENT, handler);
  return () => bus.removeEventListener(INFRA_CHANGED_EVENT, handler);
}
