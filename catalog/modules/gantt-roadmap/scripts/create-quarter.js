'use strict';
// modules/gantt-roadmap/scripts/create-quarter.js
// Creates a new, empty quarter of the Gantt roadmap (the browser never creates
// one). Optionally fills it with a small synthetic example (--example).
//
// Usage:
//   node modules/gantt-roadmap/scripts/create-quarter.js --id q1-2027 \
//     --monday 2026-12-28 --weeks 13 [--label "Q1 2027"] [--example] [--target <dir>]
//
// --id      quarter id, q<1-4>-<year>
// --monday  ISO date of the Monday the first week starts on
// --weeks   number of weeks (1-26)
// --label   display label (default derived from the id, e.g. "Q1 2027")
// --example add an example roster, areas, tasks and backlog items (synthetic)
// --target  the gantt-roadmap/ directory to write (default: the team data repo)
//
// Refuses to touch a quarter that already has task shards. Never creates the
// team data plaintext directory itself: pull the Team data source first.
// NEVER runs git inside data-sub-repositories/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const out = { example: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--example') { out.example = true; continue; }
    if (['--id', '--monday', '--weeks', '--label', '--target'].includes(a) && argv[i + 1] !== undefined) {
      out[a.slice(2)] = argv[i + 1];
      i++;
      continue;
    }
    throw new Error('unknown argument: ' + a);
  }
  return out;
}

function fail(msg, code) {
  console.error(msg);
  process.exit(code);
}

function isoWeekNo(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function uid(prefix, len) {
  return prefix + crypto.randomBytes(len / 2).toString('hex');
}

const EXAMPLE_ROSTER = [
  { id: 'alex-morgan', n: 'Alex Morgan', s: 'Alex', team: 'Atlas', cap: 1 },
  { id: 'sam-rivera', n: 'Sam Rivera', s: 'Sam', team: 'Atlas', cap: 1 },
  { id: 'jordan-lee', n: 'Jordan Lee', s: 'Jordan', team: 'Borealis', cap: 1 },
  { id: 'taylor-kim', n: 'Taylor Kim', s: 'Taylor', team: 'Comet', cap: 2 },
];
const EXAMPLE_AREAS = [
  { id: 'forecasting', name: 'Forecasting', color: 'blue', note: 'Demand models and their monitoring', o: 1 },
  { id: 'platform', name: 'Platform', color: 'green', note: '', o: 2 },
  { id: 'other', name: 'Other', color: 'gray', note: '', o: 3 },
];
const EXAMPLE_TASKS = [
  { n: 1, a: 'forecasting', o: 1, t: 'Model monitoring', who: ['alex-morgan'], s: 1, l: 4, ph: [{ n: 'Baseline metrics', s: 1, l: 2 }, { n: 'Drift alerts', s: 3, l: 2 }] },
  { n: 2, a: 'forecasting', o: 2, t: 'Feature engineering', who: ['sam-rivera', 'alex-morgan'], s: 5, l: 5, ph: null },
  { n: 3, a: 'platform', o: 1, t: 'Test environment for the data pipeline', who: ['jordan-lee'], s: 2, l: 6, ph: null },
  { n: 4, a: 'other', o: 1, t: 'KPI review', who: ['taylor-kim'], s: 4, l: 3, ph: null },
];
const EXAMPLE_BACKLOG = ['Seasonal locations', 'New product forecasts', 'Research: what can we improve'];

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message, 2); }
  const id = String(args.id || '');
  if (!/^q[1-4]-\d{4}$/.test(id)) fail('--id must look like q1-2027', 2);
  const monday = String(args.monday || '');
  const md = new Date(monday + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday) || Number.isNaN(md.getTime()) || md.getUTCDay() !== 1) fail('--monday must be the ISO date of a Monday', 2);
  const weeks = Number(args.weeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) fail('--weeks must be a whole number from 1 to 26', 2);

  let target = args.target ? path.resolve(args.target) : null;
  if (!target) {
    const appRoot = path.resolve(__dirname, '..', '..', '..');
    const base = process.env.DATA_SUB_REPOS_DIR ? path.resolve(process.env.DATA_SUB_REPOS_DIR) : path.join(appRoot, 'data-sub-repositories');
    const teamData = path.join(base, 'ds-data');
    if (!fs.existsSync(teamData)) fail('The team data repository is not downloaded: ' + teamData + '\nPull the Team data source in the Sync window and run the script again.', 2);
    target = path.join(teamData, 'gantt-roadmap');
  }

  const qDir = path.join(target, id);
  const tasksDir = path.join(qDir, 'tasks');
  if (fs.existsSync(tasksDir) && fs.readdirSync(tasksDir).some((f) => f.startsWith('t-'))) {
    fail('Refused: ' + tasksDir + ' already holds tasks; nothing was changed.', 1);
  }

  const indexFile = path.join(target, 'index.json');
  let index = { activeQuarter: id, quarters: [] };
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { /* new index */ }
  const quarters = Array.isArray(index.quarters) ? index.quarters : [];
  if (!quarters.includes(id)) quarters.push(id);
  writeJsonAtomic(indexFile, { activeQuarter: index.activeQuarter || id, quarters });

  const label = args.label || id.toUpperCase().replace('-', ' ');
  writeJsonAtomic(path.join(qDir, 'quarter.json'), {
    id, label, mondayFirst: monday, weeksN: weeks, weekFirstNo: isoWeekNo(monday), xmasWeek: null, sprints: [],
    teamOrder: args.example ? ['Atlas', 'Borealis', 'Comet'] : [],
    teamLabel: args.example ? { Atlas: 'Atlas', Borealis: 'Borealis', Comet: 'Comet' } : {},
    roster: args.example ? EXAMPLE_ROSTER : [],
  });

  const areas = args.example ? EXAMPLE_AREAS : [{ id: 'general', name: 'General', color: 'blue', note: '', o: 1 }];
  for (const a of areas) writeJsonAtomic(path.join(qDir, 'areas', a.id + '.json'), a);

  const now = new Date().toISOString();
  if (args.example) {
    for (const t of EXAMPLE_TASKS) {
      const shard = { uid: uid('t-', 16), n: t.n, a: t.a, o: t.o, t: t.t, who: t.who, s: t.s, l: t.l, ph: t.ph, gw: false, ms: false, createdAt: now, updatedAt: now, updatedBy: null };
      writeJsonAtomic(path.join(tasksDir, shard.uid + '.json'), shard);
    }
    for (const t of EXAMPLE_BACKLOG) {
      const item = { uid: uid('bl-', 12), t, createdAt: now, updatedAt: now };
      writeJsonAtomic(path.join(qDir, 'backlog', item.uid + '.json'), item);
    }
  }
  console.log('Quarter ' + id + ' created in ' + qDir + (args.example ? ' (with example data)' : '') + '.');
}

main();
