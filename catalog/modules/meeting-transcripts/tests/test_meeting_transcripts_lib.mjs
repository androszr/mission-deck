// modules/meeting-transcripts/tests/test_meeting_transcripts_lib.mjs
// The pure rules of the pipeline (server/lib.js). Nothing here calls Gemini
// or ffmpeg.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { APP_ROOT } from './_root.mjs';

const require = createRequire(import.meta.url);
const lib = require('../server/lib.js');

test('mergeChunkSegments: offsets, failed chunk, window clip, inverted and past-EOF segments', () => {
  const chunks = [
    { ok: true, segments: [
      { speaker_id: 'A', start: 10, end: 20, text: 'one' },
      { speaker_id: 'A', start: 30, end: 25, text: 'inverted' },
      { speaker_id: 'B', start: 295, end: 310, text: 'on the edge' },
      { speaker_id: 'B', start: 305, end: 320, text: 'outside the window' },
    ] },
    { ok: false, segments: [{ speaker_id: 'X', start: 1, end: 2, text: 'should not be here' }] },
    { ok: true, segments: [
      { speaker_id: 'A', start: 5, end: 9, text: 'three' },
      { speaker_id: 'A', start: 200, end: 210, text: 'past the end' },
    ] },
  ];
  // duration 700 s -> last chunk window = 700 - 600 + 5 = 105 s
  const out = lib.mergeChunkSegments(chunks, { chunkSec: 300, duration: 700 });
  assert.deepStrictEqual(out.map((s) => [s.text, s.start, s.end, s.chunk]), [
    ['one', 10, 20, 0],
    ['on the edge', 295, 300, 0],
    ['three', 605, 609, 2],
  ]);
});

test('findGaps: internal and trailing gaps become padded slices of at most 240 s', () => {
  const segs = [
    { start: 0, end: 20 },
    { start: 120, end: 130 },
  ];
  const slices = lib.findGaps(segs, 300);
  assert.deepStrictEqual(slices, [
    { start: 17, end: 123 },
    { start: 127, end: 300 },
  ]);
  const long = lib.findGaps([{ start: 0, end: 5 }], 600);
  assert.ok(long.every((s) => s.end - s.start <= 240 + 6), 'every slice <= 240 s plus padding');
  assert.strictEqual(long[0].start, 2);
  assert.strictEqual(long[long.length - 1].end, 600);
});

test('spliceGapSegments: the padded slice does not duplicate the neighbouring segment', () => {
  const chunk = [{ start: 1, end: 10, text: 'old' }, { start: 250, end: 260, text: 'later' }];
  const slice = { start: 7, end: 253 };
  const fromSlice = [
    { start: 8, end: 10, text: 'old (again)' },
    { start: 40, end: 50, text: 'new' },
    { start: 251, end: 253, text: 'later (again)' },
  ];
  const out = lib.spliceGapSegments(chunk, slice, fromSlice);
  assert.deepStrictEqual(out.map((s) => s.text), ['old', 'new', 'later']);
});

test('applySpeakerMap unifies per chunk; prefixSpeakers keeps two chunks Person_1 apart', () => {
  const segs = [
    { chunk: 0, speaker_id: 'Person_1', start: 0, end: 1, text: 'a' },
    { chunk: 1, speaker_id: 'Person_1', start: 300, end: 301, text: 'b' },
  ];
  const mapped = lib.applySpeakerMap(segs, [
    { chunk: 0, local_id: 'Person_1', global_id: 'Alex' },
    { chunk: 1, local_id: 'Person_1', global_id: 'Sam' },
  ]);
  assert.deepStrictEqual(mapped.map((s) => s.speaker_id), ['Alex', 'Sam']);
  assert.strictEqual(lib.applySpeakerMap(segs, [{ chunk: 0, local_id: 'Person_1', global_id: 'Alex' }]), null,
    'an incomplete map is refused, not half-applied');
  assert.deepStrictEqual(lib.prefixSpeakers(segs).map((s) => s.speaker_id), ['s1_Person_1', 's2_Person_1']);
});

test('outputFileName / slugify / isValidOutputName', () => {
  const d = new Date('2026-10-03T12:15:00Z'); // 14:15:00 in Europe/Warsaw (CEST)
  const name = lib.outputFileName(d, 'Team sync (Teams).mp4');
  assert.strictEqual(name, '2026-10-03-141500-team-sync-teams.json');
  assert.ok(lib.isValidOutputName(name));
  assert.ok(!lib.isValidOutputName('../x.json'));
  assert.ok(!lib.isValidOutputName('2026-10-03-141500-../../x.json'));
  assert.strictEqual(lib.slugify('Café - Øresund ł.m4a'), 'cafe-resund-l');
  assert.strictEqual(lib.slugify('....'), 'recording');
});

test('buildOutputDoc: required keys, segments key kept, partial status, no API key anywhere', () => {
  process.env.GEMINI_PERSONAL_TOKEN = 'SECRET-TEST-KEY';
  const doc = lib.buildOutputDoc({
    sourceFile: 'a.mp4', sourceBytes: 10, processedAt: '2026-10-03T12:00:00.000Z', durationSec: 61.234,
    model: 'gemini-3.8-flash', warnings: ['chunk-failed:00:05:00-00:10:00'],
    summary: { title: 'T', brief: 'B', chosen_template: 'meeting-notes-decision', template_reason: 'R', summary_md: '# S' },
    segments: [{ chunk: 0, speaker_id: 'Alex', start: 0, end: 2, text: 'Good morning' }],
  });
  for (const k of ['schemaVersion', 'source_file', 'processed_at', 'duration_sec', 'model', 'status', 'title', 'brief', 'participants', 'segments', 'transcript_txt', 'summary']) {
    assert.ok(k in doc, 'missing ' + k);
  }
  assert.strictEqual(doc.status, 'partial');
  assert.deepStrictEqual(doc.segments[0], { speaker_id: 'Alex', start: 0, end: 2, text: 'Good morning' });
  assert.strictEqual(doc.transcript_txt, '[00:00:00] Alex: Good morning');
  assert.ok(!JSON.stringify(doc).includes('SECRET-TEST-KEY'));
  delete process.env.GEMINI_PERSONAL_TOKEN;
});

test('isValidUploadId / allowedExtension / parseParticipants', () => {
  assert.ok(lib.isValidUploadId('0123456789abcdef01234567'));
  for (const bad of ['', '../etc', '0123456789abcdef012345678', '0123456789ABCDEF01234567', null]) {
    assert.ok(!lib.isValidUploadId(bad), String(bad));
  }
  assert.strictEqual(lib.allowedExtension('Recording.MP4'), '.mp4');
  assert.strictEqual(lib.allowedExtension('file.exe'), null);
  assert.deepStrictEqual(lib.parseParticipants(' Alex Morgan, Sam  Rivera ;Alex Morgan,, '), ['Alex Morgan', 'Sam Rivera']);
});

// -- HTML report on templates/meeting-report.template.html ------------------
// The template text itself belongs to the core; these checks look only at
// what report.js puts into it.

const report = require('../server/report.js');
const TPL = fs.readFileSync(path.join(APP_ROOT, 'templates', 'meeting-report.template.html'), 'utf8');

const DOC = {
  source_file: 'Meeting <b>.m4a', processed_at: '2026-10-03T12:00:00.000Z', recorded_at: null, duration_sec: 125, model: 'gemini-3.8-flash',
  title: 'Deadline <script>alert(1)</script>', brief: 'Briefly about the deadline.',
  participants: [{ name: 'Alex Morgan', speaker_id: 'Alex Morgan' }, { name: 'Person_1', speaker_id: 'Person_1' }],
  segments: [{ speaker_id: 'Alex Morgan', start: 61, end: 70, text: 'I suggest October 15 & <test>.' }],
  summary: { chosen_template: 'meeting-notes-decision', template_reason: '', summary_md: '# S' },
  report: {
    tldr_strong: 'Rollout on 15.10', tldr_body: 'Provided the tests pass.',
    participant_roles: [{ name: 'Alex Morgan', role: 'facilitator' }],
    topics: [{ title: 'Deadline', tag: 'agreed', body_md: '#### Context\n- **order** screen\n- tests\n\nParagraph.' }],
    decisions: ['Deadline **15.10**'],
    action_items: [{ who: 'Sam', task: 'Tests at 2 sites', when: '', status: 'risk' }],
    risks: [{ level: 'risk', strong: 'Environment', body: 'may be unavailable' }],
    qa: [], open_questions: [], next_steps: [{ strong: 'Review with the PO', span: 'next week' }],
  },
};

test('renderReport: a self-contained report, no tokens, no script, logo kept, text escaped', () => {
  const html = report.renderReport(TPL, DOC, { jsonName: '2026-10-03-120000-deadline.json' });
  assert.strictEqual((html.match(/\{\{/g) || []).length, 0, 'no unfilled token');
  assert.ok(!/<script/i.test(html), 'no <script> at all - the title is escaped');
  assert.ok(html.includes('Deadline &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('src="data:image/'), 'embedded logo kept');
  assert.ok(!html.includes('BEGIN component'), 'template instructions stripped');
  assert.ok(html.includes('<span class="ava">AM</span>Alex Morgan<span class="role">facilitator</span>'));
  assert.ok(html.includes('<span class="person"><span class="ava">S1</span>Person_1</span>'), 'no empty role span');
  assert.ok(html.includes('<h4>Context</h4>') && html.includes('<li><strong>order</strong> screen</li>'));
  assert.ok(html.includes('<span class="badge risk">at risk</span>'));
  assert.ok(html.includes('<div class="callout risk">'));
  assert.ok(html.includes('<li>Deadline <strong>15.10</strong></li>'));
  assert.ok(!html.includes('class="qa"'), 'empty components removed');
  assert.ok(html.includes('00:01:01 · Alex Morgan') && html.includes('October 15 &amp; &lt;test&gt;.'));
  assert.ok(html.includes('href="2026-10-03-120000-deadline.json"'));
  assert.ok(html.includes('Decision meeting'));
});

test('renderReport: without report content falls back to the summary as the only topic', () => {
  const html = report.renderReport(TPL, { ...DOC, report: null }, {});
  assert.strictEqual((html.match(/\{\{/g) || []).length, 0);
  assert.ok(html.includes('Summary</h3>') || html.includes('Summary<'));
  assert.ok(!html.includes('<li>Deadline <strong>15.10</strong></li>') && !html.includes('href=""'));
});

test('reportFileName: the report sits next to its JSON', () => {
  assert.strictEqual(lib.reportFileName('2026-10-03-120000-deadline.json'), '2026-10-03-120000-deadline.html');
});

test('pickLatestModels: highest Flash (the one the module uses), GA beats preview, variants skipped', () => {
  const { pickLatestModels } = require('../server/gemini.js');
  const gc = ['generateContent'];
  const names = [
    'gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-preview',
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-tts-preview', 'gemini-3.9-flash-image', 'gemini-4.0-pro-exp-0930',
  ].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: gc }));
  names.push({ name: 'models/gemini-9.9-pro', supportedGenerationMethods: ['embedContent'] });
  assert.deepStrictEqual(pickLatestModels(names), { flash: 'gemini-3.8-flash', pro: 'gemini-3.1-pro-preview' });
  names.push({ name: 'models/gemini-4.0-flash-preview', supportedGenerationMethods: gc });
  assert.strictEqual(pickLatestModels(names).flash, 'gemini-4.0-flash-preview', 'a newer Flash replaces 3.8 on its own');
  assert.deepStrictEqual(pickLatestModels([]), { flash: null, pro: null });
});

// -- 0.2.0: gap-retry timestamps and repeated speech -----------------------------

test('clampToSlice: segments a short slice places outside itself are dropped, ends clipped', () => {
  const slice = { start: 36, end: 87 };
  const { kept, dropped } = lib.clampToSlice([
    { start: 40, end: 45, text: 'inside' },
    { start: 85, end: 95, text: 'ends past the slice' },
    { start: 120, end: 126, text: 'time outside the recorded piece' },
    { start: 30, end: 33, text: 'before the slice' },
    { start: 50, end: 49, text: 'inverted' },
  ], slice);
  assert.deepStrictEqual(kept.map((s) => [s.start, s.end]), [[40, 45], [85, 87]]);
  assert.strictEqual(dropped.length, 3);
});

test('dedupeRepeats: a run repeated ~40 s later is removed once, short lines inside it too', () => {
  const S = (start, text, gap) => ({ speaker_id: 'x', start, end: start + 3, text, gap: gap || null });
  const segs = [
    S(88, 'Jordan, could you walk everyone through your side of the release plan today?'),
    S(91, 'Sorry?'),
    S(100, 'Only Casey would be useful here, there is one ticket today and I want to discuss the frontend part'),
    S(128, 'Jordan, could you walk everyone through your side of the release plan?'),
    S(131, 'Sorry?'),
    S(141, 'Only Casey would be useful here, there is one ticket uh today, I want to discuss the frontend part'),
    S(150, 'Fine, let us start, a short introduction given how involved the whole team has been'),
  ];
  const r = lib.dedupeRepeats(segs);
  assert.deepStrictEqual(r.removed.map((s) => s.start), [128, 131, 141]);
  assert.strictEqual(r.segments.length, 4);
});

test('dedupeRepeats: the copy from a gap retry loses even when it comes first', () => {
  const S = (start, text, gap) => ({ speaker_id: 'x', start, end: start + 3, text, gap: gap || null });
  const r = lib.dedupeRepeats([
    S(90, 'I have just one doubt regarding this particular price here Jordan', '0:36'),
    S(130, 'I have just one doubt regarding this particular price here, Jordan'),
  ]);
  assert.deepStrictEqual(r.removed.map((s) => s.start), [90]);
});

test('dedupeRepeats: similar but different sentences stay (fillers are not evidence)', () => {
  const S = (start, text) => ({ speaker_id: 'x', start, end: start + 3, text });
  const segs = [
    S(1420, 'I was hesitating between five and eight points.'),
    S(1429, 'I was also hesitating between three and five, but we are talking about the scheduler alone'),
    S(1446, 'Well, but surely not as much as eight.'),
    S(1450, 'Then I would go with five, but not three.'),
    S(2000, 'I was hesitating between five and eight points.'),
  ];
  assert.strictEqual(lib.dedupeRepeats(segs).removed.length, 0);
});
