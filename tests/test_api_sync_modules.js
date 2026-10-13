'use strict';
// tests/test_api_sync_modules.js
// GET /api/sync-modules, GET /api/sync-modules/files and the scoped
// push-stream?module= validation. MODULES_DIR is overridden to an empty,
// throwaway directory so this suite never depends on whether the gitignored
// modules/demo-hub happens to exist on the machine it runs on: the only module
// is one fixture written in test.before (a pure reader of team/), so every repo
// answers with the "_core" complement, the SYNC_CORE_SCOPES rows declared for
// it (three on data-tier-0 plus the fixture) and nothing
// else, and the only MODULE id ever known is the fixture, which is what makes
// the "module=nope -> unknown-module" and "module=_all/_core -> 200"
// assertions deterministic everywhere. Do not "fix" this later by pointing
// MODULES_DIR at a real module - that would make the suite depend on what
// happens to be installed.
//
// data-tier-0 is never cloned here either (same not-configured pattern as
// tests/test_api_data_tier0.js), so the sum-equality assertion below is
// meaningful precisely BECAUSE every repo answers all-zeros - it proves the
// response shape and the invariant's wiring, not the classification logic
// itself (that lives in tests/test_sync_modules.mjs).

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, apiUrl } = require('./_api_helper');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3517;
let child;

const TMP_DATA_TIER_0_DIR = path.join(os.tmpdir(), `cockpit-test-data-tier-0-sm-${process.pid}`);
const TMP_MODULES_DIR = path.join(os.tmpdir(), `cockpit-test-modules-sm-${process.pid}`);
// A module that only READS team/ (dataRepos[].access 'read'): it gets a row on
// data-tier-0 but owns nothing, so its scoped push must be refused.
const READER_ID = 'sm-reader';

test.before(async () => {
  fs.mkdirSync(path.join(TMP_MODULES_DIR, READER_ID), { recursive: true });
  fs.writeFileSync(path.join(TMP_MODULES_DIR, READER_ID, 'module.json'), JSON.stringify({
    schemaVersion: 1,
    id: READER_ID,
    name: 'Czytelnik testowy',
    version: '0.1.0',
    area: 'AR',
    sidebar: { label: 'Czytelnik', kind: 'item' },
    views: [{ id: READER_ID + '-main', label: 'Czytelnik' }],
    dataRepos: [{ name: 'data-tier-0', access: 'read', description: 'Team directory - read only', paths: ['team/'] }],
  }));
  child = startServer(PORT, {
    COCKPIT_DATA_TOKEN: '',
    DATA_TIER_0_REPO_URL: '',
    DATA_TIER_0_DIR: TMP_DATA_TIER_0_DIR,
    MODULES_DIR: TMP_MODULES_DIR,
    AUTO_SYNC_ENABLED: '0',
  });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(TMP_DATA_TIER_0_DIR, { recursive: true, force: true });
  fs.rmSync(TMP_MODULES_DIR, { recursive: true, force: true });
});

async function readSse(pathAndQuery) {
  const r = await fetch(apiUrl(PORT, pathAndQuery), { signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  const events = [];
  for (const block of text.split('\n\n')) {
    const evt = /^event: (.+)$/m.exec(block);
    const data = /^data: (.+)$/m.exec(block);
    if (evt && data) {
      try { events.push({ event: evt[1], data: JSON.parse(data[1]) }); }
      catch { /* keep-alive or malformed - skip */ }
    }
  }
  return { status: r.status, events };
}

test('GET /api/sync-modules answers 200 with exactly one _core row per repo (only the reader fixture installed)', async () => {
  const { status, body } = await getJson(PORT, '/api/sync-modules');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(Array.isArray(body.modules));

  const { body: overview } = await getJson(PORT, '/api/sync-overview');
  const repoIds = overview.repos.map((r) => r.repo);
  assert.deepStrictEqual(repoIds, ['data-tier-0']);

  for (const repoId of repoIds) {
    const rows = body.modules.filter((m) => m.repo === repoId);
    const coreRows = rows.filter((m) => m.id === '_core');
    assert.strictEqual(coreRows.length, 1, `repo ${repoId} must have exactly one _core row`);
    // No modules installed (MODULES_DIR is empty), so the only rows a repo may
    // answer with are the _core complement plus whatever SYNC_CORE_SCOPES
    // declares for it. Pinned as an exact SET per repo rather than a count or a
    // ">= 1" floor: this is the one gate that sees the assembled HTTP payload,
    // so a core scope added, renamed or attached to the wrong repo has to fail
    // here or it reaches the sync table unnoticed.
    const expectedIds = {
      'data-tier-0': ['_academy', '_core', '_prototypes', '_team', READER_ID],
    }[repoId] || ['_core'];
    assert.deepStrictEqual(
      rows.map((m) => m.id).sort(),
      expectedIds,
      `repo ${repoId} must answer with exactly the _core row plus its declared core scopes`,
    );

    for (const row of rows) {
      assert.strictEqual(typeof row.unknown, 'boolean', `row ${repoId}/${row.id} is missing boolean unknown`);
      assert.strictEqual(row.access, row.id === READER_ID ? 'read' : 'write', `row ${repoId}/${row.id} must carry access`);
      // filesToSend is the same value as pendingFiles under the repo row's
      // own field name (AC: frontend reads ONE vocabulary for both levels).
      assert.strictEqual(row.filesToSend, row.pendingFiles, `row ${repoId}/${row.id}: filesToSend must alias pendingFiles`);
      assert.ok(row.filesToFetch === null || typeof row.filesToFetch === 'number', `row ${repoId}/${row.id} filesToFetch must be null or numeric`);
      assert.ok(row.localAt === null || typeof row.localAt === 'string', `row ${repoId}/${row.id} localAt must be null or a string`);
      assert.ok(row.remoteAt === null || typeof row.remoteAt === 'string', `row ${repoId}/${row.id} remoteAt must be null or a string`);
    }

    // data-tier-0 is guaranteed not-configured (TMP_DATA_TIER_0_DIR never
    // existed), but the seven Phase D sources read straight off
    // data-sub-repositories/ (no override here - see the suite header), so a
    // developer machine that already cloned one of them legitimately answers
    // 'ready' with real numbers. The invariant that must hold everywhere is
    // the sum equality below; the "un-cloned -> null" check only applies
    // where the row actually IS un-cloned.
    // A read row is a view of files another row owns, so it is outside the
    // ownership sum (see _syncModulesForRepo).
    const certainRows = rows.filter((m) => !m.unknown && m.access !== 'read');
    const sendSum = certainRows.reduce((acc, m) => acc + (m.pendingFiles || 0), 0);
    const fetchSum = certainRows.reduce((acc, m) => acc + (m.filesToFetch || 0), 0);
    const overviewRow = overview.repos.find((r) => r.repo === repoId);
    // Only when EVERY row of this repo answered. `_syncModulesForRepo` gives
    // up after 5 s and marks the whole repo `unknown`, which is a legitimate
    // answer on a developer machine holding a large cloned source - and the
    // partial sum it leaves behind (0, every row dropped by the filter above)
    // has nothing to do with the overview's real count, so comparing the two
    // fails the suite for a timeout rather than for a defect.
    if (certainRows.length === rows.filter((m) => m.access !== 'read').length) {
      assert.strictEqual(sendSum, overviewRow.filesToSend, `sum for ${repoId} must equal filesToSend`);
      assert.strictEqual(fetchSum, overviewRow.filesToFetch, `sum for ${repoId} must equal filesToFetch`);
    }
    if (overviewRow.status !== 'ready') {
      for (const row of certainRows) {
        assert.strictEqual(row.localAt, null, `row ${repoId}/${row.id}: an un-cloned repo has no localAt`);
        assert.strictEqual(row.remoteAt, null, `row ${repoId}/${row.id}: an un-cloned repo has no remoteAt`);
      }
    }
  }
});

test('GET /api/sync-modules?force=1 answers 200 and bypasses the cache', async () => {
  const { status, body } = await getJson(PORT, '/api/sync-modules?force=1');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
});

test('GET /api/sync-modules/files?repo=nope&module=_all -> 400 unknown-repo', async () => {
  const { status, body } = await getJson(PORT, '/api/sync-modules/files?repo=nope&module=_all');
  assert.strictEqual(status, 400);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'unknown-repo');
});

test('GET /api/sync-modules/files?repo=data-tier-0&module=nope -> 400 unknown-module', async () => {
  const { status, body } = await getJson(PORT, '/api/sync-modules/files?repo=data-tier-0&module=nope');
  assert.strictEqual(status, 400);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'unknown-module');
});

for (const moduleId of ['_all', '_core']) {
  test(`GET /api/sync-modules/files?repo=data-tier-0&module=${moduleId} -> 200 with an empty, not-truncated list`, async () => {
    const before = fs.existsSync(TMP_DATA_TIER_0_DIR);
    const { status, body } = await getJson(PORT, `/api/sync-modules/files?repo=data-tier-0&module=${moduleId}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.files));
    assert.strictEqual(body.files.length, 0);
    assert.strictEqual(body.total, 0);
    assert.strictEqual(typeof body.truncated, 'boolean');
    assert.strictEqual(body.viewAt, null);
    // Read-only: a repo that was never cloned must never spring into being
    // because someone asked for its file list.
    assert.strictEqual(fs.existsSync(TMP_DATA_TIER_0_DIR), before, 'handler must not create the data directory');
  });
}

test('GET /api/data-tier-0/push-stream?module=<read-only scope> -> SSE error read-only-scope, before the clone check', async () => {
  const { status, events } = await readSse(`/api/data-tier-0/push-stream?module=${READER_ID}`);
  assert.strictEqual(status, 200);
  const errorEvt = events.find((e) => e.event === 'error');
  assert.ok(errorEvt, 'expected an "error" SSE event');
  assert.strictEqual(errorEvt.data.error, 'read-only-scope');
  assert.strictEqual(errorEvt.data.message, 'This module only reads this data - send it from the owner row.');
});

test('GET /api/data-tier-0/push-stream?module=nope -> SSE error unknown-module, validated before the clone check', async () => {
  const { status, events } = await readSse('/api/data-tier-0/push-stream?module=nope');
  assert.strictEqual(status, 200);
  const errorEvt = events.find((e) => e.event === 'error');
  assert.ok(errorEvt, 'expected an "error" SSE event');
  assert.strictEqual(errorEvt.data.error, 'unknown-module');
});

// Level-3 (single/explicit file) scoped push: ?paths=<rel1>,<rel2>, mutually
// exclusive with ?module=. All three checks below are purely syntactic (query
// params only), so they answer deterministically without a clone - the ONE
// check that needs the repo (a path must match something actually pending)
// is unit-tested against _matchPushPaths in tests/test_sync_modules.mjs
// instead, since data-tier-0 is never cloned in this suite and a real push
// must never run against the shared mirror from a test.
test('GET /api/data-tier-0/push-stream?module=x&paths=a.json -> SSE error conflicting-selector', async () => {
  const { status, events } = await readSse('/api/data-tier-0/push-stream?module=_core&paths=a.json');
  assert.strictEqual(status, 200);
  const errorEvt = events.find((e) => e.event === 'error');
  assert.ok(errorEvt, 'expected an "error" SSE event');
  assert.strictEqual(errorEvt.data.error, 'conflicting-selector');
});

test('GET /api/data-tier-0/push-stream?paths= (empty) -> SSE error empty-paths', async () => {
  const { status, events } = await readSse('/api/data-tier-0/push-stream?paths=');
  assert.strictEqual(status, 200);
  const errorEvt = events.find((e) => e.event === 'error');
  assert.ok(errorEvt, 'expected an "error" SSE event');
  assert.strictEqual(errorEvt.data.error, 'empty-paths');
});

test('GET /api/data-tier-0/push-stream?paths=<51 entries> -> SSE error too-many-paths', async () => {
  const paths = Array.from({ length: 51 }, (_, i) => `f${i}.json`).join(',');
  const { status, events } = await readSse(`/api/data-tier-0/push-stream?paths=${encodeURIComponent(paths)}`);
  assert.strictEqual(status, 200);
  const errorEvt = events.find((e) => e.event === 'error');
  assert.ok(errorEvt, 'expected an "error" SSE event');
  assert.strictEqual(errorEvt.data.error, 'too-many-paths');
});
