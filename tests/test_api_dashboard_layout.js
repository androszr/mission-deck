'use strict';
// tests/test_api_dashboard_layout.js
// GET/PUT /api/dashboard/layout against tests/fixtures/modules.
// DASHBOARD_LAYOUT_FILE points at a temp file so the real data/ is never touched.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, waitForServer, stopServer, getJson, putJson, apiUrl } = require('./_api_helper');

const PORT = 3579;
const MODULES_DIR = path.resolve(__dirname, 'fixtures/modules');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-layout-'));
const LAYOUT_FILE = path.join(TMP, 'dashboard-layout.json');
let child;

test.before(async () => {
  child = startServer(PORT, { MODULES_DIR, DASHBOARD_LAYOUT_FILE: LAYOUT_FILE });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('GET with no saved file: empty layout, catalog has declared and fallback widgets', async () => {
  const { status, body } = await getJson(PORT, '/api/dashboard/layout');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.hasModules, true);
  assert.deepStrictEqual(body.layout, { version: 1, items: [] });
  const mod = body.available.find((a) => a.module === 'fixture-mod');
  assert.ok(mod && mod.widgets.some((w) => w.id === 'licznik' && w.builtin === false));
  const hub = body.available.find((a) => a.module === 'fixture-hub');
  assert.ok(hub && hub.widgets.length === 1 && hub.widgets[0].id === 'shortcut' && hub.widgets[0].builtin === true);
  assert.strictEqual(hub.entryView, 'fixture-hub-lista');
});

test('PUT round-trip persists and GET returns it', async () => {
  const items = [
    { module: 'fixture-hub', widget: 'shortcut', variant: 's' },
    { module: 'fixture-mod', widget: 'licznik', variant: 'm' },
  ];
  const put = await putJson(PORT, '/api/dashboard/layout', { items });
  assert.strictEqual(put.status, 200);
  assert.strictEqual(put.body.ok, true);
  assert.deepStrictEqual(put.body.layout.items, items);
  const got = await getJson(PORT, '/api/dashboard/layout');
  assert.deepStrictEqual(got.body.layout.items, items);
  assert.ok(!fs.existsSync(LAYOUT_FILE + '.tmp'));
});

test('GET filters a stale item without rewriting the file', async () => {
  const stale = { version: 1, items: [
    { module: 'gone-module', widget: 'x', variant: 's' },
    { module: 'fixture-mod', widget: 'licznik', variant: 'nope' },
  ] };
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(stale));
  const before = fs.readFileSync(LAYOUT_FILE, 'utf8');
  const got = await getJson(PORT, '/api/dashboard/layout');
  assert.deepStrictEqual(got.body.layout.items, [{ module: 'fixture-mod', widget: 'licznik', variant: 's' }]);
  assert.strictEqual(fs.readFileSync(LAYOUT_FILE, 'utf8'), before);
});

test('PUT with unknown module, widget or variant answers 400 and writes nothing', async () => {
  const before = fs.readFileSync(LAYOUT_FILE, 'utf8');
  for (const bad of [
    { module: 'nope', widget: 'shortcut', variant: 's' },
    { module: 'fixture-mod', widget: 'nope', variant: 's' },
    { module: 'fixture-mod', widget: 'licznik', variant: 'xl' },
  ]) {
    const r = await putJson(PORT, '/api/dashboard/layout', { items: [bad] });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error, 'invalid-layout');
    assert.strictEqual(r.body.index, 0);
  }
  assert.strictEqual(fs.readFileSync(LAYOUT_FILE, 'utf8'), before);
});

test('PUT with a duplicate or non-array items answers 400', async () => {
  const dup = { module: 'fixture-mod', widget: 'licznik', variant: 's' };
  const r1 = await putJson(PORT, '/api/dashboard/layout', { items: [dup, dup] });
  assert.strictEqual(r1.status, 400);
  assert.strictEqual(r1.body.index, 1);
  const r2 = await putJson(PORT, '/api/dashboard/layout', { items: 'x' });
  assert.strictEqual(r2.status, 400);
  assert.strictEqual(r2.body.error, 'invalid-layout');
});

test('PUT without a JSON content type answers 415', async () => {
  const r = await fetch(apiUrl(PORT, '/api/dashboard/layout'), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: '{"items":[]}',
  });
  assert.strictEqual(r.status, 415);
});
