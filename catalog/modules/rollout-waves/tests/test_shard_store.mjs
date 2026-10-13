// rollout-waves/tests/test_shard_store.mjs
// Prefixing, idempotent shard writes (incl. single-shard rewrite) and the
// merge-only done-import end to end on the real writer, in a throwaway tmp
// directory. writeShardedDir is merge-only by construction now - the store
// catalog (the one full-dump caller that needed a removeMissing option)
// moved out of this module, so there is nothing left to test that flag with.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shardStore = require(path.join(DIR, 'server', 'shard-store.js'));
const core = require(path.join(DIR, 'server', 'rollout-core.js'));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-waves-shard-'));
}

test('prefixOf: 3-char prefix, uppercased, "other" under 3 characters', () => {
  assert.equal(shardStore.prefixOf('AA046'), 'AA0');
  assert.equal(shardStore.prefixOf('ab812'), 'AB8');
  assert.equal(shardStore.prefixOf('A1'), 'other');
});

test('groupByPrefix: groups items by the prefix of the extracted code', () => {
  const grouped = shardStore.groupByPrefix([{ c: 'AA001' }, { c: 'AA099' }, { c: 'AB812' }], (i) => i.c);
  assert.deepEqual([...grouped.keys()].sort(), ['AA0', 'AB8']);
  assert.equal(grouped.get('AA0').length, 2);
});

test('writeShardedDir: idempotent - a second identical write reports 0 written, mtimes unchanged', () => {
  const dir = tmpDir();
  const byPrefix = new Map([
    ['AA0', { rows: [{ code: 'AA001' }, { code: 'AA002' }] }],
    ['AB8', { rows: [{ code: 'AB812' }] }],
  ]);
  const meta = { dataset: 'training-done', schema_version: 3, source_file: 'a.xlsx', source_kind: 'xlsx' };

  const first = shardStore.writeShardedDir(dir, byPrefix, meta);
  assert.equal(first.written, 2);
  assert.equal(first.unchanged, 0);
  assert.equal(first.total, 3);

  const mtimesBefore = ['AA0', 'AB8'].map((p) => fs.statSync(path.join(dir, p + '.json')).mtimeMs);

  const second = shardStore.writeShardedDir(dir, byPrefix, meta);
  assert.equal(second.written, 0);
  assert.equal(second.unchanged, 2);

  const mtimesAfter = ['AA0', 'AB8'].map((p) => fs.statSync(path.join(dir, p + '.json')).mtimeMs);
  assert.deepEqual(mtimesAfter, mtimesBefore);

  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepEqual(index.shards, { AA0: 2, AB8: 1 });
  assert.equal(index.total, 3);
});

test('writeShardedDir: changing one shard rewrites only that shard, index total updates', () => {
  const dir = tmpDir();
  const meta = { dataset: 'training-done' };
  const v1 = new Map([
    ['AA0', { rows: [{ code: 'AA001' }] }],
    ['AB8', { rows: [{ code: 'AB812' }] }],
  ]);
  shardStore.writeShardedDir(dir, v1, meta);
  const ab8Before = fs.statSync(path.join(dir, 'AB8.json')).mtimeMs;

  const v2 = new Map([
    ['AA0', { rows: [{ code: 'AA001' }, { code: 'AA002' }] }], // changed
    ['AB8', { rows: [{ code: 'AB812' }] }], // unchanged
  ]);
  const result = shardStore.writeShardedDir(dir, v2, meta);
  assert.equal(result.written, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(fs.statSync(path.join(dir, 'AB8.json')).mtimeMs, ab8Before);

  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.equal(index.total, 3);
});

test('writeShardedDir: content-only rewrite at constant row count still moves index.json', () => {
  const dir = tmpDir();
  const meta = { dataset: 'training-done' };
  const v1 = new Map([
    ['AA0', { rows: [{ code: 'AA001', manager: 'Alex Morgan' }] }],
    ['AB8', { rows: [{ code: 'AB812', manager: 'Sam Rivera' }] }],
  ]);
  shardStore.writeShardedDir(dir, v1, meta);
  const updatedAtBefore = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).updated_at;

  // updated_at is `new Date().toISOString()`, millisecond resolution - force
  // the clock to tick so a real rewrite is distinguishable from a no-op, a
  // busy wait rather than a timed sleep so the test stays fast.
  const t0 = Date.now();
  while (Date.now() === t0) { /* spin until the millisecond ticks over */ }

  // Same row COUNT in AA0, different field value - no total/shards change.
  const v2 = new Map([
    ['AA0', { rows: [{ code: 'AA001', manager: 'Jordan Lee' }] }],
    ['AB8', { rows: [{ code: 'AB812', manager: 'Sam Rivera' }] }],
  ]);
  const result = shardStore.writeShardedDir(dir, v2, meta);
  assert.equal(result.written, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(result.total, 2);

  const indexAfter1 = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.notEqual(indexAfter1.updated_at, updatedAtBefore, 'index.json must carry a fresh updated_at after a content-only shard rewrite');

  // A further identical re-run is still a true no-op: 0 written, index.json untouched.
  const indexBefore2 = fs.readFileSync(path.join(dir, 'index.json'), 'utf8');
  const idle = shardStore.writeShardedDir(dir, v2, meta);
  assert.equal(idle.written, 0);
  assert.equal(idle.unchanged, 2);
  const indexAfter2 = fs.readFileSync(path.join(dir, 'index.json'), 'utf8');
  assert.equal(indexAfter2, indexBefore2);
});

test('writeShardedDir: merge-only - a shard absent from the new set is left on disk untouched, never removed', () => {
  const dir = tmpDir();
  const meta = { dataset: 'training-done' };
  const full = new Map([
    ['AA0', { rows: [{ code: 'AA001' }] }],
    ['AB8', { rows: [{ code: 'AB812' }] }],
  ]);
  shardStore.writeShardedDir(dir, full, meta);

  const withoutAb8 = new Map([['AA0', { rows: [{ code: 'AA001' }] }]]);
  const result = shardStore.writeShardedDir(dir, withoutAb8, meta);
  assert.equal(result.removed, 0);
  assert.ok(fs.existsSync(path.join(dir, 'AB8.json')));
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepEqual(index.shards, { AA0: 1, AB8: 1 });
});

test('readShardedDir: reads back what writeShardedDir wrote, a missing directory answers empty, not a throw', () => {
  const dir = tmpDir();
  const byPrefix = new Map([['AA0', { rows: [{ code: 'AA001' }] }]]);
  shardStore.writeShardedDir(dir, byPrefix, { dataset: 'training-done' });

  const read = shardStore.readShardedDir(dir);
  assert.equal(read.exists, true);
  assert.deepEqual(read.shards.get('AA0'), { rows: [{ code: 'AA001' }] });

  const missing = shardStore.readShardedDir(path.join(dir, 'does-not-exist'));
  assert.equal(missing.exists, false);
  assert.equal(missing.shards.size, 0);
  assert.deepEqual(missing.errors, []);
});

test('readWaveConfigFile: normalizes a real file, defaults when the file is missing', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'waves-config.json');
  fs.writeFileSync(file, JSON.stringify({ first_wave_start: '2026-10-13', waves_count: 9, managers: { 'Alex Morgan': 1 } }));
  const cfg = shardStore.readWaveConfigFile(file);
  assert.equal(cfg.firstWaveStart, '2026-10-13');
  assert.equal(cfg.wavesCount, 9);

  const missing = shardStore.readWaveConfigFile(path.join(dir, 'no-such-file.json'));
  assert.equal(missing.firstWaveStart, core.FIRST_WAVE_DEFAULT);
  assert.equal(missing.source, 'default');
});

test('merge-only done import end to end: two imports, only the touched shard is rewritten', () => {
  const dir = tmpDir();
  const known = new Set(['AA001', 'AA002', 'AA003']);

  const first = core.mergeDoneCodes({}, ['AA001', 'AA002'], known, '2026-01-01T00:00:00.000Z', 'xlsx');
  const firstPayloads = new Map();
  for (const prefix of first.touchedPrefixes) {
    firstPayloads.set(prefix, { stores: Object.fromEntries(Object.entries(first.stores).filter(([code]) => shardStore.prefixOf(code) === prefix)) });
  }
  const firstWrite = shardStore.writeShardedDir(dir, firstPayloads, { dataset: 'training-done' });
  assert.equal(firstWrite.written, 1); // both codes share prefix AA0

  const second = core.mergeDoneCodes(first.stores, ['AA003', 'UNKNOWN'], known, '2026-02-01T00:00:00.000Z', 'xlsx');
  assert.equal(second.imported, 1);
  assert.deepEqual(second.unknown, ['UNKNOWN']);
  assert.deepEqual(Object.keys(second.stores).sort(), ['AA001', 'AA002', 'AA003']);

  const secondPayloads = new Map();
  for (const prefix of second.touchedPrefixes) {
    secondPayloads.set(prefix, { stores: Object.fromEntries(Object.entries(second.stores).filter(([code]) => shardStore.prefixOf(code) === prefix)) });
  }
  const secondWrite = shardStore.writeShardedDir(dir, secondPayloads, { dataset: 'training-done' });
  assert.equal(secondWrite.written, 1); // only shard AA0 touched again

  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.equal(index.total, 3);
});
