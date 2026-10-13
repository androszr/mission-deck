// Dashboard widget contract: manifest widgets[] passes the host validator, the
// painter never ranks people (leave is not subtracted from miss_days_count).

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

const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-10', '2026-10-11'];
const days = (logs) => dates.map((date, i) => ({ date, is_weekend: i >= 3, is_holiday: false, has_log: i >= 3 ? false : logs[i], hours: 0 }));
const person = (name, team, logs) => ({ name, team, logged_days_count: logs.filter(Boolean).length, miss_days_count: logs.filter((x) => !x).length, days: days(logs) });
const DATA = {
  available: true, storage: 'ok', generated_at: '2026-10-10T08:10:00', window_days: 14, dates,
  persons: [
    person('Zoe Adams', 'Borealis', [false, false, false]),
    person('Alex Morgan', 'Borealis', [true, false, true]),
    person('Sam Rivera', 'Atlas', [true, true, true]),
  ],
};

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'time-log');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.label, 'Days without a time entry');
  assert.ok(w.variants.length <= 6);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2), 'at least one two-row variant');
});

test('widget: exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: counts people, says "days without an entry" and never ranks', () => {
  const { blocks } = widget.buildBlocks(DATA);
  assert.strictEqual(blocks.big.value, '2');
  assert.match(blocks.big.unit, /with days without an entry/);
  assert.match(blocks.big.label, /time off is not subtracted/);
  assert.match(blocks.big.label, /10\.10/);
  assert.deepStrictEqual(blocks.avatars.people.map((p) => p.name), ['Alex Morgan', 'Zoe Adams'], 'alphabetical, not by count');
  assert.strictEqual(blocks.rank, undefined);
  for (const keys of Object.values(widget.VARIANT_BLOCKS)) assert.ok(!keys.includes('rank'));
  assert.deepStrictEqual(blocks.heatmap.rows, ['Borealis', 'Atlas'], 'teams, not people');
  assert.deepStrictEqual(blocks.heatmap.cols, ['05', '06', '07'], 'weekend columns dropped');
  assert.deepStrictEqual(blocks.heatmap.values[0], [50, 0, 50]);
});

test('widget: every variant paints without "gaps"', () => {
  for (const v of manifest.widgets[0].variants) {
    const html = widget.paint(DATA, v.id, { cols: v.cols, rows: v.rows }, kit);
    assert.ok(html.length > 0 && !/gaps/i.test(html), v.id);
  }
  assert.ok(widget.paint(DATA, 'xl', { cols: 6, rows: 2 }, kit).includes('dash-kit-heat'));
});

test('widget: everyone logged -> ok pill; empty states', () => {
  const ok = { ...DATA, persons: [person('Sam Rivera', 'Atlas', [true, true, true])] };
  assert.match(widget.paint(ok, 's2', { cols: 2, rows: 2 }, kit), /Everyone has an entry/);
  assert.match(widget.buildBlocks({ available: false, storage: 'ok', persons: [] }).empty, /Time Log/);
});

test('widget: /data lists dates newest first - the heatmap still reads oldest to newest', () => {
  const desc = { ...DATA, dates: dates.slice().reverse(), persons: DATA.persons.map((p) => ({ ...p, days: p.days.slice().reverse() })) };
  const { blocks } = widget.buildBlocks(desc);
  assert.deepStrictEqual(blocks.heatmap.cols, ['05', '06', '07']);
  assert.deepStrictEqual(blocks.heatmap.values[0], [50, 0, 50]);
});

test('widget: no data repo is the Sync sentence, not the Tempo one', () => {
  const r = widget.buildBlocks({ available: false, storage: 'unavailable', persons: [] });
  assert.strictEqual(r.empty, widget.NO_STORAGE);
  assert.match(r.empty, /Sync window/);
  assert.strictEqual(widget.buildBlocks({ available: false, storage: 'ok', persons: [] }).empty, widget.NO_DATA);
});

test('widget: the people count agrees in number', () => {
  assert.deepStrictEqual([0, 1, 2, 5].map(widget.peopleWord), ['people', 'person', 'people', 'people']);
  const one = { ...DATA, persons: [DATA.persons[0], DATA.persons[2]] };
  assert.strictEqual(widget.buildBlocks(one).blocks.big.unit, 'person with days without an entry');
});
