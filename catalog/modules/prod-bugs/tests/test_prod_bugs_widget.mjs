// modules/prod-bugs/tests/test_prod_bugs_widget.mjs
// Dashboard widget contract: manifest widgets[] passes the host validator, the
// widget file exports renderWidget and imports in plain Node, the painter shows
// the right blocks per variant, and a 404 asks for a restart (no heavy fallback).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The module runs from modules/<id>/ when installed and from
// catalog/modules/<id>/ in the source tree: find the core server.js upwards.
function _coreServerPath() {
  const _fs = require('node:fs');
  const _path = require('node:path');
  let dir = _path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    dir = _path.dirname(dir);
    const candidate = _path.join(dir, 'server.js');
    if (_fs.existsSync(candidate) && _fs.existsSync(_path.join(dir, 'package.json'))) return candidate;
  }
  return '../../../server.js';
}

const { validateModuleManifest } = require(_coreServerPath());

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const { kit } = await import(pathToFileURL(path.join(path.dirname(path.resolve(DIR, _coreServerPath())), 'js/dashboard-widget-kit.js')).href);

const area = (bugs, resolvedCount, createdCount, bugFixTime) => ({ bugs, resolvedCount, createdCount, bugFixTime });
const DATA = {
  storage: 'ok',
  latest: { sprint: 20, sprintName: 'Sprint 20', dateRangeDisplay: '06.10-20.10', areas: { orders: area(1, 0, 1, null), otherModules: area(8, 2, 0, 100), platform: area(46, 22, 14, 20) } },
  series: [61, 58, 66, 52, 49, 55, 50, 55].map((bugs, i) => ({ sprint: 13 + i, bugs, areas: { orders: 1, otherModules: 8, platform: bugs - 9 }, priorities: { Low: 10, Medium: 20, High: bugs - 30 } })),
  fetchedAt: '2026-10-10T10:00:00',
};

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'prod-bugs');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'open-bugs');
  assert.strictEqual(new Set(w.variants.map((v) => v.id)).size, w.variants.length);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2), 'at least one two-row variant');
});

test('widget: client/widget.js exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: totals, weighted fix time and a dash for a missing one', () => {
  const { blocks } = widget.buildBlocks(DATA);
  assert.strictEqual(blocks.big.value, '55');
  assert.strictEqual(blocks.big.tone, 'error');
  assert.strictEqual(blocks.trend.delta, '+5', '55 vs 50');
  assert.strictEqual(blocks.trend.higherIsBetter, false, 'more open bugs is worse');
  assert.strictEqual(blocks.line.series.length, 3);
  assert.deepStrictEqual(blocks.area.series.map((s) => s.label), ['High', 'Medium', 'Low']);
  assert.strictEqual(blocks.tiles.tiles[0].value, '24');
  assert.strictEqual(blocks.tiles.tiles[2].value, '26.7 d', '(100*2 + 20*22) / 24');
  const none = widget.buildBlocks({ ...DATA, latest: { ...DATA.latest, areas: { orders: area(0, 0, 0, null), otherModules: area(0, 0, 0, null), platform: area(0, 0, 0, null) } } });
  assert.strictEqual(none.blocks.tiles.tiles[2].value, '—');
  assert.strictEqual(none.blocks.big.tone, 'ok');
});

test('widget: every variant paints; the tall one carries the trend and the breakdown', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(DATA, id, sizes[id], kit).includes('dash-kit-trend'), id);
  const tall = widget.paint(DATA, 'm2', sizes.m2, kit);
  assert.ok(tall.includes('dash-kit-linebox') && tall.includes('dash-kit-tiles'));
  assert.ok(widget.paint(DATA, 'l', sizes.l, kit).includes('dash-kit-area-box'));
  assert.ok(!widget.paint(DATA, 's', sizes.s, kit).includes('dash-kit-linebox'));
});

test('widget: empty states', () => {
  assert.match(widget.buildBlocks({ storage: 'unavailable' }).empty, /Sync window/);
  assert.match(widget.buildBlocks({ storage: 'ok', latest: null }).empty, /refresh it/);
});

test('widget: the labels carry the sprint and the date of the data', () => {
  const { blocks } = widget.buildBlocks(DATA);
  assert.strictEqual(blocks.trend.label, 'Sprint 20 (06.10-20.10) · as of 10.10');
  assert.strictEqual(widget.asOfLabel(null), '');
});

test('widget: a 404 on /widget paints the restart sentence and never fetches /overview', async () => {
  const calls = [];
  const el = { innerHTML: '' };
  globalThis.fetch = async (url) => { calls.push(url); return { ok: false, status: 404, json: async () => ({}) }; };
  try {
    await widget.renderWidget(el, { apiBase: '/api/m/prod-bugs', signal: new AbortController().signal, kit, variant: { id: 'm2', cols: 3, rows: 2 } });
  } finally {
    delete globalThis.fetch;
  }
  assert.deepStrictEqual(calls, ['/api/m/prod-bugs/widget']);
  assert.ok(el.innerHTML.includes('This tile needs a server restart: Settings &gt; Restart server.'));
  assert.strictEqual(widget.RESTART_TEXT, 'This tile needs a server restart: Settings > Restart server.');
});

test('widget: an aborted frame paints nothing', async () => {
  const ctrl = new AbortController();
  const el = { innerHTML: 'old' };
  globalThis.fetch = async () => { ctrl.abort(); return { ok: true, status: 200, json: async () => DATA }; };
  try {
    await widget.renderWidget(el, { apiBase: '/api/m/prod-bugs', signal: ctrl.signal, kit, variant: { id: 'm2', cols: 3, rows: 2 } });
  } finally {
    delete globalThis.fetch;
  }
  assert.strictEqual(el.innerHTML, 'old');
});
