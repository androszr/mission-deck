// time-off/client/widget.js
// Dashboard widget "Away this week" (contract: modules-template/README.md,
// dashboard widgets). Reads GET <apiBase>/data (every entry; the
// Mon-Fri intersection is computed here) and paints who is away this week.
// People are avatars from the team directory (the host hydrates them). On a
// weekend the widget shows the coming week. Public holidays are not workdays.
// No static import from the core's /js/: the kit arrives as ctx.kit; the
// sibling ./holidays.js is this module's own.

import { publicHolidays } from './holidays.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function _ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Monday of the shown week: this week's, or the coming one on Saturday/Sunday. */
export function weekStart(now) {
  const dow = now.getDay();
  if (dow === 0) return _addDays(now, 1);
  if (dow === 6) return _addDays(now, 2);
  return _addDays(now, -(dow - 1));
}

function _plural(n) {
  return n === 1 ? 'person' : 'people';
}

/** Span label ("mon-wed", "fri", whole week) for the workday indexes a person is away. */
function _span(flags) {
  const idx = flags.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return '';
  if (idx.length === 5) return 'whole week';
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (idx.length === 1) return DAYS[idx[0]];
  return contiguous ? DAYS[idx[0]] + '-' + DAYS[idx[idx.length - 1]] : idx.map((i) => DAYS[i]).join(', ');
}

/**
 * Persons away on at least one workday of the shown week, with per-day flags.
 * Entries of one person are merged; a holiday is never an "away" day.
 * @param {Array<{person: string, dateFrom: string, dateTo: string}>} entries
 * @param {Date} now
 */
export function weekAbsences(entries, now) {
  const mon = weekStart(now);
  const days = Array.from({ length: 5 }, (_, i) => _ymd(_addDays(mon, i)));
  const holidays = new Set([...publicHolidays(mon.getFullYear()), ...publicHolidays(_addDays(mon, 4).getFullYear())]);
  const byPerson = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !e.person || !e.dateFrom || !e.dateTo) continue;
    days.forEach((day, i) => {
      if (holidays.has(day) || e.dateFrom > day || e.dateTo < day) return;
      if (!byPerson.has(e.person)) byPerson.set(e.person, [false, false, false, false, false]);
      byPerson.get(e.person)[i] = true;
    });
  }
  const todayIdx = days.indexOf(_ymd(now));
  return {
    days,
    todayIdx,
    mon,
    persons: [...byPerson.entries()].map(([name, flags]) => ({ name, flags })).sort((a, b) => a.flags.indexOf(true) - b.flags.indexOf(true) || a.name.localeCompare(b.name, 'en')),
    holidays: days.map((d) => holidays.has(d)),
  };
}

/**
 * Calendar days of the month of `now`: persons away per workday, null on
 * weekends and public holidays.
 */
export function monthDays(entries, now) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const count = new Date(y, m + 1, 0).getDate();
  const holidays = publicHolidays(y);
  const out = [];
  for (let d = 1; d <= count; d += 1) {
    const date = new Date(y, m, d);
    const iso = _ymd(date);
    if (date.getDay() === 0 || date.getDay() === 6 || holidays.has(iso)) { out.push(null); continue; }
    const names = new Set();
    for (const e of Array.isArray(entries) ? entries : []) {
      if (e && e.person && e.dateFrom <= iso && e.dateTo >= iso) names.add(e.person);
    }
    out.push(names.size);
  }
  return out;
}

/** "as of 11.10" from an ISO timestamp (UTC in the index), in local time; '' when absent. */
export function asOfLabel(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return 'as of ' + String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
}

export const SYNC_TEXT = 'No time-off data. Pull the data in the Sync window.';
export const NO_SHEET_TEXT = 'No time-off data. Pull the data in the Sync window or download the sheet in the module view.';

/**
 * Which "no data" sentence a /data answer needs, or null when it carries data.
 * The route answers available:true with no index and no entries before the
 * first download (or on an emptied tree): that is no data, not "nobody away".
 */
export function noDataText(data) {
  if (!data || data.storage !== 'ok' || data.available === false) return SYNC_TEXT;
  const none = !data.fetched_at && !(Array.isArray(data.entries) && data.entries.length) && !(Array.isArray(data.persons) && data.persons.length);
  return none ? NO_SHEET_TEXT : null;
}

/**
 * @param {Array} entries @param {Date} now
 * @param {{asOf?: string}} [opts] "as of DD.MM" shown in the first block
 * @returns {{blocks: Object<string, object>, empty: string|null}}
 */
export function buildBlocks(entries, now, opts = {}) {
  const asOf = opts.asOf ? ' · ' + opts.asOf : '';
  const w = weekAbsences(entries, now);
  const monLabel = String(w.mon.getDate()).padStart(2, '0') + '.' + String(w.mon.getMonth() + 1).padStart(2, '0');
  const calendar = { type: 'calendar', label: MONTHS[now.getMonth()] + (asOf || ': people off'), firstWeekday: ((new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7) + 1, days: monthDays(entries, now) };
  if (w.persons.length === 0) {
    // A genuine empty week is good news in every size, never a bare zero.
    // One pill object under every person key: paint() drops the repeats.
    const pill = { type: 'pill', tone: 'ok', text: 'Nobody has time off booked', sub: 'in the week of ' + monLabel + asOf };
    return { blocks: { avatars_today: pill, people: pill, heatmap: pill, calendar }, empty: null };
  }
  const today = w.todayIdx >= 0 ? w.persons.filter((p) => p.flags[w.todayIdx]) : [];
  const blocks = {
    people: { type: 'people', people: w.persons.map((p) => ({ name: p.name, sub: _span(p.flags), tone: p.flags.every(Boolean) ? 'warn' : 'info' })) },
    calendar,
    heatmap: { type: 'heatmap', rows: w.persons.slice(0, 6).map((p) => p.name), cols: DAYS, values: w.persons.slice(0, 6).map((p) => p.flags.map((f) => (f ? 1 : 0))) },
    avatars_today: today.length
      ? { type: 'avatars', label: 'Away today' + asOf, people: today.map((p) => ({ name: p.name, tone: 'warn' })), max: 6 }
      : { type: 'pill', tone: 'ok', text: w.todayIdx >= 0 ? 'Nobody away today' : 'Weekend', sub: w.persons.length + ' ' + _plural(w.persons.length) + ' in the week of ' + monLabel + asOf },
  };
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['avatars_today'],
  m: ['people'],
  l: ['avatars_today', 'calendar', 'people'],
  s2: ['avatars_today', 'calendar'],
  m2: ['people', 'calendar'],
  xl: ['avatars_today', 'calendar', 'heatmap'],
};

/** @returns {string} HTML */
export function paint(entries, variantId, size, kit, now = new Date(), opts = {}) {
  const { blocks, empty } = buildBlocks(entries, now, opts);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m;
  return kit.blocks(keys.map((k) => blocks[k]).filter((b, i, all) => b && all.indexOf(b) === i), size);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/data', { signal: ctx.signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const missing = noDataText(data);
  const html = missing
    ? ctx.kit.empty(missing)
    : paint(data.entries, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit, new Date(), { asOf: asOfLabel(data.fetched_at) });
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) el.innerHTML = html;
  return () => { disposed = true; };
}
