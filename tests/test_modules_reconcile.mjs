// tests/test_modules_reconcile.mjs
// Unit tests of the dirty-guard reconcile (plan 2026-10-07-modul-publikacja-commit-lokalny):
// the pure verdict, the commit lookup by version, the orchestrator against a
// throwaway module repo with a stubbed GitLab getFn, and the publish-time commit.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-reconcile-modules-'));
process.env.MODULES_DIR = SCRATCH; // BEFORE server.js: it reads MODULES_DIR at require time
const MG = require('../scripts/_module-git.js');
const {
  gitBlobSha, moduleReconcileVerdict, _moduleReconcileWithCatalog, _modulesCatalogCommitForVersion,
  _modulesCatalogCommitsUrl, _modulePublishLocalCommit, _modulesCatalogFileRawUrl, _collectModuleFiles,
  _isRegenerableModulePath, _driftAutoReconcile, _moduleFileLf, _modulesCatalogTreeUrl,
} = require('../server.js');

let GIT_AVAILABLE = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { GIT_AVAILABLE = false; }
const SKIP = !GIT_AVAILABLE && 'git not on PATH';

test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

const ID = 'recon-mod';
const MANIFEST = (version, extra = {}) => JSON.stringify({ schemaVersion: 1, id: ID, name: 'R', version, ...extra }, null, 2) + '\n';

function treeFor(files) {
  return Object.entries(files).map(([p, text]) => ({ type: 'blob', path: 'modules/' + ID + '/' + p, id: gitBlobSha(Buffer.from(text)) }));
}

/** getFn answering the commits list, the raw manifest per sha and the tree. */
function stubGet(commits, manifestsBySha, files, calls) {
  return async (url) => {
    if (calls) calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, text: JSON.stringify(body), headers: { get: () => null } });
    if (url === _modulesCatalogCommitsUrl('modules/' + ID + '/module.json')) return ok(commits);
    for (const [sha, text] of Object.entries(manifestsBySha)) {
      if (url === _modulesCatalogFileRawUrl('modules/' + ID + '/module.json', sha)) return { ok: true, status: 200, text, headers: { get: () => null } };
    }
    if (url.includes('/repository/tree')) return ok(treeFor(files));
    return { ok: false, status: 404, text: '', headers: { get: () => null } };
  };
}

async function scaffold(published) {
  const dir = path.join(SCRATCH, ID + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(path.join(dir, 'client'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'module.json'), MANIFEST('0.0.1'));
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), 'old\n');
  assert.strictEqual((await MG.moduleGitInit(dir, 'initial state (scaffold)')).ok, true);
  for (const [p, t] of Object.entries(published)) fs.writeFileSync(path.join(dir, p), t);
  return dir;
}

const PUBLISHED = { 'module.json': MANIFEST('0.1.0'), 'client/index.js': 'new\n', 'client/lib.mjs': 'lib\n' };

test('reconcile commits a dirty repo whose tree equals the catalog tree of its version', { skip: SKIP }, async () => {
  const dir = await scaffold(PUBLISHED);
  assert.strictEqual((await MG.moduleGitStatus(dir)).dirty, true);
  const r = await _moduleReconcileWithCatalog(ID, dir, '0.1.0', {
    getFn: stubGet([{ id: 'c1' }], { c1: PUBLISHED['module.json'] }, PUBLISHED),
    catalogHasModule: async () => true,
    origin: null,
  });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.reconciled, true);
  const st = await MG.moduleGitStatus(dir);
  assert.strictEqual(st.dirty, false);
  assert.strictEqual(st.lastCommit.subject, 'publish 0.1.0 (reconciled with catalog)');
});

test('reconcile answers differs and touches nothing when one file differs by a byte', { skip: SKIP }, async () => {
  const dir = await scaffold(PUBLISHED);
  const headBefore = (await MG.moduleGitStatus(dir)).lastCommit.sha7;
  const remote = { ...PUBLISHED, 'client/index.js': 'neW\n' };
  const r = await _moduleReconcileWithCatalog(ID, dir, '0.1.0', {
    getFn: stubGet([{ id: 'c1' }], { c1: PUBLISHED['module.json'] }, remote),
    catalogHasModule: async () => true,
    origin: null,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'differs');
  assert.strictEqual(r.changed, 1);
  assert.deepStrictEqual(r.paths, ['client/index.js']);
  const st = await MG.moduleGitStatus(dir);
  assert.strictEqual(st.lastCommit.sha7, headBefore);
  assert.strictEqual(st.dirty, true);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'client', 'index.js'), 'utf8'), 'new\n');
});

test('reconcile for a module absent from the catalog makes no GitLab call and no commit', { skip: SKIP }, async () => {
  const dir = await scaffold(PUBLISHED);
  const calls = [];
  const r = await _moduleReconcileWithCatalog(ID, dir, '0.1.0', {
    getFn: stubGet([], {}, {}, calls),
    catalogHasModule: async () => false,
  });
  assert.deepStrictEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'not-in-catalog' });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual((await MG.moduleGitStatus(dir)).lastCommit.subject, 'initial state (scaffold)');
});

test('drift scan commits a dirty repo that already equals the catalog, under the lock', { skip: SKIP }, async () => {
  const dir = await scaffold(PUBLISHED);
  let locked = 0;
  const done = await _driftAutoReconcile(ID, dir, '0.1.0', {
    getFn: stubGet([{ id: 'c1' }], { c1: PUBLISHED['module.json'] }, PUBLISHED),
    catalogHasModule: async () => true,
    withLock: async (fn) => { locked += 1; return fn(); },
  });
  assert.strictEqual(done, true);
  assert.strictEqual(locked, 1);
  const st = await MG.moduleGitStatus(dir);
  assert.strictEqual(st.dirty, false);
  assert.strictEqual(st.lastCommit.subject, 'publish 0.1.0 (reconciled with catalog)');
});

test('drift scan leaves a clean repo alone with no GitLab call and no lock', { skip: SKIP }, async () => {
  const dir = await scaffold({});
  const calls = [];
  let locked = 0;
  const done = await _driftAutoReconcile(ID, dir, '0.0.1', {
    getFn: stubGet([], {}, {}, calls),
    catalogHasModule: async () => true,
    withLock: async (fn) => { locked += 1; return fn(); },
  });
  assert.strictEqual(done, false);
  assert.deepStrictEqual({ calls: calls.length, locked }, { calls: 0, locked: 0 });
});

test('drift scan never commits a dirty repo that differs from the catalog', { skip: SKIP }, async () => {
  const dir = await scaffold(PUBLISHED);
  const remote = { ...PUBLISHED, 'client/index.js': 'other\n' };
  const done = await _driftAutoReconcile(ID, dir, '0.1.0', {
    getFn: stubGet([{ id: 'c1' }], { c1: PUBLISHED['module.json'] }, remote),
    catalogHasModule: async () => true,
    withLock: async (fn) => fn(),
  });
  assert.strictEqual(done, false);
  const st = await MG.moduleGitStatus(dir);
  assert.strictEqual(st.dirty, true);
  assert.strictEqual(st.lastCommit.subject, 'initial state (scaffold)');
});

test('moduleReconcileVerdict ignores a locally stamped area in module.json', () => {
  const local = [{ path: 'module.json', data: Buffer.from(MANIFEST('0.1.0', { area: 'AR' })) }];
  const remoteText = MANIFEST('0.1.0');
  const v = moduleReconcileVerdict(local, ID, treeFor({ 'module.json': remoteText }), remoteText);
  assert.strictEqual(v.equal, true);
  assert.strictEqual(v.changed, 0);
  assert.deepStrictEqual(v.paths, []);
});

test('_modulesCatalogCommitForVersion walks newest first and distinguishes the three failures', async () => {
  const commits = [{ id: 'c2' }, { id: 'c1' }];
  const bySha = { c2: MANIFEST('0.2.0'), c1: MANIFEST('0.1.0') };
  const get = stubGet(commits, bySha, {});
  const hit = await _modulesCatalogCommitForVersion(ID, '0.1.0', get);
  assert.strictEqual(hit.ok, true);
  assert.strictEqual(hit.sha, 'c1');
  assert.deepStrictEqual(await _modulesCatalogCommitForVersion(ID, '0.3.0', get), { ok: false, reason: 'version-not-found' });
  assert.deepStrictEqual(await _modulesCatalogCommitForVersion(ID, '0.1.0', stubGet([], {}, {})), { ok: false, reason: 'not-in-catalog' });
  const down = async () => ({ ok: false, status: 502, text: '' });
  assert.deepStrictEqual(await _modulesCatalogCommitForVersion(ID, '0.1.0', down), { ok: false, reason: 'gitlab-unreachable' });
});

test('_modulePublishLocalCommit commits a dirty scaffold repo and refuses an empty path list without throwing', { skip: SKIP }, async () => {
  const dir = await scaffold(PUBLISHED);
  const files = _collectModuleFiles(dir);
  const r = await _modulePublishLocalCommit(dir, '0.1.0', files, {});
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const st = await MG.moduleGitStatus(dir);
  assert.strictEqual(st.lastCommit.subject, 'publish 0.1.0');
  assert.strictEqual(st.dirty, false);
  assert.deepStrictEqual(await _modulePublishLocalCommit(dir, '0.1.0', [], {}), { ok: false, reason: 'bad-paths' });
});

test('moduleGitUnsavedPaths lists every file git still reports, one per file, after a reconcile-style commit', { skip: SKIP }, async () => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'unsaved-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'one\n');
  assert.strictEqual((await MG.moduleGitInit(dir, 'initial state (scaffold)')).ok, true);
  assert.deepStrictEqual(await MG.moduleGitUnsavedPaths(dir), { ok: true, paths: [] });

  fs.writeFileSync(path.join(dir, 'a.js'), 'two\n');
  fs.writeFileSync(path.join(dir, '.env'), 'LOCAL=1\n');
  fs.mkdirSync(path.join(dir, 'cfg', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cfg', 'deep', 'x y.json'), '{}');
  const r = await MG.moduleGitUnsavedPaths(dir);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.paths.slice().sort(), ['.env', 'a.js', 'cfg/deep/x y.json']);

  assert.deepStrictEqual(await MG.moduleGitUnsavedPaths(path.join(SCRATCH, 'nope')), { ok: false, reason: 'no-repo' });
});

test('_isRegenerableModulePath drops only caches, never a dotfile or a source file', () => {
  for (const p of ['client/__pycache__/x.pyc', 'scripts/a.pyc', 'node_modules/x/index.js', '.pytest_cache/v/cache']) {
    assert.strictEqual(_isRegenerableModulePath(p), true, p);
  }
  for (const p of ['.env', 'client/index.js', 'config/.local.json', 'pycache.js']) {
    assert.strictEqual(_isRegenerableModulePath(p), false, p);
  }
});

// cockpit-modules !134: a Windows checkout published six files as CRLF, every
// line changed in the catalog for a 27-line edit.
test('_moduleFileLf turns CRLF into LF in source text only, and leaves everything else byte-identical', () => {
  const crlf = Buffer.from('const a = 1;\r\n// café déjà vu\r\n', 'utf8');
  assert.strictEqual(_moduleFileLf('client/lib.js', crlf).toString('utf8'), 'const a = 1;\n// café déjà vu\n', 'UTF-8 survives');
  for (const p of ['module.json', 'README.md', 'server/x.py', 'styles/a.CSS', '.gitignore']) {
    assert.ok(!_moduleFileLf(p, crlf).includes('\r\n'), p);
  }
  for (const p of ['data/export.csv', 'assets/logo.png', 'bin/tool', 'LICENSE']) {
    assert.strictEqual(_moduleFileLf(p, crlf), crlf, p + ' is content, not source text');
  }
  const binary = Buffer.from([0x7b, 0x0d, 0x0a, 0x00, 0x0d, 0x0a]);
  assert.strictEqual(_moduleFileLf('a.json', binary), binary, 'a NUL byte means binary');
  const lf = Buffer.from('x\n');
  assert.strictEqual(_moduleFileLf('a.js', lf), lf, 'nothing to do -> same Buffer');
  assert.strictEqual(_moduleFileLf('a.js', Buffer.from('a\rb')).toString(), 'a\rb', 'a lone CR is not a line ending');
});

test('_collectModuleFiles answers the LF bytes, so a CRLF checkout matches the LF catalog blob (no false drift)', () => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'lf-'));
  fs.writeFileSync(path.join(dir, 'index.js'), 'a\r\nb\r\n');
  const [f] = _collectModuleFiles(dir);
  assert.strictEqual(f.data.toString(), 'a\nb\n');
  assert.strictEqual(gitBlobSha(f.data), gitBlobSha(Buffer.from('a\nb\n')));
});

// -- False "local change" after a same-version catalog fix (a module at 0.8.3, 2026-10-09) --
// The catalog set 0.1.0 in c1, then c3 changed client/index.js WITHOUT a version
// bump; the install read c3. Comparing only with c1 reported the untouched
// file as the person's own change and blocked every update.

/** getFn with per-sha trees, the module.json commit list and the module dir commit list. */
function stubGetBySha({ manifestCommits, dirCommits, manifestsBySha, treesBySha, calls }) {
  return async (url) => {
    if (calls) calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, text: JSON.stringify(body), headers: { get: () => null } });
    if (url === _modulesCatalogCommitsUrl('modules/' + ID + '/module.json')) return ok(manifestCommits);
    if (url === _modulesCatalogCommitsUrl('modules/' + ID)) return ok(dirCommits);
    for (const [sha, text] of Object.entries(manifestsBySha)) {
      if (url === _modulesCatalogFileRawUrl('modules/' + ID + '/module.json', sha)) return { ok: true, status: 200, text, headers: { get: () => null } };
    }
    for (const [sha, files] of Object.entries(treesBySha)) {
      if (url === _modulesCatalogTreeUrl('modules/' + ID, { recursive: true, page: 1, ref: sha })) return ok(treeFor(files));
    }
    return { ok: false, status: 404, text: '', headers: { get: () => null } };
  };
}

const C1_FILES = { ...PUBLISHED, 'client/index.js': 'new\r\n' }; // before the LF fix
const SHA1 = 'a'.repeat(40);
const SHA3 = 'c'.repeat(40);

test('reconcile accepts the tree of a later same-version catalog commit found through the version range', { skip: SKIP }, async () => {
  const dir = await scaffold(PUBLISHED);
  const r = await _moduleReconcileWithCatalog(ID, dir, '0.1.0', {
    getFn: stubGetBySha({
      manifestCommits: [{ id: SHA1 }],
      dirCommits: [{ id: SHA3 }, { id: SHA1 }],
      manifestsBySha: { [SHA1]: PUBLISHED['module.json'] },
      treesBySha: { [SHA1]: C1_FILES, [SHA3]: PUBLISHED },
    }),
    catalogHasModule: async () => true,
    origin: null,
  });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual((await MG.moduleGitStatus(dir)).dirty, false);
});

test('reconcile tries the sha recorded at install first and never walks the range when it matches', { skip: SKIP }, async () => {
  const dir = await scaffold(PUBLISHED);
  const calls = [];
  const r = await _moduleReconcileWithCatalog(ID, dir, '0.1.0', {
    getFn: stubGetBySha({
      manifestCommits: [{ id: SHA1 }],
      dirCommits: [],
      manifestsBySha: { [SHA1]: PUBLISHED['module.json'], [SHA3]: PUBLISHED['module.json'] },
      treesBySha: { [SHA1]: C1_FILES, [SHA3]: PUBLISHED },
      calls,
    }),
    catalogHasModule: async () => true,
    origin: { source: 'catalog', version: '0.1.0', catalogSha: SHA3 },
  });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(!calls.includes(_modulesCatalogCommitsUrl('modules/' + ID)), 'range not walked');
  assert.ok(!calls.some((u) => u.includes('/repository/tree') && u.includes(SHA1)), 'c1 tree not read');
});

test('a real local edit still answers differs after every candidate tree was compared', { skip: SKIP }, async () => {
  const dir = await scaffold({ ...PUBLISHED, 'client/lib.mjs': 'edited\n' });
  const r = await _moduleReconcileWithCatalog(ID, dir, '0.1.0', {
    getFn: stubGetBySha({
      manifestCommits: [{ id: SHA1 }],
      dirCommits: [{ id: SHA3 }, { id: SHA1 }],
      manifestsBySha: { [SHA1]: PUBLISHED['module.json'] },
      treesBySha: { [SHA1]: C1_FILES, [SHA3]: PUBLISHED },
    }),
    catalogHasModule: async () => true,
    origin: null,
  });
  assert.strictEqual(r.reason, 'differs');
  assert.deepStrictEqual(r.paths, ['client/lib.mjs']); // the closest tree (c3) is reported
});

test('the version range stops at the commit that moved the version on', async () => {
  const { _modulesCatalogVersionRangeShas } = require('../server.js');
  const get = stubGetBySha({ manifestCommits: [], dirCommits: [{ id: 'n2' }, { id: 'n1' }, { id: 'm2' }, { id: 'm1' }, { id: 'f' }], manifestsBySha: {}, treesBySha: {} });
  assert.deepStrictEqual(await _modulesCatalogVersionRangeShas(ID, { sha: 'f', nextSha: 'n1' }, get), ['m2', 'm1']);
  assert.deepStrictEqual(await _modulesCatalogVersionRangeShas(ID, { sha: 'f', nextSha: null }, get), ['n2', 'n1', 'm2', 'm1']);
  assert.deepStrictEqual(await _modulesCatalogVersionRangeShas(ID, { sha: 'f', nextSha: 'gone' }, get), []);
});

// -- Caches never make a module dirty (the frequent false alarm) --

test('a module repo whose only untracked content is caches and OS litter reports clean, even without a .gitignore', { skip: SKIP }, async () => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'caches-'));
  fs.writeFileSync(path.join(dir, 'a.py'), 'x = 1\n');
  assert.strictEqual((await MG.moduleGitInit(dir, 'start')).ok, true);
  // The catalog install rebuilds the tree from published files: no .gitignore.
  execFileSync('git', ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, 'rm', '-q', '--cached', '.gitignore']);
  execFileSync('git', ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'install']);
  fs.rmSync(path.join(dir, '.gitignore'));
  fs.writeFileSync(path.join(dir, '.git', 'info', 'exclude'), '# git default\n'); // a repo created before the fix
  fs.mkdirSync(path.join(dir, 'server', 'py', '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server', 'py', '__pycache__', 'a.cpython-314.pyc'), 'x');
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'i.js'), 'x');
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
  assert.strictEqual((await MG.moduleGitStatus(dir)).dirty, false);
  assert.deepStrictEqual(await MG.moduleGitUnsavedPaths(dir), { ok: true, paths: [] });
  assert.ok(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8').startsWith('# git default\n'), 'existing lines kept');

  // User files are never hidden: downloads/ and a local .env still block a swap.
  fs.mkdirSync(path.join(dir, 'downloads'));
  fs.writeFileSync(path.join(dir, 'downloads', 'f.csv'), 'x');
  fs.writeFileSync(path.join(dir, '.env'), 'X=1\n');
  assert.strictEqual((await MG.moduleGitStatus(dir)).dirty, true);
  assert.deepStrictEqual((await MG.moduleGitUnsavedPaths(dir)).paths.sort(), ['.env', 'downloads/f.csv']);
});

test('ensureModuleGitExclude is idempotent and the path test matches its list', { skip: SKIP }, async () => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'excl-'));
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n');
  assert.strictEqual((await MG.moduleGitInit(dir, 'start')).ok, true);
  const file = path.join(dir, '.git', 'info', 'exclude');
  const once = fs.readFileSync(file, 'utf8');
  assert.strictEqual(MG.ensureModuleGitExclude(dir), true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), once);
  assert.ok(!MG.MODULE_DROP_SAFE_EXCLUDES.some((l) => l.startsWith('downloads')), 'downloads/ holds user files');
  for (const p of ['x/__pycache__/a.pyc', 'b.pyo', 'node_modules/y', '.pytest_cache/v', '.DS_Store', 'd/Thumbs.db']) {
    assert.strictEqual(_isRegenerableModulePath(p), true, p);
  }
  for (const p of ['downloads/f.csv', '.env', 'DS_Store.js']) assert.strictEqual(_isRegenerableModulePath(p), false, p);
});

test('boot sweep removes install staging dirs of dead processes only', () => {
  const { _sweepStaleModuleInstallDirs } = require('../server.js');
  const dead = '.tmp-install-mini-x-424242-1791579062927';
  const live = '.tmp-install-mini-x-' + process.pid + '-1791579062928';
  const other = '.tmp-install-mini-x-777-1791579062929';
  for (const n of [dead, live, other]) fs.mkdirSync(path.join(SCRATCH, n, 'client'), { recursive: true });
  fs.mkdirSync(path.join(SCRATCH, 'mini-x.bak-1'), { recursive: true });
  const removed = _sweepStaleModuleInstallDirs((pid) => pid === 777);
  assert.deepStrictEqual(removed, [dead]);
  for (const n of [live, other, 'mini-x.bak-1']) assert.ok(fs.existsSync(path.join(SCRATCH, n)), n);
});
