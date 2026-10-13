// modules/meeting-transcripts/tests/test_frames.mjs
// Pure rules of frames.js: tile-name merging, directory matching, frame
// sampling and the majority-vote speaker correction. No Gemini, no ffmpeg.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fr = require('../server/frames.js');

const MEMBERS = [
  { id: 'tm-1', name: 'Alex Morgan' },
  { id: 'tm-2', name: 'Sam Rivera' },
  { id: 'tm-3', name: 'Jordan Lee' },
  { id: 'tm-4', name: 'Taylor Kimball' },
  { id: 'tm-5', name: 'Casey Novakowski' },
  { id: 'tm-6', name: 'Robin Hale' },
  { id: 'tm-7', name: 'Drew Hale' },
];

test('matchMember: Teams labels, prefixes, reversed order, truncation, diacritics', () => {
  const m = (n) => (fr.matchMember(n, MEMBERS) || {}).id || null;
  assert.strictEqual(m('EXT Morgan Alex'), 'tm-1');
  assert.strictEqual(m('Alex Morgan'), 'tm-1');
  assert.strictEqual(m('Lee Jordan CTR'), 'tm-3');
  assert.strictEqual(m('EXT Rivera S...'), 'tm-2');
  assert.strictEqual(m('Kimball'), 'tm-4');
  assert.strictEqual(m('Novakows'), 'tm-5', 'truncated surname prefix');
  assert.strictEqual(m('Jordan'), null, 'a lone first name is not unique');
  assert.strictEqual(m('Hale'), null, 'too short for the lone-surname rule');
  assert.strictEqual(m('Robin Hales'), null);
  assert.strictEqual(m('Speaker_1'), null);
  assert.strictEqual(m('Pat Example'), null);
});

test('mergeTileNames: ellipsis stripped, short labels dropped, the longest version wins', () => {
  let names = fr.mergeTileNames([], ['EXT Rivera S...', 'AB', 'Kimball …']);
  names = fr.mergeTileNames(names, ['EXT Rivera Sam', 'Kimball Taylor']);
  assert.deepStrictEqual(names, ['EXT Rivera Sam', 'Kimball Taylor']);
  assert.strictEqual(fr.canonicalName('EXT Rivera S...', MEMBERS), 'Sam Rivera');
  assert.strictEqual(fr.canonicalName('External guest', MEMBERS), 'External guest');
});

test('listFrames: frame_00001.jpg is t=0, one per 10 s', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-frames-'));
  try {
    for (const n of ['frame_00003.jpg', 'frame_00001.jpg', 'frame_00002.jpg', 'audio.mp3']) fs.writeFileSync(path.join(dir, n), '');
    assert.deepStrictEqual(fr.listFrames(dir).map((f) => f.ts), [0, 10, 20]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selectFrameTimestamps: midpoints of 8 s+, ends of 30 s+, chunk seams', () => {
  const avail = Array.from({ length: 70 }, (_, i) => i * 10); // 0..690
  const segs = [
    { start: 0, end: 5 },      // too short
    { start: 20, end: 30 },    // mid 25 -> 20 or 30
    { start: 100, end: 160 },  // long: 100, 130, 160
  ];
  const ts = fr.selectFrameTimestamps(segs, avail, 300);
  for (const t of [100, 130, 160, 300, 600]) assert.ok(ts.includes(t), 'missing ' + t);
  assert.ok(!ts.includes(0));
  assert.deepStrictEqual(ts, [...new Set(ts)].sort((a, b) => a - b));
});

test('applyVisualCorrections: majority overrides, ties and short segments stay', () => {
  const segs = [
    { speaker_id: 'Speaker_1', start: 0, end: 30, text: 'a' },
    { speaker_id: 'Speaker_2', start: 30, end: 50, text: 'b' },
    { speaker_id: 'Speaker_1', start: 50, end: 54, text: 'c' },
  ];
  const tl = new Map([[0, 'Alex Morgan'], [10, 'Alex Morgan'], [20, 'Sam Rivera'], [30, 'Sam Rivera'], [40, 'Jordan Lee'], [50, 'Jordan Lee']]);
  const r = fr.applyVisualCorrections(segs, tl);
  assert.strictEqual(r.segments[0].speaker_id, 'Alex Morgan');
  assert.strictEqual(r.segments[1].speaker_id, 'Speaker_2', '1:1 tie is not a majority');
  assert.strictEqual(r.segments[2].speaker_id, 'Speaker_1', 'under 8 s');
  assert.strictEqual(r.corrections, 1);
  assert.strictEqual(fr.applyVisualCorrections(segs, new Map()).corrections, 0);
});

test('canonicalizeSpeakers and loadMembers (first/last name shape)', () => {
  const out = fr.canonicalizeSpeakers([{ speaker_id: 'EXT Morgan Alex' }, { speaker_id: 'Speaker_3' }], MEMBERS);
  assert.deepStrictEqual(out.map((s) => s.speaker_id), ['Alex Morgan', 'Speaker_3']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-team-'));
  try {
    const f = path.join(dir, 'team-members.json');
    fs.writeFileSync(f, JSON.stringify({ team_members: [{ id: 'tm-9', first_name: 'Pat', last_name: 'Example' }] }));
    assert.deepStrictEqual(fr.loadMembers(f), [{ id: 'tm-9', name: 'Pat Example', first: 'Pat', last: 'Example', email: '' }]);
    assert.deepStrictEqual(fr.loadMembers(path.join(dir, 'missing.json')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('org labels are surname first, truncated to 3+ letters: EXT Morg, EXT Riv, EXT Hal, EXT Pen', () => {
  const dir = [
    { id: 'tm-a', name: 'Alex Morgan', first: 'Alex', last: 'Morgan', email: 'ext.a.morgan@example.com' },
    { id: 'tm-b', name: 'Sam Rivera', first: 'Sam', last: 'Rivera', email: 'ext.s.rivera@example.com' },
    { id: 'tm-c', name: 'Robin Halvorsen', first: 'Robin', last: 'Halvorsen', email: 'ext.r.halvorsen@example.com' },
    { id: 'tm-d', name: 'Drew Halvorsen', first: 'Drew', last: 'Halvorsen', email: 'd.halvorsen@example.com' },
    { id: 'tm-e', name: 'Jordan Lee', first: 'Jordan', last: 'Lee', email: 'j.lee@example.com' },
    { id: 'tm-f', name: 'Taylor Rivington', first: 'Taylor', last: 'Rivington', email: 't.rivington@example.com' },
    { id: 'tm-g', name: 'José Peña', first: 'José', last: 'Peña', email: 'ext.j.pena@example.com' },
  ];
  const m = (n) => (fr.matchMember(n, dir) || {}).id || null;
  assert.strictEqual(m('EXT Morg'), 'tm-a');
  assert.strictEqual(m('EXT Morgan Alex'), 'tm-a');
  assert.strictEqual(m('EXT Riv'), 'tm-b', 'Rivera and Rivington share "riv" - the ext mailbox decides');
  assert.strictEqual(m('EXT Hal'), 'tm-c', 'Robin (ext.) over Drew');
  assert.strictEqual(m('Lee Jordan CTR'), 'tm-e');
  assert.strictEqual(m('EXT Pen'), 'tm-g', 'diacritics folded: Peña');
  assert.strictEqual(m('EXT Mo'), null, 'two letters are too few');
  assert.strictEqual(m('Riv'), null, 'without a marker the 5-letter rule stays');
});

test('aliases: manual assignment for people outside the directory', () => {
  const aliases = [{ label: 'EXT Gue', name: 'Pat Guestworth' }];
  assert.strictEqual(fr.canonicalName('EXT Gue', MEMBERS, aliases), 'Pat Guestworth');
  assert.strictEqual(fr.canonicalName('EXT Guestworth Pat', MEMBERS, aliases), 'Pat Guestworth');
  assert.strictEqual(fr.canonicalName('EXT Gu...', MEMBERS, aliases), 'EXT Gu', 'two letters do not trigger an alias');
  assert.strictEqual(fr.canonicalName('Alex Morgan', MEMBERS, aliases), 'Alex Morgan');
});

test('mergeTileNames: org prefix is ignored when merging truncated variants', () => {
  assert.deepStrictEqual(fr.mergeTileNames(['EXT Morg'], ['EXT Morgan Alex', 'EXT Pen', 'EXT Pena J...']),
    ['EXT Morgan Alex', 'EXT Pena J']);
  assert.deepStrictEqual(fr.mergeTileNames([], ['EXT Riv', 'EXT Hal']), ['EXT Riv', 'EXT Hal'], 'different people stay apart');
});
