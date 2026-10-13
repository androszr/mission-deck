// modules/sprint-stats/tests/test_refresh_job.mjs
// Closed argument lists, token handoff, refusal order, Python candidates per
// platform and progress scaling - all pure, no spawn.

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const refreshJob = require('../server/refresh-job.js');

test('etlArgs: closed list, --out always present, selection appended only when non-empty', () => {
  const args = refreshJob.etlArgs('main', [], '/tmp/out.json');
  assert.deepStrictEqual(args, ['-u', args[1], '--out', '/tmp/out.json']);
  assert.ok(args[1].endsWith(path.join('scripts', 'sprint_stats_main.py')));
});

test('etlArgs: force (empty selection) never appends a selection flag', () => {
  const args = refreshJob.etlArgs('platform', [], '/tmp/out2.json');
  assert.strictEqual(args.includes('--sprint-ids'), false);
});

test('etlArgs: a real selection appends the right flag per source, filtered to integers', () => {
  const mainArgs = refreshJob.etlArgs('main', [16, 17, NaN, 1.5, '18'], '/tmp/o.json');
  assert.ok(mainArgs.includes('--sprints'));
  assert.strictEqual(mainArgs[mainArgs.indexOf('--sprints') + 1], '16,17');

  const platformArgs = refreshJob.etlArgs('platform', [9024, 9023], '/tmp/o2.json');
  assert.ok(platformArgs.includes('--sprint-ids'));
  assert.strictEqual(platformArgs[platformArgs.indexOf('--sprint-ids') + 1], '9024,9023');
  assert.strictEqual(platformArgs.includes('--sprints'), false);
});

test('pickJiraToken: personal token wins over technical, technical is the fallback', () => {
  assert.strictEqual(refreshJob.pickJiraToken({ JIRA_TOKEN: 'a', JIRA_TECH_TOKEN: 'b' }), 'a');
  assert.strictEqual(refreshJob.pickJiraToken({ JIRA_TECH_TOKEN: 'b' }), 'b');
  assert.strictEqual(refreshJob.pickJiraToken({}), '');
});

test('handoffLine: one JSON line, defaults for jira_url/verify_ssl, never logs the token itself', () => {
  const line = refreshJob.handoffLine({ JIRA_TOKEN: 'secret-token' });
  assert.ok(line.endsWith('\n'));
  const payload = JSON.parse(line);
  assert.strictEqual(payload.token, 'secret-token');
  assert.strictEqual(payload.jira_url, 'https://jira.example.com');
  assert.strictEqual(payload.verify_ssl, true);

  const custom = JSON.parse(refreshJob.handoffLine({ JIRA_TECH_TOKEN: 'tech', JIRA_URL: 'https://x', VERIFY_SSL: 'false' }));
  assert.strictEqual(custom.token, 'tech');
  assert.strictEqual(custom.jira_url, 'https://x');
  assert.strictEqual(custom.verify_ssl, false);
});

test('childEnv: an allowlist - no key outside CHILD_ENV_ALLOW reaches the child, whatever the parent holds', () => {
  // Every secret the Bitwarden unlock assigns into process.env after boot,
  // plus the two the handoff line carries: none of them may be in envp.
  const parent = {
    PATH: '/usr/bin', HOME: '/home/x', SSL_CERT_FILE: '/etc/ca.pem', HTTPS_PROXY: 'http://proxy:3128',
    JIRA_TOKEN: 'a', JIRA_TECH_TOKEN: 'b', JIRA_URL: 'https://x', VERIFY_SSL: 'false',
    CONFLUENCE_TOKEN: 'c', FIGMA_TOKEN: 'f', ADO_PERSONAL_TOKEN: 'ado', GEMINI_PERSONAL_TOKEN: 'g',
    STARTER_APP_TOKEN: 's1', STARTER_DATA_TOKEN: 's2', GITLAB_PRODUCT_TOKEN: 'g1',
    COCKPIT_ANALYTICS_API_KEY: 'amp', BW_SESSION: 'bw', NODE_ENV: 'production', EMPTY: '',
  };
  const env = refreshJob.childEnv(parent);
  const allowed = new Set(refreshJob.CHILD_ENV_ALLOW.concat(['PYTHONUNBUFFERED']));
  for (const key of Object.keys(env)) {
    assert.ok(allowed.has(key), 'leaked into the child env: ' + key);
  }
  for (const key of ['JIRA_TOKEN', 'JIRA_TECH_TOKEN', 'JIRA_URL', 'VERIFY_SSL', 'CONFLUENCE_TOKEN', 'BW_SESSION', 'COCKPIT_ANALYTICS_API_KEY']) {
    assert.strictEqual(key in env, false, key + ' must not reach the child');
  }
  assert.strictEqual(env.PATH, '/usr/bin');
  assert.strictEqual(env.SSL_CERT_FILE, '/etc/ca.pem');
  assert.strictEqual(env.HTTPS_PROXY, 'http://proxy:3128');
  assert.strictEqual(env.PYTHONUNBUFFERED, '1');
  assert.strictEqual(env.PYTHONIOENCODING, 'utf-8');
  assert.strictEqual(env.LANG, 'C.UTF-8', 'a missing locale falls back to UTF-8');
  assert.strictEqual('EMPTY' in env, false, 'an empty value is not carried');
  // A key in the allowlist is copied verbatim - a spread is not what this is.
  assert.strictEqual(Object.keys(refreshJob.childEnv({ PATH: '/p', LANG: 'pl_PL.UTF-8' })).sort().join(','), 'LANG,PATH,PYTHONIOENCODING,PYTHONUNBUFFERED');
});

test('_pythonCandidates: py -3 then python on Windows, python3 then python elsewhere', () => {
  assert.deepStrictEqual(refreshJob._pythonCandidates('win32'), [['py', ['-3']], ['python', []]]);
  assert.deepStrictEqual(refreshJob._pythonCandidates('darwin'), [['python3', []], ['python', []]]);
  assert.deepStrictEqual(refreshJob._pythonCandidates('linux'), [['python3', []], ['python', []]]);
});

test('refreshRefusal: refusal order - test-mode, busy, no-token, data-missing, no-python, then null', () => {
  assert.strictEqual(refreshJob.refreshRefusal({ testMode: true, running: true, token: 'x', storage: 'ok', python: {} }), 'test-mode');
  assert.strictEqual(refreshJob.refreshRefusal({ testMode: false, running: true, token: 'x', storage: 'ok', python: {} }), 'busy');
  assert.strictEqual(refreshJob.refreshRefusal({ testMode: false, running: false, token: '', storage: 'ok', python: {} }), 'no-token');
  assert.strictEqual(refreshJob.refreshRefusal({ testMode: false, running: false, token: 'x', storage: 'unavailable', python: {} }), 'data-missing');
  assert.strictEqual(refreshJob.refreshRefusal({ testMode: false, running: false, token: 'x', storage: 'ok', python: null }), 'no-python');
  assert.strictEqual(refreshJob.refreshRefusal({ testMode: false, running: false, token: 'x', storage: 'ok', python: { cmd: 'python3' } }), null);
});

test('scaleStageProgress: MAIN fills 0-50, PLATFORM fills 50-100', () => {
  assert.strictEqual(refreshJob.scaleStageProgress('main', 0), 0);
  assert.strictEqual(refreshJob.scaleStageProgress('main', 100), 50);
  assert.strictEqual(refreshJob.scaleStageProgress('main', 50), 25);
  assert.strictEqual(refreshJob.scaleStageProgress('platform', 0), 50);
  assert.strictEqual(refreshJob.scaleStageProgress('platform', 100), 100);
  assert.strictEqual(refreshJob.scaleStageProgress('platform', 50), 75);
});

test('parseProgressLine + createLineSplitter: recognizes @@PROGRESS: lines, carries a partial tail across chunks', () => {
  assert.deepStrictEqual(refreshJob.parseProgressLine('@@PROGRESS:{"step":1,"total":4,"pct":25,"msg":"x"}'),
    { step: 1, total: 4, pct: 25, msg: 'x' });
  assert.strictEqual(refreshJob.parseProgressLine('a plain log line'), null);
  assert.strictEqual(refreshJob.parseProgressLine('@@PROGRESS:not-json'), null);

  const lines = [];
  const splitter = refreshJob.createLineSplitter((l) => lines.push(l));
  splitter.push('first li');
  splitter.push('ne\nsecond\n@@PROGR');
  splitter.push('ESS:{"step":1,"total":2,"pct":50,"msg":"m"}\nlast without a newline');
  splitter.flush();
  assert.deepStrictEqual(lines, [
    'first line', 'second', '@@PROGRESS:{"step":1,"total":2,"pct":50,"msg":"m"}', 'last without a newline',
  ]);
});

/** A minimal fake child process: an EventEmitter with stdout/stderr/stdin
 * stand-ins, closing on the next tick so runEtlStage/_runDiscoverOne see a
 * real async close event rather than a synchronous one. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let written = null;
  let ended = false;
  child.stdin = {
    write(chunk) { written = chunk; },
    end() { ended = true; },
  };
  child.pid = 4242;
  child.stdinWritten = () => written;
  child.stdinEnded = () => ended;
  return child;
}

test('runEtlStage: spawns with env stripped of JIRA_TOKEN/JIRA_TECH_TOKEN even though process.env carries both, and writes the handoff line to stdin', async () => {
  const prevToken = process.env.JIRA_TOKEN;
  const prevTech = process.env.JIRA_TECH_TOKEN;
  process.env.JIRA_TOKEN = 'personal-secret';
  process.env.JIRA_TECH_TOKEN = 'tech-secret';
  try {
    let capturedOpts = null;
    const child = fakeChild();
    const spawnFn = (cmd, args, opts) => {
      capturedOpts = opts;
      process.nextTick(() => child.emit('close', 0));
      return child;
    };
    const handoff = refreshJob.handoffLine(process.env);
    const result = await refreshJob.runEtlStage({
      python: { cmd: 'python3', baseArgs: [] },
      args: ['-u', 'sprint_stats_main.py', '--out', '/tmp/out.json'],
      handoff,
      cwd: '/tmp',
      spawnFn,
    });
    assert.strictEqual(result.ok, true);
    assert.ok(capturedOpts && capturedOpts.env, 'spawn was called with an env option');
    assert.strictEqual('JIRA_TOKEN' in capturedOpts.env, false);
    assert.strictEqual('JIRA_TECH_TOKEN' in capturedOpts.env, false);
    assert.strictEqual(capturedOpts.shell, false);
    assert.strictEqual(child.stdinWritten(), handoff);
    assert.strictEqual(child.stdinEnded(), true);
  } finally {
    if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken;
    if (prevTech === undefined) delete process.env.JIRA_TECH_TOKEN; else process.env.JIRA_TECH_TOKEN = prevTech;
  }
});

test('loadDiscover: the discover_sprints.py spawn for both boards also strips JIRA_TOKEN/JIRA_TECH_TOKEN from env and gets the handoff line on stdin', async () => {
  const prevToken = process.env.JIRA_TOKEN;
  const prevTech = process.env.JIRA_TECH_TOKEN;
  process.env.JIRA_TOKEN = 'personal-secret';
  process.env.JIRA_TECH_TOKEN = 'tech-secret';
  refreshJob.invalidateDiscoverCache();
  try {
    const captured = [];
    const spawnSyncFn = () => ({ status: 0, error: undefined });
    const spawnFn = (cmd, args, opts) => {
      const child = fakeChild();
      captured.push({ args, opts, child });
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({ active: [], sprints: [] })));
        child.emit('close', 0);
      });
      return child;
    };
    const expectedHandoff = refreshJob.handoffLine(process.env);
    const data = await refreshJob.loadDiscover({ rootDir: '/tmp' }, { force: true, spawnFn, spawnSyncFn });
    assert.strictEqual(data.available, true);
    assert.strictEqual(captured.length, 2, 'one discover_sprints.py spawn per board');
    for (const call of captured) {
      assert.ok(call.args.some((a) => String(a).includes('discover_sprints.py')));
      assert.ok(call.opts && call.opts.env, 'spawn was called with an env option');
      assert.strictEqual('JIRA_TOKEN' in call.opts.env, false);
      assert.strictEqual('JIRA_TECH_TOKEN' in call.opts.env, false);
      assert.strictEqual(call.child.stdinWritten(), expectedHandoff);
      assert.strictEqual(call.child.stdinEnded(), true);
    }
  } finally {
    if (prevToken === undefined) delete process.env.JIRA_TOKEN; else process.env.JIRA_TOKEN = prevToken;
    if (prevTech === undefined) delete process.env.JIRA_TECH_TOKEN; else process.env.JIRA_TECH_TOKEN = prevTech;
    refreshJob.invalidateDiscoverCache();
  }
});
