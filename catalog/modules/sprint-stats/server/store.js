'use strict';
// modules/sprint-stats/server/store.js
// The only file in this module that touches fs for the data repository.
// Owns sprint-stats/ inside the team data source (data-tier-0): index.json
// plus one sprint-<src>-<n>.json shard per (src, sprint_n). The Python ETL
// funnels through mergeSprints(), so the knowledge of the on-disk layout -
// shard names, what goes into the index, what a "nothing changed" write
// looks like - lives in exactly one place. No `.lock` file on disk:
// serialization is the in-process `ctx.makeLock()` chain lock
// server/index.js shares between the write routes.

const fs = require('fs');
const path = require('path');

const normalize = require('./normalize.js');

const JUNK_ENTRIES = new Set(['.gitignore', '.DS_Store']);

/**
 * Plaintext directory of the team data source. Read on EVERY call - never
 * frozen into a module-level const - because the API test suite sets
 * DATA_SUB_REPOS_DIR mid-case. Prefers the host's ctx.dataRepoDir (the
 * declared dataRepos entry); falls back to the env/dir convention.
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

/** @param {string} dir team data root (teamDataDir output) */
function statsDir(dir) {
  return path.join(dir, 'sprint-stats');
}

/**
 * 'ok' when the team data source is cloned (a non-empty directory, junk
 * files ignored), 'unavailable' otherwise - a fresh machine with no clone is
 * a normal state, never a thrown error.
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

/**
 * Reads sprint-stats/index.json, or the empty shape when it does not exist
 * yet (a module installed before any refresh).
 * @param {string} dir team data root
 * @returns {{schema_version: number, boards: object, sprints: object[]}}
 */
function readIndex(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(statsDir(dir), 'index.json'), 'utf8'));
    if (parsed && typeof parsed === 'object') {
      return {
        schema_version: parsed.schema_version || 1,
        boards: parsed.boards && typeof parsed.boards === 'object' ? parsed.boards : {},
        sprints: Array.isArray(parsed.sprints) ? parsed.sprints : [],
      };
    }
  } catch {
    // Missing file or bad JSON both read as "no data yet".
  }
  return { schema_version: 1, boards: {}, sprints: [] };
}

/**
 * Reads one shard. The file name is built EXCLUSIVELY from a validated
 * `src` (one of normalize.SRC_IDS) and a validated non-negative integer `n` -
 * never from an unvalidated request string. `null` for a missing shard,
 * which is a normal state ("No data" in the table), not a 404.
 * @param {string} dir team data root
 * @param {string} src
 * @param {number} n
 * @returns {object|null}
 */
function readShard(dir, src, n) {
  if (!normalize.SRC_IDS.includes(src) || !Number.isInteger(n) || n < 0) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(statsDir(dir), `sprint-${src}-${n}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Reads the ETL child's `--out` file. `null` on a missing or unparsable
 * file - the caller then treats that stage as failed without ever writing
 * to sprint-stats/.
 * @param {string} outPath
 * @returns {{src: string, board: object, sprints: object[]}|null}
 */
function readEtlOut(outPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sprints)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Merges full merged-sprint objects (`{ src, sprint_n, phase, teams: [team-
 * sprint, ...] }`, WITH persons/issues/burndown) into sprint-stats/: one
 * shard file per (src, sprint_n) that is actually written, then index.json.
 * Shards are written before the index, so the index can never point at a
 * shard that is not yet on disk. Caller is expected to run this inside its
 * own `ctx.makeLock()` chain lock - this function itself takes no lock.
 * @param {string} dir team data root
 * @param {object[]} sprints full merged-sprint objects
 * @param {{onlyMissing?: boolean, boards?: {main?: object, platform?: object}}} [opts]
 * @returns {{written: number, skipped: number, writtenKeys: {src: string, sprint_n: number}[],
 *   skippedKeys: {src: string, sprint_n: number}[]}}
 */
function mergeSprints(dir, sprints, opts) {
  const onlyMissing = !!(opts && opts.onlyMissing);
  const boardsUpdate = (opts && opts.boards) || {};

  const index = readIndex(dir);
  const incomingEntries = (sprints || []).map((s) => normalize.indexEntryOf(s));
  const merge = normalize.mergeIndex(index.sprints, incomingEntries, { onlyMissing });

  const dirPath = statsDir(dir);
  fs.mkdirSync(dirPath, { recursive: true });

  const writtenKeySet = new Set(merge.written.map((w) => w.src + ':' + w.sprint_n));
  for (const s of sprints || []) {
    const key = s.src + ':' + s.sprint_n;
    if (!writtenKeySet.has(key)) continue;
    const file = path.join(dirPath, `sprint-${s.src}-${s.sprint_n}.json`);
    const nextText = JSON.stringify(s, null, 2) + '\n';
    const tmp = file + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, nextText, 'utf8');
    fs.renameSync(tmp, file);
  }

  // The ETL (onlyMissing: false) is the authority on a board block and
  // replaces it whole; an onlyMissing merge may only FILL a board that is
  // absent or empty.
  const boards = { ...index.boards };
  for (const src of Object.keys(boardsUpdate)) {
    if (!boardsUpdate[src]) continue;
    const current = boards[src];
    const currentEmpty = !current || typeof current !== 'object' || Object.keys(current).length === 0;
    if (!onlyMissing || currentEmpty) boards[src] = boardsUpdate[src];
  }

  const nextIndex = { schema_version: 1, boards, sprints: merge.sprints };
  const indexFile = path.join(dirPath, 'index.json');
  const nextText = JSON.stringify(nextIndex, null, 2) + '\n';
  let currentText = null;
  try {
    currentText = fs.readFileSync(indexFile, 'utf8');
  } catch {
    // No index.json yet - the write below creates it.
  }
  if (currentText !== nextText) {
    const tmp = indexFile + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, nextText, 'utf8');
    fs.renameSync(tmp, indexFile);
  }

  return {
    written: merge.written.length,
    skipped: merge.skipped.length,
    writtenKeys: merge.written,
    skippedKeys: merge.skipped,
  };
}

/** @param {string} dir team data root @returns {string} */
function spilloverPath(dir) {
  return path.join(statsDir(dir), 'spillover.json');
}

/**
 * Current text of sprint-stats/spillover.json, or null when it does not exist.
 * @param {string} dir team data root
 * @returns {string|null}
 */
function readSpilloverText(dir) {
  try {
    return fs.readFileSync(spilloverPath(dir), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Writes spillover.json (tmp + rename) only when the bytes differ.
 * Caller holds the module chain lock.
 * @param {string} dir team data root
 * @param {string} text
 * @returns {{written: boolean}}
 */
function writeSpilloverIfChanged(dir, text) {
  fs.mkdirSync(statsDir(dir), { recursive: true });
  if (readSpilloverText(dir) === text) return { written: false };
  const file = spilloverPath(dir);
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return { written: true };
}

module.exports = {
  teamDataDir,
  spilloverPath,
  readSpilloverText,
  writeSpilloverIfChanged,
  statsDir,
  storageState,
  readIndex,
  readShard,
  readEtlOut,
  mergeSprints,
};
