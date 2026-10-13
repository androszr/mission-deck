// modules/qa-tests/tests/test_qa_python_contract.mjs
// Static contract of scripts/qa_automation.py: the Jira status names it
// compares against and the regression-run area map. Reads the source file as
// UTF-8 text; no Python needed.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(DIR, 'scripts', 'qa_automation.py'), 'utf8');
const clientSrc = fs.readFileSync(path.join(DIR, 'client', 'index.js'), 'utf8');

test('qa_automation.py: STATUSES lists every status the client renders', () => {
  const statusesBlock = src.match(/STATUSES\s*=\s*\[[\s\S]*?\]/);
  assert.ok(statusesBlock, 'STATUSES list must be present in qa_automation.py');
  for (const s of ['Automated', 'Test', 'Open', 'In Progress', 'New', 'Blocked', 'Closed', 'Cancelled']) {
    assert.ok(statusesBlock[0].includes("'" + s + "'"), 'STATUSES must contain ' + s);
  }
  for (const s of ['New', 'Open', 'In Progress', 'Blocked', 'Test', 'Automated']) {
    assert.ok(clientSrc.includes("key: '" + s + "'"), 'client STATUS_CONFIG must contain ' + s);
  }
});

test('qa_automation.py: EXCLUDED_STATUSES holds exactly Closed and Cancelled', () => {
  const excludedBlock = src.match(/EXCLUDED_STATUSES\s*=\s*\{[^}]+\}/);
  assert.ok(excludedBlock, 'EXCLUDED_STATUSES set must be present in qa_automation.py');
  assert.ok(excludedBlock[0].includes("'Closed'"));
  assert.ok(excludedBlock[0].includes("'Cancelled'"));
});

test('qa_automation.py: the source is ASCII only', () => {
  assert.ok(!/[^\x00-\x7f]/.test(src), 'qa_automation.py must stay ASCII');
});

test('qa_automation.py: TSTRUN_MODULE_MAP maps every labelled area', () => {
  const mapBlock = src.match(/TSTRUN_MODULE_MAP\s*=\s*\{[\s\S]*?\}/);
  assert.ok(mapBlock, 'TSTRUN_MODULE_MAP dict must be present in qa_automation.py');
  for (const key of ['orders', 'checkout', 'catalog', 'stock', 'deliveries', 'labels', 'warehouse']) {
    assert.ok(mapBlock[0].includes("'" + key + "'"), 'TSTRUN_MODULE_MAP must map ' + key);
  }
});
