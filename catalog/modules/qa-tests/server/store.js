'use strict';
// modules/qa-tests/server/store.js
// The only file in this module that touches fs for the data repository.
// Owns jira/qa-automation/ inside the team data source: index.json plus
// one module-<key>.json shard per QA module. The refresh script writes them;
// this file only reads. No lock needed here - writes are serialised by the
// ctx.makeLock() chain lock in server/index.js.

const fs = require('fs');
const path = require('path');

const JUNK_ENTRIES = new Set(['.gitignore', '.DS_Store']);
const QA_SUBDIR = path.join('jira', 'qa-automation');

/**
 * Where this machine's team data plaintext tree lives, or `null` when the
 * core does not resolve it (storage unavailable).
 *
 * The core answers through ctx.dataRepoDir('data-tier-0') - the source is
 * declared in module.json dataRepos[], so the core owns the path (and its
 * DATA_SUB_REPOS_DIR relocation). Asked on EVERY call, never frozen into a
 * module-level const. The hand-built fallback below serves only a core older
 * than ctx.dataRepoDir (and the unit tests' bare ctx); it is read on every
 * call too, because the tests set DATA_SUB_REPOS_DIR mid-case.
 * @param {{rootDir: string, dataRepoDir?: (name: string) => string|null}} ctx
 * @returns {string|null}
 */
function teamDataDir(ctx) {
  if (ctx && typeof ctx.dataRepoDir === 'function') {
    const dir = ctx.dataRepoDir('data-tier-0');
    return typeof dir === 'string' && dir ? dir : null;
  }
  if (process.env.DATA_TIER_0_DIR) return path.resolve(process.env.DATA_TIER_0_DIR);
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(ctx.rootDir, 'data-sub-repositories');
  return path.join(base, 'ds-data');
}

/**
 * 'ok' when the team data source is cloned (a non-empty directory, junk
 * files ignored), 'unavailable' otherwise.
 * @param {string|null} dir team data root (teamDataDir output)
 * @returns {'ok'|'unavailable'}
 */
function storageState(dir) {
  if (!dir) return 'unavailable';
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 'unavailable';
  }
  return entries.some((e) => !JUNK_ENTRIES.has(e)) ? 'ok' : 'unavailable';
}

/**
 * Reads jira/qa-automation/index.json, or the empty shape when it does not
 * exist yet (a module installed before any refresh).
 *
 * On-disk format (_common.py _update_shard_index):
 *   { "meta": { shard_to_module, aggregates, schema_version, ... }, "keys": [...] }
 *
 * @param {string} dir team data root
 * @returns {{meta: object, shard_to_module: object, aggregates: object}}
 */
function readIndex(dir) {
  if (!dir) return { meta: {}, shard_to_module: {}, aggregates: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, QA_SUBDIR, 'index.json'), 'utf8'));
    if (parsed && typeof parsed === 'object') {
      const meta = (parsed.meta && typeof parsed.meta === 'object') ? parsed.meta : {};
      const shardToModule = (meta.shard_to_module && typeof meta.shard_to_module === 'object')
        ? meta.shard_to_module : {};
      const aggregates = (meta.aggregates && typeof meta.aggregates === 'object')
        ? meta.aggregates : {};
      return { meta, shard_to_module: shardToModule, aggregates };
    }
  } catch {
    // Missing file or bad JSON - return empty shape.
  }
  return { meta: {}, shard_to_module: {}, aggregates: {} };
}

/**
 * Reads one module shard. The file name is built exclusively from the
 * validated moduleKey (never an unvalidated request string). `null` for a
 * missing shard (normal state before first refresh).
 * @param {string} dir team data root
 * @param {string} moduleKey e.g. 'orders', 'checkout'
 * @returns {object|null}
 */
function readShard(dir, moduleKey) {
  if (!dir) return null;
  if (!moduleKey || typeof moduleKey !== 'string' || /[^a-z0-9_-]/.test(moduleKey)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, QA_SUBDIR, 'module-' + moduleKey + '.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Reads all shards listed in index.shard_to_module. Returns an array of
 * module objects (the `modules` array); missing shards are
 * omitted rather than represented as null.
 * @param {string} dir team data root
 * @param {{shard_to_module: object}} index readIndex() output
 * @returns {object[]}
 */
function readAllShards(dir, index) {
  const shardMap = (index && index.shard_to_module) || {};
  const modules = [];
  for (const shardKey of Object.keys(shardMap)) {
    const shard = readShard(dir, shardKey);
    if (shard) modules.push(shard);
  }
  return modules;
}

module.exports = {
  teamDataDir,
  storageState,
  readIndex,
  readShard,
  readAllShards,
};
