'use strict';
// rollout-waves/server/shard-store.js
// The only server file with fs. One shard layout for two directories:
// rollout-waves/training-done/ and rollout-waves/webinar-done/. Each directory holds index.json
// plus one <PREFIX>.json per 3-char code prefix (prefixOf). Every shard body
// has the shape { stores: { "<code>": {...} } } - a done-import shard, the
// only kind this module still writes; this file only diffs bytes, writes
// tmp+rename and keeps index.json in sync with whatever shards exist on
// disk. A done import is always merge-only: it never removes a shard that
// is not among the ones it touched.
//
// index.json trap: it must be rewritten on EVERY change to any shard (the
// dashboard cache in server/index.js is keyed on this file's mtime), but a
// second identical import must report 0 written. A content-only shard
// rewrite (same row count, different field values) leaves the DERIVED index
// - per-shard counts plus total/shards/meta - byte-identical to the
// previous one, so a rewrite fires when EITHER the derived index differs
// from the previous one (`updated_at` excluded) OR this call actually wrote
// or removed a shard file - never on derived sameness alone.

const fs = require('fs');
const path = require('path');

const core = require('./rollout-core.js');

/**
 * The 3-char shard prefix for a location code, or 'other' when the code is
 * shorter than 3 characters. Uppercased so 'ab812' and 'AB812' land in the
 * same shard.
 * @param {unknown} code
 * @returns {string}
 */
function prefixOf(code) {
  const trimmed = String(code === null || code === undefined ? '' : code).trim().toUpperCase();
  return trimmed.length < 3 ? 'other' : trimmed.slice(0, 3);
}

/**
 * Groups items by the prefix of the code `codeOf` extracts from each one.
 * @param {unknown[]} items
 * @param {(item: unknown) => unknown} codeOf
 * @returns {Map<string, unknown[]>}
 */
function groupByPrefix(items, codeOf) {
  const map = new Map();
  for (const item of items || []) {
    const prefix = prefixOf(codeOf(item));
    if (!map.has(prefix)) map.set(prefix, []);
    map.get(prefix).push(item);
  }
  return map;
}

/**
 * Parses a JSON file, never throwing. `null` on a missing or unparsable file
 * or a non-object result.
 * @param {string} file
 * @returns {object|null}
 */
function readJsonSafe(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads a sharded directory: the index plus every shard it names. A shard
 * file that is missing or unparsable is skipped and reported in `errors`,
 * never thrown - a partially readable directory is still readable.
 * @param {string} dir
 * @returns {{exists: boolean, index: object|null, shards: Map<string, object>, errors: {prefix: string, file: string}[]}}
 */
function readShardedDir(dir) {
  const index = readJsonSafe(path.join(dir, 'index.json'));
  const shards = new Map();
  const errors = [];
  if (!index || !index.shards || typeof index.shards !== 'object') {
    return { exists: !!index, index, shards, errors };
  }
  for (const prefix of Object.keys(index.shards)) {
    const file = path.join(dir, prefix + '.json');
    const payload = readJsonSafe(file);
    if (payload === null) {
      errors.push({ prefix, file });
      continue;
    }
    shards.set(prefix, payload);
  }
  return { exists: true, index, shards, errors };
}

/** How many records a shard payload carries, for the index.json counters. */
function _countOf(payload) {
  if (payload && Array.isArray(payload.rows)) return payload.rows.length;
  if (payload && payload.stores && typeof payload.stores === 'object') return Object.keys(payload.stores).length;
  return 0;
}

/**
 * Writes the shards in `byPrefix` (only the ones given - a done-import call
 * passes just the touched prefixes) and refreshes index.json. Every shard
 * write is tmp+rename and skipped entirely when the bytes are unchanged.
 * Merge-only by construction: a shard absent from `byPrefix` is left exactly
 * as it is on disk.
 * @param {string} dir
 * @param {Map<string, object>} byPrefix prefix -> exact JSON body for that shard
 * @param {object} meta index.json fields besides updated_at/total/shards (dataset, ...)
 * @returns {{written: number, unchanged: number, removed: number, total: number}}
 */
function writeShardedDir(dir, byPrefix, meta) {
  fs.mkdirSync(dir, { recursive: true });

  const indexFile = path.join(dir, 'index.json');
  const oldIndex = readJsonSafe(indexFile);
  const shardCounts = (oldIndex && oldIndex.shards && typeof oldIndex.shards === 'object') ? { ...oldIndex.shards } : {};

  let written = 0;
  let unchanged = 0;
  // Merge-only writer: nothing here ever unlinks a shard, so `removed` stays
  // 0 forever. Kept in the return shape because callers (server/index.js,
  // tests) destructure it.
  const removed = 0;

  for (const [prefix, payload] of byPrefix.entries()) {
    const file = path.join(dir, prefix + '.json');
    const nextText = JSON.stringify(payload, null, 2) + '\n';
    let currentText = null;
    try { currentText = fs.readFileSync(file, 'utf8'); } catch { /* shard does not exist yet */ }
    if (currentText === nextText) {
      unchanged += 1;
    } else {
      const tmp = file + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, nextText, 'utf8');
      fs.renameSync(tmp, file);
      written += 1;
    }
    shardCounts[prefix] = _countOf(payload);
  }

  const sortedShards = {};
  for (const prefix of Object.keys(shardCounts).sort()) sortedShards[prefix] = shardCounts[prefix];
  const total = Object.values(sortedShards).reduce((sum, n) => sum + n, 0);

  const proposedIndex = { ...meta, total, shards: sortedShards };
  let sameAsOld = false;
  if (oldIndex) {
    const oldForCompare = { ...oldIndex };
    delete oldForCompare.updated_at;
    sameAsOld = JSON.stringify(oldForCompare) === JSON.stringify(proposedIndex);
  }
  // A content-only shard rewrite (a fresher imported_at for a code already
  // there) can leave the derived index - the
  // per-shard row COUNTS plus total/shards/meta - byte-identical to the
  // previous one even though a shard's bytes on disk changed. index.json
  // must move whenever real bytes moved, or the dashboard cache in
  // server/index.js (keyed on this file's mtime) serves stale content
  // forever. So a rewrite happens when the derived index differs OR when
  // this call actually touched a shard file, never on derived sameness alone.
  if (!sameAsOld || written > 0) {
    const finalIndex = { ...proposedIndex, updated_at: new Date().toISOString() };
    // Key order: meta, then updated_at, then total/shards.
    const ordered = { ...meta, updated_at: finalIndex.updated_at, total, shards: sortedShards };
    const tmp = indexFile + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, indexFile);
  }

  return { written, unchanged, removed, total };
}

/**
 * Reads waves-config.json and normalizes it. A missing or unparsable file
 * yields the same defaults `normalizeWaveConfig(null)` would.
 * @param {string} file
 * @returns {{firstWaveStart: string, wavesCount: number, managers: object, source: string}}
 */
function readWaveConfigFile(file) {
  return core.normalizeWaveConfig(readJsonSafe(file));
}

module.exports = {
  prefixOf,
  groupByPrefix,
  readJsonSafe,
  readShardedDir,
  writeShardedDir,
  readWaveConfigFile,
};
