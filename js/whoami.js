// ── Mission Deck — js/whoami.js ───────────────────────────────────────
// One reader for GET /api/whoami, shared by the top bar avatar and the
// analytics identify call. Both used to fetch it on boot, one line apart in
// time, and the two answers went into the same six HTTP/1.1 sockets the view's
// own module import was waiting on. The promise is shared while in flight and
// kept until somebody asks for a fresh one, so two callers in the same boot
// cost one request; `force: true` is for the moment the answer can change -
// the vault just opened (`cockpit:secrets-changed`), and the server cache
// behind the route is keyed by the token, so that re-read is a miss there too.
//
// The result lands in `state.whoami` (js/state.js), which is where every
// reader already looks; this module only owns the fetch.

import { state } from './state.js';

let _inFlight = null;

/**
 * The whoami payload, or null when it cannot be read (offline, server
 * restarting). Never throws.
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<object|null>}
 */
export function fetchWhoami(opts) {
  const force = !!(opts && opts.force);
  if (!force && _inFlight) return _inFlight;
  const p = (async () => {
    try {
      const r = await fetch('/api/whoami', { cache: 'no-store' });
      if (!r.ok) return null;
      const data = await r.json();
      state.whoami = data;
      return data;
    } catch (_e) {
      return null;
    }
  })();
  _inFlight = p;
  // A failed read must not be remembered: the next caller tries again.
  p.then((data) => { if (data === null && _inFlight === p) _inFlight = null; });
  return p;
}
