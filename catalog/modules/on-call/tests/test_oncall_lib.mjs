// on-call/tests/test_oncall_lib.mjs
// Pure client helpers - no browser document.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  COLUMNS, buildMonthGrid, groupEntriesByDay, monthRange, shiftYM, parseYM, formatYM, getInitials,
} from '../client/oncall-lib.js';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { COLUMN_ORDER } = require(path.join(DIR, 'server', 'build.js'));

test('oncall-lib: groupEntriesByDay dedupes a person in two columns into one row, columns in COLUMNS order', () => {
  const entries = [
    { date: '2026-08-01', column: 'devops', person: 'Ann Test', person_slug: 'ann-test', matched: true },
    { date: '2026-08-01', column: 'inventory', person: 'Ann Test', person_slug: 'ann-test', matched: true },
    { date: '2026-08-01', column: 'orders', person: 'Ben Other', person_slug: 'ben-other', matched: true },
  ];
  const byDay = groupEntriesByDay(entries);
  assert.equal(byDay['2026-08-01'].length, 2);
  const ann = byDay['2026-08-01'].find((r) => r.person_slug === 'ann-test');
  assert.deepEqual(ann.columns, ['inventory', 'devops']);
});

test('oncall-lib: buildMonthGrid(2026, 8) starts with five null cells and has a multiple of 7 length', () => {
  const cells = buildMonthGrid(2026, 8);
  assert.equal(cells.length % 7, 0);
  let leadingNulls = 0;
  while (cells[leadingNulls] === null) leadingNulls += 1;
  // August 2026 opens on a Saturday - Monday-first grid, so 5 leading blanks.
  assert.equal(leadingNulls, 5);
});

test('oncall-lib: COLUMNS keys match the server COLUMN_ORDER', () => {
  assert.deepEqual(COLUMNS.map((c) => c.key), COLUMN_ORDER);
});

test('oncall-lib: monthRange clamps to today when the list is empty and widens to the data on both sides', () => {
  assert.deepEqual(monthRange([], '2026-09'), { minYM: '2026-09', maxYM: '2026-09' });
  assert.deepEqual(monthRange(['2026-08', '2026-09'], '2026-09'), { minYM: '2026-08', maxYM: '2026-09' });
  assert.deepEqual(monthRange(['2026-11'], '2026-09'), { minYM: '2026-09', maxYM: '2026-11' });
  assert.deepEqual(monthRange([null, '', '2026-07'], '2026-09'), { minYM: '2026-07', maxYM: '2026-09' }, 'junk entries are ignored');
});

test('oncall-lib: shiftYM crosses the year boundary both ways, parseYM/formatYM round-trip', () => {
  assert.equal(shiftYM('2026-12', 1), '2027-01');
  assert.equal(shiftYM('2027-01', -1), '2026-12');
  assert.equal(shiftYM('2026-09', -12), '2025-09');
  assert.deepEqual(parseYM('2026-09'), { year: 2026, month: 9 });
  assert.equal(formatYM(2026, 9), '2026-09');
  assert.equal(formatYM(2027, 1), '2027-01');
});

test('oncall-lib: getInitials handles hyphenated surnames, single words and empty input', () => {
  assert.equal(getInitials('Quinn Harper-Ellis'), 'QH');
  assert.equal(getInitials('Patel Drew'), 'PD');
  assert.equal(getInitials('Ben'), 'BE', 'a single word yields two letters');
  assert.equal(getInitials(''), '??');
});
