// modules/meeting-transcripts/tests/test_onedrive_queue.mjs
// Pure rules of the OneDrive source (onedrive-lib.js) and the persistent
// queue (queue.js). Nothing here starts a browser, ffmpeg or Gemini.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const od = require('../server/onedrive-lib.js');
const { createQueue, isValidInput } = require('../server/queue.js');

// Placeholder tenant (Microsoft's documentation tenant name); the parser only
// accepts SharePoint Online hosts, so the tests need one.
const HOST = 'contoso-my.sharepoint.com';
const HOST_URL = 'https://' + HOST;

test('parseFolderUrl: onedrive.aspx?id= address of the folder view', () => {
  const r = od.parseFolderUrl(HOST_URL + '/personal/sam_rivera_contoso_com/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fsam_rivera_contoso_com%2FDocuments%2FRecordings&view=0');
  assert.strictEqual(r.site, '/personal/sam_rivera_contoso_com');
  assert.strictEqual(r.siteUrl, HOST_URL + '/personal/sam_rivera_contoso_com');
  assert.strictEqual(r.serverRelativePath, '/personal/sam_rivera_contoso_com/Documents/Recordings');
});

test('parseFolderUrl: direct path with spaces', () => {
  const r = od.parseFolderUrl(HOST_URL + '/personal/jordan_lee_contoso_com/Documents/Meetings%20-%20Product%20AI/');
  assert.strictEqual(r.serverRelativePath, '/personal/jordan_lee_contoso_com/Documents/Meetings - Product AI');
  assert.strictEqual(od.parseFolderUrl(r.url).serverRelativePath, r.serverRelativePath, 'the stored url parses back');
});

test('parseFolderUrl: /:f:/r/ copy-link address carries the real path', () => {
  const r = od.parseFolderUrl(HOST_URL + '/:f:/r/personal/alex_morgan_contoso_com/Documents/Recordings/Public?d=w0000000000000000000000000000000a&csf=1&web=1&e=AbCdEf');
  assert.strictEqual(r.serverRelativePath, '/personal/alex_morgan_contoso_com/Documents/Recordings/Public');
  assert.strictEqual(r.siteUrl, HOST_URL + '/personal/alex_morgan_contoso_com');
  assert.strictEqual(od.parseFolderUrl(r.url).serverRelativePath, r.serverRelativePath, 'the stored url parses back');
});

test('parseFolderUrl: refuses foreign hosts, sharing links, traversal and quotes', () => {
  for (const bad of [
    'https://evil.example.com/personal/x/Documents/Recordings',
    'http://' + HOST + '/personal/x/Documents/Recordings',
    HOST_URL + '/:f:/g/personal/x/EabcDEF',
    HOST_URL + '/personal/x/Documents/../../etc',
    HOST_URL + "/personal/x/Documents/a'b",
    HOST_URL + '/personal/x',
    'not an address', null, 42,
  ]) assert.strictEqual(od.parseFolderUrl(bad), null, String(bad));
});

test('normalizeSettings: first start watches no folder and carries the default schedule', () => {
  const s = od.normalizeSettings(null);
  assert.strictEqual(s.folders.length, 0);
  assert.deepStrictEqual(s.schedule, { enabled: true, time: '01:00' });
  assert.strictEqual(s.minSizeMb, 50);
  assert.strictEqual(s.maxFilesPerRun, 20);
  assert.strictEqual(s.autoPublish, false);
  assert.strictEqual(od.normalizeSettings({ minSizeMb: 0 }).minSizeMb, 0, 'an explicit 0 is kept');
});

test('normalizeSettings: invalid values fall back, duplicates collapse, empty list stays empty', () => {
  const url = HOST_URL + '/personal/a_b/Documents/Recordings';
  const s = od.normalizeSettings({
    schedule: { enabled: false, time: '25:00' }, minSizeMb: -1, sinceDate: 'yesterday', maxFilesPerRun: 0,
    folders: [{ url }, { url, label: 'dup' }, { url: 'bad' }], autoPublish: true,
  });
  assert.deepStrictEqual(s.schedule, { enabled: false, time: '01:00' });
  assert.strictEqual(s.minSizeMb, 50);
  assert.strictEqual(s.sinceDate, '2026-08-25');
  assert.strictEqual(s.maxFilesPerRun, 20);
  assert.strictEqual(s.folders.length, 1);
  assert.strictEqual(s.folders[0].label, 'Recordings');
  assert.strictEqual(s.autoPublish, true);
  assert.strictEqual(od.normalizeSettings({ folders: [] }).folders.length, 0);
});

test('pickNewFiles: extension, size, date floor, archive, settling and known ids', () => {
  const now = Date.parse('2026-10-08T10:00:00Z');
  const f = (name, size, created, extra) => ({
    Name: name, Length: String(size), TimeCreated: created, TimeLastModified: created, UniqueId: name.toUpperCase(), ...extra,
  });
  const files = [
    f('b.mp4', 80e6, '2026-10-02T09:00:00Z'),
    f('a.mp4', 80e6, '2026-10-01T09:00:00Z'),
    f('notes.docx', 80e6, '2026-10-01T09:00:00Z'),
    f('tiny.mp4', 1e6, '2026-10-01T09:00:00Z'),
    f('old.mp4', 80e6, '2026-08-01T09:00:00Z'),
    f('archived.mp4', 80e6, '2026-10-01T09:00:00Z'),
    f('fresh.mp4', 80e6, '2026-10-08T09:55:00Z'),
    f('known.mp4', 80e6, '2026-10-01T09:00:00Z'),
  ];
  const r = od.pickNewFiles(files, {
    minBytes: 50 * 1024 * 1024, sinceIso: '2026-08-25T00:00:00Z', known: new Set(['known.mp4']),
    archivedNames: new Set(['archived.mp4']), nowMs: now,
  });
  assert.deepStrictEqual(r.take.map((x) => x.name), ['a.mp4', 'b.mp4'], 'oldest first');
  assert.strictEqual(r.take[0].uniqueId, 'a.mp4', 'ids lower-cased');
  const reasons = Object.fromEntries(r.skipped.map((s) => [s.name, s.reason]));
  assert.deepStrictEqual(reasons, { 'notes.docx': 'ext', 'tiny.mp4': 'size', 'old.mp4': 'old', 'archived.mp4': 'archived', 'fresh.mp4': 'settling' });
});

test('isDue / nextRunAt: once a day at or after the slot, catch-up the same day', () => {
  const sched = { enabled: true, time: '01:00' };
  const at = (h, m) => new Date(2026, 9, 8, h, m);
  assert.strictEqual(od.isDue(sched, null, at(0, 59)), false);
  assert.strictEqual(od.isDue(sched, null, at(1, 0)), true);
  const key = od.todaySlot('01:00', at(1, 0)).key;
  assert.strictEqual(od.isDue(sched, key, at(9, 30)), false, 'already ran today');
  assert.strictEqual(od.isDue(sched, '2026-10-07T01:00', at(9, 30)), true, 'asleep at 01:00 -> runs on wake');
  assert.strictEqual(od.isDue({ enabled: false, time: '01:00' }, null, at(9, 0)), false);
  assert.strictEqual(new Date(od.nextRunAt(sched, key, at(9, 30))).getDate(), 9);
  assert.strictEqual(od.nextRunAt({ enabled: false, time: '01:00' }, null, at(9, 0)), null);
});

test('queue: add, next, update, interrupted reset, remove - persisted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-queue-'));
  const file = path.join(dir, 'queue.json');
  try {
    const q = createQueue(file);
    const a = q.add({ origin: 'upload', sourceName: 'a.mp4', sourceBytes: 1, input: 'u-a.mp4' });
    const b = q.add({ origin: 'onedrive', sourceName: 'b.mp4', sourceBytes: 2, input: 'b.mp4', uniqueId: 'x' });
    assert.strictEqual(q.next().id, a.id);
    q.update(a.id, { status: 'processing' });
    assert.strictEqual(q.next().id, b.id);
    const q2 = createQueue(file);
    assert.strictEqual(q2.resetInterrupted(), 1);
    assert.strictEqual(q2.get(a.id).status, 'queued');
    assert.ok(q2.remove(b.id));
    assert.strictEqual(createQueue(file).list().length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isValidInput: inbox names only', () => {
  assert.ok(isValidInput('u-0123abcd.mp4'));
  assert.ok(isValidInput('{6f1c-aa}.mp4'));
  for (const bad of ['../x.mp4', 'a/b.mp4', '', null, 'x'.repeat(200)]) assert.strictEqual(isValidInput(bad), false, String(bad));
});

test('keepaliveDue: off at 0, due after the interval since the last touch', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  assert.strictEqual(od.keepaliveDue(0, null, now), false);
  assert.strictEqual(od.keepaliveDue(4, null, now), true);
  assert.strictEqual(od.keepaliveDue(4, '2026-10-08T09:00:00Z', now), false);
  assert.strictEqual(od.keepaliveDue(4, '2026-10-08T07:59:00Z', now), true);
  assert.strictEqual(od.normalizeSettings(null).keepaliveHours, 4);
  assert.strictEqual(od.normalizeSettings({ keepaliveHours: 3 }).keepaliveHours, 4);
  assert.strictEqual(od.normalizeSettings({ keepaliveHours: 0 }).keepaliveHours, 0);
});
