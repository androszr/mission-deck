// ── Mission Deck — js/data-tier-0-sync.js ─────────────────────────────────
// Client for the data-tier-0 repo (see user-data/BUILD-CONTRACT.md) PLUS the
// generic overview of every row in the server's `DATA_REPOS` registry
// (the generic data-repo layer). Two call shapes coexist on purpose:
//   - the data-tier-0-only functions below (fetchDataTierStatus,
//     runDataTierSync, pushDataTier, ...) keep calling the legacy
//     `/api/data-tier-0/*` prefix with no arguments, because the top bar's
//     "Sync" pill (js/topbar.js), the autosync loop and the
//     Settings > System sync card (js/settings.js) are wired to exactly this
//     one repo and must keep working unchanged;
//   - the repair-route clients further down (fetchLocalChanges,
//     discardLocalChanges, fetchConflictDiff, writeResolved,
//     clearDataTierDir) now take an OPTIONAL `repoId` so
//     js/sync-center-modal.js can address any row in the registry through
//     `/api/data/<repoId>/<op>` while every existing call site that omits
//     `repoId` keeps hitting `/api/data-tier-0/<op>` exactly as before.
//
// runDataTierSync() below is a lean EventSource reader speaking the same
// progress / log / done / error protocol.

import { showToast } from './toast.js';
import { openSyncLogModal, renderSyncLogSteps } from './sync-log-modal.js';
import { emitDataChanged } from './data-events.js';
import { connectionLostOutcome, streamErrorPayload } from './sync-stream-helpers.mjs';

/** Endpoint prefix — every data-tier-0-only path in this module derives from it. */
const API = '/api/data-tier-0';

/**
 * Address of a repo-scoped operation. With no `repoId`, this is the legacy
 * `/api/data-tier-0` prefix every existing call site already depends on;
 * with a `repoId` it is the generic `/api/data/<repoId>` family added in
 * with the generic repo layer (server.js `DATA_REPO_OPERATIONS`), a working alias for
 * `data-tier-0` too.
 * @param {string} [repoId]
 * @returns {string}
 */
function _repoApiBase(repoId) {
  return repoId ? `/api/data/${repoId}` : API;
}

/** Last status payload, so callers can repaint without a refetch. */
let _lastStatus = null;

/**
 * Last GET /api/sync-overview payload, so callers can repaint without a
 * refetch. `null` until the first fetch resolves - a caller must tell "no
 * request has finished yet" apart from "the request failed", or a slow first
 * load paints a false failure message instead of a loading state.
 */
let _lastOverview = null;

/**
 * One row per entry in the server's `DATA_REPOS` registry - today exactly
 * one (`data-tier-0`), tomorrow as many as the registry grows to. Field shape per row:
 * `{ repo, label, status, hasToken, canWrite, localDirty, pendingPush, ahead,
 * behind, lastSync, lastAutoPull, lastAutoPush, bitwardenLocked, remoteUrl }`.
 * `row.repo` doubles as the `repoId` for `/api/data/<repoId>/<op>`.
 * @returns {Promise<{ok: boolean, repos: object[], autoSyncEnabled: boolean, intervalMs: number}>}
 */
export async function fetchSyncOverview() {
  try {
    const res = await fetch('/api/sync-overview', { cache: 'no-store' });
    if (!res.ok) return _settleOverview(null);
    return _settleOverview(await res.json());
  } catch (_e) {
    return _settleOverview(null);
  }
}

/**
 * The shape every overview consumer reads, from a raw payload or from null.
 * A null payload keeps a cached overview when there is one: `getSyncOverview()`
 * is what the sync window paints from and what its row handlers look rows up
 * in, and `refreshRemoteState` fails on a REAL network fetch (a dead remote,
 * a closed vault), which is far likelier than the localhost GET this used to
 * be the only caller of. Blanking eight rows because the server could not
 * reach GitLab would replace real state with "no connection" everywhere.
 * With no cache at all, the fallback is still the answer - the caller has to
 * tell "failed" from "not asked yet".
 */
function _settleOverview(d) {
  if (!d && _lastOverview && _lastOverview.ok) return _lastOverview;
  const overview = d ? {
    ok: d.ok !== false,
    repos: Array.isArray(d.repos) ? d.repos : [],
    autoSyncEnabled: d.autoSyncEnabled === true,
    intervalMs: Number(d.intervalMs) || 0,
  } : { ok: false, repos: [], autoSyncEnabled: false, intervalMs: 0 };
  _lastOverview = overview;
  return overview;
}

/**
 * Move every source's remote-tracking ref, then take the fresh overview the
 * same POST answers with. This is the ONLY client call that costs network on
 * the SERVER side: `GET /api/sync-overview` reads `@{upstream}`, a local ref
 * git moves on fetch/pull/push and on nothing else, so without this call the
 * "to fetch" column and the server timestamp show the remote as it was at this
 * machine's last sync - a teammate's push stays invisible.
 *
 * `force: true` bypasses the server's per-source TTL and is what the explicit
 * "Check server" button sends; the automatic call when the sync window opens
 * omits it, so re-opening the window does not re-fetch eight remotes.
 *
 * `ok` here answers "did THIS refresh happen", never "is there an overview":
 * a failed POST keeps the cached rows in `getSyncOverview()` (see
 * `_settleOverview`) but comes back `ok: false`, because the caller decides
 * from it whether to say "Could not check the server" - and a cached
 * success passed through as `ok: true` turned a dead server into a silent
 * no-op.
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<{ok: boolean, repos: object[], autoSyncEnabled: boolean, intervalMs: number, refreshed: object[]}>}
 */
export async function refreshRemoteState(opts = {}) {
  const force = !!opts.force;
  try {
    const res = await fetch('/api/sync-overview/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (!res.ok) return _refreshFailed();
    const d = await res.json();
    return { ..._settleOverview(d), refreshed: Array.isArray(d.refreshed) ? d.refreshed : [] };
  } catch (_e) {
    return _refreshFailed();
  }
}

function _refreshFailed() {
  return { ..._settleOverview(null), ok: false, refreshed: [] };
}

/**
 * The most recent sync-overview payload without hitting the network, or
 * `null` before the first fetch has resolved.
 * @returns {{ok: boolean, repos: object[], autoSyncEnabled: boolean, intervalMs: number}|null}
 */
export function getSyncOverview() {
  return _lastOverview;
}

/**
 * Normalized status of the data-tier-0 working copy.
 * Tolerates two spellings per field - the contract's (`ahead` / `dirty`) and
 * the older `mirrorAhead` / `localDirty` - so a server that still emits the
 * older shape keeps working instead of silently reporting "clean".
 *
 * @typedef {{ ok: boolean, exists: boolean, hasToken: boolean, status: string,
 *   branch: string|null, ahead: number, behind: number, dirty: boolean,
 *   lastSync: string|null, remoteUrl: string|null, bitwardenLocked: boolean,
 *   encryptionReady: boolean }} DataTierStatus
 * @returns {Promise<DataTierStatus>}
 */
export async function fetchDataTierStatus() {
  const fallback = {
    ok: false, exists: false, hasToken: false, status: 'no-access',
    branch: null, ahead: 0, behind: 0, dirty: false,
    lastSync: null, remoteUrl: null, bitwardenLocked: false, encryptionReady: false,
  };
  try {
    const res = await fetch(API + '/status');
    if (!res.ok) { _lastStatus = fallback; return fallback; }
    const d = await res.json();
    const status = {
      ok: true,
      exists: d.exists !== false && d.status !== 'not-configured',
      hasToken: d.hasToken === true,
      status: d.status || (d.exists ? 'ok' : 'not-configured'),
      branch: d.branch || null,
      ahead: Number(d.ahead === undefined || d.ahead === null ? d.mirrorAhead : d.ahead) || 0,
      behind: Number(d.behind) || 0,
      dirty: (d.dirty === true) || (d.localDirty === true),
      lastSync: d.lastSync || null,
      remoteUrl: d.remoteUrl || null,
      bitwardenLocked: d.bitwardenLocked === true,
      encryptionReady: d.encryptionReady === true,
    };
    _lastStatus = status;
    return status;
  } catch (_e) {
    _lastStatus = fallback;
    return fallback;
  }
}

/**
 * The most recent status payload without hitting the network.
 * @returns {DataTierStatus|null}
 */
export function getDataTierStatus() {
  return _lastStatus;
}

/**
 * True when the repo needs the user's attention in the top bar: unpushed
 * commits, a dirty working copy, a missing/locked token - or commits waiting
 * on the SERVER (`behind`). The last one was missing, so the pill stayed calm
 * while the team's work sat unpulled; the pill is called "Sync",
 * not "Send". It costs no extra request: `behind` is already in the status
 * payload, read off `@{upstream}` - which means the dot reflects the last
 * FETCHED state, so it lights up after the sync window (or the auto-sync
 * loop) has moved that ref and stays lit until the pull, because the ref
 * persists on disk.
 * @param {DataTierStatus|null} status
 * @returns {boolean}
 */
export function dataTierPending(status) {
  if (!status) return false;
  return status.ahead > 0 || status.behind > 0 || status.dirty === true || status.bitwardenLocked === true;
}

/**
 * Run one streamed operation and report it through the shared sync-log modal.
 *
 * @param {'pull'|'clone'} op
 * @param {{ title?: string, onFinish?: (data: object) => void }} [hooks]
 * @returns {Promise<{ok: boolean, [k: string]: any}>}
 */
export function runDataTierSync(op, hooks = {}) {
  const streamUrl = `${API}/${op}-stream`;
  const title = hooks.title || (op === 'clone'
    ? 'Cloning the team repository (ds-data)'
    : 'Sync ds-data (Fetch)');

  return new Promise(resolve => {
    let es;
    try {
      es = new EventSource(streamUrl);
    } catch (_e) {
      const data = { ok: false, error: 'error', message: 'Could not open the connection' };
      showToast('error', 'Sync failed', data.message);
      resolve(data);
      return;
    }

    const steps = [];
    let finished = false;

    const finish = async (data) => {
      if (finished) return;
      finished = true;
      es.close();
      if (!data.ok && steps.length) steps[steps.length - 1].status = 'fail';
      await fetchDataTierStatus();
      // Same announcement as the streamed twin in js/sub-repo-sync-stream.js:
      // this reader is the OTHER finish path (Settings > System), so the
      // views under the page have to hear about a pull from here too.
      if (data.ok) emitDataChanged({ repo: 'data-tier-0', op });
      const handle = openSyncLogModal({ title });
      renderSyncLogSteps(handle, { ...data, steps });
      if (data.ok) showToast('success', 'Synced', data.message || 'Data is up to date.');
      else showToast('error', 'Sync failed', data.message || data.error || 'Unknown error');
      if (typeof hooks.onFinish === 'function') {
        try { hooks.onFinish(data); } catch (_e) { /* caller error must not break the promise */ }
      }
      resolve(data);
    };

    es.addEventListener('log', function (e) {
      let p;
      try { p = JSON.parse(e.data); } catch (_err) { return; }
      if (!p || !p.text) return;
      const entry = { ts: new Date().toISOString(), step: p.text, status: p.status || 'ok' };
      if (p.detail) entry.detail = p.detail;
      steps.push(entry);
    });

    es.addEventListener('progress', function (e) {
      let p;
      try { p = JSON.parse(e.data); } catch (_err) { return; }
      if (p && p.label) steps.push({ ts: new Date().toISOString(), step: p.label, status: 'ok' });
    });

    es.addEventListener('done', function (e) {
      let d;
      try { d = JSON.parse(e.data); } catch (_err) { d = {}; }
      finish({ ok: true, ...d });
    });

    // 'open' separates "the run never started" from "the run is in flight".
    let opened = false;
    es.addEventListener('open', function () { opened = true; });

    // SSE 'error' arrives both as a server-sent payload and as a transport
    // failure with no data — only the latter means the connection died.
    es.addEventListener('error', function (e) {
      const payload = streamErrorPayload(e);
      if (payload) finish({ ok: false, ...payload });
      else {
        // Transport died. Never let EventSource auto-reconnect a mutating
        // stream: the re-issued GET would queue a second pull/push behind the
        // repo lock (same rule as js/sub-repo-sync-stream.js). The sentence
        // comes from js/sync-stream-helpers.mjs, where the unit suite pins it.
        es.close();
        finish(connectionLostOutcome(opened));
      }
    });
  });
}

/**
 * Push local commits. Plain JSON call, no progress modal - used by callers
 * (js/settings.js) that just need a result. js/sync-center-modal.js uses the
 * streamed twin (`push-stream`) through runSyncWithProgress instead.
 * @returns {Promise<{ok: boolean, [k: string]: any}>}
 */
export async function pushDataTier() {
  try {
    const res = await fetch(API + '/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok !== false) {
      showToast('success', 'Changes sent', data.message || '');
      await fetchDataTierStatus();
      emitDataChanged({ repo: 'data-tier-0', op: 'push' });
      return { ok: true, ...data };
    }
    showToast('error', 'Send failed', data.message || data.error || `HTTP ${res.status}`);
    return { ok: false, ...data };
  } catch (e) {
    showToast('error', 'Send failed', String((e && e.message) || e));
    return { ok: false, error: 'error' };
  }
}

// ── Repair-route clients (feature parity first, then per-repoId) ──────────────
// Plain fetch wrappers around the twelve routes added alongside pull-stream/
// clone-stream. Every response is normalized to always carry `ok`, even on a
// network failure, so callers never need a try/catch of their own. Every
// wrapper takes an OPTIONAL `repoId` (see `_repoApiBase` above) - existing
// callers (js/local-changes-modal.js, js/store-conflict-resolver.js) that
// omit it keep hitting `/api/data-tier-0/<op>` unchanged.

async function _postJson(path, body, repoId) {
  try {
    const res = await fetch(_repoApiBase(repoId) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body === undefined ? {} : body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, ...data };
  } catch (e) {
    return { ok: false, error: 'network', message: String((e && e.message) || e) };
  }
}

/**
 * `_postJson` for the ops that REWRITE the plaintext tree, announcing the
 * change on js/data-events.js so the view under the modal repaints itself
 * instead of waiting for an F5. Read-only siblings (`conflict-diff`) keep
 * calling `_postJson` directly - nothing changed for them to repaint.
 * @param {string} path
 * @param {string|undefined} repoId
 * @param {string} op label carried on the event, for debugging only
 * @returns {Promise<{ok: boolean, [k: string]: any}>}
 */
async function _mutating(path, repoId, op) {
  const data = await _postJson(path, undefined, repoId);
  if (data.ok) emitDataChanged({ repo: repoId || 'data-tier-0', op });
  return data;
}

/**
 * GET .../local-changes - list of dirty files, own status per file,
 * `truncated` when the repo has more than the server-side cap.
 * @param {string} [repoId]
 * @returns {Promise<{ok: boolean, files?: {path: string, status: string}[], truncated?: boolean, error?: string}>}
 */
export async function fetchLocalChanges(repoId) {
  try {
    const res = await fetch(`${_repoApiBase(repoId)}/local-changes?t=${Date.now()}`);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, ...data };
  } catch (e) {
    return { ok: false, error: 'network', message: String((e && e.message) || e) };
  }
}

/** POST .../discard-local-changes - "Discard changes". @param {string} [repoId] */
export function discardLocalChanges(repoId) {
  return _mutating('/discard-local-changes', repoId, 'discard-local-changes');
}

/**
 * POST .../conflict-diff - per-file `{ ours, theirs }` plaintext preview (or
 * `{ error }` per file). No unified diff from the server - the caller
 * computes it.
 * @param {string} [repoId]
 */
export function fetchConflictDiff(repoId) {
  return _postJson('/conflict-diff', undefined, repoId);
}

/**
 * POST .../write-resolved - manual per-file resolution.
 * @param {{path: string, content: string}[]} files
 * @param {string} [repoId]
 */
export async function writeResolved(files, repoId) {
  const data = await _postJson('/write-resolved', { files }, repoId);
  if (data.ok) emitDataChanged({ repo: repoId || 'data-tier-0', op: 'write-resolved' });
  return data;
}

// pull, pull-overwrite, resolve-conflicts, rebase-abort and recover-rebase
// are called directly from js/sub-repo-sync-stream.js's
// buildSyncErrorActions() against the `repoBase` (e.g. `data/<repoId>`) the
// caller already carries, so that module stays the single owner of the
// recovery-action URLs.

/**
 * POST .../clear-dir - clears ONLY leftovers from a failed clone (status
 * `dir-exists`); refuses when the directory already holds a working `.git`
 * repository.
 * @param {string} [repoId]
 */
export function clearDataTierDir(repoId) {
  return _mutating('/clear-dir', repoId, 'clear-dir');
}

/**
 * POST .../decrypt - mirror -> plaintext only, no git. For a source that was
 * cloned before its key existed (`decrypted: false` on its overview row).
 * @param {string} [repoId]
 */
export function decryptDataTierRepo(repoId) {
  return _mutating('/decrypt', repoId, 'decrypt');
}

/**
 * POST .../clear-plaintext - the evening "End of day" step: deletes every
 * file inside the source's plaintext directory, refusing unless the mirror
 * already covers it in full (server gate `wrapUpClearEligibility`). Never
 * touches the encrypted mirror or git.
 * @param {string} [repoId]
 * @returns {Promise<{ok: boolean, removedFiles?: number, alreadyEmpty?: boolean,
 *   error?: string, message?: string}>}
 */
export function clearDataTierPlaintext(repoId) {
  return _postJson('/clear-plaintext', undefined, repoId);
}

/** URL used by js/sub-repo-sync-stream.js's "Fix branch" recovery action. */
export const REPAIR_DETACHED_HEAD_URL = API + '/repair-detached-head';

/**
 * Same URL, generalized to any repo in the registry.
 * @param {string} [repoId]
 * @returns {string}
 */
export function repairDetachedHeadUrl(repoId) {
  return `${_repoApiBase(repoId)}/repair-detached-head`;
}
