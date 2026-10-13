// modules/roadmap/client/roadmap.js
// The "Timeline" tab: a read-only timeline of the Discovery initiatives. Same data as
// the table (GET /initiatives), no writes. Geometry lives in roadmap-helpers.js.
//
// Collapsible quarters, a month row under the quarter row, a sticky first column, a go-live milestone marker, RAG dot
// in the name cell and a legend that explains every mark.
//
// renderRoadmap(root, ctx): ctx = { initiatives, today (Date), avatar(name) -> html,
//   esc, onOpenRow(id), registerViewCleanup }. Overwrites the pane unconditionally.

import {
  buildScale, headerCells, gridLines, todayPct, toggleCollapsed, barModel, phaseCounts,
  yearOptions, localYmd, stageLabels, countLoggedPersons, GRANULARITIES,
} from './roadmap-helpers.js';
import { INITIATIVE_STAGES } from './helpers.js';

const RAG_LABELS = { green: 'Green', amber: 'Amber', red: 'Red' };

const _state = { year: null, gran: 'quarters', collapsed: [] };
let _ctx = null;

function _pct(n) { return n.toFixed(3) + '%'; }

function _tooltip(init, bar) {
  const lines = [init.title || ''];
  lines.push('Start: ' + (bar.start || '-') + ' → discovery end: ' + (bar.discEnd || '-'));
  lines.push('Delivery end: ' + (bar.delEnd || '-') + ' · Go-Live: ' + (bar.goLiveDate || '-'));
  const stages = stageLabels(init, INITIATIVE_STAGES);
  if (stages.length) lines.push('Stages: ' + stages.join(', '));
  lines.push('People with logged time: ' + countLoggedPersons(init));
  return lines.join('\n');
}

function _toolbarHtml(list, todayStr) {
  const esc = _ctx.esc;
  const opts = yearOptions(list, Number(todayStr.slice(0, 4))).map((y) =>
    '<option value="' + y + '"' + (y === _state.year ? ' selected' : '') + '>' + y + '</option>').join('');
  const segs = [{ k: 'quarters', l: 'Quarters' }, { k: 'months', l: 'Months' }].map((s) =>
    '<button type="button" class="ds-segment' + (_state.gran === s.k ? ' active' : '') + '" data-crm-rm-gran="' + s.k + '" aria-pressed="' + (_state.gran === s.k ? 'true' : 'false') + '">' + esc(s.l) + '</button>').join('');
  const c = phaseCounts(list, todayStr);
  const stat = (n, label, cls) => '<div class="ds-card crm-rm-stat"><div class="ds-card-body"><div class="crm-rm-stat-num' + (cls ? ' ' + cls : '') + '">' + n + '</div><div class="crm-rm-stat-lbl">' + esc(label) + '</div></div></div>';
  return '<div class="crm-rm-toolbar">'
    + '<select class="ds-input crm-rm-year" data-crm-rm-year aria-label="Year">' + opts + '</select>'
    + '<div class="ds-segmented" role="group" aria-label="Timeline scale">' + segs + '</div>'
    + '<span class="crm-rm-hint">' + esc('Click a quarter header to collapse or expand it.') + '</span></div>'
    + '<div class="crm-rm-stats">'
    + stat(c.total, 'Initiatives in total')
    + stat(c.discovery, 'In discovery', 'crm-rm-stat-disc')
    + stat(c.delivery, 'In delivery', 'crm-rm-stat-del')
    + stat(c.finished, 'Finished')
    + '</div>'
    + '<div class="crm-rm-legend" aria-label="Legend">'
    + '<span class="crm-rm-sw crm-rm-sw--disc"></span><span class="crm-rm-leg-lbl">Discovery</span>'
    + '<span class="crm-rm-sw crm-rm-sw--del"></span><span class="crm-rm-leg-lbl">Delivery</span>'
    + '<span class="crm-rm-sw crm-rm-sw--go"></span><span class="crm-rm-leg-lbl">Go-Live</span>'
    + '<span class="crm-rm-sw crm-rm-sw--today"></span><span class="crm-rm-leg-lbl">Today</span>'
    + '<span class="crm-rm-dot crm-rag-dot crm-rag-dot--green"></span><span class="crm-rm-leg-lbl">RAG green</span>'
    + '<span class="crm-rm-dot crm-rag-dot crm-rag-dot--amber"></span><span class="crm-rm-leg-lbl">amber</span>'
    + '<span class="crm-rm-dot crm-rag-dot crm-rag-dot--red"></span><span class="crm-rm-leg-lbl">red</span></div>';
}

function _headerHtml(scale, todayLeft) {
  const esc = _ctx.esc;
  const q = scale.quarters.map((c) =>
    '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-rm-hcell crm-rm-hcell--q' + (c.collapsed ? ' is-collapsed' : '') + '" style="left:' + _pct(c.leftPct) + ';width:' + _pct(c.widthPct) + '" data-crm-rm-collapse="' + c.quarter + '" aria-expanded="' + (c.collapsed ? 'false' : 'true') + '" title="' + esc((c.collapsed ? 'Expand ' : 'Collapse ') + c.label) + '">'
    + esc(c.collapsed ? 'Q' + (c.quarter + 1) : c.label) + '</button>').join('');
  const monthsRow = _state.gran === 'months'
    ? '<div class="crm-rm-hrow">' + headerCells(scale, 'months').map((m) =>
      '<div class="crm-rm-hcell crm-rm-hcell--m' + (m.collapsed ? ' is-collapsed' : '') + '" style="left:' + _pct(m.leftPct) + ';width:' + _pct(m.widthPct) + '">' + esc(m.collapsed ? '' : m.label) + '</div>').join('') + '</div>'
    : '';
  const pill = todayLeft === null ? '' : '<span class="crm-rm-today-pill" style="left:' + _pct(todayLeft) + '">' + esc('Today') + '</span>';
  return '<div class="crm-rm-header"><div class="crm-rm-name-col crm-rm-name-col--head"></div>'
    + '<div class="crm-rm-track-col"><div class="crm-rm-hrow crm-rm-hrow--today">' + pill + '</div>'
    + '<div class="crm-rm-hrow">' + q + '</div>' + monthsRow + '</div></div>';
}

function _rowHtml(init, scale) {
  const esc = _ctx.esc;
  const bar = barModel(init, scale);
  const lines = gridLines(scale, _state.gran).map((l) => '<span class="crm-rm-line" style="left:' + _pct(l) + '"></span>').join('');
  let inner = '';
  if (bar.disc) inner += '<div class="crm-rm-seg crm-rm-seg--disc" style="left:' + _pct(bar.disc.left) + ';width:' + _pct(bar.disc.width) + '"></div>';
  if (bar.del) inner += '<div class="crm-rm-seg crm-rm-seg--del" style="left:' + _pct(bar.del.left) + ';width:' + _pct(bar.del.width) + '"></div>';
  if (bar.goLive) inner += '<span class="crm-rm-go" style="left:' + _pct(bar.goLive.left) + '" aria-hidden="true"></span>';
  const empty = !bar.visible && !bar.goLive ? '<span class="crm-rm-empty">' + esc('no dates or outside the year') + '</span>' : '';
  const tip = esc(_tooltip(init, bar));
  const people = [init.po, init.analyst, init.designer, init.architect].filter(Boolean).map((n) => _ctx.avatar(n)).join('');
  const rag = RAG_LABELS[init.ragStatus]
    ? '<span class="crm-rag-dot crm-rag-dot--' + init.ragStatus + ' crm-rm-rag" title="' + esc('RAG: ' + RAG_LABELS[init.ragStatus]) + '"></span>'
    : '<span class="crm-rm-rag crm-rm-rag--none"></span>';
  return '<div class="crm-rm-row" data-crm-rm-row="' + esc(init.id) + '" role="button" tabindex="0" title="' + esc('Show in the table: ' + (init.title || '')) + '">'
    + '<div class="crm-rm-name-col">' + rag + '<span class="crm-rm-name">' + esc(init.title || '') + '</span><span class="crm-rm-people">' + people + '</span></div>'
    + '<div class="crm-rm-track-col"><div class="crm-rm-track" title="' + tip + '">' + lines + inner + empty + '</div></div></div>';
}

function _gridHtml(list, scale, todayLeft) {
  const rows = list.map((i) => _rowHtml(i, scale)).join('');
  const today = todayLeft === null ? '' : '<div class="crm-rm-today" style="left:' + _pct(todayLeft) + '"></div>';
  return '<div class="crm-rm-scroll"><div class="crm-rm-grid crm-rm-grid--' + _state.gran + '">'
    + _headerHtml(scale, todayLeft) + '<div class="crm-rm-rows">' + rows + '</div>'
    + '<div class="crm-rm-overlay" aria-hidden="true">' + today + '</div></div></div>';
}

function _paint(root) {
  const keep = root.querySelector('.crm-rm-scroll');
  const scrollLeft = keep ? keep.scrollLeft : 0;
  const list = _ctx.initiatives;
  if (!list.length) {
    root.innerHTML = '<div class="ds-callout ds-callout--info"><div>' + _ctx.esc('No initiatives to show on the timeline. Sync the data with Jira or pull the team data source in the Sync window.') + '</div></div>';
    return;
  }
  const todayStr = localYmd(_ctx.today);
  if (_state.year === null) _state.year = Number(todayStr.slice(0, 4));
  const scale = buildScale(_state.year, _state.collapsed);
  root.innerHTML = _toolbarHtml(list, todayStr) + _gridHtml(list, scale, todayPct(scale, todayStr));
  const sc = root.querySelector('.crm-rm-scroll');
  if (sc && scrollLeft) sc.scrollLeft = scrollLeft;
}

function _wire(root) {
  if (root.dataset.crmRmWired === '1') return;
  root.dataset.crmRmWired = '1';
  const onClick = (e) => {
    const t = e.target;
    const gran = t.closest('[data-crm-rm-gran]');
    if (gran) {
      const g = gran.getAttribute('data-crm-rm-gran');
      if (GRANULARITIES.includes(g)) { _state.gran = g; _paint(root); }
      return;
    }
    const col = t.closest('[data-crm-rm-collapse]');
    if (col) {
      _state.collapsed = toggleCollapsed(_state.collapsed, Number(col.getAttribute('data-crm-rm-collapse')));
      _paint(root);
      return;
    }
    if (t.closest('a')) return;
    const row = t.closest('[data-crm-rm-row]');
    if (row && typeof _ctx.onOpenRow === 'function') _ctx.onOpenRow(row.getAttribute('data-crm-rm-row'));
  };
  const onChange = (e) => {
    const sel = e.target.closest('[data-crm-rm-year]');
    if (!sel) return;
    _state.year = Number(sel.value) || _state.year;
    _paint(root);
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest && e.target.closest('[data-crm-rm-row]');
    if (!row || e.target !== row) return;
    e.preventDefault();
    if (typeof _ctx.onOpenRow === 'function') _ctx.onOpenRow(row.getAttribute('data-crm-rm-row'));
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKey);
  if (typeof _ctx.registerViewCleanup === 'function') {
    _ctx.registerViewCleanup(() => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('keydown', onKey);
      delete root.dataset.crmRmWired;
    });
  }
}

export function renderRoadmap(root, ctx) {
  if (!root) return;
  _ctx = ctx;
  _wire(root);
  _paint(root);
}
