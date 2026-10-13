// modules/meeting-archive/tests/test_folder_assign.mjs
// folder-assign.js: series keys, the archive majority rule, Claude's answer
// parsing and the whole decision with an injected Claude.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fa = require('../server/folder-assign.js');

const FOLDERS = [
  { id: 'fld-1-atlas', name: 'Refinement - Atlas', parentId: null },
  { id: 'fld-2-cros', name: 'Cross refinements', parentId: null },
  { id: 'fld-3-dev', name: 'DevOps - Platform', parentId: null },
  { id: 'fld-4-idp', name: 'Internal Developer Platform', parentId: 'fld-3-dev' },
];
const KNOWN = new Set(FOLDERS.map((f) => f.id));
const A = (sourceFile, folderId, title) => ({ sourceFile, folderId, title: title || sourceFile });

test('seriesKey: Teams date tails, ticket ids, extensions and manual entries', () => {
  assert.strictEqual(fa.seriesKey('Refinement - Atlas (Next Generation)-20260911_090003UTC-Meeting Recording.mp4'), 'refinement atlas next generation');
  assert.strictEqual(fa.seriesKey('cross refinement - PROJ-4598-20260908_093017UTC-Meeting Recording.mp4'), 'cross refinement');
  assert.strictEqual(fa.seriesKey('Stocks-20261005_103529-Meeting recording.mp4'), 'stocks');
  assert.strictEqual(fa.seriesKey('Refinement Comet (Señor)-20260918_100042UTC-Meeting Recording.mp4'), 'refinement comet senor');
  assert.strictEqual(fa.seriesKey('manual-2026-06-11_22-33-12'), '');
});

test('seriesFolder: majority of at least 2 and 60%', () => {
  const idx = fa.seriesIndex([
    A('cross refinement - PROJ-1-20260101_090000UTC-Meeting Recording.mp4', 'fld-2-cros'),
    A('cross refinement - PROJ-2-20260102_090000UTC-Meeting Recording.mp4', 'fld-2-cros'),
    A('cross refinement - PROJ-3-20260103_090000UTC-Meeting Recording.mp4', 'fld-1-atlas'),
    A('Devops - planning-20260101_090000UTC-Meeting Recording.mp4', 'fld-3-dev'),
    A('Devops - planning-20260108_090000UTC-Meeting Recording.mp4', 'fld-4-idp'),
    A('Stocks-20260101_103529-Meeting recording.mp4', 'fld-3-dev'),
  ]);
  const r = fa.seriesFolder('cross refinement - PROJ-9-20261001_090000UTC-Meeting Recording.mp4', idx, KNOWN);
  assert.deepStrictEqual(r, { folderId: 'fld-2-cros', count: 2, total: 3 });
  assert.strictEqual(fa.seriesFolder('Devops - planning-20261005_110123UTC-Meeting Recording.mp4', idx, KNOWN), null, '1:1 split');
  assert.strictEqual(fa.seriesFolder('Stocks-20261005_103529-Meeting recording.mp4', idx, KNOWN), null, 'one meeting is no series');
  assert.strictEqual(fa.seriesFolder('New series-20261005_103529UTC-Meeting Recording.mp4', idx, KNOWN), null);
});

test('parseAnswer: envelope or bare JSON, unknown ids refused', () => {
  const env = JSON.stringify({ type: 'result', result: '{"folder_id": "fld-3-dev", "confidence": 0.8, "reason": "DevOps planning."}' });
  assert.deepStrictEqual(fa.parseAnswer(env, KNOWN), { folderId: 'fld-3-dev', confidence: 0.8, reason: 'DevOps planning.' });
  assert.strictEqual(fa.parseAnswer('{"folder_id": "fld-x-evil", "confidence": 1, "reason": ""}', KNOWN).folderId, null);
  assert.strictEqual(fa.parseAnswer('{"folder_id": null, "confidence": 0.9, "reason": "Nothing"}', KNOWN).folderId, null);
  assert.strictEqual(fa.parseAnswer('no idea', KNOWN), null);
});

test('buildPrompt: folder paths with example titles, the meeting last', () => {
  const p = fa.buildPrompt({
    folders: FOLDERS,
    examples: new Map([['fld-4-idp', ['Devops Refinement']]]),
    meeting: { title: 'Review DEVOPS', brief: 'Review.', sourceFile: 'Review DEVOPS.mp4' },
  });
  assert.ok(p.includes('folder: DevOps - Platform / Internal Developer Platform | example meetings: "Devops Refinement"'));
  assert.ok(p.indexOf('Title: Review DEVOPS') > p.indexOf('fld-4-idp'));
});

test('assignFolder: series first (no Claude call), else Claude, else none', async () => {
  const archive = [
    A('Refinement - Atlas (Next Generation)-20260901_090000UTC-Meeting Recording.mp4', 'fld-1-atlas', 'Refinement A'),
    A('Refinement - Atlas (Next Generation)-20260902_090000UTC-Meeting Recording.mp4', 'fld-1-atlas', 'Refinement B'),
  ];
  let calls = 0;
  const run = async () => { calls += 1; return { ok: true, stdout: JSON.stringify({ result: '{"folder_id":"fld-3-dev","confidence":0.9,"reason":"DevOps."}' }) }; };
  const s = await fa.assignFolder({ meeting: { title: 't', brief: '', sourceFile: 'Refinement - Atlas (Next Generation)-20261001_090000UTC-Meeting Recording.mp4' }, archive, folders: FOLDERS, run });
  assert.strictEqual(s.folderId, 'fld-1-atlas');
  assert.strictEqual(s.auto.by, 'series');
  assert.strictEqual(calls, 0);
  const c = await fa.assignFolder({ meeting: { title: 'Review DEVOPS', brief: '', sourceFile: 'Review DEVOPS-20260928_110016UTC-Meeting Recording.mp4' }, archive, folders: FOLDERS, run });
  assert.deepStrictEqual([c.folderId, c.auto.by, calls], ['fld-3-dev', 'claude', 1]);
  const low = await fa.assignFolder({ meeting: { title: 'x', brief: '', sourceFile: 'x.mp4' }, archive, folders: FOLDERS,
    run: async () => ({ ok: true, stdout: '{"folder_id":"fld-3-dev","confidence":0.3,"reason":"Not sure."}' }) });
  assert.strictEqual(low.folderId, null);
  const failed = await fa.assignFolder({ meeting: { title: 'x', brief: '', sourceFile: 'x.mp4' }, archive, folders: FOLDERS,
    run: async () => ({ ok: false, stdout: '', reason: 'claude-missing' }) });
  assert.deepStrictEqual([failed.folderId, failed.auto, failed.note], [null, null, 'claude-claude-missing']);
});

test('claudeEnv: no vault token reaches the child', () => {
  const env = fa.claudeEnv({ HOME: '/h', PATH: '/p', ANTHROPIC_API_KEY: 'k', GITLAB_KNOWLEDGE_HUB_TOKEN: 'secret', GEMINI_PERSONAL_TOKEN: 's' });
  assert.deepStrictEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'HOME', 'PATH']);
});
