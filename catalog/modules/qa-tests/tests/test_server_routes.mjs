// modules/qa-tests/tests/test_server_routes.mjs
// Contract test: register(ctx) returns { routes } with the required routes.
// Does NOT start a real server - all ctx calls are stubs.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const registerModule = require('../server/index.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-tests-route-test-'));
}

function makeCtx(rootDir) {
  return {
    moduleId: 'qa-tests',
    dataDir: path.join(rootDir, '.module-data'),
    rootDir,
    log: () => {},
    jsonResponse: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async () => ({}),
    checkOrigin: () => true,
    makeLock: () => (fn) => Promise.resolve().then(fn),
  };
}

function findRoute(routes, method, urlPath) {
  const route = routes.find((r) => r.method === method && r.path === urlPath);
  if (!route) throw new Error('no route ' + method + ' ' + urlPath);
  return route;
}

function fakeRes() {
  const written = [];
  return {
    status: null,
    body: null,
    writableEnded: false,
    headersSent: false,
    statusCode: 200,
    headers: {},
    writeHead(code, hdrs) { this.statusCode = code; this.headersSent = true; Object.assign(this.headers, hdrs || {}); },
    flushHeaders() {},
    write(chunk) { written.push(chunk); return true; },
    end() { this.writableEnded = true; },
    on() {},
    removeListener() {},
    socket: { setTimeout() {} },
    _written: written,
  };
}

// -- T1: register returns the required routes --------------------------------

test('T1: register(ctx) returns { routes } with GET /overview and GET /refresh-stream', () => {
  const root = tmpDir();
  const ctx = makeCtx(root);
  const { routes } = registerModule(ctx);

  assert.ok(Array.isArray(routes), 'routes must be an array');
  findRoute(routes, 'GET', '/overview');
  findRoute(routes, 'GET', '/refresh-stream');
  assert.strictEqual(routes.length, 2, 'expected exactly 2 routes');
});

// -- T2: GET /overview returns expected shape --------------------------------

test('T2: GET /overview returns { storage, index, python, jira_url }', async () => {
  const root = tmpDir();
  const ctx = makeCtx(root);
  const { routes } = registerModule(ctx);
  const route = findRoute(routes, 'GET', '/overview');
  const res = fakeRes();
  const req = { url: '/overview', method: 'GET', on() {}, removeListener() {}, socket: { setTimeout() {} } };

  route.handler(req, res);

  assert.ok(res.body !== null, 'jsonResponse should have been called');
  assert.ok('storage' in res.body, 'body must have storage');
  assert.ok('index' in res.body, 'body must have index');
  assert.ok('python' in res.body, 'body must have python');
  assert.ok('jira_url' in res.body, 'body must have jira_url');
  // No team data clone in the test root -> unavailable
  assert.strictEqual(res.body.storage, 'unavailable');
  assert.ok(res.body.index && typeof res.body.index === 'object', 'index must be an object');
  assert.ok(typeof res.body.python.available === 'boolean', 'python.available must be a boolean');
});

// -- T3: GET /refresh-stream in test mode returns SSE with error:test-mode --

test('T3: GET /refresh-stream in COCKPIT_EMBEDDED test mode emits error:test-mode over SSE', async () => {
  const saved = process.env.COCKPIT_EMBEDDED;
  process.env.COCKPIT_EMBEDDED = '1';
  try {
    const root = tmpDir();
    const ctx = makeCtx(root);
    const { routes } = registerModule(ctx);
    const route = findRoute(routes, 'GET', '/refresh-stream');

    const written = [];
    const res = {
      writableEnded: false,
      writeHead() {},
      flushHeaders() {},
      write(chunk) { written.push(String(chunk)); return true; },
      end() { this.writableEnded = true; },
      on() {},
      removeListener() {},
      socket: { setTimeout() {} },
    };
    const req = { url: '/refresh-stream', method: 'GET', on() {}, removeListener() {}, socket: { setTimeout() {} } };

    await route.handler(req, res);

    const combined = written.join('');
    assert.ok(combined.includes('"test-mode"') || combined.includes('test-mode'), 'SSE should contain test-mode error');
  } finally {
    if (saved === undefined) delete process.env.COCKPIT_EMBEDDED;
    else process.env.COCKPIT_EMBEDDED = saved;
  }
});

// -- T4: cross-site guard -----------------------------------------------------
// Security review 2026-10-08: core checks the Origin only for non-GET routes,
// and /refresh-stream starts a 20-minute Jira fetch on a GET (server/same-site.js).

test('T4: every GET *-stream route refuses a cross-site request before its handler runs', async () => {
  const { isSameSiteRequest } = require('../server/same-site.js');
  assert.strictEqual(isSameSiteRequest({ 'sec-fetch-site': 'same-origin' }), true);
  assert.strictEqual(isSameSiteRequest({}), true, 'curl from the terminal sends no Sec-Fetch-Site');
  assert.strictEqual(isSameSiteRequest({ 'sec-fetch-site': 'cross-site' }), false);
  assert.strictEqual(isSameSiteRequest({ 'sec-fetch-site': 'same-site' }), false);
  assert.strictEqual(isSameSiteRequest({ origin: 'https://evil.example' }), false);
  assert.strictEqual(isSameSiteRequest({ 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3001' }), true);

  const root = tmpDir();
  const { routes } = registerModule(makeCtx(root));
  const streams = routes.filter((r) => r.method === 'GET' && /-stream$/.test(r.path));
  assert.ok(streams.some((r) => r.path === '/refresh-stream'));
  for (const r of streams) {
    const res = fakeRes();
    const req = {
      url: r.path, method: 'GET', headers: { 'sec-fetch-site': 'cross-site' },
      on() {}, removeListener() {}, socket: { setTimeout() {} },
    };
    await r.handler(req, res);
    assert.strictEqual(res.status, 403, r.path);
    assert.strictEqual(res.body.error, 'cross-site', r.path);
    assert.strictEqual(res.headersSent, false, r.path + ' must not start a stream');
    assert.deepStrictEqual(res._written, [], r.path + ' must not write SSE frames');
  }
});

// -- T5: ctx.dataRepoDir decides the storage path ------------------------------

test('T5: GET /overview reads storage through ctx.dataRepoDir; null means unavailable', () => {
  const root = tmpDir();
  const dp = path.join(root, 'plain-data-tier-0');
  fs.mkdirSync(path.join(dp, 'jira'), { recursive: true });
  fs.writeFileSync(path.join(dp, 'jira', 'x.json'), '{}');

  const asked = [];
  const okCtx = { ...makeCtx(root), dataRepoDir: (name) => { asked.push(name); return dp; } };
  const okRes = fakeRes();
  findRoute(registerModule(okCtx).routes, 'GET', '/overview').handler({ url: '/overview', method: 'GET' }, okRes);
  assert.deepStrictEqual(asked, ['data-tier-0']);
  assert.strictEqual(okRes.body.storage, 'ok');

  const nullCtx = { ...makeCtx(root), dataRepoDir: () => null };
  const nullRes = fakeRes();
  findRoute(registerModule(nullCtx).routes, 'GET', '/overview').handler({ url: '/overview', method: 'GET' }, nullRes);
  assert.strictEqual(nullRes.body.storage, 'unavailable');
});
