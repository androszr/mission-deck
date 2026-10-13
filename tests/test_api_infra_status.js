'use strict';
// tests/test_api_infra_status.js
// GET /api/infra/status and POST /api/infra/recheck - the reachability
// verdict behind the strip under the top bar. GITLAB_API_BASE_URL points at
// a port nothing listens on, so the recheck fails on ECONNREFUSED in
// milliseconds and never reaches gitlab.com; the fake app token authorises
// only requests aimed at that dead port.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');

const PORT = 3492;
const UNREACHABLE_API = 'http://127.0.0.1:9/api/v4';
let child;

test.before(async () => {
  child = startServer(PORT, {
    GITLAB_API_BASE_URL: UNREACHABLE_API,
    COCKPIT_APP_TOKEN: 'glpat-testtesttesttesttest',
  });
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

test('GET /api/infra/status is a register read: always 200, one of four states', async () => {
  const { status, body } = await getJson(PORT, '/api/infra/status');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(['unknown', 'reachable', 'refused', 'unreachable'].includes(body.network.state), body.network.state);
  assert.ok('since' in body.network && 'source' in body.network);
});

test('POST /api/infra/recheck probes GitLab once and the verdict flips to unreachable on a dead host', async () => {
  const { status, body } = await postJson(PORT, '/api/infra/recheck', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.probed, true);
  assert.strictEqual(body.network.state, 'unreachable');
  assert.strictEqual(body.network.source, 'identity');
  assert.match(body.network.since, /^\d{4}-\d{2}-\d{2}T/);
  // The status route now reads the same verdict.
  const after = await getJson(PORT, '/api/infra/status');
  assert.strictEqual(after.body.network.state, 'unreachable');
  assert.ok(!JSON.stringify(body).includes('glpat-'), 'the verdict must not echo a token');
});

test('POST /api/infra/recheck without JSON is 415 - checkOrigin, like every other mutating route', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/infra/recheck`, { method: 'POST' });
  assert.strictEqual(r.status, 415);
});

test('POST /api/infra/recheck with no token probes nothing and says so', async () => {
  const port = PORT + 4;
  const c = startServer(port, { GITLAB_API_BASE_URL: UNREACHABLE_API, COCKPIT_APP_TOKEN: '' });
  try {
    await waitForServer(port);
    const { status, body } = await postJson(port, '/api/infra/recheck', {});
    assert.strictEqual(status, 200);
    assert.strictEqual(body.probed, false);
    assert.strictEqual(body.reason, 'no-token');
    // Nothing was tried, so the register is untouched: "no token" is the
    // vault's story, not the network's.
    assert.strictEqual(body.network.state, 'unknown');
  } finally {
    await stopServer(c);
  }
});

// The reported 2026-09-16 case, end to end: a GitLab that ANSWERS and turns
// the caller away. On a public host behind a group IP allowlist that is what
// a missing VPN looks like, and it used to land on `reachable` - a machine
// locked out of everything with a hidden strip. A stub that answers 401 to
// the app credential stands in for the allowlist; nothing here reaches
// gitlab.com (under IS_TEST_MODE the recheck skips its `ls-remote` on the
// app repository, which would resolve to this checkout's real origin - that
// half of the probe is pinned by source in tests/test_infra_banner.mjs and
// its classification in tests/test_server_helpers.mjs).
test('POST /api/infra/recheck: a GitLab that answers 401 is `refused`, never `reachable`', async () => {
  const stubPort = PORT + 6;
  const port = PORT + 8;
  const stub = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"message":"401 Unauthorized"}');
  });
  await new Promise((resolve) => stub.listen(stubPort, '127.0.0.1', resolve));
  const c = startServer(port, {
    GITLAB_API_BASE_URL: `http://127.0.0.1:${stubPort}/api/v4`,
    COCKPIT_APP_TOKEN: 'glpat-testtesttesttesttest',
  });
  try {
    await waitForServer(port);
    const { status, body } = await postJson(port, '/api/infra/recheck', {});
    assert.strictEqual(status, 200);
    assert.strictEqual(body.probed, true);
    assert.strictEqual(body.network.state, 'refused');
    assert.strictEqual(body.network.source, 'identity');
    // The register read agrees - the strip and the probe cannot disagree.
    const after = await getJson(port, '/api/infra/status');
    assert.strictEqual(after.body.network.state, 'refused');
    assert.ok(!JSON.stringify(body).includes('glpat-'), 'the verdict must not echo a token');
  } finally {
    await stopServer(c);
    await new Promise((resolve) => stub.close(resolve));
  }
});
