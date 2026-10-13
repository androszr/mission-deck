'use strict';
// tests/test_api_sync_overview_refresh.js
// POST /api/sync-overview/refresh - the one place the sync table's FETCH
// direction gets network.
//
// Why it exists: every "server" number in a status row (filesToFetch, behind,
// remoteAt) is read off `@{upstream}`, which is a LOCAL ref
// (refs/remotes/origin/<branch>). git moves it on fetch, pull and push and on
// nothing else, and the status poll spends no network by design - so a
// teammate's push stayed invisible in the sync window until somebody happened
// to pull. `check-update` was not the escape hatch its comment claimed
// (`ls-remote` writes no ref, it is data-tier-0 only, and no client called it).
//
// What this suite can prove: the route exists, guards its content type, answers
// the FULL overview shape so the client needs no follow-up GET, and reports one
// result per source rather than one verdict for all eight. What it cannot: a
// real fetch. `_gitExecRepo` refuses every remote op whose origin is not clean
// HTTPS - a `file://` remote included - which is a security rule, not a defect,
// so a local remote can never be fetched from here. The classification of that
// refusal is what the "reports per source" assertion pins.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, waitForServer, stopServer, getJson, postJson, apiUrl } = require('./_api_helper');

const PORT = 3528;

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-refresh-'));
const REMOTE = path.join(BASE, 'remote.git');
const PLAIN_DIR = path.join(BASE, 'ds-data');
const MIRROR_DIR = PLAIN_DIR + '-encrypted';
const SUB_REPOS = path.join(BASE, 'sub-repos');
// Empty on purpose, same pattern as tests/test_api_sync_modules.js: the new
// test below asserts a per-module row (_team vs _core), which must not depend
// on whatever happens to be installed under the real gitignored modules/.
const MODULES_DIR = path.join(BASE, 'modules-empty');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
  }).trim();
}

async function waitFor(pred, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(r => setTimeout(r, 200));
  }
}

let child;

test.before(async () => {
  const work = path.join(BASE, 'seed-mirror');
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'aaaa.enc'), 'v2:seed');
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'seed');
  git(BASE, 'clone', '-q', '--bare', work, REMOTE);
  fs.mkdirSync(MODULES_DIR, { recursive: true });

  child = startServer(PORT, {
    COCKPIT_DATA_TOKEN: 'test-token',
    DATA_TIER_0_REPO_URL: 'file://' + REMOTE,
    DATA_TIER_0_DIR: PLAIN_DIR,
    DATA_SUB_REPOS_DIR: SUB_REPOS,
    MODULES_DIR,
    AUTO_SYNC_ENABLED: '0',
    // A throwaway key, so name resolution never depends on whether the
    // machine running the suite has a real .encryption-key.
    DATA_ENCRYPTION_KEY: require('node:crypto').randomBytes(32).toString('base64'),
  });
  await waitForServer(PORT);
  await postJson(PORT, '/api/data/data-tier-0/clone', {});
  await waitFor(async () => {
    const { body } = await getJson(PORT, '/api/data/data-tier-0/status');
    return body.exists ? body : null;
  });
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(BASE, { recursive: true, force: true });
});

test('answers the whole sync-overview shape, so the client needs no follow-up GET', async () => {
  const { status, body } = await postJson(PORT, '/api/sync-overview/refresh', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  assert.ok(Array.isArray(body.repos) && body.repos.length > 0, 'the row list the table paints from');
  assert.strictEqual(typeof body.autoSyncEnabled, 'boolean');
  assert.strictEqual(typeof body.intervalMs, 'number');

  const { body: getBody } = await getJson(PORT, '/api/sync-overview');
  assert.deepStrictEqual(
    body.repos.map(r => r.repo),
    getBody.repos.map(r => r.repo),
    'same rows in the same order as the GET - one payload builder, not two',
  );
  const row = body.repos.find(r => r.repo === 'data-tier-0');
  for (const field of ['filesToSend', 'filesToFetch', 'localAt', 'remoteAt', 'behind', 'ahead']) {
    assert.ok(field in row, `the refreshed row still carries ${field}`);
  }
});

test('reports one result per source, and never claims success for a source it could not reach', async () => {
  const { body } = await postJson(PORT, '/api/sync-overview/refresh', { force: true });
  assert.ok(Array.isArray(body.refreshed), 'per-source results, not one verdict for all eight');

  const tier0 = body.refreshed.find(r => r.repo === 'data-tier-0');
  assert.ok(tier0, 'the cloned source with a token is a refresh target: ' + JSON.stringify(body.refreshed));
  // The origin here is file://, which _gitExecRepo refuses for every remote
  // op. What matters is that the refusal is REPORTED, with a classified code,
  // instead of being swallowed into a green row.
  assert.strictEqual(tier0.ok, false, JSON.stringify(tier0));
  assert.strictEqual(typeof tier0.error, 'string');
  assert.ok(tier0.error.length > 0);
  assert.ok(!('skipped' in tier0), 'a git failure is an error, not a skip');

  const ids = body.refreshed.map(r => r.repo);
  assert.deepStrictEqual(ids, ['data-tier-0'], 'only the team repo is a refresh target');
});

test('the per-source TTL gates a FAILING source too: a second, unforced refresh skips it as fresh', async () => {
  // Nothing here can succeed (file:// origin), which is exactly the case the
  // TTL must cover: keyed on success alone, a dead source was re-fetched on
  // every opening of the sync modal and held the button for the whole 45 s
  // timeout, for as long as it stayed dead. The forced call above recorded an
  // attempt; this unforced one must ride the TTL instead of fetching again.
  const { status, body } = await postJson(PORT, '/api/sync-overview/refresh');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  const tier0 = body.refreshed.find(r => r.repo === 'data-tier-0');
  assert.ok(tier0, JSON.stringify(body.refreshed));
  assert.strictEqual(tier0.skipped, 'fresh', JSON.stringify(tier0));
  assert.strictEqual(tier0.ok, true, 'a fresh skip is not a failure');
  assert.ok(!('error' in tier0), 'no git ran, so there is no error to classify');

  // And the button still gets its answer: force bypasses the gate.
  const forced = await postJson(PORT, '/api/sync-overview/refresh', { force: true });
  const again = forced.body.refreshed.find(r => r.repo === 'data-tier-0');
  assert.strictEqual(again.ok, false, JSON.stringify(again));
  assert.ok(!('skipped' in again), 'forced -> fetched -> the real (failed) result');
});

test('refuses a request that is not JSON, like every other write route', async () => {
  const r = await fetch(apiUrl(PORT, '/api/sync-overview/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'force=1',
    signal: AbortSignal.timeout(20000),
  });
  assert.strictEqual(r.status, 415);
});

test('an empty body is a normal call - the modal-open refresh sends none', async () => {
  const r = await fetch(apiUrl(PORT, '/api/sync-overview/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.ok, true);
});

test('a file new on the remote (never pulled here) is attributed to its scope, not dropped into Cockpit Core', async () => {
  // Simulate a teammate's push: a second, throwaway clone of REMOTE adds one
  // new mirror file under team/ - a v1-shaped legacy name (`<relPath>.enc`,
  // the legacy layout) - and pushes it.
  // A v1 name resolves for free by stripping ".enc" (see
  // _resolveRemoteAheadNames), so no real crypto-sync key or ciphertext is
  // needed - only the NAME has to look like a real mirror entry. The v2
  // (decrypt) branch is proven separately, with a fake resolveFn, in
  // tests/test_sync_modules.mjs - setting up a real HKDF/GCM round trip here
  // would be disproportionate to what this suite is for (route wiring).
  const teammateWork = path.join(BASE, 'teammate-clone');
  git(BASE, 'clone', '-q', REMOTE, teammateWork);
  fs.mkdirSync(path.join(teammateWork, 'team'), { recursive: true });
  fs.writeFileSync(path.join(teammateWork, 'team', 'nowa-osoba.json.enc'), 'bare-armored-body');
  git(teammateWork, 'add', '-A');
  git(teammateWork, 'commit', '-q', '-m', 'teammate adds a new team member');
  git(teammateWork, 'push', '-q', 'origin', 'HEAD:main');

  // Move the mirror's own remote-tracking ref the way a real fetch would -
  // raw git, called directly by the test rather than through the app.
  // _gitExecRepo refuses this file:// origin for every remote op (see the
  // test above), so a real POST /api/sync-overview/refresh can never itself
  // perform a successful fetch in this sandbox; that refusal is app policy
  // (only a clean HTTPS origin is trusted with the token), not a gap in it.
  git(MIRROR_DIR, 'fetch', '-q', 'origin');

  // What this test actually proves: once the ref HAS moved (by whatever
  // means), GET /api/sync-modules attributes the new upstream-only file to
  // its scope (_team) instead of dropping it into Cockpit Core, and the
  // per-module filesToFetch sums back to the overview's total. It does NOT
  // exercise the cache-invalidation line in _repoRefreshRemote
  // (_afterRemoteRefreshSuccess), for two independent reasons, not one. The
  // POST below attempts a real `git fetch`, but `_gitExecRepo` refuses this
  // file:// origin for every remote op, so the success branch that calls
  // _afterRemoteRefreshSuccess never runs here - the ref move that makes the
  // rest of this test meaningful happened by raw git, directly on the mirror,
  // above, outside the app entirely. And even if the app's fetch DID succeed,
  // the follow-up read below asks for `force=1`, which bypasses the 30 s memo
  // on its own, regardless of whether invalidation ran. That line is covered
  // honestly, without a real remote, by the unit tests in
  // tests/test_sync_modules.mjs ('_afterRemoteRefreshSuccess: clears the
  // stale per-module memo ...' and '_repoRefreshRemote calls
  // _afterRemoteRefreshSuccess only after the non-zero-exit early return').
  const refreshed = await postJson(PORT, '/api/sync-overview/refresh', { force: true });
  const overviewRow = refreshed.body.repos.find((r) => r.repo === 'data-tier-0');
  assert.ok(overviewRow, JSON.stringify(refreshed.body.repos));
  assert.ok(overviewRow.filesToFetch >= 1, JSON.stringify(overviewRow));

  const { body: modulesBody } = await getJson(PORT, '/api/sync-modules?force=1');
  const rows = modulesBody.modules.filter((m) => m.repo === 'data-tier-0');
  const fetchSum = rows.reduce((acc, m) => acc + (m.filesToFetch || 0), 0);
  assert.strictEqual(fetchSum, overviewRow.filesToFetch, 'sum(rows.filesToFetch) === overview.filesToFetch');

  const teamRow = rows.find((m) => m.id === '_team');
  const coreRow = rows.find((m) => m.id === '_core');
  assert.ok(teamRow, '_team is one of SYNC_CORE_SCOPES and always ships for data-tier-0');
  assert.ok(teamRow.filesToFetch >= 1, JSON.stringify(teamRow));
  assert.ok(coreRow, '_core always ships too, even at zero');
});

test('the mirror is untouched: a refresh writes refs and nothing else', async () => {
  // The whole reason this op is generic for all eight sources. Anything that
  // walked the plaintext tree (encryptTree) could prune the mirror.
  assert.strictEqual(git(MIRROR_DIR, 'status', '--porcelain'), '', 'no working-tree change');
  assert.strictEqual(fs.readdirSync(MIRROR_DIR).filter(f => f.endsWith('.enc')).length, 1, 'the seeded .enc still there');
});
