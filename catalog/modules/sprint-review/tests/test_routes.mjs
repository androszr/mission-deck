// modules/sprint-review/tests/test_routes.mjs
// createRoutes(ctx, { http, now, env }) against a temp dataTier0Dir and a
// fake http client - never the network, never process.env.CONFLUENCE_TOKEN.
//
// The fixtures are confluence-page.json (id 441589397, four teams, Echo with
// two topic sections) and confluence-children.json.

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
const CHILDREN_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'confluence-children.json'), 'utf8'));
const PAGE_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'confluence-page.json'), 'utf8'));
const PAGE_ID = PAGE_FIXTURE.id;

const NOW = () => new Date('2026-09-13T09:00:00.000Z');
const TOKEN = 'super-secret-confluence-token';

function makeTmpDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-review-routes-'));
  const dataTier0Dir = path.join(base, 'ds-data');
  fs.mkdirSync(dataTier0Dir, { recursive: true });
  return { base, dataTier0Dir };
}

/** storageState() reads 'unavailable' for an existing-but-empty directory
 * (same junk-filter rule as sprint-stats) - most tests want the "repo is
 * cloned" state, so they call this after makeTmpDirs(). */
function seedRepo(dataTier0Dir) {
  fs.writeFileSync(path.join(dataTier0Dir, 'team-marker.json'), '{}', 'utf8');
}

function makeLock() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(() => fn());
    chain = run.catch(() => {});
    return run;
  };
}

function makeCtx(dataTier0Dir) {
  const logCalls = [];
  return {
    moduleId: 'sprint-review',
    dataTier0Dir,
    rootDir: DIR,
    log: (...args) => { logCalls.push(args.join(' ')); },
    _logCalls: logCalls,
    jsonResponse: (res, status, body) => { res.statusCode = status; res.body = body; },
    readBody: async (req) => req._body,
    checkOrigin: () => true,
    makeLock: () => makeLock(),
  };
}

function findRoute(routes, method, p) {
  const r = routes.find((x) => x.method === method && x.path === p);
  assert.ok(r, 'no route ' + method + ' ' + p);
  return r;
}

function makeReq(url, body) {
  return { url, _body: body };
}

function makeRes() {
  return { statusCode: null, body: null };
}

/** Fake fetch-shaped http: routes on URL substring, returns a fetch Response lookalike. */
function fakeHttp(handlers) {
  return async (url) => {
    for (const [needle, respond] of handlers) {
      if (url.includes(needle)) return respond(url);
    }
    throw new Error('unexpected URL in test: ' + url);
  };
}

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : '') }, json: async () => body };
}

function htmlRes() {
  return { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : '') }, json: async () => { throw new Error('not json'); } };
}

test('GET /sessions on an empty repository answers unavailable with an empty list', () => {
  const { dataTier0Dir } = makeTmpDirs();
  fs.rmSync(dataTier0Dir, { recursive: true, force: true });
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx, { http: null, now: NOW, env: {} });
  const res = makeRes();
  findRoute(routes, 'GET', '/sessions').handler(makeReq('/sessions'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { storage: 'unavailable', sessions: [] });
});

test('POST /sessions refuses without a cloned repo and creates a four-team shard once one exists', async () => {
  const { dataTier0Dir } = makeTmpDirs();
  const missing = { dataTier0Dir: path.join(dataTier0Dir, 'missing') };
  const ctxMissing = makeCtx(missing.dataTier0Dir);
  const routesMissing = createRoutes(ctxMissing, { http: null, now: NOW, env: {} }).routes;
  const resMissing = makeRes();
  await findRoute(routesMissing, 'POST', '/sessions').handler(makeReq('/sessions', { reviewDate: '2026-09-17' }), resMissing);
  assert.equal(resMissing.statusCode, 409);
  assert.equal(resMissing.body.error, 'storage-unavailable');

  seedRepo(dataTier0Dir);
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx, { http: null, now: NOW, env: {} });
  const res = makeRes();
  await findRoute(routes, 'POST', '/sessions').handler(makeReq('/sessions', { reviewDate: '2026-09-17', facilitatorPo: 'Jordan Kim' }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.meeting, 'team-review');
  assert.deepEqual(res.body.teamGoals.map((g) => g.team), ['Atlas', 'Borealis', 'Echo', 'Delta']);
  assert.equal(fs.existsSync(path.join(dataTier0Dir, 'sprint-review', 'sessions', res.body.id + '.json')), true);

  const badRes = makeRes();
  await findRoute(routes, 'POST', '/sessions').handler(makeReq('/sessions', {}), badRes);
  assert.equal(badRes.statusCode, 400);
  assert.equal(badRes.body.error, 'reviewDate-required');
});

test('PUT /session/team rejects an unknown team, persists a single-list team, and enforces the dual-section shape', async () => {
  const { dataTier0Dir } = makeTmpDirs();
  seedRepo(dataTier0Dir);
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx, { http: null, now: NOW, env: {} });
  const created = makeRes();
  await findRoute(routes, 'POST', '/sessions').handler(makeReq('/sessions', { reviewDate: '2026-09-17' }), created);
  const id = created.body.id;

  const bad = makeRes();
  await findRoute(routes, 'PUT', '/session/team').handler(makeReq('/session/team?id=' + id + '&team=Comet', { realizationStatus: 'achieved' }), bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, 'bad-team');

  const ok = makeRes();
  await findRoute(routes, 'PUT', '/session/team').handler(makeReq('/session/team?id=' + id + '&team=Atlas', { realizationStatus: 'achieved', topics: [{ title: 'New topic', format: 'discussion', presenters: [] }] }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.submissions.Atlas.realizationStatus, 'achieved');
  assert.equal(ok.body.submissions.Atlas.topics.length, 1);

  const wrongShape = makeRes();
  await findRoute(routes, 'PUT', '/session/team').handler(makeReq('/session/team?id=' + id + '&team=Atlas', { topicsProblemSpace: [] }), wrongShape);
  assert.equal(wrongShape.statusCode, 400);
  assert.equal(wrongShape.body.error, 'bad-topics-key');

  const dualOk = makeRes();
  await findRoute(routes, 'PUT', '/session/team').handler(makeReq('/session/team?id=' + id + '&team=Echo', { topicsSolutionSpace: [{ title: 'Read layer cache', presenters: [] }] }), dualOk);
  assert.equal(dualOk.statusCode, 200);
  assert.equal(dualOk.body.submissions['Echo'].topicsSolutionSpace.length, 1);
  assert.deepEqual(dualOk.body.submissions['Echo'].topicsProblemSpace, []);

  const dualWrongShape = makeRes();
  await findRoute(routes, 'PUT', '/session/team').handler(makeReq('/session/team?id=' + id + '&team=Echo', { topics: [] }), dualWrongShape);
  assert.equal(dualWrongShape.statusCode, 400);
  assert.equal(dualWrongShape.body.error, 'bad-topics-key');

  const reread = makeRes();
  findRoute(routes, 'GET', '/session').handler(makeReq('/session?id=' + id), reread);
  assert.equal(reread.body.submissions.Atlas.realizationStatus, 'achieved', 'the write actually landed on disk');
});

test('DELETE /session removes a session and answers not-found on a second try', async () => {
  const { dataTier0Dir } = makeTmpDirs();
  seedRepo(dataTier0Dir);
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx, { http: null, now: NOW, env: {} });
  const created = makeRes();
  await findRoute(routes, 'POST', '/sessions').handler(makeReq('/sessions', { reviewDate: '2026-09-17' }), created);
  const id = created.body.id;

  const del1 = makeRes();
  await findRoute(routes, 'DELETE', '/session').handler(makeReq('/session?id=' + id), del1);
  assert.equal(del1.statusCode, 200);
  assert.deepEqual(del1.body, { deleted: true });

  const del2 = makeRes();
  await findRoute(routes, 'DELETE', '/session').handler(makeReq('/session?id=' + id), del2);
  assert.equal(del2.statusCode, 404);

  const badId = makeRes();
  await findRoute(routes, 'DELETE', '/session').handler(makeReq('/session?id=not-a-real-id'), badId);
  assert.equal(badId.statusCode, 400);
  assert.equal(badId.body.error, 'bad-id');
});

test('GET /confluence-discover: no token, HTML instead of JSON, and the real children fixture', async () => {
  const { dataTier0Dir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir);

  const noTokenRoutes = createRoutes(ctx, { http: async () => jsonRes(200, {}), now: NOW, env: {} }).routes;
  const noTokenRes = makeRes();
  await findRoute(noTokenRoutes, 'GET', '/confluence-discover').handler(makeReq('/confluence-discover'), noTokenRes);
  assert.equal(noTokenRes.statusCode, 400);
  assert.equal(noTokenRes.body.error, 'no-token');

  const htmlRoutes = createRoutes(ctx, { http: async () => htmlRes(), now: NOW, env: { CONFLUENCE_TOKEN: TOKEN } }).routes;
  const htmlOut = makeRes();
  await findRoute(htmlRoutes, 'GET', '/confluence-discover').handler(makeReq('/confluence-discover'), htmlOut);
  assert.equal(htmlOut.statusCode, 502);
  assert.equal(htmlOut.body.error, 'confluence-unreachable');
  assert.match(htmlOut.body.message, /VPN/);

  const http = fakeHttp([['/child/page', () => jsonRes(200, CHILDREN_FIXTURE)]]);
  const routes = createRoutes(ctx, { http, now: NOW, env: { CONFLUENCE_TOKEN: TOKEN } }).routes;
  const res = makeRes();
  await findRoute(routes, 'GET', '/confluence-discover').handler(makeReq('/confluence-discover'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pages.length, 3, 'the page with no date in its title is filtered out');
  assert.deepEqual(res.body.pages.map((p) => p.status), ['new', 'new', 'new'], 'no prior sessions yet - everything reads new');
  assert.deepEqual(res.body.pages.map((p) => p.sprintN), [18, 17, 15], 'sorted by sprint number descending');
});

test('POST /confluence-import: disabled in test mode, imports the four-team fixture page, and merges on re-import', async () => {
  const { dataTier0Dir } = makeTmpDirs();
  // The storage-unavailable check runs BEFORE the confluence-disabled/pageId
  // checks, and this test is about those, not about the
  // storage guard (covered by the POST /sessions test above).
  seedRepo(dataTier0Dir);
  const ctx = makeCtx(dataTier0Dir);

  const disabledRoutes = createRoutes(ctx, { http: null, now: NOW, env: { CONFLUENCE_TOKEN: TOKEN } }).routes;
  const disabledRes = makeRes();
  await findRoute(disabledRoutes, 'POST', '/confluence-import').handler(makeReq('/confluence-import?pageId=' + PAGE_ID), disabledRes);
  assert.equal(disabledRes.statusCode, 503);
  assert.equal(disabledRes.body.error, 'confluence-disabled');

  const badPageId = makeRes();
  await findRoute(disabledRoutes, 'POST', '/confluence-import').handler(makeReq('/confluence-import?pageId=not-numeric'), badPageId);
  assert.equal(badPageId.statusCode, 400);
  assert.equal(badPageId.body.error, 'pageId-required');

  const http = fakeHttp([
    ['/rest/api/user?key=', (url) => jsonRes(200, { displayName: (new URL(url).searchParams.get('key') === 'uk-po') ? 'Jordan Kim' : 'Some Presenter' })],
    ['/rest/api/content/' + PAGE_ID, () => jsonRes(200, PAGE_FIXTURE)],
  ]);
  const routes = createRoutes(ctx, { http, now: NOW, env: { CONFLUENCE_TOKEN: TOKEN } }).routes;

  const firstImport = makeRes();
  await findRoute(routes, 'POST', '/confluence-import').handler(makeReq('/confluence-import?pageId=' + PAGE_ID), firstImport);
  assert.equal(firstImport.statusCode, 201);
  assert.equal(firstImport.body.confluencePageId, PAGE_ID);
  assert.equal(firstImport.body.facilitatorPo, 'Jordan Kim');
  assert.deepEqual(firstImport.body.teamGoals.map((g) => g.team), ['Atlas', 'Borealis', 'Echo', 'Delta'], 'page order');
  assert.equal(firstImport.body.submissions.Atlas.topics.length, 2, 'the placeholder topic is skipped');
  assert.equal(firstImport.body.submissions['Echo'].topicsProblemSpace.length, 1);
  assert.equal(firstImport.body.submissions['Echo'].topicsSolutionSpace.length, 2);
  const sessionId = firstImport.body.id;

  // A manual edit between imports: adds a hand-written topic to the
  // Solution Space list that must survive the re-import.
  await findRoute(routes, 'PUT', '/session/team').handler(
    makeReq('/session/team?id=' + sessionId + '&team=Echo', {
      topicsSolutionSpace: [...firstImport.body.submissions['Echo'].topicsSolutionSpace, { title: 'Manual topic', format: 'discussion', presenters: [] }],
    }),
    makeRes(),
  );

  const secondImport = makeRes();
  await findRoute(routes, 'POST', '/confluence-import').handler(makeReq('/confluence-import?pageId=' + PAGE_ID), secondImport);
  assert.equal(secondImport.statusCode, 200, 're-import of the same page reuses the existing session');
  assert.equal(secondImport.body.id, sessionId);
  const ssTitles = secondImport.body.submissions['Echo'].topicsSolutionSpace.map((t) => t.title);
  assert.ok(ssTitles.includes('Manual topic'), 'the manual topic survives re-import');
  assert.equal(ssTitles.filter((title) => title === 'Index on the stock table').length, 1, 'the Confluence topic is not duplicated');
  assert.equal(secondImport.body.submissions.Atlas.topics.length, 2, 'Atlas, untouched between imports, is not duplicated either');

  // The token never leaks into a response body or a log line.
  const haystack = JSON.stringify([firstImport.body, secondImport.body, ...ctx._logCalls]);
  assert.equal(haystack.includes(TOKEN), false, 'the confluence token must never appear in a response or a log line');
});

test('POST /confluence-sync-all: guards, imports new pages, counts failures, skips synced pages on the next run', async () => {
  const { dataTier0Dir } = makeTmpDirs();
  const ctxEmpty = makeCtx(dataTier0Dir);
  const unavailable = makeRes();
  await findRoute(createRoutes(ctxEmpty, { http: null, now: NOW, env: {} }).routes, 'POST', '/confluence-sync-all')
    .handler(makeReq('/confluence-sync-all'), unavailable);
  assert.equal(unavailable.statusCode, 409);
  assert.equal(unavailable.body.error, 'storage-unavailable');

  seedRepo(dataTier0Dir);
  const ctx = makeCtx(dataTier0Dir);

  const disabled = makeRes();
  await findRoute(createRoutes(ctx, { http: null, now: NOW, env: { CONFLUENCE_TOKEN: TOKEN } }).routes, 'POST', '/confluence-sync-all')
    .handler(makeReq('/confluence-sync-all'), disabled);
  assert.equal(disabled.statusCode, 503);

  const noToken = makeRes();
  await findRoute(createRoutes(ctx, { http: async () => jsonRes(200, {}), now: NOW, env: {} }).routes, 'POST', '/confluence-sync-all')
    .handler(makeReq('/confluence-sync-all'), noToken);
  assert.equal(noToken.statusCode, 400);
  assert.equal(noToken.body.error, 'no-token');

  const sprint18 = { ...PAGE_FIXTURE, id: '441600002', title: '10.09.2026 Sprint 18 Review', version: { number: 1 } };
  const pageCalls = [];
  const http = fakeHttp([
    ['/child/page', () => jsonRes(200, CHILDREN_FIXTURE)],
    ['/rest/api/user?key=', () => jsonRes(200, { displayName: 'Jordan Kim' })],
    ['/rest/api/content/' + PAGE_ID, () => { pageCalls.push(PAGE_ID); return jsonRes(200, PAGE_FIXTURE); }],
    ['/rest/api/content/441600002', () => { pageCalls.push('441600002'); return jsonRes(200, sprint18); }],
    ['/rest/api/content/441500001', () => { pageCalls.push('441500001'); return jsonRes(404, {}); }],
  ]);
  const routes = createRoutes(ctx, { http, now: NOW, env: { CONFLUENCE_TOKEN: TOKEN } }).routes;

  const first = makeRes();
  await findRoute(routes, 'POST', '/confluence-sync-all').handler(makeReq('/confluence-sync-all'), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.ok, false, 'one page failed');
  assert.deepEqual(first.body.totals, { total: 3, imported: 2, refreshed: 0, unchanged: 0, failed: 1 });
  assert.equal(first.body.results.find((r) => r.pageId === '441500001').error, 'confluence-http');

  pageCalls.length = 0;
  const second = makeRes();
  await findRoute(routes, 'POST', '/confluence-sync-all').handler(makeReq('/confluence-sync-all'), second);
  assert.deepEqual(second.body.totals, { total: 3, imported: 0, refreshed: 0, unchanged: 2, failed: 1 });
  assert.deepEqual(pageCalls, ['441500001'], 'synced pages are not fetched again');
});
