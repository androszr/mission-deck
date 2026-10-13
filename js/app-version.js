// ── Mission Deck — js/app-version.js ──────────────────────────────────
// One reader for "which version is this cockpit", shared by the dashboard's
// Windows card and the analytics context, so the boot path pays for the
// request once instead of once per consumer.
//
// Cached for the life of the page: the version only changes with a server
// restart, and a restart reloads the browser anyway. A failed read caches
// nothing, so the next caller tries again.

let _inFlight = null;

/** Forget the remembered answer. For tests that drive several platforms
 * through one process; the app itself never needs it (see above). */
export function resetAppVersionCache() { _inFlight = null; }

/**
 * The whole GET /api/app/version payload, or null when it cannot be read.
 * Shared while in flight and remembered on success, so the dashboard's
 * Windows card, the analytics context and the module cards cost one request
 * between them instead of one each on the boot path. Never throws.
 * @returns {Promise<object|null>}
 */
export function fetchAppVersion() {
  if (_inFlight) return _inFlight;
  const p = (async () => {
    try {
      const res = await fetch('/api/app/version', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  })();
  _inFlight = p;
  p.then((data) => { if (data === null && _inFlight === p) _inFlight = null; });
  return p;
}

