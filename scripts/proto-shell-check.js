#!/usr/bin/env node
'use strict';
// scripts/proto-shell-check.js
// Builds a THROWAWAY prototype build shell from the seed
// (templates/prototype-build-shell/), stages the prototype folders you name
// into it the way the cockpit does for a preview, and runs the shell's own
// gates: npm install, eslint, tsc -b and vite build. It proves that the seed,
// its shared layer (ds/, components/, recorder) and real prototypes compile,
// lint clean and ship their pictures - without a cockpit server, a git remote
// or the person's own build shell.
//
//   node scripts/proto-shell-check.js --out <dir>                       (the seed alone)
//   node scripts/proto-shell-check.js --prototypes <dir,dir> --out <dir> [--json]
//   node scripts/proto-shell-check.js --prototypes <dirs> --check-frames <id> --out <dir>
//
// Staging uses the real helpers of server.js (_protoEnsureShellSharedSeed,
// _protoValidateTsx, _protoStageSources) in a child process with
// POC_PAGES_DATA_DIR pointing at the throwaway shell, so what is checked is
// what the preview and the publish write.
//
// --check-frames <id> then serves the built bundle with `vite preview` on a
// free port and runs `scripts/proto-record.mjs --check-frames` against it;
// the preview is always stopped. It needs the shell's playwright (the seed
// lists it) and a Chromium (PW_CHROMIUM_PATH or the folder
// scripts/bootstrap-playwright.js fills).
//
// The throwaway shell lives in <out>/shell (an existing one is refreshed and
// keeps its node_modules). Nothing outside <out> is written.
// Exit: 0 every step passed, 1 a step failed, 2 usage error.

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SEED_DIR = path.join(ROOT, 'templates', 'prototype-build-shell');
const SERVER = path.join(ROOT, 'server.js');

const HELP = `
proto-shell-check.js - build, lint and type-check prototypes in a throwaway shell

Usage:
  node scripts/proto-shell-check.js --out <dir> [--prototypes <dir,dir>] [--check-frames <id>] [--json]

Options:
  --out <dir>             working folder (the shell is <dir>/shell); default: a temp folder
  --prototypes <dir,dir>  prototype folders (holding index.tsx) to stage into the shell
  --check-frames <id>     after the build, serve dist and check that this briefing shows its pictures
  --json                  machine-readable result
  --help                  this text

Exit codes: 0 every step passed, 1 a step failed, 2 usage error.
`;

function usage(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json' || a === '--help') { flags[a.slice(2)] = true; continue; }
    if (['--out', '--prototypes', '--check-frames'].includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) usage(a + ' needs a value');
      flags[a.slice(2)] = v;
      i += 1;
      continue;
    }
    usage('unexpected argument: ' + a);
  }
  return flags;
}

// The environment of every child: an allowlist, never a copy of process.env
// (a vault unlock puts tokens there), and no npm_config_* (a server started by
// `npm start` would make npm skip devDependencies).
function childEnv(extra) {
  const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS', 'SYSTEMROOT', 'APPDATA', 'LOCALAPPDATA', 'PW_CHROMIUM_PATH', 'PLAYWRIGHT_BROWSERS_PATH'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return Object.assign(env, extra || {});
}

function emptyShellKeepingModules(shellDir) {
  fs.mkdirSync(shellDir, { recursive: true });
  for (const name of fs.readdirSync(shellDir)) {
    if (name === 'node_modules') continue;
    fs.rmSync(path.join(shellDir, name), { recursive: true, force: true });
  }
}

function listFiles(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function waitForHttp(url, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500); });
      req.on('error', () => {
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

const STAGE_CHILD = `
'use strict';
const fs = require('fs');
const path = require('path');
const srv = require(process.env.PSC_SERVER);
(async () => {
  const cfg = JSON.parse(process.env.PSC_CONFIG);
  const seed = srv._protoEnsureShellSharedSeed();
  const staged = [];
  for (const id of cfg.ids) {
    const slug = id.replace(/^proto-/, '');
    const dir = path.join(cfg.protosDir, id);
    const indexTsx = fs.readFileSync(path.join(dir, 'index.tsx'), 'utf8');
    const stylesCss = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
    srv._protoValidateTsx(indexTsx);
    await srv._protoStageSources({ id, slug, indexTsx, stylesCss, code: srv._protoPlaceholderCode(slug) });
    staged.push(slug);
  }
  process.stdout.write(JSON.stringify({ seed: { copied: seed.copied.length, icons: seed.icons }, staged }));
})().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
`;

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) { process.stdout.write(HELP); return 0; }

  const out = path.resolve(flags.out || path.join(os.tmpdir(), 'proto-shell-check'));
  const shellDir = path.join(out, 'shell');
  const dataDir = path.join(out, 'data');
  const logDir = path.join(out, 'logs');
  const protoDirs = String(flags.prototypes || '').split(',').map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  for (const d of protoDirs) {
    if (!fs.existsSync(path.join(d, 'index.tsx'))) usage('not a prototype folder (no index.tsx): ' + d);
    if (!/^proto-[a-z0-9]+$/.test(path.basename(d))) usage('the folder must be named after its prototype id (proto-...): ' + d);
  }
  const checkId = flags['check-frames'] || null;
  if (checkId && !protoDirs.some((d) => path.basename(d) === checkId)) usage('--check-frames ' + checkId + ' is not among --prototypes');
  if (!fs.existsSync(path.join(SEED_DIR, 'package.json'))) usage('no build shell seed in ' + SEED_DIR);

  fs.mkdirSync(logDir, { recursive: true });
  const result = { ok: false, out, shell: shellDir, steps: [], staged: [], distJpgCount: 0, bundledJpgCount: 0, expectedJpg: 0, expectedBundled: 0 };
  const record = (name, code, started, log) => {
    result.steps.push({ name, code, ms: Date.now() - started, log });
    return code === 0;
  };
  const run = (name, cmd, args, cwd, extraEnv) => {
    const started = Date.now();
    const log = path.join(logDir, name + '.log');
    const r = spawnSync(cmd, args, { cwd, env: childEnv(extraEnv), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && cmd === 'npm' });
    fs.writeFileSync(log, (r.stdout || '') + (r.stderr || ''));
    const code = r.status === null ? 1 : r.status;
    return { ok: record(name, code, started, log), stdout: r.stdout || '', code };
  };
  const finish = (ok) => {
    result.ok = ok;
    if (flags.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else {
      for (const s of result.steps) process.stdout.write((s.code === 0 ? 'OK   ' : 'FAIL ') + s.name + '  (' + s.ms + ' ms)  ' + s.log + '\n');
      process.stdout.write((ok ? 'PASS' : 'FAIL') + '  shell: ' + shellDir + '\n');
    }
    return ok ? 0 : 1;
  };

  // 1. the shell: the seed, copied
  let started = Date.now();
  emptyShellKeepingModules(shellDir);
  fs.cpSync(SEED_DIR, shellDir, {
    recursive: true,
    filter: (src) => !['node_modules', 'dist', '.git'].includes(path.basename(src)),
  });
  record('seed', 0, started, '');

  // 2. the prototypes, staged by the cockpit's own helpers
  const protosDir = path.join(dataDir, 'ds-data', 'prototypes');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(protosDir, { recursive: true });
  for (const d of protoDirs) fs.cpSync(d, path.join(protosDir, path.basename(d)), { recursive: true });
  const sourceJpgs = protoDirs.flatMap((d) => listFiles(path.join(d, 'assets'), []).filter((f) => /\.jpe?g$/i.test(f)));
  result.expectedJpg = sourceJpgs.length;
  // The bundler emits identical pictures once, so the hashed copies are counted by content.
  // Only recorded frames (assets/frames/, the folder a briefing's import.meta.glob
  // names) are bundled, and Vite inlines a file under 4 KB as a data URL.
  const frameSep = path.sep + 'assets' + path.sep + 'frames' + path.sep;
  const bundledSources = sourceJpgs.filter((f) => f.includes(frameSep) && fs.statSync(f).size >= 4096);
  result.expectedBundled = new Set(bundledSources.map((f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'))).size;
  const stage = run('stage', process.execPath, ['-e', STAGE_CHILD], ROOT, {
    IS_TEST_MODE: '1',
    AUTO_SYNC_ENABLED: '0',
    POC_PAGES_DATA_DIR: shellDir,
    DATA_SUB_REPOS_DIR: dataDir,
    DATA_TIER_0_DIR: path.join(dataDir, 'ds-data'),
    PSC_SERVER: SERVER,
    PSC_CONFIG: JSON.stringify({ ids: protoDirs.map((d) => path.basename(d)), protosDir }),
  });
  if (!stage.ok) return finish(false);
  try { result.staged = JSON.parse(stage.stdout).staged; } catch { /* the log has the output */ }

  // 3. the shell's own gates
  if (!run('install', 'npm', ['install', '--no-audit', '--no-fund', '--include=dev'], shellDir).ok) return finish(false);
  const bin = (name, rel) => path.join(shellDir, 'node_modules', name, rel);
  if (!run('eslint', process.execPath, [bin('eslint', 'bin/eslint.js'), '.'], shellDir).ok) return finish(false);
  if (!run('tsc', process.execPath, [bin('typescript', 'bin/tsc'), '-b', '--pretty', 'false'], shellDir).ok) return finish(false);
  if (!run('vite-build', process.execPath, [bin('vite', 'bin/vite.js'), 'build'], shellDir).ok) return finish(false);

  // 4. the build holds the pictures: the named copies under dist/proto-assets
  // (URL references) AND the hashed copies the bundler emits for
  // import.meta.glob (under dist/assets, one per distinct picture).
  const distFiles = listFiles(path.join(shellDir, 'dist'), []);
  const jpgs = distFiles.filter((f) => /\.jpe?g$/i.test(f));
  result.distJpgCount = jpgs.filter((f) => f.includes(path.sep + 'proto-assets' + path.sep)).length;
  result.bundledJpgCount = jpgs.filter((f) => !f.includes(path.sep + 'proto-assets' + path.sep)).length;
  const picturesOk = result.distJpgCount >= result.expectedJpg && result.bundledJpgCount >= result.expectedBundled;
  record('dist-pictures', picturesOk ? 0 : 1, Date.now(), '');
  if (!picturesOk) return finish(false);

  // 5. the briefing really shows its pictures (a served bundle, a real browser)
  if (checkId) {
    const port = await freePort();
    const preview = spawn(process.execPath, [bin('vite', 'bin/vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
      { cwd: shellDir, env: childEnv(), stdio: 'ignore' });
    try {
      const up = await waitForHttp('http://127.0.0.1:' + port + '/', 20000);
      if (!up) { record('preview', 1, Date.now(), ''); return finish(false); }
      const r = run('check-frames', process.execPath, [
        path.join(ROOT, 'scripts', 'proto-record.mjs'), '--check-frames', path.join(protosDir, checkId),
        '--base', 'http://127.0.0.1:' + port, '--shell', shellDir, '--json',
      ], ROOT);
      try {
        const rep = JSON.parse(r.stdout);
        result.framesLoaded = rep.framesLoaded === true;
        result.frameCheck = { images: rep.images, failed: rep.failed, pageErrors: rep.pageErrors };
      } catch { result.framesLoaded = false; }
      if (!r.ok || !result.framesLoaded) return finish(false);
    } finally {
      preview.kill();
    }
  }
  return finish(true);
}

main().then((code) => process.exit(code), (e) => {
  process.stderr.write('proto-shell-check internal error: ' + ((e && e.stack) || e) + '\n');
  process.exit(2);
});
