'use strict';
// tests/test_api_modules.js
// API tests for the plug-and-play module system.
// Server is started with MODULES_DIR pointing at tests/fixtures/modules so the
// fixture-mod module is loaded without touching the real modules/ directory.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');

const PORT = 3506;
const MODULES_DIR = require('node:path').resolve(__dirname, 'fixtures/modules');
let child;

test.before(async () => {
  child = startServer(PORT, { MODULES_DIR });
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

// Helper: raw HTTP GET that sends the path as-is, bypassing fetch URL normalization.
function rawGet(port, rawPath) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

test('GET /api/modules/manifest returns fixture-mod with no errors', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/manifest');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.modules), 'modules must be an array');
  assert.ok(Array.isArray(body.errors), 'errors must be an array');
  assert.strictEqual(typeof body.modulesDir, 'string', 'modulesDir must be a string');
  assert.strictEqual(body.errors.length, 0, 'expected no errors, got: ' + JSON.stringify(body.errors));
  const ids = body.modules.map(m => m.id);
  assert.ok(ids.includes('fixture-mod'), 'fixture-mod missing from modules list');
});

test('GET /api/modules/manifest returns both the item and the hub fixture, shapes intact', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/manifest');
  assert.strictEqual(status, 200);

  const itemMod = body.modules.find(m => m.id === 'fixture-mod');
  assert.ok(itemMod, 'fixture-mod missing from modules list');
  assert.strictEqual(itemMod.manifest.sidebar.kind, 'item');
  assert.strictEqual(itemMod.manifest.views.length, 1);

  const hubMod = body.modules.find(m => m.id === 'fixture-hub');
  assert.ok(hubMod, 'fixture-hub missing from modules list');
  assert.strictEqual(hubMod.manifest.sidebar.kind, 'hub');
  assert.strictEqual(hubMod.manifest.views.length, 2);
  const viewIds = hubMod.manifest.views.map(v => v.id);
  assert.deepStrictEqual(viewIds, ['fixture-hub-lista', 'fixture-hub-raport']);
});

test('GET /api/m/fixture-mod/ping returns pong', async () => {
  const { status, body } = await getJson(PORT, '/api/m/fixture-mod/ping');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.pong, true);
  assert.strictEqual(body.id, 'fixture-mod');
});

test('POST /api/m/fixture-mod/echo echoes body', async () => {
  const { status, body } = await postJson(PORT, '/api/m/fixture-mod/echo', { test: 1 });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.echo.test, 1);
});

test('GET /modules/fixture-mod/client/index.js returns 200', async () => {
  const { status } = await getJson(PORT, '/modules/fixture-mod/client/index.js');
  assert.strictEqual(status, 200);
});

test('GET /modules/fixture-mod/server/index.js returns 404 (server/ blocked)', async () => {
  const { status } = await getJson(PORT, '/modules/fixture-mod/server/index.js');
  assert.strictEqual(status, 404);
});

test('GET traversal attempt /modules/fixture-mod/client/../../server/index.js returns 403 or 404', async () => {
  // Use raw http.request to send the literal path without client-side normalization.
  const { status } = await rawGet(PORT, '/modules/fixture-mod/client/../../server/index.js');
  assert.ok(status === 403 || status === 404, 'expected 403 or 404, got ' + status);
});

test('GET with an encoded backslash /modules%5Cfixture-mod%5Cserver%5Cindex.js returns 404', async () => {
  // On win32 a backslash is a path separator: it must never slip past the
  // '/modules/<id>/client/' gate into the plain ROOT static branch.
  const { status } = await rawGet(PORT, '/modules%5Cfixture-mod%5Cserver%5Cindex.js');
  assert.strictEqual(status, 404);
});

test('GET /api/m/nieistniejacy/x returns 404 JSON', async () => {
  const { status, body } = await getJson(PORT, '/api/m/nieistniejacy/x');
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'not-found');
});
