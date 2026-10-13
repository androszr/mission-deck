#!/usr/bin/env node
'use strict';
// scripts/hook-core-scope.js
//
// Pre-commit gate: on a machine that has not opted in, a commit may only
// touch modules/. The reasoning, the marker file and the pure decision live
// in scripts/_core-scope.js, shared with the `core-scope` rule in
// scripts/check-conventions.js so the hook and the audit cannot disagree.
//
// Single-purpose on purpose, exactly like restore-agent-models-for-commit.js:
// the full conventions check is not run here, so this costs one `git diff
// --cached --name-only` and nothing else.
//
// Exit 0 allow, 1 block.

const path = require('path');
const { execFileSync } = require('child_process');
const CS = require('./_core-scope');

function getStagedFiles(repoRoot) {
  const out = execFileSync(
    'git',
    // D included: deleting a core file is changing the core. Leaving it out
    // let `git rm server.js && git commit` walk straight through this gate.
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRD'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * A staged path is refused when it is core AND this machine did not opt in.
 * The generated-line exemption is deliberately NOT applied here: by the time
 * the hook runs, restore-agent-models-for-commit.js has already put the
 * `model:` lines back, so a staged agent file that still differs is a real
 * edit. Pure, so the decision is unit-testable without git.
 * @param {string[]} stagedFiles
 * @param {boolean} allowed
 * @returns {string[]} the paths that block the commit
 */
function blockedPaths(stagedFiles, allowed) {
  if (allowed) return [];
  return (stagedFiles || []).filter((f) => CS.isCorePath(f));
}

function main() {
  const repoRoot = path.join(__dirname, '..');
  if (CS.coreEditAllowedIn(repoRoot)) process.exit(0);

  let staged;
  try {
    staged = getStagedFiles(repoRoot);
  } catch (err) {
    // Fail OPEN, unlike hook-lint-staged.js. That gate protects code quality
    // and a silent pass would ship an unlinted file; this one decides who owns
    // the repository, and GitLab's protected branch answers that for real. A
    // git that cannot be read here must not turn into a commit nobody can
    // make - it would look like the repo is broken, with no way to tell why.
    process.stderr.write(`[hook-core-scope] could not read the file list: ${err.message}\n`);
    process.exit(0);
    return;
  }

  const blocked = blockedPaths(staged, false);
  if (blocked.length === 0) process.exit(0);

  const shown = blocked.slice(0, 10);
  const rest = blocked.length - shown.length;
  // stderr, not stdout: GUI git clients surface a hook's stderr and swallow
  // its stdout - the same reason hook-lint-staged.js writes there.
  process.stderr.write(
    'This commit changes the Mission Deck core, and this machine has not opted in to that.\n\n'
    + 'Files outside modules/:\n'
    + shown.map((f) => '  - ' + f).join('\n') + '\n'
    + (rest > 0 ? `  ...and ${rest} more\n` : '')
    + '\nThe team builds MODULES in modules/ and publishes them with\n'
    + 'Settings > Modules > Publish. The core is a shared base you pull.\n\n'
    + 'If you maintain the core, turn this on once on your machine:\n'
    + `  touch ${CS.CORE_DEV_MARKER}\n`
    + `The file is in .gitignore, so it stays on your machine only. For a single commit: ${CS.CORE_DEV_ENV}=1 git commit ...\n`,
  );
  process.exit(1);
}

if (require.main === module) {
  main();
} else {
  module.exports = { blockedPaths, getStagedFiles };
}
