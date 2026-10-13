'use strict';
// tests/test_api_tools_status.js
// GET /api/tools/status - the probe endpoint behind Settings > Tools.
//
// This suite asserts SHAPE, never a particular state. It has to pass on CI and
// on a laptop with no `bw`, no `claude` and no `gitnexus` installed - a test
// that expects 'ok' would go red on exactly the machine the tab exists to
// describe. The one hard rule it does enforce is that no probe leaks a person:
// `bw status` returns userEmail and userId, and neither may reach the response.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');

const PORT = 3490;
const STATES = new Set(['ok', 'warn', 'missing', 'unknown']);
const GROUPS = new Set(['runtime', 'sejf', 'claude', 'weryfikacja']);

let child;

test.before(async () => {
  child = startServer(PORT);
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

test('GET /api/tools/status answers 200 with a well-formed tool list', async () => {
  const { status, body } = await getJson(PORT, '/api/tools/status');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.tools), 'tools must be an array');
  assert.ok(body.tools.length > 0, 'expected at least one probe');
  assert.ok(!Number.isNaN(Date.parse(body.checked_at)), 'checked_at must be an ISO date');
  for (const t of body.tools) {
    assert.strictEqual(typeof t.id, 'string');
    assert.ok(GROUPS.has(t.group), `unknown group ${t.group} on ${t.id}`);
    assert.ok(STATES.has(t.state), `unknown state ${t.state} on ${t.id}`);
    // Three-valued on purpose: false is "not installed", null is "could not tell".
    assert.ok([true, false, null].includes(t.installed), `bad installed on ${t.id}`);
  }
});

test('a missing binary is an answer, never an error', async () => {
  // Whatever this machine lacks must land as missing/unknown on its own row
  // with the response still 200 - the rule handleGitlabSshAccess states for a
  // machine with no ssh binary at all.
  const { status, body } = await getJson(PORT, '/api/tools/status');
  assert.strictEqual(status, 200);
  const ids = body.tools.map(t => t.id);
  for (const id of ['node', 'bitwarden', 'claude-cli', 'chromium', 'gitnexus-index']) {
    assert.ok(ids.includes(id), `probe ${id} missing from the response`);
  }
  // node is the one probe that cannot fail: the server is running on it.
  const node = body.tools.find(t => t.id === 'node');
  assert.strictEqual(node.installed, true);
  assert.strictEqual(node.state, 'ok');
});

test('no probe leaks the person behind the vault', async () => {
  const { body } = await getJson(PORT, '/api/tools/status');
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('userEmail'), 'userEmail must never reach the response');
  assert.ok(!serialized.includes('userId'), 'userId must never reach the response');
  const bw = body.tools.find(t => t.id === 'bitwarden');
  if (bw && bw.detail) {
    assert.deepStrictEqual(Object.keys(bw.detail).sort(), ['lockState', 'serverUrl']);
  }
});

test('refresh=1 bypasses the cache, a plain call may use it', async () => {
  // Written order-independently on purpose: the tests above share this server
  // and have already warmed the cache, so "the first call is cold" would only
  // hold for whichever test happens to run first.
  const forced = await getJson(PORT, '/api/tools/status?refresh=1');
  assert.strictEqual(forced.body.cached, false, 'refresh=1 must re-probe');
  const warm = await getJson(PORT, '/api/tools/status');
  assert.strictEqual(warm.body.cached, true, 'a call inside the TTL must be served warm');
  assert.strictEqual(warm.body.checked_at, forced.body.checked_at, 'the warm answer is the same reading');
  const forcedAgain = await getJson(PORT, '/api/tools/status?refresh=1');
  assert.strictEqual(forcedAgain.body.cached, false, 'refresh=1 must re-probe every time');
});

// ── POST /api/tools/run ─────────────────────────────────────────────────────
// The half of the tab that acts. These tests must NEVER let a real job start:
// they install packages globally and rewrite the developer's index. The handler
// refuses to spawn under NODE_ENV=test (which _api_helper always sets), and the
// first test below is what proves that guard is still in place.

test('POST /api/tools/run never spawns anything under test', async () => {
  const { status, body } = await postJson(PORT, '/api/tools/run', { job: 'gitnexus-reindex' });
  assert.strictEqual(status, 202, 'accepted, not "done"');
  assert.strictEqual(body.started, false);
  assert.strictEqual(body.reason, 'test-mode');
  assert.strictEqual(body.job.running, false, 'no job may be left running behind a test');
});

test('POST /api/tools/run only accepts ids from the server-side table', async () => {
  // The whole safety property of this endpoint: the request names a job, never
  // a command. Anything not in TOOL_JOBS is a 400 before anything can happen.
  for (const job of ['rm -rf /', 'npm install -g evil', '../../etc/passwd', '', null, 42, {}]) {
    const { status, body } = await postJson(PORT, '/api/tools/run', { job });
    assert.strictEqual(status, 400, `job ${JSON.stringify(job)} must be refused`);
    assert.strictEqual(body.error, 'unknown-job');
  }
  const missing = await postJson(PORT, '/api/tools/run', {});
  assert.strictEqual(missing.status, 400);
});

test('POST /api/tools/run rejects a foreign Origin and a non-JSON body', async () => {
  const foreign = await postJson(PORT, '/api/tools/run', { job: 'gitnexus-reindex' },
    { Origin: 'http://evil.example' });
  assert.strictEqual(foreign.status, 403);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/tools/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'x',
  });
  assert.strictEqual(res.status, 415);
});

test('GET /api/tools/status carries the job state, cached or not', async () => {
  // The tab polls the PLAIN endpoint while a job runs, so `job` has to be
  // present on a cache hit too - otherwise a poll would cost a full re-probe.
  const fresh = await getJson(PORT, '/api/tools/status?refresh=1');
  const warm = await getJson(PORT, '/api/tools/status');
  for (const r of [fresh, warm]) {
    assert.ok(r.body.job, 'job must be present');
    assert.strictEqual(r.body.job.running, false);
    assert.deepStrictEqual(
      Object.keys(r.body.job).sort(),
      ['error', 'finishedAt', 'id', 'ok', 'restartRequired', 'running', 'startedAt']);
  }
  assert.strictEqual(warm.body.cached, true);
});
