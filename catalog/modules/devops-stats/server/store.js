'use strict';
// modules/devops-stats/server/store.js
// The only file in this module that writes jira/devops/ inside the
// team data source (data-tier-0): index.json, one issues-YYYY-MM.json shard per created
// month and config.json. Callers hold the module's chain lock
// (ctx.makeLock()); nothing here takes a lock itself. Writes are tmp+rename,
// shards before index, and a file whose text is unchanged is not rewritten
// (keeps the encrypted mirror's pending-file count honest).

const fs = require('fs');
const path = require('path');

const JUNK_ENTRIES = new Set(['.gitignore', '.DS_Store']);
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Where this machine's team data (data-tier-0) plaintext tree lives. Read on
 * EVERY call. Never created here: a missing directory is `storage: 'unavailable'`.
 * @param {{rootDir: string, dataRepoDir?: Function, dataTier0Dir?: string}} ctx
 * @returns {string}
 */
function teamDataDir(ctx) {
  if (ctx && typeof ctx.dataRepoDir === 'function') {
    const dir = ctx.dataRepoDir('data-tier-0');
    if (dir) return dir;
  }
  if (ctx && ctx.dataTier0Dir) return ctx.dataTier0Dir;
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(ctx.rootDir, 'data-sub-repositories');
  return path.join(base, 'ds-data');
}

/** @param {string} dir team data root */
function devopsDir(dir) {
  return path.join(dir, 'jira', 'devops');
}

/** @param {string} dir @returns {'ok'|'unavailable'} */
function storageState(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 'unavailable';
  }
  return entries.some((e) => !JUNK_ENTRIES.has(e)) ? 'ok' : 'unavailable';
}

function _readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} dir @returns {object|null} index.json or null when absent */
function readIndex(dir) {
  const parsed = _readJson(path.join(devopsDir(dir), 'index.json'));
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    schema_version: parsed.schema_version || 1,
    project: parsed.project || 'DEVOPS',
    generated_at: parsed.generated_at || null,
    mode: parsed.mode || null,
    lookback_days: parsed.lookback_days || null,
    fields: parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {},
    statuses: Array.isArray(parsed.statuses) ? parsed.statuses : [],
    shards: Array.isArray(parsed.shards) ? parsed.shards : [],
  };
}

function _idList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
}

/**
 * cancelled_status_ids is null until the team saves it (the client then uses
 * the name-based proposal); an empty array is a saved "no cancelled status".
 * @param {string} dir @returns {{blocked_status_ids: string[], cancelled_status_ids: string[]|null}}
 */
function readConfig(dir) {
  const parsed = _readJson(path.join(devopsDir(dir), 'config.json')) || {};
  return {
    blocked_status_ids: _idList(parsed.blocked_status_ids) || [],
    cancelled_status_ids: _idList(parsed.cancelled_status_ids),
  };
}

function _shardFile(dir, month) {
  return path.join(devopsDir(dir), 'issues-' + month + '.json');
}

function _readShard(dir, month) {
  if (!MONTH_RE.test(month)) return [];
  const parsed = _readJson(_shardFile(dir, month));
  return parsed && Array.isArray(parsed.issues) ? parsed.issues : [];
}

/** Every fact of every shard listed in the index; `[]` when there is none.
 * @param {string} dir @returns {object[]} */
function readAllIssues(dir) {
  const index = readIndex(dir);
  if (!index) return [];
  const out = [];
  for (const s of index.shards) {
    if (s && typeof s.month === 'string' && MONTH_RE.test(s.month)) out.push(..._readShard(dir, s.month));
  }
  return out;
}

/** The ETL child's `--out` file, or null when missing or malformed.
 * @param {string} outPath */
function readEtlOut(outPath) {
  const parsed = _readJson(outPath);
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.issues) && Array.isArray(parsed.statuses)) return parsed;
  return null;
}

function _writeIfChanged(file, text) {
  let current = null;
  try { current = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  if (current === text) return false;
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

function _keyNum(key) {
  const n = Number(String(key).split('-')[1]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Union of the stored status table and the one from this run, by id. The new
 * entry wins; a stored entry the run did not carry is kept (an incremental run
 * only sees recently changed issues, so historic ids must survive). In a full
 * run a kept project status that left the project list becomes current:false.
 * @param {object[]} existing @param {object[]|undefined} fresh @param {boolean} full
 * @returns {object[]}
 */
function _unionStatuses(existing, fresh, full) {
  const next = Array.isArray(fresh) ? fresh.filter((s) => s && s.id !== undefined) : [];
  if (!next.length) return Array.isArray(existing) ? existing : [];
  const out = new Map();
  for (const s of (Array.isArray(existing) ? existing : [])) {
    if (!s || s.id === undefined) continue;
    out.set(String(s.id), full && s.current ? { ...s, current: false } : s);
  }
  for (const s of next) out.set(String(s.id), s);
  return [...out.values()];
}

/**
 * Merges ETL facts into jira/devops/. Both modes upsert by key (nothing is
 * ever deleted); a `full` run with zero facts is refused so a permission
 * glitch cannot look like a refresh. Shards are written before the index.
 * @param {string} dir team data root
 * @param {object[]} facts
 * @param {{mode: string, generated_at?: string, lookback_days?: number, fields?: object, statuses?: object[], project?: string}} meta
 * @returns {{written: number, refused?: 'etl-empty'}}
 */
function mergeIssues(dir, facts, meta) {
  const list = Array.isArray(facts) ? facts : [];
  const m = meta || {};
  if (m.mode === 'full' && list.length === 0) return { written: 0, refused: 'etl-empty' };

  const target = devopsDir(dir);
  fs.mkdirSync(target, { recursive: true });
  const index = readIndex(dir);

  const byMonth = new Map();
  for (const f of list) {
    const month = typeof f.created === 'string' ? f.created.slice(0, 7) : '';
    if (!MONTH_RE.test(month)) continue;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(f);
  }

  const counts = new Map();
  for (const s of (index ? index.shards : [])) if (s && MONTH_RE.test(s.month)) counts.set(s.month, s.count);

  let written = 0;
  for (const month of [...byMonth.keys()].sort()) {
    const merged = new Map(_readShard(dir, month).map((x) => [x.key, x]));
    for (const f of byMonth.get(month)) merged.set(f.key, f);
    const issues = [...merged.values()].sort((a, b) => _keyNum(a.key) - _keyNum(b.key));
    counts.set(month, issues.length);
    if (_writeIfChanged(_shardFile(dir, month), JSON.stringify({ month, issues }, null, 2) + '\n')) written += 1;
  }

  const nextIndex = {
    schema_version: 1,
    project: m.project || 'DEVOPS',
    generated_at: m.generated_at || new Date().toISOString(),
    mode: m.mode || 'full',
    lookback_days: m.lookback_days || 365,
    fields: m.fields || (index && index.fields) || {},
    statuses: _unionStatuses(index ? index.statuses : [], m.statuses, m.mode === 'full'),
    shards: [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, count]) => ({ month, count })),
  };
  if (_writeIfChanged(path.join(target, 'index.json'), JSON.stringify(nextIndex, null, 2) + '\n')) written += 1;
  return { written };
}

/** @param {string} dir @param {{blocked_status_ids: string[], cancelled_status_ids?: string[]|null}} cfg */
function writeConfig(dir, cfg) {
  const target = devopsDir(dir);
  fs.mkdirSync(target, { recursive: true });
  const clean = { blocked_status_ids: _idList(cfg.blocked_status_ids) || [] };
  const cancelled = _idList(cfg.cancelled_status_ids);
  if (cancelled) clean.cancelled_status_ids = cancelled;
  _writeIfChanged(path.join(target, 'config.json'), JSON.stringify(clean, null, 2) + '\n');
  return { blocked_status_ids: clean.blocked_status_ids, cancelled_status_ids: cancelled };
}

module.exports = {
  teamDataDir,
  devopsDir,
  storageState,
  readIndex,
  readConfig,
  readAllIssues,
  readEtlOut,
  mergeIssues,
  writeConfig,
};
