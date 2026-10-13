// modules/prod-bugs/tests/test_store.mjs
// server/store.js against throwaway directories - never the real team data clone.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const store = require('../server/store.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prod-bugs-store-'));
}

function shard(n) {
  return JSON.stringify({ sprint: n, areas: {} });
}

test('listShards: numeric order, ignores look-alikes, corrupt shard goes to skipped', () => {
  const dir = tmp();
  for (const n of [10, 2, 1]) fs.writeFileSync(path.join(dir, 'prod-bugs-sprint-' + n + '.json'), shard(n));
  fs.writeFileSync(path.join(dir, 'prod-bugs-sprint-5.json'), '{ not json');
  fs.writeFileSync(path.join(dir, 'sprint-3.json'), shard(3));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(dir, 'prod-bugs-sprint-x.json'), shard(0));
  const out = store.listShards(dir);
  assert.deepStrictEqual(out.availableSprints, [1, 2, 10]);
  assert.deepStrictEqual(out.sprints.map((s) => s.sprint), [1, 2, 10]);
  assert.deepStrictEqual(out.skipped, ['prod-bugs-sprint-5.json']);
});

test('listShards: a missing directory is an empty result, not a throw', () => {
  const out = store.listShards(path.join(tmp(), 'nope'));
  assert.deepStrictEqual(out, { sprints: [], availableSprints: [], skipped: [] });
});

test('parseSprintN accepts digits only', () => {
  assert.strictEqual(store.parseSprintN('12'), 12);
  assert.strictEqual(store.parseSprintN('012'), 12);
  assert.strictEqual(store.parseSprintN('1a'), null);
  assert.strictEqual(store.parseSprintN(''), null);
  assert.strictEqual(store.parseSprintN('../1'), null);
});

test('readShard: missing and corrupt are null, present is the object', () => {
  const dir = tmp();
  assert.strictEqual(store.readShard(dir, 7), null);
  fs.writeFileSync(path.join(dir, 'prod-bugs-sprint-7.json'), shard(7));
  assert.strictEqual(store.readShard(dir, 7).sprint, 7);
  fs.writeFileSync(path.join(dir, 'prod-bugs-sprint-8.json'), 'x');
  assert.strictEqual(store.readShard(dir, 8), null);
  assert.strictEqual(store.readShard(dir, -1), null);
});

test('readManifestSprints: no file is [], else the key', () => {
  const dir = tmp();
  assert.deepStrictEqual(store.readManifestSprints(dir), []);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ availableProdBugsSprints: [1, 2], latestWeek: 3 }));
  assert.deepStrictEqual(store.readManifestSprints(dir), [1, 2]);
});

test('storageState: empty or missing is unavailable, junk ignored', () => {
  const dir = tmp();
  assert.strictEqual(store.storageState(dir), 'unavailable');
  assert.strictEqual(store.storageState(path.join(dir, 'nope')), 'unavailable');
  fs.writeFileSync(path.join(dir, '.DS_Store'), '');
  assert.strictEqual(store.storageState(dir), 'unavailable');
  fs.mkdirSync(path.join(dir, 'progress'));
  assert.strictEqual(store.storageState(dir), 'ok');
});

test('teamDataDir: prefers ctx.dataRepoDir, falls back to DATA_SUB_REPOS_DIR', () => {
  assert.strictEqual(store.teamDataDir({ rootDir: '/x', dataRepoDir: () => '/host/dir' }), '/host/dir');
  const prev = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = '/tmp/subrepos';
  try {
    assert.strictEqual(store.teamDataDir({ rootDir: '/x', dataRepoDir: () => null }), path.join('/tmp/subrepos', 'ds-data'));
    assert.strictEqual(store.teamDataDir({ rootDir: '/x' }), path.join('/tmp/subrepos', 'ds-data'));
  } finally {
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
  }
});
