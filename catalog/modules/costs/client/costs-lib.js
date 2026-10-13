// modules/costs/client/costs-lib.js
// Dependency-free helpers shared by the client and the tests.

export const AREAS = ['atlas', 'borealis', 'comet', 'delta'];
export const AREA_LABELS = { atlas: 'Atlas', borealis: 'Borealis', comet: 'Comet', delta: 'Delta' };
/** Currency code shown next to every amount (rates are stored as plain numbers). */
export const CURRENCY = 'EUR';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DASH = '—';

export function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + CURRENCY;
}

/** Whole units, for dense month tables (totals keep cents via fmtMoney). */
export function fmtMoneyShort(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return Math.round(n).toLocaleString('en-US') + ' ' + CURRENCY;
}

export function fmtHours(h) {
  if (h === null || h === undefined || !Number.isFinite(h)) return DASH;
  return h.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' h';
}

export function fmtDays(d) {
  if (d === null || d === undefined || !Number.isFinite(d)) return DASH;
  return d.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' d';
}

export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) return String(month || '');
  return MONTH_NAMES[Number(m[2]) - 1] + ' ' + m[1];
}

/** Ordered ['YYYY-MM', ...] from fromMonth to toMonth inclusive. */
export function monthStartsBetween(fromMonth, toMonth) {
  const out = [];
  let y = Number(fromMonth.slice(0, 4));
  let m = Number(fromMonth.slice(5, 7));
  const ey = Number(toMonth.slice(0, 4));
  const em = Number(toMonth.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function lastDayOfMonth(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return month + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
}

export function fold(s) {
  return String(s || '').replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Persons of one area tab, filtered by a free-text query. */
export function rowsForArea(persons, area, query) {
  const q = fold(query).trim();
  return (persons || []).filter((p) => (p.areas || []).includes(area)
    && (!q || fold(p.name).includes(q) || fold(p.role).includes(q) || fold(p.company).includes(q)));
}

export function summaryFor(summary, area) {
  const empty = { cost: 0, hours: 0, personsNoRate: 0, hoursNoRate: 0, persons: 0 };
  if (!summary) return empty;
  return (summary.byArea && summary.byArea[area]) || summary.all || empty;
}

/** Cell value for the chosen metric: 'cost' | 'hours' | 'days'. */
export function metricText(cell, metric) {
  if (!cell) return DASH;
  if (metric === 'hours') return fmtHours(cell.hours);
  if (metric === 'days') return fmtDays(cell.days);
  return fmtMoneyShort(cell.cost);
}

/** Column totals over rows for the chosen metric; cost skips rate-less rows. */
export function columnTotals(rows, months, metric) {
  const out = {};
  const keys = [...months, 'total'];
  for (const k of keys) {
    let hours = 0; let days = 0; let cost = 0; let noRateHours = 0;
    for (const p of rows) {
      const c = k === 'total' ? p.total : p.months[k];
      if (!c) continue;
      hours += c.hours; days += c.days;
      if (p.rateMissing) noRateHours += c.hours; else cost += c.cost;
    }
    out[k] = { hours, days, cost, noRateHours, text: metricText({ hours, days, cost }, metric) };
  }
  return out;
}

// -- epic tree helpers ----------------------------------------------------------

/** Cell value of the chosen metric as a number (for sorting and sums). */
export function metricValue(cell, metric) {
  if (!cell) return 0;
  if (metric === 'hours') return cell.hours || 0;
  if (metric === 'days') return cell.days || 0;
  return cell.cost || 0;
}

/** Text of a tree cell: no hours -> dash; cost shows the PRICED sum, a cell with nothing priced shows a dash. */
export function treeCellText(cell, metric) {
  if (!cell || !(cell.hours > 0)) return DASH;
  if (metric === 'hours') return fmtHours(cell.hours);
  if (metric === 'days') return fmtDays(cell.days);
  return cell.cost > 0 || !(cell.noRateHours > 0) ? fmtMoneyShort(cell.cost) : DASH;
}

/** True when part of the cell is unpriced and the cost metric is shown. */
export function treeCellUnpriced(cell, metric) {
  return metric === 'cost' && !!cell && cell.noRateHours > 0;
}

export function sortByMetric(list, metric) {
  return [...list].sort((a, b) => (metricValue(b.total, metric) - metricValue(a.total, metric)) || ((b.total.hours || 0) - (a.total.hours || 0)));
}

/** Search over epic name/key and issue key/summary; an epic hit keeps all its issues. */
export function filterEpics(epics, query) {
  const q = fold(query).trim();
  if (!q) return epics || [];
  const out = [];
  for (const ep of epics || []) {
    if (fold(ep.name).includes(q) || fold(ep.key).includes(q)) { out.push(ep); continue; }
    const issues = (ep.issues || []).filter((is) => fold(is.key).includes(q) || fold(is.summary).includes(q));
    if (issues.length) out.push({ ...ep, issues });
  }
  return out;
}

/** Column sums over the VISIBLE epics (an epic's total may include hidden issues after a search). */
export function sumEpics(epics, months) {
  const zero = () => ({ hours: 0, days: 0, cost: 0, noRateHours: 0 });
  const out = { total: zero() };
  for (const m of months) out[m] = zero();
  const add = (to, c) => { to.hours += c.hours; to.days += c.days; to.cost += c.cost; to.noRateHours += c.noRateHours; };
  for (const ep of epics || []) {
    for (const is of ep.issues || []) {
      for (const m of months) add(out[m], is.months[m]);
      add(out.total, is.total);
    }
  }
  return out;
}

/**
 * Invert the epic tree (epic -> issue -> person) into person -> epic -> issue,
 * so the People view can expand a person into their epics and tasks.
 * Returns Map(personId -> [{ key, name, months, total, issues: [{ key, summary, months, total }] }]).
 */
export function personEpics(epics, months) {
  const zero = () => ({ hours: 0, days: 0, cost: 0, noRateHours: 0 });
  const add = (to, c) => { if (!c) return; to.hours += c.hours || 0; to.days += c.days || 0; to.cost += c.cost || 0; to.noRateHours += c.noRateHours || 0; };
  const blank = () => { const o = { months: {}, total: zero() }; for (const m of months) o.months[m] = zero(); return o; };
  const out = new Map();
  for (const ep of epics || []) {
    for (const is of ep.issues || []) {
      for (const pe of is.persons || []) {
        if (!out.has(pe.id)) out.set(pe.id, new Map());
        const byEpic = out.get(pe.id);
        if (!byEpic.has(ep.key)) byEpic.set(ep.key, { key: ep.key, name: ep.name, issues: [], ...blank() });
        const e = byEpic.get(ep.key);
        const i = { key: is.key, summary: is.summary, ...blank() };
        for (const m of months) { add(i.months[m], pe.months[m]); add(e.months[m], pe.months[m]); }
        add(i.total, pe.total);
        add(e.total, pe.total);
        e.issues.push(i);
      }
    }
  }
  const res = new Map();
  for (const [id, byEpic] of out) res.set(id, [...byEpic.values()]);
  return res;
}

const ORG_PREFIX_RE = /^(ext|vnd|ctr)\s+/i;

/** Tempo display name -> a person's name: no org prefix, no "[X]" / "(...)" tail, no "ctr". */
export function cleanTempoName(displayName) {
  let n = String(displayName || '').replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(ORG_PREFIX_RE, '').replace(/\s+ctr$/i, '').trim();
  return n;
}
