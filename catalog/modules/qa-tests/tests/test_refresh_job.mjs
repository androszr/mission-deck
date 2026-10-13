// modules/qa-tests/tests/test_refresh_job.mjs
// Pure tests: refusal order, pickJiraToken, childEnv allowlist, handoffLine
// shape, etlArgs closed list, runEtlStage exit-code mapping, SSE error path.
// No real spawn, no network.

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const refreshJob = require('../server/refresh-job.js');
const sse = require('../server/sse.js');

// -- Helpers ------------------------------------------------------------------

/** Builds a fake child-process object that emits 'close' after one tick. */
function makeFakeChild(exitCode) {
  const child = new EventEmitter();
  child.pid = 9999;
  child.stdin = { write() {}, end() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => child.emit('close', exitCode));
  return child;
}

/** Builds a fake SSE res object; returns it with a `_written` collector. */
function makeFakeRes() {
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
    _written: written,
  };
  return res;
}

// -- etlArgs -----------------------------------------------------------------

test('etlArgs: always contains -u, the script path, --out; no extra flags', () => {
  const args = refreshJob.etlArgs('/tmp/out.json');
  assert.strictEqual(args[0], '-u');
  assert.ok(args[1].endsWith(path.join('scripts', 'qa_automation.py')), 'second arg must be qa_automation.py');
  assert.strictEqual(args[2], '--out');
  assert.strictEqual(args[3], '/tmp/out.json');
  assert.strictEqual(args.length, 4, 'etlArgs must have exactly 4 elements');
});

test('etlArgs: a different outPath produces a different fourth argument', () => {
  const a = refreshJob.etlArgs('/a/b/c.json');
  const b = refreshJob.etlArgs('/x/y/z.json');
  assert.strictEqual(a[3], '/a/b/c.json');
  assert.strictEqual(b[3], '/x/y/z.json');
});

// -- pickJiraToken -----------------------------------------------------------

test('pickJiraToken: personal token wins over technical; technical is the fallback', () => {
  assert.strictEqual(refreshJob.pickJiraToken({ JIRA_TOKEN: 'a', JIRA_TECH_TOKEN: 'b' }), 'a');
  assert.strictEqual(refreshJob.pickJiraToken({ JIRA_TECH_TOKEN: 'b' }), 'b');
  assert.strictEqual(refreshJob.pickJiraToken({}), '');
  assert.strictEqual(refreshJob.pickJiraToken(null), '');
});

// -- handoffLine -------------------------------------------------------------

test('handoffLine: one JSON line, correct defaults, never logs token', () => {
  const line = refreshJob.handoffLine({ JIRA_TOKEN: 'secret-token' });
  assert.ok(line.endsWith('\n'));
  const payload = JSON.parse(line);
  assert.strictEqual(payload.token, 'secret-token');
  assert.strictEqual(payload.jira_url, 'https://jira.example.com');
  assert.strictEqual(payload.verify_ssl, true);
});

test('handoffLine: custom jira_url and verify_ssl=false are forwarded', () => {
  const custom = JSON.parse(refreshJob.handoffLine({
    JIRA_TECH_TOKEN: 'tech',
    JIRA_URL: 'https://jira.example.org',
    VERIFY_SSL: 'false',
  }));
  assert.strictEqual(custom.token, 'tech');
  assert.strictEqual(custom.jira_url, 'https://jira.example.org');
  assert.strictEqual(custom.verify_ssl, false);
});

// -- childEnv ----------------------------------------------------------------

test('childEnv: allowlist only - no token/secret reaches the child', () => {
  const parent = {
    PATH: '/usr/bin', HOME: '/home/x', SSL_CERT_FILE: '/etc/ca.pem',
    JIRA_TOKEN: 'a', JIRA_TECH_TOKEN: 'b', JIRA_URL: 'https://x', VERIFY_SSL: 'false',
    CONFLUENCE_TOKEN: 'c', FIGMA_TOKEN: 'f', ADO_PERSONAL_TOKEN: 'ado',
    STARTER_APP_TOKEN: 's1', STARTER_DATA_TOKEN: 's2', BW_SESSION: 'bw',
    COCKPIT_ANALYTICS_API_KEY: 'amp', NODE_ENV: 'production', EMPTY: '',
  };
  const env = refreshJob.childEnv(parent);
  const allowed = new Set([...refreshJob.CHILD_ENV_ALLOW, 'PYTHONUNBUFFERED']);
  for (const key of Object.keys(env)) {
    assert.ok(allowed.has(key), 'leaked into child env: ' + key);
  }
  const forbidden = [
    'JIRA_TOKEN', 'JIRA_TECH_TOKEN', 'JIRA_URL', 'VERIFY_SSL',
    'CONFLUENCE_TOKEN', 'BW_SESSION', 'STARTER_APP_TOKEN',
  ];
  for (const key of forbidden) {
    assert.strictEqual(key in env, false, key + ' must not reach the child');
  }
  assert.strictEqual(env.PYTHONUNBUFFERED, '1');
  assert.strictEqual(env.PYTHONIOENCODING, 'utf-8');
  assert.strictEqual('EMPTY' in env, false, 'empty values are not carried');
});

test('childEnv: LANG defaults to C.UTF-8 when not set in parent', () => {
  const env = refreshJob.childEnv({ PATH: '/p' });
  assert.strictEqual(env.LANG, 'C.UTF-8');
});

// -- _pythonCandidates -------------------------------------------------------

test('_pythonCandidates: py -3 first on Windows, python3 first elsewhere', () => {
  assert.deepStrictEqual(refreshJob._pythonCandidates('win32'), [['py', ['-3']], ['python', []]]);
  assert.deepStrictEqual(refreshJob._pythonCandidates('darwin'), [['python3', []], ['python', []]]);
  assert.deepStrictEqual(refreshJob._pythonCandidates('linux'), [['python3', []], ['python', []]]);
});

// -- refreshRefusal ----------------------------------------------------------

test('refreshRefusal: correct order - test-mode > busy > no-token > data-missing > no-python > null', () => {
  assert.strictEqual(
    refreshJob.refreshRefusal({ testMode: true, running: true, token: 'x', storage: 'ok', python: {} }),
    'test-mode',
  );
  assert.strictEqual(
    refreshJob.refreshRefusal({ testMode: false, running: true, token: 'x', storage: 'ok', python: {} }),
    'busy',
  );
  assert.strictEqual(
    refreshJob.refreshRefusal({ testMode: false, running: false, token: '', storage: 'ok', python: {} }),
    'no-token',
  );
  assert.strictEqual(
    refreshJob.refreshRefusal({ testMode: false, running: false, token: 'x', storage: 'unavailable', python: {} }),
    'data-missing',
  );
  assert.strictEqual(
    refreshJob.refreshRefusal({ testMode: false, running: false, token: 'x', storage: 'ok', python: null }),
    'no-python',
  );
  assert.strictEqual(
    refreshJob.refreshRefusal({ testMode: false, running: false, token: 'x', storage: 'ok', python: { cmd: 'python3' } }),
    null,
  );
});

// -- parseProgressLine -------------------------------------------------------

test('parseProgressLine: parses @@PROGRESS: JSON, returns null for plain lines', () => {
  const p = refreshJob.parseProgressLine('@@PROGRESS:{"step":3,"total":10,"pct":30,"msg":"Step 3"}');
  assert.deepStrictEqual(p, { step: 3, total: 10, pct: 30, msg: 'Step 3' });

  assert.strictEqual(refreshJob.parseProgressLine('plain log line'), null);
  assert.strictEqual(refreshJob.parseProgressLine(''), null);
  assert.strictEqual(refreshJob.parseProgressLine('@@PROGRESS:{bad json'), null);
});

// -- (b) runEtlStage exit-code mapping ---------------------------------------

test('(b) runEtlStage: child exiting 0 produces ok:true', async () => {
  const result = await refreshJob.runEtlStage({
    python: { cmd: 'python3', baseArgs: [] },
    args: ['-u', 'qa_automation.py', '--out', '/tmp/x'],
    handoff: '{"token":"t"}\n',
    cwd: '/tmp',
    spawnFn: () => makeFakeChild(0),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 0);
});

test('(b) runEtlStage: child exiting 1 produces ok:false, code:1', async () => {
  const result = await refreshJob.runEtlStage({
    python: { cmd: 'python3', baseArgs: [] },
    args: ['-u', 'qa_automation.py', '--out', '/tmp/x'],
    handoff: '{"token":"t"}\n',
    cwd: '/tmp',
    spawnFn: () => makeFakeChild(1),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 1);
});

// -- (b) SSE error/done routing ----------------------------------------------

test('(b) SSE: result ok:false sends error event, not done', async () => {
  const res = makeFakeRes();
  const req = { on() {}, removeListener() {}, socket: { setTimeout() {} } };

  await sse.runSseStream(req, res, async () => ({
    ok: false,
    error: 'etl-failed',
    message: 'Refresh failed.',
  }));

  const combined = res._written.join('');
  assert.ok(combined.includes('event: error'), 'SSE must emit error event on ok:false result');
  assert.ok(!combined.includes('event: done'), 'SSE must not emit done event on ok:false result');
  assert.ok(combined.includes('etl-failed'), 'SSE error event must carry the error code');
});

test('(b) SSE: result ok:true sends done event, not error', async () => {
  const res = makeFakeRes();
  const req = { on() {}, removeListener() {}, socket: { setTimeout() {} } };

  await sse.runSseStream(req, res, async () => ({ ok: true }));

  const combined = res._written.join('');
  assert.ok(combined.includes('event: done'), 'SSE must emit done event on ok:true result');
  assert.ok(!combined.includes('event: error'), 'SSE must not emit error event on ok:true result');
});
