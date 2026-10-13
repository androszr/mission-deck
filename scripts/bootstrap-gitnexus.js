#!/usr/bin/env node
// Cross-platform setup for the gitnexus MCP integration (Mac + Windows).
//
// Idempotent: safe to re-run. Installs the CLI globally via npm, then builds
// the per-repo knowledge graph. After this, Claude Code picks up `.mcp.json`
// automatically.
//
// Usage:  node scripts/bootstrap-gitnexus.js

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');

// The analyze environment lives in scripts/_gitnexus-analyze.js, shared with
// the "Update map" button in Settings > Tools. Both callers must
// pass the same values or one of them produces a green result over an empty
// graph - the reasoning is written out in that file.
const { ANALYZE_ENV, CLI_VERSION: GITNEXUS_VERSION, analyzeCliArgs } = require('./_gitnexus-analyze');

function note(msg) { console.log(`\x1b[1;34m==>\x1b[0m ${msg}`); }
function warn(msg) { console.warn(`\x1b[1;33m!! \x1b[0m ${msg}`); }
function die(msg) { console.error(`\x1b[1;31mxx \x1b[0m ${msg}`); process.exit(1); }

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', cwd: REPO_ROOT, ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

// 1. Node.js version check (gitnexus needs 18+)
const nodeVer = process.versions.node.split('.').map(Number);
if (nodeVer[0] < 18) {
  die(`Node.js ${process.versions.node} detected; gitnexus requires 18+.`);
}
note(`Node.js ${process.versions.node} OK`);

// 2. Install gitnexus globally, AT THE PIN.
//
// The version is checked, not merely the presence of the binary. This step
// used to accept whatever `gitnexus --version` answered, so the pin in
// scripts/_gitnexus-analyze.js only ever applied to a machine that had no CLI
// at all - one `npm install -g gitnexus` without a version (the command a
// person reaches for when something looks stale) put a different analyzer on
// that machine for good. That is how the team ended up with two CLIs writing
// two different sets of generated files into one repository. The "Install"
// button in Settings > Tools always installed the pin; only this path
// disagreed with it.
let currentVer = null;
try {
  currentVer = runCapture('gitnexus --version');
} catch {
  // not installed
}

if (currentVer === GITNEXUS_VERSION) {
  note(`gitnexus ${currentVer} already installed (pinned)`);
} else {
  note(currentVer
    ? `gitnexus ${currentVer} installed, this repo pins ${GITNEXUS_VERSION} - switching`
    : `Installing gitnexus@${GITNEXUS_VERSION} globally via npm`);
  try {
    run(`npm install -g gitnexus@${GITNEXUS_VERSION}`);
    note(`gitnexus ${runCapture('gitnexus --version')} installed`);
  } catch (e) {
    // A failed switch is not fatal WHEN a working CLI is already there: the
    // analyzer runs with `--index-only`, so a version mismatch can no longer
    // rewrite a tracked file, and an index built by the wrong version still
    // beats no index. With nothing installed there is nothing to fall back to.
    if (!currentVer) die(`could not install gitnexus@${GITNEXUS_VERSION}: ${e.message}`);
    warn(`could not switch to gitnexus@${GITNEXUS_VERSION}, continuing with ${currentVer}`);
    warn('Fix it by hand with: npm install -g gitnexus@' + GITNEXUS_VERSION);
  }
}

// 3. Build or update the knowledge graph
const dbDir = path.join(REPO_ROOT, '.gitnexus');
if (fs.existsSync(dbDir)) {
  note('Updating existing knowledge graph');
} else {
  note('Building initial knowledge graph (first run takes ~30s)');
}

// A source archive (GitLab zip) has no .git; the analyzer refuses such a tree
// unless told to skip git history. The cockpit recreates the repository the
// first time the vault is unlocked (see scripts/_app-repo-adopt.js) - re-run
// this script afterwards for the full graph.
const analyzeArgs = analyzeCliArgs(REPO_ROOT);
if (analyzeArgs.includes('--skip-git')) {
  note('No .git directory (source archive): indexing without git history (--skip-git). Re-run after the cockpit has recreated the repository.');
}
run(`gitnexus ${analyzeArgs.join(' ')}`, {
  env: { ...process.env, ...ANALYZE_ENV },
});

console.log(`
\x1b[1;32mDone.\x1b[0m
- Knowledge graph: ${dbDir}/ (gitignored)
- MCP config: ${path.join(REPO_ROOT, '.mcp.json')} (committed)

Restart Claude Code in this directory; it will prompt to enable the
gitnexus MCP server. After that, use /review-pr for graph-aware
blast-radius analysis.
`);
