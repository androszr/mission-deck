'use strict';
// tests/test_api_module_prefix_routes.js
// T1: core API tests for prefix-route support in handleModuleRoute.
// Uses the fixture-mod module which registers GET /x/* (prefix) and
// GET /x/exact (exact — must win over prefix).

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson } = require('./_api_helper');
const path = require('node:path');

const PORT = 3540;
const MODULES_DIR = path.resolve(__dirname, 'fixtures/modules');
let child;

test.before(async () => {
  child = startServer(PORT, { MODULES_DIR });
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

test('T1a: GET /api/m/fixture-mod/x/a/b is matched by /x/* with moduleRest="a/b"', async () => {
  const { status, body } = await getJson(PORT, '/api/m/fixture-mod/x/a/b');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.rest, 'a/b', 'moduleRest must equal the remainder after the prefix');
});

test('T1b: GET /api/m/fixture-mod/x/one is matched by /x/* with moduleRest="one"', async () => {
  const { status, body } = await getJson(PORT, '/api/m/fixture-mod/x/one');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.rest, 'one');
});

test('T1b2: the longest prefix wins over one registered earlier', async () => {
  const { status, body } = await getJson(PORT, '/api/m/fixture-mod/x/deep/a/b');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body, { deep: 'a/b' });
});

test('T1c: exact route /x/exact takes priority over prefix /x/*', async () => {
  const { status, body } = await getJson(PORT, '/api/m/fixture-mod/x/exact');
  assert.strictEqual(status, 200);
  assert.ok(body.exact === true, 'exact route must win over prefix route');
  assert.ok(!('rest' in body), 'prefix handler must not have run');
});

test('T1d: path traversal via encoded .. is rejected with 400', async () => {
  // %2F is "/" and %2E%2E is ".." - bypass URL normalization
  const { status, body } = await getJson(PORT, '/api/m/fixture-mod/x/..%2Fping');
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'invalid-path');
});

test('T1d2: path traversal via encoded backslash is rejected with 400', async () => {
  const { status, body } = await getJson(PORT, '/api/m/fixture-mod/x/a/..%5Cping');
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'invalid-path');
});

test('T1e: unmatched route returns 404', async () => {
  const { status, body } = await getJson(PORT, '/api/m/fixture-mod/no-such-route');
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'not-found');
});
