// modules/sprint-stats/client/index.js
// Sprint Stats view: commitment vs delivery per team and per person for
// Atlas, Borealis, Comet (MAIN, story points) and Delta (PLATFORM, man-days).
// Reads this module's own sprint-stats/ store, built on DS classes/tokens.
//
// Entry budget: GET overview, then ONE GET sprint?main=N&platform=M for the
// active offset - both index-derived sections (tabs, date/goal card, tile
// bar, phase badge, team table, trend chart) paint from `overview.index`
// alone; the shard fetched alongside is what lets the burndown chart, the
// expanded issue subtable and the "Per person" modal work without a THIRD
// request on first paint. GET discover always runs AFTER the first paint
// (a banner, never a blocker). Changing tabs costs exactly one shard fetch
// (0 when already cached) - see _fetchShardsFor.
//
// Cache lives ONLY here (module-scope state below), never in
// sprint-model.mjs or sprint-charts.mjs (both DOM-free and stateless) - see
// modules-template/README.md "Refreshing after a data sync": a data
// pull re-imports THIS file fresh, so any cache in a sibling file would
// survive a pull with stale data. onDataChanged() below drops the cache and
// repaints, keeping the selected tab (never resets to "Active").

import * as SM from './sprint-model.mjs';
import * as SC from './sprint-charts.mjs';
import { openRefreshModal } from './refresh-modal.js';

const ROOT_ID = 'sprint-stats-main-root';
const ACTIONS_ID = 'sprint-stats-main-actions';
const BANNER_ID = 'sprint-stats-banner';
const PANEL_ID = 'sprint-stats-panel';

function _jiraBase() {
  return (_overview && _overview.jira_url) || 'https://jira.example.com';
}

const EXTERNAL_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

let _deps = null;
let _dsModal = null; // '/js/ds-modal.js' namespace once loaded, else null

let _overview = null; // last GET /overview answer
let _shards = new Map(); // 'main:16' -> full shard | null (missing on disk)
let _discover = null; // last GET /discover answer, loaded AFTER first paint
let _page = 'sprints'; // 'sprints' | 'spillover' (from the sub-path)
let _spillover = null; // last GET /spillover answer
let _spilloverFilter = 'all'; // 'all' or a team name
let _selectedOffset = 0;
let _expandedTeams = new Set(); // team KEYS (shard teams[].team) with an open issue subtable
let _chartWindowOffset = 0; // trend chart's 8-sprint window
let _burndownExpanded = false; // "Previous sprints" shown (4 sprints) or only the active one
let _refreshing = false;
let _actionsWired = false;
let _rootWired = false;
let _openModalOverlay = null; // the currently open "Per person" modal, if any

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/sprint-stats') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _root() {
  return document.getElementById(ROOT_ID);
}

function _slug(v) {
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function _shardKey(src, n) {
  return src + ':' + n;
}

/**
 * Fetches whichever (src, sprint_n) shards `teams` need at `offset` and are
 * not already cached, in ONE request when possible - `GET
 * /sprint?main=N&platform=M` answers both sources at once.
 */
async function _fetchShardsFor(offset, teams) {
  const need = {};
  teams.forEach((team) => {
    const sp = SM.getSprintAtOffset(team, offset);
    if (sp) need[sp._src] = sp.sprint_n;
  });
  const toFetch = Object.entries(need).filter(([src, n]) => !_shards.has(_shardKey(src, n)));
  if (!toFetch.length) return;
  const query = toFetch.map(([src, n]) => src + '=' + n).join('&');
  try {
    const res = await fetch(_api('/sprint?' + query));
    const data = await res.json();
    toFetch.forEach(([src, n]) => _shards.set(_shardKey(src, n), (data && data[src]) || null));
  } catch {
    toFetch.forEach(([src, n]) => _shards.set(_shardKey(src, n), null));
  }
}

async function _fetchOneShard(src, n) {
  try {
    const res = await fetch(_api('/sprint?' + src + '=' + n));
    const data = await res.json();
    _shards.set(_shardKey(src, n), (data && data[src]) || null);
  } catch {
    _shards.set(_shardKey(src, n), null);
  }
}

// ── Header action slot ─────────────────────────────────────────────────────

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-ss-refresh'
    + (_refreshing ? ' aria-busy="true"' : '') + '>Refresh</button>';

  if (_actionsWired) return;
  _actionsWired = true;
  const onClick = async (e) => {
    if (e.target.closest('[data-ss-refresh]')) await _openRefresh();
  };
  actions.addEventListener('click', onClick);
  _deps.registerViewCleanup(() => {
    actions.removeEventListener('click', onClick);
    _actionsWired = false;
  });
}

// The refresh stream writes sprint-stats/ in the team data. Announced on the core's data bus, the core repaints the
// module sync bar (local date, pending files) and calls onDataChanged()
// below - the same cache drop + re-render the callers used to do by hand.
// Returns false when the bus could not be reached; the caller then
// re-renders by itself. Dynamic import keeps this file Node-importable.
async function _announceDataWrite() {
  try {
    const ev = await import('/js/data-events.js');
    ev.emitDataChanged({ source: 'sprint-stats' });
    return true;
  } catch {
    return false;
  }
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
      onDone: async () => {
        if (!(await _announceDataWrite())) {
          _shards.clear();
          _discover = null;
          _overview = null;
          _spillover = null;
          await _render();
        }
        _toast('success', 'Sprint Stats updated', '');
      },
    });
  } finally {
    _refreshing = false;
    _paintActions();
  }
}

// ── Empty / unavailable states ─────────────────────────────────────────────

function _skeletonHtml() {
  return '<div class="sprint-stats-skeleton" data-skel="1">'
    + '<span class="ds-skeleton" style="width:280px;height:36px;display:block;margin-bottom:16px"></span>'
    + '<span class="ds-skeleton" style="width:100%;height:120px;display:block;margin-bottom:16px"></span>'
    + '<span class="ds-skeleton" style="width:100%;height:200px;display:block"></span>'
    + '</div>';
}

function _errorHtml() {
  return '<div class="ds-callout ds-callout--danger"><div>Could not load the Sprint Stats data. Check the connection and try again.</div></div>';
}

function _unavailableHtml() {
  return '<div class="ds-callout ds-callout--warning"><div>No team data on this computer. Fetch the "Team data" source in the Sync window.</div></div>';
}

function _emptyHtml() {
  return '<div class="ds-callout ds-callout--info"><div>No sprint statistics yet. Click "Refresh" to fetch them from Jira.</div></div>';
}

// ── Page sections (all pure string builders reading module state) ─────────

// Bare `ds-tabs-list` on purpose: the strip is a row of its own between the
// banner and the panel, directly on the page - the page-strip variant, whose
// border-bottom is the rule under the content it switches. `ds-framed-tabs`
// is for tabs INSIDE a toolbar, card or modal header. check-conventions'
// ds-tabs-variant WARN is the reminder to make this choice, not a defect.
function _tabsHtml(maxOffset, teams) {
  let html = '<nav class="ds-tabs-list sprint-stats-tabs" role="tablist" aria-label="Sprint">';
  for (let o = 0; o <= maxOffset; o++) {
    const active = o === _selectedOffset;
    const tip = SM.offsetTooltip(o, teams);
    html += '<button type="button" class="ds-tab' + (active ? ' active' : '') + '" role="tab" id="sprint-stats-tab-' + o + '"'
      + ' aria-selected="' + active + '" aria-controls="' + PANEL_ID + '" tabindex="' + (active ? '0' : '-1') + '"'
      + ' data-ss-tab="' + o + '" title="' + _esc(tip) + '" aria-label="' + _esc(SM.offsetLabel(o) + ' - ' + tip) + '">' + _esc(SM.offsetLabel(o)) + '</button>';
  }
  html += '</nav>';
  return html;
}

function _dateGoalHtml(teams) {
  if (!teams.length) return '';
  let dateLine = '';
  for (const team of teams) {
    const sp = SM.getSprintAtOffset(team, _selectedOffset);
    const t = sp && sp.teamData;
    if (t && (t.start || t.end)) { dateLine = SM.fmtDayDate(t.start) + ' &rarr; ' + SM.fmtDayDate(t.end); break; }
  }
  const boards = (_overview.index && _overview.index.boards) || {};
  const rows = teams.map((team) => {
    const sp = SM.getSprintAtOffset(team, _selectedOffset);
    const t = sp && sp.teamData;
    const goal = t && t.goal ? String(t.goal).trim() : '';
    const board = team.unit === 'SP' ? boards.main : boards.platform;
    const url = t ? SM.jiraSprintUrl({
      sprintId: t.sprint_id, boardId: board && board.board_id,
      projectKey: board && board.project, sprintName: t.sprint_name,
      jiraBase: _jiraBase(),
    }) : null;
    const teamLabelHtml = url
      ? '<a class="ds-btn ds-btn--tertiary ds-btn--sm sprint-stats-goal-team" href="' + _esc(url) + '" target="_blank" rel="noopener noreferrer" title="Open the sprint in Jira (new tab)">' + _esc(team.name) + ' ' + EXTERNAL_ICON + '</a>'
      : '<span class="sprint-stats-goal-team-plain">' + _esc(team.name) + '</span>';
    return '<div class="sprint-stats-goal-team-cell">' + teamLabelHtml + '</div>'
      + '<div class="sprint-stats-goal-text">' + (goal ? _esc(goal) : '<span class="sprint-stats-goal-empty">No goal</span>') + '</div>';
  }).join('');
  const headLabel = _selectedOffset === 0 ? 'Active sprint' : SM.offsetLabel(_selectedOffset);
  return '<div class="ds-card sprint-stats-dates-card"><div class="ds-card-body">'
    + '<div class="sprint-stats-dates-head"><span class="sprint-stats-dates-label">' + _esc(headLabel) + '</span>'
    + (dateLine ? ('<span class="sprint-stats-dates-range">' + dateLine + '</span>') : '') + '</div>'
    + '<div class="sprint-stats-goals-title">Sprint goals</div>'
    + '<div class="sprint-stats-goals-grid">' + rows + '</div>'
    + '</div></div>';
}

function _tileBarHtml(teams) {
  // One ds-stat-row per team: the team label cell plus five equal tiles
  // filling the row, so tile 3 of Atlas sits over tile 3 of Borealis
  // (conventions section 2c).
  const rows = teams.map((team) => {
    const sp = SM.getSprintAtOffset(team, _selectedOffset);
    const t = sp && sp.teamData;
    const subject = '<div class="ds-card ds-stat-subject">' + _esc(team.name) + '</div>';
    if (!t) {
      return '<div class="ds-stat-row" style="--ds-stat-cols: 1">' + subject
        + '<div class="ds-card ds-stat"><div class="ds-stat-value">-</div><div class="ds-stat-label">No data</div></div></div>';
    }
    const cards = SM.SUMMARY_CARDS[team.unit].map((def, i) => {
      const val = def.value(t, sp.phase);
      const tone = def.tone(t, sp.phase);
      return '<div class="ds-card ds-stat' + (i === 0 ? ' ds-stat--highlight' : '') + '">'
        + '<div class="ds-stat-value' + (tone ? (' ds-stat-value--' + tone) : '') + '">' + _esc(val) + '</div>'
        + '<div class="ds-stat-label">' + _esc(def.label) + '</div></div>';
    }).join('');
    return '<div class="ds-stat-row">' + subject + cards + '</div>';
  }).join('');
  return '<div class="sprint-stats-tiles" aria-label="Sprint summary per team">' + rows + '</div>';
}

const PHASE_TONE = { START: 'blue', MID: 'yellow', END: 'green' };

function _tableHtml(teams) {
  if (!teams.length) return '<div class="ds-callout ds-callout--info"><div>No data for this sprint.</div></div>';

  let phaseLbl = '';
  let phaseTone = 'gray';
  const mainTeam = teams.find((t) => t.unit === 'SP');
  if (mainTeam) {
    const sp = SM.getSprintAtOffset(mainTeam, _selectedOffset);
    if (sp) {
      phaseLbl = SM.PHASE_LABELS[sp.phase] || sp.phase;
      phaseTone = PHASE_TONE[sp.phase] || 'gray';
    }
  }

  const rows = teams.map((team) => {
    const sp = SM.getSprintAtOffset(team, _selectedOffset);
    const t = sp && sp.teamData;
    if (!t) {
      return '<tr><td>' + _esc(team.name) + '</td><td class="right">' + _esc(team.unit) + '</td>'
        + '<td class="right">-</td><td class="right">-</td><td class="right">-</td>'
        + '<td class="right">-</td><td class="right">-</td><td class="right">-</td></tr>';
    }
    const cells = SM.TABLE_CELLS[team.unit].map((fn) => '<td class="right">' + _esc(fn(t, sp.phase)) + '</td>').join('');
    const expanded = _expandedTeams.has(team.key);
    const count = t.issues_count || 0;
    const subId = 'sprint-stats-issues-' + _slug(team.key);
    const headerRow = '<tr class="sprint-stats-team-row">'
      + '<td><button type="button" class="ds-row-toggle" data-ss-expand="' + _esc(team.key) + '" aria-expanded="' + expanded + '" aria-controls="' + subId + '">'
      + '<span class="ds-row-toggle-chevron" aria-hidden="true">&#9654;</span>'
      + '<span>' + _esc(team.name) + '</span> <span class="sprint-stats-issue-count">(' + count + ' issues)</span></button></td>'
      + '<td class="right">' + _esc(team.unit) + '</td>' + cells + '</tr>';

    let subRow = '';
    if (expanded) {
      const shard = _shards.get(sp._src + ':' + sp.sprint_n);
      const shardTeam = shard && (shard.teams || []).find((tt) => tt.team === team.key);
      const issues = shardTeam ? SM.sortIssues(shardTeam.issues) : [];
      const headers = SM.ISSUE_COLUMNS[team.unit];
      const headHtml = headers.map((h, i) => '<th' + (i === 0 ? '' : ' class="right"') + '>' + _esc(h) + '</th>').join('');
      const issueRows = issues.map((iss) => {
        const summaryFull = iss.summary || '';
        const tone = SM.issueTone(iss.status_bucket);
        // The full summary stays in the page (clamped by CSS, title for the
        // hover), so a screen reader hears the whole sentence.
        const cols = ['<td class="sprint-stats-issue-cell"><span class="sprint-stats-issue-line"><a class="ds-link" href="' + _esc(_jiraBase()) + '/browse/' + encodeURIComponent(iss.key) + '" target="_blank" rel="noopener noreferrer" aria-label="' + _esc(iss.key + ' - open in Jira (new tab)') + '">' + _esc(iss.key) + '</a>'
          + '<span class="sprint-stats-issue-summary" title="' + _esc(summaryFull) + '">' + _esc(summaryFull) + '</span></span></td>',
        '<td>' + _esc(iss.type || '') + '</td>',
        '<td>' + _esc(iss.assignee || '-') + '</td>',
        '<td class="right">' + _esc(SM.fmtEstimate(team.unit, iss.estimate)) + '</td>'];
        if (team.unit === 'MD') cols.push('<td class="right">' + _esc(SM.fmtEstimate('MD', iss.spent_h)) + '</td>');
        cols.push('<td class="right"><span class="sprint-stats-status-tone--' + tone + '">' + _esc(iss.status_label || '') + '</span></td>');
        return '<tr>' + cols.join('') + '</tr>';
      }).join('');
      subRow = '<tr class="ds-table-sub" id="' + subId + '"><td colspan="8" class="sprint-stats-sub-cell">'
        + '<table class="ds-table" aria-label="Issues: ' + _esc(team.name) + '"><thead><tr>' + headHtml + '</tr></thead><tbody>'
        + (issueRows || ('<tr><td colspan="' + headers.length + '">No issues</td></tr>'))
        + '</tbody></table></td></tr>';
    }
    return headerRow + subRow;
  }).join('');

  return '<div class="ds-section-head"><h2 class="ds-section-head-title">Summary per team</h2>'
    + (phaseLbl ? ('<div class="ds-section-head-actions"><span class="ds-badge ds-badge--' + phaseTone + '">' + _esc(phaseLbl) + '</span></div>') : '')
    + '</div>'
    + '<div class="ds-table-wrap"><table class="ds-table" aria-label="Summary per team"><thead><tr>'
    + '<th>Team</th><th class="right">Unit</th><th class="right">Committed</th><th class="right">Done</th>'
    + '<th class="right">WIP</th><th class="right">Spillover</th><th class="right">Added</th><th class="right">Completion</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function _personButtonsHtml(teams) {
  const btns = teams.map((team) => {
    const sp = SM.getSprintAtOffset(team, _selectedOffset);
    const t = sp && sp.teamData;
    if (!t || !t.persons_count) return '';
    return '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ss-person="' + _esc(team.key) + '">Per person: ' + _esc(team.name) + '</button>';
  }).filter(Boolean).join('');
  return btns ? ('<div class="ds-actions sprint-stats-person-actions">' + btns + '</div>') : '';
}

function _chartsHtml(trend, burndown) {
  const prevAttr = trend.canPrev ? '' : ' disabled';
  const nextAttr = trend.canNext ? '' : ' disabled';
  const trendHeader = '<div class="ds-section-head"><h2 class="ds-section-head-title">Sprint trend</h2>'
    + '<div class="ds-section-head-actions">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ss-trend-prev' + prevAttr + ' aria-label="Earlier sprints">&#9664;</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ss-trend-next' + nextAttr + ' aria-label="Later sprints">&#9654;</button>'
    + '</div></div>';
  const trendSection = trend.html ? ('<section class="sprint-stats-trend-section" aria-label="Sprint trend">' + trendHeader + trend.html + '</section>') : '';
  const burndownSection = burndown.html
    ? ('<section class="sprint-stats-burndown-section" aria-label="Burndown charts"><div class="ds-section-head"><h2 class="ds-section-head-title">Burndown charts</h2>'
       + '<div class="ds-section-head-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ss-burndown-more aria-expanded="' + _burndownExpanded + '">'
       + (_burndownExpanded ? 'Hide previous sprints' : 'Show previous sprints') + '</button></div></div>' + burndown.html + '</section>')
    : '';
  return trendSection + burndownSection;
}

// ── Page switch and the Spillover page ─────────────────────────────────────────

function _pageSwitchHtml() {
  const btn = (id, label) => '<button type="button" class="ds-segment' + (_page === id ? ' active' : '') + '" data-ss-page="' + id + '" aria-pressed="' + (_page === id) + '">' + label + '</button>';
  return '<div class="ds-segmented sprint-stats-page-switch" role="group" aria-label="Page">'
    + btn('sprints', 'Sprints') + btn('spillover', 'Spillover') + '</div>';
}

function _fmtPct(v) {
  return (Math.round(Number(v) * 10) / 10).toFixed(1) + '%';
}

function _spilloverMetaHtml(agg) {
  const n = agg.sprints.length;
  const range = n ? ' (' + agg.sprints[0].label + '-' + agg.sprints[n - 1].label + ')' : '';
  const date = agg.generated_at ? ' · Jira data from: ' + SM.fmtDayDate(agg.generated_at) : '';
  return '<div class="sprint-stats-meta">' + _esc('Closed MAIN sprints: ' + n + range + date) + '</div>';
}

function _spilloverFileCalloutHtml(file) {
  if (file && file.present && file.current) return '';
  return '<div class="ds-callout ds-callout--warning"><div>'
    + 'The exported spillover.json is out of date - recalculate it and send it with the team data.'
    + '</div><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ss-spillover-recompute>Recalculate the file</button></div>';
}

function _spilloverTilesHtml(agg) {
  const rows = agg.team_names.map((name) => {
    const t = agg.teams[name];
    if (!t) return '';
    const pctTone = t.avg_spillover_pct > 20 ? 'danger' : 'success';
    return '<div class="ds-stat-row" style="--ds-stat-cols: 4"><div class="ds-card ds-stat-subject">' + _esc(name) + '</div>'
      + '<div class="ds-card ds-stat"><div class="ds-stat-value">' + _esc(t.avg_committed_sp) + '</div><div class="ds-stat-label">Avg committed</div></div>'
      + '<div class="ds-card ds-stat"><div class="ds-stat-value">' + _esc(t.avg_spillover_full) + '</div><div class="ds-stat-label">Avg spillover</div></div>'
      + '<div class="ds-card ds-stat"><div class="ds-stat-value ds-stat-value--' + pctTone + '">' + _fmtPct(t.avg_spillover_pct) + '</div><div class="ds-stat-label">Avg spillover %</div></div>'
      + '<div class="ds-card ds-stat"><div class="ds-stat-value">' + _esc(t.worst_sprint_label || '-') + '</div><div class="ds-stat-label">Worst sprint: ' + _fmtPct(t.worst_spillover_pct) + '</div></div>'
      + '</div>';
  }).join('');
  return '<div class="sprint-stats-tiles" aria-label="Spillover per team">' + rows + '</div>';
}

function _spilloverFilterHtml(agg) {
  const opt = (key, label) => '<button type="button" class="ds-segment' + (_spilloverFilter === key ? ' active' : '') + '" data-ss-spillover-team="' + _esc(key) + '" aria-pressed="' + (_spilloverFilter === key) + '">' + _esc(label) + '</button>';
  return '<div class="ds-segmented" role="group" aria-label="Team">' + opt('all', 'All') + agg.team_names.map((n) => opt(n, n)).join('') + '</div>';
}

function _spilloverTableHtml(agg) {
  const source = _spilloverFilter === 'all' ? agg.sprints : ((agg.teams[_spilloverFilter] || {}).sprints || []);
  const rows = [...source].reverse().map((r) => {
    const danger = r.spillover_pct > 20;
    return '<tr><td>' + _esc(r.label) + '</td><td>' + _esc(r.period) + '</td>'
      + '<td class="right">' + _esc(r.committed_sp) + '</td><td class="right">' + _esc(r.done_sp) + '</td><td class="right">' + _esc(r.spillover_full) + '</td>'
      + '<td class="right"><span class="ds-badge ds-badge--' + (danger ? 'danger' : 'success') + '">' + _fmtPct(r.spillover_pct) + '</span></td>'
      + '<td class="right">' + _fmtPct(r.completion_pct) + '</td></tr>';
  }).join('');
  return '<div class="ds-section-head"><h2 class="ds-section-head-title">Spillover by sprint</h2></div>'
    + '<div class="ds-table-wrap sprint-stats-spillover-table"><table class="ds-table" aria-label="Spillover by sprint"><thead><tr>'
    + '<th>Sprint</th><th>Period</th><th class="right">Committed</th><th class="right">Done</th><th class="right">Spillover</th><th class="right">Spillover %</th><th class="right">Completion</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function _spilloverBodyHtml() {
  const agg = _spillover.aggregate;
  if (_spilloverFilter !== 'all' && !agg.team_names.includes(_spilloverFilter)) _spilloverFilter = 'all';
  return _spilloverMetaHtml(agg)
    + _spilloverFileCalloutHtml(_spillover.file)
    + _spilloverTilesHtml(agg)
    + '<div class="ds-section-head sprint-stats-spillover-head"><h2 class="ds-section-head-title">Spillover percentage by sprint</h2>'
    + '<div class="ds-section-head-actions">' + _spilloverFilterHtml(agg) + '</div></div>'
    + SC.buildSpilloverChart(agg, _spilloverFilter)
    + _spilloverTableHtml(agg);
}

function _paintSpillover(root) {
  if (!root || !_spillover) return;
  if (_spillover.storage === 'unavailable' || !_spillover.aggregate) {
    root.innerHTML = _pageSwitchHtml() + _unavailableHtml();
    return;
  }
  if (!_spillover.aggregate.sprints.length) {
    root.innerHTML = _pageSwitchHtml()
      + '<div class="ds-callout ds-callout--info"><div>No closed MAIN sprints. Click "Refresh" to fetch the data from Jira.</div></div>';
    return;
  }
  root.innerHTML = _pageSwitchHtml() + _spilloverBodyHtml();
}

async function _renderSpillover(root) {
  _paintActions();
  if (!_spillover) root.innerHTML = _pageSwitchHtml() + _skeletonHtml();
  try {
    const res = await fetch(_api('/spillover'));
    _spillover = await res.json();
  } catch {
    _spillover = null;
    root.innerHTML = _pageSwitchHtml() + _errorHtml();
    _wireRoot(root);
    return;
  }
  _paintSpillover(root);
  _wireRoot(root);
}

async function _recomputeSpillover(btn) {
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(_api('/spillover/recompute'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (!res.ok) {
      _toast('danger', 'Could not recalculate the file', data && data.message ? data.message : '');
      return;
    }
    _toast('success', data.written ? 'spillover.json written' : 'File unchanged', '');
    _spillover = null;
    if (data.written && (await _announceDataWrite())) return;
    await _render();
  } catch (e) {
    _toast('danger', 'Recalculation failed', e && e.message ? e.message : String(e));
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

// ── Full repaint from state (tabs, expand, chart window all live here) ────

function _renderAll(root) {
  if (!root || !_overview) return;
  const teams = SM.buildTeamsModel(_overview.index);
  const maxOffset = SM.computeMaxOffset(teams);
  if (_selectedOffset > maxOffset) _selectedOffset = 0;

  const trend = SC.buildTrendSection(teams, _chartWindowOffset);
  const burndown = SC.buildBurndownSection(teams, _shards, { maxSprints: _burndownExpanded ? SC.BURNDOWN_SPRINT_COUNT : 1 });

  root.innerHTML = _pageSwitchHtml()
    + '<div class="sprint-stats-meta">' + _esc(SM.summaryLine(_overview.index)) + '</div>'
    + '<div id="' + BANNER_ID + '" class="sprint-stats-banner"></div>'
    + _tabsHtml(maxOffset, teams)
    + '<div id="' + PANEL_ID + '" class="sprint-stats-panel" role="tabpanel" aria-labelledby="sprint-stats-tab-' + _selectedOffset + '">'
    + _dateGoalHtml(teams)
    + _tileBarHtml(teams)
    + _chartsHtml(trend, burndown)
    + '<section class="sprint-stats-table-section" aria-label="Summary per team">' + _tableHtml(teams) + _personButtonsHtml(teams) + '</section>'
    + '</div>';

  if (_discover) _paintBanner(teams);
}

function _paintBanner(_teams) {
  const el = document.getElementById(BANNER_ID);
  if (!el) return;
  const banner = SM.staleBannerState(_overview.index, _discover);
  if (!banner) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="ds-callout ds-callout--warning">'
    + '<div>New active sprint on the board (' + _esc(banner.label) + '). The saved data does not include it yet.</div>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ss-refresh-now>Refresh now</button>'
    + '</div>';
}

async function _selectOffset(offset) {
  if (offset === _selectedOffset || !_overview) return;
  _selectedOffset = offset;
  _expandedTeams.clear();
  const teams = SM.buildTeamsModel(_overview.index);
  await _fetchShardsFor(offset, teams);
  _renderAll(_root());
}

function _toggleExpand(teamKey) {
  if (_expandedTeams.has(teamKey)) _expandedTeams.delete(teamKey);
  else _expandedTeams.add(teamKey);
  _renderAll(_root());
}

// Toggles the burndown between the active sprint alone and the last four.
// Expanding fetches the older shards it still lacks (once - they stay in
// the cache); collapsing is a repaint, nothing is thrown away.
async function _toggleBurndown() {
  if (!_overview) return;
  if (_burndownExpanded) {
    _burndownExpanded = false;
    _renderAll(_root());
    return;
  }
  _burndownExpanded = true;
  // The three sprints before the active one, per source - a fixed target,
  // so a second expand fetches nothing (the first version walked back from
  // the oldest cached shard and pulled three more every time).
  const teams = SM.buildTeamsModel(_overview.index);
  const wanted = { main: new Set(), platform: new Set() };
  teams.forEach((team) => {
    for (let o = 1; o < SC.BURNDOWN_SPRINT_COUNT; o++) {
      const sp = SM.getSprintAtOffset(team, o);
      if (sp) wanted[sp._src].add(sp.sprint_n);
    }
  });
  for (const src of ['main', 'platform']) {
    for (const n of [...wanted[src]].sort((a, b) => a - b)) {
      if (_shards.has(_shardKey(src, n))) continue;
      await _fetchOneShard(src, n);
    }
  }
  _renderAll(_root());
}

async function _openPersonsModal(teamKey) {
  if (!_overview) return;
  const teams = SM.buildTeamsModel(_overview.index);
  const team = teams.find((t) => t.key === teamKey);
  if (!team) return;
  const sp = SM.getSprintAtOffset(team, _selectedOffset);
  if (!sp) return;
  const shard = _shards.get(sp._src + ':' + sp.sprint_n);
  const shardTeam = shard && (shard.teams || []).find((tt) => tt.team === team.key);
  if (!shardTeam) return;

  const { headers, rows } = SM.personRows(shardTeam);
  const title = _esc(team.name) + ' - ' + _esc(sp.sprint_label) + ' per person';

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  const titleId = 'sprint-stats-persons-title';
  overlay.innerHTML = '<div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="' + titleId + '">' + title + '</span></div>'
    + '<div class="ds-modal-body"><div class="ds-table-wrap"><table class="ds-table"><thead><tr>'
    + headers.map((h, i) => '<th' + (i === 0 ? '' : ' class="right"') + '>' + _esc(h) + '</th>').join('')
    + '</tr></thead><tbody>'
    + rows.map((r) => '<tr' + (r[0] === SM.TOTAL_LABEL ? ' class="ds-table-highlight"' : '') + '>'
      + r.map((c, i) => '<td' + (i === 0 ? '' : ' class="right"') + '>' + _esc(c) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div></div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-ss-modal-close>Close</button></div>'
    + '</div>';
  document.body.appendChild(overlay);
  _openModalOverlay = overlay;

  const trigger = document.activeElement;
  const close = () => {
    if (_dsModal) _dsModal.closeDsModal(overlay);
    overlay.remove();
    if (_openModalOverlay === overlay) _openModalOverlay = null;
  };
  overlay.querySelector('[data-ss-modal-close]').addEventListener('click', close);
  if (_dsModal) _dsModal.openDsModal(overlay, { trigger });
  else overlay.hidden = false;
}

function _wireRoot(root) {
  if (_rootWired) return;
  _rootWired = true;
  const onClick = async (e) => {
    const pageBtn = e.target.closest('[data-ss-page]');
    if (pageBtn) {
      const target = pageBtn.dataset.ssPage;
      if (target !== _page && _deps && typeof _deps.navigate === 'function') {
        _deps.navigate(target === 'spillover' ? 'sprint-stats-main/spillover' : 'sprint-stats-main');
      }
      return;
    }
    const teamBtn = e.target.closest('[data-ss-spillover-team]');
    if (teamBtn) { _spilloverFilter = teamBtn.dataset.ssSpilloverTeam; _paintSpillover(_root()); return; }
    const recomputeBtn = e.target.closest('[data-ss-spillover-recompute]');
    if (recomputeBtn) { await _recomputeSpillover(recomputeBtn); return; }
    const tabBtn = e.target.closest('[data-ss-tab]');
    if (tabBtn) { await _selectOffset(Number(tabBtn.dataset.ssTab)); return; }
    const expandRow = e.target.closest('[data-ss-expand]');
    if (expandRow) { _toggleExpand(expandRow.dataset.ssExpand); return; }
    const personBtn = e.target.closest('[data-ss-person]');
    if (personBtn) { await _openPersonsModal(personBtn.dataset.ssPerson); return; }
    if (e.target.closest('[data-ss-trend-prev]')) { _chartWindowOffset += 1; _renderAll(_root()); return; }
    if (e.target.closest('[data-ss-trend-next]')) { _chartWindowOffset = Math.max(0, _chartWindowOffset - 1); _renderAll(_root()); return; }
    if (e.target.closest('[data-ss-burndown-more]')) { await _toggleBurndown(); return; }
    if (e.target.closest('[data-ss-refresh-now]')) { await _openRefresh(); }
  };
  const onKey = async (e) => {
    const tab = e.target.closest && e.target.closest('[data-ss-tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...root.querySelectorAll('[data-ss-tab]')];
    const idx = tabs.indexOf(tab);
    let next = idx;
    if (e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
    if (e.key === 'ArrowRight') next = Math.min(tabs.length - 1, idx + 1);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next === idx) return;
    e.preventDefault();
    await _selectOffset(Number(tabs[next].dataset.ssTab));
    const focusTo = root.querySelector('[data-ss-tab="' + next + '"]');
    if (focusTo) focusTo.focus();
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  _deps.registerViewCleanup(() => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    _rootWired = false;
    if (_openModalOverlay) { _openModalOverlay.remove(); _openModalOverlay = null; }
  });
}

async function _loadDiscoverAndBanner() {
  try {
    const res = await fetch(_api('/discover'));
    _discover = await res.json();
  } catch {
    _discover = null;
  }
  const el = document.getElementById(BANNER_ID);
  if (el && _overview) _paintBanner(SM.buildTeamsModel(_overview.index));
}

// ── Entry point ─────────────────────────────────────────────────────────

async function _render() {
  const root = _root();
  if (!root) return;
  if (_page === 'spillover') { await _renderSpillover(root); return; }
  _paintActions();

  if (!root.dataset.ssBooted) {
    root.innerHTML = _pageSwitchHtml() + _skeletonHtml();
  }

  let overview;
  try {
    const res = await fetch(_api('/overview'));
    overview = await res.json();
  } catch {
    root.innerHTML = _pageSwitchHtml() + _errorHtml();
    _wireRoot(root);
    return;
  }
  _overview = overview;
  root.dataset.ssBooted = '1';
  _paintActions();

  if (overview.storage === 'unavailable') {
    root.innerHTML = _pageSwitchHtml() + _unavailableHtml();
    _wireRoot(root);
    return;
  }

  const sprints = (overview.index && overview.index.sprints) || [];
  if (!sprints.length) {
    root.innerHTML = _pageSwitchHtml() + _emptyHtml();
    _wireRoot(root);
    return;
  }

  const teams = SM.buildTeamsModel(overview.index);
  const maxOffset = SM.computeMaxOffset(teams);
  if (_selectedOffset > maxOffset) _selectedOffset = 0;
  await _fetchShardsFor(_selectedOffset, teams);

  _renderAll(root);
  _wireRoot(root);

  _loadDiscoverAndBanner();
}

export const views = {
  'sprint-stats-main': {
    /** @param {{navigate, registerViewCleanup, showToast, apiBase}} deps */
    init(deps) {
      _deps = deps;
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
    },

    /** Called on every navigation into the view. */
    async render(subPath, _opts) {
      _page = subPath === 'spillover' ? 'spillover' : 'sprints';
      await _render();
    },

    /** Data pulled under us - drop the cache, keep the selected tab. */
    async onDataChanged() {
      _overview = null;
      _shards = new Map();
      _discover = null;
      _spillover = null;
      await _render();
    },
  },
};
