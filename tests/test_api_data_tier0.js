'use strict';
// tests/test_api_data_tier0.js
// The single data repository (data-tier-0) is not cloned in CI, so every
// endpoint must report the not-configured state instead of failing.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, postJson, apiUrl } = require('./_api_helper');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3502;
let child;

// A path that does not exist: the server must see "not cloned", never the
// developer's real data-sub-repositories/ds-data checkout. Never created here,
// so dataTier0Exists() and the dir-exists probe both stay false.
const TMP_DATA_TIER_0_DIR = path.join(os.tmpdir(), `cockpit-test-data-tier-0-${process.pid}`);

test.before(async () => {
  // Blank the TOKEN explicitly so a developer's real .env cannot make this
  // suite talk to a live GitLab repo. The blank URL no longer carries that
  // guarantee on its own: DATA_TIER_0_REPO_URL now DEFAULTS to the canonical
  // data repo, so the token is the only thing standing between this suite and
  // the network - which is also the order _dataTier0Clone checks them in.
  // DATA_TIER_0_DIR is overridden for the same reason: a local clone would
  // otherwise leak in and every not-configured assertion would see the real
  // repo (auth-expired, dirty, ahead/behind) instead of the fresh-clone state.
  child = startServer(PORT, {
    COCKPIT_DATA_TOKEN: '',
    DATA_TIER_0_REPO_URL: '',
    DATA_TIER_0_DIR: TMP_DATA_TIER_0_DIR,
    AUTO_SYNC_ENABLED: '0',
  });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  // Nothing should have created it, but a failed clone attempt might.
  fs.rmSync(TMP_DATA_TIER_0_DIR, { recursive: true, force: true });
});

test('GET /api/data-tier-0/status reports not-configured', async () => {
  const { status, body } = await getJson(PORT, '/api/data-tier-0/status');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.exists, false);
  assert.strictEqual(body.hasToken, false);
  assert.strictEqual(body.status, 'not-configured');
  for (const key of ['branch', 'ahead', 'behind', 'dirty', 'lastSync', 'pendingPush']) {
    assert.ok(key in body, `status is missing "${key}"`);
  }
  // Both booleans must be present even in the not-configured base object (the
  // ready branch that computes them for real never runs here), so a future
  // regression that only adds them to the ready branch still fails this.
  assert.strictEqual(typeof body.plaintextDirty, 'boolean');
  assert.strictEqual(typeof body.mirrorDirty, 'boolean');
});

test('GET /api/data-tier-0/check-update short-circuits when not cloned', async () => {
  const { status, body } = await getJson(PORT, '/api/data-tier-0/check-update');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'not-configured');
});

test('POST /api/data-tier-0/clone stops at the missing token, not at the URL', async () => {
  // `no-token` rather than `no-repo-url`: the repo URL is a built-in default
  // (the whole team shares one data repo), so the token is the only genuinely
  // per-person prerequisite left - and the only one a person can act on.
  const { status, body } = await postJson(PORT, '/api/data-tier-0/clone', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'no-token');
});

test('the default data repo URL reaches the status payload even before a clone', async () => {
  const { body } = await getJson(PORT, '/api/data-tier-0/status');
  // With no clone and no .env entry the UI can still name the repo it WOULD
  // pull - which is what makes the not-configured state readable.
  assert.match(body.remoteUrl, /mission-deck-data\.git$/);
  assert.strictEqual(body.repoName, 'mission-deck-data');
});

test('POST /api/data-tier-0/pull and /push report not-configured', async () => {
  const pull = await postJson(PORT, '/api/data-tier-0/pull', {});
  assert.strictEqual(pull.status, 200);
  assert.strictEqual(pull.body.error, 'not-configured');

  const push = await postJson(PORT, '/api/data-tier-0/push', {});
  assert.strictEqual(push.status, 200);
  assert.strictEqual(push.body.error, 'not-configured');
});

test('GET /api/sync-overview returns one row per DATA_REPOS entry (data-tier-0 alone by default)', async () => {
  const { status, body } = await getJson(PORT, '/api/sync-overview');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(body.repos.map(r => r.repo), ['data-tier-0']);
  assert.strictEqual(typeof body.intervalMs, 'number');
  assert.strictEqual(typeof body.autoSyncEnabled, 'boolean');
  for (const row of body.repos) {
    assert.strictEqual(typeof row.repoName, 'string', `row ${row.repo} is missing repoName`);
    assert.strictEqual(typeof row.plaintextDirty, 'boolean', `row ${row.repo} is missing plaintextDirty`);
  }
  // data-tier-0 alone is guaranteed not-configured here - its dir is pointed
  // at TMP_DATA_TIER_0_DIR above. The other seven read the developer's real
  // data-sub-repositories/ds-<id>/ (there is no per-repo env override for
  // them - see DATA_REPO_DEFS), so on a machine where one was cloned by hand
  // this assertion would be environment-dependent; it is scoped to the one
  // row this fixture actually controls. An empty plaintext tree must never
  // read as dirty (the plaintextEmpty exception in scripts/crypto-sync.js) -
  // that invariant has its own dedicated case in tests/test_crypto_sync.mjs.
  assert.strictEqual(body.repos[0].plaintextDirty, false, 'data-tier-0 must not be plaintextDirty when not cloned');
});

test('GET /api/sync-log returns an events array', async () => {
  const { status, body } = await getJson(PORT, '/api/sync-log');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.events));
  assert.strictEqual(typeof body.total, 'number');
});

test('GET /api/data-tier-0/pull-stream emits SSE start then error', async () => {
  const r = await fetch(apiUrl(PORT, '/api/data-tier-0/pull-stream'), { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
  const text = await r.text();
  assert.match(text, /event: start/);
  assert.match(text, /event: error/);
  assert.match(text, /not-configured/);
});

// Reads only the FIRST chunk of an SSE response and cancels the request -
// npm run test:api is sequential, so a case that waits for a stream to close
// would stall the whole run if that stream ever took longer than instant.
async function firstSseChunk(port, p) {
  const r = await fetch(apiUrl(port, p), { signal: AbortSignal.timeout(20000) });
  const reader = r.body.getReader();
  const { value } = await reader.read();
  const text = Buffer.from(value || []).toString('utf8');
  await reader.cancel();
  return { status: r.status, headers: r.headers, text };
}

test('GET /api/data-tier-0/push-stream emits SSE start first', async () => {
  const { status, headers, text } = await firstSseChunk(PORT, '/api/data-tier-0/push-stream');
  assert.strictEqual(status, 200);
  assert.match(headers.get('content-type') || '', /text\/event-stream/);
  assert.match(text, /event: start/);
});

test('GET /api/data-tier-0/pull-overwrite-stream emits SSE start first', async () => {
  const { status, headers, text } = await firstSseChunk(PORT, '/api/data-tier-0/pull-overwrite-stream');
  assert.strictEqual(status, 200);
  assert.match(headers.get('content-type') || '', /text\/event-stream/);
  assert.match(text, /event: start/);
});

test('GET /api/data-tier-0/local-changes reports not-configured', async () => {
  const { status, body } = await getJson(PORT, '/api/data-tier-0/local-changes');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'not-configured');
});

test('POST /api/data-tier-0/conflict-diff reports not-configured', async () => {
  const { status, body } = await postJson(PORT, '/api/data-tier-0/conflict-diff', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'not-configured');
});

test('POST /api/data-tier-0/pull-overwrite reports not-configured', async () => {
  const { status, body } = await postJson(PORT, '/api/data-tier-0/pull-overwrite', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'not-configured');
});

test('POST /api/data-tier-0/resolve-conflicts rejects an unsupported strategy', async () => {
  const { status, body } = await postJson(PORT, '/api/data-tier-0/resolve-conflicts', { strategy: 'mine' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'invalid-strategy');
});

test('POST /api/data-tier-0/write-resolved rejects a path escaping the repo, before any clone check', async () => {
  const { status, body } = await postJson(PORT, '/api/data-tier-0/write-resolved', {
    files: [{ path: '../../etc/passwd', content: 'x' }],
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'validation-failed');
  assert.strictEqual(body.errors[0].error, 'invalid-path');
});

test('POST /api/data-tier-0/discard-local-changes reports not-configured', async () => {
  const { status, body } = await postJson(PORT, '/api/data-tier-0/discard-local-changes', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'not-configured');
});

test('POST /api/data-tier-0/rebase-abort reports not-configured', async () => {
  const { status, body } = await postJson(PORT, '/api/data-tier-0/rebase-abort', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'not-configured');
});

test('POST /api/data-tier-0/recover-rebase reports not-configured', async () => {
  const { status, body } = await postJson(PORT, '/api/data-tier-0/recover-rebase', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'not-configured');
});

test('POST /api/data-tier-0/repair-detached-head reports not-configured', async () => {
  const { status, body } = await postJson(PORT, '/api/data-tier-0/repair-detached-head', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'not-configured');
});

test('POST /api/data-tier-0/clear-dir is a no-op when there is nothing to clean', async () => {
  // Neither TMP_DATA_TIER_0_DIR nor its `-encrypted` mirror exists on disk in
  // this suite (no clone ever runs - see the comment at the top of the file),
  // so clear-dir's "already empty" branch is what fires, not the refusal
  // branch (that needs an actual `.git` to refuse against).
  const { status, body } = await postJson(PORT, '/api/data-tier-0/clear-dir', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.removed, false);
});
