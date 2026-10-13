// tests/test_tools_status.mjs
// The pure half of Settings > Tools: version parsing, engine-range
// matching and the classifier that turns a probe result into a colour.
// Requiring server.js from a non-main module exports the helpers and never
// starts the HTTP server, so nothing here spawns a single probe.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');

test('_normalizeVersion drops the prerelease tail instead of returning NaN', () => {
  assert.strictEqual(srv._normalizeVersion('24.19.0'), '24.19.0');
  assert.strictEqual(srv._normalizeVersion('v24.19.0'), '24.19.0');
  // The case that matters: a naive segment-wise compare on "19.0-nightly"
  // yields NaN and silently answers "wrong version" for a healthy install.
  assert.strictEqual(srv._normalizeVersion('24.19.0-nightly'), '24.19.0');
  assert.strictEqual(srv._normalizeVersion('12.0.2+build.7'), '12.0.2');
  assert.strictEqual(srv._normalizeVersion('wersja-nieznana'), null);
  assert.strictEqual(srv._normalizeVersion(null), null);
});

test('_satisfiesEngineRange reads the ranges package.json actually carries', () => {
  // The two live ones, from `engines` in package.json.
  assert.strictEqual(srv._satisfiesEngineRange('24.19.0', '>=24 <25'), true);
  assert.strictEqual(srv._satisfiesEngineRange('25.0.0', '>=24 <25'), false);
  assert.strictEqual(srv._satisfiesEngineRange('23.9.0', '>=24 <25'), false);
  assert.strictEqual(srv._satisfiesEngineRange('12.0.2', '>=12 <13'), true);
  // A prerelease of a version inside the range is inside the range.
  assert.strictEqual(srv._satisfiesEngineRange('24.19.0-nightly', '>=24 <25'), true);
  // No range means nothing to violate.
  assert.strictEqual(srv._satisfiesEngineRange('1.2.3', ''), true);
});

test('_satisfiesEngineRange answers null - not false - for what it cannot read', () => {
  // "Cannot read this version" and "wrong version" send a person to two
  // different places, so they must not collapse into the same answer.
  assert.strictEqual(srv._satisfiesEngineRange('wersja-nieznana', '>=24 <25'), null);
  assert.strictEqual(srv._satisfiesEngineRange('24.19.0', '^24'), null);
});

test('_classifyTool separates absent, unreadable, degraded and wrong-version', () => {
  assert.strictEqual(srv._classifyTool({ installed: false }), 'missing');
  assert.strictEqual(srv._classifyTool({ installed: null }), 'unknown');
  assert.strictEqual(srv._classifyTool({ installed: true }), 'ok');
  // Present but needing a person: a locked vault, a stale code map.
  assert.strictEqual(srv._classifyTool({ installed: true, degraded: true }), 'warn');
  assert.strictEqual(
    srv._classifyTool({ installed: true, version: '24.19.0', expected: '>=24 <25' }), 'ok');
  assert.strictEqual(
    srv._classifyTool({ installed: true, version: '25.1.0', expected: '>=24 <25' }), 'warn');
  // An unreadable version against a real range is unknown, never a warning.
  assert.strictEqual(
    srv._classifyTool({ installed: true, version: 'nieznana', expected: '>=24 <25' }), 'unknown');
});

// The lock the tab reported was never the vault's: `bw status` reads BW_SESSION
// from its own environment, and the cockpit keeps that session in memory. Without
// this forwarding the probe answers "locked" while the top bar shows it open.
test('_toolExec hands the child the environment it was given', async () => {
  const read = ['-e', 'process.stdout.write(process.env.COCKPIT_PROBE_ENV || "brak")'];
  const withEnv = await srv._toolExec(process.execPath, read, null,
    { ...process.env, COCKPIT_PROBE_ENV: 'sesja' });
  assert.strictEqual(withEnv.ok, true);
  assert.strictEqual(withEnv.out, 'sesja');
  // Omitting it must inherit this process's environment, not empty it.
  const inherited = await srv._toolExec(process.execPath,
    ['-e', 'process.stdout.write(process.env.PATH ? "ma-path" : "puste")']);
  assert.strictEqual(inherited.out, 'ma-path');
});

test('_toolVersionFrom picks the version out of each CLI banner', () => {
  assert.strictEqual(srv._toolVersionFrom('2026.6.0'), '2026.6.0');
  assert.strictEqual(srv._toolVersionFrom('2.1.261 (Claude Code)'), '2.1.261');
  assert.strictEqual(srv._toolVersionFrom('git version 2.53.0'), '2.53.0');
  assert.strictEqual(srv._toolVersionFrom('Version 0.0.80'), '0.0.80');
  assert.strictEqual(srv._toolVersionFrom('command not found'), null);
});

test('_toolPlaywrightMcpSpec reads the pin from .mcp.json and refuses anything odd', () => {
  const cfg = { mcpServers: { playwright: { args: ['-y', '@playwright/mcp@0.0.80', '--output-dir', 'x'] } } };
  assert.strictEqual(srv._toolPlaywrightMcpSpec(cfg), '@playwright/mcp@0.0.80');
  // The value becomes an execFile argument, so anything that is not a plain
  // package spec is dropped rather than passed on.
  assert.strictEqual(srv._toolPlaywrightMcpSpec(
    { mcpServers: { playwright: { args: ['@playwright/mcp@0.0.80; rm -rf /'] } } }), null);
  assert.strictEqual(srv._toolPlaywrightMcpSpec({ mcpServers: {} }), null);
  assert.strictEqual(srv._toolPlaywrightMcpSpec(null), null);
});

test('_reindexFailureLine skips stack frames and finds the line that speaks', () => {
  // What the analyzer actually printed when it crashed: the last line is a
  // stack frame, which on a card looks like a bug in the cockpit and says
  // nothing about what went wrong.
  const crash = [
    '  GitNexus Analyzer',
    'Error: database is locked',
    '    at Object.run (file:///opt/homebrew/lib/node_modules/gitnexus/dist/db.js:12:3)',
    '    at async Command.<anonymous> (file:///opt/homebrew/lib/node_modules/gitnexus/dist/cli/lazy-action.js:33:9)',
  ].join('\n');
  assert.strictEqual(srv._reindexFailureLine(crash), 'Error: database is locked');
  // No recognisable failure line: fall back to the last real line, not a frame.
  assert.strictEqual(srv._reindexFailureLine('start' + '\n' + 'something odd' + '\n' + '    at x (y.js:1:1)'), 'something odd');
  assert.strictEqual(srv._reindexFailureLine(''), null);
  // ANSI escapes are stripped - the tail is raw terminal output.
  assert.strictEqual(srv._reindexFailureLine('\x1b[31mError: ENOENT\x1b[0m'), 'Error: ENOENT');
});

test('TOOL_JOBS is a closed table of argv arrays, never shell strings', () => {
  const ids = Object.keys(srv.TOOL_JOBS).sort();
  assert.deepStrictEqual(ids, [
    'bitwarden-install', 'claude-install', 'deps-install',
    'gitnexus-install', 'gitnexus-reindex', 'playwright-setup',
  ], 'adding a job is a deliberate edit here, not a config change');

  for (const id of ids) {
    const spec = srv.TOOL_JOBS[id].resolve();
    assert.strictEqual(typeof spec.cmd, 'string', `${id}: cmd`);
    assert.ok(spec.cmd.length > 0, `${id}: cmd is not empty`);
    assert.ok(Array.isArray(spec.args), `${id}: args is an array`);
    for (const a of spec.args) assert.strictEqual(typeof a, 'string', `${id}: every arg is a string`);
    // An argv array is what keeps this from being a shell: no argument may
    // smuggle a second command in.
    for (const a of spec.args) {
      assert.ok(!/[;&|`$]/.test(a), `${id}: argument "${a}" carries shell metacharacters`);
    }
  }

  // The installers must install the pinned/official packages, not whatever
  // happens to be latest under a similar name.
  const bw = srv.TOOL_JOBS['bitwarden-install'].resolve();
  assert.ok(bw.args.includes('@bitwarden/cli'));
  const claude = srv.TOOL_JOBS['claude-install'].resolve();
  assert.ok(claude.args.includes('@anthropic-ai/claude-code'));
  const gx = srv.TOOL_JOBS['gitnexus-install'].resolve();
  assert.ok(gx.args.some(a => a.startsWith('gitnexus@')), 'gitnexus is installed at a pinned version');

  // Only the dependency install needs a fresh process to take effect.
  assert.strictEqual(srv.TOOL_JOBS['deps-install'].restart, true);
  assert.ok(!srv.TOOL_JOBS['gitnexus-reindex'].restart);
});

test('only the code-map job retries itself, and only once', () => {
  // The analyzer refuses to run over an index a previous run left dirty and
  // repairs it on the NEXT invocation, so one retry is the difference between a
  // button that works and one you have to click twice. Nothing else here earns
  // that: a failed global install is a real failure a person has to see.
  assert.strictEqual(srv.TOOL_JOBS['gitnexus-reindex'].retryOnce, true);
  for (const id of Object.keys(srv.TOOL_JOBS)) {
    if (id === 'gitnexus-reindex') continue;
    assert.ok(!srv.TOOL_JOBS[id].retryOnce, id + ' must not retry silently');
  }
});
