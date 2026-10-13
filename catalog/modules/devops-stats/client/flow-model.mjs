// modules/devops-stats/client/flow-model.mjs
// Pure Kanban flow metrics over the fact records in jira/devops/. No document, no
// state, no fetch; every function that depends on the clock takes `now`
// (ms since epoch) explicitly. Status categories come from the index status
// table (`categoryById`), never from a status name. Definitions are pinned
// by tests/test_flow_model.mjs and described in README.md.

export const DAY_MS = 86400000;
export const WEEKS_RANGE = 12;
export const MONTHS_RANGE = 6;
export const AGING_LIMIT = 15;

const BLOCKED_NAME_RE = /block|hold|imped|paused|waiting for/i;
const CANCELLED_NAME_RE = /cancel|reject|won.?t|abandon|discard/i;

function _ts(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** @param {Array<{id:string,category:string|null}>} statuses */
export function categoryMap(statuses) {
  const map = new Map();
  for (const s of statuses || []) map.set(String(s.id), s.category || null);
  return map;
}

/** Keys of epics: is_epic facts plus any key some non-subtask fact points at. */
export function epicKeySet(facts) {
  const set = new Set();
  for (const f of facts || []) {
    if (f.is_epic) set.add(f.key);
    if (!f.subtask && f.epic_key) set.add(f.epic_key);
  }
  return set;
}

/** Counts for WIP / throughput / lead / cycle: no epics, no sub-tasks. */
export function countableFacts(facts) {
  const epics = epicKeySet(facts);
  return (facts || []).filter((f) => !f.subtask && !f.is_epic && !epics.has(f.key));
}

// -- Buckets -----------------------------------------------------------------

function _isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _bucketStart(granularity, ts) {
  const d = new Date(ts);
  if (granularity === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

/** Stable key of the bucket containing `ts` (local time). */
export function bucketKey(granularity, ts) {
  const start = _bucketStart(granularity, ts);
  const pad = (n) => String(n).padStart(2, '0');
  return start.getFullYear() + '-' + pad(start.getMonth() + 1) + (granularity === 'month' ? '' : '-' + pad(start.getDate()));
}

/**
 * The last `count` buckets ending with the one that holds `now`, oldest first.
 * @returns {Array<{key:string,label:string,start:number,end:number,current:boolean}>}
 */
export function bucketsFor(granularity, now, count) {
  const n = count || (granularity === 'month' ? MONTHS_RANGE : WEEKS_RANGE);
  const first = _bucketStart(granularity, now);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = granularity === 'month'
      ? new Date(first.getFullYear(), first.getMonth() - i, 1)
      : new Date(first.getFullYear(), first.getMonth(), first.getDate() - 7 * i);
    const e = granularity === 'month'
      ? new Date(s.getFullYear(), s.getMonth() + 1, 1)
      : new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
    const label = granularity === 'month'
      ? MONTH_SHORT[s.getMonth()] + ' ' + s.getFullYear()
      : 'W' + _isoWeek(s);
    out.push({
      key: bucketKey(granularity, s.getTime()), label,
      start: s.getTime(), end: e.getTime(), current: i === 0,
    });
  }
  return out;
}

// -- Statistics --------------------------------------------------------------

/** Classic median; null for an empty list. */
export function median(values) {
  const v = (values || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Nearest-rank percentile (p in 0..1); null for an empty list. */
export function percentile(values, p) {
  const v = (values || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.max(0, Math.ceil(p * v.length) - 1)];
}

/** Per-bucket { median, p85, n } from per-bucket value lists. */
export function timeSeriesStats(perBucket) {
  return (perBucket || []).map((vals) => ({
    median: median(vals), p85: percentile(vals, 0.85), n: vals.length,
  }));
}

function _round1(x) { return x === null ? null : Math.round(x * 10) / 10; }

// -- WIP / throughput --------------------------------------------------------

/** Category of the status interval covering instant t (null when none). */
export function categoryAt(fact, t, categoryById) {
  for (const iv of fact.intervals || []) {
    const from = _ts(iv.from);
    const to = iv.to ? _ts(iv.to) : Infinity;
    if (from !== null && from <= t && t < to) {
      const c = categoryById.get(String(iv.s));
      return c === undefined ? null : c;
    }
  }
  return null;
}

export function wipAt(facts, t, categoryById) {
  let n = 0;
  for (const f of countableFacts(facts)) if (categoryAt(f, t, categoryById) === 'indeterminate') n++;
  return n;
}

/** The facts in progress right now (current status in the indeterminate category); wipAt counts the same set. */
export function wipNowFacts(facts, categoryById) {
  return countableFacts(facts).filter((f) => {
    const last = (f.intervals || []).find((iv) => !iv.to);
    return !!last && categoryById.get(String(last.s)) === 'indeterminate';
  });
}

/** WIP at the end of each bucket (at `now` for the current one). */
export function wipSeries(facts, buckets, now, categoryById) {
  const countable = countableFacts(facts);
  return buckets.map((b) => {
    const t = b.current ? now : b.end - 1;
    let n = 0;
    for (const f of countable) if (categoryAt(f, t, categoryById) === 'indeterminate') n++;
    return n;
  });
}

/**
 * Done without ever entering an in-progress status: a backlog clean-up (a plan
 * closed as obsolete, a duplicate), not a delivery. Such an issue is left out of
 * throughput, lead and cycle time and counted on its own (closedWithoutWork*):
 * otherwise one clean-up of month-old tickets reads as a lead-time spike.
 */
export function isClosedWithoutWork(fact) {
  return _ts(fact.done_at) !== null && _ts(fact.started_at) === null;
}

/**
 * Ended in a status the team marked as cancelled ("Set statuses"): a normal
 * outcome of the process, neither a delivery nor a clean-up - left out of
 * throughput, lead and cycle time and of "Closed without work".
 */
export function isCancelled(fact, cancelledIds) {
  if (!cancelledIds || !cancelledIds.length || _ts(fact.done_at) === null) return false;
  return cancelledIds.map(String).includes(String(fact.status_id));
}

/** Countable facts that can be a delivery or a clean-up: everything but cancelled. */
function _deliveryFacts(facts, cancelledIds) {
  return countableFacts(facts).filter((f) => !isCancelled(f, cancelledIds));
}

function _bucketIndex(buckets, t) {
  return buckets.findIndex((b) => t >= b.start && t < b.end);
}

/** Issues delivered (done after real work) per bucket of done_at. */
export function throughputSeries(facts, buckets, cancelledIds) {
  const counts = buckets.map(() => 0);
  for (const f of _deliveryFacts(facts, cancelledIds)) {
    if (isClosedWithoutWork(f)) continue;
    const d = _ts(f.done_at);
    if (d === null) continue;
    const i = _bucketIndex(buckets, d);
    if (i >= 0) counts[i]++;
  }
  return counts;
}

/** Issues closed without work per bucket of done_at. */
export function closedWithoutWorkSeries(facts, buckets, cancelledIds) {
  const counts = buckets.map(() => 0);
  for (const f of _deliveryFacts(facts, cancelledIds)) {
    if (!isClosedWithoutWork(f)) continue;
    const i = _bucketIndex(buckets, _ts(f.done_at));
    if (i >= 0) counts[i]++;
  }
  return counts;
}

/** Issues closed without work inside the visible buckets, newest close first. */
export function closedWithoutWorkRows(facts, buckets, cancelledIds) {
  if (!buckets.length) return [];
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  const rows = [];
  for (const f of _deliveryFacts(facts, cancelledIds)) {
    if (!isClosedWithoutWork(f)) continue;
    const d = _ts(f.done_at);
    if (d < from || d >= to) continue;
    const c = _ts(f.created);
    rows.push({
      key: f.key, summary: f.summary, status_id: String(f.status_id), assignee: f.assignee || null,
      created: c, doneAt: d,
      daysOpen: c === null ? null : _round1(Math.max(0, d - c) / DAY_MS),
    });
  }
  rows.sort((a, b) => (b.doneAt - a.doneAt) || a.key.localeCompare(b.key));
  return rows;
}

/**
 * Cancelled after work had begun (it entered "w toku" or carries logged time):
 * the cost of planning work that was then dropped. Left out of every flow
 * metric like any cancellation, listed on its own with the logged hours.
 * @returns {Array<{key,summary,status_id,assignee,created,startedAt,cancelledAt,daysInWork,loggedSeconds,loggedKnown}>}
 */
export function cancelledAfterWorkRows(facts, buckets, cancelledIds) {
  if (!buckets.length || !cancelledIds || !cancelledIds.length) return [];
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  const rows = [];
  for (const f of countableFacts(facts)) {
    if (!isCancelled(f, cancelledIds)) continue;
    const d = _ts(f.done_at);
    if (d < from || d >= to) continue;
    const s = _ts(f.started_at);
    const spent = typeof f.time_spent_s === 'number' && f.time_spent_s > 0 ? f.time_spent_s : 0;
    if (s === null && spent === 0) continue;
    rows.push({
      key: f.key, summary: f.summary, status_id: String(f.status_id), assignee: f.assignee || null,
      created: _ts(f.created), startedAt: s, cancelledAt: d,
      daysInWork: s === null ? null : _round1(Math.max(0, d - s) / DAY_MS),
      loggedSeconds: spent,
      loggedKnown: Object.prototype.hasOwnProperty.call(f, 'time_spent_s'),
    });
  }
  rows.sort((a, b) => (b.loggedSeconds - a.loggedSeconds) || ((b.daysInWork || 0) - (a.daysInWork || 0)) || a.key.localeCompare(b.key));
  return rows;
}

/**
 * Totals of cancelledAfterWorkRows. A fact stored before the logged-time field
 * existed has no time_spent_s: it is counted in `unknownTime`, and loggedSeconds
 * is null when NO row knows its time ("unknown", not "zero"). Exact seconds are
 * summed - rounding happens only in fmtLogged, never before the sum.
 */
export function cancelledAfterWorkTotals(facts, buckets, cancelledIds) {
  const rows = cancelledAfterWorkRows(facts, buckets, cancelledIds);
  const knownRows = rows.filter((r) => r.loggedKnown);
  return {
    count: rows.length,
    loggedSeconds: rows.length && !knownRows.length ? null : knownRows.reduce((a, r) => a + r.loggedSeconds, 0),
    unknownTime: rows.length - knownRows.length,
    daysInWork: _round1(rows.reduce((a, r) => a + (r.daysInWork || 0), 0)),
  };
}

function _durations(facts, buckets, startOf, cancelledIds) {
  const perBucket = buckets.map(() => []);
  let skipped = 0;
  for (const f of _deliveryFacts(facts, cancelledIds)) {
    const d = _ts(f.done_at);
    if (d === null) continue;
    const i = _bucketIndex(buckets, d);
    if (i < 0) continue;
    const s = isClosedWithoutWork(f) ? null : startOf(f);
    if (s === null) { skipped++; continue; }
    perBucket[i].push(Math.max(0, d - s) / DAY_MS);
  }
  return { perBucket, skipped };
}

/** Lead time (created -> done) in days per bucket of done_at; closed-without-work issues are `skipped`. */
export function leadTimes(facts, buckets, cancelledIds) {
  return _durations(facts, buckets, (f) => _ts(f.created), cancelledIds);
}

/** Cycle time (started -> done); issues that never started are counted in `skipped`. */
export function cycleTimes(facts, buckets, cancelledIds) {
  return _durations(facts, buckets, (f) => _ts(f.started_at), cancelledIds);
}

// -- Blocked time ------------------------------------------------------------

function _union(ranges) {
  const sorted = ranges.filter((r) => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curS = null;
  let curE = null;
  for (const [s, e] of sorted) {
    if (curE === null || s > curE) {
      if (curE !== null) total += curE - curS;
      curS = s; curE = e;
    } else if (e > curE) curE = e;
  }
  if (curE !== null) total += curE - curS;
  return total;
}

// Blocked = time in a status the team marked as blocked ("Set statuses"),
// nothing else. Jira's Flagged field is deliberately NOT counted (team
// decision 2026-10-10): flags outlive the problem - a ticket flagged in 2025
// and moved back to the backlog stayed "blocked" for 505 days. The ETL keeps
// fact.flagged on disk; the view ignores it.
function _blockedRanges(fact, blockedIds, now) {
  const blocked = new Set((blockedIds || []).map(String));
  const ranges = [];
  for (const iv of fact.intervals || []) {
    if (!blocked.has(String(iv.s))) continue;
    const from = _ts(iv.from);
    if (from === null) continue;
    ranges.push([from, Math.min(iv.to ? _ts(iv.to) : now, now)]);
  }
  return ranges;
}

/**
 * Days blocked: union of blocked-status intervals, clamped to now; optional [winFrom, winTo] clips it (cycle-time share).
 */
export function blockedDays(fact, blockedIds, now, win) {
  let ranges = _blockedRanges(fact, blockedIds, now);
  if (win) ranges = ranges.map(([s, e]) => [Math.max(s, win[0]), Math.min(e, win[1])]);
  return _union(ranges) / DAY_MS;
}

/** Is the fact blocked right now: is its current status a blocked one? */
export function isBlockedNow(fact, blockedIds) {
  const blocked = new Set((blockedIds || []).map(String));
  const last = (fact.intervals || []).find((iv) => !iv.to);
  return !!last && blocked.has(String(last.s));
}

/** Ids of non-done statuses whose name looks like a blocked/on-hold state. A proposal only. */
export function proposeBlockedStatuses(statuses) {
  return (statuses || [])
    .filter((s) => s.category !== 'done' && BLOCKED_NAME_RE.test(String(s.name || '')))
    .map((s) => String(s.id));
}

/** Ids of done statuses whose name looks like a cancellation. A default until the team saves its own list. */
export function proposeCancelledStatuses(statuses) {
  return (statuses || [])
    .filter((s) => s.category === 'done' && CANCELLED_NAME_RE.test(String(s.name || '')))
    .map((s) => String(s.id));
}

/** Share of cycle time spent blocked for issues done in the buckets (0..1, null when no cycle time). */
export function blockedShare(facts, buckets, blockedIds, now, cancelledIds) {
  if (!buckets.length) return null;
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;
  let cycle = 0;
  let blocked = 0;
  for (const f of _deliveryFacts(facts, cancelledIds)) {
    const d = _ts(f.done_at);
    const s = _ts(f.started_at);
    if (d === null || s === null || d < from || d >= to) continue;
    cycle += Math.max(0, d - s);
    blocked += blockedDays(f, blockedIds, now, [s, d]) * DAY_MS;
  }
  return cycle > 0 ? blocked / cycle : null;
}

// -- Tables ------------------------------------------------------------------

/** Rows of the "Epiki" table, open epics first, then newest done. */
export function epicRows(facts, categoryById, now) {
  const epics = epicKeySet(facts);
  const children = new Map();
  for (const f of facts || []) {
    if (f.subtask || f.is_epic || epics.has(f.key) || !f.epic_key) continue;
    if (!children.has(f.epic_key)) children.set(f.epic_key, []);
    children.get(f.epic_key).push(f);
  }
  const rows = [];
  for (const e of facts || []) {
    if (!(e.is_epic || epics.has(e.key))) continue;
    const kids = children.get(e.key) || [];
    const doneAt = _ts(e.done_at);
    const created = _ts(e.created);
    const starts = [_ts(e.started_at), ...kids.map((k) => _ts(k.started_at))].filter((x) => x !== null);
    const start = starts.length ? Math.min(...starts) : created;
    const end = doneAt === null ? now : doneAt;
    const doneKids = kids.filter((k) => _ts(k.done_at) !== null).length;
    rows.push({
      key: e.key, summary: e.summary, done: doneAt !== null,
      start, doneAt,
      daysFromStart: start === null ? null : _round1(Math.max(0, end - start) / DAY_MS),
      daysFromCreated: created === null ? null : _round1(Math.max(0, end - created) / DAY_MS),
      progress: { done: doneKids, total: kids.length },
    });
  }
  rows.sort((a, b) => (a.done - b.done) || ((b.doneAt || 0) - (a.doneAt || 0)) || a.key.localeCompare(b.key));
  return rows;
}

/** Oldest in-progress issues: days since start, days in current status, blocked days. */
export function agingRows(facts, categoryById, blockedIds, now, limit) {
  const rows = [];
  for (const f of countableFacts(facts)) {
    const last = (f.intervals || []).find((iv) => !iv.to);
    if (!last || categoryById.get(String(last.s)) !== 'indeterminate') continue;
    const started = _ts(f.started_at);
    const inStatusFrom = _ts(last.from);
    if (started === null) continue;
    rows.push({
      key: f.key, summary: f.summary, status_id: String(last.s), assignee: f.assignee || null,
      daysInProgress: _round1(Math.max(0, now - started) / DAY_MS),
      daysInStatus: inStatusFrom === null ? null : _round1(Math.max(0, now - inStatusFrom) / DAY_MS),
      blockedDays: _round1(blockedDays(f, blockedIds, now)),
    });
  }
  rows.sort((a, b) => (b.daysInProgress - a.daysInProgress) || a.key.localeCompare(b.key));
  return rows.slice(0, limit || AGING_LIMIT);
}

/** Open issues blocked right now, most blocked first. */
export function blockedNowRows(facts, categoryById, blockedIds, now) {
  const rows = [];
  for (const f of countableFacts(facts)) {
    const last = (f.intervals || []).find((iv) => !iv.to);
    if (!last || categoryById.get(String(last.s)) === 'done') continue;
    if (!isBlockedNow(f, blockedIds)) continue;
    rows.push({
      key: f.key, summary: f.summary, status_id: String(last.s), assignee: f.assignee || null,
      blockedDays: _round1(blockedDays(f, blockedIds, now)),
    });
  }
  rows.sort((a, b) => (b.blockedDays - a.blockedDays) || a.key.localeCompare(b.key));
  return rows;
}

/**
 * Five tiles of the top row, computed over the visible buckets.
 * @returns {{wipNow:number, throughputAvg:number, leadMedian:number|null,
 *   cycleMedian:number|null, blockedNow:number, cycleSkipped:number,
 *   leadSkipped:number, closedWithoutWork:number,
 *   cancelledAfterWork:{count:number, loggedSeconds:number|null, unknownTime:number, daysInWork:number}}}
 */
export function summaryTiles(facts, buckets, categoryById, blockedIds, now, cancelledIds) {
  const lead = leadTimes(facts, buckets, cancelledIds);
  const cycle = cycleTimes(facts, buckets, cancelledIds);
  const thr = throughputSeries(facts, buckets, cancelledIds);
  const total = thr.reduce((a, b) => a + b, 0);
  return {
    wipNow: wipAt(facts, now, categoryById),
    throughputAvg: buckets.length ? _round1(total / buckets.length) : 0,
    leadMedian: _round1(median(lead.perBucket.flat())),
    cycleMedian: _round1(median(cycle.perBucket.flat())),
    blockedNow: blockedNowRows(facts, categoryById, blockedIds, now).length,
    cycleSkipped: cycle.skipped,
    leadSkipped: lead.skipped,
    closedWithoutWork: closedWithoutWorkSeries(facts, buckets, cancelledIds).reduce((a, b) => a + b, 0),
    cancelledAfterWork: cancelledAfterWorkTotals(facts, buckets, cancelledIds),
  };
}

// -- Per person ---------------------------------------------------------------

/**
 * Flow stats of a selection of people, per bucket. `isMine(jiraName)` says
 * whether a Jira display name belongs to the selection. Tasks follow their
 * CURRENT assignee (Jira keeps no per-period assignee here); logged time
 * follows the AUTHOR of each worklog and the bucket it started in - over every
 * fact, epics and sub-tasks included. Delivery uses the team definition:
 * cancelled and closed-without-work are not delivered (and not shown here).
 * loggedKnown is false when no stored fact carries worklogs yet - "unknown",
 * never "0 min".
 * @returns {{wipNow:number, loggedKnown:boolean,
 *   perBucket: Array<{delivered:number, leadMedian:number|null, cycleMedian:number|null, loggedSeconds:number}>}}
 */
export function personPeriodStats(facts, buckets, categoryById, cancelledIds, isMine) {
  const all = facts || [];
  const acc = buckets.map(() => ({ delivered: 0, lead: [], cycle: [], loggedSeconds: 0 }));
  let wipNow = 0;
  for (const f of countableFacts(all)) {
    if (!f.assignee || !isMine(f.assignee)) continue;
    const last = (f.intervals || []).find((iv) => !iv.to);
    if (last && categoryById.get(String(last.s)) === 'indeterminate') wipNow++;
    if (isCancelled(f, cancelledIds) || isClosedWithoutWork(f)) continue;
    const d = _ts(f.done_at);
    if (d === null) continue;
    const i = _bucketIndex(buckets, d);
    if (i < 0) continue;
    acc[i].delivered++;
    const c = _ts(f.created);
    const st = _ts(f.started_at);
    if (c !== null) acc[i].lead.push(Math.max(0, d - c) / DAY_MS);
    if (st !== null) acc[i].cycle.push(Math.max(0, d - st) / DAY_MS);
  }
  let loggedKnown = false;
  for (const f of all) {
    if (!Array.isArray(f.worklogs)) continue;
    loggedKnown = true;
    for (const w of f.worklogs) {
      if (!w.author || !isMine(w.author)) continue;
      const t = _ts(w.started);
      const i = t === null ? -1 : _bucketIndex(buckets, t);
      if (i >= 0) acc[i].loggedSeconds += w.seconds;
    }
  }
  return {
    wipNow,
    loggedKnown,
    perBucket: acc.map((a) => ({
      delivered: a.delivered,
      leadMedian: _round1(median(a.lead)),
      cycleMedian: _round1(median(a.cycle)),
      loggedSeconds: a.loggedSeconds,
    })),
  };
}

/** Logged work as Jira shows it: "45 min", "3 h 30 min", "12 h"; "-" for null, "0 min" for 0. */
export function fmtLogged(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return m + ' min';
  return m ? h + ' h ' + m + ' min' : h + ' h';
}

/** "3.5" style days, "-" for null. */
export function fmtDays(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '-';
  return (Math.round(x * 10) / 10).toString();
}
