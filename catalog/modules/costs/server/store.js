'use strict';
// modules/costs/server/store.js
// The ONLY file in this module that writes. Rates and hours are sensitive data:
// one writer, a containment check (everything under costs/) and a fixed prefix
// make the boundary structural (see README). The plaintext root of the team
// data set is NEVER created here - only the costs/ subtree inside an existing,
// populated root.

const fs = require('fs');
const path = require('path');

const PREFIX = 'costs/';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const INDEX_REL = 'costs/hours/index.json';
const CONFIG_REL = 'costs/config.json';
const TEAM_RATES_REL = 'costs/team-rates.json';
const JUNK_ENTRIES = new Set(['.DS_Store', '.gitignore']);

function fail(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

function privateRoot(ctx) {
  return typeof ctx.dataRepoDir === 'function' ? ctx.dataRepoDir('data-tier-0') : null;
}

/**
 * Tree-level readiness: the plaintext root exists AND is populated (holds at
 * least one real entry). After "End of day" the root stays but is empty; a
 * write into it would invent a lone costs/ tree that the next push would
 * publish as the whole data set.
 */
function rootReady(root) {
  if (typeof root !== 'string' || root === '' || !fs.existsSync(root)) return false;
  try {
    return fs.readdirSync(root).some((e) => !JUNK_ENTRIES.has(e));
  } catch {
    return false;
  }
}

function privateReady(ctx) {
  return rootReady(privateRoot(ctx));
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function _atomicWrite(abs, data) {
  const tmp = abs + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, abs);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function writeJsonPrivate(root, relPath, data) {
  if (!rootReady(root)) throw fail('data-missing');
  if (typeof relPath !== 'string' || !relPath.startsWith(PREFIX)) throw fail('path-outside');
  const base = path.resolve(root);
  const abs = path.resolve(base, relPath);
  if (!abs.startsWith(path.join(base, 'costs') + path.sep)) throw fail('path-outside');
  // Only subdirs UNDER an existing, ready root (costs/, costs/hours/); never the root itself.
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  _atomicWrite(abs, data);
}

/** App cache (ctx.dataDir) - not team data; the one other place that writes. */
function writeAppCache(dataDir, name, data) {
  if (!/^[a-z0-9.-]+\.json$/.test(name)) throw fail('path-outside');
  fs.mkdirSync(dataDir, { recursive: true });
  _atomicWrite(path.join(dataDir, name), data);
}

// -- shard layer --------------------------------------------------------------

function shardRelPath(month) {
  if (typeof month !== 'string' || !MONTH_RE.test(month)) throw fail('bad-month');
  return 'costs/hours/' + month + '.json';
}

function listShardMonths(root) {
  try {
    return fs.readdirSync(path.join(root, 'costs', 'hours'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((m, i, arr) => MONTH_RE.test(m) && arr.indexOf(m) === i)
      .sort();
  } catch {
    return [];
  }
}

function readShards(root, months) {
  const out = {};
  for (const m of months) out[m] = readJsonOrNull(path.join(root, shardRelPath(m)));
  return out;
}

function writeShards(root, byMonth) {
  const months = Object.keys(byMonth).sort();
  for (const m of months) writeJsonPrivate(root, shardRelPath(m), byMonth[m]);
  return months;
}

/** The index, or - when missing/corrupt - one rebuilt from the shards (nothing written). */
function readIndexOrRebuild(root) {
  const idx = readJsonOrNull(path.join(root, INDEX_REL));
  if (idx && Array.isArray(idx.months)) return idx;
  const months = listShardMonths(root);
  const shards = readShards(root, months);
  const entries = [];
  for (const m of months) {
    const s = shards[m];
    if (!s) continue;
    entries.push({
      month: m,
      fetchedAt: s.fetchedAt || null,
      dateFrom: s.dateFrom || null,
      dateTo: s.dateTo || null,
      partial: !!s.partial,
      authors: Array.isArray(s.authors) ? s.authors.length : 0,
      worklogs: null,
      skipped: s.skipped || 0,
    });
  }
  return {
    schemaVersion: 1,
    rebuilt: true,
    generatedAt: null,
    dateFrom: entries.length ? entries[0].dateFrom : null,
    dateTo: entries.length ? entries[entries.length - 1].dateTo : null,
    projects: [],
    months: entries,
    authorsSeen: [],
    unmatchedByEmail: [],
  };
}

function writeIndex(root, index) {
  writeJsonPrivate(root, INDEX_REL, index);
}

module.exports = {
  INDEX_REL, CONFIG_REL, TEAM_RATES_REL, MONTH_RE,
  privateRoot, privateReady, rootReady, readJsonOrNull, writeJsonPrivate, writeAppCache,
  shardRelPath, listShardMonths, readShards, writeShards, readIndexOrRebuild, writeIndex,
};
