#!/usr/bin/env node
'use strict';
// scripts/prepare.js
//
// Runs as the npm "prepare" lifecycle script, replacing the old
// `"prepare": "husky"`. Sets core.hooksPath to .husky directly, so hooks
// work on both install profiles (start and co-create) without pulling in
// the husky package - all it added over this was PATH/init.sh glue our
// hooks (plain `node <script>` calls) do not need.
//
// Must never fail the install: a missing git binary, a missing .git
// directory, a missing .husky directory or a failing git command are all
// silent no-ops. This script always exits 0.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function shouldSetHooksPath({ hasGitDir, hasHooksDir }) {
  return !!(hasGitDir && hasHooksDir);
}

function main() {
  const repoRoot = path.join(__dirname, '..');
  const hasGitDir = fs.existsSync(path.join(repoRoot, '.git'));
  const hasHooksDir = fs.existsSync(path.join(repoRoot, '.husky'));

  if (shouldSetHooksPath({ hasGitDir, hasHooksDir })) {
    try {
      spawnSync('git', ['config', 'core.hooksPath', '.husky'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
    } catch (_) {
      // never fail the install over a hook-path setting
    }
  }

  process.exit(0);
}

if (require.main === module) {
  main();
} else {
  module.exports = { shouldSetHooksPath };
}
