'use strict';
// modules/gantt-roadmap/server/store.js
// The only file that touches fs for the gantt-roadmap tree in the team
// data repository (data-tier-0).
// Paths are built EXCLUSIVELY from ctx.rootDir via paths.js — never from a
// frozen module-level constant — so the unit tests can pass a temp dir.
//
// Layout (per quarter directory):
//   gantt-roadmap/
//     index.json              { activeQuarter, quarters[] }
//     q4-2026/
//       quarter.json          { id, label, mondayFirst, weeksN, weekFirstNo,
//                               xmasWeek, sprints[], roster[] }
//       areas/<id>.json       { id, name, color, note, o }
//       backlog/<uid>.json    { uid, t, createdAt, updatedAt }
//       tasks/<uid>.json      { uid, n, a, o, t, who[], s, l, ph, gw, ms,
//                               createdAt, updatedAt, updatedBy }
//       tasks/_n<N>           tombstone (empty file, 0 bytes)
//
// All writes: writeJsonAtomic (tmp + rename). Shared writes: caller must
// hold the lock returned by ctx.makeLock() — no lock file on disk.
// gantt.js pure helpers are loaded lazily (dynamic import) to stay CJS.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { quarterDir, moduleDataDir } = require('./paths.js');

// Regexes — mirrored in client/gantt.js (exported there for the browser).
const TASK_UID_RE = /^t-[0-9a-f]{16}$/;
const BACKLOG_UID_RE = /^bl-[0-9a-f]{12,16}$/;
const QUARTER_ID_RE = /^q[1-4]-\d{4}$/;
const AREA_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const TOMBSTONE_RE = /^_n\d+$/;

// Lazy-loaded gantt.js helpers (ES module loaded via import()).
let _gantt = null;
async function gantt() {
  if (_gantt) return _gantt;
  const ganttPath = path.join(__dirname, '..', 'client', 'gantt.js');
  _gantt = await import(pathToFileURL(ganttPath).href);
  return _gantt;
}

class BadIdError extends Error {
  constructor(msg) {
    super(msg || 'bad-id');
    this.code = 'bad-id';
  }
}

class NotFoundError extends Error {
  constructor(msg) {
    super(msg || 'not-found');
    this.code = 'not-found';
  }
}

class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---- Atomic write ----------------------------------------------------------

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

// ---- UID generators --------------------------------------------------------

function newTaskUid() {
  return 't-' + crypto.randomBytes(8).toString('hex');
}

function newBacklogUid() {
  return 'bl-' + crypto.randomBytes(8).toString('hex');
}

// ---- Validation helpers ----------------------------------------------------

function validateQuarterId(qId) {
  if (typeof qId !== 'string' || !QUARTER_ID_RE.test(qId)) {
    throw new BadIdError('Invalid quarter id: ' + qId);
  }
}

function validateTaskUid(uid) {
  if (typeof uid !== 'string' || !TASK_UID_RE.test(uid)) {
    throw new BadIdError('Invalid task uid: ' + uid);
  }
}

function validateBacklogUid(uid) {
  if (typeof uid !== 'string' || !BACKLOG_UID_RE.test(uid)) {
    throw new BadIdError('Invalid backlog uid: ' + uid);
  }
}

function validateAreaId(id) {
  if (typeof id !== 'string' || !AREA_ID_RE.test(id)) {
    throw new BadIdError('Invalid area id: ' + id);
  }
}

// ---- Paths within a quarter ------------------------------------------------

function qDir(rootDir, qId) {
  return quarterDir(rootDir, qId);
}

function areasDir(rootDir, qId) {
  return path.join(qDir(rootDir, qId), 'areas');
}

function backlogDir(rootDir, qId) {
  return path.join(qDir(rootDir, qId), 'backlog');
}

function tasksDir(rootDir, qId) {
  return path.join(qDir(rootDir, qId), 'tasks');
}

function quarterJsonFile(rootDir, qId) {
  return path.join(qDir(rootDir, qId), 'quarter.json');
}

function indexJsonFile(rootDir) {
  return path.join(moduleDataDir(rootDir), 'index.json');
}

// ---- Index -----------------------------------------------------------------

function readIndex(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(indexJsonFile(rootDir), 'utf8'));
  } catch {
    return null;
  }
}

function writeIndex(rootDir, data) {
  writeJsonAtomic(indexJsonFile(rootDir), data);
}

// ---- Quarter.json ----------------------------------------------------------

function readQuarterMeta(rootDir, qId) {
  validateQuarterId(qId);
  try {
    return JSON.parse(fs.readFileSync(quarterJsonFile(rootDir, qId), 'utf8'));
  } catch {
    return null;
  }
}

function writeQuarterMeta(rootDir, qId, data) {
  validateQuarterId(qId);
  writeJsonAtomic(quarterJsonFile(rootDir, qId), data);
}

// ---- Areas -----------------------------------------------------------------

function areaFile(rootDir, qId, areaId) {
  return path.join(areasDir(rootDir, qId), areaId + '.json');
}

function listAreas(rootDir, qId) {
  validateQuarterId(qId);
  let files;
  try {
    files = fs.readdirSync(areasDir(rootDir, qId));
  } catch {
    return [];
  }
  const areas = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const id = f.replace(/\.json$/, '');
    if (!AREA_ID_RE.test(id)) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(areasDir(rootDir, qId), f), 'utf8'));
      areas.push(a);
    } catch { /* skip corrupt */ }
  }
  areas.sort((a, b) => (a.o || 0) - (b.o || 0));
  return areas;
}

function readArea(rootDir, qId, areaId) {
  validateQuarterId(qId);
  validateAreaId(areaId);
  try {
    return JSON.parse(fs.readFileSync(areaFile(rootDir, qId, areaId), 'utf8'));
  } catch {
    return null;
  }
}

function writeArea(rootDir, qId, area) {
  validateQuarterId(qId);
  validateAreaId(area.id);
  writeJsonAtomic(areaFile(rootDir, qId, area.id), area);
}

function deleteArea(rootDir, qId, areaId) {
  validateQuarterId(qId);
  validateAreaId(areaId);
  try {
    fs.unlinkSync(areaFile(rootDir, qId, areaId));
    return true;
  } catch {
    return false;
  }
}

// ---- Tombstones ------------------------------------------------------------

function listTombstoneNames(rootDir, qId) {
  try {
    return fs.readdirSync(tasksDir(rootDir, qId)).filter((f) => TOMBSTONE_RE.test(f));
  } catch {
    return [];
  }
}

function writeTombstone(rootDir, qId, n) {
  const dir = tasksDir(rootDir, qId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '_n' + n), '', 'utf8');
}

// ---- Tasks (shards) --------------------------------------------------------

function taskFile(rootDir, qId, uid) {
  return path.join(tasksDir(rootDir, qId), uid + '.json');
}

function listTaskShards(rootDir, qId) {
  let files;
  try {
    files = fs.readdirSync(tasksDir(rootDir, qId));
  } catch {
    return [];
  }
  const shards = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const uid = f.replace(/\.json$/, '');
    if (!TASK_UID_RE.test(uid)) continue;
    try {
      const t = JSON.parse(fs.readFileSync(path.join(tasksDir(rootDir, qId), f), 'utf8'));
      shards.push(t);
    } catch { /* skip corrupt */ }
  }
  return shards;
}

function readTask(rootDir, qId, uid) {
  validateQuarterId(qId);
  validateTaskUid(uid);
  try {
    return JSON.parse(fs.readFileSync(taskFile(rootDir, qId, uid), 'utf8'));
  } catch {
    return null;
  }
}

function writeTask(rootDir, qId, task) {
  validateQuarterId(qId);
  validateTaskUid(task.uid);
  writeJsonAtomic(taskFile(rootDir, qId, task.uid), task);
}

function deleteTask(rootDir, qId, uid) {
  validateQuarterId(qId);
  validateTaskUid(uid);
  const task = readTask(rootDir, qId, uid);
  if (!task) return false;
  // write tombstone BEFORE unlinking
  writeTombstone(rootDir, qId, task.n);
  try {
    fs.unlinkSync(taskFile(rootDir, qId, uid));
  } catch { /* already gone */ }
  return true;
}

/**
 * Creates a new task shard. No shared file is written — only the new shard.
 * Caller MUST hold the lock before calling.
 * @param {string} rootDir
 * @param {string} qId
 * @param {{a: string, t: string}} body
 * @param {number} weeksN
 * @returns {object} the new task
 */
function createTask(rootDir, qId, body, weeksN) {
  validateQuarterId(qId);
  const areaId = body.a;
  validateAreaId(areaId);
  if (!body.t || !String(body.t).trim()) {
    throw new ValidationError('invalid-title', 'The task title cannot be empty.');
  }

  const shards = listTaskShards(rootDir, qId);
  const tombstones = listTombstoneNames(rootDir, qId);
  // Compute n = max(shards n + tombstone n) + 1
  let maxN = 0;
  for (const s of shards) if (typeof s.n === 'number' && s.n > maxN) maxN = s.n;
  for (const name of tombstones) {
    const m = name.match(/^_n(\d+)$/);
    if (m) { const v = parseInt(m[1], 10); if (v > maxN) maxN = v; }
  }
  const n = maxN + 1;

  const uid = newTaskUid();
  const now = new Date().toISOString();
  // order: place at the end of the area
  const areaShards = shards.filter((s) => s.a === areaId);
  const maxO = areaShards.reduce((m, s) => Math.max(m, s.o || 0), 0);

  const task = {
    uid,
    n,
    a: areaId,
    o: maxO + 1,
    t: String(body.t).trim(),
    who: [],
    s: 1,
    l: Math.min(2, weeksN),
    ph: null,
    gw: false,
    ms: false,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  };
  writeTask(rootDir, qId, task);
  return task;
}

// ---- Backlog ---------------------------------------------------------------

function backlogFile(rootDir, qId, uid) {
  return path.join(backlogDir(rootDir, qId), uid + '.json');
}

function listBacklog(rootDir, qId) {
  validateQuarterId(qId);
  let files;
  try {
    files = fs.readdirSync(backlogDir(rootDir, qId));
  } catch {
    return [];
  }
  const items = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const uid = f.replace(/\.json$/, '');
    if (!BACKLOG_UID_RE.test(uid)) continue;
    try {
      const item = JSON.parse(fs.readFileSync(path.join(backlogDir(rootDir, qId), f), 'utf8'));
      items.push(item);
    } catch { /* skip */ }
  }
  items.sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
  return items;
}

function readBacklogItem(rootDir, qId, uid) {
  validateQuarterId(qId);
  validateBacklogUid(uid);
  try {
    return JSON.parse(fs.readFileSync(backlogFile(rootDir, qId, uid), 'utf8'));
  } catch {
    return null;
  }
}

function writeBacklogItem(rootDir, qId, item) {
  validateQuarterId(qId);
  validateBacklogUid(item.uid);
  writeJsonAtomic(backlogFile(rootDir, qId, item.uid), item);
}

function deleteBacklogItem(rootDir, qId, uid) {
  validateQuarterId(qId);
  validateBacklogUid(uid);
  try {
    fs.unlinkSync(backlogFile(rootDir, qId, uid));
    return true;
  } catch {
    return false;
  }
}

function createBacklogItem(rootDir, qId, body) {
  validateQuarterId(qId);
  if (!body.t || !String(body.t).trim()) {
    throw new ValidationError('invalid-title', 'The backlog item title cannot be empty.');
  }
  const uid = newBacklogUid();
  const now = new Date().toISOString();
  const item = {
    uid,
    t: String(body.t).trim(),
    createdAt: now,
    updatedAt: now,
  };
  writeBacklogItem(rootDir, qId, item);
  return item;
}

// ---- Atomic complex ops ----------------------------------------------------

/**
 * Promotes a backlog item to a task. Atomic under caller's lock.
 * @param {string} rootDir
 * @param {string} qId
 * @param {string} blUid backlog item uid
 * @param {string} areaId target area id
 * @param {number} weeksN quarter weeks count
 * @returns {{ task: object }}
 */
function promoteBacklogItem(rootDir, qId, blUid, areaId, weeksN) {
  validateQuarterId(qId);
  validateBacklogUid(blUid);
  validateAreaId(areaId);

  const item = readBacklogItem(rootDir, qId, blUid);
  if (!item) throw new NotFoundError('The backlog item does not exist.');

  const shards = listTaskShards(rootDir, qId);
  const tombstones = listTombstoneNames(rootDir, qId);
  let maxN = 0;
  for (const s of shards) if (typeof s.n === 'number' && s.n > maxN) maxN = s.n;
  for (const name of tombstones) {
    const m = name.match(/^_n(\d+)$/);
    if (m) { const v = parseInt(m[1], 10); if (v > maxN) maxN = v; }
  }
  const n = maxN + 1;

  const uid = newTaskUid();
  const now = new Date().toISOString();
  const areaShards = shards.filter((s) => s.a === areaId);
  const maxO = areaShards.reduce((m, s) => Math.max(m, s.o || 0), 0);

  const task = {
    uid,
    n,
    a: areaId,
    o: maxO + 1,
    t: item.t,
    who: [],
    s: 1,
    l: Math.min(2, weeksN),
    ph: null,
    gw: false,
    ms: false,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  };

  // write task shard first, then delete backlog shard
  writeTask(rootDir, qId, task);
  deleteBacklogItem(rootDir, qId, blUid);

  return { task };
}

/**
 * Demotes a task to a backlog item. Atomic under caller's lock.
 * @param {string} rootDir
 * @param {string} qId
 * @param {string} taskUid
 * @returns {{ backlogItem: object }}
 */
function demoteTask(rootDir, qId, taskUid) {
  validateQuarterId(qId);
  validateTaskUid(taskUid);

  const task = readTask(rootDir, qId, taskUid);
  if (!task) throw new NotFoundError('The task does not exist.');

  const uid = newBacklogUid();
  const now = new Date().toISOString();
  const backlogItem = {
    uid,
    t: task.t,
    createdAt: now,
    updatedAt: now,
  };

  // write tombstone, write backlog shard, then unlink task shard
  writeTombstone(rootDir, qId, task.n);
  writeBacklogItem(rootDir, qId, backlogItem);
  try { fs.unlinkSync(taskFile(rootDir, qId, taskUid)); } catch { /* gone */ }

  return { backlogItem };
}

/**
 * Swaps display order of a task with its neighbour in the same area.
 * @param {string} rootDir
 * @param {string} qId
 * @param {string} taskUid
 * @param {'up'|'down'} direction
 * @returns {{ task: object, neighbour: object }}
 */
function swapTaskOrder(rootDir, qId, taskUid, direction) {
  validateQuarterId(qId);
  validateTaskUid(taskUid);

  const task = readTask(rootDir, qId, taskUid);
  if (!task) throw new NotFoundError('The task does not exist.');

  const areaShards = listTaskShards(rootDir, qId).filter((s) => s.a === task.a);
  areaShards.sort((a, b) => (a.o || 0) - (b.o || 0) || (a.n || 0) - (b.n || 0));

  const idx = areaShards.findIndex((s) => s.uid === taskUid);
  if (idx === -1) throw new NotFoundError('The task was not found in the area.');

  const neighbourIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (neighbourIdx < 0 || neighbourIdx >= areaShards.length) {
    throw new ValidationError('boundary', 'The task is already at the edge of the order.');
  }

  const neighbour = areaShards[neighbourIdx];
  const tmpO = task.o;
  task.o = neighbour.o;
  neighbour.o = tmpO;
  task.updatedAt = new Date().toISOString();
  neighbour.updatedAt = new Date().toISOString();

  writeTask(rootDir, qId, task);
  writeTask(rootDir, qId, neighbour);

  return { task, neighbour };
}

// ---- readQuarter (assembles full quarter payload) --------------------------

/**
 * Reads all quarter data from shards and resolves duplicate display numbers.
 * The duplicate-fix persist runs through the ONE lock created in register(ctx)
 * so it cannot race a concurrent PUT/POST on the same shard.
 *
 * Callers MUST NOT hold withLock before calling this function — they are all
 * GET handlers that run outside any lock, so no deadlock is possible.
 *
 * @param {string} rootDir
 * @param {string} qId
 * @param {{ log?: Function, withLock: Function }} opts
 * @returns {Promise<object>}
 */
async function readQuarter(rootDir, qId, { log, withLock }) {
  validateQuarterId(qId);

  const meta = readQuarterMeta(rootDir, qId);
  const areas = listAreas(rootDir, qId);
  const backlog = listBacklog(rootDir, qId);
  let tasks = listTaskShards(rootDir, qId);

  // Resolve duplicate display numbers — persisted through the shared lock so a
  // concurrent write cannot see a half-fixed shard set.
  // The unlocked read only decides whether to take the lock at all. Inside it
  // the shards are read AGAIN and only `n` changes on that fresh copy:
  // writing back the objects read above would drop a PUT that landed between
  // the two reads. The result is the same on every machine (createdAt + uid
  // order, tombstones synced with the shards), so two machines repairing the
  // same merge write identical files.
  const g = await gantt();
  if (g.resolveDisplayDuplicates(tasks).fixed.length > 0) {
    let fixedCount = 0;
    await withLock(async () => {
      const fresh = listTaskShards(rootDir, qId);
      const { fixed } = g.resolveDisplayDuplicates(fresh, listTombstoneNames(rootDir, qId));
      for (const fix of fixed) {
        const shard = fresh.find((t) => t.uid === fix.uid);
        if (shard) {
          shard.n = fix.newN;
          writeTask(rootDir, qId, shard);
          fixedCount++;
        }
      }
    });
    if (log && fixedCount) {
      log('gantt-roadmap: naprawiono ' + fixedCount + ' duplikat(y) numerow wyswietlania w ' + qId);
    }
    // re-read after fix
    tasks = listTaskShards(rootDir, qId);
  }

  tasks.sort((a, b) => (a.a < b.a ? -1 : a.a > b.a ? 1 : 0) || (a.o || 0) - (b.o || 0));

  return {
    id: qId,
    meta,
    areas,
    tasks,
    backlog,
  };
}

// ---- Storage state ---------------------------------------------------------

function storageState(rootDir) {
  const { storageState: ss } = require('./paths.js');
  return ss(rootDir);
}

module.exports = {
  BadIdError,
  NotFoundError,
  ValidationError,
  TASK_UID_RE,
  BACKLOG_UID_RE,
  QUARTER_ID_RE,
  AREA_ID_RE,
  TOMBSTONE_RE,
  writeJsonAtomic,
  newTaskUid,
  newBacklogUid,
  readIndex,
  writeIndex,
  readQuarterMeta,
  writeQuarterMeta,
  listAreas,
  readArea,
  writeArea,
  deleteArea,
  listTombstoneNames,
  writeTombstone,
  listTaskShards,
  readTask,
  writeTask,
  deleteTask,
  createTask,
  listBacklog,
  readBacklogItem,
  writeBacklogItem,
  deleteBacklogItem,
  createBacklogItem,
  promoteBacklogItem,
  demoteTask,
  swapTaskOrder,
  readQuarter,
  storageState,
};
