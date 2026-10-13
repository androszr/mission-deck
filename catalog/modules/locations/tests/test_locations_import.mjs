// locations/tests/test_locations_import.mjs
// Pure domain logic: header aliases, header detection, CSV parsing, row
// building, the light index and the read-time vacant-manager label.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = require(path.join(DIR, 'server', 'locations-import.js'));

test('normalize folds case, diacritics and punctuation', () => {
  assert.equal(L.normalize('  Crème-Brûlée, Łódź '), 'creme brulee lodz');
  assert.equal(L.normalize(null), '');
});

test('fieldForHeader maps aliases to canonical fields', () => {
  assert.equal(L.fieldForHeader('Location code'), 'code');
  assert.equal(L.fieldForHeader('ZIP'), 'postal_code');
  assert.equal(L.fieldForHeader('E-mail'), 'email');
  assert.equal(L.fieldForHeader('Unknown column'), null);
});

test('findHeaderOffset skips title lines and gives up after ten rows', () => {
  assert.equal(L.findHeaderOffset([['Export of 2026'], [], ['Code', 'Name']]), 2);
  const rows = Array.from({ length: 12 }, () => ['x']);
  rows[11] = ['Code'];
  assert.equal(L.findHeaderOffset(rows), -1);
});

test('parseCsv handles quotes, doubled quotes, CRLF, a BOM and semicolons', () => {
  assert.deepEqual(L.parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(L.parseCsv('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('buildLocations: uppercases codes, skips blank codes, keeps the first duplicate, splits groups', () => {
  const r = L.buildLocations([
    ['Code', 'Name', 'City', 'Groups', 'Latitude'],
    ['loc-1', 'One', 'Springfield', 'Pilot, pilot; Flagship', '52,5'],
    ['', 'No code', 'X', '', ''],
    ['LOC-1', 'Duplicate', 'Y', '', ''],
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.locations.length, 1);
  assert.equal(r.locations[0].code, 'LOC-1');
  assert.equal(r.locations[0].name, 'One');
  assert.deepEqual(r.locations[0].groups, ['Pilot', 'Flagship']);
  assert.equal(r.locations[0].latitude, 52.5);
  assert.deepEqual(r.warnings, ['duplicate-codes:1']);
});

test('buildLocations: errors', () => {
  assert.equal(L.buildLocations([['nothing']]).error, 'header-not-found');
  assert.deepEqual(L.buildLocations([['Code', 'Name']]).missing, ['city']);
  assert.equal(L.buildLocations([['Code', 'Name', 'City']]).error, 'no-rows');
});

test('buildIndexRow keeps index fields only, with a normalized search_text', () => {
  const row = L.buildIndexRow({ code: 'A', name: 'Old Town', city: 'Springfield', phone: '+48 600 000 001', email: 'a@example.com', groups: ['Pilot'] });
  assert.ok(!('phone' in row) && !('email' in row));
  assert.match(row.search_text, /old town springfield/);
  assert.match(row.search_text, /pilot/);
});

test('withVacantManager labels a blank manager by area, on a copy', () => {
  const row = { code: 'A', manager: '', area: '2', search_text: 'a' };
  const out = L.withVacantManager(row);
  assert.equal(out.manager, 'Vacant 2');
  assert.match(out.search_text, /vacant 2/);
  assert.equal(row.manager, '', 'never mutates the input');
  assert.equal(L.withVacantManager({ manager: 'Alex Morgan', area: '1' }).manager, 'Alex Morgan');
  assert.equal(L.withVacantManager({ manager: '', area: '' }).manager, '');
});
