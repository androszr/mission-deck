// on-call/client/widget.js
// Dashboard widget "on-call-today" (contract: modules-template/README.md,
// dashboard widgets). Reads GET <apiBase>/data (the current month, and the next one
// only when the next days cross into it and the index lists it) and paints who
// is on duty today and on the next days. People are avatars from the team
// directory (the host hydrates them). No static import from the core's /js/:
// the kit arrives as ctx.kit; ./oncall-lib.js is this module's own sibling.

import { COLUMNS, groupEntriesByDay } from './oncall-lib.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AHEAD_DAYS = 4; // today + 3
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function _ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _addDays(d, n) {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return c;
}

/**
 * Months (YYYY-MM) the widget needs: the ones of the next AHEAD_DAYS days.
 * @param {Date} now @returns {string[]} sorted
 */
export function neededMonths(now) {
  const set = new Set();
  for (let i = 0; i < AHEAD_DAYS; i += 1) set.add(_ymd(_addDays(now, i)).slice(0, 7));
  return [...set].sort();
}

/** "as of 11 Oct" from the index's generated_at, in local time; '' when absent. */
export function asOfLabel(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return 'as of ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
}

export const SYNC_TEXT = 'No on-call schedule data. Fetch the data in the Sync window.';
export const NO_INDEX_TEXT = 'No on-call schedule yet. Fetch the data in the Sync window or use the Sync button in the tool view.';

/** Sentence for a month whose shard is missing - "nobody on call" would be a lie. */
export function noMonthText(now) {
  return 'No on-call schedule for ' + MONTHS[now.getMonth()] + '. Use the Sync button in the tool view.';
}

function _columnText(columns) {
  if (columns.length === 1) {
    const c = COLUMNS.find((x) => x.key === columns[0]);
    return c ? c.label : columns[0];
  }
  return columns.map((k) => { const c = COLUMNS.find((x) => x.key === k); return c ? c.short : k; }).join(' · ');
}

function _dayLabel(d, i) {
  if (i === 0) return 'today';
  if (i === 1) return 'tomorrow';
  return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
}

/**
 * @param {Array} entries month entries (any months)
 * @param {Date} now
 * @param {{asOf?: string}} [opts] "as of D Mon" shown in the labels
 * @returns {{blocks: Object<string, object>, empty: string|null}}
 */
export function buildBlocks(entries, now, opts = {}) {
  const asOf = opts.asOf || '';
  const byDay = groupEntriesByDay(entries);
  const todayRows = byDay[_ymd(now)] || [];
  const nothing = { type: 'pill', tone: 'neutral', text: 'Nobody on call today', sub: asOf ? 'schedule ' + asOf : 'in the schedule' };
  const anyAhead = Array.from({ length: AHEAD_DAYS }, (_, i) => byDay[_ymd(_addDays(now, i))]).some((r) => r && r.length);
  if (!anyAhead) return { blocks: {}, empty: 'Nobody on call today in the schedule.' };

  const personOf = (row) => ({ name: row.person, sub: _columnText(row.columns), tone: 'ok' });
  const platformRows = todayRows.filter((r) => r.columns.includes('platform'));
  const blocks = {
    people_platform: todayRows.length ? { type: 'people', people: (platformRows.length ? platformRows : todayRows).map(personOf) } : nothing,
    people_all: todayRows.length ? { type: 'people', people: todayRows.map(personOf) } : nothing,
    avatars: todayRows.length ? { type: 'avatars', label: 'On call today' + (asOf ? ' · ' + asOf : ''), people: todayRows.map((r) => ({ name: r.person, tone: 'ok' })), max: 6 } : nothing,
  };

  // Timeline: who covers Platform (else the first person of the day) on each day.
  const events = [];
  for (let i = 0; i < AHEAD_DAYS; i += 1) {
    const d = _addDays(now, i);
    const rows = byDay[_ymd(d)] || [];
    if (!rows.length) continue;
    const row = rows.find((r) => r.columns.includes('platform')) || rows[0];
    events.push({ date: _dayLabel(d, i), label: row.person, tone: i === 0 ? 'ok' : 'info', person: row.person });
  }
  blocks.timeline = { type: 'timeline', events };

  // Calendar: how many on-call columns are covered on each day of the month (null = no schedule).
  const y = now.getFullYear();
  const mo = now.getMonth();
  const count = new Date(y, mo + 1, 0).getDate();
  const monthDays = [];
  for (let d = 1; d <= count; d += 1) {
    const rows = byDay[_ymd(new Date(y, mo, d))] || [];
    const cols = new Set(rows.flatMap((r) => r.columns));
    monthDays.push(cols.size ? cols.size : null);
  }
  blocks.calendar = { type: 'calendar', label: MONTHS[mo] + (asOf ? ' · ' + asOf : ': on-call coverage'), firstWeekday: ((new Date(y, mo, 1).getDay() + 6) % 7) + 1, days: monthDays };
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['people_platform'],
  s2: ['people_all', 'calendar'],
  m: ['avatars'],
  m2: ['people_all', 'calendar'],
  l: ['people_all', 'calendar', 'timeline'],
};

/** @returns {string} HTML */
export function paint(entries, variantId, size, kit, now = new Date(), opts = {}) {
  const { blocks, empty } = buildBlocks(entries, now, opts);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m2;
  return kit.blocks(keys.map((k) => blocks[k]).filter((b) => b && !(b.type === 'timeline' && b.events.length === 0)), size);
}

async function _fetchMonth(ctx, ym) {
  const res = await fetch(ctx.apiBase + '/data' + (ym ? '?month=' + encodeURIComponent(ym) : ''), { signal: ctx.signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const now = new Date();
  const current = _ymd(now).slice(0, 7);
  // Ask for the month we mean: the server's default month may differ (midnight, clock skew).
  const first = await _fetchMonth(ctx, current);
  let html;
  if (!first || first.storage !== 'ok') {
    html = ctx.kit.empty(SYNC_TEXT);
  } else if (first.available === false) {
    html = ctx.kit.empty(NO_INDEX_TEXT);
  } else if (!first.month || first.ym !== current) {
    html = ctx.kit.empty(noMonthText(now));
  } else {
    const listed = new Set(Array.isArray(first.months) ? first.months : []);
    const entries = [...(first.month.entries || [])];
    for (const ym of neededMonths(now)) {
      if (ym === current || !listed.has(ym)) continue;
      try {
        const more = await _fetchMonth(ctx, ym);
        entries.push(...((more.month && more.month.entries) || []));
      } catch (e) {
        if (ctx.signal && ctx.signal.aborted) throw e;
        // The neighbouring month is optional: the widget shows what it has.
      }
    }
    const opts = { asOf: asOfLabel(first.index && first.index.generated_at) };
    html = paint(entries, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit, now, opts);
  }
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) el.innerHTML = html;
  return () => { disposed = true; };
}
