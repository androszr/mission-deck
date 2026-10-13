// modules/devops-stats/client/index.js
// DEVOPS Stats view: Kanban flow metrics of the Jira project DEVOPS - WIP,
// throughput, lead and cycle time (median + p85), epics, aging WIP and
// blocked time. All math is pure in flow-model.mjs, all SVG in
// flow-charts.mjs; this file paints and wires.
//
// Cache lives ONLY here (module scope), never in a sibling file: a data pull
// re-imports THIS file fresh (modules-template/README.md, "Refreshing after a
// data sync"). onDataChanged() drops it and repaints, keeping the
// selected granularity. Switching "Weeks / Months" repaints from the
// cache with no request.

import * as FM from './flow-model.mjs';
import * as FC from './flow-charts.mjs';
import { openRefreshModal } from './refresh-modal.js';
import { openBlockedModal } from './blocked-modal.js';
import { tipHtml } from './metric-defs.mjs';

const ROOT_ID = 'devops-stats-main-root';
const ACTIONS_ID = 'devops-stats-main-actions';
const STALE_DAYS = 7;
const ROWS_CAP = 30;

const EXTERNAL_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

let _deps = null;
let _dsModal = null;
let _overview = null; // last GET /overview answer
let _issues = null; // last GET /issues answer (array of facts)
let _granularity = 'week'; // 'week' | 'month'
let _tab = 'team'; // 'team' | 'people' - kept across repaints and data pulls, like _granularity
let _person = '__team__'; // People tab: roster member id, or the whole team (ALL_TEAM)
let _teamDir = null; // '/js/team-directory.js' namespace once loaded, else null
let _refreshing = false;
let _actionsWired = false;
let _rootWired = false;

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/devops-stats') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _root() {
  return document.getElementById(ROOT_ID);
}

function _fmtDate(ts) {
  if (ts === null || ts === undefined) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
}

function _jiraBase() {
  return (_overview && _overview.jira_url) || 'https://jira.example.com';
}

function _keyLink(key) {
  return '<a class="ds-btn ds-btn--tertiary ds-btn--sm" href="' + _esc(_jiraBase()) + '/browse/' + encodeURIComponent(key)
    + '" target="_blank" rel="noopener noreferrer" aria-label="' + _esc(key + ' - open in Jira (new tab)') + '">' + _esc(key) + ' ' + EXTERNAL_ICON + '</a>';
}

// -- Header action slot ------------------------------------------------------

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-ds-refresh'
    + (_refreshing ? ' aria-busy="true"' : '') + '>Refresh</button>';
  if (_actionsWired) return;
  _actionsWired = true;
  const onClick = async (e) => {
    if (e.target.closest('[data-ds-refresh]')) await _openRefresh();
  };
  actions.addEventListener('click', onClick);
  _deps.registerViewCleanup(() => {
    actions.removeEventListener('click', onClick);
    _actionsWired = false;
  });
}

// Refresh and the config save both write jira/devops/ in the team data.
// Announced on the core's data bus, the core repaints the module sync bar and
// calls onDataChanged() below. Returns false when the bus is unreachable;
// the caller then re-renders by itself. Dynamic import keeps this file
// importable in plain Node.
async function _announceDataWrite() {
  try {
    const ev = await import('/js/data-events.js');
    ev.emitDataChanged({ source: 'devops-stats' });
    return true;
  } catch {
    return false;
  }
}

async function _afterWrite() {
  if (!(await _announceDataWrite())) {
    _overview = null;
    _issues = null;
    await _render();
  }
  _toast('success', 'DEVOPS Stats zaktualizowane', '');
}

async function _openRefresh() {
  if (_refreshing) return;
  _refreshing = true;
  _paintActions();
  try {
    await openRefreshModal({
      apiBase: _deps.apiBase,
      overview: _overview,
      dsModal: _dsModal,
      registerViewCleanup: _deps.registerViewCleanup,
      onDone: () => _afterWrite(),
    });
  } finally {
    _refreshing = false;
    _paintActions();
  }
}

async function _openBlocked() {
  const index = _overview && _overview.index;
  if (!index) return;
  const cfg = await openBlockedModal({
    apiBase: _deps.apiBase,
    statuses: index.statuses || [],
    saved: (_overview.config && _overview.config.blocked_status_ids) || [],
    cancelled: _cancelledIds(index),
    dsModal: _dsModal,
    showToast: _deps.showToast,
  });
  if (cfg) {
    _overview = Object.assign({}, _overview, { config: cfg });
    await _afterWrite();
  }
}

// -- States ------------------------------------------------------------------

function _skeletonHtml() {
  return '<div class="devops-stats-skeleton" data-skel="1">'
    + '<span class="ds-skeleton" style="width:100%;height:96px;display:block;margin-bottom:16px"></span>'
    + '<span class="ds-skeleton" style="width:100%;height:260px;display:block"></span>'
    + '</div>';
}

function _errorHtml() {
  return '<div class="ds-callout ds-callout--danger"><div>Could not load the DEVOPS Stats data. Check the connection and try again.</div></div>';
}

function _unavailableHtml() {
  return '<div class="ds-callout ds-callout--info"><div>The team data source is not downloaded - pull it in the Sync window.</div></div>';
}

function _emptyHtml() {
  return '<div class="ds-callout ds-callout--info"><div>No DEVOPS data yet. Click "Refresh" to fetch it from Jira.</div></div>';
}

// -- Sections (pure string builders over module state) -----------------------

function _bannerHtml(index, config) {
  const parts = [];
  const gen = index.generated_at ? Date.parse(index.generated_at) : NaN;
  if (Number.isFinite(gen) && Date.now() - gen > STALE_DAYS * FM.DAY_MS) {
    parts.push('<div class="ds-callout ds-callout--warning"><div>Data from ' + _esc(_fmtDate(gen)) + ' - refresh to see the current state.</div></div>');
  }
  if (!config.blocked_status_ids.length) {
    parts.push('<div class="ds-callout ds-callout--info"><div>Blocked statuses are not set, so no issue counts as blocked. '
      + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ds-blocked>Set statuses</button></div></div>');
  }
  return parts.length ? '<div class="devops-stats-banners">' + parts.join('') + '</div>' : '';
}

function _filterHtml() {
  const seg = (val, label) => '<button type="button" class="ds-segment' + (_granularity === val ? ' active' : '') + '" data-ds-gran="' + val + '" aria-pressed="' + (_granularity === val) + '">' + label + '</button>';
  return '<div class="devops-stats-filters"><div class="ds-segmented" role="group" aria-label="Okres">'
    + seg('week', 'Weeks') + seg('month', 'Months') + '</div></div>';
}

/** "the last 12 weeks (20.07.2026 - 11.10.2026)" for the visible buckets. */
function _rangeText(buckets) {
  if (!buckets.length) return '';
  const n = buckets.length;
  const what = _granularity === 'month' ? 'the last ' + n + ' months' : 'the last ' + n + ' weeks';
  return what + ' (' + _fmtDate(buckets[0].start) + ' - ' + _fmtDate(buckets[n - 1].end - 1) + ')';
}

// Who the in-progress tasks belong to: TEAM (the People tab), nobody, or
// people outside the team. Empty until the team directory has loaded.
function _wipSplit(model) {
  if (!_teamDir) return '';
  const team = new Set(_teamMembers().map((m) => String(m.id)));
  if (!team.size) return '';
  let mine = 0;
  let none = 0;
  let other = 0;
  for (const f of FM.wipNowFacts(model.facts, model.cat)) {
    if (!f.assignee) none++;
    else if (team.has(_memberIdOf(f.assignee))) mine++;
    else other++;
  }
  return TEAM + ': ' + mine + ' · unassigned: ' + none + (other ? ' · others: ' + other : '');
}

function _tilesHtml(t, model) {
  const per = _granularity === 'month' ? 'month' : 'week';
  const span = _granularity === 'month' ? model.buckets.length + ' months' : model.buckets.length + ' weeks';
  const tile = (value, label, hi, tip, note) => '<div class="ds-card ds-stat' + (hi ? ' ds-stat--highlight' : '') + '">'
    + '<div class="ds-stat-value">' + _esc(value) + '</div><div class="ds-stat-label">' + _esc(label) + tip
    + (note ? '<span class="devops-stats-tile-note">' + _esc(note) + '</span>' : '') + '</div></div>';
  return '<div class="ds-stat-row devops-stats-tiles" aria-label="Flow summary">'
    + '<div class="ds-card ds-stat-subject">DEVOPS</div>'
    + tile(String(t.wipNow), 'In progress now', true, tipHtml('wipNow', { label: 'In progress now' }), 'state today, whole project; ' + _wipSplit(model))
    + tile(String(t.throughputAvg), 'Delivered - average per ' + per, false, tipHtml('throughput', { per, label: 'Delivered per ' + per }), 'over ' + span)
    + tile(FM.fmtDays(t.leadMedian), 'Lead time - median (days)', false, tipHtml('leadTime', {
      label: 'Lead time',
      extra: t.leadSkipped ? 'Skipped ' + t.leadSkipped + ' issues closed without work.' : '',
    }), 'over ' + span)
    + tile(FM.fmtDays(t.cycleMedian), 'Cycle time - median (days)', false, tipHtml('cycleTime', {
      label: 'Cycle time',
      extra: t.cycleSkipped ? 'Skipped ' + t.cycleSkipped + ' issues that never went through an in-progress status.' : '',
    }), 'over ' + span)
    + tile(String(t.blockedNow), 'Blocked now', false, tipHtml('blockedNow', { label: 'Blocked now' }), 'state today')
    + tile(String(t.closedWithoutWork), 'Closed without work', false, tipHtml('closedWithoutWork', { label: 'Closed without work' }), 'total over ' + span)
    + '</div>';
}

function _panel(title, legend, chart, tip) {
  return '<div class="ds-card devops-stats-panel"><div class="ds-card-body">'
    + '<div class="devops-stats-panel-title">' + _esc(title) + (tip || '') + '</div>' + chart
    + (legend ? '<div class="devops-stats-legend">' + legend + '</div>' : '')
    + '</div></div>';
}

function _head(title, actionsHtml, tip) {
  return '<div class="ds-section-head"><h2 class="ds-section-head-title">' + _esc(title) + (tip || '') + '</h2>'
    + (actionsHtml ? '<div class="ds-section-head-actions">' + actionsHtml + '</div>' : '') + '</div>';
}

function _chartsHtml(model) {
  const { buckets, now, facts, cat, cancelledIds } = model;
  const lbl = (i) => ({ label: buckets[i].label, current: buckets[i].current });
  const wip = FM.wipSeries(facts, buckets, now, cat);
  const thr = FM.throughputSeries(facts, buckets, cancelledIds);
  const lead = FM.timeSeriesStats(FM.leadTimes(facts, buckets, cancelledIds).perBucket);
  const cycle = FM.timeSeriesStats(FM.cycleTimes(facts, buckets, cancelledIds).perBucket);
  const per = _granularity === 'month' ? 'month' : 'week';

  const wipPts = buckets.map((_, i) => Object.assign(lbl(i), { wip: wip[i] }));
  const thrPts = buckets.map((_, i) => Object.assign(lbl(i), { done: thr[i] }));
  const leadPts = buckets.map((_, i) => Object.assign(lbl(i), { median: lead[i].median, p85: lead[i].p85 }));
  const cyclePts = buckets.map((_, i) => Object.assign(lbl(i), { median: cycle[i].median, p85: cycle[i].p85 }));
  const medP85 = [
    { key: 'median', label: 'Median', color: FC.LINE_COLORS.primary },
    { key: 'p85', label: '85th percentile', color: FC.LINE_COLORS.tertiary },
  ];
  const dashed = 'Current period (incomplete)';

  return _head('Flow')
    + '<div class="devops-stats-panels">'
    + _panel('Work in progress', FC.legendHtml([{ label: 'In progress at the end of the period', color: FC.LINE_COLORS.primary }], dashed),
      FC.buildLineChart(wipPts, { lines: [{ key: 'wip', label: 'In progress', color: FC.LINE_COLORS.primary }], ariaLabel: 'Chart of the number of issues in progress at the end of each period' }),
      tipHtml('wipChart', { label: 'Work in progress' }))
    + _panel('Delivered', FC.legendHtml([{ label: 'Delivered per ' + per, color: FC.LINE_COLORS.secondary }], dashed),
      FC.buildBarChart(thrPts, { key: 'done', label: 'Delivered', color: FC.LINE_COLORS.secondary, ariaLabel: 'Chart of the number of issues delivered in each period' }),
      tipHtml('throughputChart', { label: 'Delivered' }))
    + '</div>'
    + _head('Lead and cycle time')
    + '<div class="devops-stats-panels">'
    + _panel('Lead time', FC.legendHtml(medP85, dashed),
      FC.buildLineChart(leadPts, { lines: medP85, unit: 'days', ariaLabel: 'Lead time chart in days: median and 85th percentile' }),
      tipHtml('leadChart', { label: 'Lead time chart' }))
    + _panel('Cycle time', FC.legendHtml(medP85, dashed),
      FC.buildLineChart(cyclePts, { lines: medP85, unit: 'days', ariaLabel: 'Cycle time chart in days: median and 85th percentile' }),
      tipHtml('cycleChart', { label: 'Cycle time chart' }))
    + '</div>';
}

function _epicsHtml(model) {
  const rows = FM.epicRows(model.facts, model.cat, model.now);
  const body = rows.slice(0, ROWS_CAP).map((r) => {
    const pct = r.progress.total ? Math.round((r.progress.done / r.progress.total) * 100) : null;
    return '<tr><td>' + _keyLink(r.key) + ' <span class="devops-stats-summary" title="' + _esc(r.summary) + '">' + _esc(r.summary) + '</span></td>'
      + '<td><span class="ds-badge ds-badge--' + (r.done ? 'green' : 'blue') + '">' + (r.done ? 'Done' : 'Open') + '</span></td>'
      + '<td class="right">' + (pct === null ? '-' : r.progress.done + '/' + r.progress.total + ' (' + pct + '%)') + '</td>'
      + '<td class="right">' + _esc(_fmtDate(r.start)) + '</td>'
      + '<td class="right">' + _esc(_fmtDate(r.doneAt)) + '</td>'
      + '<td class="right">' + _esc(FM.fmtDays(r.daysFromStart)) + '</td>'
      + '<td class="right">' + _esc(FM.fmtDays(r.daysFromCreated)) + '</td></tr>';
  }).join('');
  return _head('Epics', '', tipHtml('epics', { label: 'Epics' }))
    + '<div class="ds-table-wrap"><table class="ds-table" aria-label="Epics"><thead><tr>'
    + '<th>Epic</th><th>Status</th><th class="right">Progress</th><th class="right">Start</th><th class="right">End</th>'
    + '<th class="right">Days since start</th><th class="right">Days since creation</th></tr></thead><tbody>'
    + (body || '<tr><td colspan="7">No epics in the downloaded data.</td></tr>') + '</tbody></table></div>';
}

function _statusName(model, id) {
  const s = (model.statuses || []).find((x) => String(x.id) === String(id));
  return s ? s.name : String(id);
}

function _closedWithoutWorkHtml(model) {
  const rows = FM.closedWithoutWorkRows(model.facts, model.buckets, model.cancelledIds);
  const body = rows.slice(0, ROWS_CAP).map((r) => '<tr><td>' + _keyLink(r.key) + ' <span class="devops-stats-summary" title="' + _esc(r.summary) + '">' + _esc(r.summary) + '</span></td>'
    + '<td>' + _esc(_statusName(model, r.status_id)) + '</td>'
    + '<td class="right">' + _esc(_fmtDate(r.created)) + '</td>'
    + '<td class="right">' + _esc(_fmtDate(r.doneAt)) + '</td>'
    + '<td class="right">' + _esc(FM.fmtDays(r.daysOpen)) + '</td>'
    + '<td>' + _esc(r.assignee || '-') + '</td></tr>').join('');
  return _head('Closed without work', '', tipHtml('closedWithoutWorkList', { label: 'Closed without work' }))
    + '<div class="ds-table-wrap"><table class="ds-table" aria-label="Closed without work"><thead><tr>'
    + '<th>Issue</th><th>Status</th><th class="right">Created</th><th class="right">Closed</th><th class="right">Days open</th><th>Person</th></tr></thead><tbody>'
    + (body || '<tr><td colspan="6">No issues closed without work in the selected period.</td></tr>') + '</tbody></table></div>'
    + (rows.length > ROWS_CAP ? '<div class="devops-stats-meta">Showing ' + ROWS_CAP + ' of ' + rows.length + ' issues.</div>' : '');
}

function _cancelledAfterWorkHtml(model) {
  const rows = FM.cancelledAfterWorkRows(model.facts, model.buckets, model.cancelledIds);
  const totals = FM.cancelledAfterWorkTotals(model.facts, model.buckets, model.cancelledIds);
  const body = rows.slice(0, ROWS_CAP).map((r) => '<tr><td>' + _keyLink(r.key) + ' <span class="devops-stats-summary" title="' + _esc(r.summary) + '">' + _esc(r.summary) + '</span></td>'
    + '<td class="right">' + _esc(_fmtDate(r.startedAt)) + '</td>'
    + '<td class="right">' + _esc(_fmtDate(r.cancelledAt)) + '</td>'
    + '<td class="right">' + _esc(FM.fmtDays(r.daysInWork)) + '</td>'
    + '<td class="right">' + (r.loggedKnown ? _esc(FM.fmtLogged(r.loggedSeconds)) : '-') + '</td>'
    + '<td>' + _esc(r.assignee || '-') + '</td></tr>').join('');
  const meta = totals.count
    ? 'In the selected period ' + totals.count + ' issues were cancelled after work had started: in total '
      + (totals.loggedSeconds === null ? 'an unknown amount of logged work' : FM.fmtLogged(totals.loggedSeconds) + ' of logged work')
      + ' and ' + FM.fmtDays(totals.daysInWork) + ' days in progress.'
      + (totals.unknownTime ? ' For ' + totals.unknownTime + ' issues there is no logged-time data (stored before this field was added) - fetch the data again.' : '')
    : '';
  return _head('Cancelled after work started', '', tipHtml('cancelledAfterWorkList', { label: 'Cancelled after work started' }))
    + (meta ? '<div class="devops-stats-meta">' + _esc(meta) + '</div>' : '')
    + '<div class="ds-table-wrap"><table class="ds-table" aria-label="Cancelled after work started"><thead><tr>'
    + '<th>Issue</th><th class="right">Start</th><th class="right">Cancelled</th><th class="right">Days in progress</th><th class="right">Logged</th><th>Person</th></tr></thead><tbody>'
    + (body || '<tr><td colspan="6">No issues cancelled after work started in the selected period.</td></tr>') + '</tbody></table></div>'
    + (rows.length > ROWS_CAP ? '<div class="devops-stats-meta">Showing ' + ROWS_CAP + ' of ' + rows.length + ' issues.</div>' : '');
}

function _agingHtml(model) {
  const rows = FM.agingRows(model.facts, model.cat, model.blockedIds, model.now);
  const body = rows.map((r) => '<tr><td>' + _keyLink(r.key) + ' <span class="devops-stats-summary" title="' + _esc(r.summary) + '">' + _esc(r.summary) + '</span></td>'
    + '<td>' + _esc(_statusName(model, r.status_id)) + '</td>'
    + '<td class="right">' + _esc(FM.fmtDays(r.daysInProgress)) + '</td>'
    + '<td class="right">' + _esc(FM.fmtDays(r.daysInStatus)) + '</td>'
    + '<td class="right">' + _esc(FM.fmtDays(r.blockedDays)) + '</td>'
    + '<td>' + _esc(r.assignee || '-') + '</td></tr>').join('');
  return _head('Longest in progress', '', tipHtml('aging', { label: 'Longest in progress' }))
    + '<div class="ds-table-wrap"><table class="ds-table" aria-label="Longest in progress"><thead><tr>'
    + '<th>Issue</th><th>Status</th><th class="right">Days in progress</th><th class="right">Days in current status</th><th class="right">Blocked days</th><th>Person</th></tr></thead><tbody>'
    + (body || '<tr><td colspan="6">No issues in progress.</td></tr>') + '</tbody></table></div>';
}

function _blockedHtml(model) {
  const rows = FM.blockedNowRows(model.facts, model.cat, model.blockedIds, model.now);
  const share = FM.blockedShare(model.facts, model.buckets, model.blockedIds, model.now, model.cancelledIds);
  const body = rows.slice(0, ROWS_CAP).map((r) => '<tr><td>' + _keyLink(r.key) + ' <span class="devops-stats-summary" title="' + _esc(r.summary) + '">' + _esc(r.summary) + '</span></td>'
    + '<td>' + _esc(_statusName(model, r.status_id)) + '</td>'
    + '<td class="right">' + _esc(FM.fmtDays(r.blockedDays)) + '</td>'
    + '<td>' + _esc(r.assignee || '-') + '</td></tr>').join('');
  const total = rows.reduce((a, r) => a + (r.blockedDays || 0), 0);
  return _head('Blocked', '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ds-blocked>Set statuses</button>',
    tipHtml('blocked', { label: 'Blocked' }))
    + '<div class="devops-stats-meta">Total blocked time of the issues blocked now: ' + _esc(FM.fmtDays(total)) + ' days.'
    + (share === null ? '' : ' Blocked time was ' + Math.round(share * 100) + '% of the cycle time of issues delivered in the selected period.') + '</div>'
    + '<div class="ds-table-wrap"><table class="ds-table" aria-label="Blocked issues"><thead><tr>'
    + '<th>Issue</th><th>Status</th><th class="right">Blocked days</th><th>Person</th></tr></thead><tbody>'
    + (body || '<tr><td colspan="4">No blocked issues.</td></tr>') + '</tbody></table></div>';
}

/** Cancelled ids in force: the saved list, or the name-based proposal while nothing is saved. */
function _cancelledIds(index) {
  const saved = _overview && _overview.config && _overview.config.cancelled_status_ids;
  return Array.isArray(saved) ? saved : FM.proposeCancelledStatuses((index && index.statuses) || []);
}

function _model() {
  const index = _overview.index;
  const now = Date.now();
  const buckets = FM.bucketsFor(_granularity, now);
  const blockedIds = (_overview.config && _overview.config.blocked_status_ids) || [];
  return {
    index, now, buckets, blockedIds, cancelledIds: _cancelledIds(index), facts: _issues || [],
    statuses: index.statuses || [], cat: FM.categoryMap(index.statuses),
  };
}

const TABS = [['team', 'Team'], ['people', 'People']];

// Bare ds-tabs-list on purpose: the strip spans the page and its rule runs
// under the panel it switches (css/ds.css "Tabs").
function _tabsHtml() {
  return '<div class="ds-tabs-list devops-stats-tabs" role="tablist" aria-label="Statistics view">'
    + TABS.map(([id, label]) => '<button type="button" class="ds-tab' + (_tab === id ? ' active' : '') + '" role="tab"'
      + ' id="devops-stats-tab-' + id + '" aria-controls="devops-stats-panel" aria-selected="' + (_tab === id) + '"'
      + ' tabindex="' + (_tab === id ? '0' : '-1') + '" data-ds-tab="' + id + '">' + label + '</button>').join('')
    + '</div>';
}

// -- People ------------------------------------------------------------------
// Only the team below (TEAM: the `team` value in team/team-members.json); people are matched to Jira display names through the
// core team directory (/js/team-directory.js, the ONE name resolver).

const TEAM = 'Falcon';
const ALL_TEAM = '__team__';

function _teamMembers() {
  const list = _teamDir && typeof _teamDir.getTeamMembers === 'function' ? _teamDir.getTeamMembers() : [];
  return (list || []).filter((m) => m && m.team === TEAM)
    .sort((x, y) => _teamDir.fullName(x).localeCompare(_teamDir.fullName(y), 'en'));
}

// Jira display name -> roster member id ('' when not on the roster). A
// deactivated Jira account carries a trailing "[X]"; it is the same person.
const _memberIdCache = new Map();
function _memberIdOf(jiraName) {
  if (_memberIdCache.has(jiraName)) return _memberIdCache.get(jiraName);
  const clean = String(jiraName).replace(/\s*\[x\]\s*$/i, '');
  const m = _teamDir && typeof _teamDir.memberByName === 'function' ? _teamDir.memberByName(clean) : null;
  const id = m && m.id ? String(m.id) : '';
  _memberIdCache.set(jiraName, id);
  return id;
}

function _personToolbarHtml(members) {
  const opt = (id, label) => '<option value="' + _esc(id) + '"' + (_person === id ? ' selected' : '') + '>' + _esc(label) + '</option>';
  return '<div class="devops-stats-person-bar">'
    + '<label class="devops-stats-person-label" for="devops-stats-person">Person</label>'
    + '<select id="devops-stats-person" class="ds-input devops-stats-person-select" data-ds-person>'
    + opt(ALL_TEAM, 'The whole ' + TEAM + ' team')
    + members.map((m) => opt(String(m.id), _teamDir.fullName(m))).join('')
    + '</select>'
    + _filterHtml()
    + '</div>';
}

function _peopleHtml(model) {
  if (!_teamDir) {
    return '<div class="ds-callout ds-callout--warning"><div>Loading the team directory failed or is still running - refresh the page if the list of people does not appear.</div></div>';
  }
  const members = _teamMembers();
  if (!members.length) {
    return '<div class="ds-callout ds-callout--info"><div>The team directory has no members of the ' + _esc(TEAM) + ' team or is not downloaded yet '
      + '(Settings > Users, the team data source).</div></div>';
  }
  if (_person !== ALL_TEAM && !members.some((m) => String(m.id) === _person)) _person = ALL_TEAM;
  const chosen = new Set(_person === ALL_TEAM ? members.map((m) => String(m.id)) : [_person]);
  const isMine = (name) => chosen.has(_memberIdOf(name));
  const who = _person === ALL_TEAM ? TEAM : _teamDir.fullName(members.find((m) => String(m.id) === _person));

  // Tiles: the CURRENT week, whatever the comparison below shows.
  const weeks = FM.bucketsFor('week', model.now);
  const wk = FM.personPeriodStats(model.facts, weeks, model.cat, model.cancelledIds, isMine);
  const cur = wk.perBucket[wk.perBucket.length - 1];
  const curLabel = weeks[weeks.length - 1].label;
  const tile = (value, label, key, hi) => '<div class="ds-card ds-stat' + (hi ? ' ds-stat--highlight' : '') + '">'
    + '<div class="ds-stat-value">' + _esc(value) + '</div><div class="ds-stat-label">' + _esc(label)
    + tipHtml(key, { label }) + '</div></div>';
  const tiles = '<div class="ds-stat-row devops-stats-person-tiles" aria-label="This week">'
    + '<div class="ds-card ds-stat-subject devops-stats-person-subject"><span>' + _esc(who) + '</span>'
    + '<span class="devops-stats-th-note">This week: ' + _esc(curLabel) + '</span></div>'
    + tile(String(wk.wipNow), 'In progress now', 'personWip', true)
    + tile(String(cur.delivered), 'Delivered this week', 'personDelivered')
    + tile(FM.fmtDays(cur.leadMedian), 'Lead time - median (days)', 'personLead')
    + tile(FM.fmtDays(cur.cycleMedian), 'Cycle time - median (days)', 'personCycle')
    + tile(wk.loggedKnown ? FM.fmtLogged(cur.loggedSeconds) : '-', 'Time logged this week', 'personLogged')
    + '</div>';

  // Comparison: one row per week or month, newest first.
  const months = _granularity === 'month';
  const buckets = months ? model.buckets : weeks;
  const stats = months ? FM.personPeriodStats(model.facts, buckets, model.cat, model.cancelledIds, isMine) : wk;
  const order = buckets.map((b, i) => i).reverse();
  const body = order.map((i) => {
    const b = buckets[i];
    const r = stats.perBucket[i];
    return '<tr><td>' + _esc(b.label) + (b.current ? ' <span class="devops-stats-th-note">(in progress)</span>' : '') + '</td>'
      + '<td class="right">' + r.delivered + '</td>'
      + '<td class="right">' + _esc(FM.fmtDays(r.leadMedian)) + '</td>'
      + '<td class="right">' + _esc(FM.fmtDays(r.cycleMedian)) + '</td>'
      + '<td class="right">' + _esc(stats.loggedKnown ? FM.fmtLogged(r.loggedSeconds) : '-') + '</td></tr>';
  }).join('');
  const title = months ? 'Month comparison' : 'Week comparison';
  return _personToolbarHtml(members)
    + '<div class="devops-stats-range">Tiles: the current week (' + _esc(curLabel) + ', from Monday). Table: '
    + _esc(_rangeText(buckets)) + '. Only issues and worklog entries of ' + _esc(TEAM) + ' members are counted'
    + (_person === ALL_TEAM ? ' - without unassigned issues and people outside the team.' : '.') + '</div>'
    + tiles
    + _head(title, '', tipHtml('personCompare', { label: title }))
    + (stats.loggedKnown ? '' : '<div class="devops-stats-meta">No worklog data - fetch the data again.</div>')
    + '<div class="ds-table-wrap"><table class="ds-table" aria-label="' + _esc(title + ': ' + who) + '"><thead><tr>'
    + '<th>' + (months ? 'Month' : 'Week') + '</th><th class="right">Delivered</th>'
    + '<th class="right">Lead time - median (days)</th><th class="right">Cycle time - median (days)</th>'
    + '<th class="right">Time logged</th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

function _paint(root) {
  if (!root || !_overview || !_overview.index) return;
  const model = _model();
  let panel;
  if (_tab === 'people') {
    panel = _peopleHtml(model);
  } else {
    const tiles = FM.summaryTiles(model.facts, model.buckets, model.cat, model.blockedIds, model.now, model.cancelledIds);
    panel = _filterHtml()
      + '<div class="devops-stats-range">Range: ' + _esc(_rangeText(model.buckets)) + '; the current '
      + (_granularity === 'month' ? 'month' : 'week') + ' is still running. The "now" tiles show the state today, '
      + 'the other numbers, charts and tables the selected range.</div>'
      + _tilesHtml(tiles, model)
      + _chartsHtml(model)
      + _epicsHtml(model)
      + _agingHtml(model)
      + _closedWithoutWorkHtml(model)
      + _cancelledAfterWorkHtml(model)
      + _blockedHtml(model);
  }
  root.innerHTML = _bannerHtml(model.index, { blocked_status_ids: model.blockedIds })
    + _tabsHtml()
    + '<div id="devops-stats-panel" class="devops-stats-panel-body" role="tabpanel" aria-labelledby="devops-stats-tab-' + _tab + '">'
    + panel + '</div>';
}

// -- Wiring ------------------------------------------------------------------

function _wireRoot(root) {
  if (_rootWired) return;
  _rootWired = true;
  const onChange = (e) => {
    const sel = e.target.closest && e.target.closest('[data-ds-person]');
    if (!sel) return;
    _person = sel.value;
    _paint(root);
    const again = root.querySelector('[data-ds-person]');
    if (again) again.focus();
  };
  const onClick = async (e) => {
    const tab = e.target.closest('[data-ds-tab]');
    if (tab) {
      const t = tab.getAttribute('data-ds-tab');
      if (t !== _tab) { _tab = t; _paint(root); root.querySelector('[data-ds-tab="' + t + '"]').focus(); }
      return;
    }
    const seg = e.target.closest('[data-ds-gran]');
    if (seg) {
      const g = seg.getAttribute('data-ds-gran');
      if (g !== _granularity) { _granularity = g; _paint(root); }
      return;
    }
    if (e.target.closest('[data-ds-blocked]')) await _openBlocked();
  };
  // A definition tooltip is 300px wide and start-aligned; near the right edge
  // of the window it is flipped to end-aligned before it shows.
  const onTipEnter = (e) => {
    const tip = e.target.closest && e.target.closest('.devops-stats-tip');
    if (!tip) return;
    tip.classList.toggle('devops-stats-tip--end', tip.getBoundingClientRect().left + 320 > window.innerWidth);
  };
  // Arrow keys move between the two tabs (WAI-ARIA tabs pattern).
  const onKey = (e) => {
    if (!e.target.closest || !e.target.closest('[data-ds-tab]')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = TABS.findIndex(([id]) => id === _tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
    _tab = next;
    _paint(root);
    root.querySelector('[data-ds-tab="' + next + '"]').focus();
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKey);
  root.addEventListener('mouseover', onTipEnter);
  root.addEventListener('focusin', onTipEnter);
  _deps.registerViewCleanup(() => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('mouseover', onTipEnter);
    root.removeEventListener('focusin', onTipEnter);
    _rootWired = false;
  });
}

// -- Entry point -------------------------------------------------------------

async function _render() {
  const root = _root();
  if (!root) return;
  _paintActions();
  if (!root.dataset.dsBooted) root.innerHTML = _skeletonHtml();

  if (!_overview || !_issues) {
    try {
      const [ovRes, isRes] = await Promise.all([fetch(_api('/overview')), fetch(_api('/issues'))]);
      // Both routes always answer 200; anything else (e.g. 404 before the
      // server loaded the module) is the error state, not "no data yet".
      if (!ovRes.ok || !isRes.ok) throw new Error('HTTP ' + ovRes.status + '/' + isRes.status);
      _overview = await ovRes.json();
      const iss = await isRes.json();
      _issues = (iss && iss.issues) || [];
    } catch {
      _overview = null;
      _issues = null;
      root.innerHTML = _errorHtml();
      return;
    }
  }
  root.dataset.dsBooted = '1';
  _paintActions();

  if (_overview.storage === 'unavailable') { root.innerHTML = _unavailableHtml(); return; }
  if (!_overview.index) { root.innerHTML = _emptyHtml(); return; }

  _paint(root);
  _wireRoot(root);
}

export const views = {
  'devops-stats-main': {
    /** @param {{navigate, registerViewCleanup, showToast, apiBase}} deps */
    init(deps) {
      _deps = deps;
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
      (async () => {
        try {
          const td = await import('/js/team-directory.js');
          await td.loadTeamDirectory();
          _teamDir = td;
          _memberIdCache.clear();
          // The roster may land after the first paint: repaint (People needs it,
          // and so does the team split under "In progress now").
          const root = _root();
          if (root && _overview && _overview.index) _paint(root);
        } catch { _teamDir = null; }
      })();
    },

    /** Called on every navigation into the view and after a data reload. */
    async render(_subPath, _opts) {
      await _render();
    },

    /** Data pulled or written under us - drop the cache, keep the granularity. */
    async onDataChanged() {
      _overview = null;
      _issues = null;
      await _render();
    },
  },
};
