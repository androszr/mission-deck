// tests/test_repo_pull_reconcile.mjs
// Merging local and server changes BEFORE `git pull` in a data repository
// mirror (_repoReconcileBeforePull in server.js). Regression of 2026-10-09:
// every `.enc` is one line of base64, so two people editing the same file
// always collide, and a conflict on the autostash re-apply ends with exit
// code 0 - UU files in the mirror, decryptTree aborted, plaintext stale.
// Real, throwaway git repositories and real encryption; no network.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Keep the pull's sync-log shard out of the repo's data/ (it is named after the git user).
if (!process.env.TEST_SYNC_LOG_DIR) process.env.TEST_SYNC_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-log-'));
const srv = require('../server.js');
const cs = require('../scripts/crypto-sync.js');

const KEY = cs.generateKey();
const INFO = Buffer.from('cockpit-test-reconcile-v1');
const GIT_CFG = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
function git(cwd, args) {
  return cp.execFileSync('git', ['-C', cwd, ...GIT_CFG, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function gitAsync(cwd) {
  return (args) => new Promise((resolve) => {
    cp.execFile('git', ['-C', cwd, ...GIT_CFG, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
// v1: name = path + .enc; v2: HMAC name + `v2:` prefix.
const FORMATS = {
  v1: { enc: (rel, text) => [`${rel}.enc`, cs.encryptBufferV1(Buffer.from(text), rel, KEY, INFO)] },
  v2: {
    enc: (rel, text) => {
      const dir = path.posix.dirname(rel);
      const name = cs.encryptRelPath(rel, KEY, INFO);
      return [`${dir === '.' ? '' : dir + '/'}${name}.enc`, cs.encryptBuffer(Buffer.from(text), rel, name, KEY, INFO)];
    },
  },
};
const decryptBlob = (armored, encRelPath) => cs.decryptMirrorBlob(armored, encRelPath, KEY, INFO);

const BASE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const edit = (text, n, to) => text.split('\n').map((l, i) => (i === n - 1 ? to : l)).join('\n');

// origin (bare), this machine's mirror and a second machine that pushes.
function fixture(fmt) {
  const F = FORMATS[fmt];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-reconcile-'));
  const origin = path.join(root, 'origin.git');
  const mirror = path.join(root, 'mirror');
  const other = path.join(root, 'other');
  const write = (dir, rel, text) => {
    const [encRel, armored] = F.enc(rel, text);
    const abs = path.join(dir, ...encRel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, armored);
    return encRel;
  };
  cp.execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  cp.execFileSync('git', ['clone', '-q', origin, mirror], { stdio: 'ignore' });
  git(mirror, ['checkout', '-q', '-b', 'main']);
  write(mirror, 'src/a.ts', BASE);
  write(mirror, 'src/b.ts', 'b\n');
  write(mirror, 'img.bin', 'x\0y');
  git(mirror, ['add', '-A']);
  git(mirror, ['commit', '-q', '-m', 'init']);
  git(mirror, ['push', '-q', '-u', 'origin', 'main']);
  cp.execFileSync('git', ['clone', '-q', '-b', 'main', origin, other], { stdio: 'ignore' });
  return {
    mirror,
    local: (rel, text) => write(mirror, rel, text),
    pushFromOther: (rel, text) => {
      git(other, ['pull', '-q', '--rebase']);
      write(other, rel, text);
      git(other, ['add', '-A']);
      git(other, ['commit', '-q', '-m', 'sync']);
      git(other, ['push', '-q', 'origin', 'main']);
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
const unmerged = (fx) => git(fx.mirror, ['diff', '--name-only', '--diff-filter=U']).trim();
const reconcile = (fx) => srv._repoReconcileBeforePull({ git: gitAsync(fx.mirror), decryptBlob });

// One overlapping file that merges and one that does not: nothing is merged,
// so resolve-autostash later decides both and never overwrites a merge.
test('a mix: one mergeable file and one conflict -> nothing merged', async () => {
  const fx = fixture('v1');
  try {
    fx.pushFromOther('src/a.ts', edit(BASE, 2, 'theirs'));
    fx.pushFromOther('src/b.ts', 'b-theirs\n');
    fx.local('src/a.ts', edit(BASE, 18, 'mine'));
    fx.local('src/b.ts', 'b-mine\n');
    const r = await reconcile(fx);
    assert.deepStrictEqual(r, { ok: true, merged: [], unresolved: ['src/b.ts'] });
    assert.match(git(fx.mirror, ['status', '--porcelain']), /src\/a\.ts\.enc/, 'the mergeable file stays untouched too');
  } finally { fx.cleanup(); }
});

// End to end through _repoPull: the reconcile and the autostash gate together.
function pullDef(fx, calls) {
  return {
    id: 'test-reconcile', dir: fx.mirror, existsFn: () => true,
    gitExecFn: gitAsync(fx.mirror), resetCheckCache: () => {},
    writeToken: () => 't', keyFn: () => KEY, hkdfInfo: INFO,
    plainDir: path.join(path.dirname(fx.mirror), 'plain'),
    encryptFn: () => { calls.push('encrypt'); return { ok: true }; },
    decryptFn: () => { calls.push('decrypt'); return { ok: true }; },
    pullTimestampKey: 'test-reconcile',
  };
}

test('_repoPull: a real conflict ends in autostash-conflict (version choice buttons), not a reconcile refusal', async () => {
  const fx = fixture('v1');
  try {
    fx.pushFromOther('src/a.ts', edit(BASE, 5, 'theirs'));
    fx.local('src/a.ts', edit(BASE, 5, 'mine'));
    const calls = [];
    const r = await srv._repoPull(pullDef(fx, calls), () => {});
    assert.strictEqual(r.error, 'autostash-conflict', JSON.stringify(r));
    assert.deepStrictEqual(r.paths, ['src/a.ts.enc']);
    assert.ok(!calls.includes('decrypt'));
  } finally { fx.cleanup(); }
});

test('_repoPull: disjoint changes -> pull ok, the merged text lands in the plaintext directory', async () => {
  const fx = fixture('v1');
  try {
    fx.pushFromOther('src/a.ts', edit(BASE, 2, 'theirs'));
    fx.local('src/a.ts', edit(BASE, 18, 'mine'));
    const d = pullDef(fx, []);
    const r = await srv._repoPull(d, () => {});
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(unmerged(fx), '');
    assert.strictEqual(fs.readFileSync(path.join(d.plainDir, 'src', 'a.ts'), 'utf8'), edit(edit(BASE, 2, 'theirs'), 18, 'mine'));
  } finally { fx.cleanup(); }
});

test('regression proof: edits on both sides -> autostash leaves UU with code 0', async () => {
  const fx = fixture('v1');
  try {
    fx.pushFromOther('src/a.ts', edit(BASE, 2, 'theirs'));
    fx.local('src/a.ts', edit(BASE, 18, 'mine'));
    const r = await gitAsync(fx.mirror)(['pull', '--rebase', '--autostash']);
    assert.strictEqual(r.code, 0, 'git succeeds despite the conflict - the exit code is not the gate');
    assert.strictEqual(unmerged(fx), 'src/a.ts.enc', 'disjoint hunks collide anyway, because an .enc is one line');
  } finally { fx.cleanup(); }
});

for (const fmt of ['v1', 'v2']) {
  test(`${fmt}: disjoint changes merge on the plaintext, the pull passes without a conflict`, async () => {
    const fx = fixture(fmt);
    try {
      fx.pushFromOther('src/a.ts', edit(BASE, 2, 'theirs'));
      fx.local('src/a.ts', edit(BASE, 18, 'mine'));
      fx.local('src/b.ts', 'b-local\n'); // a local-only change - it stays in the mirror
      const r = await reconcile(fx);
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.deepStrictEqual(r.merged.map((m) => m.relPath), ['src/a.ts']);
      assert.strictEqual(r.merged[0].body.toString(), edit(edit(BASE, 2, 'theirs'), 18, 'mine'));
      const pull = await gitAsync(fx.mirror)(['pull', '--rebase', '--autostash']);
      assert.strictEqual(pull.code, 0, pull.stderr);
      assert.strictEqual(unmerged(fx), '');
      assert.match(git(fx.mirror, ['status', '--porcelain']), /b\.ts\.enc|\.enc/, 'the disjoint local change was not lost');
    } finally { fx.cleanup(); }
  });

  test(`${fmt}: overlapping changes -> nothing merged, the mirror untouched (the choice stays with resolve-autostash)`, async () => {
    const fx = fixture(fmt);
    try {
      fx.pushFromOther('src/a.ts', edit(BASE, 5, 'theirs'));
      const encRel = fx.local('src/a.ts', edit(BASE, 5, 'mine'));
      const before = fs.readFileSync(path.join(fx.mirror, ...encRel.split('/')), 'utf8');
      const head = git(fx.mirror, ['rev-parse', 'HEAD']);
      const r = await reconcile(fx);
      assert.deepStrictEqual(r, { ok: true, merged: [], unresolved: ['src/a.ts'] });
      assert.strictEqual(fs.readFileSync(path.join(fx.mirror, ...encRel.split('/')), 'utf8'), before, 'the local blob stays');
      assert.strictEqual(git(fx.mirror, ['rev-parse', 'HEAD']), head, 'HEAD does not move');
    } finally { fx.cleanup(); }
  });
}

test('an identical change on both sides is not a conflict', async () => {
  const fx = fixture('v1');
  try {
    fx.pushFromOther('src/a.ts', edit(BASE, 5, 'same'));
    fx.local('src/a.ts', edit(BASE, 5, 'same'));
    const r = await reconcile(fx);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.merged[0].body.toString(), edit(BASE, 5, 'same'));
  } finally { fx.cleanup(); }
});

test('a binary file changed on both sides -> no text merge', async () => {
  const fx = fixture('v1');
  try {
    fx.pushFromOther('img.bin', 'x\0theirs');
    fx.local('img.bin', 'x\0mine');
    const r = await reconcile(fx);
    assert.deepStrictEqual(r, { ok: true, merged: [], unresolved: ['img.bin'] });
  } finally { fx.cleanup(); }
});

test('non-UTF-8 text (cp1250) -> no merge, never a silent corruption of accented letters', async () => {
  const fx = fixture('v1');
  try {
    const cp1250 = (t) => Buffer.from(t, 'latin1'); // bytes > 0x7f that are not valid UTF-8
    const base = cp1250('a;\xb3\nb;2\nc;3\nd;4\ne;5\nf;6\n');
    const enc = (b) => cs.encryptBufferV1(b, 'dane.csv', KEY, INFO);
    fs.writeFileSync(path.join(fx.mirror, 'dane.csv.enc'), enc(base));
    git(fx.mirror, ['add', '-A']); git(fx.mirror, ['commit', '-q', '-m', 'csv']); git(fx.mirror, ['push', '-q']);
    const other = path.join(path.dirname(fx.mirror), 'other');
    git(other, ['pull', '-q']);
    fs.writeFileSync(path.join(other, 'dane.csv.enc'), enc(cp1250('a;\xb3x\nb;2\nc;3\nd;4\ne;5\nf;6\n')));
    git(other, ['commit', '-q', '-am', 'csv theirs']); git(other, ['push', '-q', 'origin', 'main']);
    fs.writeFileSync(path.join(fx.mirror, 'dane.csv.enc'), enc(cp1250('a;\xb3\nb;2\nc;3\nd;4\ne;5\nf;6x\n')));
    const r = await reconcile(fx);
    assert.deepStrictEqual(r, { ok: true, merged: [], unresolved: ['dane.csv'] });
  } finally { fx.cleanup(); }
});

test('JSON merged without a conflict but invalid -> no merge', async () => {
  const fx = fixture('v1');
  try {
    const base = '[\n  1,\n  2,\n  3,\n  4,\n  5,\n  6\n]\n';
    fx.local('x.json', base);
    git(fx.mirror, ['add', '-A']); git(fx.mirror, ['commit', '-q', '-m', 'json']); git(fx.mirror, ['push', '-q']);
    fx.pushFromOther('x.json', base.replace('  6\n', '  6,\n  7\n'));
    fx.local('x.json', base.replace('  1,\n', '  1,,\n')); // a disjoint hunk, but the result is not JSON
    const r = await reconcile(fx);
    assert.deepStrictEqual(r, { ok: true, merged: [], unresolved: ['x.json'] });
  } finally { fx.cleanup(); }
});

test('a mirror that already holds UU files stays untouched (that is the _repoAutostashConflict state)', async () => {
  const fx = fixture('v1');
  try {
    fx.pushFromOther('src/a.ts', edit(BASE, 2, 'theirs'));
    fx.local('src/a.ts', edit(BASE, 18, 'mine'));
    await gitAsync(fx.mirror)(['pull', '--rebase', '--autostash']); // stary, wadliwy przebieg
    const r = await reconcile(fx);
    assert.deepStrictEqual(r, { ok: true, merged: [] });
    assert.strictEqual(unmerged(fx), 'src/a.ts.enc');
  } finally { fx.cleanup(); }
});

test('with no server-side changes nothing is merged or touched', async () => {
  const fx = fixture('v1');
  try {
    fx.local('src/a.ts', edit(BASE, 1, 'mine'));
    const r = await reconcile(fx);
    assert.deepStrictEqual(r, { ok: true, merged: [] });
    assert.match(git(fx.mirror, ['status', '--porcelain']), /src\/a\.ts\.enc/);
  } finally { fx.cleanup(); }
});
