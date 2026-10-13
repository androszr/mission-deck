// modules/sprint-planning/tests/test_routes.mjs
// createRoutes against temp copies of the fixtures - never the real team data.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRoutes } = require(path.join(DIR, 'server', 'index.js'));
const FIXTURES = path.join(DIR, 'tests', 'fixtures');
const START = Date.parse('2026-10-09T09:00:00.000Z');
const INVALID = Symbol('invalid-json');

/** opts: empty = no team data. */
function setup(t, { empty = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-planning-'));
  const dataTier0Dir = path.join(base, 'ds-data');
  fs.mkdirSync(dataTier0Dir, { recursive: true });
  if (!empty) fs.cpSync(path.join(FIXTURES, 'ds-data'), dataTier0Dir, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  let chain = Promise.resolve();
  const ctx = {
    moduleId: 'sprint-planning', dataTier0Dir, rootDir: base, log: () => {},
    dataRepoDir: () => null,
    jsonResponse: (res, status, body) => { res.statusCode = status; res.body = body; },
    readBody: async (req) => { if (req._body === INVALID) throw new Error('bad json'); return req._body; },
    checkOrigin: () => true,
    makeLock: () => (fn) => { const run = chain.then(() => fn()); chain = run.catch(() => {}); return run; },
  };
  let tick = 0;
  const { routes } = createRoutes(ctx, { now: () => new Date(START + (tick++) * 1000), randomBytes: (n) => Buffer.alloc(n, 1) });
  const start = (method, p, query, body) => {
    const r = routes.find((x) => x.method === method && x.path === p);
    assert.ok(r, 'no route ' + method + ' ' + p);
    const res = { statusCode: null, body: null };
    return Promise.resolve(r.handler({ url: p + (query ? '?' + query : ''), _body: body }, res)).then(() => res);
  };
  return { call: start, dataTier0Dir };
}

test('GET /status lists teams with null refinement slots and storage', async (t) => {
  const { call } = setup(t);
  const res = await call('GET', '/status');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.storage, 'ok');
  assert.deepEqual(res.body.teams.map((x) => x.id), ['atlas', 'borealis', 'comet', 'delta']);
  assert.ok(res.body.teams.every((x) => x.refinementSlot === null));
  assert.equal(res.body.boards.main.board_id, '101');
});

test('POST /plan extrapolates dates and answers 409 exists on repeat', async (t) => {
  const { call } = setup(t);
  const created = await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.id, 'atlas-21');
  assert.equal(created.body.dateFrom, '2026-10-20');
  assert.equal(created.body.dateTo, '2026-11-03');
  assert.equal(created.body.datesSource, 'computed');
  const again = await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error, 'exists');
  assert.equal((await call('POST', '/plan', '', { team: 'bogus', sprintN: 21 })).body.error, 'bad-team');
  assert.equal((await call('POST', '/plan', '', { team: 'borealis', sprintN: 0 })).body.error, 'bad-sprint');
});

test('POST /plan answers 409 storage-unavailable on an empty team data dir', async (t) => {
  const { call } = setup(t, { empty: true });
  const none = await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 });
  assert.equal(none.statusCode, 409);
  assert.equal(none.body.error, 'storage-unavailable');
});

test('PUT /plan: stale base 409, current base saves and bumps updatedAt', async (t) => {
  const { call } = setup(t);
  const created = (await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 })).body;
  const stale = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: 'old', sections: { goal: { goal: 'x' } } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error, 'stale');
  const ok = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: created.updatedAt, sections: { goal: { goal: '  Goal  ', done: true }, refinements: { items: [{ key: 'ATL-1', topic: 't' }] } } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.sections.goal.goal, 'Goal');
  assert.equal(ok.body.sections.goal.done, true);
  assert.match(ok.body.sections.refinements.items[0].id, /^it-[0-9a-f]{8}$/);
  assert.notEqual(ok.body.updatedAt, created.updatedAt);
  assert.ok(new Date(ok.body.updatedAt) > new Date(created.updatedAt));
  // The old base is now stale: a save invalidates it.
  const again = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: created.updatedAt, sections: { goal: { goal: 'y' } } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error, 'stale');
  const get = await call('GET', '/plan', 'id=atlas-21');
  assert.equal(get.body.sections.goal.goal, 'Goal');
});

test('PUT /plan and GET /plan: unknown field and bad id answer 400', async (t) => {
  const { call } = setup(t);
  const created = (await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 })).body;
  const bad = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: created.updatedAt, sections: { goal: { nope: 1 } } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, 'bad-patch');
  const badSec = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: created.updatedAt, sections: { bogus: {} } });
  assert.equal(badSec.statusCode, 400);
  assert.equal((await call('GET', '/plan', 'id=..%2Fx')).statusCode, 400);
  assert.equal((await call('PUT', '/plan', 'id=bogus-1', {})).statusCode, 400);
  assert.equal((await call('GET', '/plan', 'id=borealis-3')).statusCode, 404);
});

test('GET /context filters roster, duties, absences and maps the Delta history', async (t) => {
  const { call } = setup(t);
  const res = await call('GET', '/context', 'team=atlas&from=2026-10-20&to=2026-11-03');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.roster.members.map((m) => m.slug), ['alex-morgan', 'robin-zlotek', 'sam-rivera']);
  assert.deepEqual(res.body.duties.entries.map((e) => e.date), ['2026-10-21', '2026-10-22']);
  assert.deepEqual(res.body.absences.persons.map((p) => p.slug), ['alex-morgan']);
  assert.equal(res.body.history.unit, 'SP');
  assert.equal(res.body.history.sprints.length, 4);
  const tur = await call('GET', '/context', 'team=delta&from=2026-10-20&to=2026-11-03');
  assert.equal(tur.body.history.unit, 'MD');
  assert.deepEqual(tur.body.history.sprints.map((s) => s.sprintName), ['Delta Sprint 20']);
  assert.equal((await call('GET', '/context', 'team=atlas&from=2026-10-20&to=2027-01-03')).body.error, 'bad-range');
});

test('DELETE /plan removes the shard', async (t) => {
  const { call, dataTier0Dir } = setup(t);
  await call('POST', '/plan', '', { team: 'borealis', sprintN: 5 });
  const file = path.join(dataTier0Dir, 'sprint-planning', 'plans', 'borealis-5.json');
  assert.ok(fs.existsSync(file));
  assert.equal((await call('DELETE', '/plan', 'id=borealis-5')).body.deleted, true);
  assert.ok(!fs.existsSync(file));
  assert.equal((await call('DELETE', '/plan', 'id=borealis-5')).statusCode, 404);
});

test('PUT /settings validates, refuses a stale base and is published in GET /status', async (t) => {
  const { call } = setup(t);
  const empty = await call('GET', '/status');
  assert.deepEqual(empty.body.settings.teams, {});
  assert.equal(empty.body.settings.updatedAt, null);

  const bad = await call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { borealis: { sprintWeeks: 7, firstSprintN: 21, firstSprintStart: '2026-10-06' } } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, 'bad-settings');
  const unknown = await call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { echo: null } });
  assert.equal(unknown.statusCode, 400);

  const ok = await call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { borealis: { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' } } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body.teams.borealis, { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' });

  const stale = await call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { borealis: null } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error, 'stale');

  const status = await call('GET', '/status');
  assert.equal(status.body.settings.teams.borealis.sprintWeeks, 2);
  const cleared = await call('PUT', '/settings', '', { baseUpdatedAt: status.body.settings.updatedAt, teams: { borealis: null } });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.body.teams, {});
});

test('settings drive new plan dates; one longer sprint shifts the next; resetDates restores the cadence', async (t) => {
  const { call } = setup(t);
  await call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { borealis: { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' } } });

  const s21 = await call('POST', '/plan', '', { team: 'borealis', sprintN: 21 });
  assert.equal(s21.statusCode, 201);
  assert.deepEqual([s21.body.dateFrom, s21.body.dateTo, s21.body.datesSource], ['2026-10-06', '2026-10-20', 'settings']);

  // Exception: sprint 21 runs three weeks; the settings stay at two.
  const longer = await call('PUT', '/plan', 'id=borealis-21', { baseUpdatedAt: s21.body.updatedAt, dateTo: '2026-10-27' });
  assert.equal(longer.statusCode, 200);
  assert.equal(longer.body.datesSource, 'manual');

  const s22 = await call('POST', '/plan', '', { team: 'borealis', sprintN: 22 });
  assert.deepEqual([s22.body.dateFrom, s22.body.dateTo], ['2026-10-27', '2026-11-10']);
  const s24 = await call('POST', '/plan', '', { team: 'borealis', sprintN: 24 });
  assert.deepEqual([s24.body.dateFrom, s24.body.dateTo], ['2026-11-24', '2026-12-08']);

  const reset = await call('PUT', '/plan', 'id=borealis-21', { baseUpdatedAt: longer.body.updatedAt, resetDates: true });
  assert.equal(reset.statusCode, 200);
  assert.deepEqual([reset.body.dateFrom, reset.body.dateTo, reset.body.datesSource], ['2026-10-06', '2026-10-20', 'settings']);

  // Before the first configured sprint, and for a team without settings, Jira dates still apply.
  const g = await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 });
  assert.equal(g.body.datesSource, 'computed');
  const noCfg = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: g.body.updatedAt, resetDates: true });
  assert.equal(noCfg.statusCode, 409);
  assert.equal(noCfg.body.error, 'no-settings');
});

test('a body that is not JSON answers 400 invalid-json on every write route', async (t) => {
  const { call } = setup(t);
  const created = (await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 })).body;
  for (const [method, p, query] of [['POST', '/plan', ''], ['PUT', '/plan', 'id=atlas-21'], ['PUT', '/settings', '']]) {
    const res = await call(method, p, query, INVALID);
    assert.equal(res.statusCode, 400, method + ' ' + p);
    assert.equal(res.body.error, 'invalid-json');
  }
  assert.equal((await call('GET', '/plan', 'id=atlas-21')).body.updatedAt, created.updatedAt);
});

test('a JSON null body is always answered, never left hanging', async (t) => {
  const { call } = setup(t);
  await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 });
  assert.equal((await call('POST', '/plan', '', null)).statusCode, 400);
  const put = await call('PUT', '/plan', 'id=atlas-21', null);
  assert.equal(put.statusCode, 409);
  assert.equal(put.body.error, 'stale');
  assert.equal((await call('PUT', '/settings', '', null)).statusCode, 400);
});

test('concurrent writes are serialised by the lock: one wins, the other gets 409', async (t) => {
  const { call } = setup(t);
  const posts = await Promise.all([
    call('POST', '/plan', '', { team: 'borealis', sprintN: 5 }),
    call('POST', '/plan', '', { team: 'borealis', sprintN: 5 }),
  ]);
  assert.deepEqual(posts.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal(posts.find((r) => r.statusCode === 409).body.error, 'exists');
  const cfg = { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' };
  const puts = await Promise.all([
    call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { borealis: cfg } }),
    call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { atlas: cfg } }),
  ]);
  assert.deepEqual(puts.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(puts.find((r) => r.statusCode === 409).body.error, 'stale');
});

test('a corrupt shard is never treated as missing: POST keeps it, GET and PUT answer 409 corrupt', async (t) => {
  const { call, dataTier0Dir } = setup(t);
  const dir = path.join(dataTier0Dir, 'sprint-planning', 'plans');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'borealis-5.json');
  const conflict = '<<<<<<< HEAD\n{"id":"borealis-5"}\n=======\n{}\n>>>>>>> origin\n';
  fs.writeFileSync(file, conflict);
  const post = await call('POST', '/plan', '', { team: 'borealis', sprintN: 5 });
  assert.equal(post.statusCode, 409);
  assert.equal(post.body.error, 'exists');
  assert.equal(fs.readFileSync(file, 'utf8'), conflict, 'the shard is left untouched');
  assert.equal((await call('GET', '/plan', 'id=borealis-5')).body.error, 'corrupt');
  assert.equal((await call('PUT', '/plan', 'id=borealis-5', { baseUpdatedAt: 'x' })).body.error, 'corrupt');
  // A shard whose id does not match its file name is corrupt too and absent from the list.
  fs.writeFileSync(path.join(dir, 'borealis-6.json'), JSON.stringify({ id: 'borealis-7' }));
  assert.equal((await call('GET', '/plan', 'id=borealis-6')).statusCode, 409);
  const status = await call('GET', '/status');
  assert.deepEqual(status.body.plans, []);
  assert.equal((await call('DELETE', '/plan', 'id=borealis-5')).statusCode, 200);
});

test('PUT /plan: missing id 404, resetDates validation, invalid manual dates', async (t) => {
  const { call } = setup(t);
  assert.equal((await call('PUT', '/plan', 'id=borealis-9', { baseUpdatedAt: 'x' })).statusCode, 404);
  const created = (await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 })).body;
  const base = created.updatedAt;
  const falsy = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: base, resetDates: false });
  assert.equal(falsy.statusCode, 400);
  assert.equal(falsy.body.error, 'bad-patch');
  const combined = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: base, resetDates: true, dateTo: '2026-11-10' });
  assert.equal(combined.statusCode, 400);
  for (const dates of [{ dateFrom: '2026-11-10', dateTo: '2026-11-03' }, { dateTo: '2026-02-30' }, { dateFrom: '2026-10-01', dateTo: '2026-11-13' }]) {
    const res = await call('PUT', '/plan', 'id=atlas-21', { baseUpdatedAt: base, ...dates });
    assert.equal(res.statusCode, 400, JSON.stringify(dates));
    assert.equal(res.body.error, 'bad-patch');
  }
  assert.equal((await call('GET', '/plan', 'id=atlas-21')).body.updatedAt, base, 'refused patches write nothing');
});

test('GET /context: 42-day boundary, order, impossible date and unknown team', async (t) => {
  const { call } = setup(t);
  const q = (team, from, to) => call('GET', '/context', 'team=' + team + '&from=' + from + '&to=' + to);
  assert.equal((await q('atlas', '2026-10-01', '2026-11-12')).statusCode, 200);
  assert.equal((await q('atlas', '2026-10-01', '2026-11-13')).body.error, 'bad-range');
  assert.equal((await q('atlas', '2026-11-03', '2026-10-20')).body.error, 'bad-range');
  assert.equal((await q('atlas', '2026-02-30', '2026-03-02')).body.error, 'bad-range');
  assert.equal((await q('bogus', '2026-10-20', '2026-11-03')).body.error, 'bad-team');
});

test('GET /context reads duty shards across a year boundary and skips months without a shard', async (t) => {
  const { call } = setup(t);
  const res = await call('GET', '/context', 'team=atlas&from=2026-12-22&to=2027-01-05');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.duties.available, true);
  assert.deepEqual(res.body.duties.entries.map((e) => e.date), ['2027-01-04']);
});

test('sources answer available: false instead of throwing when team data is missing', async (t) => {
  const none = setup(t, { empty: true });
  const k = await none.call('GET', '/context', 'team=atlas&from=2026-10-20&to=2026-11-03');
  assert.equal(k.statusCode, 200);
  assert.equal(k.body.roster.available, false);
  assert.equal(k.body.duties.available, false);
  assert.equal(k.body.absences.available, false);
  assert.equal(k.body.history.available, false);
  assert.deepEqual(k.body.history.sprints, []);
  const s = await none.call('GET', '/status');
  assert.equal(s.statusCode, 200);
  assert.equal(s.body.storage, 'unavailable');
  assert.deepEqual(s.body.boards, { main: null, ops: null });
  assert.deepEqual(s.body.plans, []);
});

test('sources tolerate malformed files: bad slug, non-array entries, broken team file', async (t) => {
  const { call, dataTier0Dir } = setup(t);
  const read = () => call('GET', '/context', 'team=atlas&from=2026-10-20&to=2026-11-03');
  fs.writeFileSync(path.join(dataTier0Dir, 'time-off', 'people', 'alex-morgan.json'), JSON.stringify({ name: 'Alex', entries: 'x' }));
  assert.deepEqual((await read()).body.absences.persons, []);
  fs.writeFileSync(path.join(dataTier0Dir, 'on-call', 'months', '2026-10.json'), JSON.stringify({ entries: { not: 'an array' } }));
  assert.deepEqual((await read()).body.duties.entries, []);
  fs.writeFileSync(path.join(dataTier0Dir, 'team', 'team-members.json'), '{ not json');
  assert.equal((await read()).body.roster.available, false);
  fs.writeFileSync(path.join(dataTier0Dir, 'sprint-stats', 'index.json'), JSON.stringify({ sprints: 'x' }));
  const hist = (await read()).body.history;
  assert.equal(hist.available, true);
  assert.deepEqual(hist.sprints, []);
  fs.writeFileSync(path.join(dataTier0Dir, 'sprint-stats', 'index.json'), '{ not json');
  assert.equal((await read()).body.history.available, false);
});

test('settings: a corrupt file refuses the save, bad per-team entries are dropped', async (t) => {
  const { call, dataTier0Dir } = setup(t);
  const file = path.join(dataTier0Dir, 'sprint-planning', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const good = { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' };

  fs.writeFileSync(file, JSON.stringify({ updatedAt: 'T1', teams: { borealis: { sprintWeeks: 'x', firstSprintN: 21, firstSprintStart: '2026-10-06' }, atlas: { ...good, firstSprintStart: 'bad' }, comet: good, echo: good } }));
  const status = await call('GET', '/status');
  assert.deepEqual(Object.keys(status.body.settings.teams), ['comet']);
  assert.equal(status.body.settings.updatedAt, 'T1');
  // A bad entry no longer breaks POST /plan (it used to throw inside the lock).
  const post = await call('POST', '/plan', '', { team: 'borealis', sprintN: 21 });
  assert.equal(post.statusCode, 201);
  assert.notEqual(post.body.datesSource, 'settings');

  for (const broken of ['{ conflict', JSON.stringify({ teams: [] }), JSON.stringify([])]) {
    fs.writeFileSync(file, broken);
    const put = await call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { borealis: good } });
    assert.equal(put.statusCode, 409, broken);
    assert.equal(put.body.error, 'settings-corrupt');
    assert.equal(fs.readFileSync(file, 'utf8'), broken, 'the broken file is not overwritten');
  }
});

test('before the first configured sprint the Jira dates still apply', async (t) => {
  const { call } = setup(t);
  await call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { atlas: { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-20' } } });
  const before = await call('POST', '/plan', '', { team: 'atlas', sprintN: 20 });
  assert.equal(before.statusCode, 201);
  assert.deepEqual([before.body.dateFrom, before.body.dateTo, before.body.datesSource], ['2026-10-06', '2026-10-20', 'jira']);
  const first = await call('POST', '/plan', '', { team: 'atlas', sprintN: 21 });
  assert.deepEqual([first.body.dateFrom, first.body.dateTo, first.body.datesSource], ['2026-10-20', '2026-11-03', 'settings']);
});

test('a manual Monday-Friday exception does not push the next sprint onto a weekend', async (t) => {
  const { call } = setup(t);
  await call('PUT', '/settings', '', { baseUpdatedAt: null, teams: { borealis: { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' } } });
  const s21 = (await call('POST', '/plan', '', { team: 'borealis', sprintN: 21 })).body;
  const edited = await call('PUT', '/plan', 'id=borealis-21', { baseUpdatedAt: s21.updatedAt, dateTo: '2026-10-19' });
  assert.equal(edited.statusCode, 200);
  const s22 = await call('POST', '/plan', '', { team: 'borealis', sprintN: 22 });
  assert.deepEqual([s22.body.dateFrom, s22.body.dateTo], ['2026-10-20', '2026-11-03']);
});
