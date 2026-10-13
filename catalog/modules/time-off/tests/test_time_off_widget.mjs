// time-off/tests/test_time_off_widget.mjs
// Dashboard widget contract: manifest widgets[] passes the host validator, the
// widget file exports renderWidget and imports in plain Node, and the painter
// computes the Mon-Fri intersection for a fixed date.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { APP_ROOT } from './_root.mjs';

const require = createRequire(import.meta.url);
const { validateModuleManifest } = require(path.join(APP_ROOT, 'server.js'));

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const { kit } = await import(pathToFileURL(path.join(APP_ROOT, 'js', 'dashboard-widget-kit.js')).href);

// Wednesday 2026-10-14. Week: Mon 12.10 - Fri 16.10.
const NOW = new Date(2026, 9, 14, 9, 0, 0);
const ENTRIES = [
  { person: 'Alex Morgan', dateFrom: '2026-10-05', dateTo: '2026-10-14' },
  { person: 'Alex Morgan', dateFrom: '2026-10-15', dateTo: '2026-10-15' },
  { person: 'Sam Rivera', dateFrom: '2026-10-14', dateTo: '2026-10-20' },
  { person: 'Jordan Lee', dateFrom: '2026-10-16', dateTo: '2026-10-16' },
  { person: 'Taylor Kim', dateFrom: '2026-09-01', dateTo: '2026-09-10' },
];

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'time-off');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'away-this-week');
  assert.strictEqual(new Set(w.variants.map((v) => v.id)).size, w.variants.length);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2), 'at least one two-row variant');
  assert.ok(w.variants.length <= 6);
});

test('widget: client/widget.js exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: entries are intersected with Mon-Fri and merged per person', () => {
  const w = widget.weekAbsences(ENTRIES, NOW);
  assert.deepStrictEqual(w.persons.map((p) => p.name), ['Alex Morgan', 'Sam Rivera', 'Jordan Lee']);
  assert.deepStrictEqual(w.persons[0].flags, [true, true, true, true, false], 'two entries of one person merge');
  assert.strictEqual(w.todayIdx, 2);
});

test('widget: weekend shows the coming week; a holiday is not an away day', () => {
  assert.strictEqual(widget.weekStart(new Date(2026, 9, 17)).getDate(), 19, 'Saturday -> next Monday');
  assert.strictEqual(widget.weekStart(new Date(2026, 9, 18)).getDate(), 19, 'Sunday -> next Monday');
  assert.strictEqual(widget.weekStart(NOW).getDate(), 12);
  // 2026-11-11 (Wednesday) is a public holiday.
  const w = widget.weekAbsences([{ person: 'Casey Novak', dateFrom: '2026-11-09', dateTo: '2026-11-13' }], new Date(2026, 10, 10));
  assert.deepStrictEqual(w.persons[0].flags, [true, true, false, true, true]);
});

test('widget: count wording and the "whole week" label', () => {
  const { blocks } = widget.buildBlocks(ENTRIES, NOW);
  assert.strictEqual(blocks.people.people.length, 3);
  const sat = widget.buildBlocks(ENTRIES, new Date(2026, 9, 10, 9, 0, 0));
  assert.strictEqual(sat.blocks.avatars_today.text, 'Weekend');
  assert.match(sat.blocks.avatars_today.sub, /^3 people in the week of 12\.10/);
  const cal = blocks.calendar;
  assert.strictEqual(cal.firstWeekday, 4, '1 Oct 2026 is a Thursday');
  assert.strictEqual(cal.days.length, 31);
  assert.strictEqual(cal.days[2], null, '3 Oct is a Saturday');
  assert.strictEqual(cal.days[13], 2, '14 Oct: Alex and Sam');
  const all = widget.buildBlocks([{ person: 'Casey Novak', dateFrom: '2026-10-01', dateTo: '2026-10-30' }], NOW);
  assert.strictEqual(all.blocks.people.people[0].sub, 'whole week');
  const one = widget.buildBlocks([{ person: 'Casey Novak', dateFrom: '2026-10-01', dateTo: '2026-10-30' }], new Date(2026, 9, 10, 9, 0, 0));
  assert.match(one.blocks.avatars_today.sub, /^1 person /);
});

test('widget: every variant paints; today stack lists those away today', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(ENTRIES, id, sizes[id], kit, NOW).length > 50, id);
  const stack = widget.paint(ENTRIES, 's', sizes.s, kit, NOW);
  assert.ok(stack.includes('Alex Morgan') && stack.includes('Sam Rivera') && !stack.includes('Jordan Lee'));
});

test('widget: a genuinely empty week is an ok pill in every size, painted once', () => {
  const r = widget.buildBlocks([], NOW);
  assert.strictEqual(r.empty, null);
  assert.strictEqual(r.blocks.people.type, 'pill');
  assert.strictEqual(r.blocks.people.tone, 'ok');
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) {
    const html = widget.paint([], id, sizes[id], kit, NOW);
    assert.strictEqual(html.split('Nobody has time off booked').length - 1, 1, id + ': exactly one pill');
  }
});

test('widget: no index and no entries is "no data", never "nobody away"', () => {
  assert.strictEqual(widget.noDataText({ available: true, storage: 'ok', fetched_at: null, persons: [], entries: [] }), widget.NO_SHEET_TEXT);
  assert.strictEqual(widget.noDataText({ available: false, storage: 'unavailable', entries: [] }), widget.SYNC_TEXT);
  assert.strictEqual(widget.noDataText({ available: true, storage: 'ok', fetched_at: '2026-10-11T15:23:25+00:00', persons: [{}], entries: [] }), null);
});

test('widget: the date of the sheet is shown', () => {
  assert.match(widget.asOfLabel('2026-10-11T15:23:25.384628+00:00'), /^as of 1[12]\.10$/);
  const r = widget.buildBlocks(ENTRIES, NOW, { asOf: 'as of 11.10' });
  assert.match(r.blocks.calendar.label, /as of 11\.10/);
});

test('widget: unavailable data is not "nobody is away"', async () => {
  const el = { innerHTML: '' };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ available: false, storage: 'unavailable', entries: [] }) });
  await widget.renderWidget(el, { apiBase: '/api/m/time-off', signal: new AbortController().signal, kit, variant: { id: 'm', cols: 3, rows: 1 } });
  assert.match(el.innerHTML, /No time-off data/);
  delete globalThis.fetch;
});
