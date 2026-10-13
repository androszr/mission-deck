// time-off/client/time-off-lib.js
// Pure functions, no browser document - importable from node --test and
// used by client/index.js for the render. Kept dependency-free so the
// contract test can import this file without a browser.
//
// slugify() MUST match the Python twin in scripts/sharepoint_time_off.py -
// both are checked against the same tests/fixtures/slug-cases.json.

const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/**
 * Same rules as the app's name normaliser plus "spaces -> dash": NFD
 * normalize, strip combining marks, map l/d/o-with-stroke, lowercase,
 * collapse separators to one space, strip a trailing "app read|write|access"
 * suffix (SharePoint permission groups leak into name columns), trim,
 * then turn the remaining spaces into dashes.
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  let s = String(name === null || name === undefined ? '' : name);
  s = s.normalize('NFD');
  s = s.replace(COMBINING_MARKS_RE, '');
  s = s.replace(/[\u0142\u0141]/g, 'l'); // l/L with stroke
  s = s.replace(/[\u0111\u0110]/g, 'd'); // d/D with stroke
  s = s.replace(/[\u00f8\u00d8]/g, 'o'); // o/O with stroke
  s = s.toLowerCase();
  s = s.replace(/[-_\s]+/g, ' ');
  s = s.replace(/\s+app\s+(read|write|access)$/, '');
  s = s.trim();
  s = s.replace(/\s+/g, '-');
  return s;
}

/**
 * @param {string} ym "YYYY-MM"
 * @returns {{year: number, month: number}}
 */
export function parseYM(ym) {
  const parts = String(ym || '').split('-');
  return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) };
}

/**
 * @param {number} year
 * @param {number} month 1-12
 * @returns {string} "YYYY-MM"
 */
export function formatYM(year, month) {
  return year + '-' + String(month).padStart(2, '0');
}

/**
 * Monthly grid cells, Monday-first, padded to full weeks with `null`.
 * `holidays` is passed in (from holidays.js) so the function stays
 * deterministic and side-effect free.
 * @param {number} year
 * @param {number} month 1-12
 * @param {Set<string>} [holidays]
 * @returns {Array<{dateStr: string, dayNum: number, isWeekend: boolean, isHoliday: boolean}|null>}
 */
export function buildMonthGrid(year, month, holidays) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatYM(year, month) + '-' + String(d).padStart(2, '0');
    const dow = new Date(year, month - 1, d).getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holidays ? holidays.has(dateStr) : false;
    cells.push({ dateStr, dayNum: d, isWeekend, isHoliday });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * @param {Date|string|number} [today]
 * @returns {string} "YYYY-MM"
 */
function todayYM(today) {
  const d = today instanceof Date ? today : new Date(today === undefined ? Date.now() : today);
  return formatYM(d.getFullYear(), d.getMonth() + 1);
}

/**
 * Month range the "Previous"/"Next" buttons may reach, derived from the
 * data rather than a hardcoded year. `startYM` is the current month clipped
 * into [minYM, maxYM]; with no entries the whole range collapses onto the
 * current month.
 * @param {Array<{dateFrom: string, dateTo: string}>} entries
 * @param {Date|string|number} [today]
 * @returns {{minYM: string, maxYM: string, startYM: string}}
 */
export function buildRange(entries, today) {
  const list = Array.isArray(entries) ? entries : [];
  const current = todayYM(today);
  if (list.length === 0) return { minYM: current, maxYM: current, startYM: current };

  let minYM = null;
  let maxYM = null;
  for (const e of list) {
    const fromYM = String(e && e.dateFrom || '').slice(0, 7);
    const toYM = String(e && e.dateTo || '').slice(0, 7);
    for (const ym of [fromYM, toYM]) {
      if (!ym) continue;
      if (minYM === null || ym < minYM) minYM = ym;
      if (maxYM === null || ym > maxYM) maxYM = ym;
    }
  }
  if (minYM === null || maxYM === null) return { minYM: current, maxYM: current, startYM: current };

  let startYM = current;
  if (startYM < minYM) startYM = minYM;
  if (startYM > maxYM) startYM = maxYM;
  return { minYM, maxYM, startYM };
}

/**
 * Flattens the index + per-person shards into the same entry shape
 * `GET /data` answers with. Exists as a pure, testable twin of the merge the
 * server does with its own (CJS) loop - a module cannot share code between
 * its CommonJS server and its ESM client.
 * @param {{persons?: Record<string, {name?: string}>}} index
 * @param {Record<string, {name?: string, entries?: Array<{dateFrom: string, dateTo: string, submittedAt?: string|null, submittedBy?: string|null}>}>} shards
 * @returns {Array<{id: string, person: string, person_slug: string, dateFrom: string, dateTo: string, submittedAt: string|null, submittedBy: string|null}>}
 */
export function mergeShards(index, shards) {
  const out = [];
  const map = shards && typeof shards === 'object' ? shards : {};
  const persons = (index && index.persons) || {};
  for (const slug of Object.keys(map)) {
    const shard = map[slug] || {};
    const name = shard.name || (persons[slug] && persons[slug].name) || slug;
    const entries = Array.isArray(shard.entries) ? shard.entries : [];
    entries.forEach((entry, i) => {
      out.push({
        id: slug + '-' + i,
        person: name,
        person_slug: slug,
        dateFrom: entry.dateFrom,
        dateTo: entry.dateTo,
        submittedAt: entry.submittedAt || null,
        submittedBy: entry.submittedBy || null,
      });
    });
  }
  out.sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0));
  return out;
}

/**
 * Inclusive day count between two ISO dates.
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {number}
 */
export function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T00:00:00');
  const b = new Date(toIso + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * "YYYY-MM-DD" -> "DD.MM.YYYY".
 * @param {string} iso
 * @returns {string}
 */
export function fmtDate(iso) {
  if (!iso || iso.length < 10) return iso || '';
  return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
}

/**
 * Fallback initials when no team-directory match exists.
 * @param {string} name
 * @returns {string}
 */
export function getInitials(name) {
  if (!name) return '??';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const PALETTE = [
  'timeoff-c--1', 'timeoff-c--2', 'timeoff-c--3', 'timeoff-c--4',
  'timeoff-c--5', 'timeoff-c--6', 'timeoff-c--7', 'timeoff-c--8',
];

/**
 * Assigns one palette class per distinct person_slug, in order of first
 * appearance, cycling through the eight slots.
 * @param {Array<{person_slug?: string, person?: string}>} entries
 * @returns {Record<string, string>}
 */
export function paletteClassMap(entries) {
  const map = {};
  let idx = 0;
  for (const e of (entries || [])) {
    const key = (e && (e.person_slug || e.person)) || '';
    if (!key) continue;
    if (!map[key]) {
      map[key] = PALETTE[idx % PALETTE.length];
      idx++;
    }
  }
  return map;
}

// ── Search over people ──────────────────────────────────────────────────────
// A private copy of the core's normalizeSearch (js/utils.js) rather than an
// import: this file is imported by `node --test` with no `/js/...` resolver,
// the same reason client/index.js reaches for core ESM dynamically. slugify()
// above is NOT reused for the fold - it is pinned by the Python parity fixture
// and turns spaces into dashes, which would break a two-word query.

/**
 * Diacritic- and case-insensitive form of a string, for substring matching.
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
 * Keeps the entries whose person matches every word of the query. Two names per
 * entry are searched: the raw `person` string from the sheet and whatever
 * `displayNameOf` resolves from the team directory (the name a person actually
 * reads on screen), so a surname alone finds the row even when the sheet spells it
 * surname-first or with a prefix.
 * @param {Array<{person?: string}>} entries
 * @param {string} query
 * @param {(entry: object) => string} [displayNameOf]
 * @returns {Array<object>}
 */
export function filterEntriesByPerson(entries, query, displayNameOf) {
  const list = Array.isArray(entries) ? entries : [];
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((e) => {
    const extra = typeof displayNameOf === 'function' ? displayNameOf(e) : '';
    const haystack = normalizeSearch((e && e.person) || '') + ' ' + normalizeSearch(extra || '');
    return words.every((w) => haystack.indexOf(w) !== -1);
  });
}

/**
 * How many distinct people the entry list covers - the number the count line
 * next to the search box reports.
 * @param {Array<{person_slug?: string, person?: string}>} entries
 * @returns {number}
 */
export function countPersons(entries) {
  const seen = new Set();
  for (const e of (entries || [])) {
    const key = (e && (e.person_slug || e.person)) || '';
    if (key) seen.add(key);
  }
  return seen.size;
}
