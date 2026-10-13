// modules/gantt-roadmap/client/index.js
// Gantt roadmap - full Gantt view.
//
// deps (passed to init):
//   navigate(viewId)         - go to another view
//   registerViewCleanup(cb)  - MANDATORY for timers / listeners
//   showToast(variant, title) - host signature; init() wraps it into the
//                               (message, kind) form this file calls
//   apiBase                  - '/api/m/gantt-roadmap'
//
// DS classes only. Confirm destructive actions with confirmDsModal.
// All imports from /js/ are dynamic (Node test loads this without a browser).

import {
  monthSegsByDay, sprintSegs, dayPct,
  phaseLanes, envelope,
  groupsOf, weekLabel, AREA_COLORS,
  slToRange, rangeToSL,
} from './gantt.js';

// ---- Module-level state (cleared on data-changed reload) ------------------

let _quarter = null;    // full quarter payload from GET /quarter
let _areas   = [];      // area shards, sorted by o
let _tasks   = [];      // task shards
let _backlog = [];      // backlog items
let _status  = null;    // GET /status payload

// UI state persisted across renders
let _uiGroup     = 'area';    // 'area' | 'owner' | 'none'
let _uiPerson    = '';        // roster id filter
// giewont filter removed
// Editing is always on (the team asked for no separate edit mode); the
// editMode/_uiEdit plumbing stays so a read-only mode can come back with one line.
let _uiEdit      = true;
let _collapsed   = {};        // { groupKey: true } collapsed group keys
let _backlogOpen = true;      // backlog section collapsed state

let _drawerUid   = null;      // currently-open task uid in drawer
let _drag        = null;      // drag operation state
let _dragCleanup = null;      // cleanup fn for window mousemove/mouseup added by _startDrag

// Lazy-loaded cockpit imports
let _dsModal  = null;
let _teamDir  = null;

// Quarter-level constants (set in _buildView, read by _drawerHtml via closure)
let _weekFirstNo = 39; // ISO week number of the first quarter week
let _weeksNGlobal = 14;

// ---- Helpers ---------------------------------------------------------------

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _pad2(n) { return String(n).padStart(2, '0'); }

function _displayN(task) { return 'T' + _pad2(task.n || 0); }

function _weekMondayLabel(mondayFirst, weekIndex) {
  const d = new Date(mondayFirst + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + weekIndex * 7);
  return (d.getUTCDate()) + '.' + _pad2(d.getUTCMonth() + 1);
}

// Returns today's day-precise percentage within the gantt area (0..100),
// or -1 when today is outside the quarter range.
function _todayLinePct(mondayFirst, weeksN) {
  const daysN = weeksN * 7;
  const now = Date.now();
  const base = new Date(mondayFirst + 'T00:00:00Z').getTime();
  const dayOffset = (now - base) / (24 * 3600 * 1000);
  if (dayOffset < 0 || dayOffset >= daysN) return -1;
  return dayPct(dayOffset, daysN);
}

// Keep week-index for header column highlights (approximate; used only in header).
function _todayWeek(mondayFirst, weeksN) {
  const now = Date.now();
  const base = new Date(mondayFirst + 'T00:00:00Z').getTime();
  const weekIdx = Math.floor((now - base) / (7 * 24 * 3600 * 1000));
  if (weekIdx < 0 || weekIdx >= weeksN) return -1;
  return weekIdx; // 0-based
}

function _areaClass(colorKey) {
  if (AREA_COLORS.includes(colorKey)) return 'gr-area--' + colorKey;
  return 'gr-area--gray';
}

function _personInitials(person) {
  if (!person) return '?';
  const n = person.n || person.id || '?';
  const parts = n.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return n[0].toUpperCase();
}

function _avatarHtml(personId, roster, teamDir) {
  const person = roster ? roster.find((p) => p.id === personId) : null;
  const initials = _personInitials(person);
  if (teamDir && person && person.n) {
    // avatarUrlForName resolves through the loaded team directory
    const url = teamDir.avatarUrlForName ? teamDir.avatarUrlForName(person.n) : null;
    if (url && !url.startsWith('data:')) {
      return '<span class="gr-avatar" title="' + _esc(person.n || personId) + '">'
        + '<img src="' + _esc(url) + '" alt="' + _esc(initials) + '" loading="lazy">'
        + '</span>';
    }
  }
  return '<span class="gr-avatar" title="' + _esc(person ? person.n : personId) + '">'
    + _esc(initials) + '</span>';
}

// ---- Data loading ----------------------------------------------------------

async function _loadStatus(apiBase) {
  try {
    const res = await fetch(apiBase + '/status');
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function _loadQuarter(apiBase, qId, showToast) {
  try {
    const res = await fetch(apiBase + '/quarter?id=' + encodeURIComponent(qId));
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast((data.message || 'Failed to load the quarter.'), 'error');
      return null;
    }
    return await res.json();
  } catch {
    showToast('Network error while loading the data.', 'error');
    return null;
  }
}

// What the view paints from, as one comparable string (onDataChanged).
function _snapshotData() {
  try { return JSON.stringify([_quarter, _areas, _tasks, _backlog]); } catch { return null; }
}

async function _refreshData(apiBase, showToast) {
  _status = await _loadStatus(apiBase);
  if (!_status || _status.storage !== 'ok') return;
  const qId = _status.activeQuarter;
  if (!qId) return;
  const q = await _loadQuarter(apiBase, qId, showToast);
  if (!q) return;
  _quarter = q;
  // server returns { id, meta: {weeksN, roster, ...}, areas, tasks, backlog };
  // flatten meta onto _quarter so all read sites (roster, weeksN, ...) work
  if (q && q.meta) Object.assign(_quarter, q.meta);
  _areas   = (q.areas   || []).slice().sort((a, b) => (a.o || 0) - (b.o || 0));
  _tasks   = q.tasks   || [];
  _backlog = q.backlog || [];
}

// ---- API helpers (each re-fetches the whole quarter after a write) ---------

// Every successful write lands in data-tier-ar's gantt-roadmap/ plaintext, so it
// is announced on the core's data bus: the core then repaints the module sync
// bar (new local date, pending files) and calls onDataChanged() below, which
// repaints only when the reloaded quarter differs from what the view already
// shows. Dynamic import keeps this file importable under plain Node.
async function _announceDataWrite() {
  try {
    const ev = await import('/js/data-events.js');
    ev.emitDataChanged({ source: 'gantt-roadmap' });
  } catch { /* the bar catches up on the next view entry */ }
}

function _buildQs(params) {
  if (!params) return '';
  const parts = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v));
  return parts.length ? '?' + parts.join('&') : '';
}

async function _apiPost(apiBase, path, params, body, showToast) {
  try {
    const res = await fetch(apiBase + path + _buildQs(params), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.message || 'Could not save the change.', 'error'); return null; }
    _announceDataWrite();
    return data;
  } catch { showToast('Network error.', 'error'); return null; }
}

async function _apiPut(apiBase, path, params, body, showToast) {
  try {
    const res = await fetch(apiBase + path + _buildQs(params), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.message || 'Could not save the change.', 'error'); return null; }
    _announceDataWrite();
    return data;
  } catch { showToast('Network error.', 'error'); return null; }
}

async function _apiDelete(apiBase, path, params, showToast) {
  try {
    const res = await fetch(apiBase + path + _buildQs(params), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.message || 'Could not delete.', 'error'); return null; }
    _announceDataWrite();
    return data;
  } catch { showToast('Network error.', 'error'); return null; }
}

// ---- Modal helper that captures field values BEFORE the overlay is removed -

/**
 * Open a confirmDsModal that also snapshots the current values of form inputs
 * identified by fieldIds just before the user confirms. Because ds-modal.js
 * removes the overlay from the page before its promise resolves, any
 * document.getElementById(id) call after `await` returns null.
 *
 * @param {object} dsModal  - the loaded ds-modal module
 * @param {object} opts     - same options object as confirmDsModal
 * @param {string[]} fieldIds - ids of form fields (input, select, textarea) inside the modal body
 * @returns {Promise<{ok: boolean, values: Record<string,string>}>}
 */
async function _confirmWithFields(dsModal, opts, fieldIds) {
  const values = {};
  const listeners = [];

  // We need to snapshot field values at the moment OK is clicked (or Enter pressed)
  // and BEFORE the overlay is removed. We do this with a capture-phase click listener
  // on document that fires before the modal's own handler removes the node.
  const snapshot = () => {
    for (const id of fieldIds) {
      const el = document.getElementById(id);
      if (el) values[id] = el.value;
    }
  };

  const onConfirmClick = (e) => {
    if (e.target.closest('[data-confirm-ok]')) snapshot();
  };
  const onKeydown = (e) => {
    if (e.key === 'Enter') {
      // Enter inside a modal input triggers OK; snapshot now
      if (e.target.closest && fieldIds.some((id) => e.target.id === id)) snapshot();
    }
  };

  document.addEventListener('click', onConfirmClick, true);
  document.addEventListener('keydown', onKeydown, true);
  listeners.push(
    () => document.removeEventListener('click', onConfirmClick, true),
    () => document.removeEventListener('keydown', onKeydown, true),
  );

  let ok = false;
  try {
    ok = await dsModal.confirmDsModal(opts);
  } finally {
    listeners.forEach((fn) => fn());
  }
  return { ok, values };
}

// ---- HTML builders ---------------------------------------------------------

function _skeletonHtml() {
  return '<div class="gr-skeleton" data-skel="1">'
    + '<div class="ds-skeleton gr-skeleton-bar" style="width:60%"></div>'
    + '<div class="ds-skeleton gr-skeleton-bar" style="width:90%"></div>'
    + '<div class="ds-skeleton gr-skeleton-bar" style="width:75%"></div>'
    + '<div class="ds-skeleton gr-skeleton-bar" style="width:80%"></div>'
    + '<div class="ds-skeleton gr-skeleton-bar" style="width:50%"></div>'
    + '</div>';
}

function _storageCalloutHtml() {
  return '<div class="gr-storage-callout">'
    + '<div class="ds-callout ds-callout--warning"><div>'
    + '<strong>Team data unavailable.</strong> '
    + 'Pull the Team data source in the Sync window, then refresh the page.'
    + '</div></div></div>';
}

// data-tier-0 is here (possibly still empty) but holds no gantt-roadmap/index.json yet: either the
// quarter was set up on another machine and has not been pulled, or nobody
// has set it up. Both remedies are named; neither runs from the browser.
function _noQuarterCalloutHtml() {
  return '<div class="gr-storage-callout">'
    + '<div class="ds-callout ds-callout--info"><div>'
    + '<strong>The roadmap has no quarter yet.</strong> '
    + 'If someone on the team has already set one up, pull the Team data source in the Sync window. '
    + 'If not, create a quarter in a terminal with <code>node modules/gantt-roadmap/scripts/create-quarter.js --id q1-2027 --monday 2026-12-28 --weeks 13</code> '
    + 'and push the Team data source so the whole team sees it.'
    + '</div></div></div>';
}

function _toolbarHtml(roster, editMode, group, person) {
  const groupBtns = [
    { key: 'area', label: 'Area' },
    { key: 'owner', label: 'Owner' },
    { key: 'none', label: 'No grouping' },
  ].map((g) =>
    '<button type="button" class="ds-segment' + (group === g.key ? ' ds-segment--active' : '')
    + '" data-gr-group="' + g.key + '">' + _esc(g.label) + '</button>'
  ).join('');

  const personOpts = '<option value="">Everybody</option>'
    + (roster || []).map((p) =>
      '<option value="' + _esc(p.id) + '"' + (person === p.id ? ' selected' : '') + '>'
      + _esc(p.n || p.id) + '</option>'
    ).join('');

  const addAreaBtn = (editMode && group === 'area')
    ? '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-gr-add-area="1">+ New area</button>'
    : '';

  // Global "Add task" for owner/none grouping (item 13)
  const addGlobalTaskBtn = (editMode && (group === 'owner' || group === 'none'))
    ? '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-gr-add-global-task="1">+ Add task</button>'
    : '';

  return '<div class="gr-toolbar">'
    + '<div class="ds-segmented" aria-label="Grouping">' + groupBtns + '</div>'
    + '<select class="ds-input gr-person-filter" aria-label="Filter by person" data-gr-person-filter="1">'
    + personOpts + '</select>'
    + '<span class="gr-toolbar-sep"></span>'
    + addGlobalTaskBtn
    + addAreaBtn
    + '</div>';
}

function _ganttHeaderHtml(mondayFirst, weeksN, weekFirstNo, xmasWeek, sprints) {
  const daysN = weeksN * 7;
  const today0 = _todayWeek(mondayFirst, weeksN); // 0-based week index (for header column tint)

  // Month row — day-precision widths (percentage of total gantt area)
  const monthSegsDay = monthSegsByDay(mondayFirst, daysN);
  const monthCells = monthSegsDay.map((seg) => {
    const widthPct = (seg.days / daysN * 100).toFixed(4);
    return '<div class="gr-gantt-month-cell" style="flex:0 0 ' + widthPct + '%;overflow:hidden">'
      + _esc(seg.label) + '</div>';
  }).join('');

  // Week row — grid-based (unchanged)
  const weekCells = Array.from({ length: weeksN }, (_, i) => {
    const wNo = weekFirstNo + i;
    const isToday = i === today0;
    const isXmas = xmasWeek && (i + 1) === xmasWeek;
    const cls = 'gr-gantt-week-cell'
      + (isToday ? ' gr-today-col' : '')
      + (isXmas ? ' gr-xmas-col' : '');
    const date = _weekMondayLabel(mondayFirst, i);
    return '<div class="' + cls + '">'
      + '<span class="gr-week-no">' + weekLabel(wNo) + '</span>'
      + '<span class="gr-week-date">' + date + '</span>'
      + '</div>';
  }).join('');

  // Sprint row — day-precision absolute positioning within a relative band
  let sprintBandHtml = '';
  if (sprints && sprints.length) {
    const segs = sprintSegs(mondayFirst, daysN, sprints);
    sprintBandHtml = segs.map((seg) => {
      const leftPct = (seg.startDay / daysN * 100).toFixed(4);
      const widthPct = (seg.days / daysN * 100).toFixed(4);
      return '<div class="gr-gantt-sprint-abs-cell" style="left:' + leftPct + '%;width:' + widthPct + '%">'
        + _esc(seg.label) + '</div>';
    }).join('');
  }

  return '<div class="gr-gantt-head" style="--gr-weeks:' + weeksN + '">'
    + '<div class="gr-gantt-month-row">'
    + '<div class="gr-gantt-label-cell">Task</div>'
    + '<div class="gr-gantt-month-band">' + monthCells + '</div>'
    + '</div>'
    + '<div class="gr-gantt-row">'
    + '<div class="gr-gantt-label-cell">Week</div>'
    // Week cells wrapped so the header uses the same 2-column template as body rows
    + '<div class="gr-gantt-weeks-inner">' + weekCells + '</div>'
    + '</div>'
    + (sprintBandHtml
      ? '<div class="gr-gantt-month-row">'
        + '<div class="gr-gantt-label-cell" style="font-size:var(--text-2xs);color:var(--body-tertiary-text)">Sprint</div>'
        + '<div class="gr-gantt-sprint-band">' + sprintBandHtml + '</div>'
        + '</div>'
      : '')
    + '</div>';
}

function _laneBackgroundHtml(weeksN, xmasWeek, todayLinePct) {
  const cells = Array.from({ length: weeksN }, (_, i) => {
    const isXmas = xmasWeek && (i + 1) === xmasWeek;
    return '<div class="gr-lane-bg-cell' + (isXmas ? ' gr-xmas-col' : '') + '"></div>';
  }).join('');
  const todayLine = todayLinePct >= 0
    ? '<div class="gr-today-line" style="left:' + todayLinePct.toFixed(2) + '%" aria-hidden="true"></div>'
    : '';
  return '<div class="gr-lane-bg" style="--gr-weeks:' + weeksN + '">' + cells + '</div>' + todayLine;
}

function _barStyle(s, l, weeksN) {
  const pct = 100 / weeksN;
  const left = (s - 1) * pct;
  const width = l * pct;
  return 'left:' + left + '%;width:' + width + '%;';
}

function _taskBarHtml(task, areaColorKey, editMode, weeksN) {
  const area = AREA_COLORS.includes(areaColorKey) ? areaColorKey : 'gray';
  const colorCls = 'gr-area--' + area;
  const GAP_PX = 3; // visual gap between consecutive phase bars

  if (task.ms) {
    // Milestone: diamond — tooltip shows only task name
    const left = (task.s - 1) * (100 / weeksN);
    return '<div class="gr-bar gr-milestone ' + colorCls + '" '
      + 'style="left:' + left + '%;" '
      + 'data-gr-task="' + _esc(task.uid) + '" '
      + 'title="' + _esc(task.t || '') + '">'
      + '</div>';
  }

  if (task.ph && task.ph.length) {
    // Phase bars — each rendered as its own bar (same style as single-phase),
    // no envelope wrapper, with a small gap between consecutive bars.
    const lanes = phaseLanes(task.ph);
    const barH = 26;
    const laneGap = 3;

    let phaseBarsHtml = '';
    task.ph.forEach((ph, idx) => {
      const lane = lanes[idx];
      const top = 9 + lane * (barH + laneGap);
      // calc() adds pixel gap on each side to create visual separation
      const leftExpr = 'calc(' + ((ph.s - 1) * 100 / weeksN).toFixed(4) + '% + ' + GAP_PX + 'px)';
      const widthExpr = 'calc(' + (ph.l * 100 / weeksN).toFixed(4) + '% - ' + (GAP_PX * 2) + 'px)';
      const style = 'left:' + leftExpr + ';width:' + widthExpr + ';top:' + top + 'px;height:' + barH + 'px;';
      const handleHtml = editMode
        ? '<div class="gr-bar-handle gr-bar-handle-l" data-gr-phase-drag="l" data-gr-phase-idx="' + idx + '" data-gr-task="' + _esc(task.uid) + '"></div>'
          + '<div class="gr-bar-handle gr-bar-handle-r" data-gr-phase-drag="r" data-gr-phase-idx="' + idx + '" data-gr-task="' + _esc(task.uid) + '"></div>'
        : '';
      // tooltip: phase name only (no week range, no ARxx)
      phaseBarsHtml += '<div class="gr-phase-bar ' + colorCls + '" '
        + 'style="' + style + '" '
        + 'data-gr-task="' + _esc(task.uid) + '" '
        + 'data-gr-phase-bar="' + idx + '" '
        + 'title="' + _esc(ph.n || task.t || '') + '">'
        + handleHtml
        + '<span class="gr-phase-bar-label">' + _esc(ph.n || '') + '</span>'
        + '</div>';
    });

    return phaseBarsHtml;
  }

  // Simple bar — label and tooltip show only task title (no ARxx prefix)
  const style = _barStyle(task.s, task.l, weeksN);
  const dragHandle = editMode
    ? '<div class="gr-bar-handle gr-bar-handle-l" data-gr-drag="l" data-gr-task="' + _esc(task.uid) + '"></div>'
      + '<div class="gr-bar-handle gr-bar-handle-r" data-gr-drag="r" data-gr-task="' + _esc(task.uid) + '"></div>'
    : '';
  return '<div class="gr-bar ' + colorCls + '" style="' + style + '" '
    + 'data-gr-task="' + _esc(task.uid) + '" '
    + 'title="' + _esc(task.t || '') + '">'
    + dragHandle
    + '<span class="gr-bar-label">' + _esc(task.t || '') + '</span>'
    + '</div>';
}

function _taskRowHtml(task, area, editMode, weeksN, roster, teamDir, todayLinePct, xmasWeek) {
  const areaColor = area ? area.color : 'gray';
  const colorCls = _areaClass(areaColor);

  // Avatars (first 3)
  const whoToShow = (task.who || []).slice(0, 3);
  const avatarsHtml = whoToShow.map((id) => _avatarHtml(id, roster, teamDir)).join('');
  const moreAvatars = (task.who || []).length > 3
    ? '<span class="gr-avatar" title="' + ((task.who.length - 3) + ' more') + '">+' + (task.who.length - 3) + '</span>'
    : '';

  // Compute lane height: taller bars (26px) with gap (3px) and padding (18px top)
  let laneH = 44;
  if (task.ph && task.ph.length) {
    const lanes = phaseLanes(task.ph);
    const maxLane = Math.max(...lanes);
    laneH = Math.max(44, (maxLane + 1) * 26 + maxLane * 3 + 18);
  }

  return '<div class="gr-task-row ' + colorCls + '" data-gr-task-row="' + _esc(task.uid) + '">'
    + '<div class="gr-task-label">'
    + '<span class="gr-task-n">' + _esc(_displayN(task)) + '</span>'
    + '<span class="gr-task-title" title="' + _esc(task.t || '') + '">' + _esc(task.t || '') + '</span>'
    + '<span class="gr-task-avatars">' + avatarsHtml + moreAvatars + '</span>'
    + '</div>'
    + '<div class="gr-lane ' + colorCls + '" style="--gr-weeks:' + weeksN + ';min-height:' + laneH + 'px" data-gr-lane="' + _esc(task.uid) + '">'
    + '<div class="gr-lane-inner" style="height:' + laneH + 'px">'
    + _laneBackgroundHtml(weeksN, xmasWeek, todayLinePct)
    + _taskBarHtml(task, areaColor, editMode, weeksN)
    + '</div>'
    + '</div>'
    + '</div>';
}

function _groupHtml(group, areas, _tasks, weeksN, mondayFirst, xmasWeek, editMode, collapsed, roster, teamDir) {
  const todayLinePct = _todayLinePct(mondayFirst, weeksN);
  void _todayWeek; // todayWeek removed: today column tint dropped, line used instead
  const isCollapsed = collapsed[group.key];
  const area = areas.find((a) => 'area:' + a.id === group.key);
  const areaColor = area ? area.color : 'gray';
  const colorCls = _areaClass(areaColor);

  const collapseIcon = isCollapsed ? '▶' : '▼';
  const addTaskBtn = (editMode && area)
    ? '<button type="button" class="ds-btn ds-btn--sm ds-btn--secondary" '
      + 'data-gr-add-task="' + _esc(area.id) + '" aria-label="Add a task to area ' + _esc(group.label) + '">'
      + '+ Add task</button>'
    : '';
  const editAreaBtn = (editMode && area)
    ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" '
      + 'data-gr-edit-area="' + _esc(area.id) + '" aria-label="Edit area ' + _esc(group.label) + '">✎</button>'
    : '';

  const noteHtml = (area && area.note && !isCollapsed)
    ? '<div class="gr-group-note">' + _esc(area.note) + '</div>'
    : '';

  let bodyHtml = '';
  if (isCollapsed) {
    // Envelope bar for collapsed group
    const groupTasks = group.tasks;
    if (groupTasks.length) {
      const minS = Math.min(...groupTasks.map((t) => (t.ph && t.ph.length ? envelope(t).s : t.s)));
      const maxE = Math.max(...groupTasks.map((t) => {
        const e = t.ph && t.ph.length ? envelope(t) : { s: t.s, l: t.l };
        return e.s + e.l - 1;
      }));
      const envL = maxE - minS + 1;
      const style = _barStyle(minS, envL, weeksN);
      bodyHtml = '<div class="gr-group-envelope-row ' + colorCls + '">'
        + '<div class="gr-group-envelope-label">' + _esc(groupTasks.length + ' tasks') + '</div>'
        + '<div class="gr-lane" style="--gr-weeks:' + weeksN + ';height:28px">'
        + '<div class="gr-lane-inner" style="height:28px">'
        + _laneBackgroundHtml(weeksN, xmasWeek, todayLinePct)
        + '<div class="gr-bar ' + colorCls + '" style="' + style + 'height:16px;top:6px;opacity:0.5"></div>'
        + '</div></div></div>';
    }
  } else {
    bodyHtml = group.tasks.map((t) =>
      _taskRowHtml(t, area, editMode, weeksN, roster, teamDir, todayLinePct, xmasWeek)
    ).join('');
  }

  return '<div class="gr-group-header ' + colorCls + '" data-gr-group-key="' + _esc(group.key) + '">'
    + '<div class="gr-group-header-label">'
    + '<span class="gr-group-color-dot"></span>'
    + '<button type="button" class="ds-btn gr-group-collapse-btn" data-gr-collapse="' + _esc(group.key) + '" aria-expanded="' + (!isCollapsed) + '" aria-label="' + (isCollapsed ? 'Expand' : 'Collapse') + ' group ' + _esc(group.label) + '">'
    + _esc(collapseIcon) + '</button>'
    + '<span>' + _esc(group.label) + '</span>'
    + '<span style="color:var(--body-tertiary-text);font-weight:400;font-size:var(--text-xs);margin-left:4px">(' + group.tasks.length + ')</span>'
    + '</div>'
    + '<div class="gr-group-header-actions">'
    + addTaskBtn + editAreaBtn
    + '</div>'
    + '</div>'
    + (noteHtml ? '<div>' + noteHtml + '</div>' : '')
    + bodyHtml;
}

function _ganttBodyHtml(tasks, areas, roster, teamDir, weeksN, mondayFirst, xmasWeek, editMode, group, person, collapsed) {
  // Filter tasks
  let filtered = tasks;
  if (person) filtered = filtered.filter((t) => (t.who || []).includes(person));

  const groups = groupsOf(filtered, areas, roster || [], group);

  if (!groups.length || groups.every((g) => !g.tasks.length)) {
    return '<div style="padding:var(--space-32);text-align:center;color:var(--body-tertiary-text);font-size:var(--text-sm)">No tasks match the filter.</div>';
  }

  return groups.map((g) =>
    _groupHtml(g, areas, tasks, weeksN, mondayFirst, xmasWeek, editMode, collapsed, roster, teamDir)
  ).join('');
}

function _backlogHtml(backlog, editMode, open) {
  const toggleIcon = open ? '▼' : '▶';
  const count = backlog.length;

  let listHtml = '';
  if (open) {
    listHtml = '<div class="gr-backlog-list">'
      + backlog.map((item) =>
        '<div class="gr-backlog-item" data-gr-bl-item="' + _esc(item.uid) + '">'
        + '<span class="gr-backlog-title" data-gr-bl-title="' + _esc(item.uid) + '">' + _esc(item.t || '') + '</span>'
        + '<span class="gr-backlog-actions">'
        + (editMode
          ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" '
            + 'data-gr-bl-promote="' + _esc(item.uid) + '" aria-label="Add to the roadmap: ' + _esc(item.t) + '">'
            + 'Add to the roadmap</button>'
          : '')
        + (editMode
          ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" '
              + 'data-gr-bl-edit="' + _esc(item.uid) + '" aria-label="Edit item">✎</button>'
            + '<button type="button" class="ds-btn ds-btn--danger ds-btn--sm" '
              + 'data-gr-bl-delete="' + _esc(item.uid) + '" aria-label="Delete item">🗑</button>'
          : '')
        + '</span>'
        + '</div>'
      ).join('')
      + '</div>';

    if (editMode) {
      listHtml += '<div class="gr-backlog-add-row">'
        + '<input type="text" class="ds-input" placeholder="New item…" id="gr-bl-new-input" aria-label="New backlog item" maxlength="200">'
        + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-gr-bl-add="1">Save</button>'
        + '</div>';
    }
  }

  return '<div class="gr-backlog" id="gr-backlog-section">'
    + '<div class="ds-section-head">'
    + '<h2 class="ds-section-head-title">'
    + '<button type="button" class="ds-btn gr-group-collapse-btn" data-gr-bl-toggle="1" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' backlog">'
    + toggleIcon + '</button>'
    + ' Backlog <span style="color:var(--body-tertiary-text);font-size:var(--text-sm);font-weight:400">(' + count + ')</span>'
    + '</h2>'
    + '</div>'
    + listHtml
    + '</div>';
}

// ---- Drawer ----------------------------------------------------------------

function _drawerHtml(task, areas, weeksN, roster, editMode) {
  if (!task) return '<div class="gr-drawer" id="gr-drawer" aria-label="Task panel"></div>';

  const isMilestone = Boolean(task.ms);
  const hasPhases = !isMilestone && task.ph && task.ph.length > 0;

  // Area select
  const areaOpts = areas.map((a) =>
    '<option value="' + _esc(a.id) + '"' + (a.id === task.a ? ' selected' : '') + '>'
    + _esc(a.name) + '</option>'
  ).join('');


  // Milestone segmented
  const msBtns = [
    { val: 'false', label: 'Task' },
    { val: 'true', label: 'Milestone' },
  ].map((b) =>
    '<button type="button" class="ds-segment' + (String(isMilestone) === b.val ? ' ds-segment--active' : '')
    + '" data-gr-drawer-ms="' + b.val + '">' + b.label + '</button>'
  ).join('');

  // Phases section
  let phasesHtml = '';
  if (!isMilestone) {
    if (hasPhases) {
      const phItems = (task.ph || []).map((ph, i) =>
        '<div class="gr-phase-item">'
        + '<div class="gr-phase-item-row">'
        + '<input type="text" class="ds-input" value="' + _esc(ph.n || '') + '" '
          + 'placeholder="Phase name" maxlength="60" '
          + 'data-gr-phase-name="' + i + '" aria-label="Phase name ' + (i + 1) + '">'
        + '<button type="button" class="ds-btn ds-btn--danger ds-btn--sm" '
          + 'data-gr-phase-del="' + i + '" aria-label="Delete phase ' + (i + 1) + '">Delete</button>'
        + '</div>'
        + (function() {
            const { from: phFrom, to: phTo } = slToRange(ph.s, ph.l || 1, _weekFirstNo);
            const wMin = _weekFirstNo;
            const wMax = _weekFirstNo + _weeksNGlobal - 1;
            return '<div class="gr-phase-item-weeks">'
              + '<label style="font-size:var(--text-xs)">From week'
              + '<input type="number" class="ds-input" value="' + phFrom + '" min="' + wMin + '" max="' + wMax + '" data-gr-phase-wfrom="' + i + '" aria-label="Phase ' + (i + 1) + ' start week (ISO)">'
              + '</label>'
              + '<label style="font-size:var(--text-xs)">To week'
              + '<input type="number" class="ds-input" value="' + phTo + '" min="' + wMin + '" max="' + wMax + '" data-gr-phase-wto="' + i + '" aria-label="Phase ' + (i + 1) + ' end week (ISO)">'
              + '</label>'
              + '</div>';
          })()
        + '</div>'
      ).join('');
      phasesHtml = '<div class="gr-drawer-field">'
        + '<div class="gr-drawer-field-label">Phases</div>'
        + '<div class="gr-phase-list" id="gr-phase-list">' + phItems + '</div>'
        + '<div class="ds-actions" style="margin-top:var(--space-8)">'
        + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-gr-phase-add="1">+ Add phase</button>'
        + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-gr-phase-merge="1">Merge into one task</button>'
        + '</div></div>';
    } else {
      phasesHtml = '<div class="gr-drawer-field">'
        + '<div class="ds-actions">'
        + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-gr-phase-split="1">Split into phases</button>'
        + '</div></div>';
    }
  }

  // People section: teams grouped
  const teamOrder = (_quarter && _quarter.teamOrder) ? _quarter.teamOrder : [];
  const teamLabel = (_quarter && _quarter.teamLabel) ? _quarter.teamLabel : {};
  const rosterByTeam = {};
  (roster || []).forEach((p) => {
    const team = p.team || 'Other';
    if (!rosterByTeam[team]) rosterByTeam[team] = [];
    rosterByTeam[team].push(p);
  });

  const whoSet = new Set(task.who || []);
  const teams = teamOrder.filter((t) => rosterByTeam[t]);
  const otherTeams = Object.keys(rosterByTeam).filter((t) => !teamOrder.includes(t));

  const buildTeamChips = (teamKey) =>
    '<div class="gr-person-team-label">' + _esc(teamLabel[teamKey] || teamKey) + '</div>'
    + '<div class="gr-person-chips">'
    + (rosterByTeam[teamKey] || []).map((p) => {
        const isOwner = task.who && task.who[0] === p.id;
        const isSelected = whoSet.has(p.id);
        const shortName = p.s || (p.n ? p.n.split(' ')[0] : p.id);
        return '<button type="button" class="ds-btn gr-person-chip' + (isSelected ? ' gr-person-chip--selected' : '') + '" '
          + 'data-gr-person-toggle="' + _esc(p.id) + '" '
          + 'title="' + _esc(p.n || p.id) + (p.team ? ' · ' + _esc(p.team) : '') + '" '
          + 'aria-label="' + (isSelected ? 'Remove' : 'Add') + ' ' + _esc(p.n || p.id) + '">'
          + _avatarHtml(p.id, roster, _teamDir)
          + '<span class="gr-person-chip-name">' + _esc(shortName) + '</span>'
          + (isOwner ? '<span class="gr-owner-dot" title="Owner" aria-label="Owner" style="font-size:9px;font-weight:700;color:var(--body-brand-text)">★</span>' : '')
          + '</button>';
      }).join('')
    + '</div>';

  const allTeamHtml = [...teams, ...otherTeams].map(buildTeamChips).join('');

  // Assigned people list
  const assignedHtml = (task.who || []).length
    ? '<div class="gr-assigned-list">'
      + (task.who || []).map((id, idx) => {
          const p = (roster || []).find((r) => r.id === id);
          return '<div class="gr-assigned-row">'
            + _avatarHtml(id, roster, _teamDir)
            + '<span class="gr-assigned-name">' + _esc(p ? p.n : id) + '</span>'
            + (idx === 0 ? '<span class="gr-assigned-badge">Owner</span>' : '')
            + (idx > 0
                ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" '
                  + 'data-gr-set-owner="' + _esc(id) + '" aria-label="Make ' + _esc(p ? p.n : id) + ' the owner">Owner</button>'
                : '')
            + '</div>';
        }).join('')
      + '</div>'
    : '<div style="color:var(--body-tertiary-text);font-size:var(--text-xs)">Nobody assigned.</div>';

  return '<div class="gr-drawer gr-drawer--open" id="gr-drawer" role="dialog" aria-modal="true" aria-labelledby="gr-drawer-title">'
    + '<div class="gr-drawer-header">'
    + '<span class="gr-drawer-header-n">' + _esc(_displayN(task)) + '</span>'
    + '<span id="gr-drawer-title" style="font-size:var(--text-sm);font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
    + _esc(task.t || '') + '</span>'
    + '<button type="button" class="ds-btn gr-drawer-close" data-gr-drawer-close="1" aria-label="Close the panel">'
    + '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
    + '<path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    + '</svg>'
    + '</button>'
    + '</div>'
    + '<div class="gr-drawer-body">'

    // Title + order buttons (edit-only order buttons)
    + '<div class="gr-drawer-field">'
    + '<div class="gr-drawer-field-label">Title</div>'
    + '<div class="gr-drawer-title-row">'
    + (editMode
      ? '<input type="text" id="gr-drawer-title-input" class="ds-input" value="' + _esc(task.t || '') + '" maxlength="200" aria-label="Task title">'
        + '<div class="gr-drawer-order-btns">'
        + '<button type="button" class="ds-btn gr-order-btn" data-gr-order="up" aria-label="Move the task up">▲</button>'
        + '<button type="button" class="ds-btn gr-order-btn" data-gr-order="down" aria-label="Move the task down">▼</button>'
        + '</div>'
      : '<span style="font-size:var(--text-sm);font-weight:500">' + _esc(task.t || '') + '</span>')
    + '</div>'
    + '</div>'

    // Area
    + '<div class="gr-drawer-field">'
    + '<div class="gr-drawer-field-label">Area</div>'
    + (editMode
      ? '<select class="ds-input" id="gr-drawer-area" aria-label="Task area">' + areaOpts + '</select>'
      : '<span style="font-size:var(--text-sm)">' + _esc((areas.find((a) => a.id === task.a) || {}).name || task.a || '—') + '</span>')
    + '</div>'

    // Milestone (edit-only segmented; view shows badge or nothing)
    + (editMode
      ? '<div class="gr-drawer-field">'
        + '<div class="gr-drawer-field-label">Typ</div>'
        + '<div class="ds-segmented" aria-label="Task type">' + msBtns + '</div>'
        + '</div>'
      : (isMilestone
          ? '<div class="gr-drawer-field"><span class="ds-badge">Milestone</span></div>'
          : ''))

    // Weeks / timing — ISO week numbers (e.g. W40–W42)
    + (function() {
        const { from: wFrom, to: wTo } = slToRange(task.s, task.l || 1, _weekFirstNo);
        const wMin = _weekFirstNo;
        const wMax = _weekFirstNo + _weeksNGlobal - 1;
        if (isMilestone) {
          return '<div class="gr-drawer-field">'
            + '<div class="gr-drawer-field-label">Week</div>'
            + (editMode
              ? '<input type="number" id="gr-drawer-wfrom" class="ds-input" value="' + wFrom + '" min="' + wMin + '" max="' + wMax + '" aria-label="Milestone week (ISO)">'
              : '<span style="font-size:var(--text-sm)">W' + wFrom + '</span>')
            + '</div>';
        }
        return '<div class="gr-drawer-field">'
          + '<div class="gr-drawer-field-label">Tygodnie</div>'
          + (editMode
            ? '<div class="gr-drawer-weeks-row">'
              + '<label style="font-size:var(--text-xs)">From week'
              + '<input type="number" id="gr-drawer-wfrom" class="ds-input" value="' + wFrom + '" min="' + wMin + '" max="' + wMax + '" aria-label="Start week (ISO)">'
              + '</label>'
              + '<label style="font-size:var(--text-xs)">To week'
              + '<input type="number" id="gr-drawer-wto" class="ds-input" value="' + wTo + '" min="' + wMin + '" max="' + wMax + '" aria-label="End week (ISO)">'
              + '</label>'
              + '</div>'
            : '<span style="font-size:var(--text-sm)">W' + wFrom + ' – W' + wTo + '</span>')
          + '</div>';
      })()

    // Phases (edit-only)
    + (editMode ? phasesHtml : (hasPhases
        ? '<div class="gr-drawer-field"><div class="gr-drawer-field-label">Phases</div>'
          + '<div style="font-size:var(--text-sm);color:var(--body-secondary-text)">' + (task.ph || []).length + ' phase(s)</div></div>'
        : ''))

    // People
    + '<hr class="gr-drawer-sep">'
    + '<div class="gr-drawer-field">'
    + '<div class="gr-drawer-field-label">Assigned people</div>'
    + assignedHtml
    + '</div>'
    + (editMode
      ? '<div class="gr-drawer-field">'
        + '<div class="gr-drawer-field-label">Add people</div>'
        + '<div class="gr-person-picker">' + allTeamHtml + '</div>'
        + '</div>'
      : '')

    + '</div>' // end gr-drawer-body

    // Footer — only in edit mode
    + (editMode
      ? '<div class="gr-drawer-footer">'
        + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-gr-demote="' + _esc(task.uid) + '">Move to backlog</button>'
        + '<button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-gr-delete="' + _esc(task.uid) + '">Delete task</button>'
        + '</div>'
      : '')
    + '</div>';
}

// ---- Area modal ------------------------------------------------------------

function _areaModalBodyHtml(area, isNew) {
  const colorChips = AREA_COLORS.map((c) =>
    '<button type="button" class="ds-btn gr-color-chip' + (area.color === c ? ' gr-color-chip--active' : '') + '" '
    + 'data-gr-color="' + c + '" aria-label="Colour ' + c + '">'
    + '<div class="gr-color-chip-inner gr-area--' + c + '" style="background:var(--gr-area-bg);border:2px solid var(--gr-area-fg)"></div></button>'
  ).join('');

  const deleteBtn = !isNew
    ? '<div class="gr-drawer-field" style="margin-top:var(--space-8);border-top:1px solid var(--border-default);padding-top:var(--space-12)">'
      + '<button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-gr-delete-area="1" aria-label="Delete area ' + _esc(area.name || '') + '">'
      + 'Delete area'
      + '</button>'
      + '<span style="font-size:var(--text-xs);color:var(--body-tertiary-text);margin-left:var(--space-8)">Only when the area has no tasks.</span>'
      + '</div>'
    : '';

  return '<div style="display:flex;flex-direction:column;gap:var(--space-12)">'
    + '<div class="gr-drawer-field">'
    + '<div class="gr-drawer-field-label">Area name</div>'
    + '<input type="text" class="ds-input" id="gr-area-name" value="' + _esc(area.name || '') + '" maxlength="100" aria-label="Area name">'
    + '</div>'
    + '<div class="gr-drawer-field">'
    + '<div class="gr-drawer-field-label">Note</div>'
    + '<input type="text" class="ds-input" id="gr-area-note" value="' + _esc(area.note || '') + '" maxlength="200" aria-label="Area note">'
    + '</div>'
    + '<div class="gr-drawer-field">'
    + '<div class="gr-drawer-field-label">Colour</div>'
    + '<div class="gr-color-palette" id="gr-color-palette">' + colorChips + '</div>'
    + '<input type="hidden" id="gr-area-color" value="' + _esc(area.color || 'blue') + '">'
    + '</div>'
    + deleteBtn
    + '</div>';
}

// ---- Main render -----------------------------------------------------------

function _buildView(root, actions, quarter, areas, tasks, backlog, roster, teamDir, weeksN, editMode) {
  const mondayFirst = quarter.mondayFirst || '2026-09-21';
  const weekFirstNo = quarter.weekFirstNo || 39;
  const xmasWeek = quarter.xmasWeek || null;
  const sprints = quarter.sprints || [];
  // Store for _drawerHtml closure access
  _weekFirstNo = weekFirstNo;
  _weeksNGlobal = weeksN;

  root.innerHTML =
    '<div class="gr-root' + (editMode ? ' gr-edit' : '') + '" id="gr-root-inner">'
    + _toolbarHtml(roster, editMode, _uiGroup, _uiPerson)
    + '<div class="gr-gantt-wrap">'
    + '<div class="gr-gantt" style="--gr-weeks:' + weeksN + '">'
    + _ganttHeaderHtml(mondayFirst, weeksN, weekFirstNo, xmasWeek, sprints)
    + '<div class="gr-gantt-body" id="gr-gantt-body">'
    + _ganttBodyHtml(tasks, areas, roster, teamDir, weeksN, mondayFirst, xmasWeek, editMode, _uiGroup, _uiPerson, _collapsed)
    + '</div>'
    + '</div>'
    + '</div>'
    + _backlogHtml(backlog, editMode, _backlogOpen)
    + '</div>';

  // Inject drawer (outside gr-root-inner so it's fixed)
  const existing = document.getElementById('gr-drawer');
  if (existing) existing.remove();
  const drawerEl = document.createElement('div');
  drawerEl.innerHTML = _drawerHtml(
    _drawerUid ? tasks.find((t) => t.uid === _drawerUid) : null,
    areas, weeksN, roster, editMode
  );
  document.body.appendChild(drawerEl.firstElementChild);
}

// ---- Event handlers --------------------------------------------------------

async function _handleClick(e, apiBase, showToast) {
  const qId = _status && _status.activeQuarter;
  if (!qId) return;

  // -- Toolbar: group switch
  const groupBtn = e.target.closest('[data-gr-group]');
  if (groupBtn) {
    _uiGroup = groupBtn.dataset.arGroup;
    _reRenderBody();
    return;
  }

  // -- Toolbar: add area
  if (e.target.closest('[data-gr-add-area]')) {
    await _openAreaModal(null, apiBase, showToast, qId);
    await _refreshData(apiBase, showToast);
    _reRenderAll(apiBase, showToast);
    return;
  }

  // -- Toolbar: export HTML
  if (e.target.closest('[data-gr-export-html]')) {
    await _doExportHtml(showToast);
    return;
  }

  // -- Toolbar: global "Add task" (owner/none grouping, edit mode, item 13)
  if (e.target.closest('[data-gr-add-global-task]') && _uiEdit) {
    if (!_dsModal) return;
    const areaOpts = _areas.map((a) =>
      '<option value="' + _esc(a.id) + '">' + _esc(a.name) + '</option>'
    ).join('');
    const { ok, values: gFields } = await _confirmWithFields(_dsModal, {
      title: 'New task',
      bodyHtml: '<div style="display:flex;flex-direction:column;gap:var(--space-8)">'
        + '<label style="font-size:var(--text-sm)">Title<br>'
        + '<input type="text" class="ds-input" id="gr-global-task-title" value="New task" maxlength="200" aria-label="New task title" style="width:100%;margin-top:4px"></label>'
        + '<label style="font-size:var(--text-sm)">Area<br>'
        + '<select class="ds-input" id="gr-global-task-area" style="margin-top:4px">' + areaOpts + '</select>'
        + '</label></div>',
      okLabel: 'Add',
      cancelLabel: 'Cancel',
      trigger: e.target.closest('[data-gr-add-global-task]'),
    }, ['gr-global-task-title', 'gr-global-task-area']);
    if (!ok) return;
    const title = (gFields['gr-global-task-title'] || '').trim() || 'New task';
    const areaId = gFields['gr-global-task-area'] || (_areas[0] && _areas[0].id);
    if (!areaId) return;
    const task = await _apiPost(apiBase, '/task', { qid: qId }, { a: areaId, t: title }, showToast);
    if (!task) return;
    await _refreshData(apiBase, showToast);
    _drawerUid = task.uid;
    _reRenderAll(apiBase, showToast);
    return;
  }

  // -- Group collapse
  const collapseBtn = e.target.closest('[data-gr-collapse]');
  if (collapseBtn) {
    const key = collapseBtn.dataset.arCollapse;
    _collapsed[key] = !_collapsed[key];
    _reRenderBody();
    return;
  }

  // -- Add task (in group)
  const addTaskBtn = e.target.closest('[data-gr-add-task]');
  if (addTaskBtn && _uiEdit) {
    const areaId = addTaskBtn.dataset.arAddTask;
    let title = 'New task';
    if (_dsModal) {
      const { ok, values: tFields } = await _confirmWithFields(_dsModal, {
        title: 'New task in area ' + ((_areas.find((a) => a.id === areaId) || {}).name || areaId),
        bodyHtml: '<input type="text" class="ds-input" id="gr-new-task-title" value="New task" maxlength="200" aria-label="New task title" style="width:100%">',
        okLabel: 'Add',
        cancelLabel: 'Cancel',
        trigger: addTaskBtn,
      }, ['gr-new-task-title']);
      if (!ok) return;
      title = (tFields['gr-new-task-title'] || '').trim() || 'New task';
    }
    const task = await _apiPost(apiBase, '/task', { qid: qId }, { a: areaId, t: title }, showToast);
    if (!task) return;
    await _refreshData(apiBase, showToast);
    _drawerUid = task.uid;
    _reRenderAll(apiBase, showToast);
    return;
  }

  // -- Edit area modal
  const editAreaBtn = e.target.closest('[data-gr-edit-area]');
  if (editAreaBtn && _uiEdit) {
    const areaId = editAreaBtn.dataset.arEditArea;
    const foundArea = _areas.find((a) => a.id === areaId);
    await _openAreaModal(foundArea, apiBase, showToast, qId);
    await _refreshData(apiBase, showToast);
    _reRenderAll(apiBase, showToast);
    return;
  }

  // -- Task bar / row click -> open drawer
  const taskEl = e.target.closest('[data-gr-task]');
  if (taskEl && !e.target.closest('[data-gr-drag]') && !e.target.closest('[data-gr-phase-drag]')) {
    const uid = taskEl.dataset.ganttTask;
    _drawerUid = _drawerUid === uid ? null : uid;
    _updateDrawer();
    return;
  }

  // -- Task row click -> open drawer
  const taskRow = e.target.closest('[data-gr-task-row]');
  if (taskRow && !e.target.closest('[data-gr-task]') && !e.target.closest('button') && !e.target.closest('input')) {
    const uid = taskRow.dataset.arTaskRow;
    _drawerUid = _drawerUid === uid ? null : uid;
    _updateDrawer();
    return;
  }

  // ---- Drawer interactions --------------------------------------------------

  // -- Close drawer
  if (e.target.closest('[data-gr-drawer-close]')) {
    _drawerUid = null;
    _updateDrawer();
    return;
  }

  // -- Drawer: milestone toggle
  const msBtn = e.target.closest('[data-gr-drawer-ms]');
  if (msBtn) {
    const ms = msBtn.dataset.arDrawerMs === 'true';
    await _putTask(apiBase, qId, _drawerUid, { ms }, showToast);
    return;
  }

  // -- Drawer: phase delete
  const phDelBtn = e.target.closest('[data-gr-phase-del]');
  if (phDelBtn) {
    const idx = parseInt(phDelBtn.dataset.arPhaseDel, 10);
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task || !task.ph) return;
    const newPh = task.ph.filter((_, i) => i !== idx);
    await _putTask(apiBase, qId, _drawerUid, { ph: newPh.length ? newPh : null }, showToast);
    return;
  }

  // -- Drawer: add phase
  if (e.target.closest('[data-gr-phase-add]')) {
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task) return;
    const curPh = task.ph || [];
    const lastEnd = curPh.length ? curPh[curPh.length - 1].s + curPh[curPh.length - 1].l : task.s;
    const weeksN = (_quarter && _quarter.weeksN) || 14;
    const newPh = [...curPh, { n: 'New phase', s: Math.min(lastEnd, weeksN), l: 2 }];
    await _putTask(apiBase, qId, _drawerUid, { ph: newPh }, showToast);
    return;
  }

  // -- Drawer: split to phases (Z12)
  if (e.target.closest('[data-gr-phase-split]')) {
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task) return;
    const half = Math.floor(task.l / 2) || 1;
    const ph = [
      { n: 'Analiza', s: task.s, l: half },
      { n: 'Realizacja', s: task.s + half, l: task.l - half || 1 },
    ];
    await _putTask(apiBase, qId, _drawerUid, { ph }, showToast);
    return;
  }

  // -- Drawer: merge phases (Z13)
  if (e.target.closest('[data-gr-phase-merge]')) {
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task || !task.ph) return;
    const env = envelope(task);
    await _putTask(apiBase, qId, _drawerUid, { ph: null, s: env.s, l: env.l }, showToast);
    return;
  }

  // -- Drawer: person toggle (Z14/Z15)
  const personChip = e.target.closest('[data-gr-person-toggle]');
  if (personChip) {
    const pid = personChip.dataset.arPersonToggle;
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task) return;
    const who = [...(task.who || [])];
    const idx = who.indexOf(pid);
    if (idx >= 0) who.splice(idx, 1);
    else who.push(pid);
    await _putTask(apiBase, qId, _drawerUid, { who }, showToast);
    return;
  }

  // -- Drawer: set owner (Z16)
  const setOwnerBtn = e.target.closest('[data-gr-set-owner]');
  if (setOwnerBtn) {
    const pid = setOwnerBtn.dataset.arSetOwner;
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task) return;
    const who = [...(task.who || [])].filter((id) => id !== pid);
    who.unshift(pid);
    await _putTask(apiBase, qId, _drawerUid, { who }, showToast);
    return;
  }

  // -- Drawer: order up/down (Z20)
  const orderBtn = e.target.closest('[data-gr-order]');
  if (orderBtn) {
    const dir = orderBtn.dataset.arOrder;
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task) return;
    await _swapTaskOrder(apiBase, qId, _drawerUid, dir, showToast);
    return;
  }

  // -- Drawer: demote to backlog (Z22) — edit mode only
  const demoteBtn = e.target.closest('[data-gr-demote]');
  if (demoteBtn && _dsModal && _uiEdit) {
    const uid = demoteBtn.dataset.arDemote;
    const task = _tasks.find((t) => t.uid === uid);
    const ok = await _dsModal.confirmDsModal({
      title: 'Move to the backlog?',
      body: 'The task "' + (task ? task.t : '') + '" will be moved to the backlog.',
      okLabel: 'Move',
      cancelLabel: 'Cancel',
      trigger: demoteBtn,
    });
    if (!ok) return;
    const result = await _apiPost(apiBase, '/task/demote', { qid: qId, uid }, {}, showToast);
    if (!result) return;
    _drawerUid = null;
    await _refreshData(apiBase, showToast);
    _reRenderAll(apiBase, showToast);
    showToast('Task moved to the backlog.', 'success');
    return;
  }

  // -- Drawer: delete task (Z21) — edit mode only
  const deleteBtn = e.target.closest('[data-gr-delete]');
  if (deleteBtn && _dsModal && _uiEdit) {
    const uid = deleteBtn.dataset.arDelete;
    const task = _tasks.find((t) => t.uid === uid);
    const ok = await _dsModal.confirmDsModal({
      title: 'Delete the task?',
      body: 'The task "' + (task ? task.t : '') + '" will be deleted permanently.',
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
      trigger: deleteBtn,
    });
    if (!ok) return;
    const result = await _apiDelete(apiBase, '/task', { qid: qId, uid }, showToast);
    if (!result) return;
    _drawerUid = null;
    await _refreshData(apiBase, showToast);
    _reRenderAll(apiBase, showToast);
    showToast('Task deleted.', 'success');
    return;
  }

  // ---- Backlog interactions -------------------------------------------------

  // -- Backlog toggle
  if (e.target.closest('[data-gr-bl-toggle]')) {
    _backlogOpen = !_backlogOpen;
    const blEl = document.getElementById('gr-backlog-section');
    if (blEl) {
      blEl.outerHTML = _backlogHtml(_backlog, _uiEdit, _backlogOpen);
    }
    return;
  }

  // -- Backlog: add
  if (e.target.closest('[data-gr-bl-add]')) {
    const inp = document.getElementById('gr-bl-new-input');
    const t = inp ? inp.value.trim() : '';
    if (!t) { showToast('Enter the item text.', 'error'); return; }
    const result = await _apiPost(apiBase, '/backlog', { qid: qId }, { t }, showToast);
    if (!result) return;
    _backlog.push(result);
    const blEl = document.getElementById('gr-backlog-section');
    if (blEl) blEl.outerHTML = _backlogHtml(_backlog, _uiEdit, _backlogOpen);
    return;
  }

  // -- Backlog: promote (B4) — edit mode only
  const promoteBtn = e.target.closest('[data-gr-bl-promote]');
  if (promoteBtn && _dsModal && _uiEdit) {
    const uid = promoteBtn.dataset.arBlPromote;
    const item = _backlog.find((b) => b.uid === uid);
    const areaOpts = _areas.map((a) =>
      '<option value="' + _esc(a.id) + '">' + _esc(a.name) + '</option>'
    ).join('');
    const { ok: promoteOk, values: pFields } = await _confirmWithFields(_dsModal, {
      title: 'Add to the roadmap?',
      bodyHtml: '<label style="font-size:var(--text-sm);display:block;margin-bottom:8px">'
        + 'Item: <strong>' + _esc(item ? item.t : '') + '</strong></label>'
        + '<label style="font-size:var(--text-sm)">Area:<br>'
        + '<select class="ds-input" id="gr-promote-area" style="margin-top:4px">' + areaOpts + '</select>'
        + '</label>',
      okLabel: 'Add to the roadmap',
      cancelLabel: 'Cancel',
      trigger: promoteBtn,
    }, ['gr-promote-area']);
    if (!promoteOk) return;
    const areaId = pFields['gr-promote-area'] || (_areas[0] && _areas[0].id);
    if (!areaId) return;
    const result = await _apiPost(apiBase, '/backlog/promote', { qid: qId }, { uid, areaId }, showToast);
    if (!result) return;
    await _refreshData(apiBase, showToast);
    _reRenderAll(apiBase, showToast);
    showToast('Item added to the roadmap.', 'success');
    return;
  }

  // -- Backlog: edit title inline (B2)
  const blEditBtn = e.target.closest('[data-gr-bl-edit]');
  if (blEditBtn && _uiEdit) {
    const uid = blEditBtn.dataset.arBlEdit;
    const item = _backlog.find((b) => b.uid === uid);
    const itemEl = document.querySelector('[data-gr-bl-item="' + uid + '"]');
    if (!itemEl || !item) return;
    const titleEl = itemEl.querySelector('[data-gr-bl-title]');
    if (!titleEl) return;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'ds-input gr-backlog-edit-input';
    inp.value = item.t || '';
    inp.maxLength = 200;
    inp.setAttribute('aria-label', 'Edit item');
    titleEl.replaceWith(inp);
    inp.focus();
    inp.select();
    const save = async () => {
      const t = inp.value.trim();
      if (!t || t === item.t) { inp.replaceWith(titleEl); return; }
      const result = await _apiPut(apiBase, '/backlog', { qid: qId, uid }, { t }, showToast);
      if (result) {
        item.t = result.t;
        titleEl.textContent = result.t;
      }
      inp.replaceWith(titleEl);
    };
    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); save(); }
      if (ev.key === 'Escape') { inp.replaceWith(titleEl); }
    });
    return;
  }

  // -- Backlog: delete (B3)
  const blDeleteBtn = e.target.closest('[data-gr-bl-delete]');
  if (blDeleteBtn && _uiEdit) {
    const uid = blDeleteBtn.dataset.arBlDelete;
    const result = await _apiDelete(apiBase, '/backlog', { qid: qId, uid }, showToast);
    if (!result) return;
    _backlog = _backlog.filter((b) => b.uid !== uid);
    const blEl = document.getElementById('gr-backlog-section');
    if (blEl) blEl.outerHTML = _backlogHtml(_backlog, _uiEdit, _backlogOpen);
    return;
  }
}

async function _handleChange(e, apiBase, showToast) {
  const qId = _status && _status.activeQuarter;
  if (!qId) return;

  // -- Person filter: does NOT need an open drawer (item 12 fix)
  if (e.target.closest('[data-gr-person-filter]')) {
    _uiPerson = e.target.value;
    _reRenderBody();
    return;
  }

  // Remaining handlers require an open drawer
  if (!_drawerUid) return;

  // -- Area select in drawer (Z19)
  if (e.target.id === 'gr-drawer-area') {
    await _putTask(apiBase, qId, _drawerUid, { a: e.target.value }, showToast);
    return;
  }

  // -- Week-from / week-to in drawer (ISO week numbers, item E)
  if (e.target.id === 'gr-drawer-wfrom' || e.target.id === 'gr-drawer-wto') {
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task) return;
    const fromEl = document.getElementById('gr-drawer-wfrom');
    const toEl = document.getElementById('gr-drawer-wto');
    const fromVal = parseInt(fromEl ? fromEl.value : e.target.value, 10);
    const toVal = toEl ? parseInt(toEl.value, 10) : fromVal;
    const sl = rangeToSL(fromVal, Math.max(fromVal, toVal), _weekFirstNo, _weeksNGlobal);
    await _putTask(apiBase, qId, _drawerUid, sl, showToast);
    return;
  }

  // -- Phase name change (Z11)
  const phNameInput = e.target.closest('[data-gr-phase-name]');
  if (phNameInput) {
    const idx = parseInt(phNameInput.dataset.arPhaseName, 10);
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task || !task.ph) return;
    const newPh = task.ph.map((ph, i) => i === idx ? { ...ph, n: e.target.value.slice(0, 60) } : ph);
    await _putTask(apiBase, qId, _drawerUid, { ph: newPh }, showToast);
    return;
  }

  // -- Phase week-from / week-to change (ISO week numbers, item E)
  const phFromInput = e.target.closest('[data-gr-phase-wfrom]');
  if (phFromInput) {
    const idx = parseInt(phFromInput.dataset.arPhaseWfrom, 10);
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task || !task.ph) return;
    const toEl = document.querySelector('[data-gr-phase-wto="' + idx + '"]');
    const fromVal = parseInt(e.target.value, 10);
    const toVal = toEl ? parseInt(toEl.value, 10) : fromVal;
    const sl = rangeToSL(fromVal, Math.max(fromVal, toVal), _weekFirstNo, _weeksNGlobal);
    const newPh = task.ph.map((ph, i) => i === idx ? { ...ph, ...sl } : ph);
    await _putTask(apiBase, qId, _drawerUid, { ph: newPh }, showToast);
    return;
  }

  const phToInput = e.target.closest('[data-gr-phase-wto]');
  if (phToInput) {
    const idx = parseInt(phToInput.dataset.arPhaseWto, 10);
    const task = _tasks.find((t) => t.uid === _drawerUid);
    if (!task || !task.ph) return;
    const fromEl = document.querySelector('[data-gr-phase-wfrom="' + idx + '"]');
    const toVal = parseInt(e.target.value, 10);
    const fromVal = fromEl ? parseInt(fromEl.value, 10) : toVal;
    const sl = rangeToSL(Math.min(fromVal, toVal), Math.max(fromVal, toVal), _weekFirstNo, _weeksNGlobal);
    const newPh = task.ph.map((ph, i) => i === idx ? { ...ph, ...sl } : ph);
    await _putTask(apiBase, qId, _drawerUid, { ph: newPh }, showToast);
    return;
  }
}


// ---- Drawer title on blur --------------------------------------------------

async function _handleTitleBlur(e, apiBase, showToast) {
  if (e.target.id !== 'gr-drawer-title-input' || !_drawerUid) return;
  const t = e.target.value.trim();
  if (!t) return;
  const qId = _status && _status.activeQuarter;
  if (!qId) return;
  const task = _tasks.find((tk) => tk.uid === _drawerUid);
  if (task && task.t !== t) {
    await _putTask(apiBase, qId, _drawerUid, { t }, showToast);
  }
}

// ---- PUT task helper -------------------------------------------------------

async function _putTask(apiBase, qId, uid, patch, showToast) {
  if (!uid) return;
  const result = await _apiPut(apiBase, '/task', { qid: qId, uid }, patch, showToast);
  if (!result) return;
  // Update in-memory
  const idx = _tasks.findIndex((t) => t.uid === uid);
  if (idx >= 0) _tasks[idx] = result;
  else _tasks.push(result);
  _updateDrawer();
  _reRenderBody();
}

// ---- Swap task order helper ------------------------------------------------

async function _swapTaskOrder(apiBase, qId, uid, dir, showToast) {
  const result = await _apiPost(apiBase, '/task/swap', { qid: qId }, { uid, dir }, showToast);
  if (!result) return;
  // Server returns { tasks: [updatedA, updatedB] }; patch in-memory then re-render
  const updated = result.tasks || [];
  updated.forEach((t) => {
    const idx = _tasks.findIndex((x) => x.uid === t.uid);
    if (idx >= 0) _tasks[idx] = t;
  });
  _updateDrawer();
  _reRenderBody();
}

// ---- Area modal ------------------------------------------------------------

async function _openAreaModal(area, apiBase, showToast, qId) {
  if (!_dsModal) return;
  const isNew = !area;
  const current = area ? { ...area } : { name: '', color: 'blue', note: '', id: '' };

  // Wire delete button inside the modal body before confirmDsModal resolves
  let _deleteRequested = false;
  const onDeleteClick = async (e) => {
    const btn = e.target.closest('[data-gr-delete-area]');
    if (!btn) return;
    e.stopPropagation();
    // Ask for confirmation in a nested modal
    const confirmOk = await _dsModal.confirmDsModal({
      title: 'Delete area',
      bodyHtml: '<p>Do you really want to delete the area <strong>' + _esc(current.name) + '</strong>? This cannot be undone.</p>',
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!confirmOk) return;
    // Attempt delete
    const res = await fetch(apiBase + '/area' + _buildQs({ qid: qId, id: current.id }), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Show server message (e.g. "The area has 3 task(s) - move them first") as toast; keep edit modal open
      showToast(data.message || 'Cannot delete the area.', 'error');
      return;
    }
    _announceDataWrite();
    _deleteRequested = true;
    // Close the edit modal without saving: closeDsModal on a confirmDsModal
    // overlay runs its finisher, which resolves the edit dialog as dismissed.
    // The overlay is found from the clicked button, never by a page-wide
    // selector: confirmDsModal's buttons carry data-confirm-*, and a global
    // lookup by class matched nothing, so the modal used to stay open.
    const editOverlay = btn.closest('.ds-modal-overlay');
    if (editOverlay) _dsModal.closeDsModal(editOverlay);
  };

  document.addEventListener('click', onDeleteClick, true);

  const { ok, values: aFields } = await _confirmWithFields(_dsModal, {
    title: isNew ? 'New area' : 'Edit area: ' + current.name,
    bodyHtml: _areaModalBodyHtml(current, isNew),
    okLabel: isNew ? 'Create area' : 'Save',
    cancelLabel: 'Cancel',
    danger: false,
  }, ['gr-area-name', 'gr-area-note', 'gr-area-color']);

  document.removeEventListener('click', onDeleteClick, true);

  if (_deleteRequested) {
    // Delete already executed and succeeded; just refresh
    await _refreshData(apiBase, showToast);
    _reRenderAll(apiBase, showToast);
    return;
  }

  if (!ok) return;

  const name = (aFields['gr-area-name'] !== undefined ? aFields['gr-area-name'] : current.name).trim();
  const note = aFields['gr-area-note'] !== undefined ? aFields['gr-area-note'].trim() : current.note;
  const color = aFields['gr-area-color'] !== undefined ? aFields['gr-area-color'] : current.color;

  if (!name) { showToast('The area name cannot be empty.', 'error'); return; }

  if (isNew) {
    await _apiPost(apiBase, '/area', { qid: qId }, { name, color, note }, showToast);
  } else {
    await _apiPut(apiBase, '/area', { qid: qId, id: area.id }, { name, color, note }, showToast);
  }
}

// Handle color chip click in area modal
function _handleAreaModalColorClick(e) {
  const chip = e.target.closest('[data-gr-color]');
  if (!chip) return;
  const color = chip.dataset.arColor;
  const colorInput = document.getElementById('gr-area-color');
  if (colorInput) colorInput.value = color;
  // Update active state
  document.querySelectorAll('[data-gr-color]').forEach((c) => c.classList.remove('gr-color-chip--active'));
  chip.classList.add('gr-color-chip--active');
}

// ---- Drag handling ---------------------------------------------------------

function _startDrag(e, task, kind, phaseIdx, apiBase, showToast, root, weeksN) {
  if (!_uiEdit || !task) return;
  e.preventDefault();

  const ganttWrap = document.querySelector('.gr-gantt-wrap');
  if (!ganttWrap) return;

  // Measure actual week column width from the lane element
  const laneEl = document.querySelector('.gr-lane');
  const weekW = laneEl ? Math.round(laneEl.getBoundingClientRect().width / weeksN) : 80;
  const startX = e.clientX;
  const origS = task.s;
  const origL = task.l;
  const origPh = task.ph ? task.ph.map((p) => ({ ...p })) : null;

  document.documentElement.classList.add('gr-dragging');

  const onMove = (moveEv) => {
    const dx = moveEv.clientX - startX;
    const dw = Math.round(dx / weekW);
    _drag = { uid: task.uid, kind, phaseIdx, dw, origS, origL, origPh, weeksN };
    _applyDragPreview(task.uid, kind, phaseIdx, dw, origS, origL, origPh, weeksN);
  };

  const onUp = async () => {
    document.documentElement.classList.remove('gr-dragging');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    _dragCleanup = null;

    if (!_drag || _drag.dw === 0) { _drag = null; return; }

    const dw = _drag.dw;
    _drag = null;
    const qId = _status && _status.activeQuarter;
    if (!qId) return;

    let patch = {};
    if (kind === 'bar') {
      const newS = Math.max(1, Math.min(weeksN - origL + 1, origS + dw));
      patch = { s: newS, l: origL };
    } else if (kind === 'handle-l') {
      const newS = Math.max(1, Math.min(origS + origL - 1, origS + dw));
      const newL = Math.max(1, origL - (newS - origS));
      patch = { s: newS, l: newL };
    } else if (kind === 'handle-r') {
      const newL = Math.max(1, Math.min(weeksN - origS + 1, origL + dw));
      patch = { s: origS, l: newL };
    } else if (kind === 'phase-bar' && origPh) {
      const newPh = origPh.map((ph, i) => {
        if (i !== phaseIdx) return ph;
        return { ...ph, s: Math.max(1, Math.min(weeksN, ph.s + dw)) };
      });
      const env = { s: Math.min(...newPh.map((p) => p.s)), l: 0 };
      env.l = Math.max(...newPh.map((p) => p.s + p.l)) - env.s;
      patch = { ph: newPh, s: env.s, l: env.l };
    } else if (kind === 'phase-l' && origPh) {
      const newPh = origPh.map((ph, i) => {
        if (i !== phaseIdx) return ph;
        const newPs = Math.max(1, Math.min(ph.s + ph.l - 1, ph.s + dw));
        const newPl = Math.max(1, ph.l - (newPs - ph.s));
        return { ...ph, s: newPs, l: newPl };
      });
      patch = { ph: newPh };
    } else if (kind === 'phase-r' && origPh) {
      const newPh = origPh.map((ph, i) => {
        if (i !== phaseIdx) return ph;
        const newPl = Math.max(1, Math.min(weeksN - ph.s + 1, ph.l + dw));
        return { ...ph, l: newPl };
      });
      patch = { ph: newPh };
    }

    if (Object.keys(patch).length) {
      await _putTask(apiBase, qId, task.uid, patch, showToast);
    }
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  _dragCleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  return { onMove, onUp };
}

function _applyDragPreview(uid, kind, phaseIdx, dw, origS, origL, origPh, weeksN) {
  // Visual preview: update bar style directly
  const barEl = document.querySelector('.gr-bar[data-gr-task="' + uid + '"]:not(.gr-phase-bar)');
  if (!barEl) return;
  const pct = 100 / weeksN;

  if (kind === 'bar') {
    const newS = Math.max(1, Math.min(weeksN - origL + 1, origS + dw));
    barEl.style.left = (newS - 1) * pct + '%';
  } else if (kind === 'handle-l') {
    const newS = Math.max(1, Math.min(origS + origL - 1, origS + dw));
    const newL = Math.max(1, origL - (newS - origS));
    barEl.style.left = (newS - 1) * pct + '%';
    barEl.style.width = newL * pct + '%';
  } else if (kind === 'handle-r') {
    const newL = Math.max(1, Math.min(weeksN - origS + 1, origL + dw));
    barEl.style.width = newL * pct + '%';
  } else if ((kind === 'phase-bar' || kind === 'phase-l' || kind === 'phase-r') && origPh) {
    const phBar = document.querySelector('.gr-phase-bar[data-gr-task="' + uid + '"][data-gr-phase-bar="' + phaseIdx + '"]');
    if (!phBar) return;
    const ph = origPh[phaseIdx];
    if (kind === 'phase-bar') {
      const newS = Math.max(1, Math.min(weeksN, ph.s + dw));
      phBar.style.left = (newS - 1) * pct + '%';
    } else if (kind === 'phase-l') {
      const newPs = Math.max(1, Math.min(ph.s + ph.l - 1, ph.s + dw));
      const newPl = Math.max(1, ph.l - (newPs - ph.s));
      phBar.style.left = (newPs - 1) * pct + '%';
      phBar.style.width = newPl * pct + '%';
    } else if (kind === 'phase-r') {
      const newPl = Math.max(1, Math.min(weeksN - ph.s + 1, ph.l + dw));
      phBar.style.width = newPl * pct + '%';
    }
  }
}

// ---- Re-render helpers -----------------------------------------------------

function _reRenderBody() {
  if (!_quarter) return;
  const roster = _quarter.roster || [];
  const weeksN = _quarter.weeksN || 14;
  const mondayFirst = _quarter.mondayFirst || '2026-09-21';
  const xmasWeek = _quarter.xmasWeek || null;

  const bodyEl = document.getElementById('gr-gantt-body');
  if (bodyEl) {
    bodyEl.innerHTML = _ganttBodyHtml(
      _tasks, _areas, roster, _teamDir, weeksN, mondayFirst, xmasWeek,
      _uiEdit, _uiGroup, _uiPerson, _collapsed
    );
  }
}

function _reRenderAll(_apiBase, _showToast, root) {
  if (!_quarter) return;
  const r = root || document.getElementById('gantt-roadmap-main-root');
  if (!r) return;
  const roster = _quarter.roster || [];
  const weeksN = _quarter.weeksN || 14;
  _buildView(r, null, _quarter, _areas, _tasks, _backlog, roster, _teamDir, weeksN, _uiEdit);
  _updateDrawer();
}

function _updateDrawer() {
  if (!_quarter) return;
  const weeksN = _quarter.weeksN || 14;
  const roster = _quarter.roster || [];
  const existing = document.getElementById('gr-drawer');
  const task = _drawerUid ? _tasks.find((t) => t.uid === _drawerUid) : null;
  const newHtml = _drawerHtml(task, _areas, weeksN, roster, _uiEdit);
  if (existing) {
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    existing.replaceWith(tmp.firstElementChild);
  } else {
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    document.body.appendChild(tmp.firstElementChild);
  }
}

// ---- Wire all events -------------------------------------------------------

function _wireEvents(root, apiBase, showToast, registerViewCleanup) {
  const weeksN = (_quarter && _quarter.weeksN) || 14;

  // Click delegation on root
  const onRootClick = (e) => _handleClick(e, apiBase, showToast);
  root.addEventListener('click', onRootClick);

  // Color chip clicks inside area modal (document-level, ds-modal is in body)
  const onDocClick = (e) => _handleAreaModalColorClick(e);
  document.addEventListener('click', onDocClick);

  // Drawer clicks (drawer is in body, not root)
  const onDrawerClick = (e) => {
    const drawer = document.getElementById('gr-drawer');
    if (drawer && drawer.contains(e.target)) {
      _handleClick(e, apiBase, showToast);
    }
  };
  document.body.addEventListener('click', onDrawerClick);

  // Change events
  const onRootChange = (e) => _handleChange(e, apiBase, showToast);
  root.addEventListener('change', onRootChange);

  const onDrawerChange = (e) => {
    const drawer = document.getElementById('gr-drawer');
    if (drawer && drawer.contains(e.target)) {
      _handleChange(e, apiBase, showToast);
    }
  };
  document.body.addEventListener('change', onDrawerChange);

  // Blur for title save
  const onDrawerBlur = (e) => {
    const drawer = document.getElementById('gr-drawer');
    if (drawer && drawer.contains(e.target)) {
      _handleTitleBlur(e, apiBase, showToast);
    }
  };
  document.body.addEventListener('blur', onDrawerBlur, true);

  // Phase name blur
  const onPhaseBlur = (e) => {
    if (!e.target.closest('[data-gr-phase-name]') && !e.target.closest('[data-gr-phase-s]') && !e.target.closest('[data-gr-phase-l]')) return;
    _handleChange(e, apiBase, showToast);
  };
  document.body.addEventListener('blur', onPhaseBlur, true);


  // Esc key closes drawer (item 9)
  const onKeydown = (e) => {
    if (e.key === 'Escape' && _drawerUid) {
      _drawerUid = null;
      _updateDrawer();
    }
  };
  document.addEventListener('keydown', onKeydown);

  // Mousedown on bars for drag
  const onMousedown = (e) => {
    if (!_uiEdit) return;
    const barEl = e.target.closest('.gr-bar, .gr-phase-bar');
    if (!barEl) return;
    const uid = barEl.dataset.ganttTask;
    if (!uid) return;
    const task = _tasks.find((t) => t.uid === uid);
    if (!task) return;

    const isHandleL = e.target.closest('[data-gr-drag="l"]') || e.target.closest('[data-gr-phase-drag="l"]');
    const isHandleR = e.target.closest('[data-gr-drag="r"]') || e.target.closest('[data-gr-phase-drag="r"]');
    const isPhaseBar = barEl.classList.contains('gr-phase-bar');
    const phaseIdx = isPhaseBar ? parseInt(barEl.dataset.arPhaseBar || '0', 10) : null;

    let kind = 'bar';
    if (isHandleL) kind = isPhaseBar ? 'phase-l' : 'handle-l';
    else if (isHandleR) kind = isPhaseBar ? 'phase-r' : 'handle-r';
    else if (isPhaseBar) kind = 'phase-bar';

    _startDrag(e, task, kind, phaseIdx, apiBase, showToast, root, weeksN);
  };
  root.addEventListener('mousedown', onMousedown);

  // Cleanup
  registerViewCleanup(() => {
    root.removeEventListener('click', onRootClick);
    root.removeEventListener('change', onRootChange);
    root.removeEventListener('mousedown', onMousedown);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKeydown);
    document.body.removeEventListener('click', onDrawerClick);
    document.body.removeEventListener('change', onDrawerChange);
    document.body.removeEventListener('blur', onDrawerBlur, true);
    document.body.removeEventListener('blur', onPhaseBlur, true);
    // Remove drag listeners if active
    if (_dragCleanup) {
      _dragCleanup();
      _dragCleanup = null;
    }
    if (_drag) {
      document.documentElement.classList.remove('gr-dragging');
      _drag = null;
    }
    // Remove drawer from the page
    const drawer = document.getElementById('gr-drawer');
    if (drawer) drawer.remove();
    _drawerUid = null;
  });
}

// Drawer is in document.body; change events handled via body delegation in _wireEvents.

// ---- Export HTML -----------------------------------------------------------

async function _doExportHtml(showToast) {
  if (!_quarter) return;
  if (!_tasks.length) {
    showToast('The roadmap has no tasks yet - nothing to export.', 'info');
    return;
  }
  try {
    const { buildExportHtml } = await import('./export-html.js');
    const html = await buildExportHtml({
      quarter: _quarter,
      areas: _areas,
      tasks: _tasks,
      backlog: _backlog,
      teamDir: _teamDir,
    });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gantt-roadmap-' + (_status && _status.activeQuarter || 'q4-2026') + '.html';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('HTML export failed: ' + err.message, 'error');
  }
}

// ---- Views export ----------------------------------------------------------

export const views = {

  'gantt-roadmap-main': {
    _wired: false,

    init(deps) {
      // The host's showToast is (variant, title, desc) with variants
      // success|danger|info|warning|neutral. Every call site in this file
      // reads (message, kind) with kind 'error'|'success'|'info', so the order
      // is swapped once here instead of at ~15 call sites.
      const hostToast = deps.showToast;
      const showToast = (message, kind) => {
        const variant = kind === 'error' ? 'danger' : (kind || 'neutral');
        if (typeof hostToast === 'function') hostToast(variant, String(message || ''));
      };
      this._deps = { ...deps, showToast };
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
        try { _teamDir = await import('/js/team-directory.js'); } catch { _teamDir = null; }
      })();
    },

    async render(_subPath, _opts) {
      const { apiBase, showToast, registerViewCleanup } = this._deps;
      const root = document.getElementById('gantt-roadmap-main-root');
      if (!root) return;

      // Actions slot: primary = Export HTML, secondary = Refresh
      const actions = document.getElementById('gantt-roadmap-main-actions');
      if (actions) {
        actions.innerHTML =
          '<button type="button" class="ds-btn ds-btn--secondary" data-gr-export-html="1" data-skel="0">Export HTML</button>'
          + '<button type="button" class="ds-btn ds-btn--tertiary" data-gr-refresh-btn="1" data-skel="0">Refresh</button>';
      }

      // Show skeleton while loading
      root.innerHTML = _skeletonHtml();

      // Load team directory so avatarUrlForName can resolve photos (item 3)
      if (_teamDir && _teamDir.loadTeamDirectory) {
        try { await _teamDir.loadTeamDirectory(); } catch { /* ignore — initials fallback */ }
      }

      // Load data
      await _refreshData(apiBase, showToast);

      if (!_status || _status.storage !== 'ok') {
        root.innerHTML = _status && _status.storage === 'empty' ? _noQuarterCalloutHtml() : _storageCalloutHtml();
        // Wire refresh button
        const refreshBtn = actions && actions.querySelector('[data-gr-refresh-btn]');
        if (refreshBtn) {
          const onRefreshClick = async () => {
            root.innerHTML = _skeletonHtml();
            await _refreshData(apiBase, showToast);
            this.render(_subPath, _opts);
          };
          refreshBtn.addEventListener('click', onRefreshClick);
          registerViewCleanup(() => refreshBtn.removeEventListener('click', onRefreshClick));
        }
        return;
      }

      if (!_quarter) {
        root.innerHTML = _status.activeQuarter
          ? '<div class="gr-storage-callout"><div class="ds-callout ds-callout--warning"><div>Could not load the quarter data.</div></div></div>'
          : _noQuarterCalloutHtml();
        return;
      }

      const roster = _quarter.roster || [];
      const weeksN = _quarter.weeksN || 14;

      _buildView(root, actions, _quarter, _areas, _tasks, _backlog, roster, _teamDir, weeksN, _uiEdit);

      // Wire header actions slot
      if (actions) {
        const onActionsClick = async (e) => {
          if (e.target.closest('[data-gr-export-html]')) await _doExportHtml(showToast);
          if (e.target.closest('[data-gr-refresh-btn]')) {
            await _refreshData(apiBase, showToast);
            _reRenderAll(apiBase, showToast);
          }
        };
        actions.addEventListener('click', onActionsClick);
        registerViewCleanup(() => actions.removeEventListener('click', onActionsClick));
      }

      if (this._wired) return;
      this._wired = true;

      _wireEvents(root, apiBase, showToast, registerViewCleanup);

      // The cleanup registered inside _wireEvents already resets _wired; add one more callback
      registerViewCleanup(() => { this._wired = false; });
    },

    // Called by the core after a data sync — re-fetches and repaints
    // (a pull, or one of this view's own writes - _announceDataWrite). An
    // own write has usually patched memory with the server's answer already,
    // so an unchanged reload skips the repaint (and keeps the drawer focus).
    onDataChanged() {
      if (this._deps) {
        const { apiBase, showToast } = this._deps;
        const before = _snapshotData();
        _refreshData(apiBase, showToast).then(() => {
          const root = document.getElementById('gantt-roadmap-main-root');
          if (root && _quarter && (before === null || _snapshotData() !== before)) _reRenderAll(apiBase, showToast);
        });
      }
    },
  },
};
