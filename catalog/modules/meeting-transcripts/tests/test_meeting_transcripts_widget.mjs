// modules/meeting-transcripts/tests/test_meeting_transcripts_widget.mjs
// Dashboard widget contract: manifest widgets[] passes the host validator, the
// widget file exports renderWidget, and the painter turns the GET /queue body into
// the right blocks per variant. Read-only: the test never calls a route.

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
const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'meeting-transcripts');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'transcription-queue');
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2), 'at least one two-row variant');
});

test('widget: client/widget.js exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

const NOW = new Date(2026, 9, 11, 10, 0, 0);
const at = (days, h) => new Date(2026, 9, 11 + days, h, 0, 0).toISOString();
const item = (status) => ({ id: status + Math.random(), status, createdAt: '2026-10-11T08:00:00Z' });
const QUEUE = {
  items: [item('processing'), item('queued'), item('queued'), item('done'), item('done')],
  current: { id: 'a', percent: 45.4, step: 'Transcription', log: ['secret line'] },
  blocked: null,
  paused: false,
  nextRunAt: at(1, 7),
};

test('widget: counts only - progress ring, segments, next run; no log text', () => {
  const { blocks, empty } = widget.buildBlocks(QUEUE, NOW);
  assert.strictEqual(empty, null);
  assert.strictEqual(blocks.pill.tone, 'info');
  assert.match(blocks.pill.text, /Processing \(45%\)/);
  assert.match(blocks.pill.sub, /3 queued · next run tomorrow 07:00/);
  assert.strictEqual(blocks.donut.value, 45);
  assert.deepStrictEqual(blocks.segments.segments.map((x) => x.value), [2, 1, 2]);
  assert.doesNotMatch(JSON.stringify(blocks), /secret line/);
});

test('widget: empty queue is an ok pill, also after a restart (current null)', () => {
  const { blocks } = widget.buildBlocks({ items: [], current: null, blocked: null, paused: false, nextRunAt: null }, NOW);
  assert.strictEqual(blocks.pill.tone, 'ok');
  assert.strictEqual(blocks.pill.text, 'Queue empty');
  assert.strictEqual(blocks.donut, undefined);
  assert.strictEqual(blocks.segments, undefined);
});

test('widget: failed, blocked and paused states pick the tone', () => {
  const base = { items: [], current: null, blocked: null, paused: false, nextRunAt: null };
  const failed = widget.buildBlocks({ ...base, items: [item('failed'), item('failed')] }, NOW).blocks.pill;
  assert.strictEqual(failed.tone, 'error');
  assert.match(failed.text, /2 recordings failed/);
  assert.strictEqual(widget.buildBlocks({ ...base, items: [item('queued')], blocked: { error: 'no-key' } }, NOW).blocks.pill.tone, 'warn');
  assert.match(widget.buildBlocks({ ...base, paused: true }, NOW).blocks.pill.text, /paused by hand/);
});

test('widget: an expired Microsoft session or scan errors are never an ok pill', () => {
  const base = { items: [], current: null, blocked: null, paused: false, nextRunAt: null };
  const run = (scan) => ({ ...base, lastRun: { id: 'r', scan } });
  const expired = widget.buildBlocks(run({ folders: 5, errors: [], expired: true }), NOW).blocks.pill;
  assert.strictEqual(expired.tone, 'warn');
  assert.match(expired.text, /Microsoft session expired/);
  const errs = widget.buildBlocks(run({ folders: 5, errors: [{ code: 'x' }, { code: 'y' }], expired: false }), NOW).blocks.pill;
  assert.strictEqual(errs.tone, 'warn');
  assert.match(errs.text, /OneDrive download errors: 2/);
  assert.strictEqual(widget.buildBlocks(run({ folders: 5, errors: [], expired: false }), NOW).blocks.pill.tone, 'ok');
  // a failed item still outranks the scan state
  assert.strictEqual(widget.buildBlocks({ ...run({ expired: true }), items: [item('failed')] }, NOW).blocks.pill.tone, 'error');
});

test('widget: malformed body -> sentence; blocks per variant; 2x1 one block', () => {
  assert.match(widget.paint({}, 's', sizes.s, kit, NOW), /dash-kit-empty/);
  const s = widget.paint(QUEUE, 's', sizes.s, kit, NOW);
  assert.strictEqual((s.match(/dash-kit-pillbox/g) || []).length, 1);
  assert.doesNotMatch(s, /dash-kit-donut|dash-kit-seg"/);
  const m2 = widget.paint(QUEUE, 'm2', sizes.m2, kit, NOW);
  assert.match(m2, /dash-kit-donut/);
  assert.match(m2, /dash-kit-seg/);
  assert.strictEqual(widget.formatNext(at(0, 15), NOW), 'today 15:00');
});

test('widget: renderWidget GETs queue only and throws on HTTP errors', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push([url, init]); return { ok: false, status: 404 }; };
  try {
    await assert.rejects(widget.renderWidget({ innerHTML: '' }, { apiBase: '/api/m/meeting-transcripts', signal: null, kit, variant: { id: 's', cols: 2, rows: 1 } }), /HTTP 404/);
    assert.strictEqual(calls[0][0], '/api/m/meeting-transcripts/queue');
    assert.ok(!calls[0][1] || !calls[0][1].method || calls[0][1].method === 'GET');
  } finally { globalThis.fetch = realFetch; }
});
