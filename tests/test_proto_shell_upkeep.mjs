// tests/test_proto_shell_upkeep.mjs
// Upkeep of the prototype build shell (parity audit, steps 4, 8 and 9):
//   R-04  vite.config.ts in the narrow publish staging,
//   R-07  the Vite marker with startedAt and a restart of OUR OWN process only,
//   R-05  libraries imported by a prototype: install them or 503.
// Nothing here runs the real npm, git or Vite and nothing writes to
// data-sub-repositories/: every shell, marker and "data source" is a temp
// directory, npm is a fake node script first on PATH, and the paths that
// depend on module constants (PROTO_BUILD_DIR) are checked in a SEPARATE node
// process with its own POC_PAGES_DATA_DIR - the same pattern as tests/test_proto_build.mjs.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');
const SERVER_PATH = fileURLToPath(new URL('../server.js', import.meta.url));

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runInIsolatedShell(buildDir, subReposDir, code, extraEnv) {
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
      POC_PAGES_DATA_DIR: buildDir,
      DATA_SUB_REPOS_DIR: subReposDir,
      ...(extraEnv || {}),
    },
  });
  return JSON.parse(out);
}

// The async variant: a test that itself holds an HTTP server on a port must
// not block the event loop with execFileSync, or the child's probe would get
// no answer.
function runInIsolatedShellAsync(buildDir, subReposDir, code, extraEnv) {
  const script = `
'use strict';
const srv = require(${JSON.stringify(SERVER_PATH)});
(async () => {
  const out = await (async () => { ${code} })();
  process.stdout.write(JSON.stringify(out === undefined ? null : out));
})().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;
  return new Promise((resolve, reject) => {
    cp.execFile(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, IS_TEST_MODE: '1', POC_PAGES_DATA_DIR: buildDir, DATA_SUB_REPOS_DIR: subReposDir, ...(extraEnv || {}) },
    }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(JSON.parse(stdout))));
  });
}

// A fake npm. `run dev` listens on --port (a healthy Vite), `install`
// adds packages to package.json and creates node_modules/<name>/package.json
// (or fails in 'fail' mode). The mode and the log are BAKED into the script,
// because _protoNpmEnv passes the child an allowlist, not process.env.
function writeFakeNpm(binDir, opts = {}) {
  const npmPath = path.join(binDir, 'npm');
  const script = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const argv = process.argv.slice(2);
const logPath = ${JSON.stringify(opts.argvLog || '')};
if (logPath) fs.appendFileSync(logPath, JSON.stringify(argv) + '\\n');
const installMode = ${JSON.stringify(opts.install || 'ok')};
if (argv[0] === 'install') {
  if (installMode === 'fail') { process.stderr.write('npm ERR! network ENOTFOUND registry\\n'); process.exit(1); }
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  const named = argv.slice(1).filter((a) => !a.startsWith('-'));
  // A bare npm install installs what package.json already declares.
  if (named.length === 0) {
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      const dir = path.join(process.cwd(), 'node_modules', ...name.split('/'));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
    }
  }
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    const at = a.lastIndexOf('@');
    const name = a.slice(0, at); const version = a.slice(at + 1);
    pkg.dependencies[name] = version;
    const dir = path.join(process.cwd(), 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  if (${JSON.stringify(Boolean(opts.lock))}) {
    fs.writeFileSync(path.join(process.cwd(), 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: pkg.dependencies } } }, null, 2));
  }
  process.exit(0);
}
const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 5173;
const server = http.createServer((req, res) => { res.end('ok'); });
server.listen(port, 'localhost', () => {});
`;
  fs.writeFileSync(npmPath, script, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'npm.cmd'), `@echo off\r\n"${process.execPath}" "${npmPath}" %*\r\n`);
}

async function unusedPort() {
  const l = net.createServer();
  await new Promise((resolve, reject) => { l.once('error', reject); l.listen(0, 'localhost', resolve); });
  const port = l.address().port;
  await new Promise((resolve) => l.close(resolve));
  return port;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killQuietly(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') cp.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch { /* already dead */ }
}

// -- R-04 -----------------------------------------------------------------

test('R-04: every config file Vite reads and the npm manifests ride in the publish staging', () => {
  const staging = new Set(srv.PROTO_PUBLISH_SHELL_FILES);
  assert.ok(staging.has('vite.config.ts'), 'vite.config.ts carries the Bryntum alias - without it the hosting builds something other than local');
  // Guardrail: a file Vite reads at startup (outside node_modules) that the
  // commit does not carry means a local build different from the hosted one.
  for (const rel of srv.PROTO_VITE_CONFIG_FILES) {
    if (rel.startsWith('node_modules/')) continue;
    assert.ok(staging.has(rel), `${rel} is read by Vite but does not ride in the publish commit`);
  }
  // Installing a prototype's libraries rewrites both npm manifests.
  assert.ok(staging.has('package.json') && staging.has('package-lock.json'));
  assert.ok(!staging.has('.npmrc'), '.npmrc is rewritten only by the seed, never the clone - it is not part of a publish');
});

test('R-04: _protoPublishAddPaths returns vite.config.ts when the file exists in the shell', () => {
  const buildDir = tmp('upkeep-stage-build-');
  const subReposDir = tmp('upkeep-stage-repos-');
  try {
    for (const f of ['package.json', 'package-lock.json', 'postcss.config.js', 'vite.config.ts']) {
      fs.writeFileSync(path.join(buildDir, f), '{}');
    }
    const paths = runInIsolatedShell(buildDir, subReposDir, "return srv._protoPublishAddPaths('demo');");
    for (const f of ['package.json', 'package-lock.json', 'postcss.config.js', 'vite.config.ts']) {
      assert.ok(paths.includes(f), `${f} missing from ${JSON.stringify(paths)}`);
    }
    assert.ok(!paths.includes('vite.config.js'), 'a missing file is filtered out - git add on an unknown path fails');
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(subReposDir, { recursive: true, force: true });
  }
});

// -- R-07 -----------------------------------------------------------------

test('R-07: _protoViteIsStale compares startedAt with the newest mtime, a marker without startedAt is not stale', () => {
  assert.strictEqual(srv._protoViteIsStale({ startedAt: 1000 }, 2000), true);
  assert.strictEqual(srv._protoViteIsStale({ startedAt: 2000 }, 1000), false);
  assert.strictEqual(srv._protoViteIsStale({ startedAt: 2000 }, 0), false, 'no config files is not a signal');
  assert.strictEqual(srv._protoViteIsStale({ pid: 5 }, 9e15), false, 'a marker from before the startedAt field is adopted, not restarted');
  assert.strictEqual(srv._protoViteIsStale(null, 9e15), false);
});

test('R-07: _protoViteConfigNewestMtime looks at the config file list, node_modules/.package-lock.json included', () => {
  const dir = tmp('upkeep-mtime-');
  try {
    assert.strictEqual(srv._protoViteConfigNewestMtime(dir), 0);
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.utimesSync(path.join(dir, 'package.json'), new Date(1_000_000), new Date(1_000_000));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', '.package-lock.json'), '{}');
    fs.utimesSync(path.join(dir, 'node_modules', '.package-lock.json'), new Date(5_000_000), new Date(5_000_000));
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x');
    assert.strictEqual(srv._protoViteConfigNewestMtime(dir), 5_000_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R-07: a package.json change after the start restarts our own Vite (new PID), no change keeps the PID', async () => {
  const binDir = tmp('upkeep-vite-bin-');
  const buildDir = tmp('upkeep-vite-build-');
  const subReposDir = tmp('upkeep-vite-repos-');
  const markerDir = tmp('upkeep-vite-marker-');
  const markerPath = path.join(markerDir, 'proto-vite.json');
  writeFakeNpm(binDir);
  fs.writeFileSync(path.join(buildDir, 'package.json'), '{"name":"shell"}');
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(buildDir, 'package.json'), past, past);
  const env = {
    PATH: binDir + path.delimiter + process.env.PATH,
    PROTO_VITE_PORT: String(await unusedPort()),
    PROTOTYPE_VITE_MARKER_PATH: markerPath,
    PROTO_VITE_PROBE_MS: '100',
  };
  const readMarker = () => JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  const pids = [];
  try {
    // Every call in a SEPARATE process = an app restart: _protoViteChild
    // is null and the marker is the only knowledge about the server.
    assert.strictEqual(runInIsolatedShell(buildDir, subReposDir, 'return await srv._protoEnsureViteRunning();', env).ok, true);
    const first = readMarker();
    pids.push(first.pid);
    assert.ok(first.pid > 0 && first.startedAt > 0, `the marker must carry pid and startedAt: ${JSON.stringify(first)}`);

    assert.strictEqual(runInIsolatedShell(buildDir, subReposDir, 'return await srv._protoEnsureViteRunning();', env).ok, true);
    assert.strictEqual(readMarker().pid, first.pid, 'without a config change the server is reused');

    const future = new Date(first.startedAt + 5_000);
    fs.utimesSync(path.join(buildDir, 'package.json'), future, future);
    assert.strictEqual(runInIsolatedShell(buildDir, subReposDir, 'return await srv._protoEnsureViteRunning();', env).ok, true);
    const second = readMarker();
    pids.push(second.pid);
    assert.notStrictEqual(second.pid, first.pid, 'a stale server must be replaced by a new process');
    assert.ok(second.startedAt > first.startedAt);
    assert.strictEqual(alive(first.pid), false, 'the old, own Vite process must be stopped');
  } finally {
    for (const pid of pids) killQuietly(pid);
    for (const d of [binDir, buildDir, subReposDir, markerDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('R-07: a stale server whose marker has no PID is left alone (somebody else\'s process)', async () => {
  const buildDir = tmp('upkeep-foreign-build-');
  const subReposDir = tmp('upkeep-foreign-repos-');
  const markerDir = tmp('upkeep-foreign-marker-');
  const markerPath = path.join(markerDir, 'proto-vite.json');
  const port = await unusedPort();
  const foreign = http.createServer((req, res) => res.end('foreign'));
  await new Promise((resolve) => foreign.listen(port, 'localhost', resolve));
  try {
    fs.writeFileSync(path.join(buildDir, 'package.json'), '{}');
    fs.writeFileSync(markerPath, JSON.stringify({ dir: path.resolve(buildDir), port, startedAt: 1 }));
    const out = await runInIsolatedShellAsync(buildDir, subReposDir, 'return await srv._protoEnsureViteRunning();', {
      PROTO_VITE_PORT: String(port),
      PROTOTYPE_VITE_MARKER_PATH: markerPath,
    });
    assert.strictEqual(out.ok, false);
    assert.match(out.message, /did not start/);
    assert.ok(foreign.listening, 'a foreign server on the port stays untouched');
  } finally {
    await new Promise((resolve) => foreign.close(resolve));
    for (const d of [buildDir, subReposDir, markerDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('R-07: a marker from before startedAt is adopted - no restart, startedAt added', async () => {
  const buildDir = tmp('upkeep-adopt-build-');
  const subReposDir = tmp('upkeep-adopt-repos-');
  const markerDir = tmp('upkeep-adopt-marker-');
  const markerPath = path.join(markerDir, 'proto-vite.json');
  const port = await unusedPort();
  const server = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(port, 'localhost', resolve));
  // The PID in the marker is a separate, sleeping child - if the logic wrongly
  // restarted, that child dies, not the test process.
  const sleeper = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(path.join(buildDir, 'package.json'), '{}');
    fs.writeFileSync(markerPath, JSON.stringify({ dir: path.resolve(buildDir), port, pid: sleeper.pid }));
    const out = await runInIsolatedShellAsync(buildDir, subReposDir, 'return await srv._protoEnsureViteRunning();', {
      PROTO_VITE_PORT: String(port),
      PROTOTYPE_VITE_MARKER_PATH: markerPath,
    });
    assert.strictEqual(out.ok, true);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    assert.strictEqual(marker.pid, sleeper.pid);
    assert.ok(marker.startedAt > 0, 'adoption adds startedAt');
    assert.strictEqual(alive(sleeper.pid), true, 'an adopted process is not stopped');
  } finally {
    sleeper.kill();
    await new Promise((resolve) => server.close(resolve));
    for (const d of [buildDir, subReposDir, markerDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// -- R-05 -----------------------------------------------------------------

test('R-05: _protoImportedLibraries returns the roots of non-React libraries, no local paths', () => {
  const tsx = [
    "import React from 'react'",
    "import type { Schema } from 'write-excel-file/browser'",
    "import { BryntumScheduler } from '@bryntum/scheduler-react'",
    "import '@bryntum/scheduler/scheduler.stockholm.css'",
    "import { DSButton } from '../../ds'",
    "// import x from 'jspdf'",
    'export default async function App() { await import(\'html2canvas\'); return null }',
  ].join('\n');
  assert.deepStrictEqual(srv._protoImportedLibraries(tsx), ['@bryntum/scheduler', '@bryntum/scheduler-react', 'html2canvas', 'write-excel-file']);
});

test('R-05: _protoMissingLibraries needs a declaration and node_modules, a Vite alias to the trial build counts', () => {
  const dir = tmp('upkeep-libs-');
  try {
    const put = (name, version) => {
      const d = path.join(dir, 'node_modules', ...name.split('/'));
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, version }));
    };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: { '@bryntum/scheduler-trial': '^7.3.3', '@bryntum/scheduler-react': '^7.3.3', jspdf: '4.2.1' },
    }));
    put('@bryntum/scheduler-trial', '7.3.6');
    put('@bryntum/scheduler-react', '7.3.6');
    put('html2canvas', '1.4.1'); // in node_modules, but package.json does not declare it
    const names = ['@bryntum/scheduler', '@bryntum/scheduler-react', 'html2canvas', 'jspdf'];
    assert.deepStrictEqual(srv._protoMissingLibraries(names, dir), ['@bryntum/scheduler', 'html2canvas', 'jspdf'],
      'without the alias the scheduler is unavailable; a declaration without node_modules or the reverse is missing');
    fs.writeFileSync(path.join(dir, 'vite.config.ts'), "export default { resolve: { alias: { '@bryntum/scheduler': '@bryntum/scheduler-trial' } } }\n");
    assert.deepStrictEqual(srv._protoMissingLibraries(names, dir), ['html2canvas', 'jspdf'],
      'the clone aliases @bryntum/scheduler to the trial build - that works and must not get a 503');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R-05: _protoEnsureLibraryDeps installs the export libraries at pinned versions (--save-exact)', () => {
  const binDir = tmp('upkeep-install-bin-');
  const buildDir = tmp('upkeep-install-build-');
  const subReposDir = tmp('upkeep-install-repos-');
  const argvLog = path.join(binDir, 'argv.log');
  writeFakeNpm(binDir, { argvLog });
  fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.3.1' } }));
  try {
    const tsx = "import type { Schema } from 'write-excel-file/browser'\nexport default async function A() { await import('jspdf'); await import('html2canvas'); return null }\n";
    const out = runInIsolatedShell(buildDir, subReposDir, `return await srv._protoEnsureLibraryDeps(${JSON.stringify(tsx)}, () => {});`,
      { PATH: binDir + path.delimiter + process.env.PATH });
    assert.strictEqual(out.ok, true, JSON.stringify(out));
    assert.deepStrictEqual(out.installed.sort(), ['html2canvas', 'jspdf', 'write-excel-file']);
    const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8').trim().split('\n')[0]);
    assert.strictEqual(argv[0], 'install');
    assert.ok(argv.includes('--save-exact'));
    for (const spec of ['write-excel-file@4.1.1', 'jspdf@4.2.1', 'html2canvas@1.4.1']) assert.ok(argv.includes(spec), spec);
    const pkg = JSON.parse(fs.readFileSync(path.join(buildDir, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.dependencies['write-excel-file'], '4.1.1', 'the package.json entry rides in the publish commit');
    // A second call installs nothing.
    const again = runInIsolatedShell(buildDir, subReposDir, `return await srv._protoEnsureLibraryDeps(${JSON.stringify(tsx)}, () => {});`,
      { PATH: binDir + path.delimiter + process.env.PATH });
    assert.deepStrictEqual(again, { ok: true, installed: [] });
    assert.strictEqual(fs.readFileSync(argvLog, 'utf8').trim().split('\n').length, 1);
  } finally {
    for (const d of [binDir, buildDir, subReposDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('R-05: a library declared by the clone but not installed gets a plain npm install - the pin never overrides the version', () => {
  const binDir = tmp('upkeep-declared-bin-');
  const buildDir = tmp('upkeep-declared-build-');
  const subReposDir = tmp('upkeep-declared-repos-');
  const argvLog = path.join(binDir, 'argv.log');
  writeFakeNpm(binDir, { argvLog });
  // The state after a clone pull: a newer declaration than the app's pin, node_modules without the package.
  fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({ dependencies: { jspdf: '^4.3.0' } }));
  try {
    const tsx = "export default async function A() { await import('jspdf'); return null }\n";
    const out = runInIsolatedShell(buildDir, subReposDir, `return await srv._protoEnsureLibraryDeps(${JSON.stringify(tsx)}, () => {});`,
      { PATH: binDir + path.delimiter + process.env.PATH });
    assert.strictEqual(out.ok, true, JSON.stringify(out));
    const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8').trim().split('\n')[0]);
    assert.strictEqual(argv[0], 'install');
    assert.ok(!argv.includes('jspdf@4.2.1') && !argv.includes('--save-exact'), `the pin must not override the clone's declaration: ${argv.join(' ')}`);
    const pkg = JSON.parse(fs.readFileSync(path.join(buildDir, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.dependencies.jspdf, '^4.3.0', 'a publish must not ship a version downgrade');
  } finally {
    for (const d of [binDir, buildDir, subReposDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('R-05: a failed install and a missing Bryntum give a refusal with a plain explanation, Bryntum is never installed', () => {
  const binDir = tmp('upkeep-fail-bin-');
  const buildDir = tmp('upkeep-fail-build-');
  const subReposDir = tmp('upkeep-fail-repos-');
  const argvLog = path.join(binDir, 'argv.log');
  writeFakeNpm(binDir, { argvLog, install: 'fail' });
  fs.writeFileSync(path.join(buildDir, 'package.json'), '{}');
  const env = { PATH: binDir + path.delimiter + process.env.PATH };
  try {
    const bry = "import { BryntumScheduler } from '@bryntum/scheduler-react'\nexport default function A() { return null }\n";
    const outB = runInIsolatedShell(buildDir, subReposDir, `return await srv._protoEnsureLibraryDeps(${JSON.stringify(bry)}, () => {});`, env);
    assert.strictEqual(outB.ok, false);
    assert.deepStrictEqual(outB.missing, ['@bryntum/scheduler-react']);
    assert.match(outB.message, /licensed library/);
    assert.match(outB.message, /decision on the Bryntum license/);
    assert.ok(!fs.existsSync(argvLog), 'Bryntum is never installed by the app');

    const xls = "import writeXlsxFile from 'write-excel-file'\nexport default function A() { return null }\n";
    const outX = runInIsolatedShell(buildDir, subReposDir, `return await srv._protoEnsureLibraryDeps(${JSON.stringify(xls)}, () => {});`, env);
    assert.strictEqual(outX.ok, false);
    assert.deepStrictEqual(outX.missing, ['write-excel-file']);
    assert.match(outX.message, /write-excel-file/);
    assert.match(outX.message, /failed/);
    assert.match(outX.message, /ENOTFOUND/, 'the reason from npm reaches the message');
  } finally {
    for (const d of [binDir, buildDir, subReposDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// Why this is not an API test: POST /api/prototypes/local-preview/<id> answers
// 503 "disabled in test mode" as its FIRST step under IS_TEST_MODE, and
// tests/_api_helper.js always spawns the server with NODE_ENV=test (the suite
// walks the developer's own tree, where the route would run npm and Vite in
// the real clone). tests/test_api_prototypes.js pins that refusal; the
// deps-missing branch is driven here, at the functions the handler calls, plus
// a source pin of the handler's mapping to 503 / 'deps-missing'.
test('R-05: a clone or vendor without the Bryntum package -> ok:false, a plain message, npm not run', () => {
  const binDir = tmp('upkeep-bry-bin-');
  const buildDir = tmp('upkeep-bry-build-');
  const subReposDir = tmp('upkeep-bry-repos-');
  const argvLog = path.join(binDir, 'argv.log');
  writeFakeNpm(binDir, { argvLog });
  const env = { PATH: binDir + path.delimiter + process.env.PATH };
  const tsx = "import { BryntumScheduler } from '@bryntum/scheduler-react'\nimport '@bryntum/scheduler/scheduler.stockholm.css'\nexport default function A() { return null }\n";
  try {
    // (1) a clone without a declaration: the shell's package.json does not know Bryntum at all.
    fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.3.1' } }));
    let out = runInIsolatedShell(buildDir, subReposDir, `return await srv._protoEnsureLibraryDeps(${JSON.stringify(tsx)}, () => {});`, env);
    assert.strictEqual(out.ok, false);
    assert.deepStrictEqual(out.missing, ['@bryntum/scheduler', '@bryntum/scheduler-react']);
    // (2) a clone with an alias to the trial build, but vendor/node_modules without the package.
    fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({ dependencies: { '@bryntum/scheduler-trial': '^7.3.3', '@bryntum/scheduler-react': '^7.3.3' } }));
    fs.writeFileSync(path.join(buildDir, 'vite.config.ts'), "export default { resolve: { alias: { '@bryntum/scheduler': '@bryntum/scheduler-trial' } } }\n");
    out = runInIsolatedShell(buildDir, subReposDir, `return await srv._protoEnsureLibraryDeps(${JSON.stringify(tsx)}, () => {});`, env);
    assert.strictEqual(out.ok, false);
    assert.deepStrictEqual(out.missing, ['@bryntum/scheduler', '@bryntum/scheduler-react']);
    for (const m of [/The prototype imports @bryntum\/scheduler, @bryntum\/scheduler-react/, /the build shell does not have that package/, /licensed library/]) {
      assert.match(out.message, m);
    }
    assert.match(out.message, /^[\x20-\x7e]+$/, 'the message reaches a person - plain English');
    assert.ok(!fs.existsSync(argvLog), 'Bryntum is never installed by the app - npm not even once');
  } finally {
    for (const d of [binDir, buildDir, subReposDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('R-05: _protoMissingLibrariesMessage joins both causes, and an empty list gives empty text', () => {
  assert.strictEqual(srv._protoMissingLibrariesMessage({}), '');
  const both = srv._protoMissingLibrariesMessage({ licensed: ['@bryntum/scheduler'], failed: ['jspdf'], failure: 'npm ERR! ENOTFOUND' });
  assert.match(both, /Bryntum is a licensed library/);
  assert.match(both, /jspdf, and installing them into the build shell failed: npm ERR! ENOTFOUND\./);
  assert.match(both, /Check the network connection/);
});

test('R-05: the preview handler maps the library refusal to 503 with error deps-missing', () => {
  const src = fs.readFileSync(SERVER_PATH, 'utf8');
  const start = src.indexOf('async function handlePrototypeLocalPreview(');
  assert.ok(start > 0, 'the preview handler exists');
  // The run body lives in _protoLocalPreviewRun (the handler keeps only the
  // validation and the state for the progress modal) - we read both.
  const runStart = src.indexOf('async function _protoLocalPreviewRun(');
  assert.ok(runStart > start, 'the preview run sits behind the handler');
  const body = src.slice(start, src.indexOf('\n}\n', runStart));
  assert.match(body, /const libs = await withProtoBuildLock\(\(\) => _protoEnsureLibraryDeps\(src\.indexTsx\)\);\s*\n\s*if \(!libs\.ok\) return jsonResponse\(res, 503, \{ status: 'error', error: 'deps-missing', missing: libs\.missing, message: libs\.message \}\);/);
  // The test-mode gate stands BEFORE everything that runs npm - hence no API test.
  assert.ok(body.indexOf('if (IS_TEST_MODE)') < body.indexOf('_protoEnsureLibraryDeps'));
});

test('R-04/R-05: after a library install package.json and package-lock.json ride in the publish staging', () => {
  const binDir = tmp('upkeep-addpaths-bin-');
  const buildDir = tmp('upkeep-addpaths-build-');
  const subReposDir = tmp('upkeep-addpaths-repos-');
  writeFakeNpm(binDir, { lock: true });
  fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.3.1' } }));
  try {
    const tsx = "export default async function A() { await import('jspdf'); return null }\n";
    const out = runInIsolatedShell(buildDir, subReposDir,
      `const libs = await srv._protoEnsureLibraryDeps(${JSON.stringify(tsx)}, () => {}); return { libs, paths: srv._protoPublishAddPaths('demo') };`,
      { PATH: binDir + path.delimiter + process.env.PATH });
    assert.deepStrictEqual(out.libs, { ok: true, installed: ['jspdf'] });
    assert.ok(fs.existsSync(path.join(buildDir, 'package-lock.json')), 'the install rewrote package-lock.json');
    for (const f of ['package.json', 'package-lock.json']) {
      assert.ok(out.paths.includes(f), `${f} must ride in the publish commit after a library install: ${JSON.stringify(out.paths)}`);
    }
    assert.ok(!out.paths.includes('node_modules') && !out.paths.some((p) => p.startsWith('node_modules/')), 'node_modules is never staged');
  } finally {
    for (const d of [binDir, buildDir, subReposDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
