// tests/test_worktree.mjs
// scripts/_worktree.js (pure decisions) and scripts/worktree.js (the CLI) on
// throwaway git repositories. No network. The never-list - .encryption-key and
// data-sub-repositories/ - is asserted on disk, not only documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const W = require('../scripts/_worktree.js');
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'worktree.js');

// A test run from a git hook inherits GIT_DIR / GIT_INDEX_FILE, which would
// point every git call below at the real repository. Strip them.
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: CLEAN_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: CLEAN_ENV });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* text mode */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function makeRepo({ coreDev = true, env = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, '.gitignore'),
    '.env\n.encryption-key\n/.core-dev\nnode_modules/\ndata/\nuser-data/\ndata-sub-repositories/\n/modules/\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  if (env) fs.writeFileSync(path.join(dir, '.env'), 'FOO=1\nPORT=3001\nBAR=2\n');
  if (coreDev) fs.writeFileSync(path.join(dir, '.core-dev'), 'yes\n');
  fs.writeFileSync(path.join(dir, '.encryption-key'), 'data-tier-0=secret\n');
  fs.mkdirSync(path.join(dir, 'data-sub-repositories', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data-sub-repositories', 'x', 'team.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules', 'y'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'y', 'index.js'), '');
  return dir;
}

// --- recommendWorktree -------------------------------------------------------

test('recommendWorktree: a plan inside one module is module-only', () => {
  const r = W.recommendWorktree({
    planPaths: ['modules/abc/module.json', 'modules/abc/client/index.js'],
    porcelain: ' M server.js\n',
    forced: true,
  });
  assert.equal(r.recommendation, 'module-only');
  assert.ok(r.reasons.length > 0);
});

test('recommendWorktree: a clean tree and one layer stays on the branch', () => {
  const r = W.recommendWorktree({
    planPaths: ['js/a.js', 'tests/test_a.mjs'],
    porcelain: ' M js/a.js\n?? scratch.txt\n M plans/2026-10-04-x.md\n M user-data/n.md\n',
  });
  assert.equal(r.recommendation, 'branch');
  assert.deepEqual(r.foreignChanges, []);
});

test('recommendWorktree: tracked changes outside the plan mean another session -> worktree', () => {
  const r = W.recommendWorktree({ planPaths: ['js/a.js'], porcelain: ' M index.html\n M js/a.js\n' });
  assert.equal(r.recommendation, 'worktree');
  assert.deepEqual(r.foreignChanges, ['index.html']);
});

test('recommendWorktree: a split plan with a file in two layers -> worktree', () => {
  const paths = ['server.js', 'js/a.js', 'tests/test_api_a.mjs'];
  const layers = W.classifyPlanLayers(paths);
  assert.equal(layers.split, true);
  const r = W.recommendWorktree({ planPaths: paths, porcelain: '', splitLayers: [layers.backend, layers.frontend] });
  assert.equal(r.recommendation, 'worktree');
  assert.deepEqual(r.overlapping, ['tests/test_api_a.mjs']);
});

test('recommendWorktree: the person chose it -> worktree', () => {
  const r = W.recommendWorktree({ planPaths: ['js/a.js'], porcelain: '', forced: true });
  assert.equal(r.recommendation, 'worktree');
});

// --- pickPort / rewriteEnvPort / removeVerdict -------------------------------

test('pickPort: skips taken ports and gives up past the range', () => {
  assert.equal(W.pickPort({ taken: [3101, 3102] }), 3103);
  assert.equal(W.pickPort({ taken: [3001] }), 3101);
  const all = [];
  for (let p = W.PORT_MIN; p <= W.PORT_MAX; p++) all.push(p);
  assert.equal(W.pickPort({ taken: all }), null);
});

test('rewriteEnvPort: replaces PORT= and keeps every other byte', () => {
  assert.equal(W.rewriteEnvPort('A=1\nPORT=3001\n# c\nB=2\n', 3105), 'A=1\nPORT=3105\n# c\nB=2\n');
  assert.equal(W.rewriteEnvPort('A=1\r\nPORT=3001\r\n', 3105), 'A=1\r\nPORT=3105\r\n');
  assert.equal(W.rewriteEnvPort('A=1', 3105), 'A=1\nPORT=3105\n');
  assert.equal(W.rewriteEnvPort('', 3105), 'PORT=3105\n');
  assert.equal(W.readEnvPort(W.rewriteEnvPort('X=PORT=1\n', 3107)), 3107);
});

test('removeVerdict: four refusals and one consent', () => {
  const dirty = W.removeVerdict({ porcelain: ' M a.txt', merged: true });
  assert.equal(dirty.ok, false);
  assert.deepEqual(dirty.reasons.map((r) => r.code), ['dirty']);

  const unmerged = W.removeVerdict({ porcelain: '', merged: false });
  assert.deepEqual(unmerged.reasons.map((r) => r.code), ['unmerged']);

  const alive = W.removeVerdict({ porcelain: '', merged: true, serverAlive: true, slug: 'x' });
  assert.deepEqual(alive.reasons.map((r) => r.code), ['server-alive']);
  assert.match(alive.reasons[0].fix, /worktree\.js stop x/);

  const all = W.removeVerdict({ porcelain: '?? b.txt', merged: false, serverAlive: true });
  assert.equal(all.reasons.length, 3);

  assert.equal(W.removeVerdict({ porcelain: '', merged: false, keepBranch: true }).ok, true);
  assert.equal(W.removeVerdict({ porcelain: '', merged: true }).ok, true);
});

test('removeVerdict: --keep-branch saves nothing on a detached HEAD; local data needs consent', () => {
  const detached = W.removeVerdict({ porcelain: '', merged: false, keepBranch: true, hasBranch: false });
  assert.equal(detached.ok, false);
  assert.deepEqual(detached.reasons.map((r) => r.code), ['unmerged']);
  assert.equal(W.removeVerdict({ porcelain: '', merged: true, keepBranch: true, hasBranch: false }).ok, true);

  const local = W.removeVerdict({ porcelain: '', merged: true, localData: ['user-data/notatka.md'], slug: 'x' });
  assert.deepEqual(local.reasons.map((r) => r.code), ['local-data']);
  assert.match(local.reasons[0].message, /user-data\/notatka\.md/);
  assert.match(local.reasons[0].fix, /--discard-local-data/);
  assert.equal(W.removeVerdict({ porcelain: '', merged: true, localData: ['user-data/n.md'], discardLocalData: true }).ok, true);
  // The verification server's own log and PID files are not somebody's work.
  assert.deepEqual(W.localDataLeftovers(['data/worktree-server.log', 'data/worktree-server.pid', 'data/server-3101.pid', 'data/x.json']), ['data/x.json']);
});

test('pidOwnership: a PID file pointing at another process is stale, an unreadable line is trusted', () => {
  assert.equal(W.pidOwnership('/usr/local/bin/node /r/.claude/worktrees/a/server.js 3101', '/r/.claude/worktrees/a'), 'ours');
  assert.equal(W.pidOwnership('/usr/local/bin/node /r/server.js 3001', '/r/.claude/worktrees/a'), 'foreign');
  // Started by hand inside the worktree: no directory on the line, trust the PID file.
  assert.equal(W.pidOwnership('node server.js', '/r/.claude/worktrees/a'), 'unknown');
  assert.equal(W.pidOwnership('/Applications/Safari.app/Contents/MacOS/Safari', '/r/.claude/worktrees/a'), 'foreign');
  assert.equal(W.pidOwnership('', '/r/.claude/worktrees/a'), 'unknown');
  assert.equal(W.pidOwnership('"C:\\R\\.claude\\worktrees\\a\\server.js" 3101', 'C:\\r\\.claude\\worktrees\\a'), 'ours');
});

test('stripChildEnv: no ENV_SCHEMA secret and nothing credential-like reaches the test-mode child', () => {
  const src = "const ENV_SCHEMA = [\n  { group: 'g', keys: [\n    { key: 'COCKPIT_APP_TOKEN', type: 'token', kind: 'secret' },\n    { key: 'AMPLITUDE_PROJECT_X', type: 'text', kind: 'secret' },\n    { key: 'JIRA_BASE_URL', type: 'text', kind: 'config' },\n  ] },\n];\nconst ENV_SCHEMA_KEYS = 1;\n";
  const keys = W.secretEnvKeys(src);
  assert.deepEqual(keys, ['COCKPIT_APP_TOKEN', 'AMPLITUDE_PROJECT_X']);
  const env = W.stripChildEnv({
    PATH: '/bin', HOME: '/h', JIRA_BASE_URL: 'u', AMPLITUDE_PROJECT_X: 's', COCKPIT_APP_TOKEN: 's',
    MY_GITLAB_TOKEN: 's', SOME_SECRET: 's', DB_PASSWORD: 's', GEMINI_API_KEY: 's', BW_SESSION: 's',
    DATA_ENCRYPTION_KEY: 's', PORT: '3001', COCKPIT_EMBEDDED: '1',
  }, keys);
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'JIRA_BASE_URL', 'PATH']);
  // The real server.js: every secret key of its schema is found.
  const real = fs.readFileSync(path.join(path.dirname(SCRIPT), '..', 'server.js'), 'utf8');
  const realKeys = W.secretEnvKeys(real);
  assert.ok(realKeys.includes('COCKPIT_APP_TOKEN') && realKeys.length >= 10, String(realKeys.length));
});

// --- CLI on a throwaway repository -------------------------------------------

test('create/prepare/remove: own port, links, copies, never-list, safe removal', () => {
  const repo = makeRepo();
  try {
    const c = cli(repo, 'create', 'proba', '--json');
    assert.equal(c.code, 0, c.stderr + c.stdout);
    const wt = path.join(repo, '.claude', 'worktrees', 'proba');
    assert.equal(c.json.path, wt);
    assert.equal(c.json.branch, 'wt/proba');
    assert.ok(c.json.port >= 3101 && c.json.port <= 3199, String(c.json.port));
    assert.match(git(repo, 'branch', '--list', 'wt/proba'), /wt\/proba/);

    // .env copied with its own port, the rest untouched.
    const env = fs.readFileSync(path.join(wt, '.env'), 'utf8');
    assert.equal(env, `FOO=1\nPORT=${c.json.port}\nBAR=2\n`);
    // .core-dev copied, node_modules is a symlink into the main tree.
    assert.ok(fs.existsSync(path.join(wt, '.core-dev')));
    assert.ok(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(wt, 'node_modules', 'y', 'index.js')));
    // The never-list: no key, no team data - only an empty directory of its own.
    assert.equal(fs.existsSync(path.join(wt, '.encryption-key')), false);
    assert.equal(fs.existsSync(path.join(wt, 'data-sub-repositories', 'x')), false);
    assert.ok(fs.lstatSync(path.join(wt, 'data-sub-repositories')).isDirectory());
    assert.equal(fs.lstatSync(path.join(wt, 'data-sub-repositories')).isSymbolicLink(), false);

    // Neither tree shows the worktree or its symlink as untracked.
    assert.equal(git(repo, 'status', '--porcelain'), '');
    assert.equal(git(wt, 'status', '--porcelain'), '');

    // A second prepare keeps the port and overwrites nothing.
    const p2 = cli(repo, 'prepare', wt, '--json');
    assert.equal(p2.code, 0, p2.stderr);
    assert.equal(p2.json.port, c.json.port);

    // status sees it; no server is running.
    const st = cli(repo, 'status', 'proba', '--json');
    assert.equal(st.code, 0, st.stderr);
    assert.equal(st.json.serverAlive, false);
    assert.equal(st.json.nodeModulesOk, true);
    assert.equal(st.json.serverUrl, `http://localhost:${c.json.port}`);

    // Refuses with uncommitted work.
    fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
    const r1 = cli(repo, 'remove', 'proba', '--json');
    assert.equal(r1.code, 1);
    assert.ok(r1.json.reasons.some((r) => r.code === 'dirty'));

    // Refuses with an unmerged branch.
    git(wt, 'add', 'b.txt');
    git(wt, 'commit', '-q', '-m', 'b');
    const r2 = cli(repo, 'remove', 'proba', '--json');
    assert.equal(r2.code, 1);
    assert.deepEqual(r2.json.reasons.map((r) => r.code), ['unmerged']);

    // Merged -> removed, branch deleted with -d, the main node_modules intact.
    git(repo, 'merge', '-q', '--ff-only', 'wt/proba');
    const r3 = cli(repo, 'remove', 'proba', '--json');
    assert.equal(r3.code, 0, r3.stderr + r3.stdout);
    assert.equal(fs.existsSync(wt), false);
    assert.equal(git(repo, 'branch', '--list', 'wt/proba'), '');
    assert.ok(fs.existsSync(path.join(repo, 'node_modules', 'y', 'index.js')));
    assert.ok(fs.existsSync(path.join(repo, 'data-sub-repositories', 'x', 'team.json')));
    assert.ok(fs.existsSync(path.join(repo, '.encryption-key')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('create: no .core-dev in the main tree means none in the worktree; refuses a taken slug', () => {
  const repo = makeRepo({ coreDev: false, env: false });
  try {
    const c = cli(repo, 'create', 'bez-zgody', '--json');
    assert.equal(c.code, 0, c.stderr + c.stdout);
    const wt = c.json.path;
    assert.equal(fs.existsSync(path.join(wt, '.core-dev')), false);
    // No .env in the main tree: the worktree still gets its own PORT= line.
    assert.equal(fs.readFileSync(path.join(wt, '.env'), 'utf8'), `PORT=${c.json.port}\n`);
    assert.equal(fs.existsSync(path.join(wt, '.encryption-key')), false);

    const again = cli(repo, 'create', 'bez-zgody', '--json');
    assert.equal(again.code, 1);
    assert.equal(again.json.error, 'exists');

    const bad = cli(repo, 'create', 'Zly_Slug', '--json');
    assert.equal(bad.code, 1);
    assert.equal(bad.json.error, 'bad-slug');

    // --from is a revision, never an option smuggled into git.
    const opt = cli(repo, 'create', 'inny', '--from=--orphan', '--json');
    assert.equal(opt.code, 2);
    assert.match(opt.stderr, /--from/);
    assert.equal(fs.existsSync(path.join(repo, '.claude', 'worktrees', 'inny')), false);

    // A stale PID file (another live process) neither blocks nor gets signalled.
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(path.join(wt, 'data', 'worktree-server.pid'), String(other.pid));
      const st = cli(repo, 'status', 'bez-zgody', '--json');
      assert.equal(st.json.serverAlive, false);
      const stop = cli(repo, 'stop', 'bez-zgody', '--json');
      assert.equal(stop.code, 0, stop.stderr);
      assert.equal(stop.json.stalePid, other.pid);
      assert.equal(fs.existsSync(path.join(wt, 'data', 'worktree-server.pid')), false);
      assert.equal(other.exitCode, null);
      assert.equal(other.signalCode, null);
    } finally {
      other.kill();
    }

    // Files in the worktree's own user-data/ block removal until discarded on purpose.
    fs.writeFileSync(path.join(wt, 'user-data', 'notatka.md'), 'x');
    const keep = cli(repo, 'remove', 'bez-zgody', '--json');
    assert.equal(keep.code, 1);
    assert.deepEqual(keep.json.reasons.map((r) => r.code), ['local-data']);
    assert.ok(fs.existsSync(path.join(wt, 'user-data', 'notatka.md')));

    // Clean and merged (nothing committed) -> removable once the data is let go.
    const r = cli(repo, 'remove', 'bez-zgody', '--discard-local-data', '--json');
    assert.equal(r.code, 0, r.stderr + r.stdout);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
