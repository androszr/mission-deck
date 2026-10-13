'use strict';
// tests/test_api_identity.js
// GET /api/whoami, GET /api/analytics/config and the GitLab endpoints
// (ssh-access, tokens/targets, tokens/create).
//
// GITLAB_API_BASE_URL points at a port nothing listens on, so no test in this
// file can ever reach gitlab.com or create a real token. The create endpoint's
// three-attempt retry means the network path takes a few seconds by design.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');

const PORT = 3505;
const UNREACHABLE_API = 'http://127.0.0.1:9/api/v4';
let child;

test.before(async () => {
  child = startServer(PORT, {
    GITLAB_API_BASE_URL: UNREACHABLE_API,
    // A deliberately fake owner token: it never leaves the process, and every
    // request it authorises is aimed at the unreachable base URL above.
    COCKPIT_OWNER_TOKEN: 'glpat-testtesttesttesttest',
  });
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

// ── GET /api/whoami ─────────────────────────────────────────────────────────

// The GitLab base URL is unreachable, so the token tier can never resolve here
// and whoami must degrade to the local sources rather than to an error. That
// degradation is exactly what a user with no token sees.
test('GET /api/whoami degrades to git config / the OS account with no reachable token', async () => {
  const { status, body } = await getJson(PORT, '/api/whoami');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.valid, true);
  assert.ok(['git', 'os'].includes(body.source), `unexpected source ${body.source}`);
  assert.ok(typeof body.display_name === 'string' && body.display_name.length > 0);
  assert.match(body.person_slug, /^[a-z0-9-]+$/);
  // A local fallback must never invent a GitLab handle or an avatar.
  assert.strictEqual(body.gitlab_username, null);
  assert.strictEqual(body.avatar_url, null);
});

test('GET /api/whoami carries no email field and never a raw token', async () => {
  const { status, body, headers } = await getJson(PORT, '/api/whoami');
  assert.strictEqual(status, 200);
  assert.ok((headers.get('content-type') || '').includes('application/json'));
  assert.ok(!('email' in body), 'this repo has no email source - the field must be gone');
  assert.ok(!JSON.stringify(body).includes('glpat-'), 'whoami must not echo a token');
});

test('GET /api/whoami is 200 even with no token configured at all', async () => {
  const port = PORT + 20;
  const c = startServer(port, { GITLAB_API_BASE_URL: UNREACHABLE_API, COCKPIT_APP_TOKEN: '' });
  try {
    await waitForServer(port);
    const { status, body } = await getJson(port, '/api/whoami');
    assert.strictEqual(status, 200);
    assert.ok(typeof body.valid === 'boolean');
    assert.ok(['gitlab', 'git', 'os', 'none'].includes(body.source));
  } finally {
    await stopServer(c);
  }
});

// ── GET /api/analytics/config ───────────────────────────────────────────────

test('GET /api/analytics/config is off by default: no ANALYTICS_KEY, no analytics', async () => {
  const { status, body } = await getJson(PORT, '/api/analytics/config');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(Object.keys(body).sort(), ['apiKey', 'enabled']);
  assert.strictEqual(body.enabled, false);
  assert.strictEqual(body.apiKey, null);
});

test('ANALYTICS_KEY opts in, and ANALYTICS_ENABLED=0 still switches it off', async () => {
  const port = PORT + 21;
  const key = '0123456789abcdef0123456789abcdef';
  let c = startServer(port, { ANALYTICS_KEY: key });
  try {
    await waitForServer(port);
    const { body } = await getJson(port, '/api/analytics/config');
    assert.strictEqual(body.enabled, true);
    assert.strictEqual(body.apiKey, key);
  } finally {
    await stopServer(c);
  }
  c = startServer(port, { ANALYTICS_KEY: key, ANALYTICS_ENABLED: '0' });
  try {
    await waitForServer(port);
    const { body } = await getJson(port, '/api/analytics/config');
    assert.strictEqual(body.enabled, false);
    assert.strictEqual(body.apiKey, null);
  } finally {
    await stopServer(c);
  }
});

// ── CSP ─────────────────────────────────────────────────────────────────────

test('the CSP allows both Amplitude hosts in connect-src', async () => {
  const { headers } = await getJson(PORT, '/api/whoami');
  const csp = headers.get('content-security-policy') || '';
  assert.ok(csp.includes('https://api.eu.amplitude.com'), 'ingestion host missing from CSP');
  assert.ok(csp.includes('https://sr-client-cfg.eu.amplitude.com'), 'remote-config host missing from CSP');
});

// ── The vault stays read-only ───────────────────────────────────────────────

test('there is NO Bitwarden write path - tokens are edited in Bitwarden only', async () => {
  const { status } = await postJson(PORT, '/api/bitwarden/item-key',
    { item: 'COCKPIT-APP', key: 'COCKPIT_APP_TOKEN', value: 'glpat-x' });
  assert.strictEqual(status, 404, 'a vault write endpoint must not exist');
});

// ── GitLab project tokens ───────────────────────────────────────────────────

test('GET /api/gitlab/ssh-access answers 200 with a derived project path', async () => {
  const { status, body } = await getJson(PORT, '/api/gitlab/ssh-access');
  assert.strictEqual(status, 200);
  // The probe's RESULT depends on the machine's SSH keys, so only its shape is
  // asserted here. "no access" is an answer, never an error.
  assert.strictEqual(typeof body.ssh, 'boolean');
  assert.strictEqual(body.host, 'gitlab.example.com');
  assert.match(body.project_path, /mission-deck$/);
  assert.ok(!Number.isNaN(Date.parse(body.checked_at)));
});

test('GET /api/gitlab-tokens/targets leads with the app repo, derived from origin', async () => {
  const { status, body } = await getJson(PORT, '/api/gitlab-tokens/targets');
  assert.strictEqual(status, 200);

  // Asserting a COUNT here was wrong and broke the moment the data-repo target
  // was added: the contract is "only repositories this cockpit owns", not "one
  // row". What must hold is that the app repo leads (the UI reads targets[0] as
  // the primary card, and a create that names no target defaults to it) and
  // that no target belongs to another cockpit.
  assert.ok(body.targets.length >= 1, 'at least the app repo must be offered');
  const ids = body.targets.map((x) => x.id);
  assert.strictEqual(ids[0], 'app', 'the app repo must stay first');
  assert.deepStrictEqual([...new Set(ids)], ids, 'target ids must be unique');
  assert.deepStrictEqual(ids, ['app', 'data', 'modules']);
  for (const x of body.targets) {
    assert.match(x.envVar, /^COCKPIT_/, x.id);
    assert.match(x.bwItem, /^COCKPIT-/, x.id);
  }

  const t = body.targets[0];
  assert.strictEqual(t.envVar, 'COCKPIT_APP_TOKEN');
  // write_repository is what lets the token push over HTTPS - see the comment
  // on GITLAB_TOKEN_TARGETS in server.js.
  assert.deepStrictEqual(t.scopes, ['api', 'read_api', 'read_repository', 'write_repository']);
  assert.match(t.projectPath, /mission-deck$/);
  assert.ok(['remote', 'fallback'].includes(t.resolvedFrom));
  assert.ok(!JSON.stringify(body).includes('glpat-'), 'targets must never carry a token');
});

test('POST /api/gitlab-tokens/create rejects an unknown target', async () => {
  // Falling back to a default here would mint a token against the WRONG
  // project, which the user then pastes under the wrong key.
  const { status, body } = await postJson(PORT, '/api/gitlab-tokens/create',
    { firstName: 'Jordan', lastName: 'Lee', target: 'nope' });
  assert.strictEqual(status, 400);
  assert.match(body.message, /target/);

  // A non-string target is rejected too, rather than coerced into the default.
  const typed = await postJson(PORT, '/api/gitlab-tokens/create',
    { firstName: 'Jordan', lastName: 'Lee', target: 1 });
  assert.strictEqual(typed.status, 400);
  assert.match(typed.body.message, /target/);
});

test('POST /api/gitlab-tokens/create rejects a foreign Origin', async () => {
  const { status } = await postJson(PORT, '/api/gitlab-tokens/create',
    { firstName: 'Jordan', lastName: 'Lee' }, { Origin: 'https://evil.example' });
  assert.strictEqual(status, 403);
});

test('POST /api/gitlab-tokens/create validates the name and the access level', async () => {
  const missing = await postJson(PORT, '/api/gitlab-tokens/create', { lastName: 'Lee' });
  assert.strictEqual(missing.status, 400);
  assert.match(missing.body.message, /firstName/);

  const empty = await postJson(PORT, '/api/gitlab-tokens/create', { firstName: 'Jan', lastName: '  ' });
  assert.strictEqual(empty.status, 400);
  assert.match(empty.body.message, /lastName/);

  const level = await postJson(PORT, '/api/gitlab-tokens/create',
    { firstName: 'Jordan', lastName: 'Lee', access_level: 99 });
  assert.strictEqual(level.status, 400);
  assert.match(level.body.message, /access_level/);
});

test('POST /api/gitlab-tokens/create answers 503 without an owner token', async () => {
  const port = PORT + 22;
  const c = startServer(port, { GITLAB_API_BASE_URL: UNREACHABLE_API, COCKPIT_OWNER_TOKEN: '' });
  try {
    await waitForServer(port);
    const { status, body } = await postJson(port, '/api/gitlab-tokens/create',
      { firstName: 'Jordan', lastName: 'Lee' });
    assert.strictEqual(status, 503);
    assert.match(body.message, /COCKPIT_OWNER_TOKEN/);

    const targets = await getJson(port, '/api/gitlab-tokens/targets');
    assert.strictEqual(targets.body.ownerTokenConfigured, false);
  } finally {
    await stopServer(c);
  }
});

test('an unreachable GitLab API surfaces a redacted 502, never the owner token', async () => {
  // Three attempts with a 1.5s + 3s backoff against a dead port.
  const { status, body } = await postJson(PORT, '/api/gitlab-tokens/create',
    { firstName: 'Jordan', lastName: 'Lee', access_level: 30 });
  assert.strictEqual(status, 502);
  assert.strictEqual(body.status, 'error');
  assert.strictEqual(body.tokenName, 'jordan-lee-COCKPIT-APP');
  const text = JSON.stringify(body);
  assert.ok(!text.includes('glpat-'), 'the error path must redact every glpat- fragment');
  assert.ok(!text.includes('testtesttest'), 'the owner token must never reach the client');
});

test('target: data names the token after COCKPIT-DATA and targets the data repo', async () => {
  // Same dead-port path as above, so nothing reaches gitlab.com. What is
  // asserted is what the REQUEST was built from - the name and the project -
  // because those are exactly what a mis-resolved target would get wrong, and
  // a token minted against the wrong project fails much later and confusingly.
  const { status, body } = await postJson(PORT, '/api/gitlab-tokens/create',
    { firstName: 'Jordan', lastName: 'Lee', target: 'data' });
  assert.strictEqual(status, 502);
  assert.strictEqual(body.tokenName, 'jordan-lee-COCKPIT-DATA');
  assert.match(body.projectPath, /mission-deck-data$/);
});
