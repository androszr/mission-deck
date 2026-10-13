'use strict';
// tests/test_api_modules_data_static.js
// API tests for the /modules-data/<id>/public/... static route: a built
// module app (e.g. sample-app's Vite dist/) lives under MODULES_DATA_DIR,
// never inside the module's own git tree. Server is started with
// MODULES_DATA_DIR pointing at tests/fixtures/modules-data so the fixture
// files are served without touching the real data/modules/ directory.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { startServer, waitForServer, stopServer, getJson } = require('./_api_helper');

const PORT = 3529;
const MODULES_DATA_DIR = path.resolve(__dirname, 'fixtures/modules-data');
let child;

test.before(async () => {
  child = startServer(PORT, { MODULES_DATA_DIR });
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

// Helper: raw HTTP GET that sends the path as-is, bypassing fetch URL normalization.
function rawGet(port, rawPath) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.end();
  });
}

test('GET /modules-data/fixture-mod/public/x.json returns 200 no-cache', async () => {
  const { status, headers, body } = await getJson(PORT, '/modules-data/fixture-mod/public/x.json');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(headers.get('cache-control'), 'no-cache');
});

test('GET /modules-data/fixture-mod/deploy/x returns 404 (deploy/ blocked)', async () => {
  const { status } = await getJson(PORT, '/modules-data/fixture-mod/deploy/x');
  assert.strictEqual(status, 404);
});

test('GET traversal attempt /modules-data/fixture-mod/public/../../deploy/x returns 403 or 404', async () => {
  // Use raw http.request to send the literal path without client-side normalization.
  const { status } = await rawGet(PORT, '/modules-data/fixture-mod/public/../../deploy/x');
  assert.ok(status === 403 || status === 404, 'expected 403 or 404, got ' + status);
});

// -- Module data exposure guard (docs/architecture/modules.md, step 17)
// The fixture holds a real allowed-users.json next to x.json, so a 404 here is
// a refusal, not an absence: the same directory answers 200 for x.json.

test('GET /modules-data/<id>/public/allowed-users.json is refused although the file exists', async () => {
  const { status, body } = await rawGet(PORT, '/modules-data/fixture-mod/public/allowed-users.json');
  assert.strictEqual(status, 404);
  assert.ok(!body.includes('fixture@example.test'), 'roster bytes must never leave the server');
});

test('GET /data/modules/... (the ROOT alias of MODULES_DATA_DIR) is refused outright, not stubbed', async () => {
  // Without the guard this path resolved under ROOT/data/modules and, being a
  // missing .json under /data/, was answered by the empty-JSON stub with 200.
  const { status, body } = await rawGet(PORT, '/data/modules/fixture-mod/public/x.json');
  assert.strictEqual(status, 404);
  assert.ok(!body.includes('_missing'), 'the /data/ stub must not answer for the alias');
  const roster = await rawGet(PORT, '/data/modules/sample-app/public/app-cockpit/allowed-users.json');
  assert.strictEqual(roster.status, 404);
});

test('GET of a run directory, a manifest and a nested .git through the alias or the gate is refused', async () => {
  for (const p of [
    '/data/modules/fixture-mod/artifacts/cockpit/run-1/manifest.json',
    '/data/modules/fixture-mod/build-reports/last.json',
    '/data/modules/fixture-mod/deploy/cockpit/.git/config',
    '/modules-data/fixture-mod/public/nested/.git/config',
  ]) {
    const { status } = await rawGet(PORT, p);
    assert.strictEqual(status, 404, p);
  }
});

test('GET of an ordinary app file through the gate still answers 200', async () => {
  const { status, body } = await getJson(PORT, '/modules-data/fixture-mod/public/x.json');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
});

// -- Directory requests under the frameable prefix -------------------------------
// Cloudflare Pages resolves a directory to its index.html in production, so the
// mini app screen that redirects to a second Vite entry ('.../zam-ar/') works
// there and 404'd here, making the screen invisible in local preview. The rewrite
// is deliberately scoped to FRAMEABLE_PATH_PREFIX: it must NOT switch on directory
// indexing anywhere else in the app.

test('GET a directory under /modules-data/ resolves to its index.html', async () => {
  const { status, body } = await rawGet(PORT, '/modules-data/fixture-mod/public/app-x/zam-ar/');
  assert.strictEqual(status, 200);
  assert.match(body, /zam-ar fixture/);
});

test('GET a directory with NO index.html under /modules-data/ still 404s', async () => {
  const { status } = await rawGet(PORT, '/modules-data/fixture-mod/public/app-x/pusty/');
  assert.strictEqual(status, 404, 'a missing index.html must not suddenly list the directory');
});

test('a directory OUTSIDE the frameable prefix is unaffected by the rewrite', async () => {
  // The guard is `normalized.startsWith(FRAMEABLE_PATH_PREFIX)`. If it ever widens,
  // this turns into directory indexing across the whole static root - which is why
  // the assertion is "not 200" rather than a specific code.
  for (const p of ['/docs/', '/js/', '/']) {
    const { status } = await rawGet(PORT, p);
    if (p === '/') continue; // '/' legitimately serves the app shell
    assert.notStrictEqual(status, 200, `${p} must not start serving a directory index`);
  }
});

// -- /ds-icons/ dev shim: the GUARD chain, not the parser ------------------------
// The shared app shells (cs-shell) build url('/ds-icons/<slug>.svg') -
// root-absolute, right on Pages, 404 when the app is framed under /modules-data/.
// The shim serves such an icon out of the framed app the REFERER names. The referer
// is caller-controlled, so it is the one input in this route that picks a path on
// disk: every case below is a REFUSAL that must stay a refusal.

const ICON = '/ds-icons/24-ic-fixture.svg';
const GOOD_REFERER = `http://127.0.0.1:${PORT}/modules-data/fixture-mod/public/app-x/zam-ar/`;

function rawGetWithHeaders(port, rawPath, headers) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: rawPath, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

test('/ds-icons/<slug>.svg is served when the referer names a framed app', async () => {
  const { status, body } = await rawGetWithHeaders(PORT, ICON, { Referer: GOOD_REFERER });
  assert.strictEqual(status, 200);
  assert.match(body, /<svg/);
});

test('/ds-icons/ refuses without a referer, cross-origin, or outside the frameable prefix', async () => {
  const cases = [
    ['no referer', {}],
    ['obcy origin', { Referer: 'http://evil.example/modules-data/fixture-mod/public/app-x/' }],
    ['referer spoza prefiksu', { Referer: `http://127.0.0.1:${PORT}/docs/design-system/` }],
  ];
  for (const [label, headers] of cases) {
    const { status } = await rawGetWithHeaders(PORT, ICON, headers);
    assert.notStrictEqual(status, 200, `${label}: an icon must not escape ROOT`);
  }
});

test('/ds-icons/ refuses a non-.svg name and anything carrying a path separator', async () => {
  const cases = [
    '/ds-icons/notes.txt',
    '/ds-icons/../x.json',
    '/ds-icons/sub/24-ic-fixture.svg',
    '/ds-icons/..%2F..%2Fpublic%2Fallowed-users.json',
  ];
  for (const p of cases) {
    const { status } = await rawGetWithHeaders(PORT, p, { Referer: GOOD_REFERER });
    assert.notStrictEqual(status, 200, `${p}: the shim let in something that is not an icon in the app root`);
  }
});
