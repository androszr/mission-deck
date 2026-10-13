// on-call/tests/test_oncall_widget.mjs
// Dashboard widget contract: manifest widgets[] passes the host validator, the
// widget file exports renderWidget and imports in plain Node, and the painter
// answers "who is on call" for a fixed date, across a month boundary.

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
const { kit } = await import(pathToFileURL(path.join(APP_ROOT, 'js/dashboard-widget-kit.js')).href);

const e = (date, column, person) => ({ date, column, person, person_raw: person, person_slug: person, matched: true, note: '' });
// Wed 2026-09-30 is "today"; Oct 1-2 are in the next month shard.
const NOW = new Date(2026, 8, 30, 10, 0, 0);
const ENTRIES = [
  e('2026-09-30', 'inventory', 'Alex Morgan'), e('2026-09-30', 'orders', 'Alex Morgan'),
  e('2026-09-30', 'platform', 'Sam Rivera'), e('2026-09-30', 'devops', 'Jordan Lee'),
  e('2026-10-01', 'platform', 'Taylor Kim'), e('2026-10-02', 'platform', 'Sam Rivera'),
];

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'on-call');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'on-call-today');
  assert.strictEqual(new Set(w.variants.map((v) => v.id)).size, w.variants.length);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2), 'at least one two-row variant');
});

test('widget: client/widget.js exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: a person covering two columns is one row; labels come from the module columns', () => {
  const { blocks } = widget.buildBlocks(ENTRIES, NOW);
  const all = blocks.people_all.people;
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all.find((p) => p.name === 'Alex Morgan').sub, 'Inv. · Ord.');
  assert.strictEqual(all.find((p) => p.name === 'Sam Rivera').sub, 'Platform');
  assert.deepStrictEqual(blocks.people_platform.people.map((p) => p.name), ['Sam Rivera']);
});

test('widget: the timeline crosses into the next month and the week needs both months', () => {
  const { blocks } = widget.buildBlocks(ENTRIES, NOW);
  assert.deepStrictEqual(blocks.timeline.events.map((x) => x.date), ['today', 'tomorrow', 'Fri 2 Oct']);
  assert.deepStrictEqual(widget.neededMonths(NOW), ['2026-09', '2026-10']);
  assert.deepStrictEqual(widget.neededMonths(new Date(2026, 9, 14)), ['2026-10']);
});

test('widget: the calendar counts covered columns per day and leaves empty days null', () => {
  const cal = widget.buildBlocks(ENTRIES, NOW).blocks.calendar;
  assert.strictEqual(cal.days.length, 30, 'September');
  assert.strictEqual(cal.days[29], 4, '30 Sep: all four columns covered');
  assert.strictEqual(cal.days[0], null);
  assert.strictEqual(cal.firstWeekday, 2, '1 Sep 2026 is a Tuesday');
});

test('widget: every variant paints with avatars; nobody on call today is a pill, not an empty list', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) {
    assert.ok(widget.paint(ENTRIES, id, sizes[id], kit, NOW).includes('data-person='), id);
  }
  const onlyLater = ENTRIES.filter((x) => x.date !== '2026-09-30');
  assert.ok(widget.paint(onlyLater, 'm2', sizes.m2, kit, NOW).includes('Nobody on call today'));
});

test('widget: nothing in the window is the empty sentence', () => {
  assert.match(widget.buildBlocks([], NOW).empty, /Nobody on call today in the schedule/);
});

test('widget: renderWidget tells "no data" from "nobody on call"', async () => {
  const el = { innerHTML: '' };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ available: false, storage: 'unavailable', months: [] }) });
  await widget.renderWidget(el, { apiBase: '/api/m/on-call', signal: new AbortController().signal, kit, variant: { id: 'm2', cols: 3, rows: 2 } });
  assert.match(el.innerHTML, /No on-call schedule data/);
  delete globalThis.fetch;
});

const VAR = { id: 'm2', cols: 3, rows: 2 };
async function runWith(answers) {
  const calls = [];
  const el = { innerHTML: '' };
  globalThis.fetch = async (url) => { calls.push(url); const a = answers(url); return { ok: true, status: 200, json: async () => a }; };
  try {
    await widget.renderWidget(el, { apiBase: '/api/m/on-call', signal: new AbortController().signal, kit, variant: VAR });
  } finally {
    delete globalThis.fetch;
  }
  return { el, calls };
}
const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

test('widget: a synced tree without the schedule index is its own sentence, not the Sync window alone', async () => {
  const { el } = await runWith(() => ({ available: false, storage: 'ok', months: [] }));
  assert.match(el.innerHTML, /Sync button in the tool view/);
});

test('widget: a missing current-month shard never reads as "nobody on call"', async () => {
  const { el } = await runWith(() => ({ available: true, storage: 'ok', index: {}, month: null, months: [], ym: ym(new Date()) }));
  assert.match(el.innerHTML, /No on-call schedule for /);
  assert.ok(!el.innerHTML.includes('Nobody on call today'));
});

test('widget: only months the index lists are fetched; the date of the schedule is shown', async () => {
  const cur = ym(new Date());
  const { el, calls } = await runWith(() => ({ available: true, storage: 'ok', index: { generated_at: '2026-10-11T08:00:00' }, month: { entries: [] }, months: [cur], ym: cur }));
  assert.deepStrictEqual(calls, ['/api/m/on-call/data?month=' + cur], 'the current month by name; next month not listed: no request');
  assert.ok(el.innerHTML.length > 0);
  assert.strictEqual(widget.asOfLabel('2026-10-11T08:00:00'), 'as of 11 Oct');
  const withDate = widget.buildBlocks(ENTRIES, NOW, { asOf: 'as of 29 Sep' });
  assert.match(withDate.blocks.avatars.label, /as of 29 Sep/);
  assert.match(withDate.blocks.calendar.label, /as of 29 Sep/);
});
