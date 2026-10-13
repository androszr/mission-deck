// modules/sprint-review/tests/test_store.mjs
// server/store.js against a temp dataTier0Dir - never the real team data
// repo. Every path comes out of ctx.dataTier0Dir alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = require(path.join(DIR, 'server', 'store.js'));

function makeCtx() {
  const dataTier0Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-review-store-'));
  return { dataTier0Dir, log: () => {} };
}

function sampleSession(id, reviewDate) {
  return {
    id,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    reviewDate,
    sprintN: 18,
    sprintName: 'Sprint 18',
    deadline: '2026-09-11T10:00:00.000Z',
    facilitatorPo: 'Jordan Kim',
    meeting: 'team-review',
    teamGoals: [{ team: 'Atlas', goal: 'Cel', sprint_name: 'Atlas Sprint 18' }],
    submissions: {},
    cardsSentAt: null,
    confluencePageId: null,
    confluenceVersion: null,
  };
}

test('writeSession writes a shard and an index entry that survives a read', () => {
  const ctx = makeCtx();
  const session = sampleSession('sr-aaaaaaaaaaaaaaaa', '2026-09-17');
  store.writeSession(ctx, session);

  assert.ok(fs.existsSync(path.join(store.sessionsDir(ctx), 'sr-aaaaaaaaaaaaaaaa.json')));
  const read = store.readSession(ctx, 'sr-aaaaaaaaaaaaaaaa');
  assert.deepEqual(read, session);

  const list = store.listSessions(ctx);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, session.id);
  assert.equal(list[0].reviewDate, '2026-09-17');

  const index = JSON.parse(fs.readFileSync(store.indexFile(ctx), 'utf8'));
  assert.equal(index.meeting, 'team-review');
});

test('deleteSession removes the shard and its index entry', () => {
  const ctx = makeCtx();
  const session = sampleSession('sr-bbbbbbbbbbbbbbbb', '2026-09-17');
  store.writeSession(ctx, session);
  const existed = store.deleteSession(ctx, 'sr-bbbbbbbbbbbbbbbb');
  assert.equal(existed, true);
  assert.equal(store.readSession(ctx, 'sr-bbbbbbbbbbbbbbbb'), null);
  assert.equal(store.listSessions(ctx).length, 0);

  const existedAgain = store.deleteSession(ctx, 'sr-bbbbbbbbbbbbbbbb');
  assert.equal(existedAgain, false, 'deleting an already-gone shard is not an error');
});

test('rebuildIndex after deleting index.json gives back the same result byte-for-byte', () => {
  const ctx = makeCtx();
  store.writeSession(ctx, sampleSession('sr-cccccccccccccccc', '2026-09-17'));
  store.writeSession(ctx, sampleSession('sr-dddddddddddddddd', '2026-09-10'));
  const before = fs.readFileSync(store.indexFile(ctx), 'utf8');

  fs.unlinkSync(store.indexFile(ctx));
  const rebuiltList = store.listSessions(ctx); // self-heals: rebuilds and persists
  const after = fs.readFileSync(store.indexFile(ctx), 'utf8');

  assert.equal(after, before, 'rebuilt index.json is byte-identical to the original');
  assert.equal(rebuiltList.length, 2);
  assert.equal(rebuiltList[0].id, 'sr-cccccccccccccccc', 'sorted by reviewDate descending');
});

test('rebuildIndex skips a shard whose file name does not match its own id', () => {
  const ctx = makeCtx();
  store.writeSession(ctx, sampleSession('sr-eeeeeeeeeeeeeeee', '2026-09-17'));
  fs.mkdirSync(store.sessionsDir(ctx), { recursive: true });
  fs.writeFileSync(path.join(store.sessionsDir(ctx), 'sr-ffffffffffffffff.json'), JSON.stringify({ id: 'sr-not-the-file-name' }), 'utf8');
  fs.unlinkSync(store.indexFile(ctx));

  const list = store.listSessions(ctx);
  assert.equal(list.length, 1, 'the mismatched shard is skipped, not counted');
  assert.equal(list[0].id, 'sr-eeeeeeeeeeeeeeee');
});

test('shardPath rejects an id that does not match SESSION_ID_RE', () => {
  const ctx = makeCtx();
  assert.throws(() => store.shardPath(ctx, '../x'), store.BadIdError);
  assert.throws(() => store.shardPath(ctx, 'sr-not-hex'), store.BadIdError);
  assert.throws(() => store.readSession(ctx, '../../etc/passwd'), store.BadIdError);
});

test('storageState reads unavailable when dataTier0Dir does not exist', () => {
  const missing = { dataTier0Dir: path.join(os.tmpdir(), 'sprint-review-missing-' + Date.now()) };
  assert.equal(store.storageState(missing), 'unavailable');

  const ctx = makeCtx();
  assert.equal(store.storageState(ctx), 'unavailable', 'an existing but empty directory is also unavailable');
  fs.writeFileSync(path.join(ctx.dataTier0Dir, 'team-marker.json'), '{}', 'utf8');
  assert.equal(store.storageState(ctx), 'ok');
});
