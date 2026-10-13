// tests/test_proto_quarantine.mjs
// Quarantine of untracked previews for the duration of the prototype publish
// gates (server.js, publish section): tsc/eslint/vite read all of src/, so an
// orphaned preview copy broke the publication of every prototype.
// Real, throwaway git repositories in a temp directory; no network.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');
const SERVER_PATH = fileURLToPath(new URL('../server.js', import.meta.url));

function git(cwd, args) {
  return cp.execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
}
function put(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-quar-'));
  const shell = path.join(root, 'shell');
  fs.mkdirSync(shell);
  git(shell, ['init', '-q']);
  put(path.join(shell, 'src/prototypes/tracked-a/index.tsx'), 'a');
  put(path.join(shell, 'src/prototypes/_shared/x.ts'), 's');
  put(path.join(shell, 'src/prototypes/registry.ts'), 'r');
  git(shell, ['add', '-A']);
  git(shell, ['commit', '-q', '-m', 'init']);
  // untracked: previews of other prototypes, the preview of the published one, assets
  put(path.join(shell, 'src/prototypes/orphan/index.tsx'), 'bad');
  put(path.join(shell, 'src/prototypes/orphan/data.json'), '{}');
  put(path.join(shell, 'src/prototypes/other/index.tsx'), 'o');
  put(path.join(shell, 'src/prototypes/pub/index.tsx'), 'p');
  put(path.join(shell, 'public/proto-assets/orphan/a.png'), 'png');
  return { root, shell, quarantine: path.join(root, 'q'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('_protoQuarantineSelect: untracked yes, tracked / published / _shared no', () => {
  const sel = srv._protoQuarantineSelect({
    onDisk: ['tracked-a', '_shared', 'orphan', 'pub', 'other'],
    trackedPaths: ['src/prototypes/tracked-a/index.tsx', 'src/prototypes/_shared/x.ts', 'src/prototypes/registry.ts'],
    slug: 'pub',
  });
  assert.deepStrictEqual(sel, ['orphan', 'other']);
  assert.deepStrictEqual(srv._protoQuarantineSelect({ onDisk: [], trackedPaths: [], slug: 'x' }), []);
});

test('quarantine moves the untracked (with assets), leaves the rest, restore brings back byte for byte', async () => {
  const fx = fixture();
  try {
    const q = await srv._protoQuarantineUntracked({ buildDir: fx.shell, slug: 'pub', quarantineRoot: fx.quarantine });
    assert.deepStrictEqual(q.moved, ['orphan', 'other']);
    const p = (r) => path.join(fx.shell, r);
    assert.ok(!fs.existsSync(p('src/prototypes/orphan')), 'orphan out of the tree during the gates');
    assert.ok(!fs.existsSync(p('src/prototypes/other')));
    assert.ok(!fs.existsSync(p('public/proto-assets/orphan')), 'the untracked one\'s assets too');
    assert.ok(fs.existsSync(p('src/prototypes/tracked-a/index.tsx')));
    assert.ok(fs.existsSync(p('src/prototypes/_shared/x.ts')));
    assert.ok(fs.existsSync(p('src/prototypes/pub/index.tsx')), 'the published one stays');
    assert.ok(fs.existsSync(path.join(q.dir, 'src/prototypes/orphan/data.json')));
    assert.deepStrictEqual(q.restore(), []);
    assert.strictEqual(fs.readFileSync(p('src/prototypes/orphan/index.tsx'), 'utf8'), 'bad');
    assert.strictEqual(fs.readFileSync(p('public/proto-assets/orphan/a.png'), 'utf8'), 'png');
    assert.ok(!fs.existsSync(q.dir), 'an empty quarantine is cleaned up');
    assert.deepStrictEqual(q.restore(), [], 'a second call is safe');
  } finally { fx.cleanup(); }
});

test('a collision on restore: never overwrites, leaves it in quarantine', async () => {
  const fx = fixture();
  try {
    const q = await srv._protoQuarantineUntracked({ buildDir: fx.shell, slug: 'pub', quarantineRoot: fx.quarantine });
    put(path.join(fx.shell, 'src/prototypes/orphan/index.tsx'), 'NEW'); // a preview recreated in the meantime
    const warn = console.warn; console.warn = () => {};
    let left;
    try { left = q.restore(); } finally { console.warn = warn; }
    assert.strictEqual(left.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(fx.shell, 'src/prototypes/orphan/index.tsx'), 'utf8'), 'NEW', 'not overwritten');
    assert.strictEqual(fs.readFileSync(path.join(left[0], 'index.tsx'), 'utf8'), 'bad', 'the old copy is in quarantine');
    assert.ok(fs.existsSync(path.join(fx.shell, 'src/prototypes/other/index.tsx')), 'the rest came back');
  } finally { fx.cleanup(); }
});

test('nothing is deleted: the tree after restore = the tree before', async () => {
  const fx = fixture();
  try {
    const snap = () => cp.execFileSync('find', [fx.shell, '-type', 'f', '-not', '-path', '*/.git/*'], { encoding: 'utf8' }).split('\n').sort().join('\n');
    const before = snap();
    const q = await srv._protoQuarantineUntracked({ buildDir: fx.shell, slug: 'pub', quarantineRoot: fx.quarantine });
    q.restore();
    assert.strictEqual(snap(), before);
  } finally { fx.cleanup(); }
});

test('the publish commit carries no untracked previews (_protoPublishAddPaths + git add)', () => {
  const fx = fixture();
  try {
    const script = `const srv = require(${JSON.stringify(SERVER_PATH)}); process.stdout.write(JSON.stringify(srv._protoPublishAddPaths('pub')));`;
    const out = cp.execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, IS_TEST_MODE: '1', POC_PAGES_DATA_DIR: fx.shell },
    });
    const paths = JSON.parse(out);
    git(fx.shell, ['add', '--', ...paths]);
    const staged = git(fx.shell, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    assert.ok(staged.includes('src/prototypes/pub/index.tsx'));
    assert.ok(!staged.some((f) => f.includes('orphan') || f.includes('/other/')), `no foreign preview in the commit: ${staged}`);
  } finally { fx.cleanup(); }
});

test('protoGateErrorHint: the file path, and for another prototype a plain-language message', () => {
  const tsc = "src/prototypes/21f82d9446c0/index.tsx(12,5): error TS2345: Argument of type 'profile'";
  const h = srv.protoGateErrorHint(tsc, 'narzedziownik');
  assert.strictEqual(h.file, 'src/prototypes/21f82d9446c0/index.tsx');
  assert.strictEqual(h.proto, '21f82d9446c0');
  assert.ok(h.text.includes('in prototype 21f82d9446c0, which is not being published'));
  const own = srv.protoGateErrorHint(tsc, '21f82d9446c0');
  assert.ok(own.text.includes('src/prototypes/21f82d9446c0/index.tsx') && !own.text.includes('not being published'));
  const eslint = '/Users/example/data-prototypes/src/components/Foo.tsx\n  3:1  error  no-undef';
  assert.strictEqual(srv.protoGateErrorHint(eslint, 'a').file, 'src/components/Foo.tsx');
  assert.strictEqual(srv.protoGateErrorHint(eslint, 'a').proto, null);
  assert.strictEqual(srv.protoGateErrorHint('boom', 'a').text, '');
  assert.strictEqual(srv.protoGateErrorHint('src/prototypes/_shared/x.ts(1,1): error', 'a').proto, null);
});

test('_protoMoveDir on EXDEV: copy + delete, and an existing target is NEVER overwritten', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-exdev-'));
  const exdev = () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); };
  try {
    put(path.join(root, 'from/a.txt'), 'A');
    srv._protoMoveDir(path.join(root, 'from'), path.join(root, 'to'), { rename: exdev });
    assert.strictEqual(fs.readFileSync(path.join(root, 'to/a.txt'), 'utf8'), 'A');
    assert.ok(!fs.existsSync(path.join(root, 'from')), 'the source is removed after the copy');

    put(path.join(root, 'src2/a.txt'), 'NEW');
    put(path.join(root, 'busy/a.txt'), 'FOREIGN');
    assert.throws(() => srv._protoMoveDir(path.join(root, 'src2'), path.join(root, 'busy'), { rename: exdev }));
    assert.strictEqual(fs.readFileSync(path.join(root, 'busy/a.txt'), 'utf8'), 'FOREIGN', 'the target is untouched');
    assert.ok(fs.existsSync(path.join(root, 'src2/a.txt')), 'the source stays when the copy refused');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an interrupted publish: the next quarantine first restores abandoned previews, leaves an occupied spot', async () => {
  const fx = fixture();
  try {
    // simulated crash: moved, restore() never called
    const q1 = await srv._protoQuarantineUntracked({ buildDir: fx.shell, slug: 'pub', quarantineRoot: fx.quarantine });
    assert.ok(!fs.existsSync(path.join(fx.shell, 'src/prototypes/orphan')));
    put(path.join(fx.shell, 'src/prototypes/other/index.tsx'), 'RECREATED'); // somebody recreated the preview in the meantime
    const lines = [];
    const warn = console.warn; console.warn = () => {};
    let rec;
    try { rec = srv._protoQuarantineRecover({ buildDir: fx.shell, quarantineRoot: fx.quarantine, log: (t) => lines.push(t) }); } finally { console.warn = warn; }
    assert.ok(rec.restored.some((p) => p.endsWith(path.join('src', 'prototypes', 'orphan'))));
    assert.ok(rec.restored.some((p) => p.endsWith(path.join('public', 'proto-assets', 'orphan'))));
    assert.strictEqual(fs.readFileSync(path.join(fx.shell, 'src/prototypes/orphan/index.tsx'), 'utf8'), 'bad');
    assert.strictEqual(fs.readFileSync(path.join(fx.shell, 'public/proto-assets/orphan/a.png'), 'utf8'), 'png');
    assert.strictEqual(rec.left.length, 1, 'occupied spot: the copy stays in quarantine');
    assert.strictEqual(fs.readFileSync(path.join(fx.shell, 'src/prototypes/other/index.tsx'), 'utf8'), 'RECREATED', 'not overwritten');
    assert.ok(fs.existsSync(path.join(q1.dir, 'src/prototypes/other/index.tsx')), 'the old copy is still in quarantine');
    assert.ok(lines.some((l) => l.startsWith('Restored')) && lines.some((l) => l.startsWith('Note:')));

    // without a collision the timestamp directory is cleaned up
    fs.rmSync(path.join(fx.shell, 'src/prototypes/other'), { recursive: true });
    const rec2 = srv._protoQuarantineRecover({ buildDir: fx.shell, quarantineRoot: fx.quarantine });
    assert.strictEqual(rec2.left.length, 0);
    assert.strictEqual(fs.readFileSync(path.join(fx.shell, 'src/prototypes/other/index.tsx'), 'utf8'), 'o');
    assert.ok(!fs.existsSync(q1.dir), 'the empty quarantine directory is removed');
    assert.deepStrictEqual(srv._protoQuarantineRecover({ buildDir: fx.shell, quarantineRoot: path.join(fx.root, 'brak') }), { restored: [], left: [] });
  } finally { fx.cleanup(); }
});

test('protoGateErrorHint with several errors points at the first file of the output', () => {
  const out = 'src/prototypes/aaa/index.tsx(1,1): error TS1\nsrc/prototypes/bbb/index.tsx(2,2): error TS2';
  const h = srv.protoGateErrorHint(out, 'bbb');
  assert.strictEqual(h.proto, 'aaa');
  assert.ok(h.text.includes('in prototype aaa'));
});

// Shared directories (src/components, src/ds, src/prototypes/_shared): an orphan is
// a file that is untracked AND absent from team data; a new component from the data ships.
function sharedFixture() {
  const fx = fixture();
  const data = path.join(fx.root, 'data-components');
  put(path.join(fx.shell, 'src/components/Tracked.tsx'), 't');
  git(fx.shell, ['add', '-A', 'src/components']);
  git(fx.shell, ['commit', '-q', '-m', 'components']);
  put(path.join(fx.shell, 'src/components/Orphan.tsx'), 'bad');
  put(path.join(fx.shell, 'src/components/frame/Old.tsx'), 'old');
  put(path.join(fx.shell, 'src/components/frame/New.tsx'), 'new');
  put(path.join(data, 'Tracked.tsx'), 't');
  put(path.join(data, 'frame/New.tsx'), 'new');
  const sharedRoots = [{ shellRel: 'src/components', srcDir: data }];
  return { ...fx, sharedRoots };
}

test('_protoQuarantineSelectFiles: untracked and absent from the data yes, tracked or from the data no', () => {
  const sel = srv._protoQuarantineSelectFiles({
    onDisk: ['src/components/A.tsx', 'src/components/B.tsx', 'src/components/x/C.tsx', 'src/components/D.tsx'],
    trackedPaths: ['src/components/A.tsx'],
    sourcePaths: ['src/components/B.tsx'],
  });
  assert.deepStrictEqual(sel, ['src/components/D.tsx', 'src/components/x/C.tsx']);
  assert.deepStrictEqual(srv._protoQuarantineSelectFiles({ onDisk: [], trackedPaths: [], sourcePaths: [] }), []);
});

test('an orphaned file in src/components: out of the tree during the gates, a new one from the data stays, restore byte for byte', async () => {
  const fx = sharedFixture();
  try {
    const lines = [];
    const q = await srv._protoQuarantineUntracked({ buildDir: fx.shell, slug: 'pub', quarantineRoot: fx.quarantine, sharedRoots: fx.sharedRoots, log: (t) => lines.push(t) });
    assert.deepStrictEqual(q.files, ['src/components/Orphan.tsx', 'src/components/frame/Old.tsx']);
    const p = (r) => path.join(fx.shell, r);
    assert.ok(!fs.existsSync(p('src/components/Orphan.tsx')));
    assert.ok(!fs.existsSync(p('src/components/frame/Old.tsx')));
    assert.ok(fs.existsSync(p('src/components/frame/New.tsx')), 'a new component from the data stays');
    assert.ok(fs.existsSync(p('src/components/Tracked.tsx')));
    assert.ok(lines.some((l) => l.includes('orphaned shared files')));
    assert.deepStrictEqual(q.restore(), []);
    assert.strictEqual(fs.readFileSync(p('src/components/Orphan.tsx'), 'utf8'), 'bad');
    assert.strictEqual(fs.readFileSync(p('src/components/frame/Old.tsx'), 'utf8'), 'old');
    assert.ok(!fs.existsSync(q.dir));
  } finally { fx.cleanup(); }
});

test('the publish commit carries no orphaned src/components files, but a new component from the data does', async () => {
  const fx = sharedFixture();
  try {
    const q = await srv._protoQuarantineUntracked({ buildDir: fx.shell, slug: 'pub', quarantineRoot: fx.quarantine, sharedRoots: fx.sharedRoots });
    q.restore(); // as in the handler: restored BEFORE the commit
    const spec = srv._protoPublishPathspec(['src/prototypes/pub/', 'src/components/'], q.files);
    git(fx.shell, ['add', '--', ...spec]);
    const staged = git(fx.shell, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    assert.ok(staged.includes('src/components/frame/New.tsx'), `new component in the commit: ${staged}`);
    assert.ok(staged.includes('src/prototypes/pub/index.tsx'));
    assert.ok(!staged.some((f) => f.endsWith('Orphan.tsx') || f.endsWith('Old.tsx')), `no orphan in the commit: ${staged}`);
    assert.deepStrictEqual(srv._protoPublishPathspec([], ['x']), [], 'an exclude alone never');
  } finally { fx.cleanup(); }
});

test('an interrupted publish: orphaned shared files come back at the next quarantine', async () => {
  const fx = sharedFixture();
  try {
    const q1 = await srv._protoQuarantineUntracked({ buildDir: fx.shell, slug: 'pub', quarantineRoot: fx.quarantine, sharedRoots: fx.sharedRoots });
    put(path.join(fx.shell, 'src/components/Orphan.tsx'), 'RECREATED');
    const warn = console.warn; console.warn = () => {};
    let rec;
    try { rec = srv._protoQuarantineRecover({ buildDir: fx.shell, quarantineRoot: fx.quarantine }); } finally { console.warn = warn; }
    assert.ok(rec.restored.includes('src/components/frame/Old.tsx'));
    assert.strictEqual(fs.readFileSync(path.join(fx.shell, 'src/components/frame/Old.tsx'), 'utf8'), 'old');
    assert.strictEqual(fs.readFileSync(path.join(fx.shell, 'src/components/Orphan.tsx'), 'utf8'), 'RECREATED', 'not overwritten');
    assert.ok(fs.existsSync(path.join(q1.dir, 'files/src/components/Orphan.tsx')), 'the old copy waits in quarantine');
  } finally { fx.cleanup(); }
});

test('protoGateErrorHint: a file with only ESLint warnings is not pointed at as an error', () => {
  const out = [
    '/Users/example/data-prototypes/src/components/DesktopShell.tsx',
    '  12:7  warning  Fast refresh only works when a file only exports components  react-refresh/only-export-components',
    '',
    '/Users/example/data-prototypes/src/prototypes/abc/index.tsx',
    '  3:1  warning  Unused eslint-disable directive',
    '  9:5  error  \'x\' is defined but never used  @typescript-eslint/no-unused-vars',
    '',
    '✖ 3 problems (1 error, 2 warnings)',
  ].join('\n');
  const h = srv.protoGateErrorHint(out, 'pub');
  assert.strictEqual(h.file, 'src/prototypes/abc/index.tsx');
  assert.strictEqual(h.kind, 'error');
  assert.ok(h.text.includes('in prototype abc') && !h.text.includes('DesktopShell'));

  const onlyWarn = srv.protoGateErrorHint(out.split('\n').slice(0, 2).join('\n'), 'pub');
  assert.strictEqual(onlyWarn.kind, 'warning');
  assert.strictEqual(onlyWarn.proto, null);
  assert.ok(onlyWarn.text.includes('only warnings') && !onlyWarn.text.includes('First error'));

  const tscAfterWarn = 'src/components/A.tsx\n  1:1  warning  w  r\nsrc/prototypes/q/index.tsx(4,2): error TS2322: nope';
  assert.strictEqual(srv.protoGateErrorHint(tscAfterWarn, 'pub').file, 'src/prototypes/q/index.tsx');
});

test('recovery does not delete a timestamp directory holding a file it does not know', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-unknown-'));
  try {
    const shell = path.join(root, 'shell');
    fs.mkdirSync(shell);
    const q = path.join(root, 'q');
    put(path.join(q, 'stamp-a/reczne/ekran.tsx'), 'praca');
    srv._protoQuarantineRecover({ buildDir: shell, quarantineRoot: q });
    assert.strictEqual(fs.readFileSync(path.join(q, 'stamp-a/reczne/ekran.tsx'), 'utf8'), 'praca');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('_protoPublishPathspec: the exclude is literal - a name with glob characters does not exclude somebody else\'s file', () => {
  const fx = sharedFixture();
  try {
    put(path.join(fx.shell, 'src/components/[id].tsx'), 'orphan');
    put(path.join(fx.shell, 'src/components/i.tsx'), 'legit');
    const spec = srv._protoPublishPathspec(['src/components/'], ['src/components/[id].tsx']);
    assert.ok(spec.includes(':(exclude,literal)src/components/[id].tsx'));
    git(fx.shell, ['add', '--', ...spec]);
    const staged = git(fx.shell, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    assert.ok(staged.includes('src/components/i.tsx'), `a file matching the glob [id] ships: ${staged}`);
    assert.ok(!staged.includes('src/components/[id].tsx'), `the excluded orphan does not ship: ${staged}`);
  } finally { fx.cleanup(); }
});

test('a tracked non-ASCII file in a shared directory is not an orphan (ls-files -z, quotePath=false)', async () => {
  const fx = sharedFixture();
  try {
    put(path.join(fx.shell, 'src/components/Żółw.tsx'), 'z');
    git(fx.shell, ['add', '--', 'src/components/Żółw.tsx']);
    git(fx.shell, ['commit', '-q', '-m', 'nonascii']);
    const q = await srv._protoQuarantineUntracked({ buildDir: fx.shell, slug: 'pub', quarantineRoot: fx.quarantine, sharedRoots: fx.sharedRoots });
    try {
      assert.ok(!q.files.some((f) => f.normalize('NFC').endsWith('Żółw.tsx')), `a tracked file never goes to quarantine: ${q.files}`);
      assert.ok(fs.existsSync(path.join(fx.shell, 'src/components/Żółw.tsx')));
    } finally { q.restore(); }
  } finally { fx.cleanup(); }
});

test('the orphan quarantine and the shared-deps copy read the same directory list', () => {
  const src = fs.readFileSync(SERVER_PATH, 'utf8');
  const body = src.slice(src.indexOf('async function _protoSyncSharedDeps()'), src.indexOf('async function _protoCopyAssets('));
  assert.ok(body.includes('_protoSharedSyncRoots()'), '_protoSyncSharedDeps takes its pairs from _protoSharedSyncRoots');
  assert.ok(!/path\.join\(PRODUCT_DATA_DIR/.test(body), 'no second, hand-written directory list');
});
