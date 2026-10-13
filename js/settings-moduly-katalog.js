// ── Mission Deck — js/settings-moduly-katalog.js ───────────────────────────
// Renders the "Catalog" section under the "Modules" tab in #view-settings: a
// shared, read-only TABLE of modules published in the cockpit-modules
// repository, with one-click install/update and the same details modal the
// installed table opens - same columns, same renderers. Exports:
// renderModulesCatalogSection({ onRestart, installedPayload, fresh }); rows are
// grouped by menu place like the Installed table.
// Called from js/settings-moduly.js renderModulySection() — fire-and-forget,
// so a slow or unreachable catalog never blocks the "Installed" section.
//
// Deliberately one-way, same rule as js/settings-moduly.js: nothing here
// imports from js/settings.js — the restart action arrives as the onRestart
// argument instead, so the import graph never cycles back through it.

import { showToast } from './toast.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { escHtml } from './utils.js';
import { catalogRowState, installedVersionMap } from './module-updates.mjs';
import { areaOptions, filterRows, nextFilterState } from './module-filter.mjs';
import { applyMenuGroups, groupRowsByMenu, renderMenuGroup } from './module-menu-groups.mjs';
import { createAreaSelectLifecycle, requestModuleArea } from './module-area-modal.js';
import {
  areaFilterKey,
  moduleArea,
  renderAreaBadge,
  moduleSearchText,
  renderDetailsButton,
  renderMaturityBadge,
  renderModuleDetailsBody,
  renderModuleNameCell,
  renderShapeBadge,
} from './module-card.mjs';

const SLOT_ID = 'settings-moduly-catalog';

// Remembers the onRestart callback across re-renders triggered from inside
// this module (install/update re-render the whole Modules section).
let _lastOnRestart = null;

// Set once an install/update succeeded: the module is on disk but loads only
// after a server restart. Every render paints the restart callout while it is
// set, so the re-render that follows an install cannot wipe it (2026-10-05:
// the callout was inserted by hand once and the rows were never repainted,
// so an installed module kept its "Install" button). A restart reloads
// the page, which resets it.
let _restartPending = false;

// The search box's text, kept across re-renders (install/update/refresh all
// rebuild the list) so a filtered catalog stays filtered after an action.
let _query = '';
let _area = '';
let _filterData = [];
const _areaSelectLifecycle = createAreaSelectLifecycle('[data-katalog-area-input]');

// Menu groups the person expanded; same rule as the Installed table -
// emptied on every entry to the tab, kept across this file's own repaints.
const _openGroups = new Set();

// The last catalog answer, keyed by id, plus this cockpit's version - the
// details modal reads a row's entry from here rather than fetching the
// catalog a second time. Same module-state pattern as _query above; it goes
// stale exactly when the list does, and every action re-renders the list.
let _entriesById = new Map();

// ── Data loading ──────────────────────────────────────────────────────────────

async function _fetchCatalog(force) {
  const url = `/api/modules/catalog?t=${Date.now()}${force ? '&force=1' : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return res.json();
}

// The installed versions come from the DISK scan (/api/modules/installed),
// the same source the update banner classifies from - never from
// /api/modules/manifest, which is the loadModules() snapshot taken at boot.
// A module.json bumped after the last restart (a publish, an edit) is
// invisible there, so the catalog compared today's catalog version against a
// stale local one and offered "Update" on six up-to-date modules - an
// update whose only effect would have been the 409 module-dirty guard.
// That endpoint runs one `git status` per installed module, and the tab
// already asks it for the "Installed" table, so a render started by the
// tab SHARES that request (`installedPayload`, a promise of the parsed body)
// instead of paying for it twice; only "Refresh" and a retry - which the tab
// is not part of - fetch on their own, because the disk may have moved.
async function _fetchInstalledVersions(installedPayload) {
  try {
    if (installedPayload) return installedVersionMap(await installedPayload);
    const res = await fetch(`/api/modules/installed?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return {};
    return installedVersionMap(await res.json());
  } catch {
    return {};
  }
}

// ── Card state ────────────────────────────────────────────────────────────────
// `dostepny` (not installed) / `zainstalowany` (up to date, or local newer -
// never propose a downgrade) / `dostepna aktualizacja` (catalog is newer).
// The decision itself is catalogRowState in js/module-updates.mjs, shared
// with the banner's classifier, so the two surfaces cannot drift.

function _cardState(entry, installedVersions) {
  return catalogRowState(installedVersions[entry.id], entry.manifest && entry.manifest.version);
}

function _actionButton(entry, state) {
  if (state === 'dostepny') {
    return `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-katalog-install="${escHtml(entry.id)}">Install</button>`;
  }
  if (state === 'dostepna-aktualizacja') {
    return `<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-katalog-update="${escHtml(entry.id)}">Update</button>`;
  }
  return '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" disabled>Installed</button>';
}

// ── Rendering ─────────────────────────────────────────────────────────────────

// The same renderers as the "Installed" table above (js/module-card.mjs),
// so a module cannot look like two different things before and after the
// install. Only the icon differs, and only because a "module:<file>" icon
// lives inside modules/<id>/client/, which does not exist yet: passing no
// module id makes the shared resolver fall back to the DS default instead of
// linking a 404.
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

function _renderRow(entry, installedVersions) {
  const manifest = entry.manifest || {};
  const state = _cardState(entry, installedVersions);
  // A catalog entry always has a status (parseModulesCatalog defaults it), so
  // the fallback only covers a malformed payload - and stays "stable" to
  // match what the server would have answered.
  const statusBadge = renderMaturityBadge(entry.status) || renderMaturityBadge('stable');
  const curatedBadge = entry.curated
    ? ''
    : '<span class="ds-badge ds-badge--gray">uncurated</span>';
  const featuredClass = entry.featured ? ' modules-catalog-row--featured' : '';

  return `
    <tr class="moduly-row${featuredClass}" data-katalog-id="${escHtml(entry.id)}" data-katalog-area="${escHtml(areaFilterKey(moduleArea(manifest, entry)))}" data-katalog-search="${escHtml(moduleSearchText(manifest, entry))}">
      <td>${renderModuleNameCell(manifest, { id: entry.id, iconModuleId: null })}</td>
      <td class="moduly-cell-version">${escHtml(manifest.version || '?')}</td>
      <td><span class="moduly-cell-badges">${statusBadge}${curatedBadge}</span></td>
      <td><span class="moduly-cell-badges">${renderAreaBadge(moduleArea(manifest, entry))}</span></td>
      <td><span class="moduly-cell-badges">${renderShapeBadge(manifest)}</span></td>
      <td class="right">
        <span class="moduly-row-actions">
          ${renderDetailsButton(entry.id, 'katalog-details')}
          ${_actionButton(entry, state)}
        </span>
      </td>
    </tr>`;
}

// ── Details modal ─────────────────────────────────────────────────────────────
// The columns a row leaves out: description, author, tags, capabilities,
// views and declarations. Rendered by the same renderModuleDetailsBody the
// installed table's modal uses. No git block here - a catalog entry is not on
// this disk, so it has no local repository to describe. `summary`, `author`
// and `tags` are passed explicitly because catalog.json may curate all three
// over module.json (mergeModulesCatalog in server.js).
function _openDetailsModal(id) {
  const entry = _entriesById.get(id);
  if (!entry) return;
  const manifest = entry.manifest || {};

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true" aria-labelledby="kat-det-title">
      <div class="ds-modal-header">
        <span class="ds-modal-title" id="kat-det-title">Module details</span>
        <button type="button" class="ds-modal-close" data-katalog-det-close aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body moduly-detail-body">${renderModuleDetailsBody(manifest, {
    id: entry.id,
    iconModuleId: null,
    description: entry.summary || manifest.description || '',
    author: entry.author || manifest.author || '',
    area: moduleArea(manifest, entry),
    tags: Array.isArray(entry.tags) ? entry.tags : (manifest.tags || []),
  })}</div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--tertiary" data-katalog-det-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { closeDsModal(overlay); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelectorAll('[data-katalog-det-close]').forEach(b => b.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  openDsModal(overlay);
}

function _renderErrors(errors) {
  if (!errors.length) return '';
  return `<div class="ds-callout ds-callout--warning modules-catalog-errors">
      <div>
        <p>The catalog has invalid entries:</p>
        <ul>${errors.map(e => `<li>${escHtml(e.id)}: ${escHtml(e.error)}</li>`).join('')}</ul>
      </div>
    </div>`;
}

function _renderNoToken(data) {
  return `<div class="ds-callout ds-callout--warning">
      <div>
        <p>${escHtml(data.message || 'You have no access to the module catalog yet.')}</p>
        <a class="ds-btn ds-btn--tertiary ds-btn--sm" href="#settings/keys">Go to the Keys tab</a>
      </div>
    </div>`;
}

/**
 * One line saying where the catalog comes from: the local folder (the
 * default, published to by copying files) or an opt-in GitLab repository
 * (published to through merge requests). '' when the server did not say.
 * @param {{catalogSource?: {mode?: string, location?: string}}} data
 */
export function catalogSourceLine(data) {
  const src = data && data.catalogSource;
  if (!src || !src.location) return '';
  const text = src.mode === 'local'
    ? `Catalog source: the local folder <code>${escHtml(src.location)}</code>. Install copies modules from it, and Publish writes into it - commit the change to share it.`
    : `Catalog source: the GitLab repository <code>${escHtml(src.location)}</code>. Publish opens a merge request there.`;
  return `<p class="sett-empty-hint" data-katalog-source="${escHtml(src.mode || '')}">${text}</p>`;
}

function _renderUnreachable(data) {
  return `<div class="ds-callout ds-callout--warning">
      <div>${escHtml(data.message || 'Could not read the module catalog from GitLab.')}</div>
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-katalog-refresh>Try again</button>
    </div>`;
}

// Placeholder table painted while the catalog request is in flight. Mirrors
// the static skeleton in index.html, so the first paint and every repaint
// reserve the same height and the tab never jumps.
function _renderSkeletonTable() {
  const row = `
    <tr class="moduly-row sett-skel" aria-hidden="true">
      <td>
        <span class="moduly-row-name">
          <span class="moduly-row-icon"></span>
          <span class="moduly-row-name-text">
            <span class="ds-skeleton sett-skel-bar sett-skel-bar--title"></span>
            <span class="ds-skeleton sett-skel-bar sett-skel-bar--text-short"></span>
          </span>
        </span>
      </td>
      <td><span class="ds-skeleton sett-skel-bar sett-skel-bar--text-short"></span></td>
      <td><span class="ds-skeleton sett-skel-bar sett-skel-bar--text-short"></span></td>
      <td><span class="ds-skeleton sett-skel-bar sett-skel-bar--text"></span></td>
      <td><span class="ds-skeleton sett-skel-bar sett-skel-bar--text-short"></span></td>
      <td class="right"><span class="ds-skeleton sett-skel-bar sett-skel-bar--btn"></span></td>
    </tr>`;
  return '<div class="ds-table-wrap moduly-table-wrap"><table class="ds-table moduly-table">'
    + _renderTableHead()
    + '<tbody>' + row.repeat(3) + '</tbody>'
    + '</table></div>';
}

// One root element on purpose: the restart callout is inserted right after
// slot.firstChild, so the title row and the search row must travel together.
function _renderHeader() {
  return `<div class="modules-catalog-head">
      <div class="modules-catalog-header">
        <h3 class="modules-catalog-title">Catalog</h3>
        <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-modules-refresh>Refresh catalog</button>
      </div>
      <div class="moduly-search-row">
        <input type="search" class="ds-input moduly-search" value="${escHtml(_query)}" placeholder="Search the catalog by name, id, author or tag..." aria-label="Search the module catalog" autocomplete="off" data-katalog-search-input>
        <div class="moduly-area-select">
          <select class="ds-input moduly-area-select" aria-label="Area of catalog modules" data-katalog-area-input>
            ${areaOptions(_filterData).map(option => `<option value="${escHtml(option.value)}"${option.value === _area ? ' selected' : ''}>${escHtml(option.label)}</option>`).join('')}
          </select>
        </div>
        <span class="moduly-search-count" data-katalog-search-count aria-live="polite"></span>
      </div>
    </div>`;
}

// Filters the card grid in place, same rule as the Installed section: a
// card whose haystack misses any word of the query is hidden, the counter
// says how many stay, an empty result shows one sentence.
function _applyFilter(slot) {
  const cards = [...slot.querySelectorAll('[data-katalog-search]')]
    .map(card => ({ card, area: card.dataset.katalogArea, search: card.dataset.katalogSearch }));
  const { rows, visible, total } = filterRows(cards, { query: _query, area: _area });
  const shown = new Set(rows);
  cards.forEach(row => { row.card.hidden = !shown.has(row); });
  const count = slot.querySelector('[data-katalog-search-count]');
  if (count) count.textContent = total === 0 ? '' : (_query.trim() || _area ? `${visible} z ${total}` : `${total}`);
  const empty = slot.querySelector('[data-katalog-search-empty]');
  if (empty) empty.hidden = visible > 0 || cards.length === 0;
  applyMenuGroups(slot, { filtering: !!(_query.trim() || _area), openKeys: _openGroups });
}

// ── No-isolation warning modal ───────────────────────────────────────────────

function _confirmNoIsolation(id) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ds-modal-overlay';
    overlay.innerHTML = `
      <div class="ds-modal">
        <div class="ds-modal-header">
          <span class="ds-modal-title">You are installing someone else's module</span>
        </div>
        <div class="ds-modal-body">
          <div class="ds-callout ds-callout--warning">
            <div>Module <strong>${escHtml(id)}</strong> runs without isolation — it runs its author's code with full rights, both in the browser and in the server process.</div>
          </div>
        </div>
        <div class="ds-modal-footer">
          <button type="button" class="ds-btn ds-btn--tertiary" data-katalog-cancel>Cancel</button>
          <button type="button" class="ds-btn ds-btn--danger" data-katalog-confirm>Install anyway</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    openDsModal(overlay);
    const finish = (result) => {
      closeDsModal(overlay);
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    overlay.querySelector('[data-katalog-cancel]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-katalog-confirm]').addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
  });
}

function _renderRestartCallout() {
  return `<div class="ds-callout ds-callout--success modules-catalog-restart">
      <div>The module is on disk. The change takes effect after a server restart.</div>
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-katalog-restart>Restart</button>
    </div>`;
}

// The header plus, after a successful install, the restart callout right
// under it. Every exit of _renderInto paints the header through here.
function _paintHeader(slot) {
  slot.innerHTML = _renderHeader() + (_restartPending ? _renderRestartCallout() : '');
  const restartBtn = slot.querySelector('[data-katalog-restart]');
  if (restartBtn) {
    restartBtn.addEventListener('click', (ev) => {
      if (typeof _lastOnRestart === 'function') _lastOnRestart(ev.currentTarget);
    });
  }
}

// ── Public export ─────────────────────────────────────────────────────────────

/**
 * @param {{onRestart?: Function, installedPayload?: Promise<object|null>}} [opts]
 *   `installedPayload` is the tab's own GET /api/modules/installed body
 *   (a promise; `null` when that request failed), shared so the catalog
 *   does not run the per-module git probes a second time.
 */
export async function renderModulesCatalogSection({ onRestart, installedPayload, fresh = false } = {}) {
  _lastOnRestart = onRestart || _lastOnRestart;
  if (fresh) _openGroups.clear();
  const slot = document.getElementById(SLOT_ID);
  if (!slot) return;

  await _renderInto(slot, false, installedPayload);
}

async function _renderInto(slot, force, installedPayload) {
  await _areaSelectLifecycle.prepare(slot);
  _paintHeader(slot);
  slot.insertAdjacentHTML('beforeend', _renderSkeletonTable());

  let data;
  let installedVersions = {};
  try {
    [data, installedVersions] = await Promise.all([
      _fetchCatalog(force), _fetchInstalledVersions(installedPayload),
    ]);
  } catch (err) {
    _areaSelectLifecycle.dispose();
    _paintHeader(slot);
    slot.insertAdjacentHTML('beforeend',
      `<div class="ds-callout ds-callout--danger"><div>Could not load the module catalog: ${escHtml(err.message)}</div></div>`);
    _wireHeader(slot);
    return;
  }

  _entriesById = new Map(
    (data && Array.isArray(data.entries) ? data.entries : []).map(e => [e.id, e]),
  );

  const inner = document.createElement('div');
  inner.className = 'modules-catalog-inner';

  if (!data || data.ok === false) {
    inner.innerHTML = data && data.error === 'no-token' ? _renderNoToken(data) : _renderUnreachable(data || {});
  } else {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    _filterData = entries.map(entry => ({ area: moduleArea(entry.manifest, entry) }));
    ({ query: _query, area: _area } = nextFilterState({ query: _query, area: _area }, _filterData));
    const errors = Array.isArray(data.errors) ? data.errors : [];
    if (!entries.length) {
      inner.innerHTML = '<p class="sett-empty-hint">The catalog is empty so far.</p>' + _renderErrors(errors);
    } else {
      // Sorted by the name the row shows, same rule as the installed table -
      // the order GitLab answers in is not one a person can predict.
      const rows = entries.slice().sort((a, b) => {
        const an = (a.manifest && a.manifest.name) || a.id || '';
        const bn = (b.manifest && b.manifest.name) || b.id || '';
        return an.localeCompare(bn, 'en');
      });
      inner.innerHTML = '<div class="ds-table-wrap moduly-table-wrap"><table class="ds-table moduly-table">'
        + _renderTableHead()
        + groupRowsByMenu(rows, e => e.manifest || {})
          .map(group => renderMenuGroup(group, { scope: 'katalog', colspan: 6, renderRow: e => _renderRow(e, installedVersions) })).join('')
        + '</table></div>'
        + '<p class="sett-empty-hint" data-katalog-search-empty hidden>No catalog module matches the selected filters.</p>'
        + _renderErrors(errors);
    }
  }

  inner.insertAdjacentHTML('afterbegin', catalogSourceLine(data));

  _areaSelectLifecycle.dispose();
  _paintHeader(slot);
  slot.appendChild(inner);
  _wireHeader(slot);
  _applyFilter(slot);
  inner.addEventListener('click', (e) => _handleInnerClick(e, slot));
}

async function _wireHeader(slot) {
  const areaSelect = slot.querySelector('[data-katalog-area-input]');
  if (areaSelect) {
    const { initSelect } = await import('./ds-select.js');
    if (!areaSelect.isConnected) return;
    initSelect(areaSelect);
    areaSelect.parentElement.querySelector('.ds-sel-trigger').setAttribute('aria-label', 'Area of catalog modules');
    const onAreaChange = () => { _area = areaSelect.value; _applyFilter(slot); };
    _areaSelectLifecycle.bind(areaSelect, onAreaChange);
  }
  const refreshBtn = slot.querySelector('[data-modules-refresh]');
  if (refreshBtn) refreshBtn.addEventListener('click', () => _renderInto(slot, true));
  const retryBtn = slot.querySelector('[data-katalog-refresh]');
  if (retryBtn) retryBtn.addEventListener('click', () => _renderInto(slot, true));
  const search = slot.querySelector('[data-katalog-search-input]');
  if (search) search.addEventListener('input', () => { _query = search.value; _applyFilter(slot); });
}

async function _handleInnerClick(e, slot) {
  const groupToggle = e.target.closest('[data-menu-group-toggle]');
  if (groupToggle) {
    const key = groupToggle.dataset.menuGroupToggle;
    if (groupToggle.getAttribute('aria-expanded') === 'true') _openGroups.delete(key); else _openGroups.add(key);
    const body = slot.querySelector(`[data-menu-group-body="${CSS.escape(key)}"]`);
    if (body) {
      body.hidden = !body.hidden;
      groupToggle.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
    }
    return;
  }

  const detailsBtn = e.target.closest('[data-katalog-details]');
  if (detailsBtn) { _openDetailsModal(detailsBtn.dataset.katalogDetails); return; }

  const installBtn = e.target.closest('[data-katalog-install]');
  const updateBtn = e.target.closest('[data-katalog-update]');
  const restartBtn = e.target.closest('[data-katalog-restart]');

  if (restartBtn) {
    if (typeof _lastOnRestart === 'function') _lastOnRestart(restartBtn);
    return;
  }

  const btn = installBtn || updateBtn;
  if (!btn) return;

  const id = btn.dataset.katalogInstall || btn.dataset.katalogUpdate;
  btn.disabled = true;
  try {
    const ok = await installFromCatalog(id, { overwrite: !!updateBtn });
    if (!ok) return;
    // The module is on disk but loads only after a restart: every render of
    // the Catalog paints the restart callout while this is set.
    _restartPending = true;
    // Repaint BOTH tables from a fresh disk scan: the row must read
    // "Installed" and the module must appear under "Installed".
    // Lazy import - settings-moduly.js imports this file statically.
    // A failed repaint is not a failed install - it must not raise the
    // install-error toast.
    try {
      const { renderModulySection } = await import('./settings-moduly.js');
      await renderModulySection({ onRestart: _lastOnRestart });
    } catch (repaintErr) {
      console.error('[settings] moduly repaint after install:', repaintErr);
    }
  } finally {
    btn.disabled = false;
  }
}

/**
 * Installs (or, with `overwrite`, updates) one module from the catalog: the
 * no-isolation warning, POST /api/modules/install with the area prompt loop,
 * and the outcome toast. Shared by the Catalog rows and the "Need
 * updating" list in the Installed section, so both run one flow.
 * @param {string} id
 * @param {{overwrite?: boolean}} [opts]
 * @returns {Promise<boolean>} true when the module is on disk
 */
export async function installFromCatalog(id, { overwrite = false } = {}) {
  const proceed = await _confirmNoIsolation(id);
  if (!proceed) return false;
  try {
    const request = { id, overwrite };
    let res;
    let result;
    do {
      res = await fetch('/api/modules/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      result = await res.json().catch(() => ({}));
      if (res.status !== 409 || result.error !== 'area-required' || !result.needsArea) break;
      const area = await requestModuleArea(result.suggestions);
      if (area === null) return false;
      request.area = area;
    } while (true);
    if (!res.ok || result.ok === false) {
      const message = result.message
        || (Array.isArray(result.errors) ? result.errors.join('; ') : null)
        || result.error
        || 'Unknown server error';
      showToast('danger', 'Installation failed', message);
      return false;
    }
    showToast('success', overwrite ? 'Module updated' : 'Module installed', 'Restart the server for it to take effect.');
    // The caller marks the restart (one callout per action, in the section
    // the person acted in) and repaints the tables - both callers do.
    return true;
  } catch (err) {
    showToast('danger', 'Installation failed', err.message);
    return false;
  }
}
