// tests/test_report_emit_pipe.mjs
// _report.emit() must deliver the WHOLE --json report through a pipe. With an
// immediate process.exit() Node cut stdout at 64 KB (2026-10-08: the prototype job
// runner's DS baseline got truncated JSON and failed).
import test from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a large --json report survives a pipe and keeps the exit code', async () => {
  const code = `
    const R = require(${JSON.stringify(path.join(ROOT, 'scripts', '_report.js'))});
    const rep = new R.Report('pipe-test');
    for (let i = 0; i < 3000; i++) rep.block({ rule: 'rule-' + (i % 7), file: 'file.tsx', line: i + 1, message: 'finding number ' + i + ' ' + 'x'.repeat(40) });
    rep.emit({ json: true }, 'T');
  `;
  const { err, out } = await new Promise((resolve) => {
    execFile(process.execPath, ['-e', code], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (e, stdout) => resolve({ err: e, out: stdout }));
  });
  assert.ok(out.length > 200 * 1024, `report should be large, got ${out.length} B`);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.findings.length, 3000);
  assert.strictEqual(err && err.code, 1, 'BLOCK findings still map to exit 1');
});
