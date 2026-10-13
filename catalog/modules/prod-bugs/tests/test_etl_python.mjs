// modules/prod-bugs/tests/test_etl_python.mjs
// The Python ETL, offline: compile, the metric maths and the one-key manifest
// rule. Skips when no interpreter is on PATH. Never touches Jira or the real
// team data clone.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(DIR, 'scripts');
const FIXTURES = path.join(DIR, 'tests', 'fixtures');

function findPython() {
  const candidates = process.platform === 'win32' ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  for (const [cmd, base] of candidates) {
    const r = spawnSync(cmd, [...base, '--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return { cmd, base };
  }
  return null;
}
const PY = findPython();

function runPy(code, args = []) {
  // -B: no __pycache__ in the module tree.
  return spawnSync(PY.cmd, [...PY.base, '-B', '-c', code, ...args], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
}

const PRELUDE = `import sys, json, datetime
sys.path.insert(0, ${JSON.stringify(SCRIPTS)})
import _common, sync_prod_bugs_sprint as m
`;

test('both scripts byte-compile', { skip: !PY && 'no python' }, () => {
  const r = runPy(`import ast, sys
for f in sys.argv[1:]:
    ast.parse(open(f, encoding='utf-8').read(), f)
print('ok')`, [path.join(SCRIPTS, '_common.py'), path.join(SCRIPTS, 'sync_prod_bugs_sprint.py')]);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('calc_area_metrics: open / resolved in sprint / resolved before', { skip: !PY && 'no python' }, () => {
  const r = runPy(PRELUDE + `
d = datetime.date
issues = [
    {'key': 'A-1', 'summary': 's1', 'created': d(2026, 6, 1), 'resolved': None, 'status': 'Open', 'priority': 'High'},
    {'key': 'A-2', 'summary': 's2', 'created': d(2026, 6, 10), 'resolved': d(2026, 6, 20), 'status': 'Closed', 'priority': None},
    {'key': 'A-3', 'summary': 's3', 'created': d(2026, 5, 1), 'resolved': d(2026, 5, 11), 'status': 'Closed', 'priority': 'Low'},
    {'key': 'A-4', 'summary': 's4', 'created': d(2026, 6, 2), 'resolved': None, 'status': 'Cancelled', 'priority': None},
]
out = m.calc_area_metrics(issues, d(2026, 6, 16), d(2026, 6, 30))
print(json.dumps(out))
`);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.bugs, 1);
  assert.strictEqual(out.bugFixTime, 10);
  assert.strictEqual(out.resolvedCount, 1);
  assert.strictEqual(out.createdCount, 0);
  assert.deepStrictEqual(out.openBugs.map((b) => b.key), ['A-1']);
  assert.deepStrictEqual(out.resolvedBugs.map((b) => [b.key, b.fixDays, b.resolved]), [['A-2', 10, '2026-06-20']]);
});

test('update_manifest_prod_bugs: only its key changes, order kept, no-op leaves mtime alone', { skip: !PY && 'no python' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-bugs-etl-'));
  fs.copyFileSync(path.join(FIXTURES, 'manifest.json'), path.join(dir, 'manifest.json'));
  for (const n of [3, 12]) fs.copyFileSync(path.join(FIXTURES, 'prod-bugs-sprint-' + n + '.json'), path.join(dir, 'prod-bugs-sprint-' + n + '.json'));
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  const r1 = runPy(PRELUDE + 'print(json.dumps(m.update_manifest_prod_bugs(sys.argv[1])))', [dir]);
  assert.strictEqual(r1.status, 0, r1.stderr);
  assert.strictEqual(r1.stdout.trim(), 'true');
  const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
  const after = JSON.parse(raw);
  assert.deepStrictEqual(Object.keys(after), Object.keys(before));
  assert.deepStrictEqual(after.availableProdBugsSprints, [3, 12]);
  for (const k of Object.keys(before)) if (k !== 'availableProdBugsSprints') assert.deepStrictEqual(after[k], before[k]);
  assert.ok(!raw.endsWith('\n'), 'manifest is written without a trailing newline');

  const old = new Date(2020, 0, 1);
  fs.utimesSync(path.join(dir, 'manifest.json'), old, old);
  const r2 = runPy(PRELUDE + 'print(json.dumps(m.update_manifest_prod_bugs(sys.argv[1])))', [dir]);
  assert.strictEqual(r2.stdout.trim(), 'false');
  assert.strictEqual(fs.statSync(path.join(dir, 'manifest.json')).mtimeMs, old.getTime());

  // a missing manifest is created holding this key alone
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-bugs-etl-bare-'));
  fs.copyFileSync(path.join(FIXTURES, 'prod-bugs-sprint-3.json'), path.join(bare, 'prod-bugs-sprint-3.json'));
  const r3 = runPy(PRELUDE + 'm.update_manifest_prod_bugs(sys.argv[1])', [bare]);
  assert.strictEqual(r3.status, 0, r3.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(bare, 'manifest.json'), 'utf8')), { availableProdBugsSprints: [3] });
});

test('atomic_write_json: fixed layout (indent 2, UTF-8, trailing newline, 0.0 kept)', { skip: !PY && 'no python' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-bugs-etl-w-'));
  const fp = path.join(dir, 'x.json');
  const r = runPy(PRELUDE + 'import os\n_common.atomic_write_json(sys.argv[1], {"a": 0.0, "b": "naïve café"})', [fp]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(fp, 'utf8'), '{\n  "a": 0.0,\n  "b": "naïve café"\n}\n');
});
