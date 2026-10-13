'use strict';
// tests/test_api_prototypes_local_preview_status.js
// GET /api/prototypes/local-preview-status - the read behind the local preview
// progress modal. In test mode the preview never starts (POST answers 503),
// so the route always sees "nothing running"; we check the answer's shape,
// the id validation, and that the dispatch does not hand it to the generic route
// /api/prototypes/<id>.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson } = require('./_api_helper');

const PORT = 3493;
let child;

test.before(async () => {
  child = startServer(PORT);
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

test('no run: active false and the full shape', async () => {
  const { status, body } = await getJson(PORT, '/api/prototypes/local-preview-status?id=proto-missing');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.active, false);
  assert.strictEqual(body.phase, null);
  assert.strictEqual(body.install, null);
  assert.strictEqual(typeof body.now, 'number');
});

test('no id is 200 too - the install state is shared', async () => {
  const { status, body } = await getJson(PORT, '/api/prototypes/local-preview-status');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.active, false);
});

test('nieprawidlowe id -> 400', async () => {
  const { status } = await getJson(PORT, '/api/prototypes/local-preview-status?id=..%2Fetc');
  assert.strictEqual(status, 400);
});
