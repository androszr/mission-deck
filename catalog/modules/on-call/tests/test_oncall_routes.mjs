// on-call/tests/test_oncall_routes.mjs
// createRoutes(ctx, { http, now }) against a temp dataTier0Dir/dataDir and a
// fake http client - never the network, never process.env.CONFLUENCE_TOKEN /
// ONCALL_PAGE_ID unless a test sets them and restores them in t.after.

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

const FIXTURE_HTML = fs.readFileSync(path.join(DIR, 'tests', 'fixtures', 'oncall-schedule.html'), 'utf8');
const NOW = () => new Date(2026, 8, 13, 12, 0, 0); // local 2026-09-13

function makeTmpDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oncall-routes-'));
  const dataTier0Dir = path.join(base, 'team-data');
  const dataDir = path.join(base, 'module-data');
  fs.mkdirSync(dataTier0Dir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  return { base, dataTier0Dir, dataDir };
}

function makeLock() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(() => fn());
    chain = run.catch(() => {});
    return run;
  };
}

function makeCtx(dataTier0Dir, dataDir) {
  return {
    moduleId: 'on-call',
    dataTier0Dir,
    dataDir,
    rootDir: DIR,
    log: () => {},
    jsonResponse: (res, status, body) => { res.statusCode = status; res.body = body; },
    readBody: async () => ({}),
    checkOrigin: () => true,
    makeLock: () => makeLock(),
  };
}

function findRoute(routes, method, p) {
  const r = routes.find((x) => x.method === method && x.path === p);
  assert.ok(r, 'no route ' + method + ' ' + p);
  return r;
}

function makeFakeRes() {
  return { statusCode: null, body: null };
}

function makeFakeReq(url, method) {
  return { url: url || '/', method: method || 'GET' };
}

function fakeHttpOk() {
  let calls = 0;
  const http = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'application/json' : '') },
      json: async () => ({
        title: 'On-call schedule',
        version: { number: 27, when: '2026-08-25T09:00:00.000Z' },
        _links: { webui: '/pages/viewpage.action?pageId=100001' },
        body: { export_view: { value: FIXTURE_HTML } },
      }),
    };
  };
  http.callCount = () => calls;
  return http;
}

function setEnv(t, values) {
  const prev = {};
  for (const [k, v] of Object.entries(values)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function fakeHttpThrows() {
  return async () => { throw new Error('network down'); };
}

function fakeHttpStatus(status) {
  return async () => ({
    ok: false,
    status,
    headers: { get: (name) => (name === 'content-type' ? 'application/json' : '') },
    json: async () => ({ message: 'nope' }),
  });
}

test('oncall-routes: GET /data without a clone answers storage unavailable', async () => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  fs.rmSync(dataTier0Dir, { recursive: true, force: true }); // simulate "not cloned"
  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http: null, now: NOW });
  const route = findRoute(routes, 'GET', '/data');
  const res = makeFakeRes();
  route.handler(makeFakeReq('/data'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.available, false);
  assert.equal(res.body.storage, 'unavailable');
});

test('oncall-routes: GET /data with a bad month answers 400 bad-month', async () => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http: null, now: NOW });
  const route = findRoute(routes, 'GET', '/data');
  const res = makeFakeRes();
  route.handler(makeFakeReq('/data?month=2026-13'), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad-month');
});

test('oncall-routes: POST /sync without a clone answers 409 data-missing, http never called', async () => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  fs.rmSync(dataTier0Dir, { recursive: true, force: true });
  const ctx = makeCtx(dataTier0Dir, dataDir);
  const http = fakeHttpOk();
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const route = findRoute(routes, 'POST', '/sync');
  const res = makeFakeRes();
  await route.handler(makeFakeReq('/sync', 'POST'), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'data-missing');
  assert.equal(http.callCount(), 0);
});

test('oncall-routes: POST /sync without CONFLUENCE_TOKEN answers 409 no-confluence-token, http never called', async (t) => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir, dataDir);
  setEnv(t, { CONFLUENCE_TOKEN: undefined, ONCALL_PAGE_ID: '100001' });

  const http = fakeHttpOk();
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const route = findRoute(routes, 'POST', '/sync');
  const res = makeFakeRes();
  await route.handler(makeFakeReq('/sync', 'POST'), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'no-confluence-token');
  assert.equal(http.callCount(), 0);
});

test('oncall-routes: POST /sync with a fake http writes shards, keeps an untouched older month, saves the raw HTML', async (t) => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir, dataDir);
  setEnv(t, { CONFLUENCE_TOKEN: 'test-token-123', ONCALL_PAGE_ID: '100001' });

  // A pre-existing older month, untouched by the fixture's Aug/Sep entries.
  const monthsDir = path.join(dataTier0Dir, 'on-call', 'months');
  fs.mkdirSync(monthsDir, { recursive: true });
  fs.writeFileSync(path.join(monthsDir, '2026-07.json'), JSON.stringify({ month: '2026-07', entries: [] }), 'utf8');

  const http = fakeHttpOk();
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const route = findRoute(routes, 'POST', '/sync');
  const res = makeFakeRes();
  await route.handler(makeFakeReq('/sync', 'POST'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.months, ['2026-07', '2026-08', '2026-09']);

  const indexFile = path.join(dataTier0Dir, 'on-call', 'index.json');
  assert.ok(fs.existsSync(indexFile));
  assert.ok(fs.existsSync(path.join(monthsDir, '2026-08.json')));
  assert.ok(fs.existsSync(path.join(monthsDir, '2026-09.json')));
  assert.ok(fs.existsSync(path.join(monthsDir, '2026-07.json')), 'the older shard is kept as history');

  const rawHtmlFile = path.join(dataDir, 'last-fetch.html');
  assert.ok(fs.existsSync(rawHtmlFile));
  assert.ok(fs.readFileSync(rawHtmlFile, 'utf8').includes('On-call schedule'));
});

test('oncall-routes: a throwing http answers 502 confluence-unreachable, no file under on-call/ changed', async (t) => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir, dataDir);
  setEnv(t, { CONFLUENCE_TOKEN: 'test-token-123', ONCALL_PAGE_ID: '100001' });

  const moduleDir = path.join(dataTier0Dir, 'on-call');
  assert.equal(fs.existsSync(moduleDir), false);

  const http = fakeHttpThrows();
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const route = findRoute(routes, 'POST', '/sync');
  const res = makeFakeRes();
  await route.handler(makeFakeReq('/sync', 'POST'), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'confluence-unreachable');
  assert.equal(fs.existsSync(moduleDir), false, 'nothing under on-call/ was created by a failed fetch');
});

test('oncall-routes: GET /data?month=2026-08 after a sync answers real entries and 12 roster rows', async (t) => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir, dataDir);
  setEnv(t, { CONFLUENCE_TOKEN: 'test-token-123', ONCALL_PAGE_ID: '100001' });

  const http = fakeHttpOk();
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const syncRoute = findRoute(routes, 'POST', '/sync');
  await syncRoute.handler(makeFakeReq('/sync', 'POST'), makeFakeRes());

  const dataRoute = findRoute(routes, 'GET', '/data');
  const res = makeFakeRes();
  dataRoute.handler(makeFakeReq('/data?month=2026-08'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.available, true);
  assert.ok(res.body.month.entries.length > 0);
  assert.equal(res.body.index.roster.length, 12);
});

test('oncall-routes: a 401 from Confluence answers 502 confluence-http with the status in the message, nothing written to team data', async (t) => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir, dataDir);
  setEnv(t, { CONFLUENCE_TOKEN: 'expired-token', ONCALL_PAGE_ID: '100001' });

  const { routes } = createRoutes(ctx, { http: fakeHttpStatus(401), now: NOW });
  const route = findRoute(routes, 'POST', '/sync');
  const res = makeFakeRes();
  await route.handler(makeFakeReq('/sync', 'POST'), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'confluence-http');
  assert.match(res.body.message, /401/);
  assert.equal(fs.existsSync(path.join(dataTier0Dir, 'on-call')), false);

  // the job flag is released, so the next click is not answered with job-running
  const res2 = makeFakeRes();
  await route.handler(makeFakeReq('/sync', 'POST'), res2);
  assert.equal(res2.body.error, 'confluence-http');
});

test('oncall-routes: POST /sync without ONCALL_PAGE_ID answers 409 not-configured, http never called', async (t) => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir, dataDir);
  setEnv(t, { CONFLUENCE_TOKEN: 'test-token-123', ONCALL_PAGE_ID: undefined });
  const http = fakeHttpOk();
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const res = makeFakeRes();
  await findRoute(routes, 'POST', '/sync').handler(makeFakeReq('/sync', 'POST'), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'not-configured');
  assert.equal(http.callCount(), 0);
});

test('oncall-routes: the page URL comes from the configured base URL and page id', async (t) => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  setEnv(t, { CONFLUENCE_BASE_URL: 'https://wiki.example.com/', ONCALL_PAGE_ID: '4242' });
  const { routes } = createRoutes(makeCtx(dataTier0Dir, dataDir), { http: null, now: NOW });
  const res = makeFakeRes();
  findRoute(routes, 'GET', '/data').handler(makeFakeReq('/data'), res);
  assert.equal(res.body.pageUrl, 'https://wiki.example.com/pages/viewpage.action?pageId=4242');
});
