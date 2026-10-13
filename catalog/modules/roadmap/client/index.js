// modules/roadmap/client/index.js
// Roadmap: the Discovery initiatives table (tab "Table"). Stage 3: the table is
// edited per row (row edit mode: RAG, stages, three dates, four people, one
// combined save; drag & drop order) and "Sync with Jira" runs initiative by
// initiative in a progress modal. There is no
// preview/details panel: the title is plain text.
//
// deps (passed to init): navigate, registerViewCleanup, showToast, apiBase.
// DS classes and tokens only. /js/ imports are dynamic so the file stays
// importable in plain Node (the contract test reads it as text).

import {
  INITIATIVE_STAGES, JIRA_BASE,
  esc, sortInitiatives, timeByPersonTotals, formatMd, workingDaysLabel, isDateDone,
  filterInitiatives, collectPersons, syncErrorText,
  ragPatch, toggleStagePatch, moveInOrder, stepInOrder, moveToPosition, syncTargets, isFatalSyncError,
  draftChanges, cellChanged, buildEditPatch,
  STRIP_ROLE_FILTERS, DAY_NAMES_SHORT, buildActivityStrip, formatHours, normalizeTempo, DISCOVERY_TASKS,
  roadmapKeySet, otherWorklogsFor, formatDayTotal, normalizeWorklogs, safeJiraHref,
  VIEW_TABS, tabFromSubPath, tabHash,
} from './helpers.js';
import { renderRoadmap } from './roadmap.js';
import { renderKanban } from './kanban.js';

const VIEW_ID = 'roadmap-main';
let _tab = 'table';
let _painted = new Set(); // tabs already painted with the current data (lazy render)
let _loadedOk = false;

let _teamDir = null;
let _data = [];
let _skipped = [];
let _search = '';
let _persons = new Set();
let _today = new Date();
let _dragId = null;
let _edit = null; // { id, draft } - the ONE row in edit mode
let _saving = false;
let _reorderBusy = false;
let _rankEdit = null; // id of the row whose priority number is being typed
let _pop = null;
let _tempo = normalizeTempo(null);
let _allWork = normalizeWorklogs(null);
let _stripRole = 'all';

const SVG_TRASH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 10.5V15M14 10.5V15M4 6.5H20M17.5 17.2841C16.2036 18.9408 14.2214 20 12 20C9.77858 20 7.79639 18.9408 6.5 17.2841L6 6.5H18L17.5 17.2841ZM10 4.45505C10.4714 3.87248 11.1922 3.5 12 3.5C12.8078 3.5 13.5286 3.87248 14 4.45505V6.5L10 6.5V4.45505Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; // 24-ic-trashcan.svg

const SVG_CHEVRON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const SVG_UP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg>';
const SVG_DOWN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const SVG_GRIP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>';

const RAG = {
  green: { label: 'Green' },
  amber: { label: 'Amber' },
  red: { label: 'Red' },
};
const ROLE_NAMES = { po: 'PO', designer: 'Designer', analyst: 'Analyst', architect: 'Architect' };

// ---- People ----------------------------------------------------------------

function _canon(name) {
  if (!name) return '';
  const m = _teamDir && _teamDir.memberByName ? _teamDir.memberByName(name) : null;
  return m ? (_teamDir.fullName(m) || name) : name;
}

function _initials(name) {
  if (_teamDir && _teamDir.memberInitials) return _teamDir.memberInitials(name);
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function _avatar(name) {
  if (!name) return '';
  const url = _teamDir && _teamDir.avatarUrlForName ? _teamDir.avatarUrlForName(name) : '';
  if (url) return '<img class="crm-avatar" src="' + esc(url) + '" alt="" title="' + esc(name) + '" loading="lazy">';
  return '<span class="crm-avatar crm-avatar--initials" title="' + esc(name) + '">' + esc(_initials(name)) + '</span>';
}

/** Canonical names of the team directory, sorted; [] when it is not loaded. */
function _teamNames() {
  if (!_teamDir || !_teamDir.getTeamMembers) return [];
  const names = new Set();
  for (const m of _teamDir.getTeamMembers() || []) {
    const n = _teamDir.fullName(m);
    if (n) names.add(n);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'en'));
}

// ---- Shared fragments ------------------------------------------------------

function _calloutHtml(kind, text) {
  return '<div class="ds-callout ds-callout--' + kind + '"><div>' + esc(text) + '</div></div>';
}

function _skeletonHtml() {
  return '<div class="crm-skel" data-skel="1" aria-hidden="true">'
    + '<div class="ds-skeleton crm-skel-bar"></div>'
    + '<div class="ds-skeleton crm-skel-table"></div></div>';
}

function _ticketBadge(ticket) {
  if (!ticket) return '<span class="ds-badge ds-badge--gray">none</span>';
  return '<a class="ds-badge ds-badge--brand crm-link" href="' + esc(JIRA_BASE + ticket) + '" target="_blank" rel="noopener noreferrer">' + esc(ticket) + '</a>';
}

function _dateBlock(init, field) {
  const v = init[field];
  if (!v) return '<span class="crm-empty">-</span>';
  return esc(v) + '<div class="crm-days-left">' + esc(workingDaysLabel(v, isDateDone(init, field), _today)) + '</div>';
}

function _dndEnabled() {
  return _search === '' && _persons.size === 0;
}

// ---- Activity strip ----------------------------------------------------------

function _memberRole(name) {
  const m = _teamDir && _teamDir.memberByName ? _teamDir.memberByName(name) : null;
  return (m && m.role) || '';
}

function _stripModel() {
  return buildActivityStrip({
    initiatives: sortInitiatives(_data), tempo: _tempo, today: _today, roleFilter: _stripRole, canonical: _canon, memberRole: _memberRole,
  });
}

function _stripHtml() {
  const model = _stripModel();
  const segs = STRIP_ROLE_FILTERS.map((f) =>
    '<button type="button" class="ds-segment' + (_stripRole === f.key ? ' active' : '') + '" data-crm-strip-role="' + f.key + '" aria-pressed="' + (_stripRole === f.key ? 'true' : 'false') + '">' + esc(f.label) + '</button>').join('');
  const cells = model.days.map((day) => {
    const zone = day.zone === 'today' ? 'Today' : day.zone === 'tomorrow' ? 'Tomorrow' : '';
    const people = day.names.map((n) =>
      '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-cal-person" data-crm-cal-person="' + esc(n) + '" data-crm-cal-date="' + day.dateStr + '" aria-label="' + esc(n + ', ' + day.dateStr) + '">' + _avatar(n) + '</button>').join('');
    return '<div class="crm-cal-cell crm-cal-cell--' + day.zone + '" data-crm-cal-day="' + day.dateStr + '">'
      + '<div class="crm-cal-day-label">' + esc(DAY_NAMES_SHORT[day.dow] + ' ' + day.dayNum) + (zone ? '<span class="crm-cal-zone">' + zone + '</span>' : '') + '</div>'
      + '<div class="crm-cal-people">' + people + '</div></div>';
  }).join('');
  return '<div class="crm-strip-filter"><div class="ds-segmented" role="group" aria-label="Role filter">' + segs + '</div></div>'
    + '<div class="ds-card crm-cal-card"><div class="crm-cal-strip">' + cells + '</div></div>';
}

function _repaintStrip(root) {
  const slot = root.querySelector('#crm-strip-slot');
  if (slot) slot.innerHTML = _stripHtml();
}

function _calPopHtml(person, dateStr) {
  const model = _stripModel();
  const day = model.days.find((d) => d.dateStr === dateStr);
  const past = !day || day.zone === 'past';
  const tasks = ((past ? model.worklogs : model.busy)[dateStr] || {})[person] || [];
  const sorted = tasks.slice().sort((a, b) => past ? (b.loggedSeconds || 0) - (a.loggedSeconds || 0) : (a.rank ?? 999) - (b.rank ?? 999));
  const total = past ? sorted.reduce((sum, t) => sum + (t.loggedSeconds || 0), 0) : 0;
  const other = past ? otherWorklogsFor(_allWork.worklogs, person, dateStr, roadmapKeySet(_data), _canon) : [];
  const otherTotal = other.reduce((sum, t) => sum + t.loggedSeconds, 0);
  const rows = sorted.map((t) => {
    const def = DISCOVERY_TASKS.find((d) => d.label === t.phase || d.shortLabel === t.phase);
    const phase = def ? def.shortLabel : t.phase;
    const key = t.jiraKey
      ? '<a class="crm-link" href="' + esc(JIRA_BASE + t.jiraKey) + '" target="_blank" rel="noopener noreferrer">' + esc(t.jiraKey) + '</a> '
      : '';
    const hours = past && t.loggedSeconds > 0 ? '<span class="ds-badge ds-badge--gray">' + esc(formatHours(t.loggedSeconds)) + '</span> ' : '';
    const status = !past && t.statusName ? '<span class="ds-badge ds-badge--brand">' + esc(t.statusName) + '</span> ' : '';
    return '<div class="crm-cal-task">' + status + hours + '<span class="crm-cal-task-title">' + esc(t.title) + '</span>'
      + '<span class="crm-cal-task-phase">' + key + esc(phase) + '</span></div>';
  }).join('');
  const otherRows = other.map((t) => {
    const href = safeJiraHref(JIRA_BASE, t.jiraKey);
    const key = href
      ? '<a class="crm-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(t.jiraKey) + '</a>'
      : esc(t.jiraKey);
    return '<div class="crm-cal-task crm-cal-task--other"><span class="ds-badge ds-badge--transparent">' + esc(formatHours(t.loggedSeconds)) + '</span> '
      + '<span class="crm-cal-task-title">' + esc(t.summary || t.jiraKey) + '</span>'
      + '<span class="crm-cal-task-phase">' + key + '</span></div>';
  }).join('');
  const otherBlock = other.length > 0
    ? '<div class="crm-pop-other"><div class="crm-pop-subtitle">Other tasks (outside the roadmap)</div><div class="crm-pop-list crm-cal-tasks">' + otherRows + '</div></div>'
    : '';
  const totalText = formatDayTotal(total, otherTotal);
  return '<div class="crm-pop-title">' + esc(person) + (totalText ? ' · ' + esc(totalText) : '') + '</div>'
    + '<div class="crm-pop-list crm-cal-tasks">' + (rows || '<span class="crm-empty">' + (past ? 'No time logged on the roadmap' : 'No tasks in progress') + '</span>') + '</div>'
    + otherBlock;
}

// ---- List ------------------------------------------------------------------

function _isEditing(id) {
  return !!(_edit && _edit.id === id);
}

function _namesFor(current) {
  const canon = current ? _canon(current) : '';
  const list = _teamNames();
  if (canon && !list.includes(canon)) list.unshift(canon);
  return { list, canon };
}

function _editCells(init) {
  const d = _edit.draft;
  const val = (f) => (f in d ? d[f] : init[f]);
  const mark = (cell) => (cellChanged(init, d, cell, _canon) ? ' crm-cell--changed' : '');
  const dis = _saving ? ' disabled' : '';
  const curRag = val('ragStatus');
  const ragBtns = ['red', 'amber', 'green'].map((c) =>
    '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-cell-btn crm-rag-choice" data-crm-draft-rag="' + c + '" aria-pressed="' + (curRag === c ? 'true' : 'false') + '" aria-label="' + esc(RAG[c].label) + '" title="' + esc(RAG[c].label + (curRag === c ? ' (click to clear)' : '')) + '"' + dis + '>'
    + '<span class="crm-rag-dot crm-rag-dot--' + c + '"></span></button>').join('');
  const select = (role) => {
    const { list, canon } = _namesFor(val(role));
    const opts = ['<option value="">(none)</option>'].concat(list.map((n) => '<option value="' + esc(n) + '"' + (n === canon ? ' selected' : '') + '>' + esc(n) + '</option>'));
    return '<label class="crm-edit-field"><span class="crm-pop-label">' + esc(ROLE_NAMES[role]) + '</span>'
      + '<select class="ds-input crm-edit-select" data-crm-draft-role="' + role + '"' + dis + '>' + opts.join('') + '</select></label>';
  };
  const dateInput = (field, label) => '<input type="date" class="ds-input crm-date-input" data-crm-draft-date="' + field + '" value="' + esc(val(field) || '') + '" aria-label="' + esc('Date: ' + label + ' (Enter saves, Esc cancels)') + '"' + dis + '>';
  const active = Array.isArray(val('stageStatus')) ? val('stageStatus') : [];
  const chips = INITIATIVE_STAGES.map((s) =>
    '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-stage-dot' + (active.includes(s.id) ? ' crm-stage-dot--on' : '') + '" data-crm-draft-stage="' + esc(s.id) + '" aria-pressed="' + (active.includes(s.id) ? 'true' : 'false') + '" title="' + esc(s.label) + '"' + dis + '>' + esc(s.short) + '</button>').join('');
  const hasChanges = Object.keys(draftChanges(init, d, _canon)).length > 0;
  const actions = '<div class="crm-edit-actions">'
    + '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-crm-edit-save' + (_saving || !hasChanges ? ' disabled' : '') + '>' + (_saving ? 'Saving...' : 'Save') + '</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-crm-edit-cancel' + (_saving ? ' disabled' : '') + '>Cancel</button>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm crm-delete-btn" data-crm-edit-delete aria-label="Delete initiative" title="Delete initiative"' + (_saving ? ' disabled' : '') + '>' + SVG_TRASH + '</button></div>';
  return {
    actions,
    rag: '<td class="crm-rag-cell' + mark('rag') + '" data-crm-cell="rag"><div class="crm-rag-choices" role="group" aria-label="RAG status">' + ragBtns + '</div></td>',
    po: '<td class="crm-person-cell' + mark('po,designer') + '" data-crm-cell="po,designer"><div class="crm-edit-stack">' + select('po') + select('designer') + '</div></td>',
    an: '<td class="crm-person-cell' + mark('analyst,architect') + '" data-crm-cell="analyst,architect"><div class="crm-edit-stack">' + select('analyst') + select('architect') + '</div></td>',
    d1: '<td class="crm-date-cell' + mark('discoveryEnd') + '" data-crm-cell="discoveryEnd">' + dateInput('discoveryEnd', 'Discovery end') + '</td>',
    d2: '<td class="crm-date-cell' + mark('deliveryEnd') + '" data-crm-cell="deliveryEnd">' + dateInput('deliveryEnd', 'Delivery end') + '</td>',
    d3: '<td class="crm-date-cell' + mark('goLiveDate') + '" data-crm-cell="goLiveDate">' + dateInput('goLiveDate', 'go-live') + '</td>',
    stages: '<td class="crm-stage-cell' + mark('stages') + '" data-crm-cell="stages"><div class="crm-stage-dots">' + chips + '</div></td>',
  };
}

function _rowInner(init, rank, total) {
  const rag = RAG[init.ragStatus];
  const active = Array.isArray(init.stageStatus) ? init.stageStatus : [];
  const id = esc(init.id);
  const editing = _isEditing(init.id);
  const ec = editing ? _editCells(init) : null;
  const dnd = _dndEnabled() && !editing;
  const dis = dnd ? '' : ' disabled';
  const chips = INITIATIVE_STAGES.map((s) =>
    '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-stage-dot' + (active.includes(s.id) ? ' crm-stage-dot--on' : '') + '" data-crm-stage="' + esc(s.id) + '" data-crm-id="' + id + '" aria-pressed="' + (active.includes(s.id) ? 'true' : 'false') + '" title="' + esc(s.label) + '">' + esc(s.short) + '</button>').join('');
  const peopleBtn = (roles, label) => {
    const inner = roles.map((r) => _avatar(init[r])).join('');
    return '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-cell-btn crm-person-btn" data-crm-people="' + roles.join(',') + '" data-crm-id="' + id + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">'
      + (inner || '<span class="crm-empty">-</span>') + '</button>';
  };
  const dateBtn = (field, label) => '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-cell-btn crm-date-btn" data-crm-date="' + field + '" data-crm-id="' + id + '" aria-label="' + esc('Edit row: ' + label) + '" title="Edit row">' + _dateBlock(init, field) + '</button>';
  return '<td class="crm-rank-cell"><div class="crm-rank-inner">'
    + '<span class="crm-drag-handle' + (dnd ? '' : ' crm-drag-handle--off') + '" data-crm-drag="' + id + '"' + (dnd ? ' draggable="true"' : '') + ' title="Drag to change the order" aria-hidden="true">' + SVG_GRIP + '</span>'
    + _rankHtml(init, rank, total, dnd)
    + '<span class="crm-move-btns"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-move-btn" data-crm-move="-1" data-crm-id="' + id + '" aria-label="Move up"' + dis + (rank === 1 ? ' disabled' : '') + '>' + SVG_UP + '</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-move-btn" data-crm-move="1" data-crm-id="' + id + '" aria-label="Move down"' + dis + (rank === total ? ' disabled' : '') + '>' + SVG_DOWN + '</button></span>'
    + '</div></td>'
    + '<td class="crm-title-cell">' + '<span class="crm-title-text">' + esc(init.title || '(untitled)') + '</span>' + (ec ? ec.actions : '') + '</td>'
    + '<td class="crm-ticket-cell">' + _ticketBadge(init.ticket) + '</td>'
    + (ec ? ec.rag : '<td class="crm-rag-cell"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-cell-btn" data-crm-rag="' + id + '" aria-label="' + esc('Edit row: RAG status' + (rag ? ' (now: ' + rag.label.toLowerCase() + ')' : '')) + '" title="Edit row">'
      + (rag ? '<span class="crm-rag-dot crm-rag-dot--' + esc(init.ragStatus) + '"></span>' : '<span class="crm-empty">-</span>') + '</button></td>')
    + (ec ? ec.po : '<td class="crm-person-cell">' + peopleBtn(['po', 'designer'], 'Edit row: PO and Designer') + '</td>')
    + (ec ? ec.an : '<td class="crm-person-cell">' + peopleBtn(['analyst', 'architect'], 'Edit row: Analyst and Architect') + '</td>')
    + (ec ? ec.d1 : '<td class="crm-date-cell">' + dateBtn('discoveryEnd', 'Discovery end') + '</td>')
    + (ec ? ec.d2 : '<td class="crm-date-cell">' + dateBtn('deliveryEnd', 'Delivery end') + '</td>')
    + (ec ? ec.d3 : '<td class="crm-date-cell">' + dateBtn('goLiveDate', 'go-live') + '</td>')
    + (ec ? ec.stages : '<td class="crm-stage-cell"><div class="crm-stage-dots">' + chips + '</div></td>')
    + '<td class="crm-md-cell"><span class="crm-md-total">' + esc(formatMd(timeByPersonTotals(init, _canon).total)) + '</span></td>';
}

/** Priority number: a button when reordering is allowed, an input while typing, plain text otherwise. */
function _rankHtml(init, rank, total, dnd) {
  const id = esc(init.id);
  const pos = rank + ' z ' + total;
  if (!dnd) return '<span class="crm-rank-num" title="' + esc('Position ' + pos) + '">' + rank + '</span>';
  if (_rankEdit === init.id) {
    return '<input type="number" class="ds-input crm-rank-input" data-crm-rank-input="' + id + '" min="1" max="' + total + '" step="1" value="' + rank + '" inputmode="numeric" aria-label="' + esc('New priority from 1 to ' + total + ' (Enter saves, Escape cancels)') + '">';
  }
  return '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crm-rank-btn" data-crm-rank="' + id + '" aria-label="Change priority, currently ' + rank + '" title="' + esc('Position ' + pos) + '">' + rank + '</button>';
}

function _rowHtml(init, rank, total) {
  return '<tr data-crm-row="' + esc(init.id) + '"' + (_isEditing(init.id) ? ' class="crm-row--editing"' : '') + '>' + _rowInner(init, rank, total) + '</tr>';
}

function _tableHtml() {
  const all = sortInitiatives(_data);
  if (all.length === 0) {
    return '<div class="ds-empty"><div class="ds-empty-title">No initiatives in the downloaded data.</div></div>';
  }
  const filtered = filterInitiatives(all, { search: _search, persons: _persons }, _canon);
  if (filtered.length === 0) {
    return '<div class="ds-empty"><div class="ds-empty-title">No results</div>'
      + '<div class="ds-empty-desc">Change the search criteria or filters.</div></div>';
  }
  const rank = new Map(all.map((it, i) => [it.id, i + 1]));
  const hint = _dndEnabled() ? '' : '<div class="crm-note crm-dnd-hint">' + _calloutHtml('info', 'Reordering is disabled while a search or person filter is active - clear them to drag rows.') + '</div>';
  return hint + '<div class="ds-table-wrap crm-table-wrap"><table class="ds-table crm-table"><thead><tr>'
    + '<th class="crm-rank-col">#</th><th>Initiative</th><th>Epic</th><th class="crm-rag-col">RAG</th>'
    + '<th>PO / Des</th><th>An / Arch</th><th>Discovery end</th><th>Delivery end</th><th>Go-live</th>'
    + '<th>Stage</th><th>MD</th></tr></thead><tbody>'
    + filtered.map((it) => _rowHtml(it, rank.get(it.id), all.length)).join('')
    + '</tbody></table></div>';
}

function _countText() {
  const total = _data.length;
  if (_search === '' && _persons.size === 0) return String(total);
  return filterInitiatives(sortInitiatives(_data), { search: _search, persons: _persons }, _canon).length + ' of ' + total;
}

function _personLabel() {
  return _persons.size > 0 ? 'People (' + _persons.size + ')' : 'Filter by person';
}

function _toolbarHtml() {
  const options = collectPersons(_data, _canon).map((name) =>
    '<label class="crm-person-option"><input type="checkbox" data-crm-person="' + esc(name) + '"' + (_persons.has(name) ? ' checked' : '') + '>'
    + _avatar(name) + '<span>' + esc(name) + '</span></label>').join('');
  return '<div class="crm-toolbar">'
    + '<div class="ds-input-wrap crm-search-wrap"><input id="crm-search" class="ds-input" type="search" placeholder="Search initiatives..." aria-label="Search initiatives" autocomplete="off" value="' + esc(_search) + '"></div>'
    + '<div class="crm-person-select">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-crm-person-toggle aria-expanded="false" aria-controls="crm-person-dropdown"><span id="crm-person-label">' + esc(_personLabel()) + '</span>' + SVG_CHEVRON + '</button>'
    + '<div class="ds-card crm-person-dropdown" id="crm-person-dropdown" hidden>' + options + '</div></div>'
    + '<span class="crm-count" id="crm-count" aria-live="polite">' + esc(_countText()) + '</span></div>';
}

function _skippedHtml() {
  return _skipped.length > 0
    ? '<div class="crm-note">' + _calloutHtml('info', 'Skipped ' + _skipped.length + ' corrupt files.') + '</div>'
    : '';
}

/** The pane a tab paints into; falls back to the slot itself when the shell is missing. */
function _pane(root, tab) {
  return root.querySelector('[data-crm-pane="' + tab + '"]') || root;
}

function _paintList(slot) {
  _closePop();
  const root = _pane(slot, 'table');
  _painted.add('table');
  root.innerHTML = _skippedHtml()
    + (_data.length > 0 ? '<div id="crm-strip-slot" class="crm-strip-slot">' + _stripHtml() + '</div>' : '')
    + (_data.length > 0 ? _toolbarHtml() : '')
    + '<div id="crm-table-slot">' + _tableHtml() + '</div>';
}

function _repaintTable(root) {
  _closePop();
  const slot = root.querySelector('#crm-table-slot');
  if (slot) slot.innerHTML = _tableHtml();
  const count = root.querySelector('#crm-count');
  if (count) count.textContent = _countText();
  const label = root.querySelector('#crm-person-label');
  if (label) label.textContent = _personLabel();
}

/** Repaints ONE row (no flicker of the rest of the table). */
function _repaintRow(root, id) {
  const sorted = sortInitiatives(_data);
  const idx = sorted.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const tr = [...root.querySelectorAll('tr[data-crm-row]')].find((r) => r.getAttribute('data-crm-row') === id);
  if (!tr) return;
  tr.innerHTML = _rowInner(sorted[idx], idx + 1, sorted.length);
  tr.classList.toggle('crm-row--editing', _isEditing(id));
}

// ---- Data ------------------------------------------------------------------

/** @returns {Promise<{ok: boolean, kind?: string, message?: string}>} */
async function _load(apiBase) {
  let res;
  try {
    res = await fetch(apiBase + '/initiatives');
  } catch {
    return { ok: false, kind: 'error', message: 'Could not load the initiatives.' };
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (res.status === 409) {
    return { ok: false, kind: 'unavailable', message: (body && body.message) || 'Team data has not been downloaded to this computer yet - pull the Team data source in the Sync window.' };
  }
  if (!res.ok || !body || !Array.isArray(body.initiatives)) {
    return { ok: false, kind: 'error', message: 'Could not load the initiatives.' };
  }
  _data = body.initiatives;
  _tempo = await _loadTempo(apiBase);
  _allWork = await _loadAllWork(apiBase);
  _skipped = Array.isArray(body.skipped) ? body.skipped : [];
  return { ok: true };
}

/** All logged time per person (time-log module, read-only); absent data = no "other tasks" section, never an error. */
async function _loadAllWork(apiBase) {
  try {
    const res = await fetch(apiBase + '/worklogs');
    if (!res.ok) return normalizeWorklogs(null);
    return normalizeWorklogs(await res.json());
  } catch {
    return normalizeWorklogs(null);
  }
}

/** Tempo worklogs; never fails the load - without them the strip shows today and tomorrow only. */
async function _loadTempo(apiBase) {
  try {
    const res = await fetch(apiBase + '/tempo');
    if (!res.ok) return normalizeTempo(null);
    return normalizeTempo(await res.json());
  } catch {
    return normalizeTempo(null);
  }
}

function _paintFailure(slot, r) {
  const html = _calloutHtml(r.kind === 'unavailable' ? 'warning' : 'danger', r.message);
  for (const tab of ['table', 'timeline']) _pane(slot, tab).innerHTML = html;
  _painted.delete('table');
  _painted.delete('timeline');
}

// ---- Tabs ----------------------------------------------------------------------

function _tabsShellHtml() {
  const tabs = VIEW_TABS.map((t) =>
    '<button type="button" class="ds-tab' + (t.id === _tab ? ' active' : '') + '" role="tab" id="crm-tab-' + t.id + '" data-crm-tab="' + t.id + '" aria-selected="' + (t.id === _tab ? 'true' : 'false') + '" aria-controls="crm-pane-' + t.id + '">' + esc(t.label) + '</button>').join('');
  const panes = VIEW_TABS.map((t) =>
    '<div class="crm-pane" id="crm-pane-' + t.id + '" role="tabpanel" aria-labelledby="crm-tab-' + t.id + '" data-crm-pane="' + t.id + '"' + (t.id === _tab ? '' : ' hidden') + '>'
    + (t.id === 'table' ? _skeletonHtml() : '') + '</div>').join('');
  return '<nav class="ds-tabs-list ds-framed-tabs crm-tabs" role="tablist" aria-label="Roadmap views">' + tabs + '</nav>' + panes;
}

/** Paints the pane of `tab` once per data load (lazy); `force` repaints it. */
function _paintTab(deps, slot, tab, force) {
  if (!force && _painted.has(tab)) return;
  if (tab === 'table') { _paintList(slot); return; }
  const pane = _pane(slot, tab);
  if (tab === 'timeline') {
    _painted.add(tab);
    renderRoadmap(pane, {
      initiatives: sortInitiatives(_data), today: _today, avatar: _avatar, esc,
      registerViewCleanup: deps.registerViewCleanup,
      onOpenRow: (id) => _openRowInTable(deps, slot, id),
    });
    return;
  }
  _painted.add(tab);
  renderKanban(pane, {
    apiBase: deps.apiBase, showToast: deps.showToast, registerViewCleanup: deps.registerViewCleanup, teamDir: _teamDir, esc,
    onOpenRow: (id) => _openRowInTable(deps, slot, id),
  });
}

function _activateTab(deps, slot, tab, opts) {
  _tab = tab;
  for (const t of VIEW_TABS) {
    const btn = slot.querySelector('[data-crm-tab="' + t.id + '"]');
    if (btn) {
      btn.classList.toggle('active', t.id === tab);
      btn.setAttribute('aria-selected', t.id === tab ? 'true' : 'false');
    }
    const pane = slot.querySelector('[data-crm-pane="' + t.id + '"]');
    if (pane) pane.hidden = t.id !== tab;
  }
  if (!opts || opts.updateHash !== false) {
    try { window.history.replaceState(null, '', tabHash(VIEW_ID, tab)); } catch { /* deep link is best effort */ }
  }
  _closePop();
  // The roadmap is cheap and reads the shared list, so it repaints on every entry (edits made in the table show up).
  if (tab === 'kanban' || _loadedOk) _paintTab(deps, slot, tab, tab === 'timeline');
}

/** Roadmap row click: show the same initiative in the table. */
function _openRowInTable(deps, slot, id) {
  _activateTab(deps, slot, 'table');
  const tr = [...slot.querySelectorAll('tr[data-crm-row]')].find((r) => r.getAttribute('data-crm-row') === id);
  if (!tr) return;
  tr.scrollIntoView({ block: 'center' });
  tr.classList.add('crm-row--flash');
  setTimeout(() => tr.classList.remove('crm-row--flash'), 1600);
}

// /update, /delete, /reorder and /jira-sync rewrite dt-<id>.json files in
// the team data's discovery-tasks/ (a write scope in module.json). Announced on the core's data bus,
// the core repaints the module sync bar (local date, pending files) and calls
// onDataChanged() below, which skips the repaint when the reloaded data
// equals what the caller has already painted. Dynamic import: Node-safe.
async function _announceDataWrite() {
  try {
    const ev = await import('/js/data-events.js');
    ev.emitDataChanged({ source: 'roadmap' });
    return true;
  } catch {
    return false;
  }
}

/** What the table and the strip are painted from, as one comparable string. */
function _snapshotData() {
  try { return JSON.stringify([_data, _tempo, _allWork, _skipped]); } catch { return null; }
}

/** POST JSON to the module API; resolves { status, body } (body null on a non-JSON answer). */
async function _post(apiBase, route, payload) {
  let res;
  try {
    res = await fetch(apiBase + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  } catch {
    return { status: 0, body: { error: 'jira-unreachable' } };
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

function _toast(deps, variant, title, desc) {
  if (deps && typeof deps.showToast === 'function') deps.showToast(variant, title, desc || '');
}

// ---- Popover (activity strip) ---------------------------------------------------

function _closePop() {
  if (_pop) { _pop.remove(); _pop = null; }
}

function _openPop(anchor, html) {
  _closePop();
  const el = document.createElement('div');
  el.className = 'ds-card crm-pop';
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.top = Math.min(r.bottom + 4, window.innerHeight - el.offsetHeight - 8) + 'px';
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  _pop = el;
  const first = el.querySelector('button, select');
  if (first) first.focus();
  return el;
}


// ---- Row edit mode ------------------------------------------------------------
// One row at a time. Clicking an editable cell turns the whole row into controls;
// changes live in `_edit.draft` and go out as ONE POST /update on "Save".

function _rowEl(root, id) {
  return [...root.querySelectorAll('tr[data-crm-row]')].find((r) => r.getAttribute('data-crm-row') === id) || null;
}

function _editChanged() {
  const init = _edit && _data.find((i) => i.id === _edit.id);
  return init ? draftChanges(init, _edit.draft, _canon) : {};
}

/** In place (no repaint, so a focused date input keeps focus): marks changed cells and the Save state. */
function _refreshEditMarks(root) {
  if (!_edit) return;
  const tr = _rowEl(root, _edit.id);
  const init = _data.find((i) => i.id === _edit.id);
  if (!tr || !init) return;
  for (const td of tr.querySelectorAll('[data-crm-cell]')) {
    td.classList.toggle('crm-cell--changed', cellChanged(init, _edit.draft, td.getAttribute('data-crm-cell'), _canon));
  }
  const save = tr.querySelector('[data-crm-edit-save]');
  if (save) save.disabled = _saving || Object.keys(_editChanged()).length === 0;
}

function _refocus(root, id, selector) {
  const tr = _rowEl(root, id);
  const el = tr && selector ? tr.querySelector(selector) : null;
  if (el) el.focus();
}

async function _enterEdit(root, id) {
  if (_saving || _isEditing(id)) return;
  const prev = _edit;
  if (prev && Object.keys(_editChanged()).length > 0) {
    let ok = false;
    try {
      const { confirmDsModal } = await import('/js/ds-modal.js');
      ok = await confirmDsModal({ title: 'Unsaved changes', body: 'Another row has unsaved changes. Discard them and edit this row?', okLabel: 'Discard and edit', cancelLabel: 'Back to the previous row', danger: true });
    } catch { ok = false; }
    if (!ok || _saving || _edit !== prev) return;
  }
  _edit = { id, draft: {} };
  if (prev) _repaintRow(root, prev.id);
  _repaintRow(root, id);
  _refocus(root, id, '[data-crm-draft-date]');
}

function _cancelEdit(root) {
  if (!_edit || _saving) return;
  const id = _edit.id;
  _edit = null;
  _repaintRow(root, id);
}

async function _saveEditRow(deps, root) {
  if (!_edit || _saving) return;
  const id = _edit.id;
  const init = _data.find((i) => i.id === id);
  if (!init) return;
  const built = buildEditPatch(init, _edit.draft, _canon);
  if (!built.ok) {
    if (!built.empty) _toast(deps, 'danger', 'Cannot save the changes.', built.message);
    return;
  }
  _saving = true;
  _repaintRow(root, id);
  let ok = false;
  try {
    const r = await _post(deps.apiBase, '/update', { id, patch: built.patch });
    if (r.status === 200 && r.body && r.body.initiative) {
      const i = _data.findIndex((x) => x.id === id);
      if (i >= 0) _data[i] = r.body.initiative;
      ok = true;
    } else {
      _toast(deps, 'danger', 'Could not save the changes.', (r.body && r.body.message) || 'Try again in a moment - your changes stay in the row.');
    }
  } finally {
    _saving = false;
    if (ok && _edit && _edit.id === id) _edit = null;
    _repaintRow(root, id);
    if (ok) _repaintStrip(root);
  }
  if (ok) _announceDataWrite();
}

async function _deleteEditRow(deps, root) {
  if (!_edit || _saving) return;
  const id = _edit.id;
  const init = _data.find((i) => i.id === id);
  if (!init) return;
  const name = init.title || '(untitled)';
  const ticket = init.ticket ? ' (' + init.ticket + ')' : '';
  let confirmed = false;
  try {
    const { confirmDsModal } = await import('/js/ds-modal.js');
    confirmed = await confirmDsModal({
      title: 'Delete the initiative?',
      body: 'Do you really want to delete the initiative "' + name + '"' + ticket + '? It disappears from the roadmap once the sync is sent; the Jira issue stays.',
      okLabel: 'Delete', cancelLabel: 'Cancel', danger: true,
    });
  } catch { confirmed = false; }
  if (!confirmed || _saving || !_edit || _edit.id !== id) return;
  _saving = true;
  _repaintRow(root, id);
  let ok = false;
  try {
    const r = await _post(deps.apiBase, '/delete', { id });
    if (r.status === 200 && r.body && r.body.ok) {
      _data = _data.filter((x) => x.id !== id);
      ok = true;
    } else {
      _toast(deps, 'danger', 'Could not delete the initiative.', (r.body && r.body.message) || 'Try again in a moment.');
    }
  } finally {
    _saving = false;
    if (ok) {
      if (_edit && _edit.id === id) _edit = null;
      _repaintTable(root);
      _repaintStrip(root);
      _toast(deps, 'success', 'Initiative deleted.', '"' + name + '"' + ticket);
      _announceDataWrite();
    } else {
      _repaintRow(root, id);
    }
  }
}

/** @returns {Promise<boolean>} true only when the server saved the new order */
async function _applyOrder(deps, root, order) {
  if (_reorderBusy) return false;
  const before = sortInitiatives(_data).map((i) => i.id);
  if (order.length === before.length && order.every((id, i) => id === before[i])) return false;
  _reorderBusy = true;
  const prev = new Map(_data.map((i) => [i.id, i.rank]));
  order.forEach((id, idx) => { const it = _data.find((x) => x.id === id); if (it) it.rank = idx + 1; });
  _repaintTable(root);
  let ok = false;
  try {
    const r = await _post(deps.apiBase, '/reorder', { order });
    if (r.status === 200 && r.body && Array.isArray(r.body.initiatives)) {
      _data = r.body.initiatives;
      ok = true;
    } else {
      for (const it of _data) { if (prev.has(it.id)) it.rank = prev.get(it.id); }
      const b = r.body || {};
      _toast(deps, 'danger', 'Could not save the order.', b.message || 'Try again in a moment.');
    }
  } finally {
    _reorderBusy = false;
    _repaintTable(root);
  }
  if (ok) _announceDataWrite();
  return ok;
}

// ---- Priority by typing a number ------------------------------------------------

function _openRankEdit(root, id) {
  if (!id || !_dndEnabled() || _isEditing(id) || _reorderBusy) return;
  const prev = _rankEdit;
  _rankEdit = id;
  if (prev && prev !== id) _repaintRow(root, prev);
  _repaintRow(root, id);
  const tr = _rowEl(root, id);
  const el = tr ? tr.querySelector('[data-crm-rank-input]') : null;
  if (el) { el.focus(); el.select(); }
}

function _cancelRankEdit(root) {
  const id = _rankEdit;
  _rankEdit = null;
  if (id) {
    _repaintRow(root, id);
    _refocus(root, id, '[data-crm-rank]');
  }
}

/** Commits a typed priority; `refocus` is false when focus already moved elsewhere (blur). */
async function _commitRank(deps, root, id, rawValue, refocus) {
  if (_rankEdit !== id) return;
  _rankEdit = null;
  const total = _data.length;
  const n = parseInt(String(rawValue || '').trim(), 10);
  if (!Number.isInteger(n)) {
    _repaintRow(root, id);
    if (String(rawValue || '').trim() !== '') _toast(deps, 'danger', 'Enter a priority number.', 'A whole number from 1 to ' + total + '.');
    if (refocus) _refocus(root, id, '[data-crm-rank]');
    return;
  }
  const order = moveToPosition(sortInitiatives(_data).map((i) => i.id), id, n);
  _repaintRow(root, id);
  const ok = await _applyOrder(deps, root, order);
  if (ok) {
    const sorted = sortInitiatives(_data);
    const idx = sorted.findIndex((i) => i.id === id);
    const init = sorted[idx];
    _toast(deps, 'success', 'Priority changed.', '"' + ((init && init.title) || '(untitled)') + '" is now at position ' + (idx + 1) + '.');
    const tr = _rowEl(root, id);
    if (tr) tr.classList.add('crm-row--flash');
  }
  if (refocus) _refocus(root, id, '[data-crm-rank]');
}

// ---- Jira sync modal ---------------------------------------------------------

async function _runSyncModal(deps, root, cleanupList) {
  const targets = syncTargets(_data);
  if (targets.length === 0) {
    _toast(deps, 'info', 'No initiatives with an epic to sync.', '');
    return;
  }
  let modalApi = null;
  try { modalApi = await import('/js/ds-modal.js'); } catch { modalApi = null; }
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = '<div class="ds-modal crm-sync-modal">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Sync with Jira</span></div>'
    + '<div class="ds-modal-body">'
    + '<div class="crm-sync-now" id="crm-sync-now" aria-live="polite"></div>'
    + '<div class="ds-progress"><div class="ds-progress-labels"><span id="crm-sync-counts"></span><span id="crm-sync-pct"></span></div>'
    + '<div class="ds-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="crm-sync-track"><div class="ds-progress-fill ds-progress-fill--brand" id="crm-sync-fill" style="width:0%"></div></div></div>'
    + '<ul class="crm-sync-list" id="crm-sync-list"></ul></div>'
    + '<div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--secondary" id="crm-sync-cancel">Stop after the current one</button></div></div>';
  document.body.appendChild(overlay);
  if (modalApi) modalApi.openDsModal(overlay, { dismissible: false });
  else { overlay.hidden = false; overlay.classList.add('open'); }

  const q = (id) => overlay.querySelector('#' + id);
  const total = targets.length;
  const results = [];
  let cancelRequested = false;
  let running = true;
  const close = () => {
    if (modalApi) modalApi.closeDsModal(overlay);
    overlay.remove();
  };
  cleanupList.push(() => { cancelRequested = true; close(); });
  const cancelBtn = q('crm-sync-cancel');
  cancelBtn.addEventListener('click', () => {
    if (running) {
      cancelRequested = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Stopping...';
    } else {
      close();
    }
  });
  const paint = (current) => {
    const done = results.length;
    const pct = Math.round((done / total) * 100);
    q('crm-sync-counts').textContent = 'Done: ' + done + ' of ' + total + ' · remaining: ' + (total - done);
    q('crm-sync-pct').textContent = pct + '%';
    q('crm-sync-fill').style.width = pct + '%';
    q('crm-sync-track').setAttribute('aria-valuenow', String(pct));
    q('crm-sync-now').textContent = current ? 'Now: ' + current.title + ' (' + current.ticket + ')' : '';
  };
  const addResult = (t, ok, text) => {
    results.push({ id: t.id, ok });
    const li = document.createElement('li');
    li.className = 'crm-sync-item';
    li.innerHTML = '<span class="ds-badge ' + (ok ? 'ds-badge--green' : 'ds-badge--red') + '">' + (ok ? 'OK' : 'Error') + '</span>'
      + '<span class="crm-sync-item-text">' + esc(t.title) + ' (' + esc(t.ticket) + ')' + (text ? ' - ' + esc(text) : '') + '</span>';
    q('crm-sync-list').appendChild(li);
  };

  paint(null);
  let abortedBy = '';
  for (const t of targets) {
    if (cancelRequested) break;
    paint(t);
    const r = await _post(deps.apiBase, '/jira-sync', { id: t.id });
    if (r.status === 200 && r.body && r.body.initiative) {
      const i = _data.findIndex((x) => x.id === t.id);
      if (i >= 0) _data[i] = r.body.initiative;
      if (document.getElementById(VIEW_ID + '-root') === root) _repaintRow(root, t.id);
      addResult(t, true, 'tasks from Jira: ' + ((r.body.counts && r.body.counts.tasks) || 0));
    } else {
      const b = r.body || {};
      addResult(t, false, b.message || syncErrorText(b.error));
      if (isFatalSyncError(b.error)) { abortedBy = b.message || syncErrorText(b.error); break; }
    }
  }
  running = false;
  const doneCount = results.length;
  const okCount = results.filter((x) => x.ok).length;
  paint(null);
  const skippedCount = total - doneCount;
  let summary = 'Synced ' + okCount + ' of ' + total + ' initiatives.';
  if (abortedBy) summary += ' Stopped - ' + abortedBy + '. Skipped: ' + skippedCount + '.';
  else if (cancelRequested && skippedCount > 0) summary += ' Stopped on request. Skipped: ' + skippedCount + '.';
  q('crm-sync-now').textContent = summary;
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Close';
  cancelBtn.classList.remove('ds-btn--secondary');
  cancelBtn.classList.add('ds-btn--primary');
  // One announce for the whole batch; it reloads through onDataChanged().
  if (okCount > 0 && await _announceDataWrite()) return;
  if (document.getElementById(VIEW_ID + '-root') === root) {
    const loaded = await _load(deps.apiBase);
    if (loaded.ok) { _today = new Date(); _loadedOk = true; _painted.clear(); _paintTab(deps, root, _tab, true); }
  }
}

export const views = {

  'roadmap-main': {
    _wired: false,

    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      this._deps = deps;
      (async () => {
        try { _teamDir = await import('/js/team-directory.js'); } catch { _teamDir = null; }
      })();
    },

    async render(subPath, _opts) {
      const root = document.getElementById(VIEW_ID + '-root');
      if (!root) return;
      const { apiBase, showToast } = this._deps;

      // The slot is a fresh element on every entry, so the button needs no cleanup.
      const actions = document.getElementById(VIEW_ID + '-actions');
      if (actions) {
        actions.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary" data-crm-sync-all>Sync with Jira</button>';
        const btn = actions.querySelector('[data-crm-sync-all]');
        if (btn) btn.addEventListener('click', () => this._syncAll(btn, root));
      }

      _edit = null;
      _tab = tabFromSubPath(subPath);
      _loadedOk = false;
      _painted = new Set();
      this._wire(root);
      root.innerHTML = _tabsShellHtml();
      this._wireTabs(root);
      if (_tab === 'kanban') _paintTab(this._deps, root, 'kanban', true);
      if (!_teamDir) {
        try { _teamDir = await import('/js/team-directory.js'); } catch { _teamDir = null; }
      }
      if (_teamDir && _teamDir.loadTeamDirectory) {
        try { await _teamDir.loadTeamDirectory(); } catch { /* initials fallback */ }
      }
      _today = new Date();
      const r = await _load(apiBase);
      if (!r.ok) {
        _paintFailure(root, r);
        if (r.kind === 'error' && typeof showToast === 'function') showToast('danger', r.message);
        return;
      }
      _loadedOk = true;
      _paintTab(this._deps, root, _tab, _tab !== 'kanban' || !_painted.has('kanban'));
    },

    /** Tab strip: click and arrow keys; the hash follows the active tab (deep link). */
    _wireTabs(root) {
      if (root.dataset.crmTabsWired === '1') return;
      root.dataset.crmTabsWired = '1';
      const deps = this._deps;
      const onTab = (e) => {
        const btn = e.target.closest('[data-crm-tab]');
        if (!btn) return;
        _activateTab(deps, root, btn.getAttribute('data-crm-tab'));
      };
      const onTabKey = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const btn = e.target.closest('[data-crm-tab]');
        if (!btn) return;
        const ids = VIEW_TABS.map((t) => t.id);
        const next = ids[(ids.indexOf(btn.getAttribute('data-crm-tab')) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
        _activateTab(deps, root, next);
        const nb = root.querySelector('[data-crm-tab="' + next + '"]');
        if (nb) nb.focus();
      };
      root.addEventListener('click', onTab);
      root.addEventListener('keydown', onTabKey);
      deps.registerViewCleanup(() => {
        root.removeEventListener('click', onTab);
        root.removeEventListener('keydown', onTabKey);
        delete root.dataset.crmTabsWired;
      });
    },

    /** Listener wiring; guarded by _wired, independent of the load outcome. */
    _wire(root) {
      if (this._wired) return;
      this._wired = true;
      const { registerViewCleanup } = this._deps;
      const deps = this._deps;
      const rowOf = (id) => _data.find((i) => i.id === id);
      const onClick = (e) => {
        const t = e.target;
        const roleBtn = t.closest('[data-crm-strip-role]');
        if (roleBtn) {
          _stripRole = roleBtn.getAttribute('data-crm-strip-role');
          _closePop();
          _repaintStrip(root);
          return;
        }
        const calBtn = t.closest('[data-crm-cal-person]');
        if (calBtn) {
          if (_pop && _pop.getAttribute('data-crm-cal-anchor') === calBtn.getAttribute('data-crm-cal-date') + '|' + calBtn.getAttribute('data-crm-cal-person')) { _closePop(); return; }
          const pop = _openPop(calBtn, _calPopHtml(calBtn.getAttribute('data-crm-cal-person'), calBtn.getAttribute('data-crm-cal-date')));
          pop.setAttribute('data-crm-cal-anchor', calBtn.getAttribute('data-crm-cal-date') + '|' + calBtn.getAttribute('data-crm-cal-person'));
          return;
        }
        const draftRag = t.closest('[data-crm-draft-rag]');
        if (draftRag && _edit && !_saving) {
          const init = rowOf(_edit.id);
          const cur = 'ragStatus' in _edit.draft ? _edit.draft.ragStatus : (init ? init.ragStatus : null);
          const v = ragPatch(cur ?? null, draftRag.getAttribute('data-crm-draft-rag')).ragStatus;
          _edit.draft.ragStatus = v;
          _repaintRow(root, _edit.id);
          _refocus(root, _edit.id, '[data-crm-draft-rag][aria-pressed="true"], [data-crm-draft-rag]');
          return;
        }
        const draftStage = t.closest('[data-crm-draft-stage]');
        if (draftStage && _edit && !_saving) {
          const init = rowOf(_edit.id);
          const cur = _edit.draft.stageStatus || (init && init.stageStatus) || [];
          const sid = draftStage.getAttribute('data-crm-draft-stage');
          _edit.draft.stageStatus = toggleStagePatch(cur, sid).stageStatus;
          _repaintRow(root, _edit.id);
          _refocus(root, _edit.id, '[data-crm-draft-stage="' + sid + '"]');
          return;
        }
        if (t.closest('[data-crm-edit-save]')) { _saveEditRow(deps, root); return; }
        if (t.closest('[data-crm-edit-delete]')) { _deleteEditRow(deps, root); return; }
        if (t.closest('[data-crm-edit-cancel]')) { _cancelEdit(root); return; }
        const enter = t.closest('[data-crm-rag], [data-crm-people], [data-crm-date], [data-crm-stage]');
        if (enter) {
          const tr = enter.closest('tr[data-crm-row]');
          if (tr) _enterEdit(root, tr.getAttribute('data-crm-row'));
          return;
        }
        const rankBtn = t.closest('[data-crm-rank]');
        if (rankBtn) { _openRankEdit(root, rankBtn.getAttribute('data-crm-rank')); return; }
        const move = t.closest('[data-crm-move]');
        if (move && _dndEnabled() && !_isEditing(move.getAttribute('data-crm-id'))) {
          const order = stepInOrder(sortInitiatives(_data).map((i) => i.id), move.getAttribute('data-crm-id'), Number(move.getAttribute('data-crm-move')));
          _applyOrder(deps, root, order);
          return;
        }
        const toggle = t.closest('[data-crm-person-toggle]');
        if (toggle) {
          const dd = root.querySelector('#crm-person-dropdown');
          if (dd) {
            dd.hidden = !dd.hidden;
            toggle.setAttribute('aria-expanded', dd.hidden ? 'false' : 'true');
          }
        }
      };
      const onInput = (e) => {
        if (e.target && e.target.id === 'crm-search') {
          _search = e.target.value;
          _repaintTable(root);
        }
      };
      const onChange = (e) => {
        const roleSel = e.target.closest ? e.target.closest('[data-crm-draft-role]') : null;
        if (roleSel && _edit && !_saving) {
          _edit.draft[roleSel.getAttribute('data-crm-draft-role')] = roleSel.value;
          _refreshEditMarks(root);
          return;
        }
        const dateIn = e.target.closest ? e.target.closest('[data-crm-draft-date]') : null;
        if (dateIn && _edit && !_saving) {
          _edit.draft[dateIn.getAttribute('data-crm-draft-date')] = dateIn.value;
          _refreshEditMarks(root);
          return;
        }
        const cb = e.target.closest ? e.target.closest('[data-crm-person]') : null;
        if (!cb) return;
        const name = cb.getAttribute('data-crm-person');
        if (cb.checked) _persons.add(name); else _persons.delete(name);
        _repaintTable(root);
      };
      const onDragStart = (e) => {
        const h = e.target.closest ? e.target.closest('[data-crm-drag]') : null;
        if (!h || !_dndEnabled()) return;
        _dragId = h.getAttribute('data-crm-drag');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _dragId); }
        const tr = h.closest('tr');
        if (tr) tr.classList.add('crm-row--dragging');
      };
      const clearMarks = () => {
        for (const r of root.querySelectorAll('.crm-row--over-before, .crm-row--over-after, .crm-row--dragging')) {
          r.classList.remove('crm-row--over-before', 'crm-row--over-after', 'crm-row--dragging');
        }
      };
      const onDragOver = (e) => {
        if (!_dragId) return;
        const tr = e.target.closest ? e.target.closest('tr[data-crm-row]') : null;
        if (!tr) return;
        e.preventDefault();
        const rect = tr.getBoundingClientRect();
        const after = e.clientY >= rect.top + rect.height / 2;
        for (const r of root.querySelectorAll('.crm-row--over-before, .crm-row--over-after')) r.classList.remove('crm-row--over-before', 'crm-row--over-after');
        tr.classList.add(after ? 'crm-row--over-after' : 'crm-row--over-before');
      };
      const onDrop = (e) => {
        if (!_dragId) return;
        const tr = e.target.closest ? e.target.closest('tr[data-crm-row]') : null;
        if (!tr) return;
        e.preventDefault();
        const rect = tr.getBoundingClientRect();
        const after = e.clientY >= rect.top + rect.height / 2;
        const order = moveInOrder(sortInitiatives(_data).map((i) => i.id), _dragId, tr.getAttribute('data-crm-row'), after);
        _dragId = null;
        clearMarks();
        _applyOrder(deps, root, order);
      };
      const onDragEnd = () => { _dragId = null; clearMarks(); };
      const onDocClick = (e) => {
        const dd = root.querySelector('#crm-person-dropdown');
        if (dd && !dd.hidden && !(e.target.closest && e.target.closest('.crm-person-select'))) {
          dd.hidden = true;
          const tg = root.querySelector('[data-crm-person-toggle]');
          if (tg) tg.setAttribute('aria-expanded', 'false');
        }
        if (_pop && !(e.target.closest && (e.target.closest('.crm-pop') || e.target.closest('[data-crm-rag], [data-crm-people], [data-crm-cal-person]')))) _closePop();
      };
      const onKey = (e) => { if (e.key === 'Escape') _closePop(); };
      const onRootKey = (e) => {
        const rankIn = e.target.closest ? e.target.closest('[data-crm-rank-input]') : null;
        if (rankIn && (e.key === 'Enter' || e.key === 'Escape')) {
          e.preventDefault();
          e.stopPropagation();
          if (rankIn.dataset.crmRankDone) return;
          rankIn.dataset.crmRankDone = '1';
          if (e.key === 'Enter') _commitRank(deps, root, rankIn.getAttribute('data-crm-rank-input'), rankIn.value, true);
          else _cancelRankEdit(root);
          return;
        }
        const rankBtn = e.key === 'F2' && e.target.closest ? e.target.closest('[data-crm-rank]') : null;
        if (rankBtn) { e.preventDefault(); _openRankEdit(root, rankBtn.getAttribute('data-crm-rank')); return; }
        if (!_edit || !e.target.closest || !e.target.closest('tr.crm-row--editing')) return;
        if (e.key === 'Escape') { e.preventDefault(); _cancelEdit(root); return; }
        const dateIn = e.key === 'Enter' ? e.target.closest('[data-crm-draft-date]') : null;
        if (dateIn && !_saving) {
          e.preventDefault();
          _edit.draft[dateIn.getAttribute('data-crm-draft-date')] = dateIn.value;
          _saveEditRow(deps, root);
        }
      };
      root.addEventListener('click', onClick);
      root.addEventListener('keydown', onRootKey);
      const onFocusOut = (e) => {
        const el = e.target && e.target.closest ? e.target.closest('[data-crm-rank-input]') : null;
        if (!el || el.dataset.crmRankDone) return;
        el.dataset.crmRankDone = '1';
        _commitRank(deps, root, el.getAttribute('data-crm-rank-input'), el.value, false);
      };
      root.addEventListener('focusout', onFocusOut);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onChange);
      root.addEventListener('dragstart', onDragStart);
      root.addEventListener('dragover', onDragOver);
      root.addEventListener('drop', onDrop);
      root.addEventListener('dragend', onDragEnd);
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKey);
      // Registered on every entry (the registry is wiped on every exit).
      registerViewCleanup(() => {
        root.removeEventListener('click', onClick);
        root.removeEventListener('keydown', onRootKey);
        root.removeEventListener('focusout', onFocusOut);
        _rankEdit = null;
        _edit = null;
        _saving = false;
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onChange);
        root.removeEventListener('dragstart', onDragStart);
        root.removeEventListener('dragover', onDragOver);
        root.removeEventListener('drop', onDrop);
        root.removeEventListener('dragend', onDragEnd);
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKey);
        _closePop();
        this._wired = false;
      });
    },

    async _syncAll(btn, root) {
      if (btn.disabled) return;
      btn.disabled = true;
      const cleanups = [];
      this._deps.registerViewCleanup(() => { for (const c of cleanups) c(); });
      try {
        await _runSyncModal(this._deps, root, cleanups);
      } finally {
        btn.disabled = false;
      }
    },

    /** Called after a data sync: refetch and repaint the list. */
    async onDataChanged() {
      if (!this._deps) return;
      const root = document.getElementById(VIEW_ID + '-root');
      if (!root) return;
      const before = _loadedOk ? _snapshotData() : null;
      const r = await _load(this._deps.apiBase);
      if (!r.ok) { _paintFailure(root, r); return; }
      // Nothing new (typically this view's own write, already painted): keep
      // the table, an open edit row and the focus as they are.
      if (before !== null && _snapshotData() === before) return;
      _today = new Date();
      _loadedOk = true;
      _painted.clear();
      _paintTab(this._deps, root, _tab, true);
    },
  },
};
