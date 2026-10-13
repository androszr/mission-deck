'use strict';
// tests/test_api_data_day_cycle.js
// End-to-end test of the "Koniec dnia" wrap-up clear (POST
// /api/data/<repoId>/clear-plaintext) against a real mirror and a real git
// remote on disk, plus POST /api/settings/shutdown under the test gate.
// Pattern copied from tests/test_api_data_decrypt.js: a bare remote seeded
// with an encrypted tree, a server pointed at a temp sandbox through
// DATA_TIER_0_DIR / DATA_SUB_REPOS_DIR - this test never touches
// data-sub-repositories/ds-data/ or any real source on this machine.
//
// The data-integrity invariant under test: the plaintext tree may only be
// deleted when it is fully covered by the encrypted mirror (added===0 &&
// changed===0). The "still there" assertions on the plaintext-ahead and
// key-missing cases are the ones that would have caught a data-loss bug.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');
const crypto_sync = require('../scripts/crypto-sync.js');

const PORT_WITH_KEY = 3524;
const PORT_INVALID_KEY = 3525;

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-daycycle-'));
const REMOTE = path.join(BASE, 'remote.git');
const PLAIN_DIR = path.join(BASE, 'ds-data');      // DATA_TIER_0_DIR
const MIRROR_DIR = PLAIN_DIR + '-encrypted';         // derived by the server
const SUB_REPOS = path.join(BASE, 'sub-repos');
const KEY = crypto_sync.generateKey();
// Deliberately not a valid key SHAPE (wrong base64 decode length), so
// dataTierMasterKey() THROWS inside _repoClearPlaintextOp's try/catch and the
// gate answers key-missing deterministically - a wrong-but-valid-length key
// would instead fail later, as plaintext-ahead (see plaintextAheadOfMirror:
// with no matching mirror name every file counts as added).
const INVALID_KEY = 'not-a-valid-key';
const TEAM_FILES = 6; // team-members.json + 5 avatars

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
  }).trim();
}

function encCount(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.enc')).length; } catch { return -1; }
}

function plainFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full); else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  try { walk(dir); } catch { /* absent */ }
  return out.sort();
}

async function waitFor(pred, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function overviewRow(port) {
  const { body } = await getJson(port, '/api/sync-overview');
  return body.repos.find((r) => r.repo === 'data-tier-0');
}

const baseEnv = {
  COCKPIT_DATA_TOKEN: 'test-token',
  DATA_TIER_0_REPO_URL: 'file://' + REMOTE,
  DATA_TIER_0_DIR: PLAIN_DIR,
  DATA_SUB_REPOS_DIR: SUB_REPOS,
  AUTO_SYNC_ENABLED: '0',
};

let child;

test.before(() => {
  // The team's data, encrypted with KEY, committed and served as a bare
  // remote - the state ds-data-tier-0 is in for every fresh clone.
  const seed = path.join(BASE, 'seed-plain');
  fs.mkdirSync(path.join(seed, 'team', 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'team', 'team-members.json'), JSON.stringify([{ id: 'alex-morgan', first_name: 'Anna', last_name: 'Nowak', avatar: 'alex-morgan.png' }]));
  for (let i = 0; i < TEAM_FILES - 1; i++) fs.writeFileSync(path.join(seed, 'team', 'avatars', `p${i}.png`), Buffer.from([0x89, 0x50, i]));
  const work = path.join(BASE, 'seed-mirror');
  crypto_sync.encryptTree(seed, work, Buffer.from(KEY, 'base64'));
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'seed');
  git(BASE, 'clone', '-q', '--bare', work, REMOTE);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(BASE, { recursive: true, force: true });
});

test('clone and decrypt: plaintext tree filled from the mirror', async () => {
  child = startServer(PORT_WITH_KEY, { ...baseEnv, DATA_ENCRYPTION_KEY: KEY });
  await waitForServer(PORT_WITH_KEY);

  await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/clone', {});
  await waitFor(async () => {
    const { body } = await getJson(PORT_WITH_KEY, '/api/data/data-tier-0/status');
    return body.exists ? body : null;
  });
  assert.strictEqual(encCount(MIRROR_DIR), TEAM_FILES, 'the clone itself succeeded');

  const { body } = await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/decrypt', {});
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  assert.strictEqual(body.stats.written, TEAM_FILES);
  assert.strictEqual(plainFiles(PLAIN_DIR).length, TEAM_FILES);
});

test('clear-plaintext: a fully-mirrored tree clears, marks wrappedUpAt, and never touches the mirror', async () => {
  const { body } = await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/clear-plaintext', {});
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  assert.strictEqual(body.alreadyEmpty, undefined, 'a real clear must not carry alreadyEmpty');
  assert.strictEqual(body.removedFiles, TEAM_FILES);
  assert.deepStrictEqual(plainFiles(PLAIN_DIR), [], 'plaintext tree is empty after the clear');
  assert.strictEqual(encCount(MIRROR_DIR), TEAM_FILES, 'the encrypted mirror is untouched');

  const row = await overviewRow(PORT_WITH_KEY);
  assert.strictEqual(typeof row.wrappedUpAt, 'string', 'sync-overview must record when this source was cleared');
});

test('clear-plaintext: a second call the same evening is idempotent (legacy alias route)', async () => {
  // The permanent alias (see CLAUDE.md, Stack): /api/data-tier-0/clear-plaintext
  // reaches the exact same handler as /api/data/data-tier-0/clear-plaintext.
  const { body } = await postJson(PORT_WITH_KEY, '/api/data-tier-0/clear-plaintext', {});
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  assert.strictEqual(body.alreadyEmpty, true);
  assert.strictEqual(body.removedFiles, 0);
  assert.deepStrictEqual(plainFiles(PLAIN_DIR), []);
});

test('clear-plaintext: refuses when the plaintext tree is ahead of the mirror, and leaves the file on disk', async () => {
  // What a module download after a wrap-up looks like: one file the mirror
  // does not have yet.
  fs.mkdirSync(path.join(PLAIN_DIR, 'time-off', 'persons'), { recursive: true });
  fs.writeFileSync(path.join(PLAIN_DIR, 'time-off', 'persons', 'alex-morgan.json'), '{"days":[]}');

  const { body } = await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/clear-plaintext', {});
  assert.strictEqual(body.ok, false, JSON.stringify(body));
  assert.strictEqual(body.error, 'plaintext-ahead', JSON.stringify(body));
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
  // The assertion that would have caught a data-loss bug: the file the mirror
  // does not have yet must still be on disk after the refusal.
  assert.ok(fs.existsSync(path.join(PLAIN_DIR, 'time-off', 'persons', 'alex-morgan.json')));
});

test('decrypt after a wrap-up: restores the team files, keeps the stray file, and clears wrappedUpAt', async () => {
  const { body } = await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/decrypt', {});
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  const files = plainFiles(PLAIN_DIR);
  assert.ok(files.includes('team/team-members.json'), 'team files are back');
  assert.ok(files.includes('time-off/persons/alex-morgan.json'), 'the stray file survived (prune:false)');

  const row = await overviewRow(PORT_WITH_KEY);
  assert.strictEqual(row.wrappedUpAt, null, 'a successful decrypt clears the marker');
});

test('clear-plaintext: an unusable key answers key-missing and leaves the tree untouched', async () => {
  await stopServer(child);
  // Same directories, a key that fails to decode to the right length - the
  // gate must fail BEFORE the probe runs, on d.keyFn() throwing.
  child = startServer(PORT_INVALID_KEY, { ...baseEnv, DATA_ENCRYPTION_KEY: INVALID_KEY });
  await waitForServer(PORT_INVALID_KEY);

  const before = plainFiles(PLAIN_DIR);
  assert.ok(before.length > 0, 'sanity: the tree still holds files from the previous test');

  const { body } = await postJson(PORT_INVALID_KEY, '/api/data/data-tier-0/clear-plaintext', {});
  assert.strictEqual(body.ok, false, JSON.stringify(body));
  assert.strictEqual(body.error, 'key-missing', JSON.stringify(body));
  assert.deepStrictEqual(plainFiles(PLAIN_DIR), before, 'nothing was removed');
});

test('shutdown: answers 202 under the test gate and the server keeps serving', async () => {
  const { status, body } = await postJson(PORT_INVALID_KEY, '/api/settings/shutdown', {});
  assert.strictEqual(status, 202);
  assert.deepStrictEqual(body, { status: 'stopping' });

  // The whole point of TEST_DISABLE_RESTART: this must NOT have killed the
  // process the rest of the suite (and test.after's stopServer) depends on.
  const follow = await getJson(PORT_INVALID_KEY, '/api/app/version');
  assert.strictEqual(follow.status, 200);
});

// The FUNC blocker this test exists for: rmSync can throw part-way through the
// delete loop (EBUSY/EPERM on a handle somebody else holds). A tree left half
// gone with NO wrappedUpAt mark is the worst state this feature can produce -
// the survivors satisfy encryptTree's `mirrorOverlap === 0` guard, the ratio
// guard only bites above 50 mirror files and 30%, and the auto-sync
// `wrapped-up` gate reads exactly that mark, so the next cycle would encrypt,
// commit and PUSH the deletions to the team. The mark must therefore go down
// BEFORE the first unlink, not after the last one.
//
// Skipped where the permission trick cannot work: Windows ignores the mode
// bits this relies on, and root ignores them everywhere.
const CANNOT_DENY_WRITE = process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0);

test('clear-plaintext: a delete that fails part-way still records wrappedUpAt, so auto-sync stays gated',
  { skip: CANNOT_DENY_WRITE ? 'needs POSIX mode bits and a non-root user' : false },
  async () => {
    await stopServer(child);
    child = startServer(PORT_WITH_KEY, { ...baseEnv, DATA_ENCRYPTION_KEY: KEY });
    await waitForServer(PORT_WITH_KEY);

    // Refill from the mirror, then drop the one file the mirror does not have,
    // so the eligibility gate passes and the failure below comes from the
    // delete itself rather than from `plaintext-ahead`.
    await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/decrypt', {});
    fs.rmSync(path.join(PLAIN_DIR, 'time-off'), { recursive: true, force: true });
    assert.ok(plainFiles(PLAIN_DIR).length > 0, 'sanity: there is something to delete');

    // Read-only directory: readdirSync still lists it, unlinking inside fails.
    fs.chmodSync(PLAIN_DIR, 0o500);
    try {
      const { body } = await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/clear-plaintext', {});
      assert.strictEqual(body.ok, false, JSON.stringify(body));
      assert.strictEqual(body.error, 'fs-error', JSON.stringify(body));

      const row = await overviewRow(PORT_WITH_KEY);
      assert.ok(row.wrappedUpAt, 'the mark must survive a partial delete - without it auto-sync would push the half-wipe');
    } finally {
      fs.chmodSync(PLAIN_DIR, 0o700);
    }
  });
