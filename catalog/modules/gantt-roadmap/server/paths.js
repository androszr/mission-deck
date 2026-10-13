'use strict';
// modules/gantt-roadmap/server/paths.js
// Paths to the gantt-roadmap/ plaintext tree in the team data repository
// (data-tier-0).
// Paths are computed from an explicit rootDir (never a frozen module-level
// constant) because the API test suite may set DATA_SUB_REPOS_DIR mid-case
// and a frozen value would then point at the developer's own checkout.
// Pattern: gr-zam-hub/server/paths.js

const fs = require('fs');
const path = require('path');

const JUNK_ENTRIES = new Set(['.gitignore', '.DS_Store']);

const DATA_REPO = 'data-tier-0';
const DATA_REPO_DIR_NAME = 'ds-data';

// ctx.dataRepoDir of the core this module registered with (null on an older
// core). Set by register(ctx) on EVERY registration, so a later register with
// a ctx that lacks it never inherits an earlier one.
let _coreRepoDir = null;

/** @param {{dataRepoDir?: Function}} ctx */
function useCoreResolver(ctx) {
  _coreRepoDir = ctx && typeof ctx.dataRepoDir === 'function' ? ctx.dataRepoDir : null;
}

/**
 * Team data plaintext root on this machine: the core answers through
 * ctx.dataRepoDir (it owns the layout); otherwise DATA_SUB_REPOS_DIR read at
 * call time, then the default layout.
 * @param {string} rootDir ctx.rootDir
 * @returns {string}
 */
function teamDataDir(rootDir) {
  const viaCore = _coreRepoDir ? _coreRepoDir(DATA_REPO) : null;
  if (viaCore) return viaCore;
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(rootDir, 'data-sub-repositories');
  return path.join(base, DATA_REPO_DIR_NAME);
}

/**
 * Root of all gantt-roadmap data within the team data repository.
 * @param {string} rootDir ctx.rootDir
 * @returns {string}
 */
function moduleDataDir(rootDir) {
  return path.join(teamDataDir(rootDir), 'gantt-roadmap');
}

/**
 * Directory for a specific quarter within gantt-roadmap/.
 * @param {string} rootDir ctx.rootDir
 * @param {string} quarterId e.g. "q4-2026"
 * @returns {string}
 */
function quarterDir(rootDir, quarterId) {
  return path.join(moduleDataDir(rootDir), quarterId);
}

/**
 * 'ok' when the team data repository holds data, 'empty' when it is cloned but
 * holds nothing yet, 'unavailable' when it is not cloned. Only
 * 'ok' lets a route write - an empty plaintext tree may also be a
 * half-decrypted one. A quarter directory not existing yet is NOT
 * 'unavailable' — it is created on first write.
 * @param {string} rootDir ctx.rootDir
 * @returns {'ok'|'empty'|'unavailable'}
 */
function storageState(rootDir) {
  let entries;
  try {
    entries = fs.readdirSync(teamDataDir(rootDir));
  } catch {
    return 'unavailable';
  }
  return entries.some((e) => !JUNK_ENTRIES.has(e)) ? 'ok' : 'empty';
}

module.exports = { DATA_REPO, useCoreResolver, teamDataDir, moduleDataDir, quarterDir, storageState };
