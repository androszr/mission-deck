// modules/sprint-stats/tests/test_server_routes.mjs
// register(ctx) driven against a throwaway directory tree with
// DATA_SUB_REPOS_DIR pointed at it - never the developer's own
// data-sub-repositories/ds-data checkout.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const registerModule = require('../server/index.js');
const refreshJobModule = require('../server/refresh-job.js');
const storeModule = require('../server/store.js');

const FIXTURES = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fixtures');

function makeCtx(rootDir) {
  return {
    moduleId: 'sprint-stats',
    dataDir: path.join(rootDir, '.module-data'),
    rootDir,
    log: () => {},
    jsonResponse: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async () => ({}),
    checkOrigin: () => true,
    makeLock: () => (fn) => Promise.resolve(fn()),
  };
}

function findRoute(routes, method, urlPath) {
  const route = routes.find((r) => r.method === method && r.path === urlPath);
  if (!route) throw new Error('no route ' + method + ' ' + urlPath);
  return route;
}

function fakeRes() {
  return { status: null, body: null };
}

async function callJson(routes, method, urlPath, query) {
  const route = findRoute(routes, method, urlPath);
  const res = fakeRes();
  const url = query ? urlPath + '?' + query : urlPath;
  const req = { url, method };
  await route.handler(req, res);
  return res;
}

class FakeSseRes {
  constructor() {
    this.chunks = [];
    this.writableEnded = false;
  }
  writeHead() {}
  flushHeaders() {}
  write(chunk) { this.chunks.push(chunk); }
  end() { this.writableEnded = true; }
  get text() { return this.chunks.join(''); }
}

function fakeSseReq(urlPath) {
  return {
    url: urlPath,
    method: 'GET',
    socket: { setTimeout() {} },
    on() {},
    removeListener() {},
  };
}

// Writes the two synthetic sprint-16 shards (every team still active) the
// same way the ETL does, through store.mergeSprints.
function seedSprints(root) {
  const dir = path.join(root, 'ds-data');
  fs.mkdirSync(dir, { recursive: true });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  storeModule.mergeSprints(dir, [read('sprint-main-16.json'), read('sprint-platform-16.json')], { onlyMissing: false, boards: read('boards.json') });
}

test('GET /overview: an empty tree answers storage unavailable, no throw', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-empty-'));
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  try {
    const ctx = makeCtx(tmp);
    const { routes } = registerModule(ctx);
    const res = await callJson(routes, 'GET', '/overview');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.storage, 'unavailable');
    assert.deepStrictEqual(res.body.index.sprints, []);
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('GET /sprint: returns both shards, validates the numbers, missing side is null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-sprint-'));
  seedSprints(tmp);
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  try {
    const ctx = makeCtx(tmp);
    const { routes } = registerModule(ctx);

    const both = await callJson(routes, 'GET', '/sprint', 'main=16&platform=16');
    assert.strictEqual(both.status, 200);
    assert.strictEqual(both.body.main.src, 'main');
    assert.strictEqual(both.body.platform.src, 'platform');

    const mainOnly = await callJson(routes, 'GET', '/sprint', 'main=16');
    assert.strictEqual(mainOnly.body.platform, null);
    assert.ok(mainOnly.body.main);

    const badN = await callJson(routes, 'GET', '/sprint', 'main=abc');
    assert.strictEqual(badN.status, 400);
    assert.strictEqual(badN.body.error, 'bad-n');

    const noParams = await callJson(routes, 'GET', '/sprint');
    assert.strictEqual(noParams.status, 400);
    assert.strictEqual(noParams.body.error, 'bad-n');

    const missingShard = await callJson(routes, 'GET', '/sprint', 'main=999');
    assert.strictEqual(missingShard.status, 200);
    assert.strictEqual(missingShard.body.main, null);
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('GET /refresh-stream: COCKPIT_EMBEDDED=1 answers error test-mode and never spawns a process', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-refresh-'));
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  const prevEmbedded = process.env.COCKPIT_EMBEDDED;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  process.env.COCKPIT_EMBEDDED = '1';

  const spawnSpy = t.mock.method(childProcess, 'spawn', () => {
    throw new Error('should not spawn in test mode');
  });
  const spawnSyncSpy = t.mock.method(childProcess, 'spawnSync', () => {
    throw new Error('should not spawnSync in test mode');
  });

  try {
    const ctx = makeCtx(tmp);
    const { routes } = registerModule(ctx);
    const route = findRoute(routes, 'GET', '/refresh-stream');
    const res = new FakeSseRes();
    const req = fakeSseReq('/refresh-stream');
    await route.handler(req, res);
    assert.strictEqual(res.writableEnded, true);
    assert.match(res.text, /event: error/);
    assert.match(res.text, /"error":"test-mode"/);
    assert.strictEqual(spawnSpy.mock.callCount(), 0);
    assert.strictEqual(spawnSyncSpy.mock.callCount(), 0);
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    process.env.COCKPIT_EMBEDDED = prevEmbedded;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('GET /discover: COCKPIT_EMBEDDED=1 answers 200 { available: false, reason: test-mode } and never spawns a process', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-discover-testmode-'));
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  const prevEmbedded = process.env.COCKPIT_EMBEDDED;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  process.env.COCKPIT_EMBEDDED = '1';
  refreshJobModule.invalidateDiscoverCache();

  const spawnSpy = t.mock.method(childProcess, 'spawn', () => {
    throw new Error('should not spawn in test mode');
  });
  const spawnSyncSpy = t.mock.method(childProcess, 'spawnSync', () => {
    throw new Error('should not spawnSync in test mode');
  });

  try {
    const ctx = makeCtx(tmp);
    const { routes } = registerModule(ctx);
    const res = await callJson(routes, 'GET', '/discover');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { available: false, reason: 'test-mode' });
    assert.strictEqual(spawnSpy.mock.callCount(), 0);
    assert.strictEqual(spawnSyncSpy.mock.callCount(), 0);
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    process.env.COCKPIT_EMBEDDED = prevEmbedded;
    refreshJobModule.invalidateDiscoverCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('GET /refresh-stream: a failed discover refuses with discover-failed and never runs either ETL stage when force is not set', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-discoverfail-'));
  seedSprints(tmp);
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  const prevEmbedded = process.env.COCKPIT_EMBEDDED;
  const prevToken = process.env.JIRA_TOKEN;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  delete process.env.COCKPIT_EMBEDDED;
  process.env.JIRA_TOKEN = 'test-token';

  // resolvePython and loadDiscover are mocked at the property level
  // (refreshJobModule.xxx), not by monkey-patching child_process: server.js
  // reads them as `refreshJob.resolvePython(...)` / `refreshJob.loadDiscover(...)`
  // on every call (property access, not a destructured local), so this
  // intercepts the exact calls server/index.js makes without needing a real
  // or a fake Python. runEtlStage is mocked the same way, purely to prove it
  // is never reached - if it were, this throws and fails the test loudly.
  t.mock.method(refreshJobModule, 'resolvePython', () => ({ cmd: 'python3', baseArgs: [] }));
  t.mock.method(refreshJobModule, 'loadDiscover', async () => ({ available: false, reason: 'discover-failed' }));
  const runEtlStageSpy = t.mock.method(refreshJobModule, 'runEtlStage', () => {
    throw new Error('runEtlStage must not run when discover failed and force was not set');
  });

  try {
    const ctx = makeCtx(tmp);
    const { routes } = registerModule(ctx);
    const route = findRoute(routes, 'GET', '/refresh-stream');
    const res = new FakeSseRes();
    const req = fakeSseReq('/refresh-stream');
    await route.handler(req, res);
    assert.strictEqual(res.writableEnded, true);
    assert.match(res.text, /event: error/);
    assert.match(res.text, /"error":"discover-failed"/);
    assert.match(res.text, /active sprints/);
    assert.strictEqual(runEtlStageSpy.mock.callCount(), 0);
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    if (prevEmbedded === undefined) delete process.env.COCKPIT_EMBEDDED; else process.env.COCKPIT_EMBEDDED = prevEmbedded;
    if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('GET /refresh-stream: force=1 proceeds even when discover would fail, because it never calls loadDiscover', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-force-'));
  seedSprints(tmp);
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  const prevEmbedded = process.env.COCKPIT_EMBEDDED;
  const prevToken = process.env.JIRA_TOKEN;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  delete process.env.COCKPIT_EMBEDDED;
  process.env.JIRA_TOKEN = 'test-token';

  t.mock.method(refreshJobModule, 'resolvePython', () => ({ cmd: 'python3', baseArgs: [] }));
  const loadDiscoverSpy = t.mock.method(refreshJobModule, 'loadDiscover', async () => ({ available: false, reason: 'discover-failed' }));
  t.mock.method(refreshJobModule, 'runEtlStage', async () => ({ ok: true, code: 0, tail: [] }));

  try {
    const ctx = makeCtx(tmp);
    const { routes } = registerModule(ctx);
    const route = findRoute(routes, 'GET', '/refresh-stream');
    const res = new FakeSseRes();
    const req = fakeSseReq('/refresh-stream?force=1');
    await route.handler(req, res);
    assert.strictEqual(res.writableEnded, true);
    assert.doesNotMatch(res.text, /"error":"discover-failed"/);
    assert.strictEqual(loadDiscoverSpy.mock.callCount(), 0, 'force=1 skips discover entirely');
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    if (prevEmbedded === undefined) delete process.env.COCKPIT_EMBEDDED; else process.env.COCKPIT_EMBEDDED = prevEmbedded;
    if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function seedSpilloverIndex(root) {
  const dir = path.join(root, 'ds-data', 'sprint-stats');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'spillover-index.json'), path.join(dir, 'index.json'));
  return path.join(dir, 'spillover.json');
}

test('GET /spillover: an empty tree answers storage unavailable and aggregate null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-spillover-empty-'));
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  try {
    const { routes } = registerModule(makeCtx(tmp));
    const res = await callJson(routes, 'GET', '/spillover');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.storage, 'unavailable');
    assert.strictEqual(res.body.aggregate, null);
    const post = await callJson(routes, 'POST', '/spillover/recompute');
    assert.strictEqual(post.status, 409);
    assert.strictEqual(post.body.error, 'storage-unavailable');
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('POST /spillover/recompute: writes the file once, the second call changes nothing, GET reports current', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-spillover-'));
  const spilloverFile = seedSpilloverIndex(tmp);
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  try {
    const { routes } = registerModule(makeCtx(tmp));
    const before = await callJson(routes, 'GET', '/spillover');
    assert.ok(before.body.aggregate.sprints.length > 0);
    assert.strictEqual(before.body.file.present, false);
    assert.strictEqual(before.body.file.current, false);

    const first = await callJson(routes, 'POST', '/spillover/recompute');
    assert.deepStrictEqual(first.body, { written: true, present: true });
    assert.ok(fs.existsSync(spilloverFile));
    const bytes = fs.readFileSync(spilloverFile, 'utf8');
    const second = await callJson(routes, 'POST', '/spillover/recompute');
    assert.strictEqual(second.body.written, false);
    assert.strictEqual(fs.readFileSync(spilloverFile, 'utf8'), bytes);

    const after = await callJson(routes, 'GET', '/spillover');
    assert.strictEqual(after.body.file.present, true);
    assert.strictEqual(after.body.file.current, true);
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('POST /spillover/recompute: no closed MAIN sprint = no empty spillover.json', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-stats-spillover-active-'));
  seedSprints(tmp); // one sprint, every team still active
  const prevEnv = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  try {
    const { routes } = registerModule(makeCtx(tmp));
    const spilloverFile = path.join(tmp, 'ds-data', 'sprint-stats', 'spillover.json');
    assert.ok(!fs.existsSync(spilloverFile), 'an aggregate without closed sprints is never written');
    const post = await callJson(routes, 'POST', '/spillover/recompute');
    assert.strictEqual(post.status, 409);
    assert.strictEqual(post.body.error, 'no-index');
    assert.ok(!fs.existsSync(spilloverFile));
  } finally {
    process.env.DATA_SUB_REPOS_DIR = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
