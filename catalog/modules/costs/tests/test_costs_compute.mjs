import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const c = require('../server/compute.js');

const wl = (name, display, day, secs) => ({ author: { name, displayName: display }, dateStarted: day + 'T09:00:00.000+0200', timeSpentSeconds: secs });

test('aggregateWorklogs groups by author and month and counts skipped', () => {
  const agg = c.aggregateWorklogs([
    wl('A@example.com', 'A One', '2026-01-05', 3600), wl('a@example.com', 'A One', '2026-01-06', 3600),
    wl('a@example.com', 'A One', '2026-02-01', 7200), { author: null, timeSpentSeconds: 5 },
  ]);
  assert.strictEqual(agg.authors.length, 1);
  assert.deepStrictEqual(agg.authors[0].months, { '2026-01': 7200, '2026-02': 7200 });
  assert.strictEqual(agg.skipped, 1);
});

test('splitByMonth yields every month of the range, mergeShards round-trips', () => {
  const agg = c.aggregateWorklogs([wl('a@example.com', 'A', '2026-01-05', 3600), wl('b@example.com', 'B', '2026-03-05', 1800)]);
  const split = c.splitByMonth(agg, ['2026-01', '2026-02', '2026-03']);
  assert.deepStrictEqual(Object.keys(split), ['2026-01', '2026-02', '2026-03']);
  assert.deepStrictEqual(split['2026-02'].authors, []);
  const shards = Object.entries(split).map(([month, v]) => ({ month, ...v })).reverse();
  assert.deepStrictEqual(c.mergeShards(shards), { authors: agg.authors.map(({ key, displayName, months }) => ({ key, displayName, months })) });
});

test('buildIndex keeps months outside the range and replaces the ones inside', () => {
  const e = (month, tag) => ({ month, fetchedAt: tag, dateFrom: month + '-01', dateTo: month + '-28', partial: false, authors: 1, worklogs: 1, skipped: 0 });
  const prev = c.buildIndex(null, [e('2026-01', 'old'), e('2026-02', 'old'), e('2026-03', 'old')], { now: 't0' });
  const next = c.buildIndex(prev, [e('2026-03', 'new'), e('2026-04', 'new')], { now: 't1' });
  assert.deepStrictEqual(next.months.map((m) => m.month), ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.deepStrictEqual(next.months[0], prev.months[0]);
  assert.deepStrictEqual(next.months[1], prev.months[1]);
  assert.strictEqual(next.months[2].fetchedAt, 'new');
  assert.strictEqual(next.generatedAt, 't1');
  assert.strictEqual(next.dateFrom, '2026-01-01');
});

test('monthsOfRange crosses a year boundary', () => {
  assert.deepStrictEqual(c.monthsOfRange('2025-11-01', '2026-02-10'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

const roster = [
  { id: 'tm-1', first_name: 'Alex', last_name: 'Morgan', email: 'alex.morgan@example.com', role: 'PO', team: 'Borealis' },
  { id: 'tm-2', first_name: 'Sam', last_name: 'River', email: 'sam.river@example.com', role: 'Dev', team: 'Borealis' },
  { id: 'tm-3', first_name: 'Jordan', last_name: 'Lee', email: 'jordan.lee@example.com', role: 'QA', team: 'Borealis' },
];
const config = { members: [
  { id: 'tm-1', included: true, areas: ['borealis'] }, { id: 'tm-2', included: true, areas: ['borealis', 'atlas'] }, { id: 'tm-3', included: true, areas: ['delta'] },
] };

test('buildCosts: cost = hours / 8 * rate rounded, missing rate -> null and counted, no-worklog member is a zero row', () => {
  const agg = c.aggregateWorklogs([
    wl('alex.morgan@example.com', 'BS Morgan Alex', '2026-01-05', 8 * 3600),
    wl('x@example.org', 'Sam River', '2026-01-06', 4 * 3600),
    wl('nobody@example.org', 'Totally Unknown', '2026-01-06', 3600),
  ]);
  const out = c.buildCosts({ aggregated: c.mergeShards(Object.entries(c.splitByMonth(agg, ['2026-01'])).map(([month, v]) => ({ month, ...v }))), config, rates: { rates: [{ id: 'tm-1', daily_rate: 1000.555 }] }, roster, months: ['2026-01'] });
  const p1 = out.persons.find((p) => p.id === 'tm-1');
  assert.strictEqual(p1.total.cost, Math.round(1000.555 * 100) / 100);
  const p2 = out.persons.find((p) => p.id === 'tm-2');
  assert.strictEqual(p2.rateMissing, true);
  assert.strictEqual(p2.total.cost, null);
  assert.strictEqual(p2.total.hours, 4);
  const p3 = out.persons.find((p) => p.id === 'tm-3');
  assert.strictEqual(p3.total.hours, 0);
  assert.strictEqual(p3.rateMissing, true);
  assert.strictEqual(out.summary.byArea.borealis.personsNoRate, 1);
  assert.strictEqual(out.summary.byArea.borealis.hoursNoRate, 4);
  assert.strictEqual(out.unassigned.length, 1);
  assert.strictEqual(out.unassigned[0].reason, 'none');
});

test('buildCosts: a non-included namesake is never costed to the included person', () => {
  const c = require('../server/compute.js');
  const roster = [
    { id: 'a', first_name: 'Casey', last_name: 'Brook', email: 'casey.brook@example.com' },
    { id: 'b', first_name: 'Casey', last_name: 'Brookfield', email: 'casey.brookfield@example.com' },
  ];
  const aggregated = { authors: [{ key: 'zz', displayName: 'Casey Brookfield', months: { '2026-01': 3600 } }] };
  const out = c.buildCosts({ aggregated, config: { members: [{ id: 'a', included: true, areas: ['borealis'] }] }, rates: { rates: [{ id: 'a', daily_rate: 800 }] }, roster, months: ['2026-01'] });
  // Exact hit on the non-included member: ignored, neither costed nor unassigned.
  assert.strictEqual(out.persons[0].total.hours, 0);
  assert.strictEqual(out.unassigned.length, 0);
});
