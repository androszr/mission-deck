// demo/mocks/ch-roadmap.mjs
// Painters for chapter `roadmap`: "Product roadmap"
// (modules/roadmap - tabs Table / Roadmap / Kanban from
// VIEW_TABS, the "Role filter" calendar strip, the initiatives table with RAG
// dots, the year timeline with quarter columns and the Discovery kanban) and
// "Gantt roadmap" (modules/gantt-roadmap - the weekly Gantt of one quarter).
// Pure (props) => htmlString, DS classes only; module classes renamed
// roadmapa-*. Initiatives, tickets and people are invented.

import { esc } from './common.mjs';
import { fruitFaceFor } from '../../assets/avatars/fruit-avatars.mjs';
import { modulePage, syncBar } from './ch-time-tracking.mjs';

const RAG = { green: 'Green', amber: 'Amber', red: 'Red' };
const STAGES = [['preparation', 'Preparation', 'Prep'], ['problem-space', 'Problem Space', 'Prob'], ['solution-space', 'Solution Space', 'Sol'], ['delivery', 'Delivery', 'Del'], ['pilot', 'Pilot', 'Pil'], ['go-live', 'Go-Live', 'GL']];

/** Invented initiatives. Dates as day-of-year fractions are derived below. */
const INITS = [
  { t: 'Work schedule on a new screen', k: 'DEMO-101', rag: 'green', st: 'delivery', po: 'Alex Morgan', de: 'Jordan Lee', an: 'Sam Rivera', ar: 'Parker Lane', d1: '2026-08-14', d2: '2026-11-20', gl: '2026-12-01', md: '14.3' },
  { t: 'Quantity suggestions in orders', k: 'DEMO-120', rag: 'green', st: 'delivery', po: 'Avery Quinn', de: 'Emerson Gray', an: 'Drew Patel', ar: 'Riley Chen', d1: '2026-07-31', d2: '2026-10-30', gl: '2026-11-09', md: '9.6' },
  { t: 'Pay calculator 2.0', k: 'DEMO-114', rag: 'amber', st: 'solution-space', po: 'Taylor Kim', de: 'Rowan Ellis', an: 'Morgan Blake', ar: 'Casey Novak', d1: '2026-10-16', d2: '2027-01-29', gl: '', md: '0.8' },
  { t: 'Training module for sites', k: 'DEMO-142', rag: 'amber', st: 'pilot', po: 'Dakota Hale', de: 'Jordan Lee', an: 'Skyler Reed', ar: 'Cameron Shaw', d1: '2026-05-29', d2: '2026-09-25', gl: '2026-10-19', md: '21.4' },
  { t: 'Sales report on mobile', k: 'DEMO-131', rag: 'red', st: 'problem-space', po: 'Alex Morgan', de: 'Hayden Cole', an: 'Sam Rivera', ar: '', d1: '2026-11-13', d2: '', gl: '', md: '2.1' },
  { t: 'Paperless stocktaking', k: 'DEMO-138', rag: 'green', st: 'preparation', po: 'Taylor Kim', de: '', an: 'Morgan Blake', ar: '', d1: '2026-12-11', d2: '', gl: '', md: '0' },
];

const ROLES = [['all', 'All'], ['po', 'PO'], ['analityk', 'Analyst'], ['designer', 'Designer'], ['architekt', 'Architect']];
/** Two working weeks back, then today (Sunday 04.10 - the demo's "today") and tomorrow, as the real strip lays them out. */
const STRIP = [['Mo', 21, 'past'], ['Tu', 22, 'past'], ['We', 23, 'past'], ['Th', 24, 'past'], ['Fr', 25, 'past'], ['Mo', 28, 'past'], ['Tu', 29, 'past'], ['We', 30, 'past'], ['Th', 1, 'past'], ['Fr', 2, 'past'], ['Su', 4, 'today'], ['Mo', 5, 'tomorrow']];
/** How many people a day shows (a Friday afternoon is thin). */
const STRIP_LOAD = [9, 10, 9, 7, 9, 9, 9, 9, 4, 2, 9, 9];
/** Who is busy on which strip day, by role. */
const BUSY = {
  po: ['Alex Morgan', 'Taylor Kim', 'Avery Quinn'],
  analityk: ['Sam Rivera', 'Morgan Blake', 'Drew Patel', 'Skyler Reed'],
  designer: ['Jordan Lee', 'Emerson Gray', 'Rowan Ellis'],
  architekt: ['Parker Lane', 'Riley Chen'],
};

const _av = (n) => (n ? '<span class="roadmapa-avatar demo-fruit" title="' + esc(n) + '">' + fruitFaceFor(n) + '</span>' : '');
const DEMO_TODAY_ISO = '2026-10-04';

/** workingDaysLabel from modules/roadmap/client/helpers.js, against the demo's today (holidays left out). */
function _days(iso, done) {
  if (!iso) return '';
  const t0 = new Date(DEMO_TODAY_ISO + 'T00:00:00Z');
  const end = new Date(iso + 'T00:00:00Z');
  if (end < t0) return done ? '(done)' : '(overdue)';
  let n = 0;
  for (const d = new Date(t0); d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n += 1;
  return '(' + n + ' workdays)';
}

/** The real cell prints the stored ISO date as is, with the working-days line under it. */
function _date(iso, done) {
  if (!iso) return '<span class="roadmapa-empty">-</span>';
  return esc(iso) + '<div class="roadmapa-days-left">' + esc(_days(iso, done)) + '</div>';
}

const SVG_UP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg>';
const SVG_DOWN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const SVG_GRIP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>';
const SVG_CHEVRON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

function _stripHtml(role) {
  const people = role === 'all' ? [].concat(...Object.values(BUSY)) : BUSY[role];
  const segs = ROLES.map(([k, l]) => '<button type="button" class="ds-segment' + (role === k ? ' active' : '') + '" data-roadmapa-role="' + k + '" aria-pressed="' + (role === k) + '">' + esc(l) + '</button>').join('');
  const cells = STRIP.map(([d, n, zone], i) => {
    const want = role === 'all' ? STRIP_LOAD[i] : Math.max(1, Math.round((STRIP_LOAD[i] * people.length) / 12));
    const who = people.map((_, j) => people[(j + i * 2) % people.length]).slice(0, Math.min(want, people.length));
    const tag = zone === 'today' ? 'Today' : zone === 'tomorrow' ? 'Tomorrow' : '';
    return '<div class="roadmapa-cal-cell roadmapa-cal-cell--' + zone + '"><div class="roadmapa-cal-day-label">' + d + ' ' + n
      + (tag ? '<span class="roadmapa-cal-zone">' + tag + '</span>' : '') + '</div>'
      + '<div class="roadmapa-cal-people">' + who.map(_av).join('') + '</div></div>';
  }).join('');
  return '<div class="roadmapa-strip-filter"><div class="ds-segmented" role="group" aria-label="Role filter">' + segs + '</div></div>'
    + '<div class="ds-card roadmapa-cal-card" id="roadmapa-strip"><div class="roadmapa-cal-strip">' + cells + '</div></div>';
}

function _stageDots(st) {
  // Only the stage the initiative is in now is lit, as on the real page (stageStatus).
  return '<div class="roadmapa-stage-dots">' + STAGES.map(([id, label, short]) => '<span class="roadmapa-stage-dot' + (id === st ? ' roadmapa-stage-dot--on' : '') + '" title="' + esc(label) + '">' + short + '</span>').join('') + '</div>';
}

function _tableHtml() {
  const rows = INITS.map((x, i) => {
    const doneDisc = ['solution-space', 'delivery', 'pilot', 'go-live'].includes(x.st);
    const doneDel = ['pilot', 'go-live'].includes(x.st);
    return '<tr data-roadmapa-row="' + i + '"><td class="roadmapa-rank"><div class="roadmapa-rank-inner">'
      + '<span class="roadmapa-drag-handle" title="Drag to reorder" aria-hidden="true">' + SVG_GRIP + '</span>'
      + '<span class="roadmapa-rank-num">' + (i + 1) + '</span>'
      + '<span class="roadmapa-move-btns"><span class="roadmapa-move-btn" aria-hidden="true">' + SVG_UP + '</span><span class="roadmapa-move-btn" aria-hidden="true">' + SVG_DOWN + '</span></span>'
      + '</div></td>'
      + '<td class="roadmapa-title-cell">' + esc(x.t) + '</td>'
      + '<td><span class="ds-badge ds-badge--brand">' + x.k + '</span></td>'
      + '<td class="roadmapa-rag-cell"><span class="roadmapa-rag-dot roadmapa-rag-dot--' + x.rag + '" title="' + esc('RAG: ' + RAG[x.rag]) + '" data-roadmapa-rag="' + i + '"></span></td>'
      + '<td><div class="roadmapa-people">' + _av(x.po) + _av(x.de) + '</div></td>'
      + '<td><div class="roadmapa-people">' + _av(x.an) + _av(x.ar) + '</div></td>'
      + '<td class="roadmapa-date-cell">' + _date(x.d1, doneDisc) + '</td>'
      + '<td class="roadmapa-date-cell">' + _date(x.d2, doneDel) + '</td>'
      + '<td class="roadmapa-date-cell">' + _date(x.gl, false) + '</td>'
      + '<td>' + _stageDots(x.st) + '</td>'
      + '<td><span class="roadmapa-md">' + x.md + ' MD</span></td></tr>';
  }).join('');
  return '<div class="roadmapa-toolbar"><div class="ds-input-wrap roadmapa-search-wrap"><input class="ds-input" type="search" placeholder="Search initiatives..." aria-label="Search initiatives"></div>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm roadmapa-person-btn">Filter by person' + SVG_CHEVRON + '</button>'
    + '<span class="roadmapa-count">' + INITS.length + '</span></div>'
    + '<div class="ds-table-wrap"><table class="ds-table roadmapa-table" id="roadmapa-table"><thead><tr>'
    + '<th>#</th><th>Initiative</th><th>Epic</th><th>RAG</th><th>PO / Des</th><th>An / Arch</th><th>Discovery end</th><th>Delivery end</th><th>Go-live</th><th>Stage</th><th>MD</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// ── Roadmap tab: one year, quarter columns ────────────────────────────────
const _pos = (iso) => {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2027, 0, 1);
  return Math.max(0, Math.min(100, ((d - start) / (end - start)) * 100));
};
const TODAY = _pos(DEMO_TODAY_ISO);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _timelineHtml(gran) {
  const seg = [['quarters', 'Quarters'], ['months', 'Months']].map(([k, l]) => '<button type="button" class="ds-segment' + (gran === k ? ' active' : '') + '" data-roadmapa-gran="' + k + '">' + l + '</button>').join('');
  const stat = (n, l, cls) => '<div class="ds-card roadmapa-rm-stat"><div class="ds-card-body"><div class="roadmapa-rm-stat-num' + (cls ? ' ' + cls : '') + '">' + n + '</div><div class="roadmapa-rm-stat-lbl">' + l + '</div></div></div>';
  const qs = [0, 1, 2, 3].map((q) => '<div class="roadmapa-rm-hcell" style="left:' + q * 25 + '%;width:25%" data-roadmapa-q="' + (q + 1) + '">Q' + (q + 1) + ' 2026</div>').join('');
  const ms = gran === 'months' ? '<div class="roadmapa-rm-hrow">' + MONTHS.map((m, i) => '<div class="roadmapa-rm-hcell roadmapa-rm-hcell--m" style="left:' + (i * 100) / 12 + '%;width:' + 100 / 12 + '%">' + m + '</div>').join('') + '</div>' : '';
  const lines = (gran === 'months' ? Array.from({ length: 11 }, (_, i) => ((i + 1) * 100) / 12) : [25, 50, 75]).map((l) => '<span class="roadmapa-rm-line" style="left:' + l + '%"></span>').join('');
  const rows = INITS.map((x, i) => {
    const a = _pos(x.d1 && '2026-0' + (2 + (i % 4)) + '-01');
    const b = _pos(x.d1);
    const c = _pos(x.d2 || '');
    let bar = '';
    if (a !== null && b !== null) bar += '<div class="roadmapa-rm-seg roadmapa-rm-seg--disc" style="left:' + a + '%;width:' + Math.max(1, b - a) + '%"></div>';
    if (b !== null && c !== null) bar += '<div class="roadmapa-rm-seg roadmapa-rm-seg--del" style="left:' + b + '%;width:' + Math.max(1, c - b) + '%"></div>';
    if (x.gl) bar += '<span class="roadmapa-rm-go" style="left:' + _pos(x.gl) + '%"></span>';
    return '<div class="roadmapa-rm-row" data-roadmapa-rm-row="' + i + '" title="' + esc('Show in the table: ' + x.t) + '"><div class="roadmapa-rm-name-col"><span class="roadmapa-rag-dot roadmapa-rag-dot--' + x.rag + '" title="' + esc('RAG: ' + RAG[x.rag]) + '"></span>'
      + '<span class="roadmapa-rm-name">' + esc(x.t) + '</span></div><div class="roadmapa-rm-track-col"><div class="roadmapa-rm-track">' + lines + bar + '</div></div></div>';
  }).join('');
  return '<div class="roadmapa-rm-toolbar"><select class="ds-input roadmapa-rm-year" aria-label="Year"><option selected>2026</option><option>2027</option></select>'
    + '<div class="ds-segmented" role="group" aria-label="Timeline scale">' + seg + '</div>'
    + '<span class="roadmapa-rm-hint">Click a quarter header to collapse or expand it.</span></div>'
    + '<div class="roadmapa-rm-stats">' + stat(INITS.length, 'Initiatives in total') + stat(3, 'In discovery', 'roadmapa-rm-stat-disc') + stat(3, 'In delivery', 'roadmapa-rm-stat-del') + stat(0, 'Finished') + '</div>'
    + '<div class="roadmapa-rm-legend"><span class="roadmapa-rm-sw roadmapa-rm-sw--disc"></span>Discovery<span class="roadmapa-rm-sw roadmapa-rm-sw--del"></span>Delivery'
    + '<span class="roadmapa-rm-sw roadmapa-rm-sw--go"></span>Go-Live<span class="roadmapa-rm-sw roadmapa-rm-sw--today"></span>Today'
    + '<span class="roadmapa-rag-dot roadmapa-rag-dot--green"></span>RAG green<span class="roadmapa-rag-dot roadmapa-rag-dot--amber"></span>amber<span class="roadmapa-rag-dot roadmapa-rag-dot--red"></span>red</div>'
    + '<div class="roadmapa-rm-grid" id="roadmapa-rm-grid"><div class="roadmapa-rm-header"><div class="roadmapa-rm-name-col"></div><div class="roadmapa-rm-track-col">'
    + '<div class="roadmapa-rm-hrow roadmapa-rm-hrow--today"><span class="roadmapa-rm-today-pill" style="left:' + TODAY + '%">Today</span></div>'
    + '<div class="roadmapa-rm-hrow">' + qs + '</div>' + ms + '</div></div>'
    + '<div class="roadmapa-rm-rows">' + rows + '<div class="roadmapa-rm-overlay"><div class="roadmapa-rm-today" style="left:' + TODAY + '%"></div></div></div>'
    + '<div class="roadmapa-rm-q4" id="roadmapa-rm-q4" aria-hidden="true"></div></div>';
}

// ── Kanban tab ─────────────────────────────────────────────────────────────
const COLS = [['preparation', 'Preparation'], ['todo', 'To do'], ['in-progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];
const CARDS = [
  [0, 'in-progress', 'DEMO-204', 'Mockups of the weekly view', 'Task', 'Jordan Lee'],
  [0, 'done', 'DEMO-198', 'Mapping the schedule process', 'Task', 'Sam Rivera'],
  [0, 'todo', 'DEMO-211', 'Tests with site managers', 'Story', 'Jordan Lee'],
  [1, 'in-progress', 'DEMO-216', 'Suggestion rules for dairy', 'Task', 'Drew Patel'],
  [1, 'blocked', 'DEMO-219', 'Historical sales data', 'Task', 'Riley Chen'],
  [2, 'preparation', 'DEMO-223', 'Workshop with HR', 'Task', 'Morgan Blake'],
  [2, 'in-progress', 'DEMO-225', 'Variant architecture', 'Task', 'Casey Novak'],
  [4, 'todo', 'DEMO-230', 'Research: the report on a phone', 'Story', 'Hayden Cole'],
];

function _kanbanHtml() {
  const head = COLS.map(([id, l]) => '<div class="roadmapa-col-header"><span>' + l + '</span><span class="ds-badge ds-badge--sm ds-badge--gray">' + CARDS.filter((c) => c[1] === id).length + '</span></div>').join('');
  const lanes = [0, 1, 2, 4].map((li) => {
    const cards = CARDS.filter((c) => c[0] === li);
    return '<div class="roadmapa-lane" data-roadmapa-lane="' + li + '"><div class="roadmapa-lane-header"><span class="roadmapa-lane-title">' + esc(INITS[li].t) + '</span>'
      + '<span class="ds-badge ds-badge--sm ds-badge--gray">' + cards.length + '</span>'
      + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm">In the table</button></div><div class="roadmapa-lane-body">'
      + COLS.map(([id]) => '<div class="roadmapa-cell">' + cards.filter((c) => c[1] === id).map(([, , key, sum, type, who]) => '<div class="roadmapa-card" data-roadmapa-card="' + key + '">'
        + '<div class="roadmapa-card-header"><span class="roadmapa-card-key">' + key + '</span><span class="roadmapa-priority-dot"></span></div>'
        + '<p class="roadmapa-card-summary">' + esc(sum) + '</p><div class="roadmapa-card-footer"><span class="ds-badge ds-badge--sm ' + (type === 'Story' ? 'ds-badge--green' : 'ds-badge--blue') + '">' + type + '</span>' + _av(who) + '</div></div>').join('') + '</div>').join('')
      + '</div></div>';
  }).join('');
  return '<div class="roadmapa-kanban-toolbar"><div class="ds-input-wrap roadmapa-search-wrap"><input type="search" class="ds-input" placeholder="Search by key or title..." aria-label="Search tasks"></div>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Unassigned</button><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Refresh from Jira</button></div>'
    + '<div class="roadmapa-board" id="roadmapa-board"><div class="roadmapa-board-head">' + head + '</div>' + lanes + '</div>';
}

function productBody({ tab = 'tabela', role = 'all', gran = 'quarters' } = {}) {
  const tabs = [['tabela', 'Table'], ['roadmap', 'Roadmap'], ['kanban', 'Kanban']].map(([id, l]) => '<button type="button" class="ds-tab' + (tab === id ? ' active' : '') + '" role="tab" aria-selected="' + (tab === id) + '" data-roadmapa-tab="' + id + '">' + l + '</button>').join('');
  let pane;
  if (tab === 'roadmap') pane = _timelineHtml(gran);
  else if (tab === 'kanban') pane = _kanbanHtml();
  else pane = '<div id="roadmapa-strip-slot">' + _stripHtml(role) + '</div>' + _tableHtml();
  return '<nav class="ds-tabs-list ds-framed-tabs roadmapa-tabs" role="tablist" aria-label="Roadmap views">' + tabs + '</nav>'
    + '<div class="roadmapa-pane" role="tabpanel" data-roadmapa-pane="' + tab + '">' + pane + '</div>';
}

// ── Gantt roadmap: weekly Gantt of Q4 2026 ──────────────────────────────────
const WEEKS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 28 + i * 7));
  return { no: 40 + i, label: String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0'), m: d.getUTCMonth() };
});
const AREAS = [
  { name: 'Orders', color: 1, owner: 'Avery Quinn', tasks: [['Quantity suggestions — pilot', 0, 4], ['Roll-out to 300 sites', 4, 5], ['Milestone: scale decision', 9, 0]] },
  { name: 'Availability', color: 2, owner: 'Riley Chen', tasks: [['A new stock-availability metric', 1, 5], ['Alerts for managers', 6, 6]] },
  { name: 'Promotions', color: 3, owner: 'Taylor Kim', tasks: [['Forecast for the flyer', 2, 4], ['A/B test: display order', 6, 5]] },
  { name: 'Analytics', color: 6, owner: 'Drew Patel', tasks: [['Experiment effect report', 0, 3], ['Quarterly results panel', 8, 5]] },
];

function ganttBody() {
  const months = [];
  WEEKS.forEach((w) => { const last = months[months.length - 1]; if (last && last.m === w.m) last.n += 1; else months.push({ m: w.m, n: 1 }); });
  const grp = [['area', 'Area'], ['owner', 'Owner'], ['none', 'No grouping']].map(([, l], i) => '<button type="button" class="ds-segment' + (i === 0 ? ' active' : '') + '">' + l + '</button>').join('');
  const head = '<div class="roadmapa-gantt-head"><div class="roadmapa-gantt-row"><div class="roadmapa-gantt-label">Quarter Q4 2026</div><div class="roadmapa-gantt-weeks">'
    + months.map((x) => '<div class="roadmapa-gantt-month" style="grid-column: span ' + x.n + '">' + MONTHS[x.m] + '</div>').join('') + '</div></div>'
    + '<div class="roadmapa-gantt-row"><div class="roadmapa-gantt-label">Sprint</div><div class="roadmapa-gantt-weeks">'
    + [42, 43, 44, 45, 46, 47, 48].map((s, i) => '<div class="roadmapa-gantt-sprint" style="grid-column: ' + (i * 2 + 1) + ' / span 2">Sprint ' + s + '</div>').join('') + '</div></div>'
    + '<div class="roadmapa-gantt-row"><div class="roadmapa-gantt-label"></div><div class="roadmapa-gantt-weeks">'
    + WEEKS.map((w, i) => '<div class="roadmapa-gantt-week' + (i === 0 ? ' roadmapa-gantt-week--today' : '') + (w.no === 52 ? ' roadmapa-gantt-week--xmas' : '') + '"><span class="roadmapa-week-no">W' + w.no + '</span><span class="roadmapa-week-date">' + w.label + '</span></div>').join('')
    + '</div></div></div>';
  const lanes = AREAS.map((a, ai) => '<div class="roadmapa-gantt-lane" data-roadmapa-ganttea="' + ai + '"><div class="roadmapa-gantt-row roadmapa-gantt-lane-head"><div class="roadmapa-gantt-label"><span class="roadmapa-ganttea-chip" style="background:var(--legend-' + ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][a.color] + '-primary)"></span><b>' + esc(a.name) + '</b>' + _av(a.owner) + '</div><div class="roadmapa-gantt-weeks roadmapa-gantt-grid"></div></div>'
    + a.tasks.map(([t, s, len]) => '<div class="roadmapa-gantt-row"><div class="roadmapa-gantt-label roadmapa-gantt-task">' + esc(t) + '</div><div class="roadmapa-gantt-weeks roadmapa-gantt-grid">'
      + (len ? '<div class="roadmapa-gantt-bar" style="grid-column:' + (s + 1) + ' / span ' + len + ';background:var(--legend-' + ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][a.color] + '-primary)">' + esc(t) + '</div>'
        : '<div class="roadmapa-gantt-milestone" style="grid-column:' + (s + 1) + '"></div>')
      + '</div></div>').join('') + '</div>').join('');
  return '<div class="roadmapa-gantt-toolbar"><div class="ds-segmented" aria-label="Grouping">' + grp + '</div>'
    + '<select class="ds-input roadmapa-gantt-person" aria-label="Filter by person"><option>Everyone</option></select></div>'
    + '<div class="ds-card roadmapa-gantt" id="roadmapa-gantt">' + head + '<div class="roadmapa-gantt-body">' + lanes + '</div></div>';
}

export const MOCKS = {
  'roadmapa-produkt-page': () => modulePage({
    view: 'roadmapa-produkt',
    title: 'Product roadmap',
    subtitle: 'The product team’s Discovery initiatives - a table with in-place editing, ordering and Jira sync',
    actions: '<button type="button" class="ds-btn ds-btn--secondary">Sync with Jira</button>',
    bar: syncBar({ view: 'roadmapa-produkt', variant: 'success', text: 'Data up to date - local 04.10 08:02, server 04.10 08:02.' }),
    body: productBody({}),
  }),
  'roadmapa-produkt-body': (p) => productBody(p),
  'roadmapa-strip': ({ role = 'all' } = {}) => _stripHtml(role),
  'roadmapa-gantt-page': () => modulePage({
    view: 'roadmapa-gantt',
    title: 'Gantt roadmap',
    subtitle: 'A weekly Gantt chart — tasks, areas, phases, backlog and HTML export',
    actions: '<button type="button" class="ds-btn ds-btn--secondary" id="roadmapa-gantt-export">Export HTML</button><button type="button" class="ds-btn ds-btn--tertiary">Refresh</button>',
    bar: syncBar({ view: 'roadmapa-gantt', variant: 'success', text: 'Data up to date - local 04.10 08:05, server 04.10 08:05.' }),
    body: ganttBody(),
  }),
};

export const LABELS = [
  'Product roadmap', 'Sync with Jira', 'Table', 'Roadmap', 'Kanban', 'Role filter', 'All', 'Search initiatives...',
  'Filter by person', 'Initiative', 'Discovery end', 'Delivery end', 'Quarters', 'Months', 'Initiatives in total', 'In discovery',
  'In delivery', 'Finished', 'Today', 'RAG green', 'amber', 'red', 'Click a quarter header to collapse or expand it.',
  'Preparation', 'To do', 'In progress', 'Blocked', 'Done', 'In the table', 'Unassigned', 'Refresh from Jira',
  'Gantt roadmap', 'A weekly Gantt chart — tasks, areas, phases, backlog and HTML export', 'Export HTML', 'Refresh',
  'Area', 'Owner', 'No grouping', 'Everyone', 'Tomorrow', 'Drag to reorder', ...Object.values(RAG),
];
