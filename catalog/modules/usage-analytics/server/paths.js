'use strict';
// modules/usage-analytics/server/paths.js
// Paths, storage state and the two tiny fs helpers the other server files share.
// Nothing here reads a file at require() time - paths() only joins strings, so
// register(ctx) succeeds against a non-existent rootDir (the contract test does that).
//
// Team data: ONE file, <data-tier-0 plaintext>/usage-analytics/aggregated.json.
// The raw per-day Amplitude cache stays local under ctx.dataDir/amplitude/.

const fs = require('fs');
const path = require('path');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEAM_REPO = 'data-tier-0';

/**
 * Plaintext root of data-tier-0. The core answers through ctx.dataRepoDir; an
 * older core without it falls back to DATA_SUB_REPOS_DIR / the default layout.
 * @param {{rootDir: string, dataRepoDir?: Function}} ctx
 * @returns {string}
 */
function repoDir(ctx) {
  const viaCore = ctx && typeof ctx.dataRepoDir === 'function' ? ctx.dataRepoDir(TEAM_REPO) : null;
  if (viaCore) return viaCore;
  // ctx.dataRepoDir answers null for a source that is not on disk: that is "unavailable",
  // not a reason to guess a path - but only when the function exists at all.
  if (ctx && typeof ctx.dataRepoDir === 'function') return '';
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(ctx.rootDir, 'data-sub-repositories');
  return path.join(base, 'ds-data');
}

/**
 * @param {string} rootDir ctx.rootDir (kept for symmetry, unused)
 * @param {string} dataDir ctx.dataDir (data/modules/usage-analytics/)
 * @param {string} repo repoDir(ctx); '' = not available
 */
function paths(rootDir, dataDir, repo) {
  const moduleDir = repo ? path.join(repo, 'usage-analytics') : '';
  return {
    repoDir: repo || '',
    moduleDir,
    aggregateFile: moduleDir ? path.join(moduleDir, 'aggregated.json') : '',
    // read-only inputs: the team directory and the optional hand-kept alias map
    teamFile: repo ? path.join(repo, 'team', 'team-members.json') : '',
    aliasesFile: moduleDir ? path.join(moduleDir, 'aliases.json') : '',
    cacheDir: path.join(dataDir, 'amplitude'),
  };
}

/** 'ok' only when the plaintext repo directory exists on this machine. */
function storageState(dir) {
  try {
    return dir && fs.existsSync(dir) ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function readJsonSafe(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** tmp + rename. Creates the parent directory, so team-data callers use writeAggregate. */
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * The one write into team data. Re-checks the repo directory right now and
 * creates ONLY usage-analytics/ (non-recursive: never the repo root, which a
 * wiped plaintext tree must not get back from us). Never removes anything.
 */
function writeAggregate(p, data) {
  if (storageState(p.repoDir) !== 'ok') {
    const err = new Error('storage-unavailable');
    err.code = 'storage-unavailable';
    throw err;
  }
  try { fs.mkdirSync(p.moduleDir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const tmp = p.aggregateFile + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p.aggregateFile);
}

module.exports = { DAY_RE, TEAM_REPO, repoDir, paths, storageState, readJsonSafe, writeJsonAtomic, writeAggregate };
