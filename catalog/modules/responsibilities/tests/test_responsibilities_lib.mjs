// Pure helpers of client/responsibilities-lib.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = await import(pathToFileURL(path.join(DIR, 'client', 'responsibilities-lib.js')).href);

test('previousClosedMonthKey: January rolls back to December of the previous year', () => {
  assert.equal(lib.previousClosedMonthKey(new Date(2026, 0, 15)), '2025-12');
  assert.equal(lib.previousClosedMonthKey(new Date(2026, 3, 2)), '2026-03');
});

test('defaultMonth: previous closed, else nearest earlier, else first', () => {
  const now = new Date(2026, 8, 29); // Sep -> prev 2026-08
  assert.equal(lib.defaultMonth(['2026-07', '2026-08', '2026-09'], now), '2026-08');
  assert.equal(lib.defaultMonth(['2026-05', '2026-06', '2026-09'], now), '2026-06');
  assert.equal(lib.defaultMonth(['2026-09', '2026-10'], now), '2026-09');
  assert.equal(lib.defaultMonth([], now), '');
});

test('monthWindow: selected plus three earlier, hiddenCount, showAll', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  const w = lib.monthWindow(months, '2026-06', false);
  assert.deepEqual(w.visible, ['2026-03', '2026-04', '2026-05', '2026-06']);
  assert.equal(w.hiddenCount, 2);
  const all = lib.monthWindow(months, '2026-06', true);
  assert.equal(all.visible.length, 6);
  assert.equal(all.hiddenCount, 0);
  assert.equal(all.canCollapse, false);
});

test('timelineMonths: 8 keys, last is the current month', () => {
  const keys = lib.timelineMonths(new Date(2026, 1, 10));
  assert.equal(keys.length, 8);
  assert.equal(keys[0], '2025-07');
  assert.equal(keys[7], '2026-02');
});

test('countsForMonth: unset areas are counted', () => {
  const data = { groups: [{ areas: [
    { ratings: { '2026-08': { status: 'red' } } },
    { ratings: { '2026-08': { status: 'green' } } },
    { ratings: {} },
    { ratings: { '2026-08': { status: null } } },
  ] }] };
  assert.deepEqual(lib.countsForMonth(data, '2026-08'), { green: 1, amber: 0, red: 1, unset: 2, total: 4 });
  assert.equal(lib.countsForMonth(null, '2026-08').total, 0);
});

test('monthLabel and isValidProject', () => {
  assert.equal(lib.monthLabel('2026-10'), 'Oct 26');
  assert.ok(lib.isValidProject('platform'));
  assert.ok(!lib.isValidProject('x'));
});
