#!/usr/bin/env node
// scripts/test-unit-js.js
// Runs pure unit tests in parallel via `node --test`:
//   tests/test_*.mjs                      the Mission Deck core
//   catalog/modules/<id>/tests/test_*.mjs one module of the bundled catalog
//   modules/<id>/tests/test_*.mjs         one installed module
//
// A module that is both in the catalog and installed runs ONCE, from its
// installed copy: that is the code this machine runs (and possibly edits
// before publishing it back), and running both copies side by side would
// only double the suite and race on any fixture the two share.
//
// Server-bound tests live in tests/test_api_*.js and run sequentially via
// `npm run test:api` - they must NOT be matched here (port conflicts).
//
// modules/ is gitignored, so module tests never reach the team through a
// commit; they run for whoever has that module installed. A module with no
// tests/ directory is simply skipped, and a fresh clone with no modules/ at
// all still runs the core suite.
//
// --core drops both module blocks (catalog and installed), and that is what
// .husky/pre-push runs. The
// sentence above is the whole reason: a module is somebody else's code,
// downloaded from the shared catalog and never part of a push of THIS repo,
// so it must not decide whether this repo's push is allowed. It happened -
// a module published with `status: "stable"` in its manifest while its own
// bundled test still asserted "beta" failed on arrival, and from then on
// every core push by everyone who had installed it was refused for a reason
// none of them caused and none of them could fix from this repo. The gate
// now covers exactly what the push contains.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UNIT_RE = /^test_.*\.mjs$/;

/** Every test_*.mjs directly inside `dir`, as paths relative to `root`. */
function _testsIn(root, dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter((f) => UNIT_RE.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Module directory names under `dir` (no dotfiles, no node_modules), sorted. */
function _moduleIdsIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch (_e) {
    return [];
  }
}

/**
 * Discover the unit-test files to run: the core suite first, then one block
 * per catalog module (catalog/modules/<id>/) that is not installed, then one
 * block per installed module, each in directory order.
 * @param {string} [root] repo root (overridable for tests)
 * @param {{includeModules?: boolean}} [opts] `includeModules: false` returns
 *   the core suite alone - the push gate's scope. Defaults to true, so every
 *   existing caller keeps the full suite.
 * @returns {string[]} paths relative to `root`
 */
function discoverTests(root, opts) {
  const base = root || ROOT;
  const files = _testsIn(base, 'tests');
  if (opts && opts.includeModules === false) return files;

  // No modules/ is a fresh clone, no catalog/ a trimmed one: both add nothing.
  const moduleIds = _moduleIdsIn(path.join(base, 'modules'));
  const installed = new Set(moduleIds);
  for (const id of _moduleIdsIn(path.join(base, 'catalog', 'modules'))) {
    if (installed.has(id)) continue;
    files.push(..._testsIn(base, path.join('catalog', 'modules', id, 'tests')));
  }
  for (const id of moduleIds) {
    files.push(..._testsIn(base, path.join('modules', id, 'tests')));
  }
  return files;
}

function main() {
  const includeModules = !process.argv.slice(2).includes('--core');
  const files = discoverTests(ROOT, { includeModules });
  if (files.length === 0) {
    console.log('[test-unit-js] no test_*.mjs files found - nothing to run.');
    process.exit(0);
  }
  if (!includeModules) {
    // Say it out loud. Silence here would read as "your module passed".
    console.log('[test-unit-js] --core: ' + files.length
      + ' core test files; catalog and installed modules skipped (run `npm test` for those).');
  }
  const fromModules = files.filter((f) => f.startsWith('modules' + path.sep)).length;
  const fromCatalog = files.filter((f) => f.startsWith('catalog' + path.sep)).length;
  if (fromModules + fromCatalog > 0) {
    console.log('[test-unit-js] ' + files.length + ' unit test files (' + fromCatalog + ' from the catalog, '
      + fromModules + ' from installed modules)');
  }
  // COCKPIT_TEST_SCOPE=core lets a test that reads a LIVE data repo (gitignored,
  // changing under somebody's work, e.g. tests/test_shell_screens_registry.mjs)
  // step out of the push gate: its red there would depend on who is building
  // what right now, not on the push.
  const env = includeModules ? process.env : { ...process.env, COCKPIT_TEST_SCOPE: 'core' };
  const result = spawnSync('node', ['--test', ...files], { stdio: 'inherit', cwd: ROOT, env });
  process.exit(result.status !== null ? result.status : 1);
}

if (require.main === module) main();
else module.exports = { discoverTests };
