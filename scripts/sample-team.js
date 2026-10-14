#!/usr/bin/env node
'use strict';
// scripts/sample-team.js
// Writes the "Northwind Product" sample team: a fictional product team with six
// squads, 24 people and one quarter of history (2026-07-01 .. 2026-09-30), laid
// out exactly like the team data repository (one folder per module path).
//
//   node scripts/sample-team.js [--out <dir>]     writes <dir>/ds-data/
//
// The default <dir> is examples/sample-team. The output is the SAME bytes on
// every run: a seeded random generator, a fixed clock (FIXED_NOW below), no
// reading of the system time and no network. Node built-ins only; where a
// catalog module owns the on-disk shape (sprint stats, time log, costs, on-call,
// sprint review, sprint planning, locations, usage analytics, DevOps stats) the
// generator calls that module's own pure builders, so the shapes cannot drift.
//
// Used by: the "Try it with sample data" mode of the onboarding wizard
// (server.js, Sample mode), tests/test_sample_team.mjs and scripts/readme-shots.mjs.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const C = require('./_sample-team-content.js');
const { fruitAvatarSvg } = require('./_fruit-avatars.js');

const QUARTER_START = '2026-07-01';
const QUARTER_END = '2026-09-30';
// The one clock of the tree. Never read the real time in this file.
const FIXED_NOW = '2026-09-30T16:00:00.000Z';
const FIXED_NOW_LOCAL = '2026-09-30T18:00:00+02:00';
const DEFAULT_OUT = path.join(ROOT, 'examples', 'sample-team');

const SPRINT_FIRST = 21;
const SPRINT_COUNT = 6;
const SPRINT_DAYS = 14;

function modulePath(id, ...rest) {
  return path.join(ROOT, 'catalog', 'modules', id, ...rest);
}
function mod(id, file) {
  return require(modulePath(id, 'server', file));
}

// -- Seeded randomness ---------------------------------------------------------

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A named, independent stream: adding a section never shifts another one. */
function rngFor(name) {
  return mulberry32(fnv1a('northwind-product/' + name));
}

const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, list) => list[Math.floor(r() * list.length)];
function hex(r, n) {
  let s = '';
  while (s.length < n) s += Math.floor(r() * 16).toString(16);
  return s;
}
function shuffled(r, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function bytesFrom(r) {
  return (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(r() * 256)));
}

// -- Dates (ISO strings, UTC arithmetic, no clock) -------------------------------

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function dayOfWeek(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function isWeekend(iso) {
  const w = dayOfWeek(iso);
  return w === 0 || w === 6;
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// -- Output --------------------------------------------------------------------

function makeWriter(outDir) {
  const root = path.join(outDir, 'ds-data');
  return {
    root,
    json(rel, data) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    },
    text(rel, text) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, 'utf8');
    },
  };
}

// -- People ---------------------------------------------------------------------

function buildPeople() {
  const r = rngFor('people');
  const people = [];
  for (const squad of C.SQUADS) {
    for (const [first, last, role] of squad.people) {
      const slug = (first + last).toLowerCase();
      people.push({
        id: 'tm-' + hex(r, 8),
        first_name: first,
        last_name: last,
        role,
        team: squad.name,
        email: (first + '.' + last).toLowerCase() + '@' + C.DOMAIN,
        avatar: slug + '.svg',
        // helpers used by the other sections, not written to team-members.json
        _name: first + ' ' + last,
        _slug: first.toLowerCase() + '-' + last.toLowerCase(),
        _squad: squad.id,
      });
    }
  }
  return people;
}

// Made-up people get made-up faces: a fruit with a face, never initials and
// never a photo (scripts/_fruit-avatars.js).
function avatarSvg(person, index) {
  return fruitAvatarSvg(index, person._name);
}

function writeTeam(w, people) {
  const members = people
    .map((p) => ({
      id: p.id, first_name: p.first_name, last_name: p.last_name, role: p.role, team: p.team, email: p.email, avatar: p.avatar,
    }))
    .sort((a, b) => a.last_name.localeCompare(b.last_name, 'en') || a.first_name.localeCompare(b.first_name, 'en'));
  w.json('team/team-members.json', { generated_at: FIXED_NOW, source: 'sample-team', team_members: members });
  people.forEach((p, i) => w.text('team/avatars/' + p.avatar, avatarSvg(p, i)));
}

// -- Sprints -------------------------------------------------------------------------

function sprintWindows() {
  const out = [];
  for (let i = 0; i < SPRINT_COUNT; i++) {
    const start = addDays(QUARTER_START, i * SPRINT_DAYS);
    out.push({ i, n: SPRINT_FIRST + i, start, end: addDays(start, SPRINT_DAYS - 1), next: addDays(start, SPRINT_DAYS) });
  }
  return out;
}

// How much of its commitment a squad finished, per sprint. One bad sprint
// (Comet, sprint 23) with a recovery, and a post-release dip (Borealis, 24).
function completionFactor(squadId, sprintIndex, r) {
  const base = { atlas: 0.9, borealis: 0.88, comet: 0.86, delta: 0.92, echo: 0.84, falcon: 0.87 }[squadId];
  let f = base + (r() - 0.5) * 0.12;
  if (squadId === 'comet') f = [0.9, 0.86, 0.52, 0.78, 0.95, 0.93][sprintIndex] + (r() - 0.5) * 0.04;
  if (squadId === 'borealis' && sprintIndex === 3) f = 0.68 + (r() - 0.5) * 0.04;
  if (sprintIndex === 5) f = Math.min(0.98, f + 0.04);
  return Math.max(0.35, Math.min(1, f));
}

const BASE_COMMIT = { atlas: 34, borealis: 30, comet: 38, delta: 28, echo: 32, falcon: 26 };
const ESTIMATES = [1, 2, 3, 3, 5, 5, 8];

/** Builds all team-sprint records: { src, team, sprintIndex, issues, ... }. */
function buildSprintFacts(people, timeOff) {
  const r = rngFor('sprints');
  const windows = sprintWindows();
  const facts = [];
  for (const squad of C.SQUADS) {
    const members = people.filter((p) => p._squad === squad.id);
    for (const win of windows) {
      const factor = completionFactor(squad.id, win.i, r);
      const target = BASE_COMMIT[squad.id] + int(r, -3, 3);
      // issues: estimates until the commitment is reached
      const issues = [];
      let sum = 0;
      let j = 0;
      while (sum < target && j < 14) {
        let est = pick(r, ESTIMATES);
        if (sum + est > target) est = target - sum;
        const titles = C.ISSUE_TITLES[squad.id];
        const typeRoll = r();
        issues.push({
          key: squad.key + '-' + (100 + win.i * 20 + j),
          summary: titles[(win.i * 3 + j) % titles.length],
          type: typeRoll < 0.15 ? 'Bug' : typeRoll < 0.3 ? 'Task' : 'Story',
          assignee: members[j % members.length]._name,
          estimate: est,
          epic: squad.epics[j % squad.epics.length],
        });
        sum += est;
        j += 1;
      }
      const committed = sum;
      const wantDone = Math.round(committed * factor);
      const order = shuffled(r, issues.map((_, k) => k));
      // the subset of issues whose estimates come closest to the target
      let bestMask = 0;
      let bestSum = -1;
      for (let mask = 1; mask < (1 << order.length); mask++) {
        let sum2 = 0;
        for (let b = 0; b < order.length; b++) if (mask & (1 << b)) sum2 += issues[order[b]].estimate;
        if (sum2 <= wantDone && sum2 > bestSum) { bestSum = sum2; bestMask = mask; }
      }
      order.forEach((k, b) => {
        if (bestMask & (1 << b)) {
          issues[k].status_bucket = 'done';
          issues[k].status_label = 'Done';
        }
      });
      const rest = order.filter((k) => !issues[k].status_bucket);
      rest.forEach((k, idx) => {
        const it = issues[k];
        if (idx === rest.length - 1 && rest.length > 2 && r() < 0.5) {
          it.status_bucket = 'dropped'; it.status_label = 'Cancelled';
        } else if (r() < 0.6) {
          it.status_bucket = 'wip'; it.status_label = 'In Progress';
        } else {
          it.status_bucket = 'todo'; it.status_label = 'To Do';
        }
      });
      const bucketSum = (b) => issues.filter((x) => x.status_bucket === b).reduce((s, x) => s + x.estimate, 0);
      const added = win.i > 0 && r() < 0.5 ? Math.min(3, committed) : 0;
      const summary = {
        committed, done: bucketSum('done'), wip: bucketSum('wip'), todo: bucketSum('todo'), dropped: bucketSum('dropped'),
        added, total_issues: issues.length, completion_pct: Math.round((bucketSum('done') / committed) * 100),
      };
      // people: committed / done per person from their issues
      const offDays = (p) => {
        const set = timeOff.get(p._slug) || [];
        let n = 0;
        for (const d of eachDay(win.start, win.end)) if (!isWeekend(d) && set.some(([a, b]) => d >= a && d <= b)) n += 1;
        return n;
      };
      const persons = members.map((p) => {
        const mine = issues.filter((x) => x.assignee === p._name);
        const sumOf = (b) => mine.filter((x) => x.status_bucket === b).reduce((s, x) => s + x.estimate, 0);
        const c = mine.reduce((s, x) => s + x.estimate, 0);
        return {
          name: p._name, committed: c, done: sumOf('done'), wip: sumOf('wip'), todo: sumOf('todo'), dropped: sumOf('dropped'),
          added: 0, completion_pct: c ? Math.round((sumOf('done') / c) * 100) : 0, days_with_work: 10 - offDays(p),
        };
      });
      // burndown over the 14 days: remaining = committed - done-so-far
      const finalRemaining = committed - summary.done;
      const burndown = [];
      for (let d = 0; d <= SPRINT_DAYS - 1; d++) {
        const t = d / (SPRINT_DAYS - 1);
        let progress = t;
        if (squad.id === 'comet' && win.i === 2) progress = t < 0.7 ? t * 0.45 : 0.315 + (t - 0.7) * 2.2;
        const remaining = Math.max(finalRemaining, Math.round(committed - (committed - finalRemaining) * Math.min(1, progress) + (r() - 0.5) * 1.6));
        burndown.push({ day_n: d, date: addDays(win.start, d), remaining: d === 0 ? committed : d === SPRINT_DAYS - 1 ? finalRemaining : remaining });
      }
      facts.push({
        squad, win, summary, persons, burndown, factor,
        issues: issues.map((x) => ({
          key: x.key, summary: x.summary, type: x.type, assignee: x.assignee, status_bucket: x.status_bucket,
          status_label: x.status_label, estimate: x.estimate, spent_h: null, _epic: x.epic,
        })),
        src: squad.id === 'delta' ? 'platform' : 'main',
      });
    }
  }
  return facts;
}

function writeSprintStats(w, facts) {
  const store = mod('sprint-stats', 'store.js');
  const spillover = mod('sprint-stats', 'spillover.js');
  const stamp = '2026-09-30T07:30:00';
  const sprints = [];
  for (let i = 0; i < SPRINT_COUNT; i++) {
    for (const src of ['main', 'platform']) {
      const teams = facts.filter((f) => f.src === src && f.win.i === i).map((f) => {
        const idx = C.SQUADS.indexOf(f.squad);
        return {
          src, team: f.squad.name, unit: src === 'platform' ? 'MD' : 'SP', sprint_n: f.win.n, sprint_id: src === 'main' ? f.win.n * 100 + idx : 9000 + f.win.n,
          sprint_name: f.squad.name + ' Sprint ' + f.win.n, state: 'closed', phase: 'END',
          start: f.win.start + 'T09:00:00.000+02:00', end: f.win.next + 'T09:00:00.000+02:00',
          goal: f.squad.name + ': ' + f.squad.goals[i], summary: f.summary, persons: f.persons,
          issues: f.issues.map(({ _epic, ...rest }) => rest), burndown: f.burndown, extra: {},
        };
      });
      sprints.push({ src, sprint_n: SPRINT_FIRST + i, phase: 'END', teams });
    }
  }
  const boards = {
    main: {
      board_id: '1', project: 'NW', teams: C.SQUADS.filter((s) => s.id !== 'delta').map((s) => s.name),
      active_sprint_n: SPRINT_FIRST + SPRINT_COUNT - 1, generated_at: stamp,
    },
    platform: { board_id: '2', project: 'DLT', active_sprint_id: 9000 + SPRINT_FIRST + SPRINT_COUNT - 1, year_filter: 2026, generated_at: stamp },
  };
  store.mergeSprints(w.root, sprints, { onlyMissing: false, boards });
  const aggregate = spillover.buildSpilloverAggregate(store.readIndex(w.root));
  store.writeSpilloverIfChanged(w.root, spillover.spilloverText(aggregate));
}

// -- Time off --------------------------------------------------------------------------

function buildTimeOff(people) {
  const r = rngFor('time-off');
  const plan = new Map(); // slug -> [[from, to], ...]
  for (const p of people) {
    const list = [];
    // one longer summer break, outside the busiest sprint days where possible
    const startOffset = int(r, 14, 66);
    const from = addDays(QUARTER_START, startOffset);
    const len = pick(r, [4, 4, 5, 9, 11]);
    list.push([from, addDays(from, len)]);
    if (r() < 0.55) {
      const d = addDays(QUARTER_START, int(r, 3, 85));
      if (!isWeekend(d)) list.push([d, d]);
    }
    plan.set(p._slug, list.sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  }
  // the one on-call swap and a team-wide quiet week are described elsewhere
  return plan;
}

function writeTimeOff(w, people, plan) {
  const r = rngFor('time-off-meta');
  const persons = {};
  let count = 0;
  for (const p of people) {
    const entries = (plan.get(p._slug) || []).map(([a, b]) => {
      const submitted = addDays(a, -int(r, 7, 30));
      return {
        dateFrom: a < QUARTER_START ? QUARTER_START : a,
        dateTo: b > QUARTER_END ? QUARTER_END : b,
        submittedAt: (submitted < QUARTER_START ? QUARTER_START : submitted) + 'T' + pick(r, ['08:12:00', '09:40:00', '13:05:00', '16:20:00']),
        submittedBy: p.email,
      };
    });
    w.json('time-off/people/' + p._slug + '.json', { entries, name: p._name, slug: p._slug });
    persons[p._slug] = { count: entries.length, last_changed: '2026-09-30T06:00:00', name: p._name };
    count += entries.length;
  }
  w.json('time-off/index.json', {
    count, fetched_at: '2026-09-30T06:00:00', persons, schema: 1, skipped: 0, source_mtime: '2026-09-29T17:45:00',
  });
}

// -- Worklogs (time log + costs) ----------------------------------------------------------

function buildWorklogs(people, facts, timeOff) {
  const r = rngFor('worklogs');
  const { isPlHoliday } = mod('time-log', 'calendar.js');
  const last14 = eachDay(addDays(QUARTER_END, -14), addDays(QUARTER_END, -1));
  // a handful of people forget to log on some of the last days
  const forgetful = new Map([
    ['tomas-novak', 4], ['kofi-mensah', 3], ['oscar-lindqvist', 2], ['jonas-berg', 2], ['felix-moreau', 1], ['taylor-kim', 3],
  ]);
  const worklogs = [];
  const issueDetails = {};
  const bySprint = (squadId, day) => {
    let found = null;
    for (const f of facts) {
      if (f.squad.id !== squadId) continue;
      if (day >= f.win.start) found = f;
    }
    return found;
  };
  for (const p of people) {
    const off = timeOff.get(p._slug) || [];
    const skipLast = new Set();
    if (forgetful.has(p._slug)) {
      const pool = shuffled(r, last14.filter((d) => !isWeekend(d) && !isPlHoliday(d)));
      pool.slice(0, forgetful.get(p._slug)).forEach((d) => skipLast.add(d));
    }
    for (const day of eachDay(QUARTER_START, QUARTER_END)) {
      if (isWeekend(day) || isPlHoliday(day)) continue;
      if (off.some(([a, b]) => day >= a && day <= b)) continue;
      if (skipLast.has(day)) continue;
      const fact = bySprint(p._squad, day);
      const mine = fact.issues.filter((x) => x.assignee === p._name);
      const pool = mine.length ? mine.concat(fact.issues.slice(0, 3)) : fact.issues;
      const count = pick(r, [1, 2, 2, 3]);
      const chosen = shuffled(r, pool).filter((x, i, arr) => arr.findIndex((y) => y.key === x.key) === i).slice(0, count);
      let remaining = pick(r, [7.5, 8, 8, 8, 7.5, 8.5]) * 2; // in half hours
      chosen.forEach((it, idx) => {
        const share = idx === chosen.length - 1 ? remaining : Math.max(1, Math.min(remaining - (chosen.length - idx - 1), int(r, 4, 10)));
        remaining -= share;
        issueDetails[it.key] = { summary: it.summary, type: it.type, epicKey: it._epic[0], epicName: it._epic[1] };
        worklogs.push({
          author: { name: p.email, displayName: p._name },
          issue: { key: it.key, summary: it.summary },
          dateStarted: day + 'T09:00:00.000+0200',
          timeSpentSeconds: share * 1800,
          dateCreated: day + 'T17:' + String(int(r, 10, 59)).padStart(2, '0') + ':00.000+0200',
        });
      });
    }
  }
  return { worklogs, issueDetails };
}

function writeTimeLog(w, people, worklogs) {
  const { buildTimeLog } = mod('time-log', 'build.js');
  const { windowDates } = mod('time-log', 'calendar.js');
  const dates = windowDates(QUARTER_END, 14); // 2026-09-16 .. 2026-09-29, newest first
  const members = people.map((p) => ({
    id: p.id, first_name: p.first_name, last_name: p.last_name, role: p.role, team: p.team, email: p.email,
  }));
  const built = buildTimeLog(worklogs, members, dates, { now: () => new Date(FIXED_NOW) });
  for (const shard of built.shards) w.json('time-log/people/' + shard.slug + '.json', shard);
  w.json('time-log/index.json', built.index);
}

// -- Costs ---------------------------------------------------------------------------------

const RATE_BY_ROLE = { 'Product Owner': 560, Engineer: 520, Designer: 480, 'QA Engineer': 440 };

function writeCosts(w, people, worklogs, issueDetails) {
  const compute = mod('costs', 'compute.js');
  const contractors = C.VENDORS.map((v) => ({
    name: v.person, email: v.mail + '@' + v.name.toLowerCase().replace(/[^a-z]/g, '') + '.example', vendor: v, squad: C.SQUADS.find((s) => s.id === v.squad),
  }));
  // contractors log time too (they are in the cost config, not in the roster)
  const r = rngFor('contractor-worklogs');
  const { isPlHoliday } = mod('time-log', 'calendar.js');
  const extra = [];
  for (const c of contractors) {
    const keys = Object.keys(issueDetails).filter((k) => k.startsWith(c.squad.key + '-'));
    for (const day of eachDay(QUARTER_START, QUARTER_END)) {
      if (isWeekend(day) || isPlHoliday(day) || r() < 0.12) continue;
      const key = pick(r, keys);
      extra.push({
        author: { name: c.email, displayName: c.name },
        issue: { key, summary: issueDetails[key].summary },
        dateStarted: day + 'T09:00:00.000+0200',
        timeSpentSeconds: pick(r, [6, 7, 8, 8]) * 3600,
      });
    }
  }
  const all = worklogs.concat(extra);
  const months = ['2026-07', '2026-08', '2026-09'];
  const agg = compute.aggregateWorklogs(all);
  const split = compute.splitByMonth(agg, months);
  const entries = [];
  for (const m of months) {
    const monthKeys = new Set();
    for (const a of split[m].authors) for (const k of Object.keys(a.issues || {})) monthKeys.add(k);
    const issues = {};
    for (const k of [...monthKeys].sort()) if (issueDetails[k]) issues[k] = issueDetails[k];
    const lastDay = { '2026-07': '2026-07-31', '2026-08': '2026-08-31', '2026-09': QUARTER_END }[m];
    w.json('costs/hours/' + m + '.json', {
      schemaVersion: 3, month: m, fetchedAt: FIXED_NOW, dateFrom: m + '-01', dateTo: lastDay, partial: false,
      projects: C.SQUADS.map((s) => s.key), skipped: agg.skipped, authors: split[m].authors, issues,
    });
    entries.push({
      month: m, fetchedAt: FIXED_NOW, dateFrom: m + '-01', dateTo: lastDay, partial: false,
      authors: split[m].authors.length, worklogs: agg.counts[m] || 0, skipped: agg.skipped,
    });
  }
  const seen = agg.authors.map((a) => ({ key: a.key, displayName: a.displayName, months: Object.keys(a.months) }));
  const index = compute.buildIndex(null, entries, { now: FIXED_NOW, projects: C.SQUADS.map((s) => s.key), seen, unmatchedByEmail: [] });
  w.json('costs/hours/index.json', index);

  const members = people.map((p) => {
    const squad = C.SQUADS.find((s) => s.id === p._squad);
    return { id: p.id, name: p._name, email: p.email, included: true, areas: squad.area ? [squad.area] : [] };
  }).concat(contractors.map((c, i) => ({
    id: 'ext-' + (i + 1), name: c.name, email: c.email, included: true, external: true, company: c.vendor.name, areas: [c.squad.area],
  })));
  w.json('costs/config.json', { schemaVersion: 1, members });
  const rates = people.map((p) => ({ name: p._name, daily_rate: RATE_BY_ROLE[p.role] }))
    .concat(contractors.map((c) => ({ name: c.name, daily_rate: c.vendor.rate })));
  w.json('costs/team-rates.json', { team_rates: rates });
}

// -- Prod bugs ------------------------------------------------------------------------------

function writeProdBugs(w) {
  const r = rngFor('prod-bugs');
  const windows = sprintWindows();
  const areas = ['orders', 'otherModules', 'platform'];
  const keyOf = { orders: 'ATL', otherModules: 'CMT', platform: 'FAL' };
  const titles = {};
  for (const a of areas) titles[a] = shuffled(r, C.BUG_TITLES[a]);
  const used = { orders: 0, otherModules: 0, platform: 0 };
  const pool = { orders: [], otherModules: [], platform: [] };
  let serial = 4000;
  const priority = () => pick(r, ['Low', 'Medium', 'Medium', 'High', 'Critical']);
  const statusOf = () => pick(r, ['Open', 'Open', 'In Progress', 'Blocked', 'New']);
  const newBug = (area, created) => {
    const t = titles[area][used[area] % titles[area].length] + (used[area] >= titles[area].length ? ' (' + Math.floor(used[area] / titles[area].length + 1) + ')' : '');
    used[area] += 1;
    serial += 1;
    return { key: keyOf[area] + '-' + serial, summary: t, status: statusOf(), priority: priority(), created };
  };
  // starting stock, created before the quarter
  for (const [area, n] of [['orders', 5], ['otherModules', 7], ['platform', 9]]) {
    for (let i = 0; i < n; i++) pool[area].push(newBug(area, addDays(QUARTER_START, int(r, 0, 3))));
  }
  const inflow = [6, 5, 7, 19, 11, 6]; // the spike follows the release at the start of sprint 24
  const outflow = [5, 6, 6, 9, 14, 10];
  const share = { orders: 0.3, otherModules: 0.4, platform: 0.3 };
  const available = [];
  windows.forEach((win, si) => {
    const shard = { sprint: win.n, sprintName: 'Sprint ' + win.n, dateRange: { startDate: win.start, endDate: win.end }, dateRangeDisplay: '', fetchedAt: '2026-09-30T08:00:00', areas: {} };
    const sd = win.start.slice(8, 10) + '.' + win.start.slice(5, 7);
    const ed = win.end.slice(8, 10) + '.' + win.end.slice(5, 7);
    shard.dateRangeDisplay = sd + '-' + ed;
    for (const area of areas) {
      const nNew = Math.round(inflow[si] * share[area]);
      const nFix = Math.round(outflow[si] * share[area]);
      for (let i = 0; i < nNew; i++) pool[area].push(newBug(area, addDays(win.start, int(r, 0, SPRINT_DAYS - 1))));
      const resolved = [];
      const open = pool[area];
      for (let i = 0; i < nFix && open.length > 3; i++) {
        const idx = int(r, 0, Math.min(open.length - 1, 5));
        const [b] = open.splice(idx, 1);
        let resolvedOn = addDays(win.start, int(r, 1, SPRINT_DAYS - 1));
        if (resolvedOn < b.created) resolvedOn = b.created;
        resolved.push({
          key: b.key, summary: b.summary, status: 'Done', priority: b.priority, created: b.created,
          resolved: resolvedOn, fixDays: Math.max(0, daysBetween(b.created, resolvedOn)),
        });
      }
      const fix = resolved.length ? Math.round(resolved.reduce((s, x) => s + x.fixDays, 0) / resolved.length) : null;
      shard.areas[area] = {
        bugs: open.length, bugFixTime: fix, resolvedCount: resolved.length, createdCount: nNew,
        openBugs: open.map((b) => ({ ...b })), resolvedBugs: resolved,
      };
    }
    w.json('prod-bugs/prod-bugs-sprint-' + win.n + '.json', shard);
    available.push(win.n);
  });
  w.json('prod-bugs/manifest.json', { latestSprint: windows[windows.length - 1].n, availableProdBugsSprints: available });
}

// -- DevOps stats ---------------------------------------------------------------------------------

function writeDevops(w, people) {
  const r = rngFor('devops');
  const store = mod('devops-stats', 'store.js');
  const engineers = people.filter((p) => p.role === 'Engineer');
  const statuses = [
    { id: '10000', name: 'Backlog', category: 'new', current: true },
    { id: '10001', name: 'In Progress', category: 'indeterminate', current: true },
    { id: '10002', name: 'In Review', category: 'indeterminate', current: true },
    { id: '10003', name: 'Done', category: 'done', current: true },
    { id: '10004', name: 'Blocked', category: 'indeterminate', current: true },
  ];
  const titles = [
    'Rotate the deploy keys', 'Speed up the CI pipeline', 'Move the staging database to the new instance',
    'Alert on failed background jobs', 'Automate the preview environments', 'Upgrade the base container image',
    'Add a canary step to deployments', 'Clean up unused feature flags', 'Backup restore drill',
    'Reduce the build cache size', 'Dashboard for deploy frequency', 'Document the rollback procedure',
    'Pin the dependency versions', 'Cheaper log retention', 'Health checks for the gateway',
  ];
  const facts = [];
  let n = 100;
  for (const day of eachDay(QUARTER_START, QUARTER_END)) {
    if (isWeekend(day) || r() > 0.42) continue;
    n += 1;
    const created = day + 'T09:' + String(int(r, 0, 59)).padStart(2, '0') + ':00.000Z';
    const waitDays = int(r, 0, 3);
    const workDays = int(r, 1, 6);
    const reviewDays = int(r, 0, 2);
    const startDay = addDays(day, waitDays);
    const reviewDay = addDays(startDay, workDays);
    const doneDay = addDays(reviewDay, reviewDays);
    const isOpen = doneDay > QUARTER_END || r() < 0.06;
    const blocked = r() < 0.12;
    const t = (d, hh) => d + 'T' + hh + ':00:00.000Z';
    const intervals = [{ s: '10000', from: created, to: t(startDay, '10') }];
    const flagged = [];
    if (isOpen) {
      intervals.push({ s: '10001', from: t(startDay, '10'), to: null });
    } else {
      intervals.push({ s: '10001', from: t(startDay, '10'), to: t(reviewDay, '14') });
      intervals.push({ s: '10002', from: t(reviewDay, '14'), to: t(doneDay, '16') });
      intervals.push({ s: '10003', from: t(doneDay, '16'), to: null });
    }
    if (blocked && !isOpen) flagged.push({ from: t(addDays(startDay, 1), '09'), to: t(addDays(startDay, 2), '09') });
    const who = pick(r, engineers);
    const fact = {
      key: 'DEVOPS-' + n, summary: titles[(n * 7) % titles.length], type_id: '10002', subtask: false, is_epic: false, epic_key: null,
      created, started_at: t(startDay, '10'), done_at: isOpen ? null : t(doneDay, '16'), status_id: isOpen ? '10001' : '10003',
      assignee: who._name, time_spent_s: workDays * 3 * 3600, intervals, flagged,
    };
    facts.push(fact);
  }
  store.mergeIssues(w.root, facts, {
    project: 'DEVOPS', generated_at: FIXED_NOW, mode: 'full', lookback_days: 365,
    fields: { epic_link: 'customfield_10014', epic_name: 'customfield_10011', flagged: 'customfield_10021' }, statuses,
  });
  w.json('jira/devops/config.json', { blocked_status_ids: ['10004'] });
}

// -- QA tests ------------------------------------------------------------------------------------

function writeQa(w) {
  const r = rngFor('qa');
  const dir = 'jira/qa-automation/';
  const labels = { orders: 'Orders', checkout: 'Checkout', warehouse: 'Warehouse', catalog: 'Catalog', stock: 'Stock levels', deliveries: 'Deliveries', labels: 'Labels' };
  const counts = { orders: 46, checkout: 38, catalog: 31, stock: 22, deliveries: 27, labels: 16 };
  const statusPool = ['Automated', 'Automated', 'Automated', 'Test', 'Open', 'In Progress', 'New', 'Blocked', 'Closed'];
  const subjects = {
    orders: ['Create an order', 'Edit quantity', 'Cancel an order', 'Reorder a past order', 'Import orders from CSV', 'Order history filter'],
    checkout: ['Pay with saved terms', 'Change delivery address', 'Apply a coupon', 'Retry a failed payment', 'Order summary email'],
    catalog: ['Import supplier CSV', 'Edit a variant', 'Archive a product', 'Duplicate detection', 'Price sanity check'],
    stock: ['Stock badge for large packs', 'Reserve stock for an order', 'Low stock warning'],
    deliveries: ['Choose a delivery slot', 'Delay notification', 'Partial delivery', 'Track a parcel'],
    labels: ['Print a label', 'Batch printing', 'Carrier name on the label'],
  };
  const modules = [];
  let serial = 700;
  for (const key of Object.keys(counts)) {
    const tests = [];
    const statuses = { Automated: 0, Test: 0, Open: 0, 'In Progress': 0, New: 0, Blocked: 0, Closed: 0, Cancelled: 0 };
    for (let i = 0; i < counts[key]; i++) {
      const status = pick(r, statusPool);
      statuses[status] += 1;
      serial += 1;
      const subj = subjects[key][i % subjects[key].length];
      const effort = pick(r, [10, 15, 20, 30, 45, null]);
      const t = {
        key: 'QA-' + serial, summary: subj + (i >= subjects[key].length ? ' - variant ' + (Math.floor(i / subjects[key].length) + 1) : ''), status,
        updated: '2026-09-' + String(int(r, 1, 29)).padStart(2, '0') + 'T10:00:00.000+0200',
        created: '2026-0' + int(r, 5, 8) + '-' + String(int(r, 10, 28)).padStart(2, '0') + 'T10:00:00.000+0200',
        estimate_seconds: effort ? effort * 60 : null, labels: [], manual_effort_min: effort,
        auto_exec_min: effort ? Math.max(1, Math.round(effort / 10)) : null, savings_min: effort ? effort - Math.max(1, Math.round(effort / 10)) : null,
      };
      if (status !== 'Closed') tests.push(t);
    }
    modules.push({ key, tests, statuses });
  }
  const runs = { orders: 7, checkout: 7, catalog: 7, stock: 6, deliveries: 7, labels: 5 };
  const finished = [];
  for (const m of modules) {
    const active = Object.entries(m.statuses).filter(([s]) => s !== 'Closed' && s !== 'Cancelled').reduce((s, [, v]) => s + v, 0);
    const automated = m.statuses.Automated;
    const lastRun = '2026-09-29T05:30:00.000+0200';
    for (const t of m.tests) {
      t.runs_7d = t.status === 'Automated' ? runs[m.key] : 0;
      t.last_run_at = t.status === 'Automated' ? lastRun : null;
      t.last_run_key = t.status === 'Automated' ? 'QA-RUN-' + (3000 + m.key.length) : null;
    }
    finished.push({
      key: m.key, label: labels[m.key], total: Object.values(m.statuses).reduce((s, v) => s + v, 0), active_total: active, automated,
      coverage_pct: Math.round((automated / active) * 10000) / 100, statuses: m.statuses, tests: m.tests, runs_7d: runs[m.key],
      executions_7d: runs[m.key] * automated, last_run_at: '2026-09-29T05:30:00.000+0200', last_run_key: 'QA-RUN-' + (3000 + m.key.length),
      manual_effort_min_total: m.tests.reduce((s, t) => s + (t.manual_effort_min || 0), 0),
      auto_exec_min_total: m.tests.reduce((s, t) => s + (t.auto_exec_min || 0), 0),
      savings_min_total: m.tests.reduce((s, t) => s + (t.savings_min || 0), 0),
    });
  }
  const sub = ['catalog', 'stock', 'deliveries', 'labels'].map((k) => finished.find((f) => f.key === k));
  const sumStatuses = {};
  for (const s of sub) for (const [k, v] of Object.entries(s.statuses)) sumStatuses[k] = (sumStatuses[k] || 0) + v;
  const whActive = sub.reduce((s, f) => s + f.active_total, 0);
  const whAuto = sub.reduce((s, f) => s + f.automated, 0);
  finished.push({
    key: 'warehouse', label: labels.warehouse, total: sub.reduce((s, f) => s + f.total, 0), active_total: whActive, automated: whAuto,
    coverage_pct: Math.round((whAuto / whActive) * 10000) / 100, statuses: sumStatuses, tests: [],
    runs_7d: sub.reduce((s, f) => s + f.runs_7d, 0), executions_7d: sub.reduce((s, f) => s + f.executions_7d, 0),
    last_run_at: '2026-09-29T05:30:00.000+0200', last_run_key: 'QA-RUN-3007',
    manual_effort_min_total: 0, auto_exec_min_total: 0, savings_min_total: 0,
  });
  const order = ['orders', 'checkout', 'warehouse', 'catalog', 'stock', 'deliveries', 'labels'];
  finished.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const shardToModule = {};
  for (const f of finished) {
    shardToModule[f.key] = f.key;
    w.json(dir + 'module-' + f.key + '.json', f);
  }
  const allActive = finished.filter((f) => f.key !== 'warehouse').reduce((s, f) => s + f.active_total, 0);
  const allAuto = finished.filter((f) => f.key !== 'warehouse').reduce((s, f) => s + f.automated, 0);
  const allTests = finished.flatMap((f) => f.tests);
  const est = (list) => {
    const withEst = list.filter((t) => (t.manual_effort_min || 0) > 0);
    const minutes = withEst.reduce((s, t) => s + t.manual_effort_min, 0);
    return { count: withEst.length, minutes, hours: Math.round(minutes / 6) / 10, md: Math.round(minutes / 48) / 10 };
  };
  const bugs = [
    ['ATL-4410', 'Order total not refreshed after quantity edit', 'Closed', 'QA-740'],
    ['BOR-4411', 'Coupon removed when changing address', 'Open', 'QA-760'],
    ['CMT-4412', 'Duplicate product after a re-import', 'Closed', 'QA-790'],
    ['DLT-4413', 'Slot picker ignores the cut-off time', 'In Progress', 'QA-820'],
    ['FAL-4414', 'Rate limit header missing on errors', 'Cancelled', 'QA-840'],
  ].map(([key, summary, status, ref], i) => ({ key, summary, status, labels: [], updated: '2026-09-' + String(10 + i * 3) + 'T09:00:00.000+0200', test_ref: ref }));
  w.json(dir + 'index.json', {
    meta: {
      generated_at: FIXED_NOW_LOCAL, shard_to_module: shardToModule,
      aggregates: {
        aggregate: { total: allTests.length + 12, active_total: allActive, automated: allAuto, coverage_pct: Math.round((allAuto / allActive) * 10000) / 100 },
        bugs_found: { total: bugs.length, closed: 2, cancelled: 1, list: bugs },
        estimates: { automated: est(allTests.filter((t) => t.status === 'Automated')), all: est(allTests) },
        test_runs: { meta: { window_days: 7, prefix: '[AUTO]' }, total_runs: 39, total_executions: 520 },
      },
      schema_version: 1, shard_count: finished.length, last_updated: FIXED_NOW,
    },
    keys: Object.keys(shardToModule).sort(),
  });
}

// -- Roadmap -----------------------------------------------------------------------------------------

function writeRoadmap(w, people, worklogs) {
  const r = rngFor('roadmap');
  const dtype = ['scope-gate-start', 'process-mapping', 'research-insights', 'goals-metrics', 'requirements-breakdown', 'workshops-alignment', 'architecture', 'mockups-prototypes', 'user-testing', 'refinements'];
  // The role each discovery task belongs to (the roadmap module's DISCOVERY_TASKS),
  // so a task lands on the person who holds that role on the initiative.
  const roleOf = {
    'scope-gate-start': 'po', 'process-mapping': 'analyst', 'research-insights': 'designer', 'goals-metrics': 'po',
    'requirements-breakdown': 'analyst', 'workshops-alignment': 'analyst', architecture: 'architect',
    'mockups-prototypes': 'designer', 'user-testing': 'designer', refinements: 'analyst',
  };
  // The roadmap's activity strip shows who logged time on each of the last
  // working days before "today" (the sample clock, 2026-09-30) and who has
  // work in progress today and tomorrow. Done tasks log a few days before
  // the discovery end; tasks in progress log most days of the last two weeks.
  const recentDays = eachDay(addDays(QUARTER_END, -16), addDays(QUARTER_END, -1)).filter((d) => !isWeekend(d));
  const spread = (secs, days) => {
    const out = {};
    const per = Math.max(1800, Math.round(secs / days.length / 1800) * 1800);
    for (const d of days) out[d] = per;
    return out;
  };
  const stageOrder = ['preparation', 'problem-space', 'solution-space', 'delivery', 'pilot', 'go-live'];
  const slipping = new Set(['NW-105', 'NW-111']);
  let rank = 0;
  for (const [title, ticket, squadId, stage, rag] of C.INITIATIVES) {
    rank += 1;
    const squad = C.SQUADS.find((s) => s.id === squadId);
    const members = people.filter((p) => p._squad === squadId);
    const po = members.find((p) => p.role === 'Product Owner') || members[0];
    const designer = people.find((p) => p.role === 'Designer' && p._squad === squadId) || people.find((p) => p.role === 'Designer');
    const engineers = members.filter((p) => p.role === 'Engineer');
    const eng = engineers[0];
    const architect = engineers[1] || engineers[0];
    const holder = { po, analyst: eng || po, designer: designer || po, architect: architect || po };
    const stageIdx = stageOrder.indexOf(stage);
    const done = stageOrder.slice(0, Math.max(0, stageIdx));
    const dayOffset = 20 + rank * 4;
    const discoveryEnd = addDays(QUARTER_START, dayOffset);
    const deliveryEnd = addDays(discoveryEnd, 56 + (rank % 4) * 7);
    const goLive = addDays(deliveryEnd, 14 + (slipping.has(ticket) ? -30 : 0));
    const nTasks = stageIdx >= 2 ? 6 : stageIdx >= 1 ? 4 : 2;
    const tasks = [];
    for (let t = 0; t < nTasks; t++) {
      const category = t < nTasks - 2 || stageIdx >= 3 ? 'done' : t === nTasks - 2 ? 'indeterminate' : 'new';
      const assignee = holder[roleOf[dtype[t]]]._name;
      const secs = category === 'new' ? 0 : int(r, 4, 40) * 3600;
      let days = [];
      if (category === 'done') {
        const end = addDays(discoveryEnd, -3 * (nTasks - 1 - t));
        days = eachDay(addDays(end, -6), end).filter((d) => !isWeekend(d) && d <= QUARTER_END).slice(-3);
      } else if (category === 'indeterminate') {
        days = recentDays.filter(() => r() < 0.75);
      }
      tasks.push({
        defId: dtype[t], key: 'NW-' + (200 + rank * 10 + t), summary: title + ': ' + dtype[t].replace(/-/g, ' '),
        statusName: category === 'done' ? 'Done' : category === 'indeterminate' ? 'In Progress' : 'To Do', statusCategory: category,
        assignee, timeByPerson: secs ? { [assignee]: secs } : {},
        timeByPersonByDay: secs && days.length ? { [assignee]: spread(secs, days) } : {},
      });
    }
    const initiative = {
      id: 'dt-' + hex(r, 8), title, ticket, rank, po: po._name, analyst: eng ? eng._name : '', designer: designer ? designer._name : '', architect: architect ? architect._name : '',
      ragStatus: slipping.has(ticket) ? 'red' : rag, stageStatus: done,
      discoveryEnd, deliveryEnd, goLiveDate: goLive, vmoName: null, appliesTo: squad.name, jiraTasks: tasks,
      comments: [],
      links: [{ title: 'Brief', url: 'https://wiki.example.com/northwind/' + ticket.toLowerCase() }],
    };
    if (slipping.has(ticket)) {
      initiative.comments.push({ author: po._name, date: '2026-09-02', text: 'Slipping: the go-live date moves by about three weeks. Needs one more engineer for two sprints.' });
    }
    if (ticket === 'NW-110') initiative.comments.push({ author: po._name, date: '2026-09-15', text: 'Depends on NW-109 (search relevance) shipping first.' });
    if (ticket === 'NW-108') initiative.comments.push({ author: po._name, date: '2026-09-10', text: 'Depends on NW-107 (delivery tracking) for the carrier data.' });
    w.json('discovery-tasks/' + initiative.id + '.json', initiative);
  }
  // logged-time file read by the roadmap view (pre-fetched worklogs, same shape as the Tempo file)
  void worklogs;
  w.json('discovery-tasks-tempo.json', { generated_at: FIXED_NOW, worklogs: {} });
}

function writeGantt(w, people) {
  const r = rngFor('gantt');
  const quarters = [
    { id: 'q3-2026', label: 'Q3 2026', monday: '2026-07-06', weeks: 13, weekFirstNo: 28, tasks: 'past' },
    { id: 'q4-2026', label: 'Q4 2026', monday: '2026-09-28', weeks: 14, weekFirstNo: 40, tasks: 'next' },
  ];
  const roster = people.map((p) => ({ id: p._slug, n: p._name, s: p.first_name, team: p.team, cap: 1 }));
  const areas = [
    { id: 'orders', name: 'Orders', color: 'blue', note: 'Atlas', o: 1 },
    { id: 'checkout', name: 'Checkout', color: 'green', note: 'Borealis', o: 2 },
    { id: 'catalog', name: 'Catalog', color: 'orange', note: 'Comet', o: 3 },
    { id: 'delivery', name: 'Delivery', color: 'purple', note: 'Delta', o: 4 },
    { id: 'search', name: 'Search', color: 'teal', note: 'Echo', o: 5 },
    { id: 'platform', name: 'Platform', color: 'gray', note: 'Falcon', o: 6 },
  ];
  const plan = {
    'q3-2026': [
      ['orders', 'Order editing pilot', 'atlas', 1, 5, [{ n: 'Build', s: 1, l: 3 }, { n: 'Pilot', s: 4, l: 2 }]],
      ['orders', 'Bulk order import', 'atlas', 5, 7, null],
      ['checkout', 'Three-step checkout', 'borealis', 1, 6, null],
      ['checkout', 'Release and stabilise', 'borealis', 7, 4, null],
      ['catalog', 'Catalog import pipeline', 'comet', 2, 11, [{ n: 'Parser', s: 2, l: 4 }, { n: 'Validation', s: 6, l: 4 }, { n: 'Preview', s: 10, l: 3 }]],
      ['delivery', 'Delivery tracking', 'delta', 1, 8, null],
      ['delivery', 'Carrier connectors', 'delta', 6, 6, null],
      ['search', 'Typo tolerance', 'echo', 1, 5, null],
      ['search', 'Saved filters', 'echo', 7, 6, null],
      ['platform', 'Public API v2', 'falcon', 1, 12, null],
      ['platform', 'Audit log', 'falcon', 9, 5, null],
    ],
    'q4-2026': [
      ['orders', 'Customer portal for returns', 'atlas', 1, 9, null],
      ['checkout', 'Payment terms rollout', 'borealis', 2, 6, null],
      ['catalog', 'Product variants', 'comet', 1, 8, null],
      ['delivery', 'Delivery slot booking', 'delta', 2, 8, null],
      ['search', 'Search analytics', 'echo', 3, 5, null],
      ['platform', 'Partner sandbox', 'falcon', 1, 7, null],
      ['platform', 'Audit log viewer', 'falcon', 8, 4, null],
    ],
  };
  w.json('gantt-roadmap/index.json', { activeQuarter: 'q3-2026', quarters: quarters.map((q) => q.id) });
  for (const q of quarters) {
    const sprints = q.id === 'q3-2026'
      ? sprintWindows().map((s) => ({ no: s.n, start: s.start, days: SPRINT_DAYS }))
      : [];
    w.json('gantt-roadmap/' + q.id + '/quarter.json', {
      id: q.id, label: q.label, mondayFirst: q.monday, weeksN: q.weeks, weekFirstNo: q.weekFirstNo, xmasWeek: null, sprints,
      teamOrder: C.SQUADS.map((s) => s.name), teamLabel: Object.fromEntries(C.SQUADS.map((s) => [s.name, s.name])), roster,
    });
    areas.forEach((a) => w.json('gantt-roadmap/' + q.id + '/areas/' + a.id + '.json', a));
    plan[q.id].forEach(([area, title, squadId, s, l, ph], i) => {
      const owners = people.filter((p) => p._squad === squadId).slice(0, 2).map((p) => p._slug);
      const uid = 't-' + hex(r, 16);
      const orderInArea = plan[q.id].filter(([a2], idx) => a2 === area && idx <= i).length;
      w.json('gantt-roadmap/' + q.id + '/tasks/' + uid + '.json', {
        uid, n: i + 1, a: area, o: orderInArea, t: title, who: owners, s, l, ph, gw: false, ms: false,
        createdAt: '2026-06-24T09:00:00.000Z', updatedAt: '2026-09-20T09:00:00.000Z', updatedBy: null,
      });
    });
    const backlog = q.id === 'q3-2026' ? ['Seasonal order templates', 'Supplier self-service import'] : ['Returns analytics', 'Carrier cost comparison', 'Mobile order approval'];
    backlog.forEach((t) => {
      const uid = 'bl-' + hex(r, 12);
      w.json('gantt-roadmap/' + q.id + '/backlog/' + uid + '.json', { uid, t, createdAt: '2026-06-24T09:00:00.000Z', updatedAt: '2026-09-20T09:00:00.000Z' });
    });
  }
}

// -- On-call ---------------------------------------------------------------------------------------------

function writeOnCall(w, people) {
  const r = rngFor('on-call');
  const { buildShards } = mod('on-call', 'build.js');
  const engineers = people.filter((p) => p.role === 'Engineer');
  const roster = engineers.map((p, i) => ({
    name: p._name, person_slug: p._slug, emails: [p.email], phone: '+1 555 01' + String(10 + i).padStart(2, '0'),
    company: 'Northwind', role: i % 4 === 0 ? 'DEVOPS' : 'BE',
    scopes: { inventory: i % 3 === 0, orders: i % 2 === 0, platform: i % 4 !== 3 },
  }));
  const coordination = [
    { name: 'Hannah Weiss', email: 'hannah.weiss@' + C.DOMAIN, phone: '+15550190', phone_display: '+1 555 0190', note: '' },
    { name: 'Amara Diallo', email: 'amara.diallo@' + C.DOMAIN, phone: '+15550191', phone_display: '+1 555 0191', note: 'or Teams call' },
  ];
  const hours = [
    { system: 'Inventory', days: 'Monday to Friday', hours: ['06:00-22:00'], scope: 'Incidents and failed imports' },
    { system: 'Orders', days: 'Monday to Sunday', hours: ['00:00-24:00'], scope: 'Orders cannot be placed or edited' },
    { system: 'Platform', days: 'Monday to Sunday', hours: ['00:00-24:00'], scope: 'API gateway and background jobs' },
  ];
  const columns = ['inventory', 'orders', 'platform', 'devops'];
  const entries = [];
  const days = eachDay(QUARTER_START, QUARTER_END);
  const weekOf = (d) => Math.floor(daysBetween(QUARTER_START, d) / 7);
  const eligible = (col) => roster.filter((p) => (col === 'devops' ? p.role === 'DEVOPS' || p.scopes.platform : p.scopes[col]));
  for (const day of days) {
    columns.forEach((col, ci) => {
      const list = eligible(col);
      let person = list[(weekOf(day) + ci) % list.length];
      let note = '';
      // the one swap: in the week of 2026-08-17 the orders duty changes hands for two days
      if (col === 'orders' && (day === '2026-08-19' || day === '2026-08-20')) {
        const other = list[(weekOf(day) + ci + 1) % list.length];
        note = 'swap with ' + person.name;
        person = other;
      }
      entries.push({
        date: day, weekday: WEEKDAYS[dayOfWeek(day)], column: col, person_raw: person.name, person: person.name,
        person_slug: person.person_slug, matched: true, note,
      });
    });
  }
  void r;
  const meta = {
    generated_at: FIXED_NOW, source_url: 'https://wiki.example.com/northwind/on-call', source_page_id: '100000', source_version: 12,
    source_updated: '2026-09-29T15:00:00.000Z', source_title: 'On-call schedule',
  };
  const built = buildShards({ roster, coordination, hours, entries, warnings: [] }, meta, null);
  if (built.error) throw new Error('on-call: ' + built.message);
  for (const ym of Object.keys(built.months)) w.json('on-call/months/' + ym + '.json', built.months[ym]);
  w.json('on-call/index.json', { ...built.index, months: Object.keys(built.months).sort() });
}

// -- Sprint review and sprint planning -------------------------------------------------------------------------

function writeSprintReview(w, facts, people) {
  const session = mod('sprint-review', 'session.js');
  const store = mod('sprint-review', 'store.js');
  const r = rngFor('sprint-review');
  const rb = bytesFrom(r);
  const ctx = { dataTier0Dir: w.root, log() {} };
  const teams = C.SQUADS.map((s) => s.name);
  sprintWindows().forEach((win) => {
    const goals = {
      sprintN: win.n, sprintName: 'Sprint ' + win.n,
      teamGoals: C.SQUADS.map((s) => ({ team: s.name, goal: s.goals[win.i], sprint_name: s.name + ' Sprint ' + win.n })),
    };
    const reviewDate = win.next;
    const s0 = session.buildNewSession({
      reviewDate, facilitatorPo: 'Alex Morgan', sprintGoals: goals, now: () => new Date(reviewDate + 'T08:00:00.000Z'), randomBytes: rb,
    });
    let cur = { ...s0, updatedAt: reviewDate + 'T15:00:00.000Z', cardsSentAt: reviewDate + 'T09:30:00.000Z' };
    for (const team of teams) {
      const fact = facts.find((f) => f.squad.name === team && f.win.i === win.i);
      const status = fact.factor >= 0.85 ? 'achieved' : fact.factor >= 0.65 ? 'partial' : 'not-achieved';
      const presenters = people.filter((p) => p.team === team).slice(0, 2).map((p) => p._name);
      const topic = () => ({ title: pick(r, C.REVIEW_TOPICS), format: pick(r, ['presentation', 'discussion']), presenters: [pick(r, presenters)] });
      const patch = { realizationStatus: status, submitted: true };
      for (const key of session.topicListKeysFor(team)) patch[key] = [topic(), topic()];
      const res = session.applyTeamPatch(cur, team, patch, rb);
      if (res.error) throw new Error('sprint-review: ' + res.message);
      cur = res.session;
    }
    store.writeSession(ctx, cur);
  });
}

function writeSprintPlanning(w, facts, people, timeOff) {
  const plan = require(modulePath('sprint-planning', 'server', 'plan.js'));
  const store = require(modulePath('sprint-planning', 'server', 'store.js'));
  const r = rngFor('sprint-planning');
  const ctx = { dataTier0Dir: w.root, log() {} };
  const teamsForPlanning = ['atlas', 'borealis', 'comet', 'delta'];
  const settings = { schema_version: 1, updatedAt: FIXED_NOW, teams: {} };
  for (const id of teamsForPlanning) settings.teams[id] = { sprintWeeks: 2, firstSprintN: SPRINT_FIRST, firstSprintStart: QUARTER_START };
  store.writeSettings(ctx, settings);
  const engineers = (squadId) => people.filter((p) => p._squad === squadId && p.role === 'Engineer');
  for (const win of sprintWindows().slice(2)) {
    for (const id of teamsForPlanning) {
      const squad = C.SQUADS.find((s) => s.id === id);
      const stamp = addDays(win.start, -1) + 'T10:00:00.000Z';
      const p0 = plan.buildNewPlan({ team: id, sprintN: win.n, dateFrom: win.start, dateTo: win.next, now: new Date(stamp) });
      p0.datesSource = 'computed';
      const eng = engineers(id);
      const fact = facts.find((f) => f.squad.id === id && f.win.i === win.i);
      const absences = people.filter((p) => p._squad === id).flatMap((p) => (timeOff.get(p._slug) || [])
        .filter(([a, b]) => a <= win.end && b >= win.start)
        .map(([a, b]) => ({ person: p._name, dateFrom: a < win.start ? win.start : a, dateTo: b > win.end ? win.end : b, reason: 'Holiday' })));
      const sections = {
        oncall: { done: true, dev: eng[0] ? eng[0]._name : '', devops: eng[1] ? eng[1]._name : '', note: '' },
        capacity: {
          done: true, peopleOverride: null, extraDaysOff: win.i === 3 ? 1 : 0,
          events: win.i === 3 ? [{ text: 'Release on the first day of the sprint' }] : [{ text: 'Quarter review on the last day' }],
          dependencies: id === 'delta' ? [{ text: 'Carrier test accounts from the vendor' }] : [],
        },
        absences: { done: true, manual: absences },
        velocity: { done: true, override: null, note: 'Average of the last three sprints' },
        refinements: {
          done: true, items: fact.issues.slice(0, 2).map((x) => ({ key: x.key, topic: x.summary, note: '' })),
          cross: id === 'atlas' && win.i === 4 ? [{ key: 'ATL-190', teams: ['atlas', 'borealis'], note: 'Shared order summary component' }] : [],
        },
        goal: { done: true, goal: squad.goals[win.i] },
        jira: { done: win.i < 5 },
      };
      const res = plan.applyPlanPatch(p0, { sections }, new Date(stamp), bytesFrom(r));
      if (res.error) throw new Error('sprint-planning: ' + res.error);
      store.writePlan(ctx, res.plan);
    }
  }
}

// -- Meetings and knowledge base ----------------------------------------------------------------------------------

function writeMeetings(w) {
  const r = rngFor('meetings');
  w.json('meeting-archive/_categories.json', { categories: C.MEETING_CATEGORIES });
  w.json('meeting-archive/_folder-tree.json', { folders: C.MEETING_FOLDERS });
  for (const m of C.MEETINGS) {
    const dir = 'meeting-archive/' + m.folder + '/';
    w.json(dir + 'metadata.json', {
      status: 'ok', processed_at: m.date + 'T18:00:00.000Z', meeting_date: m.date, duration_sec: m.minutes * 60,
      has_transcript: !!m.transcript, source_transcript: m.transcript ? m.folder + '.vtt' : null, source_file: m.folder + '.mp4',
    });
    w.json(dir + 'meeting-info.json', {
      title: m.title, brief: m.brief,
      participants: m.people.map((name) => ({ name, member_id: null })),
    });
    w.json(dir + 'meeting-user-meta.json', { categories: [m.category], virtual_folder_id: m.folderId, meeting_date: m.date });
    w.text(dir + 'summary.md', m.summary.join('\n') + '\n');
    if (m.transcript) {
      let t = 5;
      const segments = [];
      for (const [speaker, text] of m.lines) {
        segments.push({ speaker_id: speaker, start: t, end: t + 20, text });
        t += int(r, 24, 70);
      }
      w.json(dir + 'transcript.json', { segments });
    }
    if (m.html) {
      w.text(dir + 'summary.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + m.title
        + '</title></head><body><h1>' + m.title + '</h1><p>' + m.brief + '</p></body></html>\n');
    }
  }
}

function writeKnowledgeBase(w) {
  const areas = C.SQUADS.map((s) => ({ slug: s.kb, label: s.focus, subareas: [] }));
  w.json('knowledge-base/knowledge-base-areas.json', { areas });
  for (const d of C.DOCS) {
    const front = [
      '---', 'title: "' + d.title + '"', 'date: ' + d.date, 'author: ' + d.author, 'type: ' + d.type, 'status: final',
      'summary: "' + d.summary + '"', '---', '',
    ];
    w.text('knowledge-base/' + d.area + '/' + d.category + '/' + d.slug + '.md', front.concat(d.body).join('\n') + '\n');
  }
  w.text('knowledge-base/checkout/data-analysis/checkout-drop-off.html',
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Where buyers leave the checkout</title></head><body>'
    + '<h1>Where buyers leave the checkout</h1><p>Of 1,000 buyers who start checkout, 720 finish.</p></body></html>\n');
}

// -- Responsibilities, onboarding -----------------------------------------------------------------------------------------

function writeResponsibilities(w) {
  const r = rngFor('responsibilities');
  const months = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
  const past = months.slice(0, 3);
  const build = (groups) => ({
    meta: { last_updated: FIXED_NOW },
    months,
    groups: groups.map((g, gi) => ({
      id: 'grp-' + hex(r, 8), name: g.name,
      areas: g.areas.map(([name, description, owner], ai) => {
        const ratings = {};
        let state = pick(r, ['green', 'green', 'amber']);
        past.forEach((m) => {
          if (r() < 0.35) state = pick(r, ['green', 'amber', 'red']);
          ratings[m] = {
            status: state, actions: state === 'red' ? 'Owner and deputy agreed a plan for the next two weeks.' : (state === 'amber' ? 'Watching it, review next month.' : null),
            updated_at: m + '-28T10:00:00.000Z',
          };
        });
        void gi; void ai;
        return { id: 'area-' + hex(r, 8), name, description, owner, ratings };
      }),
    })),
  });
  w.json('responsibilities/main.json', build(C.RESPONSIBILITY_GROUPS));
  w.json('responsibilities/web.json', build([{ name: 'Web', areas: [['Browser support', 'Which browsers we test and fix.', 'Jordan Lee'], ['Accessibility', 'Keyboard use, contrast and screen readers.', 'Aiko Tanaka']] }]));
  w.json('responsibilities/mobile.json', build([{ name: 'Mobile', areas: [['App releases', 'Store submissions and phased rollouts.', 'Yuki Sato'], ['Offline mode', 'What works without a connection.', 'Sam Rivera']] }]));
  w.json('responsibilities/platform.json', build([{ name: 'Platform', areas: [['API stability', 'Uptime and error budgets.', 'Felix Moreau'], ['Security reviews', 'Dependency audits and access reviews.', 'Chloe Dubois']] }]));
}

function writeOnboarding(w) {
  w.json('onboarding/links.json', {
    links: C.ONBOARDING_LINKS.map(([title, url, description], i) => ({ id: 'link-' + (1000 + i), title, url, description })),
    generated_at: FIXED_NOW,
  });
  const rows = C.ONBOARDING_ROWS.map(([topic, description, who, when]) => ({ topic, description, who, when }));
  w.json('onboarding/template.json', {
    id: 'default', name: 'Two-week plan', slug: 'default', rows, created_at: '2026-07-01T09:00:00.000Z', generated_at: FIXED_NOW,
  });
  w.json('onboarding/people/ravi-desai.json', {
    id: 'plan-1789000000001', name: 'Ravi Desai', slug: 'ravi-desai',
    rows: rows.map((row, i) => ({ ...row, done: i < 5 })), created_at: '2026-09-14T09:00:00.000Z', generated_at: '2026-09-25T09:00:00.000Z',
  });
}

// -- Vendor settlements -------------------------------------------------------------------------------------------------------

function writeVendorSettlements(w) {
  const r = rngFor('vendors');
  const months = ['2026-07', '2026-08', '2026-09'];
  const lastDay = { '2026-07': '2026-07-31', '2026-08': '2026-08-31', '2026-09': '2026-09-30' };
  const assignments = [];
  const protocols = { atlas: [], borealis: [] };
  const orders = { atlas: { vendors: [] }, borealis: { vendors: [] } };
  const poPool = [];
  for (const v of C.VENDORS) {
    poPool.push({ po_number: v.po, vendor: v.name, title: v.poName, amount: v.poAmount, area: C.SQUADS.find((s) => s.id === v.squad).area });
    const project = v.squad === 'borealis' ? 'borealis' : 'atlas';
    orders[project].vendors.push({ po_number: v.po, name: v.name });
    months.forEach((m, mi) => {
      const days = [21, 22, 21][mi];
      const amount = v.rate * days * (v.name === 'Globex' ? 1 : 2) - mi * 800;
      const id = 'st-' + hex(r, 8);
      const prId = 'pr-' + hex(r, 8);
      const accepted = !(v.name === 'Initech' && m === '2026-08') && !(m === '2026-09');
      const overdue = v.name === 'Initech' && m === '2026-08';
      assignments.push({
        id, area: C.SQUADS.find((s) => s.id === v.squad).area, title: v.poName + ' - ' + m, period_from: m + '-01', period_to: lastDay[m],
        vendor: v.name, mode: 'persons', items: [v.person], amount, amount_full: amount, po_number: v.po, po_name: v.poName,
        protocol_link: 'https://wiki.example.com/northwind/protocols/' + prId, accepted_at: accepted ? addDays(lastDay[m], 5) + 'T10:00:00.000Z' : null,
        created_at: addDays(lastDay[m], 1) + 'T09:00:00.000Z', updated_at: addDays(lastDay[m], accepted ? 5 : 1) + 'T10:00:00.000Z', protocol_id: prId,
      });
      protocols[project].push({
        id: prId, po_number: v.po, protocol_number: v.poName + ' - ' + m, vendor: v.name, amount,
        protocol_link: 'https://wiki.example.com/northwind/protocols/' + prId, invoice_number: accepted || overdue ? 'INV-' + v.name.slice(0, 3).toUpperCase() + '-' + m.replace('-', '') : '',
        accepted_on: accepted ? addDays(lastDay[m], 5) : null, status: accepted ? 'accepted' : overdue ? 'overdue' : 'new', status_manual: false,
        created_on: lastDay[m] < QUARTER_END ? addDays(lastDay[m], 1) : QUARTER_END, settlement_month: m, updated_at: addDays(lastDay[m], accepted ? 5 : 1) + 'T10:00:00.000Z',
      });
    });
  }
  w.json('vendor-settlements/summary.json', { meta: { last_updated: FIXED_NOW, total_assignments: assignments.length }, assignments });
  for (const p of Object.keys(protocols)) {
    w.json('vendor-settlements/protocols-' + p + '.json', {
      meta: { last_updated: FIXED_NOW, total_orders: orders[p].vendors.length }, protocols: protocols[p], orders: [orders[p]],
    });
  }
  w.json('vendor-settlements/vendor-info.json', {
    meta: { last_updated: FIXED_NOW },
    vendors: C.VENDORS.map((v) => ({ name: v.name, full_name: v.full_name, address: v.address, tax_id: v.tax_id, registry_no: v.registry_no })),
  });
  w.json('vendor-settlements/purchase-orders.json', { orders: poPool });
}

// -- Locations and rollout waves ----------------------------------------------------------------------------------------------------

function buildSites() {
  const r = rngFor('locations');
  const sites = [];
  const streets = ['High Street', 'Market Square', 'Station Road', 'Mill Lane', 'Park Avenue', 'Harbour Way', 'Church Road', 'Green Street'];
  const statusFor = (i) => (i === 7 ? 'Temporarily closed' : i === 19 ? 'Contract signed' : i === 26 ? 'Handover' : i === 29 ? 'Closed' : 'Open');
  let serial = 0;
  for (const region of C.LOCATION_REGIONS) {
    region.cities.forEach((city, ci) => {
      serial += 1;
      const code = region.prefix + String(100 + ci * 7 + serial).padStart(3, '0');
      const manager = C.SITE_MANAGERS[(serial + ci) % C.SITE_MANAGERS.length];
      sites.push({
        code, name: 'Northwind Partner ' + city, status: statusFor(serial - 1), city,
        postal_code: String(10000 + int(r, 100, 899)), street: int(r, 1, 120) + ' ' + pick(r, streets), region: region.name,
        area: region.name + ' ' + (ci < 3 ? 'A' : 'B'), district: 'District ' + (1 + (serial % 5)), operator: ci % 5 === 4 ? '' : 'Operator ' + String.fromCharCode(65 + (serial % 6)),
        manager: serial % 9 === 0 ? '' : manager, partner: pick(r, ['', '', 'Partner Blue', 'Partner Green']),
        groups: ci % 2 === 0 ? ['Pilot'] : ['Standard'], phone: '+1 555 02' + String(serial).padStart(2, '0'),
        email: 'site.' + code.toLowerCase() + '@' + C.DOMAIN, opened_at: addDays(QUARTER_START, int(r, 0, 88)), sales_area_m2: int(r, 120, 480),
        latitude: Math.round((40 + serial * 0.37) * 1000) / 1000, longitude: Math.round((-70 + serial * 0.52) * 1000) / 1000,
      });
    });
  }
  return sites;
}

function writeLocations(w, sites) {
  const imp = mod('locations', 'locations-import.js');
  const payloads = imp.buildPayloads(sites, [], { sourceFile: 'sample-sites.csv', nowIso: FIXED_NOW, sourceModIso: '2026-09-28T12:00:00.000Z' });
  w.json('locations/locations.json', payloads.full);
  w.json('locations/locations.index.json', payloads.index);
}

function writeRolloutWaves(w, sites) {
  const core = mod('rollout-waves', 'rollout-core.js');
  const store = mod('rollout-waves', 'shard-store.js');
  // managers -> wave: every manager name that occurs, spread over four waves
  const managers = {};
  const keys = [];
  for (const s of sites) {
    const key = core.managerKeyFor(s) || (s.area ? 'Vacant ' + s.area : '');
    if (key && !keys.includes(key)) keys.push(key);
  }
  keys.sort().forEach((k, i) => { managers[k] = (i % 4) + 1; });
  w.json('rollout-waves/waves-config.json', { first_wave_start: '2026-09-14', waves_count: 4, managers });
  const eligible = sites.filter((s) => s.status === 'Open');
  const known = new Set(sites.map((s) => s.code));
  const doneTraining = eligible.filter((_, i) => i % 2 === 0).map((s) => s.code);
  const doneWebinar = eligible.filter((_, i) => i % 3 !== 2).map((s) => s.code);
  for (const [dir, codes] of [['training-done', doneTraining], ['webinar-done', doneWebinar]]) {
    const merged = core.mergeDoneCodes({}, codes, known, '2026-09-24T10:00:00.000Z', 'xlsx');
    const byPrefix = new Map();
    for (const prefix of merged.touchedPrefixes) {
      const stores = {};
      for (const code of Object.keys(merged.stores)) if (store.prefixOf(code) === prefix) stores[code] = merged.stores[code];
      byPrefix.set(prefix, { stores });
    }
    const shards = {};
    for (const [prefix, payload] of [...byPrefix.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      shards[prefix] = Object.keys(payload.stores).length;
      w.json('rollout-waves/' + dir + '/' + prefix + '.json', payload);
    }
    w.json('rollout-waves/' + dir + '/index.json', {
      dataset: dir, updated_at: '2026-09-24T10:00:00.000Z', total: Object.values(shards).reduce((s, n) => s + n, 0), shards,
    });
  }
}

// -- Usage analytics ----------------------------------------------------------------------------------------------------------------------

function writeUsageAnalytics(w, people) {
  const aggregate = mod('usage-analytics', 'aggregate.js').aggregate;
  const r = rngFor('usage');
  const { isPlHoliday } = mod('time-log', 'calendar.js');
  // the module dictionary comes from the catalog manifests
  const catalog = path.join(ROOT, 'catalog', 'modules');
  const modulesDict = {};
  for (const id of fs.readdirSync(catalog).sort()) {
    const m = JSON.parse(fs.readFileSync(path.join(catalog, id, 'module.json'), 'utf8'));
    modulesDict[m.id] = { name: m.name || m.id, views: (m.views || []).map((v) => ({ id: v.id, label: v.label || v.id })) };
  }
  const viewPool = [
    ['dashboard', 8, 'Dashboard'], ['sprint-stats-main', 5, 'Sprint stats'], ['prod-bugs-main', 3, 'Production bugs'], ['roadmap-main', 3, 'Roadmap'],
    ['time-log-main', 4, 'Time log'], ['on-call-main', 2, 'On-call'], ['time-off-main', 2, 'Time off'], ['knowledge-base-main', 3, 'Knowledge base'],
    ['meeting-archive-main', 2, 'Meeting archive'], ['team-directory-main', 2, 'Team directory'], ['settings', 1, 'Settings'],
  ].filter(([id]) => id === 'dashboard' || id === 'settings' || Object.values(modulesDict).some((m) => m.views.some((v) => v.id === id)));
  const total = viewPool.reduce((s, v) => s + v[1], 0);
  const pickView = () => {
    let x = r() * total;
    for (const v of viewPool) { x -= v[1]; if (x <= 0) return v; }
    return viewPool[0];
  };
  const events = [];
  let sessionId = 1790000000;
  for (const day of eachDay(QUARTER_START, addDays(QUARTER_END, -1))) {
    if (isWeekend(day) || isPlHoliday(day)) continue;
    // adoption grows over the quarter
    const progress = daysBetween(QUARTER_START, day) / 90;
    for (const p of people) {
      if (r() > 0.45 + progress * 0.4) continue;
      sessionId += 1;
      let minute = int(r, 480, 600);
      const views = int(r, 3, 9);
      const version = progress < 0.4 ? '0.9.4' : '0.9.5';
      for (let i = 0; i < views; i++) {
        const v = pickView();
        const hh = String(Math.floor(minute / 60)).padStart(2, '0');
        const mm = String(minute % 60).padStart(2, '0');
        const t = day + ' ' + hh + ':' + mm + ':00';
        const props = { base_view: v[0], view: v[0], view_title: v[2], app_version: version, app_hash: version === '0.9.4' ? 'a1b2c3d' : 'e4f5a6b' };
        events.push({ t, e: 'View Viewed', u: p.email, s: sessionId, p: props, up: { full_name: p._name } });
        const dur = int(r, 8000, 240000);
        events.push({ t: day + ' ' + hh + ':' + mm + ':59', e: 'View Exited', u: p.email, s: sessionId, p: { ...props, duration_ms: dur } });
        minute += Math.max(1, Math.round(dur / 60000)) + int(r, 0, 3);
      }
    }
  }
  const data = aggregate(events, {
    today: QUARTER_END, modulesDict, now: FIXED_NOW,
    members: people.map((p) => ({ first_name: p.first_name, last_name: p.last_name, email: p.email })),
  });
  w.json('usage-analytics/aggregated.json', data);
}

// -- Demo hub -------------------------------------------------------------------------------------------------------------------------------

function writeDemoHub(w) {
  w.text('demo-hub/note.md', [
    '---', 'author: Alex Morgan', 'person_slug: alex-morgan', 'source: sample-team', 'date: 2026-09-30', '---', '',
    'Welcome to the Northwind Product sample team.', '',
    'This note is only here to show the sync test hub: edit it, save it, and the change would be',
    'sent to the team at the next sync. In sample mode nothing is ever sent.', '',
  ].join('\n'));
}

// -- Main -------------------------------------------------------------------------------------------------------------------------------------------

// -- Academy ---------------------------------------------------------------------------------------

// One progress file per person, the shape the server's /api/cocreate/* writes
// (academy/progress/<person_slug>.json), so the Academy's "finished stage"
// rows show faces. Stage and step ids come from the one list the view and the
// server read. Most of the team finished stage 1, fewer each stage after it.
const ACADEMY_REACH = [4, 3, 2, 4, 1, 3, 2, 1, 4, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 1, 0, 2, 1, 0];
const ACADEMY_MURAL = [
  ['alex-morgan', 'What I built', 'A release calendar for Atlas. It took one sentence and two rounds of feedback.'],
  ['sam-rivera', 'What surprised me', 'The plan came before the code, and reading it caught a wrong idea early.'],
  ['grace-whitfield', 'A tip for the next person', 'Describe the screen the way you would to a colleague, not as a spec.'],
  ['kofi-mensah', 'What I built', 'A page that shows which carrier is late today, from the data we already had.'],
];

function writeAcademy(w, people) {
  const { STAGES } = require('../js/academy-stages.mjs');
  const r = rngFor('academy');
  people.forEach((p, i) => {
    const reach = ACADEMY_REACH[i % ACADEMY_REACH.length];
    const doc = { version: 1, person_slug: p._slug, display_name: p._name, unlocks: {}, steps: {}, completed: {} };
    let at = addDays(QUARTER_START, 3 + (i % 9) * 2);
    STAGES.forEach((stage, si) => {
      if (si > reach) return;
      doc.unlocks[stage.id] = at + 'T09:00:00.000Z';
      const finished = si < reach;
      // The stage after the last finished one is under way: about half its steps.
      const steps = finished ? stage.steps : stage.steps.slice(0, Math.floor(stage.steps.length / 2));
      if (steps.length === 0 && !finished) { delete doc.unlocks[stage.id]; return; }
      doc.steps[stage.id] = {};
      steps.forEach((step, k) => {
        doc.steps[stage.id][step.id] = {
          checked_at: addDays(at, Math.floor(k / 2)) + 'T' + String(10 + (k % 6)).padStart(2, '0') + ':' + String(int(r, 0, 5) * 10).padStart(2, '0') + ':00.000Z',
          method: (step.check && step.check.type) || 'self-attest',
        };
      });
      if (finished) doc.completed[stage.id] = addDays(at, Math.floor(stage.steps.length / 2)) + 'T16:00:00.000Z';
      at = addDays(at, 6 + int(r, 0, 6));
    });
    if (Object.keys(doc.unlocks).length > 0) w.json('academy/progress/' + p._slug + '.json', doc);
  });
  for (const [slug, heading, text] of ACADEMY_MURAL) {
    const p = people.find((x) => x._slug === slug);
    if (!p) throw new Error('sample-team: the academy mural names ' + slug + ', who is not on the team');
    w.text('academy/mural/' + slug + '.md', ['---', 'author: ' + p._name, 'person_slug: ' + slug, 'date: 2026-09-' + String(10 + ACADEMY_MURAL.findIndex((m) => m[0] === slug) * 4), '---', '', '## ' + heading, '', '- ' + text, ''].join('\n'));
  }
}

function generate(outDir) {
  const out = path.resolve(outDir || DEFAULT_OUT);
  const target = path.join(out, 'ds-data');
  if (path.basename(target) !== 'ds-data') throw new Error('sample-team: refusing to clear ' + target);
  fs.rmSync(target, { recursive: true, force: true });
  const w = makeWriter(out);
  fs.mkdirSync(w.root, { recursive: true });

  const people = buildPeople();
  const timeOff = buildTimeOff(people);
  const facts = buildSprintFacts(people, timeOff);
  const { worklogs, issueDetails } = buildWorklogs(people, facts, timeOff);
  const sites = buildSites();

  writeTeam(w, people);
  writeSprintStats(w, facts);
  writeTimeOff(w, people, timeOff);
  writeTimeLog(w, people, worklogs);
  writeCosts(w, people, worklogs, issueDetails);
  writeProdBugs(w);
  writeDevops(w, people);
  writeQa(w);
  writeRoadmap(w, people, worklogs);
  writeGantt(w, people);
  writeOnCall(w, people);
  writeSprintReview(w, facts, people);
  writeSprintPlanning(w, facts, people, timeOff);
  writeMeetings(w);
  writeKnowledgeBase(w);
  writeResponsibilities(w);
  writeOnboarding(w);
  writeVendorSettlements(w);
  writeLocations(w, sites);
  writeRolloutWaves(w, sites);
  writeUsageAnalytics(w, people);
  writeDemoHub(w);
  writeAcademy(w, people);
  return { out: w.root, people: people.length };
}

function parseArgs(argv) {
  const args = { out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) { args.out = argv[i + 1]; i += 1; continue; }
    if (argv[i] === '--help' || argv[i] === '-h') { args.help = true; continue; }
    throw new Error('unknown argument: ' + argv[i]);
  }
  return args;
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (args.help) {
    console.log('Usage: node scripts/sample-team.js [--out <dir>]\nWrites <dir>/ds-data/ (default: examples/sample-team).');
    return;
  }
  const res = generate(args.out);
  console.log('Sample team written to ' + res.out + ' (' + res.people + ' people).');
}

if (require.main === module) main();

module.exports = { generate, QUARTER_START, QUARTER_END, FIXED_NOW, DEFAULT_OUT };
