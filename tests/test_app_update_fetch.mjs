// tests/test_app_update_fetch.mjs
// The app repository's remote-tracking ref and its local config, against real
// git. Both exist for one reason: what an editor shows a person who never
// commits this repository.
//
// The bug this pins: `git fetch <url>` with no refspec writes FETCH_HEAD and
// NOTHING else, so refs/remotes/origin/main stayed frozen wherever the clone
// or the adopt left it while the updater walked local `main` forward one
// release at a time. VS Code reads that gap as "you have N commits to push"
// and offers a person the maintainer's own commits behind a GitLab sign-in.
// Two halves are covered here: the refspec that stops it recurring, and
// repairStaleOriginMain, which is the only thing that reaches a machine that
// is already apart (the startup updater returns early once a state hash is
// recorded, so such a machine never fetches again).
//
// The updater's own hard reset is emulated with `update-ref refs/heads/main`
// plus `read-tree`: what is under test is ref bookkeeping, not the reset.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const adopt = require('../scripts/_app-repo-adopt.js');
const srv = require('../server.js');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_TERMINAL_PROMPT: '0',
};
delete GIT_ENV.GIT_DIR; delete GIT_ENV.GIT_WORK_TREE; delete GIT_ENV.GIT_INDEX_FILE;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// The runner shape server.js hands in (_gitP): never throws, resolves a code.
function run(args, timeout) {
  return new Promise((resolve) => {
    execFile('git', args, { timeout: timeout || 15000, env: GIT_ENV }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/**
 * A bare remote at c1, a clone taken at that moment, then c2 and c3 pushed -
 * the shape of a machine that cloned once and has been updated by the app
 * ever since. Returns the clone plus every sha.
 */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-fetch-'));
  const remote = path.join(dir, 'remote.git');
  const work = path.join(dir, 'work');
  const clone = path.join(dir, 'clone');

  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'f.txt'), 'c1\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'c1');
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', '-q', 'origin', 'main');
  const c1 = git(work, 'rev-parse', 'HEAD');

  git(dir, 'clone', '-q', remote, clone);

  fs.writeFileSync(path.join(work, 'f.txt'), 'c2\n');
  git(work, 'commit', '-qam', 'c2');
  const c2 = git(work, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(work, 'f.txt'), 'c3\n');
  git(work, 'commit', '-qam', 'c3');
  const c3 = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', '-q', 'origin', 'main');

  return { dir, remote, clone, c1, c2, c3 };
}

/** "<behind> <ahead>" of local main against its remote-tracking ref. */
function aheadBehind(repo) {
  return git(repo, 'rev-list', '--left-right', '--count', 'refs/remotes/origin/main...main').replace(/\s+/g, ' ');
}

/** What the updater does to the working tree, minus the reset itself. */
function emulateUpdateReset(repo) {
  git(repo, 'update-ref', 'refs/heads/main', 'FETCH_HEAD');
  git(repo, 'read-tree', 'HEAD');
}

test('git fetch by URL with no refspec leaves origin/main stale - the bug', () => {
  const { dir, remote, clone, c1, c3 } = fixture();
  try {
    git(clone, 'fetch', remote);
    assert.strictEqual(git(clone, 'rev-parse', 'refs/remotes/origin/main'), c1,
      'a bare-URL fetch must not move the remote-tracking ref (this is what broke)');
    emulateUpdateReset(clone);
    assert.strictEqual(git(clone, 'rev-parse', 'main'), c3);
    assert.strictEqual(aheadBehind(clone), '0 2', 'two of the remote own commits read as outgoing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ORIGIN_MAIN_REFSPEC moves origin/main and still resolves FETCH_HEAD to the same commit', () => {
  const { dir, remote, clone, c3 } = fixture();
  try {
    git(clone, 'fetch', remote, adopt.ORIGIN_MAIN_REFSPEC);
    assert.strictEqual(git(clone, 'rev-parse', 'refs/remotes/origin/main'), c3);
    // Load-bearing: the updater resets to FETCH_HEAD, so the refspec must not
    // change which commit that names.
    assert.strictEqual(git(clone, 'rev-parse', 'FETCH_HEAD'), c3);
    emulateUpdateReset(clone);
    assert.strictEqual(aheadBehind(clone), '0 0', 'nothing outgoing after an update');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('_appUpdateFetchArgs is the one argv both update paths use', () => {
  const args = srv._appUpdateFetchArgs('/some/root', 'https://oauth2:tok@example.com/r.git');
  assert.deepStrictEqual(args, [
    '-C', '/some/root', 'fetch', 'https://oauth2:tok@example.com/r.git',
    '+refs/heads/main:refs/remotes/origin/main',
  ]);
  // The token rides as an argument only; nothing here names a stored remote.
  assert.ok(!args.includes('origin'));
});

test('repairStaleOriginMain fast-forwards a stale ref when HEAD came from an update', async () => {
  const { dir, remote, clone, c1, c3 } = fixture();
  try {
    git(clone, 'fetch', remote);
    emulateUpdateReset(clone);
    assert.strictEqual(aheadBehind(clone), '0 2');

    const r = await adopt.repairStaleOriginMain({ root: clone, run, stateHash: c3 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.moved, true);
    assert.strictEqual(r.from, c1);
    assert.strictEqual(r.to, c3);
    assert.strictEqual(aheadBehind(clone), '0 0', 'the editor stops offering the commits');

    // Idempotent: a second boot writes nothing.
    const again = await adopt.repairStaleOriginMain({ root: clone, run, stateHash: c3 });
    assert.deepStrictEqual(again, { ok: true, already: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repairStaleOriginMain refuses when HEAD is not the commit the updater recorded', async () => {
  const { dir, remote, clone, c2, c3 } = fixture();
  try {
    git(clone, 'fetch', remote);
    emulateUpdateReset(clone);
    // A commit somebody authored locally on top of the update.
    fs.writeFileSync(path.join(clone, 'mine.txt'), 'local work\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-qm', 'my own commit');
    const mine = git(clone, 'rev-parse', 'HEAD');
    assert.notStrictEqual(mine, c3);

    const r = await adopt.repairStaleOriginMain({ root: clone, run, stateHash: c3 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'head-not-from-update');
    assert.strictEqual(aheadBehind(clone), '0 3', 'a real local commit stays visible as outgoing');
    // A stale hash from an older update is refused for the same reason.
    const older = await adopt.repairStaleOriginMain({ root: clone, run, stateHash: c2 });
    assert.strictEqual(older.reason, 'head-not-from-update');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repairStaleOriginMain never rewinds a ref that is ahead of HEAD', async () => {
  const { dir, remote, clone, c1, c3 } = fixture();
  try {
    // The honest "this machine is behind" state: the ref knows about c3, HEAD
    // does not. Rewinding it would hide an available update from the editor.
    git(clone, 'fetch', remote, adopt.ORIGIN_MAIN_REFSPEC);
    assert.strictEqual(git(clone, 'rev-parse', 'main'), c1);
    assert.strictEqual(git(clone, 'rev-parse', 'refs/remotes/origin/main'), c3);

    const r = await adopt.repairStaleOriginMain({ root: clone, run, stateHash: c1 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'not-ancestor');
    assert.strictEqual(git(clone, 'rev-parse', 'refs/remotes/origin/main'), c3, 'ref untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repairStaleOriginMain refuses every state it cannot read', async (t) => {
  const { dir, clone, c3 } = fixture();
  try {
    await t.test('no recorded state hash', async () => {
      assert.strictEqual((await adopt.repairStaleOriginMain({ root: clone, run, stateHash: null })).reason, 'no-state');
      assert.strictEqual((await adopt.repairStaleOriginMain({ root: clone, run, stateHash: 'nonsense' })).reason, 'no-state');
    });
    await t.test('no repository at root', async () => {
      const plain = path.join(dir, 'plain');
      fs.mkdirSync(plain);
      assert.strictEqual((await adopt.repairStaleOriginMain({ root: plain, run, stateHash: c3 })).reason, 'no-repo');
    });
    await t.test('no remote-tracking ref at all', async () => {
      const solo = path.join(dir, 'solo');
      fs.mkdirSync(solo);
      git(solo, 'init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(solo, 'a.txt'), 'a\n');
      git(solo, 'add', '-A');
      git(solo, 'commit', '-qm', 'only');
      const head = git(solo, 'rev-parse', 'HEAD');
      assert.strictEqual((await adopt.repairStaleOriginMain({ root: solo, run, stateHash: head })).reason, 'no-ref');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const HTTPS_ORIGIN = 'https://gitlab.example.com/example/mission-deck.git';

test('quietCredentialPrompts clears the helper for an HTTPS origin, once', async () => {
  const { dir, clone } = fixture();
  try {
    git(clone, 'remote', 'set-url', 'origin', HTTPS_ORIGIN);

    const r = await adopt.quietCredentialPrompts({ root: clone, run });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.set, true);
    // An empty value RESETS the helper list, so the machine's own helper stops
    // applying here - that is what stops the sign-in window.
    assert.strictEqual(git(clone, 'config', '--get', 'credential.helper'), '');

    // Idempotent: the key now reads as configured, so a second boot writes
    // nothing. This is the property that lets it run on every start.
    const again = await adopt.quietCredentialPrompts({ root: clone, run });
    assert.strictEqual(again.ok, false);
    assert.strictEqual(again.reason, 'already-configured');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quietCredentialPrompts keeps out of a developer own setup', async (t) => {
  const { dir, clone } = fixture();
  try {
    await t.test('an SSH origin never uses a helper and is left alone', async () => {
      git(clone, 'remote', 'set-url', 'origin', 'git@gitlab.example.com:example/mission-deck.git');
      const r = await adopt.quietCredentialPrompts({ root: clone, run });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, 'not-https');
    });

    await t.test('a helper somebody configured locally is their decision', async () => {
      git(clone, 'remote', 'set-url', 'origin', HTTPS_ORIGIN);
      git(clone, 'config', '--local', 'credential.helper', 'manager');
      const r = await adopt.quietCredentialPrompts({ root: clone, run });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, 'already-configured');
      assert.strictEqual(git(clone, 'config', '--local', '--get', 'credential.helper'), 'manager');
    });

    await t.test('no repository at root', async () => {
      const plain = path.join(dir, 'plain-cred');
      fs.mkdirSync(plain);
      const r = await adopt.quietCredentialPrompts({ root: plain, run });
      assert.strictEqual(r.reason, 'no-repo');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
