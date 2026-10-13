// modules/sprint-planning/client/sprint-planning-lib.mjs
// Pure, DOM-free helpers for the sprint planning view: holidays, working
// days, absences, capacity, velocity proposal, refinement slots, progress,
// Jira URLs, escaping. Importable from node --test with no browser.
//
// All dates are ISO strings (YYYY-MM-DD) and are computed through UTC
// arithmetic, never toISOString() on a local midnight (that shifts a day in
// CEST).

export const SECTION_KEYS = ['oncall', 'capacity', 'absences', 'velocity', 'refinements', 'goal', 'jira'];

export const WEEKDAY_NAMES = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday',
};

export const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;
const MS_DAY = 86400000;

/** HTML-escape a value for innerHTML / attribute use. */
export function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Same slug rule as the time-off module (copied: that module may not be installed). */
export function slugify(name) {
  let s = String(name === null || name === undefined ? '' : name);
  s = s.normalize('NFD');
  s = s.replace(COMBINING_MARKS_RE, '');
  s = s.replace(/[łŁ]/g, 'l');
  s = s.replace(/[đĐ]/g, 'd');
  s = s.replace(/[øØ]/g, 'o');
  s = s.toLowerCase();
  s = s.replace(/[-_\s]+/g, ' ');
  s = s.replace(/\s+app\s+(read|write|access)$/, '');
  s = s.trim();
  s = s.replace(/\s+/g, '-');
  return s;
}

// -- ISO date arithmetic ----------------------------------------------------

export function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function toMs(iso) {
  return Date.parse(iso + 'T00:00:00Z');
}

function fromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysIso(iso, n) {
  return fromMs(toMs(iso) + n * MS_DAY);
}

/** Days between two ISO dates (b - a). */
export function diffDays(a, b) {
  return Math.round((toMs(b) - toMs(a)) / MS_DAY);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(iso) {
  return new Date(toMs(iso)).getUTCDay();
}

// -- Public holidays (Poland; copy of the time-off module's holidays.js) ----

const FIXED_MONTH_DAY = [
  '01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26',
];
const CHRISTMAS_EVE_FROM_YEAR = 2025;

/** Easter Sunday (Meeus/Jones/Butcher) as an ISO string. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthDayNum = h + l - 7 * m + 114;
  const month = Math.floor(monthDayNum / 31);
  const day = (monthDayNum % 31) + 1;
  return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

/** All Polish public holidays of one year as a Set of ISO strings. */
export function polishHolidays(year) {
  const set = new Set();
  for (const md of FIXED_MONTH_DAY) set.add(year + '-' + md);
  if (year >= CHRISTMAS_EVE_FROM_YEAR) set.add(year + '-12-24');
  const easter = easterSunday(year);
  set.add(easter);
  set.add(addDaysIso(easter, 1));
  set.add(addDaysIso(easter, 49));
  set.add(addDaysIso(easter, 60));
  return set;
}

/** Holidays for every year touched by [from, to]. */
export function holidaysForRange(from, to) {
  const out = new Set();
  if (!isIsoDate(from) || !isIsoDate(to)) return out;
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const h of polishHolidays(y)) out.add(h);
  }
  return out;
}

// -- Working days -----------------------------------------------------------

/**
 * ISO dates Mon-Fri in [from, to] (both inclusive unless endExclusive) minus
 * the holidays set.
 */
export function workingDays(from, to, holidays, opts) {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return [];
  const hol = holidays instanceof Set ? holidays : new Set(holidays || []);
  const last = opts && opts.endExclusive ? addDaysIso(to, -1) : to;
  const out = [];
  for (let d = from; d <= last; d = addDaysIso(d, 1)) {
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6 || hol.has(d)) continue;
    out.push(d);
  }
  return out;
}

/**
 * True for a whole-week range (Tuesday to Tuesday): it ends where the next
 * sprint starts, so its last day is not a working day of this sprint. Same
 * rule as nextStartAfter in server/plan.js.
 */
export function endExclusive(plan) {
  if (!plan || !isIsoDate(plan.dateFrom) || !isIsoDate(plan.dateTo)) return false;
  const d = diffDays(plan.dateFrom, plan.dateTo);
  return d >= 7 && d % 7 === 0;
}

/** Holidays that fall on a weekday inside the same range (for the "Holidays in the sprint" tile). */
export function holidaysInRange(from, to, holidays, opts) {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return [];
  const hol = holidays instanceof Set ? holidays : new Set(holidays || []);
  const last = opts && opts.endExclusive ? addDaysIso(to, -1) : to;
  const out = [];
  for (let d = from; d <= last; d = addDaysIso(d, 1)) {
    const wd = weekdayOf(d);
    if (wd !== 0 && wd !== 6 && hol.has(d)) out.push(d);
  }
  return out;
}

// -- Absences ---------------------------------------------------------------

function expandRange(dateFrom, dateTo, allowed) {
  const out = [];
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateTo < dateFrom) return out;
  for (const d of allowed) {
    if (d >= dateFrom && d <= dateTo) out.push(d);
  }
  return out;
}

/**
 * Union of leave from the calendar and manual (Teams) absences, per person.
 * Only days in workingDaysList count, and a day reported twice counts once.
 * @returns {Map<string, Set<string>>} key = slug of the person's name
 */
export function absenceDaysByPerson(autoPersons, manual, workingDaysList) {
  const allowed = Array.isArray(workingDaysList) ? workingDaysList : [];
  const map = new Map();
  const add = (key, days) => {
    if (!key || !days.length) return;
    if (!map.has(key)) map.set(key, new Set());
    for (const d of days) map.get(key).add(d);
  };
  for (const p of (autoPersons || [])) {
    const key = p.slug || slugify(p.name);
    for (const e of (p.entries || [])) add(key, expandRange(e.dateFrom, e.dateTo, allowed));
  }
  for (const m of (manual || [])) {
    add(slugify(m.person), expandRange(m.dateFrom, m.dateTo, allowed));
  }
  return map;
}

/**
 * Merges overlapping or adjacent {dateFrom, dateTo} ranges (the leave
 * calendar holds re-submitted, overlapping entries for one person).
 */
export function mergeRanges(entries) {
  const sorted = (entries || [])
    .filter((e) => e && isIsoDate(e.dateFrom) && isIsoDate(e.dateTo))
    .map((e) => ({ dateFrom: e.dateFrom, dateTo: e.dateTo }))
    .sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0));
  const out = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && e.dateFrom <= addDaysIso(last.dateTo, 1)) {
      if (e.dateTo > last.dateTo) last.dateTo = e.dateTo;
    } else {
      out.push(e);
    }
  }
  return out;
}

/** Working days of one entry inside the sprint (for the "days in the sprint" column). */
export function entryDaysInSprint(dateFrom, dateTo, workingDaysList) {
  return expandRange(dateFrom, dateTo, workingDaysList || []).length;
}

export function totalAbsenceDays(absMap) {
  let n = 0;
  for (const set of absMap.values()) n += set.size;
  return n;
}

// -- Capacity and velocity --------------------------------------------------

/** Weekdays of a regular sprint of `weeks` weeks (no holidays, no days off). */
export function regularSprintDays(weeks) {
  const w = Number(weeks);
  return (Number.isInteger(w) && w >= 1 ? w : 2) * 5;
}

/**
 * nominal = people * (workingDaysCount - extraDaysOff);
 * available = nominal - absentDays (never below 0).
 * baselineRatio = available / (people * regularDays): availability against a
 * regular sprint, so holidays, team days off and a sprint of an unusual
 * length move it (ratio cancels them out). null without regularDays or people.
 */
export function capacity({ people, workingDaysCount, extraDaysOff, absentDays, regularDays }) {
  const p = Math.max(0, Number(people) || 0);
  const days = Math.max(0, (Number(workingDaysCount) || 0) - (Number(extraDaysOff) || 0));
  const nominal = p * days;
  const available = Math.max(0, nominal - (Number(absentDays) || 0));
  const baseline = p * (Number(regularDays) || 0);
  return { nominal, available, ratio: nominal ? available / nominal : null, baseline, baselineRatio: baseline ? available / baseline : null };
}

/**
 * Average `done` of the last 3 CLOSED sprints with sprintN < n, scaled by the
 * availability ratio and rounded. Pass capacity().baselineRatio (against a
 * regular sprint), not ratio. proposal is null with no basis sprint or with
 * no known ratio (null/undefined - e.g. no people or no baseline).
 */
export function velocityProposal(sprints, n, ratio) {
  const basis = (sprints || [])
    .filter((s) => s && s.state === 'closed' && Number(s.sprintN) < Number(n))
    .sort((a, b) => b.sprintN - a.sprintN)
    .slice(0, 3);
  if (!basis.length) return { basis, average: null, proposal: null };
  const sum = basis.reduce((acc, s) => acc + (Number(s.done) || 0), 0);
  const average = sum / basis.length;
  if (ratio === null || ratio === undefined) return { basis, average, proposal: null };
  return { basis, average, proposal: Math.round(average * (Number(ratio) || 0)) };
}

// -- Refinement slots -------------------------------------------------------

export const SLOT_PLACEHOLDER = 'Refinement slot to be set';

/** "Tuesday, 10:00-11:00" or the placeholder for a null/invalid slot. */
export function formatSlot(slot) {
  if (!slot || !WEEKDAY_NAMES[slot.weekday]) return SLOT_PLACEHOLDER;
  return WEEKDAY_NAMES[slot.weekday] + ', ' + slot.from + '-' + slot.to;
}

/** ISO dates in [from, to] that fall on the slot's weekday; [] for null. */
export function slotDatesInSprint(slot, from, to) {
  if (!slot || !WEEKDAY_NAMES[slot.weekday]) return [];
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return [];
  const out = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    if (weekdayOf(d) === slot.weekday) out.push(d);
  }
  return out;
}

// -- Progress, labels, links ------------------------------------------------

export function progress(plan) {
  const sections = (plan && plan.sections) || {};
  let done = 0;
  for (const k of SECTION_KEYS) if (sections[k] && sections[k].done) done++;
  return { done, total: SECTION_KEYS.length };
}

export function planLabel(plan, teams) {
  const t = (teams || []).find((x) => x.id === plan.team);
  return (t ? t.label : plan.team) + ' · Sprint ' + plan.sprintN;
}

/** Same URL shape as modules/sprint-stats/client/sprint-model.mjs jiraSprintUrl. */
export function jiraSprintUrl({ sprintId, boardId, projectKey, jiraBase } = {}) {
  const base = String(jiraBase || 'https://jira.example.com').replace(/\/+$/, '');
  if (!boardId || !projectKey) return null;
  let url = base + '/secure/RapidBoard.jspa?rapidView=' + encodeURIComponent(boardId)
    + '&projectKey=' + encodeURIComponent(projectKey);
  if (sprintId) url += '&sprint=' + encodeURIComponent(sprintId);
  return url;
}

export function jiraIssueUrl(jiraBase, key) {
  if (!ISSUE_KEY_RE.test(String(key || ''))) return null;
  return String(jiraBase || 'https://jira.example.com').replace(/\/+$/, '') + '/browse/' + key;
}

/** Most frequent non-empty person among duty entries of the given columns. */
export function mostFrequentPerson(entries, columns) {
  const counts = new Map();
  for (const e of (entries || [])) {
    if (!columns.includes(e.column) || !e.person) continue;
    counts.set(e.person, (counts.get(e.person) || 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [p, n] of counts) {
    if (n > bestN) { best = p; bestN = n; }
  }
  return best;
}
