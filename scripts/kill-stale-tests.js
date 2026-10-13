#!/usr/bin/env node
// Pre-test cleanup. Runs automatically before `test` / `test:js` / `test:api` via npm `pre*` hooks.
//
// Problem it solves: test files spawn their own `node server.js <PORT>` and then poll waitForServer.
// If a previous run left an orphaned test server holding a port (e.g. an interrupted suite, or — before
// the EADDRINUSE fast-fail in server.js — a zombie stuck in the retry loop), the next run's waitForServer
// times out and `node --test` appears to hang for minutes. This kills those orphans up front.
//
// SAFE: only targets `server.js` processes started WITH an explicit port arg (the test/embedded spawn
// shape `server.js <digits>`). It does NOT touch:
//   - the bare `node server.js` dev server on :3000 (no port arg),
//   - `node scripts/kb-mcp-server.js` (the KB MCP server),
//   - Chrome / Playwright helpers.
//
// OWN TREE ONLY: since parallel work moved into git worktrees
// (scripts/worktree.js, docs/architecture/worktrees.md) a second checkout of
// this repository can run its own test servers and its own verification
// server on the same machine. A match on the bare `server.js <digits>` shape
// alone would make `npm test` in one tree kill the servers of the other, so a
// process qualifies only when its command line names THIS tree's server.js by
// absolute path (tests/_api_helper.js always spawns that way) or the legacy
// relative `server.js <digits>` with no directory in front of it.

const path = require('path');
const { execSync } = require('child_process');

const OWN_ROOT = path.resolve(__dirname, '..');

/**
 * Is this command line a stale test server of the tree at `root`?
 * True for `<root>/server.js <digits>` (quoted or not, either separator) and
 * for a bare relative `server.js <digits>`; false for any other absolute path
 * and for scripts/kb-mcp-server.js.
 * @param {string} cmdline a `pgrep -fl` line or a CIM CommandLine block
 * @param {string} root absolute path of the repository root
 * @returns {boolean}
 */
function isOwnStaleTestServer(cmdline, root) {
  const text = String(cmdline || '');
  if (/kb-mcp-server/.test(text)) return false;
  const win = /\\/.test(text) || /^[A-Za-z]:[\\/]/.test(String(root || ''));
  const norm = (s) => {
    const t = String(s).replace(/\\/g, '/').replace(/\/+$/, '');
    return win ? t.toLowerCase() : t;
  };
  const ownRoot = norm(root || '');
  const re = /server\.js"?\s+\d+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // The token in front of `server.js`: everything back to whitespace or a quote.
    let i = m.index;
    while (i > 0 && !/[\s"']/.test(text[i - 1])) i--;
    const prefix = text.slice(i, m.index);
    if (prefix === '' || prefix === './' || prefix === '.\\') return true;
    // `<root>/` right in front, starting at a boundary. Compared on the whole
    // preceding text, not the token, so a root with a space in it still matches.
    if (!ownRoot) continue;
    // (The sentinel `x` stops norm() from trimming the trailing separator.)
    const before = norm(text.slice(0, m.index) + 'x').slice(0, -1);
    const want = ownRoot + '/';
    if (before.endsWith(want)) {
      const k = before.length - want.length;
      if (k === 0 || /[\s"']/.test(before[k - 1])) return true;
    }
  }
  return false;
}

// Required by a test: export the filter and do nothing else. Without this guard
// a require() would kill test servers and wipe tests/tmp under a running suite.
if (require.main !== module) {
  module.exports = { isOwnStaleTestServer };
  return;
}

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

let killed = 0;
const freedPorts = [];

if (process.platform === 'win32') {
  // Best-effort on Windows via PowerShell CIM (WMIC removed in Win 11 24H2+).
  const out = sh('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select-Object ProcessId,CommandLine | Format-List"');
  for (const block of out.split(/\r?\n\r?\n/)) {
    if (isOwnStaleTestServer(block, OWN_ROOT)) {
      const m = block.match(/ProcessId=(\d+)/);
      if (m && m[1] !== String(process.pid)) { sh(`taskkill /PID ${m[1]} /F`); killed++; }
    }
  }
} else {
  // pgrep -fl prints "<pid> <command line>"; match `server.js <digits>` (explicit port = test/embedded).
  const out = sh("pgrep -fl 'server\\.js'");
  const killedPids = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pid = trimmed.split(/\s+/)[0];
    if (!/^\d+$/.test(pid) || pid === String(process.pid)) continue;
    // Require an explicit port arg after server.js; skip the bare dev server and kb-mcp-server.
    if (!isOwnStaleTestServer(trimmed, OWN_ROOT)) continue;
    // Extract the port from the command line for logging.
    const portMatch = trimmed.match(/server\.js\s+(\d+)/);
    const port = portMatch ? portMatch[1] : null;
    sh(`kill -9 ${pid} 2>/dev/null || true`);
    killed++;
    killedPids.push(pid);
    if (port) freedPorts.push(port);
  }

  // Optional lsof certainty pass: confirm each freed port is now released.
  // Guards against lsof absence (non-macOS/linux) — any failure is a silent no-op.
  if (killedPids.length > 0 && freedPorts.length > 0) {
    try {
      for (const port of freedPorts) {
        const holders = sh(`lsof -ti:${port} 2>/dev/null`).trim();
        if (holders) {
          // Port still held by something else — kill it too (best-effort).
          for (const h of holders.split('\n')) {
            const hpid = h.trim();
            if (hpid && hpid !== String(process.pid)) {
              sh(`kill -9 ${hpid} 2>/dev/null || true`);
            }
          }
        }
      }
    } catch (_) { /* lsof absent or failed — no-op */ }
  }
}

if (killed > 0) {
  const portSuffix = freedPorts.length > 0 ? `; freed port(s): ${freedPorts.join(', ')}` : '';
  console.error(`[kill-stale-tests] killed ${killed} orphaned test server(s)${portSuffix}`);
}

// Clean up orphaned tests/tmp/ directories left by interrupted test runs.
// helpers.js:makeTempDirs() creates dirs here; process.on('exit') cleanup
// doesn't fire on kill -9 or crashes, so they accumulate.
const fs = require('fs');
const tmpDir = path.resolve(__dirname, '..', 'tests', 'tmp');
if (fs.existsSync(tmpDir)) {
  let cleaned = 0;
  try {
    for (const entry of fs.readdirSync(tmpDir)) {
      const full = path.join(tmpDir, entry);
      try { fs.rmSync(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); cleaned++; } catch (e) { console.error(`[kill-stale-tests] could not remove ${entry}: ${e.code || e.message}`); }
    }
  } catch { /* ignore */ }
  if (cleaned > 0) console.error(`[kill-stale-tests] cleaned ${cleaned} orphaned tests/tmp/ dir(s)`);
}
