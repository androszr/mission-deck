// modules/time-log/tests/test_time_log_routes.mjs
// createRoutes(ctx, { http, now }) against a temp dataTier0Dir/dataDir and a
// fake http client - never the network, never process.env.JIRA_TOKEN unless
// a test sets it and restores it in t.after.

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

const NOW = () => new Date(2026, 8, 13, 12, 0, 0); // local 2026-09-13 - windowDates ends 2026-09-12

function makeTmpDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'time-log-routes-'));
  const dataTier0Dir = path.join(base, 'ds-data');
  const dataDir = path.join(base, 'module-data');
  fs.mkdirSync(dataTier0Dir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  return { base, dataTier0Dir, dataDir };
}

function writeRoster(dataTier0Dir, members) {
  const teamDir = path.join(dataTier0Dir, 'team');
  fs.mkdirSync(teamDir, { recursive: true });
  fs.writeFileSync(path.join(teamDir, 'team-members.json'), JSON.stringify({ team_members: members }), 'utf8');
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
    moduleId: 'time-log',
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
  const res = { statusCode: null, body: null };
  return res;
}

function makeSseReq() {
  const listeners = {};
  return {
    on: (name, fn) => { listeners[name] = fn; },
    removeListener: () => {},
    socket: { setTimeout: () => {} },
  };
}

function makeSseRes() {
  const events = [];
  let buffer = '';
  const res = {
    writeHead: () => {},
    write: (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const m = /^event: (\S+)\ndata: (.*)$/s.exec(frame);
        if (m) events.push({ event: m[1], data: JSON.parse(m[2]) });
      }
    },
    end: () => { res.ended = true; },
  };
  res.events = events;
  return res;
}

test('GET /data without a cloned ds-data directory answers unavailable', () => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  fs.rmSync(dataTier0Dir, { recursive: true, force: true }); // simulate "never cloned"
  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http: null, now: NOW });
  const res = makeFakeRes();
  findRoute(routes, 'GET', '/data').handler({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { available: false, storage: 'unavailable', persons: [] });
});

test('GET /data with index.json and two shards returns persons in shard order', () => {
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const moduleDir = path.join(dataTier0Dir, 'time-log');
  const personsDir = path.join(moduleDir, 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  const shardA = { slug: 'amy-a', name: 'Amy A', display_short: 'A. A', email: '', team: 'Borealis', logged_days_count: 0, miss_days_count: 2, days: [] };
  const shardB = { slug: 'beth-b', name: 'Beth B', display_short: 'B. B', email: '', team: 'Borealis', logged_days_count: 1, miss_days_count: 0, days: [] };
  fs.writeFileSync(path.join(personsDir, 'amy-a.json'), JSON.stringify(shardA));
  fs.writeFileSync(path.join(personsDir, 'beth-b.json'), JSON.stringify(shardB));
  fs.writeFileSync(path.join(moduleDir, 'index.json'), JSON.stringify({
    generated_at: '2026-09-13T00:00:00.000Z', window_days: 1, dates: ['2026-09-12'],
    persons: { 'amy-a': { name: 'Amy A', team: 'Borealis', logged_days_count: 0, miss_days_count: 2 }, 'beth-b': { name: 'Beth B', team: 'Borealis', logged_days_count: 1, miss_days_count: 0 } },
    unmatched_authors: [],
  }));
  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http: null, now: NOW });
  const res = makeFakeRes();
  findRoute(routes, 'GET', '/data').handler({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.available, true);
  assert.deepStrictEqual(res.body.persons.map((p) => p.slug), ['amy-a', 'beth-b']);
});

test('GET /status reports token false without JIRA_TOKEN and honours a config.json projects override', (t) => {
  const prevToken = process.env.JIRA_TOKEN;
  delete process.env.JIRA_TOKEN;
  t.after(() => { if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken; });

  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const ctx = makeCtx(dataTier0Dir, dataDir);
  let routes = createRoutes(ctx, { http: null, now: NOW }).routes;
  let res = makeFakeRes();
  findRoute(routes, 'GET', '/status').handler({}, res);
  assert.strictEqual(res.body.token, false);
  assert.deepStrictEqual(res.body.projects, ['APP', 'WEB', 'OPS']);
  assert.strictEqual(res.body.roster, false);

  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ projects: ['APP', 'WEB'] }));
  routes = createRoutes(ctx, { http: null, now: NOW }).routes;
  res = makeFakeRes();
  findRoute(routes, 'GET', '/status').handler({}, res);
  assert.deepStrictEqual(res.body.projects, ['APP', 'WEB']);
});

test('GET /refresh-stream fetches an array page and a paginated-object page, writes shards, drops a stale one, and reports done', async (t) => {
  const prevToken = process.env.JIRA_TOKEN;
  process.env.JIRA_TOKEN = 'test-token';
  t.after(() => { if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken; });

  const { dataTier0Dir, dataDir } = makeTmpDirs();
  writeRoster(dataTier0Dir, [
    { first_name: 'Kira', last_name: 'Hale', team: 'Atlas', email: 'kira@example.com' },
    { first_name: 'Mark', last_name: 'Ross', team: 'Delta', email: 'mark@example.com' },
  ]);
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ projects: ['APP', 'WEB'] }));
  const personsDir = path.join(dataTier0Dir, 'time-log', 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(personsDir, 'stale-person.json'), JSON.stringify({ slug: 'stale-person', name: 'X', days: [] }));

  const calls = [];
  const http = {
    async fetchJson(url) {
      calls.push(url);
      const u = new URL(url);
      const projectKey = u.searchParams.get('projectKey');
      if (projectKey === 'APP') {
        return [{ author: { name: 'kira@example.com', displayName: 'Kira Hale' }, issue: { key: 'APP-5', summary: 'Review the till' }, timeSpentSeconds: 3600, dateStarted: '2026-09-12', dateCreated: '2026-09-12T09:00:00.000' }];
      }
      return { results: [{ author: { name: 'mark@example.com', displayName: 'Mark Ross' }, issue: { key: 'APP-6', summary: 'Update the price list' }, timeSpentSeconds: 1800, dateStarted: '2026-09-12', dateCreated: '2026-09-12T10:00:00.000' }] };
    },
  };

  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const req = makeSseReq();
  const res = makeSseRes();
  await findRoute(routes, 'GET', '/refresh-stream').handler(req, res);

  assert.strictEqual(calls.length, 2);
  const progressEvents = res.events.filter((e) => e.event === 'progress');
  assert.ok(progressEvents.length >= 2);
  const done = res.events.find((e) => e.event === 'done');
  assert.ok(done, 'expected a done event: ' + JSON.stringify(res.events));
  assert.strictEqual(done.data.ok, true);
  assert.strictEqual(done.data.persons, 2);
  assert.strictEqual(done.data.worklogs, 2);
  assert.strictEqual(done.data.unmatched, 0);

  assert.strictEqual(fs.existsSync(path.join(personsDir, 'stale-person.json')), false, 'stale shard must be removed');
  assert.strictEqual(fs.existsSync(path.join(personsDir, 'kira-hale.json')), true);
  assert.strictEqual(fs.existsSync(path.join(personsDir, 'mark-ross.json')), true);
  assert.strictEqual(fs.existsSync(path.join(dataTier0Dir, 'time-log', 'index.json')), true);
  const kiraShard = JSON.parse(fs.readFileSync(path.join(personsDir, 'kira-hale.json'), 'utf8'));
  const kiraDay = kiraShard.days.find((d) => d.date === '2026-09-12');
  assert.strictEqual(kiraDay.issues[0].summary, 'Review the till', 'the tooltip title must reach the written shard');
  const lastRun = JSON.parse(fs.readFileSync(path.join(dataDir, 'last-run.json'), 'utf8'));
  assert.strictEqual(lastRun.ok, true);
  assert.strictEqual(lastRun.persons, 2);
});

test('GET /refresh-stream answers no-token with zero http calls, and refuses a second run while one is in flight', async (t) => {
  const prevToken = process.env.JIRA_TOKEN;
  t.after(() => { if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken; });

  const { dataTier0Dir, dataDir } = makeTmpDirs();
  writeRoster(dataTier0Dir, [{ first_name: 'Kira', last_name: 'Hale', team: 'Atlas', email: 'kira@example.com' }]);

  delete process.env.JIRA_TOKEN;
  let calls = 0;
  const httpNoToken = { async fetchJson() { calls += 1; return []; } };
  const ctxNoToken = makeCtx(dataTier0Dir, dataDir);
  const { routes: routesNoToken } = createRoutes(ctxNoToken, { http: httpNoToken, now: NOW });
  const reqNT = makeSseReq();
  const resNT = makeSseRes();
  await findRoute(routesNoToken, 'GET', '/refresh-stream').handler(reqNT, resNT);
  assert.strictEqual(calls, 0);
  const errNT = resNT.events.find((e) => e.event === 'error');
  assert.ok(errNT);
  assert.strictEqual(errNT.data.error, 'no-token');

  process.env.JIRA_TOKEN = 'test-token';
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const httpSlow = {
    async fetchJson() {
      await gate;
      return [];
    },
  };
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ projects: ['APP'] }));
  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http: httpSlow, now: NOW });
  const route = findRoute(routes, 'GET', '/refresh-stream');

  const req1 = makeSseReq();
  const res1 = makeSseRes();
  const first = route.handler(req1, res1);

  // Let the first call's lock-protected running-flag check settle before
  // firing the second one, same ordering guarantee the real chain lock gives.
  await Promise.resolve();
  await Promise.resolve();

  const res2 = makeFakeRes();
  await route.handler({}, res2);
  assert.strictEqual(res2.statusCode, 409);
  assert.strictEqual(res2.body.error, 'job-running');

  releaseFirst();
  await first;
  const done1 = res1.events.find((e) => e.event === 'done');
  assert.ok(done1, 'first run should still complete: ' + JSON.stringify(res1.events));
});

test('GET /refresh-stream refuses the write and leaves existing shards untouched when the roster is deleted after the run has started', async (t) => {
  const prevToken = process.env.JIRA_TOKEN;
  process.env.JIRA_TOKEN = 'test-token';
  t.after(() => { if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken; });

  const { dataTier0Dir, dataDir } = makeTmpDirs();
  const rosterFile = path.join(dataTier0Dir, 'team', 'team-members.json');
  writeRoster(dataTier0Dir, [
    { first_name: 'Kira', last_name: 'Hale', team: 'Atlas', email: 'kira@example.com' },
  ]);
  const personsDir = path.join(dataTier0Dir, 'time-log', 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(personsDir, 'kira-hale.json'), JSON.stringify({ slug: 'kira-hale', name: 'Kira Hale', days: [] }));
  fs.writeFileSync(path.join(dataTier0Dir, 'time-log', 'index.json'), JSON.stringify({
    generated_at: '2026-09-01T00:00:00.000Z', window_days: 1, dates: ['2026-09-01'],
    persons: { 'kira-hale': { name: 'Kira Hale', team: 'Atlas', logged_days_count: 1, miss_days_count: 0 } },
    unmatched_authors: [],
  }));

  const http = { async fetchJson() { return []; } };
  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const req = makeSseReq();
  const res = makeSseRes();

  // The initial data-missing preflight (fs.existsSync(rosterFile), synchronous,
  // before the job lock) sees the file. Calling the async handler without
  // awaiting it runs it synchronously up to its first `await` (the job-running
  // lock) and then yields back here - so deleting the file now, before any
  // microtask runs, lands strictly after that preflight and strictly before
  // loadRoster() is reached, the same window a mid-run deletion opens for real.
  const pending = findRoute(routes, 'GET', '/refresh-stream').handler(req, res);
  fs.rmSync(rosterFile, { force: true });
  await pending;

  const err = res.events.find((e) => e.event === 'error');
  assert.ok(err, 'expected an error event: ' + JSON.stringify(res.events));
  assert.strictEqual(err.data.error, 'roster-empty');
  assert.strictEqual(fs.existsSync(path.join(personsDir, 'kira-hale.json')), true, 'the existing shard must survive an empty-roster run');
  const lastRun = JSON.parse(fs.readFileSync(path.join(dataDir, 'last-run.json'), 'utf8'));
  assert.strictEqual(lastRun.ok, false);
});

test('GET /refresh-stream refuses the write when it would remove more than 30% of the existing shards', async (t) => {
  const prevToken = process.env.JIRA_TOKEN;
  process.env.JIRA_TOKEN = 'test-token';
  t.after(() => { if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken; });

  const { dataTier0Dir, dataDir } = makeTmpDirs();
  // The roster shrank to one person - a real run would only ever confirm
  // Kira and would otherwise silently drop the other three shards already
  // on disk.
  writeRoster(dataTier0Dir, [
    { first_name: 'Kira', last_name: 'Hale', team: 'Atlas', email: 'kira@example.com' },
  ]);
  const personsDir = path.join(dataTier0Dir, 'time-log', 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  const existingSlugs = ['kira-hale', 'mark-ross', 'anna-rysy', 'piotr-morskie', 'zofia-area'];
  for (const slug of existingSlugs) {
    fs.writeFileSync(path.join(personsDir, slug + '.json'), JSON.stringify({ slug, name: slug, days: [] }));
  }
  fs.writeFileSync(path.join(dataTier0Dir, 'time-log', 'index.json'), JSON.stringify({
    generated_at: '2026-09-01T00:00:00.000Z', window_days: 1, dates: ['2026-09-01'],
    persons: Object.fromEntries(existingSlugs.map((slug) => [slug, { name: slug, team: 'Atlas', logged_days_count: 1, miss_days_count: 0 }])),
    unmatched_authors: [],
  }));

  const http = { async fetchJson() { return []; } };
  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http, now: NOW });
  const req = makeSseReq();
  const res = makeSseRes();
  await findRoute(routes, 'GET', '/refresh-stream').handler(req, res);

  const err = res.events.find((e) => e.event === 'error');
  assert.ok(err, 'expected an error event: ' + JSON.stringify(res.events));
  assert.strictEqual(err.data.error, 'destructive');
  for (const slug of existingSlugs) {
    assert.strictEqual(fs.existsSync(path.join(personsDir, slug + '.json')), true, slug + ' must survive a run that would remove most of the roster');
  }
  const lastRun = JSON.parse(fs.readFileSync(path.join(dataDir, 'last-run.json'), 'utf8'));
  assert.strictEqual(lastRun.ok, false);
});

test('GET /refresh-stream: a deadline that fires while the fetch is still running answers timeout, writes NOTHING, and keeps the job slot until the run has really stopped', async (t) => {
  const prevToken = process.env.JIRA_TOKEN;
  process.env.JIRA_TOKEN = 'test-token';
  t.after(() => { if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken; });

  const { dataTier0Dir, dataDir } = makeTmpDirs();
  writeRoster(dataTier0Dir, [{ first_name: 'Kira', last_name: 'Hale', team: 'Atlas', email: 'kira@example.com' }]);
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ projects: ['APP'] }));
  const personsDir = path.join(dataTier0Dir, 'time-log', 'people');

  // A fetch that ignores the abort signal and answers well after the
  // deadline - the shape of a Tempo call that is simply slow.
  let release;
  const http = {
    fetchJson() {
      return new Promise((resolve) => { release = () => resolve([{ author: { name: 'kira@example.com' }, issue: { key: 'APP-5', summary: 'x' }, timeSpentSeconds: 3600, dateStarted: '2026-09-12' }]); });
    },
  };

  const ctx = makeCtx(dataTier0Dir, dataDir);
  const { routes } = createRoutes(ctx, { http, now: NOW, runDeadlineMs: 30 });
  const handler = findRoute(routes, 'GET', '/refresh-stream').handler;
  const req = makeSseReq();
  const res = makeSseRes();
  const run = handler(req, res);

  await new Promise((r) => setTimeout(r, 80));
  const err = res.events.find((e) => e.event === 'error');
  assert.ok(err, 'the client is answered by the deadline: ' + JSON.stringify(res.events));
  assert.strictEqual(err.data.error, 'timeout');
  assert.strictEqual(res.ended, true);

  // The run has not stopped yet (the fetch is still pending), so a second
  // click is still refused - the slot is released by the run's own finally.
  const res2 = makeFakeRes();
  await handler({}, res2);
  assert.strictEqual(res2.statusCode, 409, 'second run while the first is still winding down');
  assert.strictEqual(res2.body.error, 'job-running');

  release();
  await run;
  assert.strictEqual(fs.existsSync(personsDir), false, 'a timed-out run must not write shards after telling the person it failed');
  assert.strictEqual(fs.existsSync(path.join(dataTier0Dir, 'time-log', 'index.json')), false);

  // Now the slot is free.
  const status = makeFakeRes();
  findRoute(routes, 'GET', '/status').handler({}, status);
  assert.strictEqual(status.body.job.running, false);
});

test('register(): test mode is read per request, not frozen at require()', async (t) => {
  const prevEmbedded = process.env.COCKPIT_EMBEDDED;
  const prevNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (prevEmbedded === undefined) delete process.env.COCKPIT_EMBEDDED; else process.env.COCKPIT_EMBEDDED = prevEmbedded;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
  });
  const { dataTier0Dir, dataDir } = makeTmpDirs();
  writeRoster(dataTier0Dir, [{ first_name: 'Kira', last_name: 'Hale', team: 'Atlas', email: 'kira@example.com' }]);
  const register = require(path.join(DIR, 'server', 'index.js'));

  delete process.env.NODE_ENV;
  delete process.env.COCKPIT_EMBEDDED;
  const { routes } = register(makeCtx(dataTier0Dir, dataDir)); // registered OUTSIDE test mode
  process.env.COCKPIT_EMBEDDED = '1'; // flipped afterwards - the next request must see it

  const req = makeSseReq();
  const res = makeSseRes();
  await findRoute(routes, 'GET', '/refresh-stream').handler(req, res);
  const err = res.events.find((e) => e.event === 'error');
  assert.ok(err, JSON.stringify(res.events));
  assert.strictEqual(err.data.error, 'test-mode', 'a frozen flag would have tried the real fetch here');
});
