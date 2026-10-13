#!/usr/bin/env node
'use strict';
// scripts/hook-lint-staged.js
//
// Runs from .husky/pre-commit instead of `npx lint-staged`. `npx` would try
// to fetch the package from the registry mid-commit on the lean start
// profile, where devDependencies are not installed - this script decides
// what to do instead:
//
//   (a) lint-staged is installed -> spawn it directly (bypassing npx),
//       forwarding node_modules/.bin on PATH exactly like the old husky
//       shim did, and forward its exit code;
//   (b) lint-staged is missing and the commit touches a .js/.mjs/.cjs file
//       -> hard stop with a plain-language message and exit 1. This is a gate, not
//       a bypass;
//   (c) lint-staged is missing and no JS file is staged -> allow the commit.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const JS_FILE_RE = /\.(?:js|mjs|cjs)$/i;

function shouldBlockCommit(stagedFiles, hasLintStaged, readFailed) {
  if (hasLintStaged) return false;
  // Fail closed. An unreadable staged list must never be read as "nothing to
  // lint": git missing from a GUI client's PATH, or any other read error,
  // would otherwise let an unlinted commit through on the start profile -
  // the gate would open on failure instead of shutting.
  if (readFailed) return true;
  return (stagedFiles || []).some((file) => JS_FILE_RE.test(file));
}

function getStagedFiles(repoRoot) {
  const out = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function main() {
  const repoRoot = path.join(__dirname, '..');
  const lintStagedBin = path.join(repoRoot, 'node_modules', 'lint-staged', 'bin', 'lint-staged.js');
  const hasLintStaged = fs.existsSync(lintStagedBin);

  let stagedFiles = [];
  let readFailed = false;
  try {
    stagedFiles = getStagedFiles(repoRoot);
  } catch (err) {
    readFailed = true;
    process.stderr.write(`[hook-lint-staged] could not read staged files: ${err.message}\n`);
  }

  if (hasLintStaged) {
    const binDir = path.join(repoRoot, 'node_modules', '.bin');
    const env = Object.assign({}, process.env, { PATH: binDir + path.delimiter + (process.env.PATH || '') });
    const result = spawnSync(process.execPath, [lintStagedBin], { stdio: 'inherit', env });
    process.exit(result.status === null || result.status === undefined ? 1 : result.status);
    return;
  }

  if (shouldBlockCommit(stagedFiles, hasLintStaged, readFailed)) {
    // stderr, not stdout: GUI git clients (Sourcetree, Fork, Tower) surface a
    // hook's stderr and swallow its stdout, so on stdout the block would be
    // silent - exit 1 with no visible reason.
    process.stderr.write(readFailed
      ? 'Could not read the list of files in this commit, so they cannot be checked.\n' +
        'Commit stopped on purpose. Check that the `git` command is available and try again.\n'
      : 'This commit changes JavaScript files, and this install has no developer tools.\n' +
        'Run `npm install --include=dev` and try again.\n');
    process.exit(1);
    return;
  }

  console.log('[hook-lint-staged] lint-staged not installed, no staged JS/MJS/CJS files - skipping.');
  process.exit(0);
}

if (require.main === module) {
  main();
} else {
  module.exports = { shouldBlockCommit, JS_FILE_RE };
}
