// modules/devops-stats/tests/test_server_routes.mjs
// register(ctx) against a throwaway tree - never the developer's own
// data-sub-repositories/ds-data checkout.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolveFieldIds, statusTable, issueToFact, markEpics } from '../scripts/_extract.mjs';

const require = createRequire(import.meta.url);
const register = require('../server/index.js');
const store = require('../server/store.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
const fieldIds = resolveFieldIds(load('fields.json'));
const statuses = statusTable(load('project-statuses.json'));
const categoryById = new Map(statuses.map((s) => [s.id, s.category]));
const FACTS = markEpics([...load('search-page-1.json').issues, ...load('search-page-2.json').issues]
  .map((i) => issueToFact(i, { fieldIds, categoryById })));
const META = { mode: 'full', generated_at: '2026-10-01T00:00:00.000Z', fields: fieldIds, statuses };

function setup(withClone = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devops-stats-'));
  const clone = path.join(root, 'ds-data');
  if (withClone) { fs.mkdirSync(clone, { recursive: true }); fs.writeFileSync(path.join(clone, 'README.md'), 'x'); }
  let body = {};
  const ctx = {
    moduleId: 'devops-stats', dataDir: path.join(root, '.module-data'), rootDir: root, log: () => {},
    jsonResponse: (res, status, b) => { res.status = status; res.body = b; },
    readBody: async () => body,
    checkOrigin: () => true,
    makeLock: () => (fn) => Promise.resolve(fn()),
    dataRepoDir: () => clone,
  };
  return { root, clone, ctx, setBody: (b) => { body = b; }, routes: register(ctx).routes };
}

async function call(routes, method, p, query) {
  const r = routes.find((x) => x.method === method && x.path === p);
  const res = { status: null, body: null };
  await r.handler({ url: query ? p + '?' + query : p, method }, res);
  return res;
}

class FakeSseRes {
  constructor() { this.chunks = []; this.writableEnded = false; }
  writeHead() {}
  flushHeaders() {}
  write(c) { this.chunks.push(c); }
  end() { this.writableEnded = true; }
  get text() { return this.chunks.join(''); }
}

test('GET /overview: unavailable without a clone, ok with an index', async () => {
  const none = setup(false);
  const r1 = await call(none.routes, 'GET', '/overview');
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r1.body.storage, 'unavailable');
  assert.strictEqual(r1.body.index, null);

  const ok = setup();
  store.mergeIssues(ok.clone, FACTS, META);
  const r2 = await call(ok.routes, 'GET', '/overview');
  assert.strictEqual(r2.body.storage, 'ok');
  assert.strictEqual(r2.body.index.statuses.length, 4);
  assert.deepStrictEqual(r2.body.config, { blocked_status_ids: [], cancelled_status_ids: null });
  assert.ok(r2.body.jira_url.startsWith('http'));
});

test('GET /issues concatenates shards; empty when unavailable', async () => {
  const s = setup();
  store.mergeIssues(s.clone, FACTS, META);
  const r = await call(s.routes, 'GET', '/issues');
  assert.deepStrictEqual(r.body.issues.map((i) => i.key).sort(), ['DEVOPS-1', 'DEVOPS-2', 'DEVOPS-3', 'DEVOPS-4']);
  const none = await call(setup(false).routes, 'GET', '/issues');
  assert.deepStrictEqual(none.body, { issues: [] });
});

test('POST /config: 200, 400 bad-status, 409 storage-unavailable', async () => {
  const s = setup();
  store.mergeIssues(s.clone, FACTS, META);
  s.setBody({ blocked_status_ids: ['3'] });
  const ok = await call(s.routes, 'POST', '/config');
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(store.readConfig(s.clone), { blocked_status_ids: ['3'], cancelled_status_ids: null });
  s.setBody({ blocked_status_ids: ['999'] });
  assert.strictEqual((await call(s.routes, 'POST', '/config')).body.error, 'bad-status');
  s.setBody({ blocked_status_ids: 'x' });
  assert.strictEqual((await call(s.routes, 'POST', '/config')).status, 400);
  const none = setup(false);
  none.setBody({ blocked_status_ids: [] });
  const r = await call(none.routes, 'POST', '/config');
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'storage-unavailable');
});

test('mergeIssues writes shards before the index and leaves unchanged files alone', async () => {
  const s = setup();
  const first = store.mergeIssues(s.clone, FACTS, META);
  assert.strictEqual(first.written, 3); // shards 2026-08, 2026-09 + index
  const dir = store.devopsDir(s.clone);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepStrictEqual(idx.shards, [{ month: '2026-08', count: 1 }, { month: '2026-09', count: 3 }]);
  const shard = path.join(dir, 'issues-2026-09.json');
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(shard, old, old);
  const second = store.mergeIssues(s.clone, FACTS, META);
  assert.strictEqual(second.written, 0);
  assert.strictEqual(fs.statSync(shard).mtime.getTime(), old.getTime());
  assert.ok(fs.existsSync(path.join(dir, 'issues-2026-08.json')));
});

test('mergeIssues: incremental upserts by key, full with zero facts refuses', () => {
  const s = setup();
  store.mergeIssues(s.clone, FACTS, META);
  const changed = { ...FACTS[0], summary: 'Renamed' };
  store.mergeIssues(s.clone, [changed], { ...META, mode: 'incremental' });
  const all = store.readAllIssues(s.clone);
  assert.strictEqual(all.length, 4);
  assert.strictEqual(all.find((i) => i.key === 'DEVOPS-1').summary, 'Renamed');
  assert.deepStrictEqual(store.mergeIssues(s.clone, [], META), { written: 0, refused: 'etl-empty' });
  assert.strictEqual(store.readAllIssues(s.clone).length, 4);
});

test('mergeIssues keeps historic statuses on incremental; full demotes dropped project statuses', () => {
  const s = setup();
  const A = { id: '1', name: 'A', category: 'new', current: true };
  const B = { id: '2', name: 'B', category: 'done', current: false };
  store.mergeIssues(s.clone, FACTS, { ...META, statuses: [A, B] });
  store.mergeIssues(s.clone, [FACTS[0]], { ...META, mode: 'incremental', statuses: [A] });
  const ids = (d) => store.readIndex(d).statuses.map((x) => x.id).sort();
  assert.deepStrictEqual(ids(s.clone), ['1', '2']);
  const C = { id: '3', name: 'C', category: 'done', current: true };
  store.mergeIssues(s.clone, FACTS, { ...META, mode: 'full', statuses: [C] });
  const after = store.readIndex(s.clone).statuses;
  assert.deepStrictEqual(after.map((x) => x.id).sort(), ['1', '2', '3']);
  assert.strictEqual(after.find((x) => x.id === '1').current, false);
  assert.strictEqual(after.find((x) => x.id === '3').current, true);
});

test('GET /refresh-stream answers test-mode as an error event and spawns nothing', async () => {
  const prev = process.env.COCKPIT_EMBEDDED;
  process.env.COCKPIT_EMBEDDED = '1';
  try {
    const s = setup();
    const res = new FakeSseRes();
    const r = s.routes.find((x) => x.path === '/refresh-stream');
    await r.handler({ url: '/refresh-stream', method: 'GET', socket: { setTimeout() {} }, on() {}, removeListener() {} }, res);
    assert.match(res.text, /event: error/);
    assert.match(res.text, /"error":"test-mode"/);
    assert.ok(!fs.existsSync(s.ctx.dataDir));
  } finally {
    if (prev === undefined) delete process.env.COCKPIT_EMBEDDED; else process.env.COCKPIT_EMBEDDED = prev;
  }
});

test('POST /config: cancelled ids are done statuses only and a missing key keeps its saved value', async () => {
  const s = setup();
  store.mergeIssues(s.clone, FACTS, META);
  s.setBody({ blocked_status_ids: ['3'] });
  await call(s.routes, 'POST', '/config');
  // '4' (Finished) is the only done-category status of the fixture.
  s.setBody({ cancelled_status_ids: ['4'] });
  const ok = await call(s.routes, 'POST', '/config');
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(store.readConfig(s.clone), { blocked_status_ids: ['3'], cancelled_status_ids: ['4'] });
  s.setBody({ cancelled_status_ids: ['2'] });
  const bad = await call(s.routes, 'POST', '/config');
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error, 'bad-status');
  s.setBody({ blocked_status_ids: [] });
  await call(s.routes, 'POST', '/config');
  assert.deepStrictEqual(store.readConfig(s.clone), { blocked_status_ids: [], cancelled_status_ids: ['4'] });
  s.setBody({ cancelled_status_ids: [] });
  await call(s.routes, 'POST', '/config');
  assert.deepStrictEqual(store.readConfig(s.clone).cancelled_status_ids, []);
  s.setBody({});
  assert.strictEqual((await call(s.routes, 'POST', '/config')).body.error, 'bad-body');
});
