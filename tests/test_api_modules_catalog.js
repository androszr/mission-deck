'use strict';
// tests/test_api_modules_catalog.js
// GET /api/modules/catalog and POST /api/modules/install.
//
// GITLAB_API_BASE_URL points at a port nothing listens on, so no test in this
// file can ever reach gitlab.com. Two servers are needed because the catalog
// handler branches on whether COCKPIT_MODULES_TOKEN is set at boot: PORT has no
// token (the fresh-install state), PORT_WITH_TOKEN has a fake one (the
// GitLab-unreachable state). Same shape as tests/test_api_identity.js.
//
// A fourth server (PORT_STUB_GITLAB) points at a GitLab STUB started in this
// process (PORT_GITLAB_STUB): it defaults to 404 for repository reads and
// 200 or 404 to the project probe depending on `stubProjectVisible`, which is
// how the two meanings of a GitLab 404 - "the repo is empty" and "this caller
// cannot see the repo" (no VPN, a token without access) - are told apart.
// Install tests explicitly enable one local artifact on that same stub.
//
// Every assertion reads the DISK, never a restarted server: _api_helper starts
// the server with TEST_DISABLE_RESTART, so an install that half-succeeded would
// still be visible here as a leftover directory.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, waitForServer, stopServer, getJson, postJson, apiUrl, ROOT } = require('./_api_helper');
const { gitBlobSha } = require('../server.js');

const PORT = 3509;
const PORT_WITH_TOKEN = PORT + 20; // 3529
const PORT_EMPTY = PORT + 40; // 3549 - a third server, empty MODULES_DIR (no modules installed)
const PORT_STUB_GITLAB = 3569; // a fourth server, GitLab pointed at the in-process stub below
const PORT_GITLAB_STUB = 3570; // the stub GitLab itself (http.createServer in this process)
const PORT_RECONCILE = 3571; // a fifth server WITH git on PATH, for the dirty-guard reconcile case
const UNREACHABLE_API = 'http://127.0.0.1:9/api/v4';
const STUB_API = `http://127.0.0.1:${PORT_GITLAB_STUB}/api/v4`;
const FAKE_TOKEN = 'glpat-testtesttesttesttest';
// Every server in this file runs the OPT-IN GitLab source: the local catalog
// folder is the default, and its own cases live in
// tests/test_api_modules_catalog_local.js.
const GITLAB_CATALOG_URL = 'https://gitlab.example.com/your-group/mission-deck-modules.git';
const MODULES_DIR = path.join(ROOT, 'tests', 'fixtures', 'modules');

let child;
let childWithToken;
let childEmpty;
let childStubGitlab;
let gitlabStub;
let emptyModulesDir;
let originDir;
let originFile;
let stubModulesDir;
let stubOriginFile;
let stubArtifact = null;
// What the catalog held AT the commit `stubsha1` (ref-sensitive reads only): the
// version a person published earlier, as opposed to the newer one on `main`.
let stubRefArtifact = null;
let childReconcile;
let reconcileModulesDir;
let stubManifestReads = 0;
// Mutable per test: a whole catalog the stub serves and accepts WRITES for -
// { catalogText, manifests: { id: object }, writes: [] } - so the
// migrate-areas flow (branch -> commit -> merge request) can be driven end to
// end against a fake remote instead of merely failing on an unreachable one.
let stubCatalog = null;
// Mutable per test: does the stub GitLab let this caller see the project?
let stubProjectVisible = true;
let stubProbeCount = 0;
// Mutable per test: how many open merge requests the stub reports. Routed
// BEFORE the project probe, because `/projects/<enc>/merge_requests` carries
// `/projects/` too and would otherwise be counted as a probe.
let stubOpenMrTotal = 0;
let stubMrListReads = 0;
// Mutable per test: the MRs a `state=merged` list answers with.
let stubMergedMrs = [];

/** The stub is a fake GitLab, not a cockpit response - `jsonResponse` is server.js's. */
function stubAnswer(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...(extraHeaders || {}) });
  res.end(payload);
}

/**
 * The stub GitLab. Route on '/repository/' FIRST: the project probe URL
 * (/projects/<enc>) is a prefix of every repository URL, so the other order
 * would swallow them all. Unless a test enables an artifact, repository reads
 * answer 404, and the probe answers according to the flag.
 * Nothing here ever needs the token, but the header is checked to
 * be present so a request that forgot it would be visible.
 */
function startGitlabStub() {
  const srv = http.createServer((req, res) => {
    const url = req.url || '';
    const hasToken = req.headers['private-token'] === FAKE_TOKEN;
    if (stubCatalog && hasToken && stubCatalogAnswer(req, res, url)) return;
    if (url.includes('/repository/')) {
      if (!hasToken) return stubAnswer(res, 401, { message: '401 Unauthorized' });
      // Only the active test artifact is downloadable; never proxy a request.
      if (stubArtifact && req.method === 'GET') {
        const parsed = new URL(url, STUB_API);
        const prefix = 'modules/' + stubArtifact.id;
        // Reads pinned to the `stubsha1` commit see the earlier published copy.
        const art = (stubRefArtifact && parsed.searchParams.get('ref') === 'stubsha1') ? stubRefArtifact : stubArtifact;
        const manifestBytes = Buffer.from(JSON.stringify(art));
        const indexBytes = Buffer.from('// Local test artifact ' + art.version + '\n');
        if (parsed.pathname.endsWith('/repository/commits')
            && parsed.searchParams.get('path') === prefix + '/module.json') {
          return stubAnswer(res, 200, [{ id: 'stubsha1' }]);
        }
        if (parsed.pathname.endsWith('/repository/tree')
            && parsed.searchParams.get('path') === prefix) {
          return stubAnswer(res, 200, [
            { type: 'blob', mode: '100644', path: prefix + '/module.json', id: gitBlobSha(manifestBytes) },
            { type: 'blob', mode: '100644', path: prefix + '/client/index.js', id: gitBlobSha(indexBytes) },
          ]);
        }
        const raw = parsed.pathname.match(/\/repository\/files\/([^/]+)\/raw$/);
        const file = raw && decodeURIComponent(raw[1]);
        if (file === prefix + '/module.json') {
          stubManifestReads += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(manifestBytes);
        }
        if (file === prefix + '/client/index.js') {
          res.writeHead(200, { 'Content-Type': 'text/javascript' });
          return res.end(indexBytes);
        }
      }
      return stubAnswer(res, 404, { message: '404 Not Found' });
    }
    if (url.includes('/merge_requests') && req.method === 'GET') {
      stubMrListReads += 1;
      if (!hasToken) return stubAnswer(res, 401, { message: '401 Unauthorized' });
      const parsed = new URL(url, STUB_API);
      if (parsed.searchParams.get('state') === 'merged') return stubAnswer(res, 200, stubMergedMrs);
      assert.strictEqual(parsed.searchParams.get('state'), 'opened');
      // GitLab paginates and puts the real total in x-total; the body carries
      // one item at most, which is all the counter should ever ask for.
      const perPage = parseInt(parsed.searchParams.get('per_page') || '20', 10);
      const items = [];
      for (let i = 0; i < Math.min(perPage, stubOpenMrTotal); i++) items.push({ iid: i + 1, title: 'New module: x' + i });
      return stubAnswer(res, 200, items, { 'x-total': String(stubOpenMrTotal) });
    }
    if (url.includes('/projects/')) {
      stubProbeCount += 1;
      if (!hasToken) return stubAnswer(res, 401, { message: '401 Unauthorized' });
      if (stubProjectVisible) {
        return stubAnswer(res, 200, { id: 1, path_with_namespace: 'stub/cockpit-modules' });
      }
      return stubAnswer(res, 404, { message: '404 Project Not Found' });
    }
    return stubAnswer(res, 404, { message: '404 Not Found' });
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(PORT_GITLAB_STUB, '127.0.0.1', () => resolve(srv));
  });
}

/**
 * The catalog half of the stub: reads answer from `stubCatalog`, writes are
 * recorded on `stubCatalog.writes` with the parsed body. Returns false for
 * any request it does not own so the rest of the stub keeps its behaviour.
 */
function stubCatalogAnswer(req, res, url) {
  const parsed = new URL(url, STUB_API);
  const p = parsed.pathname;
  if (req.method === 'GET') {
    const raw = p.match(/\/repository\/files\/([^/]+)\/raw$/);
    const file = raw && decodeURIComponent(raw[1]);
    if (file === 'catalog.json') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(stubCatalog.catalogText);
      return true;
    }
    const m = file && file.match(/^modules\/([^/]+)\/module\.json$/);
    const pinned = stubRefArtifact && parsed.searchParams.get('ref') === 'stubsha1';
    if (m && !pinned && stubCatalog.manifests[m[1]]) { stubAnswer(res, 200, stubCatalog.manifests[m[1]]); return true; }
    if (p.endsWith('/repository/tree') && parsed.searchParams.get('path') === 'modules') {
      stubAnswer(res, 200, Object.keys(stubCatalog.manifests).map((name) => ({ type: 'tree', name })));
      return true;
    }
    return false;
  }
  if (req.method === 'POST' && (p.endsWith('/repository/branches') || p.endsWith('/repository/commits') || p.endsWith('/merge_requests'))) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let json = null;
      try { json = JSON.parse(body); } catch { /* the branch call sends {} */ }
      const kind = p.endsWith('/repository/branches') ? 'branch' : (p.endsWith('/repository/commits') ? 'commit' : 'mr');
      stubCatalog.writes.push({ kind, query: Object.fromEntries(parsed.searchParams), body: json });
      if (kind === 'mr') return stubAnswer(res, 201, { iid: 7, web_url: 'https://gitlab.example/stub/cockpit-modules/-/merge_requests/7' });
      stubAnswer(res, 201, { ok: true });
    });
    return true;
  }
  return false;
}

async function stopGitlabStub(srv) {
  if (!srv) return;
  // fetch in the child keeps a socket alive; a bare close() would never
  // resolve and the whole suite would hang without a failure message.
  if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
  await new Promise((resolve) => srv.close(() => resolve()));
}

/** Entries in the fixture modules dir, so a leak shows up as a new name. */
function modulesDirEntries() {
  return fs.readdirSync(MODULES_DIR).sort();
}

function readOrigin() {
  try { return JSON.parse(fs.readFileSync(originFile, 'utf8')); }
  catch { return {}; }
}

let entriesBefore;

test.before(async () => {
  entriesBefore = modulesDirEntries();
  // MODULES_ORIGIN_FILE is scoped to a scratch path so this suite - which
  // reuses the committed tests/fixtures/modules/ tree - never touches the
  // developer's real data/modules-origin.json.
  originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-modules-origin-'));
  originFile = path.join(originDir, 'modules-origin.json');
  child = startServer(PORT, {
    MODULES_DIR,
    GITLAB_API_BASE_URL: UNREACHABLE_API,
    MODULES_CATALOG_REPO_URL: GITLAB_CATALOG_URL,
    MODULES_ORIGIN_FILE: originFile,
  });
  childWithToken = startServer(PORT_WITH_TOKEN, {
    MODULES_DIR,
    GITLAB_API_BASE_URL: UNREACHABLE_API,
    MODULES_CATALOG_REPO_URL: GITLAB_CATALOG_URL,
    MODULES_ORIGIN_FILE: originFile,
    // Fake by construction: it never leaves the process, and every request it
    // authorises is aimed at the unreachable base URL above.
    COCKPIT_MODULES_TOKEN: FAKE_TOKEN,
  });
  // A third server with an EMPTY MODULES_DIR - the "no modules installed"
  // state GET /api/modules/updates must answer without ever reaching GitLab.
  emptyModulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-empty-modules-'));
  childEmpty = startServer(PORT_EMPTY, {
    MODULES_DIR: emptyModulesDir,
    GITLAB_API_BASE_URL: UNREACHABLE_API,
    MODULES_CATALOG_REPO_URL: GITLAB_CATALOG_URL,
    MODULES_ORIGIN_FILE: originFile,
    COCKPIT_MODULES_TOKEN: FAKE_TOKEN,
  });
  // A fourth server whose GitLab is the stub above, so the 404 branches of
  // the catalog handler are driven rather than merely unreachable.
  gitlabStub = await startGitlabStub();
  stubModulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-catalog-install-'));
  stubOriginFile = path.join(originDir, 'stub-modules-origin.json');
  fs.writeFileSync(stubOriginFile, JSON.stringify({
    unrelated: { source: 'zip', version: '1.0.0', at: '2026-01-01T00:00:00.000Z' },
  }));
  childStubGitlab = startServer(PORT_STUB_GITLAB, {
    MODULES_DIR: stubModulesDir,
    GITLAB_API_BASE_URL: STUB_API,
    MODULES_CATALOG_REPO_URL: GITLAB_CATALOG_URL,
    MODULES_ORIGIN_FILE: stubOriginFile,
    COCKPIT_MODULES_TOKEN: FAKE_TOKEN,
    // startServer uses an absolute Node path. No git executable is available
    // to this child, so successful installs cannot initialize or commit repos.
    PATH: path.join(originDir, 'no-executables'),
  });
  reconcileModulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-catalog-reconcile-'));
  childReconcile = startServer(PORT_RECONCILE, {
    MODULES_DIR: reconcileModulesDir,
    GITLAB_API_BASE_URL: STUB_API,
    MODULES_CATALOG_REPO_URL: GITLAB_CATALOG_URL,
    MODULES_ORIGIN_FILE: path.join(originDir, 'reconcile-origin.json'),
    COCKPIT_MODULES_TOKEN: FAKE_TOKEN,
  });
  await waitForServer(PORT);
  await waitForServer(PORT_WITH_TOKEN);
  await waitForServer(PORT_EMPTY);
  await waitForServer(PORT_STUB_GITLAB);
  await waitForServer(PORT_RECONCILE);
});

test.after(async () => {
  await stopServer(child);
  await stopServer(childWithToken);
  await stopServer(childEmpty);
  // The cockpit child goes first: it is the one holding sockets to the stub.
  await stopServer(childStubGitlab);
  await stopServer(childReconcile);
  await stopGitlabStub(gitlabStub);
  fs.rmSync(stubModulesDir, { recursive: true, force: true });
  fs.rmSync(reconcileModulesDir, { recursive: true, force: true });
  fs.rmSync(emptyModulesDir, { recursive: true, force: true });
  fs.rmSync(originDir, { recursive: true, force: true });
  // The suite must not mutate the committed fixture tree.
  assert.deepStrictEqual(modulesDirEntries(), entriesBefore,
    'the fixture modules dir must be unchanged after the suite');
});

// ── a) No token: a fresh install, not an error ───────────────────────────────

// A missing token is the state EVERY new person is in before they open
// Settings > Keys. Answering 401 or 500 would make the tab render a raw
// error where it should render an instruction, so the status code is the
// assertion that matters most here.
test('GET /api/modules/catalog with no token answers 200 and error: no-token', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/catalog');
  assert.strictEqual(status, 200);
  assert.notStrictEqual(status, 401);
  assert.notStrictEqual(status, 500);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'no-token');
  assert.strictEqual(body.tokenConfigured, false);
  assert.deepStrictEqual(body.entries, []);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
  // The message is user-facing English copy, not an error code echoed back.
  assert.ok(ENGLISH_COPY_RE.test(body.message), 'message should be English UI copy');
});

// ── b) Token present, GitLab unreachable ─────────────────────────────────────

test('GET /api/modules/catalog with an unreachable GitLab answers 200 and error: gitlab-unreachable', async () => {
  const { status, body } = await getJson(PORT_WITH_TOKEN, '/api/modules/catalog');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'gitlab-unreachable');
  assert.strictEqual(body.tokenConfigured, true);
  assert.deepStrictEqual(body.entries, []);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
});

// The token authorises every catalog request; a response that echoed it back
// would leak it into the browser and into any copied bug report.
test('GET /api/modules/catalog never echoes the token back', async () => {
  const r = await fetch(apiUrl(PORT_WITH_TOKEN, '/api/modules/catalog'), {
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text();
  assert.ok(!raw.includes('glpat-'), 'response body must not contain the token');
});

// Errors are cached too, deliberately: without this an offline machine pays the
// full network timeout on every open of the tab.
test('GET /api/modules/catalog answers from cache on the second call', async () => {
  const first = await getJson(PORT_WITH_TOKEN, '/api/modules/catalog');
  assert.strictEqual(first.status, 200);
  const second = await getJson(PORT_WITH_TOKEN, '/api/modules/catalog');
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.source, 'cache');
  assert.strictEqual(second.body.error, 'gitlab-unreachable');
});

// ── b2) Token present, GitLab answers 404: empty catalog or no access? ───────
// GitLab hides a private project from a caller that may not see it (outside
// the group's IP allowlist - no VPN - or a token without access) with a 404,
// not a 403. These three cases drive the stub through both meanings. Every
// call carries ?force=1 so flipping the stub between tests bypasses the TTL.

// User-facing copy is a readable English sentence: printable ASCII with at
// least two words, never a bare error code echoed back.
const ENGLISH_COPY_RE = /^(?=.*[A-Za-z]+ [A-Za-z]+)[\x20-\x7E]+$/;

test('GET /api/modules/catalog: a 404 on a VISIBLE project is an empty catalog, ok: true (regression)', async () => {
  stubProjectVisible = true;
  const probesBefore = stubProbeCount;
  const { status, body } = await getJson(PORT_STUB_GITLAB, '/api/modules/catalog?force=1');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true, `expected ok: true, got ${JSON.stringify(body)}`);
  assert.strictEqual(body.tokenConfigured, true);
  assert.deepStrictEqual(body.entries, []);
  assert.deepStrictEqual(body.errors, []);
  assert.strictEqual(body.source, 'gitlab');
  // catalog.json 404 then modules/ 404: ONE probe for the whole run, memoized.
  assert.strictEqual(stubProbeCount - probesBefore, 1, 'one refresh asks the project probe exactly once');
});

test('GET /api/modules/catalog: a 404 on an INVISIBLE project is gitlab-no-access with a VPN message, never an empty list', async () => {
  stubProjectVisible = false;
  const r = await fetch(apiUrl(PORT_STUB_GITLAB, '/api/modules/catalog?force=1'), {
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text();
  const body = JSON.parse(raw);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'gitlab-no-access');
  assert.strictEqual(body.tokenConfigured, true);
  assert.deepStrictEqual(body.entries, []);
  assert.deepStrictEqual(body.errors, []);
  assert.ok(typeof body.projectPath === 'string' && body.projectPath.length > 0,
    'the answer names the project path, because a wrong MODULES_CATALOG_REPO_URL is the third cause');
  assert.ok(typeof body.message === 'string' && /VPN/.test(body.message), 'message names the VPN first');
  assert.ok(/COCKPIT_MODULES_TOKEN/.test(body.message), 'message names the token permissions second');
  assert.ok(ENGLISH_COPY_RE.test(body.message), 'message should be English UI copy');
  assert.ok(!raw.includes('glpat-'), 'response body must not contain the token');

  // The error is cached under the same TTL as gitlab-unreachable; the tab's
  // "Try again" goes through ?force=1, so a later flip is seen.
  const cached = await getJson(PORT_STUB_GITLAB, '/api/modules/catalog');
  assert.strictEqual(cached.body.source, 'cache');
  assert.strictEqual(cached.body.error, 'gitlab-no-access');
});

test('POST /api/modules/install on an INVISIBLE project answers gitlab-no-access, not not-found', async () => {
  stubProjectVisible = false;
  const r = await fetch(apiUrl(PORT_STUB_GITLAB, '/api/modules/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'no-such-id' }),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text();
  const body = JSON.parse(raw);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(body.error, 'gitlab-no-access');
  assert.notStrictEqual(body.error, 'not-found');
  assert.ok(typeof body.message === 'string' && /VPN/.test(body.message));
  assert.ok(ENGLISH_COPY_RE.test(body.message), 'message should be English UI copy');
  assert.ok(!raw.includes('glpat-'), 'response body must not contain the token');

  // The same install with the project VISIBLE is the honest not-found: the
  // repo can be seen and simply has no such module.
  stubProjectVisible = true;
  const visible = await postJson(PORT_STUB_GITLAB, '/api/modules/install', { id: 'no-such-id' });
  assert.strictEqual(visible.status, 400);
  assert.strictEqual(visible.body.error, 'not-found');

  const after = fs.readdirSync(stubModulesDir);
  assert.deepStrictEqual(after, [], 'no new entry may survive a refused install');
  assert.ok(!after.some(n => n.startsWith('.tmp-install-')),
    'the temp install directory must be removed on every error path');
});

// ── g) GET /api/modules/updates ──────────────────────────────────────────────
// The update banner's read-only endpoint. Every case below returns before the
// lazy js/module-updates.mjs import is ever reached (no-token, no-modules and
// gitlab-unreachable all short-circuit earlier), so this suite never depends
// on that file existing.

test('GET /api/modules/updates with no token answers 200 and reason: no-token', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/updates');
  assert.strictEqual(status, 200);
  assert.notStrictEqual(status, 401);
  assert.notStrictEqual(status, 500);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.reason, 'no-token');
  assert.deepStrictEqual(body.modules, []);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
  assert.ok(ENGLISH_COPY_RE.test(body.message), 'message should be English UI copy');
});

test('GET /api/modules/updates with an unreachable GitLab answers 200 and reason: gitlab-unreachable', async () => {
  const first = await getJson(PORT_WITH_TOKEN, '/api/modules/updates');
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.ok, false);
  assert.strictEqual(first.body.reason, 'gitlab-unreachable');
  assert.deepStrictEqual(first.body.modules, []);

  // A second call reads the same cached catalog snapshot as /api/modules/catalog
  // and must not crash or reach the network again.
  const second = await getJson(PORT_WITH_TOKEN, '/api/modules/updates');
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.reason, 'gitlab-unreachable');
});

test('GET /api/modules/updates never echoes the token back', async () => {
  const r = await fetch(apiUrl(PORT_WITH_TOKEN, '/api/modules/updates'), {
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text();
  assert.ok(!raw.includes('glpat-'), 'response body must not contain the token');
});

test('GET /api/modules/updates with no modules installed answers 200 and reason: no-modules', async () => {
  const { status, body } = await getJson(PORT_EMPTY, '/api/modules/updates');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.reason, 'no-modules');
  assert.deepStrictEqual(body.modules, []);
  assert.strictEqual(body.catalogFetchedAt, null);
});

// ── c) Install: the id is hostile until proven otherwise ─────────────────────

test('POST /api/modules/install rejects an id that escapes modules/', async () => {
  for (const id of ['../evil', '/etc/passwd', 'a/b', '..', 'settings']) {
    const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/install', { id });
    assert.strictEqual(status, 400, `id ${JSON.stringify(id)} should be rejected`);
    assert.strictEqual(body.error, 'invalid-id');
  }
  assert.deepStrictEqual(modulesDirEntries(), entriesBefore,
    'a rejected id must not create anything on disk');
});

// ── d) Install: already present ──────────────────────────────────────────────

test('POST /api/modules/install answers 409 for a module that is already installed', async () => {
  const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/install', { id: 'fixture-mod' });
  assert.strictEqual(status, 409);
  assert.strictEqual(body.error, 'already-installed');
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
});

// ── e) Install: a failed download leaves nothing behind ──────────────────────

// The temp directory is a dotfile on purpose (loadModules skips dotfiles and
// serveStatic blocks them), but a leftover is still a bug: the next install of
// the same id would collide with it.
test('POST /api/modules/install leaves no temp directory when the download fails', async () => {
  const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/install', { id: 'no-such-id' });
  assert.ok(status >= 400, `expected a failure status, got ${status}`);
  assert.ok(body && typeof body.error === 'string' && body.error.length > 0,
    'a failed install must name its error');

  const after = modulesDirEntries();
  assert.deepStrictEqual(after, entriesBefore, 'no new entry may survive a failed install');
  assert.ok(!after.some(n => n.startsWith('.tmp-install-')),
    'the temp install directory must be removed on every error path');
});

function installArtifact(id, version = '0.1.0') {
  return {
    schemaVersion: 1, id, name: 'Local catalog artifact', version,
    sidebar: { label: 'Local artifact', kind: 'item' },
    views: [{ id: id + '-main', label: 'Main' }],
    client: { entry: 'client/index.js' },
  };
}

// Include temporary directories and file contents, not just module names.
function snapshotInstallTree(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => [entry.name, entry.isDirectory()
      ? snapshotInstallTree(path.join(dir, entry.name))
      : fs.readFileSync(path.join(dir, entry.name)).toString('base64')]);
}

test('POST /api/modules/install gates missing area, persists retry AR and retains it on legacy overwrite', async () => {
  const id = 'catalog-area-retry';
  const target = path.join(stubModulesDir, id);
  const originBefore = fs.readFileSync(stubOriginFile, 'utf8');
  const treeBefore = snapshotInstallTree(stubModulesDir);
  stubArtifact = installArtifact(id);
  try {
    const refused = await postJson(PORT_STUB_GITLAB, '/api/modules/install', { id });
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.error, 'area-required');
    assert.strictEqual(refused.body.needsArea, true);
    assert.strictEqual(refused.body.id, id);
    assert.ok(Array.isArray(refused.body.suggestions));
    assert.ok(refused.body.suggestions.includes('Engineering'));
    assert.strictEqual(fs.existsSync(target), false);
    assert.deepStrictEqual(snapshotInstallTree(stubModulesDir), treeBefore, 'no destination or staging residue');
    assert.strictEqual(fs.readFileSync(stubOriginFile, 'utf8'), originBefore);

    for (const [version, payload] of [
      ['0.1.0', { id, area: 'Engineering' }],
      ['0.2.0', { id, overwrite: true }],
    ]) {
      stubArtifact = installArtifact(id, version);
      const readsBefore = stubManifestReads;
      const installed = await postJson(PORT_STUB_GITLAB, '/api/modules/install', payload);
      assert.strictEqual(installed.status, 200, JSON.stringify(installed.body));
      assert.strictEqual(installed.body.ok, true);
      assert.strictEqual(installed.body.id, id);
      assert.strictEqual(installed.body.version, version);
      assert.strictEqual(installed.body.restartRequired, true);
      assert.strictEqual(stubManifestReads, readsBefore + 1, 'each install downloads the legacy manifest');
      assert.strictEqual(stubArtifact.area, undefined, 'the downloaded artifact itself still has no area');
      // The installed file is the staged module.json after the directory swap:
      // an in-memory-only resolution would lose AR here.
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(target, 'module.json'), 'utf8')),
        { ...stubArtifact, area: 'Engineering' });
      assert.strictEqual(fs.readFileSync(path.join(target, 'client/index.js'), 'utf8'),
        '// Local test artifact ' + version + '\n', 'overwrite installs the new payload, not a no-op');
      assert.deepStrictEqual(fs.readdirSync(stubModulesDir), [id], 'no staging or backup residue');
      assert.strictEqual(fs.existsSync(path.join(target, '.git')), false);
      const origin = JSON.parse(fs.readFileSync(stubOriginFile, 'utf8'));
      assert.strictEqual(origin[id].source, 'catalog');
      assert.strictEqual(origin[id].version, version);
      assert.deepStrictEqual(origin.unrelated, JSON.parse(originBefore).unrelated);
    }
  } finally {
    stubArtifact = null;
    fs.rmSync(target, { recursive: true, force: true });
    fs.writeFileSync(stubOriginFile, originBefore);
  }
});

test('POST /api/modules/install rejects invalid explicit area despite a valid artifact without changing disk', async () => {
  const id = 'catalog-area-invalid';
  const target = path.join(stubModulesDir, id);
  const originBefore = fs.readFileSync(stubOriginFile, 'utf8');
  stubArtifact = { ...installArtifact(id, '0.2.0'), area: 'Product' };
  try {
    for (const overwrite of [false, true]) {
      if (overwrite) {
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'module.json'),
          JSON.stringify({ ...installArtifact(id), area: 'Engineering' }));
        fs.writeFileSync(path.join(target, 'keep.txt'), 'Local content must survive rejection.\n');
      }
      const before = snapshotInstallTree(stubModulesDir);
      for (const area of ['', 42]) {
        const result = await postJson(PORT_STUB_GITLAB, '/api/modules/install', { id, area, overwrite });
        assert.strictEqual(result.status, 400, JSON.stringify(result.body));
        assert.strictEqual(result.body.error, 'area-invalid');
        assert.deepStrictEqual(snapshotInstallTree(stubModulesDir), before,
          'invalid area must not install, replace files or leave staging/backup residue');
        assert.strictEqual(fs.readFileSync(stubOriginFile, 'utf8'), originBefore);
      }
    }
  } finally {
    stubArtifact = null;
    fs.rmSync(target, { recursive: true, force: true });
  }
});

let GIT_AVAILABLE = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { GIT_AVAILABLE = false; }

test('POST /api/modules/install reconciles a dirty repo equal to the published version, and names the files when it differs',
  { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
    const id = 'catalog-reconcile';
    const target = path.join(reconcileModulesDir, id);
    const g = (...args) => execFileSync('git', ['--git-dir', path.join(target, '.git'), '--work-tree', target, ...args], { encoding: 'utf8' });
    const published = { ...installArtifact(id, '0.1.0'), area: 'Engineering' };
    stubRefArtifact = published;
    stubArtifact = { ...installArtifact(id, '0.2.0'), area: 'Engineering' };
    stubCatalog = {
      catalogText: JSON.stringify({ schemaVersion: 1, modules: [{ id, status: 'beta', area: 'Engineering' }] }),
      manifests: { [id]: stubArtifact },
      writes: [],
    };
    try {
      // The published tree on disk, with a DIFFERENT first commit so the repo is dirty.
      fs.mkdirSync(path.join(target, 'client'), { recursive: true });
      fs.writeFileSync(path.join(target, 'module.json'), JSON.stringify({ ...published, name: 'scaffold' }));
      execFileSync('git', ['init', '-q', '-b', 'main', target]);
      g('add', '-A');
      g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'initial state (scaffold)');
      fs.writeFileSync(path.join(target, 'module.json'), JSON.stringify(published));
      fs.writeFileSync(path.join(target, 'client', 'index.js'), '// Local test artifact 0.1.0\n');
      fs.writeFileSync(path.join(target, 'client', 'extra.js'), '// unpublished\n');

      const refused = await postJson(PORT_RECONCILE, '/api/modules/install', { id, overwrite: true });
      assert.strictEqual(refused.status, 409, JSON.stringify(refused.body));
      assert.strictEqual(refused.body.error, 'module-dirty');
      assert.strictEqual(refused.body.reconcile.reason, 'differs');
      assert.ok(refused.body.reconcile.paths.includes('client/extra.js'));
      assert.ok(refused.body.message.includes('client/extra.js'));
      assert.match(g('log', '--oneline'), /initial state/);
      assert.ok(!/publish/.test(g('log', '--oneline')), 'no commit on a differing tree');

      fs.rmSync(path.join(target, 'client', 'extra.js'));
      // Equal published tree, but an unpublished dotfile the swap would delete:
      // still refused, the file named and left on disk. A cache is not a reason.
      fs.writeFileSync(path.join(target, '.env'), 'LOCAL=1\n');
      fs.mkdirSync(path.join(target, 'client', '__pycache__'));
      fs.writeFileSync(path.join(target, 'client', '__pycache__', 'x.pyc'), 'cache');
      const kept = await postJson(PORT_RECONCILE, '/api/modules/install', { id, overwrite: true });
      assert.strictEqual(kept.status, 409, JSON.stringify(kept.body));
      assert.strictEqual(kept.body.reconcile.reason, 'unpublished-local');
      assert.deepStrictEqual(kept.body.reconcile.paths, ['.env']);
      assert.ok(kept.body.message.includes('.env'));
      assert.ok(fs.existsSync(path.join(target, '.env')));

      fs.rmSync(path.join(target, '.env'));
      const ok = await postJson(PORT_RECONCILE, '/api/modules/install', { id, overwrite: true });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
      // The refused call above already committed the reconcile; what was left
      // is only the __pycache__, which the module's .git/info/exclude hides,
      // so this install sees a CLEAN repo and needs no second reconcile.
      assert.strictEqual(ok.body.git.reconciled, undefined);
      assert.strictEqual(ok.body.git.kept, true);
      const log = g('log', '--oneline').split('\n').filter(Boolean);
      assert.match(log[0], /install from catalog 0\.2\.0/);
      assert.match(log[1], /publish 0\.1\.0 \(reconciled with catalog\)/);
    } finally {
      stubArtifact = null;
      stubRefArtifact = null;
      stubCatalog = null;
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

// ── GET /api/merge-requests/counts (the "MR:" chips on the top bar) ──────────
// Two rows: the module catalog (MODULES_CATALOG_TOKEN) and this repository's
// own feedback merge requests (APP_UPDATE_TOKEN, label `feedback`). Always
// 200 on the same reasoning as the catalog route: a missing token is a fresh
// install and an unreachable GitLab is a VPN story, and neither may paint an
// error on every view. Rows are looked up by `key`, never by index, so a row
// added later cannot silently re-point an assertion at the wrong repository.

test('GET /api/merge-requests/counts with no token answers 200 and a no_token row per repository', async () => {
  const { status, body } = await getJson(PORT, '/api/merge-requests/counts');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(Array.isArray(body.repos));
  assert.strictEqual(body.repos.length, 2);
  // This server carries neither token, so both rows say so and the top bar
  // paints no chip at all (mrRowsToPaint drops every no_token row).
  const feedback = body.repos.find(r => r.key === 'feedback');
  assert.ok(feedback, 'a feedback row must be present');
  assert.strictEqual(feedback.count, null);
  assert.strictEqual(feedback.error, 'no_token');
  assert.strictEqual(feedback.shortLabel, 'FB');
  assert.match(feedback.webUrl, /label_name=feedback$/);
  const row = body.repos.find(r => r.key === 'modules');
  assert.ok(row, 'a modules row must be present');
  assert.strictEqual(row.count, null);
  assert.strictEqual(row.error, 'no_token');
  assert.ok(typeof row.label === 'string' && row.label.length > 0);
  assert.strictEqual(row.shortLabel, 'MC');
  // The link is public knowledge, so it travels even without a token.
  assert.match(row.webUrl, /^https:\/\/gitlab\.example\.com\/.+\/-\/merge_requests$/);
});

test('GET /api/merge-requests/counts with an unreachable GitLab answers 200, count null, gitlab_error', async () => {
  const { status, body } = await getJson(PORT_WITH_TOKEN, '/api/merge-requests/counts');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  const row = body.repos.find(r => r.key === 'modules');
  assert.ok(row, 'a modules row must be present');
  assert.strictEqual(row.count, null);
  assert.strictEqual(row.error, 'gitlab_error');
  // The app token is absent on this server, so the feedback row is no_token
  // rather than gitlab_error - a missing credential and a dead GitLab are
  // different stories and the chip treats them differently.
  const feedback = body.repos.find(r => r.key === 'feedback');
  assert.strictEqual(feedback.error, 'no_token');
});

test('GET /api/modules/publish-drift without a token answers 200 with no_token', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/publish-drift');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body, { ok: true, items: [], failed: [], error: 'no_token' });
});

test('POST /api/modules/bump-version raises the patch number of module.json only', async () => {
  const dir = path.join(stubModulesDir, 'bump-test');
  fs.mkdirSync(dir, { recursive: true });
  const text = '{\n  "schemaVersion": 1,\n  "id": "bump-test",\n  "version": "0.2.9",\n  "name": "Bump"\n}\n';
  fs.writeFileSync(path.join(dir, 'module.json'), text);
  try {
    const ok = await postJson(PORT_STUB_GITLAB, '/api/modules/bump-version', { id: 'bump-test' });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(ok.body, { ok: true, from: '0.2.9', to: '0.2.10' });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'), text.replace('0.2.9', '0.2.10'));
    const missing = await postJson(PORT_STUB_GITLAB, '/api/modules/bump-version', { id: 'no-such-id' });
    assert.strictEqual(missing.status, 404);
    const bad = await postJson(PORT_STUB_GITLAB, '/api/modules/bump-version', { id: '../x' });
    assert.strictEqual(bad.status, 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/modules/pending-publishes without a token answers 200 with no_token', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/pending-publishes');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body, { ok: true, items: [], error: 'no_token' });
});

test('GET /api/modules/pending-publishes with an unreachable GitLab answers 200 with gitlab_error', async () => {
  const { status, body } = await getJson(PORT_WITH_TOKEN, '/api/modules/pending-publishes');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body, { ok: true, items: [], error: 'gitlab_error' });
});

test('GET /api/modules/pending-publishes against GitLab skips MRs that are not publish branches', async () => {
  const { status, body } = await getJson(PORT_STUB_GITLAB, '/api/modules/pending-publishes');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.error, undefined);
  assert.deepStrictEqual(body.items, []);
});

test('GET /api/modules/pending-publishes: a publish merged after the catalog snapshot drops that snapshot (regression)', async () => {
  // 2026-10-06: three modules published and merged within minutes stayed on
  // "Wymagaja publikacji" - the MR had left the open list while the cached
  // catalog still held the pre-merge versions for up to five minutes.
  const warm = await getJson(PORT_STUB_GITLAB, '/api/modules/catalog?force=1');
  assert.strictEqual(warm.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  stubMergedMrs = [{ source_branch: 'module/workspace-20261006-155246', merged_at: new Date().toISOString() }];
  try {
    const stale = await getJson(PORT_STUB_GITLAB, '/api/modules/pending-publishes?force=1');
    assert.strictEqual(stale.status, 200);
    assert.strictEqual(stale.body.catalogStale, true);
    assert.strictEqual(stale.body.merged, undefined, 'the merged list stays server-side');
    const fresh = await getJson(PORT_STUB_GITLAB, '/api/modules/catalog');
    assert.strictEqual(fresh.body.source, 'gitlab', 'the stale snapshot must not be served again');
    const again = await getJson(PORT_STUB_GITLAB, '/api/modules/pending-publishes');
    assert.strictEqual(again.body.catalogStale, undefined, 'a snapshot taken after the merge is not stale');
  } finally {
    stubMergedMrs = [];
  }
});

test('GET /api/merge-requests/counts never echoes the token back', async () => {
  const r = await fetch(apiUrl(PORT_WITH_TOKEN, '/api/merge-requests/counts'), {
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text();
  assert.ok(!raw.includes('glpat-'), 'response body must not contain the token');
});

test('GET /api/merge-requests/counts reads the count from x-total and caches it for a minute', async () => {
  stubOpenMrTotal = 3;
  const readsBefore = stubMrListReads;
  const probesBefore = stubProbeCount;
  const first = await getJson(PORT_STUB_GITLAB, '/api/merge-requests/counts');
  assert.strictEqual(first.status, 200);
  const firstModules = first.body.repos.find(r => r.key === 'modules');
  assert.strictEqual(firstModules.count, 3);
  assert.strictEqual(firstModules.error, undefined);
  assert.strictEqual(stubMrListReads - readsBefore, 1, 'one call, one GitLab request');
  assert.strictEqual(stubProbeCount - probesBefore, 0, 'the counter never asks the project probe');
  // A second call inside the TTL is served from the cache - the top bar polls
  // this route from every open tab, so it must not cost a GitLab call each.
  stubOpenMrTotal = 9;
  const second = await getJson(PORT_STUB_GITLAB, '/api/merge-requests/counts');
  assert.strictEqual(second.body.repos.find(r => r.key === 'modules').count, 3);
  assert.strictEqual(stubMrListReads - readsBefore, 1, 'the second call must not reach GitLab');
  stubOpenMrTotal = 0;
});

test('GET /api/merge-requests/counts rejects a foreign Origin', async () => {
  const r = await fetch(apiUrl(PORT_WITH_TOKEN, '/api/merge-requests/counts'), {
    headers: { Origin: 'https://evil.example.com' },
    signal: AbortSignal.timeout(20000),
  });
  assert.strictEqual(r.status, 403);
});

// ── f) Install is a write, so the Origin check applies ───────────────────────

test('POST /api/modules/install rejects a foreign Origin', async () => {
  const { status } = await postJson(
    PORT_WITH_TOKEN,
    '/api/modules/install',
    { id: 'cokolwiek' },
    { Origin: 'https://evil.example.com' },
  );
  assert.strictEqual(status, 403);
  assert.deepStrictEqual(modulesDirEntries(), entriesBefore,
    'a rejected origin must not create anything on disk');
});

// ── POST /api/modules/publish ────────────────────────────────────────────────
// The catalog repo's main is protected, so publishing goes branch -> commit ->
// merge request. GitLab is unreachable in these tests, so what is exercised is
// the guard layer: nothing may reach the network before the id, the module and
// the token have all been checked.

test('POST /api/modules/publish rejects an id that escapes modules/', async () => {
  for (const id of ['../evil', '/etc/passwd', 'a/b', 'settings']) {
    const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id });
    assert.strictEqual(status, 400, `id ${JSON.stringify(id)} should be rejected`);
    assert.strictEqual(body.error, 'invalid-id');
  }
});

test('POST /api/modules/publish answers 404 for a module that is not installed', async () => {
  const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'no-such-id' });
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'not-found');
});

// A missing token is a normal first-run state, not a 500 and not a 401.
test('POST /api/modules/publish with no token answers 200 and error: no-token', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/publish', { id: 'fixture-mod' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'no-token');
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
});

test('POST /api/modules/publish degrades readably when GitLab is unreachable', async () => {
  const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.ok(['gitlab-unreachable', 'forbidden'].includes(body.error), `unexpected error ${body.error}`);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);

  // A failed publish - the tree read itself never completes when GitLab is
  // unreachable - must never write an origin record: only a SUCCESSFUL
  // publish updates the base a later publish compares itself against.
  assert.strictEqual(readOrigin()['fixture-mod'], undefined,
    'a failed publish must not write an origin record');
});

// The version gate reads the catalog snapshot before it can compare anything;
// when that snapshot is not `ok` the gate must let the publish through rather
// than block it - an unreachable GitLab must never read as "version too low".
test('POST /api/modules/publish does not block on the version gate when the catalog is unreachable', async () => {
  const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.notStrictEqual(body.error, 'version-not-bumped');
  assert.ok(['gitlab-unreachable', 'forbidden'].includes(body.error), `unexpected error ${body.error}`);
});

// The status picked in the publish modal is SAVED into module.json before the
// first GitLab call, so it survives an unreachable GitLab - and the fixture
// manifest is restored afterwards, because it is a committed file.
test('POST /api/modules/publish writes the chosen status into module.json', async () => {
  const manifestPath = path.join(MODULES_DIR, 'fixture-mod', 'module.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  assert.strictEqual(JSON.parse(original).status, undefined, 'fixture starts without a status');
  try {
    const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod', status: 'stable' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, false, 'GitLab is unreachable in this suite');
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(saved.status, 'stable');
    const keys = Object.keys(saved);
    assert.strictEqual(keys[keys.indexOf('version') + 1], 'status');

    // A request without a status leaves the manifest alone.
    await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod' });
    assert.strictEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).status, 'stable');

    // An unknown status is ignored, never written.
    await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod', status: 'alpha' });
    assert.strictEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).status, 'stable');
  } finally {
    fs.writeFileSync(manifestPath, original);
  }
});

// The area gate runs BEFORE any GitLab access (plan step 5): a module with no
// area and no body.area answers 400 area-missing without a network call, so
// this test is safe to run with no token and no real GitLab reachable at all.
test('POST /api/modules/publish without area and without body.area answers 400 area-missing before any network call', async () => {
  const manifestPath = path.join(MODULES_DIR, 'fixture-mod', 'module.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  const withoutArea = JSON.stringify({ ...JSON.parse(original), area: undefined });
  // JSON.stringify drops an `undefined` value entirely, so this really has
  // no `area` key - not an empty string, which validateModuleArea would also
  // reject, but for a different reason.
  fs.writeFileSync(manifestPath, withoutArea);
  try {
    assert.strictEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).area, undefined, 'precondition: no area on disk');
    const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod' });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error, 'area-missing');
    assert.ok(typeof body.message === 'string' && body.message.length > 0);
    assert.strictEqual(readOrigin()['fixture-mod'], undefined, 'a refused publish must not write an origin record');
  } finally {
    fs.writeFileSync(manifestPath, original);
  }
});

// The area gate must run BEFORE the no-token check (fix: it used to run
// after, which made "missing area" untestable without a fake token). With NO
// token configured at all (PORT) and no area anywhere, the answer must still
// be 400 area-missing, never 200 no-token - proving the gate really runs
// first and needs no network/token to do it.
test('POST /api/modules/publish area-missing is answered even with no token configured (area gate runs before no-token)', async () => {
  const manifestPath = path.join(MODULES_DIR, 'fixture-mod', 'module.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  const withoutArea = JSON.stringify({ ...JSON.parse(original), area: undefined });
  fs.writeFileSync(manifestPath, withoutArea);
  try {
    const { status, body } = await postJson(PORT, '/api/modules/publish', { id: 'fixture-mod' });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error, 'area-missing');
  } finally {
    fs.writeFileSync(manifestPath, original);
  }
});

// The publish modal's explicit `area` field must be able to CHANGE the area
// already on the manifest (e.g. Product -> Engineering) - it must not be silently
// ignored in favour of whatever is already saved. The write happens inside
// the area gate, before any GitLab call, so it is observable even though the
// publish itself fails afterwards (GitLab is unreachable in this suite).
test('POST /api/modules/publish: an explicit body.area overrides and persists over the manifest area', async () => {
  const manifestPath = path.join(MODULES_DIR, 'fixture-mod', 'module.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  assert.strictEqual(JSON.parse(original).area, 'Product', 'precondition: fixture starts as Product');
  try {
    const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod', area: 'Engineering' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, false, 'GitLab is unreachable in this suite - only the area write is under test');
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(saved.area, 'Engineering', 'the explicit body.area must have overridden the manifest area');
  } finally {
    fs.writeFileSync(manifestPath, original);
  }
});

// An explicit body.area that is invalid (empty string, or a non-string) must
// be refused with 400 area-invalid - it must NEVER be silently ignored and
// fall back to whatever area the manifest already has.
test('POST /api/modules/publish: an explicit but invalid body.area is refused, not silently ignored', async () => {
  const manifestPath = path.join(MODULES_DIR, 'fixture-mod', 'module.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  try {
    const r1 = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod', area: '' });
    assert.strictEqual(r1.status, 400);
    assert.strictEqual(r1.body.error, 'area-invalid');

    const r2 = await postJson(PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod', area: 42 });
    assert.strictEqual(r2.status, 400);
    assert.strictEqual(r2.body.error, 'area-invalid');

    // Neither attempt touched the manifest on disk.
    assert.strictEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).area, 'Product');
  } finally {
    fs.writeFileSync(manifestPath, original);
  }
});

test('POST /api/modules/publish never echoes the token back', async () => {
  const r = await fetch(apiUrl(PORT_WITH_TOKEN, '/api/modules/publish'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'fixture-mod' }),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text();
  assert.ok(!raw.includes('glpat-'), 'response body must not contain the token');
});

test('POST /api/modules/publish rejects a foreign Origin', async () => {
  const { status } = await postJson(
    PORT_WITH_TOKEN, '/api/modules/publish', { id: 'fixture-mod' },
    { Origin: 'https://evil.example.com' },
  );
  assert.strictEqual(status, 403);
});

// ── POST /api/modules/catalog/migrate-areas ─────────────────────────────────
// The backfill of `area` on catalog entries published before the field
// existed. Driven end to end against the stub: what must be asserted is the
// SHAPE of the write (one branch, one commit carrying catalog.json plus each
// module.json, one merge request) and that a dry run writes nothing.

function backfillManifest(id, area) {
  const m = { ...installArtifact(id), status: 'beta' };
  if (area) m.area = area;
  return m;
}

test('POST /api/modules/catalog/migrate-areas with no token answers 200 and error: no-token', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/catalog/migrate-areas', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'no-token');
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
});

test('POST /api/modules/catalog/migrate-areas validates the request before any GitLab access', async () => {
  const badArea = await postJson(PORT_WITH_TOKEN, '/api/modules/catalog/migrate-areas', { areas: { 'fixture-mod': 'Cyber\tstore' } });
  assert.strictEqual(badArea.status, 400, JSON.stringify(badArea.body));
  assert.strictEqual(badArea.body.error, 'area-invalid');
  assert.ok(ENGLISH_COPY_RE.test(badArea.body.message), 'message should be English UI copy');
  const badId = await postJson(PORT_WITH_TOKEN, '/api/modules/catalog/migrate-areas', { areas: { '../x': 'Engineering' } });
  assert.strictEqual(badId.status, 400);
  assert.strictEqual(badId.body.error, 'invalid-id');
  const badShape = await postJson(PORT_WITH_TOKEN, '/api/modules/catalog/migrate-areas', { areas: ['Engineering'] });
  assert.strictEqual(badShape.status, 400);
  assert.strictEqual(badShape.body.error, 'bad-request');
  const { status } = await postJson(
    PORT_WITH_TOKEN, '/api/modules/catalog/migrate-areas', {}, { Origin: 'https://evil.example.com' },
  );
  assert.strictEqual(status, 403);
});

test('POST /api/modules/catalog/migrate-areas degrades readably when GitLab is unreachable', async () => {
  const { status, body } = await postJson(PORT_WITH_TOKEN, '/api/modules/catalog/migrate-areas', { dryRun: true });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.ok(['gitlab-unreachable', 'gitlab-no-access'].includes(body.error), `unexpected error ${body.error}`);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
});

test('POST /api/modules/catalog/migrate-areas plans from the installed module, dry-runs without writing, then opens one MR', async () => {
  const id = 'catalog-area-backfill';
  const other = 'catalog-area-done';
  const target = path.join(stubModulesDir, id);
  // The installed copy of `id` carries the area the remote lacks; `other`
  // already has one on the remote and must be left alone.
  fs.mkdirSync(path.join(target, 'client'), { recursive: true });
  fs.writeFileSync(path.join(target, 'module.json'), JSON.stringify(backfillManifest(id, 'Engineering'), null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'client', 'index.js'), '// installed\n');
  const catalogText = JSON.stringify({
    schemaVersion: 1,
    modules: [
      { id, status: 'beta', summary: 'No area yet', owner: { slug: 'sam-rivera', name: 'Sam Rivera' } },
      { id: other, status: 'stable', area: 'Product' },
    ],
  }, null, 2) + '\n';
  stubCatalog = {
    catalogText,
    manifests: { [id]: backfillManifest(id), [other]: backfillManifest(other, 'Product') },
    writes: [],
  };
  try {
    const dry = await postJson(PORT_STUB_GITLAB, '/api/modules/catalog/migrate-areas', { dryRun: true });
    assert.strictEqual(dry.status, 200, JSON.stringify(dry.body));
    assert.strictEqual(dry.body.ok, true);
    assert.strictEqual(dry.body.dryRun, true);
    assert.deepStrictEqual(dry.body.set, [{ id, area: 'Engineering', source: 'installed', curated: true }]);
    assert.deepStrictEqual(dry.body.skipped, [{ id: other, reason: 'has-area' }]);
    assert.strictEqual(dry.body.branch, null);
    assert.strictEqual(dry.body.mrUrl, null);
    assert.deepStrictEqual(stubCatalog.writes, [], 'a dry run writes nothing');

    // An explicit area in the body wins over the installed module's.
    const override = await postJson(PORT_STUB_GITLAB, '/api/modules/catalog/migrate-areas',
      { dryRun: true, areas: { [id]: 'Operations' } });
    assert.strictEqual(override.status, 200, JSON.stringify(override.body));
    assert.deepStrictEqual(override.body.set, [{ id, area: 'Operations', source: 'request', curated: true }]);
    assert.deepStrictEqual(stubCatalog.writes, []);

    const real = await postJson(PORT_STUB_GITLAB, '/api/modules/catalog/migrate-areas', {});
    assert.strictEqual(real.status, 200, JSON.stringify(real.body));
    assert.strictEqual(real.body.ok, true);
    assert.strictEqual(real.body.dryRun, false);
    assert.ok(/^catalog\/areas-\d{8}-\d{6}$/.test(real.body.branch), real.body.branch);
    assert.strictEqual(real.body.mrIid, 7);
    assert.ok(/merge_requests\/7$/.test(real.body.mrUrl));
    assert.strictEqual(real.body.files, 2);

    assert.deepStrictEqual(stubCatalog.writes.map((w) => w.kind), ['branch', 'commit', 'mr']);
    const [branch, commit, mr] = stubCatalog.writes;
    assert.strictEqual(branch.query.branch, real.body.branch);
    assert.strictEqual(branch.query.ref, 'main');
    assert.strictEqual(commit.body.branch, real.body.branch);
    assert.ok(!/[^\x00-\x7f]/.test(commit.body.commit_message), 'commit message stays ASCII');
    assert.deepStrictEqual(commit.body.actions.map((a) => [a.action, a.file_path]),
      [['update', 'catalog.json'], ['update', 'modules/' + id + '/module.json']]);
    const catalogAfter = JSON.parse(commit.body.actions[0].content);
    const entryAfter = catalogAfter.modules.find((m) => m.id === id);
    assert.strictEqual(entryAfter.area, 'Engineering');
    assert.deepStrictEqual(entryAfter.owner, { slug: 'sam-rivera', name: 'Sam Rivera' }, 'owner survives the backfill');
    assert.deepStrictEqual(Object.keys(entryAfter), ['id', 'status', 'area', 'summary', 'owner'], 'area lands right after status');
    assert.deepStrictEqual(catalogAfter.modules.find((m) => m.id === other), { id: other, status: 'stable', area: 'Product' });
    const manifestAfter = JSON.parse(commit.body.actions[1].content);
    assert.deepStrictEqual(manifestAfter, { ...backfillManifest(id), area: 'Engineering' });
    assert.strictEqual(mr.body.source_branch, real.body.branch);
    assert.strictEqual(mr.body.target_branch, 'main');
    assert.strictEqual(mr.body.remove_source_branch, true);
    assert.ok(ENGLISH_COPY_RE.test(mr.body.title), 'MR title is English UI copy');
    assert.ok(mr.body.description.includes('`' + id + '` → `Engineering`'));

    // Idempotent on the remote: once every entry carries an area there is
    // nothing to plan and nothing is written.
    stubCatalog.catalogText = commit.body.actions[0].content;
    stubCatalog.manifests[id] = manifestAfter;
    stubCatalog.writes = [];
    const again = await postJson(PORT_STUB_GITLAB, '/api/modules/catalog/migrate-areas', {});
    assert.strictEqual(again.status, 200, JSON.stringify(again.body));
    assert.strictEqual(again.body.ok, true);
    assert.deepStrictEqual(again.body.set, []);
    assert.strictEqual(again.body.branch, null);
    assert.ok(ENGLISH_COPY_RE.test(again.body.message));
    assert.deepStrictEqual(stubCatalog.writes, []);
  } finally {
    stubCatalog = null;
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('POST /api/modules/catalog/migrate-areas reports an entry with no area source as skipped and writes nothing', async () => {
  const id = 'catalog-area-orphan';
  stubCatalog = {
    catalogText: JSON.stringify({ schemaVersion: 1, modules: [{ id, status: 'beta' }] }) + '\n',
    manifests: { [id]: backfillManifest(id) },
    writes: [],
  };
  try {
    const { status, body } = await postJson(PORT_STUB_GITLAB, '/api/modules/catalog/migrate-areas', {});
    assert.strictEqual(status, 200, JSON.stringify(body));
    assert.strictEqual(body.ok, true);
    assert.deepStrictEqual(body.set, []);
    assert.deepStrictEqual(body.skipped, [{ id, reason: 'no-source' }]);
    assert.strictEqual(body.branch, null);
    assert.deepStrictEqual(stubCatalog.writes, []);
  } finally {
    stubCatalog = null;
  }
});
