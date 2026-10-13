// modules/qa-tests/tests/test_store.mjs
// storageState (ok/unavailable), readIndex (missing->empty shape),
// readShard (valid/missing), readAllShards. Uses DATA_SUB_REPOS_DIR to point
// at a throwaway directory - never the developer's own ds-data clone.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-tests-store-test-'));
}

function makeCtx(rootDir) {
  return { rootDir };
}

// -- storageState ------------------------------------------------------------

test('storageState: unavailable when directory does not exist', () => {
  const fake = path.join(os.tmpdir(), 'qa-tests-does-not-exist-' + Date.now());
  process.env.DATA_SUB_REPOS_DIR = path.dirname(fake);
  const store = require('../server/store.js');
  const dir = store.teamDataDir(makeCtx(fake));
  assert.strictEqual(store.storageState(dir), 'unavailable');
  delete process.env.DATA_SUB_REPOS_DIR;
});

test('storageState: unavailable when directory is empty (only junk files)', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  fs.mkdirSync(dpDir, { recursive: true });
  fs.writeFileSync(path.join(dpDir, '.gitignore'), '');
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  assert.strictEqual(store.storageState(dpDir), 'unavailable');
  delete process.env.DATA_SUB_REPOS_DIR;
});

test('storageState: ok when directory has at least one non-junk file', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  fs.mkdirSync(path.join(dpDir, 'jira'), { recursive: true });
  fs.writeFileSync(path.join(dpDir, 'jira', 'something.json'), '{}');
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  assert.strictEqual(store.storageState(dpDir), 'ok');
  delete process.env.DATA_SUB_REPOS_DIR;
});

// -- readIndex ---------------------------------------------------------------

test('readIndex: returns empty shape when index.json does not exist', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  fs.mkdirSync(dpDir, { recursive: true });
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  const idx = store.readIndex(dpDir);
  assert.deepStrictEqual(idx, { meta: {}, shard_to_module: {}, aggregates: {} });
  delete process.env.DATA_SUB_REPOS_DIR;
});

test('readIndex: parses a valid index.json (_utils.py format)', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  const qaDir = path.join(dpDir, 'jira', 'qa-automation');
  fs.mkdirSync(qaDir, { recursive: true });
  // On-disk format: { meta: { shard_to_module, aggregates, ... }, keys: [...] }
  const payload = {
    meta: {
      generated_at: '2026-01-01T00:00:00Z',
      dashboard_id: 167300,
      shard_to_module: { orders: 'orders', checkout: 'checkout' },
      aggregates: { aggregate: { total: 42, active_total: 40, automated: 20, coverage_pct: 50.0 } },
      schema_version: 1,
      shard_count: 2,
    },
    keys: ['checkout', 'orders'],
  };
  fs.writeFileSync(path.join(qaDir, 'index.json'), JSON.stringify(payload));
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  const idx = store.readIndex(dpDir);
  assert.strictEqual(idx.meta.dashboard_id, 167300);
  assert.deepStrictEqual(Object.keys(idx.shard_to_module), ['orders', 'checkout']);
  assert.strictEqual(idx.aggregates.aggregate.total, 42);
  delete process.env.DATA_SUB_REPOS_DIR;
});

// -- readShard ---------------------------------------------------------------

test('readShard: returns null for a missing shard', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  fs.mkdirSync(path.join(dpDir, 'jira', 'qa-automation'), { recursive: true });
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  assert.strictEqual(store.readShard(dpDir, 'orders'), null);
  delete process.env.DATA_SUB_REPOS_DIR;
});

test('readShard: returns null for invalid module key (path traversal guard)', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  fs.mkdirSync(dpDir, { recursive: true });
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  assert.strictEqual(store.readShard(dpDir, '../secret'), null);
  assert.strictEqual(store.readShard(dpDir, ''), null);
  assert.strictEqual(store.readShard(dpDir, null), null);
  delete process.env.DATA_SUB_REPOS_DIR;
});

test('readShard: parses a valid shard file', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  const qaDir = path.join(dpDir, 'jira', 'qa-automation');
  fs.mkdirSync(qaDir, { recursive: true });
  const shard = { key: 'orders', label: 'Orders', total: 10, active_total: 9, automated: 5, coverage_pct: 55.56 };
  fs.writeFileSync(path.join(qaDir, 'module-orders.json'), JSON.stringify(shard));
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  const result = store.readShard(dpDir, 'orders');
  assert.ok(result !== null, 'should parse the shard');
  assert.strictEqual(result.key, 'orders');
  assert.strictEqual(result.automated, 5);
  delete process.env.DATA_SUB_REPOS_DIR;
});

// -- readAllShards ------------------------------------------------------------

test('readAllShards: returns array of shards matching shard_to_module keys', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  const qaDir = path.join(dpDir, 'jira', 'qa-automation');
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'module-orders.json'), JSON.stringify({ key: 'orders' }));
  fs.writeFileSync(path.join(qaDir, 'module-checkout.json'), JSON.stringify({ key: 'checkout' }));
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  const index = { shard_to_module: { orders: 'orders', checkout: 'checkout' } };
  const shards = store.readAllShards(dpDir, index);
  assert.strictEqual(shards.length, 2);
  const keys = shards.map((s) => s.key).sort();
  assert.deepStrictEqual(keys, ['checkout', 'orders']);
  delete process.env.DATA_SUB_REPOS_DIR;
});

test('readAllShards: missing shards are omitted', () => {
  const base = tmpDir();
  const dpDir = path.join(base, 'ds-data');
  const qaDir = path.join(dpDir, 'jira', 'qa-automation');
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'module-orders.json'), JSON.stringify({ key: 'orders' }));
  // the checkout shard is missing
  process.env.DATA_SUB_REPOS_DIR = base;
  const store = require('../server/store.js');
  const index = { shard_to_module: { orders: 'orders', checkout: 'checkout' } };
  const shards = store.readAllShards(dpDir, index);
  assert.strictEqual(shards.length, 1);
  assert.strictEqual(shards[0].key, 'orders');
  delete process.env.DATA_SUB_REPOS_DIR;
});
