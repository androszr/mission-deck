'use strict';
// tests/test_api_modules_git.js
// API tests for the module-local git surface: GET /api/modules/installed's
// `git` field, POST /api/modules/git-init, POST /api/modules/git-commit, the
// dirty guard on import overwrite and on remove, and that an exported zip
// never carries a module's .git. Plan: docs/architecture/modules.md.
//
// Same harness as tests/test_api_modules_manage.js: everything happens inside
// an mkdtempSync() scratch MODULES_DIR, copied from
// tests/fixtures/modules/fixture-mod, never the committed fixture itself.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');
const { writeZip, readZip } = require('../scripts/zip');

const PORT = 3520;
const FIXTURE_SRC = path.resolve(__dirname, 'fixtures/modules/fixture-mod');

let GIT_AVAILABLE = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { GIT_AVAILABLE = false; }

let child;
let workDir;
let modulesDir;
let dataDir;
let registryFile;
let originFile;

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function moduleDir(id) { return path.join(modulesDir, id); }

function gitLog(id) {
  const dir = moduleDir(id);
  return execFileSync('git', ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, 'log', '--oneline'], { encoding: 'utf8' });
}

function buildZip(entries) {
  return writeZip(entries.map((e) => ({ name: e.name, data: Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data) })));
}

function fixtureZip(id) {
  const manifest = {
    schemaVersion: 1, id, name: 'Fixture Module', version: '0.2.0',
    sidebar: { label: 'Fixture', kind: 'item' },
    views: [{ id: id + '-main', label: 'Glowna' }],
  };
  return buildZip([
    { name: id + '/module.json', data: JSON.stringify(manifest) },
    { name: id + '/client/index.js', data: 'export const views = {};' },
  ]);
}

test.before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-mod-git-'));
  modulesDir = path.join(workDir, 'modules');
  dataDir = path.join(workDir, 'data-modules');
  registryFile = path.join(workDir, 'modules-registry.json');
  // The successful import below writes an origin record; without this the
  // suite would read-modify-write the developer's real data/modules-origin.json.
  originFile = path.join(workDir, 'modules-origin.json');
  fs.mkdirSync(modulesDir, { recursive: true });
  copyDirSync(FIXTURE_SRC, path.join(modulesDir, 'fixture-mod'));

  child = startServer(PORT, {
    MODULES_DIR: modulesDir,
    MODULES_DATA_DIR: dataDir,
    MODULES_REGISTRY_FILE: registryFile,
    MODULES_ORIGIN_FILE: originFile,
  });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(workDir, { recursive: true, force: true });
});

// -- (1) GET /api/modules/installed carries git + gitAvailable --------------

test('GET /api/modules/installed reports git.present:false for a module with no .git yet', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/installed');
  assert.strictEqual(status, 200);
  assert.strictEqual(typeof body.gitAvailable, 'boolean');
  const item = body.installed.find((m) => m.id === 'fixture-mod');
  assert.ok(item, 'fixture-mod missing from installed');
  assert.deepStrictEqual(item.git, { present: false });
});

// -- (2) POST /api/modules/git-init ------------------------------------------

test('POST /api/modules/git-init creates .git, .gitignore and a clean status', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const { status, body } = await postJson(PORT, '/api/modules/git-init', { id: 'fixture-mod' });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.ok, true);
  assert.ok(fs.existsSync(path.join(moduleDir('fixture-mod'), '.git')));
  assert.ok(fs.existsSync(path.join(moduleDir('fixture-mod'), '.gitignore')));

  const installed = await getJson(PORT, '/api/modules/installed');
  const item = installed.body.installed.find((m) => m.id === 'fixture-mod');
  assert.strictEqual(item.git.present, true);
  assert.strictEqual(item.git.dirty, false);
});

// -- (3) git-init again -------------------------------------------------------

test('POST /api/modules/git-init a second time refuses with 409', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const { status, body } = await postJson(PORT, '/api/modules/git-init', { id: 'fixture-mod' });
  assert.strictEqual(status, 409);
  assert.strictEqual(body.error, 'already-present');
});

// -- (4) bad ids --------------------------------------------------------------

test('POST /api/modules/git-init with an unknown id answers 404', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/git-init', { id: 'nope' });
  assert.strictEqual(status, 404);
  assert.strictEqual(body.error, 'not-found');
});

test('POST /api/modules/git-init with a path-escape id answers 400', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/git-init', { id: '../x' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'invalid-id');
});

// -- (5) git-commit validation -------------------------------------------------

test('POST /api/modules/git-commit with an empty message answers 400 bad-message', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const { status, body } = await postJson(PORT, '/api/modules/git-commit', { id: 'fixture-mod', message: '' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'bad-message');
});

test('POST /api/modules/git-commit on a clean tree answers 409 nothing-to-commit', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const { status, body } = await postJson(PORT, '/api/modules/git-commit', { id: 'fixture-mod', message: 'no changes here' });
  assert.strictEqual(status, 409);
  assert.strictEqual(body.error, 'nothing-to-commit');
});

// -- (6) git-commit on a dirty tree -------------------------------------------

test('POST /api/modules/git-commit after a write answers 200 with sha7 and leaves the tree clean', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  fs.writeFileSync(path.join(moduleDir('fixture-mod'), 'NOTES.md'), 'a note');
  const { status, body } = await postJson(PORT, '/api/modules/git-commit', { id: 'fixture-mod', message: 'dodaje notatke' });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.ok(body.ok);
  assert.ok(typeof body.sha7 === 'string' && body.sha7.length > 0);
  assert.strictEqual(body.git.dirty, false);
});

// -- (6b) GET /api/modules/git-log: the "Historia" list -----------------------

test('GET /api/modules/git-log lists the commits newest first, the first one being the card\'s lastCommit', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const { status, body } = await getJson(PORT, '/api/modules/git-log?id=fixture-mod');
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.present, true);
  assert.ok(Array.isArray(body.commits));
  assert.deepStrictEqual(body.commits.map((c) => c.subject), ['dodaje notatke', 'initial state']);
  for (const c of body.commits) {
    assert.match(c.sha7, /^[0-9a-f]{7,}$/);
    assert.ok(!Number.isNaN(new Date(c.date).getTime()));
  }
  const installed = await getJson(PORT, '/api/modules/installed');
  const item = installed.body.installed.find((m) => m.id === 'fixture-mod');
  assert.strictEqual(item.git.lastCommit.sha7, body.commits[0].sha7);

  const limited = await getJson(PORT, '/api/modules/git-log?id=fixture-mod&limit=1');
  assert.deepStrictEqual(limited.body.commits.map((c) => c.subject), ['dodaje notatke']);
});

test('GET /api/modules/git-log for a module without .git answers 200 present:false, unknown id 404, hostile id 400', async () => {
  const noGitId = 'fixture-nogit';
  copyDirSync(FIXTURE_SRC, moduleDir(noGitId));
  const manifestPath = path.join(moduleDir(noGitId), 'module.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.id = noGitId;
  if (Array.isArray(manifest.views)) manifest.views = manifest.views.map((v) => ({ ...v, id: noGitId + '-' + String(v.id).split('-').pop() }));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  try {
    const none = await getJson(PORT, '/api/modules/git-log?id=' + noGitId);
    assert.strictEqual(none.status, 200, JSON.stringify(none.body));
    assert.deepStrictEqual(none.body, { ok: true, present: false, commits: [] });
  } finally {
    fs.rmSync(moduleDir(noGitId), { recursive: true, force: true });
  }

  const missing = await getJson(PORT, '/api/modules/git-log?id=no-such-id');
  assert.strictEqual(missing.status, 404);
  assert.strictEqual(missing.body.error, 'not-found');

  for (const bad of ['..%2F..%2Fetc', 'Fixture-Mod', 'settings', '']) {
    const r = await getJson(PORT, '/api/modules/git-log?id=' + bad);
    assert.strictEqual(r.status, 400, 'id ' + JSON.stringify(bad));
    assert.strictEqual(r.body.error, 'invalid-id');
  }
});

// -- (7) import overwrite refuses on a dirty repo, then keeps history --------

test('POST /api/modules/import with overwrite refuses 409 module-dirty on a dirty repo, then keeps history once clean', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  fs.writeFileSync(path.join(moduleDir('fixture-mod'), 'DIRTY.md'), 'uncommitted');

  const dirtyAttempt = await postJson(PORT, '/api/modules/import', {
    filename: 'fixture-mod.zip',
    dataBase64: fixtureZip('fixture-mod').toString('base64'),
    overwrite: true,
  });
  assert.strictEqual(dirtyAttempt.status, 409);
  assert.strictEqual(dirtyAttempt.body.error, 'module-dirty');

  const commit = await postJson(PORT, '/api/modules/git-commit', { id: 'fixture-mod', message: 'przed importem' });
  assert.strictEqual(commit.status, 200);

  const before = gitLog('fixture-mod').trim().split('\n').length;

  const second = await postJson(PORT, '/api/modules/import', {
    filename: 'fixture-mod.zip',
    dataBase64: fixtureZip('fixture-mod').toString('base64'),
    overwrite: true,
  });
  assert.strictEqual(second.status, 200, JSON.stringify(second.body));
  assert.strictEqual(second.body.overwritten, true);
  assert.deepStrictEqual(second.body.git, { kept: true, committed: true });

  const log = gitLog('fixture-mod');
  assert.match(log, /import from zip file/);
  const after = log.trim().split('\n').length;
  assert.ok(after > before, `expected a new commit on top of history (before=${before}, after=${after})`);
  assert.ok(after >= 3, `expected at least 3 commits total, got ${after}`);
});

// -- (8) export never carries .git -------------------------------------------

test('GET /api/modules/export never includes a .git entry', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/modules/export?id=fixture-mod`, { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  const entries = readZip(buf, { maxEntries: 1000, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 });
  assert.ok(!entries.some((e) => e.name.includes('/.git/')), 'export leaked a .git entry');
  assert.ok(entries.some((e) => e.name === 'fixture-mod/module.json'));
});

// -- (8b) a stray <id>.bak-* holding .git refuses import overwrite ----------
// The trace a crashed swap leaves (rename-back-.git failed between "new tree
// is live" and "backup removed") must never be silently swept aside: import
// refuses with 409 stale-backup and touches neither the stray backup nor the
// live module. docs/architecture/modules.md gap fix.

test('POST /api/modules/import refuses 409 stale-backup when a stray <id>.bak-* with .git already exists, and deletes nothing', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  const staleBak = moduleDir('fixture-mod') + '.bak-1700000000000';
  fs.mkdirSync(path.join(staleBak, '.git'), { recursive: true });
  fs.writeFileSync(path.join(staleBak, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const liveTreeBefore = fs.readdirSync(moduleDir('fixture-mod')).sort();

  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'fixture-mod.zip',
    dataBase64: fixtureZip('fixture-mod').toString('base64'),
    overwrite: true,
  });

  assert.strictEqual(status, 409, JSON.stringify(body));
  assert.strictEqual(body.error, 'stale-backup');
  assert.ok(typeof body.message === 'string' && body.message.includes(path.basename(staleBak)));
  // Nothing deleted: the stray backup survives, and the live module tree is
  // exactly what it was before the request.
  assert.ok(fs.existsSync(path.join(staleBak, '.git')));
  assert.deepStrictEqual(fs.readdirSync(moduleDir('fixture-mod')).sort(), liveTreeBefore);

  fs.rmSync(staleBak, { recursive: true, force: true });
});

// -- (9) remove refuses on a dirty repo, force:true still removes -----------

test('POST /api/modules/remove refuses 409 module-dirty, then removes with force:true', { skip: !GIT_AVAILABLE && 'git not on PATH' }, async () => {
  fs.writeFileSync(path.join(moduleDir('fixture-mod'), 'ONE-MORE.md'), 'dirty again');

  const refused = await postJson(PORT, '/api/modules/remove', { id: 'fixture-mod', removeData: false });
  assert.strictEqual(refused.status, 409);
  assert.strictEqual(refused.body.error, 'module-dirty');
  assert.ok(fs.existsSync(moduleDir('fixture-mod')));

  const forced = await postJson(PORT, '/api/modules/remove', { id: 'fixture-mod', removeData: false, force: true });
  assert.strictEqual(forced.status, 200, JSON.stringify(forced.body));
  assert.strictEqual(forced.body.removedRepo, true);
  assert.ok(!fs.existsSync(moduleDir('fixture-mod')));
});
