'use strict';
// tests/test_api_infra.js
// Boot smoke test: version, settings schema, token status, security headers,
// CSRF/Content-Type guards and the unknown-route contract.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, postJson, apiUrl } = require('./_api_helper');

const PORT = 3499;
let child;

test.before(async () => {
  child = startServer(PORT);
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

test('GET /api/app/version reports the VERSION file semver', async () => {
  const { status, body } = await getJson(PORT, '/api/app/version');
  assert.strictEqual(status, 200);
  assert.match(body.semver, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(typeof body.hasToken, 'boolean');
  assert.ok('hash' in body && 'version' in body && 'updatedAt' in body);
});

test('GET /api/app/version reports the OS this cockpit runs on', async () => {
  // The dashboard gates its Windows card on this field. The server is local, so
  // its own process.platform IS the person's OS - a better answer than a
  // User-Agent sniff, and the reason the field lives here rather than in the
  // client.
  const { status, body } = await getJson(PORT, '/api/app/version');
  assert.strictEqual(status, 200);
  assert.ok(['win32', 'darwin', 'linux', 'freebsd', 'openbsd', 'sunos', 'aix'].includes(body.platform),
    'unexpected platform: ' + body.platform);
  assert.strictEqual(body.platform, process.platform, 'must report THIS process platform');
});

test('the Windows guide is served as a static document', async () => {
  // The dashboard card fetches this path directly; no endpoint fronts it.
  const res = await fetch(apiUrl(PORT, '/docs/guides/WINDOWS.md'), { signal: AbortSignal.timeout(10000) });
  assert.strictEqual(res.status, 200);
  const body = await res.text();
  assert.match(body, /^# Mission Deck on Windows/m, 'expected the guide heading');
  assert.match(body, /winget install/, 'expected the Windows install command');
});

test('GET /api/settings/env returns the contract groups', async () => {
  const { status, body } = await getJson(PORT, '/api/settings/env');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.groups));
  const ids = body.groups.map(g => g.id);
  for (const expected of ['app', 'bitwarden', 'data-tier-0', 'jira', 'sync']) {
    assert.ok(ids.includes(expected), `missing group ${expected} (got ${ids.join(', ')})`);
  }
  // Token values must never be echoed back - only a masked preview.
  for (const group of body.groups) {
    for (const k of group.keys) {
      if (k.type === 'token') {
        assert.ok(!('value' in k), `token key ${k.key} must not expose a raw value`);
        assert.ok(k.preview === '' || k.preview.startsWith('****'));
      }
    }
  }
});

test('GET /api/env-token-status lists every schema token key', async () => {
  const { status, body } = await getJson(PORT, '/api/env-token-status');
  assert.strictEqual(status, 200);
  for (const key of ['COCKPIT_APP_TOKEN', 'COCKPIT_DATA_TOKEN', 'JIRA_TOKEN', 'JIRA_TECH_TOKEN', 'CONFLUENCE_TOKEN']) {
    assert.strictEqual(typeof body[key], 'boolean', `${key} missing from token status`);
  }
  assert.ok(Array.isArray(body._bitwardenSourced));
});

test('security headers are set on API responses', async () => {
  const { headers } = await getJson(PORT, '/api/app/version');
  assert.strictEqual(headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(headers.get('x-frame-options'), 'DENY');
  assert.ok((headers.get('content-security-policy') || '').includes("default-src 'self'"));
});

test('POST rejects a foreign Origin and a non-JSON Content-Type', async () => {
  const bad = await postJson(PORT, '/api/settings/env', { updates: {} }, { Origin: 'https://evil.example' });
  assert.strictEqual(bad.status, 403);

  const noCt = await fetch(apiUrl(PORT, '/api/settings/env'), { method: 'POST', body: 'x' });
  assert.strictEqual(noCt.status, 415);
});

test('POST /api/settings/env refuses keys outside ENV_SCHEMA', async () => {
  const { status, body } = await postJson(PORT, '/api/settings/env', { updates: { NOT_A_KEY: 'x' } });
  assert.strictEqual(status, 400);
  assert.match(body.message, /Unknown key/);
});

test('unknown /api routes answer JSON 404, wave-2 routes answer 501', async () => {
  const missing = await getJson(PORT, '/api/definitely-not-a-route');
  assert.strictEqual(missing.status, 404);
  assert.strictEqual(missing.body.error, 'not-found');

  // /api/cocreate/* shipped ahead of the onboarding wizard (plans/2026-09-06-
  // academy-modul.md) - only /api/onboarding-wizard/* is still wave 2.
  const wave2 = await getJson(PORT, '/api/onboarding-wizard/status');
  assert.strictEqual(wave2.status, 501);
  assert.strictEqual(wave2.body.wave, 2);

  const cocreate = await getJson(PORT, '/api/cocreate/progress');
  assert.notStrictEqual(cocreate.status, 501);

  // Removed endpoints: /api/docs/* must return 404 (not-found), not 500.
  const docsList = await getJson(PORT, '/api/docs/list');
  assert.strictEqual(docsList.status, 404);
  assert.strictEqual(docsList.body.error, 'not-found');

  const docsRead = await getJson(PORT, '/api/docs/read?id=claude-md');
  assert.strictEqual(docsRead.status, 404);
  assert.strictEqual(docsRead.body.error, 'not-found');

  // Removed endpoints: /api/sandbox/* must return 404 (not-found), not 500.
  const sandboxStatus = await getJson(PORT, '/api/sandbox/status');
  assert.strictEqual(sandboxStatus.status, 404);
  assert.strictEqual(sandboxStatus.body.error, 'not-found');

  const sandboxSwitch = await postJson(PORT, '/api/sandbox/switch', { branch: 'main' });
  assert.strictEqual(sandboxSwitch.status, 404);
  assert.strictEqual(sandboxSwitch.body.error, 'not-found');
});

test('GET /api/agents/list returns an array', async () => {
  const { status, body } = await getJson(PORT, '/api/agents/list');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.agents));
  for (const a of body.agents) assert.strictEqual(typeof a.name, 'string');
});

// -- serveStatic: the root path and its query string -------------------------
// The root is the SPA shell, and the shell is what every deep link loads. The
// query has to be stripped BEFORE the root test, not after: testing req.url
// against '/' first leaves '/?anything' to the split, which yields a bare '/'
// that resolves to a directory and 404s. Any link to the app carrying a query
// (a cache-buster, a campaign parameter, a copied URL) hit that.
test('GET / serves the SPA shell', async () => {
  const res = await fetch(apiUrl(PORT, '/'), { signal: AbortSignal.timeout(10000) });
  assert.strictEqual(res.status, 200);
  const body = await res.text();
  assert.match(body, /<div class="view-section"/, 'expected the SPA shell markup');
});

test('GET /?<query> serves the same shell, not a 404', async () => {
  for (const q of ['?cb=1', '?utm_source=x&utm_medium=y', '?']) {
    const res = await fetch(apiUrl(PORT, '/' + q), { signal: AbortSignal.timeout(10000) });
    assert.strictEqual(res.status, 200, 'expected 200 for /' + q);
    const body = await res.text();
    assert.match(body, /<div class="view-section"/, 'expected the SPA shell for /' + q);
  }
});

test('a query string does not open a path the bare path would refuse', async () => {
  // The query is stripped BEFORE the guards run, so adding one must not change
  // any verdict. Secret files stay refused and encoded traversal stays refused,
  // with and without a query. (fetch() normalizes a literal '/../x' away before
  // it leaves the client, so the traversal cases here are percent-encoded - the
  // only form that actually reaches the server as a traversal.)
  const cases = [
    '/.env', '/.env?cb=1',
    '/.encryption-key', '/.encryption-key?x=1',
    '/%2e%2e/.env', '/%2e%2e/.env?cb=1',
    '/..%2f.env', '/..%2f.env?cb=1',
  ];
  for (const p of cases) {
    const res = await fetch(apiUrl(PORT, p), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    assert.ok(res.status === 403 || res.status === 404,
      'expected 403/404 for ' + p + ', got ' + res.status);
    const body = await res.text();
    assert.ok(!/DATA_ENCRYPTION_KEY|COCKPIT_APP_TOKEN|BW_SESSION/.test(body),
      'no secret may leak for ' + p);
  }
});
