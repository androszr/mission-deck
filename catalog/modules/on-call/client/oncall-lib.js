// on-call/client/oncall-lib.js
// Pure functions, no browser document - importable from node --test and used by
// client/index.js for the render. COLUMNS' key order must match the
// server's COLUMN_ORDER (server/build.js) - pinned by a parity test.

export const COLUMNS = [
  { key: 'inventory', label: 'Inventory', short: 'Inv.', badge: 'ds-badge--sky' },
  { key: 'orders', label: 'Orders', short: 'Ord.', badge: 'ds-badge--mandarine' },
  { key: 'platform', label: 'Platform', short: 'Plat.', badge: 'ds-badge--violet' },
  { key: 'devops', label: 'DevOps', short: 'DevOps', badge: 'ds-badge--green' },
];

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/**
 * @param {string} ym "YYYY-MM"
 * @returns {{year: number, month: number}}
 */
export function parseYM(ym) {
  const m = MONTH_RE.exec(String(ym || ''));
  if (!m) return { year: NaN, month: NaN };
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
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
 * @param {string} ym "YYYY-MM"
 * @param {number} delta months to add (may be negative)
 * @returns {string} "YYYY-MM"
 */
export function shiftYM(ym, delta) {
  const { year, month } = parseYM(ym);
  let y = year;
  let m = month + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return formatYM(y, m);
}

/**
 * Monthly grid cells, Monday-first, padded to full weeks with `null` - the
 * time-off calendar shape minus holidays (an on-call calendar has none).
 * @param {number} year
 * @param {number} month 1-12
 * @returns {Array<{dateStr: string, dayNum: number, isWeekend: boolean}|null>}
 */
export function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = formatYM(year, month) + '-' + String(d).padStart(2, '0');
    const dow = new Date(year, month - 1, d).getDay();
    cells.push({ dateStr, dayNum: d, isWeekend: dow === 0 || dow === 6 });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * The month-nav range: the data months plus today, so "Next"/"Previous"
 * never lead into a month with no shard AND no way back.
 * @param {Array<string>} months sorted "YYYY-MM" list
 * @param {string} todayYM "YYYY-MM"
 * @returns {{minYM: string, maxYM: string}}
 */
export function monthRange(months, todayYM) {
  const list = Array.isArray(months) ? months.filter(Boolean) : [];
  let minYM = todayYM;
  let maxYM = todayYM;
  for (const ym of list) {
    if (ym < minYM) minYM = ym;
    if (ym > maxYM) maxYM = ym;
  }
  return { minYM, maxYM };
}

/**
 * Groups a month's flat entries by date, deduping a person present in more
 * than one column into one row that lists every column they cover, in
 * COLUMNS order.
 * @param {Array<{date: string, column: string, person: string, person_slug: string, matched: boolean, note?: string}>} entries
 * @returns {Record<string, Array<{person: string, person_slug: string, matched: boolean, columns: Array<string>, notes: Array<string>}>>}
 */
export function groupEntriesByDay(entries) {
  const order = COLUMNS.map((c) => c.key);
  const byDay = {};
  for (const e of (Array.isArray(entries) ? entries : [])) {
    if (!e || !e.date) continue;
    if (!byDay[e.date]) byDay[e.date] = {};
    const key = e.person_slug || e.person || e.person_raw || '';
    if (!byDay[e.date][key]) {
      byDay[e.date][key] = {
        person: e.person || e.person_raw || '',
        person_slug: e.person_slug || '',
        matched: !!e.matched,
        columns: [],
        notes: [],
      };
    }
    const row = byDay[e.date][key];
    if (e.column && row.columns.indexOf(e.column) === -1) row.columns.push(e.column);
    if (e.note) row.notes.push(e.note);
  }
  const out = {};
  for (const date of Object.keys(byDay)) {
    out[date] = Object.values(byDay[date]).map((row) => {
      row.columns.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return row;
    });
  }
  return out;
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

/**
 * @param {{generated_at?: string, source_version?: number|null}|null} index
 * @returns {string}
 */
export function fmtSyncLabel(index) {
  if (!index || !index.generated_at) return 'The schedule has not been fetched yet.';
  const d = new Date(index.generated_at);
  if (Number.isNaN(d.getTime())) return 'Last sync: unknown date';
  const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const version = index.source_version ? ', page version ' + index.source_version : '';
  return 'Last sync: ' + date + ' ' + time + version;
}

/** @returns {Array<string>} Monday-first weekday headers. */
export function weekdayHeaders() {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
}
