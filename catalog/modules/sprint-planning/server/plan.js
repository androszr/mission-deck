'use strict';
// modules/sprint-planning/server/plan.js
// Pure plan logic: ids, the new-plan shape, the patch whitelist, sprint dates.
// No fs, no clock of its own (now / randomBytes are injected).

const { TEAM_IDS } = require('./teams.js');

const PLAN_ID_RE = new RegExp('^(' + TEAM_IDS.join('|') + ')-([1-9][0-9]{0,2})$');
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 42; // 6 weeks: room for one exceptionally long sprint
const MAX_SPRINT_WEEKS = 6;
const MAX_ITEMS = 50;
const SECTION_KEYS = ['oncall', 'capacity', 'absences', 'velocity', 'refinements', 'goal', 'jira'];

function planIdOf(team, sprintN) {
  return team + '-' + sprintN;
}

function isoToMs(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

function msToIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True for a real ISO date. */
function isIsoDate(s) {
  return isoToMs(s) !== null;
}

/** Validates a from/to pair: both ISO, from <= to, range <= 42 days. */
function validRange(from, to) {
  const a = isoToMs(from);
  const b = isoToMs(to);
  if (a === null || b === null || a > b) return false;
  return (b - a) / DAY_MS <= MAX_RANGE_DAYS;
}

function buildNewPlan({ team, sprintN, dateFrom, dateTo, now }) {
  const stamp = now.toISOString();
  return {
    schema_version: 1,
    id: planIdOf(team, sprintN),
    team,
    sprintN,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    datesSource: null,
    createdAt: stamp,
    updatedAt: stamp,
    sections: {
      oncall: { done: false, dev: '', devops: '', note: '' },
      capacity: { done: false, peopleOverride: null, extraDaysOff: 0, events: [], dependencies: [] },
      absences: { done: false, manual: [] },
      velocity: { done: false, override: null, note: '' },
      refinements: { done: false, items: [], cross: [] },
      goal: { done: false, goal: '' },
      jira: { done: false },
    },
  };
}

class PatchError extends Error {}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function text(v, max) {
  if (typeof v !== 'string') throw new PatchError('A text field must be a string.');
  return v.trim().slice(0, max);
}

function bool(v) {
  if (typeof v !== 'boolean') throw new PatchError('The "done" field must be a boolean.');
  return v;
}

function intRange(v, min, max, nullable) {
  if ((v === null || v === '') && nullable) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new PatchError('Number out of the allowed range.');
  return n;
}

function list(v, mapItem, randomBytes) {
  if (!Array.isArray(v)) throw new PatchError('The field must be a list.');
  if (v.length > MAX_ITEMS) throw new PatchError('The list is too long (at most ' + MAX_ITEMS + ' items).');
  return v.map((item) => {
    if (!item || typeof item !== 'object') throw new PatchError('A list item has a wrong shape.');
    const out = mapItem(item);
    const given = typeof item.id === 'string' && /^it-[0-9a-f]{8}$/.test(item.id) ? item.id : null;
    out.id = given || 'it-' + randomBytes(4).toString('hex');
    return out;
  });
}

const FIELDS = {
  oncall: {
    done: bool,
    dev: (v) => text(v, 500),
    devops: (v) => text(v, 500),
    note: (v) => text(v, 500),
  },
  capacity: {
    done: bool,
    peopleOverride: (v) => intRange(v, 0, 50, true),
    extraDaysOff: (v) => intRange(v, 0, 10, false),
    events: (v, rb) => list(v, (i) => ({ text: text(i.text === undefined ? '' : i.text, 500) }), rb),
    dependencies: (v, rb) => list(v, (i) => ({ text: text(i.text === undefined ? '' : i.text, 500) }), rb),
  },
  absences: {
    done: bool,
    manual: (v, rb) => list(v, (i) => {
      const from = i.dateFrom;
      const to = i.dateTo;
      if (!isIsoDate(from) || !isIsoDate(to) || isoToMs(from) > isoToMs(to)) throw new PatchError('The absence has an invalid date range.');
      return { person: text(i.person === undefined ? '' : i.person, 500), dateFrom: from, dateTo: to, reason: text(i.reason === undefined ? '' : i.reason, 500) };
    }, rb),
  },
  velocity: {
    done: bool,
    override: (v) => intRange(v, 0, 100000, true),
    note: (v) => text(v, 500),
  },
  refinements: {
    done: bool,
    items: (v, rb) => list(v, (i) => ({
      key: text(i.key === undefined ? '' : i.key, 500),
      topic: text(i.topic === undefined ? '' : i.topic, 500),
      note: text(i.note === undefined ? '' : i.note, 500),
    }), rb),
    cross: (v, rb) => list(v, (i) => {
      const teams = Array.isArray(i.teams) ? i.teams : [];
      if (teams.some((t) => !TEAM_IDS.includes(t))) throw new PatchError('Unknown team in a cross-refinement.');
      return {
        key: text(i.key === undefined ? '' : i.key, 500),
        teams: teams.filter((t, idx) => teams.indexOf(t) === idx),
        note: text(i.note === undefined ? '' : i.note, 500),
      };
    }, rb),
  },
  goal: { done: bool, goal: (v) => text(v, 2000) },
  jira: { done: bool },
};

/**
 * Whitelisted merge of a request body into a plan. Never mutates `plan`.
 * @returns {{plan: object}|{error: string}}
 */
function applyPlanPatch(plan, body, now, randomBytes) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'The request body must be an object.' };
  const rb = randomBytes || require('crypto').randomBytes;
  const next = JSON.parse(JSON.stringify(plan));
  try {
    for (const key of Object.keys(body)) {
      if (key === 'baseUpdatedAt' || key === 'sections' || key === 'dateFrom' || key === 'dateTo') continue;
      throw new PatchError('Unknown field: ' + key + '.');
    }
    if (body.dateFrom !== undefined || body.dateTo !== undefined) {
      const from = body.dateFrom !== undefined ? body.dateFrom : plan.dateFrom;
      const to = body.dateTo !== undefined ? body.dateTo : plan.dateTo;
      if (!validRange(from, to)) throw new PatchError('The sprint dates are invalid (the start cannot be after the end, at most 42 days).');
      next.dateFrom = from;
      next.dateTo = to;
      next.datesSource = 'manual';
    }
    if (body.sections !== undefined) {
      if (!body.sections || typeof body.sections !== 'object' || Array.isArray(body.sections)) throw new PatchError('The "sections" field must be an object.');
      for (const sec of Object.keys(body.sections)) {
        if (!SECTION_KEYS.includes(sec)) throw new PatchError('Unknown section: ' + sec + '.');
        const patch = body.sections[sec];
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new PatchError('Section ' + sec + ' must be an object.');
        for (const field of Object.keys(patch)) {
          // Own keys only: `constructor`, `valueOf`, `__proto__` must not resolve through the prototype.
          if (!hasOwn(FIELDS, sec) || !hasOwn(FIELDS[sec], field)) throw new PatchError('Unknown field of section ' + sec + ': ' + field + '.');
          const fn = FIELDS[sec][field];
          next.sections[sec][field] = fn(patch[field], rb);
        }
      }
    }
  } catch (e) {
    if (e instanceof PatchError) return { error: e.message };
    throw e;
  }
  next.updatedAt = now.toISOString();
  return { plan: next };
}

/**
 * Sprint dates for sprint n: the shard's own dates when Jira knows n,
 * else extrapolated from the newest known sprint (14-day cadence), else null.
 * @param {{sprintN:number,start:string,end:string}[]} history
 */
function sprintDatesFor(history, n) {
  const known = (history || []).filter((s) => s && isIsoDate(s.start) && isIsoDate(s.end));
  const exact = known.find((s) => s.sprintN === n);
  if (exact) return { dateFrom: exact.start, dateTo: exact.end, source: 'jira' };
  if (!known.length) return { dateFrom: null, dateTo: null, source: null };
  const newest = known.reduce((a, b) => (b.sprintN > a.sprintN ? b : a));
  const startMs = isoToMs(newest.start) + (n - newest.sprintN) * 14 * DAY_MS;
  return { dateFrom: msToIso(startMs), dateTo: msToIso(startMs + 14 * DAY_MS), source: 'computed' };
}

// -- Sprint settings (per team cadence) --------------------------------------
//
// settings = { schema_version, updatedAt, teams: { <teamId>: { sprintWeeks,
// firstSprintN, firstSprintStart } } }. A team without an entry is not
// configured and keeps the Jira-based dates (sprintDatesFor).
//
// Date convention (same as Jira shards): dateTo is the day the next sprint
// starts, so a regular sprint spans exactly sprintWeeks * 7 days.

function emptySettings() {
  return { schema_version: 1, updatedAt: null, teams: {} };
}

/**
 * Validates the `teams` map of a PUT /settings body. A team mapped to null
 * is cleared. Returns { teams } (normalised, only known team ids) or { error }.
 */
function validateSettingsTeams(teams) {
  if (!teams || typeof teams !== 'object' || Array.isArray(teams)) return { error: 'The "teams" field must be an object.' };
  const out = {};
  for (const id of Object.keys(teams)) {
    if (!TEAM_IDS.includes(id)) return { error: 'Unknown team: ' + id + '.' };
    const v = teams[id];
    if (v === null) { out[id] = null; continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Team settings must be an object.' };
    const weeks = Number(v.sprintWeeks);
    const first = Number(v.firstSprintN);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_SPRINT_WEEKS) {
      return { error: 'The sprint length must be from 1 to ' + MAX_SPRINT_WEEKS + ' weeks.' };
    }
    if (!Number.isInteger(first) || first < 1 || first > 999) return { error: 'The first sprint number must be a number from 1 to 999.' };
    if (!isIsoDate(v.firstSprintStart)) return { error: 'The start date of the first sprint is invalid.' };
    out[id] = { sprintWeeks: weeks, firstSprintN: first, firstSprintStart: v.firstSprintStart };
  }
  return { teams: out };
}

/** Merges validated team entries into settings (null clears a team). Never mutates. */
function mergeSettings(settings, teams, now) {
  const next = { schema_version: 1, updatedAt: now.toISOString(), teams: { ...((settings && settings.teams) || {}) } };
  for (const id of Object.keys(teams)) {
    if (teams[id] === null) delete next.teams[id]; else next.teams[id] = teams[id];
  }
  return next;
}

/**
 * The day the sprint after `p` starts: dateTo for a whole-week range, else the
 * day after dateTo rolled forward to the sprint start weekday (the weekday of
 * cfg.firstSprintStart; without settings, to the next Mon-Fri day), so a manual
 * Monday-to-Friday exception never pushes the next sprint onto a weekend.
 */
function nextStartAfter(p, cfg) {
  const days = (isoToMs(p.dateTo) - isoToMs(p.dateFrom)) / DAY_MS;
  if (days >= 7 && days % 7 === 0) return p.dateTo;
  let ms = isoToMs(p.dateTo) + DAY_MS;
  const startMs = cfg && isoToMs(cfg.firstSprintStart);
  if (startMs) {
    const wd = new Date(startMs).getUTCDay();
    while (new Date(ms).getUTCDay() !== wd) ms += DAY_MS;
  } else {
    while (new Date(ms).getUTCDay() === 0 || new Date(ms).getUTCDay() === 6) ms += DAY_MS;
  }
  return msToIso(ms);
}

/**
 * Dates of sprint n from the team's settings. Chains from the newest saved
 * plan of the team with firstSprintN <= sprintN < n (so one exceptionally
 * long or short sprint shifts the following ones), else counts from the
 * first sprint. null when the team is not configured or n < firstSprintN.
 * @param {{sprintWeeks:number,firstSprintN:number,firstSprintStart:string}|null} cfg
 * @param {{sprintN:number,dateFrom:string,dateTo:string}[]} teamPlans
 */
function datesFromSettings(cfg, n, teamPlans) {
  if (!cfg || n < cfg.firstSprintN) return null;
  const len = cfg.sprintWeeks * 7 * DAY_MS;
  const prev = (teamPlans || [])
    .filter((p) => p && p.sprintN >= cfg.firstSprintN && p.sprintN < n && validRange(p.dateFrom, p.dateTo))
    .reduce((a, b) => (!a || b.sprintN > a.sprintN ? b : a), null);
  const startMs = prev
    ? isoToMs(nextStartAfter(prev, cfg)) + (n - prev.sprintN - 1) * len
    : isoToMs(cfg.firstSprintStart) + (n - cfg.firstSprintN) * len;
  return { dateFrom: msToIso(startMs), dateTo: msToIso(startMs + len), source: 'settings' };
}

module.exports = {
  PLAN_ID_RE, SECTION_KEYS, MAX_SPRINT_WEEKS, planIdOf, buildNewPlan, applyPlanPatch, sprintDatesFor, isIsoDate, validRange,
  emptySettings, validateSettingsTeams, mergeSettings, nextStartAfter, datesFromSettings,
};
