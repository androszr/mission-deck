// vendor-settlements/client/index.js
// Vendor settlements - the vendor -> purchase order settlement form, the
// "Costs vs accepted" chart, the settlements list and the protocol generator,
// over this module's /api/m/vendor-settlements/ routes.
//
// One view: export const views = { 'vendor-settlements-main': { init, render } }.
// deps: { navigate, registerViewCleanup, showToast(variant, title, desc), apiBase }.
// Core ESM (/js/ds-modal.js) is imported dynamically in init(), in try/catch,
// so a plain-Node import of this file works in tests.
// Siblings: vs-lib.js (pure helpers), vs-chart.js, vs-modals.js, vs-protocol.js.
// They keep no data of their own; the loaded data travels in `ctx`.

import {
  escHtml, fmtMoney, fmtH, fmtDateTime, fmtMonthLabel, pad2, lastDayOf, AREAS, AREA_LABELS, CURRENCY,
  vendorNameMatches, buildPeriodMonthOptions, getMonthsForArea, getVendorsForArea,
  canonicalVendor, getOrdersForVendor, getEpicTotalsForVendor, getPersonTotalsForVendor,
  sumCostsForSelection, parseAmountInput, buildPoGroups, computeAvailableOnPo,
} from './vs-lib.js';
import { initSettlementsChart } from './vs-chart.js';
import { openItemsModal, openAcceptModal, openRefreshModal, closeOverlay, issueLinkHtml } from './vs-modals.js';
import { renderProtocolGenSection, handleProtClick, handleProtChange, freshProtState } from './vs-protocol.js';

const VIEW_ID = 'vendor-settlements-main';
const ROOT_ID = VIEW_ID + '-root';
const ACTIONS_ID = VIEW_ID + '-actions';
const MSG_STORAGE = 'The team data is not pulled and decrypted on this computer. Pull it in the Sync window on the top bar.';
const CODE_MSG = {
  'data-missing': MSG_STORAGE,
  'too-large': 'The data sent is too large.',
  'not-found': 'The entry was not found - refresh the view.',
  'already-accepted': 'This settlement is already marked as accepted.',
  'deps-missing': 'The generator packages are missing. Run `npm ci --omit=dev` in the modules/vendor-settlements directory.',
  network: 'No connection to the server.',
};

let _deps = null;
let _dsModal = null;
let _dsModalP = null;
let _epoch = 0;
let _ctx = null;

const $ = (id) => document.getElementById(id);

// -- SVG icons ----------------------------------------------------------------------

const ICON = {
  edit: '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>',
  del: '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd"/></svg>',
  eye: '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>',
  check: '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>',
  copy: '<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>',
  copyLine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 3 11 8 6 13"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>',
};

// -- Context ------------------------------------------------------------------------------

function emptyData() {
  return {
    costs: { atlas: null, borealis: null, comet: null, delta: null },
    protocolsAll: { meta: {}, protocols: [] },
    purchaseOrders: [],
    summary: { meta: {}, assignments: [] },
    vendorInfo: { meta: {}, vendors: [] },
    teamMembers: [],
    jiraBrowseUrl: '',
  };
}

function apiUrl(p) { return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/vendor-settlements') + p; }

async function jsonReq(method, url, body) {
  const init = { method };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body || {});
  }
  try {
    const r = await fetch(url, init);
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    return { ok: r.ok, status: r.status, data: data || {} };
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
}

function makeCtx(epoch) {
  const ctx = {
    epoch,
    dead: false,
    deps: _deps,
    dsModal: _dsModal,
    status: null,
    data: emptyData(),
    overlays: [],
    teardown: [],
    chart: null,
    ui: {
      filter: { area: '', vendor: '', month: '', search: '' },
      periodMonth: '',
      modalMode: 'add',
      editId: null,
      selectedPo: { number: '', name: '' },
      prot: freshProtState(),
      protStep: 1,
      protDataChanged: false,
      protPersons: [],
    },
    live() { return !ctx.dead && ctx.epoch === _epoch; },
    toast(variant, title, desc) {
      if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
    },
    api(method, p, body) { return jsonReq(method, apiUrl(p), body); },
    async rawFetch(method, p, body) {
      return fetch(apiUrl(p), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    },
    errMsg(res) {
      const d = (res && res.data) || {};
      return CODE_MSG[d.error] || d.message || ('HTTP ' + ((res && res.status) || 0));
    },
    getModalArea,
    populateVendorSelect() { populateVendorSelect(getModalArea()); },
    afterWrite,
    reloadAll,
  };
  return ctx;
}

function teardownCtx(ctx) {
  if (!ctx || ctx.dead) return;
  ctx.dead = true;
  if (ctx.chart) { ctx.chart.destroy(); ctx.chart = null; }
  while (ctx.teardown.length) {
    try { ctx.teardown.pop()(); } catch { /* listener already gone */ }
  }
  for (const el of [...ctx.overlays]) closeOverlay(ctx, el);
}

function listen(ctx, target, type, fn) {
  if (!target) return;
  target.addEventListener(type, fn);
  ctx.teardown.push(() => target.removeEventListener(type, fn));
}

// -- Data loading -----------------------------------------------------------------------------------

async function loadAll(ctx) {
  const [data, ...costs] = await Promise.all([
    ctx.api('GET', '/data'),
    ...AREAS.map((a) => ctx.api('GET', '/costs?area=' + a)),
  ]);
  if (!ctx.live()) return false;
  if (!data.ok) {
    ctx.toast('danger', 'Could not load the data', ctx.errMsg(data));
    return false;
  }
  const costsOf = (r) => (r.ok && r.data && !r.data._missing && r.data.storage !== 'unavailable' ? r.data : null);
  const d = data.data;
  const base = emptyData();
  const costsByArea = {};
  AREAS.forEach((a, i) => { costsByArea[a] = costsOf(costs[i]); });
  ctx.data = {
    costs: costsByArea,
    protocolsAll: d.protocols || base.protocolsAll,
    purchaseOrders: Array.isArray(d.purchaseOrders) ? d.purchaseOrders : [],
    summary: d.summary || base.summary,
    vendorInfo: d.vendorInfo || base.vendorInfo,
    teamMembers: Array.isArray(d.teamMembers) ? d.teamMembers : [],
    jiraBrowseUrl: d.jiraBrowseUrl || '',
  };
  return true;
}

/** After a write: re-read the files (the protocols too) and repaint. */
async function afterWrite() {
  const ctx = _ctx;
  if (!ctx || !ctx.live()) return;
  const [data, prot] = await Promise.all([ctx.api('GET', '/data'), ctx.api('GET', '/protocols-all')]);
  if (!ctx.live()) return;
  if (data.ok) {
    ctx.data.summary = data.data.summary || ctx.data.summary;
    ctx.data.vendorInfo = data.data.vendorInfo || ctx.data.vendorInfo;
    ctx.data.protocolsAll = data.data.protocols || ctx.data.protocolsAll;
    ctx.data.purchaseOrders = Array.isArray(data.data.purchaseOrders) ? data.data.purchaseOrders : ctx.data.purchaseOrders;
  }
  if (prot.ok && prot.data.storage !== 'unavailable') ctx.data.protocolsAll = prot.data;
  ctx.ui.protDataChanged = true;
  renderView(ctx);
}

/** "Refresh the view": full re-read of every source. */
async function reloadAll() {
  const ctx = _ctx;
  if (!ctx || !ctx.live()) return;
  const st = await ctx.api('GET', '/status');
  if (!ctx.live()) return;
  if (st.ok) ctx.status = st.data;
  if (await loadAll(ctx)) {
    ctx.ui.protDataChanged = true;
    renderView(ctx);
  }
}

// -- Shell markup ---------------------------------------------------------------------------------------------

function emptyStateHtml(icon, title, desc, extra) {
  return `<div class="ds-empty">
    <div class="ds-empty-icon">${icon}</div>
    <div class="ds-empty-title">${escHtml(title)}</div>
    <div class="ds-empty-desc">${escHtml(desc)}</div>
    ${extra || ''}
  </div>`;
}

function areaSegments(cls) {
  return AREAS.map((a, i) => `<button type="button" class="ds-segment ${cls}${i === 0 ? ' active' : ''}" data-area="${a}">${AREA_LABELS[a]}</button>`).join('');
}

function modeSegments() {
  const modes = [['epics', 'Epics'], ['persons', 'People'], ['custom', 'Custom']];
  return modes.map(([m, label], i) => `<button type="button" class="ds-segment vs-mode-segment${i === 0 ? ' active' : ''}" data-mode="${m}">${label}</button>`).join('');
}

function shellHtml() {
  const areaOptions = AREAS.map((a) => `<option value="${a}">${escHtml(AREA_LABELS[a])}</option>`).join('');
  return `<div class="header-meta"><span id="vs-meta-total"></span></div>
    <div class="view-intro">
      <p>The view helps you file settlements &mdash; it assigns a vendor and the chosen epics or people to one purchase order.</p>
      <p>Choose the area, the period, the vendor, the aggregation mode (epics / people), the items and the order. What is still available on the order (the order amount minus what was already assigned) is shown as you go.</p>
    </div>

    <div id="vs-module-root">
      <div id="vs-chart-section" class="vs-chart-section">
        <div class="vs-chart-card ds-card">
          <div class="vs-chart-card-header"><span class="vs-chart-card-title">Costs vs accepted</span></div>
          <div class="vs-chart-toolbar">
            <div class="vs-chart-toolbar-row">
              <div class="ds-segmented vs-area-seg vs-chart-area-seg">${areaSegments('vs-chart-area-btn')}</div>
            </div>
            <div class="vs-chart-toolbar-row">
              <div class="vs-chart-period-wrap"><select id="vs-chart-period" class="ds-input" aria-label="Chart month"></select></div>
              <div class="vs-chart-vendor-dropdown">
                <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="vs-chart-vendor-toggle" aria-expanded="false">Vendors</button>
                <div class="vs-chart-vendor-menu" id="vs-chart-vendor-menu" hidden></div>
              </div>
            </div>
          </div>
          <div id="vs-chart-root" class="vs-chart-svg-wrap"></div>
          <div id="vs-chart-empty" class="ds-callout ds-callout--info vs-chart-empty" hidden>No data for the chosen month and area.</div>
        </div>
      </div>

      <div id="vs-form-section" class="vs-form-section">
        <div class="vs-form-card ds-card">
          <div class="vs-form-card-header"><span id="vs-form-card-title" class="vs-form-card-title">Vendor settlement</span></div>
          <form id="vs-form" autocomplete="off" class="vs-form-body">
            <div class="vs-form-seg-row vs-form-field">
              <div class="ds-input-wrap vs-form-field--seg">
                <span class="ds-label">Area</span>
                <div class="ds-segmented vs-area-seg">${areaSegments('vs-area-segment')}</div>
              </div>
              <div class="ds-input-wrap vs-form-field--seg">
                <span class="ds-label">Aggregation mode</span>
                <div class="ds-segmented vs-area-seg">${modeSegments()}</div>
              </div>
            </div>

            <div class="ds-input-wrap vs-form-field">
              <label class="ds-label" for="vs-period-month">Period (month)<span class="vs-req" aria-hidden="true">*</span></label>
              <select id="vs-period-month" class="ds-input"><option value="">-- choose --</option></select>
            </div>

            <div class="ds-input-wrap vs-form-field">
              <label class="ds-label" for="vs-form-vendor">Vendor<span class="vs-req" aria-hidden="true">*</span></label>
              <select id="vs-form-vendor" class="ds-input"><option value="">-- choose --</option></select>
            </div>

            <div class="ds-input-wrap vs-form-field">
              <label class="ds-label" for="vs-form-title">Title<span class="vs-req" aria-hidden="true">*</span></label>
              <input type="text" id="vs-form-title" class="ds-input" placeholder="e.g. Project support Q2 2026">
            </div>

            <div id="vs-items-section" class="ds-input-wrap vs-form-field" hidden>
              <div class="vs-items-header">
                <span class="ds-label">Items</span>
                <div class="vs-items-header-actions">
                  <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="vs-select-all-btn">Select all</button>
                  <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="vs-collapse-all-btn">Collapse all</button>
                </div>
              </div>
              <div class="ds-input-wrap vs-items-search-wrap">
                <input type="search" id="vs-items-search" class="ds-input" placeholder="Filter items..." aria-label="Filter items" autocomplete="off">
              </div>
              <div id="vs-items-wrap" class="vs-items-wrap">
                <span class="vs-items-empty">Choose a vendor and a period to see the items.</span>
              </div>
            </div>

            <div id="vs-amount-full-section" class="ds-input-wrap vs-form-field">
              <label class="ds-label" for="vs-amount-selected">Amount of the selection (${CURRENCY})</label>
              <input type="text" id="vs-amount-selected" class="ds-input" readonly placeholder="0.00">
            </div>

            <div id="vs-amount-own-wrap" class="ds-input-wrap vs-form-field" hidden>
              <label class="ds-label" for="vs-form-amount">Amount (${CURRENCY})</label>
              <input type="text" inputmode="decimal" id="vs-form-amount" class="ds-input" placeholder="0.00">
            </div>

            <div id="vs-po-section" class="ds-input-wrap vs-form-field" hidden>
              <span class="ds-label">Purchase order</span>
              <div class="vs-po-search-wrap">
                <input type="search" id="vs-po-search" class="ds-input" placeholder="Filter orders..." aria-label="Filter orders" autocomplete="off">
                <select id="vs-po-area-filter" class="ds-input vs-po-area-filter" aria-label="Filter by area">
                  <option value="">All areas</option>
                </select>
              </div>
              <div id="vs-po-wrap" class="vs-items-wrap vs-po-wrap"></div>
            </div>

            <div class="ds-callout ds-callout--warning" id="vs-po-warning" hidden></div>

            <div class="ds-input-wrap vs-form-field">
              <label class="ds-label" for="vs-form-link">Protocol link</label>
              <input type="url" id="vs-form-link" class="ds-input" placeholder="https://...">
            </div>
          </form>
          <div class="vs-form-actions">
            <button type="button" class="ds-btn ds-btn--primary" id="vs-save-btn">Save</button>
            <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="vs-cancel-btn">Reset</button>
          </div>
        </div>
      </div>

      <div class="vs-filter-bar" id="vs-filter-bar">
        <div class="vs-filter-search">
          <span class="vs-filter-search-icon" aria-hidden="true"></span>
          <input type="text" id="vs-filter-search" class="ds-input" placeholder="Search vendor, title, order number..." aria-label="Search settlements">
          <button type="button" class="ds-icon-btn ds-icon-btn--sm vs-filter-clear" id="vs-filter-search-clear" aria-label="Clear the search">&times;</button>
        </div>
        <select id="vs-filter-area" class="ds-input" aria-label="Filter by area">
          <option value="">All areas</option>${areaOptions}
        </select>
        <select id="vs-filter-vendor" class="ds-input" aria-label="Filter by vendor"><option value="">All vendors</option></select>
        <select id="vs-filter-month" class="ds-input" aria-label="Filter by month"><option value="">All months</option></select>
      </div>

      <div id="vs-table-root"><div class="ds-callout ds-callout--info"><div>Loading data...</div></div></div>
      <div id="vs-summary-bar"></div>

      <section id="vsprot-section" class="vsprot-section" hidden>
        <h2>Protocol generator</h2>
        <p class="view-intro">Pick a settlement from the list above and generate an acceptance protocol as .docx or a print page. Fill in the vendor details, choose the people and enter the protocol number and date.</p>
        <div class="vsprot-wizard ds-card" id="vsprot-step-content"></div>
        <div class="vsprot-vendor-btn-row">
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="vsprot-open-vendor-modal">Edit vendor details</button>
        </div>
      </section>
    </div>`;
}

// -- Form state helpers ---------------------------------------------------------------------------------------------

function getModalArea() {
  const active = document.querySelector('#vs-form-section .vs-area-segment.active');
  return active ? active.dataset.area : AREAS[0];
}

function getModalMode() {
  const active = document.querySelector('#vs-form-section .vs-mode-segment.active');
  return active ? active.dataset.mode : 'epics';
}

function selVal(id) {
  const el = $(id);
  return el ? el.value : '';
}

function getSelectedItems() {
  return Array.from(document.querySelectorAll('#vs-items-wrap .vs-item-select[aria-pressed="true"]')).map(b => b.dataset.item);
}

function periodLast(month) { return month + '-' + pad2(lastDayOf(month)); }

function fillPeriodSelect(ctx, area) {
  const months = buildPeriodMonthOptions(getMonthsForArea(area, ctx.data), ctx.ui.periodMonth);
  const sel = $('vs-period-month');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- choose --</option>'
    + months.map(m => `<option value="${m}">${escHtml(fmtMonthLabel(m))}</option>`).join('');
  if (ctx.ui.periodMonth) sel.value = ctx.ui.periodMonth;
}

function populateVendorSelect(area) {
  const ctx = _ctx;
  const sel = $('vs-form-vendor');
  if (!ctx || !sel) return;
  const d = ctx.data;
  const fromProtocols = getVendorsForArea(area, d);
  const fromVendorInfo = ((d.vendorInfo && d.vendorInfo.vendors) || []).map(v => v.name);
  const fromOrders = getOrdersForVendor(d.purchaseOrders, null).map(c => c.vendor_name).filter(Boolean);
  const seen = new Map();
  for (const v of new Set([...fromProtocols, ...fromVendorInfo, ...fromOrders])) {
    const canon = canonicalVendor(v, d);
    if (!seen.has(canon.toLowerCase())) seen.set(canon.toLowerCase(), canon);
  }
  const prev = sel.value;
  sel.innerHTML = '<option value="">-- choose --</option>'
    + [...seen.values()].sort().map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  if (prev && seen.has(prev.toLowerCase())) sel.value = prev;
}

function updateSectionsVisibility(ctx) {
  const ready = !!(selVal('vs-form-vendor') && ctx.ui.periodMonth);
  const mode = getModalMode();
  const set = (id, hidden) => { const el = $(id); if (el) el.hidden = hidden; };
  set('vs-items-section', !ready);
  set('vs-amount-full-section', mode === 'custom');
  set('vs-po-section', !ready);
}

function setModalArea(area) {
  const ctx = _ctx;
  if (!ctx) return;
  document.querySelectorAll('#vs-form-section .vs-area-segment').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.area === area);
  });
  const prevVendor = selVal('vs-form-vendor');
  populateVendorSelect(area);
  const sel = $('vs-form-vendor');
  if (sel && prevVendor) sel.value = prevVendor;
  const vendor = (sel && sel.value) || '';
  fillPeriodSelect(ctx, area);
  updateSectionsVisibility(ctx);
  renderItemChips(ctx, area, getModalMode(), vendor, ctx.ui.periodMonth, []);
  if (vendor && ctx.ui.periodMonth) renderPoChips(ctx, vendor, null, ctx.ui.editId);
  if (ctx.chart) ctx.chart.syncArea(area);
}

function setModalMode(ctx, mode) {
  document.querySelectorAll('#vs-form-section .vs-mode-segment').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  const wrap = $('vs-amount-own-wrap');
  if (wrap) wrap.hidden = mode !== 'custom';
  updateSectionsVisibility(ctx);
  renderItemChips(ctx, getModalArea(), mode, selVal('vs-form-vendor'), ctx.ui.periodMonth, []);
  updateSelectionAmount(ctx);
}

/** Resets the form (assignment = null) or loads a settlement into it. */
function openModal(ctx, mode, a) {
  ctx.ui.modalMode = mode;
  ctx.ui.editId = a ? a.id : null;
  const section = $('vs-form-section');
  if (!section) return;
  const title = $('vs-form-card-title');
  if (title) title.textContent = mode === 'edit' ? 'Edit vendor settlement' : 'Vendor settlement';

  const area = a ? a.area : AREAS[0];
  ctx.ui.periodMonth = a ? (a.period_from || '').slice(0, 7) : '';
  setModalArea(area);
  fillPeriodSelect(ctx, area);
  setModalMode(ctx, a ? a.mode : 'epics');

  const vSel = $('vs-form-vendor');
  if (vSel) {
    populateVendorSelect(area);
    vSel.value = a ? canonicalVendor(a.vendor, ctx.data) : '';
  }
  updateSectionsVisibility(ctx);
  renderItemChips(ctx, area, getModalMode(), selVal('vs-form-vendor'), ctx.ui.periodMonth, a ? (a.items || []) : []);

  const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
  setVal('vs-form-title', a ? (a.title || '') : '');
  setVal('vs-form-link', a ? (a.protocol_link || '') : '');
  setVal('vs-form-amount', a && a.mode === 'custom' ? (a.amount || '') : '');

  renderPoChips(ctx, a ? a.vendor : '', a ? a.po_number : null, ctx.ui.editId);
  updateSelectionAmount(ctx);
  updatePoWarning(ctx);
  if (mode === 'edit') section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// -- Item and order chips ------------------------------------------------------------------------------------------------

function itemRowHtml(ctx, key, nameHtml, statsHtml, extra, children, issueKey) {
  const keyLink = issueKey ? `<span class="vs-item-jira-key">${issueLinkHtml(ctx, issueKey)}</span>` : '';
  const expand = children
    ? `<button type="button" class="ds-icon-btn ds-icon-btn--sm vs-item-expand" aria-label="Expand" aria-expanded="false">${ICON.chevron}</button>`
    : '';
  return `<div class="vs-item-row" data-item="${escHtml(key)}">
      ${keyLink}
      <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm vs-item-select" aria-pressed="${extra.selected}" data-item="${escHtml(key)}">
        <span class="vs-item-name">${nameHtml}</span>${extra.badge || ''}${statsHtml ? `<span class="vs-item-sep">|</span><span class="vs-item-stats">${statsHtml}</span>` : ''}
      </button>
      ${expand}
    </div>${children ? `<div class="vs-item-children" hidden>${children}</div>` : ''}`;
}

function childCell(name, stats, epicName) {
  return `<div class="vs-child-cell"><span class="vs-child-name">${name}</span>${epicName || ''}<span class="vs-child-stats">${stats}</span></div>`;
}

function renderItemChips(ctx, area, mode, vendor, from, selected) {
  const wrap = $('vs-items-wrap');
  if (!wrap) return;
  const search = $('vs-items-search');
  if (search) search.value = '';
  if (!from || !vendor) {
    wrap.innerHTML = '<span class="vs-items-empty">Choose a period and a vendor to see the items.</span>';
    return;
  }
  const selSet = new Set(selected);
  const d = ctx.data;
  const empty = (txt) => { wrap.innerHTML = `<span class="vs-items-empty">${txt}</span>`; };
  const selAll = $('vs-select-all-btn');

  if (mode === 'custom') {
    const totals = getPersonTotalsForVendor(area, vendor, from, from, d);
    if (totals.size === 0) { empty('No people for the chosen vendor in this period'); return; }
    wrap.innerHTML = Array.from(totals.keys()).map(name => itemRowHtml(
      ctx, name, escHtml(name), '', { selected: selSet.has(name) }, '', '',
    )).join('');
  } else if (mode === 'epics') {
    const totals = getEpicTotalsForVendor(area, vendor, from, from, d);
    if (totals.size === 0) { empty('No epics for the chosen vendor in this period'); return; }
    wrap.innerHTML = Array.from(totals.entries()).map(([key, t]) => {
      const kids = t.persons.slice().sort((a, b) => b.amount - a.amount)
        .map(p => childCell(escHtml(p.name), `${fmtH(p.hours)} | ${fmtMoney(p.amount)}`)).join('');
      return itemRowHtml(ctx, key, escHtml(t.name), `${fmtH(t.hours)} | ${fmtMoney(t.amount)}`, { selected: selSet.has(key) }, kids, key);
    }).join('');
  } else {
    const totals = getPersonTotalsForVendor(area, vendor, from, from, d);
    if (totals.size === 0) { empty('No people for the chosen vendor in this period'); return; }
    wrap.innerHTML = Array.from(totals.entries()).map(([name, t]) => {
      const kids = t.epics.map(ep => childCell(
        escHtml(ep.key), `${fmtH(ep.hours)} | ${fmtMoney(ep.amount)}`,
        `<span class="vs-child-epic-name" title="${escHtml(ep.name)}">${escHtml(ep.name)}</span>`,
      )).join('');
      return itemRowHtml(ctx, name, escHtml(name), `${fmtH(t.hours)} | ${fmtMoney(t.amount)}`, { selected: selSet.has(name) }, kids, '');
    }).join('');
  }
  if (selAll) selAll.textContent = 'Select all';
}

function filterRows(wrapId, test) {
  const wrap = $(wrapId);
  if (!wrap) return;
  wrap.querySelectorAll('.vs-item-row').forEach(row => {
    const hidden = !test(row);
    row.hidden = hidden;
    const children = row.nextElementSibling;
    if (children && children.classList.contains('vs-item-children')) {
      if (hidden) {
        children.hidden = true;
      } else {
        const expandBtn = row.querySelector('.vs-item-expand');
        children.hidden = !(expandBtn && expandBtn.getAttribute('aria-expanded') === 'true');
      }
    }
  });
}

function filterItemRows(query) {
  const needle = query.trim().toLowerCase();
  filterRows('vs-items-wrap', (row) => {
    let hay = '';
    const nameEl = row.querySelector('.vs-item-name');
    if (nameEl) hay += nameEl.textContent.toLowerCase();
    const keyEl = row.querySelector('.vs-item-jira-key');
    if (keyEl) hay += ' ' + keyEl.textContent.toLowerCase();
    return needle === '' || hay.indexOf(needle) !== -1;
  });
}

function filterPoRows() {
  const needle = selVal('vs-po-search').trim().toLowerCase();
  const areaFilter = selVal('vs-po-area-filter');
  filterRows('vs-po-wrap', (row) => {
    let hay = (row.dataset.po || '').toLowerCase() + ' ';
    const nameEl = row.querySelector('.vs-item-name');
    if (nameEl) hay += nameEl.textContent.toLowerCase();
    return (needle === '' || hay.indexOf(needle) !== -1) && (areaFilter === '' || (row.dataset.area || '') === areaFilter);
  });
}

function renderPoChips(ctx, vendor, selectedNumber, editId) {
  const wrap = $('vs-po-wrap');
  if (!wrap) return;
  const search = $('vs-po-search');
  if (search) search.value = '';
  ctx.ui.selectedPo = { number: selectedNumber || '', name: '' };

  const areaLabelFor = (g) => (g.area ? (AREA_LABELS[g.area] || g.area) : '');
  const groups = buildPoGroups(vendor, editId, ctx.data);

  // Repopulate the area filter from the areas present in this picker.
  const areaSel = $('vs-po-area-filter');
  if (areaSel) {
    const prev = areaSel.value;
    const present = [...new Set(groups.map(areaLabelFor).filter(Boolean))].sort();
    areaSel.innerHTML = '<option value="">All areas</option>'
      + present.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');
    areaSel.value = present.includes(prev) ? prev : '';
  }
  if (groups.length === 0) {
    wrap.innerHTML = '<span class="vs-items-empty">No purchase orders for the chosen vendor (add them to vendor-settlements/purchase-orders.json)</span>';
    return;
  }

  wrap.innerHTML = groups.map(g => {
    const isSelected = g.po_number === selectedNumber;
    if (isSelected) ctx.ui.selectedPo = { number: g.po_number, name: g.title };
    const overrun = g.available < 0 ? ' vs-po-overrun' : '';
    const summary = childCell('Order', fmtMoney(g.order_amount))
      + childCell('Settled', fmtMoney(g.settled_amount))
      + childCell('Assigned', fmtMoney(g.assigned_amount));
    const prots = g.protocols.map((p, i) => childCell(
      escHtml(p.protocol_number || `Protocol #${i + 1}`),
      `${fmtMoney(p.amount)} | ${escHtml(p.status || '—')}`,
    )).join('');
    const prefix = g.area ? '[' + escHtml(areaLabelFor(g)) + '] ' : '';
    return `<div class="vs-item-row" data-po="${escHtml(g.po_number)}" data-area="${escHtml(areaLabelFor(g))}">
        <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm vs-item-select" aria-pressed="${isSelected}" data-po="${escHtml(g.po_number)}" data-po-name="${escHtml(g.title)}">
          <code class="vs-item-po-key">${escHtml(g.po_number)}</code>
          <span class="vs-item-name">${prefix}${escHtml(g.title)}</span>
          <span class="vs-item-sep">|</span>
          <span class="vs-item-stats${overrun}">available: ${fmtMoney(g.available)}</span>
        </button>
        <button type="button" class="ds-icon-btn ds-icon-btn--sm vs-item-copy" data-copy="${escHtml(g.po_number)}" aria-label="Copy the order number" title="Copy the order number">${ICON.copyLine}</button>
        <button type="button" class="ds-icon-btn ds-icon-btn--sm vs-item-expand" aria-label="Expand" aria-expanded="false">${ICON.chevron}</button>
      </div>
      <div class="vs-item-children" hidden>${summary}${prots}</div>`;
  }).join('');
}

function currentAmount(ctx) {
  const mode = getModalMode();
  if (mode === 'custom') return parseAmountInput(selVal('vs-form-amount')) || 0;
  const items = getSelectedItems();
  return items.length > 0 && ctx.ui.periodMonth
    ? sumCostsForSelection(getModalArea(), selVal('vs-form-vendor'), mode, items, ctx.ui.periodMonth, ctx.ui.periodMonth, ctx.data)
    : 0;
}

function updateSelectionAmount(ctx) {
  const input = $('vs-amount-selected');
  if (!input) return;
  if (getModalMode() === 'custom') { input.value = ''; return; }
  const full = currentAmount(ctx);
  input.value = full > 0 ? full.toFixed(2) : '';
}

function updatePoWarning(ctx) {
  const el = $('vs-po-warning');
  if (!el) return;
  const number = ctx.ui.selectedPo.number;
  if (!number) { el.hidden = true; return; }
  const amount = currentAmount(ctx);
  const available = computeAvailableOnPo(number, ctx.ui.editId, ctx.data);
  if (available !== null && amount > available) {
    el.hidden = false;
    el.textContent = `Over the order by ${fmtMoney(amount - available)}`;
  } else {
    el.hidden = true;
  }
}

function refreshFormDerived(ctx) {
  updateSelectionAmount(ctx);
  updatePoWarning(ctx);
}

function onPeriodOrVendorChange(ctx) {
  ctx.ui.periodMonth = selVal('vs-period-month');
  updateSectionsVisibility(ctx);
  const area = getModalArea();
  const vendor = selVal('vs-form-vendor');
  renderItemChips(ctx, area, getModalMode(), vendor, ctx.ui.periodMonth, []);
  if (vendor && ctx.ui.periodMonth) renderPoChips(ctx, vendor, null, ctx.ui.editId);
  refreshFormDerived(ctx);
}

// -- Submit / delete ------------------------------------------------------------------------------------------------------------

async function submitForm(ctx) {
  const area = getModalArea();
  const mode = getModalMode();
  const items = getSelectedItems();
  ctx.ui.periodMonth = selVal('vs-period-month');
  const month = ctx.ui.periodMonth;
  const vendor = selVal('vs-form-vendor');
  const title = selVal('vs-form-title').trim();
  const poNumber = ctx.ui.selectedPo.number;
  const poName = ctx.ui.selectedPo.name || null;

  let amount;
  let amountFull;
  if (mode === 'custom') {
    const parsed = parseAmountInput(selVal('vs-form-amount'));
    if (parsed === null) { ctx.toast('warning', 'Enter a valid amount, e.g. 1,234.56'); return; }
    amount = parsed;
  } else {
    amountFull = currentAmount(ctx);
    amount = amountFull;
  }

  if (!title) { ctx.toast('warning', 'Enter a title for the settlement'); return; }
  if (!vendor) { ctx.toast('warning', 'Choose a vendor'); return; }
  if (!month) { ctx.toast('warning', 'Choose the period'); return; }
  if (mode !== 'custom' && items.length === 0) { ctx.toast('warning', 'Choose at least one item'); return; }
  if (mode === 'custom' && !amount) { ctx.toast('warning', 'Enter a custom amount (it may be negative as a correction)'); return; }
  if (!poNumber) { ctx.toast('warning', 'Choose a purchase order'); return; }

  const link = selVal('vs-form-link').trim();
  const body = {
    area,
    title: title || undefined,
    period_from: month + '-01',
    period_to: periodLast(month),
    vendor,
    mode,
    items,
    amount,
    amount_full: amountFull !== undefined && amountFull > 0 ? amountFull : undefined,
    po_number: poNumber,
    po_name: poName,
    protocol_link: link || undefined,
  };
  const editing = ctx.ui.modalMode === 'edit';
  if (editing) body.id = ctx.ui.editId;

  const btn = $('vs-save-btn');
  if (btn) btn.disabled = true;
  let res;
  try {
    res = await ctx.api('POST', editing ? '/summary/update' : '/summary/add', body);
  } finally {
    if (btn && ctx.live()) btn.disabled = false;
  }
  if (!ctx.live()) return;
  if (!res.ok) {
    ctx.toast('danger', 'Could not save', ctx.errMsg(res));
    return;
  }
  openModal(ctx, 'add', null);
  ctx.toast('success', editing ? 'Updated' : 'Saved');
  if (res.data && res.data.protocolSynced === false) {
    ctx.toast('warning', 'The settlement was saved, but its protocol could not be synchronised', 'Check the team data and save the settlement again.');
  }
  await afterWrite();
}

async function deleteAssignment(ctx, id, trigger) {
  const a = ((ctx.data.summary && ctx.data.summary.assignments) || []).find(x => x.id === id);
  let ok = true;
  if (_dsModal) {
    ok = await _dsModal.confirmDsModal({
      title: 'Delete the settlement?',
      body: a ? `${a.vendor} · ${a.title || ''} — ${fmtMoney(a.amount)}. This cannot be undone.` : 'This cannot be undone.',
      okLabel: 'Delete',
      danger: true,
      trigger,
    });
  }
  if (!ok || !ctx.live()) return;
  const res = await ctx.api('POST', '/summary/delete', { id });
  if (!ctx.live()) return;
  if (!res.ok) {
    ctx.toast('danger', 'Could not delete', ctx.errMsg(res));
    return;
  }
  ctx.toast('success', 'Deleted');
  await afterWrite();
}

// -- List ------------------------------------------------------------------------------------------------------------------------------

function renderEmptyState() {
  const root = $('vs-table-root');
  if (!root) return;
  root.innerHTML = emptyStateHtml(ICON.clipboard, 'No settlements yet',
    'Fill in the "Vendor settlement" form above to add the first vendor -> order settlement.');
  const sec = $('vsprot-section');
  if (sec) sec.hidden = true;
}

function renderTable(assignments) {
  const root = $('vs-table-root');
  if (!root) return;
  if (assignments.length === 0) { renderEmptyState(); return; }

  const btn = (cls, id, label, icon, extra) => `<button type="button" class="ds-icon-btn ds-icon-btn--sm ${cls}" data-id="${escHtml(id)}" aria-label="${label}" title="${label}"${extra || ''}>${icon}</button>`;
  const rows = assignments.map(a => {
    const modeLabel = a.mode === 'epics' ? 'Epics' : a.mode === 'persons' ? 'People' : 'Custom';
    const periodLabel = a.period_from ? fmtMonthLabel(a.period_from.slice(0, 7)) : '--';
    const hasItems = a.mode !== 'custom' && (a.items || []).length > 0;
    const accepted = a.accepted_at ? `Already accepted ${fmtDateTime(a.accepted_at)}` : '';
    const accept = a.accepted_at
      ? `<span title="${escHtml(accepted)}">${btn('vs-accept-btn', a.id, 'Mark as accepted', ICON.check, ' disabled aria-disabled="true"')}</span>`
      : btn('vs-accept-btn', a.id, 'Mark as accepted', ICON.check);
    const edit = a.accepted_at
      ? `<span title="${escHtml(accepted)}">${btn('vs-edit-btn', a.id, 'Edit', ICON.edit, ' disabled aria-disabled="true"')}</span>`
      : btn('vs-edit-btn', a.id, 'Edit', ICON.edit);
    return `<tr>
      <td class="vs-col-added">${escHtml(fmtDateTime(a.created_at) || '—')}</td>
      <td>${escHtml(AREA_LABELS[a.area] || a.area)}</td>
      <td>${escHtml(a.title || '')}</td>
      <td>${escHtml(periodLabel)}</td>
      <td>${escHtml(a.vendor)}</td>
      <td>${escHtml(modeLabel)}</td>
      <td class="vs-center">${hasItems ? btn('vs-items-btn', a.id, 'Preview items', ICON.eye) : '<span class="vs-muted">&mdash;</span>'}</td>
      <td class="right">${fmtMoney(a.amount)}</td>
      <td class="vs-nowrap">${escHtml(a.po_number)}<button type="button" class="ds-icon-btn ds-icon-btn--sm vs-copy-po" data-copy="${escHtml(a.po_number)}" aria-label="Copy the order number" title="Copy the order number">${ICON.copyLine}</button></td>
      <td>${escHtml(a.po_name || '')}</td>
      <td><div class="vs-actions">${accept}${btn('vs-copy-btn', a.id, 'Copy to clipboard', ICON.copy)}${edit}${btn('vs-del-btn', a.id, 'Delete', ICON.del)}</div></td>
    </tr>`;
  }).join('');

  root.innerHTML = `<div class="ds-table-wrap"><table class="ds-table">
      <thead><tr>
        <th>Added</th><th>Area</th><th>Title</th><th>Period</th><th>Vendor</th><th>Mode</th>
        <th class="vs-center">Items</th><th class="right">Amount</th><th>Order number</th><th>Order name</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function populateFilterSelects(ctx, all) {
  const vSel = $('vs-filter-vendor');
  const mSel = $('vs-filter-month');
  if (!vSel || !mSel) return;
  const seen = new Map();
  for (const v of new Set(all.map(a => a.vendor).filter(Boolean))) {
    const canon = canonicalVendor(v, ctx.data);
    if (!seen.has(canon.toLowerCase())) seen.set(canon.toLowerCase(), canon);
  }
  const vendors = [...seen.values()].sort();
  const prevV = vSel.value;
  vSel.innerHTML = '<option value="">All vendors</option>'
    + vendors.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  const canonPrev = prevV ? canonicalVendor(prevV, ctx.data) : '';
  if (canonPrev && vendors.includes(canonPrev)) vSel.value = canonPrev;

  const months = [...new Set(all.map(a => (a.period_from ? a.period_from.slice(0, 7) : '')).filter(Boolean))].sort().reverse();
  const prevM = mSel.value;
  mSel.innerHTML = '<option value="">All months</option>'
    + months.map(m => `<option value="${m}">${escHtml(fmtMonthLabel(m))}</option>`).join('');
  if (prevM && months.includes(prevM)) mSel.value = prevM;
}

function renderView(ctx) {
  if (!ctx.live() || !$('vs-table-root')) return;
  const data = ctx.data.summary;
  const meta = (data && data.meta) || {};
  const all = (data && data.assignments) || [];
  const f = ctx.ui.filter;

  const total = $('vs-meta-total');
  if (total) total.textContent = `Total: ${all.length}`;
  const updated = $('vs-meta-updated');
  if (updated && meta.last_updated) updated.textContent = 'Updated: ' + fmtDateTime(meta.last_updated);

  populateFilterSelects(ctx, all);

  const q = f.search.toLowerCase();
  const filtered = all.filter(a => {
    if (f.area && a.area !== f.area) return false;
    if (f.vendor && !vendorNameMatches(a.vendor, f.vendor)) return false;
    if (f.month && (!a.period_from || !a.period_from.startsWith(f.month))) return false;
    if (q) {
      const hay = [a.vendor, a.title, a.po_number, a.po_name, ...(a.items || [])].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  renderTable(filtered);

  const sum = filtered.reduce((s, a) => s + (a.amount || 0), 0);
  const bar = $('vs-summary-bar');
  if (bar) {
    bar.innerHTML = filtered.length > 0
      ? `<div class="vs-summary-row">
          <span class="vs-summary-label">Showing: <strong>${filtered.length}</strong> of ${all.length}</span>
          <span class="vs-summary-amount">Total amount: <strong>${fmtMoney(sum)}</strong></span>
        </div>`
      : '';
  }

  // Form selects follow the data unless a settlement is being edited.
  if (ctx.ui.modalMode !== 'edit') {
    populateVendorSelect(getModalArea());
    fillPeriodSelect(ctx, getModalArea());
  }
  renderProtocolGenSection(ctx);
  if (ctx.chart) ctx.chart.render();
}

// -- Events ------------------------------------------------------------------------------------------------------------------------------

function copyText(ctx, text, okTitle, okDesc) {
  navigator.clipboard.writeText(text).then(
    () => ctx.toast('success', okTitle, okDesc || ''),
    () => ctx.toast('warning', 'Copy failed', 'No access to the clipboard'),
  );
}

function findAssignment(ctx, id) {
  return ((ctx.data.summary && ctx.data.summary.assignments) || []).find(x => x.id === id);
}

function toggleExpand(btn) {
  const row = btn.closest('.vs-item-row');
  const children = row ? row.nextElementSibling : null;
  if (!children || !children.classList.contains('vs-item-children')) return;
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  btn.classList.toggle('expanded', !open);
  children.hidden = open;
}

function onRowAction(ctx, btn) {
  const id = btn.dataset.id;
  const a = findAssignment(ctx, id);
  if (btn.classList.contains('vs-del-btn')) { deleteAssignment(ctx, id, btn); return; }
  if (!a) return;
  if (btn.classList.contains('vs-items-btn')) { openItemsModal(ctx, a, btn); return; }
  if (btn.classList.contains('vs-accept-btn')) { if (!a.accepted_at) openAcceptModal(ctx, a, btn); return; }
  if (btn.classList.contains('vs-edit-btn')) { if (!a.accepted_at) openModal(ctx, 'edit', a); return; }
  if (btn.classList.contains('vs-copy-btn')) {
    const periodLabel = a.period_from ? fmtMonthLabel(a.period_from.slice(0, 7)) : '--';
    const header = ['Area', 'Title', 'Vendor', 'Amount', 'Order number', 'Order name'].join('\t');
    const row = [AREA_LABELS[a.area] || a.area, a.title || '', a.vendor, fmtMoney(a.amount), a.po_number, a.po_name || ''].join('\t');
    copyText(ctx, `${header}\n${row}`, 'Copied', `${a.vendor} | ${periodLabel}`);
  }
}

function onClick(ctx, e) {
  if (!ctx.live()) return;
  const t = e.target;
  if (handleProtClick(ctx, e)) return;

  const seg = t.closest('.vs-area-segment');
  if (seg) { setModalArea(seg.dataset.area); return; }
  const modeSeg = t.closest('.vs-mode-segment');
  if (modeSeg) { setModalMode(ctx, modeSeg.dataset.mode); return; }

  const copyBtn = t.closest('.vs-item-copy, .vs-copy-po');
  if (copyBtn) { e.stopPropagation(); copyText(ctx, copyBtn.dataset.copy, 'Copied', copyBtn.dataset.copy); return; }
  const expand = t.closest('.vs-item-expand');
  if (expand) { e.stopPropagation(); toggleExpand(expand); return; }

  const select = t.closest('.vs-item-select');
  if (select) {
    if (select.closest('#vs-po-wrap')) {
      const wrap = $('vs-po-wrap');
      const was = select.getAttribute('aria-pressed') === 'true';
      wrap.querySelectorAll('.vs-item-select').forEach(b => b.setAttribute('aria-pressed', 'false'));
      if (!was) {
        select.setAttribute('aria-pressed', 'true');
        ctx.ui.selectedPo = { number: select.dataset.po, name: select.dataset.poName };
      } else {
        ctx.ui.selectedPo = { number: '', name: '' };
      }
      updatePoWarning(ctx);
    } else {
      select.setAttribute('aria-pressed', select.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      refreshFormDerived(ctx);
    }
    return;
  }

  const rowBtn = t.closest('.vs-items-btn, .vs-accept-btn, .vs-edit-btn, .vs-del-btn, .vs-copy-btn');
  if (rowBtn && !rowBtn.disabled) { onRowAction(ctx, rowBtn); return; }

  const btn = t.closest('button');
  if (!btn) return;
  switch (btn.id) {
    case 'vs-select-all-btn': {
      const all = document.querySelectorAll('#vs-items-wrap .vs-item-select');
      if (!all.length) return;
      const allSelected = Array.from(all).every(b => b.getAttribute('aria-pressed') === 'true');
      all.forEach(b => b.setAttribute('aria-pressed', allSelected ? 'false' : 'true'));
      btn.textContent = allSelected ? 'Select all' : 'Clear selection';
      refreshFormDerived(ctx);
      return;
    }
    case 'vs-collapse-all-btn':
      document.querySelectorAll('#vs-items-wrap .vs-item-expand[aria-expanded="true"]').forEach(toggleExpand);
      return;
    case 'vs-save-btn': submitForm(ctx); return;
    case 'vs-cancel-btn': openModal(ctx, 'add', null); return;
    case 'vs-filter-search-clear': {
      const s = $('vs-filter-search');
      if (s) s.value = '';
      ctx.ui.filter.search = '';
      renderView(ctx);
      return;
    }
    default:
  }
}

function onChange(ctx, e) {
  if (!ctx.live()) return;
  if (handleProtChange(ctx, e)) return;
  const id = e.target.id;
  if (id === 'vs-period-month' || id === 'vs-form-vendor') { onPeriodOrVendorChange(ctx); return; }
  if (id === 'vs-po-area-filter') { filterPoRows(); return; }
  const map = { 'vs-filter-area': 'area', 'vs-filter-vendor': 'vendor', 'vs-filter-month': 'month' };
  if (map[id]) {
    ctx.ui.filter[map[id]] = e.target.value;
    renderView(ctx);
  }
}

function onInput(ctx, e) {
  if (!ctx.live()) return;
  const id = e.target.id;
  if (id === 'vs-filter-search') { ctx.ui.filter.search = e.target.value.trim(); renderView(ctx); }
  else if (id === 'vs-items-search') filterItemRows(e.target.value);
  else if (id === 'vs-po-search') filterPoRows();
  else if (id === 'vs-form-amount') updatePoWarning(ctx);
}

// -- View lifecycle ---------------------------------------------------------------------------------------------------------

async function startView(ctx, root) {
  const st = await ctx.api('GET', '/status');
  if (!ctx.live()) return;
  ctx.status = st.ok ? st.data : null;

  if (!st.ok || st.data.storage !== 'ok') {
    root.innerHTML = emptyStateHtml(ICON.lock, 'No team data on this computer', st.ok ? MSG_STORAGE : ctx.errMsg(st));
    return;
  }

  root.innerHTML = shellHtml();
  listen(ctx, root, 'click', (e) => onClick(ctx, e));
  listen(ctx, root, 'change', (e) => onChange(ctx, e));
  listen(ctx, root, 'input', (e) => onInput(ctx, e));

  if (!(await loadAll(ctx))) {
    const tr = $('vs-table-root');
    if (tr) tr.innerHTML = '<div class="ds-callout ds-callout--danger"><div>Could not load the data. Use "Refresh" to try again.</div></div>';
    return;
  }
  ctx.chart = initSettlementsChart({
    getData: () => ctx.data,
    getModalArea,
    setModalArea,
    showToast: (v, t, d) => ctx.toast(v, t, d),
  });
  openModal(ctx, 'add', null);
  renderView(ctx);
}

export const views = {

  'vendor-settlements-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;
      _dsModalP = (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
      // Cleanups register in render(): init() runs once, the registry is
      // consumed on every exit from the view.
    },

    /**
     * Every navigation into the view AND every data reload. The header slot is
     * a fresh element each time, so it is painted here.
     * @param {string} _subPath
     * @param {object} _opts
     */
    async render(_subPath, _opts) {
      const root = $(ROOT_ID);
      if (!root) return;
      teardownCtx(_ctx);
      _epoch += 1;
      if (_dsModalP) await _dsModalP;
      const ctx = makeCtx(_epoch);
      _ctx = ctx;
      _deps.registerViewCleanup(() => teardownCtx(ctx));

      const actions = $(ACTIONS_ID);
      if (actions) {
        actions.innerHTML = '<span class="refresh-ts" id="vs-meta-updated"></span>'
          + '<button type="button" class="ds-btn ds-btn--secondary" id="vs-refresh-btn">Refresh</button>';
        listen(ctx, actions, 'click', (e) => {
          const b = e.target.closest('#vs-refresh-btn');
          if (!b || !ctx.live()) return;
          if (ctx.chart) openRefreshModal(ctx, b);
          else views['vendor-settlements-main'].render('', {});
        });
      }
      root.innerHTML = '<div class="ds-callout ds-callout--info"><div>Loading data...</div></div>';
      await startView(ctx, root);
    },
  },
};
