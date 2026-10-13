'use strict';
// tests/test_api_feedback.js
// POST /api/feedback/submit.
//
// _api_helper always starts the server with NODE_ENV=test, which is exactly
// IS_TEST_MODE - so every case in this file, including the happy one, ends
// at the test-mode gate and never opens a real branch or merge request in
// mission-deck. GITLAB_API_BASE_URL additionally points at a port nothing
// listens on, so even a bug that reordered the gates could not reach a real
// GitLab. Port 3535; 3536 held in reserve (unused - one server covers every
// case here, all of them short-circuiting before any network call).

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, apiUrl, postJson } = require('./_api_helper');

const PORT = 3535;
const UNREACHABLE_API = 'http://127.0.0.1:9/api/v4';
let child;

test.before(async () => {
  child = startServer(PORT, { GITLAB_API_BASE_URL: UNREACHABLE_API });
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

// A minimal, valid PNG signature (89 50 4E 47 0D 0A 1A 0A) - what
// _feedbackImageExt actually reads, padded so a decoded-size test can grow
// the buffer past FEEDBACK_MAX_ATTACHMENT_BYTES without changing the magic
// bytes it starts with.
function pngBytes(totalLength) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const buf = Buffer.alloc(Math.max(totalLength, sig.length));
  sig.copy(buf, 0);
  return buf;
}

function validBody(extra) {
  return Object.assign({
    type: 'bug',
    title: 'The button does not respond',
    description: 'I click and nothing happens.',
    context: { view: '#view-settings', url: 'http://localhost:3001/#view-settings' },
  }, extra || {});
}

test('POST /api/feedback/submit without Content-Type: application/json -> 415', async () => {
  const r = await fetch(apiUrl(PORT, '/api/feedback/submit'), { method: 'POST', body: 'x' });
  assert.strictEqual(r.status, 415);
});

test('POST /api/feedback/submit nieznany type -> 400 invalid-type', async () => {
  const { status, body } = await postJson(PORT, '/api/feedback/submit', validBody({ type: 'skarga' }));
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'invalid-type');
  assert.ok(body.message && /[a-z]/.test(body.message));
});

test('POST /api/feedback/submit empty title -> 400 title-required', async () => {
  const { status, body } = await postJson(PORT, '/api/feedback/submit', validBody({ title: '' }));
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'title-required');
});

test('POST /api/feedback/submit zalacznik o nierozpoznanych bajtach -> 400 unsupported-format', async () => {
  const bad = Buffer.from('this is not any known image format').toString('base64');
  const { status, body } = await postJson(PORT, '/api/feedback/submit', validBody({
    attachments: [{ data: bad }],
  }));
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'unsupported-format');
});

// This is the TESTABLE size gate, not a request-body-cap test: _readRawBody
// destroys the socket before rejecting on an oversized body, so the client
// would see a transport error rather than a clean 413 response. The decoded-
// bytes check inside the handler runs AFTER readBody has already parsed the
// JSON successfully, so it answers a real 413 { error: 'too-large' } - one
// attachment decodes past FEEDBACK_MAX_ATTACHMENT_BYTES (3 MB) while the
// base64 request body itself (~4.7 MB) stays well under FEEDBACK_MAX_BODY_BYTES
// (12 MB).
test('POST /api/feedback/submit attachment over the limit after decoding -> 413 too-large', async () => {
  const big = pngBytes(3.5 * 1024 * 1024).toString('base64');
  const { status, body } = await postJson(PORT, '/api/feedback/submit', validBody({
    attachments: [{ data: big }],
  }));
  assert.strictEqual(status, 413);
  assert.strictEqual(body.error, 'too-large');
});

test('POST /api/feedback/submit a valid report under IS_TEST_MODE -> 200 test-mode, no network', async () => {
  const { status, body } = await postJson(PORT, '/api/feedback/submit', validBody());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'test-mode');
  assert.ok(body.message && /[a-zA-Z]/.test(body.message));
});
