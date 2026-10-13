// modules/time-log/tests/test_time_log_lib.mjs
// Unit tests for the pure helpers in client/time-log-lib.js: cellState,
// filterPersons, alertStats/columnTotals, teamsDraftUrl/fmtLoggedAt.

import test from 'node:test';
import assert from 'node:assert';
import {
  cellState, filterPersons, alertStats, columnTotals, teamsDraftUrl, fmtLoggedAt,
  vacationSet,
} from '../client/time-log-lib.js';

const HOLIDAY = 'public holiday';
const TIME_OFF = 'time off';

test('time-log-lib: cellState - weekend, holiday, vacation, logged and miss', () => {
  assert.deepStrictEqual(cellState({ is_weekend: true }, false), { kind: 'weekend', frac: 0, hi: false, label: 'weekend' });
  assert.deepStrictEqual(cellState({ is_holiday: true }, false), { kind: 'holiday', frac: 0, hi: false, label: HOLIDAY });
  assert.deepStrictEqual(cellState({}, true), { kind: 'vacation', frac: 0, hi: false, label: TIME_OFF });
  // Holiday wins over vacation - a holiday during a vacation is still a holiday.
  assert.strictEqual(cellState({ is_holiday: true }, true).kind, 'holiday');

  const logged4h = cellState({ has_log: true, hours: 4 }, false);
  assert.strictEqual(logged4h.kind, 'logged');
  assert.strictEqual(logged4h.frac, 0.5);
  assert.strictEqual(logged4h.hi, true, 'frac >= 0.5 must flip hi');

  const logged2h = cellState({ has_log: true, hours: 2 }, false);
  assert.strictEqual(logged2h.frac, 0.25);
  assert.strictEqual(logged2h.hi, false);

  assert.deepStrictEqual(cellState({ has_log: false }, false), { kind: 'miss', frac: 0, hi: false, label: 'no log' });
});

test('time-log-lib: filterPersons - by team and by a diacritic-free name fragment', () => {
  const persons = [
    { name: 'Zo\u00eb \u00c5ngstr\u00f6m', display_short: 'Z. \u00c5ngstr\u00f6m', team: 'Borealis' },
    { name: 'Alex Morgan', display_short: 'A. Morgan', team: 'Atlas' },
    { name: 'Sam Rivera', display_short: 'S. Rivera', team: 'Atlas' },
  ];
  assert.strictEqual(filterPersons(persons, { team: 'Atlas' }).length, 2);
  assert.strictEqual(filterPersons(persons, { team: '' }).length, 3);
  assert.deepStrictEqual(
    filterPersons(persons, { query: 'angstrom' }).map((p) => p.name),
    ['Zo\u00eb \u00c5ngstr\u00f6m'],
  );
  assert.strictEqual(filterPersons(persons, { query: 'morg', team: 'Borealis' }).length, 0, 'both filters apply together');
});

test('time-log-lib: alertStats and columnTotals skip a person on vacation and report pct/tone', () => {
  const dates = ['2026-09-12', '2026-09-11'];
  const vac = vacationSet([{ person: 'Olive Skip', dateFrom: '2026-09-12', dateTo: '2026-09-12' }]);
  const persons = [
    { name: 'Olive Skip', days: [{ date: '2026-09-12', has_log: false }, { date: '2026-09-11', has_log: true }] },
    { name: 'A B', days: [{ date: '2026-09-12', has_log: true }, { date: '2026-09-11', has_log: true }] },
    { name: 'C D', days: [{ date: '2026-09-12', has_log: false }, { date: '2026-09-11', has_log: true }] },
    { name: 'E F', days: [{ date: '2026-09-12', has_log: true }, { date: '2026-09-11', has_log: true }] },
    { name: 'G H', days: [{ date: '2026-09-12', has_log: true }, { date: '2026-09-11', has_log: true }] },
    { name: 'I J', days: [{ date: '2026-09-12', has_log: true }, { date: '2026-09-11', has_log: true }] },
    { name: 'K L', days: [{ date: '2026-09-12', has_log: true }, { date: '2026-09-11', has_log: true }] },
    { name: 'M N', days: [{ date: '2026-09-12', has_log: true }, { date: '2026-09-11', has_log: true }] },
    { name: 'O P', days: [{ date: '2026-09-12', has_log: true }, { date: '2026-09-11', has_log: true }] },
    { name: 'Q R', days: [{ date: '2026-09-12', has_log: true }, { date: '2026-09-11', has_log: true }] },
  ];
  // Olive is on time off on 2026-09-12, so that date's eligible total is 9, all
  // logged except C D -> 8/9 -> 89% -> yellow (rounds to 89, below the 90 gate).
  const stats = alertStats({ persons, dates }, vac);
  assert.ok(stats);
  assert.strictEqual(stats.date, '2026-09-12');
  assert.strictEqual(stats.total, 9, 'the vacationing person must not count toward total');
  assert.strictEqual(stats.logged, 8);
  assert.strictEqual(stats.tone, 'yellow');

  const totals = columnTotals(persons, dates, vac);
  assert.strictEqual(totals[0].total, 9, 'columnTotals excludes the same vacationing person');
  assert.strictEqual(totals[1].total, 10, 'no one is on vacation the second date');

  // A window with everyone at 100% is green; a 100%-eligible person set with
  // one miss out of two eligible (50%) is red.
  const allGreen = alertStats(
    { persons: [{ name: 'X', days: [{ date: '2026-01-01', has_log: true }] }], dates: ['2026-01-01'] },
    new Set(),
  );
  assert.strictEqual(allGreen.tone, 'green');
  const oneRed = alertStats(
    { persons: [{ name: 'X', days: [{ date: '2026-01-01', has_log: false }] }], dates: ['2026-01-01'] },
    new Set(),
  );
  assert.strictEqual(oneRed.tone, 'red');

  assert.strictEqual(alertStats({ persons: [], dates }, new Set()), null);
});

test('time-log-lib: teamsDraftUrl encodes the e-mail and message, fmtLoggedAt formats a Tempo timestamp', () => {
  const url = teamsDraftUrl('alex.morgan@example.com', 'Hi Zo\u00eb, missing?');
  assert.ok(url.startsWith('https://teams.microsoft.com/l/chat/0/0?users='));
  assert.ok(url.includes(encodeURIComponent('alex.morgan@example.com')));
  assert.ok(url.includes(encodeURIComponent('Hi Zo\u00eb, missing?')));
  assert.strictEqual(teamsDraftUrl('', 'x'), '', 'no e-mail means no link');

  assert.strictEqual(fmtLoggedAt('2026-08-22T12:50:30.000'), '22.08 12:50');
  assert.strictEqual(fmtLoggedAt('2026-08-22 12:50:30.000'), '22.08 12:50', 'a space instead of T is tolerated');
  assert.strictEqual(fmtLoggedAt(''), '');
  assert.strictEqual(fmtLoggedAt(null), '');
});
