import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const c = require('../server/compute.js');
const store = require('../server/store.js');
const { createRoutes } = require('../server/index.js');

const H = 3600;
const wl = (day, secs, key) => ({
  author: { name: 'alex@example.com', displayName: 'Alex' }, dateStarted: day + 'T09:00:00.000+0200', timeSpentSeconds: secs, issue: { key },
});

test('aggregateWorklogs + splitByMonth keep days per author, split at the month boundary', () => {
  const agg = c.aggregateWorklogs([wl('2026-01-31', H, 'A-1'), wl('2026-02-01', 2 * H, 'A-1'), wl('2026-02-01', H, 'A-2')]);
  const split = c.splitByMonth(agg, ['2026-01', '2026-02']);
  assert.deepStrictEqual(split['2026-01'].authors[0].days, { '2026-01-31': { 'A-1': H } });
  assert.deepStrictEqual(split['2026-02'].authors[0].days, { '2026-02-01': { 'A-1': 2 * H, 'A-2': H } });
});

const shardV3 = (month, days) => {
  const split = c.splitByMonth(c.aggregateWorklogs(days.map(([d, s, k]) => wl(d, s, k))), [month]);
  return { schemaVersion: 3, month, authors: split[month].authors, issues: {} };
};

test('clipShard: whole month untouched; cut month filtered by day; v2 keeps the month and flags it', () => {
  const sh = shardV3('2026-01', [['2026-01-10', H, 'A-1'], ['2026-01-20', 2 * H, 'A-1']]);
  assert.strictEqual(c.clipShard(sh, '2025-12-15', '2026-02-10').clipped, false);
  const cut = c.clipShard(sh, '2026-01-15', '2026-03-01');
  assert.strictEqual(cut.clipped, true);
  assert.strictEqual(cut.shard.authors[0].seconds, 2 * H);
  assert.deepStrictEqual(cut.shard.authors[0].issues, { 'A-1': 2 * H });
  assert.strictEqual(c.clipShard(sh, '2026-01-21', '2026-03-01').shard.authors.length, 0);
  const v2 = { schemaVersion: 2, month: '2026-01', authors: [{ key: 'alex@example.com', displayName: 'Alex', seconds: 3 * H, issues: { 'A-1': 3 * H } }] };
  const r = c.clipShard(v2, '2026-01-15', '2026-03-01');
  assert.strictEqual(r.noDaily, true);
  assert.strictEqual(r.shard.authors[0].seconds, 3 * H);
});

function setup(shards) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'costs-range-'));
  const priv = path.join(base, 'priv');
  const tier0 = path.join(base, 'tier0');
  const dataDir = path.join(base, 'cache');
  fs.mkdirSync(path.join(tier0, 'team'), { recursive: true });
  fs.mkdirSync(dataDir);
  fs.mkdirSync(priv);
  fs.writeFileSync(path.join(tier0, 'team', 'team-members.json'), JSON.stringify({ team_members: [{ id: 'tm-1', first_name: 'Alex', last_name: 'Morgan', email: 'alex@example.com' }] }));
  fs.mkdirSync(path.join(priv, 'costs'), { recursive: true });
  fs.writeFileSync(path.join(priv, 'costs', 'config.json'), JSON.stringify({ schemaVersion: 1, members: [{ id: 'tm-1', name: 'Alex Morgan', included: true, areas: ['borealis'] }] }));
  fs.writeFileSync(path.join(priv, 'costs', 'team-rates.json'), JSON.stringify({ team_rates: [{ name: 'Alex Morgan', daily_rate: 800 }] }));
  const root = priv;
  const entries = [];
  for (const sh of shards) {
    store.writeJsonPrivate(root, store.shardRelPath(sh.month), sh);
    entries.push({ month: sh.month, fetchedAt: 'x', dateFrom: sh.month + '-01', dateTo: c.lastDayOfMonth(sh.month), partial: false });
  }
  store.writeIndex(root, c.buildIndex(null, entries, { now: 'x' }));
  let last = null;
  const ctx = {
    dataRepoDir: () => priv, dataTier0Dir: tier0, dataDir, log: () => {},
    makeLock: () => (fn) => Promise.resolve().then(fn),
    jsonResponse: (_res, status, body) => { last = { status, body }; },
    readBody: async () => ({}),
  };
  const api = createRoutes(ctx, { http: () => null, now: () => new Date(2026, 9, 9), env: {} });
  const call = async (p, query) => {
    await api.routes.find((r) => r.method === 'GET' && r.path === p).handler({ url: '/x' + query }, {});
    return last;
  };
  return { call };
}

test('/data from-to across a month boundary filters at day level', async () => {
  const { call } = setup([
    shardV3('2026-01', [['2026-01-30', 8 * H, 'A-1'], ['2026-01-05', 8 * H, 'A-1']]),
    shardV3('2026-02', [['2026-02-02', 8 * H, 'A-1'], ['2026-02-20', 8 * H, 'A-1']]),
  ]);
  const r = await call('/data', '?from=2026-01-30&to=2026-02-02');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.months, ['2026-01', '2026-02']);
  const p = r.body.persons[0];
  assert.strictEqual(p.months['2026-01'].hours, 8);
  assert.strictEqual(p.months['2026-02'].hours, 8);
  assert.strictEqual(p.total.cost, 1600);
  assert.ok(r.body.monthInfo.every((m) => m.clipped && !m.noDaily));
  const t = await call('/epics', '?from=2026-01-30&to=2026-02-02&area=borealis');
  assert.strictEqual(t.body.epics[0].total.hours, 16);
});

test('/data from-to across a year boundary; v2 month is kept whole and flagged', async () => {
  const v2 = { schemaVersion: 2, month: '2025-12', authors: [{ key: 'alex@example.com', displayName: 'Alex', seconds: 16 * H, issues: { 'A-1': 16 * H } }], issues: {} };
  const { call } = setup([v2, shardV3('2026-01', [['2026-01-03', 8 * H, 'A-1'], ['2026-01-25', 8 * H, 'A-1']])]);
  const r = await call('/data', '?from=2025-12-20&to=2026-01-10');
  assert.deepStrictEqual(r.body.months, ['2025-12', '2026-01']);
  assert.strictEqual(r.body.persons[0].months['2025-12'].hours, 16);
  assert.strictEqual(r.body.persons[0].months['2026-01'].hours, 8);
  assert.strictEqual(r.body.monthInfo[0].noDaily, true);
  assert.strictEqual(r.body.monthInfo[1].noDaily, false);
  const bad = await call('/data', '?from=2026-02-01&to=2026-01-01');
  assert.strictEqual(bad.status, 400);
  const st = await call('/status', '');
  assert.strictEqual(st.body.dateMin, '2025-12-01');
  assert.strictEqual(st.body.dateMax, '2026-01-31');
});
