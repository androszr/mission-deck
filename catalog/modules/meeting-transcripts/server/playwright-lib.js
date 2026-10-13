'use strict';
// modules/meeting-transcripts/server/playwright-lib.js
// Copied and adapted from modules/locations/server/playwright-lib.js.
// Never imported from it - trust boundary (modules-template/README.md).
// Getting at the playwright package without adding it as a dependency of
// this repo (package.json carries only ws + optional node-pty).
// Plus the Windows rules server.js already owns for its own child processes
// (_toolShell/_toolKill) reimplemented here, because ctx carries neither.

const fs = require('fs');
const path = require('path');

const PIN_REGEX = /PLAYWRIGHT_VERSION\s*=\s*'([^']+)'/;

/**
 * Reads the ONE pinned Playwright version this repo agrees on, from
 * scripts/bootstrap-playwright.js. Deliberately no fallback literal - a
 * second copy of the version string is a defect (no new npm dependencies).
 * @param {string} rootDir Mission Deck repo root (ctx.rootDir)
 * @returns {string}
 */
function readPinnedPlaywrightVersion(rootDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(rootDir, 'scripts', 'bootstrap-playwright.js'), 'utf8');
  } catch (e) {
    const err = new Error('scripts/bootstrap-playwright.js not readable: ' + e.message);
    err.code = 'playwright-pin-missing';
    throw err;
  }
  const m = text.match(PIN_REGEX);
  if (!m) {
    const err = new Error('PLAYWRIGHT_VERSION not found in scripts/bootstrap-playwright.js');
    err.code = 'playwright-pin-missing';
    throw err;
  }
  return m[1];
}

/**
 * @param {string} pathValue a PATH string
 * @param {string} delimiter path.delimiter for the platform that produced it (':' or ';')
 * @returns {string[]} node_modules directories, in PATH order, .bin suffix stripped
 */
function parseNodeModulesFromPath(pathValue, delimiter) {
  const parts = String(pathValue || '').split(delimiter).filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (/node_modules[\\/]\.bin$/.test(part)) {
      out.push(part.replace(/[\\/]\.bin$/, ''));
    }
  }
  return out;
}

/**
 * A shell ONLY for the .cmd/.bat shims (Node refuses to spawn them without
 * one), never for a real binary - see server.js _toolShell for the same
 * rule and the CVE-2024-27980 argument-splitting reason.
 */
function shellFor(cmd, platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(cmd || ''));
}

/**
 * `-p process.env.PATH` is ONE argument with no space and no quote, on
 * purpose: under `shell: true` (npm.cmd on Windows) Node joins command and
 * args UNQUOTED, so an argument with a space would split apart.
 * @returns {{cmd:string, args:string[], shell:boolean}}
 */
function discoveryCommand(version, platform) {
  const cmd = platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['exec', '--yes', '--package=playwright@' + version, '--', 'node', '-p', 'process.env.PATH'];
  return { cmd, args, shell: shellFor(cmd, platform) };
}

// Whitelist only - a child must not inherit the whole
// process.env: ps eww shows a process's whole environment to anyone on
// this account, and this server's process.env may carry .env secrets.
const CHILD_ENV_KEYS = [
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR',
  'SystemRoot', 'ComSpec', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'LANG', 'LC_ALL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'PLAYWRIGHT_BROWSERS_PATH',
];

/**
 * @param {object} source e.g. process.env
 * @returns {object} a NEW object carrying only CHILD_ENV_KEYS entries present in source
 */
function childEnv(source) {
  const env = {};
  const src = source || {};
  for (const key of CHILD_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined) env[key] = src[key];
  }
  return env;
}

/**
 * SIGTERM with a 5s grace period, then SIGKILL - everywhere except win32,
 * where `child.kill()` never reaches the tree and `taskkill /T /F` does
 * (mirrors server.js _toolKill).
 * @param {import('child_process').ChildProcess} child
 * @param {string} platform
 * @param {Function} spawnFn injected so a test never spawns a real process
 * @param {Function} [setTimeoutFn] injected clock, defaults to the real one
 */
function killTree(child, platform, spawnFn, setTimeoutFn) {
  const scheduler = setTimeoutFn || setTimeout;
  if (!child || !child.pid) return;
  if (platform === 'win32') {
    try { spawnFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
    return;
  }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  scheduler(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch { /* already gone */ }
  }, 5000);
}

function readJsonFileSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Resolves the on-disk node_modules directory that carries `playwright@pin`,
 * cached in dataDir/playwright-lib.json. `run` is injected so no test ever
 * shells out to npm.
 * @param {{rootDir:string, dataDir:string, run:Function, platform:string, existsFn?:Function, readJson?:Function}} opts
 *   `run({cmd, args, shell, env})` returns `Promise<{stdout:string, stderr:string}>`.
 * @returns {Promise<string>} absolute path to the node_modules directory
 */
async function resolveNodeModules(opts) {
  const { rootDir, dataDir, run, platform } = opts;
  const exists = opts.existsFn || fs.existsSync;
  const readJson = opts.readJson || readJsonFileSafe;
  const version = readPinnedPlaywrightVersion(rootDir);
  const cacheFile = path.join(dataDir, 'playwright-lib.json');

  const cached = readJson(cacheFile);
  if (cached && cached.version === version && cached.nodeModulesDir) {
    const pkgFile = path.join(cached.nodeModulesDir, 'playwright', 'package.json');
    const pkg = exists(pkgFile) ? readJson(pkgFile) : null;
    if (pkg && pkg.version === version) return cached.nodeModulesDir;
  }

  const { cmd, args, shell } = discoveryCommand(version, platform);
  const result = await run({ cmd, args, shell, env: childEnv(process.env) });
  const candidates = parseNodeModulesFromPath(result.stdout || '', platform === 'win32' ? ';' : ':');

  for (const dir of candidates) {
    const pkgFile = path.join(dir, 'playwright', 'package.json');
    if (!exists(pkgFile)) continue;
    const pkg = readJson(pkgFile);
    if (pkg && pkg.version === version) {
      fs.mkdirSync(dataDir, { recursive: true });
      const text = JSON.stringify({ version, nodeModulesDir: dir, checkedAt: new Date().toISOString() });
      const tmp = cacheFile + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, cacheFile);
      return dir;
    }
  }

  const err = new Error('playwright@' + version + ' not found on PATH after npm exec: ' + String(result.stderr || '').slice(0, 300));
  err.code = 'playwright-unavailable';
  throw err;
}

module.exports = {
  readPinnedPlaywrightVersion,
  parseNodeModulesFromPath,
  discoveryCommand,
  shellFor,
  childEnv,
  killTree,
  resolveNodeModules,
};
