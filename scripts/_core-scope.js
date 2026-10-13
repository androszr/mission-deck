'use strict';
// scripts/_core-scope.js
// Who may change the CORE of this repository on this machine, in one place.
//
// The team's work happens in modules/ (gitignored, published through
// POST /api/modules/publish). The core is a stable base that people PULL, not
// a place they commit to. This module is the local, early half of that rule -
// it runs before a commit is made, so nobody spends an afternoon on a change
// they cannot push.
//
// It is NOT the enforcement. A local hook is advice: it can be skipped, and a
// fresh clone that never ran `npm install` has no hooks at all. The real lock
// is a protected branch on GitLab with push rights limited to maintainers.
// Both layers are wanted - GitLab refuses the push, this refuses the commit
// and says why in plain words, hours earlier.
//
// Shared by two callers that must agree:
//   - scripts/hook-core-scope.js, the pre-commit gate
//   - scripts/check-conventions.js, the `core-scope` rule in the audit
//
// Everything here is pure except `coreEditAllowed`, which reads one marker
// file; the decision itself is injected so it is unit-testable without a disk.

const fs = require('fs');
const path = require('path');

// The opt-out marker. Gitignored, so it can never travel to anybody else -
// which is the whole point: the guard is ON by default, and a person who
// maintains the core turns it off on their own machine, once.
const CORE_DEV_MARKER = '.core-dev';
const CORE_DEV_ENV = 'COCKPIT_CORE_DEV';

// Paths a module author legitimately changes. modules/ is gitignored and so
// reaches no commit here anyway; it is listed because --modules and a future
// non-ignored layout must both read the same rule.
const MODULE_PATH_RE = /^modules\//;

// Scopes that describe REAL work in this repository. `--files`, `--diff-file`
// and `--modules` are an explicit manual selection - the person already named
// what they wanted looked at - so the ownership question does not arise there,
// and the whole existing test corpus drives the checker through --diff-file.
const REAL_SCOPE_RE = /^(?:staged|worktree|base:)/;

// Lines a GENERATOR writes, per file. A diff whose every added and removed
// line matches the pattern for that file is a machine's doing, not a person's,
// and must not be read as "this person edited the core".
//
// These are the SAME two generated regions server.js exempts from the
// app-update dirty check (_APP_UPDATE_DIRT_EXEMPTIONS: _isModelOnlyAgentDiff,
// _isGitnexusBannerOnlyDiff), seen from the other side. server.js holds two
// FULL texts and compares everything outside a region byte for byte - for the
// GitNexus banner that region is the `<!-- gitnexus:start -->` ...
// `<!-- gitnexus:end -->` fence. This side sees a DIFF: `+`/`-` lines with no
// position, so a fence is invisible here and the rule has to name the one
// line the CLI rewrites, the counts line. Two views of one concept: when one
// side changes what counts as generated, the other must follow, and
// tests/test_server_helpers.mjs pins them to each other (the counts line this
// rule accepts must sit inside server.js's fence in the real AGENTS.md and
// CLAUDE.md, and the file patterns of both tables must agree).
const GENERATED_LINE_RULES = [
  {
    id: 'agent-model',
    fileRe: /^\.claude\/agents\/[^/]+\.md$/,
    lineRe: /^model:/,
    what: 'the `model:` line written by Settings > Agents',
  },
  {
    id: 'gitnexus-banner',
    fileRe: /^(?:AGENTS|CLAUDE)\.md$/,
    lineRe: /^(?:This project is indexed by GitNexus as|Indexed as) \*\*[^*\n]+\*\* \(\d+ symbols, \d+ relationships, \d+ execution flows\)/,
    what: 'the GitNexus banner line a reindex rewrites',
  },
];

/**
 * Does the ownership rule apply to this scope at all?
 * @param {string} scopeMode a `resolveScope().mode` value
 * @returns {boolean}
 */
function coreScopeApplies(scopeMode) {
  return REAL_SCOPE_RE.test(String(scopeMode || ''));
}

/**
 * Is this path part of the core? Pure.
 * @param {string} filePath repo-relative
 * @returns {boolean}
 */
function isCorePath(filePath) {
  return !MODULE_PATH_RE.test(String(filePath || ''));
}

/**
 * The generated-line rule this diff satisfies, or null. A file whose every
 * touched line is that one generated line is a generator's output.
 *
 * An EMPTY diff is never generated output: a rename or a mode change touches
 * no line, and reading that as "a machine did it" would wave through a file
 * move nobody reviewed. Neither is anything but a MODIFIED file - the same
 * restriction server.js puts on its app-update exemptions, and for the same
 * reason: adding or deleting one of these files is a person's decision, and a
 * deleted agent brief whose remaining lines happened to match would otherwise
 * be exempted out of the gate entirely.
 *
 * @param {{path: string, status?: string, added?: Array<{text: string}>, removed?: Array<{text: string}>}} file
 * @returns {{id: string, what: string}|null}
 */
function generatedOnlyChange(file) {
  if (!file || !file.path) return null;
  if (file.status && file.status !== 'M') return null;
  const rule = GENERATED_LINE_RULES.find((r) => r.fileRe.test(file.path));
  if (!rule) return null;
  const touched = [].concat(file.added || [], file.removed || []);
  if (touched.length === 0) return null;
  const isGenerated = touched.every((l) => rule.lineRe.test(String(l && l.text || '').trim()));
  return isGenerated ? { id: rule.id, what: rule.what } : null;
}

/**
 * May the core be edited here? Pure - both inputs injected.
 * @param {{markerPresent: boolean, envValue?: string}} input
 * @returns {boolean}
 */
function coreEditAllowed(input) {
  const i = input || {};
  return Boolean(i.markerPresent) || String(i.envValue || '') === '1';
}

/**
 * The same question against a real checkout.
 * @param {string} root repository root
 * @param {object} [env] defaults to process.env
 * @returns {boolean}
 */
function coreEditAllowedIn(root, env) {
  const e = env || process.env;
  return coreEditAllowed({
    markerPresent: fs.existsSync(path.join(root, CORE_DEV_MARKER)),
    envValue: e[CORE_DEV_ENV],
  });
}

/**
 * Split changed files into the core paths that must be refused and the ones
 * that are fine (module code, or a generated line). Pure.
 * @param {Array<{path: string, added?: object[], removed?: object[]}>} files
 * @returns {{blocked: Array<{path: string}>, generated: Array<{path: string, what: string}>}}
 */
function partitionCoreChanges(files) {
  const blocked = [];
  const generated = [];
  for (const f of files || []) {
    if (!f || !f.path) continue;
    if (!isCorePath(f.path)) continue;
    const gen = generatedOnlyChange(f);
    if (gen) { generated.push({ path: f.path, what: gen.what }); continue; }
    blocked.push({ path: f.path });
  }
  return { blocked, generated };
}

module.exports = {
  CORE_DEV_MARKER,
  CORE_DEV_ENV,
  GENERATED_LINE_RULES,
  coreScopeApplies,
  isCorePath,
  generatedOnlyChange,
  coreEditAllowed,
  coreEditAllowedIn,
  partitionCoreChanges,
};
