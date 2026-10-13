'use strict';
// modules/sprint-review/server/store.js
// The only file in this module that touches fs for the team data repository.
// Paths are built EXCLUSIVELY from ctx.dataTier0Dir - never ctx.rootDir plus
// a hand-joined sub-repositories path, which would let a unit test write
// into the real team data repo.
//
// Layout: <dataTier0Dir>/sprint-review/index.json (schema_version, meeting,
// sessions[] - trimmed entries only) plus <dataTier0Dir>/sprint-review/
// sessions/<id>.json (one full session per shard). Shard written BEFORE the
// index, so the index can never point at a shard that is not yet on disk;
// the index is rebuildable from the shards alone (rebuildIndex), which is
// also the self-healing path listSessions() takes when index.json is
// missing or corrupt. No .lock file on disk - the caller serializes writes
// through the single ctx.makeLock() chain lock shared by every write route.

const fs = require('fs');
const path = require('path');

const { MEETING_KEY } = require('./session.js');

const MODULE_SUBDIR = 'sprint-review';
const SESSIONS_SUBDIR = 'sessions';
const INDEX_FILE = 'index.json';

const JUNK_ENTRIES = new Set(['.gitignore', '.DS_Store']);

const SESSION_ID_RE = /^sr-[0-9a-f]{16}$/;

class BadIdError extends Error {
  constructor() {
    super('bad-id');
    this.code = 'bad-id';
  }
}

function moduleDir(ctx) {
  return path.join(ctx.dataTier0Dir, MODULE_SUBDIR);
}

function sessionsDir(ctx) {
  return path.join(moduleDir(ctx), SESSIONS_SUBDIR);
}

function indexFile(ctx) {
  return path.join(moduleDir(ctx), INDEX_FILE);
}

/**
 * 'ok' when the team data repository is cloned on this machine (a
 * non-empty directory, junk files ignored), 'unavailable' otherwise. A
 * fresh machine, or one that has the repo but never wrote
 * sprint-review/ yet, both read 'ok' with an empty session list - only
 * the ABSENCE of the whole data-tier-0 clone is 'unavailable'.
 * @param {{dataTier0Dir: string}} ctx
 * @returns {'ok'|'unavailable'}
 */
function storageState(ctx) {
  let entries;
  try {
    entries = fs.readdirSync(ctx.dataTier0Dir);
  } catch {
    return 'unavailable';
  }
  return entries.some((e) => !JUNK_ENTRIES.has(e)) ? 'ok' : 'unavailable';
}

/**
 * Builds the shard path for a session id, after validating it against
 * SESSION_ID_RE. Throws BadIdError on anything else - an id from the query
 * string must never reach path.join unvalidated.
 * @param {{dataTier0Dir: string}} ctx
 * @param {string} id
 * @returns {string}
 */
function shardPath(ctx, id) {
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) throw new BadIdError();
  return path.join(sessionsDir(ctx), id + '.json');
}

/** Trimmed shape stored in index.json - full sessions live only in shards. */
function indexEntryOf(session) {
  return {
    id: session.id,
    reviewDate: session.reviewDate,
    sprintN: session.sprintN,
    sprintName: session.sprintName,
    meeting: session.meeting,
    confluencePageId: session.confluencePageId,
    confluenceVersion: session.confluenceVersion,
    updatedAt: session.updatedAt,
  };
}

/**
 * Reads index.json, or null when it is missing or corrupt - both are a
 * "rebuild from shards" signal to the caller, never an error.
 * @param {{dataTier0Dir: string}} ctx
 */
function readIndex(ctx) {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexFile(ctx), 'utf8'));
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sessions)) return parsed;
  } catch {
    // Missing file, bad JSON, or an unexpected shape - all read as "rebuild".
  }
  return null;
}

/**
 * Lists sessions/*.json, validates each shard's own id against its file name,
 * and returns a fresh index sorted by reviewDate descending. A shard whose
 * content id does not match its file name, or that fails to parse, is
 * skipped with a ctx.log line rather than aborting the whole rebuild.
 * @param {{dataTier0Dir: string, log: (...args: any[]) => void}} ctx
 */
function rebuildIndex(ctx) {
  let files = [];
  try {
    files = fs.readdirSync(sessionsDir(ctx)).filter((f) => SESSION_ID_RE.test(f.replace(/\.json$/, '')) && f.endsWith('.json'));
  } catch {
    files = [];
  }
  const entries = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    let session;
    try {
      session = JSON.parse(fs.readFileSync(path.join(sessionsDir(ctx), file), 'utf8'));
    } catch (e) {
      ctx.log('sprint-review: corrupt shard, skipping:', file, e.message);
      continue;
    }
    if (!session || session.id !== id) {
      ctx.log('sprint-review: shard id does not match its file name, skipping:', file);
      continue;
    }
    entries.push(indexEntryOf(session));
  }
  entries.sort((a, b) => (a.reviewDate < b.reviewDate ? 1 : a.reviewDate > b.reviewDate ? -1 : 0));
  return { schema_version: 1, meeting: MEETING_KEY, sessions: entries };
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Index entries, self-healing: when index.json is missing or corrupt this
 * rebuilds it from the shards and persists the rebuilt index before
 * returning, so the next call reads a normal index.json.
 * @param {{dataTier0Dir: string, log: (...args: any[]) => void}} ctx
 */
function listSessions(ctx) {
  const index = readIndex(ctx);
  if (index) return index.sessions;
  const rebuilt = rebuildIndex(ctx);
  try {
    writeJsonAtomic(indexFile(ctx), rebuilt);
  } catch (e) {
    ctx.log('sprint-review: could not write the rebuilt index:', e.message);
  }
  return rebuilt.sessions;
}

/**
 * Reads one full session shard, or null when it is missing or unparsable.
 * Throws BadIdError for an id that does not match SESSION_ID_RE.
 * @param {{dataTier0Dir: string}} ctx
 * @param {string} id
 */
function readSession(ctx, id) {
  const file = shardPath(ctx, id);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes one session shard, then upserts its trimmed entry into index.json.
 * Shard first, index second - see the module header. Caller is expected to
 * run this inside ctx.makeLock() alongside every other write.
 * @param {{dataTier0Dir: string, log: (...args: any[]) => void}} ctx
 * @param {object} session full session object, with a valid id
 */
function writeSession(ctx, session) {
  const file = shardPath(ctx, session.id);
  writeJsonAtomic(file, session);

  const index = readIndex(ctx) || rebuildIndex(ctx);
  const entry = indexEntryOf(session);
  const idx = index.sessions.findIndex((s) => s.id === session.id);
  if (idx === -1) index.sessions.push(entry); else index.sessions[idx] = entry;
  index.sessions.sort((a, b) => (a.reviewDate < b.reviewDate ? 1 : a.reviewDate > b.reviewDate ? -1 : 0));
  writeJsonAtomic(indexFile(ctx), index);
  return session;
}

/**
 * Deletes one session shard, then removes its entry from index.json.
 * A missing shard is not an error - the caller decides whether that means
 * 404.
 * @param {{dataTier0Dir: string, log: (...args: any[]) => void}} ctx
 * @param {string} id
 */
function deleteSession(ctx, id) {
  const file = shardPath(ctx, id);
  let existed = true;
  try {
    fs.unlinkSync(file);
  } catch {
    existed = false;
  }
  const index = readIndex(ctx) || rebuildIndex(ctx);
  const next = index.sessions.filter((s) => s.id !== id);
  if (next.length !== index.sessions.length || !existed) {
    writeJsonAtomic(indexFile(ctx), { ...index, sessions: next });
  }
  return existed;
}

module.exports = {
  MEETING_KEY,
  SESSION_ID_RE,
  BadIdError,
  moduleDir,
  sessionsDir,
  indexFile,
  storageState,
  shardPath,
  indexEntryOf,
  readIndex,
  rebuildIndex,
  listSessions,
  readSession,
  writeSession,
  deleteSession,
};
