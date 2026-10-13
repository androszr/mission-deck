// tests/test_app_repo_adopt.mjs
// scripts/_app-repo-adopt.js against real git: a bare "remote" with three
// commits, a working tree unpacked from `git archive` of the middle one, and
// the adopter asked to turn that tree back into a repository. Every case
// asserts the one property the whole module exists for: not a single file in
// the working tree changes, only `.git` appears.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const adopt = require('../scripts/_app-repo-adopt.js');

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

// Every file except SOURCE_COMMIT, the one file adoption is allowed to
// restore to its committed content (asserted separately).
function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === adopt.SOURCE_COMMIT_FILE) continue;
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(path.join(dir, r), 'utf8');
    }
  };
  walk('');
  return out;
}

// Builds: a source repo with 3 commits on main, a bare clone of it (the
// "remote"), and returns the commit hashes oldest-first.
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-'));
  const src = path.join(base, 'src');
  fs.mkdirSync(src);
  git(src, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(src, '.gitattributes'), `${adopt.SOURCE_COMMIT_FILE} export-subst\n`);
  fs.writeFileSync(path.join(src, adopt.SOURCE_COMMIT_FILE), `${adopt.SOURCE_COMMIT_PLACEHOLDER}\n`);
  fs.mkdirSync(path.join(src, 'js'));
  const commits = [];
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(src, 'js', 'app.js'), `export const v = ${i};\n`);
    fs.writeFileSync(path.join(src, `note-${i}.md`), `note ${i}\n`);
    git(src, 'add', '-A');
    git(src, 'commit', '-q', '-m', `c${i}`);
    commits.push(git(src, 'rev-parse', 'HEAD'));
  }
  const remote = path.join(base, 'remote.git');
  git(base, 'clone', '-q', '--bare', src, remote);
  return { base, src, remote, commits };
}

// Unpacks `git archive <commit>` of the source repo into a fresh directory -
// the exact tree the GitLab download button produces, SOURCE_COMMIT stamped.
function unpackArchive(fx, commit) {
  const tree = path.join(fx.base, `tree-${commit.slice(0, 7)}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tree);
  execFileSync('sh', ['-c', `git archive --format=tar ${commit} | tar -x -C "${tree}"`], { cwd: fx.src, env: GIT_ENV });
  return tree;
}

const cleanup = [];
test.after(() => { for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true }); });

test('readSourceCommit: a clone keeps the placeholder and reads as no hint', () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  assert.strictEqual(adopt.readSourceCommit(fx.src), null);
  assert.strictEqual(adopt.readSourceCommit(path.join(fx.base, 'nowhere')), null);
});

test('git archive stamps SOURCE_COMMIT with the commit hash', () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const tree = unpackArchive(fx, fx.commits[1]);
  assert.strictEqual(adopt.readSourceCommit(tree), fx.commits[1]);
  assert.strictEqual(adopt.hasGitDir(tree), false);
});

test('adopt: archive of the middle commit -> repo at that commit, clean status, tree untouched', async () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const tree = unpackArchive(fx, fx.commits[1]);
  const before = snapshot(tree);
  assert.strictEqual(await adopt.repoState(tree, run), 'none');

  const r = await adopt.adoptAppRepo({ root: tree, remoteUrl: fx.remote, fetchUrl: fx.remote, run });
  assert.deepStrictEqual({ ok: r.ok, created: r.created, commit: r.commit, matched: r.matched },
    { ok: true, created: true, commit: fx.commits[1], matched: 'source-commit' });

  assert.deepStrictEqual(snapshot(tree), before, 'working tree must not change');
  assert.strictEqual(fs.readFileSync(path.join(tree, adopt.SOURCE_COMMIT_FILE), 'utf8'),
    `${adopt.SOURCE_COMMIT_PLACEHOLDER}\n`, 'the consumed hint goes back to its committed content');
  assert.strictEqual(git(tree, 'rev-parse', 'HEAD'), fx.commits[1]);
  assert.strictEqual(git(tree, 'branch', '--show-current'), 'main');
  assert.strictEqual(git(tree, 'remote', 'get-url', 'origin'), fx.remote);
  assert.strictEqual(git(tree, 'status', '--porcelain'), '', 'a clean tree, so the updater may run');
  assert.strictEqual(git(tree, 'config', 'branch.main.remote'), 'origin');
  // The scan compared with `-c core.fileMode=false` because a zip tool may drop
  // the executable bit; a repo this call CREATED persists that, so the same
  // dropped bit cannot resurface as a modified file under the updater.
  assert.strictEqual(git(tree, 'config', 'core.fileMode'), 'false');
  assert.strictEqual(await adopt.repoState(tree, run), 'ready');
  // The remote is two commits ahead - exactly what the updater then applies.
  assert.strictEqual(git(tree, 'rev-parse', 'refs/remotes/origin/main'), fx.commits[2]);
});

test('adopt: no usable hint -> tree scan finds the matching commit', async () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const tree = unpackArchive(fx, fx.commits[0]);
  // Simulate a hand-made zip: the placeholder was never substituted.
  fs.writeFileSync(path.join(tree, adopt.SOURCE_COMMIT_FILE), `${adopt.SOURCE_COMMIT_PLACEHOLDER}\n`);
  const before = snapshot(tree);

  const r = await adopt.adoptAppRepo({ root: tree, remoteUrl: fx.remote, fetchUrl: fx.remote, run });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.matched, 'tree-scan');
  assert.strictEqual(r.commit, fx.commits[0]);
  assert.deepStrictEqual(snapshot(tree), before);
  assert.strictEqual(git(tree, 'status', '--porcelain'), '');
});

test('adopt: tree scan ignores file modes and CR at end of line', async () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const tree = unpackArchive(fx, fx.commits[2]);
  fs.writeFileSync(path.join(tree, adopt.SOURCE_COMMIT_FILE), `${adopt.SOURCE_COMMIT_PLACEHOLDER}\n`);
  fs.writeFileSync(path.join(tree, 'note-1.md'), 'note 1\r\n');
  fs.chmodSync(path.join(tree, 'js', 'app.js'), 0o755);

  const r = await adopt.adoptAppRepo({ root: tree, remoteUrl: fx.remote, fetchUrl: fx.remote, run });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.commit, fx.commits[2]);
});

test('adopt: edited tree matches nothing -> no-match and the created .git is removed', async () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const tree = unpackArchive(fx, fx.commits[1]);
  fs.writeFileSync(path.join(tree, adopt.SOURCE_COMMIT_FILE), `${adopt.SOURCE_COMMIT_PLACEHOLDER}\n`);
  fs.writeFileSync(path.join(tree, 'js', 'app.js'), 'export const v = 99;\n');
  const before = snapshot(tree);

  const r = await adopt.adoptAppRepo({ root: tree, remoteUrl: fx.remote, fetchUrl: fx.remote, run });
  assert.deepStrictEqual({ ok: r.ok, error: r.error }, { ok: false, error: 'no-match' });
  assert.strictEqual(adopt.hasGitDir(tree), false, 'a failed adopt leaves no half-made repository');
  assert.deepStrictEqual(snapshot(tree), before);
});

test('adopt: a stamped hint that the remote does not have falls back to the scan, which ignores the hint file', async () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const tree = unpackArchive(fx, fx.commits[1]);
  fs.writeFileSync(path.join(tree, adopt.SOURCE_COMMIT_FILE), `${'a'.repeat(40)}\n`);
  const r = await adopt.adoptAppRepo({ root: tree, remoteUrl: fx.remote, fetchUrl: fx.remote, run });
  assert.deepStrictEqual({ ok: r.ok, matched: r.matched, commit: r.commit },
    { ok: true, matched: 'tree-scan', commit: fx.commits[1] }, JSON.stringify(r));
  assert.strictEqual(git(tree, 'status', '--porcelain'), '');
});

test('adopt: unreachable remote -> fetch-failed, nothing left behind', async () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const tree = unpackArchive(fx, fx.commits[1]);
  const bogus = path.join(fx.base, 'does-not-exist.git');
  const r = await adopt.adoptAppRepo({ root: tree, remoteUrl: bogus, fetchUrl: bogus, run });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'fetch-failed');
  assert.ok(typeof r.stderr === 'string' && r.stderr.length > 0);
  assert.strictEqual(adopt.hasGitDir(tree), false);
});

test('adopt: a repository with a HEAD is left exactly as it is', async () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const head = git(fx.src, 'rev-parse', 'HEAD');
  const r = await adopt.adoptAppRepo({ root: fx.src, remoteUrl: fx.remote, fetchUrl: fx.remote, run });
  assert.deepStrictEqual(r, { ok: true, already: true });
  assert.strictEqual(git(fx.src, 'rev-parse', 'HEAD'), head);
  assert.strictEqual((await run(['-C', fx.src, 'remote', 'get-url', 'origin'])).code === 0, false,
    'no origin was added to a repository that had none');
});

test('adopt: an interrupted attempt (unborn .git) is resumed, not duplicated, and not removed on failure', async () => {
  const fx = makeFixture(); cleanup.push(fx.base);
  const tree = unpackArchive(fx, fx.commits[1]);
  git(tree, 'init', '-q');
  assert.strictEqual(await adopt.repoState(tree, run), 'unborn');
  const bogus = path.join(fx.base, 'does-not-exist.git');
  const failed = await adopt.adoptAppRepo({ root: tree, remoteUrl: bogus, fetchUrl: bogus, run });
  assert.strictEqual(failed.error, 'fetch-failed');
  assert.strictEqual(adopt.hasGitDir(tree), true, 'a .git this call did not create is never removed');

  // `git init` probes the filesystem and writes core.filemode itself (true on
  // macOS and Linux, false on Windows); whatever it wrote is this repo's own.
  const fileModeBefore = git(tree, 'config', 'core.fileMode');

  const r = await adopt.adoptAppRepo({ root: tree, remoteUrl: fx.remote, fetchUrl: fx.remote, run });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.created, false);
  assert.strictEqual(r.commit, fx.commits[1]);
  // A .git this call did not create keeps its own config: fileMode is written
  // only for a repository adoption created.
  assert.strictEqual(git(tree, 'config', 'core.fileMode'), fileModeBefore);
  assert.strictEqual(git(tree, 'remote', 'get-url', 'origin'), fx.remote, 'set-url replaced the bogus origin');
  assert.strictEqual(git(tree, 'status', '--porcelain'), '');
});
