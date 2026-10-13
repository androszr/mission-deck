'use strict';
// tests/test_api_data_repos.js
// Stage B: the /api/data/<repoId>/<op> registry over DATA_REPOS. data-tier-0
// is not cloned in CI, so every status/op call must report the not-configured
// state instead of touching the network - same guarantee as
// tests/test_api_data_tier0.js, which this suite deliberately mirrors for the
// alias comparison (AC10).

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3513;
let child;

// Overriding DATA_TIER_0_DIR alone moves both the plaintext and the encrypted
// mirror (DATA_TIER_0_GIT_DIR derives from it) - see the comment above
// DATA_TIER_0_GIT_DIR in server.js. A path that never existed guarantees
// "not cloned", never a developer's real data-sub-repositories/ds-data.
const TMP_DATA_TIER_0_DIR = path.join(os.tmpdir(), `cockpit-test-data-repos-${process.pid}`);

// Additional sources (DATA_REPO_DEFS) derive their directories from
// DATA_SUB_REPOS_DIR, NOT from DATA_TIER_0_DIR. Pointing it at a temp dir
// keeps "this source is not cloned" a property of the code.
const TMP_SUB_REPOS_DIR = path.join(os.tmpdir(), `cockpit-test-sub-repos-${process.pid}`);

test.before(async () => {
  child = startServer(PORT, {
    COCKPIT_DATA_TOKEN: '',
    DATA_TIER_0_REPO_URL: '',
    DATA_TIER_0_DIR: TMP_DATA_TIER_0_DIR,
    DATA_SUB_REPOS_DIR: TMP_SUB_REPOS_DIR,
    AUTO_SYNC_ENABLED: '0',
  });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(TMP_DATA_TIER_0_DIR, { recursive: true, force: true });
  fs.rmSync(TMP_SUB_REPOS_DIR, { recursive: true, force: true });
});

test('GET /api/data/data-tier-0/status matches GET /api/data-tier-0/status field by field', async () => {
  const alias = await getJson(PORT, '/api/data/data-tier-0/status');
  const legacy = await getJson(PORT, '/api/data-tier-0/status');
  assert.strictEqual(alias.status, 200);
  assert.strictEqual(legacy.status, 200);
  // Field-by-field, not a string comparison (AC10): a key present on one side
  // and missing on the other must fail even if JSON.stringify happened to agree.
  const keys = new Set([...Object.keys(alias.body), ...Object.keys(legacy.body)]);
  assert.ok(keys.size > 0, 'both responses must carry fields to compare');
  for (const key of keys) {
    assert.deepStrictEqual(alias.body[key], legacy.body[key], `field "${key}" differs between the alias and the legacy route`);
  }
});

test('GET /api/data/data-tier-0/check-update matches the legacy route', async () => {
  const alias = await getJson(PORT, '/api/data/data-tier-0/check-update');
  const legacy = await getJson(PORT, '/api/data-tier-0/check-update');
  assert.strictEqual(alias.status, 200);
  assert.deepStrictEqual(alias.body, legacy.body);
});

test('POST /api/data/data-tier-0/pull matches the legacy route (not-configured)', async () => {
  const alias = await postJson(PORT, '/api/data/data-tier-0/pull', {});
  const legacy = await postJson(PORT, '/api/data-tier-0/pull', {});
  assert.strictEqual(alias.status, 200);
  assert.deepStrictEqual(alias.body, legacy.body);
  assert.strictEqual(alias.body.error, 'not-configured');
});

test('unknown repoId gives 404 with a proper JSON document', async () => {
  const { status, body } = await getJson(PORT, '/api/data/no-such-repo/status');
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'unknown-repo');
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
});

test('unknown operation gives 404 with a proper JSON document', async () => {
  const { status, body } = await getJson(PORT, '/api/data/data-tier-0/no-such-op');
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'unknown-operation');
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
});

test('a known operation reached with the wrong HTTP method is treated as unknown (404)', async () => {
  // "status" only exists as GET - POSTing it must not silently fall through
  // to some other handler.
  const { status, body } = await postJson(PORT, '/api/data/data-tier-0/status', {});
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'unknown-operation');
});

test('decrypt is served for the team repo (mirror -> plaintext only, nothing to destroy)', async () => {
  // The way in for a clone made before its key existed. Not cloned in CI, so
  // the honest answer is not-configured - never a 404.
  const { status, body } = await postJson(PORT, '/api/data/data-tier-0/decrypt', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.error, 'not-configured');
});

test('sync-overview says whether a clone was ever decrypted', async () => {
  // `decrypted` is null until a source is cloned, then true/false; a clone
  // whose plaintext directory never received the mirror's content is what the
  // table must show instead of "aktualne". encryptionReady rides along so the
  // callout can tell "no key" from "one click away".
  const { body } = await getJson(PORT, '/api/sync-overview');
  for (const r of body.repos) {
    assert.ok(r.decrypted === null || typeof r.decrypted === 'boolean', `${r.repo}: decrypted must be null or boolean`);
    assert.strictEqual(typeof r.encryptionReady, 'boolean', `${r.repo}: encryptionReady must be boolean`);
  }
  const uncloned = body.repos.find(r => r.status === 'not-configured');
  if (uncloned) assert.strictEqual(uncloned.decrypted, null);
});

test('GET /api/sync-overview lists the team repo, pushable, with its local-changes listing', async () => {
  const { status, body } = await getJson(PORT, '/api/sync-overview');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.repos.map(r => r.repo), ['data-tier-0']);
  assert.strictEqual(body.repos[0].canPush, true);
  assert.strictEqual(body.repos[0].canListLocalChanges, true);
});

test('sync-overview carries FILE counts, not just the commit counters', async () => {
  // The "Wyslac / pobrac" column renders filesToSend/filesToFetch. ahead and
  // behind stay in the payload for the auto-sync loop, but they count COMMITS
  // and this app commits only inside a push - so a person's pending edit never
  // showed up there. Both pairs must be present and numeric.
  const { status, body } = await getJson(PORT, '/api/sync-overview');
  assert.strictEqual(status, 200);
  for (const r of body.repos) {
    assert.strictEqual(typeof r.filesToSend, 'number', `${r.repo} must report filesToSend`);
    assert.strictEqual(typeof r.filesToFetch, 'number', `${r.repo} must report filesToFetch`);
    assert.strictEqual(typeof r.ahead, 'number');
    assert.strictEqual(typeof r.behind, 'number');
  }
});

test('an un-cloned source reports zero files in both directions', async () => {
  const { body } = await getJson(PORT, '/api/data/data-tier-0/status');
  assert.strictEqual(body.status, 'not-configured');
  assert.strictEqual(body.filesToSend, 0);
  assert.strictEqual(body.filesToFetch, 0);
});

test('GET /api/settings/encryption-status carries the route id next to the key id', async () => {
  const { status, body } = await getJson(PORT, '/api/settings/encryption-status');
  assert.strictEqual(status, 200);
  const tier0 = body.repos.find(r => r.repo === 'data-tier-0');
  assert.ok(tier0, 'data-tier-0 must be addressable by its ROUTE id');
  // The two ids differ for this row, which is the whole reason the field exists.
  assert.strictEqual(tier0.id, 'ds-data');
  // Every source is readable, so nothing reports syncWired:false.
  for (const r of body.repos) assert.strictEqual(r.syncWired, true, `${r.repo} must report its sync as wired`);
});
