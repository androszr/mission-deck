// ── Mission Deck — js/sync-center-modal.js ────────────────────────────────
// The "Sync" top bar pill opens this modal instead of firing a pull
// straight away: a pull can rewrite the working copy, so it gets a
// confirmation step and a visible before/after rather than happening under
// one click.
//
// Stage "sync-center-module-expansion" (iteration 2) draws a real THREE-LEVEL
// table - every level is an actual `<tr>`, never a nested panel:
//   Level 1 - one row per GET /api/sync-overview repo. A chevron appears only
//     when the repo has at least one module row beyond the synthetic "Cockpit
//     Core" catch-all (js/sync-modules.js getModulesForRepo). Row-level
//     actions (Fetch / Send / Local changes / Copy log) are icon
//     buttons in this same row.
//   Level 2 - one row per (module, repo) pair from GET /api/sync-modules,
//     plus a trailing "Cockpit Core" row - each with its own badge, its own
//     "Last sync" date and, when there is something to send, its own
//     "Send" button (a scoped push, `?module=<id>`).
//   Level 3 - one row per opened badge, filled from
//     GET /api/sync-modules/files (fetched lazily, only on demand).
// See js/sync-center-helpers.js for the pure badge/sort/label functions this
// file paints with, and js/sync-modules.js for the client behind both new
// endpoints.
//
// Two gating fields come from the server ONLY, never guessed from a repo id:
// `row.canPush` and `row.canListLocalChanges` - see _rowCanPush and
// _rowCanListLocalChanges below, the sole readers of both fields. Neither
// button, nor the scoped-push action, ever compares a repo's own id against
// a literal string to decide whether it may run - the two fields above are
// the only gate.
//
// Loaded through a dynamic import from js/topbar.js so its markup stays out
// of the boot path.

import { escHtml } from './utils.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { showToast } from './toast.js';
import { runSyncWithProgress, formatSyncStreamError } from './sub-repo-sync-stream.js';
import {
  fetchSyncOverview, getSyncOverview, fetchDataTierStatus, clearDataTierDir, repairDetachedHeadUrl,
  decryptDataTierRepo, refreshRemoteState,
} from './data-tier-0-sync.js';
import {
  formatSyncLogText, syncProgress, gitPhaseProgress, syncPrereqCallout,
  moduleStateBadge, repoStateBadge, sortModuleRows, isRepoExpanded, fileStatusLabel,
  moduleHasFileList,
} from './sync-center-helpers.js';
import { refreshSyncModules, getModulesForRepo, fetchModuleFiles } from './sync-modules.js';
import { loadTeamDirectory } from './team-directory.js';

const MODAL_ID = 'sync-center-modal';

/**
 * The one tooltip behind every "Fetch" icon, on all three levels. It names
 * the mechanism instead of hiding it: git's unit is the commit, and the
 * plaintext tree must stay a complete mirror of the encrypted one - decrypt
 * a module's files alone and every `.enc` left without a plaintext twin
 * reads as a DELETION to `plaintextAheadOfMirror`, which the next push would
 * publish. So a pull is always the whole source, from whichever row it is
 * started; what the row picks is where the person looks, not what travels.
 */
const PULL_TIP = 'Fetch (syncs the whole source)';

/**
 * Explicit expand/collapse choices the person made for a repo's module
 * rows, persisted across a reload. `null` until the first read; a missing or
 * unreadable key means "no override yet" (isRepoExpanded then falls back to
 * its pending-based default). Both storage accesses are try/catch'd -
 * private mode or a full quota must not break rendering, only persistence.
 * @type {Record<string, boolean>|null}
 */
const EXPANDED_STORAGE_KEY = 'cockpit.syncCenter.expanded';
let _expandedOverrides = null;

function _loadExpandedOverrides() {
  if (_expandedOverrides) return _expandedOverrides;
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    _expandedOverrides = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_e) {
    _expandedOverrides = {};
  }
  return _expandedOverrides;
}

function _saveExpandedOverrides() {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(_expandedOverrides || {}));
  } catch (_e) { /* private mode / quota - the choice just does not persist */ }
}

/** Level-3 rows currently open, keyed `${repoId}:${moduleId}` (`moduleId` may
 * be `_all` for a repo's own badge, `_core`, or a real module id). */
const _filesOpen = new Set();
/** Cached GET /api/sync-modules/files responses, same key as `_filesOpen`. */
const _filesCache = new Map();

/**
 * At most one running (repo-level or scoped-module) operation per repo - a
 * scoped push holds the whole repo's git lock, so two operations on one repo
 * can never overlap. `moduleId: null` means the repo's OWN action row is
 * showing progress; a module id means that module's row is.
 * @type {Map<string, {moduleId: string|null, step: string, pct: number, counter: string, isError: boolean}>}
 */
const _inflight = new Map();

/** @param {string} repoId @param {string|null} moduleId @returns {string} */
function _inflightKey(repoId, moduleId) {
  return `${repoId}:${moduleId || ''}`;
}

/** A finished operation on a repo makes every cached file list for it stale
 * - including the repo-level "_all" one a scoped push did not touch. */
function _dropFilesCacheForRepo(repoId) {
  for (const key of Array.from(_filesCache.keys())) {
    if (key.startsWith(`${repoId}:`)) _filesCache.delete(key);
  }
}

/** @param {string} iso @returns {string} */
function _fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** @returns {string} current time as HH:MM, for the in-row "Synced" line. */
function _fmtTimeNow() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Tells a person that the "server" line is a snapshot from the last pull,
 * never a live network answer - shown as a `title` on the whole "Sync"
 * cell, per row, so nobody reads it as "checked right now". The second
 * sentence says WHOSE date it is: a repo row carries the repository's last
 * commit, a module or file row the last commit that touched ITS files
 * (GET /api/sync-modules scopes both lines that way), so a module untouched
 * since Tuesday no longer reads the hour somebody else pushed tonight. */
const SYNC_CELL_TITLE = 'The server state comes from the last fetch, not from a network query right now. '
  + 'On a repository row the dates cover the whole repository; on a module or file row - only its own files.';

/**
 * The two-line "Sync" cell content shared by all three levels: a local line
 * (this computer's own mtime/push time) above a remote line (the server's
 * state as last seen), each with its own icon - never one field standing in
 * for the other, and never a guessed date. The icon IS the label (folder =
 * local, cloud = server): a text prefix made the cell wrap, so the icon
 * carries `aria-label` and `title` instead. `onRemote === false` (file rows
 * only, from GET /api/sync-modules/files) means the item is known NOT to be
 * on the server yet, so the remote line says "none" instead of a dash;
 * `onRemote === undefined` (repo/module rows, which do not carry that field)
 * just falls back to the date-or-dash rendering.
 * @param {string|null|undefined} localAt
 * @param {string|null|undefined} remoteAt
 * @param {boolean} [onRemote]
 * @returns {string}
 */
function _syncTwoLineHtml(localAt, remoteAt, onRemote) {
  const localLine = `<div class="scm-sync-line"><span class="scm-sync-ico scm-sync-ico--local" role="img" aria-label="Local" title="Local"></span>${escHtml(localAt ? _fmtDate(localAt) : '-')}</div>`;
  const remoteText = onRemote === false ? 'none' : escHtml(remoteAt ? _fmtDate(remoteAt) : '-');
  const remoteLine = `<div class="scm-sync-line"><span class="scm-sync-ico scm-sync-ico--remote" role="img" aria-label="Server" title="Server"></span>${remoteText}</div>`;
  return `${localLine}${remoteLine}`;
}

/**
 * One `ds-icon-btn` for an Actions column. Every level (repo, module, file)
 * renders the SAME four of these, same order, so the column never drifts
 * sideways between rows - an action that makes no sense on THIS row is
 * `disabled`, never omitted. `aria-label` is set regardless of `disabled`
 * (a disabled button still needs to say what it would do), and `data-tip`
 * carries the reason in English whenever it is disabled.
 * @param {string} ico - one of download/upload/changes/copy (.scm-action-ico--<ico>)
 * @param {string} label - full aria-label text
 * @param {boolean} disabled
 * @param {string} tip - data-tip text (the visible reason when disabled)
 * @param {Record<string,string>} [data] - extra data-* attributes (act, repo, module)
 * @param {Record<string,string>} [aria] - extra aria-* attributes (expanded, controls)
 * @returns {string}
 */
function _iconBtn(ico, label, disabled, tip, data = {}, aria = {}) {
  const dataAttrs = Object.entries(data).map(([k, v]) => ` data-${k}="${escHtml(v)}"`).join('');
  const ariaAttrs = Object.entries(aria).map(([k, v]) => ` aria-${k}="${escHtml(v)}"`).join('');
  return `<button type="button" class="ds-icon-btn ds-icon-btn--sm"${dataAttrs}${disabled ? ' disabled' : ''}
        data-tip="${escHtml(tip)}" aria-label="${escHtml(label)}"${ariaAttrs}>
        <span class="scm-action-ico scm-action-ico--${ico}" aria-hidden="true"></span>
      </button>`;
}

/** True once the repo has a working copy to pull into / push from. */
function _rowExists(row) {
  return row.status !== 'not-configured' && row.status !== 'dir-exists';
}

function _ensureOverlay() {
  let overlay = document.getElementById(MODAL_ID);
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = MODAL_ID;
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--xl">
      <div class="ds-modal-header">
        <span class="ds-modal-title">Data sync</span>
        <button type="button" class="ds-modal-close" id="scm-close" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body" id="scm-body"></div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--tertiary" id="scm-refresh">Check server</button>
        <button type="button" class="ds-btn ds-btn--tertiary" id="scm-log">Copy sync log</button>
        <button type="button" class="ds-btn ds-btn--secondary" id="scm-ok">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => closeDsModal(overlay);
  overlay.querySelector('#scm-close').addEventListener('click', close);
  overlay.querySelector('#scm-ok').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#scm-log').addEventListener('click', () => { _copySyncLog(null, null); });
  overlay.querySelector('#scm-refresh').addEventListener('click', () => { _checkRemote(overlay, true); });
  _wireBody(overlay);
  return overlay;
}

/**
 * Whether this row's "Send" button may be enabled at all. `canPush` comes
 * from GET /api/sync-overview, which derives it from the operation table the
 * routes themselves dispatch on - so this never becomes a second, drifting
 * list of which sources are writable. An older payload without the field is
 * treated as writable, which is what every row was before it existed.
 * @param {object} row
 * @returns {boolean}
 */
function _rowCanPush(row) {
  return row.canPush !== false;
}

/**
 * Whether "Local changes" (and the file-list panel) may be enabled. Same
 * contract as _rowCanPush: the server derives it, the browser only obeys.
 * This one is not cosmetic - the listing re-encrypts the plaintext tree into
 * the mirror before reading `git status`, so opening it on a source whose
 * plaintext tree is empty would prune that mirror.
 * @param {object} row
 * @returns {boolean}
 */
function _rowCanListLocalChanges(row) {
  return row.canListLocalChanges !== false;
}

/**
 * The four icon-only row actions (Fetch / Send / Local changes / Copy
 * log) for one repo's Level-1 row - the gate is always `_rowCanPush` /
 * `_rowCanListLocalChanges`, never the repo's own id.
 * @param {object} row
 * @param {boolean} busy - true while ANY operation on this repo is running
 *   (repo-level or a scoped module push - one git lock either way).
 * @returns {string}
 */
function _repoActionsMarkup(row, busy) {
  const repoId = row.repo;
  const label = row.label || repoId;
  const exists = _rowExists(row);
  const canPush = _rowCanPush(row);
  const canListLocal = _rowCanListLocalChanges(row);

  const pullLabel = exists ? 'Fetch' : 'Download repository';

  const pushDisabled = busy || !exists || !canPush;
  const pushTip = !canPush ? 'Sending this source is not available yet'
    : !exists ? 'Download this source first'
      : 'Send';

  const localDisabled = busy || !exists || !canListLocal;
  const localTip = !canListLocal ? 'Previewing local changes of this source is not available yet'
    : !exists ? 'Download this source first'
      : 'Local changes';

  return `
    <div class="scm-actions">
      ${_iconBtn('download', `${pullLabel} ${label}`, busy, pullLabel, { act: 'pull', repo: repoId })}
      ${_iconBtn('upload', `Send ${label}`, pushDisabled, pushTip, { act: 'push', repo: repoId })}
      ${_iconBtn('changes', `Local changes ${label}`, localDisabled, localTip, { act: 'files-all', repo: repoId }, { expanded: _allModuleFilesShown(repoId) ? 'true' : 'false' })}
      ${_iconBtn('copy', `Copy log ${label}`, false, 'Copy log', { act: 'copy-log', repo: repoId })}
    </div>`;
}

/**
 * Level-2 (module / "Cockpit Core") action icons - the SAME four buttons,
 * same order, as the repo row above (_repoActionsMarkup), so the Actions
 * column never drifts sideways between levels. The files icon here does
 * NOT open the local-changes modal (that stays a repo-level action, per an
 * explicit request) - it shares `data-act="files"` with the badge, so both
 * routes toggle the SAME Level-3 file rows through the one `_toggleFiles`
 * handler rather than duplicating that logic.
 *
 * "Fetch" carries `data-act="pull"` with NO `data-module`, which is the
 * whole of its scoping: it starts the repo's own pull (see PULL_TIP for why
 * there is no smaller one) and shows its progress in the repo row, where a
 * whole-source operation belongs. It was `disabled` with a refusal tooltip
 * before, which turned "this source has one mechanism" into "this row can do
 * nothing".
 * @param {object} mod
 * @param {string} repoId
 * @param {boolean} repoCanPush
 * @param {boolean} busy - true while ANY operation runs on this repo (one git lock).
 * @param {boolean} hasFiles - whether this module has a file list to show (mirrors the badge's own clickability test).
 * @param {boolean} filesShown
 * @returns {string}
 */
function _moduleActionsMarkup(mod, repoId, repoCanPush, busy, hasFiles, filesShown) {
  const label = mod.label;

  let pushDisabled = true;
  let pushTip;
  if (busy) { pushTip = 'Another operation is running on this source'; } else if (mod.access === 'read') { pushTip = 'This module only reads this data - send it from the owner row'; } else if (mod.unknown) { pushTip = 'No change data - refresh to try again'; } else if (!mod.pendingPush) { pushTip = 'Nothing to send'; } else if (!repoCanPush) { pushTip = 'Sending this source is not available yet'; } else { pushDisabled = false; pushTip = 'Send'; }

  const localTip = hasFiles ? 'Files to sync' : 'No files to show';

  return `
    <div class="scm-actions">
      ${_iconBtn('download', `Fetch ${label}`, busy, PULL_TIP, { act: 'pull', repo: repoId })}
      ${_iconBtn('upload', `Send ${label}`, pushDisabled, pushTip, { act: 'push', repo: repoId, module: mod.id })}
      ${_iconBtn('changes', `Files ${label}`, !hasFiles, localTip, { act: 'files', repo: repoId, module: mod.id }, { expanded: filesShown ? 'true' : 'false', controls: `scm-files-${repoId}-${mod.id}` })}
      ${_iconBtn('copy', `Copy log ${label}`, false, 'Copy log', { act: 'copy-log', repo: repoId, module: mod.id })}
    </div>`;
}

/**
 * Level-3 (one file) action icons - same four, same order. "Fetch" is the
 * repo's pull, exactly as on Level 2 (PULL_TIP says why a smaller one would
 * be unsafe); "Send" stays `disabled` until the server grows a per-file
 * push contract (see the module docblock on _fileRowMarkup below).
 * @param {{path: string|null}} f
 * @param {string} repoId
 * @param {boolean} busy - true while ANY operation runs on this repo.
 * @returns {string}
 */
function _fileActionsMarkup(f, repoId, busy) {
  const pathLabel = f.path === null ? 'file with an unknown name' : f.path;
  return `
    <div class="scm-actions">
      ${_iconBtn('download', `Fetch ${pathLabel}`, busy, PULL_TIP, { act: 'pull', repo: repoId })}
      ${_iconBtn('upload', `Send ${pathLabel}`, true, 'Sending a single file is not available yet')}
      ${_iconBtn('changes', `Local changes ${pathLabel}`, true, 'This file\'s changes are already shown on this row')}
      ${_iconBtn('copy', `Copy log ${pathLabel}`, true, 'No log is available for a single file')}
    </div>`;
}

/**
 * Cells 2-4 of a row (badge / counts-or-empty / lastSync) replaced by a
 * progress bar while `entry`'s operation is running - column 5 (actions)
 * stays a separate `<td>` next to this one, disabled but present.
 * @param {{step: string, pct: number, counter: string, isError: boolean}} entry
 * @returns {string}
 */
function _progressCellsMarkup(entry) {
  const hasPct = typeof entry.pct === 'number';
  const pct = hasPct ? Math.max(0, Math.min(100, entry.pct)) : 0;
  const stepText = entry.step || 'Starting...';
  return `
    <td colspan="3">
      <div class="ds-progress scm-prog">
        <div class="ds-progress-labels"><span class="scm-prog-step">${escHtml(stepText)}</span><span>${escHtml(entry.counter || '')}</span></div>
        <div class="ds-progress-track"><div class="ds-progress-fill ${entry.isError ? 'ds-progress-fill--red' : 'ds-progress-fill--brand'}" style="width:${pct}%"></div></div>
      </div>
    </td>`;
}

/** @param {'A'|'M'|'D'|string} status @returns {string} */
function _fileStatusBadgeCls(status) {
  if (status === 'A') return 'ds-badge--green';
  if (status === 'D') return 'ds-badge--red';
  return 'ds-badge--yellow';
}

/**
 * One Level-3 row: a single pending file, in the SAME five columns as every
 * other level - path (wraps, never widens the table) / status badge /
 * direction counts / the shared two-line sync cell / action icons. Never a
 * nested `<ul>`: a real `<tr>` is what makes the hierarchy (repo -> module ->
 * file) read as one table instead of a block bolted onto the third column.
 *
 * The "Send - fetch" cell reads the row's own `direction`: GET
 * /api/sync-modules/files answers with BOTH - `send` from _repoPendingSet
 * and `fetch` from _repoRemoteAheadPaths - so the level-3 rows of a module
 * always add up to the "1 / 1" its level-2 row shows. A file pending in both
 * directions at once is two rows, one per direction, which is what keeps
 * that sum honest.
 * @param {{path: string|null, status: string, localAt: string|null, remoteAt: string|null, onRemote: boolean}} f
 * @param {string} repoId
 * @param {string} moduleId
 * @param {string|null} rowId - set only on the FIRST row of a group, so the
 *   badge's `aria-controls` names a real element without every sibling row
 *   fighting over the same id.
 * @returns {string}
 */
function _fileRowMarkup(f, repoId, moduleId, rowId) {
  const toFetch = f.direction === 'fetch';
  const counts = toFetch ? { send: 0, fetch: 1 } : { send: 1, fetch: 0 };
  const pathHtml = f.path === null ? '(name unavailable)' : `<code>${escHtml(f.path)}</code>`;
  const idAttr = rowId ? ` id="${escHtml(rowId)}"` : '';
  return `
    <tr class="scm-row--file" data-repo="${escHtml(repoId)}" data-module="${escHtml(moduleId)}"${idAttr}>
      <td>${pathHtml}</td>
      <td><span class="ds-badge ds-badge--sm ${_fileStatusBadgeCls(f.status)}">${escHtml(fileStatusLabel(f.status, f.direction))}</span></td>
      <td title="${escHtml(_countsTip(counts))}">${counts.send} / ${counts.fetch}</td>
      <td class="scm-sync-cell" title="${SYNC_CELL_TITLE}">${_syncTwoLineHtml(f.localAt, f.remoteAt, f.onRemote)}</td>
      <td>${_fileActionsMarkup(f, repoId, _inflight.has(repoId))}</td>
    </tr>`;
}

/**
 * The Level-3 rows for one module (or a repo's own "_all"/"_core"): real
 * `<tr>`s, one per pending file, plus a one-row info line (loading, error,
 * empty, "showing N of M") that spans all five
 * columns rather than sitting at the left edge. Renders nothing when the
 * disclosure is not open (`_filesOpen`).
 * @param {string} repoId
 * @param {string} moduleId
 * @returns {string}
 */
function _filesRowsMarkup(repoId, moduleId) {
  const key = _inflightKey(repoId, moduleId);
  if (!_filesOpen.has(key)) return '';
  const entry = _filesCache.get(key);
  const baseId = `scm-files-${repoId}-${moduleId}`;
  const infoRow = (html, first) => `
    <tr class="scm-row--files-info" data-repo="${escHtml(repoId)}" data-module="${escHtml(moduleId)}"${first ? ` id="${escHtml(baseId)}"` : ''}>
      <td colspan="5">${html}</td>
    </tr>`;

  if (!entry || entry.loading) return infoRow('<p class="ds-hint">Checking differences...</p>', true);
  if (entry.error || !entry.data || entry.data.ok === false) return infoRow('<p class="ds-hint">Could not fetch the file list.</p>', true);
  const files = entry.data.files || [];
  if (!files.length) return infoRow('<p class="ds-hint">No differences to show.</p>', true);

  // The first file row carries the group's id (used to scroll the opened
  // list into view); no "server state from ..." row any more - the Sync cell's
  // title already says the server line is a snapshot, and every file row
  // shows its own server date, so the sentence only cost a row of height.
  const fileRows = files.map((f, i) => _fileRowMarkup(f, repoId, moduleId, i === 0 ? baseId : null)).join('');
  const moreRow = entry.data.truncated
    ? infoRow(`<p class="ds-hint">Showing ${files.length} of ${entry.data.total} files.</p>`, false)
    : '';
  return `${fileRows}${moreRow}`;
}

/**
 * One Level-2 row: a module (or the trailing "Cockpit Core" row) of one
 * repo, from GET /api/sync-modules. Its badge is a button (opening Level 3)
 * only when there is something to show; the "Send - fetch" cell reads
 * the same `filesToSend`/`filesToFetch` fields the repo row does (a dash
 * when the server has not sent them yet, never a blank cell).
 * @param {object} mod
 * @param {string} repoId
 * @param {boolean} repoCanPush
 * @returns {string}
 */
function _moduleRowMarkup(mod, repoId, repoCanPush) {
  const live = _inflight.get(repoId);
  const isLive = !!(live && live.moduleId === mod.id);
  const busy = !!live;
  const badge = moduleStateBadge(mod);
  const filesKey = _inflightKey(repoId, mod.id);
  const filesShown = _filesOpen.has(filesKey);
  const hasFiles = moduleHasFileList(mod);
  const badgeHtml = hasFiles
    ? `<button type="button" class="ds-badge ds-badge--sm ${badge.cls} scm-badge-btn" data-act="files" data-repo="${escHtml(repoId)}" data-module="${escHtml(mod.id)}"
        aria-expanded="${filesShown ? 'true' : 'false'}" aria-controls="scm-files-${escHtml(repoId)}-${escHtml(mod.id)}">${escHtml(badge.label)}</button>`
    : `<span class="ds-badge ds-badge--sm ${badge.cls}">${escHtml(badge.label)}</span>`;

  const counts = _rowFileCounts(mod);
  const countersCell = counts
    ? `<td title="${escHtml(_countsTip(counts))}">${counts.send} / ${counts.fetch}</td>`
    : '<td>-</td>';

  const actionsHtml = _moduleActionsMarkup(mod, repoId, repoCanPush, busy, hasFiles, filesShown);

  const labelCellHtml = escHtml(mod.label) + (mod.access === 'read' ? ' <span class="ds-badge ds-badge--sm ds-badge--transparent scm-access-badge">read only</span>' : '');
  const rowCells = isLive
    ? `<td>${labelCellHtml}</td>${_progressCellsMarkup(live)}<td>${actionsHtml}</td>`
    : `<td>${labelCellHtml}</td><td>${badgeHtml}</td>${countersCell}<td class="scm-sync-cell" title="${SYNC_CELL_TITLE}">${_syncTwoLineHtml(mod.localAt, mod.remoteAt)}</td><td>${actionsHtml}</td>`;

  const rowHtml = `
    <tr class="scm-row--module${mod.id === '_core' ? ' scm-row--core' : ''}" data-repo="${escHtml(repoId)}" data-module="${escHtml(mod.id)}">
      ${rowCells}
    </tr>`;
  return rowHtml + _filesRowsMarkup(repoId, mod.id);
}

/**
 * One repo's full group of rows: its own Level-1 row (plus a dir-exists
 * callout row and its own "_all" files row, which must render even when the
 * repo has no modules - the badge stays clickable regardless of the
 * chevron), and, only when expanded, a SECOND `<tbody>` holding every
 * Level-2 module row (each carrying its own Level-3 rows). Two sibling
 * `<tbody>` elements are valid HTML and let `aria-controls` on the chevron
 * name a real element (`scm-modules-<repoId>`) instead of nothing.
 * @param {object} row - one GET /api/sync-overview row
 * @returns {string}
 */
function _repoGroupMarkup(row) {
  const repoId = row.repo;
  const modules = sortModuleRows(getModulesForRepo(repoId));
  const hasModules = modules.some((m) => m.id !== '_core');
  const overrides = _loadExpandedOverrides();
  const expanded = isRepoExpanded(overrides, row, hasModules);
  const live = _inflight.get(repoId);
  const isRepoLive = !!(live && live.moduleId === null);

  const badge = repoStateBadge(row);
  const counts = _rowFileCounts(row);
  const counters = counts ? `${counts.send} / ${counts.fetch}` : '—';

  const chevronHtml = hasModules
    ? `<button type="button" class="ds-icon-btn ds-icon-btn--sm scm-toggle${expanded ? ' scm-toggle--open' : ''}" data-act="toggle" data-repo="${escHtml(repoId)}"
        aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="scm-modules-${escHtml(repoId)}"
        aria-label="${expanded ? 'Collapse modules' : 'Expand modules'}">
        <span class="scm-action-ico scm-action-ico--chevron" aria-hidden="true"></span>
      </button>`
    // A repo with no modules still reserves the chevron's 32px, so every repo
    // label starts at the same x and a module row (one indent step further)
    // cannot be mistaken for a chevron-less repo's own label.
    : '<span class="scm-toggle-slot" aria-hidden="true"></span>';
  const labelInner = escHtml(row.label || repoId);
  const labelHtml = hasModules
    ? `<span class="scm-repo-label scm-repo-label--toggle" data-act="toggle" data-repo="${escHtml(repoId)}" role="button" tabindex="0" aria-expanded="${expanded ? 'true' : 'false'}">${labelInner}</span>`
    : `<span class="scm-repo-label">${labelInner}</span>`;

  // The repo badge is the same gesture as the repo's "Local changes" icon:
  // it opens the file rows under each module, never a second modal.
  const filesAllShown = _allModuleFilesShown(repoId);
  const badgeClickable = typeof row.filesToSend === 'number' && row.filesToSend > 0;
  const badgeHtml = badgeClickable
    ? `<button type="button" class="ds-badge ds-badge--sm ${badge.cls} scm-badge-btn" data-act="files-all" data-repo="${escHtml(repoId)}"
        aria-expanded="${filesAllShown ? 'true' : 'false'}">${escHtml(badge.label)} (${row.filesToSend})</button>`
    : `<span class="ds-badge ds-badge--sm ${badge.cls}">${escHtml(badge.label)}</span>`;

  const bodyCells = isRepoLive
    ? `${_progressCellsMarkup(live)}<td>${_repoActionsMarkup(row, true)}</td>`
    : `<td>${badgeHtml}</td>
       <td${counts ? ` title="${escHtml(_countsTip(counts))}"` : ''}>${escHtml(counters)}</td>
       <td class="scm-sync-cell" title="${SYNC_CELL_TITLE}">${_syncTwoLineHtml(row.localAt, row.remoteAt)}</td>
       <td>${_repoActionsMarkup(row, !!live)}</td>`;

  const repoRowHtml = `
    <tr class="scm-row" data-repo="${escHtml(repoId)}">
      <td>${chevronHtml}${labelHtml}</td>
      ${bodyCells}
    </tr>`;

  let calloutHtml = '';
  // `wrappedUpAt` counts too, not only `decrypted === false`. A source wiped
  // by "End of day" and then touched by one stray write reads `decrypted:
  // true` again (mirrorOverlap sees the single file), so on this row
  // repoStateBadge would print "after end of day" with no button beside it.
  // Same rule as dayCycleRowBadge / morningRowsToDecrypt / repoStateBadge -
  // the marker is what the server clears on a successful decrypt.
  if (row.decrypted === false || row.wrappedUpAt) {
    const body = row.encryptionReady === false
      ? 'The data is downloaded but encrypted: the key for this source is missing. Add it in the "Start here" wizard (step 4).'
      : 'The data is downloaded but not decrypted yet.';
    const btn = row.encryptionReady === false ? '' : `
            <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-act="decrypt" data-repo="${escHtml(repoId)}" style="margin-left:8px">Decrypt</button>`;
    calloutHtml = `
    <tr class="scm-row-callout" data-repo="${escHtml(repoId)}">
      <td colspan="5" style="white-space:normal">
        <div class="ds-callout ds-callout--warning" style="margin-top:8px">
          <div>${body}${btn}
          </div>
        </div>
      </td>
    </tr>`;
  } else if (row.status === 'dir-exists') {
    calloutHtml = `
    <tr class="scm-row-callout" data-repo="${escHtml(repoId)}">
      <td colspan="5" style="white-space:normal">
        <div class="ds-callout ds-callout--warning" style="margin-top:8px">
          <div>The data folder contains leftovers from a failed download.
            <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-act="clear-dir" data-repo="${escHtml(repoId)}" style="margin-left:8px">Clear folder</button>
          </div>
        </div>
      </td>
    </tr>`;
  }

  // No repo-level `_all` file list any more: a repo-level click expands each
  // module's own rows, so every file is shown under the module it belongs to.
  const group1 = `<tbody class="scm-repo-body" data-repo="${escHtml(repoId)}">${repoRowHtml}${calloutHtml}</tbody>`;

  let group2 = '';
  if (expanded) {
    const moduleRowsHtml = modules.map((m) => _moduleRowMarkup(m, repoId, _rowCanPush(row))).join('');
    group2 = `<tbody id="scm-modules-${escHtml(repoId)}" class="scm-modules-group" data-repo="${escHtml(repoId)}">${moduleRowsHtml}</tbody>`;
  }
  return group1 + group2;
}

/**
 * The two numbers under "Send · fetch": FILES that differ, not commits.
 * `filesToSend`/`filesToFetch` are derived server-side (see
 * _repoPendingFileCounts). This column used to render `ahead`/`behind`, which
 * count commits - and because a push here encrypts, commits and pushes in one
 * operation, `ahead` was 0 for every edit a person had actually made. An
 * older server sends neither field; the row then falls back to a dash rather
 * than showing a number it cannot justify.
 * @param {object} row
 * @returns {{send: number, fetch: number}|null}
 */
function _rowFileCounts(row) {
  if (typeof row.filesToSend !== 'number' || typeof row.filesToFetch !== 'number') return null;
  return { send: row.filesToSend, fetch: row.filesToFetch };
}

/**
 * English plural for the noun "file": 1 -> singular, everything else -> plural.
 * @param {number} n
 * @returns {string}
 */
function _plikiLabel(n) {
  return Math.abs(n) === 1 ? `${n} file` : `${n} files`;
}

/**
 * @param {{send: number, fetch: number}} counts
 * @returns {string}
 */
function _countsTip(counts) {
  const send = counts.send ? `${_plikiLabel(counts.send)} to send` : 'nothing to send';
  const fetch = counts.fetch ? `${_plikiLabel(counts.fetch)} to fetch` : 'nothing to fetch';
  return `${send}, ${fetch}`;
}

/**
 * Copy GET /api/sync-log for one repo id (route id, not remote name) to the
 * clipboard, with a legacy `execCommand` fallback for browsers without
 * `navigator.clipboard`. With `moduleId` set, only that module's entries are
 * copied - `formatSyncLogText` already names `evt.module` in its header, so
 * filtering here just narrows WHICH entries reach it; a module with no
 * entries still copies a real (short, honest) text rather than failing,
 * same as the whole-repo case with an empty log. `repoId` null copies the
 * whole app-wide log (every repo) - the footer button's case; the log used
 * to open in the step-by-step sync modal, which expects a `steps` payload
 * this endpoint never sends, so the modal opened on nothing.
 * @param {string|null} repoId route id, or null for every repo
 * @param {string|null} [moduleId]
 */
async function _copySyncLog(repoId, moduleId) {
  let events = [];
  try {
    const q = repoId ? `repo=${encodeURIComponent(repoId)}&limit=500` : 'limit=500';
    const res = await fetch(`/api/sync-log?${q}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      events = Array.isArray(data.events) ? data.events : [];
    }
  } catch (_e) { /* fall through with an empty log - formatSyncLogText handles it */ }

  const filtered = moduleId ? events.filter((e) => e && e.module === moduleId) : events;
  const text = formatSyncLogText(filtered);
  const copied = await _copyTextToClipboard(text);
  if (copied) showToast('success', 'Copied', 'The sync log is in the clipboard.');
  else showToast('warning', 'Copy unavailable', 'Could not copy the log to the clipboard.');
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function _copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_e) { /* fall through to the legacy path below */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_e) {
    return false;
  }
}

/**
 * Repaint just ONE repo's group of `<tbody>` elements from current cache -
 * never the whole table, so scroll position, an open confirmation on another
 * repo, or another repo's in-flight progress all survive untouched.
 * @param {Element} overlay
 * @param {string} repoId
 */
function _repaintRepoGroup(overlay, repoId) {
  const overview = getSyncOverview();
  const repos = (overview && overview.repos) || [];
  const row = repos.find((r) => r.repo === repoId) || null;
  const table = overlay.querySelector('#scm-body table.scm-table');
  if (!row || !table) return;

  const existing = Array.from(table.querySelectorAll(`tbody[data-repo="${repoId}"]`));
  const holder = document.createElement('table');
  holder.innerHTML = _repoGroupMarkup(row);
  const fresh = Array.from(holder.querySelectorAll('tbody'));
  if (!existing.length || !fresh.length) return;
  existing[0].replaceWith(...fresh);
  for (let i = 1; i < existing.length; i++) existing[i].remove();
}

/**
 * Open or close the Level-3 file list of one module (or a repo's own
 * "_all"), fetching it once and caching the result for as long as the modal
 * stays open (a finished operation drops the cache via
 * `_dropFilesCacheForRepo`).
 * @param {Element} overlay
 * @param {string} repoId
 * @param {string} moduleId
 */
async function _toggleFiles(overlay, repoId, moduleId) {
  const key = _inflightKey(repoId, moduleId);
  if (_filesOpen.has(key)) {
    _filesOpen.delete(key);
    _repaintRepoGroup(overlay, repoId);
    return;
  }
  _filesOpen.add(key);
  if (!_filesCache.has(key)) {
    _filesCache.set(key, { loading: true });
    _repaintRepoGroup(overlay, repoId);
    const data = await fetchModuleFiles(repoId, moduleId);
    _filesCache.set(key, { loading: false, data, error: data.ok === false });
  }
  _repaintRepoGroup(overlay, repoId);
}

/**
 * Module ids of one repo worth listing - the rows a repo-level "Local
 * changes" click expands. `_core` counts like any other module; a module with
 * nothing pending is skipped, because an empty list under it is only noise.
 * @param {string} repoId
 * @returns {string[]}
 */
function _pendingModuleIds(repoId) {
  return getModulesForRepo(repoId)
    .filter((m) => !m.unknown && typeof m.filesToSend === 'number' && m.filesToSend > 0)
    .map((m) => m.id);
}

/**
 * True once every module of `repoId` that has pending files is expanded -
 * what the repo row's badge and its "Local changes" icon report as their
 * `aria-expanded`, and what decides whether the next click opens or closes.
 * @param {string} repoId
 * @returns {boolean}
 */
function _allModuleFilesShown(repoId) {
  const ids = _pendingModuleIds(repoId);
  return ids.length > 0 && ids.every((id) => _filesOpen.has(_inflightKey(repoId, id)));
}

/**
 * Repo-level "Local changes": expand (or collapse) the Level-3 file rows of
 * EVERY module that has something pending, so each file shows as a row under
 * the module it belongs to instead of in a second modal on top of the table.
 * Delegates to `_toggleFiles` per module rather than duplicating its
 * fetch/cache/repaint logic - one toggle path, four entry points.
 * @param {Element} overlay
 * @param {string} repoId
 * @returns {Promise<void>}
 */
async function _toggleAllModuleFiles(overlay, repoId) {
  const ids = _pendingModuleIds(repoId);
  if (!ids.length) return;
  // Decided ONCE up front: _toggleFiles mutates _filesOpen as it goes, so
  // re-reading "are they all open" inside the loop would flip mid-way and
  // leave half the modules expanded.
  const collapsing = _allModuleFilesShown(repoId);
  for (const id of ids) {
    if (collapsing === _filesOpen.has(_inflightKey(repoId, id))) {
      await _toggleFiles(overlay, repoId, id);
    }
  }
}

/**
 * Flip the person's explicit expand/collapse choice for one repo and
 * persist it - an override always wins over the pending-based default from
 * then on (see isRepoExpanded in js/sync-center-helpers.js).
 * @param {Element} overlay
 * @param {string} repoId
 * @param {object} row
 * @param {boolean} hasModules
 */
function _toggleRepoExpanded(overlay, repoId, row, hasModules) {
  const overrides = _loadExpandedOverrides();
  const current = isRepoExpanded(overrides, row, hasModules);
  overrides[repoId] = !current;
  _saveExpandedOverrides();
  _repaintRepoGroup(overlay, repoId);
}

/**
 * Run a repo-level pull/clone, a repo-level push, or a scoped module push
 * (`moduleId` set), rendering progress in place through `_inflight` and
 * `_repaintRepoGroup`. Only one operation per repo at a time - the caller
 * (the delegated click handler) never issues a second one while `_inflight`
 * already holds this repo's key, because every action button that would
 * start one is rendered `disabled` while it does.
 * @param {Element} overlay
 * @param {string} repoId
 * @param {object} row
 * @param {'pull'|'push'} kind
 * @param {string|null} moduleId
 */
async function _runRepoAction(overlay, repoId, row, kind, moduleId) {
  if (!row) return;
  const label = row.label || repoId;
  const exists = _rowExists(row);
  const isPush = kind === 'push';
  const op = isPush ? 'push' : (exists ? 'pull' : 'clone');
  const streamUrl = isPush
    ? `/api/data/${repoId}/push-stream${moduleId ? `?module=${encodeURIComponent(moduleId)}` : ''}`
    : (exists ? `/api/data/${repoId}/pull-stream` : `/api/data/${repoId}/clone-stream`);
  const title = isPush
    ? `Sync ${label} (Send)`
    : (exists ? `Sync ${label} (Fetch)` : `Downloading repository ${label}`);

  let logCount = 0;
  _inflight.set(repoId, { moduleId: moduleId || null, step: '', pct: 0, counter: '', isError: false });
  _repaintRepoGroup(overlay, repoId);

  await runSyncWithProgress(streamUrl, {
    title,
    repoBase: `data/${repoId}`,
    // Every row on this registry is encrypted-at-rest today, so a failure
    // still opens the encrypted-step log modal.
    encrypted: true,
    setBusy: () => {},
    render: () => {},
    refreshStatus: () => {},
    repairDetachedHeadUrl: repairDetachedHeadUrl(repoId),
    inline: {
      onLog: (text, n) => {
        logCount = n;
        const entry = _inflight.get(repoId);
        if (!entry) return;
        const p = syncProgress(op, n, false);
        entry.step = text;
        entry.pct = p.pct;
        entry.counter = p.counter;
        _repaintRepoGroup(overlay, repoId);
      },
      // Git's own clone progress. It REPLACES the stage counter while a
      // transfer is running, because during a clone there is exactly one
      // stage and the stage counter therefore says "1 / 2" and stops moving
      // for as long as the transfer lasts. The next onLog (a new stage) takes
      // the bar back over on its own - no flag needed.
      onProgress: (raw) => {
        const entry = _inflight.get(repoId);
        if (!entry) return;
        const g = gitPhaseProgress(raw);
        if (!g) return;
        entry.step = g.step;
        entry.pct = g.pct;
        entry.counter = g.counter;
        _repaintRepoGroup(overlay, repoId);
      },
      onFinish: (d) => {
        const entry = _inflight.get(repoId);
        if (!entry) return;
        const p = syncProgress(op, logCount, d.ok);
        entry.step = d.ok ? `Synced ${_fmtTimeNow()}` : 'Sync error';
        entry.pct = p.pct;
        entry.counter = p.counter;
        entry.isError = !d.ok;
      },
    },
  });

  _inflight.delete(repoId);
  _dropFilesCacheForRepo(repoId);
  await _refreshRow(overlay, repoId);
}

/**
 * Re-fetch the overview AND the module status (in that order - a stale
 * module list would blink pending badges back after the server already
 * invalidated them), then repaint only this repo's group.
 * @param {Element} overlay
 * @param {string} repoId
 */
async function _refreshRow(overlay, repoId) {
  await refreshSyncModules({ force: true });
  const overview = await fetchSyncOverview();
  const repos = overview.repos || [];
  _paintPrereqCallout(overlay, repos);
  _repaintRepoGroup(overlay, repoId);
  if (repoId === 'data-tier-0') await fetchDataTierStatus();
  await _repaintTopbar();
}

/**
 * Paint (or clear) the "nothing responds" callout above the table.
 * @param {Element} overlay
 * @param {object[]} repos
 */
function _paintPrereqCallout(overlay, repos) {
  const container = overlay.querySelector('#scm-prereq');
  if (!container) return;
  const callout = syncPrereqCallout(repos || []);
  if (!callout) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="ds-callout ds-callout--warning" role="status">
      <div><strong>${escHtml(callout.title)}</strong> ${escHtml(callout.text)}</div>
    </div>`;
}

/**
 * Paint the modal body from the cached (or freshly fetched) overview. The
 * delegated click/keydown listener is bound once, in `_ensureOverlay`, on
 * `#scm-body` itself - replacing its `innerHTML` here never orphans it.
 * @param {Element} overlay
 * @param {{ok: boolean, repos: object[]}|null} overview
 */
function _render(overlay, overview) {
  const body = overlay.querySelector('#scm-body');
  if (!body) return;
  if (!overview) {
    // No fetch has resolved yet (first open of the modal in this page
    // session) - a loading state, not a failure. Do not confuse it with the
    // `ok: false` branch below, which means a fetch actually failed.
    body.innerHTML = '<div id="scm-prereq"></div><p class="ds-hint">Loading...</p>';
    return;
  }
  const ok = !!(overview && overview.ok);
  const repos = ok && Array.isArray(overview.repos) ? overview.repos : [];

  if (!repos.length) {
    body.innerHTML = `<div id="scm-prereq"></div><div class="ds-callout ds-callout--warning"><div>${escHtml(
      ok ? 'The data source registry is empty.' : 'Could not load the sync state.',
    )}</div></div>`;
    return;
  }

  body.innerHTML = `
    <div id="scm-prereq"></div>
    <div class="scm-table-wrap">
    <table class="ds-table scm-table">
      <thead>
        <tr><th>Repository</th><th>State</th><th>Send/fetch</th><th>Sync</th><th>Actions</th></tr>
      </thead>
      ${repos.map(_repoGroupMarkup).join('')}
    </table>
    </div>`;

  _paintPrereqCallout(overlay, repos);
}

/**
 * One delegated listener for every clickable element in the table, bound
 * once on `#scm-body` (never per-row) - a repaint only ever replaces
 * `<tbody>` elements underneath this parent, so the listener survives every
 * repaint without rebinding. Branch order matters: `files` is checked before
 * `push` because the badge-button carries BOTH `data-act="files"` and
 * `data-module` - if `push` were checked first (or by presence of
 * `data-module` alone) a click on the badge would start a push instead of
 * opening the file list.
 * @param {Element} overlay
 */
function _wireBody(overlay) {
  const body = overlay.querySelector('#scm-body');
  if (!body) return;

  body.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const repoId = el.dataset.repo;
    if (!repoId) return;
    const moduleId = el.dataset.module || null;
    const overview = getSyncOverview();
    const row = ((overview && overview.repos) || []).find((r) => r.repo === repoId) || null;

    if (el.dataset.act === 'files') {
      await _toggleFiles(overlay, repoId, moduleId);
      return;
    }
    if (el.dataset.act === 'copy-log') {
      await _copySyncLog(repoId, moduleId);
      return;
    }
    if (el.dataset.act === 'files-all') {
      if (!row) return;
      const hasModules = getModulesForRepo(repoId).some((m) => m.id !== '_core');
      if (hasModules) {
        // Module rows only exist while the repo group is expanded, so a click
        // on a collapsed repo has to open it first - otherwise the person
        // clicks and nothing appears.
        const overrides = _loadExpandedOverrides();
        if (!isRepoExpanded(overrides, row, hasModules)) {
          overrides[repoId] = true;
          _saveExpandedOverrides();
        }
        await _toggleAllModuleFiles(overlay, repoId);
        return;
      }
      // A repo with no installed modules has no chevron and no module rows to
      // expand under, so there is nowhere to put the files inline. The modal
      // stays its answer - and it is also the only way to reach "Discard
      // changes" from here.
      const { openLocalChangesModal } = await import('./local-changes-modal.js');
      await openLocalChangesModal(row.label || repoId, {
        repoId,
        onDiscarded: async () => { await _refreshRow(overlay, repoId); },
      });
      return;
    }
    if (el.dataset.act === 'decrypt') {
      el.disabled = true;
      const data = await decryptDataTierRepo(repoId);
      // The team roster and photos may have just appeared - drop the cached
      // empty directory so avatars resolve without a page reload.
      if (data.ok) loadTeamDirectory(true);
      if (data.ok) showToast('success', 'Data decrypted', data.message || '');
      else showToast('error', 'Decryption failed', formatSyncStreamError(data));
      await _refreshRow(overlay, repoId);
      return;
    }
    if (el.dataset.act === 'clear-dir') {
      el.disabled = true;
      const data = await clearDataTierDir(repoId);
      if (data.ok) showToast('success', 'Folder cleared', data.message || '');
      else showToast('error', 'Clearing failed', data.message || 'Could not clear the folder.');
      await _refreshRow(overlay, repoId);
      return;
    }
    if (el.dataset.act === 'pull') {
      await _runRepoAction(overlay, repoId, row, 'pull', null);
      return;
    }
    if (el.dataset.act === 'push') {
      await _runRepoAction(overlay, repoId, row, 'push', moduleId);
      return;
    }
    if (el.dataset.act === 'toggle') {
      if (!row) return;
      const hasModules = getModulesForRepo(repoId).some((m) => m.id !== '_core');
      _toggleRepoExpanded(overlay, repoId, row, hasModules);
    }
  });

  // Keyboard parity for the label-as-toggle (the chevron is a real button
  // element and already handles Enter/Space on its own).
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.scm-repo-label--toggle');
    if (!el || !el.dataset.repo) return;
    e.preventDefault();
    const repoId = el.dataset.repo;
    const overview = getSyncOverview();
    const row = ((overview && overview.repos) || []).find((r) => r.repo === repoId) || null;
    if (!row) return;
    const hasModules = getModulesForRepo(repoId).some((m) => m.id !== '_core');
    _toggleRepoExpanded(overlay, repoId, row, hasModules);
  });
}

async function _repaintTopbar() {
  try {
    const { repaintSyncButtonFromCache } = await import('./topbar.js');
    repaintSyncButtonFromCache();
  } catch (_e) { /* the 60 s poll catches up */ }
}

// True while a remote check is in flight. Two of them would fetch the same
// eight directories at once, and the second would only wait out the first's
// repo file locks.
let _remoteCheckInFlight = false;

/**
 * Ask the server to move every source's remote-tracking ref, then repaint
 * from the fresh overview the same request answers with. Without this the
 * whole "fetch" side of the table is the remote AS OF THIS MACHINE'S LAST
 * SYNC: `GET /api/sync-overview` reads `@{upstream}`, a local ref, and spends
 * no network by design (the top bar polls it every 60 s for eight rows).
 *
 * Runs on open with `force` false - the server's own TTL then makes
 * re-opening the window cheap - and with `force` true from the button, which
 * is the gesture for "I know somebody just pushed".
 * @param {Element} overlay
 * @param {boolean} force
 */
async function _checkRemote(overlay, force) {
  if (_remoteCheckInFlight) return;
  _remoteCheckInFlight = true;
  const btn = overlay.querySelector('#scm-refresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking server...'; }
  try {
    const overview = await refreshRemoteState({ force });
    if (!overview.ok) {
      if (force) showToast('error', 'Could not check the server', 'Try again in a moment.');
      return;
    }
    // The per-module rows count the same remote-ahead files, off the ref that
    // just moved - a stale module cache would keep showing 0 to fetch under a
    // repo row that now shows some.
    await refreshSyncModules({ force: true });
    _render(overlay, overview);
    // The pill paints from the data-tier-0 status cache, not from the
    // overview - and that cache was taken before the ref moved, so without
    // this the dot would only catch up on the next 60 s poll.
    await fetchDataTierStatus();
    await _repaintTopbar();
    if (!force) return;
    // A source that was skipped (not cloned, no token, busy syncing) is not a
    // failure - only a git error is.
    const failed = (overview.refreshed || []).filter((r) => r && r.ok === false && !r.skipped);
    if (failed.length) showToast('warning', 'Some sources did not answer', `Could not check all sources (${failed.length}).`);
    else showToast('success', 'Server state refreshed', '');
  } finally {
    _remoteCheckInFlight = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Check server'; }
  }
}

/** Open the sync center. Painted from cache first, then refreshed. */
export async function openSyncCenterModal() {
  const overlay = _ensureOverlay();
  openDsModal(overlay);
  _render(overlay, getSyncOverview());
  const [overview] = await Promise.all([fetchSyncOverview(), refreshSyncModules({ force: true })]);
  _render(overlay, overview);
  await _repaintTopbar();
  // Deliberately NOT awaited: this one costs a fetch per source, and the
  // table is already painted with everything the local state knows. The
  // numbers on the server side land a moment later, in the same repaint path
  // a manual check uses.
  _checkRemote(overlay, false);
}
