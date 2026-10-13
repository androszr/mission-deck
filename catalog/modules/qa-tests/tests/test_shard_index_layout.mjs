// modules/qa-tests/tests/test_shard_index_layout.mjs
// Verifies that _common.py _update_shard_index writes the stable
// on-disk format: { meta: { ..., aggregates, shard_to_module, schema_version,
// shard_count, last_updated }, keys: [...] }.
// Skips gracefully when python3 is not available on the PATH.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, '..', 'scripts');

function python3Available() {
  try {
    const r = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-tests-shard-idx-'));
}

test('_common._update_shard_index writes the stable index.json layout', (t) => {
  if (!python3Available()) {
    t.skip('python3 not available');
    return;
  }

  const shardDir = tmpDir();
  const script = `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})
from _common import _update_shard_index

shard_dir = ${JSON.stringify(shardDir)}
_update_shard_index(
    shard_dir,
    keys_present=['orders', 'checkout', 'warehouse'],
    meta_overrides={
        'generated_at': '2026-01-01T00:00:00+00:00',
        'source': 'jira',
        'shard_to_module': {'orders': 'orders', 'checkout': 'checkout', 'warehouse': 'warehouse'},
        'aggregates': {
            'aggregate': {'total': 100, 'active_total': 90, 'automated': 60, 'coverage_pct': 66.67},
        },
    },
    compute_sprint_range=False,
)
index_path = os.path.join(shard_dir, 'index.json')
with open(index_path, encoding='utf-8') as fh:
    result = json.load(fh)
print(json.dumps(result))
`;

  const result = execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8' });
  const index = JSON.parse(result.trim());

  // Top-level keys must be exactly 'meta' and 'keys'
  assert.deepStrictEqual(
    Object.keys(index).sort(),
    ['keys', 'meta'],
    'top-level keys must be exactly "meta" and "keys"',
  );

  // meta must be an object
  assert.ok(index.meta && typeof index.meta === 'object', 'meta must be an object');

  // keys must be an array of sorted strings
  assert.ok(Array.isArray(index.keys), 'keys must be an array');
  assert.deepStrictEqual(
    index.keys,
    ['checkout', 'orders', 'warehouse'],
    'keys must be sorted string shard keys',
  );

  // Required meta fields
  assert.strictEqual(index.meta.schema_version, 1, 'meta.schema_version must be 1');
  assert.strictEqual(index.meta.shard_count, 3, 'meta.shard_count must equal number of keys');
  assert.ok(typeof index.meta.last_updated === 'string' && index.meta.last_updated.length > 0,
    'meta.last_updated must be a non-empty string');
  assert.strictEqual(index.meta.source, 'jira', 'caller meta (source) must be preserved');

  // aggregates must live inside meta
  assert.ok(
    index.meta.aggregates && typeof index.meta.aggregates === 'object',
    'aggregates must be nested inside meta',
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(index, 'aggregates'),
    'aggregates must NOT be at top level',
  );

  // shard_to_module must live inside meta
  assert.ok(
    index.meta.shard_to_module && typeof index.meta.shard_to_module === 'object',
    'shard_to_module must be nested inside meta',
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(index, 'shard_to_module'),
    'shard_to_module must NOT be at top level',
  );
});

// A SIGTERM from Node (refresh-job.js _killTree) must not leave a mkstemp
// file behind in jira/qa-automation/ - it would be pushed to the team.
test('_common: SIGTERM mid-write removes the tracked tmp file', (t) => {
  if (!python3Available()) {
    t.skip('python3 not available');
    return;
  }
  const shardDir = tmpDir();
  const script = `
import sys, os, time
sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})
import _common
_common.install_sigterm_handler()
fd, tmp = _common._tracked_mkstemp(${JSON.stringify(shardDir)})
os.write(fd, b'{"partial":')
os.kill(os.getpid(), 15)
time.sleep(5)
print('survived')
`;
  const r = spawnSync('python3', ['-B', '-c', script], { encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(r.status, 143, 'exit code 128+SIGTERM, stderr: ' + r.stderr);
  assert.ok(!String(r.stdout).includes('survived'));
  assert.deepStrictEqual(fs.readdirSync(shardDir), [], 'no tmp file may remain');
});

// The evening clear-plaintext may wipe the tree during a 20-minute run: the
// writers must fail rather than rebuild a missing parent directory.
test('_common: data_root_populated and the writers never recreate a wiped tree', (t) => {
  if (!python3Available()) {
    t.skip('python3 not available');
    return;
  }
  const base = tmpDir();
  const root = path.join(base, 'ds-data');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, '.DS_Store'), '');
  const script = `
import sys, os, json
sys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})
import _common
root = ${JSON.stringify(root)}
out = {'junk_only': _common.data_root_populated(root),
       'missing': _common.data_root_populated(os.path.join(root, 'nope'))}
try:
    _common.atomic_write_shard(os.path.join(root, 'jira', 'qa-automation'), 'x', {})
    out['wrote'] = True
except FileNotFoundError:
    out['wrote'] = False
print(json.dumps(out))
`;
  const res = JSON.parse(execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8' }).trim());
  assert.deepStrictEqual(res, { junk_only: false, missing: false, wrote: false });
  assert.ok(!fs.existsSync(path.join(root, 'jira')), 'missing parents must not be created');
});
