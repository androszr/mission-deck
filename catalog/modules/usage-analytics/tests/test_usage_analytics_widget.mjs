// Dashboard widget contract: manifest widgets[] passes the host validator, the widget
// file exports renderWidget and imports in plain Node, blocks per variant, empty states.
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

const DATA = {
  ok: true, generated_at: '2026-10-09T10:00:00Z', last_full_day: '2026-10-08', modulesTotal: 24, modulesInUse: 16,
  kpi: { active_users: 41, sessions: 312, page_views: 2940, modules_in_use: 17, median_view_ms: 34000, delta: { active_users_pct: 8, sessions_pct: 12, page_views_pct: -3 } },
  daily: Array.from({ length: 14 }, (_, i) => ({ date: '2026-09-' + String(25 + (i % 5)).padStart(2, '0'), page_views: 100 + i, active_users: 20 + i })),
  topModules: [{ id: 'a', label: 'Pulpit', page_views: 612 }, { id: 'b', label: 'Roadmapa AR', page_views: 274 }],
};

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'usage-analytics');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'usage-traffic');
  assert.ok(w.variants.length <= 6);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2));
});

test('widget: exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: tones follow the direction of change, a null delta is neutral', () => {
  const { blocks } = widget.buildBlocks(DATA);
  assert.deepStrictEqual(blocks.tiles.tiles.map((t) => t.tone), ['ok', 'ok', 'warn']);
  assert.strictEqual(blocks.tiles.tiles[2].delta, '-3%');
  assert.strictEqual(blocks.tiles.tiles[2].value, '2 940');
  const nul = widget.buildBlocks({ ...DATA, kpi: { ...DATA.kpi, delta: { active_users_pct: null, sessions_pct: null, page_views_pct: null } } });
  assert.strictEqual(nul.blocks.tiles.tiles[0].tone, 'neutral');
  assert.strictEqual(nul.blocks.tiles.tiles[0].delta, '');
  assert.strictEqual(blocks.gauge.max, 24);
  assert.strictEqual(blocks.gauge.value, 16, 'gauge uses modulesInUse, never kpi.modules_in_use (counts core)');
  assert.strictEqual(blocks.gauge.zones, undefined, 'no invented target zones');
});

test('widget: every variant shows the data date (last_full_day)', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(DATA, id, sizes[id], kit).includes('08.10'), id);
  assert.strictEqual(widget.buildBlocks({ ...DATA, modulesInUse: undefined }).blocks.gauge, undefined);
});

test('widget: every variant paints its blocks', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(DATA, id, sizes[id], kit).length > 50, id);
  assert.ok(widget.paint(DATA, 'm2', sizes.m2, kit).includes('dash-kit-linebox'));
  assert.ok(!widget.paint(DATA, 'm', sizes.m, kit).includes('dash-kit-linebox'));
  assert.ok(widget.paint(DATA, 'xl', sizes.xl, kit).includes('Pulpit'));
});

test('widget: empty states, and a 404 never falls back to /data', async () => {
  assert.match(widget.buildBlocks({ ok: false, error: 'storage-unavailable' }).empty, /Sync window/);
  assert.match(widget.buildBlocks({ ok: false, error: 'no-data' }).empty, /Refresh/);
  const urls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (u) => { urls.push(u); return { ok: false, status: 404 }; };
  try {
    const el = { innerHTML: '' };
    await widget.renderWidget(el, { apiBase: '/api/m/x', kit, variant: { id: 'm2', cols: 3, rows: 2 } });
    assert.deepStrictEqual(urls, ['/api/m/x/widget']);
    assert.strictEqual(el.innerHTML, kit.empty('This tile needs a server restart: Settings > Restart server.'));
  } finally { globalThis.fetch = saved; }
});

test('widget: an aborted render paints nothing', async () => {
  const saved = globalThis.fetch;
  const ac = new AbortController();
  globalThis.fetch = async () => { ac.abort(); return { ok: true, status: 200, json: async () => DATA }; };
  try {
    const el = { innerHTML: 'x' };
    await widget.renderWidget(el, { apiBase: '/api/m/x', kit, signal: ac.signal, variant: { id: 'm2', cols: 3, rows: 2 } });
    assert.strictEqual(el.innerHTML, 'x');
  } finally { globalThis.fetch = saved; }
});
