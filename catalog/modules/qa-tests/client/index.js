// modules/qa-tests/client/index.js
// QA Tests - test automation coverage read from Jira.
// Data: GET /api/m/qa-tests/overview (index + aggregates),
//       shards from /data-sub-repositories/ds-data/ (static).
// Panel: KPI groups, savings strip, filter/search, ds-table with
// ds-row-toggle, ds-badge legend, footer with bugs and estimates.
// Refresh through openRefreshModal (refresh-modal.js).
//
// Shard cache lives ONLY here (module-scope). A data pull re-imports this
// file fresh, so any cache in a sibling file would survive with stale data.
// onDataChanged() drops the cache and repaints.

import { openRefreshModal } from './refresh-modal.js';

const ROOT_ID    = 'qa-tests-main-root';
const ACTIONS_ID = 'qa-tests-main-actions';
const SHARD_BASE = '/data-sub-repositories/ds-data/jira/qa-automation/module-';

// Status visual order: left = least mature, right = most mature.
const STATUS_CONFIG = [
  { key: 'New',         badgeKind: 'violet',   label: 'New' },
  { key: 'Open',        badgeKind: 'yellow',   label: 'Open' },
  { key: 'In Progress', badgeKind: 'blue',     label: 'In progress' },
  { key: 'Blocked',     badgeKind: 'red',      label: 'Blocked' },
  { key: 'Test',        badgeKind: 'magenta',  label: 'Manual test' },
  { key: 'Automated',   badgeKind: 'green',    label: 'Automated' },
];

const STATUS_ORDER = STATUS_CONFIG.reduce((acc, cfg, idx) => {
  acc[cfg.key] = idx;
  return acc;
}, {});

// CSS custom properties mapped to DS tokens in style.css.
const STATUS_BAR_VAR = {
  'New':         'var(--qa-bar-new)',
  'Open':        'var(--qa-bar-open)',
  'In Progress': 'var(--qa-bar-in-progress)',
  'Blocked':     'var(--qa-bar-blocked)',
  'Test':        'var(--qa-bar-test)',
  'Automated':   'var(--qa-bar-automated)',
};

const GROUP_ORDERS = ['orders', 'checkout'];
const GROUP_OTHER  = ['catalog', 'stock', 'deliveries', 'labels'];

// Fallback classification of a bug by its own Jira project prefix, used when
// its description carries no "Test auto: KEY" reference. Adjust to your projects.
const BUG_PREFIX_GROUP = { ORD: 'orders', WMS: 'other' };

// -- Module-scope state -------------------------------------------------------
// All state here; never in sibling files (modules-template/README.md).
let _deps           = null;
let _dsModal        = null;
let _overview       = null;  // last GET /overview answer
let _modules        = null;  // shard objects array, null = not loaded
let _filterSearch   = '';    // normalised search string
let _expandedModules = new Set();
let _actionsWired   = false;
let _rootWired      = false;
let _refreshing     = false;

// -- Helpers ------------------------------------------------------------------

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/qa-tests') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _root() {
  return document.getElementById(ROOT_ID);
}

function _fmtPct(pct) {
  if (pct === null || pct === undefined) return '—';
  return pct.toFixed(1) + '%';
}

function _fmtNum(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('en-GB');
}

// Smart minute formatter: < 60 => "X min", < 480 => "Xh Ymin", >= 480 => "X.X MD".
function _fmtMinSmart(min) {
  if (min === null || min === undefined || min === 0) return '—';
  min = Math.round(min);
  if (min < 60) return min + ' min';
  if (min < 480) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? h + 'h' : h + 'h ' + m + 'min';
  }
  const md = min / 480;
  return (md === Math.floor(md) ? md.toFixed(0) : md.toFixed(1)) + ' MD';
}

// Always render seconds as MD.
function _fmtMd(sec) {
  if (!sec) return '0 MD';
  return (sec / 28800).toFixed(1) + ' MD';
}

function _fmtTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear()
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Lower-case and strip diacritics for case-insensitive search.
function _normalizeSearch(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _matchesSearch(text) {
  if (!_filterSearch) return true;
  return _normalizeSearch(String(text || '')).includes(_filterSearch);
}

function _testMatchesSearch(test) {
  if (!_filterSearch) return true;
  return _matchesSearch(test.key) || _matchesSearch(test.summary) || _matchesSearch(test.status);
}

function _jiraBase() {
  return (_overview && _overview.jira_url) || 'https://jira.example.com';
}

// -- Business logic ------------------------------------------------------------

function _aggregateGroup(modules, keys) {
  const mods = keys.map((k) => modules.find((m) => m.key === k)).filter(Boolean);
  if (!mods.length) return null;
  const active_total  = mods.reduce((s, m) => s + (m.active_total || 0), 0);
  const automated     = mods.reduce((s, m) => s + (m.automated || 0), 0);
  const coverage_pct  = active_total > 0 ? (automated / active_total) * 100 : 0;
  const tests         = mods.flatMap((m) => m.tests || []);
  const runs_7d       = mods.reduce((s, m) => s + (m.runs_7d || 0), 0);
  const executions_7d = mods.reduce((s, m) => s + (m.executions_7d || 0), 0);
  let last_run_at = null, last_run_key = null;
  for (const m of mods) {
    if (m.last_run_at && (!last_run_at || m.last_run_at > last_run_at)) {
      last_run_at = m.last_run_at;
      last_run_key = m.last_run_key;
    }
  }
  return { active_total, automated, coverage_pct, tests, runs_7d, executions_7d, last_run_at, last_run_key };
}

function _buildTestToGroupMap(modules) {
  const m = {};
  for (const mod of modules) {
    const group = GROUP_ORDERS.includes(mod.key) ? 'orders'
      : GROUP_OTHER.includes(mod.key) ? 'other'
      : null;
    if (!group) continue;
    for (const t of mod.tests || []) m[t.key] = group;
  }
  return m;
}

function _classifyBug(bug, testToGroup) {
  const ref = bug.test_ref;
  if (ref) {
    if (testToGroup[ref]) return testToGroup[ref];
    const prefix = ref.split('-')[0];
    if (BUG_PREFIX_GROUP[prefix]) return BUG_PREFIX_GROUP[prefix];
  }
  const bugPrefix = (bug.key || '').split('-')[0];
  if (BUG_PREFIX_GROUP[bugPrefix]) return BUG_PREFIX_GROUP[bugPrefix];
  return 'unclassified';
}

function _splitBugs(bugs, testToGroup) {
  const result = { orders: [], other: [], unclassified: [] };
  for (const b of bugs || []) result[_classifyBug(b, testToGroup)].push(b);
  return result;
}

function _timeByStatus(tests) {
  const out = {};
  for (const t of tests || []) {
    if (!t.estimate_seconds) continue;
    out[t.status] = (out[t.status] || 0) + t.estimate_seconds;
  }
  return out;
}

// -- HTML builders -------------------------------------------------------------

function _stackedBarHtml(statuses, activeTotal) {
  if (!activeTotal || activeTotal <= 0) {
    return '<span class="qa-tests-bar-empty">—</span>';
  }
  let html = '<div class="qa-tests-stacked-bar">';
  for (const cfg of STATUS_CONFIG) {
    const count = (statuses && statuses[cfg.key]) || 0;
    if (count <= 0) continue;
    const pct   = (count / activeTotal) * 100;
    const color = STATUS_BAR_VAR[cfg.key] || 'var(--text-tertiary)';
    const title = cfg.label + ': ' + count + ' (' + _fmtPct(pct) + ')';
    html += '<div class="qa-tests-bar-seg" style="width:' + pct.toFixed(1) + '%;background:' + color + '" title="' + _esc(title) + '" aria-hidden="true"></div>';
  }
  html += '</div>';
  return html;
}

function _stackedTimeBarHtml(timeMap) {
  const total = Object.values(timeMap).reduce((s, v) => s + v, 0);
  if (!total) return '<span class="qa-tests-bar-empty">—</span>';
  let html = '<div class="qa-tests-stacked-bar">';
  for (const cfg of STATUS_CONFIG) {
    const sec = timeMap[cfg.key] || 0;
    if (sec <= 0) continue;
    const pct   = (sec / total) * 100;
    const color = STATUS_BAR_VAR[cfg.key] || 'var(--text-tertiary)';
    const title = cfg.label + ': ' + _fmtMd(sec) + ' (' + _fmtPct(pct) + ')';
    html += '<div class="qa-tests-bar-seg" style="width:' + pct.toFixed(1) + '%;background:' + color + '" title="' + _esc(title) + '" aria-hidden="true"></div>';
  }
  html += '</div>';
  return html;
}

function _runsBadgeHtml(count, lastAt, lastKey) {
  if (!count) return '<span class="qa-tests-runs-zero" title="No [AUTO] run in the last 7 days">—</span>';
  const tip = lastAt
    ? 'Last run: ' + _fmtTimestamp(lastAt) + (lastKey ? ' (' + lastKey + ')' : '')
    : 'Runs in the last 7 days';
  return '<span class="qa-tests-runs-badge" title="' + _esc(tip) + '">' + count + '×</span>';
}

// ds-stat-row KPI group: ds-stat-subject + 4 ds-stat tiles.
function _kpiGroupHtml(titleMain, titleSub, group, bugsCount) {
  const subjectLabel = titleMain + (titleSub ? ' ' + titleSub : '');

  if (!group) {
    return '<div class="ds-stat-row" style="--ds-stat-cols:4">'
      + '<div class="ds-card ds-stat-subject">' + _esc(subjectLabel) + '</div>'
      + '<div class="ds-card ds-stat"><div class="ds-stat-value">—</div><div class="ds-stat-label">No data</div></div>'
      + '</div>';
  }

  const effortFilled = (group.tests || [])
    .filter((t) => t.manual_effort_min !== null && t.manual_effort_min !== undefined).length;
  const effortPct = group.active_total > 0
    ? (effortFilled / group.active_total) * 100
    : null;

  return '<div class="ds-stat-row" style="--ds-stat-cols:4">'
    + '<div class="ds-card ds-stat-subject qa-tests-kpi-subject">'
    + '<div><strong>' + _esc(titleMain) + '</strong>'
    + (titleSub ? '<br><span class="qa-tests-kpi-sub">' + _esc(titleSub) + '</span>' : '')
    + '</div></div>'
    + '<div class="ds-card ds-stat ds-stat--highlight">'
    + '<div class="ds-stat-value ds-stat-value--success">' + _fmtPct(group.coverage_pct) + '</div>'
    + '<div class="ds-stat-label">TC coverage<br>' + _fmtNum(group.automated) + ' / ' + _fmtNum(group.active_total) + '</div>'
    + '</div>'
    + '<div class="ds-card ds-stat" title="Share of test cases with the manual effort field filled in">'
    + '<div class="ds-stat-value' + (effortPct !== null && effortPct > 0 ? ' ds-stat-value--success' : '') + '">'
    + (effortPct === null ? '—' : _fmtPct(effortPct)) + '</div>'
    + '<div class="ds-stat-label">Effort filled in<br>' + _fmtNum(effortFilled) + ' / ' + _fmtNum(group.active_total) + ' TC</div>'
    + '</div>'
    + '<div class="ds-card ds-stat" title="Daily automated [AUTO] regressions in the last 7 days">'
    + '<div class="ds-stat-value">' + _fmtNum(group.runs_7d || 0) + ' / ' + _fmtNum(group.executions_7d || 0) + '</div>'
    + '<div class="ds-stat-label">Runs / executions (7d)</div>'
    + '</div>'
    + '<div class="ds-card ds-stat" title="Bugs found by automated tests">'
    + '<div class="ds-stat-value">' + _fmtNum(bugsCount || 0) + '</div>'
    + '<div class="ds-stat-label">Bugs found by automation</div>'
    + '</div>'
    + '</div>';
}

function _tableHtml(modules) {
  const visibleModules = modules.filter((m) => m.key !== 'warehouse');
  const hasSearch = !!_filterSearch;
  let rows = '';

  for (const mod of visibleModules) {
    const modId = 'qa-mod-' + mod.key;
    const matchedTests = (mod.tests || []).filter(_testMatchesSearch);

    if (hasSearch) {
      const labelMatch = _matchesSearch(mod.label);
      if (!labelMatch && matchedTests.length === 0) continue;
    }

    const isExpanded = _expandedModules.has(modId) || hasSearch;
    const modTimeByStatus = _timeByStatus(mod.tests);
    const modTimeTotal    = Object.values(modTimeByStatus).reduce((s, v) => s + v, 0);
    const modTimeAuto     = modTimeByStatus['Automated'] || 0;
    const modTimePct      = modTimeTotal > 0 ? (modTimeAuto / modTimeTotal) * 100 : null;
    const testsId         = modId + '-tests';

    const runsLine = mod.runs_7d
      ? '<div class="qa-tests-runs-line" title="Last run: ' + _esc(_fmtTimestamp(mod.last_run_at))
        + (mod.last_run_key ? ' (' + _esc(mod.last_run_key) + ')' : '') + '">'
        + mod.runs_7d + ' runs · ' + _fmtNum(mod.executions_7d) + ' executions (7d)</div>'
      : '<div class="qa-tests-runs-line qa-tests-runs-zero">No [AUTO] regression in 7d</div>';

    rows += '<tr class="qa-tests-parent-row">'
      + '<td><div class="qa-tests-mod-cell">'
      + '<button type="button" class="ds-row-toggle" data-qa-expand="' + _esc(modId) + '"'
      + ' aria-expanded="' + isExpanded + '" aria-controls="' + _esc(testsId) + '">'
      + '<span class="ds-row-toggle-chevron" aria-hidden="true">&#9654;</span>'
      + '<span>' + _esc(mod.label) + '</span>'
      + '</button>'
      + runsLine
      + '</div></td>'
      + '<td class="right">' + _fmtNum(mod.active_total) + '</td>'
      + '<td class="right">' + _fmtMinSmart(mod.manual_effort_min_total) + '</td>'
      + '<td class="right">' + _fmtMinSmart(mod.auto_exec_min_total) + '</td>'
      + '<td class="right">' + _fmtMinSmart(mod.savings_min_total) + '</td>'
      + '<td class="right">' + _fmtPct(mod.coverage_pct) + '</td>'
      + '<td class="qa-tests-bars-cell">'
      + '<div class="qa-tests-bars-dual">'
      + '<div class="qa-tests-bar-row"><span class="qa-tests-bar-lbl">TC</span>'
      + _stackedBarHtml(mod.statuses, mod.active_total)
      + '<span class="qa-tests-bar-pct">' + _fmtPct(mod.coverage_pct) + '</span></div>'
      + '<div class="qa-tests-bar-row"><span class="qa-tests-bar-lbl">Time</span>'
      + _stackedTimeBarHtml(modTimeByStatus)
      + '<span class="qa-tests-bar-pct">' + (modTimePct === null ? '—' : _fmtPct(modTimePct)) + '</span></div>'
      + '</div>'
      + '</td>'
      + '</tr>';

    // Sort tests: status order ASC, then updated DESC, then key ASC.
    const sortedTests = matchedTests.slice().sort((a, b) => {
      const oa = STATUS_ORDER[a.status] !== undefined ? STATUS_ORDER[a.status] : 99;
      const ob = STATUS_ORDER[b.status] !== undefined ? STATUS_ORDER[b.status] : 99;
      if (oa !== ob) return oa - ob;
      const ua = a.updated || '';
      const ub = b.updated || '';
      if (ua !== ub) return ub.localeCompare(ua);
      return a.key.localeCompare(b.key);
    });

    sortedTests.forEach((test, i) => {
      const effort    = _fmtMinSmart(test.manual_effort_min);
      const autoExec  = _fmtMinSmart(test.auto_exec_min);
      const saving    = _fmtMinSmart(test.savings_min);
      const runs      = _runsBadgeHtml(test.runs_7d, test.last_run_at, test.last_run_key);
      const cfg       = STATUS_CONFIG.find((c) => c.key === test.status);
      const bk        = cfg ? cfg.badgeKind : 'gray';
      const slabel    = cfg ? cfg.label : test.status;
      const rowId     = i === 0 ? ' id="' + _esc(testsId) + '"' : '';
      rows += '<tr class="qa-tests-test-row' + (isExpanded ? '' : ' hidden') + '"'
        + ' data-qa-mod-ref="' + _esc(modId) + '"' + rowId + '>'
        + '<td colspan="2" class="qa-tests-test-name">'
        + '<a class="ds-link qa-tests-test-key"'
        + ' href="' + _esc(_jiraBase() + '/browse/' + test.key) + '"'
        + ' target="_blank" rel="noopener noreferrer"'
        + ' aria-label="' + _esc(test.key + ' - open in Jira (new tab)') + '">'
        + _esc(test.key) + '</a>'
        + '<span class="qa-tests-test-summary">' + _esc(test.summary) + '</span>'
        + '</td>'
        + '<td><span class="qa-tests-test-est">' + effort + '</span></td>'
        + '<td><span class="qa-tests-test-est">' + autoExec + '</span></td>'
        + '<td><span class="qa-tests-test-est">' + saving + '</span></td>'
        + '<td><span class="ds-badge ds-badge--' + bk + ' ds-badge--sm">' + _esc(slabel) + '</span></td>'
        + '<td>' + runs + '</td>'
        + '</tr>';
    });
  }

  // Aggregate TOTAL row.
  const aggData = (_overview && _overview.index && _overview.index.aggregates && _overview.index.aggregates.aggregate) || {};
  const totEffort      = visibleModules.reduce((s, m) => s + (m.manual_effort_min_total || 0), 0);
  const totAutoExec    = visibleModules.reduce((s, m) => s + (m.auto_exec_min_total || 0), 0);
  const totSavings     = visibleModules.reduce((s, m) => s + (m.savings_min_total || 0), 0);
  rows += '<tr class="qa-tests-aggregate-row">'
    + '<td><strong>TOTAL</strong></td>'
    + '<td class="right"><strong>' + _fmtNum(aggData.active_total) + '</strong></td>'
    + '<td class="right"><strong>' + _fmtMinSmart(totEffort) + '</strong></td>'
    + '<td class="right"><strong>' + _fmtMinSmart(totAutoExec) + '</strong></td>'
    + '<td class="right"><strong>' + _fmtMinSmart(totSavings) + '</strong></td>'
    + '<td class="right"><strong>' + _fmtPct(aggData.coverage_pct) + '</strong></td>'
    + '<td></td>'
    + '</tr>';

  return '<div class="ds-table-wrap"><table class="ds-table qa-tests-table" aria-label="QA areas - test case statuses">'
    + '<thead><tr>'
    + '<th>Area</th>'
    + '<th class="right">Active TC</th>'
    + '<th class="right">Manual effort</th>'
    + '<th class="right">Auto run</th>'
    + '<th class="right">Saving</th>'
    + '<th class="right">Coverage</th>'
    + '<th>Statuses</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

function _legendHtml() {
  let html = '<div class="qa-tests-legend">';
  for (const cfg of STATUS_CONFIG) {
    html += '<span class="qa-tests-legend-item">'
      + '<span class="qa-tests-legend-swatch" style="background:' + (STATUS_BAR_VAR[cfg.key] || 'var(--text-tertiary)') + '" aria-hidden="true"></span>'
      + '<span>' + _esc(cfg.label) + '</span>'
      + '</span>';
  }
  html += '</div>';
  return html;
}

function _footerHtml(modules, bugsList) {
  const testToGroup = _buildTestToGroupMap(modules);
  const splitB    = _splitBugs(bugsList, testToGroup);
  const bugsTotal = bugsList.length;
  const agg       = (_overview && _overview.index && _overview.index.aggregates) || {};
  const estAuto   = (agg.estimates && agg.estimates.automated) || {};
  const estAll    = (agg.estimates && agg.estimates.all) || {};

  const unclassifiedLine = splitB.unclassified.length > 0
    ? '<p>Unclassified (no "Test auto:" in the description and an unknown project): ' + splitB.unclassified.length + '</p>'
    : '';

  return '<div class="qa-tests-footer">'
    + '<div class="ds-card qa-tests-footer-card"><div class="ds-card-body">'
    + '<h3 class="qa-tests-footer-h3">Bugs found by automation</h3>'
    + '<p>' + _fmtNum(bugsTotal) + ' bugs - Orders + Checkout: '
    + splitB.orders.length + ', Warehouse: ' + splitB.other.length + '</p>'
    + unclassifiedLine
    + '<p class="qa-tests-footer-hint">Classified by "Test auto: XYZ" in the bug description, falling back to the project prefix (ORD -> Orders, WMS -> Warehouse).</p>'
    + '</div></div>'
    + '<div class="ds-card qa-tests-footer-card"><div class="ds-card-body">'
    + '<h3 class="qa-tests-footer-h3">Time estimates (overall)</h3>'
    + '<p>Automated: ' + _fmtNum(estAuto.count) + ' TC → '
    + (estAuto.hours || '—') + 'h (' + (estAuto.md || '—') + ' MD)</p>'
    + '<p>All with an estimate: ' + _fmtNum(estAll.count) + ' TC → '
    + (estAll.hours || '—') + 'h (' + (estAll.md || '—') + ' MD)</p>'
    + '</div></div>'
    + '</div>';
}

// -- Painting ------------------------------------------------------------------

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-qa-refresh'
    + (_refreshing ? ' aria-busy="true"' : '') + '>Refresh</button>';

  if (_actionsWired) return;
  _actionsWired = true;
  const onClick = async (e) => {
    if (e.target.closest('[data-qa-refresh]')) await _openRefresh();
  };
  actions.addEventListener('click', onClick);
  _deps.registerViewCleanup(() => {
    actions.removeEventListener('click', onClick);
    _actionsWired = false;
  });
}

async function _openRefresh() {
  if (_refreshing) return;
  _refreshing = true;
  _paintActions();
  try {
    await openRefreshModal({
      apiBase:             _deps.apiBase,
      overview:            _overview,
      dsModal:             _dsModal,
      registerViewCleanup: _deps.registerViewCleanup,
      // Success goes through the data bus, not a local _render(): the module
      // host then calls our onDataChanged() AND repaints the module sync bar,
      // which a local repaint would leave on the pre-refresh date.
      onDone: async () => {
        try {
          const ev = await import('/js/data-events.js');
          ev.emitDataChanged({ source: 'qa-tests' });
        } catch {
          _overview = null;
          _modules  = null;
          await _render();
        }
        _toast('success', 'QA Tests updated', '');
      },
    });
  } finally {
    _refreshing = false;
    _paintActions();
  }
}

async function _fetchModules(shardToModule) {
  const modules = [];
  for (const shardKey of Object.keys(shardToModule || {})) {
    try {
      const res = await fetch(SHARD_BASE + encodeURIComponent(shardKey) + '.json');
      if (res.ok) {
        const data = await res.json();
        if (data && data.key) modules.push(data);
      }
    } catch {
      // Shard missing - skip silently.
    }
  }
  return modules;
}

function _renderFull(root) {
  if (!root || !_overview || !_modules) return;

  const agg         = (_overview.index && _overview.index.aggregates) || {};
  const bugs        = agg.bugs_found || {};
  const bugsList    = bugs.list || [];
  const visibleMods = _modules.filter((m) => m.key !== 'warehouse');

  const ordersGroup = _aggregateGroup(_modules, GROUP_ORDERS);
  const restGroup   = _aggregateGroup(_modules, GROUP_OTHER);
  const testToGroup = _buildTestToGroupMap(_modules);
  const splitB    = _splitBugs(bugsList, testToGroup);

  const savEffort      = visibleMods.reduce((s, m) => s + (m.manual_effort_min_total || 0), 0);
  const savAuto        = visibleMods.reduce((s, m) => s + (m.auto_exec_min_total || 0), 0);
  const savSavings     = visibleMods.reduce((s, m) => s + (m.savings_min_total || 0), 0);

  root.innerHTML = ''
    // KPI groups section
    + '<section class="qa-tests-kpi-section" aria-label="QA summary">'
    + _kpiGroupHtml('Orders', '+ Checkout', ordersGroup, splitB.orders.length)
    + _kpiGroupHtml('Warehouse', 'Catalog + Stock levels + Deliveries + Labels', restGroup, splitB.other.length)
    + '</section>'
    // Savings section
    + '<section class="qa-tests-savings-section" aria-label="Savings from automation">'
    + '<div class="ds-section-head"><h2 class="ds-section-head-title">Savings from automation</h2></div>'
    + '<div class="ds-stat-row" style="--ds-stat-cols:3">'
    + '<div class="ds-card ds-stat-subject qa-tests-kpi-subject"><div>Savings</div></div>'
    + '<div class="ds-card ds-stat">'
    + '<div class="ds-stat-value">' + _fmtMinSmart(savEffort) + '</div>'
    + '<div class="ds-stat-label">Total manual effort'
    + (savEffort > 0 ? '<br><span class="qa-tests-min-hint">' + savEffort + ' min</span>' : '')
    + '</div></div>'
    + '<div class="ds-card ds-stat">'
    + '<div class="ds-stat-value">' + _fmtMinSmart(savAuto) + '</div>'
    + '<div class="ds-stat-label">Automated run'
    + (savAuto > 0 ? '<br><span class="qa-tests-min-hint">' + savAuto + ' min</span>' : '')
    + '</div></div>'
    + '<div class="ds-card ds-stat ds-stat--highlight">'
    + '<div class="ds-stat-value ds-stat-value--success">' + _fmtMinSmart(savSavings) + '</div>'
    + '<div class="ds-stat-label">Total saving'
    + (savSavings > 0 ? '<br><span class="qa-tests-min-hint">' + savSavings + ' min</span>' : '')
    + '</div></div>'
    + '</div>'
    + '</section>'
    // Table section
    + '<div class="ds-section-head qa-tests-table-head">'
    + '<h2 class="ds-section-head-title">QA areas - test case statuses</h2>'
    + '<div class="ds-section-head-actions qa-tests-filter-actions">'
    + '<input type="search" class="ds-input qa-tests-search" placeholder="Search area or TC…" aria-label="Search an area or a test case" data-qa-search value="' + _esc(_filterSearch) + '">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-qa-collapse>Collapse all</button>'
    + '</div>'
    + '</div>'
    + _tableHtml(_modules)
    // Legend section
    + '<div class="ds-section-head"><h2 class="ds-section-head-title">Legend</h2></div>'
    + _legendHtml()
    // Footer section
    + '<div class="ds-section-head"><h2 class="ds-section-head-title">More information</h2></div>'
    + _footerHtml(_modules, bugsList);
}

// Replaces only the table wrap, preserving search input focus.
function _repaintTable(root) {
  const old = root && root.querySelector('.ds-table-wrap');
  if (!old) return;
  old.outerHTML = _tableHtml(_modules);
}

function _wireRoot(root) {
  if (_rootWired) return;
  _rootWired = true;

  const onClick = (e) => {
    const toggleBtn = e.target.closest('[data-qa-expand]');
    if (toggleBtn) {
      const modId    = toggleBtn.getAttribute('data-qa-expand');
      const expanded = !_expandedModules.has(modId);
      if (expanded) _expandedModules.add(modId);
      else _expandedModules.delete(modId);
      toggleBtn.setAttribute('aria-expanded', String(expanded));
      root.querySelectorAll('[data-qa-mod-ref="' + modId + '"]').forEach((row) => {
        if (expanded) row.classList.remove('hidden');
        else row.classList.add('hidden');
      });
      return;
    }
    if (e.target.closest('[data-qa-collapse]')) {
      _expandedModules.clear();
      _repaintTable(root);
    }
  };

  const onInput = (e) => {
    if (e.target.closest('[data-qa-search]')) {
      _filterSearch = _normalizeSearch(e.target.value.trim());
      _repaintTable(root);
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  _deps.registerViewCleanup(() => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    _rootWired = false;
  });
}

// -- Entry point ---------------------------------------------------------------

async function _render() {
  const root = _root();
  if (!root) return;
  _paintActions();

  if (!root.dataset.qaBooted) {
    root.innerHTML = '<div class="qa-tests-skeleton">'
      + '<span class="ds-skeleton" style="width:100%;height:80px;display:block;margin-bottom:var(--space-16,16px)"></span>'
      + '<span class="ds-skeleton" style="width:100%;height:200px;display:block;margin-bottom:var(--space-16,16px)"></span>'
      + '<span class="ds-skeleton" style="width:100%;height:400px;display:block"></span>'
      + '</div>';
  }

  let overview;
  try {
    const res = await fetch(_api('/overview'));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    overview = await res.json();
  } catch {
    root.innerHTML = '<div class="ds-callout ds-callout--danger"><div>Could not load the QA Tests data. Check the connection and try again.</div></div>';
    return;
  }

  _overview = overview;
  root.dataset.qaBooted = '1';
  _paintActions();

  if (overview.storage === 'unavailable') {
    root.innerHTML = '<div class="ds-callout ds-callout--warning"><div>No team data on this computer. Fetch the "Team data" source in the Sync window, then use the "Refresh" button.</div></div>';
    return;
  }

  const aggregate = (overview.index && overview.index.aggregates && overview.index.aggregates.aggregate) || {};
  if (!aggregate.active_total) {
    root.innerHTML = '<div class="ds-callout ds-callout--info"><div>No QA data yet. Click "Refresh" to fetch automation coverage from Jira.</div></div>';
    return;
  }

  // Load shards from static path (no dedicated server route - see backend contract).
  if (!_modules) {
    _modules = await _fetchModules(overview.index && overview.index.shard_to_module);
  }

  _renderFull(root);
  _wireRoot(root);
}

export const views = {
  'qa-tests-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
    },

    async render(_subPath, _opts) {
      await _render();
    },

    /** Data pulled under us - drop all caches, repaint. */
    async onDataChanged() {
      _overview = null;
      _modules  = null;
      await _render();
    },
  },
};
