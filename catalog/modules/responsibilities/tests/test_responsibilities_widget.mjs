// modules/responsibilities/tests/test_responsibilities_widget.mjs
// Dashboard widget contract: manifest widgets[] passes the host validator, the
// widget imports in plain Node, counts equal the lib's own and states are honest.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The app root: modules/<id>/ when installed, catalog/modules/<id>/ in the
// source tree. Walk up until server.js is found.
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'server.js')) && fs.existsSync(path.join(d, 'js'))) return d;
    d = path.dirname(d);
  }
  throw new Error('app root (server.js) not found above ' + start);
}
const ROOT = findRoot(DIR);
const { validateModuleManifest } = require(path.join(ROOT, 'server.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const lib = await import(pathToFileURL(path.join(DIR, 'client/responsibilities-lib.js')).href);
const { kit } = await import(pathToFileURL(path.join(ROOT, 'js/dashboard-widget-kit.js')).href);

const NOW = new Date(2026, 9, 11); // October -> default month 2026-09
const r = (status) => ({ status });
const MATRIX = {
  months: ['2026-08', '2026-09', '2026-10'],
  groups: [
    { id: 'g1', name: 'Platform', areas: [
      { id: 'a1', ratings: { '2026-09': r('green') } },
      { id: 'a2', ratings: { '2026-09': r('red') } },
      { id: 'a3', ratings: {} },
    ] },
    { id: 'g2', name: 'Data', areas: [
      { id: 'a4', ratings: { '2026-09': r('amber') } },
      { id: 'a5', ratings: { '2026-09': r('green') } },
    ] },
  ],
};
const DATA = { available: true, storage: 'ok', project: 'main', data: MATRIX };

test('widget: module.json declares a widget the host validator accepts', () => {
  const v = validateModuleManifest(manifest, 'responsibilities');
  assert.strictEqual(v.valid, true, (v.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'rag-of-month');
  assert.ok(w.variants.length <= 6);
  assert.ok(w.variants.some((x) => x.id === w.defaultVariant));
  assert.ok(w.variants.some((x) => x.rows === 2), 'at least one two-row variant');
});

test('widget: exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: counts equal the lib for the default month', () => {
  const { blocks } = widget.buildBlocks(DATA, NOW);
  const month = lib.defaultMonth(MATRIX.months, NOW);
  assert.strictEqual(month, '2026-09');
  const c = lib.countsForMonth(MATRIX, month);
  assert.deepStrictEqual(blocks.pie.segments.map((s) => s.value), [c.green, c.amber, c.red]);
  assert.strictEqual(blocks.pie.center, '4');
  assert.match(blocks.pill.text, /^1 area not rated$/);
  assert.deepStrictEqual(blocks.segments.segments.map((s) => [s.label, s.value, s.tone]), [['Platform', 1, 'error'], ['Data', 1, 'warn']]);
});

test('widget: everything rated reads as ok', () => {
  const all = { ...DATA, data: { months: ['2026-09'], groups: [{ name: 'G', areas: [{ ratings: { '2026-09': r('green') } }] }] } };
  const { blocks } = widget.buildBlocks(all, NOW);
  assert.strictEqual(blocks.pill.tone, 'ok');
  assert.strictEqual(blocks.segments, undefined);
});

test('widget: every variant paints; only the tall one carries the group bar', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(DATA, id, sizes[id], kit, NOW).includes('dash-kit-donut'), id);
  assert.ok(widget.paint(DATA, 'm2', sizes.m2, kit, NOW).includes('dash-kit-seg'));
  assert.ok(!widget.paint(DATA, 's', sizes.s, kit, NOW).includes('dash-kit-seg'));
});

test('widget: empty states tell storage from a missing matrix', () => {
  assert.match(widget.buildBlocks({ storage: 'unavailable', available: false }, NOW).empty, /Sync window/);
  assert.match(widget.buildBlocks({ storage: 'ok', available: false, data: null }, NOW).empty, /not prepared yet/);
});

test('widget: the unrated-areas pill agrees in number', () => {
  assert.deepStrictEqual([1, 2, 5, 12].map(widget.areasWord), ['area', 'areas', 'areas', 'areas']);
});
