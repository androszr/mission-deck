// modules/roadmap/client/helpers.js
// Pure helpers for the roadmap table. No document, no imports: this file
// is imported by the view (browser) AND by server/index.js and the tests (Node).
// Stage 3 adds inline editing and ordering.

// ---- Definitions -----------------------------------------------------------

export const DISCOVERY_TASKS = [
  { id: 'scope-gate-start', label: 'Scope preparation for the Discovery start gate', shortLabel: 'Gate Start', defaultRole: 'po', order: 1 },
  { id: 'process-mapping', label: 'Business process mapping and documentation', shortLabel: 'Process mapping', defaultRole: 'analyst', order: 2 },
  { id: 'research-insights', label: 'User research and insights', shortLabel: 'Research', defaultRole: 'designer', order: 3 },
  { id: 'goals-metrics', label: 'Goals, metrics and differentiators', shortLabel: 'Goals and metrics', defaultRole: 'po', order: 4 },
  { id: 'requirements-breakdown', label: 'Business requirements and breakdown into stages', shortLabel: 'Requirements', defaultRole: 'analyst', order: 5 },
  { id: 'workshops-alignment', label: 'Workshops, consultations and cross-team alignment', shortLabel: 'Workshops', defaultRole: 'analyst', order: 6 },
  { id: 'architecture', label: 'Solution architecture', shortLabel: 'Architecture', defaultRole: 'architect', order: 7 },
  { id: 'mockups-prototypes', label: 'Mockups and prototypes', shortLabel: 'Mockups', defaultRole: 'designer', order: 8 },
  { id: 'user-testing', label: 'User testing (optional)', shortLabel: 'UX tests', defaultRole: 'designer', order: 9 },
  { id: 'refinements', label: 'Refinement and cross-refinement preparation', shortLabel: 'Refinements', defaultRole: 'analyst', order: 10 },
];

export const ALL_TASK_IDS = DISCOVERY_TASKS.map((t) => t.id);

export const INITIATIVE_STAGES = [
  { id: 'preparation', label: 'Preparation', short: 'Prep' },
  { id: 'problem-space', label: 'Problem Space', short: 'Prob' },
  { id: 'solution-space', label: 'Solution Space', short: 'Sol' },
  { id: 'delivery', label: 'Delivery', short: 'Del' },
  { id: 'pilot', label: 'Pilot', short: 'Pil' },
  { id: 'go-live', label: 'Go-Live', short: 'GL' },
];

export const ROLE_ORDER = ['po', 'analyst', 'designer', 'architect'];


export const JIRA_BASE = 'https://jira.example.com/browse/';

// ---- Text ------------------------------------------------------------------

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Initiative data -------------------------------------------------------

export function sortInitiatives(list) {
  return (Array.isArray(list) ? list : [])
    .map((it, i) => [it, i])
    .sort((a, b) => ((a[0].rank ?? 999) - (b[0].rank ?? 999)) || (a[1] - b[1]))
    .map((p) => p[0]);
}

// ---- Dates -----------------------------------------------------------------

export function easterSunday(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

function _utcPlus(d, offset) {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset));
  return r.getUTCFullYear() + '-' + String(r.getUTCMonth() + 1).padStart(2, '0') + '-' + String(r.getUTCDate()).padStart(2, '0');
}

const _holidayCache = new Map();

/** Set of 'YYYY-MM-DD' Polish public holidays for the year. */
export function polishHolidays(year) {
  if (_holidayCache.has(year)) return _holidayCache.get(year);
  const fixed = ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26'].map((s) => year + '-' + s);
  const easter = easterSunday(year);
  const set = new Set([...fixed, _utcPlus(easter, 0), _utcPlus(easter, 1), _utcPlus(easter, 49), _utcPlus(easter, 60)]);
  _holidayCache.set(year, set);
  return set;
}

function _localYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Working days from fromDate to toDate inclusive (local dates). */
export function workingDaysBetween(fromDate, toDate) {
  const holidays = new Set(polishHolidays(toDate.getFullYear()));
  if (fromDate.getFullYear() !== toDate.getFullYear()) {
    for (const h of polishHolidays(fromDate.getFullYear())) holidays.add(h);
  }
  let count = 0;
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  while (d <= end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(_localYmd(d))) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function workingDaysLabel(dateStr, isDone, today = new Date()) {
  if (!dateStr) return '';
  const target = new Date(dateStr + 'T00:00:00');
  if (isNaN(target)) return '';
  const t0 = new Date(today);
  t0.setHours(0, 0, 0, 0);
  if (target < t0) return isDone ? '(done)' : '(overdue)';
  if (target.getTime() === t0.getTime()) return '(today)';
  return '(' + workingDaysBetween(t0, target) + ' working days)';
}

export function isDateDone(init, field) {
  const st = Array.isArray(init && init.stageStatus) ? init.stageStatus : [];
  if (field === 'discoveryEnd') return ['solution-space', 'delivery', 'pilot', 'go-live'].some((s) => st.includes(s));
  if (field === 'deliveryEnd') return ['delivery', 'pilot', 'go-live'].some((s) => st.includes(s));
  if (field === 'goLiveDate') return st.includes('go-live');
  return false;
}

// ---- Time (MD) ---------------------------------------------------------------

/** "3,5 MD"; "0 MD" for 0; '' for null/undefined. One MD = 8 h. */
export function formatMd(seconds) {
  if (seconds === 0) return '0 MD';
  if (!seconds) return '';
  return (seconds / 28800).toFixed(1).replace('.', ',') + ' MD';
}

/**
 * Sum timeByPerson over entries, keyed by the canonical name so
 * "Doe Jane" and "Jane Doe" count once.
 * -> { entries: [[name, secs], ...] (desc), total }
 */
export function sumTimeBy(items, canonical = (n) => n) {
  const byPerson = {};
  for (const it of items || []) {
    for (const [name, secs] of Object.entries((it && it.timeByPerson) || {})) {
      const key = canonical(name) || name;
      byPerson[key] = (byPerson[key] || 0) + (Number(secs) || 0);
    }
  }
  const entries = Object.entries(byPerson).sort((a, b) => b[1] - a[1]);
  return { entries, total: entries.reduce((s, e) => s + e[1], 0) };
}

/** Whole-initiative time (the MD column): jiraTasks + jiraUnmatched + deliveryEpics (+ their subtasks). */
export function timeByPersonTotals(init, canonical = (n) => n) {
  const items = [];
  for (const t of (init && init.jiraTasks) || []) items.push(t);
  for (const t of (init && init.jiraUnmatched) || []) items.push(t);
  for (const e of (init && init.deliveryEpics) || []) {
    items.push(e);
    for (const s of e.subtasks || []) items.push(s);
  }
  return sumTimeBy(items, canonical);
}

// ---- Filtering -------------------------------------------------------------

/** Lowercase, no diacritics, "l with stroke" folded to l (same as js/utils.js normalizeSearch). */
export function norm(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function collectPersons(list, canonical = (n) => n) {
  const names = new Set();
  for (const init of list || []) {
    for (const role of ROLE_ORDER) {
      if (init[role]) names.add(canonical(init[role]) || init[role]);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'en'));
}

/** filters: { search: string, persons: Set|Array of canonical names } */
export function filterInitiatives(list, filters, canonical = (n) => n) {
  const search = (filters && filters.search) || '';
  const persons = new Set((filters && filters.persons) || []);
  let out = list || [];
  if (search) {
    const needle = norm(search);
    out = out.filter((i) => norm(i.title).includes(needle) || norm(i.ticket).includes(needle));
  }
  if (persons.size > 0) {
    out = out.filter((i) => ROLE_ORDER.some((role) => i[role] && persons.has(canonical(i[role]) || i[role])));
  }
  return out;
}

// ---- Sync errors -------------------------------------------------------------

const SYNC_ERRORS = {
  'no-token': 'no Jira token (unlock the vault)',
  'token-unauthorized': 'Jira rejected the token (check the VPN, then the token)',
  'jira-unreachable': 'Jira unreachable (check the VPN)',
  'jira-error': 'Jira returned an error',
};

/** User-facing text for a server error code of the sync routes. */
export function syncErrorText(code) {
  return SYNC_ERRORS[code] || 'could not sync';
}

// ---- Inline editing and ordering (stage 3) ------------------------------------

export const RAG_VALUES = ['red', 'amber', 'green'];
export const STAGE_IDS = INITIATIVE_STAGES.map((s) => s.id);
export const DATE_FIELDS = ['discoveryEnd', 'deliveryEnd', 'goLiveDate'];
export const PERSON_FIELDS = ['po', 'designer', 'analyst', 'architect'];
export const PATCH_KEYS = ['ragStatus', 'stageStatus', ...DATE_FIELDS, ...PERSON_FIELDS];
export const PERSON_MAX = 120;

function _validYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * Pure whitelist for POST /update. Only the keys of PATCH_KEYS pass; strings
 * are trimmed and '' clears.
 * @returns {{ ok: true, patch: object } | { ok: false, message: string }}
 */
export function validateInitiativePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, message: 'patch must be an object' };
  const keys = Object.keys(patch);
  if (keys.length === 0) return { ok: false, message: 'patch is empty' };
  const out = {};
  for (const k of keys) {
    const v = patch[k];
    if (!PATCH_KEYS.includes(k)) return { ok: false, message: 'field not allowed: ' + k };
    if (k === 'ragStatus') {
      if (v !== null && !RAG_VALUES.includes(v)) return { ok: false, message: 'ragStatus: red, amber, green or null' };
      out[k] = v;
    } else if (k === 'stageStatus') {
      if (!Array.isArray(v) || !v.every((s) => STAGE_IDS.includes(s))) return { ok: false, message: 'stageStatus: an array of known stages' };
      out[k] = [...new Set(v)];
    } else if (DATE_FIELDS.includes(k)) {
      if (typeof v !== 'string' || !(v.trim() === '' || _validYmd(v.trim()))) return { ok: false, message: k + ': a YYYY-MM-DD date or empty text' };
      out[k] = v.trim();
    } else {
      if (typeof v !== 'string' || v.trim().length > PERSON_MAX) return { ok: false, message: k + ': text of up to ' + PERSON_MAX + ' characters' };
      out[k] = v.trim();
    }
  }
  return { ok: true, patch: out };
}

/** Pure: the patch for one chip click (multi-select toggle). */
export function toggleStagePatch(current, stageId) {
  const cur = Array.isArray(current) ? current : [];
  return { stageStatus: cur.includes(stageId) ? cur.filter((s) => s !== stageId) : [...cur, stageId] };
}

/** Pure: clicking the active colour clears it. */
export function ragPatch(current, clicked) {
  return { ragStatus: current === clicked ? null : clicked };
}

/**
 * Pure: moves `id` next to `targetId` in an ordered id list.
 * Returns the same order (new array) when nothing changes or an id is unknown.
 */
export function moveInOrder(order, id, targetId, after) {
  const list = Array.isArray(order) ? order.slice() : [];
  const from = list.indexOf(id);
  if (from < 0 || id === targetId || !list.includes(targetId)) return list;
  list.splice(from, 1);
  const to = list.indexOf(targetId);
  list.splice(after ? to + 1 : to, 0, id);
  return list;
}

/** Pure: one step up (-1) or down (+1); unchanged at the edges. */
export function stepInOrder(order, id, delta) {
  const list = Array.isArray(order) ? order.slice() : [];
  const i = list.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/**
 * Pure: moves `id` to the 1-based `position` (clamped to 1..n); the item that held
 * that position and everything after it shift by one. Returns the same order (new
 * array) for an unknown id, a non-integer position or the current position.
 */
export function moveToPosition(order, id, position) {
  const list = Array.isArray(order) ? order.slice() : [];
  const from = list.indexOf(id);
  if (from < 0 || !Number.isInteger(position)) return list;
  const to = Math.min(Math.max(position, 1), list.length) - 1;
  if (to === from) return list;
  list.splice(from, 1);
  list.splice(to, 0, id);
  return list;
}

/**
 * Pure: renumbering (position = index + 1), reduced
 * to what really changes.
 * @param {{id: string, rank?: number}[]} items existing initiatives
 * @param {string[]} order
 * @returns {{ ok: false, message: string } | { ok: true, changes: {id: string, rank: number}[] }}
 */
export function computeReorder(items, order) {
  const ids = (Array.isArray(items) ? items : []).map((i) => i.id);
  if (!Array.isArray(order) || order.length === 0 || !order.every((x) => typeof x === 'string')) {
    return { ok: false, message: 'order must be a non-empty array of ids' };
  }
  if (new Set(order).size !== order.length || order.length !== ids.length || !order.every((x) => ids.includes(x))) {
    return { ok: false, message: 'order must contain every initiative exactly once' };
  }
  const pos = new Map(order.map((id, i) => [id, i + 1]));
  const changes = [];
  for (const it of items) if (it.rank !== pos.get(it.id)) changes.push({ id: it.id, rank: pos.get(it.id) });
  return { ok: true, changes };
}

/** Pure: initiatives with ticket in table order - the work list of the sync modal. */
export function syncTargets(list) {
  return sortInitiatives(list)
    .filter((i) => typeof i.ticket === 'string' && /^[A-Z][A-Z0-9]+-\d+$/.test(i.ticket.trim().toUpperCase()))
    .map((i) => ({ id: i.id, ticket: i.ticket.trim().toUpperCase(), title: i.title || '(untitled)' }));
}

/** Errors that make every further item fail the same way - the modal stops there. */
export function isFatalSyncError(code) {
  return code === 'no-token' || code === 'token-unauthorized' || code === 'jira-unreachable';
}

// ---- Activity strip (who worked on what in the last days) ---------------------
// The activity strip. Past days come from every timeByPersonByDay
// stored in the initiatives plus Tempo; today and tomorrow from the in-progress
// Jira tasks of each initiative.

export const STRIP_ROLE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'po', label: 'PO' },
  { key: 'analyst', label: 'Analyst' },
  { key: 'designer', label: 'Designer' },
  { key: 'architect', label: 'Architect' },
];
export const DAY_NAMES_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const STRIP_PAST_DAYS = 10;

export function toYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Ten previous working days, today (always shown) and the next working day. */
export function stripDays(today = new Date()) {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const holidays = new Set([
    ...polishHolidays(t0.getFullYear() - 1), ...polishHolidays(t0.getFullYear()), ...polishHolidays(t0.getFullYear() + 1),
  ]);
  const isWorkDay = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !holidays.has(toYmd(d));
  const mk = (d, zone) => ({ dateStr: toYmd(d), dayNum: d.getDate(), dow: d.getDay(), zone });
  const past = [];
  const cur = new Date(t0);
  cur.setDate(cur.getDate() - 1);
  while (past.length < STRIP_PAST_DAYS) {
    if (isWorkDay(cur)) past.unshift(mk(cur, 'past'));
    cur.setDate(cur.getDate() - 1);
  }
  const tmr = new Date(t0);
  tmr.setDate(tmr.getDate() + 1);
  while (!isWorkDay(tmr)) tmr.setDate(tmr.getDate() + 1);
  return [...past, mk(t0, 'today'), mk(tmr, 'tomorrow')];
}

/** Exact, without diacritics, or surname first. */
export function nameMatch(a, b) {
  if (!a || !b) return false;
  if (a === b || norm(a) === norm(b)) return true;
  const pa = String(a).split(/\s+/);
  return pa.length === 2 && norm(pa[1] + ' ' + pa[0]) === norm(b);
}

const MEMBER_ROLE_RE = {
  po: /Product (Owner|Manager)/i,
  analyst: /Analyst/i,
  designer: /Designer|Design/i,
  architect: /Architect/i,
};

/** The initiative's own role, then the member's job title, else analyst. */
export function roleForAssignee(init, assignee, memberRole = () => '') {
  for (const role of ROLE_ORDER) if (nameMatch(init[role], assignee)) return role;
  const title = memberRole(assignee) || '';
  if (title) for (const [key, re] of Object.entries(MEMBER_ROLE_RE)) if (re.test(title)) return key;
  return 'analyst';
}

/** Canonical names of everybody the role filter lets through. */
export function rolePersons(initiatives, roleFilter, canonical = (n) => n, memberRole = () => '') {
  const persons = new Set();
  const roles = roleFilter === 'all' ? ROLE_ORDER : [roleFilter];
  for (const init of initiatives || []) {
    for (const role of roles) if (init[role]) persons.add(canonical(init[role]) || init[role]);
    for (const ep of init.deliveryEpics || []) {
      for (const s of ep.subtasks || []) {
        if (!s.assignee) continue;
        const name = canonical(s.assignee) || s.assignee;
        if (roleFilter !== 'all' && roleForAssignee(init, name, memberRole) !== roleFilter) continue;
        persons.add(name);
      }
    }
  }
  return persons;
}

/** People holding the role (all four roles for 'all') on at least one initiative - canonical names. */
export function assignedPersons(initiatives, roleFilter, canonical = (n) => n) {
  const roles = roleFilter === 'all' ? ROLE_ORDER : [roleFilter];
  const out = new Set();
  for (const init of initiatives || []) for (const role of roles) if (init[role]) out.add(canonical(init[role]) || init[role]);
  return out;
}

/**
 * { date: { person: [entry] } } of LOGGED time on the given days: every
 * timeByPersonByDay map stored in the initiatives (the initiative itself, jiraTasks,
 * jiraUnmatched, deliveryEpics and their subtasks), plus Tempo worklogs of keys that
 * belong to a roadmap initiative and are not already counted. Names are canonical.
 * Entry: { title, phase, jiraKey, loggedSeconds }.
 */
export function worklogMapForDays(tempo, initiatives, dateStrs, canonical = (n) => n) {
  const map = {};
  const wanted = new Set(dateStrs);
  const seen = new Set();
  const keyToTitle = {};
  const add = (name, dateStr, entry) => {
    const who = canonical(name) || name;
    ((map[dateStr] = map[dateStr] || {})[who] = map[dateStr][who] || []).push(entry);
  };
  const fromItem = (init, item, label) => {
    if (!item) return;
    if (item.key) keyToTitle[item.key] = init.title;
    for (const [person, days] of Object.entries(item.timeByPersonByDay || {})) {
      for (const [dateStr, secs] of Object.entries(days || {})) {
        if (!wanted.has(dateStr) || !(Number(secs) > 0)) continue;
        const who = canonical(person) || person;
        seen.add(who + '|' + dateStr + '|' + (item.key || ''));
        add(person, dateStr, { title: init.title, phase: label || item.summary || item.key || '', jiraKey: item.key || null, loggedSeconds: Number(secs) });
      }
    }
  };
  for (const init of initiatives || []) {
    fromItem(init, init, init.ticket ? 'Epic ' + init.ticket : '');
    for (const t of init.jiraTasks || []) fromItem(init, t, t.summary || (DISCOVERY_TASKS.find((d) => d.id === t.defId) || {}).label);
    for (const t of init.jiraUnmatched || []) fromItem(init, t);
    for (const ep of init.deliveryEpics || []) { fromItem(init, ep); for (const sub of ep.subtasks || []) fromItem(init, sub); }
    if (init.ticket && !keyToTitle[init.ticket]) keyToTitle[init.ticket] = init.title;
  }
  for (const [person, dayMap] of Object.entries((tempo && tempo.worklogs) || {})) {
    const who = canonical(person) || person;
    for (const [dateStr, entries] of Object.entries(dayMap || {})) {
      if (!wanted.has(dateStr)) continue;
      for (const e of entries || []) {
        if (!keyToTitle[e.issueKey] || !(Number(e.seconds) > 0) || seen.has(who + '|' + dateStr + '|' + e.issueKey)) continue;
        add(person, dateStr, { title: keyToTitle[e.issueKey], phase: e.summary || e.issueKey, jiraKey: e.issueKey, loggedSeconds: Number(e.seconds) });
      }
    }
  }
  return map;
}

/** Every Jira key that belongs to the roadmap: epic tickets, tasks, unmatched tasks, delivery epics and their subtasks. */
export function roadmapKeySet(initiatives) {
  const keys = new Set();
  const add = (k) => { if (typeof k === 'string' && k) keys.add(k.trim().toUpperCase()); };
  for (const init of initiatives || []) {
    add(init.ticket); add(init.key);
    for (const t of init.jiraTasks || []) add(t.key);
    for (const t of init.jiraUnmatched || []) add(t.key);
    for (const ep of init.deliveryEpics || []) { add(ep.key); for (const sub of ep.subtasks || []) add(sub.key); }
  }
  return keys;
}

/**
 * Pure: one person's day worklogs ({ issueKey, summary, seconds }) split into the roadmap
 * ones and the rest. The rest is summed per key and sorted by time (desc), then key.
 * @returns {{ roadmap: object[], other: {jiraKey, summary, loggedSeconds}[] }}
 */
export function splitDayWorklogs(entries, roadmapKeys) {
  const roadmap = [];
  const byKey = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const key = e && typeof e.issueKey === 'string' ? e.issueKey.trim() : '';
    const secs = Number(e && e.seconds);
    if (!key || !(secs > 0)) continue;
    if (roadmapKeys && roadmapKeys.has(key.toUpperCase())) { roadmap.push(e); continue; }
    const cur = byKey.get(key) || { jiraKey: key, summary: '', loggedSeconds: 0 };
    cur.loggedSeconds += secs;
    if (!cur.summary && typeof e.summary === 'string') cur.summary = e.summary.trim();
    byKey.set(key, cur);
  }
  const other = [...byKey.values()].sort((a, b) => b.loggedSeconds - a.loggedSeconds || a.jiraKey.localeCompare(b.jiraKey));
  return { roadmap, other };
}

/** Non-roadmap worklogs of `person` on `dateStr` from a { name: { date: [entry] } } map (names compared canonically). */
export function otherWorklogsFor(all, person, dateStr, roadmapKeys, canonical = (n) => n) {
  const want = canonical(person) || person;
  const entries = [];
  for (const [name, days] of Object.entries(all || {})) {
    if ((canonical(name) || name) !== want && !nameMatch(name, want)) continue;
    for (const e of (days && days[dateStr]) || []) entries.push(e);
  }
  return splitDayWorklogs(entries, roadmapKeys).other;
}

/** Popover header total: "3h" for roadmap alone, "5h (3h roadmap)" with other work too. */
export function formatDayTotal(roadmapSeconds, otherSeconds) {
  const r = Number(roadmapSeconds) || 0;
  const o = Number(otherSeconds) || 0;
  if (r + o <= 0) return '';
  return o > 0 && r > 0 ? formatHours(r + o) + ' (' + formatHours(r) + ' roadmap)' : formatHours(r + o);
}

/** Shape guard for GET /worklogs: always { available: false, worklogs: {} } at worst. */
export function normalizeWorklogs(raw) {
  const ok = raw && typeof raw === 'object' && !Array.isArray(raw);
  return {
    available: Boolean(ok && raw.available === true),
    worklogs: ok && raw.worklogs && typeof raw.worklogs === 'object' && !Array.isArray(raw.worklogs) ? raw.worklogs : {},
  };
}

/** Jira browse link only for plain http(s) bases. */
export function safeJiraHref(base, key) {
  return /^https?:\/\//i.test(String(base || '')) && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(String(key || '')) ? base + key : '';
}

/** { date: { person: [task] } } of in-progress work, one entry per day in `dateStrs`. */
export function busyMapForDays(initiatives, dateStrs, roleFilter, canonical = (n) => n, memberRole = () => '') {
  const map = {};
  for (const d of dateStrs) map[d] = {};
  const roles = roleFilter === 'all' ? ROLE_ORDER : [roleFilter];
  const put = (assignee, entry) => {
    for (const d of dateStrs) (map[d][assignee] = map[d][assignee] || []).push(entry);
  };
  const lookup = (tbp, name) => {
    if (!tbp || !name) return 0;
    if (tbp[name]) return tbp[name];
    const p = name.split(/\s+/);
    return p.length === 2 && tbp[p[1] + ' ' + p[0]] ? tbp[p[1] + ' ' + p[0]] : 0;
  };
  for (const init of initiatives || []) {
    const scope = Array.isArray(init.taskScope) && init.taskScope.length > 0 ? init.taskScope : ALL_TASK_IDS;
    const byDef = Object.fromEntries((Array.isArray(init.jiraTasks) ? init.jiraTasks : []).map((t) => [t.defId, t]));
    const rank = init.rank ?? 999;
    for (const def of DISCOVERY_TASKS) {
      if (!scope.includes(def.id) || !roles.includes(def.defaultRole)) continue;
      const entry = byDef[def.id];
      if (!entry || !entry.key || (entry.statusCategory || 'new') !== 'indeterminate' || !entry.assignee) continue;
      put(entry.assignee, { title: init.title, phase: def.label, status: 'indeterminate', statusName: entry.statusName, rank, loggedSeconds: lookup(entry.timeByPerson, entry.assignee), jiraKey: entry.key });
    }
    const viaRole = (t, phase) => {
      if (!t.assignee) return;
      const assignee = canonical(t.assignee) || t.assignee;
      if (roleFilter !== 'all' && roleForAssignee(init, assignee, memberRole) !== roleFilter) return;
      put(assignee, { title: init.title, phase: phase || t.summary || t.key || '', status: 'indeterminate', statusName: t.statusName || '', rank, loggedSeconds: lookup(t.timeByPerson, assignee), jiraKey: t.key || null });
    };
    for (const t of Array.isArray(init.jiraUnmatched) ? init.jiraUnmatched : []) {
      if (t.key && t.statusCategory === 'indeterminate') viaRole(t);
    }
    for (const ep of init.deliveryEpics || []) {
      for (const s of ep.subtasks || []) if ((s.statusCategory || 'new') === 'indeterminate') viaRole(s);
    }
  }
  return map;
}

/**
 * The whole strip: one cell per day with the sorted people to show.
 * Past days: people who LOGGED time on anything of the roadmap AND hold a role on some initiative;
 * today/tomorrow: people with in-progress work.
 * Every list is cut to the people the role filter lets through.
 * @returns {{ days: {dateStr, dayNum, dow, zone, names: string[]}[], busy: object, worklogs: object }}
 */
export function buildActivityStrip({ initiatives, tempo, today = new Date(), roleFilter = 'all', canonical = (n) => n, memberRole = () => '' }) {
  const days = stripDays(today);
  const allowedFuture = rolePersons(initiatives, roleFilter, canonical, memberRole);
  const allowedPast = assignedPersons(initiatives, roleFilter, canonical);
  const worklogs = worklogMapForDays(tempo, initiatives, days.map((d) => d.dateStr), canonical);
  const busy = busyMapForDays(initiatives, days.filter((d) => d.zone !== 'past').map((d) => d.dateStr), roleFilter, canonical, memberRole);
  return {
    days: days.map((d) => {
      const src = d.zone === 'past' ? worklogs[d.dateStr] : busy[d.dateStr];
      const allowed = d.zone === 'past' ? allowedPast : allowedFuture;
      const names = Object.keys(src || {}).filter((n) => allowed.has(n)).sort();
      return { ...d, names };
    }),
    busy,
    worklogs,
  };
}

/** "3h", "1,5h". */
export function formatHours(seconds) {
  const h = (Number(seconds) || 0) / 3600;
  return (h % 1 === 0 ? String(h) : h.toFixed(1)) + 'h';
}

/** Tempo file shape guard for the client: always { worklogs: {}, discoveryKeys: [] }. */
export function normalizeTempo(raw) {
  const ok = raw && typeof raw === 'object' && !Array.isArray(raw);
  return {
    worklogs: ok && raw.worklogs && typeof raw.worklogs === 'object' && !Array.isArray(raw.worklogs) ? raw.worklogs : {},
    discoveryKeys: ok && Array.isArray(raw.discoveryKeys) ? raw.discoveryKeys : [],
    dateFrom: ok && typeof raw.dateFrom === 'string' ? raw.dateFrom : null,
    dateTo: ok && typeof raw.dateTo === 'string' ? raw.dateTo : null,
    fetchedAt: ok && typeof raw.fetchedAt === 'string' ? raw.fetchedAt : null,
  };
}

// ---- Row edit mode (draft -> one combined patch) --------------------------------

/** Fields that belong to one editable cell of the table. */
export const EDIT_CELLS = {
  rag: ['ragStatus'],
  'po,designer': ['po', 'designer'],
  'analyst,architect': ['analyst', 'architect'],
  discoveryEnd: ['discoveryEnd'],
  deliveryEnd: ['deliveryEnd'],
  goLiveDate: ['goLiveDate'],
  stages: ['stageStatus'],
};

/**
 * Pure: the fields of `draft` that really differ from the initiative.
 * A person equal to the stored name OR to its canonical form is unchanged;
 * stages compare as sets; '' and null/undefined are the same for dates and RAG.
 */
export function draftChanges(init, draft, canonical = (n) => n) {
  const out = {};
  const d = draft || {};
  const cur = init || {};
  for (const k of Object.keys(d)) {
    if (!PATCH_KEYS.includes(k)) continue;
    const v = d[k];
    if (k === 'ragStatus') {
      if ((v ?? null) !== (cur.ragStatus ?? null)) out[k] = v ?? null;
    } else if (k === 'stageStatus') {
      const a = new Set(Array.isArray(v) ? v : []);
      const b = new Set(Array.isArray(cur.stageStatus) ? cur.stageStatus : []);
      if (a.size !== b.size || [...a].some((x) => !b.has(x))) out[k] = [...a];
    } else if (DATE_FIELDS.includes(k)) {
      if ((v || '') !== (cur[k] || '')) out[k] = v || '';
    } else {
      const val = String(v || '').trim();
      const stored = String(cur[k] || '').trim();
      if (val !== stored && val !== (stored ? (canonical(stored) || stored) : '')) out[k] = val;
    }
  }
  return out;
}

/** Pure: is the cell (key of EDIT_CELLS) changed in the draft? */
export function cellChanged(init, draft, cell, canonical = (n) => n) {
  const changes = draftChanges(init, draft, canonical);
  return (EDIT_CELLS[cell] || []).some((f) => f in changes);
}

/**
 * Pure: the ONE combined patch for POST /update.
 * @returns {{ ok: true, patch: object } | { ok: false, empty: true } | { ok: false, message: string }}
 */
export function buildEditPatch(init, draft, canonical = (n) => n) {
  const changes = draftChanges(init, draft, canonical);
  if (Object.keys(changes).length === 0) return { ok: false, empty: true };
  const v = validateInitiativePatch(changes);
  return v.ok ? { ok: true, patch: v.patch } : { ok: false, message: v.message };
}

// ---- Tabs (Table / Timeline / Kanban) -------------------------------------------

export const VIEW_TABS = [
  { id: 'table', label: 'Table' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'kanban', label: 'Kanban' },
];
export const DEFAULT_TAB = 'table';

/** Pure: the tab named by a view sub-path ('timeline', '/kanban?x=1'); anything unknown is the default tab. */
export function tabFromSubPath(subPath) {
  const first = String(subPath === null || subPath === undefined ? '' : subPath).replace(/^[#/]+/, '').split(/[/?#]/)[0].toLowerCase();
  return VIEW_TABS.some((t) => t.id === first) ? first : DEFAULT_TAB;
}

/** Pure: the deep-link hash of a tab; the default tab is the bare view hash. */
export function tabHash(viewId, tab) {
  return '#' + viewId + (tab && tab !== DEFAULT_TAB && VIEW_TABS.some((t) => t.id === tab) ? '/' + tab : '');
}
