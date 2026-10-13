// modules/prod-bugs/tests/test_server_routes.mjs
// register(ctx) with a fake ctx and DATA_SUB_REPOS_DIR on a temp tree - never
// the developer's own ds-data checkout.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const register = require('../server/index.js');

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function makeCtx(rootDir) {
  return {
    moduleId: 'prod-bugs',
    dataDir: path.join(rootDir, '.module-data'),
    rootDir,
    log: () => {},
    jsonResponse: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async () => ({}),
    checkOrigin: () => true,
    makeLock: () => (fn) => Promise.resolve(fn()),
  };
}

function route(routes, method, p) {
  const r = routes.find((x) => x.method === method && x.path === p);
  if (!r) throw new Error('no route ' + method + ' ' + p);
  return r;
}

async function callJson(routes, p, query) {
  const res = { status: null, body: null };
  await route(routes, 'GET', p).handler({ url: p + (query ? '?' + query : ''), method: 'GET' }, res);
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

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === null) delete process.env[k]; else process.env[k] = vars[k]; }
  const restore = () => { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } };
  let result;
  try { result = fn(); } catch (e) { restore(); throw e; }
  return Promise.resolve(result).finally(restore);
}

function seededRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-bugs-routes-'));
  const progress = path.join(root, 'ds-data', 'prod-bugs');
  fs.mkdirSync(progress, { recursive: true });
  for (const f of ['prod-bugs-sprint-3.json', 'prod-bugs-sprint-12.json', 'manifest.json']) {
    fs.copyFileSync(path.join(FIXTURES, f), path.join(progress, f));
  }
  return root;
}

test('GET /overview without a clone: 200, storage unavailable, empty lists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-bugs-empty-'));
  await withEnv({ DATA_SUB_REPOS_DIR: root }, async () => {
    const { routes } = register(makeCtx(root));
    const res = await callJson(routes, '/overview');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.storage, 'unavailable');
    assert.deepStrictEqual(res.body.sprints, []);
    assert.deepStrictEqual(res.body.availableSprints, []);
    assert.strictEqual(res.body.fetchedAt, null);
  });
});

test('GET /overview with fixtures: scan wins over the manifest, fetchedAt is the newest', async () => {
  const root = seededRoot();
  await withEnv({ DATA_SUB_REPOS_DIR: root, JIRA_URL: 'https://j.example/' }, async () => {
    const { routes } = register(makeCtx(root));
    const res = await callJson(routes, '/overview');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.storage, 'ok');
    assert.deepStrictEqual(res.body.availableSprints, [3, 12]);
    assert.strictEqual(res.body.sprints.length, 2);
    assert.deepStrictEqual(res.body.manifestSprints, [3]);
    assert.strictEqual(res.body.jira_url, 'https://j.example');
    const stamps = res.body.sprints.map((s) => s.fetchedAt).sort();
    assert.strictEqual(res.body.fetchedAt, stamps[stamps.length - 1]);
  });
});

test('GET /sprint: bad-n 400, not-found 404, shard 200', async () => {
  const root = seededRoot();
  await withEnv({ DATA_SUB_REPOS_DIR: root }, async () => {
    const { routes } = register(makeCtx(root));
    const bad = await callJson(routes, '/sprint', 'sprint=abc');
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.error, 'bad-n');
    assert.strictEqual((await callJson(routes, '/sprint')).status, 400);
    const missing = await callJson(routes, '/sprint', 'sprint=99');
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.body.error, 'not-found');
    const ok = await callJson(routes, '/sprint', 'sprint=3');
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.sprint, 3);
  });
});

test('GET /refresh-stream: refusals arrive as an error event and spawn nothing', async () => {
  const cp = require('node:child_process');
  const origSpawn = cp.spawn;
  const origSync = cp.spawnSync;
  let spawned = 0;
  cp.spawn = (...a) => { spawned += 1; return origSpawn(...a); };
  cp.spawnSync = (...a) => { spawned += 1; return origSync(...a); };
  try {
    const root = seededRoot();
    const { routes } = register(makeCtx(root));
    const h = route(routes, 'GET', '/refresh-stream').handler;
    const ask = async () => {
      const res = new FakeSseRes();
      await h({ url: '/refresh-stream', method: 'GET', socket: { setTimeout() {} }, on() {}, removeListener() {} }, res);
      return res.text;
    };
    // test mode first
    const t1 = await withEnv({ DATA_SUB_REPOS_DIR: root, NODE_ENV: 'test', JIRA_TOKEN: 'x' }, ask);
    assert.match(t1, /event: error/);
    assert.match(t1, /"error":"test-mode"/);
    // outside test mode, no token
    const t2 = await withEnv({ DATA_SUB_REPOS_DIR: root, NODE_ENV: 'production', COCKPIT_EMBEDDED: null, JIRA_TOKEN: null, JIRA_TECH_TOKEN: null }, ask);
    assert.match(t2, /"error":"no-token"/);
    assert.match(t2, /Bitwarden vault/);
    // token set but no clone
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-bugs-noclone-'));
    const t3 = await withEnv({ DATA_SUB_REPOS_DIR: empty, NODE_ENV: 'production', COCKPIT_EMBEDDED: null, JIRA_TOKEN: 'x' }, ask);
    assert.match(t3, /"error":"data-missing"/);
    assert.strictEqual(spawned, 0, 'a refusal must not spawn or probe anything');
  } finally {
    cp.spawn = origSpawn;
    cp.spawnSync = origSync;
  }
});

test('GET /widget: counters of the newest shard, a series of totals, no bug lists', async () => {
  const root = seededRoot();
  await withEnv({ DATA_SUB_REPOS_DIR: root }, async () => {
    const { routes } = register(makeCtx(root));
    const res = await callJson(routes, '/widget');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.storage, 'ok');
    assert.strictEqual(res.body.latest.sprint, 12);
    assert.strictEqual(res.body.latest.areas.platform.bugs, 58);
    assert.strictEqual(res.body.latest.areas.orders.bugFixTime, null, 'a missing fix time stays null, not 0');
    assert.deepStrictEqual(res.body.series.map((s) => s.sprint), [3, 12]);
    assert.strictEqual(res.body.series[1].bugs, 64);
    assert.strictEqual(res.body.series[1].areas.platform, 58);
    assert.strictEqual(typeof res.body.series[1].priorities, 'object');
    assert.ok(!JSON.stringify(res.body).includes('APP-'), 'no bug keys or titles leave the server');
    for (const k of ['orders', 'otherModules', 'platform']) {
      for (const forbidden of ['openBugs', 'resolvedBugs', 'summary']) {
        assert.ok(!(forbidden in res.body.latest.areas[k]), k + '.' + forbidden + ' must not leave the server');
      }
    }
  });
});

test('GET /widget without a clone: 200 with an empty answer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-bugs-widget-empty-'));
  await withEnv({ DATA_SUB_REPOS_DIR: root }, async () => {
    const { routes } = register(makeCtx(root));
    const res = await callJson(routes, '/widget');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.storage, 'unavailable');
    assert.strictEqual(res.body.latest, null);
    assert.deepStrictEqual(res.body.series, []);
  });
});
