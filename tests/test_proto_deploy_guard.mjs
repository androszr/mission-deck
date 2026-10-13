// tests/test_proto_deploy_guard.mjs
// The prototype publish gate (server.js, section "Prototypes: local build
// and publish"): did the published copy EVER pass through the shared data
// repository, plus narrowing the generated files and the commit paths to what
// the publish really carries.
//
// Why (2026-09-12): publishing one prototype rolled the published version back
// by 1244 lines - another machine had published its copy and never synced it,
// and this one "published" the state of the shared repository from two days
// earlier. Second vector: `git add src/ public/` took into the commit every
// working copy the local preview had left in the shell.
//
// The pure part (verdict, text) reads server.js directly. The git part runs
// server.js in a SEPARATE node process with its own DATA_SUB_REPOS_DIR /
// POC_PAGES_DATA_DIR / DATA_ENCRYPTION_KEY (constants computed once at require)
// and builds the mirror and the shell as real, throwaway git repositories in a
// temp directory - like tests/test_stash_api_helpers.mjs. No npm,
// no network.

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
const cryptoSync = require('../scripts/crypto-sync.js');

const SERVER_PATH = fileURLToPath(new URL('../server.js', import.meta.url));

function git(cwd, args, opts = {}) {
  return cp.execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', ...opts });
}

function writeFile(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// One workstation: the team's plaintext data, its mirror (git) and the shell (git).
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-guard-'));
  const subRepos = path.join(root, 'sub');
  // The team data repo (data-tier-0): plaintext dir and its v2 mirror.
  const plain = path.join(subRepos, 'ds-data');
  const mirror = path.join(subRepos, 'ds-data-encrypted');
  const shell = path.join(root, 'shell');
  const key = cryptoSync.generateKey();
  const masterKey = Buffer.from(key, 'base64');
  fs.mkdirSync(plain, { recursive: true });
  fs.mkdirSync(mirror, { recursive: true });
  fs.mkdirSync(shell, { recursive: true });
  git(mirror, ['init', '-q']);
  git(shell, ['init', '-q']);
  writeFile(path.join(plain, 'prototypes', 'prototypes.json'), JSON.stringify({ items: [{ id: 'proto-abc', name: 'ABC' }] }));

  // Writes one version of a file into the mirror (v2: HMAC name,
  // deterministic) and commits it - that is "went through the shared repo".
  const commitToMirror = (relPath, content, msg) => {
    const encName = cryptoSync.encryptRelPath(relPath, masterKey);
    const enc = cryptoSync.encryptBuffer(Buffer.from(content), relPath, encName, masterKey);
    writeFile(path.join(mirror, encName + '.enc'), enc);
    git(mirror, ['add', '-A']);
    git(mirror, ['commit', '-q', '-m', msg]);
  };
  const commitToShell = (files, msg) => {
    for (const [rel, content] of Object.entries(files)) writeFile(path.join(shell, rel), content);
    git(shell, ['add', '-A']);
    git(shell, ['commit', '-q', '-m', msg]);
  };
  return { root, subRepos, plain, mirror, shell, key, commitToMirror, commitToShell };
}

// Runs `code` (an async body) in a separate process with server.js pointed at
// the fixture. Returns what the body returned (JSON).
function runIsolated(fx, code, extraEnv) {
  const script = `
'use strict';
const srv = require(${JSON.stringify(SERVER_PATH)});
(async () => {
  const out = await (async () => { ${code} })();
  process.stdout.write(JSON.stringify(out === undefined ? null : out));
})().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;
  const out = cp.execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      IS_TEST_MODE: '1',
      POC_PAGES_DATA_DIR: fx.shell,
      DATA_SUB_REPOS_DIR: fx.subRepos,
      DATA_TIER_0_DIR: fx.plain,
      DATA_ENCRYPTION_KEY: fx.key,
      ...(extraEnv || {}),
    },
  });
  return JSON.parse(out);
}

// ── Pure part ────────────────────────────────────────────────────────────

test('protoDeployStaleVerdict: different and absent from history is stale, unknown kept apart, the rest passes', () => {
  const v = srv.protoDeployStaleVerdict([
    { relPath: 'a', published: 'same', inHistory: null },
    { relPath: 'b', published: 'missing', inHistory: null },
    { relPath: 'c', published: 'differs', inHistory: true },
    { relPath: 'd', published: 'differs', inHistory: false },
    { relPath: 'e', published: 'differs', inHistory: null },
  ]);
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.stale, ['d']);
  assert.deepStrictEqual(v.unknown, ['e'], 'no answer counts as "did not pass" - the safe direction');
  assert.strictEqual(v.compared, 5);
  assert.strictEqual(srv.protoDeployStaleVerdict([
    { relPath: 'c', published: 'differs', inHistory: true },
    { relPath: 'a', published: 'same', inHistory: null },
  ]).ok, true, 'a published version from the mirror history is the normal team flow');
  assert.strictEqual(srv.protoDeployStaleVerdict([]).ok, true);
  assert.strictEqual(srv.protoDeployStaleVerdict(null).ok, true);
});

test('protoStaleSourceMessage names the files, the reason and the way out - in plain words', () => {
  const msg = srv.protoStaleSourceMessage({ stale: ['prototypes/proto-x/index.tsx'], unknown: [] });
  assert.ok(msg.includes('prototypes/proto-x/index.tsx'));
  assert.ok(msg.includes('never passed through the shared data repository'), 'the reason for the refusal');
  assert.ok(msg.includes('Publish anyway'), 'the person must know how to override the gate');
  assert.ok(/^[\x20-\x7e]+$/.test(msg), 'plain English text');
  const unk = srv.protoStaleSourceMessage({ stale: [], unknown: ['ds/x.tsx'] });
  assert.ok(unk.includes('could not be checked') && unk.includes('ds/x.tsx'));
  const many = srv.protoStaleSourceMessage({ stale: Array.from({ length: 9 }, (_, i) => `f${i}`), unknown: [] });
  assert.ok(many.includes('and 3 more'), 'a long list is trimmed, not dumped in full');
  // A shallow clone is the one cause of `unknown` with a one-line fix - the message
  // names it and gives the command, so "Publish anyway" never becomes a habit.
  const shallow = srv.protoStaleSourceMessage({ stale: [], unknown: ['ds/x.tsx'], shallow: true, mirrorDir: 'data-sub-repositories/ds-data-reports-encrypted' });
  assert.ok(shallow.includes('shallow clone') && shallow.includes('git -C data-sub-repositories/ds-data-reports-encrypted fetch --unshallow'));
  assert.ok(!unk.includes('fetch --unshallow'), 'without the shallow flag there is no command - a missing mirror or key is a different fix');
});

test('_gitBlobSha computes the blob id the way git hash-object does', () => {
  const buf = Buffer.from('hello\n');
  const expected = cp.execFileSync('git', ['hash-object', '--stdin'], { input: buf, encoding: 'utf8' }).trim();
  assert.strictEqual(srv._gitBlobSha(buf), expected);
});

test('_protoPublishAddPaths carries the paths of one prototype and the generated files, never all of src/', () => {
  const paths = srv._protoPublishAddPaths('anything');
  assert.ok(!paths.includes('src/') && !paths.includes('public/'), 'it used to be `git add src/ public/` - that took other people\'s working copies');
  for (const p of paths) assert.ok(!/^(src|public)\/$/.test(p));
});

// ── Git part ────────────────────────────────────────────────────────────

test('_protoContentInMirrorHistory: true for content from history, false for foreign, null without a mirror', () => {
  const fx = makeFixture();
  const rel = 'prototypes/proto-abc/index.tsx';
  fx.commitToMirror(rel, 'export default function A() { return 1 }', 'v1');
  fx.commitToMirror(rel, 'export default function A() { return 2 }', 'v2');
  const out = runIsolated(fx, `
    const d = srv.DATA_REPOS.find((r) => r.id === 'data-tier-0');
    const rel = ${JSON.stringify(rel)};
    return {
      older: await srv._protoContentInMirrorHistory(d, rel, Buffer.from('export default function A() { return 1 }')),
      head: await srv._protoContentInMirrorHistory(d, rel, Buffer.from('export default function A() { return 2 }')),
      foreign: await srv._protoContentInMirrorHistory(d, rel, Buffer.from('export default function A() { return 3 }')),
      otherPath: await srv._protoContentInMirrorHistory(d, 'prototypes/proto-abc/styles.css', Buffer.from('export default function A() { return 1 }')),
    };
  `);
  assert.strictEqual(out.older, true, 'an older version from the mirror history');
  assert.strictEqual(out.head, true, 'the version at the mirror HEAD');
  assert.strictEqual(out.foreign, false, 'content that never passed through the repository');
  assert.strictEqual(out.otherPath, false, 'the salt comes from the path - the same content under another path is another blob');

  // A shallow clone: a version from before the boundary is unreachable, so "not
  // found" must not mean "never passed".
  const full = path.join(fx.root, 'full-mirror');
  fs.renameSync(fx.mirror, full);
  cp.execFileSync('git', ['clone', '-q', '--depth', '1', 'file://' + full, fx.mirror], { encoding: 'utf8' });
  const shallow = runIsolated(fx, `
    const d = srv.DATA_REPOS.find((r) => r.id === 'data-tier-0');
    const rel = ${JSON.stringify(rel)};
    return {
      head: await srv._protoContentInMirrorHistory(d, rel, Buffer.from('export default function A() { return 2 }')),
      beforeBoundary: await srv._protoContentInMirrorHistory(d, rel, Buffer.from('export default function A() { return 1 }')),
    };
  `);
  assert.strictEqual(shallow.head, true);
  assert.strictEqual(shallow.beforeBoundary, null, 'shallow clone: cannot tell, not "false"');

  fs.rmSync(path.join(fx.mirror, '.git'), { recursive: true, force: true });
  const noMirror = runIsolated(fx, `
    const d = srv.DATA_REPOS.find((r) => r.id === 'data-tier-0');
    return await srv._protoContentInMirrorHistory(d, ${JSON.stringify(rel)}, Buffer.from('x'));
  `);
  assert.strictEqual(noMirror, null, 'without a mirror there is no answer - null, not false');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('_protoPublishedGuard: lets the same and the synced version through, refuses one published from outside the repository', () => {
  const fx = makeFixture();
  const rel = 'prototypes/proto-abc/index.tsx';
  const older = 'export default function A() { return 1 }';
  const current = 'export default function A() { return 2 }';
  const foreign = 'export default function A() { return 99 } // published from a machine without a sync';
  fx.commitToMirror(rel, older, 'v1');
  fx.commitToMirror(rel, current, 'v2');
  writeFile(path.join(fx.plain, rel), current);
  writeFile(path.join(fx.plain, 'prototypes/proto-abc/styles.css'), '.a{}');
  fx.commitToMirror('prototypes/proto-abc/styles.css', '.a{}', 'css');
  const run = () => runIsolated(fx, "return await srv._protoPublishedGuard({ id: 'proto-abc', slug: 'abc' });");

  // 1. First publish: nothing in the shell.
  fx.commitToShell({ 'README.md': 'x' }, 'init');
  let v = run();
  assert.strictEqual(v.ok, true, 'no published copy - nothing to compare');

  // 2. Published == local.
  fx.commitToShell({ 'src/prototypes/abc/index.tsx': current, 'src/prototypes/abc/styles.css': '.a{}' }, 'deploy same');
  v = run();
  assert.strictEqual(v.ok, true);
  assert.ok(v.compared >= 2);

  // 3. Published is older, but from the mirror history: somebody pushed a newer
  //    version to the repository and did not publish it - the normal flow.
  fx.commitToShell({ 'src/prototypes/abc/index.tsx': older }, 'deploy older');
  v = run();
  assert.strictEqual(v.ok, true, 'a version from the repository history passes');

  // 4. The published content never passed through the repository: refusal.
  fx.commitToShell({ 'src/prototypes/abc/index.tsx': foreign }, 'deploy foreign');
  v = run();
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.stale, [rel]);
  assert.deepStrictEqual(v.unknown, []);

  // 5. Shared dependencies are in the gate the same way (DesktopShell.tsx went
  //    back eight lines in the same commit as the prototype).
  writeFile(path.join(fx.plain, 'components/DesktopShell.tsx'), 'local shell');
  fx.commitToMirror('components/DesktopShell.tsx', 'local shell', 'shell');
  fx.commitToShell({ 'src/prototypes/abc/index.tsx': current, 'src/components/DesktopShell.tsx': 'published shell never synced' }, 'deploy shell');
  v = run();
  assert.deepStrictEqual(v.stale, ['components/DesktopShell.tsx']);

  // 6. Without a mirror it cannot be checked: unknown, not ok - and not "stale".
  //    (A missing key goes the same `null` path, but loadMasterKey reads
  //    .encryption-key from this repository's ROOT, so a test cannot take it
  //    away without touching the developer's file.)
  fx.commitToShell({ 'src/components/DesktopShell.tsx': 'local shell', 'src/prototypes/abc/index.tsx': foreign }, 'deploy foreign again');
  fs.rmSync(path.join(fx.mirror, '.git'), { recursive: true, force: true });
  v = run();
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.stale, []);
  assert.deepStrictEqual(v.unknown, [rel]);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('_protoNarrowGeneratedForPublish: registry and codes from HEAD plus the published slug, no preview working copies', () => {
  const fx = makeFixture();
  const codesHead = srv._protoCodesFileContent({ 111111: 'pub1', 222222: 'pub2' });
  fx.commitToShell({
    'src/prototypes/pub1/index.tsx': 'export default 1',
    'src/prototypes/pub1/meta.json': JSON.stringify({ breakpoints: [375] }),
    'src/prototypes/pub2/index.tsx': 'export default 2',
    'src/prototypes/_shared/x.ts': 'export {}',
    'src/prototype-codes.ts': codesHead,
  }, 'published state');
  // Traces of the local preview: an unpublished prototype and a changed working
  // copy of a published one (other widths), plus its code in the working copy.
  writeFile(path.join(fx.shell, 'src/prototypes/preview-only/index.tsx'), 'export default 3');
  writeFile(path.join(fx.shell, 'src/prototypes/pub1/meta.json'), JSON.stringify({ breakpoints: [1920] }));
  writeFile(path.join(fx.shell, 'src/prototype-codes.ts'), srv._protoCodesFileContent({ 111111: 'pub1', 222222: 'pub2', 333333: 'preview-only' }));
  writeFile(path.join(fx.shell, 'src/prototypes/nowy/index.tsx'), 'export default 4');

  const out = runIsolated(fx, `
    const r = await srv._protoNarrowGeneratedForPublish({ slug: 'nowy', code: '444444', breakpoints: [375, 1920] });
    const fs = require('fs'); const path = require('path');
    return {
      slugs: r.slugs,
      registry: fs.readFileSync(path.join(${JSON.stringify(fx.shell)}, 'src/prototypes/registry.ts'), 'utf8'),
      codes: srv._protoParseCodes(fs.readFileSync(path.join(${JSON.stringify(fx.shell)}, 'src/prototype-codes.ts'), 'utf8')),
    };
  `);
  assert.deepStrictEqual(out.slugs, ['nowy', 'pub1', 'pub2']);
  assert.ok(!out.registry.includes('preview-only'), 'a preview working copy does not ship in the registry - the pipeline has no directory for it');
  assert.ok(out.registry.includes('"pub1": { load: () => import(\'./pub1/index\'), breakpoints: [375] }'), 'widths from meta.json AT HEAD, not from the working copy');
  assert.ok(out.registry.includes('"pub2": { load: () => import(\'./pub2/index\'), breakpoints: [375, 768, 960, 1280, 1536, 1920] }'), 'no meta.json at HEAD - the default set');
  assert.ok(out.registry.includes('"nowy": { load: () => import(\'./nowy/index\'), breakpoints: [375, 1920] }'));
  assert.deepStrictEqual(out.codes, { 111111: 'pub1', 222222: 'pub2', 444444: 'nowy' }, 'a preview prototype code never reaches the commit');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

// ── The unsent-source refusal (2026-10-07) ───────────────────────────────────────
// proto-96d41b3d8a79: dark mode and the compact view were published from a
// computer that had not pushed the team data; a second computer did not have
// them and its publish (after "Publish anyway") rolled them back. The publish
// now refuses while the prototype files are waiting to be sent.

test('protoUnsentSourceMessage names the files and the way out - in plain words', () => {
  const msg = srv.protoUnsentSourceMessage(['prototypes/proto-x/index.tsx']);
  assert.match(msg, /have not been sent/);
  assert.match(msg, /prototypes\/proto-x\/index\.tsx/);
  assert.match(msg, /Send the team data/);
  const many = srv.protoUnsentSourceMessage(Array.from({ length: 8 }, (_, i) => `f${i}`));
  assert.match(many, /\(8\)/);
  assert.match(many, /and 2 more/);
});

test('_protoUnsentPublishFiles sees the unsent files of the prototype, not somebody else\'s', () => {
  const fx = makeFixture();
  try {
    const rel = 'prototypes/proto-abc/index.tsx';
    const v1 = 'export default function A() { return null; }\n';
    fx.commitToMirror(rel, v1, 'source v1');
    fx.commitToMirror('prototypes/prototypes.json', fs.readFileSync(path.join(fx.plain, 'prototypes', 'prototypes.json'), 'utf8'), 'registry');
    writeFile(path.join(fx.plain, rel), v1);
    const call = `return (await srv._protoUnsentPublishFiles({ id: 'proto-abc', slug: 'abc' })).files;`;
    assert.deepStrictEqual(runIsolated(fx, call), [], 'a synced prototype passes');

    writeFile(path.join(fx.plain, 'prototypes', 'proto-other', 'index.tsx'), 'export default 1;\n');
    assert.deepStrictEqual(runIsolated(fx, call), [], 'an unsent OTHER prototype does not block this publish');

    writeFile(path.join(fx.plain, rel), v1 + '// change\n');
    writeFile(path.join(fx.plain, 'prototypes', 'proto-abc', 'styles.css'), '.a{}\n');
    assert.deepStrictEqual(runIsolated(fx, call), ['prototypes/proto-abc/index.tsx', 'prototypes/proto-abc/styles.css']);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});
