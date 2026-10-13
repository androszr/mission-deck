// modules/roadmap/client/roadmap-helpers.js
// Pure helpers of the "Timeline" tab. No document, no fetch: the contract test
// imports this file in plain Node. Dates are 'YYYY-MM-DD' strings, positions are
// percentages of the timeline width (0..100).
//
// Bar start, phase classification and bar geometry, on a month-based scale
// that can collapse quarters.

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const COLLAPSED_WEIGHT = 0.12;
export const GRANULARITIES = ['quarters', 'months'];

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

/** 'YYYY-MM-DD' -> whole days since 1970-01-01 (UTC); NaN for anything else. */
export function dayNumber(ymd) {
  const m = YMD.exec(String(ymd || ''));
  if (!m) return NaN;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return NaN;
  return Math.round(t / DAY_MS);
}

export function dayToYmd(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function daysInYear(year) {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
}

/** Local calendar date of a Date as 'YYYY-MM-DD' (local is what a person sees as "today"). */
export function localYmd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// ---- Initiative data ---------------------------------------------------------

function _eachTbpd(init, fn) {
  const visit = (tbpd) => { if (tbpd && typeof tbpd === 'object') fn(tbpd); };
  for (const t of (init.jiraTasks || [])) visit(t && t.timeByPersonByDay);
  for (const e of (init.deliveryEpics || [])) {
    visit(e && e.timeByPersonByDay);
    for (const s of ((e && e.subtasks) || [])) visit(s && s.timeByPersonByDay);
  }
}

/** Earliest logged day over tasks, delivery epics and their subtasks; falls back to discoveryEnd, then null. */
export function computeBarStart(init) {
  let earliest = null;
  _eachTbpd(init || {}, (tbpd) => {
    for (const dayMap of Object.values(tbpd)) {
      if (!dayMap || typeof dayMap !== 'object') continue;
      for (const d of Object.keys(dayMap)) if (!earliest || d < earliest) earliest = d;
    }
  });
  return earliest || (init && init.discoveryEnd) || null;
}

/** Number of distinct people who logged time on the initiative. */
export function countLoggedPersons(init) {
  const set = new Set();
  _eachTbpd(init || {}, (tbpd) => { for (const p of Object.keys(tbpd)) set.add(p); });
  return set.size;
}

/** 'discovery' | 'delivery' | 'finished' | 'no-dates' . */
export function classifyPhase(init, todayStr) {
  const disc = (init && init.discoveryEnd) || null;
  const del = (init && init.deliveryEnd) || null;
  if (!disc && !del) return 'no-dates';
  if (del && todayStr >= del) return 'finished';
  if (disc && todayStr >= disc) return 'delivery';
  return 'discovery';
}

export function phaseCounts(list, todayStr) {
  const out = { total: 0, discovery: 0, delivery: 0, finished: 0, 'no-dates': 0 };
  for (const i of (Array.isArray(list) ? list : [])) {
    out.total += 1;
    out[classifyPhase(i, todayStr)] += 1;
  }
  return out;
}

/** Years offered by the year select: 2025..2027, the current year and every year the data touches. */
export function yearOptions(list, todayYear) {
  const years = new Set([2025, 2026, 2027, todayYear]);
  for (const i of (Array.isArray(list) ? list : [])) {
    for (const f of ['discoveryEnd', 'deliveryEnd', 'goLiveDate']) {
      const m = YMD.exec((i && i[f]) || '');
      if (m) years.add(Number(m[1]));
    }
  }
  return [...years].filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
}

// ---- Scale: date -> position ---------------------------------------------------

/**
 * One year as 12 month segments. Every month of a collapsed quarter weighs
 * COLLAPSED_WEIGHT, the rest 1, so position is piecewise linear and every consumer
 * (bars, today line, headers, markers) goes through dayToPct.
 * @param {number} year
 * @param {number[]} [collapsed] zero-based quarter indexes (0..3)
 */
export function buildScale(year, collapsed = []) {
  const months = [];
  let total = 0;
  for (let m = 0; m < 12; m += 1) {
    const quarter = Math.floor(m / 3);
    const startDay = Math.round(Date.UTC(year, m, 1) / DAY_MS);
    const endDay = Math.round(Date.UTC(year, m + 1, 1) / DAY_MS);
    const weight = collapsed.includes(quarter) ? COLLAPSED_WEIGHT : 1;
    months.push({ index: m, quarter, startDay, endDay, weight, label: MONTH_LABELS[m], before: total });
    total += weight;
  }
  for (const mo of months) {
    mo.leftPct = (mo.before / total) * 100;
    mo.widthPct = (mo.weight / total) * 100;
  }
  const quarters = [0, 1, 2, 3].map((q) => {
    const ms = months.slice(q * 3, q * 3 + 3);
    return {
      quarter: q,
      label: 'Q' + (q + 1) + ' ' + year,
      collapsed: collapsed.includes(q),
      leftPct: ms[0].leftPct,
      widthPct: ms.reduce((s, x) => s + x.widthPct, 0),
    };
  });
  return { year, months, quarters, total, startDay: months[0].startDay, endDay: months[11].endDay };
}

/** Day number (may be fractional) -> percent of the width, clamped to the year. */
export function dayToPct(scale, day) {
  const d = Math.min(Math.max(day, scale.startDay), scale.endDay);
  for (const mo of scale.months) {
    if (d < mo.endDay || mo.index === 11) {
      const frac = Math.min((d - mo.startDay) / (mo.endDay - mo.startDay), 1);
      return ((mo.before + frac * mo.weight) / scale.total) * 100;
    }
  }
  return 100;
}

export function ymdToPct(scale, ymd) {
  const n = dayNumber(ymd);
  return Number.isNaN(n) ? null : dayToPct(scale, n);
}

/** Position of "today" inside the year, null when today is outside it. */
export function todayPct(scale, todayStr) {
  const n = dayNumber(todayStr);
  if (Number.isNaN(n) || n < scale.startDay || n >= scale.endDay) return null;
  return dayToPct(scale, n);
}

/** Toggles a quarter in the collapsed list (new array, sorted). */
export function toggleCollapsed(collapsed, quarter) {
  const cur = Array.isArray(collapsed) ? collapsed : [];
  const next = cur.includes(quarter) ? cur.filter((q) => q !== quarter) : [...cur, quarter];
  return next.filter((q) => q >= 0 && q <= 3).sort((a, b) => a - b);
}

/** Header cells for the chosen granularity: [{ label, leftPct, widthPct, quarter, collapsed }]. */
export function headerCells(scale, granularity) {
  if (granularity === 'months') {
    return scale.months.map((m) => ({ label: m.label, leftPct: m.leftPct, widthPct: m.widthPct, quarter: m.quarter, collapsed: scale.quarters[m.quarter].collapsed }));
  }
  return scale.quarters.map((q) => ({ label: q.label, leftPct: q.leftPct, widthPct: q.widthPct, quarter: q.quarter, collapsed: q.collapsed }));
}

/** Left edges (percent) of the vertical grid lines, one per header cell boundary except the first. */
export function gridLines(scale, granularity) {
  return headerCells(scale, granularity).slice(1).map((c) => c.leftPct);
}

// ---- Bars --------------------------------------------------------------------

/**
 * Bar of one initiative on the scale: a discovery segment (start -> discoveryEnd),
 * a delivery segment (-> deliveryEnd) and the go-live milestone. Endpoint
 * resolution is stable, so the same data draws the same bar.
 * @returns {{ visible: boolean, disc: {left:number,width:number}|null, del: {left:number,width:number}|null,
 *   goLive: {left:number}|null, start: string|null, discEnd: string|null, delEnd: string|null, goLiveDate: string|null }}
 */
export function barModel(init, scale) {
  const year = scale.year;
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';
  const startStr = computeBarStart(init);
  const midStr = (init && init.discoveryEnd) || null;
  const endStr = (init && init.deliveryEnd) || null;
  const goStr = (init && init.goLiveDate) || null;
  const out = { visible: false, disc: null, del: null, goLive: null, start: startStr, discEnd: midStr, delEnd: endStr, goLiveDate: goStr };

  if (goStr && goStr >= yearStart && goStr <= yearEnd && !Number.isNaN(dayNumber(goStr))) {
    out.goLive = { left: dayToPct(scale, dayNumber(goStr) + 0.5) };
  }
  if (!startStr && !midStr && !endStr) return out;

  const barStart = startStr || midStr || yearStart;
  const barEnd = endStr || midStr || barStart;
  const discEnd = midStr || barEnd;
  if (barEnd < yearStart || barStart > yearEnd) return out;

  const clampMax = (a, b) => (a > b ? a : b);
  const clampMin = (a, b) => (a < b ? a : b);
  const pct = (s) => {
    const n = dayNumber(s);
    return Number.isNaN(n) ? 0 : dayToPct(scale, n);
  };
  const dStart = pct(clampMax(barStart, yearStart));
  const dEnd = pct(clampMin(discEnd, yearEnd));
  const vStart = pct(clampMax(discEnd, yearStart));
  const vEnd = pct(clampMin(barEnd, yearEnd));
  out.visible = true;
  if (dEnd - dStart > 0) out.disc = { left: dStart, width: dEnd - dStart };
  if (vEnd - vStart > 0) out.del = { left: vStart, width: vEnd - vStart };
  return out;
}

/** Stage short labels of an initiative, for the tooltip. */
export function stageLabels(init, stages) {
  const cur = Array.isArray(init && init.stageStatus) ? init.stageStatus : [];
  return (stages || []).filter((s) => cur.includes(s.id)).map((s) => s.short);
}
