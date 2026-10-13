// Pure metric math of client/flow-model.mjs. `now` is always passed in.
import test from 'node:test';
import assert from 'node:assert';
import * as FM from '../client/flow-model.mjs';

const STATUSES = [
  { id: '1', name: 'Open', category: 'new' },
  { id: '2', name: 'Working', category: 'indeterminate' },
  { id: '3', name: 'Waiting', category: 'indeterminate' },
  { id: '4', name: 'Closed', category: 'done' },
];
const CAT = FM.categoryMap(STATUSES);
const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime(); // Wed 14 Oct 2026, local
const iso = (y, m, d, h = 0) => new Date(y, m - 1, d, h).toISOString();

function fact(key, o = {}) {
  return Object.assign({
    key, summary: key, type_id: '10', subtask: false, is_epic: false, epic_key: null,
    created: iso(2026, 10, 1), started_at: null, done_at: null, status_id: '1',
    assignee: null, intervals: [{ s: '1', from: iso(2026, 10, 1), to: null }], flagged: [],
  }, o);
}

test('median: odd, even, empty', () => {
  assert.strictEqual(FM.median([3, 1, 2]), 2);
  assert.strictEqual(FM.median([4, 1, 2, 3]), 2.5);
  assert.strictEqual(FM.median([]), null);
});

test('percentile 0.85 is nearest-rank', () => {
  assert.strictEqual(FM.percentile([5], 0.85), 5);
  assert.strictEqual(FM.percentile([1, 2, 3, 4, 5, 6, 7], 0.85), 6); // ceil(5.95) = 6th value
  assert.strictEqual(FM.percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.85), 17);
  assert.strictEqual(FM.percentile([], 0.85), null);
});

test('wipAt follows intervals including an open last one', () => {
  const f = fact('D-1', {
    intervals: [
      { s: '1', from: iso(2026, 10, 1), to: iso(2026, 10, 5) },
      { s: '2', from: iso(2026, 10, 5), to: null },
    ],
  });
  assert.strictEqual(FM.wipAt([f], new Date(2026, 9, 3).getTime(), CAT), 0);
  assert.strictEqual(FM.wipAt([f], NOW, CAT), 1);
});

test('wipSeries: week and month buckets with a fixed now', () => {
  const f = fact('D-1', { intervals: [{ s: '2', from: iso(2026, 10, 7), to: null }] });
  const weeks = FM.bucketsFor('week', NOW, 3);
  assert.strictEqual(weeks.length, 3);
  assert.ok(weeks[2].current && !weeks[0].current);
  assert.strictEqual(new Date(weeks[2].start).getDay(), 1);
  assert.deepStrictEqual(FM.wipSeries([f], weeks, NOW, CAT), [0, 1, 1]);
  const months = FM.bucketsFor('month', NOW, 2);
  assert.strictEqual(months[1].label, 'Oct 2026');
  assert.deepStrictEqual(FM.wipSeries([f], months, NOW, CAT), [0, 1]);
});

test('epics and sub-tasks never count; an epic referenced by a child is detected', () => {
  const epic = fact('D-9', { intervals: [{ s: '2', from: iso(2026, 10, 1), to: null }] });
  const child = fact('D-10', { epic_key: 'D-9', intervals: [{ s: '2', from: iso(2026, 10, 1), to: null }] });
  const sub = fact('D-11', { subtask: true, intervals: [{ s: '2', from: iso(2026, 10, 1), to: null }] });
  assert.strictEqual(FM.wipAt([epic, child, sub], NOW, CAT), 1);
});

test('throughput, lead and cycle time; skipped cycle is counted', () => {
  const b = FM.bucketsFor('week', NOW, 2);
  const a = fact('D-1', { created: iso(2026, 10, 1), started_at: iso(2026, 10, 5), done_at: iso(2026, 10, 13), status_id: '4' });
  const skipped = fact('D-2', { created: iso(2026, 10, 10), started_at: null, done_at: iso(2026, 10, 12), status_id: '4' });
  // D-2 never started: a clean-up, not a delivery - out of throughput and lead time.
  assert.deepStrictEqual(FM.throughputSeries([a, skipped], b), [0, 1]);
  const lead = FM.leadTimes([a, skipped], b);
  assert.deepStrictEqual(lead.perBucket[1], [12]);
  assert.strictEqual(lead.skipped, 1);
  const cycle = FM.cycleTimes([a, skipped], b);
  assert.deepStrictEqual(cycle.perBucket[1], [8]);
  assert.strictEqual(cycle.skipped, 1);
});

test('a reopened issue (done_at null) is not throughput', () => {
  const b = FM.bucketsFor('week', NOW, 2);
  const f = fact('D-1', { done_at: null });
  assert.deepStrictEqual(FM.throughputSeries([f], b), [0, 0]);
});

test('epicRows: start is the earliest child start, fallback created; progress', () => {
  const epic = fact('D-9', { is_epic: true, created: iso(2026, 9, 1), started_at: iso(2026, 9, 20), done_at: null });
  const k1 = fact('D-10', { epic_key: 'D-9', started_at: iso(2026, 9, 10), done_at: iso(2026, 10, 2), status_id: '4' });
  const k2 = fact('D-11', { epic_key: 'D-9' });
  const rows = FM.epicRows([epic, k1, k2], CAT, NOW);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].start, Date.parse(iso(2026, 9, 10)));
  assert.deepStrictEqual(rows[0].progress, { done: 1, total: 2 });
  const lone = FM.epicRows([fact('D-20', { is_epic: true, created: iso(2026, 9, 1) })], CAT, NOW);
  assert.strictEqual(lone[0].start, Date.parse(iso(2026, 9, 1)));
});

test('agingRows: ordered by age and cut at 15', () => {
  const facts = Array.from({ length: 20 }, (_, i) => fact('D-' + (100 + i), {
    started_at: iso(2026, 10, 1 + (i % 10)),
    intervals: [{ s: '2', from: iso(2026, 10, 1 + (i % 10)), to: null }],
  }));
  const rows = FM.agingRows(facts, CAT, [], NOW);
  assert.strictEqual(rows.length, 15);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].daysInProgress >= rows[i].daysInProgress);
});

test('blockedDays: only blocked-status time, Jira flags never count', () => {
  const f = fact('D-1', {
    intervals: [
      { s: '2', from: iso(2026, 10, 1), to: iso(2026, 10, 3) },
      { s: '3', from: iso(2026, 10, 3), to: iso(2026, 10, 6) },
      { s: '2', from: iso(2026, 10, 6), to: null },
    ],
    flagged: [{ from: iso(2026, 10, 5), to: iso(2026, 10, 8) }],
  });
  // blocked status 3 = days 3..6 -> 3 days; the flag (5..8) adds nothing
  assert.strictEqual(FM.blockedDays(f, ['3'], NOW), 3);
  assert.strictEqual(FM.blockedDays(f, [], NOW), 0);
});

test('isBlockedNow: only a blocked current status; an open flag does not block', () => {
  const f = fact('D-1', { intervals: [{ s: '3', from: iso(2026, 10, 3), to: null }] });
  assert.ok(FM.isBlockedNow(f, ['3']));
  assert.ok(!FM.isBlockedNow(f, []));
  // DEVOPS-51 case: status "Otwarte" with a flag left on since 2025.
  const flaggedOpen = fact('D-2', { intervals: [{ s: '1', from: iso(2026, 10, 1), to: null }], flagged: [{ from: iso(2025, 5, 23), to: null }] });
  assert.ok(!FM.isBlockedNow(flaggedOpen, ['3']));
  assert.strictEqual(FM.blockedNowRows([flaggedOpen], CAT, ['3'], NOW).length, 0);
});

test('proposeBlockedStatuses never returns a done status', () => {
  const ids = FM.proposeBlockedStatuses([
    { id: '1', name: 'Blocked', category: 'indeterminate' },
    { id: '2', name: 'Blocked (closed)', category: 'done' },
    { id: '3', name: 'On hold', category: 'new' },
    { id: '4', name: 'Working', category: 'indeterminate' },
  ]);
  assert.deepStrictEqual(ids, ['1', '3']);
});

test('closed without work: own series, rows and tile; never in throughput or lead', () => {
  const b = FM.bucketsFor('week', NOW, 2);
  const worked = fact('D-1', { created: iso(2026, 10, 1), started_at: iso(2026, 10, 5), done_at: iso(2026, 10, 13), status_id: '4' });
  const cleanup1 = fact('D-2', { created: iso(2026, 1, 13), started_at: null, done_at: iso(2026, 10, 12), status_id: '4' });
  const cleanup2 = fact('D-3', { created: iso(2026, 1, 13), started_at: null, done_at: iso(2026, 10, 13), status_id: '4' });
  const old = fact('D-4', { created: iso(2025, 1, 1), started_at: null, done_at: iso(2025, 2, 1), status_id: '4' });
  const open = fact('D-5', { started_at: null, done_at: null });
  const all = [worked, cleanup1, cleanup2, old, open];
  assert.strictEqual(FM.isClosedWithoutWork(cleanup1), true);
  assert.strictEqual(FM.isClosedWithoutWork(worked), false);
  assert.strictEqual(FM.isClosedWithoutWork(open), false);
  assert.deepStrictEqual(FM.closedWithoutWorkSeries(all, b), [0, 2]);
  assert.deepStrictEqual(FM.throughputSeries(all, b), [0, 1]);
  assert.deepStrictEqual(FM.leadTimes(all, b).perBucket[1], [12]);
  const rows = FM.closedWithoutWorkRows(all, b);
  assert.deepStrictEqual(rows.map((r) => r.key), ['D-3', 'D-2']);
  assert.ok(rows[0].daysOpen > 270);
  const tiles = FM.summaryTiles(all, b, CAT, [], NOW);
  assert.strictEqual(tiles.closedWithoutWork, 2);
  assert.strictEqual(tiles.leadSkipped, 2);
  assert.strictEqual(tiles.throughputAvg, 0.5);
});

test('cancelled: out of throughput, lead, cycle and closed-without-work; proposal from done names', () => {
  const b = FM.bucketsFor('week', NOW, 2);
  const worked = fact('D-1', { created: iso(2026, 10, 1), started_at: iso(2026, 10, 5), done_at: iso(2026, 10, 13), status_id: '4' });
  const cancelledWorked = fact('D-2', { created: iso(2026, 10, 1), started_at: iso(2026, 10, 5), done_at: iso(2026, 10, 12), status_id: '9' });
  const cancelledIdle = fact('D-3', { created: iso(2026, 1, 1), started_at: null, done_at: iso(2026, 10, 12), status_id: '9' });
  const closedIdle = fact('D-4', { created: iso(2026, 1, 1), started_at: null, done_at: iso(2026, 10, 12), status_id: '4' });
  const all = [worked, cancelledWorked, cancelledIdle, closedIdle];
  const C = ['9'];
  assert.strictEqual(FM.isCancelled(cancelledIdle, C), true);
  assert.strictEqual(FM.isCancelled(worked, C), false);
  assert.strictEqual(FM.isCancelled(fact('D-5', { status_id: '9', done_at: null }), C), false);
  assert.deepStrictEqual(FM.throughputSeries(all, b, C), [0, 1]);
  assert.deepStrictEqual(FM.leadTimes(all, b, C).perBucket[1], [12]);
  assert.deepStrictEqual(FM.cycleTimes(all, b, C).perBucket[1], [8]);
  assert.deepStrictEqual(FM.closedWithoutWorkRows(all, b, C).map((r) => r.key), ['D-4']);
  const t = FM.summaryTiles(all, b, CAT, [], NOW, C);
  assert.strictEqual(t.closedWithoutWork, 1);
  assert.strictEqual(t.leadSkipped, 1);
  // Without cancelled ids the old behaviour holds: the worked cancellation counts as delivered.
  assert.deepStrictEqual(FM.throughputSeries(all, b), [0, 2]);
  assert.deepStrictEqual(FM.proposeCancelledStatuses([
    { id: '6', name: 'Closed', category: 'done' },
    { id: '9', name: 'Cancelled', category: 'done' },
    { id: '3', name: 'Cancel requested', category: 'indeterminate' },
  ]), ['9']);
});

test('cancelled after work: started or logged time, sorted by hours; totals know when time is missing', () => {
  const b = FM.bucketsFor('week', NOW, 2);
  const C = ['9'];
  const worked = fact('D-1', { started_at: iso(2026, 10, 5), done_at: iso(2026, 10, 12), status_id: '9', time_spent_s: 3600 });
  const loggedOnly = fact('D-2', { started_at: null, done_at: iso(2026, 10, 12), status_id: '9', time_spent_s: 43200 });
  const idle = fact('D-3', { started_at: null, done_at: iso(2026, 10, 12), status_id: '9', time_spent_s: null });
  const delivered = fact('D-4', { started_at: iso(2026, 10, 5), done_at: iso(2026, 10, 12), status_id: '4', time_spent_s: 7200 });
  const outOfRange = fact('D-5', { started_at: iso(2025, 1, 5), done_at: iso(2025, 1, 12), status_id: '9', time_spent_s: 3600 });
  const all = [worked, loggedOnly, idle, delivered, outOfRange];
  const rows = FM.cancelledAfterWorkRows(all, b, C);
  assert.deepStrictEqual(rows.map((r) => r.key), ['D-2', 'D-1']);
  assert.strictEqual(rows[0].loggedSeconds, 43200);
  assert.strictEqual(rows[0].daysInWork, null);
  assert.strictEqual(rows[1].daysInWork, 7);
  assert.deepStrictEqual(FM.cancelledAfterWorkTotals(all, b, C), { count: 2, loggedSeconds: 46800, unknownTime: 0, daysInWork: 7 });
  // Facts stored before the field existed: hours unknown, not zero.
  const strip = (f) => { const c = { ...f }; delete c.time_spent_s; return c; };
  const legacy = all.map(strip);
  assert.strictEqual(FM.cancelledAfterWorkTotals(legacy, b, C).loggedSeconds, null);
  // D-2 never started and its time is unknown, so nothing marks it as worked: only D-1 is listed.
  assert.strictEqual(FM.cancelledAfterWorkTotals(legacy, b, C).unknownTime, 1);
  // Half refreshed: the known part is summed and the unknown part is counted.
  const mixed = FM.cancelledAfterWorkTotals([strip(worked), loggedOnly], b, C);
  assert.strictEqual(mixed.loggedSeconds, 43200);
  assert.strictEqual(mixed.unknownTime, 1);
  assert.deepStrictEqual(FM.cancelledAfterWorkRows(all, b, []), []);
  assert.strictEqual(FM.summaryTiles(all, b, CAT, [], NOW, C).cancelledAfterWork.count, 2);
});

test('fmtLogged shows logged work like Jira, never rounds 45 min to hours', () => {
  assert.strictEqual(FM.fmtLogged(2700), '45 min');
  assert.strictEqual(FM.fmtLogged(12600), '3 h 30 min');
  assert.strictEqual(FM.fmtLogged(43200), '12 h');
  assert.strictEqual(FM.fmtLogged(0), '0 min');
  assert.strictEqual(FM.fmtLogged(null), '-');
  // Sum of exact seconds: 3 x 45 min = 2 h 15 min (rounded hours would give 2,4 h).
  assert.strictEqual(FM.fmtLogged(3 * 2700), '2 h 15 min');
});

test('personPeriodStats: selection by current assignee and worklog author; per-week buckets', () => {
  const b = FM.bucketsFor('week', NOW, 2);
  const C = ['9'];
  const thisWeek = iso(2026, 10, 12);
  const mine = (n) => n === 'Jordan' || n === 'AC Lee Jordan';
  const delivered = fact('D-1', { assignee: 'AC Lee Jordan', created: iso(2026, 10, 1), started_at: iso(2026, 10, 5), done_at: thisWeek, status_id: '4',
    intervals: [{ s: '4', from: thisWeek, to: null }],
    worklogs: [
      { author: 'Jordan', started: iso(2026, 10, 12), seconds: 3600 }, // this week
      { author: 'Jordan', started: iso(2026, 10, 6), seconds: 1800 }, // previous week
      { author: 'Taylor', started: iso(2026, 10, 12), seconds: 7200 }, // not selected
    ] });
  const wip = fact('D-2', { assignee: 'Jordan', intervals: [{ s: '2', from: iso(2026, 10, 1), to: null }] });
  const cancelled = fact('D-3', { assignee: 'Jordan', started_at: iso(2026, 10, 5), done_at: thisWeek, status_id: '9' });
  const cleanup = fact('D-4', { assignee: 'Jordan', started_at: null, done_at: thisWeek, status_id: '4' });
  const others = fact('D-5', { assignee: 'Taylor', started_at: iso(2026, 10, 5), done_at: thisWeek, status_id: '4' });
  const sub = fact('D-6', { subtask: true, assignee: 'Jordan', worklogs: [{ author: 'Jordan', started: iso(2026, 10, 12), seconds: 600 }] });
  const s = FM.personPeriodStats([delivered, wip, cancelled, cleanup, others, sub], b, CAT, C, mine);
  assert.strictEqual(s.wipNow, 1);
  assert.strictEqual(s.loggedKnown, true);
  const cur = s.perBucket[1];
  assert.deepStrictEqual(
    { done: cur.delivered, lead: cur.leadMedian, cycle: cur.cycleMedian, logged: cur.loggedSeconds },
    { done: 1, lead: 11, cycle: 7, logged: 4200 }); // cancelled + clean-up not delivered; sub-task time counts
  assert.strictEqual(s.perBucket[0].loggedSeconds, 1800);
  assert.strictEqual(s.perBucket[0].delivered, 0);
  assert.strictEqual(FM.personPeriodStats([wip], b, CAT, C, mine).loggedKnown, false);
});

test('wipNowFacts: the same set wipAt counts', () => {
  const a = fact('D-1', { intervals: [{ s: '2', from: iso(2026, 10, 1), to: null }] });
  const b = fact('D-2', { intervals: [{ s: '1', from: iso(2026, 10, 1), to: null }] });
  const epic = fact('D-3', { is_epic: true, intervals: [{ s: '2', from: iso(2026, 10, 1), to: null }] });
  assert.deepStrictEqual(FM.wipNowFacts([a, b, epic], CAT).map((f) => f.key), ['D-1']);
  assert.strictEqual(FM.wipAt([a, b, epic], NOW, CAT), 1);
});
