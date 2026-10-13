// modules/devops-stats/tests/test_refresh_job.mjs
import test from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const job = require('../server/refresh-job.js');

test('etlArgs: closed list, --since only for incremental with a valid date', () => {
  const full = job.etlArgs('full', '2026-01-01T00:00:00Z', '/tmp/o.json');
  assert.deepStrictEqual(full.slice(1), ['--out', '/tmp/o.json', '--mode', 'full']);
  assert.ok(full[0].endsWith('devops_etl.mjs'));
  const inc = job.etlArgs('incremental', '2026-01-01T00:00:00Z', '/tmp/o.json');
  assert.deepStrictEqual(inc.slice(-2), ['--since', '2026-01-01T00:00:00.000Z']);
  assert.ok(!job.etlArgs('incremental', '--evil', '/tmp/o.json').includes('--since'));
  assert.deepStrictEqual(job.etlArgs('x; rm', null, '/o').slice(3), ['--mode', 'full']);
});

test('pickJiraToken precedence and handoffLine carries the token', () => {
  assert.strictEqual(job.pickJiraToken({ JIRA_TOKEN: 'a', JIRA_TECH_TOKEN: 'b' }), 'a');
  assert.strictEqual(job.pickJiraToken({ JIRA_TECH_TOKEN: 'b' }), 'b');
  assert.strictEqual(job.pickJiraToken({}), '');
  const line = job.handoffLine({ JIRA_TOKEN: 'sekret', JIRA_URL: 'https://j.example' });
  assert.deepStrictEqual(JSON.parse(line), { token: 'sekret', jira_url: 'https://j.example' });
  assert.ok(line.endsWith('\n'));
});

test('childEnv is an allowlist: no Jira token, no foreign secret', () => {
  const env = job.childEnv({ PATH: '/bin', JIRA_TOKEN: 'x', JIRA_TECH_TOKEN: 'y', FIGMA_TOKEN: 'z', NODE_EXTRA_CA_CERTS: '/ca.pem' });
  assert.deepStrictEqual(Object.keys(env).sort(), ['LANG', 'NODE_EXTRA_CA_CERTS', 'PATH']);
});

test('refreshRefusal order', () => {
  const all = { testMode: true, running: true, token: '', storage: 'unavailable' };
  assert.strictEqual(job.refreshRefusal(all), 'test-mode');
  assert.strictEqual(job.refreshRefusal({ ...all, testMode: false }), 'busy');
  assert.strictEqual(job.refreshRefusal({ ...all, testMode: false, running: false }), 'no-token');
  assert.strictEqual(job.refreshRefusal({ ...all, testMode: false, running: false, token: 't' }), 'data-missing');
  assert.strictEqual(job.refreshRefusal({ token: 't', storage: 'ok' }), null);
});

test('parseProgressLine and createLineSplitter', () => {
  assert.deepStrictEqual(job.parseProgressLine('@@PROGRESS:{"step":1,"total":2,"pct":50,"msg":"x"}'), { step: 1, total: 2, pct: 50, msg: 'x' });
  assert.strictEqual(job.parseProgressLine('@@PROGRESS:{bad'), null);
  assert.strictEqual(job.parseProgressLine('plain'), null);
  const lines = [];
  const sp = job.createLineSplitter((l) => lines.push(l));
  sp.push('ab'); sp.push('c\r\nd'); sp.flush();
  assert.deepStrictEqual(lines, ['abc', 'd']);
});

test('runEtlStage writes the handoff to stdin and runs process.execPath', async () => {
  let spawned = null;
  const written = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: (s) => written.push(s), end: () => {} };
  const spawnFn = (cmd, args, opts) => {
    spawned = { cmd, args, opts };
    setImmediate(() => { child.stdout.emit('data', 'hello\n@@PROGRESS:{"pct":10}\n'); child.emit('close', 0); });
    return child;
  };
  const seen = [];
  const r = await job.runEtlStage({ args: ['a.mjs'], handoff: 'LINE\n', cwd: '/', spawnFn, onLine: (l) => seen.push(l) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(spawned.cmd, process.execPath);
  assert.strictEqual(spawned.opts.shell, false);
  assert.ok(!('JIRA_TOKEN' in spawned.opts.env));
  assert.deepStrictEqual(written, ['LINE\n']);
  assert.strictEqual(seen.length, 2);
});
