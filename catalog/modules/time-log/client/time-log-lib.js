// modules/time-log/client/time-log-lib.js
// Pure functions for the time-log heatmap view - no document, no fetch, no
// team-directory state, so `node --test` (and the contract test) can import
// this file directly.
//
// TEAMS is a COPY of the same constant in server/build.js (this file is ESM,
// the server is CJS, so neither can import the other) -
// tests/test_time_log.mjs asserts the two stay identical.

export const TEAMS = ['Atlas', 'Borealis', 'Comet', 'Delta', 'Echo', 'Falcon'];

export const TARGET_HOURS = 8;

export const JIRA_URL_DEFAULT = 'https://jira.example.com';

const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/**
 * Diacritic- and case-insensitive form of a string. A private copy rather
 * than an import of the core's normalizeSearch (js/utils.js) - this file has
 * no document and no `/js/...` resolver in plain Node. \u escapes keep this
 * source file byte-ASCII even though the characters matched are
 * Polish/Scandinavian letters.
 * @param {*} text
 * @returns {string}
 */
export function normalizeSearch(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[\u0142\u0141]/g, 'l') // l/L with stroke - NFD leaves these intact
    .replace(/[\u0111\u0110]/g, 'd') // d/D with stroke
    .replace(/[\u00f8\u00d8]/g, 'o') // o/O with stroke
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '')
    .toLowerCase();
}

/**
 * 'YYYY-MM-DD' -> 'DD.MM'.
 * @param {string} iso
 * @returns {string}
 */
export function fmtDate(iso) {
  if (!iso || iso.length < 10) return iso || '';
  return iso.slice(8, 10) + '.' + iso.slice(5, 7);
}

/**
 * A Tempo timestamp ('YYYY-MM-DDTHH:MM:SS.sss' or with a space instead of
 * 'T') -> 'DD.MM HH:MM'.
 * @param {string} raw
 * @returns {string}
 */
export function fmtLoggedAt(raw) {
  if (!raw || typeof raw !== 'string' || raw.length < 16) return '';
  const s = raw.replace(' ', 'T');
  const dd = s.slice(8, 10);
  const mm = s.slice(5, 7);
  const hh = s.slice(11, 13);
  const mi = s.slice(14, 16);
  if (!dd || !mm || !hh || !mi) return '';
  return dd + '.' + mm + ' ' + hh + ':' + mi;
}

/**
 * Normalised match key for a person name: strip a parenthesised suffix,
 * fold diacritics and case, sort tokens - order-independent so "Morgan
 * Alex" and "Alex Morgan" (Tempo vs. the time-off sheet) collide on purpose.
 * @param {string} name
 * @returns {string}
 */
export function nameKey(name) {
  const stripped = String(name || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const norm = normalizeSearch(stripped);
  return norm.split(/\s+/).filter(Boolean).sort().join(' ');
}

/**
 * Builds a Set<"nameKey|YYYY-MM-DD"> from time-off entries
 * ({ person, dateFrom, dateTo }), one entry per calendar day in the range
 * inclusive. Date.UTC throughout so no local timezone can shift a boundary
 * day.
 * @param {Array<{person?: string, dateFrom?: string, dateTo?: string}>} entries
 * @returns {Set<string>}
 */
export function vacationSet(entries) {
  const set = new Set();
  for (const rec of entries || []) {
    if (!rec || !rec.person || !rec.dateFrom || !rec.dateTo) continue;
    const key = nameKey(rec.person);
    if (!key) continue;
    const from = String(rec.dateFrom).slice(0, 10).split('-').map(Number);
    const to = String(rec.dateTo).slice(0, 10).split('-').map(Number);
    if (from.length !== 3 || to.length !== 3 || from.some(Number.isNaN) || to.some(Number.isNaN)) continue;
    let t = Date.UTC(from[0], from[1] - 1, from[2]);
    const end = Date.UTC(to[0], to[1] - 1, to[2]);
    if (Number.isNaN(t) || Number.isNaN(end)) continue;
    while (t <= end) {
      const d = new Date(t);
      const iso = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
        + String(d.getUTCDate()).padStart(2, '0');
      set.add(key + '|' + iso);
      t += 86400000;
    }
  }
  return set;
}

/**
 * Is `person` (a full name) on vacation on `iso`?
 * @param {Set<string>} vac
 * @param {string} person
 * @param {string} iso
 * @returns {boolean}
 */
export function isVacation(vac, person, iso) {
  if (!vac || !person || !iso) return false;
  return vac.has(nameKey(person) + '|' + iso);
}

/**
 * Render state for one heatmap cell. Vacation overrides miss/logged but NOT
 * weekend/holiday (a weekend during a vacation is still painted as a
 * weekend).
 * @param {{is_weekend?: boolean, is_holiday?: boolean, has_log?: boolean, hours?: number}} day
 * @param {boolean} isVac
 * @returns {{kind: 'weekend'|'holiday'|'vacation'|'logged'|'miss', frac: number, hi: boolean, label: string}}
 */
export function cellState(day, isVac) {
  const d = day || {};
  if (d.is_weekend) return { kind: 'weekend', frac: 0, hi: false, label: 'weekend' };
  if (d.is_holiday) return { kind: 'holiday', frac: 0, hi: false, label: 'public holiday' };
  if (isVac) return { kind: 'vacation', frac: 0, hi: false, label: 'time off' };
  if (d.has_log) {
    const hours = d.hours || 0;
    const frac = hours > 0 ? Math.min(hours / TARGET_HOURS, 1) : 0;
    return { kind: 'logged', frac, hi: frac >= 0.5, label: 'logged' };
  }
  return { kind: 'miss', frac: 0, hi: false, label: 'no log' };
}

/**
 * Keeps the persons matching both filters: an exact team ('' = every team)
 * and a free-text fragment matched against name and display_short, folded
 * for diacritics and case.
 * @param {Array<{name?: string, display_short?: string, team?: string}>} persons
 * @param {{query?: string, team?: string}} [opts]
 * @returns {object[]}
 */
export function filterPersons(persons, opts) {
  const { query = '', team = '' } = opts || {};
  const list = Array.isArray(persons) ? persons : [];
  const q = normalizeSearch(query).trim();
  return list.filter((p) => {
    if (team && (p && p.team) !== team) return false;
    if (!q) return true;
    const hay = normalizeSearch(((p && p.name) || '') + ' ' + ((p && p.display_short) || ''));
    return hay.indexOf(q) !== -1;
  });
}

/**
 * One person's row totals over the window, vacation days excluded from both
 * the numerator and the denominator ("effective" days).
 * @param {{name?: string, days?: object[]}} person
 * @param {string[]} dates same order as person.days
 * @param {Set<string>} vac
 * @returns {{logged: number, effective: number, pct: number|null, missingDates: string[]}}
 */
export function personTotals(person, dates, vac) {
  const days = (person && Array.isArray(person.days)) ? person.days : [];
  const name = (person && person.name) || '';
  let logged = 0;
  let effective = 0;
  const missingDates = [];
  const list = Array.isArray(dates) ? dates : [];
  for (let i = 0; i < list.length; i += 1) {
    const iso = list[i];
    const day = days[i] || {};
    if (day.is_weekend || day.is_holiday) continue;
    if (isVacation(vac, name, iso)) continue;
    effective += 1;
    if (day.has_log) logged += 1;
    else missingDates.push(iso);
  }
  const pct = effective > 0 ? Math.round((logged / effective) * 100) : null;
  return { logged, effective, pct, missingDates };
}

/**
 * Per-date logged/total across every visible person, vacation days excluded
 * - the "Total" row.
 * @param {object[]} persons
 * @param {string[]} dates
 * @param {Set<string>} vac
 * @returns {Array<{logged: number, total: number}>}
 */
export function columnTotals(persons, dates, vac) {
  const list = Array.isArray(persons) ? persons : [];
  const dateList = Array.isArray(dates) ? dates : [];
  return dateList.map((iso, i) => {
    let logged = 0;
    let total = 0;
    for (const p of list) {
      const day = (p && Array.isArray(p.days)) ? p.days[i] : null;
      if (!day || day.is_weekend || day.is_holiday) continue;
      if (isVacation(vac, p && p.name, iso)) continue;
      total += 1;
      if (day.has_log) logged += 1;
    }
    return { logged, total };
  });
}

/**
 * The "NN% logged time on DD.MM" badge: the first date (in `data.dates`
 * order - newest first, see server/calendar.js windowDates) that has at
 * least one eligible person (not weekend/holiday/vacation), with the
 * logged/total count for that date. `null` when no date has anyone eligible.
 * @param {{persons?: object[], dates?: string[]}} data
 * @param {Set<string>} vac
 * @returns {{date: string, pct: number, logged: number, total: number, tone: 'green'|'yellow'|'red'}|null}
 */
export function alertStats(data, vac) {
  const persons = (data && Array.isArray(data.persons)) ? data.persons : [];
  const dates = (data && Array.isArray(data.dates)) ? data.dates : [];
  if (persons.length === 0 || dates.length === 0) return null;
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    let logged = 0;
    let total = 0;
    for (const p of persons) {
      const day = (p && Array.isArray(p.days)) ? p.days[i] : null;
      if (!day || day.is_weekend || day.is_holiday) continue;
      if (isVacation(vac, p && p.name, date)) continue;
      total += 1;
      if (day.has_log) logged += 1;
    }
    if (total === 0) continue;
    const pct = Math.round((logged / total) * 100);
    const tone = pct >= 90 ? 'green' : (pct >= 60 ? 'yellow' : 'red');
    return { date, pct, logged, total, tone };
  }
  return null;
}

/**
 * Teams deep-link that opens a chat with `email` prefilled with `message`.
 * @param {string} email
 * @param {string} message
 * @returns {string} '' when there is no e-mail to open a chat with
 */
export function teamsDraftUrl(email, message) {
  if (!email) return '';
  return 'https://teams.microsoft.com/l/chat/0/0?users=' + encodeURIComponent(email)
    + '&message=' + encodeURIComponent(message || '');
}

/**
 * Default draft text for the Teams message.
 * @param {string} displayShort e.g. "A. Morgan"
 * @param {string[]} missingDates ISO dates, formatted with fmtDate
 * @returns {string}
 */
export function teamsMessage(displayShort, missingDates) {
  const dateStr = (missingDates || []).map(fmtDate).join(', ');
  return 'Hi ' + (displayShort || '') + ', time is missing in Tempo for these days: '
    + dateStr + '. Please fill it in.';
}
