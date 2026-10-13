import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeSearch, filterArticles, sortArticles, areaOptions, categoryLabel, docTypeOf, hasConfluence, buildCrumbs,
} from '../client/filters.mjs';

const L = [
  { title: 'Interviews with partners', summary: 'Caf\u00e9 visit', date: '2026-02-01', area: 'atlas', subArea: 'pilot', category: 'interviews' },
  { title: 'Workshop', summary: 'x', date: '', area: 'atlas', subArea: null, category: 'workshop' },
  { title: 'Alpha', summary: 'y', date: '2026-03-01', area: 'borealis', subArea: null, category: 'research' },
];

test('normalizeSearch strips diacritics and the letter l-stroke', () => {
  assert.strictEqual(normalizeSearch('  Interviews with  Partners '), 'interviews with partners');
  assert.strictEqual(normalizeSearch('\u0141\u00f3d\u017a'), 'lodz');
});

test('filterArticles by area, subArea, docType, search', () => {
  assert.strictEqual(filterArticles(L, { area: 'atlas' }).length, 2);
  assert.strictEqual(filterArticles(L, { area: 'atlas', subArea: 'pilot' }).length, 1);
  assert.strictEqual(filterArticles(L, { docType: 'meetings' }).length, 1);
  assert.strictEqual(filterArticles(L, { search: 'cafe' }).length, 1);
  assert.strictEqual(filterArticles(L, { search: 'interview' }).length, 1);
  assert.strictEqual(docTypeOf('workshop'), 'meetings');
  assert.strictEqual(categoryLabel('nope'), 'Other');
});

test('sortArticles both orders, missing date last', () => {
  assert.deepStrictEqual(sortArticles(L, 'date-desc').map((a) => a.title), ['Alpha', 'Interviews with partners', 'Workshop']);
  assert.deepStrictEqual(sortArticles(L, 'title-asc').map((a) => a.title), ['Alpha', 'Interviews with partners', 'Workshop']);
});

test('areaOptions adds an area missing from the JSON', () => {
  const o = areaOptions([{ slug: 'atlas', label: 'Atlas' }], L);
  assert.deepStrictEqual(o.map((a) => a.slug), ['atlas', 'borealis']);
  assert.strictEqual(o[1].label, 'borealis');
});

test('hasConfluence is true only with sources', () => {
  assert.strictEqual(hasConfluence({ confluencePages: [] }), false);
  assert.strictEqual(hasConfluence({ confluencePages: ['1'] }), true);
  assert.strictEqual(hasConfluence({ frontmatter: { confluence_page_id: '5' } }), true);
  assert.strictEqual(hasConfluence(null), false);
});

test('buildCrumbs for list and detail', () => {
  const areas = [{ slug: 'atlas', label: 'Atlas', subareas: [{ slug: 'pilot', label: 'Pilot' }] }];
  const root = buildCrumbs(areas, {});
  assert.deepStrictEqual(root.map((c) => [c.label, c.current]), [['Knowledge base', true]]);
  const sub = buildCrumbs(areas, { area: 'atlas', subArea: 'pilot' });
  assert.deepStrictEqual(sub.map((c) => [c.label, c.current]), [['Knowledge base', false], ['Atlas', false], ['Pilot', true]]);
  const det = buildCrumbs(areas, { area: 'atlas', subArea: 'pilot' }, 'Doc');
  assert.strictEqual(det.length, 4);
  assert.strictEqual(det[3].label, 'Doc');
  assert.strictEqual(det[3].current, true);
  assert.strictEqual(det[2].subArea, 'pilot');
});
