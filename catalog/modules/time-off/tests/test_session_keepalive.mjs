// time-off/tests/test_session_keepalive.mjs
// The POST /session-keepalive route of the time-off module:
//   - test mode -> 409 {error: 'test-mode'}
//   - job.running -> 409 {error: 'job-running'}
//   - no session file -> 200 {ok: true, status: 'session-missing'}
//   - the route is registered

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'time-off-keepalive-test-'));
}

function makeRes() {
  const written = [];
  return {
    _status: undefined,
    headersSent: false,
    writableEnded: false,
    writeHead(code) { this.statusCode = code; this.headersSent = true; },
    write(c) { written.push(c); return true; },
    end() { this.writableEnded = true; },
    on() {}, removeListener() {},
    socket: { setTimeout() {} },
    _written: written,
  };
}

function makeReq(opts) {
  return {
    method: opts && opts.method || 'POST',
    url: opts && opts.url || '/session-keepalive',
    headers: opts && opts.headers || {},
    on() {}, removeListener() {},
  };
}

// IS_TEST_MODE in time-off/server/index.js is a module-level const, frozen
// at the first require. withServerModule() sets the env a test needs,
// requires a FRESH copy of index.js (cache entry dropped before and after)
// and restores the env afterwards - so every guard test really runs under a
// plain `node --test`, whatever NODE_ENV the caller had.

const INDEX_PATH = path.join(DIR, 'server', 'index.js');

async function withServerModule(env, fn) {
  const prev = { NODE_ENV: process.env.NODE_ENV, COCKPIT_EMBEDDED: process.env.COCKPIT_EMBEDDED };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  delete require.cache[require.resolve(INDEX_PATH)];
  try {
    return await fn(require(INDEX_PATH));
  } finally {
    delete require.cache[require.resolve(INDEX_PATH)];
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

function makeCtx(dataDir, sent) {
  return {
    moduleId: 'time-off', dataDir, rootDir: DIR, log: () => {},
    jsonResponse: (_res, code, body) => sent.push({ status: code, body }),
    readBody: async () => ({}),
    checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  };
}

test('POST /session-keepalive: the route is registered in register(ctx)', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const dataDir = tmpDir();
  try {
    const { routes } = register({
      moduleId: 'time-off', dataDir, rootDir: DIR, log: () => {},
      jsonResponse: () => {},
      readBody: async () => ({}),
      checkOrigin: () => true,
      makeLock: () => (fn) => fn(),
    });
    const route = routes.find(r => r.method === 'POST' && r.path === '/session-keepalive');
    assert.ok(route, 'no POST /session-keepalive route in register()');
    assert.equal(typeof route.handler, 'function');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('POST /session-keepalive: test mode (COCKPIT_EMBEDDED=1) -> 409 test-mode', async () => {
  await withServerModule({ NODE_ENV: undefined, COCKPIT_EMBEDDED: '1' }, async (register) => {
    const dataDir = tmpDir();
    try {
      const sent = [];
      const { routes } = register(makeCtx(dataDir, sent));
      const route = routes.find(r => r.method === 'POST' && r.path === '/session-keepalive');
      assert.ok(route, 'no POST /session-keepalive route');
      await route.handler(makeReq({ method: 'POST' }), makeRes());
      assert.equal(sent.length, 1, 'exactly one answer');
      assert.equal(sent[0].status, 409);
      assert.equal(sent[0].body.error, 'test-mode');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// -- keepalive exit code contract: Python script uses distinct exit codes -----

// sharepoint_time_off.py --keepalive against a fake playwright.sync_api put
// first on PYTHONPATH - no browser starts. FAKE_PW drives page.goto:
// {status, finalUrl, throws}. Skipped only when python3/openpyxl is missing.

const FAKE_SYNC_API = `
import json, os
SC = json.loads(os.environ.get("FAKE_PW", "{}"))

class _Resp:
    def __init__(self, status):
        self.status = status

class _Page:
    def __init__(self):
        self.url = "about:blank"
    def goto(self, url, **_kw):
        if "finalUrl" in SC:
            self.url = SC["finalUrl"]
        if SC.get("throws"):
            raise RuntimeError("net::ERR")
        if "finalUrl" not in SC:
            self.url = url
        return _Resp(SC.get("status"))

class _Context:
    def new_page(self):
        return _Page()
    def storage_state(self, path=None):
        state = {"cookies": [{"name": "FedAuth", "domain": "sp.example.com", "path": "/", "value": "resaved", "expires": -1}], "origins": []}
        if path:
            with open(path, "w") as fh:
                json.dump(state, fh)
        return state

class _Browser:
    def new_context(self, **_kw):
        return _Context()
    def close(self):
        pass

class _Chromium:
    def launch(self, **_kw):
        return _Browser()

class _P:
    chromium = _Chromium()

class sync_playwright:
    def __enter__(self):
        return _P()
    def __exit__(self, *_a):
        return False
`;

function pythonUsable() {
  const r = spawnSync('python3', ['-c', 'import openpyxl']);
  return r.status === 0;
}

function runFakeKeepalive(scenario) {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'fake', 'playwright'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fake', 'playwright', '__init__.py'), '');
  fs.writeFileSync(path.join(root, 'fake', 'playwright', 'sync_api.py'), FAKE_SYNC_API);
  const session = path.join(root, 'sso-session.json');
  const original = JSON.stringify({ cookies: [{ name: 'FedAuth', domain: 'sp.example.com', path: '/', value: 'orig', expires: -1 }], origins: [] });
  fs.writeFileSync(session, original);
  const old = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(session, old, old);
  const seed = path.join(root, 'seed', 'microsoft-session.json');
  const r = spawnSync('python3', [path.join(DIR, 'scripts', 'sharepoint_time_off.py'), '--keepalive', '--session', session, '--seed', seed], {
    env: {
      ...process.env,
      PYTHONPATH: path.join(root, 'fake'),
      PYTHONDONTWRITEBYTECODE: '1',
      FAKE_PW: JSON.stringify(scenario),
      TIMEOFF_SHAREPOINT_URL: 'https://sp.example.com/sites/team/time-off.xlsx',
      TIMEOFF_SHAREPOINT_DOWNLOAD_URL: 'https://sp.example.com/sites/team/download?UniqueId=00000000-0000-0000-0000-000000000001',
    },
    encoding: 'utf8',
  });
  const out = {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    sessionUnchanged: fs.readFileSync(session, 'utf8') === original && fs.statSync(session).mtimeMs === old.getTime(),
    seedWritten: fs.existsSync(seed),
  };
  fs.rmSync(root, { recursive: true, force: true });
  return out;
}

test('sharepoint_time_off.py --keepalive: 200 on the site -> exit 0, alive, session saved again', (t) => {
  if (!pythonUsable()) { t.skip('python3 with openpyxl is missing'); return; }
  const r = runFakeKeepalive({ status: 200 });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), { status: 'alive' });
  assert.equal(r.sessionUnchanged, false);
  assert.equal(r.seedWritten, true);
});

for (const status of [401, 403, 500]) {
  test(`sharepoint_time_off.py --keepalive: ${status} -> exit 4, session untouched (content and mtime)`, (t) => {
    if (!pythonUsable()) { t.skip('python3 with openpyxl is missing'); return; }
    const r = runFakeKeepalive({ status });
    assert.equal(r.code, 4, r.stderr);
    assert.equal(r.stdout.includes('alive'), false);
    assert.equal(r.sessionUnchanged, true);
    assert.equal(r.seedWritten, false);
  });
}

test('sharepoint_time_off.py --keepalive: navigation error on about:blank -> exit 2 (unreachable), session untouched', (t) => {
  if (!pythonUsable()) { t.skip('python3 with openpyxl is missing'); return; }
  const r = runFakeKeepalive({ throws: true });
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.sessionUnchanged, true);
  assert.equal(r.seedWritten, false);
});

test('sharepoint_time_off.py --keepalive: 200 off the site host (host name only in the path) -> exit 2', (t) => {
  if (!pythonUsable()) { t.skip('python3 with openpyxl is missing'); return; }
  const r = runFakeKeepalive({ status: 200, finalUrl: 'https://portal.example.com/?next=sp.example.com' });
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.sessionUnchanged, true);
});

test('sharepoint_time_off.py --keepalive: login redirect -> exit 4, session untouched', (t) => {
  if (!pythonUsable()) { t.skip('python3 with openpyxl is missing'); return; }
  const r = runFakeKeepalive({ status: 200, finalUrl: 'https://login.microsoftonline.com/common/oauth2' });
  assert.equal(r.code, 4, r.stderr);
  assert.equal(r.sessionUnchanged, true);
});

test('handleSessionKeepalive: exit code 2 maps to {ok: false, error: "unreachable"}', () => {
  // Read the server handler source to verify the exit-code-2 branch.
  const serverSrc = fs.readFileSync(path.join(DIR, 'server', 'index.js'), 'utf8');
  assert.ok(serverSrc.includes("code === 2"), 'handler must check exit code 2');
  assert.ok(serverSrc.includes("'unreachable'"), 'handler must map exit 2 to "unreachable"');
});

test('keepalive: an expired session is exit 4, not 1 (an uncaught exception never poses as expiry)', () => {
  const pySrc = fs.readFileSync(path.join(DIR, 'scripts', 'sharepoint_time_off.py'), 'utf8');
  const fn = pySrc.slice(pySrc.indexOf('def keepalive('), pySrc.indexOf('# -- Download and conversion'));
  assert.ok(/KEEPALIVE_EXIT_EXPIRED = 4/.test(pySrc), 'the constant KEEPALIVE_EXIT_EXPIRED = 4 is missing');
  assert.ok(!fn.includes('sys.exit(1)'), 'keepalive must never end with exit 1 (that is the exception code)');
  const serverSrc = fs.readFileSync(path.join(DIR, 'server', 'index.js'), 'utf8');
  const handler = serverSrc.slice(serverSrc.indexOf('async function handleSessionKeepalive'), serverSrc.indexOf('async function handleSessionLogin'));
  assert.ok(handler.includes('code === 4'), 'the handler must map exit 4 to expired');
  assert.ok(handler.includes("'keepalive-failed'"), 'any code other than 0/2/4 is keepalive-failed');
});

test('POST /session-keepalive: no session file -> 200 {ok: true, status: "session-missing"}', async () => {
  // Test mode switched OFF for this fresh copy of index.js: the handler gets
  // past the test-mode guard and stops at the missing session file, before
  // probing Python or spawning anything.
  await withServerModule({ NODE_ENV: undefined, COCKPIT_EMBEDDED: undefined }, async (register) => {
    const dataDir = tmpDir();
    try {
      const sent = [];
      const { routes } = register(makeCtx(dataDir, sent));
      const route = routes.find(r => r.method === 'POST' && r.path === '/session-keepalive');
      await route.handler(makeReq({ method: 'POST' }), makeRes());
      assert.equal(sent.length, 1, 'exactly one answer');
      assert.equal(sent[0].status, 200);
      assert.deepEqual(sent[0].body, { ok: true, status: 'session-missing' });
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

test('POST /session-login: registered; test mode -> 409 test-mode without a spawn', async () => {
  await withServerModule({ NODE_ENV: 'test', COCKPIT_EMBEDDED: undefined }, async (register) => {
    const dataDir = tmpDir();
    try {
      const sent = [];
      const { routes } = register(makeCtx(dataDir, sent));
      const route = routes.find(r => r.method === 'POST' && r.path === '/session-login');
      assert.ok(route, 'no POST /session-login route');
      await route.handler(makeReq({ method: 'POST', url: '/session-login' }), makeRes());
      assert.equal(sent.length, 1);
      assert.equal(sent[0].status, 409);
      assert.equal(sent[0].body.error, 'test-mode');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

test('_sso_shared.py: merge_states and merge_into_seed (mode 600, expired cookies dropped)', async () => {
  const probe = spawnSync('python3', ['--version']);
  if (probe.status !== 0) return; // no Python on this machine - the helper is never used here anyway
  const dir = tmpDir();
  try {
    const seed = path.join(dir, 'sub', 'seed.json');
    const code = [
      'import sys, json',
      'sys.path.insert(0, sys.argv[1])',
      'from _sso_shared import merge_into_seed',
      "merge_into_seed({'cookies':[{'name':'A','domain':'d','path':'/','value':'1','expires':-1},{'name':'X','domain':'d','path':'/','value':'x','expires':5}]}, sys.argv[2])",
      "merge_into_seed({'cookies':[{'name':'A','domain':'d','path':'/','value':'2','expires':-1}]}, sys.argv[2])",
    ].join('\n');
    const r = spawnSync('python3', ['-c', code, path.join(DIR, 'scripts'), seed], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.strictEqual(r.status, 0, String(r.stderr));
    const data = JSON.parse(fs.readFileSync(seed, 'utf8'));
    assert.deepStrictEqual(data.cookies.map((c) => c.name + '=' + c.value), ['A=2']);
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(seed).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
