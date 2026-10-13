'use strict';
// tests/test_api_figma_reference.js
// Figma reference: refusals of /api/figma-reference/stream (bad parameters =
// 400 JSON before the stream, test-mode = an SSE `error` event) and the read of
// /api/figma-reference/status for a directory that does not exist. There is no
// live Figma here and there cannot be - a token never reaches this suite.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, apiUrl } = require('./_api_helper');

const PORT = 3578;
const FILE = 'aBcDeFgHiJkLmNoPqRsTuV';
let child;

test.before(async () => {
  child = startServer(PORT, { AUTO_SYNC_ENABLED: '0', FIGMA_TOKEN: '' });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
});

function streamUrl(q) {
  return apiUrl(PORT, `/api/figma-reference/stream?${new URLSearchParams(q).toString()}`);
}

const GOOD = { file: FILE, node: '96560:26612', id: 'proto-test-figma' };

async function expectBad(patch, field) {
  const r = await fetch(streamUrl({ ...GOOD, ...patch }), { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(r.status, 400);
  assert.match(r.headers.get('content-type') || '', /application\/json/);
  const body = await r.json();
  assert.strictEqual(body.error, 'bad-params');
  assert.strictEqual(body.field, field);
  assert.ok(body.message);
}

test('stream: a bad file key is a 400 before any stream opens', async () => {
  await expectBad({ file: 'short' }, 'file');
  await expectBad({ file: '../../etc/passwd-aaaaaaaaaaaaaaaaaaaa' }, 'file');
});

test('stream: a bad node id is a 400', async () => {
  await expectBad({ node: '' }, 'node');
  await expectBad({ node: 'abc' }, 'node');
  await expectBad({ node: '1:2;3:4' }, 'node');
});

test('stream: a bad out id (path characters, uppercase, empty) is a 400', async () => {
  await expectBad({ id: '../x' }, 'id');
  await expectBad({ id: 'A/B' }, 'id');
  await expectBad({ id: '' }, 'id');
});

test('stream: a bad scale is a 400', async () => {
  await expectBad({ scale: '3' }, 'scale');
});

test('stream: valid params under test mode open the stream and answer error test-mode', async () => {
  const r = await fetch(streamUrl({ ...GOOD, node: '96560-26612' }), { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
  const text = await r.text();
  assert.match(text, /event: start/);
  assert.match(text, /event: error/);
  assert.match(text, /"error":"test-mode"/);
  assert.doesNotMatch(text, /event: done/);
});

test('stream: a foreign Origin is refused', async () => {
  const r = await fetch(streamUrl(GOOD), { headers: { Origin: 'https://evil.example' }, signal: AbortSignal.timeout(20000) });
  assert.strictEqual(r.status, 403);
});

test('status: a missing reference answers exists:false, not an error', async () => {
  const { status, body } = await getJson(PORT, '/api/figma-reference/status?id=proto-never-fetched-zzz');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.exists, false);
  assert.strictEqual(body.id, 'proto-never-fetched-zzz');
  assert.strictEqual(body.running, false);
});

test('status: a bad id is a 400', async () => {
  const { status, body } = await getJson(PORT, '/api/figma-reference/status?id=..%2F..%2Fetc');
  assert.strictEqual(status, 400);
  assert.strictEqual(body.field, 'id');
  const missing = await getJson(PORT, '/api/figma-reference/status');
  assert.strictEqual(missing.status, 400);
});
