// tests/test_proto_build.mjs
// The pure half of building and publishing a prototype (stages 3-4 of the
// migration): reading widths from the source, import validation, generated
// shell files, vendored packages and the node_modules probe. Requiring
// server.js from a non-main module exports the helpers and does NOT start the
// server - nothing here calls git, npm or Vite. A few AC5 tests (registry/codes
// staging, DS readiness) run server.js in a SEPARATE, temporary node process
// (runInIsolatedShell), because PROTO_BUILD_DIR/PROTOTYPES_DIR are constants
// computed once at require - the only way to isolate fully without risking the
// real shell or the team data; still no npm/git/Vite.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');

const SERVER_PATH = fileURLToPath(new URL('../server.js', import.meta.url));

// Runs build-shell code in a SEPARATE node process with its own temporary
// POC_PAGES_DATA_DIR/DATA_SUB_REPOS_DIR - PROTO_BUILD_DIR and PROTOTYPES_DIR
// are constants computed once at the first require('../server.js'), so this is
// the only way to test the whole staging path (registry.ts, prototype-codes.ts,
// meta.json) without touching the real team data or this test process's shell
// directory. It runs ONLY `node` - no npm, git or Vite - the network stays unused.
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

test('_protoParseBreakpoints reads the new format, the old one and the default', () => {
  assert.deepStrictEqual(
    srv._protoParseBreakpoints('export const breakpoints = [1280, 375, 375]'),
    [375, 1280],
    'duplicates disappear, the list is sorted',
  );
  assert.deepStrictEqual(
    srv._protoParseBreakpoints('export const breakpoints: number[] = [768]'),
    [768],
    'a type annotation must not break the match',
  );
  // The old format names two devices, not widths.
  assert.deepStrictEqual(
    srv._protoParseBreakpoints("export const viewports = ['desktop', 'mobile']"),
    [375, 1920],
  );
  // No declaration and a declaration without sensible numbers give the same
  // default list - never empty, because the preview must have something to show.
  assert.deepStrictEqual(srv._protoParseBreakpoints(''), srv.PROTO_DEFAULT_BREAKPOINTS);
  assert.deepStrictEqual(srv._protoParseBreakpoints('export const breakpoints = [0, -3]'), srv.PROTO_DEFAULT_BREAKPOINTS);
  assert.deepStrictEqual(srv._protoParseBreakpoints(null), srv.PROTO_DEFAULT_BREAKPOINTS);
});

test('_protoValidateTsx requires a default export', () => {
  assert.throws(() => srv._protoValidateTsx('export const Foo = 1'), /no default export/);
  assert.throws(() => srv._protoValidateTsx(''), /no default export/);
});

test('_protoValidateTsx lets allowed imports through', () => {
  const ok = [
    "import React from 'react'",
    "import { useState } from 'react'",
    "import { createRoot } from 'react/jsx-runtime'",
    "import './styles.css'",
    "import data from './stores.json'",
    "import icon from './assets/icon.svg'",
    "import { Shared } from '../_shared/Shared'",
    "import { Button } from '../../ds'",
    "import { Button } from '../../ds/Button'",
    "import { Card } from '../../components/Card'",
  ].join('\n');
  assert.doesNotThrow(() => srv._protoValidateTsx(ok + '\nexport default function App() { return null }\n'));
});

test('_protoValidateTsx rejects a sibling module (./Foo), because staging never copies it', () => {
  // Only styles.css, .json files and assets/ reach the shell
  // (_protoStageSources) - any other sibling TS/TSX module would build locally
  // and break only in the shell/on the hosting, where it simply is not there.
  const deny = (spec) => () => srv._protoValidateTsx(
    `import X from '${spec}'\nexport default function App() { return null }\n`,
  );
  assert.throws(deny('./Local'), /disallowed import/);
  assert.throws(deny('./helpers'), /disallowed import/);
  assert.throws(deny('./Widget.tsx'), /disallowed import/);
});

test('_protoValidateTsx lets Bryntum through, which the shell declares itself', () => {
  // Schedules are the one case the DS does not cover - a scheduling
  // prototype imports the package directly and must build.
  for (const spec of ['@bryntum/scheduler', '@bryntum/scheduler-react', '@bryntum/scheduler-trial', '@bryntum/scheduler-trial/scheduler.css']) {
    assert.doesNotThrow(
      () => srv._protoValidateTsx(`import X from '${spec}'\nexport default function App() { return null }\n`),
      spec,
    );
  }
  // The scope is not opened as a whole.
  assert.throws(
    () => srv._protoValidateTsx("import X from '@bryntum/gantt'\nexport default function App() { return null }\n"),
    /disallowed import/,
  );
});

test('_protoValidateTsx lets the export libraries through (xlsx, pdf, screenshot)', () => {
  // A scheduling prototype imports `write-excel-file/browser` statically
  // (`import type`), and jspdf and html2canvas dynamically - and it failed here
  // with 400 on preview and publish (audit R-01, 2026-09-29).
  for (const statement of [
    "import writeXlsxFile from 'write-excel-file'",
    "import type { Schema } from 'write-excel-file/browser'",
    "import { jsPDF } from 'jspdf'",
    "import html2canvas from 'html2canvas'",
    "const pdf = await import('jspdf')",
    "const shot = await import('html2canvas')",
  ]) {
    assert.doesNotThrow(
      () => srv._protoValidateTsx(`${statement}\nexport default function App() { return null }\n`),
      statement,
    );
  }
  // jspdf and html2canvas without subpaths: the list does not open the package internals.
  assert.throws(
    () => srv._protoValidateTsx("import X from 'jspdf/dist/x'\nexport default function App() { return null }\n"),
    /disallowed import/,
  );
});

test('_protoValidateTsx sees dynamic imports and skips comments', () => {
  const app = '\nexport default function App() { return null }\n';
  assert.throws(() => srv._protoValidateTsx("const m = import('lodash')" + app), /disallowed import in index.tsx: lodash/);
  assert.throws(() => srv._protoValidateTsx("export { x } from './helpers'" + app), /disallowed import/);
  assert.doesNotThrow(() => srv._protoValidateTsx("// import X from 'lodash'\n/* import Y from 'left-pad' */" + app));
  // escaping the shell tree through `..` after the prefix
  assert.throws(() => srv._protoValidateTsx("import s from './assets/../../private.json'" + app), /disallowed import/);
});

test('_protoValidateTsx rejects an import outside the list, the DS package included', () => {
  const deny = (spec) => () => srv._protoValidateTsx(
    `import X from '${spec}'\nexport default function App() { return null }\n`,
  );
  // No design-system package is on the list: the one DS surface of a
  // prototype is '../../ds'.
  assert.throws(deny('@acme/ui'), /disallowed import/);
  assert.throws(deny('lodash'), /disallowed import/);
  assert.throws(deny('../../../server.js'), /disallowed import/);
  assert.throws(deny('https://example.com/mod.js'), /disallowed import/);
});

test('_protoCodesFileContent and _protoParseCodes are inverses of each other', () => {
  const entries = { 421337: 'self-checkout', 100200: 'store-app' };
  const text = srv._protoCodesFileContent(entries);
  assert.ok(text.includes('PROTOTYPE_CODES'));
  assert.ok(text.includes('GENERATED FILE'), 'the file must introduce itself as generated');
  assert.deepStrictEqual(srv._protoParseCodes(text), entries);
  // The order is deterministic, so two runs with no changes make no diff in git.
  assert.strictEqual(srv._protoCodesFileContent(entries), text);
  assert.deepStrictEqual(srv._protoParseCodes(''), {});
  assert.deepStrictEqual(srv._protoParseCodes(null), {});
});

test('_protoRegistryFileContent generates lazy entries and a named type import', () => {
  const text = srv._protoRegistryFileContent([
    { slug: 'alfa', breakpoints: [375, 1920] },
    { slug: 'beta', breakpoints: [768] },
  ]);
  assert.ok(text.includes("import type { ComponentType } from 'react'"), 'the shell has no esModuleInterop');
  assert.ok(text.includes("\"alfa\": { load: () => import('./alfa/index'), breakpoints: [375, 1920] },"));
  assert.ok(text.includes("\"beta\": { load: () => import('./beta/index'), breakpoints: [768] },"));
  assert.ok(srv._protoRegistryFileContent([]).includes('PROTOTYPE_COMPONENTS'), 'an empty registry is still a valid module');
});

test('_protoPlaceholderCode gives a stable six-digit code', () => {
  const a = srv._protoPlaceholderCode('self-checkout');
  assert.match(a, /^\d{6}$/);
  assert.strictEqual(a, srv._protoPlaceholderCode('self-checkout'), 'same slug - same code');
  assert.notStrictEqual(a, srv._protoPlaceholderCode('other-prototype'));
});

test('_protoShellMissingDeps looks at specific files, not just the directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-shell-'));
  try {
    // No node_modules means everything is missing.
    assert.ok(srv._protoShellMissingDeps(dir).length > 0);
    // An empty node_modules is exactly the state a directory-only check would
    // call healthy.
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    assert.ok(srv._protoShellMissingDeps(dir).some((m) => m.includes('vite')), 'a missing vite must be visible');
    fs.mkdirSync(path.join(dir, 'node_modules', 'vite', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), '');
    assert.deepStrictEqual(srv._protoShellMissingDeps(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('protoBuildRepoUrl is env-only and PROTO_BUILD_DIR has a sane default', () => {
  // Publishing is opt-in: without PROTO_BUILD_REPO_URL there is no remote.
  if (!process.env.PROTO_BUILD_REPO_URL) assert.strictEqual(srv.protoBuildRepoUrl(), '');
  assert.ok(path.isAbsolute(srv.PROTO_BUILD_DIR));
});

// -- The React starter in POST /api/prototypes --------------------------------

test('_protoSubstituteStarterTokens embeds the name through JSON.stringify, never as raw text', () => {
  const tsx = "const PROTOTYPE_NAME = {{PROTO_NAME_JSON}};\nexport default function P() { return null }";
  for (const name of [
    "Till with an apostrophe O'Brien",
    'A name with a "quote"',
    'Several\nlines\nof text',
    'A name with accented letters: ąćęłńóśźż',
  ]) {
    const out = srv._protoSubstituteStarterTokens(tsx, name, 'proto-abc123');
    const m = /const PROTOTYPE_NAME = (.*);/.exec(out);
    assert.ok(m, 'the token must be replaced by a literal');
    // The literal must be valid JSON that parses back to EXACTLY the original
    // name - that is the whole difference between JSON.stringify and
    // swapping quotes by hand.
    assert.strictEqual(JSON.parse(m[1]), name);
  }
});

test('_protoSubstituteStarterTokens also substitutes {{PROTO_ID}}, ASCII', () => {
  const tsx = "// {{PROTO_ID}}\nconst PROTOTYPE_NAME = {{PROTO_NAME_JSON}};\nexport default function P() { return null }";
  const out = srv._protoSubstituteStarterTokens(tsx, 'Nazwa', 'proto-deadbeef0000');
  assert.ok(out.includes('// proto-deadbeef0000'));
});

test('_protoSubstituteStarterTokens throws on an unknown {{...}} token that survived substitution', () => {
  const tsx = 'const X = {{UNKNOWN_TOKEN}};';
  assert.throws(() => srv._protoSubstituteStarterTokens(tsx, 'Nazwa', 'proto-abc'), /starter template token/);
});

test('_protoParseStarterDemoStates reads id/label/group from the demoStates array', () => {
  const tsx = `
export const demoStates: DemoStateDef[] = [
  { id: 'ready', label: 'Initial screen', group: 'Basics' },
  { id: 'empty', label: 'No data', group: 'Data states' },
];
`;
  assert.deepStrictEqual(srv._protoParseStarterDemoStates(tsx), [
    { id: 'ready', label: 'Initial screen', group: 'Basics' },
    { id: 'empty', label: 'No data', group: 'Data states' },
  ]);
});

test('_protoParseStarterDemoStates gives an empty list when the array is missing - spec never throws on a foreign shape', () => {
  assert.deepStrictEqual(srv._protoParseStarterDemoStates('export default function P() { return null }'), []);
  assert.deepStrictEqual(srv._protoParseStarterDemoStates(''), []);
});

test('_protoGenerateStarterSpec describes only the starter states, never a business scope', () => {
  const tsx = `
export const demoStates: DemoStateDef[] = [
  { id: 'ready', label: 'Initial screen', group: 'Basics' },
  { id: 'empty', label: 'No data', group: 'Data states' },
];
`;
  const spec = srv._protoGenerateStarterSpec('My Prototype', tsx, '.proto-starter { color: red; }');
  assert.strictEqual(typeof spec.updated, 'string');
  assert.match(spec.summary, /My Prototype/);
  assert.match(spec.summary, /no business scope|without business scope/);
  assert.strictEqual(spec.scope.length, 2);
  assert.deepStrictEqual(spec.scope[0], { group: 'Basics', items: ['Initial screen'] });
  assert.deepStrictEqual(spec.scope[1], { group: 'Data states', items: ['No data'] });
  assert.strictEqual(spec.releases.length, 1);
  assert.match(spec.releases[0].items[0], /starter template/);
  // scripts/check-proto-ds.js blocks every React prototype without a
  // customElements array - a starter without CUSTOM markers in the CSS gives a
  // real, empty array, never a missing field.
  assert.deepStrictEqual(spec.customElements, []);
});

test('_protoGenerateStarterSpec without demoStates still returns a real, non-empty scope', () => {
  const spec = srv._protoGenerateStarterSpec('X', 'export default function P() { return null }');
  assert.strictEqual(spec.scope.length, 1);
  assert.match(spec.scope[0].items[0], /no business scope|without business scope/);
  assert.deepStrictEqual(spec.customElements, [], 'no stylesCss - the array is still present and empty');
});

test('_protoGenerateStarterSpec reads CUSTOM markers from styles.css, never guesses reason/lead_confirmed', () => {
  const css = '.proto-widget { color: red; } /* CUSTOM: proto-widget */';
  const spec = srv._protoGenerateStarterSpec('X', 'export default function P() { return null }', css);
  assert.deepStrictEqual(spec.customElements, [{ name: 'proto-widget' }]);
  // The backend does not invent `reason` or `lead_confirmed` - that is
  // proto-ds-guardian's job; both fields missing is expected and deliberate.
  assert.strictEqual(spec.customElements[0].reason, undefined);
  assert.strictEqual(spec.customElements[0].lead_confirmed, undefined);
});

// -- AC5: staging generates registry.ts + prototype-codes.ts + meta.json in an
// -- ISOLATED shell (POC_PAGES_DATA_DIR points at a temp directory in a
// -- separate node process - PROTO_BUILD_DIR/PROTOTYPES_DIR are constants
// -- computed once at the first require of this test process, so it cannot be
// -- tested in-process without risking the real shell). No npm, git or Vite
// -- is called - this is _protoStageSources alone.
test('_protoStageSources generates a real registry.ts and prototype-codes.ts in an isolated shell', () => {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-stage-build-'));
  const subReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-stage-repos-'));
  try {
    const out = runInIsolatedShell(buildDir, subReposDir, `
      const indexTsx = "export const breakpoints = [1280, 768]\\nexport default function P() { return null }\\n";
      const stylesCss = '.proto-x { color: blue; }';
      return await srv._protoStageSources({ id: 'proto-stagetest01', slug: 'stagetest01', indexTsx, stylesCss, code: '123456' });
    `);
    // The input order is [1280, 768] - the output is sorted ascending
    // (_protoParseBreakpoints), not copied 1:1.
    assert.deepStrictEqual(out.breakpoints, [768, 1280]);

    const registryTs = fs.readFileSync(path.join(buildDir, 'src', 'prototypes', 'registry.ts'), 'utf8');
    assert.match(registryTs, /GENERATED FILE by the cockpit/);
    assert.match(registryTs, /stagetest01/);
    assert.match(registryTs, /breakpoints: \[768, 1280\]/);

    const codesTs = fs.readFileSync(path.join(buildDir, 'src', 'prototype-codes.ts'), 'utf8');
    assert.match(codesTs, /'123456': 'stagetest01'/);

    const metaJson = JSON.parse(fs.readFileSync(path.join(buildDir, 'src', 'prototypes', 'stagetest01', 'meta.json'), 'utf8'));
    assert.deepStrictEqual(metaJson.breakpoints, [768, 1280]);

    const indexTsxOut = fs.readFileSync(path.join(buildDir, 'src', 'prototypes', 'stagetest01', 'index.tsx'), 'utf8');
    assert.match(indexTsxOut, /export default function P/);
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(subReposDir, { recursive: true, force: true });
  }
});

test('_protoStageSources repeated on the same slug with a new code replaces the entry, never duplicates', () => {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-stage-retry-'));
  const subReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-stage-retry-repos-'));
  try {
    const indexTsx = 'export default function P() { return null }\n';
    runInIsolatedShell(buildDir, subReposDir, `
      return await srv._protoStageSources({ id: 'proto-retry01', slug: 'retry01', indexTsx: ${JSON.stringify(indexTsx)}, stylesCss: '', code: '111111' });
    `);
    // Simulates "retry after a failed publish" - a second call with ANOTHER
    // code (another attempt at assigning the invitation code) on the same slug.
    runInIsolatedShell(buildDir, subReposDir, `
      return await srv._protoStageSources({ id: 'proto-retry01', slug: 'retry01', indexTsx: ${JSON.stringify(indexTsx)}, stylesCss: '', code: '222222' });
    `);
    const codesTs = fs.readFileSync(path.join(buildDir, 'src', 'prototype-codes.ts'), 'utf8');
    assert.match(codesTs, /'222222': 'retry01'/);
    assert.doesNotMatch(codesTs, /'111111'/);
    const registryTs = fs.readFileSync(path.join(buildDir, 'src', 'prototypes', 'registry.ts'), 'utf8');
    // One entry per slug, not two - the regenerated registry never duplicates.
    // The slug appears twice PER entry (the key and the import path), so we
    // count key lines, not every occurrence of the substring.
    assert.strictEqual((registryTs.match(/"retry01":/g) || []).length, 1);
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(subReposDir, { recursive: true, force: true });
  }
});

// -- Regression: _protoEnsureViteRunning must pass --port/--strictPort -----
//
// A real bug reported on a live app: `npm run dev` was called WITHOUT port
// arguments, so Vite picked its own default port (5173/5174...), while the app
// probed the configured PROTO_VITE_PORT (567xx) forever, up to the 30-second
// timeout. The test swaps the REAL npm/Vite for a FAKE "npm" script (in a
// directory placed first on PATH) that writes the argv it got to a file and -
// depending on the mode - either listens on the given port (a healthy Vite) or
// fails at once (a --strictPort refusal). No real npm/git/Vite or network is
// used here - the fake "npm" is a plain node file.
//
// The mode and the log path are BAKED into the script, not read from the
// environment: npm in the shell gets an allowlist from _protoNpmEnv, not a
// copy of process.env, so a test variable set in the parent would never reach
// the fake npm - and good, because in production no token reaches it either.
function writeFakeNpm(binDir, opts) {
  const npmPath = path.join(binDir, 'npm');
  const logPath = (opts && opts.argvLog) || '';
  const mode = (opts && opts.mode) || 'serve';
  const script = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const http = require('http');
const argv = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};
if (logPath) fs.writeFileSync(logPath, JSON.stringify(argv));
const mode = ${JSON.stringify(mode)};
const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 5173;
const hostIdx = argv.indexOf('--host');
const host = hostIdx >= 0 ? argv[hostIdx + 1] : 'localhost';
if (mode === 'fail') {
  process.stderr.write('fake error: port ' + port + ' busy (simulated --strictPort refusal)\\n');
  process.exitCode = 1;
} else {
  const server = http.createServer((req, res) => { res.end('ok'); });
  server.listen(port, host, () => {});
  server.on('error', (e) => { process.stderr.write('listen-error: ' + String(e && e.message || e) + '\\n'); process.exitCode = 1; });
}
`;
  fs.writeFileSync(npmPath, script, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'npm.cmd'), `@echo off\r\n"${process.execPath}" "${npmPath}" %*\r\n`);
  return npmPath;
}

async function unusedPreviewPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, 'localhost', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

test('_protoEnsureViteRunning passes --port/--strictPort/--host to npm run dev', async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-fake-npm-'));
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-vite-ok-build-'));
  const subReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-vite-ok-repos-'));
  const markerPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proto-vite-ok-marker-')), 'proto-vite.json');
  const argvLog = path.join(binDir, 'argv.json');
  const testPort = await unusedPreviewPort();
  writeFakeNpm(binDir, { argvLog, mode: 'serve' });
  let result;
  try {
    result = runInIsolatedShell(buildDir, subReposDir, `
      return await srv._protoEnsureViteRunning();
    `, {
      PATH: binDir + path.delimiter + process.env.PATH,
      PROTO_VITE_PORT: String(testPort),
      PROTOTYPE_VITE_MARKER_PATH: markerPath,
    });
    assert.strictEqual(result.ok, true);
    assert.ok(fs.existsSync(argvLog), 'the fake npm should record the argv it got');
    const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
    assert.deepStrictEqual(argv.slice(0, 2), ['run', 'dev']);
    assert.ok(argv.includes('--'), 'argv must separate npm arguments from Vite arguments with --');
    assert.ok(argv.includes('--port'), '--port missing from the argv passed to npm run dev');
    assert.strictEqual(argv[argv.indexOf('--port') + 1], String(testPort));
    assert.ok(argv.includes('--strictPort'), '--strictPort missing - Vite could silently pick another port');
    assert.ok(argv.includes('--host'), '--host missing - the listen address may not match the probe');
  } finally {
    // The orphaned fake "Vite" is detached on purpose (detached+unref - it
    // survives an app restart in production), so it has to be killed by hand
    // through the pid recorded in the test's own marker.
    try {
      if (fs.existsSync(markerPath)) {
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        if (marker && marker.pid) {
          if (process.platform === 'win32') cp.spawnSync('taskkill', ['/PID', String(marker.pid), '/T', '/F'], { stdio: 'ignore' });
          else process.kill(marker.pid, 'SIGTERM');
        }
      }
    } catch { /* the process is already dead - fine */ }
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(subReposDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(markerPath), { recursive: true, force: true });
  }
});

test('_protoEnsureViteRunning reports an error with the stderr content and cleans up after a failed start', async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-fake-npm-fail-'));
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-vite-fail-build-'));
  const subReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-vite-fail-repos-'));
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-vite-fail-marker-'));
  const markerPath = path.join(markerDir, 'proto-vite.json');
  const testPort = await unusedPreviewPort();
  writeFakeNpm(binDir, { mode: 'fail' });
  try {
    const result = runInIsolatedShell(buildDir, subReposDir, `
      return await srv._protoEnsureViteRunning();
    `, {
      PATH: binDir + path.delimiter + process.env.PATH,
      PROTO_VITE_PORT: String(testPort),
      PROTOTYPE_VITE_MARKER_PATH: markerPath,
      // Probing shortened ONLY for the test (see the definition in server.js)
      // - in production always 1000ms/30 attempts (30 seconds), here 2
      // attempts of 30ms suffice, because the child exits at once.
      PROTO_VITE_PROBE_MS: '200',
      PROTO_VITE_PROBE_ATTEMPTS: '15',
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.message, /fake error/, 'the error should carry the tail of the child stderr for diagnosis');
    // stderr goes to a file next to the marker, not to a pipe: the pipe dies with the app process, and a Vite that
    // survived a restart died on EPIPE at its first warning (2026-10-07).
    assert.match(fs.readFileSync(path.join(markerDir, 'proto-vite-stderr.log'), 'utf8'), /fake error/);
    assert.ok(!fs.existsSync(markerPath), 'the marker of a failed start must not remain (no running Vite)');
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(subReposDir, { recursive: true, force: true });
    fs.rmSync(markerDir, { recursive: true, force: true });
  }
});

// -- The publish token never in the shell's remote.origin.url (2026-09-13) ----------------
// Until that day _protoCloneBuildRepo cloned through an address with the PAT
// pasted in, and git stored it in the clone's config - `git remote -v` printed
// the token. Two things keep it from coming back: a pure helper that strips the
// userinfo from an address, and a self-repair in _protoGitExec that rewrites an
// existing address carrying a token to one without it at the first remote op.

test('_protoStripUrlCredentials strips the userinfo from an https address and leaves the rest alone', () => {
  assert.strictEqual(
    srv._protoStripUrlCredentials('https://pat:abc%3Ddef@git.example.com/acme/Frontend%20POC/_git/poc'),
    'https://git.example.com/acme/Frontend%20POC/_git/poc',
  );
  assert.strictEqual(srv._protoStripUrlCredentials('https://oauth2:tok@git.example.com/g/r.git'), 'https://git.example.com/g/r.git');
  // An address carrying only an organisation userinfo is stripped too, or
  // withAuth would build `user:TOKEN@org@host` and git would refuse it.
  assert.strictEqual(srv._protoStripUrlCredentials('https://acme@git.example.com/acme/Frontend%20POC/_git/poc'), 'https://git.example.com/acme/Frontend%20POC/_git/poc');
  assert.strictEqual(srv._protoStripUrlCredentials('https://git.example.com/acme/x/_git/y'), 'https://git.example.com/acme/x/_git/y');
  assert.strictEqual(srv._protoStripUrlCredentials('git@git.example.com:a/b.git'), 'git@git.example.com:a/b.git');
  assert.strictEqual(srv._protoStripUrlCredentials(''), '');
});

test('_protoGitExec rewrites an existing remote.origin.url with a token to one without it and never persists insteadOf', () => {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-git-scrub-'));
  const subReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-git-scrub-repos-'));
  try {
    cp.execFileSync('git', ['init', '-q', buildDir]);
    // A clone from before the fix: the address stored together with the PAT.
    cp.execFileSync('git', ['-C', buildDir, 'remote', 'add', 'origin', 'https://pat:SECRET123@example.invalid/acme/_git/poc']);
    const out = runInIsolatedShell(buildDir, subReposDir, `
      const r = await srv._protoGitExec(['ls-remote', 'origin'], 15000);
      return { code: r.code };
    `, { PROTO_DEPLOY_TOKEN: 'NEWTOKEN' });
    // example.invalid does not exist - the command MUST fail; we check the
    // config state after it, not its result.
    assert.notStrictEqual(out.code, 0);
    const remoteUrl = cp.execFileSync('git', ['-C', buildDir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    assert.strictEqual(remoteUrl, 'https://example.invalid/acme/_git/poc');
    const config = fs.readFileSync(path.join(buildDir, '.git', 'config'), 'utf8');
    assert.ok(!config.includes('SECRET123'), 'the old token is gone from the config');
    assert.ok(!config.includes('NEWTOKEN'), 'the new token was not stored');
    assert.ok(!/insteadOf/i.test(config), 'insteadOf is a one-shot -c, not a config entry');
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(subReposDir, { recursive: true, force: true });
  }
});

test('_protoEnsureNodeModules: parallel calls share ONE install', { skip: process.platform === 'win32' }, () => {
  // Regression 2026-10-07: every "Local preview" click during a cold install
  // deleted node_modules and started its own `npm install` in the same
  // directory - four at once, ENOENT/ENOTEMPTY, and then a killed Vite.
  // A fake `npm` on PATH counts the runs and creates vite.js after a moment.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-single-flight-'));
  const buildDir = path.join(root, 'shell');
  const binDir = path.join(root, 'bin');
  const counter = path.join(root, 'npm-runs.txt');
  try {
    fs.mkdirSync(buildDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({ name: 'shell', devDependencies: { vite: '^6' } }));
    fs.writeFileSync(path.join(binDir, 'npm'), `#!/bin/sh
echo run >> ${JSON.stringify(counter)}
sleep 0.4
mkdir -p node_modules/vite/bin && : > node_modules/vite/bin/vite.js
`, { mode: 0o755 });
    const out = runInIsolatedShell(buildDir, path.join(root, 'subs'), `
      console.log = () => {}; // stdout niesie wynik JSON
      const a = srv._protoEnsureNodeModules();
      const b = srv._protoEnsureNodeModules();
      const same = a === b;
      const [ra, rb] = await Promise.all([a, b]);
      const after = await srv._protoEnsureNodeModules();
      return { same, ra, rb, after };
    `, { PATH: `${binDir}:${process.env.PATH}` });
    assert.strictEqual(out.same, true, 'the second caller gets the same promise');
    assert.deepStrictEqual(out.ra, { ok: true });
    assert.deepStrictEqual(out.rb, { ok: true });
    assert.deepStrictEqual(out.after, { ok: true }, 'a healthy shell after the install does not install again');
    const runs = fs.readFileSync(counter, 'utf8').trim().split('\n').length;
    assert.strictEqual(runs, 1, 'exactly one `npm install`');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Prototype kit: nested assets, the seed's shared layer in an existing shell,
// the viewer's address switches and the pinned Playwright.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(SERVER_PATH));
const SEED = path.join(ROOT, 'templates', 'prototype-build-shell');
const sha = (file) => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-kit-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('_protoCopyAssets copies assets/ recursively to the source folder AND public/proto-assets', () => {
  withTemp((tmp) => {
    const buildDir = path.join(tmp, 'shell');
    const dataRepos = path.join(tmp, 'repos');
    const protoDir = path.join(dataRepos, 'ds-data', 'prototypes', 'proto-brief0001', 'assets');
    fs.mkdirSync(path.join(protoDir, 'frames'), { recursive: true });
    fs.writeFileSync(path.join(protoDir, 'top.png'), 'png');
    fs.writeFileSync(path.join(protoDir, 'frames', 'a-00.jpg'), 'jpg');
    runInIsolatedShell(buildDir, dataRepos, `
      await srv._protoCopyAssets({ id: 'proto-brief0001', slug: 'brief0001', codeText: '' });
      return null;
    `, { DATA_TIER_0_DIR: path.join(dataRepos, 'ds-data') });
    for (const rel of [
      'src/prototypes/brief0001/assets/frames/a-00.jpg', 'src/prototypes/brief0001/assets/top.png',
      'public/proto-assets/brief0001/frames/a-00.jpg', 'public/proto-assets/brief0001/top.png',
    ]) assert.ok(fs.existsSync(path.join(buildDir, rel)), rel);
    assert.strictEqual(fs.readFileSync(path.join(buildDir, 'src/prototypes/brief0001/assets/frames/a-00.jpg'), 'utf8'), 'jpg');
  });
});

test('_protoCopyAssets skips symlinks at depth: only regular files reach the shell', () => {
  withTemp((tmp) => {
    const buildDir = path.join(tmp, 'shell');
    const dataRepos = path.join(tmp, 'repos');
    const protoDir = path.join(dataRepos, 'ds-data', 'prototypes', 'proto-brief0002', 'assets');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(path.join(protoDir, 'a', 'b'), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.json'), '{}');
    fs.writeFileSync(path.join(protoDir, 'a', 'b', 'ok.png'), 'png');
    fs.symlinkSync(path.join(outside, 'secret.json'), path.join(protoDir, 'a', 'b', 'link.json'));
    fs.symlinkSync(outside, path.join(protoDir, 'a', 'dirlink'));
    runInIsolatedShell(buildDir, dataRepos, `
      await srv._protoCopyAssets({ id: 'proto-brief0002', slug: 'brief0002', codeText: '' });
      return null;
    `, { DATA_TIER_0_DIR: path.join(dataRepos, 'ds-data') });
    for (const root of ['src/prototypes/brief0002/assets', 'public/proto-assets/brief0002']) {
      assert.ok(fs.existsSync(path.join(buildDir, root, 'a/b/ok.png')), root);
      assert.ok(!fs.existsSync(path.join(buildDir, root, 'a/b/link.json')) && !fs.existsSync(path.join(buildDir, root, 'a/dirlink')), root + ' has no symlink');
    }
  });
});

test('_protoCopyAssets skips an assets/ folder that is itself a symlink', () => {
  withTemp((tmp) => {
    const buildDir = path.join(tmp, 'shell');
    const dataRepos = path.join(tmp, 'repos');
    const protoRoot = path.join(dataRepos, 'ds-data', 'prototypes', 'proto-brief0003');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(protoRoot, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.json'), '{}');
    fs.symlinkSync(outside, path.join(protoRoot, 'assets'));
    runInIsolatedShell(buildDir, dataRepos, `
      await srv._protoCopyAssets({ id: 'proto-brief0003', slug: 'brief0003', codeText: '' });
      return null;
    `, { DATA_TIER_0_DIR: path.join(dataRepos, 'ds-data') });
    for (const root of ['src/prototypes/brief0003/assets', 'public/proto-assets/brief0003']) {
      assert.ok(!fs.existsSync(path.join(buildDir, root, 'secret.json')), root + ' has no linked file');
    }
  });
});

test('_protoPublishPairs lists every file of assets/ for BOTH destinations, sub-folders included', () => {
  withTemp((tmp) => {
    const dataRepos = path.join(tmp, 'repos');
    const protoDir = path.join(dataRepos, 'ds-data', 'prototypes', 'proto-pair000001');
    fs.mkdirSync(path.join(protoDir, 'assets', 'frames'), { recursive: true });
    fs.writeFileSync(path.join(protoDir, 'index.tsx'), 'x');
    fs.writeFileSync(path.join(protoDir, 'assets', 'top.png'), 'p');
    fs.writeFileSync(path.join(protoDir, 'assets', 'frames', 'x.jpg'), 'j');
    const pairs = runInIsolatedShell(path.join(tmp, 'shell'), dataRepos, `
      return srv._protoPublishPairs('proto-pair000001', 'pair000001');
    `, { DATA_TIER_0_DIR: path.join(dataRepos, 'ds-data') });
    const frames = pairs.filter((p) => p.relPath === 'prototypes/proto-pair000001/assets/frames/x.jpg').map((p) => p.shellPath).sort();
    assert.deepStrictEqual(frames, ['public/proto-assets/pair000001/frames/x.jpg', 'src/prototypes/pair000001/assets/frames/x.jpg']);
    const top = pairs.filter((p) => p.relPath === 'prototypes/proto-pair000001/assets/top.png').map((p) => p.shellPath).sort();
    assert.deepStrictEqual(top, ['public/proto-assets/pair000001/top.png', 'src/prototypes/pair000001/assets/top.png']);
  });
});

test('_protoPublishAddPaths carries the icons, the upgraded viewer files and the recorder, plus the shell manifests', () => {
  withTemp((tmp) => {
    const buildDir = path.join(tmp, 'shell');
    for (const rel of ['public/ds-icons/x.svg', 'src/BreakpointViewer.tsx', 'src/BreakpointViewer.css', 'src/App.tsx', 'src/recorder.ts', 'package.json', 'src/ds/index.ts']) {
      fs.mkdirSync(path.dirname(path.join(buildDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(buildDir, rel), '');
    }
    const paths = runInIsolatedShell(buildDir, path.join(tmp, 'repos'), "return srv._protoPublishAddPaths('demo');");
    for (const p of ['public/ds-icons/', 'src/BreakpointViewer.tsx', 'src/BreakpointViewer.css', 'src/App.tsx', 'src/recorder.ts', 'package.json', 'src/ds/']) {
      assert.ok(paths.includes(p), p + ' is in the publish commit');
    }
  });
});

// -- the seed's shared layer in a shell that already exists -----------------

const SEED_V1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'proto-seed-v1', 'seed-v1.json'), 'utf8')).files;

function plantOldShell(buildDir, { lock = false, pkg } = {}) {
  for (const [rel, b64] of Object.entries(SEED_V1)) {
    fs.mkdirSync(path.dirname(path.join(buildDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(buildDir, rel), Buffer.from(b64, 'base64'));
  }
  const base = pkg || { name: 'clone', private: true, scripts: { build: 'x' }, dependencies: { react: '^18.3.1' }, devDependencies: { vite: '^5.4.10' } };
  fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(base, null, 2) + '\n');
  if (lock) fs.writeFileSync(path.join(buildDir, 'package-lock.json'), '{}\n');
}

test('PROTO_SEED_UPGRADES: the planted old files are exactly the versions the map names', () => {
  for (const [rel, b64] of Object.entries(SEED_V1)) {
    const digest = require('node:crypto').createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
    assert.ok(srv.PROTO_SEED_UPGRADES[rel].includes(digest), rel);
    assert.notStrictEqual(digest, sha(path.join(SEED, rel)), rel + ': the current seed is a newer version');
  }
});

test('shell upkeep: an untouched old shell is upgraded, missing shared files are copied, package.json gains only playwright', () => {
  withTemp((tmp) => {
    plantOldShell(tmp);
    const before = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    const r = srv._protoEnsureShellSharedSeed(tmp);
    assert.deepStrictEqual([...r.upgraded].sort(), Object.keys(SEED_V1).sort());
    assert.deepStrictEqual(r.kept, []);
    for (const rel of Object.keys(SEED_V1)) assert.strictEqual(sha(path.join(tmp, rel)), sha(path.join(SEED, rel)), rel);
    for (const rel of ['src/ds/index.ts', 'src/ds/components.tsx', 'src/components/AppFrame.tsx', 'src/prototypes/_shared/analytics.ts', 'src/recorder.ts']) {
      assert.ok(fs.existsSync(path.join(tmp, rel)), rel + ' was copied');
    }
    assert.ok(r.icons > 0 && fs.existsSync(path.join(tmp, 'public/ds-icons/24-ic-turbine.svg')), 'the icon set arrived');
    const after = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    const seedPin = JSON.parse(fs.readFileSync(path.join(SEED, 'package.json'), 'utf8')).devDependencies.playwright;
    assert.strictEqual(after.devDependencies.playwright, seedPin);
    delete after.devDependencies.playwright;
    assert.deepStrictEqual(after, before, 'nothing else in package.json changed');
    assert.strictEqual(r.packageJsonUpdated, true);
    // A second run changes nothing.
    const again = srv._protoEnsureShellSharedSeed(tmp);
    assert.deepStrictEqual([again.copied, again.upgraded, again.kept, again.icons, again.packageJsonUpdated], [[], [], [], 0, false]);
  });
});

test('shell upkeep: a team-edited old file is kept byte for byte and named, never overwritten', () => {
  withTemp((tmp) => {
    plantOldShell(tmp);
    const edited = '// our own demo-state, hands off\nexport const x = 1;\n';
    fs.writeFileSync(path.join(tmp, 'src/prototypes/_shared/demo-state.ts'), edited);
    const r = srv._protoEnsureShellSharedSeed(tmp);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'src/prototypes/_shared/demo-state.ts'), 'utf8'), edited);
    assert.deepStrictEqual(r.kept.map((k) => k.path), ['src/prototypes/_shared/demo-state.ts']);
    assert.match(r.kept[0].effect, /hasDemoStateParam/);
    assert.ok(!r.upgraded.includes('src/prototypes/_shared/demo-state.ts'));
    assert.ok(r.upgraded.includes('src/BreakpointViewer.tsx'), 'the untouched ones are still upgraded');
  });
});

test('shell upkeep: a team\'s own shared file is never touched, and nothing is deleted', () => {
  withTemp((tmp) => {
    plantOldShell(tmp);
    fs.mkdirSync(path.join(tmp, 'src/ds'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/ds/components.tsx'), '// the team\'s own adapters\n');
    fs.mkdirSync(path.join(tmp, 'src/components'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/components/Only.tsx'), '// only here\n');
    const r = srv._protoEnsureShellSharedSeed(tmp);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'src/ds/components.tsx'), 'utf8'), '// the team\'s own adapters\n');
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'src/components/Only.tsx'), 'utf8'), '// only here\n');
    assert.ok(!r.copied.includes('src/ds/components.tsx') && !r.upgraded.includes('src/ds/components.tsx'));
    assert.ok(r.copied.includes('src/ds/index.ts'), 'a seed file that is ABSENT is still added');
  });
});

test('shell upkeep: a folder the team owns is skipped as a whole unit, and components/ follows ds/', () => {
  withTemp((tmp) => {
    plantOldShell(tmp);
    const team = path.join(tmp, '_team');
    fs.mkdirSync(path.join(team, 'ds'), { recursive: true });
    fs.writeFileSync(path.join(team, 'ds', 'index.ts'), 'export const Only = 1;\n');
    const roots = [
      { shellRel: 'src/ds', srcDir: path.join(team, 'ds') },
      { shellRel: 'src/components', srcDir: path.join(team, 'components') },
      { shellRel: 'src/prototypes/_shared', srcDir: path.join(team, '_shared') },
    ];
    const r = srv._protoEnsureShellSharedSeed(tmp, { sharedRoots: roots });
    assert.deepStrictEqual(r.skippedDirs, ['src/ds', 'src/components']);
    assert.ok(!fs.existsSync(path.join(tmp, 'src/ds/index.ts')), 'the team-owned ds/ got no seed file');
    assert.ok(!fs.existsSync(path.join(tmp, 'src/components/AppFrame.tsx')), 'components/ is not seeded on top of a foreign ds/');
    assert.ok(r.seedPaths.every((p) => !p.startsWith('src/ds/') && !p.startsWith('src/components/')));
    assert.ok(fs.existsSync(path.join(tmp, 'src/prototypes/_shared/analytics.ts')), 'an untouched folder is still seeded');
  });
});

test('shell upkeep: a folder holding a file the seed did not put there is left alone; an untouched shell is still seeded', () => {
  withTemp((tmp) => {
    plantOldShell(tmp);
    fs.mkdirSync(path.join(tmp, 'src/components'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/components/Only.tsx'), '// only here\n');
    const none = [{ shellRel: 'src/ds', srcDir: path.join(tmp, '_none') }];
    const r = srv._protoEnsureShellSharedSeed(tmp, { sharedRoots: none });
    assert.deepStrictEqual(r.skippedDirs, ['src/components']);
    assert.ok(!fs.existsSync(path.join(tmp, 'src/components/AppFrame.tsx')));
    assert.ok(fs.existsSync(path.join(tmp, 'src/ds/index.ts')), 'ds/ held nothing foreign and is seeded');
  });
});

test('shell upkeep: prototypes/_shared is seeded file by file, even next to a file the seed did not put there or a team-owned copy', () => {
  withTemp((tmp) => {
    plantOldShell(tmp);
    fs.rmSync(path.join(tmp, 'src/prototypes/_shared/analytics.ts'), { force: true });
    fs.writeFileSync(path.join(tmp, 'src/prototypes/_shared/team-helper.ts'), 'export const x = 1;\n');
    const team = path.join(tmp, '_team');
    fs.mkdirSync(path.join(team, '_shared'), { recursive: true });
    fs.writeFileSync(path.join(team, '_shared', 'team-helper.ts'), 'export const x = 1;\n');
    const roots = [{ shellRel: 'src/prototypes/_shared', srcDir: path.join(team, '_shared') }];
    const r = srv._protoEnsureShellSharedSeed(tmp, { sharedRoots: roots });
    assert.ok(!r.skippedDirs.includes('src/prototypes/_shared'));
    assert.ok(fs.existsSync(path.join(tmp, 'src/prototypes/_shared/analytics.ts')), 'the starters\' analytics helper is added');
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'src/prototypes/_shared/team-helper.ts'), 'utf8'), 'export const x = 1;\n');
  });
});

test('shell upkeep: an untouched seed file checked out with CRLF line endings is still recognised and upgraded', () => {
  withTemp((tmp) => {
    plantOldShell(tmp);
    const rel = 'src/App.tsx';
    const abs = path.join(tmp, rel);
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/\r?\n/g, '\r\n'));
    const r = srv._protoEnsureShellSharedSeed(tmp);
    assert.ok(r.upgraded.includes(rel), JSON.stringify(r.kept));
  });
});

test('_protoPublishAddPaths leaves out an upgrade file the upkeep kept because somebody edited it', () => {
  withTemp((tmp) => {
    const buildDir = path.join(tmp, 'shell');
    for (const rel of ['src/App.tsx', 'src/BreakpointViewer.tsx']) {
      fs.mkdirSync(path.dirname(path.join(buildDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(buildDir, rel), '');
    }
    const paths = runInIsolatedShell(buildDir, path.join(tmp, 'repos'), "return srv._protoPublishAddPaths('demo', { keptPaths: ['src/App.tsx'] });");
    assert.ok(!paths.includes('src/App.tsx'));
    assert.ok(paths.includes('src/BreakpointViewer.tsx'));
  });
});

test('recorder: an existing window.analytics is kept, forwarded to and restored on cleanup', () => {
  const src = fs.readFileSync(path.join(SEED, 'src', 'recorder.ts'), 'utf8');
  assert.match(src, /const previous = window\.analytics;/);
  assert.match(src, /previous\?\.track\?\.\(event, props\)/);
  assert.match(src, /if \(previous\) window\.analytics = previous;\s*else delete window\.analytics;/);
});

test('shell upkeep: with a lock file the playwright devDependency is NOT added (the lock would go stale)', () => {
  withTemp((tmp) => {
    plantOldShell(tmp, { lock: true });
    const before = fs.readFileSync(path.join(tmp, 'package.json'), 'utf8');
    const r = srv._protoEnsureShellSharedSeed(tmp);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'), before);
    assert.strictEqual(r.playwrightSkipped, true);
    assert.strictEqual(r.packageJsonUpdated, false);
  });
});

test('shell upkeep: a package.json that already declares playwright is left byte for byte', () => {
  withTemp((tmp) => {
    plantOldShell(tmp, { pkg: { name: 'c', devDependencies: { playwright: '^1.50.0' } } });
    const before = fs.readFileSync(path.join(tmp, 'package.json'), 'utf8');
    srv._protoEnsureShellSharedSeed(tmp);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'), before);
  });
});

test('the seed itself and the shell upkeep agree: a fresh seed copy needs nothing', () => {
  withTemp((tmp) => {
    fs.cpSync(SEED, tmp, { recursive: true });
    const r = srv._protoEnsureShellSharedSeed(tmp);
    assert.deepStrictEqual([r.copied, r.upgraded, r.kept], [[], [], []]);
    assert.deepStrictEqual(srv._protoSeedSharedPaths().filter((p) => p.startsWith('src/ds/')).length > 0, true);
  });
});

// -- the viewer's address switches and the pinned Playwright ---------------

test('the viewer reads state, w and chrome from ONE parser, keeps data-proto-canvas in both modes and makes no claim about a host', () => {
  const src = fs.readFileSync(path.join(SEED, 'src', 'BreakpointViewer.tsx'), 'utf8');
  assert.match(src, /function readViewerParams\(\)/);
  assert.strictEqual((src.match(/new URLSearchParams\(/g) || []).length, 1, 'one parser of the address');
  assert.match(src, /p\.get\('chrome'\) !== '0'/);
  assert.match(src, /p\.get\('w'\)/);
  assert.match(src, /if \(!viewerParams\.chrome\)/);
  assert.strictEqual((src.match(/data-proto-canvas/g) || []).length >= 2, true, 'bare and framed canvas both carry the marker');
  assert.match(src, /writeViewerParam\('w', String\(nextBp\)\)/, 'a preset click writes w');
  assert.match(src, /Local only - these clicks stay in this preview\./);
  assert.doesNotMatch(src, /published host/);
  const app = fs.readFileSync(path.join(SEED, 'src', 'App.tsx'), 'utf8');
  assert.match(app, /installRecorder\(\)/);
});

test('the seed pins the same Playwright version as the browser bootstrap', () => {
  const pin = JSON.parse(fs.readFileSync(path.join(SEED, 'package.json'), 'utf8')).devDependencies.playwright;
  const boot = fs.readFileSync(path.join(ROOT, 'scripts', 'bootstrap-playwright.js'), 'utf8');
  assert.match(boot, new RegExp("PLAYWRIGHT_VERSION = '" + pin.replace(/\./g, '\\.') + "'"));
});

