import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRoutes } = require('../server/index.js');

const ROSTER = { team_members: [
  { id: 'tm-1', first_name: 'Alex', last_name: 'Morgan', email: 'alex@example.com', role: 'PO', team: 'Borealis' },
  { id: 'tm-2', first_name: 'Sam', last_name: 'River', email: 'sam@example.com', role: 'Dev', team: 'Borealis' },
] };
const NOW = new Date(2026, 9, 9, 12, 0, 0);

function setup({ withPrivate = true, seed = true, http = null, env = { JIRA_TOKEN: 'tok' } } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'costs-routes-'));
  const priv = path.join(base, 'priv');
  const tier0 = path.join(base, 'tier0');
  const dataDir = path.join(base, 'cache');
  fs.mkdirSync(path.join(tier0, 'team'), { recursive: true });
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(tier0, 'team', 'team-members.json'), JSON.stringify(ROSTER));
  if (withPrivate) {
    fs.mkdirSync(priv);
    if (seed) {
      fs.mkdirSync(path.join(priv, 'costs'), { recursive: true });
      fs.writeFileSync(path.join(priv, 'costs', 'team-rates.json'), JSON.stringify({ team_rates: [] }));
    }
  }
  let last = null;
  const ctx = {
    dataRepoDir: () => priv, dataTier0Dir: tier0, dataDir, log: () => {},
    makeLock: () => (fn) => Promise.resolve().then(fn),
    jsonResponse: (_res, status, body) => { last = { status, body }; },
    readBody: async (req) => req.body,
  };
  const api = createRoutes(ctx, { http: () => http, now: () => NOW, env });
  const call = async (method, p, body, query) => {
    const route = api.routes.find((r) => r.method === method && r.path === p);
    await route.handler({ url: '/x' + (query || ''), body }, {});
    return last;
  };
  return { priv, base, api, call };
}

const fakeHttp = (worklogs) => ({ fetchJson: async () => worklogs });
const wl = (name, day, secs) => ({ author: { name, displayName: name }, dateStarted: day + 'T08:00:00.000+0000', timeSpentSeconds: secs });

test('registers exactly seven routes', () => {
  const { api } = setup();
  assert.strictEqual(api.routes.length, 7);
});

test('GET /data with the private dir absent answers 200 unavailable', async () => {
  const { call } = setup({ withPrivate: false });
  const r = await call('GET', '/data');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.storage, 'unavailable');
});

test('GET /data?year reads only the shards of that year', async () => {
  const { priv, call } = setup();
  const dir = path.join(priv, 'costs', 'hours');
  fs.mkdirSync(dir, { recursive: true });
  const sh = (month, secs) => ({ schemaVersion: 1, month, fetchedAt: 't', dateFrom: month + '-01', dateTo: month + '-28', partial: false, authors: [{ key: 'alex@example.com', displayName: 'Alex Morgan', seconds: secs }] });
  for (const [m, s] of [['2025-12', 36000], ['2026-01', 3600], ['2026-02', 3600]]) fs.writeFileSync(path.join(dir, m + '.json'), JSON.stringify(sh(m, s)));
  await call('POST', '/config', { id: 'tm-1', included: true, areas: ['borealis'] });
  const r = await call('GET', '/data', null, '?year=2026');
  assert.deepStrictEqual(r.body.months, ['2026-01', '2026-02']);
  assert.strictEqual(r.body.persons[0].total.hours, 2);
  assert.ok(!fs.existsSync(path.join(dir, 'index.json')), 'a read never writes the index');
});

test('POST /rate with the dir absent is 409 and creates nothing', async () => {
  const { priv, call } = setup({ withPrivate: false });
  const r = await call('POST', '/rate', { id: 'tm-1', daily_rate: 100 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'data-missing');
  assert.strictEqual(fs.existsSync(priv), false);
});

test('POST /rate validates, rounds and clears', async () => {
  const { priv, call } = setup();
  for (const bad of [-1, 1000001, '12', undefined]) assert.strictEqual((await call('POST', '/rate', { id: 'tm-1', daily_rate: bad })).status, 400);
  assert.strictEqual((await call('POST', '/rate', { id: 'nope', daily_rate: 1 })).status, 400);
  const ok = await call('POST', '/rate', { id: 'tm-1', daily_rate: 1234.567 });
  assert.strictEqual(ok.body.daily_rate, 1234.57);
  assert.deepStrictEqual(fs.readdirSync(priv).sort(), ['costs']);
  assert.deepStrictEqual(fs.readdirSync(path.join(priv, 'costs')).sort(), ['team-rates.json']);
  await call('POST', '/rate', { id: 'tm-1', daily_rate: null });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(priv, 'costs', 'team-rates.json'), 'utf8')).team_rates, []);
});

test('POST /config rejects unknown ids and areas, upserts otherwise', async () => {
  const { call } = setup();
  assert.strictEqual((await call('POST', '/config', { id: 'zzz', included: true })).status, 400);
  assert.strictEqual((await call('POST', '/config', { id: 'tm-1', areas: ['xx'] })).status, 400);
  const ok = await call('POST', '/config', { id: 'tm-1', included: true, areas: ['delta', 'borealis'] });
  assert.deepStrictEqual(ok.body.member.areas, ['borealis', 'delta']);
});

test('POST /config stores, validates and clears endDate ("works until")', async () => {
  const { call } = setup();
  assert.strictEqual((await call('POST', '/config', { id: 'tm-1', endDate: '2026-02-30' })).status, 400);
  assert.strictEqual((await call('POST', '/config', { id: 'tm-1', endDate: 'June 2026' })).status, 400);
  const set = await call('POST', '/config', { id: 'tm-1', included: true, endDate: '2026-06-30' });
  assert.strictEqual(set.body.member.endDate, '2026-06-30');
  const keep = await call('POST', '/config', { id: 'tm-1', areas: ['borealis'] });
  assert.strictEqual(keep.body.member.endDate, '2026-06-30');
  const cleared = await call('POST', '/config', { id: 'tm-1', endDate: null });
  assert.strictEqual(cleared.body.member.endDate, undefined);
});

test('POST /refresh: test mode, bad ranges', async () => {
  const off = setup();
  assert.strictEqual((await off.call('POST', '/refresh', {})).body.error, 'test-mode');
  const on = setup({ http: fakeHttp([]) });
  for (const body of [{ dateFrom: '2026-03-02', dateTo: '2026-04-01' }, { dateFrom: '2025-01-01', dateTo: '2026-02-01' }, { dateFrom: '2026-10-01', dateTo: '2026-11-01' }]) {
    const r = await on.call('POST', '/refresh', body);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error, 'bad-range');
  }
});

test('POST /refresh rewrites only the months of the range and writes the index last', async () => {
  const { priv, api, call } = setup({ http: fakeHttp([wl('alex@example.com', '2026-03-10', 3600), wl('alex@example.com', '2026-04-02', 7200)]) });
  const dir = path.join(priv, 'costs', 'hours');
  fs.mkdirSync(dir, { recursive: true });
  const jan = JSON.stringify({ schemaVersion: 1, month: '2026-01', fetchedAt: 'old', dateFrom: '2026-01-01', dateTo: '2026-01-31', partial: false, authors: [] });
  fs.writeFileSync(path.join(dir, '2026-01.json'), jan);
  const r = await call('POST', '/refresh', { dateFrom: '2026-03-01', dateTo: '2026-04-15' });
  assert.strictEqual(r.status, 202);
  const again = await call('POST', '/refresh', { dateFrom: '2026-03-01', dateTo: '2026-04-15' });
  assert.strictEqual(again.body.error, 'job-running');
  await api.idle();
  assert.strictEqual(fs.readFileSync(path.join(dir, '2026-01.json'), 'utf8'), jan);
  const apr = JSON.parse(fs.readFileSync(path.join(dir, '2026-04.json'), 'utf8'));
  assert.strictEqual(apr.partial, true);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepStrictEqual(idx.months.map((m) => m.month), ['2026-01', '2026-03', '2026-04']);
  const st = await call('GET', '/status');
  assert.strictEqual(st.body.job.running, false);
});

test('POST /refresh: an unrecognised Tempo body fails the job and writes nothing', async () => {
  for (const bad of [{}, { errorMessages: ['x'] }, { worklogs: 'nope' }]) {
    const { priv, api, call } = setup({ http: fakeHttp(bad) });
    const dir = path.join(priv, 'costs', 'hours');
    fs.mkdirSync(dir, { recursive: true });
    const jan = JSON.stringify({ schemaVersion: 1, month: '2026-03', fetchedAt: 'old', dateFrom: '2026-03-01', dateTo: '2026-03-31', partial: false, authors: [{ key: 'a', displayName: 'A', seconds: 60 }] });
    fs.writeFileSync(path.join(dir, '2026-03.json'), jan);
    assert.strictEqual((await call('POST', '/refresh', { dateFrom: '2026-03-01', dateTo: '2026-03-31' })).status, 202);
    await api.idle();
    assert.strictEqual(fs.readFileSync(path.join(dir, '2026-03.json'), 'utf8'), jan);
    const st = await call('GET', '/status');
    assert.strictEqual(st.body.lastRun.ok, false);
    assert.strictEqual(st.body.lastRun.error, 'bad-response');
  }
});

test('POST /refresh: a month that had authors is not overwritten by an empty one', async () => {
  const { priv, api, call } = setup({ http: fakeHttp({ worklogs: [wl('alex@example.com', '2026-04-02', 7200)] }) });
  const dir = path.join(priv, 'costs', 'hours');
  fs.mkdirSync(dir, { recursive: true });
  const mar = JSON.stringify({ schemaVersion: 1, month: '2026-03', fetchedAt: 'old', dateFrom: '2026-03-01', dateTo: '2026-03-31', partial: false, authors: [{ key: 'a', displayName: 'A', seconds: 60 }] });
  fs.writeFileSync(path.join(dir, '2026-03.json'), mar);
  await call('POST', '/refresh', { dateFrom: '2026-03-01', dateTo: '2026-04-15' });
  await api.idle();
  assert.strictEqual(fs.readFileSync(path.join(dir, '2026-03.json'), 'utf8'), mar);
  assert.ok(fs.existsSync(path.join(dir, '2026-04.json')));
  const st = await call('GET', '/status');
  assert.deepStrictEqual(st.body.lastRun.skippedMonths, ['2026-03']);
  assert.match(st.body.lastRun.note, /skipped/);
});

test('writes into an empty (cleared) plaintext dir are 409 data-missing and create nothing', async () => {
  const { priv, call } = setup({ seed: false });
  assert.strictEqual((await call('POST', '/rate', { id: 'tm-1', daily_rate: 100 })).status, 409);
  assert.strictEqual((await call('POST', '/config', { id: 'tm-1', included: true, areas: ['borealis'] })).status, 409);
  assert.strictEqual((await call('POST', '/config', { external: true, name: 'Test Person', areas: ['borealis'] })).status, 409);
  assert.strictEqual((await call('POST', '/refresh', { dateFrom: '2026-03-01', dateTo: '2026-03-31' })).status, 409);
  assert.deepStrictEqual(fs.readdirSync(priv), []);
});

test('config.json without team-rates.json: the first /rate creates costs/team-rates.json', async () => {
  const { priv, call } = setup({ seed: false });
  fs.mkdirSync(path.join(priv, 'costs'), { recursive: true });
  fs.writeFileSync(path.join(priv, 'costs', 'config.json'), JSON.stringify({ schemaVersion: 1, members: [] }));
  assert.strictEqual((await call('POST', '/rate', { id: 'tm-1', daily_rate: 100 })).status, 200);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(priv, 'costs', 'team-rates.json'), 'utf8')).team_rates, [{ name: 'Alex Morgan', daily_rate: 100 }]);
  assert.ok(!fs.existsSync(path.join(priv, 'team-rates.json')), 'nothing is written outside costs/');
});

test('corrupt team-rates.json: /rate answers 500 read-failed and leaves the file untouched', async () => {
  const { priv, call } = setup();
  const file = path.join(priv, 'costs', 'team-rates.json');
  fs.writeFileSync(file, '{ not json');
  const r = await call('POST', '/rate', { id: 'tm-1', daily_rate: 100 });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.body.error, 'read-failed');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('corrupt config.json: /config answers 500 read-failed and leaves the file untouched', async () => {
  const { priv, call } = setup();
  fs.mkdirSync(path.join(priv, 'costs'), { recursive: true });
  const file = path.join(priv, 'costs', 'config.json');
  fs.writeFileSync(file, '[oops');
  const r = await call('POST', '/config', { id: 'tm-1', included: true, areas: ['borealis'] });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '[oops');
});
