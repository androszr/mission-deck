// modules/gantt-roadmap/tests/test_gantt_roadmap.mjs
// Contract test + unit tests for gantt-roadmap module helpers.
// `npm test` discovers it through scripts/test-unit-js.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The app root (server.js + js/) is found by walking up, so this test runs both
// from an installed copy (modules/<id>/tests) and from the catalog.
function findAppRoot(start) {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'js'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('app root not found above ' + start);
}
const { validateModuleManifest } = require(path.join(findAppRoot(path.dirname(fileURLToPath(import.meta.url))), 'server.js'));

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'gantt-roadmap';
const VIEW_IDS = ['gantt-roadmap-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

// Load gantt.js helpers (ES module)
const ganttUrl = new URL('../client/gantt.js', import.meta.url).href;
const g = await import(ganttUrl);

// ---- Contract tests --------------------------------------------------------

test('gantt-roadmap: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.equal(result.valid, true, (result.errors || []).join('; '));
});

test('gantt-roadmap: the manifest declares expected shape', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepEqual(manifest.views.map((v) => v.id), VIEW_IDS);
  assert.equal(manifest.area, 'Product');
  assert.equal(manifest.status, 'beta');
  assert.equal(manifest.sidebar.kind, 'page');
  assert.equal(manifest.sidebar.hub, 'initiatives');
  assert.ok(manifest.dataRepos.length >= 1);
  assert.equal(manifest.dataRepos[0].name, 'data-tier-0');
  assert.ok(manifest.views[0].id.startsWith('gantt-roadmap-'), 'view id starts with gantt-roadmap-');
});

test('gantt-roadmap: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('gantt-roadmap: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
  assert.ok(fs.existsSync(path.join(DIR, 'server', 'store.js')));
  assert.ok(fs.existsSync(path.join(DIR, 'server', 'paths.js')));
  assert.ok(fs.existsSync(path.join(DIR, 'client', 'gantt.js')));
});

test('gantt-roadmap: the server entry registers at least one route', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  assert.equal(typeof register, 'function');
  const result = register({
    moduleId: MODULE_ID, dataDir: DIR, rootDir: DIR, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  assert.ok(Array.isArray(result.routes) && result.routes.length > 0);
  for (const r of result.routes) {
    assert.match(r.path, /^\//, 'a route path starts with /');
    assert.equal(typeof r.handler, 'function');
  }
});

// ---- phaseLanes ------------------------------------------------------------

test('phaseLanes: two non-overlapping phases -> both lane 0', () => {
  const phases = [{ s: 1, l: 2 }, { s: 3, l: 2 }];
  const lanes = g.phaseLanes(phases);
  assert.deepEqual(lanes, [0, 0]);
});

test('phaseLanes: two overlapping phases -> lane 0 and lane 1', () => {
  const phases = [{ s: 1, l: 3 }, { s: 2, l: 3 }];
  const lanes = g.phaseLanes(phases);
  assert.equal(lanes[0], 0);
  assert.equal(lanes[1], 1);
});

test('phaseLanes: three phases, first two overlap, third fits with first', () => {
  // [1,3] and [2,4] overlap; [4,6] overlaps with [2,4] but not with [1,3]
  const phases = [{ s: 1, l: 3 }, { s: 2, l: 3 }, { s: 4, l: 2 }];
  const lanes = g.phaseLanes(phases);
  // phase 3 (s:4) overlaps with phase 2 (s:2 end=5), so cannot share lane 1
  // but can share lane 0 with phase 1 (end=4; s:4 is not strictly < 4)
  // 4 < 1+3=4 is false, so no overlap with phase 1 -> lane 0
  assert.equal(lanes[0], 0);
  assert.equal(lanes[1], 1);
  assert.equal(lanes[2], 0);
});

// ---- envelope --------------------------------------------------------------

test('envelope: task without phases returns s and l directly', () => {
  const task = { s: 3, l: 5 };
  const env = g.envelope(task);
  assert.deepEqual(env, { s: 3, l: 5 });
});

test('envelope: task with phases returns bounding box of phases', () => {
  const task = {
    s: 1, l: 10,
    ph: [{ s: 2, l: 3 }, { s: 6, l: 2 }],
  };
  const env = g.envelope(task);
  // min s = 2, max end = max(2+3, 6+2) = max(5,8) = 8, l = 8-2 = 6
  assert.deepEqual(env, { s: 2, l: 6 });
});

test('envelope: single phase returns that phase bounds', () => {
  const task = { s: 1, l: 4, ph: [{ s: 5, l: 3 }] };
  assert.deepEqual(g.envelope(task), { s: 5, l: 3 });
});

// ---- normRow ---------------------------------------------------------------

test('normRow: clamps s and l to [1, weeksN]', () => {
  const patch = g.normRow({}, { s: 0, l: 20 }, { weeksN: 14, rosterIds: [] });
  assert.equal(patch.s, 1);
  assert.equal(patch.l, 14);
});

test('normRow: filters who to rosterIds', () => {
  const rosterIds = ['alice', 'robin'];
  const patch = g.normRow({}, { who: ['alice', 'charlie', 'robin'] }, { weeksN: 14, rosterIds });
  assert.deepEqual(patch.who, ['alice', 'robin']);
});

test('normRow: validates phases, clamps phase s/l', () => {
  const patch = g.normRow({}, { ph: [{ n: 'Phase 1', s: 0, l: 20 }] }, { weeksN: 14, rosterIds: [] });
  assert.ok(Array.isArray(patch.ph));
  assert.equal(patch.ph[0].s, 1);
  assert.equal(patch.ph[0].l, 14);
});

test('normRow: ms:true forces l=0 and ph=null', () => {
  const patch = g.normRow({}, { ms: true, l: 5, ph: [{ n: 'x', s: 1, l: 2 }] }, { weeksN: 14, rosterIds: [] });
  assert.equal(patch.ms, true);
  assert.equal(patch.l, 0);
  assert.equal(patch.ph, null);
});

test('normRow: empty title throws invalid-title', () => {
  assert.throws(
    () => g.normRow({}, { t: '   ' }, { weeksN: 14, rosterIds: [] }),
    (e) => e.code === 'invalid-title'
  );
});

// ---- monthSegs -------------------------------------------------------------

test('monthSegs: 14 weeks from 2026-09-21 -> Sep/Oct/Nov/Dec segments', () => {
  const segs = g.monthSegs('2026-09-21', 14);
  // W1-W2: Sep (month 8), W3-W6: Oct (month 9), W7-W10: Nov (month 10), W11-W14: Dec (month 11)
  assert.ok(segs.length >= 3, 'at least 3 months: ' + segs.map((s) => s.label).join(','));
  const labels = segs.map((s) => s.label);
  assert.ok(labels.includes('Sep'), 'should include Sep');
  assert.ok(labels.includes('Oct'), 'should include Oct');
  assert.ok(labels.includes('Nov'), 'should include Nov');
  assert.ok(labels.includes('Dec'), 'should include Dec');
  // total len should equal weeksN
  const total = segs.reduce((sum, s) => sum + s.len, 0);
  assert.equal(total, 14);
});

// ---- dateToDayOffset -------------------------------------------------------

test('dateToDayOffset: same date -> 0', () => {
  assert.equal(g.dateToDayOffset('2026-09-21', '2026-09-21'), 0);
});

test('dateToDayOffset: one week later -> 7', () => {
  assert.equal(g.dateToDayOffset('2026-09-21', '2026-09-28'), 7);
});

test('dateToDayOffset: day before base -> -1', () => {
  assert.equal(g.dateToDayOffset('2026-09-21', '2026-09-20'), -1);
});

test('dateToDayOffset: month boundary (sep->oct) -> 9', () => {
  assert.equal(g.dateToDayOffset('2026-09-21', '2026-09-30'), 9);
});

// ---- dayPct ----------------------------------------------------------------

test('dayPct: offset 0 -> 0%', () => {
  assert.equal(g.dayPct(0, 98), 0);
});

test('dayPct: offset == totalDays -> 100%', () => {
  assert.equal(g.dayPct(98, 98), 100);
});

test('dayPct: half -> 50%', () => {
  assert.equal(g.dayPct(49, 98), 50);
});

test('dayPct: 14 days of 98 -> ~14.28%', () => {
  const pct = g.dayPct(14, 98);
  assert.ok(Math.abs(pct - (14 / 98) * 100) < 0.01, 'pct: ' + pct);
});

// ---- monthSegsByDay ---------------------------------------------------------

test('monthSegsByDay: 14 weeks from 2026-09-21 covers Sep, Oct, Nov, Dec', () => {
  const daysN = 14 * 7;
  const segs = g.monthSegsByDay('2026-09-21', daysN);
  assert.ok(segs.length >= 3, 'at least 3 month segs, got: ' + segs.map((s) => s.label).join(','));
  const labels = segs.map((s) => s.label);
  assert.ok(labels.includes('Sep'), 'includes Sep');
  assert.ok(labels.includes('Oct'), 'includes Oct');
  assert.ok(labels.includes('Nov'), 'includes Nov');
  assert.ok(labels.includes('Dec'), 'includes Dec');
});

test('monthSegsByDay: total days of all segments equals daysN', () => {
  const daysN = 14 * 7;
  const segs = g.monthSegsByDay('2026-09-21', daysN);
  const total = segs.reduce((sum, s) => sum + s.days, 0);
  assert.equal(total, daysN);
});

test('monthSegsByDay: segments are contiguous (each startDay = previous startDay + days)', () => {
  const daysN = 14 * 7;
  const segs = g.monthSegsByDay('2026-09-21', daysN);
  for (let i = 1; i < segs.length; i++) {
    assert.equal(segs[i].startDay, segs[i - 1].startDay + segs[i - 1].days,
      'seg ' + i + ' not contiguous');
  }
});

test('monthSegsByDay: first segment starts at day 0', () => {
  const daysN = 14 * 7;
  const segs = g.monthSegsByDay('2026-09-21', daysN);
  assert.equal(segs[0].startDay, 0);
});

// ---- sprintSegs ------------------------------------------------------------

test('sprintSegs: new-format sprints (start + days) -> correct segments', () => {
  // start is a Tuesday (2026-09-22 is a Tuesday)
  const sprints = [
    { no: 1, start: '2026-09-22', days: 14, w1: 2, w2: 3 },
    { no: 2, start: '2026-10-06', days: 14, w1: 4, w2: 5 },
  ];
  const daysN = 14 * 7; // 98 days
  const segs = g.sprintSegs('2026-09-21', daysN, sprints);
  assert.equal(segs.length, 2);
  // sprint 1 starts at day 1 (Sep 22 - Sep 21 = 1)
  assert.equal(segs[0].startDay, 1);
  assert.equal(segs[0].days, 14);
  // sprint 2 starts at day 15
  assert.equal(segs[1].startDay, 15);
  assert.equal(segs[1].days, 14);
});

test('sprintSegs: legacy fallback (w1/w2, no start) -> segments from week positions', () => {
  const sprints = [
    { no: 1, w1: 1, w2: 2 },
    { no: 2, w1: 3, w2: 4 },
  ];
  const daysN = 14 * 7;
  const segs = g.sprintSegs('2026-09-21', daysN, sprints);
  assert.equal(segs.length, 2);
  // legacy: sprint starts at (w1-1)*7
  assert.equal(segs[0].startDay, 0);
  assert.equal(segs[1].startDay, 14);
});

test('sprintSegs: sprint entirely outside range is excluded', () => {
  const sprints = [
    { no: 1, start: '2026-06-01', days: 14 },   // before range
    { no: 2, start: '2026-09-22', days: 14 },   // inside range
    { no: 3, start: '2030-01-01', days: 14 },   // after range
  ];
  const daysN = 14 * 7;
  const segs = g.sprintSegs('2026-09-21', daysN, sprints);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].no, 2);
});

test('sprintSegs: empty array -> empty result', () => {
  const segs = g.sprintSegs('2026-09-21', 98, []);
  assert.deepEqual(segs, []);
});

// ---- weekNoToIdx / slToRange / rangeToSL -----------------------------------

test('weekNoToIdx: s=1, weekFirstNo=39 -> 39', () => {
  assert.equal(g.weekNoToIdx(1, 39), 39);
});

test('weekNoToIdx: s=3, weekFirstNo=39 -> 41', () => {
  assert.equal(g.weekNoToIdx(3, 39), 41);
});

test('slToRange: s=1,l=1,weekFirstNo=39 -> from=39,to=39', () => {
  assert.deepEqual(g.slToRange(1, 1, 39), { from: 39, to: 39 });
});

test('slToRange: s=2,l=3,weekFirstNo=39 -> from=40,to=42', () => {
  assert.deepEqual(g.slToRange(2, 3, 39), { from: 40, to: 42 });
});

test('rangeToSL: from=39,to=39 -> s=1,l=1', () => {
  assert.deepEqual(g.rangeToSL(39, 39, 39, 14), { s: 1, l: 1 });
});

test('rangeToSL: from=40,to=42 -> s=2,l=3', () => {
  assert.deepEqual(g.rangeToSL(40, 42, 39, 14), { s: 2, l: 3 });
});

test('rangeToSL: clamps s to 1 when from < weekFirstNo', () => {
  const { s } = g.rangeToSL(38, 40, 39, 14);
  assert.equal(s, 1);
});

test('rangeToSL: clamps l so s+l-1 <= weeksN', () => {
  const { s, l } = g.rangeToSL(51, 55, 39, 14);
  assert.ok(s + l - 1 <= 14, 's+l-1 exceeds weeksN: s=' + s + ' l=' + l);
});

test('slToRange / rangeToSL roundtrip: s=5,l=4', () => {
  const { from, to } = g.slToRange(5, 4, 39);
  const sl = g.rangeToSL(from, to, 39, 14);
  assert.equal(sl.s, 5);
  assert.equal(sl.l, 4);
});

// ---- groupsOf --------------------------------------------------------------

const TEST_AREAS = [
  { id: 'fcst', name: 'Forecasts', o: 1 },
  { id: 'recs', name: 'Recommendations', o: 2 },
  { id: 'avail', name: 'Availability', o: 3 },
  { id: 'other', name: 'Other', o: 4 },
];
const TEST_ROSTER = [{ id: 'alice', n: 'Alice' }, { id: 'robin', n: 'Robin' }];
const TEST_TASKS = [
  { uid: 't-1', a: 'fcst', o: 1, n: 1, who: ['alice'] },
  { uid: 't-2', a: 'recs', o: 1, n: 2, who: ['robin'] },
  { uid: 't-3', a: 'fcst', o: 2, n: 3, who: ['alice'] },
  { uid: 't-4', a: 'avail', o: 1, n: 4, who: [] },
];

test('groupsOf: mode area -> 4 groups in area order', () => {
  const groups = g.groupsOf(TEST_TASKS, TEST_AREAS, TEST_ROSTER, 'area');
  // only areas with tasks
  assert.equal(groups.find((gr) => gr.key === 'area:fcst').tasks.length, 2);
  assert.equal(groups.find((gr) => gr.key === 'area:recs').tasks.length, 1);
});

test('groupsOf: mode owner -> groups by who[0]', () => {
  const groups = g.groupsOf(TEST_TASKS, TEST_AREAS, TEST_ROSTER, 'owner');
  const aliceGroup = groups.find((gr) => gr.key === 'owner:alice');
  assert.ok(aliceGroup, 'alice group exists');
  assert.equal(aliceGroup.tasks.length, 2);
});

test('groupsOf: mode none -> 1 group with all tasks', () => {
  const groups = g.groupsOf(TEST_TASKS, TEST_AREAS, TEST_ROSTER, 'none');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tasks.length, 4);
});

// ---- busyWeeks -------------------------------------------------------------

test('busyWeeks: task with phases -> union of phase weeks', () => {
  const task = { s: 1, l: 4, ph: [{ s: 2, l: 2 }, { s: 5, l: 2 }] };
  const weeks = g.busyWeeks(task);
  // phase 1: weeks 2,3; phase 2: weeks 5,6
  assert.deepEqual([...weeks].sort((a, b) => a - b), [2, 3, 5, 6]);
});

test('busyWeeks: task without phases -> consecutive weeks s..s+l-1', () => {
  const task = { s: 3, l: 3 };
  const weeks = g.busyWeeks(task);
  assert.deepEqual([...weeks].sort((a, b) => a - b), [3, 4, 5]);
});

// ---- assignDisplayNumber ---------------------------------------------------

test('assignDisplayNumber: 19 shards n:1..19, no tombstones -> 20', () => {
  const shards = Array.from({ length: 19 }, (_, i) => ({ n: i + 1 }));
  assert.equal(g.assignDisplayNumber(shards, []), 20);
});

test('assignDisplayNumber: 19 shards + tombstone _n19 -> still 20', () => {
  const shards = Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }));
  assert.equal(g.assignDisplayNumber(shards, ['_n19']), 20);
});

test('assignDisplayNumber: no shards, no tombstones -> 1', () => {
  assert.equal(g.assignDisplayNumber([], []), 1);
});

// ---- resolveDisplayDuplicates ----------------------------------------------

test('resolveDisplayDuplicates: no duplicates -> fixed is empty', () => {
  const shards = [
    { uid: 't-aaa0000000000001', n: 1, createdAt: '2026-09-01T10:00:00Z' },
    { uid: 't-aaa0000000000002', n: 2, createdAt: '2026-09-01T11:00:00Z' },
  ];
  const { fixed, ok } = g.resolveDisplayDuplicates(shards);
  assert.equal(fixed.length, 0);
  assert.equal(ok.length, 2);
});

test('resolveDisplayDuplicates: two shards with same n -> earlier keeps n, later gets n+1', () => {
  const shards = [
    { uid: 't-bbb0000000000001', n: 20, createdAt: '2026-09-01T10:00:00Z' },
    { uid: 't-bbb0000000000002', n: 20, createdAt: '2026-09-01T12:00:00Z' },
  ];
  const { fixed, ok } = g.resolveDisplayDuplicates(shards);
  assert.equal(fixed.length, 1);
  assert.equal(ok.length, 1);
  // earlier uid keeps n=20
  assert.equal(ok[0].uid, 't-bbb0000000000001');
  assert.equal(ok[0].n, 20);
  // later one gets 21
  assert.equal(fixed[0].uid, 't-bbb0000000000002');
  assert.equal(fixed[0].newN, 21);
});

test('resolveDisplayDuplicates (merge simulation): two machines each created n=20 offline', () => {
  // Simulate: machine A created task with n=20 uid='t-aaa1111111111111'
  // Machine B created task with n=20 uid='t-bbb2222222222222'
  // After git merge, both shards exist. Both should survive with different n.
  const shards = [
    { uid: 't-aaa1111111111111', n: 20, createdAt: '2026-09-15T08:00:00Z' },
    { uid: 't-bbb2222222222222', n: 20, createdAt: '2026-09-15T09:00:00Z' },
  ];
  const { fixed, ok } = g.resolveDisplayDuplicates(shards);
  const allUids = [...ok.map((s) => s.uid), ...fixed.map((s) => s.uid)];
  // both survive
  assert.ok(allUids.includes('t-aaa1111111111111'), 'first uid survived');
  assert.ok(allUids.includes('t-bbb2222222222222'), 'second uid survived');
  // they have different n values
  const ns = [...ok.map((s) => s.n), ...fixed.map((s) => s.newN)];
  assert.equal(new Set(ns).size, 2, 'both get unique n: ' + ns.join(','));
});

// ---- validateArea ----------------------------------------------------------

test('validateArea: valid area -> ok', () => {
  const result = g.validateArea({ id: 'fcst', name: 'Forecasts', color: 'blue' }, g.AREA_COLORS);
  assert.equal(result.valid, true);
});

test('validateArea: empty name -> error', () => {
  const result = g.validateArea({ id: 'fcst', name: '', color: 'blue' }, g.AREA_COLORS);
  assert.equal(result.valid, false);
  assert.ok(result.error);
});

test('validateArea: invalid color -> error', () => {
  const result = g.validateArea({ id: 'fcst', name: 'Test', color: 'purple' }, g.AREA_COLORS);
  assert.equal(result.valid, false);
});

test('validateArea: invalid id slug -> error', () => {
  const result = g.validateArea({ id: 'area with spaces', name: 'Test', color: 'blue' }, g.AREA_COLORS);
  assert.equal(result.valid, false);
});

// ---- backlogItemToTask -----------------------------------------------------

test('backlogItemToTask: converts with default weeks', () => {
  const item = { uid: 'bl-aaa000000000001', t: 'Test item', createdAt: '2026-09-01T00:00:00Z' };
  const task = g.backlogItemToTask(item, 'fcst', 5, 14);
  assert.equal(task.t, 'Test item');
  assert.equal(task.a, 'fcst');
  assert.equal(task.n, 5);
  assert.equal(task.s, 1);
  assert.equal(task.l, 2);
  assert.deepEqual(task.who, []);
  assert.equal(task.gw, false);
  assert.equal(task.ms, false);
  assert.equal(task.ph, null);
});

// ---- taskToBacklogItem -----------------------------------------------------

test('taskToBacklogItem: converts task title to backlog item', () => {
  const task = { uid: 't-aaa0000000000001', t: 'Test task', a: 'fcst', n: 3 };
  const item = g.taskToBacklogItem(task);
  assert.equal(item.t, 'Test task');
  assert.ok(item.createdAt);
  assert.ok(item.updatedAt);
});

// ---- areaSlugFromName ------------------------------------------------------

test('areaSlugFromName: ASCII lowercase with dashes', () => {
  assert.equal(g.areaSlugFromName('Availability and tops'), 'availability-and-tops');
  assert.equal(g.areaSlugFromName('Café Zürich Łódź'), 'cafe-zurich-lodz');
});

test('areaSlugFromName: empty name throws', () => {
  assert.throws(() => g.areaSlugFromName(''), (e) => e instanceof Error);
  assert.throws(() => g.areaSlugFromName('   '), (e) => e instanceof Error);
});

// ---- create-quarter script --------------------------------------------------
// The script runs into a temp directory (--target), so it is checked on every
// machine without touching the team data.

const SEED_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-quarter-'));
execFileSync(process.execPath, [path.join(DIR, 'scripts', 'create-quarter.js'), '--id', 'q4-2026', '--monday', '2026-09-21', '--weeks', '14', '--example', '--target', SEED_TMP], { stdio: 'pipe' });
const SEED_Q_DIR = path.join(SEED_TMP, 'q4-2026');
test.after(() => fs.rmSync(SEED_TMP, { recursive: true, force: true }));

test('create-quarter: index.json lists the quarter and makes it active', () => {
  const index = JSON.parse(fs.readFileSync(path.join(SEED_TMP, 'index.json'), 'utf8'));
  assert.deepEqual(index, { activeQuarter: 'q4-2026', quarters: ['q4-2026'] });
});

test('create-quarter: quarter.json carries the calendar, the ISO week of the first Monday and the example roster', () => {
  const q = JSON.parse(fs.readFileSync(path.join(SEED_Q_DIR, 'quarter.json'), 'utf8'));
  assert.equal(q.label, 'Q4 2026');
  assert.equal(q.mondayFirst, '2026-09-21');
  assert.equal(q.weeksN, 14);
  assert.equal(q.weekFirstNo, 39);
  assert.deepEqual(q.teamOrder, ['Atlas', 'Borealis', 'Comet']);
  const taylor = q.roster.find((p) => p.id === 'taylor-kim');
  assert.ok(taylor, 'taylor-kim in roster');
  assert.equal(taylor.n, 'Taylor Kim');
  assert.equal(taylor.s, 'Taylor');
  assert.equal(taylor.cap, 2);
});

test('create-quarter: example areas, tasks and backlog items are written as shards', () => {
  const areas = fs.readdirSync(path.join(SEED_Q_DIR, 'areas')).sort();
  assert.deepEqual(areas, ['forecasting.json', 'other.json', 'platform.json']);
  const tasks = fs.readdirSync(path.join(SEED_Q_DIR, 'tasks')).filter((f) => /^t-[0-9a-f]{16}\.json$/.test(f));
  assert.equal(tasks.length, 4);
  const shards = tasks.map((f) => JSON.parse(fs.readFileSync(path.join(SEED_Q_DIR, 'tasks', f), 'utf8')));
  assert.deepEqual(shards.map((t) => t.n).sort(), [1, 2, 3, 4]);
  assert.equal(fs.readdirSync(path.join(SEED_Q_DIR, 'backlog')).length, 3);
});

test('create-quarter: refuses a quarter that already has tasks and rejects bad arguments', () => {
  const run = (args) => {
    try { execFileSync(process.execPath, [path.join(DIR, 'scripts', 'create-quarter.js'), ...args], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; }
  };
  assert.equal(run(['--id', 'q4-2026', '--monday', '2026-09-21', '--weeks', '14', '--target', SEED_TMP]), 1);
  assert.equal(run(['--id', 'quarter', '--monday', '2026-09-21', '--weeks', '14', '--target', SEED_TMP]), 2);
  assert.equal(run(['--id', 'q1-2027', '--monday', '2026-12-29', '--weeks', '13', '--target', SEED_TMP]), 2, 'not a Monday');
});

// ---- store: file-system tests ----------------------------------------------

test('store: createTask assigns uid and n, writes shard to temp dir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-test-'));
  try {
    // Set up a minimal team data repository structure
    const rootDir = tmpDir;
    // Override DATA_SUB_REPOS_DIR so store finds the temp dir
    const origEnv = process.env.DATA_SUB_REPOS_DIR;
    process.env.DATA_SUB_REPOS_DIR = path.join(tmpDir, 'sub');
    const productDir = path.join(tmpDir, 'sub', 'ds-data');
    const qDir = path.join(productDir, 'gantt-roadmap', 'q4-2026');
    fs.mkdirSync(path.join(qDir, 'areas'), { recursive: true });
    fs.mkdirSync(path.join(qDir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(qDir, 'backlog'), { recursive: true });
    // write area and quarter.json
    fs.writeFileSync(path.join(qDir, 'areas', 'prog.json'), JSON.stringify({ id: 'fcst', name: 'Forecasts', color: 'blue', note: '', o: 1 }));
    fs.writeFileSync(path.join(qDir, 'quarter.json'), JSON.stringify({ id: 'q4-2026', weeksN: 14, roster: [] }));

    // Clear module cache so store.js uses the updated env
    const store = require(path.join(DIR, 'server', 'store.js'));
    const task = store.createTask(rootDir, 'q4-2026', { a: 'fcst', t: 'Test task' }, 14);
    assert.ok(store.TASK_UID_RE.test(task.uid), 'uid matches regex: ' + task.uid);
    assert.equal(task.n, 1);
    assert.equal(task.a, 'fcst');
    assert.equal(task.t, 'Test task');

    // Verify shard file was written
    const shardFile = path.join(qDir, 'tasks', task.uid + '.json');
    assert.ok(fs.existsSync(shardFile), 'shard file exists');

    // Restore env
    if (origEnv === undefined) delete process.env.DATA_SUB_REPOS_DIR;
    else process.env.DATA_SUB_REPOS_DIR = origEnv;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('store: swapTaskOrder under shared lock swaps o fields of two tasks in the same area', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-swap-'));
  try {
    const origEnv = process.env.DATA_SUB_REPOS_DIR;
    process.env.DATA_SUB_REPOS_DIR = path.join(tmpDir, 'sub');
    const qDir = path.join(tmpDir, 'sub', 'ds-data', 'gantt-roadmap', 'q4-2026');
    fs.mkdirSync(path.join(qDir, 'areas'), { recursive: true });
    fs.mkdirSync(path.join(qDir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(qDir, 'backlog'), { recursive: true });
    fs.writeFileSync(path.join(qDir, 'areas', 'prog.json'), JSON.stringify({ id: 'fcst', name: 'Forecasts', color: 'blue', note: '', o: 1 }));
    fs.writeFileSync(path.join(qDir, 'quarter.json'), JSON.stringify({ id: 'q4-2026', weeksN: 14, roster: [] }));

    const store = require(path.join(DIR, 'server', 'store.js'));
    // Create two tasks in the same area — they get o:1 and o:2
    const taskA = store.createTask(tmpDir, 'q4-2026', { a: 'fcst', t: 'Task A' }, 14);
    const taskB = store.createTask(tmpDir, 'q4-2026', { a: 'fcst', t: 'Task B' }, 14);
    assert.equal(taskA.o, 1);
    assert.equal(taskB.o, 2);

    // One lock created once (as in register)
    let lockHeld = false;
    const _withLock = async (fn) => {
      assert.ok(!lockHeld, 'lock re-entered (deadlock would occur)');
      lockHeld = true;
      try { return await fn(); } finally { lockHeld = false; }
    };
    void _withLock; // defined for potential re-entrancy checks; unused here

    // swap B up — B should get o:1, A should get o:2
    const result = store.swapTaskOrder(tmpDir, 'q4-2026', taskB.uid, 'up');
    assert.equal(result.task.uid, taskB.uid);
    assert.equal(result.neighbour.uid, taskA.uid);
    assert.equal(result.task.o, 1);      // B is now first
    assert.equal(result.neighbour.o, 2); // A is now second

    // verify persisted shards
    const persisted = store.readTask(tmpDir, 'q4-2026', taskB.uid);
    assert.equal(persisted.o, 1);

    // boundary: try to swap the first task further up
    assert.throws(
      () => store.swapTaskOrder(tmpDir, 'q4-2026', taskB.uid, 'up'),
      (e) => e.code === 'boundary',
    );

    if (origEnv === undefined) delete process.env.DATA_SUB_REPOS_DIR;
    else process.env.DATA_SUB_REPOS_DIR = origEnv;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('store: readQuarter persists duplicate-fix through the shared withLock (no deadlock)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-rdq-'));
  try {
    const origEnv = process.env.DATA_SUB_REPOS_DIR;
    process.env.DATA_SUB_REPOS_DIR = path.join(tmpDir, 'sub');
    const qDir = path.join(tmpDir, 'sub', 'ds-data', 'gantt-roadmap', 'q4-2026');
    fs.mkdirSync(path.join(qDir, 'areas'), { recursive: true });
    fs.mkdirSync(path.join(qDir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(qDir, 'backlog'), { recursive: true });
    fs.writeFileSync(path.join(qDir, 'areas', 'prog.json'), JSON.stringify({ id: 'fcst', name: 'Forecasts', color: 'blue', note: '', o: 1 }));
    fs.writeFileSync(path.join(qDir, 'quarter.json'), JSON.stringify({ id: 'q4-2026', weeksN: 14, roster: [] }));

    const store = require(path.join(DIR, 'server', 'store.js'));

    // Write two shards manually with the same n (simulates two machines offline).
    // UIDs must match TASK_UID_RE: /^t-[0-9a-f]{16}$/
    const now = new Date().toISOString();
    store.writeTask(tmpDir, 'q4-2026', { uid: 't-aa00000000000001', n: 20, a: 'fcst', o: 1, t: 'Dup A', who: [], s: 1, l: 2, ph: null, gw: false, ms: false, createdAt: '2026-09-01T08:00:00Z', updatedAt: now, updatedBy: null });
    store.writeTask(tmpDir, 'q4-2026', { uid: 't-bb00000000000002', n: 20, a: 'fcst', o: 2, t: 'Dup B', who: [], s: 1, l: 2, ph: null, gw: false, ms: false, createdAt: '2026-09-01T09:00:00Z', updatedAt: now, updatedBy: null });

    // Track that the lock is used by readQuarter and that it's never re-entered
    let lockCallCount = 0;
    let lockHeld = false;
    const withLock = async (fn) => {
      assert.ok(!lockHeld, 'lock re-entered — deadlock would occur in register(ctx)');
      lockHeld = true;
      lockCallCount++;
      try { return await fn(); } finally { lockHeld = false; }
    };

    const result = await store.readQuarter(tmpDir, 'q4-2026', { log: () => {}, withLock });

    // duplicate fixed: both tasks survived, one got a different n
    assert.equal(result.tasks.length, 2, 'both tasks present');
    const ns = result.tasks.map((t) => t.n);
    assert.equal(new Set(ns).size, 2, 'no duplicate n after readQuarter: ' + ns.join(','));
    // the fix was persisted through withLock
    assert.ok(lockCallCount >= 1, 'withLock was called at least once (fix persisted)');

    // verify shard on disk was updated
    const shardA = store.readTask(tmpDir, 'q4-2026', 't-aa00000000000001');
    const shardB = store.readTask(tmpDir, 'q4-2026', 't-bb00000000000002');
    assert.notEqual(shardA.n, shardB.n, 'persisted shards have different n values');

    if (origEnv === undefined) delete process.env.DATA_SUB_REPOS_DIR;
    else process.env.DATA_SUB_REPOS_DIR = origEnv;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('store: deleteTask writes tombstone and removes shard', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-test-'));
  try {
    const origEnv = process.env.DATA_SUB_REPOS_DIR;
    process.env.DATA_SUB_REPOS_DIR = path.join(tmpDir, 'sub');
    const productDir = path.join(tmpDir, 'sub', 'ds-data');
    const qDir = path.join(productDir, 'gantt-roadmap', 'q4-2026');
    fs.mkdirSync(path.join(qDir, 'areas'), { recursive: true });
    fs.mkdirSync(path.join(qDir, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(qDir, 'backlog'), { recursive: true });
    fs.writeFileSync(path.join(qDir, 'areas', 'prog.json'), JSON.stringify({ id: 'fcst', name: 'Forecasts', color: 'blue', note: '', o: 1 }));
    fs.writeFileSync(path.join(qDir, 'quarter.json'), JSON.stringify({ id: 'q4-2026', weeksN: 14, roster: [] }));

    const store = require(path.join(DIR, 'server', 'store.js'));
    const task = store.createTask(tmpDir, 'q4-2026', { a: 'fcst', t: 'To delete' }, 14);
    assert.equal(task.n, 1);

    const deleted = store.deleteTask(tmpDir, 'q4-2026', task.uid);
    assert.equal(deleted, true);

    // shard gone, tombstone exists
    const shardFile = path.join(qDir, 'tasks', task.uid + '.json');
    assert.ok(!fs.existsSync(shardFile), 'shard removed');
    const tombstone = path.join(qDir, 'tasks', '_n1');
    assert.ok(fs.existsSync(tombstone), 'tombstone _n1 written');

    // next task gets n=2 (max tombstone = 1, so max+1=2)
    const task2 = store.createTask(tmpDir, 'q4-2026', { a: 'fcst', t: 'Task 2' }, 14);
    assert.equal(task2.n, 2);

    if (origEnv === undefined) delete process.env.DATA_SUB_REPOS_DIR;
    else process.env.DATA_SUB_REPOS_DIR = origEnv;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---- review fixes (0.1.1) --------------------------------------------------

test('normRow: s + l - 1 never runs past weeksN', () => {
  const patch = g.normRow({ s: 1, l: 2 }, { s: 12, l: 6 }, { weeksN: 14, rosterIds: [] });
  assert.equal(patch.s, 12);
  assert.equal(patch.l, 3, 'l trimmed to weeksN - s + 1');
  // moving only s re-trims the stored l
  const moved = g.normRow({ s: 1, l: 10 }, { s: 10 }, { weeksN: 14, rosterIds: [] });
  assert.equal(moved.l, 5);
  // a bar that already fits is left alone
  assert.equal('l' in g.normRow({ s: 1, l: 2 }, { s: 3 }, { weeksN: 14, rosterIds: [] }), false);
});

test('resolveDisplayDuplicates: renumbering skips past tombstones (numbers never come back)', () => {
  const shards = [
    { uid: 't-aa00000000000001', n: 10, createdAt: '2026-09-01T08:00:00Z' },
    { uid: 't-bb00000000000002', n: 10, createdAt: '2026-09-01T09:00:00Z' },
  ];
  const { fixed } = g.resolveDisplayDuplicates(shards, ['_n11', '_n12']);
  assert.deepEqual(fixed, [{ uid: 't-bb00000000000002', oldN: 10, newN: 13 }]);
});

test('store: readQuarter repairs duplicates on a FRESH read under the lock (no lost update)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-rdq2-'));
  const origEnv = process.env.DATA_SUB_REPOS_DIR;
  try {
    process.env.DATA_SUB_REPOS_DIR = path.join(tmpDir, 'sub');
    const qDir = path.join(tmpDir, 'sub', 'ds-data', 'gantt-roadmap', 'q4-2026');
    fs.mkdirSync(path.join(qDir, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(qDir, 'quarter.json'), JSON.stringify({ id: 'q4-2026', weeksN: 14, roster: [] }));
    const store = require(path.join(DIR, 'server', 'store.js'));
    const base = { a: 'fcst', o: 1, who: [], s: 1, l: 2, ph: null, gw: false, ms: false, updatedBy: null };
    store.writeTask(tmpDir, 'q4-2026', { ...base, uid: 't-aa00000000000001', n: 5, t: 'A', createdAt: '2026-09-01T08:00:00Z' });
    store.writeTask(tmpDir, 'q4-2026', { ...base, uid: 't-bb00000000000002', n: 5, t: 'B', createdAt: '2026-09-01T09:00:00Z' });
    fs.writeFileSync(path.join(qDir, 'tasks', '_n6'), '');

    // A PUT lands between readQuarter's unlocked read and its lock.
    const withLock = async (fn) => {
      const b = store.readTask(tmpDir, 'q4-2026', 't-bb00000000000002');
      store.writeTask(tmpDir, 'q4-2026', { ...b, t: 'B po edycji', s: 4 });
      return fn();
    };
    await store.readQuarter(tmpDir, 'q4-2026', { log: () => {}, withLock });

    const b = store.readTask(tmpDir, 'q4-2026', 't-bb00000000000002');
    assert.equal(b.t, 'B po edycji', 'the concurrent edit survived the repair');
    assert.equal(b.s, 4);
    assert.equal(b.n, 7, 'renumbered past tombstone _n6');
    assert.equal(store.readTask(tmpDir, 'q4-2026', 't-aa00000000000001').n, 5);
  } finally {
    if (origEnv === undefined) delete process.env.DATA_SUB_REPOS_DIR;
    else process.env.DATA_SUB_REPOS_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function _routesOf(readBodyImpl) {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const answers = [];
  const { routes } = register({
    moduleId: MODULE_ID, dataDir: DIR, rootDir: DIR, log: () => {},
    jsonResponse: (_res, status, payload) => answers.push({ status, payload }),
    readBody: readBodyImpl, checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  return { routes, answers };
}

test('server: unused routes are gone (no unvalidated quarter-meta write)', () => {
  const { routes } = _routesOf(async () => ({}));
  const keys = routes.map((r) => r.method + ' ' + r.path);
  for (const gone of ['PUT /quarter-meta', 'GET /export', 'GET /areas', 'GET /task', 'GET /backlog']) {
    assert.ok(!keys.includes(gone), gone + ' must not be registered');
  }
  assert.ok(keys.includes('GET /quarter'));
});

test('server: a JSON body that is not an object answers 400 invalid-json, never a 500', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-body-'));
  const origEnv = process.env.DATA_SUB_REPOS_DIR;
  try {
    process.env.DATA_SUB_REPOS_DIR = path.join(tmpDir, 'sub');
    fs.mkdirSync(path.join(tmpDir, 'sub', 'ds-data', 'gantt-roadmap'), { recursive: true });
    for (const bad of [null, [], 7]) {
      const { routes, answers } = _routesOf(async () => bad);
      const post = routes.find((r) => r.method === 'POST' && r.path === '/task');
      await post.handler({ url: '/task?qid=q4-2026' }, {});
      assert.equal(answers.length, 1);
      assert.equal(answers[0].status, 400, 'body ' + JSON.stringify(bad));
      assert.equal(answers[0].payload.error, 'invalid-json');
    }
  } finally {
    if (origEnv === undefined) delete process.env.DATA_SUB_REPOS_DIR;
    else process.env.DATA_SUB_REPOS_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('client: toasts go through one (message, kind) adapter onto the host (variant, title)', () => {
  const src = read('client/index.js');
  assert.match(src, /const variant = kind === 'error' \? 'danger'/);
  assert.doesNotMatch(src, /this && this\._deps/, 'no `this` lookups inside plain functions');
  assert.doesNotMatch(src, /\.ds-modal-cancel/, 'no page-wide cancel-button lookup');
});

test('client: visible month labels are English short names', () => {
  const labels = g.monthSegs('2026-09-21', 14).map((s) => s.label);
  assert.ok(labels.includes('Oct'));
  assert.ok(labels.includes('Dec'));
});
