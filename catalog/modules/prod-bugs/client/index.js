// modules/prod-bugs/client/index.js
// "Production Bugs": production bugs per sprint.
//
// js/module-host.js imports this file lazily, creates
// <div id="prod-bugs-main-root"> and <div id="prod-bugs-main-actions"> and
// calls init() once, render() on every navigation. The data cache lives in
// THIS file only: after a pull the core reloads just the entry file, and
// onDataChanged() below drops the cache and repaints, keeping the selected
// sprint and the filters.
//
// This file must stay importable in plain Node (contract test): js/ds-modal.js
// and js/ds-select.js are loaded with a dynamic import() in init().

import {
  AREA_CONFIG, sortSprints, selectSprint, collectBugs, collectResolvedAllSprints,
  applyFilters, statusCategory, statusBadgeClass, bugTone, fmtDays, fmtDate,
} from './prod-bugs-model.mjs';
import { buildBarSvg, scrollLeftForLast } from './prod-bugs-charts.mjs';
import { openRefreshModal } from './refresh-modal.js';

const ROOT_ID = 'prod-bugs-main-root';
const ACTIONS_ID = 'prod-bugs-main-actions';

let _deps = null;
let _dsModal = null;
let _dsSelect = null;
let _overview = null;
let _refreshing = false;

// Filters survive repaints and data reloads.
const _f = {
  openSprint: 'latest', openArea: 'all', openSearch: '',
  resSprint: 'selected', resArea: 'all', resSearch: '',
};

let _wiredRoot = null;
let _wiredActions = null;
let _handlers = null;

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/prod-bugs') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _sprints() { return (_overview && _overview.sprints) || []; }
function _selected() { return selectSprint(_sprints(), _f.openSprint); }

// ── Header action slot ─────────────────────────────────────────────────────

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  const ok = !!_overview && _overview.storage === 'ok';
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-pb-refresh'
    + (ok && !_refreshing ? '' : ' disabled')
    + (_refreshing ? ' aria-busy="true"' : '') + '>Refresh from Jira</button>';
}

// ── Selects ────────────────────────────────────────────────────────────────

function _enhance(scope) {
  if (!_dsSelect || typeof _dsSelect.initSelect !== 'function') return;
  scope.querySelectorAll('select.ds-input').forEach((sel) => {
    try { _dsSelect.initSelect(sel); } catch { /* the bare select still works */ }
  });
}

function _areaOptions(current) {
  return '<option value="all">All products</option>'
    + AREA_CONFIG.map((c) => '<option value="' + c.key + '"' + (current === c.key ? ' selected' : '') + '>' + _esc(c.label) + '</option>').join('');
}

// ── Sections ───────────────────────────────────────────────────────────────

function _cardsHtml() {
  const data = _selected();
  return '<div class="prod-bugs-cards">' + AREA_CONFIG.map((cfg) => {
    const a = (data && data.areas && data.areas[cfg.key]) || {};
    const bugs = a.bugs || 0;
    return '<div class="ds-card"><div class="ds-card-body">'
      + '<div class="prod-bugs-area-label">' + _esc(cfg.label) + '</div>'
      + '<div class="ds-stat-value ds-stat-value--' + bugTone(bugs) + ' prod-bugs-bug-count">' + bugs + '</div>'
      + '<div class="ds-stat-label">open bugs</div>'
      + '<div class="prod-bugs-metric-sub">Average fix time: ' + _esc(fmtDays(a.bugFixTime)) + '</div>'
      + '<div class="prod-bugs-metric-sub">Resolved: ' + (a.resolvedCount || 0) + ' &middot; Created: ' + (a.createdCount || 0) + '</div>'
      + '</div></div>';
  }).join('') + '</div>';
}

function _chartPanel(sprints, metric, title, fmtY, id) {
  const legend = AREA_CONFIG.map((cfg) =>
    '<span class="prod-bugs-legend-item"><span class="prod-bugs-swatch" style="background:' + cfg.color + '"></span>' + _esc(cfg.label) + '</span>').join('');
  return '<div class="ds-card"><div class="ds-card-body" data-pb-chart="' + id + '">'
    + '<div class="ds-section-head"><h3 class="ds-section-head-title">' + _esc(title) + '</h3></div>'
    + '<div class="prod-bugs-legend">' + legend + '</div>'
    + '<div class="prod-bugs-chart-scroll">' + buildBarSvg(sprints, metric, fmtY, AREA_CONFIG) + '</div>'
    + '</div></div>';
}

const _fmtCount = (v) => String(Math.round(v));
const CHARTS = { bugs: { metric: 'bugs', fmt: _fmtCount }, fix: { metric: 'bugFixTime', fmt: fmtDays } };

function _chartsHtml() {
  const sprints = sortSprints(_sprints());
  return '<div class="prod-bugs-charts">'
    + _chartPanel(sprints, 'bugs', 'Open bugs per sprint', _fmtCount, 'bugs')
    + _chartPanel(sprints, 'bugFixTime', 'Average fix time (days)', fmtDays, 'fix')
    + '</div>';
}

function _bugRow(b, withResolved) {
  const jira = _overview && _overview.jira_url;
  const key = jira && /^https?:\/\//.test(jira)
    ? '<a class="ds-link" href="' + _esc(jira + '/browse/' + encodeURIComponent(b.key)) + '" target="_blank" rel="noopener noreferrer" aria-label="Open in Jira: ' + _esc(b.key) + '">' + _esc(b.key) + '</a>'
    : _esc(b.key);
  const summary = b.summary || '';
  const cat = statusCategory(b);
  let cells = '<td class="prod-bugs-key-cell">' + key + '</td>'
    + '<td class="prod-bugs-summary-cell" title="' + _esc(summary) + '" aria-label="' + _esc(summary) + '">' + _esc(summary) + '</td>'
    + '<td>' + _esc(b.areaLabel) + '</td>'
    + '<td>' + _esc(b.priority || '—') + '</td>'
    + '<td><span class="ds-badge ds-badge--sm ' + statusBadgeClass(cat) + '">' + _esc(b.status || b.bucket) + '</span></td>'
    + '<td>' + _esc(fmtDate(b.created)) + '</td>';
  if (withResolved) {
    const fix = typeof b.fixDays === 'number' ? b.fixDays + ' days' : '—';
    cells += '<td>' + _esc(fmtDate(b.resolved)) + '</td><td>' + _esc(fix) + '</td>';
  }
  return '<tr>' + cells + '</tr>';
}

function _openList() { return collectBugs(_selected(), 'open'); }

function _resolvedList() {
  const sprints = _sprints();
  if (_f.resSprint === 'all') return collectResolvedAllSprints(sprints);
  if (_f.resSprint === 'selected') return collectBugs(_selected(), 'resolved');
  const sp = sortSprints(sprints).find((s) => s.sprint === parseInt(_f.resSprint, 10));
  return sp ? collectBugs(sp, 'resolved') : [];
}

// Body + counter only: the search box keeps focus and cursor while typing.
function _paintOpenBody() {
  const body = document.querySelector('[data-pb-body="open"]');
  const count = document.querySelector('[data-pb-count="open"]');
  if (!body) return;
  const all = _openList();
  const list = applyFilters(all, _f.openArea, _f.openSearch);
  body.innerHTML = list.length ? list.map((b) => _bugRow(b, false)).join('')
    : '<tr><td colspan="6" class="prod-bugs-empty-cell">No open bugs</td></tr>';
  if (count) count.textContent = list.length + ' of ' + all.length;
}

function _paintResolvedBody() {
  const body = document.querySelector('[data-pb-body="res"]');
  const count = document.querySelector('[data-pb-count="res"]');
  if (!body) return;
  const all = _resolvedList();
  const list = applyFilters(all, _f.resArea, _f.resSearch);
  body.innerHTML = list.length ? list.map((b) => _bugRow(b, true)).join('')
    : '<tr><td colspan="8" class="prod-bugs-empty-cell">No resolved bugs</td></tr>';
  if (count) count.textContent = list.length + ' of ' + all.length;
}

function _toolbar(kind, sprintOpts, areaVal, searchVal, sprintLabel) {
  return '<div class="prod-bugs-toolbar">'
    + '<select class="ds-input prod-bugs-filter" data-pb="' + kind + '-sprint" aria-label="' + sprintLabel + '">' + sprintOpts + '</select>'
    + '<select class="ds-input prod-bugs-filter" data-pb="' + kind + '-area" aria-label="Product">' + _areaOptions(areaVal) + '</select>'
    + '<input type="search" class="ds-input prod-bugs-search" data-pb="' + kind + '-search" placeholder="Search (key, summary, status...)" aria-label="Search" value="' + _esc(searchVal) + '">'
    + '<span class="prod-bugs-count" data-pb-count="' + kind + '"></span>'
    + '</div>';
}

function _openSectionHtml() {
  const sel = _selected();
  const sorted = sortSprints(_sprints());
  const latest = sorted[sorted.length - 1];
  const opts = '<option value="latest"' + (_f.openSprint === 'latest' ? ' selected' : '') + '>Latest (Sprint ' + latest.sprint + ')</option>'
    + sorted.slice().reverse().map((s) =>
      '<option value="' + s.sprint + '"' + (_f.openSprint === String(s.sprint) ? ' selected' : '') + '>Sprint ' + s.sprint
      + (s.dateRangeDisplay ? ' (' + _esc(s.dateRangeDisplay) + ')' : '') + '</option>').join('');
  return '<div data-pb-section="open">'
    + '<div class="ds-section-head"><h3 class="ds-section-head-title">Open bugs — Sprint ' + sel.sprint + '</h3></div>'
    + _toolbar('open', opts, _f.openArea, _f.openSearch, 'Sprint')
    + '<div class="prod-bugs-table-wrap"><table class="ds-table"><thead><tr>'
    + '<th>Key</th><th>Summary</th><th>Product</th><th>Priority</th><th>Status</th><th>Created</th>'
    + '</tr></thead><tbody data-pb-body="open"></tbody></table></div></div>';
}

function _resolvedSectionHtml() {
  const sel = _selected();
  const sorted = sortSprints(_sprints());
  const opts = '<option value="selected"' + (_f.resSprint === 'selected' ? ' selected' : '') + '>Sprint ' + sel.sprint + '</option>'
    + '<option value="all"' + (_f.resSprint === 'all' ? ' selected' : '') + '>All sprints</option>'
    + sorted.slice().reverse().filter((s) => s.sprint !== sel.sprint).map((s) =>
      '<option value="' + s.sprint + '"' + (_f.resSprint === String(s.sprint) ? ' selected' : '') + '>Sprint ' + s.sprint + '</option>').join('');
  return '<div data-pb-section="res">'
    + '<div class="ds-section-head"><h3 class="ds-section-head-title">Resolved bugs</h3></div>'
    + _toolbar('res', opts, _f.resArea, _f.resSearch, 'Sprint')
    + '<div class="prod-bugs-table-wrap"><table class="ds-table"><thead><tr>'
    + '<th>Key</th><th>Summary</th><th>Product</th><th>Priority</th><th>Status</th><th>Created</th><th>Resolved</th><th>Fix time</th>'
    + '</tr></thead><tbody data-pb-body="res"></tbody></table></div></div>';
}

function _paintOpenSection() {
  const el = document.querySelector('[data-pb-section="open"]');
  if (!el) return;
  el.outerHTML = _openSectionHtml();
  const fresh = document.querySelector('[data-pb-section="open"]');
  if (fresh) _enhance(fresh);
  _paintOpenBody();
}

function _paintResolvedSection() {
  const el = document.querySelector('[data-pb-section="res"]');
  if (!el) return;
  el.outerHTML = _resolvedSectionHtml();
  const fresh = document.querySelector('[data-pb-section="res"]');
  if (fresh) _enhance(fresh);
  _paintResolvedBody();
}

function _paintCards() {
  const el = document.querySelector('[data-pb-slot="cards"]');
  if (el) el.innerHTML = _cardsHtml();
}

// ── States ─────────────────────────────────────────────────────────────────

function _errorHtml() {
  return '<div class="ds-callout ds-callout--danger"><div>Could not load the production bugs data. Check the connection and try again.</div></div>';
}

function _unavailableHtml() {
  return '<div class="ds-callout ds-callout--warning"><div>The team data source is not fetched - fetch it in the Sync window.</div></div>';
}

function _emptyHtml() {
  return '<div class="ds-empty">'
    + '<div class="ds-empty-title">No production bugs data</div>'
    + '<div class="ds-empty-desc">Click "Refresh from Jira" to fetch the data per sprint.</div></div>';
}

// ── Wiring ─────────────────────────────────────────────────────────────────

function _tooltip(root) { return root.querySelector('.prod-bugs-tooltip'); }

function _positionTooltip(tip, e) {
  const GAP = 14;
  let left = e.clientX + GAP;
  let top = e.clientY - tip.offsetHeight / 2;
  if (left + tip.offsetWidth > window.innerWidth - 8) left = e.clientX - tip.offsetWidth - GAP;
  if (top < 8) top = 8;
  if (top + tip.offsetHeight > window.innerHeight - 8) top = window.innerHeight - tip.offsetHeight - 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function _showTip(root, zone, e) {
  const tip = _tooltip(root);
  const panel = zone.closest('[data-pb-chart]');
  const cfg = panel && CHARTS[panel.getAttribute('data-pb-chart')];
  const s = sortSprints(_sprints())[parseInt(zone.getAttribute('data-hover-idx'), 10)];
  if (!tip || !cfg || !s) return;
  const rows = AREA_CONFIG.map((a) => {
    const area = s.areas && s.areas[a.key];
    const v = area && typeof area[cfg.metric] === 'number' ? area[cfg.metric] : null;
    return '<div class="prod-bugs-tip-row"><span class="prod-bugs-swatch" style="background:' + a.color + '"></span>'
      + _esc(a.label) + '<strong>' + _esc(v === null ? '—' : cfg.fmt(v)) + '</strong></div>';
  }).join('');
  tip.innerHTML = '<div class="prod-bugs-tip-header">Sprint ' + _esc(s.sprint) + '</div>' + rows
    + '<div class="prod-bugs-tip-footer">' + _esc(s.dateRangeDisplay || '') + '</div>';
  tip.classList.add('is-visible');
  _positionTooltip(tip, e);
}

function _unwire() {
  if (_handlers) {
    if (_wiredRoot) {
      _wiredRoot.removeEventListener('change', _handlers.change);
      _wiredRoot.removeEventListener('input', _handlers.input);
      _wiredRoot.removeEventListener('mouseover', _handlers.over);
      _wiredRoot.removeEventListener('mousemove', _handlers.move);
      _wiredRoot.removeEventListener('mouseout', _handlers.out);
    }
    if (_wiredActions) _wiredActions.removeEventListener('click', _handlers.click);
  }
  if (_wiredRoot) { const tip = _tooltip(_wiredRoot); if (tip) tip.remove(); }
  _wiredRoot = null;
  _wiredActions = null;
  _handlers = null;
}

function _wire(root, actions) {
  if (_wiredRoot === root && _wiredActions === actions && _handlers) return;
  _unwire();
  _handlers = {
    change(e) {
      const pb = e.target && e.target.getAttribute && e.target.getAttribute('data-pb');
      if (!pb) return;
      const v = e.target.value;
      if (pb === 'open-sprint') {
        _f.openSprint = v;
        _paintCards();
        _paintOpenSection();
        _paintResolvedSection();
      } else if (pb === 'open-area') { _f.openArea = v; _paintOpenBody(); }
      else if (pb === 'res-sprint') { _f.resSprint = v; _paintResolvedBody(); }
      else if (pb === 'res-area') { _f.resArea = v; _paintResolvedBody(); }
    },
    input(e) {
      const pb = e.target && e.target.getAttribute && e.target.getAttribute('data-pb');
      if (pb === 'open-search') { _f.openSearch = e.target.value; _paintOpenBody(); }
      else if (pb === 'res-search') { _f.resSearch = e.target.value; _paintResolvedBody(); }
    },
    over(e) {
      const zone = e.target.closest && e.target.closest('.prod-bugs-hover-zone');
      if (zone) _showTip(root, zone, e);
    },
    move(e) {
      const zone = e.target.closest && e.target.closest('.prod-bugs-hover-zone');
      const tip = _tooltip(root);
      if (!zone || !tip) return;
      if (!tip.classList.contains('is-visible')) _showTip(root, zone, e);
      else _positionTooltip(tip, e);
    },
    out(e) {
      const zone = e.target.closest && e.target.closest('.prod-bugs-hover-zone');
      const tip = _tooltip(root);
      if (zone && tip) tip.classList.remove('is-visible');
    },
    click(e) {
      if (e.target.closest('[data-pb-refresh]')) _openRefresh();
    },
  };
  root.addEventListener('change', _handlers.change);
  root.addEventListener('input', _handlers.input);
  root.addEventListener('mouseover', _handlers.over);
  root.addEventListener('mousemove', _handlers.move);
  root.addEventListener('mouseout', _handlers.out);
  if (actions) actions.addEventListener('click', _handlers.click);
  _wiredRoot = root;
  _wiredActions = actions;
  // The registry is wiped on every exit from the view; register where the
  // listeners are created, so the next render() re-wires exactly once.
  _deps.registerViewCleanup(_unwire);
}

// ── Refresh ────────────────────────────────────────────────────────────────

// The refresh stream writes prod-bugs/prod-bugs-sprint-* (and one manifest key)
// in the team data source. Announced on the core's data bus (same as
// modules/sprint-stats), the core repaints the module sync bar and calls
// onDataChanged() below. Returns false when the bus could not be reached;
// the caller then re-renders by itself. Dynamic import keeps this file
// Node-importable.
async function _announceDataWrite() {
  try {
    const ev = await import('/js/data-events.js');
    ev.emitDataChanged({ source: 'prod-bugs' });
    return true;
  } catch {
    return false;
  }
}

async function _openRefresh() {
  if (_refreshing || !_overview) return;
  _refreshing = true;
  _paintActions();
  try {
    await openRefreshModal({
      apiBase: _deps.apiBase,
      overview: _overview,
      dsModal: _dsModal,
      registerViewCleanup: _deps.registerViewCleanup,
      onDone: async () => {
        if (!(await _announceDataWrite())) await _render(true);
        _toast('success', 'Production bugs updated', '');
      },
    });
  } finally {
    _refreshing = false;
    _paintActions();
  }
}

// ── Render ─────────────────────────────────────────────────────────────────

async function _loadOverview() {
  const res = await fetch(_api('/overview'));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function _render(force) {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.classList.add('prod-bugs-root');
  const actions = document.getElementById(ACTIONS_ID);
  if (force || !_overview) {
    try {
      _overview = await _loadOverview();
    } catch {
      _overview = null;
      _paintActions();
      root.innerHTML = _errorHtml();
      _toast('danger', 'Production bugs', 'Could not load the data.');
      return;
    }
  }
  _paintActions();
  const o = _overview;

  if (o.storage !== 'ok') {
    root.innerHTML = _unavailableHtml();
    _wire(root, actions);
    return;
  }
  if (!_sprints().length) {
    root.innerHTML = _emptyHtml();
    _wire(root, actions);
    return;
  }

  // A sprint that vanished falls back to the latest one.
  const known = (n) => _sprints().some((s) => String(s.sprint) === String(n));
  if (_f.openSprint !== 'latest' && !known(_f.openSprint)) _f.openSprint = 'latest';
  if (_f.resSprint !== 'selected' && _f.resSprint !== 'all' && !known(_f.resSprint)) _f.resSprint = 'selected';

  root.innerHTML = '<div data-pb-slot="cards">' + _cardsHtml() + '</div>'
    + _chartsHtml() + _openSectionHtml() + _resolvedSectionHtml()
    + '<div class="prod-bugs-tooltip" role="tooltip"></div>';
  _enhance(root);
  _paintOpenBody();
  _paintResolvedBody();
  const count = sortSprints(_sprints()).length;
  root.querySelectorAll('.prod-bugs-chart-scroll').forEach((el) => { el.scrollLeft = scrollLeftForLast(count); });
  _wire(root, actions);
}

export const views = {
  'prod-bugs-main': {
    /** @param {{navigate, registerViewCleanup, showToast, apiBase}} deps */
    init(deps) {
      _deps = deps;
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
      (async () => {
        try {
          _dsSelect = await import('/js/ds-select.js');
          const root = document.getElementById(ROOT_ID);
          if (root && root.querySelector('select.ds-input')) _enhance(root);
        } catch { _dsSelect = null; }
      })();
    },

    /** Called on every navigation into the view. */
    async render(_subPath, _opts) {
      await _render(true);
    },

    /** Data pulled under us - drop the cache, keep sprint and filters. */
    async onDataChanged() {
      _overview = null;
      await _render(true);
    },
  },
};
