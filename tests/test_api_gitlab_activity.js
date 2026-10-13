'use strict';
// tests/test_api_gitlab_activity.js
// GET /api/gitlab-activity/active-count and GET /api/gitlab-activity/data.
//
// GITLAB_API_BASE_URL points at a port nothing listens on for the second
// server, so no test in this file can ever reach gitlab.com. TEST_ENV_FILE
// points at a nonexistent path on BOTH servers: readEnvFile() wins over
// process.env (server.js), so without it a developer's real
// COCKPIT_OWNER_TOKEN in .env would leak into the "no credential" assertions
// and make them pass only on a machine that happens to have no token set.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, apiUrl, getJson } = require('./_api_helper');

const PORT = 3508;
const PORT_WITH_TOKEN = PORT + 20; // 3528, per the plan's "second server: +20"
const UNREACHABLE_API = 'http://127.0.0.1:9/api/v4';

let child;
let childWithToken;

// Guaranteed not to exist, so the "GitLab unreachable, no snapshot yet" test
// below is deterministic regardless of what a real machine has ever written
// to the real data/gitlab-token-activity.json (see server.js's
// TEST_GITLAB_ACTIVITY_SNAPSHOT_PATH override, next to TEST_SYNC_LOG_DIR).
const NONEXISTENT_SNAPSHOT_PATH = '/nonexistent/gitlab-token-activity.json';

test.before(async () => {
  child = startServer(PORT, {
    TEST_ENV_FILE: '/nonexistent/.env',
    COCKPIT_OWNER_TOKEN: '',
    TEST_GITLAB_ACTIVITY_SNAPSHOT_PATH: NONEXISTENT_SNAPSHOT_PATH,
  });
  await waitForServer(PORT);

  childWithToken = startServer(PORT_WITH_TOKEN, {
    TEST_ENV_FILE: '/nonexistent/.env',
    GITLAB_API_BASE_URL: UNREACHABLE_API,
    // Deliberately fake: it never leaves this process, and every request it
    // authorises is aimed at the unreachable base URL above.
    COCKPIT_OWNER_TOKEN: 'glpat-testtesttesttesttest',
    TEST_GITLAB_ACTIVITY_SNAPSHOT_PATH: NONEXISTENT_SNAPSHOT_PATH,
  });
  await waitForServer(PORT_WITH_TOKEN);
});

test.after(async () => {
  await stopServer(child);
  await stopServer(childWithToken);
});

// ── No credential: the normal state for most of the team ────────────────────

test('GET /api/gitlab-activity/active-count with no credential answers 200 with error: no_token', async () => {
  const { status, body } = await getJson(PORT, '/api/gitlab-activity/active-count');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.count, null);
  assert.strictEqual(body.error, 'no_token');
  assert.deepStrictEqual(body.people, []);
});

test('GET /api/gitlab-activity/data with no credential answers 200 with one repo row per activity target', async () => {
  const { status, body } = await getJson(PORT, '/api/gitlab-activity/data');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.token_available, false);
  // GITLAB_ACTIVITY_TARGETS, not GITLAB_TOKEN_TARGETS: the modules-catalog
  // target opts out of the activity badge (activity: false) because that
  // repository does not exist yet and would sink the badge for the whole
  // team the moment any target in the loop answers with an error.
  const targets = require('../server.js').GITLAB_ACTIVITY_TARGETS;
  assert.strictEqual(body.repos.length, targets.length);
});

// ── Credential present, GitLab unreachable ───────────────────────────────────

test('GET /api/gitlab-activity/active-count with an unreachable GitLab answers error: gitlab_error', async () => {
  const { status, body } = await getJson(PORT_WITH_TOKEN, '/api/gitlab-activity/active-count');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.count, null);
  assert.strictEqual(body.error, 'gitlab_error');
  assert.deepStrictEqual(body.people, []);
});

test('GET /api/gitlab-activity/data with an unreachable GitLab answers error: gitlab_error', async () => {
  const { status, body } = await getJson(PORT_WITH_TOKEN, '/api/gitlab-activity/data');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.token_available, true);
  assert.strictEqual(body.error, 'gitlab_error');
});

test('neither response leaks a glpat- token value', async () => {
  const count = await getJson(PORT_WITH_TOKEN, '/api/gitlab-activity/active-count');
  const data = await getJson(PORT_WITH_TOKEN, '/api/gitlab-activity/data');
  assert.ok(!JSON.stringify(count.body).includes('glpat-'), 'active-count must never echo a token');
  assert.ok(!JSON.stringify(data.body).includes('glpat-'), 'data must never echo a token');
});

// ── Origin check ──────────────────────────────────────────────────────────

test('a foreign Origin is rejected on both routes', async () => {
  const r1 = await fetch(apiUrl(PORT, '/api/gitlab-activity/active-count'), {
    headers: { Origin: 'https://evil.example' },
  });
  assert.strictEqual(r1.status, 403);
  const r2 = await fetch(apiUrl(PORT, '/api/gitlab-activity/data'), {
    headers: { Origin: 'https://evil.example' },
  });
  assert.strictEqual(r2.status, 403);
});
