'use strict';
// modules/responsibilities/server/store.js
// File access for the per-project matrices in the responsibilities/ directory
// of the team data plaintext tree (data-tier-0, ds-data/). Every path is
// computed PER CALL (never frozen at load) so a test that sets
// DATA_SUB_REPOS_DIR and restores it in t.after is honoured.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECTS = ['main', 'web', 'mobile', 'platform'];
const VALID_STATUSES = ['green', 'amber', 'red', null];
const MAX_SHORT_LEN = 500;
const MAX_TEXT_LEN = 2000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isValidProject(p) { return typeof p === 'string' && PROJECTS.includes(p); }

/** The team data plaintext directory of this machine (may not exist). */
function teamDataDir(ctx) {
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(ctx.rootDir, 'data-sub-repositories');
  return path.join(base, 'ds-data');
}

/** This module's directory inside the team data tree (may not exist yet). */
function moduleDir(ctx) {
  return path.join(teamDataDir(ctx), 'responsibilities');
}

function respPath(ctx, project) {
  return path.join(moduleDir(ctx), project + '.json');
}

/** True when the team data tree is on this machine (pulled and decrypted). */
function dirExists(ctx) {
  try { return fs.statSync(teamDataDir(ctx)).isDirectory(); } catch { return false; }
}

/**
 * Reads one project file. Never initialises anything: an unparsable file is
 * reported as 'corrupt' and left untouched, because replacing it with an
 * empty shell is the likely way a full matrix becomes an empty shell on the
 * remote.
 * @returns {{ok: true, data: object} | {ok: false, error: 'missing'|'corrupt'}}
 */
function readResp(ctx, project) {
  let raw;
  try {
    raw = fs.readFileSync(respPath(ctx, project), 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, error: 'missing' };
    return { ok: false, error: 'corrupt' };
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'corrupt' };
    return { ok: true, data: ensureShell(data) };
  } catch {
    return { ok: false, error: 'corrupt' };
  }
}

/** Sets meta.last_updated and writes tmp + rename in the same directory. */
function writeRespAtomic(ctx, project, data, now) {
  data.meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  data.meta.last_updated = (now ? now() : new Date()).toISOString();
  const file = respPath(ctx, project);
  const tmp = file + '.tmp.' + process.pid + '.' + crypto.randomBytes(3).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}

function ensureShell(data) {
  const d = data && typeof data === 'object' ? data : {};
  if (!d.meta || typeof d.meta !== 'object') d.meta = {};
  if (!Array.isArray(d.months)) d.months = [];
  if (!Array.isArray(d.groups)) d.groups = [];
  d.groups.forEach((g) => { if (g && !Array.isArray(g.areas)) g.areas = []; });
  return d;
}

function ymOf(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function currentYM(now) { return ymOf(now ? now() : new Date()); }

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  return ymOf(new Date(y, m - 1 + n, 1));
}

/** Makes sure the current month and the next three exist. */
function ensureForwardMonths(data, now) {
  const cur = currentYM(now);
  const required = [cur, addMonths(cur, 1), addMonths(cur, 2), addMonths(cur, 3)];
  const existing = new Set(data.months);
  let added = 0;
  for (const m of required) {
    if (!existing.has(m)) { data.months.push(m); existing.add(m); added++; }
  }
  if (added > 0) data.months.sort();
  return { added };
}

function makeUniqueId(prefix, existingIds) {
  for (let i = 0; i < 20; i++) {
    const id = prefix + '-' + crypto.randomBytes(4).toString('hex');
    if (!existingIds.has(id)) return id;
  }
  throw new Error('Could not generate unique id for ' + prefix);
}

function validateString(val, maxLen) {
  return typeof val === 'string' && val.length <= maxLen;
}

module.exports = {
  PROJECTS, VALID_STATUSES, MAX_SHORT_LEN, MAX_TEXT_LEN, MONTH_RE,
  isValidProject, teamDataDir, moduleDir, respPath, dirExists,
  readResp, writeRespAtomic, ensureShell, ensureForwardMonths,
  currentYM, addMonths, makeUniqueId, validateString,
};
