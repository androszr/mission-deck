// _repoPull must stop when `pull --rebase --autostash` comes back with a
// conflict (git exits 0 then). Reproduces 2026-10-08 on throwaway repos: a
// local edit and a teammate's edit to the same line. Contributed with
// feedback report !6/!7; extended with the guard on later pulls and pushes and
// both resolve-autostash choices.
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
// Keep the pull's sync-log shard out of the repo's data/ (it is named after the git user).
if (!process.env.TEST_SYNC_LOG_DIR) process.env.TEST_SYNC_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-log-'));
const srv = require('../server.js');

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-pull-autostash-'));
  const origin = path.join(root, 'origin.git');
  const mine = path.join(root, 'mine');
  const theirs = path.join(root, 'theirs');
  git(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(root, ['clone', '-q', origin, mine]);
  fs.writeFileSync(path.join(mine, 'a.txt.enc'), 'base\n');
  fs.writeFileSync(path.join(mine, 'b.txt.enc'), 'base\n');
  git(mine, ['add', '-A']);
  git(mine, ['commit', '-q', '-m', 'base']);
  git(mine, ['push', '-q', 'origin', 'HEAD:main']);
  git(mine, ['branch', '-q', '--set-upstream-to=origin/main']);
  git(root, ['clone', '-q', origin, theirs]);
  return { root, mine, theirs };
}

function repoDef(dir, calls) {
  return {
    id: 'test-autostash',
    dir,
    existsFn: () => true,
    gitExecFn: async (args) => {
      const r = spawnSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
      return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', killed: false };
    },
    resetCheckCache: () => {},
    writeToken: () => 'test-token',
    encryptFn: () => { calls.push('encrypt'); return { ok: true }; },
    decryptFn: () => { calls.push('decrypt'); return { ok: true }; },
    pullTimestampKey: 'test-autostash',
  };
}

test('autostash conflict: refuses before decrypting and keeps the stash', async () => {
  const { root, mine, theirs } = setup();
  try {
    fs.writeFileSync(path.join(theirs, 'a.txt.enc'), 'teammate\n');
    git(theirs, ['commit', '-q', '-am', 'teammate']);
    git(theirs, ['push', '-q', 'origin', 'HEAD:main']);
    fs.writeFileSync(path.join(mine, 'a.txt.enc'), 'local\n');
    fs.writeFileSync(path.join(mine, 'b.txt.enc'), 'local only\n');

    const calls = [];
    const r = await srv._repoPull(repoDef(mine, calls), () => {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'autostash-conflict');
    assert.deepStrictEqual(r.paths, ['a.txt.enc']);
    assert.match(r.message, /a\.txt/);
    assert.ok(!r.message.includes('.enc'), 'paths are shown without the mirror suffix');
    assert.ok(!calls.includes('decrypt'), 'the plaintext is never touched');
    assert.match(git(mine, ['stash', 'list']), /autostash/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no conflict: pull goes on to decrypt as before', async () => {
  const { root, mine, theirs } = setup();
  try {
    fs.writeFileSync(path.join(theirs, 'a.txt.enc'), 'teammate\n');
    git(theirs, ['commit', '-q', '-am', 'teammate']);
    git(theirs, ['push', '-q', 'origin', 'HEAD:main']);
    fs.writeFileSync(path.join(mine, 'b.txt.enc'), 'local only\n');

    const calls = [];
    const r = await srv._repoPull(repoDef(mine, calls), () => {});
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(calls.includes('decrypt'));
    // core.autocrlf on Windows may hand the line back as CRLF.
    assert.strictEqual(fs.readFileSync(path.join(mine, 'b.txt.enc'), 'utf8').trim(), 'local only');
    assert.deepStrictEqual(await srv._repoUnmergedPaths(repoDef(mine, [])), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The state the first test leaves behind: `a` conflicted (UU), `b` carries a
// local-only edit, `c` a teammate-only edit, the autostash on top.
async function conflicted() {
  const env = setup();
  const { mine, theirs } = env;
  fs.writeFileSync(path.join(mine, 'c.txt.enc'), 'base\n');
  git(mine, ['add', '-A']);
  git(mine, ['commit', '-q', '-m', 'c']);
  git(mine, ['push', '-q', 'origin', 'HEAD:main']);
  git(theirs, ['pull', '-q']);
  fs.writeFileSync(path.join(theirs, 'a.txt.enc'), 'teammate\n');
  fs.writeFileSync(path.join(theirs, 'c.txt.enc'), 'teammate c\n');
  git(theirs, ['commit', '-q', '-am', 'teammate']);
  git(theirs, ['push', '-q', 'origin', 'HEAD:main']);
  fs.writeFileSync(path.join(mine, 'a.txt.enc'), 'local\n');
  fs.writeFileSync(path.join(mine, 'b.txt.enc'), 'local only\n');
  const r = await srv._repoPull(repoDef(mine, []), () => {});
  assert.strictEqual(r.error, 'autostash-conflict');
  return env;
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8').trim();

test('an unresolved conflict blocks the next pull and the next push before anything is encrypted or staged', async () => {
  const { root, mine } = await conflicted();
  try {
    const calls = [];
    const pull = await srv._repoPull(repoDef(mine, calls), () => {});
    assert.strictEqual(pull.error, 'autostash-conflict');
    const push = await srv._repoPush(repoDef(mine, calls), () => {});
    assert.strictEqual(push.error, 'autostash-conflict', 'a push would otherwise git add -A the local version over the teammate\'s');
    assert.deepStrictEqual(calls, [], 'neither encrypt nor decrypt ran');
    assert.deepStrictEqual(await srv._repoUnmergedPaths(repoDef(mine, [])), ['a.txt.enc']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolve keep=mine: the conflicted file takes the local version, everything else keeps the merge, the stash stays', async () => {
  const { root, mine } = await conflicted();
  try {
    const calls = [];
    const r = await srv._repoResolveAutostashOp(repoDef(mine, calls), 'mine');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(read(mine, 'a.txt.enc'), 'local');
    assert.strictEqual(read(mine, 'b.txt.enc'), 'local only');
    assert.strictEqual(read(mine, 'c.txt.enc'), 'teammate c', 'a teammate-only edit survives');
    assert.deepStrictEqual(calls, ['decrypt'], 'the whole tree is decrypted, never encrypted');
    assert.deepStrictEqual(await srv._repoUnmergedPaths(repoDef(mine, [])), []);
    // git itself stages the cleanly re-applied part of the stash (b); the
    // conflicted file must not be left staged by the resolve.
    assert.ok(!git(mine, ['diff', '--cached', '--name-only']).includes('a.txt.enc'), 'the resolved file is not left staged');
    assert.match(git(mine, ['stash', 'list']), /autostash/);
    const again = await srv._repoPull(repoDef(mine, []), () => {});
    assert.strictEqual(again.ok, true, 'the source is usable again');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolve keep=team: the conflicted file takes the team version, the local one stays in the stash', async () => {
  const { root, mine } = await conflicted();
  try {
    const calls = [];
    const r = await srv._repoResolveAutostashOp(repoDef(mine, calls), 'team');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(read(mine, 'a.txt.enc'), 'teammate');
    assert.strictEqual(read(mine, 'b.txt.enc'), 'local only', 'a local-only edit survives');
    assert.deepStrictEqual(calls, ['decrypt']);
    assert.deepStrictEqual(await srv._repoUnmergedPaths(repoDef(mine, [])), []);
    const stashed = git(mine, ['show', 'stash@{0}:a.txt.enc']).trim();
    assert.strictEqual(stashed, 'local', 'the local version is recoverable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolve keep=mine refuses when the newest stash is not the autostash', async () => {
  const { root, mine } = await conflicted();
  try {
    // A hand-made stash on top: its blobs must never be taken for the local edits.
    // (`git stash push` refuses on an unmerged index, so write the stash
    // reflog entry directly - its subject is all the guard reads.)
    git(mine, ['update-ref', '-m', 'reczny', 'refs/stash', 'HEAD']);
    const calls = [];
    const r = await srv._repoResolveAutostashOp(repoDef(mine, calls), 'mine');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'stash-missing');
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(await srv._repoUnmergedPaths(repoDef(mine, [])), ['a.txt.enc'], 'nothing was changed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolve: an unknown choice and a tree with no conflict are both answered without touching git', async () => {
  const { root, mine } = setup();
  try {
    const calls = [];
    const bad = await srv._repoResolveAutostashOp(repoDef(mine, calls), 'both');
    assert.strictEqual(bad.error, 'invalid-keep');
    const none = await srv._repoResolveAutostashOp(repoDef(mine, calls), 'team');
    assert.strictEqual(none.ok, true);
    assert.strictEqual(none.alreadyResolved, true);
    assert.deepStrictEqual(calls, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// modify/delete: the team deleted the file this machine edited. Whichever
// side is chosen must be reachable - `checkout` alone fails on the absent one.
async function deletedByTeam() {
  const env = setup();
  const { mine, theirs } = env;
  git(theirs, ['rm', '-q', 'a.txt.enc']);
  git(theirs, ['commit', '-q', '-m', 'teammate deletes a']);
  git(theirs, ['push', '-q', 'origin', 'HEAD:main']);
  fs.writeFileSync(path.join(mine, 'a.txt.enc'), 'local\n');
  const r = await srv._repoPull(repoDef(mine, []), () => {});
  assert.strictEqual(r.error, 'autostash-conflict', JSON.stringify(r));
  return env;
}

test('modify/delete, keep=team: the file is deleted as the team decided', async () => {
  const { root, mine } = await deletedByTeam();
  try {
    const r = await srv._repoResolveAutostashOp(repoDef(mine, []), 'team');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(!fs.existsSync(path.join(mine, 'a.txt.enc')));
    assert.deepStrictEqual(await srv._repoUnmergedPaths(repoDef(mine, [])), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('modify/delete, keep=mine: the local edit comes back as an ordinary change', async () => {
  const { root, mine } = await deletedByTeam();
  try {
    const r = await srv._repoResolveAutostashOp(repoDef(mine, []), 'mine');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(read(mine, 'a.txt.enc'), 'local');
    assert.deepStrictEqual(await srv._repoUnmergedPaths(repoDef(mine, [])), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
