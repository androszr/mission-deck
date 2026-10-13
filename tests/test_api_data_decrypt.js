'use strict';
// tests/test_api_data_decrypt.js
// The "clone first, key later" path, end to end against a real server and a
// real git remote on disk. This is the shape every new person hits: the
// startup auto-clone fills the encrypted mirror the moment the vault opens,
// with or without the key, and the key arrives later through the wizard.
//
// Before the fix that path lost data: status said 'ready', the wizard's key
// step ran pull-stream, and the pull's pre-fetch encrypt walked an EMPTY
// plaintext tree and unlinked every `.enc` in the mirror - one push away from
// deleting the team's data on the remote. Now the status row says
// `decrypted: false`, a pull leaves the mirror intact, and POST .../decrypt
// fills the plaintext directory without touching git.
//
// Two servers in sequence over the same directories: the first with a key that
// cannot open the mirror (a wrong key; on a machine with no .encryption-key
// this is the same state as no key at all), the second with the right one.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');
const crypto_sync = require('../scripts/crypto-sync.js');

const PORT_NO_KEY = 3521;
const PORT_WITH_KEY = 3522;

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-decrypt-'));
const REMOTE = path.join(BASE, 'remote.git');
const PLAIN_DIR = path.join(BASE, 'ds-data');            // DATA_TIER_0_DIR
const MIRROR_DIR = PLAIN_DIR + '-encrypted';               // derived by the server
const SUB_REPOS = path.join(BASE, 'sub-repos');
const KEY = crypto_sync.generateKey();
const WRONG_KEY = crypto_sync.generateKey();
const TEAM_FILES = 6; // team-members.json + 5 avatars

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
  }).trim();
}

function encCount(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.enc')).length; } catch { return -1; }
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
    await new Promise(r => setTimeout(r, 200));
  }
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
  // The team's data: a plaintext tree encrypted with KEY, committed, served as
  // a bare remote - the state ds-data-tier-0 is in when a new person arrives.
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

test('phase 1: cloned without a working key -> status ready but decrypted:false, plaintext empty, mirror full', async () => {
  child = startServer(PORT_NO_KEY, { ...baseEnv, DATA_ENCRYPTION_KEY: WRONG_KEY });
  await waitForServer(PORT_NO_KEY);

  // The startup auto-clone may already be running; an explicit clone then
  // answers alreadyCloned. Either way the mirror ends up on disk.
  await postJson(PORT_NO_KEY, '/api/data/data-tier-0/clone', {});
  const st = await waitFor(async () => {
    const { body } = await getJson(PORT_NO_KEY, '/api/data/data-tier-0/status');
    return body.exists ? body : null;
  });
  assert.strictEqual(st.status, 'ready');
  assert.strictEqual(st.decrypted, false, 'a mirror nobody could decrypt must not read as decrypted');
  assert.strictEqual(encCount(MIRROR_DIR), TEAM_FILES, 'the clone itself succeeded');
  assert.deepStrictEqual(plainFiles(PLAIN_DIR), [], 'nothing readable landed');

  const ov = await getJson(PORT_NO_KEY, '/api/sync-overview');
  const row = ov.body.repos.find(r => r.repo === 'data-tier-0');
  assert.strictEqual(row.decrypted, false);
  assert.strictEqual(row.filesToSend, 0, 'an empty plaintext tree is not "local changes"');
});

test('phase 1: a pull over the undecrypted clone leaves the mirror intact (the old data-loss path)', async () => {
  const { body } = await postJson(PORT_NO_KEY, '/api/data/data-tier-0/pull', {});
  // The pull cannot succeed without the key, and that is fine - what matters
  // is what it left behind.
  assert.strictEqual(body.ok, false);
  assert.strictEqual(encCount(MIRROR_DIR), TEAM_FILES, 'pre-fetch encrypt must not unlink the team\'s files');
  assert.strictEqual(git(MIRROR_DIR, 'status', '--porcelain'), '', 'no deletion staged for the next push');
});

test('phase 1: the local-changes listing refuses instead of pruning the mirror', async () => {
  // _dataTier0LocalChangesList re-encrypts first; on a tree that never
  // received the mirror it used to unlink every .enc (the same wipe as the
  // pull). Now the guard answers, and the modal maps the code.
  const { status, body } = await getJson(PORT_NO_KEY, '/api/data/data-tier-0/local-changes');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'encrypt-destructive', JSON.stringify(body));
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
  assert.strictEqual(encCount(MIRROR_DIR), TEAM_FILES);
});

test('phase 1: decrypt with the wrong key fails closed', async () => {
  const { body } = await postJson(PORT_NO_KEY, '/api/data/data-tier-0/decrypt', {});
  assert.strictEqual(body.ok, false);
  assert.ok(['decrypt-failed', 'key-missing'].includes(body.error), body.error);
  assert.deepStrictEqual(plainFiles(PLAIN_DIR), []);
  await stopServer(child);
  child = null;
});

test('phase 2: with the key, decrypt fills the plaintext tree and keeps a module\'s own download', async () => {
  // What the time-off module does on a fresh install: writes its shards into the
  // plaintext directory before anybody decrypted anything.
  fs.mkdirSync(path.join(PLAIN_DIR, 'time-off', 'persons'), { recursive: true });
  fs.writeFileSync(path.join(PLAIN_DIR, 'time-off', 'persons', 'alex-morgan.json'), '{"days":[]}');

  child = startServer(PORT_WITH_KEY, { ...baseEnv, DATA_ENCRYPTION_KEY: KEY });
  await waitForServer(PORT_WITH_KEY);

  const before = await getJson(PORT_WITH_KEY, '/api/data/data-tier-0/status');
  assert.strictEqual(before.body.status, 'ready');
  assert.strictEqual(before.body.decrypted, false, 'a module download alone does not make the tree decrypted');

  const { body } = await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/decrypt', {});
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  assert.strictEqual(body.stats.written, TEAM_FILES);
  const files = plainFiles(PLAIN_DIR);
  assert.ok(files.includes('team/team-members.json'), 'the roster the avatars come from is now readable');
  assert.ok(files.includes('time-off/persons/alex-morgan.json'), 'the module\'s file survived (prune:false)');

  const after = await getJson(PORT_WITH_KEY, '/api/data/data-tier-0/status');
  assert.strictEqual(after.body.decrypted, true);
});

test('phase 2: a pull after the decrypt keeps the mirror and stages the module file as an addition, never a deletion', async () => {
  // The git half of the pull cannot complete here: _gitExecRepo refuses every
  // remote op whose origin is not clean HTTPS (a file:// remote included) - a
  // security rule, not a defect. The step under test runs BEFORE git: the
  // pre-fetch encrypt of the plaintext tree into the mirror, which is exactly
  // where the old path unlinked the team's files.
  await postJson(PORT_WITH_KEY, '/api/data/data-tier-0/pull', {});
  assert.strictEqual(encCount(MIRROR_DIR), TEAM_FILES + 1, 'team files intact, the module file encrypted alongside them');
  const porcelain = git(MIRROR_DIR, 'status', '--porcelain');
  assert.ok(!/^ ?D /m.test(porcelain), 'no deletion may be staged for a push:\n' + porcelain);
  assert.ok(/^\?\? /m.test(porcelain), 'the module file shows as an addition');
  assert.ok(fs.existsSync(path.join(PLAIN_DIR, 'time-off', 'persons', 'alex-morgan.json')));
  assert.ok(fs.existsSync(path.join(PLAIN_DIR, 'team', 'team-members.json')));
  const st = await getJson(PORT_WITH_KEY, '/api/data/data-tier-0/status');
  assert.strictEqual(st.body.decrypted, true);
});
