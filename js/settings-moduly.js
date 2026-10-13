// ── Mission Deck — js/settings-moduly.js ───────────────────────────────────
// Renders the "Modules" tab in #view-settings: one TABLE row per installed
// module (enable/disable, export, publish, remove, plus a details modal), a
// block for broken modules under it, and the upload-from-file flow. A table
// rather than a card grid because this list is meant to grow: with dozens of
// modules a grid of tall boxes stops being scannable, so a row carries only
// what a person scans and acts on and the rest lives in the modal.
// Exports: renderModulySection({ onRestart, fresh, refresh }), refreshModulyAttention(). Rows are grouped by
// their place in the menu (js/module-menu-groups.mjs); `fresh` marks an entry
// to the tab and collapses every group again.
// Called from js/settings.js renderSettingsView() — fire-and-forget.
//
// Deliberately one-way: nothing here imports from js/settings.js (that would
// create an import cycle settings -> moduly -> settings), so restart handling
// arrives as the onRestart argument instead.

import { showToast } from './toast.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { escHtml, normalizeSearch } from './utils.js';
import { emptyHeroHtml } from './empty-state.js';
import { installFromCatalog, renderModulesCatalogSection } from './settings-moduly-katalog.js';
import { moduleAttention } from './module-attention.mjs';
import { areaOptions, filterRows, nextFilterState } from './module-filter.mjs';
import { createAreaSelectLifecycle, requestModuleArea } from './module-area-modal.js';
import { applyMenuGroups, groupRowsByMenu, renderMenuGroup } from './module-menu-groups.mjs';
import {
  areaInputError,
  areaSuggestions,
  areaFilterKey,
  moduleArea,
  renderAreaBadge,
  moduleSearchText,
  pluralZmiany,
  renderDetailsButton,
  renderGitHistory,
  renderGitHistoryError,
  renderMaturityBadge,
  renderModuleDetailsBody,
  renderModuleNameCell,
  renderOriginLine,
  renderShapeBadge,
  renderStatusBadge,
} from './module-card.mjs';

// Remembers the onRestart callback across re-renders triggered from inside
// this module (toggle/remove/import all re-call renderModulySection()).
let _lastOnRestart = null;

// The search box's text, kept across re-renders (toggle/remove/import all
// rebuild the grid) so a filtered list stays filtered after an action.
let _query = '';
let _area = '';
let _filterData = [];
const _areaSelectLifecycle = createAreaSelectLifecycle('[data-moduly-area-input]');

// Menu groups the person expanded. Kept across the re-renders this file
// triggers itself (toggle/remove/import), emptied on every entry to the tab
// (`fresh`), so the table always opens collapsed.
const _openGroups = new Set();

// Set by a successful publish from this tab: the next read of the open
// publish MRs bypasses the server's 60 s cache, so the module just published
// moves to "Awaiting merge" at once.
let _forcePending = false;

// Set after a publish or a version bump: the next drift read (files changed at
// an equal version) bypasses the server cache too.
let _forceDrift = false;

// Last answer of GET /api/modules/publish-drift and the request in flight.
let _lastDrift = [];
// How many modules the last drift scan could not check (their tree read failed).
let _driftFailed = 0;
let _driftPending = null;

// Set by an update run from the "Need updating" list: the new code is
// on disk but not loaded, and enabled/active ids alone cannot see that.
let _restartAfterUpdate = false;

// How long the FIRST paint on entering the tab waits for the catalog before
// drawing the table without the two to-do lists (they paint in when the
// answer lands). Re-renders after an action never wait: they repaint the
// lists at once from the FRESH disk scan against the last known catalog and
// MR answer (_lastSources), then again when the fresh answer arrives - so a
// slow GitLab never holds a toggle or a remove hostage, and a version bump
// turns its row into "Newer version locally" with a live "Publish" the
// moment module.json changes (a forced catalog crawl takes ~9 s).
const ATTENTION_WAIT_MS = 4000;
let _lastSources = null;

// Snapshot of the last GET /api/modules/installed answer, keyed by id, so the
// remove and overwrite modals can read a module's git state without a second
// fetch. Goes stale between renders like every other cached read here - the
// 409 module-dirty guard on the server is what makes that safe.
let _installedById = new Map();

// Top-level gitAvailable from the same payload - one flag for the whole tab,
// read by every git row.
let _gitAvailable = false;

// ── Rendering ─────────────────────────────────────────────────────────────────
// Every section of the card comes from js/module-card.mjs, which the catalog
// card imports too - the two cards describe the same module.json, so they
// cannot show two different pictures of one module.

// The order the server answers in is the order of the directory listing;
// with dozens of modules a person needs one they can predict, so rows are
// sorted by the name the row shows. locale-aware collation, so an accented letter sorts
// next to its base letter and not at the end of the alphabet.
function _byModuleName(a, b) {
  const an = (a.manifest && a.manifest.name) || a.id || '';
  const bn = (b.manifest && b.manifest.name) || b.id || '';
  return an.localeCompare(bn, 'en');
}

// The header of the installed table. Six columns, and the count is what the
// broken-module block below the table does NOT have to match - it is a block,
// not a row, precisely because a danger callout with a list of errors does not
// fit a cell.
function _renderTableHead() {
  return `<thead>
      <tr>
        <th>Module</th>
        <th>Version</th>
        <th>Status</th>
        <th>Area</th>
        <th>Menu placement</th>
        <th class="right">Actions</th>
      </tr>
    </thead>`;
}

// One row per installed module. Only what a person scans and acts on; the
// description, author, origin, capabilities, tags, views, declarations and the
// local git repository live in the details modal (renderModuleDetailsBody),
// which the same js/module-card.mjs renders for the catalog list too.
function _renderModuleRow(item) {
  const { id, manifest, enabled } = item;
  const toggleLabel = enabled ? 'Disable' : 'Enable';

  return `
    <tr class="moduly-row" data-module-id="${escHtml(id)}" data-moduly-area="${escHtml(areaFilterKey(moduleArea(manifest)))}" data-moduly-search="${escHtml(moduleSearchText(manifest, { id }))}">
      <td>${renderModuleNameCell(manifest, { id, iconModuleId: id })}</td>
      <td class="moduly-cell-version">${escHtml(manifest.version || '?')}</td>
      <td><span class="moduly-cell-badges">${renderStatusBadge(enabled)}${renderMaturityBadge(manifest.status)}</span></td>
      <td><span class="moduly-cell-badges">${renderAreaBadge(moduleArea(manifest))}</span></td>
      <td><span class="moduly-cell-badges">${renderShapeBadge(manifest)}</span></td>
      <td class="right">
        <span class="moduly-row-actions">
          ${renderDetailsButton(id, 'moduly-details')}
          <button type="button" class="ds-icon-btn ds-icon-btn--sm" data-tip="${toggleLabel}" aria-label="${toggleLabel}" data-moduly-toggle="${escHtml(id)}" data-moduly-enabled="${enabled ? '1' : '0'}"><span class="moduly-action-ico moduly-action-ico--${enabled ? 'pause' : 'play'}" aria-hidden="true"></span></button>
          <button type="button" class="ds-icon-btn ds-icon-btn--sm" data-tip="Export" aria-label="Export" data-moduly-export="${escHtml(id)}"><span class="moduly-action-ico moduly-action-ico--download" aria-hidden="true"></span></button>
          <button type="button" class="ds-icon-btn ds-icon-btn--sm" data-tip="Publish" aria-label="Publish" data-moduly-publish="${escHtml(id)}"><span class="moduly-action-ico moduly-action-ico--upload" aria-hidden="true"></span></button>
          <button type="button" class="ds-icon-btn ds-icon-btn--sm moduly-action--danger" data-tip="Remove" aria-label="Remove" data-moduly-remove="${escHtml(id)}"><span class="moduly-action-ico moduly-action-ico--trash" aria-hidden="true"></span></button>
        </span>
      </td>
    </tr>`;
}

// A module that did not load has no manifest, so it stays a card below the
// six-column table. It keeps its
// data-moduly-search attribute, so the search box counts and filters it just
// like a row.
function _renderInvalidCard(entry) {
  const errs = Array.isArray(entry.errors) ? entry.errors : [String(entry.error || 'unknown error')];
  return `
    <article class="ds-card moduly-card moduly-card--invalid" data-module-id="${escHtml(entry.id)}" data-moduly-area="" data-moduly-search="${escHtml(normalizeSearch(entry.id))}">
      <div class="moduly-card-head">
        <strong>${escHtml(entry.id)}</strong>
        <span class="ds-badge ds-badge--red">Broken</span>
      </div>
      <div class="ds-callout ds-callout--danger">
        <div>
          <p>This add-on did not load — the folder <code>modules/${escHtml(entry.id)}/</code> is unreadable or its manifest is invalid:</p>
          <ul>${errs.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul>
        </div>
      </div>
    </article>`;
}

function _restartRequired(installed, activeIds) {
  const enabledOnDisk = installed.filter(m => m.enabled).map(m => m.id);
  const activeSet = new Set(activeIds);
  const diskSet = new Set(enabledOnDisk);
  const waitingToLoad = enabledOnDisk.some(id => !activeSet.has(id));
  const stillActive = activeIds.some(id => !diskSet.has(id));
  return waitingToLoad || stillActive;
}

function _renderRestartCallout() {
  return `
    <div class="ds-callout ds-callout--warning moduly-restart-callout">
      <div>A module change needs a server restart to take effect.</div>
      <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-moduly-restart>Restart now</button>
    </div>`;
}

function _renderHiddenFileInput() {
  return '<input type="file" accept=".zip" hidden data-moduly-file-input>';
}

// Section header: the title on the left, the one upload button on the right -
// the same row the Catalog section draws, so the two halves of the tab read
// as siblings.
function _renderSectionHead() {
  return `
    <div class="moduly-section-head">
      <h3 class="moduly-section-title">Installed</h3>
      <span class="moduly-section-actions">
        <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-moduly-refresh>Refresh</button>
        <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-moduly-upload-trigger>Upload from file</button>
      </span>
    </div>`;
}

function _renderSearchRow() {
  return `
    <div class="moduly-search-row">
      <input type="search" class="ds-input moduly-search" value="${escHtml(_query)}" placeholder="Search modules by name, id, author or tag..." aria-label="Search installed modules" autocomplete="off" data-moduly-search-input>
      <div class="moduly-area-select">
        <select class="ds-input moduly-area-select" aria-label="Area of installed modules" data-moduly-area-input>
          ${areaOptions(_filterData).map(option => `<option value="${escHtml(option.value)}"${option.value === _area ? ' selected' : ''}>${escHtml(option.label)}</option>`).join('')}
        </select>
      </div>
      <span class="moduly-search-count" data-moduly-search-count aria-live="polite"></span>
    </div>`;
}

// Filters the card grid in place: a card whose haystack misses any word of
// the query is hidden, the counter says how many stay, and an empty result
// shows one sentence instead of a blank grid.
function _applyFilter(root) {
  const cards = [...root.querySelectorAll('[data-moduly-search]')]
    .map(card => ({ card, area: card.dataset.modulyArea, search: card.dataset.modulySearch }));
  const { rows, visible, total } = filterRows(cards, { query: _query, area: _area });
  const shown = new Set(rows);
  cards.forEach(row => { row.card.hidden = !shown.has(row); });
  const count = root.querySelector('[data-moduly-search-count]');
  if (count) count.textContent = _query.trim() || _area ? `${visible} z ${total}` : `${total}`;
  const empty = root.querySelector('[data-moduly-search-empty]');
  if (empty) empty.hidden = visible > 0 || cards.length === 0;
  applyMenuGroups(root, { filtering: !!(_query.trim() || _area), openKeys: _openGroups });
}

// ── To do: publishing and updating ────────────────────────────────────────────
// Two short lists above the menu-grouped table (js/module-attention.mjs
// decides who is on them). Each row carries ONE action; everything else about
// the module stays in the table below.

/** Catalog entries (or null when the catalog cannot be read) plus open publish MRs. */
async function _fetchAttentionSources({ force = false } = {}) {
  const forcePending = force || _forcePending;
  _forcePending = false;
  const forceDrift = force || _forceDrift;
  _forceDrift = false;
  const read = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
  // The drift read walks one catalog tree per module (seconds on a cold
  // cache), so it never holds the two lists back: they paint with the last
  // known drift, and _settleDrift repaints them when this answer lands.
  _driftPending = read('/api/modules/publish-drift' + (forceDrift ? '?force=1' : ''))
    .then(drift => {
      if (!drift || !Array.isArray(drift.items)) return _lastDrift;
      const failed = Array.isArray(drift.failed) ? drift.failed : [];
      // A whole-scan failure (catalog unreadable) keeps the last answer; a
      // module whose own tree read failed keeps ITS last answer, so a
      // transient GitLab error never silently clears a flag.
      if (drift.error && !drift.items.length && !failed.length) return _lastDrift;
      const kept = _lastDrift.filter(d => failed.includes(d.id));
      _lastDrift = [...drift.items, ...kept];
      _driftFailed = failed.length;
      // The scan committed modules whose "unsaved changes" were already the
      // catalog's: the installed list read before it still shows them dirty.
      // One re-render; the server never repeats `reconciled` from its cache.
      if (Array.isArray(drift.reconciled) && drift.reconciled.length
        && document.querySelector('#settings-moduly-installed [data-moduly-attention]')) {
        setTimeout(() => { renderModulySection({ onRestart: _lastOnRestart }).catch(() => {}); }, 0);
      }
      return _lastDrift;
    });
  const [catalogFirst, pending] = await Promise.all([
    read('/api/modules/catalog' + (force ? '?force=1' : '')),
    read('/api/modules/pending-publishes' + (forcePending ? '?force=1' : '')),
  ]);
  // A publish MR was merged after the catalog snapshot: the MR has left the
  // open list, the cached catalog still has the old version, and together
  // they would put the module back on "Need publishing". The server has
  // already dropped its snapshot; read `main` again before painting.
  const catalog = pending && pending.catalogStale && !force
    ? await read('/api/modules/catalog?force=1')
    : catalogFirst;
  const entries = catalog && catalog.ok !== false && Array.isArray(catalog.entries) ? catalog.entries : null;
  // A failed MR read is "unknown", not "none open": keep the last known list,
  // or a module published a moment ago would offer "Publish" again.
  const items = pending && Array.isArray(pending.items) && !pending.error
    ? pending.items
    : (_lastSources ? _lastSources.pending : []);
  return { entries, pending: items, drift: _lastDrift };
}

function _attentionVersion(local, catalog) {
  if (!catalog) return `${escHtml(local || '?')} <span class="moduly-attention-muted">· not in the catalog</span>`;
  return `${escHtml(local || '?')} <span class="moduly-attention-muted">· in the catalog ${escHtml(catalog)}</span>`;
}

/** "3 changed, 1 new" - what a same-version module changed, for its badge tooltip. */
function _driftSummary(drift) {
  const parts = [];
  if (drift && drift.changed) parts.push(`changed: ${drift.changed}`);
  if (drift && drift.added) parts.push(`new: ${drift.added}`);
  if (drift && drift.removed) parts.push(`removed: ${drift.removed}`);
  const files = drift && Array.isArray(drift.paths) && drift.paths.length ? ' (' + drift.paths.join(', ') + ')' : '';
  return 'Files differ from the catalog - ' + (parts.join(', ') || 'no details') + files;
}

function _publishVersionCell(row) {
  if (row.reason !== 'same-version') return _attentionVersion(row.localVersion, row.catalogVersion);
  const bump = row.nextVersion
    ? ` <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm moduly-attention-bump" data-moduly-bump="${escHtml(row.id)}">Bump to ${escHtml(row.nextVersion)}</button>`
    : '';
  return `<span class="moduly-attention-version">${escHtml(row.localVersion || '?')} <span class="moduly-attention-muted">· same in the catalog</span>${bump}</span>`;
}

function _renderPublishRow(row) {
  const reasonBadge = row.waiting
    ? '<span class="ds-badge ds-badge--blue">Awaiting merge</span>'
    : row.reason === 'local'
      ? '<span class="ds-badge ds-badge--amber">Unpublished</span>'
      : row.reason === 'same-version'
        ? `<span class="ds-badge ds-badge--amber" data-tip="${escHtml(_driftSummary(row.drift))}">Changes without a new version</span>`
        : '<span class="ds-badge ds-badge--mandarine">Newer version locally</span>';
  // An open MR with a different version than the local one: the row still
  // asks for a publish and only points at that MR.
  const otherMr = !row.waiting && row.mrUrl
    ? ` <a class="moduly-attention-mr" href="${escHtml(row.mrUrl)}" target="_blank" rel="noopener">open MR${row.mrVersion ? ' with version ' + escHtml(row.mrVersion) : ''}</a>`
    : '';
  const reason = reasonBadge + otherMr;
  const action = row.waiting
    ? (row.mrUrl ? `<a class="ds-btn ds-btn--secondary ds-btn--sm" href="${escHtml(row.mrUrl)}" target="_blank" rel="noopener">Open MR</a>` : '')
    : row.reason === 'same-version'
      ? '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" disabled title="Bump the version first - the catalog already has this one.">Publish</button>'
      : `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-moduly-publish="${escHtml(row.id)}">Publish</button>`;
  return `<tr class="moduly-row">
      <td>${renderModuleNameCell(row.item.manifest || {}, { id: row.id, iconModuleId: row.id })}</td>
      <td class="moduly-cell-version">${_publishVersionCell(row)}</td>
      <td><span class="moduly-cell-badges">${reason}</span></td>
      <td class="right">${action}</td>
    </tr>`;
}

function _renderUpdateRow(row) {
  return `<tr class="moduly-row">
      <td>${renderModuleNameCell(row.item.manifest || {}, { id: row.id, iconModuleId: row.id })}</td>
      <td class="moduly-cell-version">${_attentionVersion(row.localVersion, row.catalogVersion)}</td>
      <td><span class="moduly-cell-badges"><span class="ds-badge ds-badge--blue">Available ${escHtml(row.catalogVersion)}</span></span></td>
      <td class="right"><button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-moduly-attn-update="${escHtml(row.id)}">Update</button></td>
    </tr>`;
}

function _renderAttentionList(title, hint, rows, renderRow) {
  return `<section class="moduly-attention" aria-label="${escHtml(title)}">
      <h4 class="moduly-attention-title">${escHtml(title)} <span class="ds-badge ds-badge--gray">${rows.length}</span></h4>
      <p class="moduly-attention-hint">${escHtml(hint)}</p>
      <div class="ds-table-wrap moduly-table-wrap"><table class="ds-table moduly-table moduly-attention-table">
        <thead><tr><th>Module</th><th>Version</th><th>State</th><th class="right">Action</th></tr></thead>
        <tbody>${rows.map(renderRow).join('')}</tbody>
      </table></div>
    </section>`;
}

/**
 * The two lists, or one reassuring line when both are empty, or one muted
 * line with a retry when the catalog cannot be read (no token, VPN down, a
 * cold cache right after a restart) - the Catalog section below says why.
 * @param {ReturnType<typeof moduleAttention>} att
 */
function _renderAttention(att) {
  if (!att.catalogKnown) {
    return '<p class="moduly-attention-hint">Could not compare modules with the catalog, so it is unknown which need publishing or updating. '
      + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-moduly-attn-retry>Check again</button></p>';
  }
  if (!att.publish.length && !att.update.length) {
    return '<p class="moduly-attention-ok">All modules are published and up to date.</p>';
  }
  return (att.publish.length ? _renderAttentionList('Need publishing',
    'Modules missing from the catalog, with a higher version here, or with changed files at the same version.', att.publish, _renderPublishRow) : '')
    + (att.update.length ? _renderAttentionList('Need updating',
      'The catalog has a newer version than the installed one.', att.update, _renderUpdateRow) : '');
}

/**
 * @param {Element} root the section's `.moduly-inner`
 * @param {Promise<void>} [mounted] resolves once `root` is in the page; a
 *   late answer waits for it instead of being dropped by the isConnected
 *   check while the section is still being built
 */
/** One line under the lists when the last drift scan could not check some modules. */
function _renderDriftFailed() {
  if (!_driftFailed) return '';
  return `<p class="moduly-attention-hint">Could not check file changes for ${_driftFailed} ${_driftFailed === 1 ? 'module' : 'modules'} - showing the last known result. Click "Refresh" to try again.</p>`;
}

function _paintAttention(root, installed, sources, mounted = Promise.resolve()) {
  const slot = root.querySelector('[data-moduly-attention]');
  if (!slot) return;
  const inFlight = _driftPending;
  if (inFlight) {
    Promise.all([inFlight, mounted]).then(([drift]) => {
      if (inFlight !== _driftPending || !root.isConnected || drift === sources.drift) return;
      _paintAttention(root, installed, { ...sources, drift });
    });
  }
  const att = moduleAttention(installed, sources.entries, sources.pending, sources.drift);
  if (att.catalogKnown) _lastSources = { entries: sources.entries, pending: sources.pending };
  slot.innerHTML = _renderAttention(att) + (att.catalogKnown ? _renderDriftFailed() : '');
}

/**
 * Re-reads the catalog and the open publish MRs and repaints the two to-do
 * lists in place. Called by js/settings.js after a vault unlock: the lists
 * depend on COCKPIT_MODULES_TOKEN, so the unlock can change them while the
 * rest of the Installed table (read off the disk) cannot.
 */
export async function refreshModulyAttention() {
  const root = document.querySelector('#settings-moduly-installed .moduly-inner');
  if (!root || !root.querySelector('[data-moduly-attention]')) return;
  const sources = await _fetchAttentionSources();
  if (root.isConnected) _paintAttention(root, [..._installedById.values()], sources);
}

/** GET /api/modules/installed, parsed. Rejects on a non-2xx answer so the
 * caller's error callout keeps its status code. */
async function _fetchInstalled() {
  const res = await fetch(`/api/modules/installed?t=${Date.now()}`);
  if (!res.ok) throw new Error('/api/modules/installed: ' + res.status);
  return res.json();
}

// ── Public export ─────────────────────────────────────────────────────────────

export async function renderModulySection({ onRestart, fresh = false, refresh = false } = {}) {
  _lastOnRestart = onRestart || _lastOnRestart;
  if (fresh) _openGroups.clear();

  // ONE request for the installed list, shared with the catalog section: the
  // endpoint probes every module's git repository, and the catalog needs the
  // same body only to read versions off it. Started first so it overlaps with
  // everything below; the catalog gets the promise, this function awaits it.
  const installedPayload = _fetchInstalled();
  // `refresh` (the "Refresh" button) bypasses both server caches, so the
  // statuses really are re-read from GitLab and not replayed.
  const attentionSources = _fetchAttentionSources({ force: refresh });

  // Fire-and-forget: the catalog section reads from GitLab and must never
  // make the "Installed" section (below) wait for it.
  renderModulesCatalogSection({ onRestart, installedPayload, fresh }).catch(e => console.error('[settings] moduly-katalog:', e));

  const slot = document.getElementById('settings-moduly-installed');
  if (!slot) return;

  // Same rule as the Agents and Skills slots: the skeleton from index.html
  // (or the previous card grid) stays until the real list replaces it.

  let data;
  try {
    data = await installedPayload;
  } catch (err) {
    await _areaSelectLifecycle.prepare(slot);
    slot.innerHTML = `<div class="ds-callout ds-callout--danger"><div>Could not load the module list: ${escHtml(err.message)}</div></div>`;
    return;
  }

  const installed = Array.isArray(data.installed) ? data.installed : [];
  const invalid = Array.isArray(data.invalid) ? data.invalid : [];
  const activeIds = Array.isArray(data.activeIds) ? data.activeIds : [];

  _installedById = new Map(installed.map(m => [m.id, m]));
  _gitAvailable = data.gitAvailable === true;
  _filterData = [
    ...installed.map(item => ({ area: moduleArea(item.manifest) })),
    ...invalid.map(() => ({ area: '' })),
  ];
  ({ query: _query, area: _area } = nextFilterState({ query: _query, area: _area }, _filterData));

  const inner = document.createElement('div');
  inner.className = 'moduly-inner';

  if (installed.length === 0 && invalid.length === 0) {
    // The empty-hero CTA mechanism is intentionally unused here — one visible
    // upload button, wired by this file, not two competing upload paths.
    // No search box here: there is nothing to search through yet.
    inner.innerHTML = _renderSectionHead()
      + emptyHeroHtml({
        title: 'No modules installed',
        message: 'Copy modules-template/ to modules/<id>/ by hand, or upload a ready zip file.',
      })
      + _renderHiddenFileInput();
  } else {
    const rows = installed.slice().sort(_byModuleName);
    const table = rows.length
      ? '<div class="ds-table-wrap moduly-table-wrap"><table class="ds-table moduly-table">'
        + _renderTableHead()
        + groupRowsByMenu(rows, m => m.manifest)
          .map(group => renderMenuGroup(group, { scope: 'moduly', colspan: 6, renderRow: _renderModuleRow })).join('')
        + '</table></div>'
      : '';
    const broken = invalid.length
      ? '<div class="moduly-invalid-list">' + invalid.map(_renderInvalidCard).join('') + '</div>'
      : '';
    inner.innerHTML =
      ((_restartAfterUpdate || _restartRequired(installed, activeIds)) ? _renderRestartCallout() : '')
      + _renderSectionHead()
      + '<div class="moduly-attention-slot" data-moduly-attention></div>'
      + _renderSearchRow()
      + _renderHiddenFileInput()
      + table
      + broken
      + '<p class="sett-empty-hint" data-moduly-search-empty hidden>No installed module matches the selected filters.</p>';
  }

  // The two to-do lists sit ABOVE the table, so they are painted before the
  // table is shown whenever the catalog answers within ATTENTION_WAIT_MS -
  // a list landing later pushes the table down once, never on a warm cache.
  let markMounted;
  const mounted = new Promise(resolve => { markMounted = resolve; });
  const timedOut = Symbol('timeout');
  const early = fresh || refresh
    ? await Promise.race([
      attentionSources,
      new Promise(resolve => setTimeout(() => resolve(timedOut), ATTENTION_WAIT_MS)),
    ])
    : timedOut;
  if (early !== timedOut) {
    _paintAttention(inner, installed, early, mounted);
  } else {
    if (_lastSources) _paintAttention(inner, installed, { ..._lastSources, drift: _lastDrift }, mounted);
    Promise.all([attentionSources, mounted]).then(([src]) => {
      if (inner.isConnected) _paintAttention(inner, installed, src);
    });
  }

  const { initSelect } = await _areaSelectLifecycle.prepare(slot);
  slot.innerHTML = '';
  slot.appendChild(inner);
  markMounted();

  inner.addEventListener('click', _handleClick);
  const fileInput = inner.querySelector('[data-moduly-file-input]');
  if (fileInput) fileInput.addEventListener('change', _handleFileChange);
  const search = inner.querySelector('[data-moduly-search-input]');
  const areaSelect = inner.querySelector('[data-moduly-area-input]');
  if (areaSelect) {
    initSelect(areaSelect);
    areaSelect.parentElement.querySelector('.ds-sel-trigger').setAttribute('aria-label', 'Area of installed modules');
    const onAreaChange = () => { _area = areaSelect.value; _applyFilter(inner); };
    _areaSelectLifecycle.bind(areaSelect, onAreaChange);
  }
  if (search) {
    search.addEventListener('input', () => { _query = search.value; _applyFilter(inner); });
    _applyFilter(inner);
  }
}

// ── Click delegation ──────────────────────────────────────────────────────────

async function _handleClick(e) {
  const uploadTrigger = e.target.closest('[data-moduly-upload-trigger]');
  if (uploadTrigger) {
    const input = document.querySelector('#settings-moduly-installed [data-moduly-file-input]');
    if (input) input.click();
    return;
  }

  const groupToggle = e.target.closest('[data-menu-group-toggle]');
  if (groupToggle) {
    const key = groupToggle.dataset.menuGroupToggle;
    if (groupToggle.getAttribute('aria-expanded') === 'true') _openGroups.delete(key); else _openGroups.add(key);
    // While a filter is on every matching group is open; a click there
    // records the choice for after the filter is cleared and flips the group
    // now, so the click is never a no-op.
    const body = e.currentTarget.querySelector(`[data-menu-group-body="${CSS.escape(key)}"]`);
    if (body) {
      body.hidden = !body.hidden;
      groupToggle.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
    }
    return;
  }

  const refreshBtn = e.target.closest('[data-moduly-refresh]');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    try {
      await renderModulySection({ onRestart: _lastOnRestart, refresh: true });
    } finally {
      refreshBtn.disabled = false;
    }
    return;
  }

  const bumpBtn = e.target.closest('[data-moduly-bump]');
  if (bumpBtn) {
    bumpBtn.disabled = true;
    try {
      const res = await fetch('/api/modules/bump-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bumpBtn.dataset.modulyBump }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast('danger', 'Version not bumped', data.message || data.error || 'Unknown server error');
        return;
      }
      showToast('success', 'Version bumped', `${data.from} → ${data.to}. You can now publish the module.`);
      // No forced re-read: the new version is on disk, the catalog did not
      // move, and the server already dropped its drift cache. A plain render
      // repaints the row from the fresh disk scan straight away.
      await renderModulySection({ onRestart: _lastOnRestart });
    } finally {
      bumpBtn.disabled = false;
    }
    return;
  }

  const attnRetry = e.target.closest('[data-moduly-attn-retry]');
  if (attnRetry) {
    attnRetry.disabled = true;
    const root = e.currentTarget;
    _paintAttention(root, [..._installedById.values()], await _fetchAttentionSources({ force: true }));
    return;
  }

  const attnUpdate = e.target.closest('[data-moduly-attn-update]');
  if (attnUpdate) {
    attnUpdate.disabled = true;
    try {
      if (await installFromCatalog(attnUpdate.dataset.modulyAttnUpdate, { overwrite: true })) {
        _restartAfterUpdate = true;
        await renderModulySection({ onRestart: _lastOnRestart });
      }
    } finally {
      attnUpdate.disabled = false;
    }
    return;
  }

  const restartBtn = e.target.closest('[data-moduly-restart]');
  if (restartBtn) {
    if (typeof _lastOnRestart === 'function') _lastOnRestart(restartBtn);
    return;
  }

  const detailsBtn = e.target.closest('[data-moduly-details]');
  if (detailsBtn) { _openDetailsModal(detailsBtn.dataset.modulyDetails); return; }

  const toggleBtn = e.target.closest('[data-moduly-toggle]');
  if (toggleBtn) { await _handleToggle(toggleBtn); return; }

  const exportBtn = e.target.closest('[data-moduly-export]');
  if (exportBtn) { _handleExport(exportBtn.dataset.modulyExport); return; }

  const publishBtn = e.target.closest('[data-moduly-publish]');
  if (publishBtn) { _openPublishModal(publishBtn.dataset.modulyPublish); return; }

  const removeBtn = e.target.closest('[data-moduly-remove]');
  if (removeBtn) { _openRemoveModal(removeBtn.dataset.modulyRemove); return; }

  const gitInitBtn = e.target.closest('[data-moduly-git-init]');
  if (gitInitBtn) { await _handleGitInit(gitInitBtn); return; }

  const gitCommitBtn = e.target.closest('[data-moduly-git-commit]');
  if (gitCommitBtn) { _openCommitModal(gitCommitBtn.dataset.modulyGitCommit); return; }

  const gitLogBtn = e.target.closest('[data-moduly-git-log]');
  if (gitLogBtn) { await _toggleGitHistory(gitLogBtn); }
}

// ── Details modal ─────────────────────────────────────────────────────────────
// Everything the row deliberately leaves out. Rendered by the shared
// renderModuleDetailsBody, so the installed modal and the catalog modal are
// one thing described twice, never two descriptions of one module.

function _openDetailsModal(id) {
  const item = _installedById.get(id);
  if (!item) return;
  const manifest = item.manifest || {};

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true" aria-labelledby="mod-det-title">
      <div class="ds-modal-header">
        <span class="ds-modal-title" id="mod-det-title">Module details</span>
        <button type="button" class="ds-modal-close" data-det-close aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body moduly-detail-body">${renderModuleDetailsBody(manifest, {
    id,
    iconModuleId: id,
    origin: item.origin || null,
    git: item.git || { present: false },
    gitAvailable: _gitAvailable,
  })}</div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--tertiary" data-det-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { closeDsModal(overlay); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelectorAll('[data-det-close]').forEach(b => b.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // The git block in the body carries the same data attributes the card used,
  // and the section's delegation sits on `inner` - the modal is mounted on
  // document.body, outside it, so without this line "Initialize repository",
  // "Save version" and "History" would silently do nothing. The two that
  // re-render the whole section close the modal FIRST, because it would
  // otherwise stay open over a list it no longer matches. Registered before
  // the delegation, so it runs before it.
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('[data-moduly-git-init]') || e.target.closest('[data-moduly-git-commit]')) close();
  });
  overlay.addEventListener('click', _handleClick);

  openDsModal(overlay);
}

// ── Git: history ("History") ─────────────────────────────────────────────────

/**
 * Expands or collapses the earlier-commits list under a card's "last save"
 * line. The log is fetched on the FIRST open only and kept in the container
 * until the card re-renders (every commit re-renders the whole section, so a
 * stale list cannot survive a "Save version").
 * @param {HTMLButtonElement} btn the [data-moduly-git-log] toggle
 */
async function _toggleGitHistory(btn) {
  const id = btn.dataset.modulyGitLog;
  const root = btn.closest('.moduly-card-git');
  const box = root ? root.querySelector('[data-moduly-git-history]') : null;
  if (!box) return;

  const expanded = btn.getAttribute('aria-expanded') === 'true';
  if (expanded) {
    box.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'History';
    return;
  }

  if (!box.dataset.loaded) {
    btn.disabled = true;
    try {
      const res = await fetch(`/api/modules/git-log?id=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        box.innerHTML = renderGitHistoryError(data.message || data.error || 'Unknown server error');
      } else {
        box.innerHTML = renderGitHistory(data.commits, { skipSha7: btn.dataset.modulyGitLastSha });
        box.dataset.loaded = '1';
      }
    } catch (err) {
      box.innerHTML = renderGitHistoryError(err.message);
    } finally {
      btn.disabled = false;
    }
  }
  box.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = 'Hide history';
}

// ── Git: init ─────────────────────────────────────────────────────────────────

async function _handleGitInit(btn) {
  const id = btn.dataset.modulyGitInit;
  btn.disabled = true;
  try {
    const res = await fetch('/api/modules/git-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const message = data.message || data.error || 'Unknown server error';
      showToast('danger', 'Repository initialization failed', message);
      btn.disabled = false;
      return;
    }
    showToast('success', 'Repository created', 'The module now has its own version history.');
    await renderModulySection({ onRestart: _lastOnRestart });
  } catch (err) {
    showToast('danger', 'Repository initialization failed', err.message);
    btn.disabled = false;
  }
}

// ── Git: commit ("Save version") ─────────────────────────────────────────────

function _openCommitModal(id) {
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = `
    <div class="ds-modal" role="dialog" aria-modal="true" aria-labelledby="mod-git-title">
      <div class="ds-modal-header">
        <span class="ds-modal-title" id="mod-git-title">Save a version of module "${escHtml(id)}"</span>
        <button type="button" class="ds-modal-close" data-git-close aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        <div class="ds-input-wrap">
          <label class="ds-label" for="mod-git-message">What did you change in this version?</label>
          <input class="ds-input" id="mod-git-message" type="text" maxlength="200"
                 placeholder="What did you change in this version?" autocomplete="off">
        </div>
      </div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--tertiary" data-git-close>Cancel</button>
        <button type="button" class="ds-btn ds-btn--primary" data-git-confirm disabled>Save version</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { closeDsModal(overlay); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelectorAll('[data-git-close]').forEach((b) => b.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const input = overlay.querySelector('#mod-git-message');
  const confirmBtn = overlay.querySelector('[data-git-confirm]');
  input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim() === ''; });
  // Enter submits, like every other single-field modal in Settings - a
  // person who typed a message and hit Enter must not be left staring at a
  // dialog that did nothing.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || confirmBtn.disabled) return;
    e.preventDefault();
    _runCommit(id, input, confirmBtn, close);
  });
  confirmBtn.addEventListener('click', () => _runCommit(id, input, confirmBtn, close));

  openDsModal(overlay);
  input.focus();
}

async function _runCommit(id, input, confirmBtn, close) {
  const message = input.value.trim();
  if (!message) return;
  confirmBtn.disabled = true;
  try {
    const res = await fetch('/api/modules/git-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, message }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 409 && data.error === 'nothing-to-commit') {
      // No server message for this one - the contract carries none, so this
      // sentence is client copy for a state that is not an error.
      showToast('info', 'Nothing to save', 'This module has no unsaved changes.');
      confirmBtn.disabled = false;
      return;
    }

    if (!res.ok) {
      const message2 = data.message || data.error || 'Unknown server error';
      showToast('danger', 'Saving the version failed', message2);
      confirmBtn.disabled = false;
      return;
    }

    close();
    showToast('success', 'Version saved', 'The new module version was saved in the local repository.');
    await renderModulySection({ onRestart: _lastOnRestart });
  } catch (err) {
    showToast('danger', 'Saving the version failed', err.message);
    confirmBtn.disabled = false;
  }
}

// ── Enable / disable ──────────────────────────────────────────────────────────

async function _handleToggle(btn) {
  const id = btn.dataset.modulyToggle;
  const currentlyEnabled = btn.dataset.modulyEnabled === '1';
  btn.disabled = true;
  try {
    const res = await fetch('/api/modules/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled: !currentlyEnabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast('danger', 'Save failed', data.error || 'Unknown server error');
      return;
    }
    showToast(
      'success',
      currentlyEnabled ? 'Module disabled' : 'Module enabled',
      'The change takes effect after a server restart.',
    );
    await renderModulySection({ onRestart: _lastOnRestart });
  } catch (err) {
    showToast('danger', 'Save failed', err.message);
  } finally {
    btn.disabled = false;
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

function _handleExport(id) {
  const a = document.createElement('a');
  a.href = '/api/modules/export?id=' + encodeURIComponent(id);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Publish to the catalog (branch + merge request) ──────────────────────────
// The catalog repo's `main` is protected, so publishing never writes to it
// directly: the server opens a branch and a merge request, and a human merges.
// That is why this flow ends with a link rather than with "done".

// The status select opens on what module.json already says, because the
// server writes the chosen value back there on every publish - so a module
// published once as "stable" is not silently re-offered as "beta". A module
// with no status yet starts on "beta", the same default the server applies.
const PUBLISH_STATUS_OPTIONS = [
  ['beta', 'beta - works, but still changing'],
  ['stable', 'stable - ready to use'],
  ['deprecated', 'deprecated - being retired'],
];

function _renderPublishStatusOptions(current) {
  const known = PUBLISH_STATUS_OPTIONS.some(([v]) => v === current);
  const selected = known ? current : 'beta';
  return PUBLISH_STATUS_OPTIONS.map(([v, label]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${escHtml(label)}</option>`).join('');
}

function _openPublishModal(id) {
  const item = _installedById.get(id);
  const currentStatus = item && item.manifest ? item.manifest.status : undefined;
  const originLine = item ? renderOriginLine(item.origin) : '';
  const currentArea = moduleArea(item?.manifest);
  const suggestions = areaSuggestions([..._installedById.values()].map(entry => moduleArea(entry.manifest)));
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--md" role="dialog" aria-modal="true" aria-labelledby="mod-pub-title">
      <div class="ds-modal-header">
        <span class="ds-modal-title" id="mod-pub-title">Publish the module to the catalog</span>
        <button type="button" class="ds-modal-close" data-pub-close aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        <div class="moduly-publish-form">
          <div class="ds-callout ds-callout--info">
            <div>Module <strong>${escHtml(id)}</strong> goes onto a new branch in the shared catalog
            repository, then a merge request is opened. The <code>main</code> branch is protected,
            so the change lands only after someone on the team reviews it.</div>
          </div>
          ${originLine ? `<div class="moduly-publish-origin">${originLine}</div>` : ''}
          <div class="ds-input-wrap">
            <label class="ds-label" for="mod-pub-area">Area (required)</label>
            <input class="ds-input" id="mod-pub-area" type="text" required
                   value="${escHtml(currentArea)}" list="mod-pub-areas" placeholder="Enter a business area">
            <datalist id="mod-pub-areas">${suggestions.map(value => `<option value="${escHtml(value)}"></option>`).join('')}</datalist>
          </div>
          <div class="ds-input-wrap">
            <label class="ds-label" for="mod-pub-summary">Short description for the catalog</label>
            <input class="ds-input" id="mod-pub-summary" type="text" maxlength="300"
                   placeholder="One sentence: what this module does">
          </div>
          <div class="ds-input-wrap">
            <label class="ds-label" for="mod-pub-status">Status</label>
            <select class="ds-input" id="mod-pub-status">
              ${_renderPublishStatusOptions(currentStatus)}
            </select>
          </div>
          <div id="mod-pub-result" hidden></div>
        </div>
      </div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--tertiary" data-pub-close>Cancel</button>
        <button type="button" class="ds-btn ds-btn--primary" data-pub-go>Publish</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-pub-close]').forEach((b) => b.addEventListener('click', () => {
    closeDsModal(overlay);
    overlay.remove();
  }));
  overlay.querySelector('[data-pub-go]').addEventListener('click', () => _runPublish(id, overlay));
  openDsModal(overlay);
}

// One listener, bound once in _openPublishModal - the destructive-publish
// retry ("Publish anyway") reuses it rather than stacking a second one,
// which would fire an unconfirmed publish AND a confirmed one on the same
// click. The confirm flag lives on the button's dataset instead.
async function _runPublish(id, overlay) {
  const go = overlay.querySelector('[data-pub-go]');
  const out = overlay.querySelector('#mod-pub-result');
  const summary = overlay.querySelector('#mod-pub-summary').value;
  const status = overlay.querySelector('#mod-pub-status').value;
  const areaInput = overlay.querySelector('#mod-pub-area');
  const areaError = areaInputError(areaInput.value);
  if (areaError) {
    areaInput.setAttribute('aria-invalid', 'true');
    areaInput.focus();
    showToast('danger', 'Check the area', areaError);
    return;
  }
  areaInput.removeAttribute('aria-invalid');
  const area = areaInput.value.trim().replace(/ {2,}/g, ' ');
  const confirmDeletes = go.dataset.pubConfirm === '1';
  go.disabled = true;
  go.textContent = 'Publishing...';
  out.hidden = false;
  out.textContent = 'Creating a branch, sending files and opening a merge request...';

  let data = null;
  try {
    const res = await fetch('/api/modules/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, summary, status, area, confirmDeletes }),
    });
    data = await res.json().catch(() => null);
    if (!res.ok && data) data.ok = false;
  } catch (_e) {
    data = { ok: false, message: 'No connection to the server.' };
  }

  go.disabled = false;
  go.textContent = 'Publish';
  delete go.dataset.pubConfirm;

  if (data && data.error === 'publish-destructive') {
    const files = Array.isArray(data.deletes) ? data.deletes : [];
    out.innerHTML = `<div class="ds-callout ds-callout--warning"><div>
        <p>${escHtml(data.message || 'Publishing would delete most of the module files in the catalog.')}</p>
        <ul>${files.map(p => `<li><code>${escHtml(p)}</code></li>`).join('')}</ul>
      </div></div>`;
    go.dataset.pubConfirm = '1';
    go.textContent = 'Publish anyway';
    return;
  }

  if (data && data.error === 'publish-tree-mismatch') {
    const msg = data.message || 'The catalog tree that was read does not match the module being sent.';
    out.innerHTML = `<div class="ds-callout ds-callout--danger"><div>${escHtml(msg)}</div></div>`;
    showToast('danger', 'Publishing refused', msg);
    return;
  }

  if (data && data.ok) {
    const link = data.mrUrl
      ? `<a href="${escHtml(data.mrUrl)}" target="_blank" rel="noopener">Open merge request</a>`
      : 'Merge request opened.';
    const catalogWarning = data.catalogUnavailable
      ? `<div class="ds-callout ds-callout--warning"><div>`
        + `Could not check the version in the catalog — make sure the version in module.json is higher than the published one.`
        + `</div></div>`
      : '';
    const deletedLine = data.deleted > 0 ? ` Deleted ${data.deleted} file(s) from the catalog.` : '';
    // Names, not just a count - otherwise the only place the publisher can see
    // WHAT disappeared is the merge request in GitLab.
    const deletedList = (data.deleted > 0 && Array.isArray(data.deletes) && data.deletes.length)
      ? `<div class="ds-callout ds-callout--warning"><div>Deleted files:<ul>`
        + data.deletes.map(p => `<li><code>${escHtml(p)}</code></li>`).join('')
        + (data.deleted > data.deletes.length ? `<li>and ${data.deleted - data.deletes.length} more</li>` : '')
        + `</ul></div></div>`
      : '';
    const warningCallouts = (Array.isArray(data.warnings) ? data.warnings : [])
      .map(w => `<div class="ds-callout ds-callout--warning"><div>${escHtml(w.message || '')}</div></div>`)
      .join('');
    // A local catalog has no branch and no merge request: the files were
    // copied into the catalog folder, and committing them is the next step.
    const successLine = data.local
      ? `Copied ${data.files} file(s) into <code>${escHtml(data.modulePath || data.catalogDir || 'catalog/')}</code> and updated catalog.json. Commit the change (or open a pull request) to share it.${deletedLine}`
      : `Sent ${data.files} file(s) to branch <code>${escHtml(data.branch)}</code>. ${link}${deletedLine}`;
    out.innerHTML = `<div class="ds-callout ds-callout--success"><div>`
      + successLine
      + `</div></div>${deletedList}${catalogWarning}${warningCallouts}`;
    showToast('success', data.local ? 'Published to the local catalog' : 'Published',
      data.local ? 'The module is now in the catalog folder.' : 'The merge request is awaiting review.');
    _forcePending = true;
    _forceDrift = true;
    // module.json now carries the chosen status, so the card behind the modal
    // has a new badge to show (and the module's git row a new change).
    await renderModulySection({ onRestart: _lastOnRestart });
    return;
  }

  const msg = (data && data.message) || 'Could not publish the module.';
  out.innerHTML = `<div class="ds-callout ds-callout--danger"><div>${escHtml(msg)}</div></div>`;
  showToast('danger', 'Publishing failed', msg);
}

// ── Remove (type-to-confirm modal) ───────────────────────────────────────────

// A module's local repository is at stake too, so the warning names what
// removal costs BEFORE the person types the confirmation: dirty means
// unsaved changes disappear with the history, clean still means the history
// itself disappears with the directory.
function _renderRemoveGitWarning(git) {
  if (!git || !git.present) return '';
  if (git.dirty) {
    const n = pluralZmiany(git.changedFiles);
    return `<div class="ds-callout ds-callout--warning">
        <div>This module has a local repository with unsaved changes (${escHtml(n)}) - removing it also deletes its history.</div>
      </div>`;
  }
  return `<div class="ds-callout ds-callout--warning">
      <div>This module has a local repository with version history - removing it deletes that along with the folder.</div>
    </div>`;
}

function _openRemoveModal(id) {
  const item = _installedById.get(id);
  const git = item && item.git;
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = `
    <div class="ds-modal">
      <div class="ds-modal-header">
        <span class="ds-modal-title">Remove module "${escHtml(id)}"</span>
        <button type="button" class="ds-modal-close" data-moduly-remove-close aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body" data-moduly-remove-body>
        <div class="ds-callout ds-callout--warning">
          <div>This deletes the folder <code>modules/${escHtml(id)}/</code> from disk and cannot be undone.</div>
        </div>
        ${_renderRemoveGitWarning(git)}
        <label class="moduly-confirm-field">
          <span>Type the module id to confirm: <strong>${escHtml(id)}</strong></span>
          <input type="text" class="ds-input" data-moduly-remove-confirm autocomplete="off">
        </label>
        <label class="moduly-checkbox-field">
          <input type="checkbox" data-moduly-remove-data>
          <span>Also remove the add-on data (by default the data stays on disk)</span>
        </label>
      </div>
      <div class="ds-modal-footer" data-moduly-remove-footer>
        <button type="button" class="ds-btn ds-btn--secondary" data-moduly-remove-cancel>Cancel</button>
        <button type="button" class="ds-btn ds-btn--danger" data-moduly-remove-confirm-btn disabled>Remove module</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  openDsModal(overlay);

  const close = () => { closeDsModal(overlay); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('[data-moduly-remove-close]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // "Cancel" is re-bound every time the footer is rewritten (see
  // _showRemoveForceConfirm below), so the first binding lives here and the
  // second one binds its own copy after the swap.
  overlay.querySelector('[data-moduly-remove-cancel]').addEventListener('click', close);

  const input = overlay.querySelector('[data-moduly-remove-confirm]');
  const confirmBtn = overlay.querySelector('[data-moduly-remove-confirm-btn]');
  input.addEventListener('input', () => {
    confirmBtn.disabled = input.value.trim() !== id;
  });

  confirmBtn.addEventListener('click', async () => {
    const removeData = overlay.querySelector('[data-moduly-remove-data]').checked;
    confirmBtn.disabled = true;
    await _submitRemove(id, { removeData, force: false }, overlay, close);
  });
}

// The second confirmation the contract calls for: 409 module-dirty stops the
// first click, and the person decides here whether to lose the unsaved
// changes too. Swaps the SAME modal's body and footer rather than opening a
// second overlay, so there is only ever one remove dialog on screen.
function _showRemoveForceConfirm(id, removeData, overlay, close, data) {
  const body = overlay.querySelector('[data-moduly-remove-body]');
  const footer = overlay.querySelector('[data-moduly-remove-footer]');
  if (body) {
    body.innerHTML = `
      <div class="ds-callout ds-callout--danger">
        <div>${escHtml(data.message || 'The module has unsaved changes in its local repository.')}</div>
      </div>
      <p>Remove the module anyway, together with its unsaved changes?</p>`;
  }
  if (footer) {
    footer.innerHTML = `
      <button type="button" class="ds-btn ds-btn--secondary" data-moduly-remove-cancel>Cancel</button>
      <button type="button" class="ds-btn ds-btn--danger" data-moduly-remove-force-btn>Remove anyway</button>`;
    footer.querySelector('[data-moduly-remove-cancel]').addEventListener('click', close);
    footer.querySelector('[data-moduly-remove-force-btn]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      await _submitRemove(id, { removeData, force: true }, overlay, close);
    });
  }
}

async function _submitRemove(id, { removeData, force }, overlay, close) {
  try {
    const res = await fetch('/api/modules/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, removeData, force: !!force }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 409 && data.error === 'module-dirty' && !force) {
      _showRemoveForceConfirm(id, removeData, overlay, close, data);
      return;
    }

    if (!res.ok) {
      showToast('danger', 'Removal failed', data.message || data.error || 'Unknown server error');
      const btn = overlay.querySelector('[data-moduly-remove-confirm-btn], [data-moduly-remove-force-btn]');
      if (btn) btn.disabled = false;
      return;
    }

    close();
    showToast('success', 'Module removed', 'The change takes effect after a server restart.');
    await renderModulySection({ onRestart: _lastOnRestart });
  } catch (err) {
    showToast('danger', 'Removal failed', err.message);
    const btn = overlay.querySelector('[data-moduly-remove-confirm-btn], [data-moduly-remove-force-btn]');
    if (btn) btn.disabled = false;
  }
}

// ── Import ────────────────────────────────────────────────────────────────────

function _readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** No-isolation warning, shown BEFORE any archive is read or sent. */
function _confirmUntrustedCode() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ds-modal-overlay';
    overlay.innerHTML = `
      <div class="ds-modal">
        <div class="ds-modal-header">
          <span class="ds-modal-title">You are uploading someone else's code</span>
        </div>
        <div class="ds-modal-body">
          <div class="ds-callout ds-callout--warning">
            <div>Add-ons run without isolation — with full rights in the browser and in the server process. Uploading an archive from someone else means running their code.</div>
          </div>
        </div>
        <div class="ds-modal-footer">
          <button type="button" class="ds-btn ds-btn--secondary" data-moduly-import-cancel>Cancel</button>
          <button type="button" class="ds-btn ds-btn--danger" data-moduly-import-confirm>I understand, upload</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    openDsModal(overlay);
    const finish = (result) => {
      closeDsModal(overlay);
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    overlay.querySelector('[data-moduly-import-cancel]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-moduly-import-confirm]').addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
  });
}

/**
 * Asks whether an existing module id may be overwritten (409 `exists`).
 * `git` is the last-known state of that module's repository (from
 * `_installedById`, may be undefined for a module this tab never rendered):
 * a clean repository survives the overwrite (server keeps `.git` across the
 * swap), so the dialog says so rather than leaving the person to assume the
 * history is gone too.
 */
function _confirmOverwrite(id, git) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ds-modal-overlay';
    const keepsHistory = git && git.present && !git.dirty
      ? '<p>The version history of this module will be kept.</p>'
      : '';
    overlay.innerHTML = `
      <div class="ds-modal">
        <div class="ds-modal-header">
          <span class="ds-modal-title">Module already exists</span>
        </div>
        <div class="ds-modal-body">
          <p>Module <strong>${escHtml(id)}</strong> is already installed. Overwrite it with the version from the file?</p>
          ${keepsHistory}
        </div>
        <div class="ds-modal-footer">
          <button type="button" class="ds-btn ds-btn--secondary" data-moduly-overwrite-cancel>Cancel</button>
          <button type="button" class="ds-btn ds-btn--danger" data-moduly-overwrite-confirm>Overwrite</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    openDsModal(overlay);
    const finish = (result) => {
      closeDsModal(overlay);
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    overlay.querySelector('[data-moduly-overwrite-cancel]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-moduly-overwrite-confirm]').addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
  });
}

async function _submitImport(request) {
  const { filename } = request;
  const res = await fetch('/api/modules/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 409 && data.error === 'area-required' && data.needsArea) {
    const area = await requestModuleArea(data.suggestions);
    if (area !== null) await _submitImport({ ...request, area });
    return;
  }

  // A dirty local repository stops the retry loop outright: there is nothing
  // to confirm here (unlike "exists"), the person has to go save a version
  // first, so the server's own sentence is the whole message.
  // Both refusals name a state the person has to resolve by hand - a repo with
  // unsaved changes, or a stray .bak-<ts> still holding the history - so neither
  // is the "already installed, overwrite?" question the generic 409 asks.
  if (res.status === 409 && (data.error === 'module-dirty' || data.error === 'stale-backup')) {
    showToast('danger', 'Cannot overwrite the module', data.message || 'Save a version of the module before reinstalling.');
    return;
  }

  if (res.status === 409 && data.error === 'exists' && !request.overwrite) {
    const existing = _installedById.get(data.id || filename);
    const wantsOverwrite = await _confirmOverwrite(data.id || filename, existing && existing.git);
    if (wantsOverwrite) await _submitImport({ ...request, overwrite: true });
    return;
  }

  if (!res.ok) {
    const message = data.message
      || (Array.isArray(data.errors) ? data.errors.join('; ') : null)
      || data.error
      || 'Unknown server error';
    showToast('danger', 'Upload failed', message);
    return;
  }

  showToast('success', 'Module uploaded', 'The change takes effect after a server restart.');
  await renderModulySection({ onRestart: _lastOnRestart });
}

async function _handleFileChange(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  if (!file) return;

  try {
    const proceed = await _confirmUntrustedCode();
    if (!proceed) return;

    // FileReader.readAsDataURL(), not atob/Uint8Array: eslint.config.mjs does
    // not grant those globals to js/**/*.js, and this is the one path that
    // needs neither.
    const dataUrl = await _readFileAsDataUrl(file);
    const dataBase64 = dataUrl.split(',')[1] || '';
    await _submitImport({ filename: file.name, dataBase64, overwrite: false });
  } catch (err) {
    showToast('danger', 'Upload failed', err.message);
  } finally {
    // Without this, choosing the SAME file twice in a row never fires
    // "change" again and the upload flow silently does nothing.
    input.value = '';
  }
}
