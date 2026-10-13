// modules/time-log/tests/test_time_log_calendar.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { easterSunday, plHolidays, windowDates } = require(path.join(DIR, 'server', 'calendar.js'));

function iso({ year, month, day }) {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

test('easterSunday: 2026 and 2027 match the Gaussian algorithm', () => {
  assert.strictEqual(iso(easterSunday(2026)), '2026-04-05');
  assert.strictEqual(iso(easterSunday(2027)), '2027-03-28');
});

test('plHolidays: 2026 carries 13 dates including Corpus Christi and Pentecost', () => {
  const set = plHolidays(2026);
  assert.strictEqual(set.size, 13);
  assert.ok(set.has('2026-06-04'), 'Corpus Christi (Easter + 60)');
  assert.ok(set.has('2026-05-24'), 'Pentecost (Easter + 49)');
  assert.ok(set.has('2026-01-01'));
  assert.ok(set.has('2026-04-05'), 'Easter Sunday itself');
  assert.ok(set.has('2026-04-06'), 'Easter Monday');
});

test('windowDates: 14 days ending yesterday, crossing a month boundary', () => {
  const dates = windowDates('2026-09-13', 14);
  assert.strictEqual(dates.length, 14);
  assert.strictEqual(dates[0], '2026-09-12');
  assert.strictEqual(dates[13], '2026-08-30');
});
