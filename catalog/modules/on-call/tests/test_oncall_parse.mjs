// on-call/tests/test_oncall_parse.mjs
// Parser cases over the synthetic fixture - this is where the bugs live
// (irregular wiki HTML), so it carries the test weight.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  parseScheduleHtml, tokenizeTables, expandTable, deriveDate, splitHours, slugify, foldText,
} = require(path.join(DIR, 'server', 'parse-schedule.js'));
const { buildShards } = require(path.join(DIR, 'server', 'build.js'));

const FIXTURE_HTML = fs.readFileSync(path.join(DIR, 'tests', 'fixtures', 'oncall-schedule.html'), 'utf8');
const ANCHOR_2026 = new Date(2026, 7, 25); // 2026-08-25, the page's version date

function parseFixture(anchorDate) {
  return parseScheduleHtml(FIXTURE_HTML, { anchorDate: anchorDate || ANCHOR_2026 });
}

// (1) expandTable ------------------------------------------------------------

test('oncall-parse: expandTable copies a colspan cell into every column it covers', () => {
  const tables = tokenizeTables('<table><tr><td colspan="4">A</td></tr></table>');
  const grid = expandTable(tables[0]);
  assert.equal(grid[0].length, 4);
  assert.deepEqual(grid[0].map((c) => c.html), ['A', 'A', 'A', 'A']);
});

test('oncall-parse: expandTable copies a rowspan cell down every row it covers', () => {
  const tables = tokenizeTables(
    '<table><tr><td rowspan="3">S</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>',
  );
  const grid = expandTable(tables[0]);
  assert.deepEqual(grid.map((r) => r[0].html), ['S', 'S', 'S']);
  assert.deepEqual(grid.map((r) => r[1].html), ['1', '2', '3']);
});

test('oncall-parse: expandTable pads a row shorter than the header, never throws', () => {
  const tables = tokenizeTables('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>x</td></tr></table>');
  assert.doesNotThrow(() => expandTable(tables[0]));
  const grid = expandTable(tables[0]);
  assert.equal(grid[1].length, 3);
  assert.equal(grid[1][1].html, '');
  assert.equal(grid[1][2].html, '');
});

// (2) deriveDate --------------------------------------------------------------

test('oncall-parse: deriveDate resolves "1.08"+"Sat" and "01.09"+"Tue" under anchor 2026-08-25', () => {
  assert.equal(deriveDate('1.08', 'Sat', ANCHOR_2026).date, '2026-08-01');
  assert.equal(deriveDate('01.09', 'Tue', ANCHOR_2026).date, '2026-09-01');
});

test('oncall-parse: deriveDate still resolves to 2026 under anchor 2027-01-05', () => {
  const anchor2027 = new Date(2027, 0, 5);
  assert.equal(deriveDate('1.08', 'Sat', anchor2027).date, '2026-08-01');
  assert.equal(deriveDate('01.09', 'Tue', anchor2027).date, '2026-09-01');
});

test('oncall-parse: deriveDate accepts short, long and dotted weekday spellings', () => {
  assert.equal(deriveDate('30.09', 'Wed', ANCHOR_2026).date, '2026-09-30');
  assert.equal(deriveDate('5.08', 'Wednesday', ANCHOR_2026).date, '2026-08-05');
  assert.equal(deriveDate('6.08', 'Thu.', ANCHOR_2026).date, '2026-08-06');
});

test('oncall-parse: deriveDate with no weekday token falls back to the anchor year with a warning', () => {
  const result = deriveDate('1.08', '', ANCHOR_2026);
  assert.equal(result.date, '2026-08-01');
  assert.ok(result.warning && result.warning.length > 0);
});

// (3) block splitting ("/" and scope suffixes) --------------------------------

test('oncall-parse: a " / " cell yields two entries in the same column', () => {
  const parsed = parseFixture();
  const day8 = parsed.entries.filter((e) => e.date === '2026-08-08' && e.column === 'inventory');
  assert.equal(day8.length, 2);
  assert.equal(day8[0].person, 'Drew Patel');
});

test('oncall-parse: a two-block cell with scope suffixes routes each piece to the suffix column', () => {
  const parsed = parseFixture();
  const day3 = parsed.entries.filter((e) => e.date === '2026-08-03');
  const orders = day3.find((e) => e.column === 'orders');
  const inventory = day3.filter((e) => e.column === 'inventory');
  assert.ok(orders, 'the Orders-suffixed piece lands in the orders column');
  assert.equal(orders.person_raw, 'Rivera Sam');
  assert.ok(inventory.some((e) => e.person_raw === 'Dana Whitfield'), 'the Inventory-suffixed piece lands in inventory');
});

test('oncall-parse: a colspan weekend duty covers all four columns', () => {
  const parsed = parseFixture();
  const day2 = parsed.entries.filter((e) => e.date === '2026-08-02');
  assert.deepEqual(day2.map((e) => e.column).sort(), ['devops', 'inventory', 'orders', 'platform']);
  assert.ok(day2.every((e) => e.person === 'Sam Rivera'));
});

// (4) name normalisation -------------------------------------------------------

test('oncall-parse: both name orders normalise to "First Last" and match', () => {
  const parsed = parseFixture();
  const rev = parsed.entries.find((e) => e.person_raw === 'Patel Drew');
  assert.equal(rev.matched, true);
  assert.equal(rev.person, 'Drew Patel');

  const normal = parsed.entries.find((e) => e.person_raw === 'Drew Patel');
  assert.equal(normal.matched, true);
  assert.equal(normal.person, 'Drew Patel');
});

test('oncall-parse: a typo stays raw, unmatched, with one warning', () => {
  const parsed = parseFixture();
  const typo = parsed.entries.find((e) => e.person_raw === 'Drew Patle');
  assert.equal(typo.matched, false);
  assert.equal(typo.person, 'Drew Patle');
  assert.equal(parsed.warnings.filter((w) => w.includes('Patle')).length, 1);
});

// (5) roster table -------------------------------------------------------------

test('oncall-parse: roster table has 12 rows, two e-mails from one "/" cell, role/company/scopes', () => {
  const parsed = parseFixture();
  assert.equal(parsed.roster.length, 12);
  const casey = parsed.roster.find((d) => d.name === 'Casey Novak');
  assert.deepEqual(casey.emails, ['casey.novak@example.com', 'c.novak@example.org']);
  assert.equal(casey.role, 'BE');
  assert.equal(casey.company, 'Acme Ltd');
  assert.ok(casey.scopes && typeof casey.scopes.inventory === 'boolean');
  const jamie = parsed.roster.find((d) => d.name === 'Jamie Ortiz');
  assert.equal(jamie.company, 'Initech Labs', '&nbsp; decodes to a plain space');
});

test('oncall-parse: roster scopes read the emoji images - check mark = true, cross mark = false, empty = false', () => {
  const parsed = parseFixture();
  const alex = parsed.roster.find((d) => d.name === 'Alex Morgan');
  assert.deepEqual(alex.scopes, { inventory: true, orders: true, platform: false });
  const casey = parsed.roster.find((d) => d.name === 'Casey Novak');
  assert.deepEqual(casey.scopes, { inventory: false, orders: false, platform: false });
});

// (6) coordination table ---------------------------------------------------------

test('oncall-parse: coordination phone is normalised, "or Teams" lands in note, entities decode', () => {
  const parsed = parseFixture();
  assert.equal(parsed.coordination.length, 3);
  const robin = parsed.coordination.find((k) => k.name === 'Robin Hayes');
  assert.equal(robin.phone, robin.phone_display.replace(/ /g, ''), 'spaces stripped');
  assert.equal(robin.phone_display, '+48 600 000 021');
  const renee = parsed.coordination.find((k) => k.name.startsWith('Ren'));
  assert.equal(renee.name, 'Renée Parker');
  assert.ok(renee.note.toLowerCase().includes('or teams'));
  assert.equal(renee.phone_display, '+48 600 000 023');
});

// (7) hours table ---------------------------------------------------------------

test('oncall-parse: hours - a glued hour pair splits in two, the section-row system fills down, header repeats are skipped, verbatim text kept', () => {
  const parsed = parseFixture();
  const firstRow = parsed.hours[0];
  assert.deepEqual(firstRow.hours, ['5:30-17:00', '20:00-23:00']);
  assert.equal(firstRow.system, 'Inventory');
  assert.equal(parsed.hours[1].system, 'Inventory');
  assert.equal(parsed.hours[2].system, 'Inventory');
  const allDay = parsed.hours.find((g) => g.hours.includes('all day'));
  assert.ok(allDay, '"all day" is kept verbatim as one item');
  assert.equal(allDay.system, 'Platform');
  assert.equal(parsed.hours.length, 9, 'section rows and the repeated header are not data rows');
  assert.equal(parsed.hours.filter((g) => g.system === 'Orders').length, 3);
});

test('oncall-parse: splitHours splits a glued pair and keeps prose verbatim', () => {
  assert.deepEqual(splitHours('5:30-17:0020:00-23:00'), ['5:30-17:00', '20:00-23:00']);
  assert.deepEqual(splitHours('business 9:00-17:00'), ['business 9:00-17:00']);
});

// (8) months + warnings shape -----------------------------------------------------

test('oncall-parse: entries group into two months, warnings is an array of strings', () => {
  const parsed = parseFixture();
  const months = new Set(parsed.entries.map((e) => e.date.slice(0, 7)));
  assert.deepEqual([...months].sort(), ['2026-08', '2026-09']);
  assert.ok(Array.isArray(parsed.warnings));
  for (const w of parsed.warnings) assert.equal(typeof w, 'string');
});

// (9) no schedule table -----------------------------------------------------------

test('oncall-parse: HTML without a schedule table returns empty entries, and build reports parse-failed', () => {
  const parsed = parseScheduleHtml('<p>no tables here</p>', { anchorDate: ANCHOR_2026 });
  assert.deepEqual(parsed.entries, []);
  const built = buildShards(parsed, { generated_at: 'x' }, null);
  assert.equal(built.error, 'parse-failed');
});

test('oncall-parse: build keeps the previous roster, coordination and hours when a fetch parses them empty', () => {
  const parsed = parseFixture();
  const previous = buildShards(parsed, { generated_at: 'x' }, null).index;
  const thin = { ...parsed, roster: [], coordination: [], hours: [] };
  const built = buildShards(thin, { generated_at: 'y' }, previous);
  assert.equal(built.index.roster.length, previous.roster.length);
  assert.equal(built.index.coordination.length, 3);
  assert.equal(built.index.hours.length, 9);
  assert.equal(built.index.warnings.filter((w) => /previous one was kept/.test(w)).length, 3);
  const fresh = buildShards(thin, { generated_at: 'z' }, null);
  assert.deepEqual(fresh.index.coordination, [], 'with nothing to keep the tables stay empty rather than invented');
});

test('oncall-parse: slugify folds diacritics and matches the team-directory slug shape', () => {
  assert.equal(slugify('Quinn Harper-Ellis'), 'quinn-harper-ellis');
  assert.equal(slugify('Renée Parker'), 'renee-parker');
  assert.equal(slugify('  Zoë   Brontë '), 'zoe-bronte');
  assert.equal(foldText('Crème Brûlée Łódź'), 'creme brulee lodz');
});

test('oncall-parse: the year follows the row order, not a wrong weekday typed on the page', () => {
  const row = (d, w) => '<tr><td>' + d + '</td><td>' + w + '</td><td>Alex Morgan</td></tr>';
  const html = '<table><tr><th>Date</th><th>Day</th><th>Platform DevOps</th></tr>'
    + row('12.10', 'Mon') + row('13.10', 'Mon') + row('14.10', 'Wed') + '</table>';
  const r = parseScheduleHtml(html, { anchorDate: new Date('2026-09-22T09:00:00+02:00') });
  assert.deepEqual(r.entries.map((e) => e.date), ['2026-10-12', '2026-10-13', '2026-10-14']);
  assert.ok(r.warnings.some((w) => w.includes('2026-10-13')));
});
