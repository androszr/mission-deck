// demo/mocks/ch-sprints.mjs
// Painters for chapter `sprints`: "Sprint Stats" (modules/sprint-stats -
// sprint tabs, dates and goals card, per-team stat rows, trend charts, the
// "Summary per team" table with an expandable team row) and "Sprint
// Review" (modules/sprint-review - session header, team cards with the
// goal status segments and topics, the agenda card). Team labels and every number, goal, topic and person is invented.

import { esc, modalShell } from './common.mjs';
import { fruitFaceFor } from '../../assets/avatars/fruit-avatars.mjs';
import { modulePage, syncBar } from './ch-time-tracking.mjs';

const TEAMS = ['Atlas', 'Borealis', 'Delta', 'Comet'];
const SPRINTS = [36, 37, 38, 39, 40, 41, 42];

/** Per team: committed / done / dropped per sprint (SP), aligned with SPRINTS. */
const TREND = {
  Atlas: { c: [34, 36, 31, 38, 35, 40, 39], d: [29, 33, 30, 31, 34, 37, 21], s: [3, 2, 1, 4, 1, 2, 1] },
  Borealis: { c: [28, 30, 33, 29, 31, 32, 34], d: [26, 27, 30, 24, 29, 31, 18], s: [1, 2, 2, 3, 1, 1, 2] },
  Delta: { c: [41, 38, 40, 42, 39, 44, 41], d: [35, 33, 36, 38, 37, 40, 25], s: [4, 3, 2, 2, 1, 2, 3] },
  Comet: { c: [22, 24, 21, 26, 25, 27, 28], d: [20, 21, 19, 23, 24, 24, 13], s: [1, 1, 2, 1, 0, 2, 1] },
};
const GOALS = {
  Atlas: 'The work schedule on a new screen for the pilot sites',
  Borealis: 'Pay calculator: saving variants and export',
  Delta: 'Orders: quantity suggestions in three categories',
  Comet: 'The daily sales report on mobile',
};
const COLORS = { c: 'var(--legend-4th-primary)', d: 'var(--legend-1st-primary)', s: 'var(--legend-5th-primary)' };

const ISSUES = [
  ['DEMO-512', 'Schedule screen: weekly view', 'Story', 'Alex Morgan', '5', 'Done', 'success'],
  ['DEMO-518', 'Schedule screen: move a shift by dragging', 'Story', 'Hayden Cole', '8', 'In progress', 'warning'],
  ['DEMO-521', 'Validating night working hours', 'Task', 'Parker Lane', '3', 'Done', 'success'],
  ['DEMO-527', 'Pilot acceptance tests', 'Task', 'Jordan Lee', '5', 'To do', 'danger'],
];

function _idx(offset) { return SPRINTS.length - 1 - offset; }

function _sum(team, offset) {
  const i = _idx(offset);
  const t = TREND[team];
  const active = offset === 0;
  const wip = active ? Math.max(0, t.c[i] - t.d[i] - t.s[i]) : 0;
  const pct = Math.round((t.d[i] / t.c[i]) * 100);
  return { committed: t.c[i], done: t.d[i], wip, dropped: t.s[i], added: (i % 3) + 1, pct };
}

function _tabs(offset) {
  return '<nav class="ds-tabs-list sprinty-tabs" role="tablist" aria-label="Sprint">'
    + [0, 1, 2, 3].map((o) => {
      const label = o === 0 ? 'Active' : (o === 1 ? 'Active - 1' : 'A-' + o);
      return '<button type="button" class="ds-tab' + (o === offset ? ' active' : '') + '" role="tab" aria-selected="' + (o === offset) + '" data-sprinty-tab="' + o + '" title="Sprint ' + SPRINTS[_idx(o)] + '">' + label + '</button>';
    }).join('') + '</nav>';
}

function _dates(offset) {
  const n = SPRINTS[_idx(offset)];
  const range = offset === 0 ? '22.09.2026 - 05.10.2026' : '08.09.2026 - 21.09.2026';
  return '<div class="ds-card sprinty-dates-card"><div class="ds-card-body">'
    + '<div class="sprinty-dates-head"><span class="sprinty-dates-label">Sprint ' + n + '</span><span class="sprinty-dates-range">' + range + '</span></div>'
    + '<div class="sprinty-goals-title">Sprint goals</div><div class="sprinty-goals-grid">'
    + TEAMS.map((t) => '<div class="sprinty-goal-team">' + esc(t) + '</div><div class="sprinty-goal-text">' + esc(GOALS[t]) + '</div>').join('')
    + '</div></div></div>';
}

function _tiles(offset) {
  const defs = [['SP Committed', 'committed', ''], ['SP Done', 'done', 'success'], ['SP WIP', 'wip', ''], ['Dropped', 'dropped', 'danger'], ['Completion', 'pct', 'success']];
  return '<div class="sprinty-tiles" id="sprinty-tiles" aria-label="Sprint summary per team">' + TEAMS.map((team) => {
    const s = _sum(team, offset);
    const cards = defs.map(([label, key, tone], i) => {
      const v = key === 'pct' ? s.pct + '%' : String(s[key]);
      const t = key === 'dropped' && s.dropped === 0 ? '' : tone;
      return '<div class="ds-card ds-stat' + (i === 0 ? ' ds-stat--highlight' : '') + '"><div class="ds-stat-value' + (t ? ' ds-stat-value--' + t : '') + '">' + esc(v) + '</div><div class="ds-stat-label">' + esc(label) + '</div></div>';
    }).join('');
    return '<div class="ds-stat-row"><div class="ds-card ds-stat-subject">' + esc(team) + '</div>' + cards + '</div>';
  }).join('') + '</div>';
}

/** One team's trend: three lines over the sprints, the active point hollow. */
function _trendSvg(team) {
  const W = 300;
  const H = 170;
  const L = 34;
  const R = 10;
  const T = 12;
  const B = 24;
  const t = TREND[team];
  const max = 50;
  const x = (i) => L + (i * (W - L - R)) / (SPRINTS.length - 1);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sprinty-chart-svg" role="img" aria-label="Sprint trend: ' + esc(team) + '">';
  for (const v of [0, 10, 20, 30, 40, 50]) {
    svg += '<line x1="' + L + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - R) + '" y2="' + y(v).toFixed(1) + '" stroke="currentColor" stroke-opacity="0.15"/>'
      + '<text x="' + (L - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end" class="sprinty-axis-text">' + v + '</text>';
  }
  SPRINTS.forEach((n, i) => { svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="sprinty-axis-text">' + n + '</text>'; });
  for (const k of ['c', 'd', 's']) {
    const pts = t[k].map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1));
    const last = pts.length - 1;
    svg += '<path class="sprinty-line" d="M' + pts.slice(0, last).join(' L') + '" fill="none" stroke="' + COLORS[k] + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<path d="M' + pts[last - 1] + ' L' + pts[last] + '" fill="none" stroke="' + COLORS[k] + '" stroke-width="2" stroke-dasharray="4,3"/>';
    t[k].forEach((v, i) => {
      svg += i === last
        ? '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4" fill="var(--body-primary-bg)" stroke="' + COLORS[k] + '" stroke-width="2.5"/>'
        : '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.5" fill="' + COLORS[k] + '"/>';
    });
  }
  return svg + '</svg>';
}

function _trend() {
  const legend = [['Committed', COLORS.c], ['Done', COLORS.d], ['Dropped', COLORS.s]]
    .map(([l, c]) => '<span class="sprinty-legend-item"><span class="sprinty-legend-swatch" style="background:' + c + '"></span>' + l + '</span>').join('')
    + '<span class="sprinty-legend-item"><span class="sprinty-legend-line"></span>Active sprint</span>';
  return '<section class="sprinty-section" id="sprinty-trend" aria-label="Sprint trend"><div class="ds-section-head"><h2 class="ds-section-head-title">Sprint trend</h2>'
    + '<div class="ds-section-head-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" aria-label="Earlier sprints">&#9664;</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" aria-label="Newer sprints" disabled>&#9654;</button></div></div>'
    + '<div class="sprinty-legend">' + legend + '</div><div class="sprinty-chart-grid">'
    + TEAMS.map((team) => '<div class="ds-card sprinty-chart-panel"><div class="ds-card-body"><div class="sprinty-panel-title">' + esc(team) + '</div>' + _trendSvg(team) + '</div></div>').join('')
    + '</div></section>';
}

function _table(offset, expanded) {
  const phase = offset === 0 ? ['During the sprint', 'blue'] : ['After the end', 'gray'];
  const rows = TEAMS.map((team) => {
    const s = _sum(team, offset);
    const open = expanded === team;
    const head = '<tr class="sprinty-team-row"><td><button type="button" class="ds-row-toggle" data-sprinty-expand="' + esc(team) + '" aria-expanded="' + open + '">'
      + '<span class="ds-row-toggle-chevron" aria-hidden="true">&#9654;</span><span>' + esc(team) + '</span> <span class="sprinty-issue-count">(' + (s.committed > 30 ? 14 : 11) + ' tasks)</span></button></td>'
      + '<td class="right">SP</td><td class="right">' + s.committed + '</td><td class="right">' + s.done + '</td><td class="right">' + s.wip + '</td>'
      + '<td class="right">' + s.dropped + '</td><td class="right">' + s.added + '</td><td class="right">' + s.pct + '%</td></tr>';
    if (!open) return head;
    const sub = ISSUES.map(([k, sum, type, who, est, st, tone]) => '<tr><td class="sprinty-issue-cell"><span class="sprinty-issue-line"><span class="ds-link">' + k + '</span><span class="sprinty-issue-summary">' + esc(sum) + '</span></span></td>'
      + '<td>' + esc(type) + '</td><td>' + esc(who) + '</td><td class="right">' + est + '</td><td class="right"><span class="sprinty-status--' + tone + '">' + esc(st) + '</span></td></tr>').join('');
    return head + '<tr class="ds-table-sub"><td colspan="8" class="sprinty-sub-cell"><table class="ds-table" aria-label="Tasks: ' + esc(team) + '"><thead><tr>'
      + '<th>Task</th><th>Type</th><th>Person</th><th class="right">SP</th><th class="right">Status</th></tr></thead><tbody>' + sub + '</tbody></table></td></tr>';
  }).join('');
  return '<section class="sprinty-section" id="sprinty-table" aria-label="Summary per team"><div class="ds-section-head"><h2 class="ds-section-head-title">Summary per team</h2>'
    + '<div class="ds-section-head-actions"><span class="ds-badge ds-badge--' + phase[1] + '">' + phase[0] + '</span></div></div>'
    + '<div class="ds-table-wrap"><table class="ds-table" aria-label="Summary per team"><thead><tr>'
    + '<th>Team</th><th class="right">Unit</th><th class="right">Committed</th><th class="right">Done</th><th class="right">WIP</th><th class="right">Dropped</th><th class="right">Added</th><th class="right">Completion</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<div class="ds-actions sprinty-person-actions">' + TEAMS.map((t) => '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Per person: ' + esc(t) + '</button>').join('') + '</div></section>';
}

function statsBody({ offset = 0, expanded = '' } = {}) {
  return '<div class="sprinty-meta">Sprints: 36 - 42 · Teams: ' + TEAMS.join(', ') + '</div>'
    + _tabs(offset)
    + '<div class="sprinty-panel" role="tabpanel">' + _dates(offset) + _tiles(offset) + _trend() + _table(offset, expanded) + '</div>';
}

// ── Sprint Review ─────────────────────────────────────────────────────────

const TOPICS = {
  Atlas: [['The new schedule screen — a demo on pilot data', ['Alex Morgan', 'Hayden Cole'], 'Presentation']],
  Borealis: [['Pay calculator: variants', ['Taylor Kim'], 'Presentation'], ['What next with the HR export', ['Morgan Blake'], 'Discussion']],
  Delta: [['Quantity suggestions in orders', ['Avery Quinn'], 'Presentation']],
  Comet: [],
};


function _teamCard(team, status) {
  const locked = team === 'Delta';
  const topics = TOPICS[team];
  const seg = [['achieved', 'Achieved'], ['partly', 'Partly'], ['missed', 'Not achieved']]
    .map(([v, l]) => '<button type="button" class="ds-segment' + (status === v ? ' active' : '') + '" data-sprinty-status="' + esc(team + '-' + v) + '"' + (locked ? ' disabled' : '') + '>' + l + '</button>').join('');
  const table = topics.length
    ? '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Topic</th><th>Presenter</th><th>Format</th></tr></thead><tbody>'
      + topics.map(([t, who, f]) => '<tr><td>' + esc(t) + '</td><td>' + who.map((n) => '<span class="sprinty-presenter"><span class="sprinty-presenter-avatar demo-fruit">' + fruitFaceFor(n) + '</span><span>' + esc(n) + '</span></span>').join('') + '</td><td>' + esc(f) + '</td></tr>').join('')
      + '</tbody></table></div>'
    : '<div class="ds-callout ds-callout--info"><div>No topics submitted.</div></div>';
  return '<div class="ds-card sprinty-team-card" data-sprinty-team="' + esc(team) + '">'
    + '<div class="ds-card-header"><div class="ds-card-title">' + esc(team) + '</div><span class="ds-badge ' + (locked ? 'ds-badge--green">Approved' : 'ds-badge--yellow">Pending') + '</span></div>'
    + '<div class="ds-card-body"><div class="sprinty-goal-line"><span class="ds-hint">Sprint goal</span><span>' + esc(GOALS[team]) + '</span></div>'
    + '<div class="sprinty-realization"><span class="ds-hint">Sprint goal status</span><div class="ds-segmented" role="group" aria-label="Sprint goal status">' + seg + '</div></div>'
    + '<div class="ds-section-head"><h3 class="ds-section-head-title">Topics</h3><div class="ds-section-head-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm"' + (locked ? ' disabled' : '') + '>Add topic</button></div></div>'
    + table
    + '<div class="sprinty-lock-bar">' + (locked ? '<span class="ds-hint">The card is locked for editing</span><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Unlock editing</button>' : '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Finish editing</button>') + '</div>'
    + '</div></div>';
}

const AGENDA = [
  ['h', 'Sprint Review — Sprint 42 (07.10.2026)'],
  ['p', 'Host: Alex Morgan · 60 min'],
  ['li', 'Atlas — The new schedule screen — a demo on pilot data (presentation, 15 min)'],
  ['li', 'Borealis — Pay calculator: variants (presentation, 10 min)'],
  ['li', 'Borealis — What next with the HR export (discussion, 10 min)'],
  ['li', 'Delta — Quantity suggestions in orders (presentation, 15 min)'],
  ['li', 'Questions and conclusions (10 min)'],
];

function _agenda(open) {
  const panel = open
    ? '<div class="sprinty-agenda-panel"><div class="ds-section-head"><h3 class="ds-section-head-title">Preview</h3><div class="ds-section-head-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="sprinty-agenda-copy">Copy</button></div></div>'
      + '<div class="sprinty-agenda-rendered">' + AGENDA.map(([k, t]) => (k === 'h' ? '<div class="sprinty-md-h1">' + esc(t) + '</div>' : k === 'p' ? '<p class="sprinty-md-p">' + esc(t) + '</p>' : '<div class="sprinty-md-li">' + esc(t) + '</div>')).join('') + '</div></div>'
    : '';
  return '<div class="ds-section-head"><h2 class="ds-section-head-title">Agenda</h2></div><div class="ds-card sprinty-agenda-card" id="sprinty-agenda"><div class="ds-card-body">'
    + '<div class="ds-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="sprinty-agenda-generate">Generate agenda</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Download visual agenda</button></div>' + panel + '</div></div>';
}

function reviewBody({ status = '', agenda = false } = {}) {
  return '<div class="sprinty-session-selector"><label class="ds-label" for="sprinty-session">Sprint Review session</label>'
    + '<select id="sprinty-session" class="ds-input"><option selected>Sprint 42 · 07.10.2026</option><option>Sprint 41 · 23.09.2026</option></select></div>'
    + '<div class="sprinty-session-header"><div class="sprinty-session-title"><h2>Sprint 42</h2><div class="sprinty-session-badges"><span class="ds-badge ds-badge--green">Upcoming</span> <span class="ds-badge ds-badge--blue">Sprint 42</span></div></div>'
    + '<div class="sprinty-session-meta"><span class="ds-hint">Sprint Review date</span><strong>Tuesday, 07.10.2026</strong>'
    + '<span class="ds-hint">Host PO</span><strong>Alex Morgan</strong>'
    + '<span class="ds-hint">Deadline</span><strong>3 days 4 hrs</strong></div></div>'
    + '<div class="ds-section-head"><h2 class="ds-section-head-title">Teams</h2></div>'
    + '<div class="sprinty-team-grid" id="sprinty-team-grid">' + TEAMS.map((t) => _teamCard(t, t === 'Atlas' ? status : (t === 'Delta' ? 'achieved' : ''))).join('') + '</div>'
    + '<div id="sprinty-agenda-slot">' + _agenda(agenda) + '</div>';
}

export const MOCKS = {
  'sprinty-stats-page': () => modulePage({
    view: 'sprinty-stats',
    title: 'Sprint Stats',
    subtitle: 'Commitment vs delivery per team and person: Atlas, Borealis, Delta and Comet',
    actions: '<button type="button" class="ds-btn ds-btn--primary" id="sprinty-refresh-btn">Refresh</button>',
    bar: syncBar({ view: 'sprinty-stats', variant: 'success', text: 'Data up to date - local 29.09 07:30, server 29.09 07:30.' }),
    body: statsBody({}),
  }),
  'sprinty-stats-body': (p) => statsBody(p),

  /** "Refreshing Sprint Stats" - modules/sprint-stats/client/refresh-modal.js. */
  'sprinty-refresh-modal': () => modalShell({
    id: 'sprinty-refresh-modal',
    title: 'Refreshing Sprint Stats',
    size: 'md',
    body: '<div id="sprinty-refresh-confirm" class="sprinty-refresh-freshness"><div>DEMO: data from 29.09.2026 07:30</div><div>Comet: data from 29.09.2026 07:31</div></div>'
      + '<div id="sprinty-refresh-progress" hidden><div class="sprinty-refresh-stages">'
      + '<div class="sprinty-refresh-stage"><span>DEMO</span><span class="ds-badge ds-badge--gray ds-badge--sm" id="sprinty-stage-demo">waiting</span></div>'
      + '<div class="sprinty-refresh-stage"><span>Comet</span><span class="ds-badge ds-badge--gray ds-badge--sm" id="sprinty-stage-comet">waiting</span></div></div>'
      + '<div class="ds-progress"><div class="ds-progress-labels"><span id="sprinty-refresh-step">Starting...</span><span id="sprinty-refresh-pct">0%</span></div>'
      + '<div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand sprinty-refresh-fill" id="sprinty-refresh-fill"></div></div></div>'
      + '<div class="sprinty-refresh-log" id="sprinty-refresh-log"></div></div>',
    footer: '<span id="sprinty-footer-confirm" class="sprinty-footer"><button type="button" class="ds-btn ds-btn--primary" id="sprinty-refresh-active">Refresh active sprints</button>'
      + '<button type="button" class="ds-btn ds-btn--secondary">Fetch everything again</button>'
      + '<button type="button" class="ds-btn ds-btn--tertiary">Cancel</button></span>'
      + '<span id="sprinty-footer-progress" class="sprinty-footer" hidden><button type="button" class="ds-btn ds-btn--primary" id="sprinty-refresh-close" disabled>Close</button></span>',
  }),
  'sprinty-refresh-close-on': () => '<button type="button" class="ds-btn ds-btn--primary" id="sprinty-refresh-close">Close</button>',
  'sprinty-review-page': () => modulePage({
    view: 'sprinty-review',
    title: 'Sprint Review',
    subtitle: 'Sessions, teams and topics from the Sprint Review page in Confluence, goal status and the meeting agenda',
    actions: '<button type="button" class="ds-btn ds-btn--primary">New session</button><button type="button" class="ds-btn ds-btn--secondary">Import from Confluence</button>',
    bar: syncBar({ view: 'sprinty-review', variant: 'success', text: 'Data up to date - local 04.10 07:31, server 04.10 07:31.' }),
    body: reviewBody({}),
  }),
  'sprinty-review-body': (p) => reviewBody(p),
  'sprinty-team-card': ({ team = 'Atlas', status = '' } = {}) => _teamCard(team, status),
  'sprinty-agenda': ({ open = true } = {}) => _agenda(open),
};

export const LABELS = [
  'Sprint Stats', 'Commitment vs delivery per team and person: Atlas, Borealis, Delta and Comet', 'Refresh', 'Active',
  'Active - 1', 'Sprint goals', 'Sprint trend', 'Active sprint', 'Summary per team', 'During the sprint',
  'After the end', 'Sprint Review', 'Sessions, teams and topics from the Sprint Review page in Confluence, goal status and the meeting agenda',
  'New session', 'Import from Confluence', 'Sprint Review session', 'Upcoming', 'Sprint Review date', 'Host PO',
  'Teams', 'Sprint goal', 'Sprint goal status', 'Achieved', 'Partly', 'Not achieved', 'Topics',
  'Add topic', 'Approved', 'Pending', 'The card is locked for editing', 'Unlock editing', 'Finish editing',
  'Refreshing Sprint Stats', 'Refresh active sprints', 'Fetch everything again', 'Cancel', 'Close', 'waiting',
  'Agenda', 'Generate agenda', 'Download visual agenda', 'Preview', 'Copy', 'No topics submitted.',
];
