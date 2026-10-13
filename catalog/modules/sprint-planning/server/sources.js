'use strict';
// modules/sprint-planning/server/sources.js
// Read-only readers of data other modules own, all inside the team data
// repository (data-tier-0). Every reader answers an `available` flag instead
// of throwing.
//
//   on-call/index.json + on-call/months/<YYYY-MM>.json   (on-call module)
//   time-off/people/<slug>.json                          (time-off module)
//   team/team-members.json                               (core, Settings > Users)
//   sprint-stats/index.json                              (sprint-stats module)
//
// Each owner module may not be installed; a missing file is "unavailable",
// never an error. The candidate lists below accept the alternative layouts
// those modules have used, first match wins.

const fs = require('fs');
const path = require('path');

const COMBINING_MARKS_RE = /[̀-ͯ]/g;
const SLUG_RE = /^[a-z0-9-]+$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

const ONCALL_DIR = 'on-call';
const ONCALL_MONTHS_SUBDIR = 'months';
const TIME_OFF_PEOPLE_DIRS = [['time-off', 'people'], ['time-off', 'persons']];
const SPRINT_INDEX_PATHS = [['sprint-stats', 'index.json'], ['jira', 'sprints', 'index.json'], ['jira', 'sprinty', 'index.json']];

/** Copy of the time-off module's slugify (that module may not be installed). */
function slugify(name) {
  let s = String(name === null || name === undefined ? '' : name);
  s = s.normalize('NFD');
  s = s.replace(COMBINING_MARKS_RE, '');
  s = s.replace(/[łŁ]/g, 'l');
  s = s.replace(/[đĐ]/g, 'd');
  s = s.replace(/[øØ]/g, 'o');
  s = s.toLowerCase();
  s = s.replace(/[-_\s]+/g, ' ');
  s = s.replace(/\s+app\s+(read|write|access)$/, '');
  s = s.trim();
  s = s.replace(/\s+/g, '-');
  return s;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(String(y) + '-' + String(m).padStart(2, '0'));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function readDuties(ctx, from, to) {
  const dir = path.join(ctx.dataTier0Dir, ONCALL_DIR);
  try {
    const index = readJson(path.join(dir, 'index.json'));
    const columns = (Array.isArray(index.columns) ? index.columns : []).map((c) => ({ key: String(c.key), label: String(c.label || c.key) }));
    const entries = [];
    for (const month of monthsBetween(from, to)) {
      if (!MONTH_RE.test(month)) continue;
      let shard;
      try {
        shard = readJson(path.join(dir, ONCALL_MONTHS_SUBDIR, month + '.json'));
      } catch {
        continue;
      }
      for (const e of Array.isArray(shard.entries) ? shard.entries : []) {
        if (!e || typeof e.date !== 'string' || e.date < from || e.date > to) continue;
        entries.push({
          date: e.date, column: e.column, person: e.person || e.person_raw || '',
          person_slug: e.person_slug || slugify(e.person || ''), note: e.note || '',
        });
      }
    }
    return { available: true, columns, entries };
  } catch {
    return { available: false, columns: [], entries: [] };
  }
}

function readRoster(ctx, rosterTeam) {
  try {
    const data = readJson(path.join(ctx.dataTier0Dir, 'team', 'team-members.json'));
    const members = (Array.isArray(data.team_members) ? data.team_members : [])
      .filter((m) => m && m.team === rosterTeam)
      .map((m) => {
        const name = (String(m.first_name || '') + ' ' + String(m.last_name || '')).trim();
        return { name, role: m.role || '', slug: slugify(name) };
      });
    return { available: true, members };
  } catch {
    return { available: false, members: [] };
  }
}

function readAbsences(ctx, slugs, from, to) {
  const persons = [];
  const found = TIME_OFF_PEOPLE_DIRS.map((parts) => path.join(ctx.dataTier0Dir, ...parts))
    .find((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  let any = Boolean(found);
  if (!any) {
    try {
      fs.statSync(path.join(ctx.dataTier0Dir, TIME_OFF_PEOPLE_DIRS[0][0]));
      any = true;
    } catch {
      return { available: false, persons: [] };
    }
  }
  const dir = found || path.join(ctx.dataTier0Dir, ...TIME_OFF_PEOPLE_DIRS[0]);
  for (const slug of slugs) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) continue;
    let data;
    try {
      data = readJson(path.join(dir, slug + '.json'));
    } catch {
      continue;
    }
    const entries = (Array.isArray(data.entries) ? data.entries : [])
      .filter((e) => e && typeof e.dateFrom === 'string' && typeof e.dateTo === 'string' && e.dateFrom <= to && e.dateTo >= from)
      .map((e) => ({ dateFrom: e.dateFrom, dateTo: e.dateTo }));
    if (entries.length) persons.push({ slug, name: data.name || slug, entries });
  }
  return { available: any, persons };
}

function readIndex(ctx) {
  for (const parts of SPRINT_INDEX_PATHS) {
    const file = path.join(ctx.dataTier0Dir, ...parts);
    if (fs.existsSync(file)) return readJson(file);
  }
  throw new Error('sprint-index-unavailable');
}

function readSprintHistory(ctx, team) {
  try {
    const index = readIndex(ctx);
    const sprints = [];
    for (const s of Array.isArray(index.sprints) ? index.sprints : []) {
      if (!s || s.src !== team.sprintSrc) continue;
      const t = (Array.isArray(s.teams) ? s.teams : []).find((x) => x && x.team === team.sprintTeamKey);
      if (!t) continue;
      const sum = t.summary || {};
      sprints.push({
        sprintN: s.sprint_n, sprintId: t.sprint_id, sprintName: t.sprint_name, state: t.state, phase: t.phase || s.phase,
        start: typeof t.start === 'string' ? t.start.slice(0, 10) : '',
        end: typeof t.end === 'string' ? t.end.slice(0, 10) : '',
        committed: typeof sum.committed === 'number' ? sum.committed : null,
        done: typeof sum.done === 'number' ? sum.done : null,
        goal: t.goal || '',
      });
    }
    sprints.sort((a, b) => a.sprintN - b.sprintN);
    return { available: true, unit: team.unit, sprints };
  } catch {
    return { available: false, unit: team.unit, sprints: [] };
  }
}

/**
 * Jira boards by board key, for every key a team uses (TEAMS[].sprintSrc).
 * A key the index does not know answers null.
 * @param {string[]} keys
 */
function readBoards(ctx, keys) {
  const pick = (x) => (x ? { board_id: String(x.board_id), project: String(x.project) } : null);
  let b = {};
  try {
    b = readIndex(ctx).boards || {};
  } catch {
    b = {};
  }
  const out = {};
  for (const k of keys || []) out[k] = Object.prototype.hasOwnProperty.call(b, k) ? pick(b[k]) : null;
  return out;
}

module.exports = { slugify, readDuties, readRoster, readAbsences, readSprintHistory, readBoards };
