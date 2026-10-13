'use strict';
// modules/sprint-planning/server/store.js
// The only file touching fs for the team data repository. Paths come ONLY
// from ctx.dataTier0Dir. One shard per plan, no shared index (two machines
// creating plans for different teams never touch the same file). Writes are
// tmp + rename; the caller holds the module's chain lock.

const fs = require('fs');
const path = require('path');

const { PLAN_ID_RE, SECTION_KEYS, emptySettings, validateSettingsTeams } = require('./plan.js');

const MODULE_SUBDIR = 'sprint-planning';
const PLANS_SUBDIR = 'plans';
const SETTINGS_FILE = 'settings.json';
const JUNK_ENTRIES = new Set(['.gitignore', '.DS_Store']);

class BadIdError extends Error {
  constructor() {
    super('bad-id');
    this.code = 'bad-id';
  }
}

/** A plan shard that exists but cannot be read as that plan (conflict markers, wrong id). */
class CorruptPlanError extends Error {
  constructor(id) {
    super('corrupt-plan');
    this.code = 'corrupt';
    this.planId = id;
  }
}

function plansDir(ctx) {
  return path.join(ctx.dataTier0Dir, MODULE_SUBDIR, PLANS_SUBDIR);
}

/** 'ok' when the team data repo is cloned (non-empty directory), else 'unavailable'. */
function storageState(ctx) {
  let entries;
  try {
    entries = fs.readdirSync(ctx.dataTier0Dir);
  } catch {
    return 'unavailable';
  }
  return entries.some((e) => !JUNK_ENTRIES.has(e)) ? 'ok' : 'unavailable';
}

function shardPath(ctx, id) {
  if (typeof id !== 'string' || !PLAN_ID_RE.test(id)) throw new BadIdError();
  return path.join(plansDir(ctx), id + '.json');
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function doneCountOf(plan) {
  const s = (plan && plan.sections) || {};
  return SECTION_KEYS.filter((k) => s[k] && s[k].done === true).length;
}

function listPlans(ctx) {
  let files = [];
  try {
    files = fs.readdirSync(plansDir(ctx)).filter((f) => f.endsWith('.json') && PLAN_ID_RE.test(f.slice(0, -5)));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    const id = file.slice(0, -5);
    let plan;
    try {
      plan = JSON.parse(fs.readFileSync(path.join(plansDir(ctx), file), 'utf8'));
    } catch (e) {
      ctx.log('sprint-planning: corrupt plan file, skipping:', file, e.message);
      continue;
    }
    if (!plan || plan.id !== id) {
      ctx.log('sprint-planning: plan id does not match its file name, skipping:', file);
      continue;
    }
    out.push({
      id: plan.id, team: plan.team, sprintN: plan.sprintN, dateFrom: plan.dateFrom, dateTo: plan.dateTo,
      updatedAt: plan.updatedAt, doneCount: doneCountOf(plan),
    });
  }
  out.sort((a, b) => b.sprintN - a.sprintN);
  return out;
}

/**
 * @returns {object|null} null ONLY when the shard does not exist
 * @throws {CorruptPlanError} when it exists but is unreadable or has another id
 */
function readPlan(ctx, id) {
  const file = shardPath(ctx, id);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    ctx.log('sprint-planning: cannot read plan file', id, e && e.message);
    throw new CorruptPlanError(id);
  }
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (e) {
    ctx.log('sprint-planning: corrupt plan file', id, e.message);
    throw new CorruptPlanError(id);
  }
  if (!plan || typeof plan !== 'object' || plan.id !== id) {
    ctx.log('sprint-planning: plan id does not match its file name', id);
    throw new CorruptPlanError(id);
  }
  return plan;
}

/** True when a shard file exists at all, readable or not. */
function planFileExists(ctx, id) {
  return fs.existsSync(shardPath(ctx, id));
}

function writePlan(ctx, plan) {
  writeJsonAtomic(shardPath(ctx, plan.id), plan);
}

/** @returns {boolean} true when a shard was removed */
function deletePlan(ctx, id) {
  const file = shardPath(ctx, id);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function settingsPath(ctx) {
  return path.join(ctx.dataTier0Dir, MODULE_SUBDIR, SETTINGS_FILE);
}

/**
 * Sprint settings of every team. Invalid per-team entries are dropped (logged).
 * A missing file is an ordinary empty map; a file that exists but is unreadable
 * or has a wrong shape answers an empty map with `unreadable: true`, so a save
 * is refused instead of overwriting every team's settings.
 */
function readSettings(ctx) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath(ctx), 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return emptySettings();
    ctx.log('sprint-planning: cannot read settings file:', e && e.message);
    return { ...emptySettings(), unreadable: true };
  }
  if (!raw || typeof raw !== 'object' || !raw.teams || typeof raw.teams !== 'object' || Array.isArray(raw.teams)) {
    ctx.log('sprint-planning: settings file has a wrong shape');
    return { ...emptySettings(), unreadable: true };
  }
  const teams = {};
  for (const id of Object.keys(raw.teams)) {
    const entry = raw.teams[id];
    const checked = entry && typeof entry === 'object' ? validateSettingsTeams({ [id]: entry }) : { error: 'not an object' };
    if (checked.error || !checked.teams[id]) {
      ctx.log('sprint-planning: skipping invalid team settings', id);
      continue;
    }
    teams[id] = checked.teams[id];
  }
  return { schema_version: 1, updatedAt: raw.updatedAt || null, teams };
}

function writeSettings(ctx, settings) {
  writeJsonAtomic(settingsPath(ctx), settings);
}

module.exports = { BadIdError, CorruptPlanError, storageState, listPlans, readPlan, planFileExists, writePlan, deletePlan, readSettings, writeSettings };
