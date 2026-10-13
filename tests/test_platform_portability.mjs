// tests/test_platform_portability.mjs
// The Windows/macOS seams a new install crosses: the netstat parser behind
// `npm start` and `npm stop`, the shell decision for .cmd shims, the Claude CLI
// resolver, the per-system Python candidates and the MCP launcher that
// .mcp.json goes through on both systems.

import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { listeningPidsFromNetstat } = require('../scripts/_port.js');
const srv = require('../server.js');

test('listeningPidsFromNetstat keeps the server and spares its clients', () => {
  // A real `netstat -ano | findstr :3001` on a machine with the cockpit up,
  // one browser tab open and a second server on 30010.
  const out = [
    '  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING       4242',
    '  TCP    [::1]:3001             [::]:0                 LISTENING       4242',
    '  TCP    127.0.0.1:52144        127.0.0.1:3001         ESTABLISHED     9001',
    '  TCP    127.0.0.1:3001         127.0.0.1:52144        ESTABLISHED     4242',
    '  TCP    127.0.0.1:52145        127.0.0.1:3001         TIME_WAIT       0',
    '  TCP    0.0.0.0:30010          0.0.0.0:0              LISTENING       7777',
    '  UDP    0.0.0.0:3001           *:*                                    5555',
  ].join('\r\n');
  assert.deepStrictEqual(listeningPidsFromNetstat(out, 3001), ['4242']);
  // The bug this replaces: the last column of a client row is the CLIENT.
  assert.ok(!listeningPidsFromNetstat(out, 3001).includes('9001'));
  assert.deepStrictEqual(listeningPidsFromNetstat(out, 30010), ['7777']);
  assert.deepStrictEqual(listeningPidsFromNetstat('', 3001), []);
  assert.deepStrictEqual(listeningPidsFromNetstat(undefined, 3001), []);
});

test('_toolShell gives a shell to .cmd shims only, and only on Windows', () => {
  assert.strictEqual(srv._toolShell('npm.cmd', true), true);
  assert.strictEqual(srv._toolShell('gitnexus.cmd', true), true);
  assert.strictEqual(srv._toolShell('something.BAT', true), true);
  // process.execPath is "C:\Program Files\nodejs\node.exe" on a default
  // install: with a shell it would split at the space.
  assert.strictEqual(srv._toolShell('C:\\Program Files\\nodejs\\node.exe', true), false);
  assert.strictEqual(srv._toolShell('git', true), false);
  assert.strictEqual(srv._toolShell('npm.cmd', false), false);
  assert.strictEqual(srv._toolShell('', true), false);
});

test('_claudeCli is the bare CLI without a shell outside Windows', { skip: process.platform === 'win32' }, () => {
  assert.deepStrictEqual(srv._claudeCli(), { cmd: 'claude', shell: false });
});

test('_pythonCandidates asks each system the way it answers', () => {
  assert.deepStrictEqual(srv._pythonCandidates('win32'), [
    ['py', ['-3', '--version']], ['python', ['--version']],
  ]);
  assert.deepStrictEqual(srv._pythonCandidates('darwin'), [
    ['python3', ['--version']], ['python', ['--version']],
  ]);
  assert.deepStrictEqual(srv._pythonCandidates('linux'), srv._pythonCandidates('darwin'));
  // Both distributions print "Python X.Y.Z"; 2.x prints it on stderr, which
  // _toolExec already folds into `out`.
  assert.strictEqual(srv._toolVersionFrom('Python 3.12.4'), '3.12.4');
  assert.strictEqual(srv._satisfiesEngineRange('3.12.4', '>=3.10 <4'), true);
  assert.strictEqual(srv._satisfiesEngineRange('2.7.18', '>=3.10 <4'), false);
});

test('mcp-launch forwards the exit code and refuses to run nothing', () => {
  const launcher = path.join(ROOT, 'scripts', 'mcp-launch.js');
  const ok = spawnSync(process.execPath, [launcher, process.execPath, '-e', 'process.exit(3)'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(ok.status, 3);
  const none = spawnSync(process.execPath, [launcher], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(none.status, 2);
  assert.match(none.stderr, /usage/);
});

test('.mcp.json goes through the launcher for every server', () => {
  const mcp = JSON.parse(require('fs').readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  for (const [name, spec] of Object.entries(mcp.mcpServers)) {
    assert.strictEqual(spec.command, 'node', `${name}: command is node, a real binary on both systems`);
    assert.strictEqual(spec.args[0], 'scripts/mcp-launch.js', `${name}: first arg is the launcher`);
  }
  // The pin probe still finds the Playwright spec behind the launcher.
  assert.strictEqual(srv._toolPlaywrightMcpSpec(mcp), '@playwright/mcp@0.0.80');
});
