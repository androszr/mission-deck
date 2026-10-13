// modules/meeting-archive/tests/test_publish_lib.mjs
// publish-lib.js (transcript -> meeting folder files, meta edits) and the
// SSE outcome parser of team-push.js. No server, no git.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pub = require('../server/publish-lib.js');
const lib = require('../server/meetings-lib.js');
const { parseSse, pushOutcome } = require('../server/team-push.js');

const DOC = {
  schemaVersion: 1, source_file: 'Refinement Atlas-20261001_093000-Meeting Recording.mp4',
  recorded_at: '2026-10-01T07:30:00.000Z', processed_at: '2026-10-08T01:20:00.000Z',
  duration_sec: 1800, model: 'gemini-3.8-flash', status: 'ok', warnings: [],
  title: 'Refinement: Wallet Pay and returns', brief: 'Short.',
  participants: [{ name: 'Alex Morgan', speaker_id: 'Alex Morgan' }, { name: ' ', speaker_id: 'x' }],
  segments: [{ speaker_id: 'Alex Morgan', start: 0, end: 2, text: 'Good morning.' }],
  transcript_txt: '[00:00:00] Alex Morgan: Good morning.',
  summary: { chosen_template: 'decision', template_reason: '', summary_md: '# Note' },
};

test('isValidTranscriptName: only names meeting-transcripts writes', () => {
  assert.ok(pub.isValidTranscriptName('2026-10-08-012000-refinement.json'));
  for (const bad of ['../x.json', '2026-10-08-012000-Refinement.json', 'a.json', null]) {
    assert.strictEqual(pub.isValidTranscriptName(bad), false, String(bad));
  }
});

test('folderNameFor: meeting time in Warsaw + ascii slug, unique', () => {
  const now = new Date('2026-10-08T01:25:00Z');
  const name = pub.folderNameFor(DOC, new Set(), now);
  assert.strictEqual(name, '2026-10-01_09-30_refinement-wallet-pay-and-returns');
  assert.strictEqual(pub.folderNameFor(DOC, new Set([name]), now), name + '-2');
  const noTitle = pub.folderNameFor({ ...DOC, title: '', recorded_at: null }, new Set(), now);
  assert.match(noTitle, /^2026-10-08_03-20_refinement-atlas-20261001-093000-meeting/);
});

test('buildMeetingFiles: the shapes meeting-archive list and detail read back', () => {
  const files = pub.buildMeetingFiles(DOC, { name: '2026-10-08-012000-refinement.json', folder: 'f', now: new Date('2026-10-08T02:00:00Z'), reportHtml: '<html></html>' });
  const md = JSON.parse(files['metadata.json']);
  const info = JSON.parse(files['meeting-info.json']);
  const um = JSON.parse(files['meeting-user-meta.json']);
  assert.strictEqual(md.status, 'ok');
  assert.strictEqual(md.source_transcript, '2026-10-08-012000-refinement.json');
  assert.strictEqual(md.has_transcript, true);
  assert.deepStrictEqual(info.participants, [{ name: 'Alex Morgan', speaker_id: 'Alex Morgan', member_id: null }]);
  assert.strictEqual(um.meeting_date, '2026-10-01');
  assert.deepStrictEqual(JSON.parse(files['transcript.json']).segments.length, 1);
  assert.strictEqual(files['summary.md'], '# Note\n');
  assert.ok(files['report.html']);
  const item = lib.buildListItem({ folder: 'f', metadata: md, info, userMeta: um, dir: null });
  assert.strictEqual(item.title, DOC.title);
  assert.strictEqual(item.date, '2026-10-01');
  assert.strictEqual(item.hasTranscript, true);
});

test('buildMeetingFiles: a republish keeps the user meta (categories, folder, title)', () => {
  const prev = { area_id: null, categories: ['cat-1'], meeting_date: '2026-09-30', virtual_folder_id: 'fld-1', custom_title: 'My title' };
  const files = pub.buildMeetingFiles(DOC, { name: 'n', folder: 'f', now: new Date(), reportHtml: null, userMeta: prev });
  assert.deepStrictEqual(JSON.parse(files['meeting-user-meta.json']), prev);
  assert.strictEqual(files['report.html'], undefined);
});

test('applyUserMetaEdit: validates against known ids, keeps unknown keys', () => {
  const known = { categoryIds: new Set(['cat-1-abcd']), folderIds: new Set(['fld-1-abcd']) };
  const ok = pub.applyUserMetaEdit({ area_id: 'x', categories: [] }, { title: ' New ', date: '2026-10-01', categoryIds: ['cat-1-abcd'], folderId: 'fld-1-abcd' }, known);
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.meta, { area_id: 'x', categories: ['cat-1-abcd'], meeting_date: '2026-10-01', virtual_folder_id: 'fld-1-abcd', custom_title: 'New' });
  assert.strictEqual(pub.applyUserMetaEdit(ok.meta, { title: '' }, known).meta.custom_title, undefined);
  assert.strictEqual(pub.applyUserMetaEdit({}, { categoryIds: ['cat-9-zzzz'] }, known).error, 'unknown-category');
  assert.strictEqual(pub.applyUserMetaEdit({}, { folderId: '../x' }, known).error, 'unknown-folder');
  assert.strictEqual(pub.applyUserMetaEdit({}, { date: '1.10.2026' }, known).error, 'bad-date');
});

test('subtreeIds and newId', () => {
  const folders = [{ id: 'a' }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'b' }, { id: 'd' }];
  assert.deepStrictEqual([...pub.subtreeIds(folders, 'a')].sort(), ['a', 'b', 'c']);
  assert.match(pub.newId('cat', 1781107580051, () => 0.5), /^cat-1781107580051-[a-z0-9]{4}$/);
});

test('team push: SSE outcome', () => {
  const ok = parseSse('event: start\ndata: {"op":"push"}\n\nevent: done\ndata: {"ok":true,"message":"Sent","files":3}\n\n');
  assert.deepStrictEqual(pushOutcome(ok, 200, null), { ok: true, message: 'Sent', files: 3 });
  const bad = parseSse('event: error\ndata: {"ok":false,"error":"no-write-token","message":"No token"}\n\n');
  assert.deepStrictEqual(pushOutcome(bad, 200, null), { ok: false, error: 'no-write-token', message: 'No token' });
  assert.strictEqual(pushOutcome([], 404, { error: 'unknown-operation' }).error, 'unknown-operation');
});
