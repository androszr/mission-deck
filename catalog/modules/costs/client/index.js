// modules/costs/client/index.js
// Costs - hours from Tempo times daily rates, person x month.
// One view: export const views = { 'costs-main': { init(deps), render(subPath, opts) } }
// deps: { navigate, registerViewCleanup, showToast, apiBase }.
// Core ESM (/js/team-directory.js, /js/ds-modal.js) is imported dynamically in
// init(), in try/catch, so a plain-Node import of this file works in tests.
// DS classes only; tokens from css/ds-tokens.css, never a hex.

import {
  AREAS, AREA_LABELS, CURRENCY, fmtMoney, fmtHours, monthLabel, monthStartsBetween, lastDayOfMonth,
  rowsForArea, summaryFor, metricText, columnTotals,
  treeCellText, treeCellUnpriced, sortByMetric, filterEpics, sumEpics, cleanTempoName, personEpics,
} from './costs-lib.js';

export { AREAS, fmtMoney, fmtHours, monthLabel, monthStartsBetween, rowsForArea, summaryFor };

const ROOT_ID = 'costs-main-root';
const ACTIONS_ID = 'costs-main-actions';
const MODAL_ID = 'costs-range-modal';
const TABS = AREAS;
const RANGE_KEY = 'costs.range.v2';
const CONFIG_MODAL_ID = 'costs-config-modal';
const DASH = '—';
const NO_COMPANY = 'No company';
const POLL_MS = 2000;
const MSG_STORAGE = 'The "Team data" source is not fetched and decrypted on this computer. Fetch it in the Sync window on the top bar - the data-tier-0 key is needed.';

let _deps = null;
let _teamDir = null;
let _dsModal = null;
let _tab = 'atlas';
let _from = '';
let _to = '';
let _rangeOpen = false;
// Draft of the single range calendar: first click = start, second = end.
let _calFrom = '';
let _calTo = '';
let _calView = '';
let _configOverlay = null;
let _openConfigAfter = false;
let _metric = 'cost';
let _view = 'epics';
let _tree = null;
const _exp = new Set();
let _query = '';
let _cfgQuery = '';
let _onlyIncluded = false;
let _unassignedOpen = false;
let _rowSeq = 0;
let _status = null;
let _data = null;
let _config = null;
let _editRateId = null;
let _pollTimer = null;
let _wired = false;
let _starting = false;
let _epoch = 0;

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _api(p) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/costs') + p;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

async function _req(method, p, body) {
  const init = { method };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body || {});
  }
  try {
    const r = await fetch(_api(p), init);
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    return { ok: r.ok, status: r.status, data: data || {} };
  } catch {
    return { ok: false, status: 0, data: { error: 'network', message: 'No connection to the server.' } };
  }
}

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? m[3] + '.' + m[2] + '.' + m[1] : DASH;
}

function fmtDateTime(iso) {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleString('en-GB');
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function validIso(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime());
}

function rangeLabel() {
  return _from && _to ? fmtDate(_from) + ' – ' + fmtDate(_to) : DASH;
}

function _saveRange() {
  try { window.localStorage.setItem(RANGE_KEY, JSON.stringify({ from: _from, to: _to })); } catch { /* optional */ }
}

/** Default / remembered range, clamped to the fetched data (dateMin/dateMax of /status). */
function _initRange() {
  const today = todayIso();
  if (!_from || !_to) {
    let saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(RANGE_KEY) || 'null'); } catch { saved = null; }
    if (saved && validIso(saved.from) && validIso(saved.to) && saved.from <= saved.to) { _from = saved.from; _to = saved.to; }
    else { _from = _defaultFrom(today); _to = today; }
  }
  _clampRange();
}

function _clampRange() {
  const lo = _status && _status.dateMin;
  const hi = _status && _status.dateMax;
  if (!lo || !hi) return;
  if (_from < lo) _from = lo;
  if (_to > hi) _to = hi;
  if (_from > _to) { _from = lo; _to = hi; }
}

function _rangeQuery() {
  return 'from=' + encodeURIComponent(_from) + '&to=' + encodeURIComponent(_to);
}

// -- team directory bridge ---------------------------------------------------

function _avatarHtml(person) {
  const member = _teamDir && typeof _teamDir.memberById === 'function' ? _teamDir.memberById(person.id) : null;
  const url = member && typeof _teamDir.memberAvatarUrl === 'function' ? _teamDir.memberAvatarUrl(member) : '';
  if (url) return '<img class="costs-avatar" src="' + esc(url) + '" alt="" loading="lazy">';
  const ini = _teamDir && typeof _teamDir.memberInitials === 'function' ? _teamDir.memberInitials(person.name) : '';
  return '<span class="costs-avatar costs-avatar--initials" aria-hidden="true">' + esc(ini) + '</span>';
}

// -- header slot -------------------------------------------------------------

function _canFetch() {
  return !!(_status && _status.token && _status.storage === 'ok');
}

function _running() {
  return !!(_status && _status.job && _status.job.running);
}

function _paintActions() {
  const slot = document.getElementById(ACTIONS_ID);
  if (!slot) return;
  const busy = _running() || _starting;
  const disabled = !_canFetch();
  slot.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-costs-config>Configuration</button> '
    + '<button type="button" class="ds-btn ds-btn--primary" data-costs-fetch'
    + (busy ? ' aria-busy="true"' : '') + (disabled || busy ? ' disabled' : '') + '>Fetch from Tempo</button>';
}

// -- painting ----------------------------------------------------------------

function _callouts() {
  const out = [];
  if (_status && _status.storage === 'unavailable') {
    out.push('<div class="ds-callout ds-callout--warning"><div>' + esc(MSG_STORAGE) + '</div></div>');
  }
  if (_status && !_status.token) {
    out.push('<div class="ds-callout ds-callout--warning"><div>No Jira token - unlock the Bitwarden vault on the top bar.</div></div>');
  }
  if (_status && _status.storage === 'ok' && _data && !_data.available) {
    out.push('<div class="ds-callout ds-callout--info"><div>No hours in the period ' + esc(rangeLabel()) + ' - change the period or click Fetch from Tempo.</div></div>');
  }
  if (_data && _data.storage === 'ok' && (_data.persons || []).length === 0) {
    out.push('<div class="ds-callout ds-callout--info"><div class="costs-cell-actions">Nobody is marked as In costs yet.'
      + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-costs-config>Open the configuration</button></div></div>');
  }
  if (_view === 'epics' && _treeFresh() && (_tree.legacyMonths || []).length) {
    out.push('<div class="ds-callout ds-callout--info"><div>These months were fetched without a split by issue - click Fetch from Tempo to refresh them: '
      + esc(_tree.legacyMonths.map(monthLabel).join(', ')) + '.</div></div>');
  }
  const noDaily = _data && Array.isArray(_data.monthInfo) ? _data.monthInfo.filter((m) => m.noDaily).map((m) => m.month) : [];
  if (noDaily.length) {
    out.push('<div class="ds-callout ds-callout--info"><div>Month without daily data - fetch it again so the date filter works to the day: '
      + esc(noDaily.map(monthLabel).join(', ')) + '. Until then the whole month is counted.</div></div>');
  }
  const warnings = _status && _status.lastRun && Array.isArray(_status.lastRun.warnings) ? _status.lastRun.warnings : [];
  if (warnings.length) {
    out.push('<div class="ds-callout ds-callout--warning"><div>Last fetch: the hours were saved, but some issue details from Jira are missing. '
      + esc(warnings[0]) + (warnings.length > 1 ? ' (+' + (warnings.length - 1) + ')' : '') + '</div></div>');
  }
  return out.map((c) => '<div class="costs-callout">' + c + '</div>').join('');
}

function _statsHtml() {
  const have = _data && _data.storage === 'ok' && _data.available;
  const s = have ? summaryFor(_data.summary, _tab) : null;
  const latest = _latestFetch();
  const danger = (n) => (n > 0 ? ' ds-stat-value--danger' : '');
  const tile = (value, label, cls) => '<div class="ds-card ds-stat"><div class="ds-stat-value' + (cls || '') + '">' + value + '</div><div class="ds-stat-label">' + label + '</div></div>';
  return '<div class="ds-stat-row costs-stats">'
    + '<div class="ds-card ds-stat-subject"><div>' + esc(rangeLabel()) + (latest ? '<div class="costs-muted">fetched up to ' + esc(fmtDate(latest)) + '</div>' : '') + '</div></div>'
    + tile(s ? fmtMoney(s.cost) : DASH, 'Total cost')
    + tile(s ? fmtHours(s.hours) : DASH, 'Total hours')
    + tile(s ? String(s.personsNoRate) : DASH, 'People without a rate', s ? danger(s.personsNoRate) : '')
    + tile(s ? fmtHours(s.hoursNoRate) : DASH, 'Hours without a rate', s ? danger(s.hoursNoRate) : '')
    + '</div>';
}

function _tabsHtml() {
  return '<div class="ds-tabs-list ds-framed-tabs costs-tabs" role="tablist" aria-label="Cost areas">'
    + TABS.map((t) => '<button type="button" class="ds-tab' + (t === _tab ? ' active' : '') + '" role="tab" id="costs-tab-' + t + '" data-costs-tab="' + t + '"'
      + ' aria-controls="costs-panel" aria-selected="' + (t === _tab) + '">' + AREA_LABELS[t] + '</button>').join('')
    + '</div>';
}

const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CAL_DOWS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const RANGE_PRESETS = [['month', 'Current month'], ['prev-month', 'Previous month'], ['quarter', 'Current quarter'], ['ytd', 'Year to date'],
  ['last3', 'Last 3 months'], ['last12', 'Last 12 months'], ['all', 'Whole fetched range']];

/** Default period: the current month plus the three before it. */
function _defaultFrom(today) {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7)) - 3;
  if (m < 1) { m += 12; y -= 1; }
  return y + '-' + String(m).padStart(2, '0') + '-01';
}

function _pad2(n) { return String(n).padStart(2, '0'); }
function _fmtIso(iso) { return validIso(iso) ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '…'; }

function _calShift(view, delta) {
  let y = Number(view.slice(0, 4));
  let m = Number(view.slice(5, 7)) + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return y + '-' + _pad2(m);
}

function _calendarHtml() {
  const lo = (_status && _status.dateMin) || '';
  const hi = (_status && _status.dateMax) || '';
  const y = Number(_calView.slice(0, 4));
  const m = Number(_calView.slice(5, 7));
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const canPrev = !lo || _calShift(_calView, -1) >= lo.slice(0, 7);
  const canNext = !hi || _calShift(_calView, 1) <= hi.slice(0, 7);
  let grid = CAL_DOWS.map((d) => '<span class="costs-cal-dow" aria-hidden="true">' + d + '</span>').join('');
  for (let i = 0; i < lead; i++) grid += '<span class="costs-cal-empty"></span>';
  const end = _calTo || _calFrom;
  for (let d = 1; d <= days; d++) {
    const iso = _calView + '-' + _pad2(d);
    const out = (lo && iso < lo) || (hi && iso > hi);
    let cls = 'costs-cal-day';
    if (iso === _calFrom) cls += ' is-start';
    if (iso === end) cls += ' is-end';
    if (_calFrom && end && iso > _calFrom && iso < end) cls += ' is-in';
    if (iso === todayIso()) cls += ' is-today';
    grid += '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm ' + cls + '" data-costs-cal-day="' + iso + '"' + (out ? ' disabled' : '')
      + ' aria-pressed="' + (iso === _calFrom || iso === end) + '" aria-label="' + esc(_fmtIso(iso)) + '">' + d + '</button>';
  }
  const hint = _calFrom && !_calTo ? 'Pick the end day' : 'Click the start day, then the end day';
  return '<div class="costs-range-body">'
    + '<div class="costs-range-presets" role="group" aria-label="Quick pick">'
    + RANGE_PRESETS.map(([k, l]) => '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm costs-preset" data-costs-preset="' + k + '">' + l + '</button>').join('') + '</div>'
    + '<div class="costs-cal">'
    + '<div class="costs-cal-head">'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm costs-cal-nav" data-costs-cal-nav="-1" aria-label="Previous month"' + (canPrev ? '' : ' disabled') + '>&#8249;</button>'
    + '<span class="costs-cal-title">' + CAL_MONTHS[m - 1] + ' ' + y + '</span>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm costs-cal-nav" data-costs-cal-nav="1" aria-label="Next month"' + (canNext ? '' : ' disabled') + '>&#8250;</button>'
    + '</div>'
    + '<div class="costs-cal-grid">' + grid + '</div>'
    + '<div class="costs-cal-sel"><span class="costs-range-caption">' + esc(hint) + '</span><strong>' + esc(_fmtIso(_calFrom)) + ' – ' + esc(_fmtIso(_calTo || _calFrom)) + '</strong></div>'
    + '</div></div>'
    + '<div class="costs-range-foot"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-costs-range-cancel>Cancel</button>'
    + '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-costs-range-apply' + (_calFrom ? '' : ' disabled') + '>Apply</button></div>';
}

function _rangeControlHtml() {
  return '<div class="costs-range">'
    + '<button type="button" class="ds-input costs-range-trigger" data-costs-range-trigger aria-haspopup="dialog" aria-expanded="' + _rangeOpen + '" aria-controls="costs-range-pop">'
    + '<span class="costs-range-caption">Period</span><span>' + esc(rangeLabel()) + '</span></button>'
    + (_rangeOpen ? '<div class="ds-card costs-range-pop" id="costs-range-pop" role="dialog" aria-label="Period">' + _calendarHtml() + '</div>' : '')
    + '</div>';
}

function _openCalendar() {
  _calFrom = _from;
  _calTo = _to;
  _calView = (validIso(_to) ? _to : todayIso()).slice(0, 7);
  _rangeOpen = true;
}

function _repaintCalendar() {
  const pop = document.getElementById('costs-range-pop');
  if (pop) pop.innerHTML = _calendarHtml();
}

function _presetRange(key) {
  const today = todayIso();
  const y = Number(today.slice(0, 4));
  const mo = Number(today.slice(5, 7));
  const pad = (n) => String(n).padStart(2, '0');
  const monthStart = (yy, mm) => yy + '-' + pad(mm) + '-01';
  const endOf = (yy, mm) => lastDayOfMonth(yy + '-' + pad(mm));
  const back = (n) => { let yy = y; let mm = mo - n; while (mm < 1) { mm += 12; yy -= 1; } return [yy, mm]; };
  if (key === 'month') return [monthStart(y, mo), today];
  if (key === 'prev-month') { const [yy, mm] = back(1); return [monthStart(yy, mm), endOf(yy, mm)]; }
  if (key === 'quarter') { const q = Math.floor((mo - 1) / 3) * 3 + 1; return [monthStart(y, q), today]; }
  if (key === 'last3') { const [yy, mm] = back(2); return [monthStart(yy, mm), today]; }
  if (key === 'last12') { const [yy, mm] = back(11); return [monthStart(yy, mm), today]; }
  if (key === 'all') return [(_status && _status.dateMin) || today.slice(0, 4) + '-01-01', (_status && _status.dateMax) || today];
  return [y + '-01-01', today];
}

function _segHtml(label, attr, items, current) {
  return '<div class="ds-segmented" role="group" aria-label="' + label + '">'
    + items.map(([k, l]) => '<button type="button" class="ds-segment' + (k === current ? ' active' : '') + '" ' + attr + '="' + k + '" aria-pressed="' + (k === current) + '">' + l + '</button>').join('')
    + '</div>';
}

function _latestFetch() {
  const have = _data && _data.storage === 'ok' && _data.available && Array.isArray(_data.monthInfo);
  return have ? _data.monthInfo.map((m) => m.fetchedAt).filter(Boolean).sort().pop() || null : null;
}

function _metaLine() {
  const info = _data && Array.isArray(_data.monthInfo) ? _data.monthInfo : [];
  const latest = _latestFetch();
  const parts = [];
  if (latest) parts.push('fetched up to ' + fmtDate(latest));
  if (info.some((m) => m.partial || m.clipped)) parts.push('* incomplete month');
  if (info.some((m) => m.noDaily)) parts.push('† month without daily data');
  return parts.length ? '<span class="costs-muted">' + esc(parts.join(' · ')) + '</span>' : '';
}

function _panelHtml() {
  const isEpics = _view === 'epics';
  const area = AREA_LABELS[_tab] || _tab;
  return '<div class="ds-section-head"><h2 class="ds-section-head-title">' + esc(area) + ' · costs by ' + (isEpics ? 'epic' : (_view === 'companies' ? 'company' : 'person')) + '</h2>' + _metaLine() + '</div>'
    + '<div class="costs-filters">'
    + '<input type="search" class="ds-input" data-costs-search placeholder="' + (isEpics ? 'Search epic, issue or key' : (_view === 'companies' ? 'Search person or company' : 'Search person')) + '" aria-label="Search" value="' + esc(_query) + '">'
    + _segHtml('View', 'data-costs-view', [['epics', 'Epics'], ['people', 'People'], ['companies', 'Companies']], _view)
    + _segHtml('Cell value', 'data-costs-metric', [['cost', 'Cost'], ['hours', 'Hours'], ['days', 'Days']], _metric)
    + _rangeControlHtml()
    + '<div class="costs-filters-end"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-costs-expand-all>Expand all</button>'
      + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-costs-collapse-all>Collapse all</button></div>'
    + '</div>'
    + '<div id="costs-table-box"></div>'
    + '<div id="costs-unassigned-box"></div>';
}

function _paint() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.innerHTML = _callouts() + _statsHtml() + _tabsHtml()
    + '<div id="costs-panel" role="tabpanel" aria-labelledby="costs-tab-' + _tab + '">' + _panelHtml() + '</div>';
  _paintTable();
  _paintConfig();
}

function _rateCell(p) {
  if (_editRateId === p.id) {
    return '<input type="number" class="ds-input ds-input--sm costs-rate-input" data-costs-rate-input="' + esc(p.id) + '" step="0.01" min="0" max="1000000" aria-label="Daily rate: ' + esc(p.name) + '" value="' + (p.rate === null ? '' : esc(p.rate)) + '">';
  }
  const label = p.rateMissing ? '<span class="ds-badge ds-badge--red" aria-label="No daily rate">No rate</span>' : '<span>' + esc(fmtMoney(p.rate)) + '</span>';
  return '<div class="costs-cell-actions">' + label
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-costs-edit-rate="' + esc(p.id) + '">Edit</button></div>';
}

function _monthTh(m, mi, legacy) {
  let mark = '';
  let title = '';
  if (legacy) { mark = '†'; title = 'fetched without a split by issue'; }
  else if (mi && mi.noDaily) { mark = '†'; title = 'Month without daily data - fetch it again'; }
  else if (mi && mi.partial) { mark = '*'; title = 'fetched up to ' + fmtDate(mi.dateTo); }
  else if (mi && mi.clipped) { mark = '*'; title = 'month incomplete in the selected period'; }
  return mark
    ? '<th class="costs-month--partial" title="' + esc(title) + '">' + esc(monthLabel(m)) + '<span aria-hidden="true">' + mark + '</span></th>'
    : '<th>' + esc(monthLabel(m)) + '</th>';
}

/** Cell renderer of a person-level row (rate missing -> dash with the hours in the tooltip). */
function _personCell(p, c) {
  if (_metric === 'cost' && p.rateMissing) {
    const t = 'no rate - ' + fmtHours(c.hours);
    return '<span title="' + esc(t) + '" aria-label="' + esc(t) + '">' + DASH + '</span>';
  }
  return esc(metricText(c, _metric));
}

/** One person row plus its expanded epics and tasks. `base` is the indent level of the person row. */
function _personBlock(p, months, byPerson, base, rowId) {
  const ended = p.endDate ? ' <span class="ds-badge ds-badge--gray" title="Works until ' + esc(_fmtIso(p.endDate)) + '">until ' + esc(_fmtIso(p.endDate)) + '</span>' : '';
  const label = _avatarHtml(p) + esc(p.name) + (p.role ? ' <span class="costs-person-role">' + esc(p.role) + '</span>' : '') + ended;
  const title = p.name + (p.role ? ' - ' + p.role : '');
  const epics = byPerson ? sortByMetric(byPerson.get(p.id) || [], _metric) : [];
  const pid = 'p:' + p.id;
  const pOpen = epics.length > 0 && _exp.has(pid);
  let kids = '';
  const kidIds = [];
  if (pOpen) {
    for (const ep of epics) {
      const eid = 'pe:' + p.id + '|' + ep.key;
      const eOpen = _exp.has(eid);
      const eRow = 'costs-r' + (++_rowSeq);
      kidIds.push(eRow);
      const eTitle = (ep.key && ep.key !== '_' ? ep.key + ' ' : '') + ep.name;
      const eLabel = (ep.key && ep.key !== '_' ? _jiraLink(ep.key, ep.key) + ' ' : '') + esc(ep.name);
      const iIds = [];
      let iRows = '';
      if (eOpen) {
        for (const is of sortByMetric(ep.issues, _metric)) {
          const iRow = 'costs-r' + (++_rowSeq);
          iIds.push(iRow);
          const iTitle = is.key === '_' ? 'No issue' : is.key + (is.summary ? ' ' + is.summary : '');
          const iLabel = is.key === '_' ? 'No issue' : _jiraLink(is.key, is.key) + (is.summary ? ' ' + esc(is.summary) : '');
          iRows += '<tr id="' + iRow + '" class="ds-table-sub costs-row-issue"><td class="costs-indent-' + (base + 2) + ' costs-leaf"><div class="costs-namecell" title="' + esc(iTitle) + '"><span class="costs-ellipsis">' + iLabel + '</span></div></td><td></td>'
            + months.map((m) => _tcell(is.months[m])).join('') + _tcell(is.total) + '</tr>';
        }
      }
      kids += '<tr id="' + eRow + '" class="ds-table-sub costs-row-issue">' + _expander(eid, eOpen, eLabel, base + 1, eTitle, iIds) + '<td></td>'
        + months.map((m) => _tcell(ep.months[m])).join('') + _tcell(ep.total) + '</tr>' + iRows;
    }
  }
  const first = epics.length
    ? _expander(pid, pOpen, label, base, title, kidIds)
    : '<td class="costs-indent-' + base + (base ? ' costs-leaf' : '') + '"><div class="costs-namecell" title="' + esc(title) + '"><span class="costs-ellipsis">' + label + '</span></div></td>';
  const cls = (base ? 'ds-table-sub ' : 'costs-row-epic ') + (p.rateMissing ? 'costs-row--no-rate' : '');
  return '<tr' + (rowId ? ' id="' + rowId + '"' : '') + ' class="' + cls.trim() + '">' + first
    + '<td>' + _rateCell(p) + '</td>'
    + months.map((m) => '<td>' + _personCell(p, p.months[m]) + '</td>').join('')
    + '<td>' + _personCell(p, p.total) + '</td></tr>' + kids;
}

/** Person cells -> tree cells ({hours, days, cost, noRateHours}) summed per company. */
function _companyGroups(rows, months) {
  const zero = () => ({ hours: 0, days: 0, cost: 0, noRateHours: 0 });
  const add = (to, p, c) => {
    if (!c) return;
    to.hours += c.hours || 0;
    to.days += c.days || 0;
    if (p.rateMissing) to.noRateHours += c.hours || 0; else to.cost += c.cost || 0;
  };
  const groups = new Map();
  for (const p of rows) {
    const name = (p.company || '').trim() || NO_COMPANY;
    if (!groups.has(name)) {
      const g = { name, persons: [], months: {}, total: zero() };
      for (const m of months) g.months[m] = zero();
      groups.set(name, g);
    }
    const g = groups.get(name);
    g.persons.push(p);
    for (const m of months) add(g.months[m], p, p.months[m]);
    add(g.total, p, p.total);
  }
  return sortByMetric([...groups.values()], _metric);
}

function _areaTableHtml() {
  const months = _data.months || [];
  const info = new Map((_data.monthInfo || []).map((m) => [m.month, m]));
  const assigned = rowsForArea(_data.persons, _tab, _query);
  if (!assigned.length && !String(_query || '').trim()) {
    return '<p class="costs-muted">Nobody is assigned to the area ' + esc(AREA_LABELS[_tab] || _tab) + '.</p>';
  }
  // A person with no hours in the selected period is not shown at all.
  const rows = assigned.filter((p) => p.total && p.total.hours > 0);
  if (!rows.length) {
    return '<p class="costs-muted">Nobody in the area ' + esc(AREA_LABELS[_tab] || _tab) + ' has hours in the period ' + esc(rangeLabel()) + '.</p>';
  }
  const byPerson = _treeFresh() ? personEpics(_tree.epics || [], months) : null;
  const isCompanies = _view === 'companies';
  const head = '<tr><th>' + (isCompanies ? 'Company / person / epic / issue' : 'Person / epic / issue') + '</th><th>Rate/day</th>' + months.map((m) => _monthTh(m, info.get(m), false)).join('') + '<th>Total</th></tr>';
  let body = '';
  if (isCompanies) {
    for (const g of _companyGroups(rows, months)) {
      const cid = 'c:' + g.name;
      const open = _exp.has(cid);
      const ids = [];
      let kids = '';
      if (open) {
        for (const p of g.persons) {
          const rid = 'costs-r' + (++_rowSeq);
          ids.push(rid);
          kids += _personBlock(p, months, byPerson, 1, rid);
        }
      }
      const label = esc(g.name) + ' <span class="costs-person-role">' + g.persons.length + ' ' + (g.persons.length === 1 ? 'person' : 'people') + '</span>';
      body += '<tr class="costs-row-epic">' + _expander(cid, open, label, 0, g.name, ids) + '<td></td>'
        + months.map((m) => _tcell(g.months[m])).join('') + _tcell(g.total) + '</tr>' + kids;
    }
  } else {
    body = rows.map((p) => _personBlock(p, months, byPerson, 0, '')).join('');
  }
  const tot = columnTotals(rows, months, _metric);
  const hasNoRate = _metric === 'cost' && tot.total.noRateHours > 0;
  const noRateTitle = 'Without a rate: ' + fmtHours(tot.total.noRateHours);
  const foot = '<tr><th>Total</th><th></th>' + months.map((m) => '<th>' + esc(tot[m].text) + '</th>').join('')
    + '<th>' + esc(tot.total.text) + (hasNoRate ? ' <span class="costs-unpriced" role="img" title="' + esc(noRateTitle) + '" aria-label="' + esc(noRateTitle) + '">*</span>' : '') + '</th></tr>';
  const legend = hasNoRate
    ? '<p class="costs-muted costs-legend"><span class="costs-unpriced">*</span> ' + esc(fmtHours(tot.total.noRateHours)) + ' belongs to people without a rate - not included in the cost.</p>' : '';
  return '<div class="ds-table-wrap costs-table-wrap"><div class="costs-scroll"><table class="ds-table costs-months costs-areas"><thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div></div>' + legend;
}

function _unassignedHtml() {
  const list = (_data && _data.unassigned) || [];
  const title = '<h2 class="ds-section-head-title">Unassigned <span class="ds-badge">' + list.length + '</span></h2>';
  const note = '<p class="costs-muted costs-note">Tempo authors who could not be matched to anyone in costs.</p>';
  if (!list.length) {
    return '<div class="ds-section-head">' + title + '</div><p class="costs-muted">All Tempo hours are assigned.</p>';
  }
  const head = '<div class="ds-section-head">' + title + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm costs-disclosure" data-costs-unassigned-toggle'
    + ' aria-expanded="' + _unassignedOpen + '" aria-controls="costs-unassigned-list"><span class="ds-row-toggle-chevron" aria-hidden="true">&#9654;</span> '
    + (_unassignedOpen ? 'Hide unassigned authors' : 'Show unassigned authors') + '</button></div>' + note;
  if (!_unassignedOpen) return head + '<div id="costs-unassigned-list" hidden></div>';
  return head + '<div class="ds-table-wrap costs-table-wrap" id="costs-unassigned-list"><table class="ds-table costs-config costs-unassigned">'
    + '<thead><tr><th>Author (Tempo)</th><th class="right">Hours</th><th>Reason</th><th></th></tr></thead><tbody>'
    + list.map((u) => '<tr><td>' + esc(u.displayName) + '</td><td class="right costs-num">' + esc(fmtHours(u.hours)) + '</td><td>'
      + (u.reason === 'ambiguous'
        ? '<span class="ds-badge ds-badge--yellow">ambiguous</span> <span class="costs-muted">' + esc((u.candidates || []).join(' / ')) + '</span>'
        : '<span class="ds-badge">not in directory</span>') + '</td>'
      + '<td class="right"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-costs-add-ext data-name="' + esc(u.displayName) + '" data-key="' + esc(u.key) + '">Add to costs</button></td></tr>').join('')
    + '</tbody></table></div>';
}

function _treeFresh() {
  return !!(_tree && _tree.storage === 'ok' && _tree.area === _tab && _tree.from === _from && _tree.to === _to);
}

function _jiraLink(key, label) {
  const base = _status && typeof _status.jiraUrl === 'string' && /^https?:\/\//.test(_status.jiraUrl) ? _status.jiraUrl.replace(/\/$/, '') : '';
  if (!base || !/^[A-Z][A-Z0-9_]*-\d+$/.test(key || '')) return esc(label || key);
  return '<a class="ds-link" href="' + esc(base + '/browse/' + key) + '" target="_blank" rel="noopener">' + esc(label || key) + '</a>';
}

function _tcell(cell) {
  const text = treeCellText(cell, _metric);
  if (text === DASH && !treeCellUnpriced(cell, _metric)) return '<td class="costs-zero">' + DASH + '</td>';
  const mark = treeCellUnpriced(cell, _metric)
    ? ' <span class="costs-unpriced" role="img" title="Some hours without a rate: ' + esc(fmtHours(cell.noRateHours)) + '" aria-label="Some hours without a rate: ' + esc(fmtHours(cell.noRateHours)) + '">*</span>' : '';
  return '<td>' + esc(text) + mark + '</td>';
}

function _expander(id, open, labelHtml, level, title, controls) {
  return '<td class="costs-indent-' + level + '"><div class="costs-namecell" title="' + esc(title) + '">'
    + '<button type="button" class="ds-row-toggle costs-toggle" data-costs-toggle="' + esc(id) + '" aria-expanded="' + open + '"'
    + (controls.length ? ' aria-controls="' + controls.join(' ') + '"' : '') + ' aria-label="' + (open ? 'Collapse' : 'Expand') + ': ' + esc(title) + '">'
    + '<span class="ds-row-toggle-chevron" aria-hidden="true">&#9654;</span></button>'
    + '<span class="costs-ellipsis">' + labelHtml + '</span></div></td>';
}

function _epicTableHtml() {
  if (!_treeFresh()) return '';
  const months = _tree.months || [];
  if (!(_tree.epics || []).length) {
    return '<p class="costs-muted">' + ((_tree.legacyMonths || []).length
      ? 'No split by issue in the fetched months - switch to the People view or fetch the data again.'
      : 'No hours in the area ' + esc(AREA_LABELS[_tab] || _tab) + ' in the period ' + esc(rangeLabel()) + '.') + '</p>';
  }
  const q = String(_query || '').trim();
  const epics = sortByMetric(filterEpics(_tree.epics, q), _metric);
  if (!epics.length) return '<p class="costs-muted">No results for "' + esc(q) + '".</p>';
  const info = new Map((_tree.monthInfo || []).map((m) => [m.month, m]));
  const legacy = new Set(_tree.legacyMonths || []);
  const head = '<tr><th>Epic / issue / person</th>' + months.map((m) => _monthTh(m, info.get(m), legacy.has(m))).join('') + '<th>Total</th></tr>';
  let body = '';
  const rid = () => 'costs-r' + (++_rowSeq);
  for (const ep of epics) {
    const eid = 'e:' + ep.key;
    const eOpen = _exp.has(eid) || !!q;
    const eLabel = (ep.key ? _jiraLink(ep.key, ep.key) + ' ' : '') + '<span class="costs-epic-name">' + esc(ep.name) + '</span>';
    let kids = '';
    const kidIds = [];
    if (eOpen) {
      for (const is of sortByMetric(ep.issues, _metric)) {
        const iid = 'i:' + ep.key + '|' + is.key;
        const iOpen = _exp.has(iid);
        const iRow = rid();
        kidIds.push(iRow);
        const iTitle = is.key === '_' ? 'No issue' : is.key + (is.summary ? ' ' + is.summary : '');
        const iLabel = is.key === '_' ? 'No issue' : _jiraLink(is.key, is.key) + (is.summary ? ' ' + esc(is.summary) : '');
        const pIds = [];
        let pRows = '';
        if (iOpen) {
          for (const pe of sortByMetric(is.persons, _metric)) {
            const pid = rid();
            pIds.push(pid);
            pRows += '<tr id="' + pid + '" class="ds-table-sub costs-row-person' + (pe.rateMissing ? ' costs-row--no-rate' : '') + '"><td class="costs-indent-2"><div class="costs-namecell" title="' + esc(pe.name) + '">'
              + _avatarHtml(pe) + '<span class="costs-ellipsis">' + esc(pe.name) + '</span>'
              + (pe.rateMissing ? '<span class="ds-badge ds-badge--red">No rate</span>' : '') + '</div></td>'
              + months.map((m) => _tcell(pe.months[m])).join('') + _tcell(pe.total) + '</tr>';
          }
        }
        kids += '<tr id="' + iRow + '" class="ds-table-sub costs-row-issue">' + _expander(iid, iOpen, iLabel, 1, iTitle, pIds)
          + months.map((m) => _tcell(is.months[m])).join('') + _tcell(is.total) + '</tr>' + pRows;
      }
    }
    body += '<tr class="costs-row-epic">' + _expander(eid, eOpen, eLabel, 0, (ep.key ? ep.key + ' ' : '') + ep.name, kidIds)
      + months.map((m) => _tcell(ep.months[m])).join('') + _tcell(ep.total) + '</tr>' + kids;
  }
  const tot = sumEpics(epics, months);
  const foot = '<tr><th>Total</th>' + months.map((m) => '<th>' + esc(treeCellText(tot[m], _metric)) + (treeCellUnpriced(tot[m], _metric) ? ' <span class="costs-unpriced">*</span>' : '') + '</th>').join('')
    + '<th>' + esc(treeCellText(tot.total, _metric)) + (treeCellUnpriced(tot.total, _metric) ? ' <span class="costs-unpriced">*</span>' : '') + '</th></tr>';
  const legend = _metric === 'cost' && tot.total.noRateHours > 0
    ? '<p class="costs-muted"><span class="costs-unpriced">*</span> some hours belong to people without a rate (' + esc(fmtHours(tot.total.noRateHours)) + ') - not included in the cost.</p>' : '';
  return '<div class="ds-table-wrap costs-table-wrap"><div class="costs-scroll"><table class="ds-table costs-months costs-epics"><thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div></div>' + legend;
}

function _configTableHtml() {
  const k = _config;
  if (!k) return '<p class="costs-muted">Loading...</p>';
  const off = k.storage !== 'ok';
  const q = _cfgQuery.trim().toLowerCase();
  const members = (k.members || []).filter((m) => (!_onlyIncluded || m.included) && (!q || (m.name + ' ' + m.team).toLowerCase().includes(q)));
  const companies = [...new Set((k.members || []).map((m) => (m.company || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));
  const rows = members.map((m) => {
    const areas = '<div class="costs-areas-pick">' + AREAS.map((a) => '<label class="ds-checkbox-label"><input type="checkbox" data-costs-area="' + a + '" data-id="' + esc(m.id) + '"'
      + (m.areas.includes(a) ? ' checked' : '') + (off || !m.included ? ' disabled' : '') + '> ' + AREA_LABELS[a] + '</label>').join('') + '</div>';
    const warn = (m.included && m.rate === null ? '<span class="ds-badge ds-badge--red">no rate</span>' : '')
      + (m.included && !m.areas.length ? '<span class="ds-badge ds-badge--yellow">no area</span>' : '');
    const meta = [m.team ? esc(m.team) : '', m.external ? '<span class="ds-badge">outside directory</span>' : ''].filter(Boolean).join(' ');
    const remove = m.external ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm costs-remove" data-costs-remove="' + esc(m.id) + '">Remove</button>' : '';
    return '<tr data-row-id="' + esc(m.id) + '">'
      + '<td class="costs-config-person"><div class="costs-config-name">' + esc(m.name) + '</div>'
      + (meta || remove || warn ? '<div class="costs-config-meta">' + meta + warn + remove + '</div>' : '') + '</td>'
      + '<td class="costs-config-center"><label class="ds-checkbox-label"><input type="checkbox" data-costs-included="' + esc(m.id) + '"' + (m.included ? ' checked' : '') + (off ? ' disabled' : '') + ' aria-label="In costs: ' + esc(m.name) + '"></label></td>'
      + '<td>' + areas + '</td>'
      + '<td><input type="text" class="ds-input ds-input--sm costs-company-input" list="costs-companies" data-costs-company="' + esc(m.id) + '" maxlength="60" placeholder="Company" aria-label="Company: ' + esc(m.name) + '" value="' + esc(m.company || '') + '"' + (off ? ' disabled' : '') + '></td>'
      + '<td><input type="date" class="ds-input ds-input--sm costs-end-input" data-costs-end-date="' + esc(m.id) + '" aria-label="Works until: ' + esc(m.name) + '" value="' + esc(m.endDate || '') + '"' + (off ? ' disabled' : '') + '></td>'
      + '<td><input type="number" class="ds-input ds-input--sm costs-rate-input" data-costs-cfg-rate="' + esc(m.id) + '" step="0.01" min="0" max="1000000" placeholder="' + CURRENCY + ' / day" aria-label="Daily rate: ' + esc(m.name) + '" value="' + (m.rate === null ? '' : esc(m.rate)) + '"' + (off ? ' disabled' : '') + '></td></tr>';
  }).join('');
  let html = '<datalist id="costs-companies">' + companies.map((c) => '<option value="' + esc(c) + '"></option>').join('') + '</datalist>'
    + '<div class="ds-table-wrap costs-table-wrap"><div class="costs-scroll costs-scroll--config"><table class="ds-table costs-config costs-config-people"><thead><tr><th>Person</th><th class="costs-config-center">In costs</th><th>Areas</th><th>Company</th><th>Works until</th><th>Daily rate</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="6" class="costs-muted">No people to show.</td></tr>') + '</tbody></table></div></div>';
  html += '<div class="ds-section-head"><h2 class="ds-section-head-title">Add a person outside the directory</h2></div>'
    + '<div class="costs-filters">'
    + '<input type="text" class="ds-input" data-costs-ext-name placeholder="Full name" aria-label="Full name" maxlength="100"' + (off ? ' disabled' : '') + '>'
    + '<input type="email" class="ds-input" data-costs-ext-email placeholder="E-mail (optional)" aria-label="E-mail (optional)"' + (off ? ' disabled' : '') + '>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-costs-ext-add' + (off ? ' disabled' : '') + '>Add</button>'
    + '</div>';
  const un = k.ratesUnmatched || [];
  if (un.length) {
    html += '<div class="ds-section-head"><h2 class="ds-section-head-title">Rates without a person (' + un.length + ')</h2></div>'
      + '<p class="costs-muted costs-note">Entries in team-rates.json that cannot be matched to anyone in the directory or the list above. Read only.</p>'
      + '<div class="ds-table-wrap costs-table-wrap"><table class="ds-table costs-config"><thead><tr><th>Name</th><th>Daily rate</th></tr></thead><tbody>'
      + un.map((u) => '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.daily_rate === null ? DASH : fmtMoney(u.daily_rate)) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  const months = (_status && _status.months) || [];
  html += '<div class="ds-section-head"><h2 class="ds-section-head-title">Fetched months</h2></div>'
    + '<div class="ds-table-wrap costs-table-wrap"><table class="ds-table costs-config"><thead><tr><th>Month</th><th>Fetched</th><th>Range</th><th>People</th><th>Worklogs</th></tr></thead><tbody>'
    + (months.length ? months.map((m) => '<tr><td>' + esc(monthLabel(m.month)) + '</td><td>' + esc(fmtDateTime(m.fetchedAt)) + '</td><td>' + esc(fmtDate(m.dateFrom)) + ' - ' + esc(fmtDate(m.dateTo))
      + (m.partial ? ' <span class="ds-badge">partial</span>' : '') + '</td><td>' + esc(m.authors === null || m.authors === undefined ? DASH : m.authors) + '</td><td>' + esc(m.worklogs === null || m.worklogs === undefined ? DASH : m.worklogs) + '</td></tr>').join('')
      : '<tr><td colspan="5" class="costs-muted">Nothing fetched yet.</td></tr>')
    + '</tbody></table></div>';
  return html;
}

function _paintConfig() {
  const box = document.getElementById('costs-config-box');
  if (box) box.innerHTML = _configTableHtml();
}

function _paintTable() {
  const box = document.getElementById('costs-table-box');
  if (!box) return;
  if (!_data || _data.storage !== 'ok' || !_data.available) { box.innerHTML = ''; return; }
  box.innerHTML = _view === 'epics' ? _epicTableHtml() : _areaTableHtml();
  const un = document.getElementById('costs-unassigned-box');
  if (un) un.innerHTML = _unassignedHtml();
}

/** The configuration lives in a wide modal; closing it (button, Escape, backdrop) re-reads /data + tree. */
async function _openConfigModal(trigger) {
  if (_configOverlay) return;
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = CONFIG_MODAL_ID;
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--xl costs-config-modal" role="dialog" aria-modal="true" aria-labelledby="costs-config-title">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="costs-config-title">Costs configuration</span>'
    + '<button type="button" class="ds-modal-close" data-costs-config-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body">'
    + (_status && _status.storage === 'unavailable' ? '<div class="ds-callout ds-callout--warning costs-callout"><div>' + esc(MSG_STORAGE) + '</div></div>' : '')
    + '<div class="costs-filters">'
    + '<input type="search" class="ds-input" data-costs-cfg-search placeholder="Search person" aria-label="Search person" value="' + esc(_cfgQuery) + '">'
    + '<label class="ds-checkbox-label"><input type="checkbox" data-costs-only' + (_onlyIncluded ? ' checked' : '') + '> only in costs</label></div>'
    + '<div id="costs-config-box"></div></div></div>';
  document.body.appendChild(overlay);
  _configOverlay = overlay;
  let done = false;
  const observer = new MutationObserver(() => { if (!overlay.classList.contains('open')) finish(); });
  function finish() {
    if (done) return;
    done = true;
    observer.disconnect();
    for (const [ev, fn] of [['click', _onClick], ['change', _onChange], ['input', _onInput]]) overlay.removeEventListener(ev, fn);
    overlay.remove();
    _configOverlay = null;
    _loadData().then(() => { _paint(); });
  }
  for (const [ev, fn] of [['click', _onClick], ['change', _onChange], ['input', _onInput]]) overlay.addEventListener(ev, fn);
  overlay.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-costs-config-close]')) {
      if (_dsModal && typeof _dsModal.closeDsModal === 'function') _dsModal.closeDsModal(overlay); else finish();
    }
  });
  _paintConfig();
  if (_dsModal && typeof _dsModal.openDsModal === 'function') {
    _dsModal.openDsModal(overlay, { trigger });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  } else { overlay.hidden = false; overlay.classList.add('open'); }
  await _loadConfig();
  _paintConfig();
}

// -- data --------------------------------------------------------------------

async function _loadStatus() {
  const r = await _req('GET', '/status');
  if (r.ok) _status = r.data;
  return r.ok;
}

async function _loadTree() {
  const area = _tab;
  const r = await _req('GET', '/epics?area=' + encodeURIComponent(area) + '&' + _rangeQuery());
  if (r.ok && area === _tab) _tree = { ...r.data, area };
}

async function _loadData() {
  const [r] = await Promise.all([_req('GET', '/data?' + _rangeQuery()), _loadTree()]);
  if (r.ok) _data = r.data;
}

async function _loadConfig() {
  const r = await _req('GET', '/config');
  if (r.ok) _config = r.data;
}

async function _reload() {
  await _loadStatus();
  _initRange();
  await _loadData();
  _paintActions();
  _paint();
  _syncPoll();
}

function _syncPoll() {
  if (_running() && !_pollTimer) {
    _pollTimer = setInterval(_pollTick, POLL_MS);
    if (_deps && typeof _deps.registerViewCleanup === 'function') {
      _deps.registerViewCleanup(() => { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } });
    }
  }
  if (!_running() && _pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function _pollTick() {
  const wasRunning = _running();
  await _loadStatus();
  _paintActions();
  if (wasRunning && !_running()) {
    _syncPoll();
    const lr = _status && _status.lastRun;
    if (lr && lr.ok) _toast('success', 'Hours fetched from Tempo', '');
    else _toast('danger', 'Hours were not fetched from Tempo', (lr && lr.message) || '');
    await _reload();
  }
}

async function _startFetch(range, trigger) {
  if (_starting || _running()) return;
  _starting = true;
  _paintActions();
  try {
    const r = await _req('POST', '/refresh', range || {});
    if (r.status === 202) {
      await _loadStatus();
      if (!_running()) _status.job = { running: true };
      _syncPoll();
    } else {
      _toast('danger', 'Not fetched', r.data.message || 'The fetch could not be started.');
    }
  } finally {
    _starting = false;
    _paintActions();
  }
  return trigger;
}

// -- range modal ---------------------------------------------------------------

function _openRangeModal(trigger) {
  const old = document.getElementById(MODAL_ID);
  if (old) old.remove();
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const first = (Number(today.slice(0, 4)) - 1) + '-01';
  const months = monthStartsBetween(first, thisMonth);
  const defFrom = months.length > 1 ? months[months.length - 2] : thisMonth;
  const opts = (sel, list) => (list || months).map((m) => '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>').join('');
  // "To" offers at most 12 months counted from "From" (the server refuses more).
  const toRange = (from) => months.filter((m) => m >= from && monthStartsBetween(from, m).length <= 12);
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = MODAL_ID;
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Fetch from Tempo</span>'
    + '<button type="button" class="ds-modal-close" data-costs-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body">'
    + '<label class="costs-range-field">From month<select class="ds-input" data-costs-from>' + opts(defFrom) + '</select></label>'
    + '<label class="costs-range-field">To month<select class="ds-input" data-costs-to>' + opts(thisMonth, toRange(defFrom)) + '</select></label>'
    + '<p class="costs-muted">By default the previous and the current month. Only the months of the range are overwritten, the rest stay as they are.</p></div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-costs-modal-ok>Fetch</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-costs-modal-close>Cancel</button></div></div>';
  document.body.appendChild(overlay);
  const close = () => {
    if (_dsModal && typeof _dsModal.closeDsModal === 'function') _dsModal.closeDsModal(overlay);
    overlay.remove();
  };
  overlay.addEventListener('change', (e) => {
    if (!e.target.closest || !e.target.closest('[data-costs-from]')) return;
    const toSel = overlay.querySelector('[data-costs-to]');
    const list = toRange(e.target.value);
    const keep = list.includes(toSel.value) ? toSel.value : list[list.length - 1];
    toSel.innerHTML = opts(keep, list);
  });
  overlay.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest) return;
    if (t.closest('[data-costs-modal-close]')) { close(); return; }
    if (t.closest('[data-costs-modal-ok]')) {
      const from = overlay.querySelector('[data-costs-from]').value;
      const to = overlay.querySelector('[data-costs-to]').value;
      if (from > to) { _toast('danger', 'Invalid range', 'The start month is later than the end month.'); return; }
      const last = lastDayOfMonth(to);
      close();
      _startFetch({ dateFrom: from + '-01', dateTo: last < today ? last : today });
    }
  });
  if (_dsModal && typeof _dsModal.openDsModal === 'function') _dsModal.openDsModal(overlay, { trigger });
  else { overlay.hidden = false; overlay.classList.add('open'); }
}

// -- events --------------------------------------------------------------------

async function _saveRate(id, raw) {
  const text = String(raw).trim();
  const value = text === '' ? null : Number(text.replace(',', '.'));
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1000000)) {
    _toast('danger', 'Not saved', 'The daily rate must be a number from 0 to 1,000,000.');
    return false;
  }
  const r = await _req('POST', '/rate', { id, daily_rate: value });
  if (!r.ok) { _toast('danger', 'Not saved', r.data.message || ''); return false; }
  _toast('success', 'Rate saved', '');
  return true;
}

async function _saveConfig(id, patch, rowEl) {
  if (rowEl) rowEl.setAttribute('aria-busy', 'true');
  try {
    const r = await _req('POST', '/config', { id, ...patch });
    if (!r.ok) _toast('danger', 'Not saved', r.data.message || '');
    await Promise.all([_loadConfig(), _loadData()]);
  } finally {
    _paint();
  }
}

async function _commitRateEdit(input) {
  const id = input.getAttribute('data-costs-rate-input');
  if (_editRateId !== id) return;
  _editRateId = null;
  const ok = await _saveRate(id, input.value);
  if (!ok) { _paintTable(); return; }
  await _loadData();
  _paint();
}

async function _applyRange() {
  const a = _calFrom;
  const b = _calTo || _calFrom;
  if (!validIso(a) || !validIso(b)) { _toast('danger', 'Invalid period', 'Pick the start and the end day.'); return; }
  _from = a;
  _to = b;
  _clampRange();
  _saveRange();
  _rangeOpen = false;
  await _loadData();
  _paint();
}

function _onClick(e) {
  const t = e.target;
  if (!t || !t.closest) return;
  if (_rangeOpen && !t.closest('.costs-range')) { _rangeOpen = false; _paint(); }
  if (t.closest('[data-costs-config]')) { _openConfigModal(t.closest('[data-costs-config]')); return; }
  if (t.closest('[data-costs-range-trigger]')) {
    if (_rangeOpen) _rangeOpen = false; else _openCalendar();
    _paint();
    return;
  }
  if (t.closest('[data-costs-range-cancel]')) { _rangeOpen = false; _paint(); return; }
  const preset = t.closest('[data-costs-preset]');
  if (preset) {
    const [a, b] = _presetRange(preset.getAttribute('data-costs-preset'));
    _calFrom = a;
    _calTo = b;
    _calView = b.slice(0, 7);
    _repaintCalendar();
    return;
  }
  const nav = t.closest('[data-costs-cal-nav]');
  if (nav && !nav.disabled) { _calView = _calShift(_calView, Number(nav.getAttribute('data-costs-cal-nav'))); _repaintCalendar(); return; }
  const day = t.closest('[data-costs-cal-day]');
  if (day && !day.disabled) {
    const iso = day.getAttribute('data-costs-cal-day');
    if (!_calFrom || _calTo) { _calFrom = iso; _calTo = ''; } else if (iso < _calFrom) { _calTo = _calFrom; _calFrom = iso; } else { _calTo = iso; }
    _repaintCalendar();
    return;
  }
  if (t.closest('[data-costs-range-apply]')) { _applyRange(); return; }
  const tab = t.closest('[data-costs-tab]');
  if (tab) {
    _tab = tab.getAttribute('data-costs-tab');
    try { window.history.replaceState(null, '', '#costs-main/' + _tab); } catch { /* hash only */ }
    _editRateId = null;
    _reload();
    return;
  }
  const toggle = t.closest('[data-costs-toggle]');
  if (toggle) {
    const id = toggle.getAttribute('data-costs-toggle');
    if (_exp.has(id)) _exp.delete(id); else _exp.add(id);
    _paintTable();
    return;
  }
  const unTog = t.closest('[data-costs-unassigned-toggle]');
  if (unTog) { _unassignedOpen = !_unassignedOpen; _paintTable(); return; }
  if (t.closest('[data-costs-expand-all]')) {
    for (const p of (_data && _data.persons) || []) _exp.add('c:' + ((p.company || '').trim() || NO_COMPANY));
    for (const ep of (_treeFresh() ? _tree.epics || [] : [])) {
      _exp.add('e:' + ep.key);
      for (const is of ep.issues || []) {
        _exp.add('i:' + ep.key + '|' + is.key);
        // People view: person -> epic rows open too.
        for (const pe of is.persons || []) { _exp.add('p:' + pe.id); _exp.add('pe:' + pe.id + '|' + ep.key); }
      }
    }
    _paintTable();
    return;
  }
  if (t.closest('[data-costs-collapse-all]')) { _exp.clear(); _paintTable(); return; }
  const view = t.closest('[data-costs-view]');
  if (view) {
    _view = view.getAttribute('data-costs-view');
    _loadTree().then(() => { _paint(); });
    return;
  }
  const addExt = t.closest('[data-costs-add-ext]');
  if (addExt) { _addExternalFromTempo(addExt); return; }
  const extAdd = t.closest('[data-costs-ext-add]');
  if (extAdd) { _addExternalFromForm(); return; }
  const metric = t.closest('[data-costs-metric]');
  if (metric) { _metric = metric.getAttribute('data-costs-metric'); _paint(); return; }
  const edit = t.closest('[data-costs-edit-rate]');
  if (edit) {
    _editRateId = edit.getAttribute('data-costs-edit-rate');
    _paintTable();
    const inp = document.querySelector('[data-costs-rate-input]');
    if (inp) inp.focus();
    return;
  }
  const rem = t.closest('[data-costs-remove]');
  if (rem) { _removeOrphan(rem.getAttribute('data-costs-remove'), rem); }
}

async function _createExternal(payload) {
  const r = await _req('POST', '/config', { external: true, included: true, areas: [], ...payload });
  if (!r.ok) { _toast('danger', 'Person not added', r.data.message || ''); return false; }
  _toast('success', 'Person outside the directory added', 'Pick the areas and the rate in the configuration.');
  return true;
}

async function _addExternalFromTempo(btn) {
  const key = btn.getAttribute('data-key') || '';
  const payload = { name: cleanTempoName(btn.getAttribute('data-name')) };
  if (key.includes('@')) payload.email = key;
  btn.disabled = true;
  const ok = await _createExternal(payload);
  btn.disabled = false;
  if (!ok) return;
  await _loadConfig();
  _paintConfig();
  _openConfigModal(btn);
}

async function _addExternalFromForm() {
  const name = document.querySelector('[data-costs-ext-name]');
  const email = document.querySelector('[data-costs-ext-email]');
  if (!name) return;
  const payload = { name: name.value };
  if (email && email.value.trim()) payload.email = email.value.trim();
  if (!(await _createExternal(payload))) return;
  await _loadConfig();
  _paint();
}

async function _removeOrphan(id, trigger) {
  let ok = false;
  if (_dsModal && typeof _dsModal.confirmDsModal === 'function') {
    ok = await _dsModal.confirmDsModal({
      title: 'Remove from costs?', body: 'The person disappears from the costs configuration. The rate entry in team-rates.json stays.', okLabel: 'Remove', cancelLabel: 'Cancel', danger: true, trigger,
    });
  }
  if (ok) await _saveConfig(id, { remove: true }, null);
}

function _onChange(e) {
  const t = e.target;
  if (!t || !t.getAttribute) return;
  if (t.hasAttribute('data-costs-only')) { _onlyIncluded = t.checked; _paintConfig(); return; }
  if (t.hasAttribute('data-costs-included')) {
    _saveConfig(t.getAttribute('data-costs-included'), { included: t.checked }, t.closest('tr'));
    return;
  }
  if (t.hasAttribute('data-costs-company')) {
    _saveConfig(t.getAttribute('data-costs-company'), { company: t.value.trim() || null }, t.closest('tr'));
    return;
  }
  if (t.hasAttribute('data-costs-end-date')) {
    _saveConfig(t.getAttribute('data-costs-end-date'), { endDate: t.value || null }, t.closest('tr'));
    return;
  }
  if (t.hasAttribute('data-costs-area')) {
    const id = t.getAttribute('data-id');
    const row = t.closest('tr');
    const areas = [...row.querySelectorAll('[data-costs-area]')].filter((c) => c.checked).map((c) => c.getAttribute('data-costs-area'));
    _saveConfig(id, { areas }, row);
    return;
  }
  if (t.hasAttribute('data-costs-cfg-rate')) {
    const id = t.getAttribute('data-costs-cfg-rate');
    const row = t.closest('tr');
    row.setAttribute('aria-busy', 'true');
    _saveRate(id, t.value).then(() => Promise.all([_loadConfig(), _loadData()])).then(_paint).finally(() => row.removeAttribute('aria-busy'));
  }
}

function _onInput(e) {
  const t = e.target;
  if (!t || !t.hasAttribute) return;
  if (t.hasAttribute('data-costs-search')) { _query = t.value; _paintTable(); }
  if (t.hasAttribute('data-costs-cfg-search')) { _cfgQuery = t.value; _paintConfig(); }
}

function _onKeydown(e) {
  const t = e.target;
  if (!t || !t.hasAttribute) return;
  if (t.hasAttribute('data-costs-rate-input')) {
    if (e.key === 'Enter') { e.preventDefault(); _commitRateEdit(t); }
    if (e.key === 'Escape') { _editRateId = null; _paintTable(); }
  }
  if (e.key === 'Escape' && _rangeOpen) { _rangeOpen = false; _paint(); }
}

function _onFocusOut(e) {
  const t = e.target;
  if (t && t.hasAttribute && t.hasAttribute('data-costs-rate-input')) _commitRateEdit(t);
}

function _onActionsClick(e) {
  const t = e.target;
  if (!t || !t.closest) return;
  const fetchBtn = t.closest('[data-costs-fetch]');
  // "Fetch from Tempo" asks what to fetch first; the proposal is the previous and the current month.
  if (fetchBtn && !fetchBtn.disabled) { _openRangeModal(fetchBtn); return; }
  const cfgBtn = t.closest('[data-costs-config]');
  if (cfgBtn) { _openConfigModal(cfgBtn); return; }
  const rangeBtn = t.closest('[data-costs-range]');
  if (rangeBtn && !rangeBtn.disabled) _openRangeModal(rangeBtn);
}

function _ensureWired(root) {
  if (_wired) return;
  _wired = true;
  const slot = document.getElementById(ACTIONS_ID);
  root.addEventListener('click', _onClick);
  root.addEventListener('change', _onChange);
  root.addEventListener('input', _onInput);
  root.addEventListener('keydown', _onKeydown);
  root.addEventListener('focusout', _onFocusOut);
  if (slot) slot.addEventListener('click', _onActionsClick);
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => {
      root.removeEventListener('click', _onClick);
      root.removeEventListener('change', _onChange);
      root.removeEventListener('input', _onInput);
      root.removeEventListener('keydown', _onKeydown);
      root.removeEventListener('focusout', _onFocusOut);
      if (slot) slot.removeEventListener('click', _onActionsClick);
      if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
      const m = document.getElementById(MODAL_ID);
      if (m) m.remove();
      _wired = false;
    });
  }
}

export const views = {
  'costs-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;
      (async () => {
        try {
          _teamDir = await import('/js/team-directory.js');
          await _teamDir.loadTeamDirectory();
        } catch { _teamDir = null; }
        if (_status) _paint();
      })();
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
    },

    async render(subPath) {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      const wanted = String(subPath || '').replace(/^\/+/, '').split('/')[0];
      _tab = TABS.includes(wanted) ? wanted : (TABS.includes(_tab) ? _tab : 'atlas');
      _openConfigAfter = wanted === 'config';
      _epoch += 1;
      _paintActions();
      _ensureWired(root);
      await _reload();
      if (_openConfigAfter) {
        _openConfigAfter = false;
        try { window.history.replaceState(null, '', '#costs-main/' + _tab); } catch { /* hash only */ }
        _openConfigModal(null);
      }
    },
  },
};
