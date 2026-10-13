// locations/client/index.js
// Locations - a searchable directory of sites: search, four tiles, a card
// grid (GET /directory, filtered and paged SERVER-SIDE), one full card with
// contact details (GET /location - contact data leaves the server only
// there) and an import modal (GET /files, POST /import).
//
// export const views = { 'locations-main': { init(deps), render(subPath, opts), onDataChanged() } }
//
// deps (passed to init):
//   navigate(viewId)                 - go to another view
//   registerViewCleanup(cb)          - MANDATORY for timers, listeners, in-flight fetches
//   showToast(variant, title, desc)  - variant: success | danger | info | warning | neutral
//   apiBase                          - '/api/m/locations' (this module's routes)
//
// js/ds-modal.js and js/ds-select.js are CORE ESM modules - the import MUST
// be dynamic and only ever run inside init(), in try/catch: a static import
// would break the contract test, which loads this file in plain Node with no
// browser document and no /js/... URL resolver.
//
// DS classes only and tokens from css/ds-tokens.css - never a hex.

import {
  esc, fmtInt, statusBadgeClass, addressLine, buildDirectoryQuery, fullCardSections, mapsUrl,
  locationErrorMessage, importErrorMessage,
} from './locations-lib.js';

const ROOT_ID = 'locations-main-root';
const ACTIONS_ID = 'locations-main-actions';
const PAGE_LIMIT = 60;
const IMPORT_LIMIT_MB = 20;

let _deps = null;
let _dsModal = null;
let _dsSelect = null;
let _mounted = false;

let _data = null;
let _rows = [];
let _offset = 0;
let _loadError = null;

let _filters = { q: '', status: '', region: '', group: '' };
let _searchDebounce = null;
let _abortController = null;

let _importFiles = null;
let _importSelected = null;
let _importResult = null; // { variant, message, missing? }
let _importBusy = false;

let _actionsClickHandler = null;

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/locations') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

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

function _fmtIsoDate(iso) {
  if (!iso || typeof iso !== 'string' || iso.length < 10) return '';
  return iso.slice(0, 10);
}

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

// ── data loading ──────────────────────────────────────────────────────────

function _currentBranch() {
  if (!_data) return _loadError ? 'error' : 'loading';
  if (_data.available === false) return 'unavailable';
  if (!_data.directory || _data.directory.present === false) return 'empty';
  return 'data';
}

async function _fetchDirectory(offset) {
  if (_abortController) _abortController.abort();
  _abortController = new AbortController();
  const qs = buildDirectoryQuery(_filters, offset, PAGE_LIMIT);
  const res = await fetch(_api('/directory?' + qs), { signal: _abortController.signal });
  if (!res.ok) throw new Error('The server answered ' + res.status);
  return res.json();
}

async function _loadFirstPage() {
  try {
    const data = await _fetchDirectory(0);
    _data = data;
    _rows = Array.isArray(data.rows) ? data.rows : [];
    _offset = 0;
    _loadError = null;
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    _loadError = e;
    _data = null;
    _rows = [];
  }
}

async function _loadMore() {
  const nextOffset = _offset + PAGE_LIMIT;
  try {
    const data = await _fetchDirectory(nextOffset);
    _data = data;
    _rows = _rows.concat(Array.isArray(data.rows) ? data.rows : []);
    _offset = nextOffset;
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    _toast('danger', 'Refresh failed', e.message || '');
  }
}

// ── skeleton ──────────────────────────────────────────────────────────────

function _skeletonHtml() {
  const tile = '<div class="ds-card loc-tile"><div class="ds-card-header">'
    + '<span class="ds-skeleton loc-skel-tile-title"></span></div>'
    + '<div class="ds-card-body">'
    + '<span class="ds-skeleton loc-skel-tile-value"></span>'
    + '<span class="ds-skeleton loc-skel-tile-sub"></span></div></div>';
  const card = '<div class="ds-card loc-skel-card">'
    + '<span class="ds-skeleton loc-skel-card-head"></span>'
    + '<span class="ds-skeleton loc-skel-card-line"></span>'
    + '<span class="ds-skeleton loc-skel-card-line"></span>'
    + '<span class="ds-skeleton loc-skel-card-line"></span>'
    + '</div>';
  return '<div class="loc-header"><span class="ds-skeleton loc-skel-header"></span></div>'
    + '<div class="loc-tiles">' + tile.repeat(4) + '</div>'
    + '<div class="loc-filters">'
    + '<span class="ds-skeleton loc-skel-search"></span>'
    + '<span class="ds-skeleton loc-skel-select"></span>'
    + '<span class="ds-skeleton loc-skel-select"></span>'
    + '<span class="ds-skeleton loc-skel-select"></span>'
    + '</div>'
    + '<div class="loc-grid">' + card.repeat(12) + '</div>';
}

// ── header ────────────────────────────────────────────────────────────────

function _headerHtml() {
  const meta = (_data && _data.directory) || {};
  const total = fmtInt((_data && _data.summary && _data.summary.total) || 0);
  const source = meta.source_file ? ' · Source: ' + esc(meta.source_file) : '';
  const updated = meta.generated_at ? ' · updated ' + esc(_fmtIsoDate(meta.generated_at)) : '';
  return '<div class="loc-header"><div class="loc-header-meta">' + total + ' locations' + source + updated + '</div></div>';
}

function _paintActions(branch) {
  const slot = document.getElementById(ACTIONS_ID);
  if (!slot) return;
  if (branch === 'loading') {
    slot.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" disabled data-skel="1">Import data</button>';
    return;
  }
  if (branch !== 'data') { slot.innerHTML = ''; return; }
  slot.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-loc-import-open>Import data</button>';
}

// ── tiles ─────────────────────────────────────────────────────────────────

function _tileHtml(title, value, sub) {
  return '<div class="ds-card loc-tile"><div class="ds-card-header"><div class="ds-card-title">' + esc(title) + '</div></div>'
    + '<div class="ds-card-body"><div class="loc-tile-value">' + esc(value) + '</div>'
    + (sub ? '<div class="loc-tile-sub">' + esc(sub) + '</div>' : '')
    + '</div></div>';
}

function _tilesHtml() {
  const sum = (_data && _data.summary) || { filtered: 0, total: 0, open_total: 0, inactive_total: 0, status_kinds: 0, cities_filtered: 0 };
  const pctOpen = sum.total > 0 ? Math.round((sum.open_total / sum.total) * 100) : 0;
  return '<div class="loc-tiles" data-loc-tiles>'
    + _tileHtml('Results (filtered)', fmtInt(sum.filtered), 'of ' + fmtInt(sum.total) + ' in the directory · statuses in results: ' + fmtInt(sum.status_kinds))
    + _tileHtml('Open (all)', fmtInt(sum.open_total), pctOpen + '% of all locations')
    + _tileHtml('Not open (all)', fmtInt(sum.inactive_total), 'across the whole directory')
    + _tileHtml('Cities in results', fmtInt(sum.cities_filtered), 'in the current results')
    + '</div>';
}

// ── filters ───────────────────────────────────────────────────────────────

function _optionsHtml(items, current, allLabel) {
  let html = '<option value="">' + esc(allLabel) + '</option>';
  for (const item of (items || [])) {
    const value = String(item.value);
    html += '<option value="' + esc(value) + '"' + (value === current ? ' selected' : '') + '>'
      + esc(value) + ' (' + fmtInt(item.count) + ')</option>';
  }
  return html;
}

function _filtersHtml() {
  const facets = (_data && _data.facets) || { statuses: [], regions: [], groups: [] };
  return '<div class="loc-filters" data-loc-filters>'
    + '<input type="search" class="ds-input loc-filter-search" data-loc-filter-search value="' + esc(_filters.q) + '"'
    + ' placeholder="Search: code, name, city, street, person..."'
    + ' aria-label="Search locations by code, name, city, street or person" autocomplete="off">'
    + '<select class="ds-input loc-filter-select" data-loc-filter-status aria-label="Filter by status">'
    + _optionsHtml(facets.statuses, _filters.status, 'All statuses') + '</select>'
    + '<select class="ds-input loc-filter-select" data-loc-filter-region aria-label="Filter by region">'
    + _optionsHtml(facets.regions, _filters.region, 'All regions') + '</select>'
    + '<select class="ds-input loc-filter-select" data-loc-filter-group aria-label="Filter by group">'
    + _optionsHtml(facets.groups, _filters.group, 'All groups') + '</select>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-loc-filter-clear>Clear filters</button>'
    + '</div>';
}

// ── card grid ─────────────────────────────────────────────────────────────

function _cardHtml(r) {
  const code = r.code || '—';
  const status = r.status || '';
  const regionText = r.region ? ' · Region ' + esc(String(r.region)) : '';
  const kv = (label, value) => (value
    ? '<div class="loc-card-row"><span class="loc-card-k">' + esc(label) + '</span><span class="loc-card-v">' + esc(value) + '</span></div>'
    : '');
  const groups = (r.groups || []).map((g) => '<span class="ds-badge ds-badge--gray ds-badge--sm">' + esc(g) + '</span>').join(' ');
  return '<div class="ds-card loc-card" data-code="' + esc(code) + '" tabindex="0" role="button" aria-label="Location card ' + esc(code) + '">'
    + '<div class="loc-card-head"><code>' + esc(code) + '</code>'
    + '<span class="ds-badge ' + statusBadgeClass(status) + ' ds-badge--sm">' + esc(status || '—') + '</span></div>'
    + '<div class="loc-card-address">' + esc(r.name || '') + '</div>'
    + '<div class="loc-card-sub">' + esc(addressLine(r) || '—') + regionText + '</div>'
    + kv('Operator', r.operator)
    + kv('Manager', r.manager)
    + kv('Partner', r.partner)
    + (groups ? '<div class="loc-card-row">' + groups + '</div>' : '')
    + '</div>';
}

function _gridSectionHtml() {
  const summary = (_data && _data.summary) || { filtered: 0 };
  if (!_rows.length) {
    return '<div class="ds-empty"><div class="ds-empty-title">No locations match these filters</div>'
      + '<div class="ds-empty-desc">Change the filters or clear the search.</div></div>';
  }
  const hasMore = Boolean(_data && _data.page && _data.page.has_more);
  const remaining = Math.max(0, summary.filtered - _rows.length);
  const loadMoreHtml = hasMore
    ? '<div class="loc-load-more-wrap"><button type="button" class="ds-btn ds-btn--secondary" data-loc-load-more>'
      + 'Show more (' + fmtInt(remaining) + ' left)</button></div>'
    : '';
  return '<div class="loc-count">Showing ' + fmtInt(_rows.length) + ' of ' + fmtInt(summary.filtered) + ' locations</div>'
    + '<div class="loc-grid" data-loc-grid>' + _rows.map(_cardHtml).join('') + '</div>'
    + loadMoreHtml;
}

// ── location modal ────────────────────────────────────────────────────────

function _locationModalShellHtml() {
  return '<div id="locations-card-modal-overlay" class="ds-modal-overlay" hidden>'
    + '<div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true" aria-label="Location card">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" data-loc-card-title></span>'
    + '<button type="button" class="ds-modal-close" data-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body" data-loc-card-body></div>'
    + '</div></div>';
}

function _locationModalSkeletonHtml() {
  const lines = new Array(6).fill('<span class="ds-skeleton loc-skel-modal-line"></span>').join('');
  const block = '<div class="loc-modal-section-skel">' + lines + '</div>';
  return block + block + block;
}

function _locationCardHtml(loc) {
  if (!loc) return '<div class="ds-callout ds-callout--danger"><div>The full record of this location was not found.</div></div>';
  const sectionsHtml = fullCardSections(loc).map((sec) => {
    const rowsHtml = sec.rows.map((r) => '<tr><td class="loc-modal-k">' + esc(r.label) + '</td>'
      + '<td class="loc-modal-v">' + esc(r.value) + '</td></tr>').join('');
    return '<h3 class="loc-modal-section">' + esc(sec.title) + '</h3>'
      + '<table class="loc-modal-table"><tbody>' + rowsHtml + '</tbody></table>';
  }).join('');
  const url = mapsUrl(loc.latitude, loc.longitude);
  const footerHtml = '<div class="ds-modal-footer">'
    + (url ? '<a class="ds-btn ds-btn--primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open map</a>' : '')
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-modal-close>Close</button></div>';
  return sectionsHtml + footerHtml;
}

async function _openLocationModal(root, code, trigger) {
  const overlay = root.querySelector('#locations-card-modal-overlay');
  const body = overlay && overlay.querySelector('[data-loc-card-body]');
  const title = overlay && overlay.querySelector('[data-loc-card-title]');
  if (!overlay || !body) return;
  if (title) title.textContent = 'Location ' + code;
  body.innerHTML = _locationModalSkeletonHtml();
  _openModal(overlay, trigger);
  try {
    const res = await fetch(_api('/location?code=' + encodeURIComponent(code)));
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      body.innerHTML = '<div class="ds-callout ds-callout--danger"><div>' + esc(locationErrorMessage(res.status, json)) + '</div></div>';
      return;
    }
    body.innerHTML = _locationCardHtml(json.location);
  } catch (e) {
    body.innerHTML = '<div class="ds-callout ds-callout--danger"><div>'
      + esc('Could not load the location: ' + (e.message || '')) + '</div></div>';
  }
}

// ── import modal ──────────────────────────────────────────────────────────

function _importBodyHtml() {
  const info = _importFiles && _importFiles.files && _importFiles.files.directory;
  let meta = 'Not imported yet.';
  if (_importFiles === null) meta = 'Loading...';
  else if (info && info.present) {
    meta = fmtInt(info.total_rows || 0) + ' locations'
      + (info.source_file ? ' · ' + esc(info.source_file) : '')
      + (info.updated_at ? ' · ' + esc(_fmtIsoDate(info.updated_at)) : '');
  }
  let resultHtml = '';
  if (_importResult) {
    const cls = _importResult.variant === 'success' ? 'ds-callout--success' : 'ds-callout--danger';
    resultHtml = '<div class="ds-callout ' + cls + ' loc-import-row-result-callout"><div>' + esc(_importResult.message) + '</div></div>';
  }
  const fileName = _importSelected ? '<div class="loc-import-row-filename">' + esc(_importSelected.name) + '</div>' : '';
  return '<p class="loc-import-row-meta">One .xlsx or .csv file with a header row. Required columns: '
    + '<strong>Code</strong>, <strong>Name</strong>, <strong>City</strong>. Optional: Status, Street, Postal code, Region, '
    + 'Area, District, Operator, Manager, Partner, Groups (comma separated), Phone, Email, Opened, Sales area, Latitude, Longitude. '
    + 'An import replaces the whole directory.</p>'
    + '<div class="loc-import-row">'
    + '<div class="loc-import-row-head"><div class="loc-import-row-title">Locations directory</div>'
    + '<div class="loc-import-row-meta">' + meta + '</div>' + fileName + '</div>'
    + '<div class="loc-import-row-controls">'
    + '<input type="file" accept=".xlsx,.csv" hidden data-loc-import-file-input>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-loc-import-choose' + (_importBusy ? ' disabled' : '') + '>Choose file</button>'
    + '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-loc-import-save'
    + (_importBusy || !_importSelected ? ' disabled' : '') + (_importBusy ? ' aria-busy="true"' : '') + '>Import</button>'
    + '</div></div>'
    + resultHtml;
}

function _importModalHtml() {
  return '<div id="locations-import-modal-overlay" class="ds-modal-overlay loc-import-modal" hidden>'
    + '<div class="ds-modal" role="dialog" aria-modal="true" aria-label="Import data">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Import data</span>'
    + '<button type="button" class="ds-modal-close" data-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body" data-loc-import-body></div>'
    + '</div></div>';
}

function _refreshImportBody(root) {
  const body = root.querySelector('[data-loc-import-body]');
  if (body) body.innerHTML = _importBodyHtml();
}

async function _loadFiles() {
  try {
    const res = await fetch(_api('/files'));
    _importFiles = res.ok ? await res.json() : { available: false, files: {} };
  } catch {
    _importFiles = { available: false, files: {} };
  }
}

async function _openImportModal(root, trigger) {
  _importSelected = null;
  _importResult = null;
  _importFiles = null;
  _refreshImportBody(root);
  _openModal(root.querySelector('#locations-import-modal-overlay'), trigger);
  await _loadFiles();
  _refreshImportBody(root);
}

async function _announceDataWrite() {
  try {
    const mod = await import('/js/data-events.js');
    if (mod && typeof mod.emitDataChanged === 'function') mod.emitDataChanged({ source: 'locations' });
  } catch { /* plain Node or an older host - the view reloads itself below */ }
}

async function _handleImportSave(root) {
  if (!_importSelected || _importBusy) return;
  const file = _importSelected;
  if (file.size > IMPORT_LIMIT_MB * 1024 * 1024) {
    _importResult = { variant: 'danger', message: 'The file is larger than ' + IMPORT_LIMIT_MB + ' MB.' };
    _refreshImportBody(root);
    return;
  }
  _importBusy = true;
  _importResult = null;
  _refreshImportBody(root);
  try {
    const fileBase64 = await _fileToBase64(file);
    const res = await fetch(_api('/import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, file_base64: fileBase64, modified_at: file.lastModified || null }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      _importResult = { variant: 'danger', message: importErrorMessage(res.status, json) };
    } else {
      _importResult = {
        variant: 'success',
        message: json.written
          ? 'Imported ' + fmtInt(json.total_rows) + ' locations. Send the change to the team from the sync panel.'
          : 'Nothing changed - the file matches the current directory.',
      };
      _importSelected = null;
      await _loadFiles();
      await _loadFirstPage();
      _paintPage(root);
      if (json.written) _announceDataWrite();
    }
  } catch (e) {
    _importResult = { variant: 'danger', message: 'The import failed: ' + (e.message || '') };
  } finally {
    _importBusy = false;
    _refreshImportBody(root);
  }
}

// ── painting ──────────────────────────────────────────────────────────────

function _enhanceSelects(root) {
  if (!_dsSelect || typeof _dsSelect.initSelect !== 'function') return;
  root.querySelectorAll('[data-loc-filter-status], [data-loc-filter-region], [data-loc-filter-group]').forEach((sel) => {
    try { _dsSelect.initSelect(sel); } catch { /* bare select still works */ }
  });
}

function _paintPage(root) {
  const branch = _currentBranch();
  _paintActions(branch);
  const page = root.querySelector('[data-loc-page]');
  if (!page) return;
  if (branch === 'loading') { page.innerHTML = _skeletonHtml(); return; }
  if (branch === 'unavailable') {
    page.innerHTML = '<div class="ds-callout ds-callout--warning"><div>'
      + 'The team data repository is not on this computer - fetch it from the sync panel.</div></div>';
    return;
  }
  if (branch === 'error') {
    page.innerHTML = '<div class="ds-callout ds-callout--danger">'
      + '<div>' + esc('Could not load the locations directory' + (_loadError && _loadError.message ? ': ' + _loadError.message : '.')) + '</div>'
      + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-loc-refresh>Refresh</button></div>';
    return;
  }
  if (branch === 'empty') {
    page.innerHTML = '<div class="ds-callout ds-callout--info">'
      + '<div>There is no locations directory in the team data on this computer yet.</div>'
      + '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-loc-import-open>Import locations</button></div>';
    return;
  }
  page.innerHTML = _headerHtml() + _tilesHtml() + _filtersHtml() + '<div data-loc-grid-section>' + _gridSectionHtml() + '</div>';
  _enhanceSelects(root);
}

function _paintDynamic(root) {
  const tiles = root.querySelector('[data-loc-tiles]');
  if (tiles) tiles.outerHTML = _tilesHtml();
  const gridSection = root.querySelector('[data-loc-grid-section]');
  if (gridSection) gridSection.innerHTML = _gridSectionHtml();
}

async function _reloadFiltered(root) {
  await _loadFirstPage();
  _paintDynamic(root);
}

async function _resetFilters(root) {
  _filters = { q: '', status: '', region: '', group: '' };
  const filtersEl = root.querySelector('[data-loc-filters]');
  if (filtersEl) { filtersEl.outerHTML = _filtersHtml(); _enhanceSelects(root); }
  await _reloadFiltered(root);
}

async function _handleRefresh(root) {
  await _loadFirstPage();
  _paintPage(root);
  if (_loadError) _toast('danger', 'Refresh failed', _loadError.message || '');
}

// ── delegated listeners ───────────────────────────────────────────────────

function _onRootClick(e, root) {
  if (e.target.classList && e.target.classList.contains('ds-modal-overlay')) { _closeModal(e.target); return; }
  if (e.target.closest('[data-loc-refresh]')) { _handleRefresh(root); return; }
  const importOpenBtn = e.target.closest('[data-loc-import-open]');
  if (importOpenBtn) { _openImportModal(root, importOpenBtn); return; }
  if (e.target.closest('[data-loc-filter-clear]')) { _resetFilters(root); return; }
  const loadMoreBtn = e.target.closest('[data-loc-load-more]');
  if (loadMoreBtn) {
    loadMoreBtn.disabled = true;
    _loadMore().then(() => _paintDynamic(root));
    return;
  }
  const chooseBtn = e.target.closest('[data-loc-import-choose]');
  if (chooseBtn && !chooseBtn.disabled) {
    const input = root.querySelector('[data-loc-import-file-input]');
    if (input) input.click();
    return;
  }
  const saveBtn = e.target.closest('[data-loc-import-save]');
  if (saveBtn && !saveBtn.disabled) { _handleImportSave(root); return; }
  const modalClose = e.target.closest('[data-modal-close]');
  if (modalClose) { _closeModal(modalClose.closest('.ds-modal-overlay')); return; }
  const card = e.target.closest('.loc-card[data-code]');
  if (card) _openLocationModal(root, card.dataset.code, card);
}

function _onRootKeydown(e, root) {
  const card = e.target.closest && e.target.closest('.loc-card[data-code]');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); _openLocationModal(root, card.dataset.code, card); }
}

function _onRootInput(e, root) {
  const search = e.target.closest('[data-loc-filter-search]');
  if (!search) return;
  _filters.q = search.value || '';
  if (_searchDebounce) clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => { _searchDebounce = null; _reloadFiltered(root); }, 250);
}

function _onRootChange(e, root) {
  const status = e.target.closest('[data-loc-filter-status]');
  if (status) { _filters.status = status.value || ''; _reloadFiltered(root); return; }
  const region = e.target.closest('[data-loc-filter-region]');
  if (region) { _filters.region = region.value || ''; _reloadFiltered(root); return; }
  const group = e.target.closest('[data-loc-filter-group]');
  if (group) { _filters.group = group.value || ''; _reloadFiltered(root); return; }
  const fileInput = e.target.closest('[data-loc-import-file-input]');
  if (fileInput) {
    _importSelected = (fileInput.files && fileInput.files[0]) || null;
    _importResult = null;
    _refreshImportBody(root);
  }
}

function _wireRootOnce(root) {
  if (root.dataset.locWired === '1') return;
  root.dataset.locWired = '1';
  root.addEventListener('click', (e) => _onRootClick(e, root));
  root.addEventListener('keydown', (e) => _onRootKeydown(e, root));
  root.addEventListener('input', (e) => _onRootInput(e, root));
  root.addEventListener('change', (e) => _onRootChange(e, root));
}

// The header actions slot is a SIBLING of the root, so the delegated root
// listener never sees its clicks - wired separately, idempotently.
function _wireActionsOnce(root) {
  const slot = document.getElementById(ACTIONS_ID);
  if (!slot || slot.dataset.locActionsWired === '1') return;
  slot.dataset.locActionsWired = '1';
  _actionsClickHandler = (e) => _onRootClick(e, root);
  slot.addEventListener('click', _actionsClickHandler);
}

function _ensureCleanup() {
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => {
      if (_searchDebounce) { clearTimeout(_searchDebounce); _searchDebounce = null; }
      if (_abortController) { _abortController.abort(); _abortController = null; }
      const root = document.getElementById(ROOT_ID);
      if (root) _closeAllModals(root);
      const slot = document.getElementById(ACTIONS_ID);
      if (slot && _actionsClickHandler) { slot.removeEventListener('click', _actionsClickHandler); delete slot.dataset.locActionsWired; }
      _actionsClickHandler = null;
      _importSelected = null;
    });
  }
}

async function _mount(root) {
  root.innerHTML = '<div data-loc-page>' + _skeletonHtml() + '</div>' + _locationModalShellHtml() + _importModalHtml();
  _paintActions('loading');
  _wireRootOnce(root);
  _wireActionsOnce(root);
  _mounted = true;
  await _loadFirstPage();
  _paintPage(root);
}

export const views = {
  'locations-main': {
    init(deps) {
      _deps = deps;
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

    async render(_subPath, _opts) {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      _ensureCleanup();
      _wireActionsOnce(root);
      if (!_mounted) { await _mount(root); return; }
      _paintPage(root);
    },

    // Opt-out of the host's re-entry on a data change: reload in place,
    // keeping the search and the filters.
    async onDataChanged() {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      if (!_mounted) { await _mount(root); return; }
      await _loadFirstPage();
      _paintPage(root);
    },
  },
};
