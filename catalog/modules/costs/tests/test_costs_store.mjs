import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const s = require('../server/store.js');
const c = require('../server/compute.js');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'costs-store-'));
  fs.writeFileSync(path.join(root, 'README.md'), 'team data\n'); // a populated (ready) tree
  return root;
}
const shard = (month, tag) => ({ schemaVersion: 1, month, fetchedAt: tag, dateFrom: month + '-01', dateTo: month + '-28', partial: false, authors: [] });

test('writeShards writes exactly the given months under costs/hours', () => {
  const root = tmpRoot();
  s.writeShards(root, { '2026-01': shard('2026-01', 'a'), '2026-02': shard('2026-02', 'a') });
  assert.deepStrictEqual(fs.readdirSync(root).sort(), ['README.md', 'costs']);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'costs', 'hours')).sort(), ['2026-01.json', '2026-02.json']);
});

test('readShards opens only the requested months', () => {
  const root = tmpRoot();
  s.writeShards(root, { '2026-01': shard('2026-01', 'a') });
  fs.writeFileSync(path.join(root, 'costs', 'hours', '2026-02.json'), '{ corrupt');
  assert.doesNotThrow(() => s.readShards(root, ['2026-01']));
  assert.strictEqual(s.readShards(root, ['2026-01'])['2026-01'].fetchedAt, 'a');
});

test('partial refresh leaves untouched months byte-identical', () => {
  const root = tmpRoot();
  s.writeShards(root, { '2026-01': shard('2026-01', 'a'), '2026-02': shard('2026-02', 'a'), '2026-03': shard('2026-03', 'a') });
  const file = (m) => path.join(root, 'costs', 'hours', m + '.json');
  const before = { 1: fs.readFileSync(file('2026-01')), 2: fs.readFileSync(file('2026-02')) };
  s.writeShards(root, { '2026-03': shard('2026-03', 'b'), '2026-04': shard('2026-04', 'b') });
  assert.ok(before[1].equals(fs.readFileSync(file('2026-01'))));
  assert.ok(before[2].equals(fs.readFileSync(file('2026-02'))));
  assert.strictEqual(JSON.parse(fs.readFileSync(file('2026-03'), 'utf8')).fetchedAt, 'b');
  assert.ok(fs.existsSync(file('2026-04')));
});

test('index month list equals the shards on disk; a missing index is rebuilt without writing', () => {
  const root = tmpRoot();
  const months = ['2026-01', '2026-02'];
  s.writeShards(root, { '2026-01': shard('2026-01', 'a'), '2026-02': shard('2026-02', 'a') });
  const entries = months.map((month) => ({ month, fetchedAt: 'a', dateFrom: month + '-01', dateTo: month + '-28', partial: false, authors: 0, worklogs: 0, skipped: 0 }));
  s.writeIndex(root, c.buildIndex(null, entries, { now: 'n' }));
  assert.deepStrictEqual(s.readIndexOrRebuild(root).months.map((m) => m.month), s.listShardMonths(root));
  fs.rmSync(path.join(root, 'costs', 'hours', 'index.json'));
  const listing = fs.readdirSync(path.join(root, 'costs', 'hours')).sort();
  const rebuilt = s.readIndexOrRebuild(root);
  assert.strictEqual(rebuilt.rebuilt, true);
  assert.deepStrictEqual(rebuilt.months.map((m) => m.month), months);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'costs', 'hours')).sort(), listing);
});

test('shardRelPath refuses anything but YYYY-MM', () => {
  assert.throws(() => s.shardRelPath('2026-13'), { code: 'bad-month' });
  assert.throws(() => s.shardRelPath('../x'), { code: 'bad-month' });
});

test('writeJsonPrivate with the root absent throws data-missing and creates nothing; outside costs/ is refused', () => {
  const base = tmpRoot();
  const missing = path.join(base, 'missing');
  assert.throws(() => s.writeJsonPrivate(missing, 'costs/config.json', {}), { code: 'data-missing' });
  assert.strictEqual(fs.existsSync(missing), false);
  assert.throws(() => s.writeJsonPrivate(base, 'other/file.json', {}), { code: 'path-outside' });
  assert.throws(() => s.writeJsonPrivate(base, 'costs/../x.json', {}), { code: 'path-outside' });
});

test('an existing but empty root is not ready: every write is data-missing and creates nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'costs-empty-'));
  for (const rel of ['costs/team-rates.json', 'costs/config.json', 'costs/hours/2026-01.json']) {
    assert.throws(() => s.writeJsonPrivate(root, rel, {}), { code: 'data-missing' }, rel);
  }
  assert.deepStrictEqual(fs.readdirSync(root), []);
  fs.mkdirSync(path.join(root, 'costs'));
  fs.writeFileSync(path.join(root, 'costs', 'config.json'), '{}');
  assert.strictEqual(s.rootReady(root), true);
});

test('a failed atomic write leaves no tmp file behind', () => {
  const root = tmpRoot();
  const circular = {};
  circular.self = circular;
  assert.throws(() => s.writeJsonPrivate(root, 'costs/team-rates.json', circular));
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'costs')), []);
  fs.mkdirSync(path.join(root, 'costs', 'x.json.tmp.' + process.pid), { recursive: true });
  assert.throws(() => s.writeJsonPrivate(root, 'costs/x.json', { a: 1 }));
  assert.ok(!fs.existsSync(path.join(root, 'costs', 'x.json')));
});
