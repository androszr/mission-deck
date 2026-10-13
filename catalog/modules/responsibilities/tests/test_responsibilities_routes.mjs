// createRoutes against a temp DATA_SUB_REPOS_DIR - never the real team data tree.
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

const NOW = () => new Date(2026, 8, 29, 12, 0, 0);

function makeLock() {
  let chain = Promise.resolve();
  return (fn) => { const run = chain.then(() => fn()); chain = run.catch(() => {}); return run; };
}

function setup(t, { createDir = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-routes-'));
  const po = path.join(base, 'ds-data');
  if (createDir) fs.mkdirSync(po, { recursive: true });
  const prev = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = base;
  t.after(() => {
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
    fs.rmSync(base, { recursive: true, force: true });
  });
  let body = {};
  const ctx = {
    moduleId: 'responsibilities', dataDir: base, rootDir: base, log: () => {},
    jsonResponse: (res, status, b) => { res.statusCode = status; res.body = b; },
    readBody: async () => body, checkOrigin: () => true, makeLock,
  };
  const { routes } = createRoutes(ctx, { now: NOW });
  const call = async (method, p, b, query) => {
    const r = routes.find((x) => x.method === method && x.path === p);
    assert.ok(r, 'no route ' + method + ' ' + p);
    body = b || {};
    const res = { statusCode: null, body: null };
    await r.handler({ url: '/api/m/responsibilities' + p + (query || '') }, res);
    return res;
  };
  return { po, call };
}

test('GET /data: missing directory -> storage unavailable', async (t) => {
  const { call } = setup(t, { createDir: false });
  const res = await call('GET', '/data', null, '?project=main');
  assert.equal(res.body.storage, 'unavailable');
  assert.equal(res.body.available, false);
});

test('POST /prepare: creates the shell with four months, idempotent', async (t) => {
  const { po, call } = setup(t);
  const a = await call('POST', '/prepare', { project: 'web' });
  assert.equal(a.body.initialized, true);
  assert.deepEqual(a.body.months, ['2026-09', '2026-10', '2026-11', '2026-12']);
  assert.ok(fs.existsSync(path.join(po, 'responsibilities', 'web.json')));
  const b = await call('POST', '/prepare', { project: 'web' });
  assert.equal(b.body.initialized, false);
  assert.equal(b.body.monthsAdded, 0);
});

test('POST /prepare without the team data directory -> 409 data-missing', async (t) => {
  const { call } = setup(t, { createDir: false });
  const res = await call('POST', '/prepare', {});
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'data-missing');
});

test('corrupt file -> 409 corrupt-file and the bytes stay untouched', async (t) => {
  const { po, call } = setup(t);
  const file = path.join(po, 'responsibilities', 'main.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ "meta": broken');
  const before = fs.readFileSync(file);
  for (const [p, b] of [['/prepare', {}], ['/groups/add', { name: 'X' }], ['/groups/delete', { groupId: 'g' }]]) {
    const res = await call('POST', p, b);
    assert.equal(res.statusCode, 409, p);
    assert.equal(res.body.error, 'corrupt-file', p);
  }
  assert.ok(before.equals(fs.readFileSync(file)));
  const data = await call('GET', '/data', null, '?project=main');
  assert.equal(data.body.reason, 'corrupt');
});

test('bad project -> 400', async (t) => {
  const { call } = setup(t);
  assert.equal((await call('POST', '/groups/add', { project: 'nope', name: 'X' })).statusCode, 400);
  assert.equal((await call('GET', '/data', null, '?project=nope')).statusCode, 400);
});

async function seed(call) {
  const g = await call('POST', '/groups/add', { name: 'Teams' });
  const g2 = await call('POST', '/groups/add', { name: 'Processes' });
  const a = await call('POST', '/areas/add', { groupId: g.body.group.id, name: 'Locations', owner: 'Alex Morgan', description: 'desc' });
  return { g: g.body.group, g2: g2.body.group, a: a.body.area };
}

test('/rating: red without actions -> 400; green saves with updated_at and adds the month', async (t) => {
  const { call } = setup(t);
  const { g, a } = await seed(call);
  const bad = await call('POST', '/rating', { groupId: g.id, areaId: a.id, month: '2026-08', status: 'red' });
  assert.equal(bad.statusCode, 400);
  const badMonth = await call('POST', '/rating', { groupId: g.id, areaId: a.id, month: '2026-13', status: 'green' });
  assert.equal(badMonth.statusCode, 400);
  const ok = await call('POST', '/rating', { groupId: g.id, areaId: a.id, month: '2026-08', status: 'green' });
  assert.equal(ok.body.status, 'saved');
  const data = await call('GET', '/data', null, '?project=main');
  const rating = data.body.data.groups[0].areas[0].ratings['2026-08'];
  assert.equal(rating.status, 'green');
  assert.ok(rating.updated_at);
  assert.ok(data.body.data.months.includes('2026-08'));
});

test('groups: add / rename / delete', async (t) => {
  const { call } = setup(t);
  const { g } = await seed(call);
  assert.equal((await call('POST', '/groups/rename', { groupId: g.id, name: 'Renamed' })).body.status, 'saved');
  assert.equal((await call('POST', '/groups/rename', { groupId: 'nope', name: 'Renamed' })).statusCode, 404);
  assert.equal((await call('POST', '/groups/delete', { groupId: g.id })).body.status, 'deleted');
  const data = await call('GET', '/data', null, '?project=main');
  assert.equal(data.body.data.groups.length, 1);
});

test('areas: add / move to another group / delete', async (t) => {
  const { call } = setup(t);
  const { g, g2, a } = await seed(call);
  const mv = await call('POST', '/areas/rename', { groupId: g.id, areaId: a.id, targetGroupId: g2.id, name: 'Locations2', owner: 'Sam Rivera' });
  assert.equal(mv.body.status, 'saved');
  let data = await call('GET', '/data', null, '?project=main');
  assert.equal(data.body.data.groups[0].areas.length, 0);
  assert.equal(data.body.data.groups[1].areas[0].name, 'Locations2');
  assert.equal((await call('POST', '/areas/delete', { groupId: g2.id, areaId: a.id })).body.status, 'deleted');
  data = await call('GET', '/data', null, '?project=main');
  assert.equal(data.body.data.groups[1].areas.length, 0);
  assert.equal((await call('POST', '/areas/add', { groupId: g.id, name: '', owner: 'x' })).statusCode, 400);
});

test('two parallel writes to one project do not lose each other', async (t) => {
  const { call } = setup(t);
  await call('POST', '/prepare', {});
  await Promise.all([1, 2, 3, 4, 5].map((i) => call('POST', '/groups/add', { name: 'G' + i })));
  const data = await call('GET', '/data', null, '?project=main');
  assert.equal(data.body.data.groups.length, 5);
});
