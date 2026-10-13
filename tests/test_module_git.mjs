// tests/test_module_git.mjs
// Unit tests for scripts/_module-git.js: the pin (--git-dir/--work-tree) that
// keeps a module WITHOUT its own .git from being mistaken for the enclosing
// mission-deck repository, plus the init/status/commit contract. Every git case
// is skipped when git itself is not on PATH - the helper degrades to
// git-missing in that case, which is covered separately (case f).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MG = require('../scripts/_module-git.js');
// MODULES_DIR is read at require time, so it is pointed at a scratch directory
// BEFORE server.js loads - _findStaleModuleBackup walks that directory and the
// real modules/ of the developer running this must never be read or written.
const STALE_MODULES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-stale-backup-'));
process.env.MODULES_DIR = STALE_MODULES_DIR;
const {
  _collectModuleFiles, _isModuleJunkEntry, _isIncidentalImportEntry, _restoreModuleGitAfterSwap, _findStaleModuleBackup,
  _moduleGitAuthorName, _moduleAsciiVersion,
} = require('../server.js');

let GIT_AVAILABLE = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { GIT_AVAILABLE = false; }

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-module-git-'));
}

// -- (a) moduleGitInit creates .git, .gitignore and one commit ---------------

test('moduleGitInit creates .git, the five-line .gitignore and one commit authored by Cockpit', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const dir = tmpDir();
  const result = await MG.moduleGitInit(dir, 'initial state (scaffold)');
  assert.strictEqual(result.ok, true);
  assert.ok(typeof result.sha7 === 'string' && result.sha7.length > 0);
  assert.ok(fs.existsSync(path.join(dir, '.git')));

  const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  for (const line of MG.MODULE_GITIGNORE_LINES) {
    assert.ok(gitignore.includes(line), 'gitignore missing line: ' + line);
  }

  const status = await MG.moduleGitStatus(dir);
  assert.strictEqual(status.present, true);
  assert.strictEqual(status.dirty, false);
  assert.ok(status.lastCommit);
  assert.strictEqual(status.lastCommit.subject, 'initial state (scaffold)');

  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (b) moduleGitStatus on a fresh init, then after a write -----------------

test('moduleGitStatus reports clean after init and dirty after a write', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const dir = tmpDir();
  await MG.moduleGitInit(dir, 'initial state (scaffold)');

  const clean = await MG.moduleGitStatus(dir);
  assert.deepStrictEqual(
    { present: clean.present, dirty: clean.dirty, changedFiles: clean.changedFiles, branch: clean.branch },
    { present: true, dirty: false, changedFiles: 0, branch: 'main' },
  );

  fs.writeFileSync(path.join(dir, 'note.txt'), 'hello');
  const dirty = await MG.moduleGitStatus(dir);
  assert.strictEqual(dirty.dirty, true);
  assert.strictEqual(dirty.changedFiles, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (c) the pin: a directory with no .git, NESTED inside a git repo --------

test('moduleGitStatus on a directory with no .git nested inside a git repo answers present:false (the pin)', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const parent = tmpDir();
  execFileSync('git', ['init', '-q', '-b', 'main', parent]);
  const nested = path.join(parent, 'modules-fixture');
  fs.mkdirSync(nested, { recursive: true });

  // An UNPINNED `git -C nested status` would happily describe the PARENT
  // repository here - that is exactly the defect this helper exists to make
  // impossible. moduleGitStatus must never fall back to it.
  const status = await MG.moduleGitStatus(nested);
  assert.deepStrictEqual(status, { present: false });

  fs.rmSync(parent, { recursive: true, force: true });
});

// -- (d) moduleGitInit twice --------------------------------------------------

test('moduleGitInit twice answers already-present the second time', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const dir = tmpDir();
  const first = await MG.moduleGitInit(dir, 'first');
  assert.strictEqual(first.ok, true);
  const second = await MG.moduleGitInit(dir, 'second');
  assert.deepStrictEqual(second, { ok: false, reason: 'already-present' });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (e) moduleGitCommit on a clean tree -------------------------------------

test('moduleGitCommit on a clean tree answers nothing-to-commit', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const dir = tmpDir();
  await MG.moduleGitInit(dir, 'initial state (scaffold)');
  const result = await MG.moduleGitCommit(dir, 'no changes here');
  assert.deepStrictEqual(result, { ok: false, reason: 'nothing-to-commit' });
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (e2) moduleGitLog: the "Historia" list -----------------------------------

test('moduleGitLog answers present:false with no .git, an empty list on an unborn branch, and the commits newest first', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const bare = tmpDir();
  assert.deepStrictEqual(await MG.moduleGitLog(bare), { present: false });
  fs.rmSync(bare, { recursive: true, force: true });

  const dir = tmpDir();
  // init WITHOUT a commit: an unborn branch is the normal post-init state.
  execFileSync('git', ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, 'init', '-q', '-b', 'main']);
  const unborn = await MG.moduleGitLog(dir);
  assert.deepStrictEqual(unborn, { present: true, commits: [] });

  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  await MG.moduleGitCommit(dir, 'pierwszy');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
  await MG.moduleGitCommit(dir, 'drugi');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  await MG.moduleGitCommit(dir, 'trzeci');

  const log = await MG.moduleGitLog(dir);
  assert.strictEqual(log.present, true);
  assert.deepStrictEqual(log.commits.map((c) => c.subject), ['trzeci', 'drugi', 'pierwszy']);
  for (const c of log.commits) {
    assert.match(c.sha7, /^[0-9a-f]{7,}$/);
    assert.ok(!Number.isNaN(new Date(c.date).getTime()), 'date is ISO');
  }
  // The newest entry is the one moduleGitStatus reports as lastCommit.
  const status = await MG.moduleGitStatus(dir);
  assert.strictEqual(status.lastCommit.sha7, log.commits[0].sha7);

  const limited = await MG.moduleGitLog(dir, { limit: 2 });
  assert.deepStrictEqual(limited.commits.map((c) => c.subject), ['trzeci', 'drugi']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('moduleGitLog with an emptied PATH on an existing repo answers present:true with an error, never throws', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const dir = tmpDir();
  await MG.moduleGitInit(dir, 'initial state');
  const noPathEnv = { ...process.env, PATH: '' };
  const log = await MG.moduleGitLog(dir, { env: noPathEnv });
  assert.strictEqual(log.present, true);
  assert.strictEqual(typeof log.error, 'string');
  assert.ok(!('commits' in log));
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (f) gitAvailable false with an empty PATH; moduleGitStatus still answers

test('gitAvailable resolves false with an emptied PATH, and moduleGitStatus does not throw', async () => {
  const dir = tmpDir();
  const noPathEnv = { ...process.env, PATH: '' };

  const available = await MG.gitAvailable({ env: noPathEnv });
  assert.strictEqual(available, false);

  // No .git at all yet: this must answer present:false without ever spawning
  // git (a plain existsSync short-circuit), so it is safe to run even when
  // git itself is not installed.
  const status = await MG.moduleGitStatus(dir, { env: noPathEnv });
  assert.deepStrictEqual(status, { present: false });

  fs.rmSync(dir, { recursive: true, force: true });
});

test('moduleGitStatus with an emptied PATH on an existing repo answers present:true with an error, never throws', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const dir = tmpDir();
  await MG.moduleGitInit(dir, 'initial state (scaffold)');
  const noPathEnv = { ...process.env, PATH: '' };
  const status = await MG.moduleGitStatus(dir, { env: noPathEnv });
  assert.strictEqual(status.present, true);
  assert.ok(typeof status.error === 'string' && status.error.length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (g) _collectModuleFiles excludes .git -----------------------------------

test('_collectModuleFiles never returns entries from .git or node_modules', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(dir, 'module.json'), '{}');
  fs.mkdirSync(path.join(dir, 'client'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), 'export const views = {};');

  // The Python interpreter's cache: a module with a Python ETL grows it on
  // first run, its .gitignore is not consulted here, and a publish once
  // carried four .pyc blobs to the catalog (sprint-stats, 2026-09-13).
  fs.mkdirSync(path.join(dir, 'scripts', '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', '__pycache__', 'etl.cpython-314.pyc'), 'x');
  fs.writeFileSync(path.join(dir, 'scripts', 'etl.py'), 'print(1)\n');
  fs.writeFileSync(path.join(dir, 'scripts', 'stray.pyc'), 'x');

  const files = _collectModuleFiles(dir).map((f) => f.path).sort();
  assert.deepStrictEqual(files, ['client/index.js', 'module.json', 'scripts/etl.py']);

  fs.rmSync(dir, { recursive: true, force: true });
});

// -- (h) _restoreModuleGitAfterSwap: the happy path --------------------------

test('_restoreModuleGitAfterSwap moves .git from the backup directory onto the fresh target', () => {
  const bak = tmpDir();
  fs.mkdirSync(path.join(bak, '.git'));
  fs.writeFileSync(path.join(bak, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const target = tmpDir();

  const result = _restoreModuleGitAfterSwap(bak, target);
  assert.deepStrictEqual(result, { ok: true });
  assert.ok(fs.existsSync(path.join(target, '.git', 'HEAD')));
  assert.ok(!fs.existsSync(path.join(bak, '.git')));

  fs.rmSync(bak, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

// -- (i) _restoreModuleGitAfterSwap: the failure this whole fix is about ------
// This is the branch the api harness cannot inject directly (a .git entry is
// stripped from every download/import source before it reaches disk, so the
// swap in the running server never sees a pre-existing target/.git to
// collide with) - covered here instead, per the gap fix's own instruction.

test('_restoreModuleGitAfterSwap answers ok:false and leaves the backup untouched when the rename fails', () => {
  const bak = tmpDir();
  fs.mkdirSync(path.join(bak, '.git'));
  fs.writeFileSync(path.join(bak, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const target = tmpDir();
  // A FILE (not a directory) already sitting at target/.git makes the
  // directory-to-directory rename fail with ENOTDIR - the same "something
  // blocks the move-back" shape as the EPERM case named in the plan's Risks.
  fs.writeFileSync(path.join(target, '.git'), 'not a directory');

  const result = _restoreModuleGitAfterSwap(bak, target);
  assert.strictEqual(result.ok, false);
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  // The backup must survive untouched - it is the only copy of the history.
  assert.ok(fs.existsSync(path.join(bak, '.git', 'HEAD')));

  fs.rmSync(bak, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

// -- (k) _branchFromStatusHeader: every header shape `status --branch` emits --

test('_branchFromStatusHeader reads the branch out of every header shape, unborn included', () => {
  assert.equal(MG._branchFromStatusHeader('main'), 'main');
  assert.equal(MG._branchFromStatusHeader('main...origin/main [ahead 1]'), 'main');
  assert.equal(MG._branchFromStatusHeader('No commits yet on main'), 'main');
  assert.equal(MG._branchFromStatusHeader('feature/x-1'), 'feature/x-1');
  assert.equal(MG._branchFromStatusHeader('HEAD (no branch)'), 'HEAD');
  assert.equal(MG._branchFromStatusHeader(''), '');
});

// -- (l) _moduleGitAuthorName: the sanitiser behind "Save version" ----------

test('_moduleGitAuthorName strips <>, control characters and length, and falls back to the default', () => {
  assert.equal(_moduleGitAuthorName('Taylor Kim'), 'Taylor Kim');
  // A crafted display name must not be able to close the "Name <email>" grammar early.
  assert.equal(_moduleGitAuthorName('Taylor <evil@x> Kim'), 'Taylor evil@x Kim');
  assert.equal(_moduleGitAuthorName('Taylor\nKim\x00'), 'TaylorKim');
  assert.equal(_moduleGitAuthorName('x'.repeat(200)).length, 80);
  assert.equal(_moduleGitAuthorName(''), MG.DEFAULT_AUTHOR.name);
  assert.equal(_moduleGitAuthorName('<>'), MG.DEFAULT_AUTHOR.name);
  assert.equal(_moduleGitAuthorName(undefined), MG.DEFAULT_AUTHOR.name);
  assert.equal(_moduleGitAuthorName(42), MG.DEFAULT_AUTHOR.name);
});

// -- (m) _moduleAsciiVersion: the install commit message fragment -----------

test('_moduleAsciiVersion keeps printable ASCII, drops the rest, caps at 40 and never comes back empty', () => {
  assert.equal(_moduleAsciiVersion('1.2.3'), '1.2.3');
  assert.equal(_moduleAsciiVersion('1.2.3-ąę\n'), '1.2.3-');
  assert.equal(_moduleAsciiVersion('9'.repeat(100)).length, 40);
  assert.equal(_moduleAsciiVersion(''), 'unknown');
  assert.equal(_moduleAsciiVersion(undefined), 'unknown');
  assert.equal(_moduleAsciiVersion(null), 'unknown');
  assert.equal(_moduleAsciiVersion('ąęó'), 'unknown');
  assert.equal(_moduleAsciiVersion(7), '7');
});

// -- (n) _findStaleModuleBackup: only a <id>.bak-* that still holds .git ----

test('_findStaleModuleBackup names only a backup directory of THIS id that still holds .git', () => {
  const mk = (rel, withGit) => {
    const abs = path.join(STALE_MODULES_DIR, rel);
    fs.mkdirSync(withGit ? path.join(abs, '.git') : abs, { recursive: true });
  };
  assert.equal(_findStaleModuleBackup('alpha'), null, 'an empty modules dir has no stale backup');

  mk('alpha', true);                       // the live module itself - not a backup
  mk('alpha.bak-1000', false);             // a backup with NO .git - nothing to rescue
  mk('alphabet.bak-1000', true);           // a different id sharing the prefix
  fs.writeFileSync(path.join(STALE_MODULES_DIR, 'alpha.bak-2000'), 'a file, not a directory');
  assert.equal(_findStaleModuleBackup('alpha'), null);

  mk('alpha.bak-3000', true);
  assert.equal(_findStaleModuleBackup('alpha'), 'alpha.bak-3000', 'the bare directory NAME, not a path');
  assert.equal(_findStaleModuleBackup('alphabet'), 'alphabet.bak-1000');
  assert.equal(_findStaleModuleBackup('beta'), null);
});

test('_findStaleModuleBackup answers null, never throws, when the modules dir cannot be read', () => {
  fs.rmSync(STALE_MODULES_DIR, { recursive: true, force: true });
  assert.equal(_findStaleModuleBackup('alpha'), null);
});

// -- (g2) the one junk predicate the three walkers share ---------------------

test('_isModuleJunkEntry and _isIncidentalImportEntry agree on the Python cache', () => {
  for (const name of ['__pycache__', 'etl.cpython-314.pyc', 'x.pyo', '.DS_Store', 'node_modules', '.git']) {
    assert.strictEqual(_isModuleJunkEntry(name), true, name);
  }
  for (const name of ['etl.py', 'module.json', 'pycache', 'index.pyc.md']) {
    assert.strictEqual(_isModuleJunkEntry(name), false, name);
  }
  assert.strictEqual(_isIncidentalImportEntry('scripts/__pycache__/etl.cpython-314.pyc'), true);
  assert.strictEqual(_isIncidentalImportEntry('scripts/stray.pyc'), true);
  assert.strictEqual(_isIncidentalImportEntry('scripts/etl.py'), false);
  // A traversal segment is never "incidental" - it has to reach the loud check.
  assert.strictEqual(_isIncidentalImportEntry('../x.py'), false);
});

// -- (h) moduleGitCommitPaths: path-scoped commit, never add -A -------------

test('moduleGitCommitPaths commits the named paths and tracked deletions, never an unnamed untracked file', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.js'), 'one\n');
  fs.writeFileSync(path.join(dir, 'c.js'), 'gone\n');
  assert.strictEqual((await MG.moduleGitInit(dir, 'initial state (scaffold)')).ok, true);

  fs.writeFileSync(path.join(dir, 'a.js'), 'two\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'new\n');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
  fs.rmSync(path.join(dir, 'c.js'));

  const r = await MG.moduleGitCommitPaths(dir, 'publish 0.1.0', ['a.js', 'b.js']);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const tree = execFileSync('git', ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, 'ls-tree', '-r', 'HEAD', '--name-only'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.ok(tree.includes('a.js') && tree.includes('b.js'));
  assert.ok(!tree.includes('c.js'), 'tracked deletion is committed');
  assert.ok(!tree.includes('.env'), 'an unnamed file is never staged');
  assert.ok(fs.existsSync(path.join(dir, '.env')));
  const status = execFileSync('git', ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.match(status, /\?\? \.env/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('moduleGitCommitPaths records a named path the module .gitignore ignores (scaffold downloads/)', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.js'), 'one\n');
  assert.strictEqual((await MG.moduleGitInit(dir, 'initial state (scaffold)')).ok, true);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /downloads\//);

  fs.mkdirSync(path.join(dir, 'downloads'));
  fs.writeFileSync(path.join(dir, 'downloads', 'x.csv'), 'a;b\n');
  fs.writeFileSync(path.join(dir, 'a.js'), 'two\n');

  const r = await MG.moduleGitCommitPaths(dir, 'publish 0.1.1', ['a.js', 'downloads/x.csv']);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const tree = execFileSync('git', ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, 'ls-tree', '-r', 'HEAD', '--name-only'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.ok(tree.includes('downloads/x.csv'), 'a published path is committed even when ignored');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('moduleGitCommitPaths refuses no-repo, bad-paths and bad-message without leaving a trace', async () => {
  const dir = tmpDir();
  assert.deepStrictEqual(await MG.moduleGitCommitPaths(dir, 'm', ['a.js']), { ok: false, reason: 'no-repo' });
  assert.strictEqual(fs.existsSync(path.join(dir, '.git')), false);
  fs.mkdirSync(path.join(dir, '.git'));
  for (const bad of [['../x'], ['.git/config'], ['.git'], ['/abs'], [], 'a.js', ['']]) {
    assert.strictEqual((await MG.moduleGitCommitPaths(dir, 'm', bad)).reason, 'bad-paths', JSON.stringify(bad));
  }
  assert.strictEqual((await MG.moduleGitCommitPaths(dir, '  ', ['a.js'])).reason, 'bad-message');
  fs.rmSync(dir, { recursive: true, force: true });
});
