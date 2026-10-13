// tests/test_proto_shell_sync.mjs
// Syncing the prototype build shell with origin before a publish
// (_protoShellSyncWithOrigin in server.js). Regression of 2026-10-08: a local
// change in src/prototypes/<slug>/ plus a publish of the same prototype from
// another machine -> `pull --rebase --autostash` came back with a conflict and
// exit code 0, UU files stayed in the shell and blocked every later publish.
// Real, throwaway git repositories in a temp directory; no network.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');

const GIT_CFG = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
function git(cwd, args) {
  return cp.execFileSync('git', ['-C', cwd, ...GIT_CFG, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function gitAsync(cwd) {
  return (args) => new Promise((resolve) => {
    cp.execFile('git', ['-C', cwd, ...GIT_CFG, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
function put(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// origin (bare), this machine's shell and a second machine that publishes.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-shell-sync-'));
  const origin = path.join(root, 'origin.git');
  const shell = path.join(root, 'shell');
  const other = path.join(root, 'other');
  cp.execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  cp.execFileSync('git', ['clone', '-q', origin, shell], { stdio: 'ignore' });
  git(shell, ['checkout', '-q', '-b', 'main']);
  put(path.join(shell, 'src/prototypes/form/index.tsx'), 'v1\n');
  put(path.join(shell, 'src/prototypes/cele/index.tsx'), 'c1\n');
  put(path.join(shell, 'src/prototypes/registry.ts'), 'r1\n');
  git(shell, ['add', '-A']);
  git(shell, ['commit', '-q', '-m', 'init']);
  git(shell, ['push', '-q', '-u', 'origin', 'main']);
  cp.execFileSync('git', ['clone', '-q', '-b', 'main', origin, other], { stdio: 'ignore' });
  const publishFromOther = (rel, content) => {
    put(path.join(other, rel), content);
    git(other, ['commit', '-q', '-am', 'deploy']);
    git(other, ['push', '-q', 'origin', 'main']);
  };
  return { shell, publishFromOther, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const read = (fx, rel) => fs.readFileSync(path.join(fx.shell, rel), 'utf8');
const unmerged = (fx) => git(fx.shell, ['diff', '--name-only', '--diff-filter=U']).trim();

test('the old pull --autostash leaves a conflict with exit code 0 (regression proof)', async () => {
  const fx = fixture();
  try {
    fx.publishFromOther('src/prototypes/form/index.tsx', 'remote\n');
    put(path.join(fx.shell, 'src/prototypes/form/index.tsx'), 'local preview\n');
    const r = await gitAsync(fx.shell)(['pull', '--rebase', '--autostash']);
    assert.strictEqual(r.code, 0, 'git succeeds despite the conflict - which is why the exit code is not the gate');
    assert.strictEqual(unmerged(fx), 'src/prototypes/form/index.tsx');
  } finally { fx.cleanup(); }
});

test('a local change to a file from origin goes to a named stash, the pull passes without a conflict', async () => {
  const fx = fixture();
  try {
    fx.publishFromOther('src/prototypes/form/index.tsx', 'remote\n');
    put(path.join(fx.shell, 'src/prototypes/form/index.tsx'), 'local preview\n');
    // a change disjoint from origin stays in the tree
    put(path.join(fx.shell, 'src/prototypes/cele/index.tsx'), 'c-local\n');
    const lines = [];
    const r = await srv._protoShellSyncWithOrigin({ git: gitAsync(fx.shell), log: (t) => lines.push(t), now: () => new Date('2026-10-08T20:00:00Z') });
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(r.parked, ['src/prototypes/form/index.tsx']);
    assert.strictEqual(unmerged(fx), '');
    assert.strictEqual(read(fx, 'src/prototypes/form/index.tsx'), 'remote\n');
    assert.strictEqual(read(fx, 'src/prototypes/cele/index.tsx'), 'c-local\n', 'a disjoint local change survives the pull');
    const stash = git(fx.shell, ['stash', 'list']);
    assert.match(stash, /cockpit-deploy pre-pull 2026-10-08T20:00:00\.000Z/);
    assert.strictEqual(git(fx.shell, ['show', 'stash@{0}:src/prototypes/form/index.tsx']), 'local preview\n', 'nothing is lost');
    assert.ok(lines.some((l) => l.includes('src/prototypes/form/index.tsx')));
  } finally { fx.cleanup(); }
});

test('a shell blocked by an old conflict unblocks itself', async () => {
  const fx = fixture();
  try {
    fx.publishFromOther('src/prototypes/form/index.tsx', 'remote\n');
    put(path.join(fx.shell, 'src/prototypes/form/index.tsx'), 'local preview\n');
    await gitAsync(fx.shell)(['pull', '--rebase', '--autostash']);
    assert.ok(unmerged(fx), 'starting state: a UU file');
    // somebody publishes another prototype - the old code failed here on "unmerged files"
    fx.publishFromOther('src/prototypes/cele/index.tsx', 'c2\n');
    const r = await srv._protoShellSyncWithOrigin({ git: gitAsync(fx.shell) });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(unmerged(fx), '');
    assert.strictEqual(read(fx, 'src/prototypes/cele/index.tsx'), 'c2\n');
    assert.strictEqual(read(fx, 'src/prototypes/form/index.tsx'), 'remote\n');
    assert.match(git(fx.shell, ['show', 'stash@{0}:src/prototypes/form/index.tsx']), /<<<<<<<|local preview/, 'the conflict content is parked, not deleted');
  } finally { fx.cleanup(); }
});

test('a clean shell: a plain fast-forward, no stash entry', async () => {
  const fx = fixture();
  try {
    fx.publishFromOther('src/prototypes/registry.ts', 'r2\n');
    const r = await srv._protoShellSyncWithOrigin({ git: gitAsync(fx.shell) });
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(r.parked, []);
    assert.strictEqual(r.stashMessage, null);
    assert.strictEqual(read(fx, 'src/prototypes/registry.ts'), 'r2\n');
    assert.strictEqual(git(fx.shell, ['stash', 'list']).trim(), '');
  } finally { fx.cleanup(); }
});

test('an interrupted rebase from a previous run is aborted, it does not block', async () => {
  const fx = fixture();
  try {
    // a local commit colliding with origin -> rebase stopped halfway
    put(path.join(fx.shell, 'src/prototypes/form/index.tsx'), 'local commit\n');
    git(fx.shell, ['commit', '-q', '-am', 'local']);
    fx.publishFromOther('src/prototypes/form/index.tsx', 'remote\n');
    await gitAsync(fx.shell)(['pull', '--rebase']);
    const gitDir = git(fx.shell, ['rev-parse', '--absolute-git-dir']).trim();
    assert.ok(fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply')), 'starting state: a rebase in progress');
    const r = await srv._protoShellSyncWithOrigin({ git: gitAsync(fx.shell) });
    // the local commit still collides - a refusal with a clear code, but no rebase in progress
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'pull-failed');
    assert.ok(!fs.existsSync(path.join(gitDir, 'rebase-merge')) && !fs.existsSync(path.join(gitDir, 'rebase-apply')), 'no rebase in progress is left after the refusal');
    assert.strictEqual(unmerged(fx), '');
  } finally { fx.cleanup(); }
});

test('a rename in origin: a local change of the OLD name goes to the stash too', async () => {
  const fx = fixture();
  try {
    // the second machine moves the file and publishes
    const otherDir = path.join(path.dirname(fx.shell), 'other');
    git(otherDir, ['mv', 'src/prototypes/form/index.tsx', 'src/prototypes/form/main.tsx']);
    git(otherDir, ['commit', '-q', '-m', 'rename']);
    git(otherDir, ['push', '-q', 'origin', 'main']);
    put(path.join(fx.shell, 'src/prototypes/form/index.tsx'), 'local preview\n');
    const r = await srv._protoShellSyncWithOrigin({ git: gitAsync(fx.shell) });
    assert.strictEqual(r.ok, true, r.message);
    assert.ok(r.parked.includes('src/prototypes/form/index.tsx'), JSON.stringify(r.parked));
    assert.strictEqual(unmerged(fx), '');
    assert.strictEqual(read(fx, 'src/prototypes/form/main.tsx'), 'v1\n');
  } finally { fx.cleanup(); }
});

test('an untracked file on a path added in origin does not break the pull', async () => {
  const fx = fixture();
  try {
    const otherDir = path.join(path.dirname(fx.shell), 'other');
    put(path.join(otherDir, 'src/prototypes/nowy/index.tsx'), 'remote new\n');
    git(otherDir, ['add', '-A']);
    git(otherDir, ['commit', '-q', '-m', 'add']);
    git(otherDir, ['push', '-q', 'origin', 'main']);
    put(path.join(fx.shell, 'src/prototypes/nowy/index.tsx'), 'local untracked preview\n');
    const r = await srv._protoShellSyncWithOrigin({ git: gitAsync(fx.shell) });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(read(fx, 'src/prototypes/nowy/index.tsx'), 'remote new\n');
    assert.strictEqual(git(fx.shell, ['show', 'stash@{0}^3:src/prototypes/nowy/index.tsx']), 'local untracked preview\n', 'the untracked copy is parked');
  } finally { fx.cleanup(); }
});

test('a name with brackets is a file, not a pattern (--literal-pathspecs)', async () => {
  const fx = fixture();
  try {
    put(path.join(fx.shell, 'src/prototypes/form/[id].tsx'), 'b1\n');
    put(path.join(fx.shell, 'src/prototypes/form/i.tsx'), 'i1\n');
    git(fx.shell, ['add', '-A']);
    git(fx.shell, ['commit', '-q', '-m', 'brackets']);
    git(fx.shell, ['push', '-q', 'origin', 'main']);
    const otherDir = path.join(path.dirname(fx.shell), 'other');
    git(otherDir, ['pull', '-q', '--rebase']);
    fx.publishFromOther('src/prototypes/form/[id].tsx', 'b-remote\n');
    put(path.join(fx.shell, 'src/prototypes/form/[id].tsx'), 'b-local\n');
    // `[id].tsx` as a pattern would match `i.tsx` - that change must stay in the tree
    put(path.join(fx.shell, 'src/prototypes/form/i.tsx'), 'i-local\n');
    const r = await srv._protoShellSyncWithOrigin({ git: gitAsync(fx.shell) });
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(r.parked, ['src/prototypes/form/[id].tsx']);
    assert.strictEqual(read(fx, 'src/prototypes/form/i.tsx'), 'i-local\n');
    assert.strictEqual(read(fx, 'src/prototypes/form/[id].tsx'), 'b-remote\n');
  } finally { fx.cleanup(); }
});

test('a failed fetch and a conflicted file after the pull are a refusal, not a success', async () => {
  const failFetch = async (args) => (args[0] === 'fetch' ? { code: 128, stdout: '', stderr: 'fatal: unable to access' } : { code: 0, stdout: '', stderr: '' });
  const r1 = await srv._protoShellSyncWithOrigin({ git: failFetch });
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.error, 'pull-failed');

  // git ends the pull with code 0 but leaves a UU file - the gate is the state, not the code
  let pulled = false;
  const fake = async (args) => {
    if (args[0] === 'pull') { pulled = true; return { code: 0, stdout: '', stderr: '' }; }
    if (args.includes('--diff-filter=U')) return { code: 0, stdout: pulled ? 'src/prototypes/form/index.tsx\0' : '', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const r2 = await srv._protoShellSyncWithOrigin({ git: fake });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.error, 'shell-conflict');
  assert.deepStrictEqual(r2.paths, ['src/prototypes/form/index.tsx']);
});
