#!/usr/bin/env node
// Cross-platform setup for the Playwright MCP integration (Mac + Windows + Linux).
//
// Idempotent: safe to re-run. Downloads the Chromium build that the Playwright
// MCP server drives, and warms the MCP package itself so the first real use is
// not a silent multi-minute download inside Claude Code.
//
// Why this is a separate script and not part of `npm install`:
// the browser download is ~150 MB and only the visual-verification path needs
// it (`/new-idea` Phase 6g and the playwright-specialist agent). Keeping it
// opt-in leaves the default start profile at three packages (see .npmrc).
// `scripts/postinstall.js` prints a one-line hint when the browser is missing,
// so the dependency stays visible.
//
// Usage:  node scripts/bootstrap-playwright.js [--headless-shell-only] [--force]

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');

// Pinned so a re-run months from now installs the same browser everyone else
// has. Bump deliberately, together with a visual-verify smoke run.
const PLAYWRIGHT_VERSION = '1.56.0';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const SHELL_ONLY = argv.includes('--headless-shell-only');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`Usage: node scripts/bootstrap-playwright.js [options]

Installs the Chromium build used by the Playwright MCP server (visual
verification in /new-idea Phase 6g and the playwright-specialist agent).

Options:
  --headless-shell-only   Install only the headless shell (smaller, no headed runs)
  --force                 Re-run the download even when a browser is already present
  -h, --help              Show this message
`);
  process.exit(0);
}

function note(msg) { console.log(`\x1b[1;34m==>\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[1;33m!! \x1b[0m ${msg}`); }
function die(msg) { console.error(`\x1b[1;31mxx \x1b[0m ${msg}`); process.exit(1); }

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
}

// ── Where Playwright keeps its browsers ──────────────────────────────────────
// Shared with server.js (GET /api/tools/status) so the Tools tab and this
// bootstrapper can never disagree about whether a browser is installed.
const { browsersRoot, installedChromium } = require('./_playwright-paths');

// ── 1. Node version ──────────────────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  die(`Node.js ${process.versions.node} detected; Playwright requires 18+.`);
}
note(`Node.js ${process.versions.node} OK`);

// ── 2. npx availability ──────────────────────────────────────────────────────
const npxProbe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['npx'], { stdio: 'ignore' });
if (npxProbe.status !== 0) {
  die('npx not found on PATH. Install Node.js from https://nodejs.org and re-run.');
}

// ── 3. Chromium ──────────────────────────────────────────────────────────────
const already = installedChromium();
if (already.length > 0 && !FORCE) {
  note(`Chromium already present in ${browsersRoot()}: ${already.join(', ')}`);
  note('Skipping the download. Re-run with --force to reinstall.');
} else {
  const target = SHELL_ONLY ? 'chromium-headless-shell' : 'chromium';
  note(`Installing ${target} via playwright@${PLAYWRIGHT_VERSION} (about 150 MB, one time)`);
  try {
    run(`npx -y playwright@${PLAYWRIGHT_VERSION} install ${target}`);
  } catch (_) {
    die(`Browser install failed. Retry manually:\n     npx -y playwright@${PLAYWRIGHT_VERSION} install ${target}`);
  }
  const now = installedChromium();
  if (now.length === 0) {
    warn('Install command finished but no chromium build was found on disk.');
    warn(`Checked: ${browsersRoot()} (override with PLAYWRIGHT_BROWSERS_PATH).`);
  } else {
    note(`Chromium installed: ${now.join(', ')}`);
  }
}

// ── 4. Warm the MCP package ──────────────────────────────────────────────────
// .mcp.json launches the server with `npx -y @playwright/mcp@latest`. Fetching
// it now means the first tool call inside Claude Code does not stall on a
// download with no visible progress.
note('Warming the Playwright MCP package');
const warm = spawnSync('npx', ['-y', '@playwright/mcp@latest', '--version'], {
  cwd: REPO_ROOT,
  stdio: 'pipe',
  encoding: 'utf8',
  timeout: 180000,
  shell: process.platform === 'win32',
});
if (warm.status === 0) {
  note(`Playwright MCP ready (${(warm.stdout || '').trim() || 'version unknown'})`);
} else {
  warn('Could not pre-fetch @playwright/mcp. It will be downloaded on first use instead.');
}

// ── 5. Screenshot output dir ─────────────────────────────────────────────────
// .mcp.json passes --output-dir user-data/screenshots; a missing dir makes the
// first screenshot fail for a reason that reads like a Playwright bug.
const shotsDir = path.join(REPO_ROOT, 'user-data', 'screenshots');
try {
  fs.mkdirSync(shotsDir, { recursive: true });
  note('Screenshot directory ready: user-data/screenshots/');
} catch (e) {
  warn(`Could not create user-data/screenshots (${e.message}). Create it by hand.`);
}

console.log(`
\x1b[1;32mDone.\x1b[0m
- Browsers: ${browsersRoot()}
- MCP config: ${path.join(REPO_ROOT, '.mcp.json')} (committed)

Restart Claude Code in this directory; it will pick up the playwright MCP
server. Visual verification (/new-idea Phase 6g, playwright-specialist) then
works. Screenshots land in user-data/screenshots/ - always pass a BARE
filename, never a path.
`);
