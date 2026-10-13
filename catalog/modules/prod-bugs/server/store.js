'use strict';
// modules/prod-bugs/server/store.js
// READ-ONLY access to the module's prod-bugs/ directory in the team data
// source. Nothing in this file writes: the shards and the manifest key are
// written by the Python ETL (scripts/sync_prod_bugs_sprint.py) with one fixed
// serialization.

const fs = require('fs');
const path = require('path');

const JUNK_ENTRIES = new Set(['.gitignore', '.DS_Store']);
const SHARD_RE = /^prod-bugs-sprint-(\d+)\.json$/;

/**
 * Plaintext directory of the team data source. Read on EVERY call (the
 * API suite sets DATA_SUB_REPOS_DIR mid-case). Prefers the host's
 * ctx.dataRepoDir (declared dataRepos entry); falls back to the env/dir
 * convention for an older core.
 * @param {{rootDir: string, dataRepoDir?: (name: string) => (string|null)}} ctx
 * @returns {string}
 */
function teamDataDir(ctx) {
  if (ctx && typeof ctx.dataRepoDir === 'function') {
    let viaHost = null;
    try { viaHost = ctx.dataRepoDir('data-tier-0'); } catch { viaHost = null; }
    if (viaHost) return viaHost;
  }
  if (process.env.DATA_TIER_0_DIR) return path.resolve(process.env.DATA_TIER_0_DIR);
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(ctx.rootDir, 'data-sub-repositories');
  return path.join(base, 'ds-data');
}

/** The module's own directory inside the team data root.
 * @param {string} dir team data root */
function progressDir(dir) {
  return path.join(dir, 'prod-bugs');
}

/**
 * 'ok' when the source is cloned (non-empty directory, junk ignored),
 * 'unavailable' otherwise. A fresh machine with no clone is a normal state.
 * @param {string} dir
 * @returns {'ok'|'unavailable'}
 */
function storageState(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 'unavailable';
  }
  return entries.some((e) => !JUNK_ENTRIES.has(e)) ? 'ok' : 'unavailable';
}

/** @param {unknown} raw @returns {number|null} digits only, else null */
function parseSprintN(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Scans prod-bugs/ for prod-bugs-sprint-<n>.json, sorted numerically by the
 * number in the FILE NAME. A corrupt shard is skipped (named in `skipped`),
 * never thrown.
 * @param {string} pDir module data directory
 * @returns {{sprints: object[], availableSprints: number[], skipped: string[]}}
 */
function listShards(pDir) {
  const out = { sprints: [], availableSprints: [], skipped: [] };
  let names;
  try {
    names = fs.readdirSync(pDir);
  } catch {
    return out;
  }
  const found = [];
  for (const name of names) {
    const m = SHARD_RE.exec(name);
    if (m) found.push({ name, n: Number(m[1]) });
  }
  found.sort((a, b) => a.n - b.n);
  for (const { name, n } of found) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(pDir, name), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      out.sprints.push(parsed);
      out.availableSprints.push(n);
    } catch {
      out.skipped.push(name);
    }
  }
  return out;
}

/**
 * Sprint numbers of the shards on disk, ascending, from FILE NAMES only - no
 * shard is opened. The dashboard widget uses this to read just the newest few.
 * @param {string} pDir
 * @returns {number[]}
 */
function shardNumbers(pDir) {
  let names;
  try {
    names = fs.readdirSync(pDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const m = SHARD_RE.exec(name);
    if (m) out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}

/**
 * One shard by number. The file name is built from a validated integer only.
 * @param {string} pDir
 * @param {number} n
 * @returns {object|null}
 */
function readShard(pDir, n) {
  if (!Number.isSafeInteger(n) || n < 0) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(pDir, 'prod-bugs-sprint-' + n + '.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** What the manifest says (availableProdBugsSprints), [] when unreadable.
 * @param {string} pDir @returns {number[]} */
function readManifestSprints(pDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(pDir, 'manifest.json'), 'utf8'));
    const list = parsed && parsed.availableProdBugsSprints;
    return Array.isArray(list) ? list.filter((x) => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

module.exports = {
  teamDataDir,
  progressDir,
  storageState,
  parseSprintN,
  listShards,
  shardNumbers,
  readShard,
  readManifestSprints,
};
