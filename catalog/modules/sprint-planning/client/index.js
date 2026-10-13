// modules/sprint-planning/client/index.js
// Sprint planning page per team and sprint number: seven ordered checklist
// cards, one plan document per (team, sprint) stored through this module's
// server (GET/POST/PUT/DELETE /plan, GET /context, GET /status).
//
// Everything that can be computed (holidays, working days, capacity, velocity
// proposal, slots, progress) lives in ./sprint-planning-lib.mjs. Core ESM
// (/js/...) is reached ONLY through dynamic imports inside init(), each with a
// fallback, so this file stays importable in plain Node without a browser.
//
// Listeners: one delegated click/change pair on the root plus one click
// listener on the header slot; both come off in registerViewCleanup, which is
// registered in render() (the registry is wiped on every exit from the view).

import {
  esc, SECTION_KEYS, ISSUE_KEY_RE, SLOT_PLACEHOLDER, formatSlot, slotDatesInSprint,
  holidaysForRange, holidaysInRange, workingDays, absenceDaysByPerson, entryDaysInSprint,
  totalAbsenceDays, capacity, velocityProposal, progress, planLabel, jiraSprintUrl,
  jiraIssueUrl, mostFrequentPerson, addDaysIso, diffDays, isIsoDate, mergeRanges, endExclusive, regularSprintDays,
} from './sprint-planning-lib.mjs';

const ROOT_ID = 'sprint-planning-main-root';
const ACTIONS_ID = 'sprint-planning-main-actions';
const SEL_KEY = 'sprint-planning.selection';
const PLAN_ID_RE = /^[a-z]+-[1-9][0-9]{0,2}$/;

const SECTION_TITLES = {
  oncall: '1. On-call',
  capacity: '2. Capacity and events',
  absences: '3. Absences',
  velocity: '4. Velocity',
  refinements: '5. Refinements',
  goal: '6. Sprint goal',
  jira: '7. Go to Jira',
};

const DEV_COLUMNS = ['platform', 'dev', 'backend', 'frontend'];
const DEVOPS_COLUMNS = ['devops'];
const DATE_SOURCE_LABELS = { jira: 'from Jira', computed: 'computed', manual: 'manual', settings: 'from settings' };
const MAX_SPRINT_WEEKS = 6;

let _deps = null;
let _dsModal = null;
let _dsSelect = null;

let _status = null; // GET /status
let _team = null; // selected team id
let _plan = null; // saved plan document
let _ctx = null; // GET /context for the selected plan
let _loadSeq = 0; // bumped by every plan load; a response of an older load is dropped
let _wiredRoot = null;
let _wiredActions = null;
let _handlers = null;
let _pickerSelect = null;
const _historyCache = new Map(); // team id -> history (for the "New planning" modal)

// -- small helpers ----------------------------------------------------------

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/sprint-planning') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _root() {
  return document.getElementById(ROOT_ID);
}

function _fmtDate(iso) {
  if (!isIsoDate(iso)) return '';
  return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
}

function _teams() {
  return (_status && _status.teams) || [];
}

function _teamById(id) {
  return _teams().find((t) => t.id === id) || null;
}

function _readSelection() {
  try { return JSON.parse(localStorage.getItem(SEL_KEY) || 'null') || {}; } catch { return {}; }
}

function _saveSelection() {
  try {
    localStorage.setItem(SEL_KEY, JSON.stringify({ team: _team, id: _plan ? _plan.id : null }));
  } catch { /* storage may be unavailable; the selection is a convenience */ }
}

async function _json(res) {
  try { return await res.json(); } catch { return {}; }
}

function _plansOfTeam(teamId) {
  return ((_status && _status.plans) || []).filter((p) => p.team === teamId);
}

function _settingsOf(teamId) {
  const all = _status && _status.settings && _status.settings.teams;
  return (all && all[teamId]) || null;
}

function _weeksLabel(n) {
  return n + (n === 1 ? ' week' : ' weeks');
}

function _calc() {
  const plan = _plan;
  const sec = plan.sections;
  const opts = { endExclusive: endExclusive(plan) };
  const hol = holidaysForRange(plan.dateFrom || '', plan.dateTo || '');
  const wd = workingDays(plan.dateFrom, plan.dateTo, hol, opts);
  const holInSprint = holidaysInRange(plan.dateFrom, plan.dateTo, hol, opts);
  const members = _ctx && _ctx.roster && _ctx.roster.available ? _ctx.roster.members : [];
  const people = sec.capacity.peopleOverride === null || sec.capacity.peopleOverride === undefined
    ? members.length : sec.capacity.peopleOverride;
  const persons = _ctx && _ctx.absences && _ctx.absences.available ? _ctx.absences.persons : [];
  const absMap = absenceDaysByPerson(persons, sec.absences.manual, wd);
  const absent = totalAbsenceDays(absMap);
  const cfg = _settingsOf(plan.team);
  const cap = capacity({
    people, workingDaysCount: wd.length, extraDaysOff: sec.capacity.extraDaysOff, absentDays: absent,
    regularDays: regularSprintDays(cfg ? cfg.sprintWeeks : 2),
  });
  const sprints = _ctx && _ctx.history && _ctx.history.available ? _ctx.history.sprints : [];
  const vel = velocityProposal(sprints, plan.sprintN, cap.baselineRatio);
  return { wd, hol, holInSprint, members, people, persons, absMap, absent, cap, sprints, vel };
}

function _dateRanges(dates) {
  const sorted = Array.from(new Set(dates)).sort();
  const out = [];
  let start = null;
  let prev = null;
  for (const d of sorted) {
    if (start === null) { start = d; prev = d; continue; }
    if (diffDays(prev, d) <= 3 && diffDays(prev, d) > 0 && _onlyWeekendBetween(prev, d)) { prev = d; continue; }
    out.push(start === prev ? _fmtDate(start) : _fmtDate(start) + ' - ' + _fmtDate(prev));
    start = d; prev = d;
  }
  if (start !== null) out.push(start === prev ? _fmtDate(start) : _fmtDate(start) + ' - ' + _fmtDate(prev));
  return out.join(', ');
}

function _onlyWeekendBetween(a, b) {
  for (let d = addDaysIso(a, 1); d < b; d = addDaysIso(d, 1)) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) return false;
  }
  return true;
}

// -- HTML builders ----------------------------------------------------------

function _callout(kind, text) {
  return '<div class="ds-callout ds-callout--' + kind + '"><div>' + esc(text) + '</div></div>';
}

function _field(label, inner, hint) {
  return '<div class="ds-input-wrap"><label class="ds-label">' + esc(label) + '</label>' + inner
    + (hint ? '<span class="ds-hint">' + esc(hint) + '</span>' : '') + '</div>';
}

function _input(f, value, attrs) {
  return '<input class="ds-input" data-f="' + f + '" value="' + esc(value) + '" ' + (attrs || '') + '>';
}

function _textarea(f, value, rows) {
  return '<textarea class="ds-textarea" data-f="' + f + '" rows="' + (rows || 3) + '">' + esc(value) + '</textarea>';
}

function _stat(label, value, tone) {
  return '<div class="ds-card ds-stat"><div class="ds-stat-value' + (tone ? ' ds-stat-value--' + tone : '') + '">'
    + esc(value) + '</div><div class="ds-stat-label">' + esc(label) + '</div></div>';
}

function _statRow(subject, tiles) {
  return '<div class="ds-stat-row" style="--ds-stat-cols:' + tiles.length + '">'
    + '<div class="ds-card ds-stat-subject">' + esc(subject) + '</div>' + tiles.join('') + '</div>';
}

function _table(headers, rows) {
  return '<div class="ds-table-wrap"><table class="ds-table"><thead><tr>'
    + headers.map((h) => '<th>' + esc(h) + '</th>').join('')
    + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}

function _listRow(list, item, ctx) {
  const id = item && item.id ? ' data-id="' + esc(item.id) + '"' : '';
  const it = item || {};
  let fields = '';
  if (list === 'events' || list === 'dependencies') {
    fields = '<input class="ds-input" data-f="text" aria-label="Description" placeholder="Description" value="' + esc(it.text) + '">';
  } else if (list === 'manual') {
    fields =
      '<input class="ds-input" data-f="person" aria-label="Person" placeholder="Person" list="sprint-planning-people" value="' + esc(it.person) + '">'
      + '<input type="date" class="ds-input" data-f="dateFrom" aria-label="From" value="' + esc(it.dateFrom) + '">'
      + '<input type="date" class="ds-input" data-f="dateTo" aria-label="To" value="' + esc(it.dateTo) + '">'
      + '<input class="ds-input" data-f="reason" aria-label="Reason" placeholder="Reason" value="' + esc(it.reason) + '">';
  } else if (list === 'items') {
    fields =
      '<input class="ds-input" data-f="key" aria-label="Issue key" placeholder="Issue key, e.g. ATL-123" value="' + esc(it.key) + '">'
      + '<input class="ds-input" data-f="topic" aria-label="Topic" placeholder="Topic" value="' + esc(it.topic) + '">'
      + '<input class="ds-input" data-f="note" aria-label="Notes" placeholder="Notes" value="' + esc(it.note) + '">';
  } else if (list === 'cross') {
    const chosen = Array.isArray(it.teams) ? it.teams : [];
    const others = _teams().filter((t) => t.id !== (ctx && ctx.team));
    const boxes = others.map((t) =>
      '<label class="ds-checkbox-label"><input type="checkbox" data-team="' + esc(t.id) + '"'
      + (chosen.includes(t.id) ? ' checked' : '') + '> ' + esc(t.label)
      + ' <span class="ds-hint">' + esc(formatSlot(t.refinementSlot)) + '</span></label>').join('');
    fields =
      '<input class="ds-input" data-f="key" aria-label="Issue key" placeholder="Issue key, e.g. ATL-123" value="' + esc(it.key) + '">'
      + '<div class="sprint-planning-checks">' + boxes + '</div>'
      + '<input class="ds-input" data-f="note" aria-label="Notes" placeholder="Notes" value="' + esc(it.note) + '">';
  }
  let link = '';
  if ((list === 'items' || list === 'cross') && it.key) {
    const url = jiraIssueUrl(_status && _status.jiraUrl, it.key);
    if (url) {
      link = '<a class="ds-btn ds-btn--tertiary ds-btn--sm" target="_blank" rel="noopener noreferrer" href="'
        + esc(url) + '">Open ' + esc(it.key) + '</a>';
    }
  }
  return '<div class="sprint-planning-listrow sprint-planning-listrow--' + list + '" data-row' + id + '>'
    + fields + link
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ps-remove>Remove</button></div>';
}

function _listBlock(list, title, items, addLabel) {
  const plan = _plan;
  return '<div class="sprint-planning-list"><h3 class="sprint-planning-subtitle">' + esc(title) + '</h3>'
    + '<div data-list="' + list + '">' + (items || []).map((i) => _listRow(list, i, plan)).join('') + '</div>'
    + '<div class="ds-actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ps-add="' + list + '">'
    + esc(addLabel) + '</button></div></div>';
}

function _cardShell(key, body) {
  const done = _plan.sections[key].done;
  return '<div class="ds-card" data-card="' + key + '"><div class="ds-card-body">'
    + '<div class="ds-section-head"><h2 class="ds-section-head-title">' + esc(SECTION_TITLES[key]) + '</h2>'
    + '<div class="ds-section-head-actions">'
    + '<span class="ds-badge ' + (done ? 'ds-badge--green' : 'ds-badge--gray') + '">' + (done ? 'Done' : 'To do') + '</span>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ps-done="' + key + '" data-value="' + (done ? '0' : '1') + '">'
    + (done ? 'Undo' : 'Mark as done') + '</button>'
    + '</div></div>' + body + '</div></div>';
}

function _saveBar(key) {
  return '<div class="ds-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ps-save="' + key + '">Save</button></div>';
}

function _oncallBody() {
  const sec = _plan.sections.oncall;
  const duties = _ctx && _ctx.duties;
  let html = '';
  let devSuggest = '';
  let devopsSuggest = '';
  if (!duties || !duties.available || !duties.entries.length) {
    html += _callout('info', 'No on-call schedule for these days - fill it in by hand.');
  } else {
    const rosterSlugs = new Set(((_ctx.roster && _ctx.roster.members) || []).map((m) => m.slug));
    devSuggest = mostFrequentPerson(duties.entries, DEV_COLUMNS);
    devopsSuggest = mostFrequentPerson(duties.entries, DEVOPS_COLUMNS);
    for (const col of duties.columns) {
      const byPerson = new Map();
      for (const e of duties.entries) {
        if (e.column !== col.key || !e.person) continue;
        if (!byPerson.has(e.person)) byPerson.set(e.person, { slug: e.person_slug, dates: [] });
        byPerson.get(e.person).dates.push(e.date);
      }
      if (!byPerson.size) continue;
      const rows = [];
      for (const [person, v] of byPerson) {
        rows.push('<tr><td>' + esc(person)
          + (rosterSlugs.has(v.slug) ? ' <span class="ds-badge ds-badge--blue">in the team</span>' : '')
          + '</td><td>' + esc(_dateRanges(v.dates)) + '</td></tr>');
      }
      html += '<h3 class="sprint-planning-subtitle">' + esc(col.label) + '</h3>' + _table(['Person', 'Days in the sprint'], rows);
    }
  }
  html += '<div class="sprint-planning-form">'
    + _field('Dev on-call', _input('dev', sec.dev || devSuggest))
    + _field('DevOps on-call', _input('devops', sec.devops || devopsSuggest))
    + _field('Notes', _textarea('note', sec.note, 3)) + '</div>';
  return html + _saveBar('oncall');
}

function _capacityBody() {
  const sec = _plan.sections.capacity;
  const c = _calc();
  const team = _teamById(_plan.team);
  const src = DATE_SOURCE_LABELS[_plan.datesSource];
  let html = '<div class="sprint-planning-form sprint-planning-form--dates">'
    + _field('Sprint start', _input('dateFrom', _plan.dateFrom || '', 'type="date"'))
    + _field('Sprint end', _input('dateTo', _plan.dateTo || '', 'type="date"'))
    + (src ? '<span class="ds-badge ds-badge--gray">' + esc(src) + '</span>' : '') + '</div>'
    + '<p class="ds-hint">A sprint of whole weeks ends where the next one starts, so its end day is not counted as a working day.</p>';
  const cfg = _settingsOf(_plan.team);
  if (cfg && _plan.sprintN >= cfg.firstSprintN) {
    if (_plan.datesSource !== 'settings') {
      // Dates chain only when a plan is CREATED, so an existing later plan keeps its own dates.
      const hasLater = _plansOfTeam(_plan.team).some((p) => p.sprintN > _plan.sprintN);
      html += _callout('info', 'This sprint has different dates than the team settings (' + _weeksLabel(cfg.sprintWeeks)
        + '). ' + (hasLater
          ? 'A later planning already exists and keeps its own dates - check that it does not overlap this sprint.'
          : 'The next sprint will start after this one ends; the team settings do not change.'))
        + '<div class="ds-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ps-reset-dates>Restore dates from settings</button></div>';
    }
  } else if (!cfg) {
    html += '<p class="ds-hint">The team has no sprint length set - set it with the "Sprint settings" button.</p>';
  }
  if (!_ctx || !_ctx.roster || !_ctx.roster.available) {
    html += _callout('warning', 'No team roster - enter the number of people by hand.');
  }
  html += _statRow(team ? team.label : _plan.team, [
    _stat('Working days', c.wd.length),
    _stat('Holidays in the sprint', c.holInSprint.length),
    _stat('People in the team', c.people),
    _stat('Person-days available', c.cap.available),
  ]);
  if (c.holInSprint.length) {
    html += '<p class="ds-hint">Holidays: ' + esc(c.holInSprint.map(_fmtDate).join(', ')) + '</p>';
  }
  html += '<div class="sprint-planning-form">'
    + _field('Number of people (override)', _input('peopleOverride', sec.peopleOverride === null ? '' : sec.peopleOverride,
      'type="number" min="0" max="50" placeholder="' + esc(c.members.length) + '"'))
    + _field('Team days off', _input('extraDaysOff', sec.extraDaysOff, 'type="number" min="0" max="10"')) + '</div>'
    + _listBlock('events', 'Events', sec.events, 'Add')
    + _listBlock('dependencies', 'Dependencies', sec.dependencies, 'Add');
  return html + _saveBar('capacity');
}

function _absencesBody() {
  const sec = _plan.sections.absences;
  const c = _calc();
  let html = '<h3 class="sprint-planning-subtitle">From the time-off calendar</h3>';
  const rows = [];
  for (const p of c.persons) {
    for (const e of mergeRanges(p.entries)) {
      const n = entryDaysInSprint(e.dateFrom, e.dateTo, c.wd);
      if (!n) continue;
      rows.push('<tr><td>' + esc(p.name) + '</td><td>' + esc(_fmtDate(e.dateFrom)) + '</td><td>' + esc(_fmtDate(e.dateTo))
        + '</td><td>' + n + '</td></tr>');
    }
  }
  if (_ctx && _ctx.absences && !_ctx.absences.available) {
    html += _callout('info', 'The time-off calendar is unavailable - enter absences by hand.');
  } else if (!rows.length) {
    html += _callout('neutral', 'No team time off in this sprint.');
  } else {
    html += _table(['Person', 'From', 'To', 'Days in the sprint'], rows);
  }
  const names = c.members.map((m) => '<option value="' + esc(m.name) + '"></option>').join('');
  html += '<datalist id="sprint-planning-people">' + names + '</datalist>'
    + _listBlock('manual', 'Reported on Teams', sec.manual, 'Add absence')
    + '<p class="sprint-planning-sum">Total: ' + c.absent + ' person-days of absence</p>';
  return html + _saveBar('absences');
}

function _velocityBody() {
  const sec = _plan.sections.velocity;
  const c = _calc();
  const unit = (_ctx && _ctx.history && _ctx.history.unit) || (_teamById(_plan.team) || {}).unit || '';
  const hist = _ctx && _ctx.history;
  let html = '';
  if (!hist || !hist.available || !hist.sprints.length) {
    html += _callout('info', 'No sprint history in Sprint Stats - enter the velocity by hand.');
  } else {
    const basisN = new Set(c.vel.basis.map((s) => s.sprintN));
    const shown = hist.sprints.slice().sort((a, b) => b.sprintN - a.sprintN).slice(0, 8);
    const rows = shown.map((s) => {
      const inBasis = basisN.has(s.sprintN);
      return '<tr' + (inBasis ? '' : ' class="sprint-planning-muted"') + '><td>Sprint ' + esc(s.sprintN) + '</td><td>'
        + esc(s.committed) + '</td><td>' + esc(s.done) + '</td><td>' + esc(unit) + '</td><td>'
        + (s.state === 'active' ? '<span class="ds-badge ds-badge--blue">in progress</span>'
          : inBasis ? '<span class="ds-badge ds-badge--green">in the average</span>' : '') + '</td></tr>';
    });
    html += _table(['Sprint', 'Committed', 'Delivered', 'Unit', ''], rows);
  }
  const team = _teamById(_plan.team);
  html += _statRow(team ? team.label : _plan.team, [
    _stat('Average of ' + c.vel.basis.length + ' sprints', c.vel.average === null ? '-' : Math.round(c.vel.average * 10) / 10),
    _stat('Availability against a regular sprint', c.cap.baselineRatio === null ? '-' : Math.round(c.cap.baselineRatio * 100) + '%'),
    _stat('Proposal (' + unit + ')', c.vel.proposal === null ? '-' : c.vel.proposal, 'success'),
  ]);
  html += '<div class="sprint-planning-form">'
    + _field('Velocity for this sprint', _input('override', sec.override === null ? '' : sec.override,
      'type="number" min="0" placeholder="' + esc(c.vel.proposal === null ? '' : c.vel.proposal) + '"'),
    'An empty field means the proposal from history.')
    + _field('Rationale', _textarea('note', sec.note, 3)) + '</div>';
  return html + _saveBar('velocity');
}

function _refinementsBody() {
  const sec = _plan.sections.refinements;
  const team = _teamById(_plan.team);
  const slot = team ? team.refinementSlot : null;
  let html = slot
    ? '<p>Refinement slot: ' + esc(formatSlot(slot)) + '</p>'
    : _callout('info', SLOT_PLACEHOLDER);
  if (slot) {
    const dates = slotDatesInSprint(slot, _plan.dateFrom, _plan.dateTo);
    if (dates.length) html += '<p class="ds-hint">Dates in the sprint: ' + esc(dates.map(_fmtDate).join(', ')) + '</p>';
  }
  html += _listBlock('items', 'Team refinements', sec.items, 'Add refinement')
    + _listBlock('cross', 'Cross-refinements', sec.cross, 'Add cross-refinement');
  return html + _saveBar('refinements');
}

function _goalBody() {
  const sec = _plan.sections.goal;
  const jiraGoal = _jiraGoal();
  return '<div class="sprint-planning-form">' + _field('Sprint goal', _textarea('goal', sec.goal, 5)) + '</div>'
    + '<div class="ds-actions">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ps-save="goal">Save</button>'
    + (!sec.goal && jiraGoal
      ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ps-fill-goal>Insert goal from Jira</button>' : '')
    + '</div>';
}

function _jiraGoal() {
  const s = _ctx && _ctx.history && _ctx.history.sprints
    ? _ctx.history.sprints.find((x) => x.sprintN === _plan.sprintN) : null;
  return s && s.goal ? s.goal : '';
}

function _jiraBody() {
  const team = _teamById(_plan.team);
  const board = team && _status.boards ? _status.boards[team.sprintSrc] : null;
  const sprint = _ctx && _ctx.history && _ctx.history.sprints
    ? _ctx.history.sprints.find((x) => x.sprintN === _plan.sprintN) : null;
  const url = board ? jiraSprintUrl({
    sprintId: sprint && sprint.sprintId, boardId: board.board_id, projectKey: board.project, jiraBase: _status.jiraUrl,
  }) : null;
  const open = url
    ? '<a class="ds-btn ds-btn--secondary ds-btn--sm" target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">Open the board in Jira</a>'
    : '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" disabled>Open the board in Jira</button>';
  return '<div class="ds-actions">' + open
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ps-copy-goal>Copy sprint goal</button></div>'
    + (url ? '' : '<p class="ds-hint">This team\'s board is not known in the Sprint Stats data.</p>')
    + '<p class="ds-hint">Nothing is written to Jira - the button only opens the board.</p>';
}

const BODY_BUILDERS = {
  oncall: _oncallBody, capacity: _capacityBody, absences: _absencesBody,
  velocity: _velocityBody, refinements: _refinementsBody, goal: _goalBody, jira: _jiraBody,
};

function _cardHtml(key) {
  return _cardShell(key, BODY_BUILDERS[key]());
}

function _progressHtml() {
  const p = progress(_plan);
  const pct = Math.round((p.done / p.total) * 100);
  return '<div class="ds-progress" data-ps-progress><div class="ds-progress-labels"><span>Progress: '
    + p.done + ' of ' + p.total + ' steps</span></div><div class="ds-progress-track">'
    + '<div class="ds-progress-fill ds-progress-fill--green" style="width:' + pct + '%"></div></div></div>';
}

function _filterHtml() {
  const teams = _teams();
  const seg = teams.map((t) =>
    '<button type="button" class="ds-segment' + (t.id === _team ? ' active' : '') + '" data-ps-team="' + esc(t.id)
    + '" aria-pressed="' + (t.id === _team ? 'true' : 'false') + '">' + esc(t.label) + '</button>').join('');
  const plans = _plansOfTeam(_team);
  const opts = plans.map((p) =>
    '<option value="' + esc(p.id) + '"' + (_plan && _plan.id === p.id ? ' selected' : '') + '>Sprint ' + esc(p.sprintN) + '</option>').join('');
  return '<div class="sprint-planning-filters"><div class="ds-segmented" role="group" aria-label="Team">' + seg + '</div>'
    + (plans.length
      ? '<div class="ds-input-wrap"><label class="ds-label" for="sprint-planning-picker">Sprint</label>'
        + '<select id="sprint-planning-picker" class="ds-input" data-ps-plan>' + opts + '</select></div>'
      : '')
    + '</div>';
}

// -- painting ---------------------------------------------------------------

function _destroyPicker() {
  if (_pickerSelect && _dsSelect) { try { _dsSelect.destroySelect(_pickerSelect); } catch { /* already bare */ } }
  _pickerSelect = null;
}

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  const disabled = _status && _status.storage === 'unavailable' ? ' disabled' : '';
  actions.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary" data-ps-settings' + disabled + '>Sprint settings</button>'
    + '<button type="button" class="ds-btn ds-btn--primary" data-ps-new' + disabled + '>New planning</button>';
}

function _paint() {
  const root = _root();
  if (!root) return;
  _destroyPicker();
  _paintActions();
  if (!_status) {
    root.innerHTML = _callout('danger', 'Could not load sprint planning. Refresh the view.');
    return;
  }
  let html = '';
  if (_status.storage === 'unavailable') {
    html += _callout('warning', 'Team data is not downloaded. Pull "Team data" from the sync window in the top bar to create and edit plannings.');
  }
  html += _filterHtml();
  if (!_plan) {
    html += '<div class="ds-empty"><div class="ds-empty-title">This team has no planning yet</div>'
      + '<p>Use the "New planning" button to create the first one.</p></div>';
  } else {
    html += '<div class="sprint-planning-planhead"><h2 class="sprint-planning-title">' + esc(planLabel(_plan, _teams())) + '</h2>'
      + '<span class="ds-hint">' + esc(_fmtDate(_plan.dateFrom)) + ' - ' + esc(_fmtDate(_plan.dateTo)) + '</span></div>'
      + '<div data-ps-progress-slot>' + _progressHtml() + '</div>'
      + '<div class="sprint-planning-cards">' + SECTION_KEYS.map(_cardHtml).join('') + '</div>'
      + '<div class="ds-actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ps-delete>Delete planning</button></div>';
  }
  root.innerHTML = html;
  const sel = root.querySelector('select[data-ps-plan]');
  if (sel && _dsSelect) { try { _dsSelect.initSelect(sel); _pickerSelect = sel; } catch { /* bare select still works */ } }
}

/** Repaints the given cards; a sibling with unsaved edits (data-dirty) is left alone. */
function _repaintCards(keys, savedKey) {
  const root = _root();
  if (!root || !_plan) return;
  for (const key of keys) {
    const el = root.querySelector('[data-card="' + key + '"]');
    if (!el) continue;
    if (key !== savedKey && el.dataset.dirty === '1') continue;
    el.outerHTML = _cardHtml(key);
  }
  const slot = root.querySelector('[data-ps-progress-slot]');
  if (slot) slot.innerHTML = _progressHtml();
}

// -- loading ----------------------------------------------------------------

async function _loadStatus() {
  try {
    const res = await fetch(_api('/status'));
    const data = await _json(res);
    if (!res.ok) throw new Error(data.message || 'Could not read the status.');
    _status = data;
  } catch (e) {
    _status = null;
    _toast('danger', 'Could not load the planning', e.message || '');
  }
}

async function _loadContext() {
  const seq = _loadSeq;
  _ctx = null;
  if (!_plan || !isIsoDate(_plan.dateFrom) || !isIsoDate(_plan.dateTo)) return;
  const planId = _plan.id;
  const team = _plan.team;
  try {
    const q = '?team=' + encodeURIComponent(team) + '&from=' + _plan.dateFrom + '&to=' + _plan.dateTo;
    const res = await fetch(_api('/context' + q));
    const data = await _json(res);
    if (seq !== _loadSeq || !_plan || _plan.id !== planId) return;
    if (!res.ok) throw new Error(data.message || 'Could not read the context data.');
    _ctx = data;
    if (data.history) _historyCache.set(team, data.history);
  } catch (e) {
    if (seq !== _loadSeq) return;
    _toast('warning', 'No suggestion data', e.message || '');
  }
}

/** Loads one plan and its context; false when a newer load superseded this one. */
async function _loadPlan(id, seqArg) {
  const seq = seqArg || ++_loadSeq;
  _plan = null;
  _ctx = null;
  if (!id) return true;
  try {
    const res = await fetch(_api('/plan?id=' + encodeURIComponent(id)));
    const data = await _json(res);
    if (seq !== _loadSeq) return false;
    if (!res.ok) throw new Error(data.message || 'Could not load the planning.');
    _plan = data;
  } catch (e) {
    if (seq !== _loadSeq) return false;
    _toast('danger', 'Could not load the planning', e.message || '');
    return true;
  }
  await _loadContext();
  return seq === _loadSeq;
}

async function _selectTeam(teamId, preferredPlanId) {
  const seq = ++_loadSeq;
  _team = teamId;
  const plans = _plansOfTeam(teamId);
  const pick = plans.find((p) => p.id === preferredPlanId) || plans[0] || null;
  if (!(await _loadPlan(pick ? pick.id : null, seq))) return;
  _saveSelection();
  _paint();
}

async function _reloadAll(planId) {
  await _loadStatus();
  if (!_status) { _paint(); return; }
  if (!_teamById(_team)) _team = _teams()[0] ? _teams()[0].id : null;
  await _selectTeam(_team, planId);
}

// -- saving -----------------------------------------------------------------

// PUTs run one at a time and read the base version when their turn comes, so a
// second save never goes out with the updatedAt of the first one.
let _putChain = Promise.resolve();

function _putPlan(patch) {
  const run = _putChain.then(() => _putPlanNow(patch));
  _putChain = run.catch(() => {});
  return run;
}

async function _putPlanNow(patch) {
  const body = Object.assign({ baseUpdatedAt: _plan.updatedAt }, patch);
  const res = await fetch(_api('/plan?id=' + encodeURIComponent(_plan.id)), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await _json(res);
  if (res.status === 409 && data.error === 'stale') {
    _toast('warning', 'Someone saved changes before you - the latest version was loaded');
    await _reloadAll(_plan.id);
    return null;
  }
  if (!res.ok) throw new Error(data.message || 'Could not save.');
  if (_plan && _plan.id === data.id) _plan = data;
  return data;
}

function _refreshStatusPlan(saved) {
  const row = ((_status && _status.plans) || []).find((p) => p.id === saved.id);
  if (!row) return;
  row.updatedAt = saved.updatedAt;
  row.dateFrom = saved.dateFrom;
  row.dateTo = saved.dateTo;
  row.doneCount = progress(saved).done;
}

function _collectList(card, list) {
  const wrap = card.querySelector('[data-list="' + list + '"]');
  const out = [];
  if (!wrap) return out;
  for (const row of wrap.querySelectorAll('[data-row]')) {
    const item = {};
    if (row.dataset.id) item.id = row.dataset.id;
    for (const inp of row.querySelectorAll('[data-f]')) item[inp.dataset.f] = inp.value.trim();
    if (list === 'cross') {
      item.teams = Array.from(row.querySelectorAll('input[data-team]:checked')).map((c) => c.dataset.team);
    }
    out.push(item);
  }
  return out;
}

function _val(card, f) {
  const el = card.querySelector('[data-f="' + f + '"]');
  return el ? el.value.trim() : '';
}

/** Returns { fields, dates? } for a section, or { error } with a user-facing message. */
function _collect(card, key) {
  if (key === 'oncall') {
    return { fields: { dev: _val(card, 'dev'), devops: _val(card, 'devops'), note: _val(card, 'note') } };
  }
  if (key === 'capacity') {
    const po = _val(card, 'peopleOverride');
    const extra = Number(_val(card, 'extraDaysOff') || 0);
    if (po !== '' && !(Number(po) >= 0 && Number(po) <= 50)) return { error: 'The number of people must be between 0 and 50.' };
    if (!(extra >= 0 && extra <= 10)) return { error: 'Team days off: enter a number from 0 to 10.' };
    const dateFrom = _val(card, 'dateFrom');
    const dateTo = _val(card, 'dateTo');
    if (dateFrom && dateTo && dateFrom > dateTo) return { error: 'The sprint start cannot be after its end.' };
    const fields = {
      peopleOverride: po === '' ? null : Number(po), extraDaysOff: extra,
      events: _collectList(card, 'events').filter((i) => i.text),
      dependencies: _collectList(card, 'dependencies').filter((i) => i.text),
    };
    const dates = {};
    if (dateFrom && dateFrom !== _plan.dateFrom) dates.dateFrom = dateFrom;
    if (dateTo && dateTo !== _plan.dateTo) dates.dateTo = dateTo;
    return { fields, dates };
  }
  if (key === 'absences') {
    const manual = _collectList(card, 'manual').filter((i) => i.person || i.dateFrom || i.dateTo);
    for (const m of manual) {
      if (!m.person || !m.dateFrom || !m.dateTo) return { error: 'Fill in the person and the from and to dates for every absence.' };
      if (m.dateFrom > m.dateTo) return { error: 'The "from" date cannot be after the "to" date.' };
    }
    return { fields: { manual } };
  }
  if (key === 'velocity') {
    const ov = _val(card, 'override');
    if (ov !== '' && !(Number(ov) >= 0)) return { error: 'Velocity must be a non-negative number.' };
    return { fields: { override: ov === '' ? null : Number(ov), note: _val(card, 'note') } };
  }
  if (key === 'refinements') {
    const items = _collectList(card, 'items').filter((i) => i.key || i.topic || i.note);
    const cross = _collectList(card, 'cross').filter((i) => i.key || i.note || i.teams.length);
    for (const i of items.concat(cross)) {
      if (i.key && !ISSUE_KEY_RE.test(i.key)) return { error: 'Issue key "' + i.key + '" has a wrong format (e.g. ATL-123).' };
    }
    return { fields: { items, cross } };
  }
  if (key === 'goal') return { fields: { goal: card.querySelector('[data-f="goal"]').value.trim() } };
  return { fields: {} };
}

async function _saveSection(btn, key) {
  const card = btn.closest('[data-card]');
  const col = _collect(card, key);
  if (col.error) { _toast('warning', col.error); return; }
  const patch = { sections: { [key]: col.fields } };
  const datesChanged = col.dates && Object.keys(col.dates).length > 0;
  if (datesChanged) Object.assign(patch, col.dates);
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try {
    const saved = await _putPlan(patch);
    if (!saved) return;
    _plan = saved;
    _refreshStatusPlan(saved);
    if (datesChanged) {
      await _loadContext();
      _paint();
    } else {
      _repaintCards(key === 'capacity' || key === 'absences' || key === 'velocity'
        ? ['capacity', 'absences', 'velocity'] : [key], key);
    }
    _toast('success', 'Saved');
  } catch (e) {
    _toast('danger', 'Save failed', e.message || '');
  } finally {
    if (btn.isConnected) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
  }
}

async function _toggleDone(btn, key) {
  const value = btn.dataset.value === '1';
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try {
    const saved = await _putPlan({ sections: { [key]: { done: value } } });
    if (!saved) return;
    _plan = saved;
    _refreshStatusPlan(saved);
    // Only the head of the card changes; keep unsaved edits inside it.
    const card = btn.closest('[data-card]');
    const tmp = document.createElement('div');
    tmp.innerHTML = _cardShell(key, '');
    const newHead = tmp.querySelector('.ds-section-head');
    const oldHead = card.querySelector('.ds-section-head');
    if (newHead && oldHead) oldHead.replaceWith(newHead);
    const slot = _root().querySelector('[data-ps-progress-slot]');
    if (slot) slot.innerHTML = _progressHtml();
  } catch (e) {
    _toast('danger', 'Save failed', e.message || '');
  } finally {
    if (btn.isConnected) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
  }
}

// -- new plan modal, delete -------------------------------------------------

async function _historyFor(teamId) {
  if (_historyCache.has(teamId)) return _historyCache.get(teamId);
  try {
    const from = new Date().toISOString().slice(0, 10);
    const q = '?team=' + encodeURIComponent(teamId) + '&from=' + from + '&to=' + addDaysIso(from, 14);
    const res = await fetch(_api('/context' + q));
    const data = await _json(res);
    if (res.ok && data.history) { _historyCache.set(teamId, data.history); return data.history; }
  } catch { /* the number just stays empty */ }
  return null;
}

function _nextSprintNumber(teamId, history) {
  let max = 0;
  for (const p of _plansOfTeam(teamId)) if (p.sprintN > max) max = p.sprintN;
  const cfg = _settingsOf(teamId);
  if (cfg) return max >= cfg.firstSprintN ? max + 1 : cfg.firstSprintN;
  if (history && history.sprints) for (const s of history.sprints) if (s.sprintN > max) max = s.sprintN;
  return max ? max + 1 : '';
}

async function _openNewModal(trigger) {
  if (!_dsModal) { try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; } }
  const opts = _teams().map((t) =>
    '<option value="' + esc(t.id) + '"' + (t.id === _team ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('');
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  const titleId = 'ps-new-title';
  overlay.innerHTML =
    '<div class="ds-modal" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="' + titleId + '">New planning</span></div>'
    + '<div class="ds-modal-body">'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ps-new-team">Team</label>'
    + '<select id="ps-new-team" class="ds-input">' + opts + '</select></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ps-new-n">Sprint number</label>'
    + '<input type="number" id="ps-new-n" class="ds-input" min="1" max="999"></div>'
    + '<div class="ds-callout ds-callout--danger" data-ps-new-error hidden><div></div></div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-ps-new-ok>Create</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-ps-new-cancel>Cancel</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  const teamSel = overlay.querySelector('#ps-new-team');
  const nInput = overlay.querySelector('#ps-new-n');
  if (_dsSelect) { try { _dsSelect.initSelect(teamSel); } catch { /* bare select still works */ } }
  const prefill = async () => {
    const t = teamSel.value;
    nInput.value = _nextSprintNumber(t, _historyCache.get(t) || null);
    const h = await _historyFor(t);
    if (teamSel.value === t && h) nInput.value = _nextSprintNumber(t, h);
  };
  teamSel.addEventListener('change', prefill);
  prefill();

  const close = () => {
    if (_dsSelect) { try { _dsSelect.destroySelect(teamSel); } catch { /* already bare */ } }
    if (_dsModal) _dsModal.closeDsModal(overlay);
    overlay.remove();
  };
  overlay.querySelector('[data-ps-new-cancel]').addEventListener('click', close);
  const ok = overlay.querySelector('[data-ps-new-ok]');
  ok.addEventListener('click', async () => {
    const errEl = overlay.querySelector('[data-ps-new-error]');
    const sprintN = Number(nInput.value);
    if (!Number.isInteger(sprintN) || sprintN < 1 || sprintN > 999) {
      errEl.querySelector('div').textContent = 'Enter a sprint number (1-999).';
      errEl.hidden = false;
      return;
    }
    ok.setAttribute('aria-busy', 'true');
    ok.disabled = true;
    try {
      const res = await fetch(_api('/plan'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: teamSel.value, sprintN }),
      });
      const data = await _json(res);
      if (res.status === 409 && data.error === 'exists') {
        _toast('info', 'A planning for this sprint already exists');
        const existingTeam = teamSel.value;
        close();
        _team = existingTeam;
        await _reloadAll(data.id);
        return;
      }
      if (!res.ok) throw new Error(data.message || 'Could not create the planning.');
      close();
      _team = data.team;
      await _reloadAll(data.id);
      _toast('success', 'Planning created');
    } catch (e) {
      errEl.querySelector('div').textContent = e.message || 'Failed to create the planning.';
      errEl.hidden = false;
    } finally {
      if (ok.isConnected) { ok.removeAttribute('aria-busy'); ok.disabled = false; }
    }
  });
  if (_dsModal) _dsModal.openDsModal(overlay, { trigger }); else overlay.hidden = false;
}

// -- sprint settings modal, reset dates ---------------------------------------

function _settingsRowHtml(team) {
  const cfg = _settingsOf(team.id);
  const weeks = ['<option value="">Not set</option>'];
  for (let n = 1; n <= MAX_SPRINT_WEEKS; n++) {
    weeks.push('<option value="' + n + '"' + (cfg && cfg.sprintWeeks === n ? ' selected' : '') + '>' + esc(_weeksLabel(n)) + '</option>');
  }
  const id = 'ps-set-' + team.id;
  return '<fieldset class="sprint-planning-settings-team" data-ps-set-team="' + esc(team.id) + '">'
    + '<legend class="sprint-planning-subtitle">' + esc(team.label) + '</legend>'
    + '<div class="sprint-planning-form sprint-planning-form--settings">'
    + '<div class="ds-input-wrap"><label class="ds-label" for="' + id + '-w">Sprint length</label>'
    + '<select id="' + id + '-w" class="ds-input" data-set="sprintWeeks">' + weeks.join('') + '</select></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="' + id + '-n">First sprint in the app (no.)</label>'
    + '<input id="' + id + '-n" type="number" min="1" max="999" class="ds-input" data-set="firstSprintN" value="' + esc(cfg ? cfg.firstSprintN : '') + '"></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="' + id + '-d">Start of the first sprint</label>'
    + '<input id="' + id + '-d" type="date" class="ds-input" data-set="firstSprintStart" value="' + esc(cfg ? cfg.firstSprintStart : '') + '"></div>'
    + '</div></fieldset>';
}

/** Reads the modal into the PUT /settings `teams` map, or { error }. */
function _collectSettings(overlay) {
  const teams = {};
  for (const block of overlay.querySelectorAll('[data-ps-set-team]')) {
    const id = block.dataset.psSetTeam;
    const team = _teamById(id);
    const weeks = block.querySelector('[data-set="sprintWeeks"]').value;
    const first = block.querySelector('[data-set="firstSprintN"]').value.trim();
    const start = block.querySelector('[data-set="firstSprintStart"]').value;
    if (!weeks && !first && !start) {
      if (_settingsOf(id)) teams[id] = null;
      continue;
    }
    const label = team ? team.label : id;
    if (!weeks || !first || !start) return { error: label + ': fill in the sprint length, the number and the start date of the first sprint, or clear all three fields.' };
    const n = Number(first);
    if (!Number.isInteger(n) || n < 1 || n > 999) return { error: label + ': the first sprint number must be a number from 1 to 999.' };
    if (!isIsoDate(start)) return { error: label + ': enter a valid start date of the first sprint.' };
    teams[id] = { sprintWeeks: Number(weeks), firstSprintN: n, firstSprintStart: start };
  }
  return { teams };
}

async function _openSettingsModal(trigger) {
  if (!_dsModal) { try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; } }
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  const titleId = 'ps-settings-title';
  overlay.innerHTML =
    '<div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="' + titleId + '">Sprint settings</span></div>'
    + '<div class="ds-modal-body">'
    + '<p class="ds-hint">From these settings the app computes the dates of the next sprints. You can always change the dates of a single sprint on its page (for example three weeks instead of two, once) - the team settings stay unchanged and the next sprint starts after the changed one ends.</p>'
    + _teams().map(_settingsRowHtml).join('')
    + '<div class="ds-callout ds-callout--danger" data-ps-set-error hidden><div></div></div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-ps-set-ok>Save</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-ps-set-cancel>Cancel</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  const selects = Array.from(overlay.querySelectorAll('select'));
  if (_dsSelect) for (const sel of selects) { try { _dsSelect.initSelect(sel); } catch { /* bare select still works */ } }
  const close = () => {
    if (_dsSelect) for (const sel of selects) { try { _dsSelect.destroySelect(sel); } catch { /* already bare */ } }
    if (_dsModal) _dsModal.closeDsModal(overlay);
    overlay.remove();
  };
  overlay.querySelector('[data-ps-set-cancel]').addEventListener('click', close);
  const ok = overlay.querySelector('[data-ps-set-ok]');
  ok.addEventListener('click', async () => {
    const errEl = overlay.querySelector('[data-ps-set-error]');
    const col = _collectSettings(overlay);
    if (col.error) {
      errEl.querySelector('div').textContent = col.error;
      errEl.hidden = false;
      return;
    }
    if (!Object.keys(col.teams).length) { close(); return; }
    ok.setAttribute('aria-busy', 'true');
    ok.disabled = true;
    try {
      const baseUpdatedAt = (_status && _status.settings && _status.settings.updatedAt) || null;
      const res = await fetch(_api('/settings'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUpdatedAt, teams: col.teams }),
      });
      const data = await _json(res);
      if (res.status === 409 && data.error === 'stale') {
        close();
        _toast('warning', 'Someone saved the settings before you - the latest were loaded, make your changes again');
        await _reloadAll(_plan ? _plan.id : null);
        return;
      }
      if (!res.ok) throw new Error(data.message || 'Could not save the settings.');
      if (_status) _status.settings = data;
      close();
      if (_plan) _repaintCards(['capacity']);
      _toast('success', 'Sprint settings saved');
    } catch (e) {
      errEl.querySelector('div').textContent = e.message || 'Failed to save the settings.';
      errEl.hidden = false;
    } finally {
      if (ok.isConnected) { ok.removeAttribute('aria-busy'); ok.disabled = false; }
    }
  });
  if (_dsModal) _dsModal.openDsModal(overlay, { trigger }); else overlay.hidden = false;
}

async function _resetDates(btn) {
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try {
    const saved = await _putPlan({ resetDates: true });
    if (!saved) return;
    _plan = saved;
    _refreshStatusPlan(saved);
    await _loadContext();
    _paint();
    _toast('success', 'Dates restored from settings');
  } catch (e) {
    _toast('danger', 'Could not restore the dates', e.message || '');
  } finally {
    if (btn.isConnected) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
  }
}

async function _deletePlan(btn) {
  if (!_dsModal) { try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; } }
  if (!_dsModal) { _toast('danger', 'Cannot open the confirmation dialog'); return; }
  const ok = await _dsModal.confirmDsModal({
    title: 'Delete the planning?',
    body: 'Delete "' + planLabel(_plan, _teams()) + '"? This cannot be undone.',
    okLabel: 'Delete', danger: true, trigger: btn,
  });
  if (!ok) return;
  try {
    // The core refuses a mutating request without a JSON Content-Type (415).
    const res = await fetch(_api('/plan?id=' + encodeURIComponent(_plan.id)), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await _json(res);
    if (!res.ok) throw new Error(data.message || 'Could not delete.');
    _toast('success', 'Planning deleted');
    await _reloadAll(null);
  } catch (e) {
    _toast('danger', 'Delete failed', e.message || '');
  }
}

async function _copyGoal() {
  const goal = _plan.sections.goal.goal;
  if (!goal) { _toast('info', 'The sprint goal is empty'); return; }
  try {
    await navigator.clipboard.writeText(goal);
    _toast('success', 'Sprint goal copied');
  } catch {
    _toast('danger', 'Could not copy the sprint goal');
  }
}

// -- events -----------------------------------------------------------------

function _onClick(e) {
  const t = e.target;
  if (!t || !t.closest) return;
  const q = (sel) => t.closest(sel);
  let el;
  if ((el = q('[data-ps-new]'))) { if (!el.disabled) _openNewModal(el); return; }
  if ((el = q('[data-ps-settings]'))) { if (!el.disabled) _openSettingsModal(el); return; }
  if ((el = q('[data-ps-team]'))) { if (el.dataset.psTeam !== _team) _selectTeam(el.dataset.psTeam, null); return; }
  if (!_plan) return;
  if ((el = q('[data-ps-done]'))) { _toggleDone(el, el.dataset.psDone); return; }
  if ((el = q('[data-ps-reset-dates]'))) { _resetDates(el); return; }
  if ((el = q('[data-ps-save]'))) { _saveSection(el, el.dataset.psSave); return; }
  if ((el = q('[data-ps-add]'))) {
    _markDirty(el);
    const list = el.dataset.psAdd;
    const wrap = el.closest('.sprint-planning-list').querySelector('[data-list="' + list + '"]');
    wrap.insertAdjacentHTML('beforeend', _listRow(list, null, _plan));
    const first = wrap.lastElementChild.querySelector('input');
    if (first) first.focus();
    return;
  }
  if ((el = q('[data-ps-remove]'))) { _markDirty(el); const row = el.closest('[data-row]'); if (row) row.remove(); return; }
  if (q('[data-ps-delete]')) { _deletePlan(q('[data-ps-delete]')); return; }
  if (q('[data-ps-copy-goal]')) { _copyGoal(); return; }
  if (q('[data-ps-fill-goal]')) {
    const area = _root().querySelector('[data-card="goal"] [data-f="goal"]');
    if (area) area.value = _jiraGoal();
  }
}

function _markDirty(target) {
  const card = target && target.closest ? target.closest('[data-card]') : null;
  if (card) card.dataset.dirty = '1';
}

function _onInput(e) {
  _markDirty(e.target);
}

function _onChange(e) {
  const t = e.target;
  _markDirty(t);
  if (t && t.matches && t.matches('select[data-ps-plan]')) {
    _loadPlan(t.value).then((current) => { if (current) { _saveSelection(); _paint(); } });
  }
}

function _wire(root, actions) {
  if (!_handlers) _handlers = { click: _onClick, change: _onChange, input: _onInput };
  if (_wiredRoot !== root) {
    if (_wiredRoot) { _wiredRoot.removeEventListener('click', _handlers.click); _wiredRoot.removeEventListener('change', _handlers.change); _wiredRoot.removeEventListener('input', _handlers.input); }
    root.addEventListener('click', _handlers.click);
    root.addEventListener('change', _handlers.change);
    root.addEventListener('input', _handlers.input);
    _wiredRoot = root;
  }
  if (actions && _wiredActions !== actions) {
    if (_wiredActions) _wiredActions.removeEventListener('click', _handlers.click);
    actions.addEventListener('click', _handlers.click);
    _wiredActions = actions;
  }
}

function _unwire() {
  if (_handlers) {
    if (_wiredRoot) { _wiredRoot.removeEventListener('click', _handlers.click); _wiredRoot.removeEventListener('change', _handlers.change); _wiredRoot.removeEventListener('input', _handlers.input); }
    if (_wiredActions) _wiredActions.removeEventListener('click', _handlers.click);
  }
  _wiredRoot = null;
  _wiredActions = null;
  _destroyPicker();
}

// -- the view ---------------------------------------------------------------

export const views = {
  'sprint-planning-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;
      (async () => { try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; } })();
      (async () => { try { _dsSelect = await import('/js/ds-select.js'); } catch { _dsSelect = null; } })();
      // Cleanup is registered in render(): the registry is wiped on every exit.
    },

    async render(subPath) {
      const root = _root();
      if (!root) return;
      _wire(root, document.getElementById(ACTIONS_ID));
      _deps.registerViewCleanup(_unwire);
      _paintActions();
      const sel = _readSelection();
      const sub = String(subPath || '').replace(/^\/+/, '');
      const wantId = PLAN_ID_RE.test(sub) ? sub : (_plan ? _plan.id : sel.id);
      if (!_team) _team = sel.team || null;
      await _loadStatus();
      if (!_status) { _paint(); return; }
      if (wantId && !_team) {
        const hit = _status.plans.find((p) => p.id === wantId);
        if (hit) _team = hit.team;
      }
      if (!_teamById(_team)) _team = _teams()[0] ? _teams()[0].id : null;
      await _selectTeam(_team, wantId);
    },

    /** Data pulled under us: reload everything from the new files. */
    async onDataChanged() {
      _historyCache.clear();
      if (_root()) await _reloadAll(_plan ? _plan.id : null);
    },
  },
};
