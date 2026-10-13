// rollout-waves/client/index.js
// Rollout waves - a rollout planned in weekly waves across the locations
// directory. One view over GET /dashboard (KPI + wave table + location list,
// computed on the server from the plaintext team data tree) plus two XLSX
// confirmation imports (training, webinar). The locations directory itself is
// owned by the `locations` module and is never imported here.
//
// export const views = { 'rollout-waves-main': { init(deps), render(subPath, opts) } }
// - the shape js/module-host.js expects (see modules/demo-hub/client/index.js
//   for the working pattern).
//
// deps (passed to init):
//   navigate(viewId)                 - go to another view
//   registerViewCleanup(cb)          - MANDATORY for timers, listeners, EventSource
//   showToast(variant, title, desc)  - variant: success | danger | info | warning | neutral
//   apiBase                          - '/api/m/rollout-waves' (this module's routes)
//
// js/ds-modal.js and js/ds-select.js are CORE ESM modules - the import MUST be
// dynamic and only ever run inside init(), in try/catch: a static import would
// break the contract test, which loads this file in plain Node with no browser
// document and no /js/... URL resolver (tests/test_rollout_waves.mjs is the
// test that would break).
//
// DS classes only (ds-btn, ds-card, ds-badge, ds-callout, ds-input, ds-segmented,
// ds-table-wrap, ds-modal-overlay, ds-skeleton, ds-empty, ds-progress) and
// tokens from css/ds-tokens.css - never a hex.
//
// Status KEYS from the server are ASCII and are never displayed or compared
// against a label - see client/rollout-lib.js STATUS_LABELS /
// WAVE_STATUS_LABELS.

import {
  esc, fmtPct, fmtDate, statusBadgeClass, STATUS_LABELS, WAVE_STATUS_LABELS,
  matchesFilters, computeKpi, buildWaveDetail, buildManagersPerWave, storeCardHtml, buildHaystack,
} from './rollout-lib.js';

const ROOT_ID = 'rollout-waves-main-root';
const ACTIONS_ID = 'rollout-waves-main-actions';
const PAGE_SIZE = 100;

const IMPORT_LIMIT_MB = { training: 10, webinar: 10 };
const IMPORT_TITLES = {
  training: 'Import training',
  webinar: 'Import webinar',
};
const IMPORT_DESCS = {
  training: 'Upload an .xlsx file with location codes in column A (header in row 1) - marks those locations as trained.',
  webinar: 'Upload an .xlsx file with location codes in column A (header in row 1) - marks those locations as having attended the webinar.',
};

// ── module-scope state (one view instance for the whole app session) ──────

let _deps = null;
let _dsModal = null; // '/js/ds-modal.js' namespace once loaded, else null
let _dsSelect = null; // '/js/ds-select.js' namespace once loaded, else null

let _data = null; // last GET /dashboard answer
let _loadError = null; // last load failure, only meaningful while _data is null
let _mounted = false; // true once the root has been populated at least once

let _activeWave = 'all'; // 'all' | 'N' (string, matches matchesFilters' contract)
let _filters = { search: '', district: '', manager: '', partner: '' };
let _shown = PAGE_SIZE;

let _managersGapList = []; // [{ manager, stores }] behind the gap modal
let _importKind = null; // 'training' | 'webinar'
let _importFile = null;
let _actionsClickHandler = null; // click listener wired onto the header actions slot

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/rollout-waves') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

/**
 * Thousands separator with a plain ASCII space - deliberately not
 * toLocaleString(), which can emit U+00A0 (non-breaking space): the same
 * number is printed here AND in the KPI bar, and a verifier comparing the two
 * as text must see identical bytes, not a visually-identical look-alike.
 */
function fmt(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  const sign = num < 0 ? '-' : '';
  const digits = String(Math.trunc(Math.abs(num)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * `trigger` is always forwarded as an opts object (even when undefined) so
 * js/ds-modal.js's dismiss layer (Escape, overlay click, focus return) is
 * always active - this module's own duplicate Escape handler is gone (see
 * `_ensureCleanup`).
 */
function _openModal(el, trigger) {
  if (!el) return;
  if (_dsModal && typeof _dsModal.openDsModal === 'function') { _dsModal.openDsModal(el, { trigger }); return; }
  el.hidden = false;
  el.classList.add('open');
}

function _closeModal(el) {
  if (!el) return;
  if (_dsModal && typeof _dsModal.closeDsModal === 'function') { _dsModal.closeDsModal(el); return; }
  el.classList.remove('open');
  el.hidden = true;
}

function _closeAllModals(root) {
  if (!root) return;
  root.querySelectorAll('.ds-modal-overlay.open').forEach((el) => _closeModal(el));
}

function _copyIconSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
    + ' stroke-linejoin="round" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
}

function _emptyHtml(title, desc) {
  return '<div class="ds-empty">'
    + '<div class="ds-empty-title">' + esc(title) + '</div>'
    + '<div class="ds-empty-desc">' + esc(desc) + '</div>'
    + '</div>';
}

// ── derived data ─────────────────────────────────────────────────────────

function _allStores() {
  return (_data && Array.isArray(_data.stores)) ? _data.stores : [];
}

function _filteredStores() {
  const f = { activeWave: _activeWave, ..._filters };
  return _allStores().filter((s) => matchesFilters(s, f));
}

function _currentBranch() {
  if (!_data) return _loadError ? 'error' : 'loading';
  if (_data.available === false) return 'unavailable';
  if (!_data.directory || _data.directory.present === false) return 'no-directory';
  if (_data.kpi && _data.kpi.locations_count === 0) return 'empty';
  return 'data';
}

// ── skeleton (first paint, before GET /dashboard answers) ─────────────────

function _skeletonHtml() {
  const kpiCard = '<div class="ds-card rollout-waves-kpi-card"><div class="ds-card-body">'
    + '<span class="ds-skeleton rollout-waves-skel-title"></span>'
    + '<span class="ds-skeleton rollout-waves-skel-value"></span></div></div>';
  const headerCells = ['Status', 'Code', 'Wave', 'District', 'Manager', 'Partner', 'Operator', 'City', 'Training', 'Webinar']
    .map((h) => '<th>' + esc(h) + '</th>').join('');
  const skelRow = '<tr>' + '<td><span class="ds-skeleton rollout-waves-skel-row"></span></td>'.repeat(10) + '</tr>';

  return '<div class="rollout-waves-kpi-bar">' + kpiCard.repeat(6) + '</div>'
    + '<div class="ds-card rollout-waves-nearest-card"><div class="ds-card-body">'
    + '<span class="ds-skeleton rollout-waves-skel-nearest"></span></div></div>'
    + '<div class="rollout-waves-seg-row"><span class="ds-skeleton rollout-waves-skel-seg"></span></div>'
    + '<div class="rollout-waves-filters">'
    + '<span class="ds-skeleton rollout-waves-skel-filter-input"></span>'
    + '<span class="ds-skeleton rollout-waves-skel-filter-select"></span>'
    + '<span class="ds-skeleton rollout-waves-skel-filter-select"></span>'
    + '<span class="ds-skeleton rollout-waves-skel-filter-select"></span>'
    + '</div>'
    + '<div class="ds-table-wrap rollout-waves-table-wrap"><table class="ds-table rollout-waves-table">'
    + '<thead><tr>' + headerCells + '</tr></thead><tbody>' + skelRow.repeat(8) + '</tbody></table></div>';
}

// ── header actions slot ───────────────────────────────────────────────────
//
// This view exists to READ the rollout table, not to import files - two
// imports of equal weight and a local-data refresh, none of them the
// action the view is for, so none is `ds-btn--primary`.

/**
 * @param {string} [branch] `_currentBranch()`, or undefined for the
 *   skeleton (painted before the first `GET /dashboard` answer lands).
 */
function _actionsHtml(branch) {
  if (branch === undefined) {
    return '<button type="button" class="ds-btn ds-btn--secondary" disabled data-skel="1">Import training</button>'
      + '<button type="button" class="ds-btn ds-btn--secondary" disabled data-skel="1">Import webinar</button>'
      + '<button type="button" class="ds-btn ds-btn--secondary" disabled data-skel="1">Refresh</button>';
  }
  const noRepo = branch === 'unavailable' || branch === 'loading' || branch === 'error';
  const noDirectory = branch === 'no-directory';
  const codesDisabled = noRepo || noDirectory;
  return '<button type="button" class="ds-btn ds-btn--secondary" data-rd-import-open data-import-kind="training"'
    + (codesDisabled ? ' disabled' : '') + '>Import training</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-rd-import-open data-import-kind="webinar"'
    + (codesDisabled ? ' disabled' : '') + '>Import webinar</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-rd-refresh>Refresh</button>';
}

/**
 * Paints `#rollout-waves-main-actions`, a sibling of `.view-data`
 * (js/module-host.js `_createViewSection`) - outside `#rollout-waves-
 * main-root`, so it survives none of `root`'s own repaints and must be
 * painted here, on every `_paintPage`, never only on `_mount`.
 */
function _paintActions(branch) {
  const slot = document.getElementById(ACTIONS_ID);
  if (!slot) return;
  slot.innerHTML = _actionsHtml(branch);
}

// ── diagnostics ─────────────────────────────────────────────────────────

function _diagnosticsHtml() {
  const diag = (_data && _data.diagnostics) || null;
  _managersGapList = (diag && Array.isArray(diag.managers_out_of_config_list)) ? diag.managers_out_of_config_list : [];
  const outOfConfig = (diag && diag.managers_out_of_config) || 0;
  const noMatch = (diag && diag.managers_no_match) || 0;
  const vacantNoWave = (diag && diag.vacant_no_wave) || 0;
  const vacantList = (diag && Array.isArray(diag.vacant_no_wave_list)) ? diag.vacant_no_wave_list : [];
  if (!diag || (outOfConfig === 0 && noMatch === 0 && vacantNoWave === 0)) return '<div id="rollout-waves-diagnostics"></div>';

  const clickable = _managersGapList.length > 0;
  const triggerAttrs = clickable
    ? ' id="rollout-waves-diagnostics-gap-trigger" role="button" tabindex="0" aria-label="Show the managers outside the plan"'
    : '';
  let text = '<strong>Manager -&gt; wave mapping mismatch.</strong> ';
  if (outOfConfig > 0) {
    text += 'Open locations with a manager outside the configuration: <strong>' + fmt(outOfConfig) + '</strong>'
      + (clickable ? ' - click to see the managers' : '') + '. ';
  }
  if (noMatch > 0) {
    text += 'Managers in the configuration with no matching location: <strong>' + fmt(noMatch) + '</strong>. ';
  }
  if (vacantNoWave > 0) {
    // A Vacant key is a config line, not a person, so it may be named here.
    text += 'Vacant locations counted in the total but with no wave: <strong>' + fmt(vacantNoWave) + '</strong> - add to the wave configuration: '
      + vacantList.map((w) => '<strong>' + esc(w.manager) + '</strong> (' + fmt(w.stores) + ')').join(', ') + '.';
  }
  return '<div id="rollout-waves-diagnostics"><div class="ds-callout ds-callout--warning'
    + (clickable ? ' rollout-waves-diagnostics-clickable' : '') + '"' + triggerAttrs + '>'
    + '<div>' + text + '</div></div></div>';
}

// ── KPI bar ─────────────────────────────────────────────────────────────

function _kpiCardHtml(title, value, sub) {
  return '<div class="ds-card rollout-waves-kpi-card">'
    + '<div class="ds-card-header"><div class="ds-card-title">' + esc(title) + '</div></div>'
    + '<div class="ds-card-body">'
    + '<div class="rollout-waves-kpi-value">' + value + '</div>'
    + (sub ? '<div class="rollout-waves-kpi-sub">' + sub + '</div>' : '')
    + '</div></div>';
}

function _kpiBarHtml() {
  const kpi = computeKpi(_filteredStores());
  const pctCls = kpi.progress_pct >= 80 ? 'green' : (kpi.progress_pct >= 50 ? 'yellow' : 'red');
  const progressHtml = '<div class="ds-card rollout-waves-kpi-card">'
    + '<div class="ds-card-header"><div class="ds-card-title">Progress</div></div>'
    + '<div class="ds-card-body"><div class="ds-progress">'
    + '<div class="ds-progress-labels"><span>' + esc(fmtPct(kpi.progress_pct)) + '</span></div>'
    + '<div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--' + pctCls + '"'
    + ' style="width:' + Math.min(kpi.progress_pct, 100) + '%"></div></div>'
    + '</div></div></div>';

  return '<div class="rollout-waves-kpi-bar" data-rd-kpi>'
    + _kpiCardHtml('Locations', fmt(kpi.locations_count), kpi.no_wave ? 'of which no wave: ' + fmt(kpi.no_wave) : '')
    + _kpiCardHtml('Live', fmt(kpi.live))
    + _kpiCardHtml('To go live', fmt(kpi.to_go_live))
    + progressHtml
    + _kpiCardHtml('Training', fmt(kpi.trainings_done) + ' / ' + fmt(kpi.trainings_total))
    + _kpiCardHtml('Webinar', fmt(kpi.webinar_done) + ' / ' + fmt(kpi.webinar_total))
    + '</div>';
}

// ── nearest wave ────────────────────────────────────────────────────────

function _nearestHtml() {
  const n = _data && _data.next_start;
  if (!n) return '';
  return '<div class="ds-card rollout-waves-nearest-card">'
    + '<div class="ds-card-header"><div class="ds-card-title">Next start</div></div>'
    + '<div class="ds-card-body"><div class="rollout-waves-nearest-body">'
    + '<span class="ds-badge ds-badge--brand">W' + esc(String(n.wave)) + '</span>'
    + '<span>Start: <strong>' + esc(fmtDate(n.start)) + '</strong></span>'
    + '<span>Training: ' + esc(fmtDate(n.training_start)) + ' — ' + esc(fmtDate(n.training_end)) + '</span>'
    + '<span>Webinar: ' + esc(fmtDate(n.webinar_date)) + '</span>'
    + '<span>Locations: <strong>' + fmt(n.locations_count) + '</strong></span>'
    + '</div></div></div>';
}

// ── wave segmented control + table/managers buttons ─────────────────────

function _segRowHtml() {
  const waves = (_data && Array.isArray(_data.waves)) ? _data.waves : [];
  let segs = '<button type="button" class="ds-segment' + (_activeWave === 'all' ? ' active' : '')
    + '" data-wave="all">All</button>';
  for (const t of waves) {
    const active = String(t.wave) === _activeWave ? ' active' : '';
    segs += '<button type="button" class="ds-segment' + active + '" data-wave="' + esc(String(t.wave)) + '">'
      + 'W' + esc(String(t.wave)) + '</button>';
  }
  return '<div class="rollout-waves-seg-row">'
    + '<div class="ds-segmented rollout-waves-wave-seg" id="rollout-waves-wave-seg" data-rd-seg>' + segs + '</div>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="rollout-waves-waves-table-btn" data-rd-waves-btn>Waves table</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="rollout-waves-managers-per-wave-btn" data-rd-managers-per-wave-btn>Managers per wave</button>'
    + '</div>';
}

// ── filters ─────────────────────────────────────────────────────────────

function _optionsHtml(values, current, allLabel) {
  let html = '<option value="">' + esc(allLabel) + '</option>';
  for (const v of values) {
    html += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
  }
  return html;
}

function _filtersHtml() {
  const stores = _allStores();
  const districts = Array.from(new Set(stores.map((s) => s.district).filter((v) => v && v !== '-'))).sort((a, b) => a.localeCompare(b, 'en'));
  const managerNames = Array.from(new Set(stores.map((s) => s.manager).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en'));
  const partnerNames = Array.from(new Set(stores.map((s) => s.partner).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en'));
  if (!districts.includes(_filters.district)) _filters.district = '';
  if (!managerNames.includes(_filters.manager)) _filters.manager = '';
  if (!partnerNames.includes(_filters.partner)) _filters.partner = '';

  return '<div class="rollout-waves-filters">'
    + '<input type="search" class="ds-input rollout-waves-filter-input" data-rd-filter-search value="' + esc(_filters.search) + '"'
    // The placeholder is a short, guaranteed-to-fit sample (the field itself
    // is 420px, and a longer sentence here would clip mid-word, which
    // defeats the whole point of one field over two); the aria-label carries
    // the full six-field list for anyone using a screen reader, where width
    // is not a constraint.
    + ' placeholder="Search: location, city, operator, manager..."'
    + ' aria-label="Search by location code, city, operator, manager, partner or district" autocomplete="off">'
    + '<select class="ds-input rollout-waves-filter-select" data-rd-filter-district aria-label="Filter by district">'
    + _optionsHtml(districts, _filters.district, 'All districts') + '</select>'
    + '<select class="ds-input rollout-waves-filter-select" data-rd-filter-manager aria-label="Filter by manager">'
    + _optionsHtml(managerNames, _filters.manager, 'All managers') + '</select>'
    + '<select class="ds-input rollout-waves-filter-select" data-rd-filter-partner aria-label="Filter by partner">'
    + _optionsHtml(partnerNames, _filters.partner, 'All partners') + '</select>'
    + '</div>';
}

// ── stores table + mobile cards ──────────────────────────────────────────

function _storeRowHtml(s) {
  const badgeCls = statusBadgeClass(s.rollout_status);
  const label = STATUS_LABELS[s.rollout_status] || '—';
  const waveLabel = (s.wave !== null && s.wave !== undefined) ? 'W' + esc(String(s.wave)) : '—';
  const doneBadge = (done) => (done
    ? '<span class="ds-badge ds-badge--green ds-badge--sm">Yes</span>'
    : '<span class="ds-badge ds-badge--gray ds-badge--sm">No</span>');
  return '<tr>'
    + '<td><span class="ds-badge ' + badgeCls + ' ds-badge--sm">' + esc(label) + '</span></td>'
    + '<td><code>' + esc(s.code) + '</code></td>'
    + '<td>' + waveLabel + '</td>'
    + '<td>' + esc(s.district || '-') + '</td>'
    + '<td>' + esc(s.manager || '') + '</td>'
    + '<td>' + esc(s.partner || '') + '</td>'
    + '<td>' + esc(s.operator || '') + '</td>'
    + '<td>' + esc(s.city || '') + '</td>'
    + '<td>' + doneBadge(s.training_done) + '</td>'
    + '<td>' + doneBadge(s.webinar_done) + '</td>'
    + '</tr>';
}

/**
 * "Locations (N)" leads with the FILTERED count on purpose - it is the same
 * number the KPI bar shows for "Locations" (both read off
 * filteredStores()), so the two must never disagree. Pagination and the
 * filtered-out total are supplementary information appended after it, never
 * folded into the leading number.
 */
function _countLabel(visibleCount, filteredCount, total) {
  let label = 'Locations (' + fmt(filteredCount) + ')';
  if (visibleCount < filteredCount) label += ' - showing ' + fmt(visibleCount);
  if (filteredCount !== total) label += ' (filtered from ' + fmt(total) + ')';
  return label;
}

function _tableSectionHtml() {
  const total = _allStores().length;
  const rows = _filteredStores();
  const headerCells = ['Status', 'Code', 'Wave', 'District', 'Manager', 'Partner', 'Operator', 'City', 'Training', 'Webinar']
    .map((h) => '<th>' + esc(h) + '</th>').join('');

  if (rows.length === 0) {
    const empty = _emptyHtml('No locations match these filters', 'Change the filters or clear the search.');
    const countText = _countLabel(0, 0, total);
    return '<div class="rollout-waves-count" data-rd-count>' + esc(countText) + '</div>'
      + '<div class="ds-table-wrap rollout-waves-table-wrap" data-rd-table-wrap><table class="ds-table rollout-waves-table">'
      + '<thead><tr>' + headerCells + '</tr></thead><tbody><tr><td colspan="10">' + empty + '</td></tr></tbody></table></div>'
      + '<div class="rollout-waves-stores-cards" data-rd-cards>' + empty + '</div>'
      + '<div class="rollout-waves-load-more-wrap" data-rd-load-more-wrap hidden></div>';
  }

  const visibleCount = Math.min(_shown, rows.length);
  const visibleRows = rows.slice(0, visibleCount);
  const countText = _countLabel(visibleCount, rows.length, total);
  const bodyHtml = visibleRows.map(_storeRowHtml).join('');
  const cardsHtml = visibleRows.map(storeCardHtml).join('');
  const loadMoreHidden = visibleCount >= rows.length;

  return '<div class="rollout-waves-count" data-rd-count>' + esc(countText) + '</div>'
    + '<div class="ds-table-wrap rollout-waves-table-wrap" data-rd-table-wrap><table class="ds-table rollout-waves-table">'
    + '<thead><tr>' + headerCells + '</tr></thead><tbody data-rd-table-body>' + bodyHtml + '</tbody></table></div>'
    + '<div class="rollout-waves-stores-cards" data-rd-cards>' + cardsHtml + '</div>'
    + '<div class="rollout-waves-load-more-wrap" data-rd-load-more-wrap' + (loadMoreHidden ? ' hidden' : '') + '>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-rd-load-more>Show the next 100</button></div>';
}

// ── body (branch-specific content under the toolbar) ────────────────────

function _bodyHtml(branch) {
  if (branch === 'loading') {
    // Unreachable in normal operation - _mount() only calls _paintPage()
    // once _reloadData() has settled into 'error' or a real answer - kept as
    // a defensive branch so a future call site cannot silently fall through
    // to the 'data' branch and paint KPI cards for a null dataset.
    return _skeletonHtml();
  }
  if (branch === 'error') {
    return '<div class="ds-callout ds-callout--danger"><div>'
      + esc('Could not load the rollout data' + (_loadError && _loadError.message ? ': ' + _loadError.message : '.'))
      + '</div></div>';
  }
  if (branch === 'unavailable') {
    return '<div class="ds-callout ds-callout--warning"><div>The team data repository is not on this computer yet. '
      + 'Fetch it from the sync panel on the top bar and come back here.</div></div>';
  }
  if (branch === 'no-directory') {
    return '<div class="ds-callout ds-callout--info"><div>There is no locations directory in the team data on this computer yet. '
      + 'Pull the team data from the sync panel on the top bar (or import it on the Locations page) and come back here.</div></div>';
  }
  if (branch === 'empty') {
    return _diagnosticsHtml()
      + _emptyHtml('No location made it into the plan', 'Check that the locations\' managers have waves assigned in the configuration.');
  }
  // 'data'
  return _diagnosticsHtml() + _kpiBarHtml() + _nearestHtml() + _segRowHtml() + _filtersHtml()
    + '<div data-rd-table-section>' + _tableSectionHtml() + '</div>';
}

// ── import modal (static shell, filled/emptied via direct element refs) ─────

function _importModalHtml() {
  return '<div id="rollout-waves-import-modal-overlay" class="ds-modal-overlay" hidden>'
    + '<div class="ds-modal ds-modal--md" role="dialog" aria-modal="true" aria-label="Import">'
    + '<div class="ds-modal-header">'
    + '<span class="ds-modal-title" data-rd-import-title></span>'
    + '<button type="button" class="ds-modal-close" data-modal-close aria-label="Close">&times;</button>'
    + '</div>'
    + '<div class="ds-modal-body">'
    + '<p data-rd-import-desc></p>'
    + '<div class="rollout-waves-dropzone" data-rd-import-dropzone tabindex="0" role="button" aria-label="Choose an .xlsx file">'
    + '<span>Drop an .xlsx file here or click to choose one</span>'
    + '</div>'
    + '<input type="file" accept=".xlsx" data-rd-import-file-input hidden>'
    + '<div class="rollout-waves-import-filename" data-rd-import-filename hidden></div>'
    + '<div class="rollout-waves-import-result" data-rd-import-result hidden></div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-rd-import-save disabled>Import</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-rd-import-cancel>Cancel</button>'
    + '</div></div></div>';
}

function _openImportModal(root, kind, trigger) {
  _importKind = kind;
  _importFile = null;
  const overlay = root.querySelector('#rollout-waves-import-modal-overlay');
  if (!overlay) return;
  const title = overlay.querySelector('[data-rd-import-title]');
  const desc = overlay.querySelector('[data-rd-import-desc]');
  const filenameRow = overlay.querySelector('[data-rd-import-filename]');
  const resultBox = overlay.querySelector('[data-rd-import-result]');
  const saveBtn = overlay.querySelector('[data-rd-import-save]');
  const fileInput = overlay.querySelector('[data-rd-import-file-input]');

  if (title) title.textContent = IMPORT_TITLES[kind] || 'Import';
  if (desc) desc.textContent = IMPORT_DESCS[kind] || '';
  if (filenameRow) { filenameRow.hidden = true; filenameRow.textContent = ''; }
  if (resultBox) { resultBox.hidden = true; resultBox.innerHTML = ''; }
  if (saveBtn) saveBtn.disabled = true;
  if (fileInput) fileInput.value = '';

  _openModal(overlay, trigger);
}

function _closeImportModal(root) {
  const overlay = root.querySelector('#rollout-waves-import-modal-overlay');
  _closeModal(overlay);
  _importFile = null;
}

function _handleFileSelected(root, file) {
  _importFile = file || null;
  const overlay = root.querySelector('#rollout-waves-import-modal-overlay');
  if (!overlay) return;
  const filenameRow = overlay.querySelector('[data-rd-import-filename]');
  const saveBtn = overlay.querySelector('[data-rd-import-save]');
  if (filenameRow) {
    filenameRow.hidden = !file;
    filenameRow.textContent = file ? file.name : '';
  }
  if (saveBtn) saveBtn.disabled = !file;
}

/**
 * Reads a File into a bare base64 string (no data: prefix), through the data
 * URL FileReader already builds rather than a manual byte loop -
 * String.fromCharCode.apply(null, bigArray) blows the call stack on a real
 * file, and Uint8Array/atob are not browser globals eslint.config.mjs grants
 * to modules/*\/client/**\/*.js.
 */
function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

/** Maps a known error CODE to a sentence a person reads; falls back to the server message for anything else. */
function _importErrorMessage(kind, status, json) {
  const code = json && json.error;
  const limit = IMPORT_LIMIT_MB[kind] || 10;
  const map = {
    'repo-missing': 'The team data repository is not on this computer - fetch it from the sync panel on the top bar.',
    busy: 'This import is already running - try again in a moment.',
    'bad-file-name': 'The file name is invalid - choose an .xlsx file.',
    'too-large': 'The file is too large - the limit is ' + limit + ' MB.',
    'empty-file': 'The chosen file is empty.',
    'directory-missing': 'There is no locations directory yet - pull the team data from the sync panel on the top bar.',
    'bad-xlsx': 'Could not read the sheet - check that this is a valid .xlsx file.',
    'zip-unavailable': 'The server could not load the .xlsx unpacker.',
    'import-failed': 'The import failed.',
  };
  if (code && map[code]) return map[code];
  return (json && json.message) || ('The server answered ' + status + '.');
}

async function _handleImportSave(root) {
  const overlay = root.querySelector('#rollout-waves-import-modal-overlay');
  const saveBtn = overlay && overlay.querySelector('[data-rd-import-save]');
  const resultBox = overlay && overlay.querySelector('[data-rd-import-result]');
  if (!saveBtn || !_importFile || !_importKind) return;
  const kind = _importKind;
  const file = _importFile;

  // Checked BEFORE encoding and treated as the reliable path, not a nicety:
  // the core's own body reader (server/index.js readBodyBinary) discards
  // bytes past its limit rather than destroying the connection, so an
  // oversize upload's own 413 answer can still be lost in flight - this is
  // what actually tells the person why nothing happened.
  const limitMb = IMPORT_LIMIT_MB[kind] || 10;
  if (file.size > limitMb * 1024 * 1024) {
    const message = 'The file is too large (at most ' + limitMb + ' MB) - choose a smaller file.';
    if (resultBox) {
      resultBox.hidden = false;
      resultBox.innerHTML = '<div class="ds-callout ds-callout--danger"><div>' + esc(message) + '</div></div>';
    }
    _toast('danger', 'File too large', message);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.setAttribute('aria-busy', 'true');
  try {
    const plikBase64 = await _fileToBase64(file);
    const res = await fetch(_api('/import-' + kind), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, file_base64: plikBase64 }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.status !== 'ok') {
      const message = _importErrorMessage(kind, res.status, json);
      if (resultBox) {
        resultBox.hidden = false;
        resultBox.innerHTML = '<div class="ds-callout ds-callout--danger"><div>' + esc(message) + '</div></div>';
      }
      _toast('danger', 'Import error', message);
      return;
    }

    const unknownArr = Array.isArray(json.unknown) ? json.unknown : [];
    let summary = 'Imported: ' + fmt(json.imported) + '. Unknown location codes: ' + fmt(unknownArr.length) + '.';
    if (unknownArr.length > 0) {
      summary += '<div class="rollout-waves-import-unknown-list">'
        + unknownArr.slice(0, 50).map((code) => '<span class="ds-badge ds-badge--gray ds-badge--sm">' + esc(code) + '</span>').join('')
        + '</div>';
    }
    if (resultBox) {
      resultBox.hidden = false;
      resultBox.innerHTML = '<div class="ds-callout ds-callout--success"><div>' + summary
        + '<div>The data is saved on this computer - send the changes from the top bar so they reach the team.</div>'
        + '</div></div>';
    }
    _toast('success', 'Import finished', 'The changes reach the team once sent from the top bar.');

    // The import rewrote data-tier-0's rollout-waves/: announce it on the
    // core's data bus, so the core repaints the module sync bar (local date,
    // pending files) and calls onDataChanged() below - the same reload +
    // repaint as before, with the import modal and its summary left open.
    // Dynamic import keeps this file importable under plain Node.
    try {
      const ev = await import('/js/data-events.js');
      ev.emitDataChanged({ source: 'rollout-waves' });
    } catch {
      await _reloadData();
      _paintPage(root);
    }
  } catch (e) {
    _toast('danger', 'Connection error', e.message || '');
    if (resultBox) {
      resultBox.hidden = false;
      resultBox.innerHTML = '<div class="ds-callout ds-callout--danger"><div>' + esc(e.message || 'Unknown error.') + '</div></div>';
    }
  } finally {
    saveBtn.disabled = !_importFile;
    saveBtn.removeAttribute('aria-busy');
  }
}

// ── waves table modal ──────────────────────────────────────────────────────

function _wavePanelToolbarHtml(waveAttr, panelName, hasData) {
  if (!hasData) return '';
  return '<div class="rollout-waves-panel-toolbar">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm rollout-waves-copy-btn" data-copy-wave="' + waveAttr
    + '" data-copy-panel="' + panelName + '">' + _copyIconSvg() + '<span>Copy</span></button></div>';
}

function _detailListHtml(items) {
  if (!items.length) return '<div class="rollout-waves-detail-empty">No data.</div>';
  return '<div class="rollout-waves-detail-list">'
    + items.map((v) => '<span class="ds-badge ds-badge--gray ds-badge--sm">' + esc(v) + '</span>').join('')
    + '</div>';
}

function _expanderPanelsHtml(detail, waveN) {
  const waveAttr = esc(String(waveN));
  const hasManagerData = detail.managers.length > 0 || detail.partners.length > 0 || detail.districts.length > 0;
  const managersBody = hasManagerData
    ? '<div class="rollout-waves-panel-body">'
      + '<div class="rollout-waves-detail-section"><div class="rollout-waves-detail-heading">Managers</div>'
      + _detailListHtml(detail.managers) + '</div>'
      + '<div class="rollout-waves-detail-section"><div class="rollout-waves-detail-heading">Partners</div>'
      + _detailListHtml(detail.partners) + '</div>'
      + '<div class="rollout-waves-detail-section"><div class="rollout-waves-detail-heading">Districts</div>'
      + _detailListHtml(detail.districts) + '</div></div>'
    : _emptyHtml('No data', 'This wave has no locations assigned yet.');

  const locationsBody = detail.locations.length > 0
    ? '<div class="rollout-waves-panel-body">'
      + '<div class="rollout-waves-detail-section"><div class="rollout-waves-detail-heading">Location codes</div>'
      + _detailListHtml(detail.locations) + '</div></div>'
    : _emptyHtml('No locations', 'This wave has no locations assigned yet.');

  // Both panels are always shown together once the row expands, each with
  // its own Copy button - no per-panel hide/show, just the one
  // expand/collapse on the whole row.
  return '<div class="rollout-waves-expander-panels" data-panel="managers">'
    + _wavePanelToolbarHtml(waveAttr, 'managers', hasManagerData) + managersBody + '</div>'
    + '<div class="rollout-waves-expander-panels" data-panel="locations">'
    + _wavePanelToolbarHtml(waveAttr, 'locations', detail.locations.length > 0) + locationsBody + '</div>';
}

function _wavesModalBodyHtml() {
  const waves = (_data && Array.isArray(_data.waves)) ? _data.waves : [];
  if (waves.length === 0) {
    return '<tr><td colspan="8">' + _emptyHtml('No wave data', 'Click Refresh to recompute the wave dates.') + '</td></tr>';
  }
  const allStores = _allStores();
  return waves.map((t) => {
    const badgeCls = statusBadgeClass(t.status);
    const label = WAVE_STATUS_LABELS[t.status] || t.status;
    const waveAttr = esc(String(t.wave));
    const detail = buildWaveDetail(allStores, t.wave);
    const rowCls = String(t.wave) === _activeWave ? ' class="rollout-waves-row-active"' : '';
    return '<tr' + rowCls + '>'
      + '<td><span class="rollout-waves-wave-cell-clickable" role="button" tabindex="0" data-wave="' + waveAttr
      + '" data-panel="managers">W' + waveAttr + '</span></td>'
      + '<td>' + esc(fmtDate(t.start)) + '</td>'
      + '<td>' + esc(fmtDate(t.training_start)) + ' — ' + esc(fmtDate(t.training_end)) + '</td>'
      + '<td>' + esc(fmtDate(t.webinar_date)) + '</td>'
      + '<td class="right"><span class="rollout-waves-locations-cell-clickable" role="button" tabindex="0" data-wave="' + waveAttr
      + '" data-panel="locations">' + fmt(t.locations_count) + '</span></td>'
      + '<td class="right">' + esc(fmtPct(t.pct_training)) + '</td>'
      + '<td class="right">' + esc(fmtPct(t.pct_webinar)) + '</td>'
      + '<td><span class="ds-badge ' + badgeCls + ' ds-badge--sm">' + esc(label) + '</span></td>'
      + '</tr>'
      + '<tr class="rollout-waves-expander-row" data-wave="' + waveAttr + '" hidden>'
      + '<td colspan="8">' + _expanderPanelsHtml(detail, t.wave) + '</td></tr>';
  }).join('');
}

function _wavesModalHtml() {
  const headers = ['Wave', 'Start', 'Training from-to', 'Webinar', 'Locations', '% training', '% webinar', 'Status']
    .map((h) => '<th>' + esc(h) + '</th>').join('');
  return '<div id="rollout-waves-waves-modal-overlay" class="ds-modal-overlay" hidden>'
    + '<div class="ds-modal ds-modal--xl" role="dialog" aria-modal="true" aria-label="Waves table">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Waves table</span>'
    + '<button type="button" class="ds-modal-close" data-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body"><div class="ds-table-wrap"><table class="ds-table">'
    + '<thead><tr>' + headers + '</tr></thead><tbody data-rd-waves-body>' + _wavesModalBodyHtml() + '</tbody>'
    + '</table></div></div></div></div>';
}

/** Both triggers on a wave row (the "T<n>" cell and the store-count cell) open the same expander row. */
function _toggleWaveExpander(trigger) {
  const dataRow = trigger.closest('tr');
  const expandRow = dataRow ? dataRow.nextElementSibling : null;
  if (!expandRow || !expandRow.classList.contains('rollout-waves-expander-row')) return;
  expandRow.hidden = !expandRow.hidden;
}

function _copyWaveDetail(waveNum, panelName) {
  const detail = buildWaveDetail(_allStores(), waveNum);
  const text = panelName === 'locations'
    ? detail.locations.join('\n')
    : ['Managers:', ...detail.managers, '', 'Partners:', ...detail.partners, '', 'Districts:', ...detail.districts].join('\n');

  navigator.clipboard.writeText(text)
    .then(() => _toast('success', 'Copied', 'The list was copied to the clipboard.'))
    .catch(() => _toast('danger', 'Copy failed', 'Could not copy the list to the clipboard.'));
}

// ── managers per wave modal ─────────────────────────────────────────────────

function _managersPerWaveModalHtml() {
  const groups = buildManagersPerWave(_allStores(), (_data && _data.waves) || []);
  const rows = [];
  for (const g of groups) {
    for (const r of g.rows) {
      rows.push('<tr><td>W' + esc(String(g.wave)) + '</td><td>' + esc(r.manager) + '</td><td>' + esc(r.districts) + '</td></tr>');
    }
  }
  const body = rows.length
    ? rows.join('')
    : '<tr><td colspan="3">' + _emptyHtml('No data', 'Click Refresh to recompute the rollout plan.') + '</td></tr>';
  return '<div id="rollout-waves-managers-per-wave-modal-overlay" class="ds-modal-overlay" hidden>'
    + '<div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true" aria-label="Managers per wave">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Managers per wave</span>'
    + '<button type="button" class="ds-modal-close" data-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body"><div class="ds-table-wrap"><table class="ds-table">'
    + '<thead><tr><th>Wave</th><th>Manager</th><th>Districts</th></tr></thead><tbody>' + body + '</tbody>'
    + '</table></div></div></div></div>';
}

// ── managerNames spoza planu (gap) modal ──────────────────────────────────

function _managersGapModalHtml() {
  const body = _managersGapList.length
    ? _managersGapList.map((m) => '<tr><td>' + esc(m.manager) + '</td><td class="right">' + fmt(m.stores) + '</td></tr>').join('')
    : '<tr><td colspan="2">' + _emptyHtml('No mismatch', 'Every manager of an open location is in the plan.') + '</td></tr>';
  return '<div id="rollout-waves-managers-gap-modal-overlay" class="ds-modal-overlay" hidden>'
    + '<div class="ds-modal ds-modal--md" role="dialog" aria-modal="true" aria-label="Managers outside the plan">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Managers outside the plan</span>'
    + '<button type="button" class="ds-modal-close" data-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body"><div class="ds-table-wrap"><table class="ds-table">'
    + '<thead><tr><th>Manager</th><th class="right">Locations</th></tr></thead><tbody>' + body + '</tbody>'
    + '</table></div></div></div></div>';
}

// ── paint orchestration ───────────────────────────────────────────────────

function _enhanceSelects(root) {
  if (!_dsSelect || typeof _dsSelect.initSelect !== 'function') return;
  root.querySelectorAll('[data-rd-filter-district], [data-rd-filter-manager], [data-rd-filter-partner]').forEach((sel) => {
    try { _dsSelect.initSelect(sel); } catch { /* bare select still works */ }
  });
}

/** Full repaint of the branch-dependent page content. Never touches the import modal. */
function _paintPage(root) {
  const branch = _currentBranch();
  _paintActions(branch);
  const page = root.querySelector('[data-rd-page]');
  if (!page) return;
  page.innerHTML = '<div data-rd-body>' + _bodyHtml(branch) + '</div>';
  _enhanceSelects(root);

  const wavesModal = root.querySelector('[data-rd-waves-modal]');
  if (wavesModal) wavesModal.innerHTML = _wavesModalHtml();
  const managersModal = root.querySelector('[data-rd-managers-modal]');
  if (managersModal) managersModal.innerHTML = _managersPerWaveModalHtml();
  const gapModal = root.querySelector('[data-rd-gap-modal]');
  if (gapModal) gapModal.innerHTML = _managersGapModalHtml();
}

/** Partial repaint for filter/segment/pagination changes - keeps input focus and the toolbar intact. */
function _paintFilteredSections(root) {
  const kpi = root.querySelector('[data-rd-kpi]');
  if (kpi) kpi.outerHTML = _kpiBarHtml();

  // Everything from the count line to the load-more button lives inside this
  // one persistent wrapper (written once by _bodyHtml's 'data' branch) - a
  // plain innerHTML swap here re-renders the table/cards/count/load-more
  // together, including the "no rows match" branch that drops the table
  // entirely, without touching the toolbar or the filter inputs above it.
  const tableSection = root.querySelector('[data-rd-table-section]');
  if (tableSection) tableSection.innerHTML = _tableSectionHtml();

  const seg = root.querySelector('[data-rd-seg]');
  if (seg) {
    seg.querySelectorAll('.ds-segment').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.wave === _activeWave);
    });
  }
}

async function _reloadData() {
  try {
    const res = await fetch(_api('/dashboard'));
    if (!res.ok) throw new Error('The server answered ' + res.status);
    _data = await res.json();
    _loadError = null;
    // Precompute the search haystack ONCE per store here, right as the
    // payload lands - never per keystroke. This is the one call site every
    // path that can change the store list goes through (initial mount, the
    // "Refresh" refetch and the refetch that follows a successful import),
    // so search never runs stale against rows built from an older answer.
    if (_data && Array.isArray(_data.stores)) {
      for (const s of _data.stores) s.__haystack = buildHaystack(s);
    }
  } catch (e) {
    _loadError = e;
    if (!_data) _data = null;
  }
  // The wave/district/manager/partner selection survives a reload (this is the
  // same fetch a "just uploaded a file" reload and a plain "Refresh" click
  // both use) - only the page size resets, since a fresh answer may hold
  // fewer or more matching rows than were shown before.
  _shown = PAGE_SIZE;
}

async function _handleRefresh(root) {
  const btn = root.querySelector('[data-rd-refresh]');
  if (btn) btn.disabled = true;
  await _reloadData();
  _paintPage(root);
  if (_loadError) _toast('danger', 'Refresh failed', _loadError.message || '');
  else _toast('success', 'Refreshed', 'The rollout data was updated.');
  const freshBtn = root.querySelector('[data-rd-refresh]');
  if (freshBtn) freshBtn.disabled = false;
}

// ── root-level delegated listeners (wired once, survive every innerHTML swap) ──

function _onRootClick(e, root) {
  const refreshBtn = e.target.closest('[data-rd-refresh]');
  if (refreshBtn) { _handleRefresh(root); return; }

  const importOpen = e.target.closest('[data-rd-import-open]');
  if (importOpen) { _openImportModal(root, importOpen.dataset.importKind, importOpen); return; }

  const importCancel = e.target.closest('[data-rd-import-cancel]');
  if (importCancel) { _closeImportModal(root); return; }

  const importSave = e.target.closest('[data-rd-import-save]');
  if (importSave && !importSave.disabled) { _handleImportSave(root); return; }

  const dropzone = e.target.closest('[data-rd-import-dropzone]');
  if (dropzone) {
    const input = root.querySelector('[data-rd-import-file-input]');
    if (input) input.click();
    return;
  }

  const seg = e.target.closest('.ds-segment[data-wave]');
  if (seg && seg.closest('[data-rd-seg]')) {
    _activeWave = seg.dataset.wave;
    _shown = PAGE_SIZE;
    _paintFilteredSections(root);
    return;
  }

  const wavesBtn = e.target.closest('[data-rd-waves-btn]');
  if (wavesBtn) {
    const overlay = root.querySelector('#rollout-waves-waves-modal-overlay');
    _openModal(overlay, wavesBtn);
    return;
  }

  const managersBtn = e.target.closest('[data-rd-managers-per-wave-btn]');
  if (managersBtn) {
    const overlay = root.querySelector('#rollout-waves-managers-per-wave-modal-overlay');
    _openModal(overlay, managersBtn);
    return;
  }

  const gapTrigger = e.target.closest('#rollout-waves-diagnostics-gap-trigger');
  if (gapTrigger) {
    const overlay = root.querySelector('#rollout-waves-managers-gap-modal-overlay');
    _openModal(overlay, gapTrigger);
    return;
  }

  const loadMore = e.target.closest('[data-rd-load-more]');
  if (loadMore) {
    _shown += PAGE_SIZE;
    _paintFilteredSections(root);
    return;
  }

  const modalClose = e.target.closest('[data-modal-close]');
  if (modalClose) {
    const overlay = modalClose.closest('.ds-modal-overlay');
    _closeModal(overlay);
    if (overlay && overlay.id === 'rollout-waves-import-modal-overlay') _importFile = null;
    return;
  }

  const copyBtn = e.target.closest('.rollout-waves-copy-btn');
  if (copyBtn) { _copyWaveDetail(Number(copyBtn.dataset.copyWave), copyBtn.dataset.copyPanel); return; }

  const expandTrigger = e.target.closest('.rollout-waves-wave-cell-clickable, .rollout-waves-locations-cell-clickable');
  if (expandTrigger) { _toggleWaveExpander(expandTrigger); }
}

function _onRootKeydown(e, root) {
  const expandTrigger = e.target.closest
    && e.target.closest('.rollout-waves-wave-cell-clickable, .rollout-waves-locations-cell-clickable');
  if (expandTrigger && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); _toggleWaveExpander(expandTrigger); return; }
  const gapTrigger = e.target.closest && e.target.closest('#rollout-waves-diagnostics-gap-trigger');
  if (gapTrigger && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    _openModal(root.querySelector('#rollout-waves-managers-gap-modal-overlay'), gapTrigger);
    return;
  }
  const dropzone = e.target.closest && e.target.closest('[data-rd-import-dropzone]');
  if (dropzone && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    const input = root.querySelector('[data-rd-import-file-input]');
    if (input) input.click();
  }
}

function _onRootInput(e, root) {
  const search = e.target.closest('[data-rd-filter-search]');
  if (search) { _filters.search = search.value || ''; _shown = PAGE_SIZE; _paintFilteredSections(root); }
}

function _onRootChange(e, root) {
  const district = e.target.closest('[data-rd-filter-district]');
  if (district) { _filters.district = district.value || ''; _shown = PAGE_SIZE; _paintFilteredSections(root); return; }
  const manager = e.target.closest('[data-rd-filter-manager]');
  if (manager) { _filters.manager = manager.value || ''; _shown = PAGE_SIZE; _paintFilteredSections(root); return; }
  const partner = e.target.closest('[data-rd-filter-partner]');
  if (partner) { _filters.partner = partner.value || ''; _shown = PAGE_SIZE; _paintFilteredSections(root); return; }
  const fileInput = e.target.closest('[data-rd-import-file-input]');
  if (fileInput) _handleFileSelected(root, fileInput.files && fileInput.files[0]);
}

// The dropzone's own label promises drag-and-drop; without these two
// handlers a dropped file navigates the whole tab away (the browser's
// default action for a "drop" it never saw prevented) and the person loses
// the page. Delegated on root the same way click/keydown/input/change are,
// so a second entry into the view never re-wires them (_wireRootOnce's
// dataset guard already covers that).
function _onRootDragOver(e) {
  // Prevent the browser default (navigate the tab to the dropped file)
  // anywhere inside this view's root, not only over the dropzone itself -
  // the core ships no ancestor-level guard, so this module is the only
  // place left to stop it.
  e.preventDefault();
  const dropzone = e.target.closest && e.target.closest('[data-rd-import-dropzone]');
  if (dropzone) dropzone.classList.add('rollout-waves-dropzone--dragover');
}

function _onRootDragLeave(e) {
  const dropzone = e.target.closest && e.target.closest('[data-rd-import-dropzone]');
  if (!dropzone) return;
  dropzone.classList.remove('rollout-waves-dropzone--dragover');
}

function _onRootDrop(e, root) {
  e.preventDefault();
  const dropzone = e.target.closest && e.target.closest('[data-rd-import-dropzone]');
  if (!dropzone) return;
  dropzone.classList.remove('rollout-waves-dropzone--dragover');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) _handleFileSelected(root, file);
}

function _wireRootOnce(root) {
  if (root.dataset.rdWired === '1') return;
  root.dataset.rdWired = '1';
  root.addEventListener('click', (e) => _onRootClick(e, root));
  root.addEventListener('keydown', (e) => _onRootKeydown(e, root));
  root.addEventListener('input', (e) => _onRootInput(e, root));
  root.addEventListener('change', (e) => _onRootChange(e, root));
  root.addEventListener('dragover', (e) => _onRootDragOver(e));
  root.addEventListener('dragleave', (e) => _onRootDragLeave(e));
  root.addEventListener('drop', (e) => _onRootDrop(e, root));
}

/**
 * The header actions slot (`#rollout-waves-main-actions`) is a SIBLING of
 * `#rollout-waves-main-root` (js/module-host.js `_createViewSection`), so
 * the delegated listener `_wireRootOnce` wires above never sees a click
 * there. Wired the same idempotent way, from every render(), and unwired in
 * `_ensureCleanup` - a full data reload (js/data-events.js) rebuilds the
 * whole section, slot included, with a fresh listener-free element.
 */
function _wireActionsOnce(root) {
  const slot = document.getElementById(ACTIONS_ID);
  if (!slot || slot.dataset.rdActionsWired === '1') return;
  slot.dataset.rdActionsWired = '1';
  _actionsClickHandler = (e) => _onRootClick(e, root);
  slot.addEventListener('click', _actionsClickHandler);
}

/**
 * `js/ds-modal.js`'s own dismiss layer now closes every modal (Escape,
 * overlay click, focus return to the trigger - see `_openModal`), so this
 * view no longer wires its own document Escape handler. `runViewCleanup()`
 * deletes this view's whole cleanup registry on every EXIT
 * (js/view-lifecycle.js), so the registration below runs from render(), not
 * merely from init(), every time.
 */
function _ensureCleanup() {
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => {
      const root = document.getElementById(ROOT_ID);
      if (root) _closeAllModals(root);
      const slot = document.getElementById(ACTIONS_ID);
      if (slot && _actionsClickHandler) { slot.removeEventListener('click', _actionsClickHandler); delete slot.dataset.rdActionsWired; }
      _actionsClickHandler = null;
      _importFile = null;
    });
  }
}

// ── mount ─────────────────────────────────────────────────────────────────

async function _mount(root) {
  root.innerHTML = '<div data-rd-page>' + _skeletonHtml() + '</div>'
    + '<div data-rd-waves-modal></div>'
    + '<div data-rd-managers-modal></div>'
    + '<div data-rd-gap-modal></div>'
    + _importModalHtml();
  _paintActions(undefined);
  _wireRootOnce(root);
  _wireActionsOnce(root);
  _mounted = true;
  await _reloadData();
  _paintPage(root);
}

// ── view ─────────────────────────────────────────────────────────────────

export const views = {

  'rollout-waves-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;

      // Dynamic on purpose - see the header comment: this file is imported by
      // the contract test in plain Node with no browser and no /js/... resolver.
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
      (async () => {
        try {
          _dsSelect = await import('/js/ds-select.js');
          const root = document.getElementById(ROOT_ID);
          if (root && _mounted) _enhanceSelects(root);
        } catch { _dsSelect = null; }
      })();
    },

    /**
     * @param {string} _subPath path segment after the view id
     * @param {object} _opts navigation options
     */
    async render(_subPath, _opts) {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      _ensureCleanup();
      // Re-wire on EVERY entry, not only from _mount: the cleanup above
      // removes the slot listener on every exit, while _mounted stays true
      // for the whole session - without this line the header buttons were
      // dead from the second visit onward (idempotent via the dataset flag).
      _wireActionsOnce(root);
      if (!_mounted) { await _mount(root); return; }
      _paintPage(root);
    },

    // Opt-out of the core's re-entry on cockpit:data-changed (a pull, or the
    // import above): reload the dashboard and repaint the page part only, so
    // an open modal, the filters and the search stay as they are.
    async onDataChanged() {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      if (!_mounted) { await _mount(root); return; }
      await _reloadData();
      _paintPage(root);
    },
  },
};
