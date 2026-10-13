// -- Mission Deck - js/sync-stream-helpers.mjs -------------------------
// Document-free decisions shared by the two EventSource runners that drive a
// mutating stream (js/sub-repo-sync-stream.js for the sync center and the
// wizard, js/data-tier-0-sync.js for Settings > System). Kept out of
// both so the unit suite can read them directly - the runners touch
// `document` at import time.

/**
 * What a transport error on a MUTATING stream (push, pull, clone, deploy)
 * means once the runner has decided to close the EventSource rather than let
 * the browser reconnect it: with `readyState` CONNECTING the browser would
 * re-issue the GET on its own, and for a stream that pushes or pulls that is
 * a SECOND full operation queued behind the source's lock - a push "from
 * beyond" with nobody at the screen. The server finishes the first run either
 * way, so the sentence says which of two states the person is in: `opened`
 * (the server answered once, the run is in flight without us) or not (the run
 * never started). Pure.
 * @param {boolean} opened whether the stream's `open` event fired
 * @returns {{ok: false, error: 'connection-lost', message: string}}
 */
export function connectionLostOutcome(opened) {
  return {
    ok: false,
    error: 'connection-lost',
    message: opened
      ? 'Connection lost — the operation continues on the server; check its state in the Sync window.'
      : 'Could not connect to the server — the operation was not started.',
  };
}

/**
 * Parse the payload a server-sent `error` event carries, or null when the
 * event has none - which is how a transport death (VPN blip, laptop sleep, a
 * server restart mid-push) looks to the runner. Pure, never throws.
 * @param {{data?: unknown}|null|undefined} e the EventSource error event
 * @returns {object|null}
 */
export function streamErrorPayload(e) {
  if (!e || !e.data) return null;
  try {
    const parsed = JSON.parse(String(e.data));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
