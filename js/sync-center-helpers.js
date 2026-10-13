// ── Mission Deck — js/sync-center-helpers.js ──────────────────────────
// Pure functions (no document access) that back the "Data sync" modal
// (js/sync-center-modal.js): the per-module status badge, sorting module
// rows, the repo-expand default/override, file-list labels, formatting the
// sync log for "Copy log", the in-row progress bar math and the
// prerequisite callout predicate. Kept DOM-free on purpose so
// tests/test_sync_center_helpers.mjs can exercise them under plain
// `node --test`, no browser, no jsdom.
//
// Stage "sync-center-module-expansion" moved module/file grouping to the
// server (GET /api/sync-modules, GET /api/sync-modules/files) — this file no
// longer groups anything client-side; the two client-side grouping helpers
// from the previous iteration are gone.

/** Own name for the synthetic catch-all module row. ASCII by design. */
export const CORE_GROUP_NAME = 'Cockpit Core';

/**
 * Status pill for one row of GET /api/sync-modules. No count in the label:
 * the module row now has its own "Send · fetch" column (`filesToSend` /
 * `filesToFetch`, same shape as the repo row), so repeating the number here
 * too would be the same fact said twice in one row. The badge stays a
 * button (js/sync-center-modal.js) - it opens the file list regardless of
 * whether it also carries a count.
 * @param {{unknown?: boolean, pendingPush?: boolean}|null} mod
 * @returns {{cls: string, label: string}}
 */
export function moduleStateBadge(mod) {
  if (!mod) return { cls: 'ds-badge--gray', label: 'No data' };
  if (mod.unknown) return { cls: 'ds-badge--gray', label: 'No data' };
  const toFetch = _hasToFetch(mod);
  if (mod.pendingPush) {
    return { cls: 'ds-badge--yellow', label: toFetch ? 'To send and fetch' : 'To send' };
  }
  if (toFetch) return { cls: 'ds-badge--yellow', label: 'To fetch' };
  return { cls: 'ds-badge--green', label: 'Up to date' };
}

/**
 * Whether this row has anything waiting on the server. `filesToFetch` is the
 * file count the "Send · fetch" column renders; `behind` is the commit
 * count the same payload still carries. Either one above zero means a pull
 * would bring something, and a row with only `null`s (a source whose state
 * could not be read) is NOT claimed to be behind.
 * @param {{filesToFetch?: number|null, behind?: number|null}|null} row
 * @returns {boolean}
 */
function _hasToFetch(row) {
  if (!row) return false;
  if (typeof row.filesToFetch === 'number' && row.filesToFetch > 0) return true;
  return typeof row.behind === 'number' && row.behind > 0;
}

/**
 * Whether this row has a level-3 file list worth opening - the one test the
 * badge-button, the "files" icon and their tooltips all read, so the three
 * can never disagree. BOTH directions count: GET /api/sync-modules/files
 * answers with `direction: 'send'` rows and `direction: 'fetch'` rows, and a
 * module with nothing to send but two files waiting on the server used to
 * have no way in at all - its badge was a dead `<span>` and its icon was
 * disabled, which is what made "0 / 2" unopenable.
 * @param {{unknown?: boolean, pendingPush?: boolean, filesToFetch?: number|null, behind?: number|null}|null} mod
 * @returns {boolean}
 */
export function moduleHasFileList(mod) {
  if (!mod || mod.unknown) return false;
  return !!mod.pendingPush || _hasToFetch(mod);
}

/**
 * Status pill for one repo row of GET /api/sync-overview. Lives here rather
 * than in js/sync-center-modal.js (where it was a private `_badge`) for one
 * reason: it is the same kind of pure decision as `moduleStateBadge` above and
 * belongs under the same test file. It used to end in
 * `ahead > 0` -> `localDirty` -> green, with no branch for the FETCH
 * direction at all, so a source the team had pushed to painted a confident
 * green "up to date" - and appending a fetch branch at the end would have kept
 * exactly that bug for the both-directions row (something to send AND
 * something to pull), which is the common case for the person who works on
 * the data. So the two directions are combined explicitly.
 *
 * `null` means "no answer yet / request failed" and is the loading state's
 * own label, not an error.
 * @param {object|null} row
 * @returns {{cls: string, label: string}}
 */
export function repoStateBadge(row) {
  if (!row) return { cls: 'ds-badge--gray', label: 'no connection' };
  if (!row.hasToken) return { cls: 'ds-badge--yellow', label: 'no token' };
  if (row.bitwardenLocked) return { cls: 'ds-badge--yellow', label: 'vault locked' };
  if (row.status === 'not-configured' || row.status === 'dir-exists') return { cls: 'ds-badge--yellow', label: 'not downloaded' };
  if (row.status === 'no-access') return { cls: 'ds-badge--red', label: 'no access' };
  if (row.status === 'network') return { cls: 'ds-badge--red', label: 'connection error' };
  // Wrapped up last night: the plaintext tree was deliberately emptied, not
  // merely never filled. The MARKER ALONE decides, deliberately without an
  // `&& row.decrypted !== true` guard. The server clears `wrappedUpAt` on a
  // successful decrypt, so its presence already means "wiped and not yet
  // restored" - while `decrypted` is exactly the field that starts lying the
  // moment one file lands in the emptied tree (a Academy progress
  // write, say): `_repoDecryptedState` then sees a non-empty mirror overlap
  // and reports true on a tree still 99% empty. Reading `decrypted` here
  // would re-import the lie this marker exists to route around, and paint a
  // green `up to date` over an empty source.
  if (row.wrappedUpAt) return { cls: 'ds-badge--yellow', label: 'after end of day' };
  // Cloned, but the plaintext directory never received the content: without
  // the key there is nothing to do here, with it one click decrypts.
  if (row.decrypted === false) return { cls: 'ds-badge--yellow', label: row.encryptionReady === false ? 'no key' : 'not decrypted' };
  const toFetch = _hasToFetch(row);
  const toSend = (typeof row.ahead === 'number' && row.ahead > 0) || !!row.localDirty;
  if (toSend && toFetch) return { cls: 'ds-badge--yellow', label: 'to send and fetch' };
  if (toSend) return { cls: 'ds-badge--yellow', label: row.ahead > 0 ? 'to send' : 'local changes' };
  if (toFetch) return { cls: 'ds-badge--yellow', label: 'to fetch' };
  return { cls: 'ds-badge--green', label: 'up to date' };
}

/**
 * Order module rows of one repo for display: `_core` always last (even when
 * it has something pending — it is the catch-all, not a "real" module, and
 * belongs at the bottom regardless), everything else pending-first, ties
 * kept in the server's own (stable) order.
 * @param {{id: string, pendingPush?: boolean}[]} rows
 * @returns {object[]}
 */
export function sortModuleRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return [...list].sort((a, b) => {
    const aCore = a.id === '_core';
    const bCore = b.id === '_core';
    if (aCore !== bCore) return aCore ? 1 : -1;
    if (aCore && bCore) return 0;
    return (a.pendingPush ? 0 : 1) - (b.pendingPush ? 0 : 1);
  });
}

/**
 * Whether one repo row's module rows should be shown expanded. A repo with
 * no modules (only its `_core` row) never expands — there is nothing to
 * disclose but "Cockpit Core" alone, and the plan requires "no chevron" for
 * that case. An explicit user choice (an override key on this repo id, set
 * by clicking the chevron) always wins over the default; the default is
 * "expanded iff there is something pending on this repo".
 * @param {Record<string, boolean>} overrides
 * @param {{repo: string, filesToSend?: number, pendingPush?: boolean}} row - one GET /api/sync-overview row
 * @param {boolean} hasModules
 * @returns {boolean}
 */
export function isRepoExpanded(overrides, row, hasModules) {
  if (!hasModules) return false;
  const map = overrides && typeof overrides === 'object' ? overrides : {};
  const repoId = row && row.repo;
  if (repoId && Object.prototype.hasOwnProperty.call(map, repoId)) return !!map[repoId];
  return !!(row && ((typeof row.filesToSend === 'number' && row.filesToSend > 0) || row.pendingPush));
}

/**
 * user-facing label for one file's diff status, for the third render level.
 * @param {'A'|'M'|'D'|string} status
 * @param {'send'|'fetch'} [direction] - omitted means 'send', the only
 *   direction this list had before the fetch rows were added.
 * @returns {string}
 */
export function fileStatusLabel(status, direction) {
  // The same three letters mean the opposite thing in the other direction: a
  // row that is 'A' to SEND is a file this computer made, a row that is 'A'
  // to FETCH is a file somebody else made. Without the suffix both read
  // "new" and the list says nothing about who is waiting for whom.
  if (direction === 'fetch') {
    if (status === 'A') return 'new on the server';
    if (status === 'D') return 'deleted on the server';
    return 'changed on the server';
  }
  if (status === 'A') return 'new';
  if (status === 'D') return 'deleted';
  return 'changed';
}

/** @param {string} iso @returns {string} */
function _fmtWhen(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * What to show for one file's state "on the server". Never the word "none":
 * `onRemote: false` only tells us the mirror's LAST KNOWN upstream tree
 * (as of the last pull) did not have it — asserting the server does not have
 * it would be false the moment a colleague pushed it since. "not there at the
 * last fetch" is the honest phrasing; `viewAt` (rendered separately,
 * above the list) already tells the person how stale that picture may be.
 * @param {{onRemote?: boolean, remoteAt?: string|null}} file
 * @returns {string}
 */
export function fileRemoteLabel(file) {
  const f = file || {};
  if (f.onRemote) return f.remoteAt ? _fmtWhen(f.remoteAt) : 'present';
  return 'not there at the last fetch';
}

/** @param {string} iso @returns {string} */
function _fmtLogTimestamp(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '?';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Render GET /api/sync-log's `events[]` for one repo into plain text for
 * "Copy log". A sync with no changes never appends a log entry, so an
 * empty `events` array is a normal state (a fresh source, or one that has
 * never had anything to push) - it gets a short, honest sentence instead of
 * an empty clipboard. An entry carrying `module` (a scoped push) names it in
 * the header so a pasted log distinguishes "everything" from one module.
 * @param {object[]} events - newest first, per the contract
 * @returns {string}
 */
export function formatSyncLogText(events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) {
    return 'The sync log of this source is empty - no operation has been recorded yet.';
  }

  const lines = [];
  for (const e of list) {
    const evt = e || {};
    const ts = _fmtLogTimestamp(evt.timestamp);
    const action = evt.action || '?';
    const trigger = evt.trigger || '?';
    const header = evt.module ? `${action}/${trigger} · ${evt.module}` : `${action}/${trigger}`;
    const repo = evt.repo || '?';
    const user = evt.user || '?';
    const added = Number(evt.files_added) || 0;
    const removed = Number(evt.files_removed) || 0;
    lines.push(`${ts}  [${header}]  ${repo}  ${user}  +${added}/-${removed}`);
    if (Array.isArray(evt.files) && evt.files.length) {
      for (const f of evt.files) {
        const status = f && f.status ? ` (${f.status})` : '';
        lines.push(`    ${(f && f.path) || '?'}${status}`);
      }
    }
  }
  return lines.join('\n');
}

/** Step count per operation - the server emits no per-file progress, so the
 * bar counts named log stages instead. A scoped push has four steps too
 * (fetching / encrypting / committing / sending), same total as a full push. */
const STEP_TOTAL = { pull: 3, push: 4, clone: 2 };

/**
 * In-row progress bar state from the running count of `log` SSE events seen
 * so far. Never reports 100% before `done` is true, so a slow last step
 * never looks finished early; never exceeds 95% while running, so an
 * over-count (a category with more log lines than steps) still leaves room
 * for the final jump to 100%.
 * @param {'pull'|'push'|'clone'} op
 * @param {number} logCount
 * @param {boolean} done
 * @returns {{pct: number, counter: string}}
 */
export function syncProgress(op, logCount, done) {
  const total = STEP_TOTAL[op] || STEP_TOTAL.pull;
  const count = Math.max(0, Number(logCount) || 0);
  const pct = done ? 100 : Math.min(95, Math.round((count / total) * 100));
  const shown = Math.min(count, total);
  return { pct, counter: `${shown} / ${total}` };
}

/**
 * Overall progress for ONE `git clone --progress` phase.
 *
 * syncProgress() above counts server STAGES ("1 / 2"), which is all the sync
 * table had: a clone is a single stage, so the bar sat still for minutes. Git
 * reports its own phases, but each one runs 0->100% on its own, so painting
 * `pct` raw made the bar snap back to zero four times. Each phase therefore
 * owns a BAND of the overall bar and its percentage is interpolated inside it,
 * which keeps the bar monotonic across the whole clone.
 *
 * The bands are weighted by where the wall-clock time actually goes on these
 * repositories: the mirrors are encrypted, so their blobs do not delta-compress
 * and `receiving` dominates - it gets 70 of the 100 points.
 *
 * Keys are the stable ASCII ids the server sends alongside the user-facing label
 * (see _GIT_PROGRESS_PHASES in server.js); an unknown key returns null so the
 * caller keeps whatever it was showing rather than painting a wrong bar.
 *
 * @param {{key?: string, phase?: string, pct?: number, current?: number|null, total?: number|null}} p
 * @returns {{pct: number, counter: string, step: string}|null}
 */
export function gitPhaseProgress(p) {
  const bands = {
    counting: [0, 5],
    compressing: [5, 10],
    receiving: [10, 80],
    resolving: [80, 92],
    checkout: [92, 100],
  };
  const band = p && bands[p.key];
  if (!band) return null;
  const raw = Number(p.pct);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return null;
  const [lo, hi] = band;
  const pct = Math.round(lo + ((hi - lo) * raw) / 100);
  // Prefer git's own object counts - "500 / 1200" says more than "42%" - but
  // fall back to the percentage on the phases that report no counts.
  const counter = (Number.isFinite(p.current) && Number.isFinite(p.total) && p.total > 0)
    ? `${p.current} / ${p.total}`
    : `${raw}%`;
  return { pct, counter, step: String(p.phase || '') };
}

const _VAULT_TEXT = 'Sync needs an unlocked Bitwarden vault - unlock it with the Bitwarden button in the top bar.';
const _NETWORK_TEXT = 'Sync needs the VPN to be on.';

/**
 * Whether to show the "nothing responds" callout above the sync-overview
 * table, and why. Visible only when NO row reports `status === 'ready'`;
 * the reason is derived from `bitwardenLocked` and `status === 'network'`
 * across every row, never from a single one, so a mixed registry still
 * names every blocking requirement at once.
 * @param {{status?: string, bitwardenLocked?: boolean}[]} rows - GET /api/sync-overview's `repos`
 * @returns {{kind: 'vault'|'network'|'both'|'unknown', title: string, text: string}|null}
 */
export function syncPrereqCallout(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  if (list.some((r) => r && r.status === 'ready')) return null;

  const vault = list.some((r) => r && r.bitwardenLocked === true);
  const network = list.some((r) => r && r.status === 'network');
  const title = 'No data source is responding';

  if (vault && network) return { kind: 'both', title, text: `${_VAULT_TEXT} ${_NETWORK_TEXT}` };
  if (vault) return { kind: 'vault', title, text: _VAULT_TEXT };
  if (network) return { kind: 'network', title, text: _NETWORK_TEXT };
  return { kind: 'unknown', title, text: `${_VAULT_TEXT} ${_NETWORK_TEXT}` };
}

// ── Module sync bar (js/module-sync-bar.js) ──────────────────────────────────
// The one-line, read-only status bar js/module-host.js injects above every
// module view backed by team data. Pure and DOM-free like everything else in
// this file, so tests/test_sync_center_helpers.mjs pins the copy and
// the variant math directly.

/** A module row's `remoteAt` is the newest upstream commit that touched
 * THAT module's files (GET /api/sync-modules), so `null` there means no
 * such commit is known - the module was never pushed from anywhere, or the
 * source was never fetched here. Either way the server holds nothing of it
 * that we know of; said as that, never as a guessed date. */
const NO_REMOTE_DATA = 'the server has no data for this module yet (or the server has not been fetched yet)';

/** A module that declared NO paths for this source (GET /api/sync-modules ->
 * `declaredPaths: false`) owns nothing here: the scope fell back to the
 * assumed `<id>/` directory, which does not exist, so every count is 0 and
 * both dates are null. That is the ownership rule working as intended - the
 * module WRITING a path declares it, a module that only reads declares
 * nothing - and not a sync problem. Said plainly, because NO_REMOTE_DATA
 * names two causes and this is a third one: it reads as "fetch something"
 * for a row where there is nothing to fetch. */
// Row `access: 'read'` from GET /api/sync-modules: the numbers are a view of files another row owns.
const READS_ONLY = 'this module has no files of its own here - it only reads this data';

/** ds-callout variants ranked so the strongest one wins across several rows. */
const _VARIANT_RANK = { success: 0, info: 1, warning: 2 };

/**
 * The sources GET /api/sync-overview knows about that a
 * POST /api/sync-overview/refresh answer says nothing about, as
 * `{repo, ok: false}` entries moduleSyncBarState() reads exactly like a
 * failed check. Pulled out of js/module-sync-bar.js (which called
 * getSyncOverview() itself) so the decision is pure and pinned directly by
 * tests/test_sync_center_helpers.mjs instead of by a regex on the browser
 * module's source. Two silences the refresh payload cannot express on its
 * own, and both would otherwise read as "checked, all good":
 *  - the whole POST failed (`r.ok === false`), so nothing was checked at all;
 *  - a source with no write token was never even a TARGET of the fetch
 *    (remoteRefreshTargets in server.js filters on `writeToken()`, the same
 *    getter the overview row's `hasToken` comes from) - which is the closed
 *    vault the bar's own copy already names ("no connection or token").
 * Entries for a repo the caller's module does not touch are ignored
 * downstream (moduleSyncBarState matches them against the module's own rows).
 * @param {{repo?: string, hasToken?: boolean}[]} overviewRepos - GET /api/sync-overview's `repos`
 * @param {{ok?: boolean}} r - the refreshRemoteState() answer
 * @param {{repo?: string}[]} list - its `refreshed` array
 * @returns {{repo: string, ok: false}[]}
 */
export function uncheckedRepos(overviewRepos, r, list) {
  const seenList = Array.isArray(list) ? list : [];
  const seen = new Set(seenList.map((x) => x && x.repo));
  const repos = Array.isArray(overviewRepos) ? overviewRepos : [];
  const failed = !!(r && r.ok === false);
  return repos
    .filter((row) => row && row.repo && !seen.has(row.repo) && (failed || row.hasToken === false))
    .map((row) => ({ repo: row.repo, ok: false }));
}

/**
 * Repo ids GET /api/sync-overview reports as not cloned on this machine -
 * status 'not-configured' (never cloned) or 'dir-exists' (a leftover
 * directory blocked the clone), the same two values repoStateBadge already
 * reads as "not downloaded". `_syncModulesForRepo` in server.js answers plain
 * zeros for such a repo, with nothing in the GET /api/sync-modules row
 * itself to say why - without this, moduleSyncBarState would read those
 * zeros through `_rowSentence` and paint a confident "Data up to date" for a
 * source this machine has never even fetched.
 * @param {{repo?: string, status?: string}[]} overviewRepos - GET /api/sync-overview's `repos`
 * @returns {string[]}
 */
export function notClonedRepoIds(overviewRepos) {
  const repos = Array.isArray(overviewRepos) ? overviewRepos : [];
  return repos
    .filter((r) => r && (r.status === 'not-configured' || r.status === 'dir-exists'))
    .map((r) => r.repo);
}

/**
 * Repo ids GET /api/sync-overview reports as holding NO token while the vault
 * is open - the person simply has no access to that source, which nothing in
 * the app can fix. With the vault closed every row reads `hasToken: false`
 * and the infra banner already says "open the vault", so those rows are left out
 * here and keep the generic "no connection or token" wording.
 * moduleSyncBarState uses this to stop urging a clone that cannot succeed and
 * to stop reading a check that was never attempted as a failed one.
 * @param {{repo?: string, hasToken?: boolean, bitwardenLocked?: boolean}[]} overviewRepos
 * @returns {string[]}
 */
export function noTokenRepoIds(overviewRepos) {
  const repos = Array.isArray(overviewRepos) ? overviewRepos : [];
  return repos
    .filter((r) => r && r.repo && r.hasToken === false && r.bitwardenLocked !== true)
    .map((r) => r.repo);
}

/**
 * English plural of "file" for a file count: 1 -> "1 file", everything
 * else (0 included) -> "N files".
 * @param {number} k
 * @returns {string}
 */
export function pluralFiles(k) {
  const n = Math.abs(Math.trunc(Number(k))) || 0;
  return n === 1 ? '1 file' : `${n} files`;
}

/**
 * One row's sentence and the variant it implies, in the order the plan fixes:
 * both directions pending outranks either alone, which outranks "up to date".
 * @param {{filesToSend?: number, filesToFetch?: number, localAt?: string|null, remoteAt?: string|null}} row
 * @returns {{variant: 'success'|'info'|'warning', text: string}}
 */
function _rowSentence(row) {
  const send = Number(row.filesToSend) || 0;
  const fetch = Number(row.filesToFetch) || 0;
  // Decided BEFORE the counts, because an empty scope is not a state the
  // counts can describe: they are 0 for "nothing to do" and 0 for "nothing
  // here at all", and only this flag separates the two.
  if (row.declaredPaths === false && send === 0 && fetch === 0 && !row.localAt && !row.remoteAt) {
    return { variant: 'success', text: `${READS_ONLY}.` };
  }
  const loc = _fmtWhen(row.localAt);
  const hasRem = !!row.remoteAt;
  const rem = hasRem ? _fmtWhen(row.remoteAt) : null;
  // "server state as of <date>" needs a date; without one the clause says what
  // the missing date means instead of reading "state as of none".
  const remClause = hasRem ? `server state as of ${rem}` : NO_REMOTE_DATA;

  if (send > 0 && fetch > 0) {
    return {
      variant: 'warning',
      text: `You have local changes (${pluralFiles(send)}, latest from ${loc}) and the server has newer data (${pluralFiles(fetch)}, ${remClause}).`,
    };
  }
  if (send > 0) {
    return {
      variant: 'warning',
      text: `You have local changes (${pluralFiles(send)}, latest from ${loc}) - ${hasRem ? `server state as of ${rem}` : NO_REMOTE_DATA}.`,
    };
  }
  if (fetch > 0) {
    return {
      variant: 'info',
      text: `The server has newer data (${pluralFiles(fetch)}, ${remClause}) - your local state is from ${loc}.`,
    };
  }
  return {
    variant: 'success',
    text: hasRem ? `Data up to date - local ${loc}, server ${rem}.` : `Data up to date - local ${loc}, ${NO_REMOTE_DATA}.`,
  };
}

/**
 * Sentence for a module row whose repo is not cloned on this machine at all.
 * `_syncModulesForRepo` answers plain zeros for that repo (see server.js),
 * which `_rowSentence` would otherwise read as "Data up to date" - a green,
 * confident sentence about a source that was never even fetched here.
 * Always `warning`, so it outranks every other row and the bar never claims
 * success while one of the module's repos has nothing local at all.
 * @param {string} label
 * @returns {{variant: 'warning', text: string}}
 */
function _notClonedSentence(label) {
  return {
    variant: 'warning',
    text: `Data source "${label}" is not downloaded to this machine yet - open Sync to download it.`,
  };
}

/**
 * Sentence for a module row whose repo is not cloned AND has no token in an
 * open vault: "go and download it" would send the person to a clone that
 * fails on auth. Nothing is broken, so `info`, never `warning`.
 * @param {string} label
 * @returns {{variant: 'info', text: string}}
 */
function _noAccessSentence(label) {
  return {
    variant: 'info',
    text: `You have no access to data source "${label}" - the vault has no token for this repository. Ask the person who manages it for access.`,
  };
}

/**
 * The module sync bar's whole decision, from the GET /api/sync-modules rows
 * for ONE module (0..n, one per repo it spans), the refresh() outcome and a
 * repo-id -> label map. Pure, no document access, no Date.now().
 * @param {object[]} rows - rows already filtered to `m.id === moduleId`
 * @param {{repo: string, ok: boolean, error?: string, skipped?: boolean}[]|null} refreshed
 * @param {Record<string, string>} [labels]
 * @param {{notClonedRepos?: string[]|Set<string>, noTokenRepos?: string[]|Set<string>, checking?: boolean}} [opts] -
 *   `notClonedRepos`: repo ids notClonedRepoIds() reported for the current
 *   GET /api/sync-overview; `noTokenRepos`: repo ids noTokenRepoIds()
 *   reported (no access, vault open) - a not-cloned one gets the no-access
 *   sentence instead of "fetch", and its never-attempted check is not a
 *   failed one; `checking`: the remote check for this paint has
 *   not answered yet (the bar's first, fast paint - see paintModuleSyncBar),
 *   so the fetch side of the sentence is the last known state and a
 *   confident "success" is capped at "info" until the check lands.
 * @returns {{variant: 'neutral'|'success'|'info'|'warning', text: string}}
 */
export function moduleSyncBarState(rows, refreshed, labels = {}, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const known = list.filter((r) => r && !r.unknown);
  const unknown = list.filter((r) => r && r.unknown);

  if (!list.length || known.length === 0) {
    return {
      variant: 'neutral',
      text: 'No sync data for this module - open the Sync window to see the details.',
    };
  }

  const map = labels && typeof labels === 'object' ? labels : {};
  const notClonedInput = opts && opts.notClonedRepos;
  const notCloned = notClonedInput instanceof Set ? notClonedInput : new Set(Array.isArray(notClonedInput) ? notClonedInput : []);
  const noTokenInput = opts && opts.noTokenRepos;
  const noToken = noTokenInput instanceof Set ? noTokenInput : new Set(Array.isArray(noTokenInput) ? noTokenInput : []);
  const multi = list.length > 1;
  let variant = 'success';
  const sentences = known.map((row) => {
    const label = map[row.repo] || row.repo;
    const s = notCloned.has(row.repo)
      ? (noToken.has(row.repo) ? _noAccessSentence(label) : _notClonedSentence(label))
      : _rowSentence(row);
    if (_VARIANT_RANK[s.variant] > _VARIANT_RANK[variant]) variant = s.variant;
    const prefix = multi ? `${label}: ` : '';
    return prefix + s.text;
  });

  // An unknown row used to be filtered out entirely, so a module spanning a
  // repo whose classification timed out silently lost that source from the
  // sentence with no mention at all. It gets no `_rowSentence` (there is
  // nothing numeric to report), but it must still be named - and a confident
  // "success" cannot stand next to a source this answer says nothing about.
  for (const row of unknown) {
    const label = map[row.repo] || row.repo;
    sentences.push(`The state of source "${label}" is unknown.`);
  }
  if (unknown.length && variant === 'success') variant = 'info';

  let text = sentences.join(' ');

  const refreshedList = Array.isArray(refreshed) ? refreshed : [];
  const repoIds = new Set(known.map((r) => r.repo));
  // A source with no token (vault open) was never a target of the fetch:
  // that is no access, not a broken connection, and blaming the connection
  // kept "Could not check the server" on every module of that source
  // for good. A cloned one still gets its own honest clause below.
  const refreshFailed = refreshedList.some((r) => r && r.ok === false && !r.skipped && repoIds.has(r.repo) && !noToken.has(r.repo));
  const unchecked = known
    .filter((r) => noToken.has(r.repo) && !notCloned.has(r.repo))
    .map((r) => map[r.repo] || r.repo);
  if (unchecked.length) {
    const names = [...new Set(unchecked)].map((l) => `"${l}"`).join(', ');
    text += ` Without a token in the vault the server is not checked for ${names} - the server state comes from the last fetch.`;
    if (variant === 'success') variant = 'info';
  }
  if (refreshFailed) {
    text = 'Could not check the server (no connection or token) - the server state comes from the last fetch. ' + text;
    // A confident "success" is exactly the claim a failed check cannot back -
    // bump it to "info" rather than let the sentence contradict the badge.
    if (variant === 'success') variant = 'info';
  } else if (opts && opts.checking) {
    // The check is still running: the numbers are real (local state plus the
    // remote as of the last sync), only the "is the server ahead" half is
    // pending. Same cap as a failed check, for the same reason.
    text = 'Checking the server… ' + text;
    if (variant === 'success') variant = 'info';
  }

  return { variant, text };
}
