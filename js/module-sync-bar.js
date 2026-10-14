// -- Mission Deck - js/module-sync-bar.js ------------------------------
// The read-only sync status bar js/module-host.js injects into every module
// view whose module.json declares a non-empty dataRepos (a pure reader
// declares entries with access: 'read'; its row id is the module id). This file NEVER
// imports anything that pushes, pulls or decrypts - it answers exactly one
// question ("is what I see up to date?") and hands the person off to the
// existing "Sync" modal for every action.
//
// paintModuleSyncBar() is called (fire-and-forget, never awaited by the
// caller) from BOTH js/module-host.js adapters - the render path (every
// navigation) and the data-hook path (every cockpit:data-changed the module
// opted into) - so one function covers navigation, reload and opt-out with
// no listener of its own. It also stays subscribed to onDataChanged() itself
// for one bit: a `_dirty` flag that forces the NEXT refreshSyncModules() call,
// because js/sync-modules.js's own 30 s client memo would otherwise answer
// with the pre-sync rows on the very refresh meant to prove the sync worked.
//
// bindModuleSyncBarClicks() is bound ONCE, app-lifetime, from
// initModuleHost() - it belongs to no single view and must survive every
// _resetViewDom(), so it is deliberately NOT registered with
// runActiveViewCleanup / js/view-lifecycle.js.

import { refreshRemoteState, fetchSyncOverview, getSyncOverview } from './data-tier-0-sync.js';
import { refreshSyncModules, fetchModuleFiles } from './sync-modules.js';
import { moduleSyncBarState, uncheckedRepos, notClonedRepoIds, noTokenRepoIds } from './sync-center-helpers.js';
import { onDataChanged } from './data-events.js';
import { onInfraChanged } from './infra-events.js';
import { onSecretsChanged } from './secrets-events.js';
import { escHtml } from './utils.js';
import { showToast } from './toast.js';
import { syncFileRowHtml } from './sync-file-list.js';
import { fetchSampleModeStatus } from './sample-mode-helpers.mjs';

/** Server TTL for the remote check is 60 s; matching it client-side stops
 * hopping between two module views from costing eight status payloads a
 * second - see _repoRefreshRemote / remoteRefreshDue in server.js. */
const MSB_REMOTE_TTL_MS = 60_000;
let _lastRemoteRefreshAt = 0;

/** Set by onDataChanged(); forces the next refreshSyncModules() call so a
 * push/pull that just landed is not masked by the client-side 30 s memo. */
let _dirty = false;

/** One sequence number per viewId: a later paint (a fast re-navigation)
 * always wins over an earlier one still awaiting its fetches. */
const _seq = new Map();

/** The last refresh outcome, kept ACROSS the 60 s TTL window: a failure seen
 * 20 s ago is still the reason the numbers are stale, and an empty list on
 * the next navigation would silently turn the honest sentence back into a
 * confident "Data up to date". */
let _lastRefreshed = [];

const BTN_LABEL = 'Open Sync';

/** Sample mode is decided once per page load (entering and leaving it restart
 * the server and reload the page), so one read serves every module view. */
let _sampleActive = null;
async function _inSampleMode() {
  if (_sampleActive === null) _sampleActive = (await fetchSampleModeStatus()).active;
  return _sampleActive;
}

onDataChanged(() => { _dirty = true; });

// A failure remembered across the TTL is honest only while nothing changed:
// once the connection is back or the vault hands over new tokens, the next
// paint must check again instead of repeating "Could not check
// the server" for up to a minute.
const _forceRecheck = () => { _lastRemoteRefreshAt = 0; };
onInfraChanged(_forceRecheck);
onSecretsChanged(_forceRecheck);

/**
 * Paint the bar for one module view. Safe to call without awaiting: every
 * exit path (success, empty, error, a superseded paint) resolves, never
 * rejects.
 *
 * Two paints, not one. The remote check (`POST /api/sync-overview/refresh`,
 * a `git fetch` per source) took 2.8 s on a good connection and has a 45 s
 * per-source budget on a bad one, and the bar's skeleton used to pulse for
 * the whole of it on every page refresh - the last skeleton on the screen by
 * two seconds (measured). The FIRST paint reads what the server already
 * knows (`GET /api/sync-overview`, served from its memo, plus the per-module
 * rows) and lands in a few hundred milliseconds, labelled "Checking
 * the server…" whenever a check is about to run; the SECOND paint, after the
 * fetch, replaces it with the checked sentence. A view left before the
 * second paint is caught by the sequence check like any superseded paint.
 * @param {string} viewId
 * @param {string} moduleId
 * @returns {Promise<void>}
 */
export async function paintModuleSyncBar(viewId, moduleId) {
  const seq = (_seq.get(viewId) || 0) + 1;
  _seq.set(viewId, seq);

  try {
    // Sample mode syncs nothing, so "up to date" and "no access to Team data"
    // would both be untrue: say what is going on, offer no sync action.
    if (await _inSampleMode()) {
      const bar = document.getElementById('msb-' + viewId);
      if (bar && _seq.get(viewId) === seq) {
        bar.className = 'ds-callout ds-callout--info msb-bar';
        bar.innerHTML = '<span class="msb-text">Sample data - a fictional team. Nothing is synced.</span>';
      }
      return;
    }
    const checkDue = Date.now() - _lastRemoteRefreshAt >= MSB_REMOTE_TTL_MS;

    // Paint 1: last known state, no network to any remote. The dirty bit is
    // consumed here, so the second paint forces the per-module read only for
    // a fresh fetch (or a sync that landed while the check was running).
    const dirty = _dirty;
    _dirty = false;
    await fetchSyncOverview();
    const firstRows = await refreshSyncModules({ force: dirty });
    if (_seq.get(viewId) !== seq) return;
    _paintFromRows(viewId, moduleId, firstRows, _lastRefreshed, { checking: checkDue });
    if (!checkDue) return;

    // Paint 2: the remote check, then the checked sentence.
    _lastRemoteRefreshAt = Date.now();
    const r = await refreshRemoteState();
    const list = Array.isArray(r.refreshed) ? r.refreshed : [];
    // Only a FRESH answer may force the per-module read past its own memo -
    // a remembered one would force on every navigation for a minute.
    const fetched = list.some((x) => x && x.ok && !x.skipped);
    const refreshed = list.concat(uncheckedRepos((getSyncOverview() || {}).repos || [], r, list));
    _lastRefreshed = refreshed;

    const rows = await refreshSyncModules({ force: fetched || _dirty });
    _dirty = false;

    // A later paint for the same view already landed - this one's answer is
    // stale and must not overwrite it.
    if (_seq.get(viewId) !== seq) return;
    _paintFromRows(viewId, moduleId, rows, refreshed, { checking: false });
  } catch (e) {
    console.error('[module-sync-bar] paint failed:', e);
    if (_seq.get(viewId) !== seq) return;
    const el = document.getElementById('msb-' + viewId);
    if (el) _paint(el, 'neutral', 'Could not read the sync state.', { viewId, scopeId: moduleId, repos: [] });
  }
}

/**
 * One paint from a set of GET /api/sync-modules rows and a refresh outcome.
 * Shared by both paints above so the two cannot disagree on how a row reads.
 * @param {string} viewId
 * @param {string} moduleId
 * @param {object[]|null} rows
 * @param {object[]} refreshed
 * @param {{checking: boolean}} opts
 */
function _paintFromRows(viewId, moduleId, rows, refreshed, opts) {
  const el = document.getElementById('msb-' + viewId);
  // The view was left, or _resetViewDom() replaced the section with a fresh
  // (skeleton) copy that a newer paint owns - either way, nothing to do.
  if (!el) return;

  const overviewRepos = (getSyncOverview() || {}).repos || [];
  const labels = Object.fromEntries(overviewRepos.map((r) => [r.repo, r.label]));
  // The row id IS the module id. A module that only reads another owner's
  // files declares dataRepos[].access: 'read' and gets its own row.
  const scopeId = moduleId;
  const moduleRows = (rows || []).filter((m) => m.id === scopeId);
  const state = moduleSyncBarState(
    moduleRows,
    refreshed,
    labels,
    {
      notClonedRepos: notClonedRepoIds(overviewRepos),
      noTokenRepos: noTokenRepoIds(overviewRepos),
      checking: !!(opts && opts.checking),
    },
  );
  // Repos this module (or its mapped core scope) actually has something
  // PENDING TO SEND in - the same push side the topbar preview lists, and
  // the only thing "Details" has a per-file answer for (the fetch side
  // has no per-module file list endpoint).
  const pendingRepos = moduleRows
    .filter((r) => r && !r.unknown && Number(r.pendingFiles) > 0)
    .map((r) => r.repo);
  _paint(el, state.variant, state.text, { viewId, scopeId, repos: pendingRepos });
}

/**
 * Write one variant + sentence into the bar element, plus a "Details"
 * toggle when at least one repo has files pending to send - clicking it
 * fetches and shows the exact per-file list (path, local/on the server,
 * "newer by X h") right under the bar, same style as the previous
 * cockpit and the topbar quick preview (js/topbar-sync-preview.js). Runs
 * UNCONDITIONALLY on every path (success, empty, error) - this innerHTML
 * assignment is what drops the static data-skel="1" skeleton, so
 * js/skeleton.js's clearSkeleton is not needed here. A repaint always
 * collapses any previously open details - reopening costs one extra fetch,
 * which is cheap next to the alternative of a stale list surviving a
 * navigation that changed what is actually pending.
 * @param {Element} el
 * @param {'neutral'|'success'|'info'|'warning'} variant
 * @param {string} text
 * @param {{viewId: string, scopeId: string, repos: string[]}} scope
 */
function _paint(el, variant, text, scope) {
  el.className = 'ds-callout ds-callout--' + variant + ' msb-bar';
  const canExpand = scope.repos.length > 0;
  el.innerHTML = '<span class="msb-text">' + escHtml(text) + '</span>'
    + '<div class="msb-actions">'
    + (canExpand
      ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-msb-act="toggle-details"'
        + ' data-msb-view="' + escHtml(scope.viewId) + '" data-msb-scope="' + escHtml(scope.scopeId) + '"'
        + ' data-msb-repos="' + escHtml(scope.repos.join(',')) + '" aria-expanded="false">Details</button>'
      : '')
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-msb-act="open-sync">'
    + escHtml(BTN_LABEL) + '</button>'
    + '</div>'
    + '<div class="msb-details" hidden></div>';
}

/**
 * Fetches (once per open) and renders the per-file list for one module's
 * pending repos into its `.msb-details` container - one `<div class="tsp-
 * list">` section per repo when the module spans more than one, otherwise a
 * flat list, same convention as the topbar preview's single-repo case.
 * @param {Element} btn the clicked "Details" button
 * @returns {Promise<void>}
 */
async function _toggleDetails(btn) {
  const bar = btn.closest('.msb-bar');
  const details = bar && bar.querySelector('.msb-details');
  if (!details) return;

  const expanded = btn.getAttribute('aria-expanded') === 'true';
  if (expanded) {
    details.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    return;
  }
  btn.setAttribute('aria-expanded', 'true');
  details.hidden = false;

  if (details.dataset.loaded === '1') return;
  details.innerHTML = '<div class="tsp-loading">Loading...</div>';

  const scopeId = btn.dataset.msbScope;
  const repoIds = (btn.dataset.msbRepos || '').split(',').filter(Boolean);
  const overviewRepos = (getSyncOverview() || {}).repos || [];
  const labels = Object.fromEntries(overviewRepos.map((r) => [r.repo, r.label]));
  const multi = repoIds.length > 1;

  try {
    const sections = [];
    for (const repoId of repoIds) {
      const res = await fetchModuleFiles(repoId, scopeId);
      if (!res || !res.ok || !Array.isArray(res.files) || res.files.length === 0) continue;
      const heading = multi ? '<div class="tsp-header">' + escHtml(labels[repoId] || repoId) + '</div>' : '';
      const more = res.truncated
        ? '<div class="tsp-more">and more - the full list is in the Sync window.</div>' : '';
      sections.push(heading + '<div class="tsp-list">' + res.files.map(syncFileRowHtml).join('') + '</div>' + more);
    }
    // Closed again, or a newer paint already replaced this bar, while the
    // fetch was in flight.
    if (details.hidden || !details.isConnected) return;
    details.innerHTML = sections.length
      ? sections.join('')
      : '<div class="tsp-empty">No files to show.</div>';
    details.dataset.loaded = '1';
  } catch (e) {
    console.error('[module-sync-bar] details fetch failed:', e);
    if (!details.isConnected) return;
    details.innerHTML = '<div class="tsp-empty">Could not load the file list.</div>';
  }
}

let _bound = false;

/**
 * Bind the bar's actions once, app-lifetime: "Open Sync" and the
 * "Details" per-file toggle. Same dynamic-import shape as js/topbar.js's
 * own sync button, so the modal's markup stays out of the boot path either
 * way it is opened.
 * @returns {void}
 */
export function bindModuleSyncBarClicks() {
  if (_bound) return;
  _bound = true;
  document.addEventListener('click', async (ev) => {
    const detailsBtn = ev.target.closest('[data-msb-act="toggle-details"]');
    if (detailsBtn) { await _toggleDetails(detailsBtn); return; }

    const btn = ev.target.closest('[data-msb-act="open-sync"]');
    if (!btn) return;
    try {
      const { openSyncCenterModal } = await import('./sync-center-modal.js');
      await openSyncCenterModal();
    } catch (e) {
      console.error('[module-sync-bar] sync center failed to open:', e);
      showToast('warning', 'Could not open Sync', 'Reload the page and try again.');
    }
  });
}
