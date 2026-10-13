// rollout-waves/tests/test_rollout_waves_widget.mjs
// Dashboard widgets contract: manifest widgets[] passes the host validator, the
// widget file imports in plain Node, painters and empty states, shared fetch.

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

const TODAY = '2026-10-11';
const PAYLOAD = {
  available: true, storage: 'ok', directory: { present: true }, generated_at: '2026-10-10T08:00:00+00:00',
  kpi: { no_wave: 73, locations_count: 3000, live: 1200, to_go_live: 1800, progress_pct: 40, trainings_done: 1500, trainings_total: 3000, webinar_done: 900, webinar_total: 3000 },
  next_start: { wave: 5, start: '2026-10-21', locations_count: 400 },
  waves: [
    { wave: 3, start: '2026-10-01', webinar_date: '2026-09-28', locations_count: 300, pct_training: 100, pct_webinar: 90, status: 'done' },
    { wave: 5, start: '2026-10-21', webinar_date: '2026-10-19', locations_count: 400, pct_training: 55.5, pct_webinar: 20, status: 'current' },
    { wave: 6, start: '2026-11-04', webinar_date: '2026-11-02', locations_count: 350, pct_training: 0, pct_webinar: 0, status: 'planned' },
  ],
};
const SIZES = { s: [2, 1], s2: [2, 2], m: [3, 1], m2: [3, 2], l: [6, 1], xl: [6, 2] };
const sz = (v) => ({ cols: SIZES[v][0], rows: SIZES[v][1] });

test('manifest: two widgets accepted by the host validator', () => {
  const r = validateModuleManifest(manifest, 'rollout-waves');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  assert.deepStrictEqual(manifest.widgets.map((w) => w.id), ['rollout-progress', 'rollout-next-waves']);
  for (const w of manifest.widgets) {
    assert.ok(w.variants.some((v) => v.rows === 2));
    assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  }
});

test('exports', () => {
  for (const n of ['renderWidget', 'fromDashboard', 'sharedLoad', 'paint', 'buildProgressBlocks', 'buildWavesBlocks', 'locations', 'asOfLabel']) assert.strictEqual(typeof widget[n], 'function', n);
});

test('fromDashboard drops realised rounds', () => {
  const d = widget.fromDashboard(PAYLOAD, TODAY);
  assert.deepStrictEqual(d.waves.map((t) => t.wave), [5, 6]);
  assert.strictEqual(d.nextStart.wave, 5);
});

test('progress: waffle shares, tiles, pill when no round is left', () => {
  const d = widget.fromDashboard(PAYLOAD, TODAY);
  const { blocks } = widget.buildProgressBlocks(d);
  assert.strictEqual(blocks.waffle.center, '40%');
  assert.deepStrictEqual(blocks.waffle.parts.map((p) => p.value), [40, 58, 2]);
  assert.deepStrictEqual(blocks.tiles.tiles.map((t) => t.value), ['1200', '1800', '73'], 'To go live = kpi.to_go_live, the module view number');
  assert.deepStrictEqual(blocks.waffle.parts.map((p) => p.label), ['live', 'in waves', 'no wave']);
  assert.match(blocks.waffle.caption, /as of 10\.10$/);
  assert.strictEqual(blocks.progress.rows[0].max, 3000, 'trainings_total');
  assert.strictEqual(blocks.timeline.events[0].date, '21.10');
  const none = widget.fromDashboard({ ...PAYLOAD, next_start: null }, TODAY);
  assert.strictEqual(widget.buildProgressBlocks(none).blocks.timeline.text, 'Every wave has started');
});

test('waves: chronological, past webinars dropped, singular and plural', () => {
  const d = widget.fromDashboard({ ...PAYLOAD, waves: [
    { wave: 1, start: '2026-10-13', webinar_date: '2026-09-29', locations_count: 783, pct_training: 0, pct_webinar: 0, status: 'current' },
    { wave: 3, start: '2026-10-27', webinar_date: '2026-10-13', locations_count: 1, pct_training: 0, pct_webinar: 0, status: 'current' },
    { wave: 2, start: '2026-10-20', webinar_date: '2026-10-06', locations_count: 800, pct_training: 0, pct_webinar: 0, status: 'current' },
  ] }, TODAY);
  const ev = widget.buildWavesBlocks(d).blocks.timeline.events;
  assert.deepStrictEqual(ev.map((e) => e.date), ['13.10', '13.10', '20.10', '27.10']);
  assert.deepStrictEqual(ev.map((e) => e.label), ['Wave 1 · 783 locations', 'Webinar · wave 3', 'Wave 2 · 800 locations', 'Wave 3 · 1 location']);
  assert.ok(!ev.some((e) => e.date === '29.09' || e.date === '06.10'), 'past webinars are not upcoming events');
  assert.strictEqual(widget.locations(12), '12 locations');
  assert.strictEqual(widget.locations(1), '1 location');
});

test('every variant of both widgets paints', () => {
  const d = widget.fromDashboard(PAYLOAD, TODAY);
  for (const w of manifest.widgets) {
    for (const v of w.variants) {
      const html = widget.paint(d, w.id, v.id, { cols: v.cols, rows: v.rows }, kit);
      assert.ok(html.length > 0 && !html.includes('dash-kit-empty'), w.id + '/' + v.id);
    }
  }
  assert.ok(widget.paint(d, 'rollout-next-waves', 'm', sz('m'), kit).includes('Wave 5'));
});

test('empty states: no clone, no directory, no rounds left', () => {
  const none = widget.fromDashboard({ available: false, storage: 'unavailable' }, TODAY);
  assert.ok(widget.paint(none, 'rollout-progress', 'm', sz('m'), kit).includes('Sync window'));
  assert.ok(widget.paint(none, 'rollout-next-waves', 'm', sz('m'), kit).includes('Sync window'));
  const nocat = widget.fromDashboard({ available: true, storage: 'ok', directory: { present: false }, kpi: null, waves: [] }, TODAY);
  assert.ok(widget.paint(nocat, 'rollout-progress', 'm', sz('m'), kit).includes('No locations directory'));
  const done = widget.fromDashboard({ ...PAYLOAD, waves: [PAYLOAD.waves[0]] }, TODAY);
  assert.ok(widget.paint(done, 'rollout-next-waves', 'xl', sz('xl'), kit).includes('No waves planned.'));
});

test('sharedLoad: two callers, one request; 500 message surfaces', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => PAYLOAD }; };
  try {
    const [a, b] = await Promise.all([widget.sharedLoad('/api/m/x', null), widget.sharedLoad('/api/m/x', null)]);
    assert.strictEqual(calls, 1);
    assert.strictEqual(a, b);
    await widget.sharedLoad('/api/m/x', null);
    assert.strictEqual(calls, 2, 'cleared on settle');
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'dashboard-failed', message: 'Something failed' }) });
    const el = { innerHTML: '' };
    await widget.renderWidget(el, { apiBase: '/api/m/y', widgetId: 'rollout-next-waves', variant: { id: 'm', cols: 3, rows: 1 }, kit });
    assert.ok(el.innerHTML.includes('Something failed'));
  } finally { globalThis.fetch = realFetch; }
});
