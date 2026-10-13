import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const register = require('../server/index.js');

function fakeRes() {
  const res = { chunks: [], status: null, body: null, writableEnded: false };
  res.writeHead = (s) => { res.status = s; };
  res.flushHeaders = () => {};
  res.write = (c) => { res.chunks.push(String(c)); };
  res.end = () => { res.writableEnded = true; };
  return res;
}
function fakeReq() {
  const r = new EventEmitter();
  r.socket = { setTimeout() {} };
  return r;
}
function setup(repo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-'));
  const calls = [];
  const ctx = {
    moduleId: 'usage-analytics', rootDir: tmp, dataDir: tmp, log: () => {},
    dataRepoDir: () => repo,
    jsonResponse: (res, status, body) => { calls.push({ status, body }); },
    readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(),
  };
  const routes = Object.fromEntries(register(ctx).routes.map((r) => [r.path, r.handler]));
  return { routes, calls };
}
function sseError(res) {
  const frame = res.chunks.find((c) => c.startsWith('event: error'));
  return frame ? JSON.parse(frame.split('data: ')[1]) : null;
}
const KEYS = ['AMPLITUDE_COCKPIT_API_KEY', 'AMPLITUDE_COCKPIT_SECRET_KEY', 'COCKPIT_EMBEDDED', 'NODE_ENV'];
function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return Promise.resolve(fn()).finally(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}

test('GET /refresh-stream refuses under test mode and never fetches', () => withEnv({ COCKPIT_EMBEDDED: '1' }, async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-repo-'));
  const { routes } = setup(repo);
  const res = fakeRes();
  await routes['/refresh-stream'](fakeReq(), res);
  assert.strictEqual(sseError(res).error, 'test-mode');
  assert.match(sseError(res).message, /disabled/);
}));

test('GET /refresh-stream refuses without keys with a readable message', () => withEnv({}, async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-repo-'));
  const { routes } = setup(repo);
  const res = fakeRes();
  await routes['/refresh-stream'](fakeReq(), res);
  const err = sseError(res);
  assert.strictEqual(err.error, 'no-keys');
  assert.match(err.message, /Amplitude keys for Mission Deck are missing/);
}));

test('GET /status and /data answer calmly when the team repo is missing', () => withEnv({}, async () => {
  const { routes, calls } = setup(path.join(os.tmpdir(), 'ac-does-not-exist-' + process.pid));
  routes['/status'](fakeReq(), fakeRes());
  assert.strictEqual(calls[0].body.storage, 'unavailable');
  assert.strictEqual(calls[0].body.keysPresent, false);
  routes['/data'](fakeReq(), fakeRes());
  assert.strictEqual(calls[1].status, 200);
  assert.strictEqual(calls[1].body.error, 'storage-unavailable');
  const res = fakeRes();
  await routes['/refresh-stream'](fakeReq(), res);
  assert.strictEqual(sseError(res).error, 'storage-unavailable');
}));

test('GET /data answers no-data for an empty repo and the aggregate once written', () => withEnv({}, async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-repo-'));
  const { routes, calls } = setup(repo);
  routes['/data'](fakeReq(), fakeRes());
  assert.strictEqual(calls[0].body.error, 'no-data');
  fs.mkdirSync(path.join(repo, 'usage-analytics'));
  fs.writeFileSync(path.join(repo, 'usage-analytics', 'aggregated.json'), JSON.stringify({ schemaVersion: 1, last_full_day: '2026-10-08' }));
  routes['/data'](fakeReq(), fakeRes());
  assert.strictEqual(calls[1].body.ok, true);
  assert.strictEqual(calls[1].body.aggregate.last_full_day, '2026-10-08');
}));

const PERSON_KEYS = ['users', 'by_user', 'user_id', 'display_name', 'aliases', 'last_seen', 'first_seen', 'errors'];
function keysDeep(v, acc = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.add(k); keysDeep(x, acc); }
  return acc;
}

test('GET /widget: module-level numbers only, no per-person key anywhere', () => withEnv({}, async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-repo-'));
  const { routes, calls } = setup(repo);
  routes['/widget'](fakeReq(), fakeRes());
  assert.strictEqual(calls[0].body.error, 'no-data');
  const daily = Array.from({ length: 30 }, (_, i) => ({ date: '2026-09-' + String(i + 1).padStart(2, '0'), page_views: i, active_users: 2 }));
  const person = { user_id: 'jordan.lee', display_name: 'Jordan Lee', aliases: ['jl'], page_views: 5, by_user: [{ user_id: 'jordan.lee' }] };
  const agg = {
    schemaVersion: 1, generated_at: '2026-10-09T10:00:00Z', last_full_day: '2026-10-08',
    modules: { a: { name: 'A' }, b: { name: 'B' } },
    periods: {
      '7': { kpi: { active_users: 41, sessions: 312, page_views: 2940, modules_in_use: 2, median_view_ms: 34000, delta: { active_users_pct: 8, sessions_pct: null, page_views_pct: -3 } }, daily: [], users: [person],
        modules: [{ id: 'core', name: 'Mission Deck Core', page_views: 500 }, { id: 'a', name: 'A', page_views: 1 }]
          .concat(Array.from({ length: 7 }, (_, i) => ({ id: 'm' + i, name: 'Module ' + i, page_views: 100 - i, users: 3, by_user: [person] }))) },
      '30': { kpi: {}, daily, users: [person], modules: [] },
    },
  };
  fs.mkdirSync(path.join(repo, 'usage-analytics'));
  fs.writeFileSync(path.join(repo, 'usage-analytics', 'aggregated.json'), JSON.stringify(agg));
  routes['/widget'](fakeReq(), fakeRes());
  const body = calls[1].body;
  assert.strictEqual(calls[1].status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.kpi.active_users, 41);
  assert.strictEqual(body.kpi.delta.sessions_pct, null);
  assert.strictEqual(body.daily.length, 14);
  assert.strictEqual(body.daily[13].date, '2026-09-30');
  assert.strictEqual(body.topModules.length, 5);
  assert.deepStrictEqual(body.topModules[0], { id: 'core', label: 'Mission Deck Core', page_views: 500 });
  assert.strictEqual(body.modulesTotal, 2);
  assert.strictEqual(body.modulesInUse, 1, 'only dictionary modules count: core and unknown ids do not');
  const keys = keysDeep(body);
  for (const k of PERSON_KEYS) assert.ok(!keys.has(k), 'no per-person key: ' + k);
  assert.ok(!JSON.stringify(body).includes('jordan'));
}));

test('GET /widget mirrors the storage-unavailable refusal', () => withEnv({}, async () => {
  const { routes, calls } = setup(path.join(os.tmpdir(), 'ac-does-not-exist-w-' + process.pid));
  routes['/widget'](fakeReq(), fakeRes());
  assert.strictEqual(calls[0].body.ok, false);
  assert.strictEqual(calls[0].body.error, 'storage-unavailable');
}));
