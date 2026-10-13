import test from 'node:test';
import assert from 'node:assert';
import {
  normaliseSearch, filterMeetings, breadcrumbFor, childrenOf, meetingsIn,
  groupTranscript, speakerLabel, tsLabel,
} from '../client/list-helpers.mjs';

test('normaliseSearch and filterMeetings', () => {
  assert.strictEqual(normaliseSearch('Novák Łukas'), 'novak lukas');
  const meetings = [
    { title: 'Scheduling', brief: '', participants: [{ name: 'Casey Novák' }], categoryIds: ['c1'] },
    { title: 'Other', brief: 'nothing', participants: [], categoryIds: ['c2'] },
  ];
  const cats = { c1: { name: 'Workspace' }, c2: { name: 'Capacitor' } };
  assert.strictEqual(filterMeetings(meetings, { query: 'schedul', categoriesById: cats }).length, 1);
  assert.strictEqual(filterMeetings(meetings, { query: 'novak', categoriesById: cats })[0].title, 'Scheduling');
  assert.strictEqual(filterMeetings(meetings, { query: 'capacitor', categoriesById: cats })[0].title, 'Other');
  assert.strictEqual(filterMeetings(meetings, { categoryId: 'c2' }).length, 1);
});

test('breadcrumbFor, childrenOf, meetingsIn over a two-level tree', () => {
  const folders = [
    { id: 'a', name: 'A', parentId: null, order: 2 },
    { id: 'b', name: 'B', parentId: null, order: 1 },
    { id: 'a1', name: 'A1', parentId: 'a', order: 0 },
  ];
  assert.deepStrictEqual(childrenOf(folders, null).map((f) => f.id), ['b', 'a']);
  assert.deepStrictEqual(breadcrumbFor(folders, 'a1'), [{ id: 'a', name: 'A' }, { id: 'a1', name: 'A1' }]);
  assert.deepStrictEqual(breadcrumbFor(folders, null), []);
  const m = [{ folderId: 'a1' }, { folderId: null }, { folderId: 'ghost' }];
  assert.strictEqual(meetingsIn(m, folders, null).length, 2);
  assert.strictEqual(meetingsIn(m, folders, 'a1').length, 1);
});

test('groupTranscript, speakerLabel, tsLabel', () => {
  const input = [
    { speaker_id: 'B', start: 5, text: 'two' },
    { speaker_id: 'A', start: 0, text: 'one' },
    { speaker_id: 'A', start: 2, text: '  ' },
    { speaker_id: 'A', start: 3, text: 'three' },
  ];
  const copy = JSON.parse(JSON.stringify(input));
  const g = groupTranscript(input);
  assert.deepStrictEqual(input, copy);
  assert.deepStrictEqual(g, [
    { speaker: 'A', start: 0, texts: ['one', 'three'] },
    { speaker: 'B', start: 5, texts: ['two'] },
  ]);
  assert.strictEqual(speakerLabel('Jordan Lee CTR', 0), 'Jordan Lee CTR');
  assert.strictEqual(speakerLabel('speaker_1'), 'Speaker 1');
  assert.strictEqual(speakerLabel('SPEAKER_00'), 'Speaker 0');
  assert.strictEqual(speakerLabel('person 3'), 'Speaker 3');
  assert.strictEqual(tsLabel(3671), '1:01:11');
  assert.strictEqual(tsLabel(75), '1:15');
});

test('buildCrumbs: list mode ends on the folder, detail mode on the title', async () => {
  const { buildCrumbs } = await import('../client/list-helpers.mjs');
  const folders = [{ id: 'a', name: 'A', parentId: null, order: 0 }, { id: 'a1', name: 'A1', parentId: 'a', order: 0 }];
  assert.deepStrictEqual(buildCrumbs(folders, null, ''), [
    { label: 'All meetings', folderId: '', current: true }]);
  assert.deepStrictEqual(buildCrumbs(folders, 'a1', '').map((c) => [c.label, c.current]),
    [['All meetings', false], ['A', false], ['A1', true]]);
  const d = buildCrumbs(folders, 'a', 'Meeting X');
  assert.deepStrictEqual(d.map((c) => [c.label, c.current]),
    [['All meetings', false], ['A', false], ['Meeting X', true]]);
  assert.deepStrictEqual(buildCrumbs(folders, null, 'T').map((c) => c.label), ['All meetings', 'T']);
});
