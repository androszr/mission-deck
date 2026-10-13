// tests/test_figma_reference.mjs
// Figma reference: pure server helpers (parameter validation, child argv,
// the stdin line carrying the token, log redaction, manifest summary) plus the
// Python script run offline on fixtures (`--fixture`, no network, no token).
// There is no live Figma here.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const srv = require('../server.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'figma_reference.py');
const FIXTURE = path.join(HERE, 'fixtures', 'figma-reference-scope.json');
const FILE = 'aBcDeFgHiJkLmNoPqRsTuV';

function params(obj) { return new URLSearchParams(obj); }

function python() {
  for (const cmd of process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python']) {
    const r = spawnSync(cmd, process.platform === 'win32' && cmd === 'py' ? ['-3', '--version'] : ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return { cmd, prefix: cmd === 'py' ? ['-3'] : [] };
  }
  return null;
}
const PY = python();

test('_figmaReferenceParseParams accepts a valid request and normalises the node id', () => {
  const r = srv._figmaReferenceParseParams(params({ file: FILE, node: '96560-26612', id: 'proto-abc', scale: '1' }));
  assert.deepStrictEqual(r, { ok: true, file: FILE, nodeId: '96560:26612', outId: 'proto-abc', scale: '1', overwrite: false });
  const d = srv._figmaReferenceParseParams(params({ file: FILE, node: '1:2', id: 'x', overwrite: '1' }));
  assert.strictEqual(d.scale, '2');
  assert.strictEqual(d.overwrite, true);
});

test('_figmaReferenceParseParams rejects each bad field by name', () => {
  const base = { file: FILE, node: '1:2', id: 'proto-abc' };
  const field = (patch) => srv._figmaReferenceParseParams(params({ ...base, ...patch })).field;
  assert.strictEqual(field({ file: 'abc' }), 'file');
  assert.strictEqual(field({ file: FILE + '/..' }), 'file');
  assert.strictEqual(field({ node: '' }), 'node');
  assert.strictEqual(field({ node: '12' }), 'node');
  assert.strictEqual(field({ node: '1:2:3' }), 'node');
  assert.strictEqual(field({ id: '../x' }), 'id');
  assert.strictEqual(field({ id: 'Proto' }), 'id');
  assert.strictEqual(field({ id: 'a'.repeat(65) }), 'id');
  assert.strictEqual(field({ id: 'a\\b' }), 'id');
  assert.strictEqual(field({ scale: '0' }), 'scale');
  assert.strictEqual(srv._figmaReferenceParseParams(params({})).field, 'file');
});

test('the child argv never carries the token, only the --token-stdin flag', () => {
  const token = 'figd_SECRET-TOKEN-VALUE';
  const p = srv._figmaReferenceParseParams(params({ file: FILE, node: '1:2', id: 'proto-abc', overwrite: '1' }));
  const args = srv._figmaReferenceBuildArgs(p);
  assert.ok(args.includes('--token-stdin'));
  assert.ok(args.includes('--overwrite'));
  assert.deepStrictEqual(args.slice(args.indexOf('--file'), args.indexOf('--file') + 2), ['--file', FILE]);
  assert.ok(!args.join(' ').includes(token));
  assert.ok(!args.some((a) => /token=|figd_/i.test(a)));
});

test('the stdin handoff is one JSON line with figmaToken and nothing else', () => {
  const line = srv._figmaReferenceStdinLine('figd_abc');
  assert.ok(!line.includes('\n'));
  assert.deepStrictEqual(JSON.parse(line), { figmaToken: 'figd_abc' });
});

test('_figmaReferenceRedact removes the token from log text', () => {
  assert.strictEqual(srv._figmaReferenceRedact('GET x X-Figma-Token: figd_abc end figd_abc', 'figd_abc'), 'GET x X-Figma-Token: *** end ***');
  assert.strictEqual(srv._figmaReferenceRedact('plain', ''), 'plain');
  assert.strictEqual(srv._figmaReferenceRedact(null, 'x'), '');
});

test('_figmaReferenceSummarize counts sections and frames and tolerates junk', () => {
  const s = srv._figmaReferenceSummarize({
    fileKey: FILE, fileName: 'F', nodeId: '1:2', scale: 2, lastModified: '2026-09-01T10:00:00Z', _fetched_at: '2026-09-30T08:00:00+00:00',
    sections: [{ frames: [{}, {}] }, { frames: [{}] }],
  }, '2026-09-30T09:00:00.000Z');
  assert.strictEqual(s.frames, 3);
  assert.strictEqual(s.sections, 2);
  assert.strictEqual(s.fetchedAt, '2026-09-30T08:00:00+00:00');
  assert.strictEqual(s.figmaLastModified, '2026-09-01T10:00:00Z');
  assert.strictEqual(srv._figmaReferenceSummarize(null, 'x'), null);
  assert.strictEqual(srv._figmaReferenceSummarize({}, 'iso').fetchedAt, 'iso');
});

test('the Python script never reads the token from the environment, .env or the network fallback', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(src, /os\.environ\.get\(\s*["']FIGMA/);
  assert.doesNotMatch(src, /bitwarden\/env/);
  assert.doesNotMatch(src, /^\s*(?:import|from)\s+(?:dotenv|requests)\b/m);
  // ASCII source.
  assert.ok(!/[^\x00-\x7f]/.test(src), 'script source must be ASCII');
});

function runFixture(outId, extraEnv = {}, extraArgs = []) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-ref-test-'));
  const r = spawnSync(PY.cmd, [...PY.prefix, SCRIPT, '--fixture', FIXTURE, '--out-id', outId, ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    // No token in the environment - offline mode does not need one.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, USER_DATA_DIR: ud, PYTHONIOENCODING: 'utf-8', ...extraEnv },
  });
  return { r, ud, dir: path.join(ud, 'figma-reference', outId) };
}

test('fixture run writes the full bundle and progress goes to stdout', { skip: !PY }, () => {
  const { r, ud, dir } = runFixture('fx-bundle');
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n').filter((l) => l.startsWith('@@PROGRESS:'));
    assert.ok(lines.length >= 5);
    assert.ok(!r.stderr.includes('@@PROGRESS'));
    assert.strictEqual(JSON.parse(lines[lines.length - 1].slice('@@PROGRESS:'.length)).pct, 100);
    for (const f of ['frames.json', 'index.md', 'typography.md', 'colors.md', 'components.md', 'layout.md', 'token-map.md', 'hygiene.json',
      'section-sekcja-a.md', 'section-standalone-frames.md', path.join('dev-mode', 'README.md')]) {
      assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);
    }
    assert.ok(!fs.existsSync(path.join(dir, 'screenshots')), 'fixture mode never exports images');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
    assert.strictEqual(manifest.fileName, 'Fixture file');
    assert.deepStrictEqual(manifest.sections.map((s) => s.name), ['Sekcja A', 'Standalone frames']);
    assert.strictEqual(manifest.sections[0].frames[0].png, 'screenshots/10-2.png');
    assert.strictEqual(manifest.sections[0].frames[0].w, '1440');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('fixture run renders the layout tree and text table from the node JSON', { skip: !PY }, () => {
  const { r, ud, dir } = runFixture('fx-tree');
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const md = fs.readFileSync(path.join(dir, 'section-sekcja-a.md'), 'utf8');
    assert.match(md, /- Ekran glowny: V 1440x900 gap=16 pad=24 bg=#ffffff/);
    assert.match(md, /  - uni \/ badge \[inst\]: H 80x24 pad=0\/8 bg=#00994f/);
    assert.match(md, /\| 32\/600 \(lh 40\) \| Ekran glowny \| `#262626` \|/);
    assert.match(md, /Nowy \\\| status/, 'pipe inside a cell is escaped');
    assert.match(md, /\| uni \/ badge \| size=big \| 80x24 \| 1 \|/);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('token-map maps hex to DS names (never --fds-*) and marks NO-MATCH', { skip: !PY }, () => {
  const { r, ud, dir } = runFixture('fx-tokens');
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const map = fs.readFileSync(path.join(dir, 'token-map.md'), 'utf8');
    assert.doesNotMatch(map, /--fds-/);
    assert.match(map, /\| `#1a334c` \| 1 \| \u2014 \| \*\*NO-MATCH\*\* \|/);
    assert.match(map, /Matched: \d+\/4 colors/);
    const colors = fs.readFileSync(path.join(dir, 'colors.md'), 'utf8');
    assert.doesNotMatch(colors, /--fds-/);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('hygiene.json is written and the index carries the hygiene section', { skip: !PY }, () => {
  const { r, ud, dir } = runFixture('fx-hyg');
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const h = JSON.parse(fs.readFileSync(path.join(dir, 'hygiene.json'), 'utf8'));
    assert.strictEqual(h.count, h.findings.length);
    assert.match(fs.readFileSync(path.join(dir, 'index.md'), 'utf8'), /## Figma hygiene \(\d+\)/);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('without --fixture and without a stdin token the script refuses and touches no network', { skip: !PY }, () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-ref-test-'));
  try {
    const r = spawnSync(PY.cmd, [...PY.prefix, SCRIPT, '--token-stdin', '--file', FILE, '--node-id', '1:2', '--out-id', 'fx-notoken'], {
      cwd: ROOT, encoding: 'utf8', input: '{}\n',
      // Even a token in the environment must not be used.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, USER_DATA_DIR: ud, FIGMA_TOKEN: 'figd_should_be_ignored' },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /no Figma token/);
    assert.ok(!r.stderr.includes('figd_should_be_ignored'));
    assert.ok(!fs.existsSync(path.join(ud, 'figma-reference', 'fx-notoken')));
    const noFlag = spawnSync(PY.cmd, [...PY.prefix, SCRIPT, '--file', FILE, '--node-id', '1:2', '--out-id', 'fx-notoken'], {
      cwd: ROOT, encoding: 'utf8', input: '{"figmaToken":"x"}\n',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, USER_DATA_DIR: ud, FIGMA_TOKEN: 'figd_should_be_ignored' },
    });
    assert.strictEqual(noFlag.status, 1, 'the token is only read behind --token-stdin');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('the scope guard aborts a re-run for a different node unless --overwrite', { skip: !PY }, () => {
  const { r, ud, dir } = runFixture('fx-guard');
  try {
    assert.strictEqual(r.status, 0, r.stderr);
    const other = spawnSync(PY.cmd, [...PY.prefix, SCRIPT, '--fixture', FIXTURE, '--node-id', '9:9', '--out-id', 'fx-guard'], {
      cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, USER_DATA_DIR: ud },
    });
    assert.strictEqual(other.status, 2);
    assert.match(other.stderr, /ABORT/);
    const forced = spawnSync(PY.cmd, [...PY.prefix, SCRIPT, '--fixture', FIXTURE, '--node-id', '9:9', '--out-id', 'fx-guard', '--overwrite'], {
      cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, USER_DATA_DIR: ud },
    });
    assert.strictEqual(forced.status, 0, forced.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8')).nodeId, '9:9');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('the child argv carries --if-changed only when asked (prototype job runner)', () => {
  const a = srv._figmaReferenceBuildArgs({ file: FILE, nodeId: '1:2', outId: 'proto-a', scale: '1', overwrite: true, ifChanged: true });
  assert.ok(a.includes('--if-changed') && a.includes('--overwrite'));
  assert.ok(!srv._figmaReferenceBuildArgs({ file: FILE, nodeId: '1:2', outId: 'proto-a', scale: '1' }).includes('--if-changed'));
});

test('reference_up_to_date: complete same-scope reference + unchanged lastModified skips; anything else re-exports', { skip: !PY }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figref-cache-'));
  try {
    const code = `
import json, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))})
import figma_reference as fr
out = ${JSON.stringify(dir)}
os.makedirs(os.path.join(out, 'screenshots'), exist_ok=True)
man = {'fileKey': 'K', 'nodeId': '1:2', 'scale': 1, 'lastModified': '2026-10-01T00:00:00Z',
       'sections': [{'frames': [{'png': 'screenshots/a.png'}]}]}
json.dump(man, open(os.path.join(out, 'frames.json'), 'w'))
calls = []
class R:
    def __init__(self, lm): self.lm = lm
    def raise_for_status(self): pass
    def json(self): return {'lastModified': self.lm}
lm = {'v': '2026-10-01T00:00:00Z'}
fr._figma_get = lambda url, token, params=None, timeout=60: calls.append(params) or R(lm['v'])
res = {}
res['png_missing'] = fr.reference_up_to_date(out, 'K', '1:2', 1, False, 't')
open(os.path.join(out, 'screenshots', 'a.png'), 'wb').write(b'x')
res['fresh'] = fr.reference_up_to_date(out, 'K', '1:2', 1, False, 't')
res['other_node'] = fr.reference_up_to_date(out, 'K', '9:9', 1, False, 't')
res['other_scale'] = fr.reference_up_to_date(out, 'K', '1:2', 2, False, 't')
lm['v'] = '2026-10-08T00:00:00Z'
res['changed'] = fr.reference_up_to_date(out, 'K', '1:2', 1, False, 't')
res['depth'] = calls[0]
print(json.dumps(res))
`;
    const r = spawnSync(PY.cmd, [...PY.prefix, '-c', code], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(res, { png_missing: false, fresh: true, other_node: false, other_scale: false, changed: false, depth: { depth: 1 } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
