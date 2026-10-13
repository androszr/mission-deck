'use strict';
// modules/costs/server/compute.js
// Pure functions: no fs, no ctx. Worklogs -> author x month seconds -> month
// shards -> index -> costs at READ time (hours / 8 * daily rate).

const { buildAuthorIndex, matchAuthor, memberName } = require('./match.js');

const AREAS = ['atlas', 'borealis', 'comet', 'delta'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function roundCents(x) {
  return Math.round(x * 100) / 100;
}

/** ['YYYY-MM', ...] from the month of dateFrom to the month of dateTo. */
function monthsOfRange(dateFrom, dateTo) {
  let y = Number(String(dateFrom).slice(0, 4));
  let m = Number(String(dateFrom).slice(5, 7));
  const ey = Number(String(dateTo).slice(0, 4));
  const em = Number(String(dateTo).slice(5, 7));
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function lastDayOfMonth(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return month + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
}

const NO_ISSUE = '_';

/** Tempo v3 worklog -> issue key; defensive over the two shapes seen in the wild. */
function worklogIssueKey(w) {
  const k = (w && w.issue && typeof w.issue.key === 'string' && w.issue.key) || (w && typeof w.issueKey === 'string' && w.issueKey) || '';
  return k.trim().toUpperCase() || NO_ISSUE;
}

/** worklogs -> { authors: [{ key, displayName, months, issues: { month: { ISSUE: seconds } }, days: { 'YYYY-MM-DD': { ISSUE: seconds } } }], counts, skipped } */
function aggregateWorklogs(worklogs) {
  const byKey = new Map();
  const counts = {};
  let skipped = 0;
  for (const w of worklogs || []) {
    const a = w && w.author;
    const name = a && typeof a.name === 'string' ? a.name.trim().toLowerCase() : '';
    const display = a && typeof a.displayName === 'string' ? a.displayName.trim() : '';
    const key = name || display.toLowerCase();
    const secs = Number(w && w.timeSpentSeconds);
    const started = w && typeof w.dateStarted === 'string' ? w.dateStarted : '';
    const month = started.slice(0, 7);
    if (!key || !Number.isFinite(secs) || !MONTH_RE.test(month)) { skipped += 1; continue; }
    let rec = byKey.get(key);
    if (!rec) { rec = { key, displayName: display || key, months: {}, issues: {}, days: {} }; byKey.set(key, rec); }
    rec.months[month] = (rec.months[month] || 0) + secs;
    const ik = worklogIssueKey(w);
    if (!rec.issues[month]) rec.issues[month] = {};
    rec.issues[month][ik] = (rec.issues[month][ik] || 0) + secs;
    const day = started.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      if (!rec.days[day]) rec.days[day] = {};
      rec.days[day][ik] = (rec.days[day][ik] || 0) + secs;
    }
    counts[month] = (counts[month] || 0) + 1;
  }
  const authors = [...byKey.values()].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return { authors, counts, skipped };
}

/** One entry for EVERY month of the range (an empty month = fetched, not missing). */
function splitByMonth(aggregated, months) {
  const out = {};
  for (const month of months) {
    const authors = [];
    for (const a of aggregated.authors || []) {
      const seconds = a.months && a.months[month];
      if (seconds) {
        const row = { key: a.key, displayName: a.displayName, seconds };
        if (a.issues && a.issues[month]) row.issues = a.issues[month];
        if (a.days) {
          const days = {};
          for (const d of Object.keys(a.days).sort()) if (d.startsWith(month + '-')) days[d] = a.days[d];
          if (Object.keys(days).length) row.days = days;
        }
        authors.push(row);
      }
    }
    out[month] = { authors };
  }
  return out;
}

/**
 * One month shard cut to [from, to] (ISO days) at DAY granularity.
 * Returns { shard, clipped, noDaily }:
 *  - the range covers the whole month -> the shard unchanged;
 *  - the range cuts the month and the shard has daily data (schemaVersion 3) -> authors
 *    rebuilt from the days inside the range (seconds, issues), clipped = true;
 *  - the range cuts the month but the shard has no daily data (v1 / v2) -> the WHOLE
 *    month is kept and flagged noDaily (clipped = true), never silently wrong.
 */
function clipShard(shard, from, to) {
  if (!shard || typeof shard.month !== 'string') return { shard, clipped: false, noDaily: false };
  // the extent the shard actually holds (a partially fetched month ends at its dateTo)
  const full = lastDayOfMonth(shard.month);
  const mStart = typeof shard.dateFrom === 'string' && shard.dateFrom > shard.month + '-01' ? shard.dateFrom : shard.month + '-01';
  const mEnd = typeof shard.dateTo === 'string' && shard.dateTo < full ? shard.dateTo : full;
  if (from <= mStart && to >= mEnd) return { shard, clipped: false, noDaily: false };
  const authors = Array.isArray(shard.authors) ? shard.authors : [];
  const daily = shard.schemaVersion >= 3 && authors.every((a) => a && a.days && typeof a.days === 'object');
  if (!daily) return { shard, clipped: true, noDaily: authors.length > 0 };
  const out = [];
  for (const a of authors) {
    let seconds = 0;
    const issues = {};
    const days = {};
    for (const [d, per] of Object.entries(a.days)) {
      if (d < from || d > to) continue;
      days[d] = per;
      for (const [ik, secs] of Object.entries(per || {})) {
        if (!Number.isFinite(secs)) continue;
        seconds += secs;
        issues[ik] = (issues[ik] || 0) + secs;
      }
    }
    if (seconds > 0) out.push({ key: a.key, displayName: a.displayName, seconds, issues, days });
  }
  return { shard: { ...shard, authors: out }, clipped: true, noDaily: false };
}

/** Inverse of splitByMonth: shard payloads -> aggregated shape (order independent). */
function mergeShards(shards) {
  const byKey = new Map();
  for (const sh of shards || []) {
    if (!sh || !Array.isArray(sh.authors)) continue;
    for (const a of sh.authors) {
      let rec = byKey.get(a.key);
      if (!rec) { rec = { key: a.key, displayName: a.displayName, months: {} }; byKey.set(a.key, rec); }
      rec.months[sh.month] = (rec.months[sh.month] || 0) + a.seconds;
    }
  }
  const authors = [...byKey.values()].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return { authors };
}

/**
 * New index from the previous one: entries of months NOT in newEntries are kept
 * untouched, the new ones replace their months, sorted by month.
 * meta: { now, projects?, seen?: [{ key, displayName, months: [..] }], unmatchedByEmail? }
 */
function buildIndex(prevIndex, newEntries, meta) {
  const fresh = new Map((newEntries || []).map((e) => [e.month, e]));
  const kept = ((prevIndex && prevIndex.months) || []).filter((e) => !fresh.has(e.month));
  const months = [...kept, ...fresh.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const seen = new Map();
  for (const s of (prevIndex && prevIndex.authorsSeen) || []) seen.set(s.key, { ...s });
  for (const s of (meta && meta.seen) || []) {
    const ms = [...(s.months || [])].sort();
    if (!ms.length) continue;
    const prev = seen.get(s.key);
    seen.set(s.key, {
      key: s.key,
      displayName: s.displayName,
      firstMonth: prev && prev.firstMonth < ms[0] ? prev.firstMonth : ms[0],
      lastMonth: prev && prev.lastMonth > ms[ms.length - 1] ? prev.lastMonth : ms[ms.length - 1],
    });
  }
  const from = months.map((e) => e.dateFrom).sort()[0] || null;
  const to = months.map((e) => e.dateTo).sort().slice(-1)[0] || null;
  return {
    schemaVersion: 1,
    generatedAt: meta && meta.now,
    dateFrom: from,
    dateTo: to,
    projects: (meta && meta.projects) || (prevIndex && prevIndex.projects) || [],
    months,
    authorsSeen: [...seen.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    unmatchedByEmail: (meta && meta.unmatchedByEmail) || (prevIndex && prevIndex.unmatchedByEmail) || [],
  };
}

function _emptyAgg() {
  return { cost: 0, hours: 0, personsNoRate: 0, hoursNoRate: 0, persons: 0 };
}

function _summarize(persons) {
  const s = _emptyAgg();
  for (const p of persons) {
    s.persons += 1;
    s.hours += p.total.hours;
    if (p.rateMissing) { s.personsNoRate += 1; s.hoursNoRate += p.total.hours; } else s.cost += p.total.cost;
  }
  s.cost = roundCents(s.cost);
  return s;
}

/** Roster + every config member outside it (external people, included or not,
 * so an unticked namesake still claims its own hours). */
function _authorIndex(config, roster) {
  const rosterIds = new Set((roster || []).map((r) => r.id));
  const outside = ((config && config.members) || []).filter((c) => c && !rosterIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, email: c.email }));
  return buildAuthorIndex(
    (roster || []).map((r) => ({ id: r.id, name: memberName(r), email: r.email })),
    outside,
  );
}

/**
 * aggregated: mergeShards() of the year; config: { members }; rates: { rates };
 * roster: team_members[]; months: ['YYYY-MM', ...] shown.
 */
function buildCosts({ aggregated, config, rates, roster, months }) {
  const rosterById = new Map((roster || []).map((m) => [m.id, m]));
  const rateById = new Map(((rates && rates.rates) || []).map((r) => [r.id, r.daily_rate]));
  const included = ((config && config.members) || []).filter((m) => m && m.included);
  const includedIds = new Set(included.map((c) => c.id));
  const idx = _authorIndex(config, roster);

  const persons = new Map();
  for (const c of included) {
    const r = rosterById.get(c.id);
    const rate = rateById.has(c.id) ? rateById.get(c.id) : null;
    const ms = {};
    for (const mo of months) ms[mo] = { seconds: 0 };
    persons.set(c.id, {
      id: c.id,
      name: r ? memberName(r) : c.name || c.id,
      role: r ? r.role || '' : '',
      team: r ? r.team || '' : '',
      outsideRoster: !r,
      external: !!c.external,
      areas: Array.isArray(c.areas) ? c.areas.filter((a) => AREAS.includes(a)) : [],
      included: true,
      rate: rate === undefined ? null : rate,
      rateMissing: rate === null || rate === undefined,
      endDate: typeof c.endDate === 'string' ? c.endDate : null,
      company: typeof c.company === 'string' ? c.company : '',
      _ms: ms,
    });
  }

  const unassigned = [];
  for (const a of (aggregated && aggregated.authors) || []) {
    let secs = 0;
    for (const mo of months) secs += a.months[mo] || 0;
    if (!secs) continue;
    const res = matchAuthor(a, idx);
    if (res.member) {
      const p = includedIds.has(res.member.id) ? persons.get(res.member.id) : null;
      if (!p) continue; // a roster member who is not "in costs": not a cost row, not unassigned
      for (const mo of months) p._ms[mo].seconds += a.months[mo] || 0;
    } else {
      unassigned.push({ key: a.key, displayName: a.displayName, hours: secs / 3600, reason: res.reason, candidates: res.candidates });
    }
  }

  const list = [];
  for (const p of persons.values()) {
    const out = { ...p, months: {} };
    delete out._ms;
    let totalHours = 0;
    for (const mo of months) {
      const hours = p._ms[mo].seconds / 3600;
      const days = hours / 8;
      totalHours += hours;
      out.months[mo] = { hours, days, cost: p.rateMissing ? null : roundCents(days * p.rate) };
    }
    const totalDays = totalHours / 8;
    out.total = { hours: totalHours, days: totalDays, cost: p.rateMissing ? null : roundCents(totalDays * p.rate) };
    list.push(out);
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  unassigned.sort((a, b) => b.hours - a.hours);

  const byArea = {};
  for (const area of AREAS) byArea[area] = _summarize(list.filter((p) => p.areas.includes(area)));
  return { persons: list, unassigned, summary: { byArea, all: _summarize(list) } };
}

// -- epic tree ---------------------------------------------------------------

function _cell() {
  return { hours: 0, cost: 0, noRateHours: 0 };
}

function _addCell(cell, hours, cost) {
  cell.hours += hours;
  if (cost === null) cell.noRateHours += hours; else cell.cost += cost;
}

function _finishCell(c) {
  return { hours: c.hours, days: c.hours / 8, cost: roundCents(c.cost), noRateHours: c.noRateHours };
}

function _node(months) {
  const ms = {};
  for (const mo of months) ms[mo] = _cell();
  return { months: ms, total: _cell() };
}

function _bump(node, mo, hours, cost) {
  _addCell(node.months[mo], hours, cost);
  _addCell(node.total, hours, cost);
}

function _finishNode(node, months) {
  const ms = {};
  for (const mo of months) ms[mo] = _finishCell(node.months[mo]);
  return { months: ms, total: _finishCell(node.total) };
}

function _byCostDesc(a, b) {
  return (b.total.cost - a.total.cost) || (b.total.hours - a.total.hours) || String(a.name || a.key).localeCompare(String(b.name || b.key), 'en');
}

/**
 * Epic -> issue -> person tree of one area from month shards (schemaVersion 2).
 * Cost per (person, issue, month) = seconds / 3600 / 8 * rate; a person with no
 * rate adds hours but no cost (noRateHours), so a cell shows the PRICED sum and
 * the client marks it. Months whose shard has no issue split are `legacyMonths`.
 * shards: [{ month, schemaVersion, authors: [{ key, displayName, seconds, issues }], issues: details }]
 */
function buildEpicTree({ shards, config, rates, roster, months, area }) {
  const rosterById = new Map((roster || []).map((m) => [m.id, m]));
  const rateById = new Map(((rates && rates.rates) || []).map((r) => [r.id, r.daily_rate]));
  const inArea = new Map();
  for (const c of ((config && config.members) || [])) {
    if (!c || !c.included || !Array.isArray(c.areas) || !c.areas.includes(area)) continue;
    const r = rosterById.get(c.id);
    const rate = rateById.has(c.id) ? rateById.get(c.id) : null;
    inArea.set(c.id, { id: c.id, name: r ? memberName(r) : c.name || c.id, rate: typeof rate === 'number' ? rate : null });
  }
  const idx = _authorIndex(config, roster);
  const wanted = new Set(months);
  const legacyMonths = [];
  const epics = new Map();
  const all = _node(months);

  for (const sh of shards || []) {
    if (!sh || !wanted.has(sh.month) || !Array.isArray(sh.authors) || sh.authors.length === 0) continue;
    const hasSplit = sh.authors.some((a) => a && a.issues && typeof a.issues === 'object');
    if (!(sh.schemaVersion >= 2) || !hasSplit) { legacyMonths.push(sh.month); continue; }
    const details = sh.issues && typeof sh.issues === 'object' ? sh.issues : {};
    for (const a of sh.authors) {
      if (!a || !a.issues || typeof a.issues !== 'object') continue;
      const res = matchAuthor(a, idx);
      const person = res.member ? inArea.get(res.member.id) : null;
      if (!person) continue;
      for (const [ikey, secs] of Object.entries(a.issues)) {
        if (!Number.isFinite(secs) || secs <= 0) continue;
        const hours = secs / 3600;
        const cost = person.rate === null ? null : (hours / 8) * person.rate;
        const d = details[ikey] || {};
        const ek = typeof d.epicKey === 'string' ? d.epicKey : '';
        let ep = epics.get(ek);
        if (!ep) { ep = { key: ek, name: ek ? (d.epicName || ek) : 'No epic', node: _node(months), issues: new Map() }; epics.set(ek, ep); }
        else if (ek && d.epicName && ep.name === ek) ep.name = d.epicName;
        let is = ep.issues.get(ikey);
        if (!is) { is = { key: ikey, summary: d.summary || '', type: d.type || '', node: _node(months), persons: new Map() }; ep.issues.set(ikey, is); }
        else if (!is.summary && d.summary) is.summary = d.summary;
        let pe = is.persons.get(person.id);
        if (!pe) { pe = { id: person.id, name: person.name, rateMissing: person.rate === null, node: _node(months) }; is.persons.set(person.id, pe); }
        for (const n of [pe.node, is.node, ep.node, all]) _bump(n, sh.month, hours, cost);
      }
    }
  }

  const outEpics = [...epics.values()].map((ep) => ({
    key: ep.key,
    name: ep.name,
    ..._finishNode(ep.node, months),
    issues: [...ep.issues.values()].map((is) => ({
      key: is.key,
      summary: is.summary,
      type: is.type,
      ..._finishNode(is.node, months),
      persons: [...is.persons.values()].map((pe) => ({ id: pe.id, name: pe.name, rateMissing: pe.rateMissing, ..._finishNode(pe.node, months) })).sort(_byCostDesc),
    })).sort(_byCostDesc),
  })).sort(_byCostDesc);
  return { area, months, epics: outEpics, totals: _finishNode(all, months), legacyMonths: legacyMonths.sort() };
}

module.exports = {
  AREAS, MONTH_RE, roundCents, monthsOfRange, lastDayOfMonth,
  aggregateWorklogs, splitByMonth, clipShard, mergeShards, buildIndex, buildCosts,
  NO_ISSUE, worklogIssueKey, buildEpicTree,
};
