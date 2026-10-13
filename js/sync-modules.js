// ── Mission Deck — js/sync-modules.js ─────────────────────────────────
// Thin client for the per-module sync status behind the "Sync"
// modal's second and third render levels (js/sync-center-modal.js). Zero-
// dependency leaf module (no imports from any other js/ file), same
// convention as js/data-tier-0-sync.js's overview cache.
//
// ── GET /api/sync-modules[?force=1] contract (server.js handleSyncModules)
// Response: { ok: true, modules: [ { id, label, repo, repos, pendingFiles,
//   pendingPush, unknown, lastSync, access }, ... ] }
// - `access` is 'write' | 'read' | 'mixed'. Core scopes and `_core` are always
//   'write'. 'read' = the module owns nothing here and cannot push; its
//   numbers are a view of files another row owns (always declaredPaths:
//   true). The server refuses push-stream?module=<read-scope> with the SSE
//   error `read-only-scope`; the UI disables the push button up front.
// - Invariant: each file is SENT by exactly one row (its owner); a read row
//   only reports it.
// - `id` is a module id (from an installed module's manifest) or `_core`
//   ("Cockpit Core" — every file that matches no installed module's declared
//   `dataRepos[].paths`).
// - `repo` is the route id (`data-tier-0`, ...) THIS row belongs to; `repos`
//   lists every repo id the module has entries for (a module can declare
//   several `dataRepos[]` entries) — used to know whether a module's badge
//   should also appear under a second repo row.
// - `pendingFiles` is a count, or `null` when `unknown` is true.
// - `pendingPush` is `!unknown && pendingFiles > 0`.
// - `unknown: true` means the server's per-repo budget (5 s) was exceeded —
//   render "No data", no counter, no action: a scoped push needs a
//   reliable file list, which an unknown row does not have.
// - `lastSync` is an ISO string or `null` — render `null` as "—", never as
//   "Never synced" (that wording is reserved for the repo row).
// - Exactly one `_core` row per repo, even for a repo with no other modules —
//   that is how the client tells "no chevron" (a repo row with ONLY its
//   `_core` row) apart from "chevron, nothing pending".
// `?force=1` bypasses the server's 30 s status cache.
//
// ── GET /api/sync-modules/files?repo=<id>&module=<id|_core|_all> contract
// (server.js handleSyncModuleFiles) — read-only, fetched only once a module's
// badge is clicked (the endpoint costs real git work).
// Response: { ok: true, files: [ { path, status, localAt, onRemote,
//   remoteAt, owner } ], total, truncated, viewAt }
// - `owner` is the scope id that SENDS the file (or `_core`) - for a read row
//   it names the row to push from.
// - `path` may be `null` (only for `_core`/`_all`) when the encrypted name in
//   the mirror could not be resolved back to a plaintext path.
// - `status` is one of 'A' | 'M' | 'D'.
// - `localAt` is the plaintext file's own mtime, `null` for `status === 'D'`
//   and for an unresolved `path`.
// - `onRemote` / `remoteAt`: whether (and, for the first 50 files only, when)
//   the mirror's upstream ref already has this file — never guessed.
// - `viewAt` is the date of the mirror's last known upstream commit: "the
//   server as of our last pull", not a live network check.
// - `400 { ok: false, error: 'unknown-repo' | 'unknown-module', message }`
//   for a bad `repo`/`module` — callers only ever pass ids this module's own
//   `getModulesForRepo` already returned, so this is a defensive branch.

const REFRESH_MIN_INTERVAL_MS = 30_000;

let _modules = null; // last GET /api/sync-modules `modules` array (null before first fetch)
let _lastFetchedAt = 0;
let _inFlight = null;
let _inFlightForced = false; // whether the request behind _inFlight carried force=1
let _runSeq = 0; // monotonic id per issued request
let _appliedSeq = 0; // id of the request whose result _modules currently holds

/**
 * Fire-and-forget refresh, coalesced: an unforced call joins whatever is
 * already in flight; a forced call joins an in-flight FORCED request; a
 * forced call arriving while an unforced one is in flight starts a second,
 * forced request — the later-issued request always wins (a superseded result
 * is dropped via `_appliedSeq`).
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<object[]|null>}
 */
export function refreshSyncModules({ force = false } = {}) {
  if (_inFlight && (_inFlightForced || !force)) return _inFlight;
  if (!force && Date.now() - _lastFetchedAt < REFRESH_MIN_INTERVAL_MS) return Promise.resolve(_modules);
  const seq = ++_runSeq;
  const run = (async () => {
    try {
      const url = '/api/sync-modules?t=' + Date.now() + (force ? '&force=1' : '');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return _modules;
      const data = await res.json();
      if (seq < _appliedSeq) return _modules; // superseded by a later request that already landed
      _modules = Array.isArray(data.modules) ? data.modules : [];
      _appliedSeq = seq;
      _lastFetchedAt = Date.now();
      return _modules;
    } catch {
      return _modules;
    }
  })();
  _inFlight = run;
  _inFlightForced = force;
  const clear = () => { if (_inFlight === run) { _inFlight = null; _inFlightForced = false; } };
  run.then(clear, clear);
  return run;
}

/** Last known snapshot, or `null` before the first successful fetch. */
export function getSyncModules() {
  return _modules;
}

/**
 * Every (module, repo) row belonging to one repo id, in server-returned
 * order (caller decides sort/grouping — see sortModuleRows in
 * js/sync-center-helpers.js).
 * @param {string} repoId
 * @returns {object[]}
 */
export function getModulesForRepo(repoId) {
  return (_modules || []).filter((m) => m.repo === repoId);
}

/**
 * Which files one module (or `_core`/`_all`) in one repo would send —
 * fetched only on demand (the third render level, opened by clicking a
 * module's badge). Never throws.
 * @param {string} repoId
 * @param {string} moduleId
 * @returns {Promise<{ok: boolean, files?: object[], total?: number, truncated?: boolean, viewAt?: string|null, error?: string}>}
 */
export async function fetchModuleFiles(repoId, moduleId) {
  try {
    const url = `/api/sync-modules/files?repo=${encodeURIComponent(repoId)}&module=${encodeURIComponent(moduleId)}&t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    return await res.json();
  } catch {
    return { ok: false, error: 'network' };
  }
}
