// modules/prod-bugs/tests/test_refresh_job.mjs
// server/refresh-job.js pure helpers - nothing here spawns a real Python.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const job = require('../server/refresh-job.js');

test('etlArgs: closed list, exactly one force flag, both dirs', () => {
  const cur = job.etlArgs(false, '/d', '/c');
  const all = job.etlArgs(true, '/d', '/c');
  assert.deepStrictEqual(cur.slice(0, 1), ['-u']);
  assert.match(cur[1], /sync_prod_bugs_sprint\.py$/);
  assert.deepStrictEqual(cur.slice(2), ['auto', '--force-current', '--data-dir', '/d', '--cache-dir', '/c']);
  assert.deepStrictEqual(all.slice(2), ['auto', '--force', '--data-dir', '/d', '--cache-dir', '/c']);
});

test('refreshRefusal: five refusals in the pinned order, then null', () => {
  const ok = { testMode: false, running: false, token: 't', storage: 'ok', python: {} };
  assert.strictEqual(job.refreshRefusal(ok), null);
  assert.strictEqual(job.refreshRefusal({ testMode: true, running: true }), 'test-mode');
  assert.strictEqual(job.refreshRefusal({ ...ok, running: true, token: '' }), 'busy');
  assert.strictEqual(job.refreshRefusal({ ...ok, token: '', storage: 'unavailable' }), 'no-token');
  assert.strictEqual(job.refreshRefusal({ ...ok, storage: 'unavailable', python: null }), 'data-missing');
  assert.strictEqual(job.refreshRefusal({ ...ok, python: null }), 'no-python');
});

test('handoffLine: shape, defaults, token preference', () => {
  const line = job.handoffLine({ JIRA_TECH_TOKEN: 'tech' });
  assert.ok(line.endsWith('\n'));
  assert.deepStrictEqual(JSON.parse(line), { token: 'tech', jira_url: 'https://jira.example.com', verify_ssl: true });
  const personal = JSON.parse(job.handoffLine({ JIRA_TOKEN: 'me', JIRA_TECH_TOKEN: 'tech', JIRA_URL: 'https://j.example', VERIFY_SSL: 'false' }));
  assert.deepStrictEqual(personal, { token: 'me', jira_url: 'https://j.example', verify_ssl: false });
});

test('childEnv: allowlist only, no secrets', () => {
  const env = job.childEnv({
    PATH: '/bin', HOME: '/h', JIRA_TOKEN: 'a', JIRA_TECH_TOKEN: 'b', CONFLUENCE_TOKEN: 'c',
    GITLAB_PO_TOKEN: 'd', BW_SESSION: 'e', JIRA_URL: 'u',
  });
  assert.strictEqual(env.PATH, '/bin');
  assert.strictEqual(env.PYTHONUNBUFFERED, '1');
  for (const k of ['JIRA_TOKEN', 'JIRA_TECH_TOKEN', 'CONFLUENCE_TOKEN', 'GITLAB_PO_TOKEN', 'BW_SESSION', 'JIRA_URL']) {
    assert.ok(!(k in env), k + ' leaked into the child env');
  }
});

test('createLineSplitter + parseProgressLine: a line cut between chunks, a broken payload', () => {
  const lines = [];
  const sp = job.createLineSplitter((l) => lines.push(l));
  sp.push('@@PROGRESS:{"step":1,"to');
  sp.push('tal":2,"pct":50,"msg":"Sprint 1"}\r\nplain');
  sp.push(' line\n@@PROGRESS:{broken\ntail');
  sp.flush();
  assert.deepStrictEqual(lines, ['@@PROGRESS:{"step":1,"total":2,"pct":50,"msg":"Sprint 1"}', 'plain line', '@@PROGRESS:{broken', 'tail']);
  assert.deepStrictEqual(job.parseProgressLine(lines[0]), { step: 1, total: 2, pct: 50, msg: 'Sprint 1' });
  assert.strictEqual(job.parseProgressLine(lines[1]), null);
  assert.strictEqual(job.parseProgressLine(lines[2]), null);
});

test('runEtl: writes the handoff to stdin, closes it, reports exit code and tail', async () => {
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  let stdinData = '';
  let spawnArgs = null;
  const spawnFn = (cmd, args) => {
    spawnArgs = [cmd, args];
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdin.on('data', (c) => { stdinData += c; });
    setImmediate(() => {
      child.stdout.write('hello\n');
      child.stderr.write('@@PROGRESS:{"pct":5}\n');
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };
  const seen = [];
  const out = await job.runEtl({
    python: { cmd: 'py', baseArgs: ['-3'] }, args: ['a'], handoff: 'HANDOFF\n', cwd: '.',
    onLine: (l) => seen.push(l), spawnFn,
  });
  assert.deepStrictEqual(spawnArgs, ['py', ['-3', 'a']]);
  assert.strictEqual(stdinData, 'HANDOFF\n');
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(seen.sort(), ['@@PROGRESS:{"pct":5}', 'hello']);
});
