import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const m = require('../server/match.js');

const roster = [
  { id: '1', first_name: 'Taylor', last_name: 'Kim', email: 't.kim@example.com' },
  { id: '2', first_name: 'Casey', last_name: 'Brook', email: 'casey.brook@example.com' },
  { id: '3', first_name: 'Casey', last_name: 'Brookfield', email: 'casey.brookfield@example.com' },
  { id: '4', first_name: 'Łucja', last_name: 'Bérard', email: 'l.berard@example.com' },
];
const idx = m.buildAuthorIndex(roster, roster);

test('e-mail exact wins over the display name', () => {
  const r = m.matchAuthor({ key: 'T.Kim@example.com', displayName: 'Someone Else' }, idx);
  assert.strictEqual(r.member.id, '1');
});

test('display name with org prefix matches regardless of word order', () => {
  assert.strictEqual(m.matchAuthor({ key: 'x', displayName: 'EXT Kim Taylor' }, idx).member.id, '1');
});

test('nameTokens drops org prefix and ctr suffix', () => {
  assert.deepStrictEqual([...m.nameTokens('EXT Kim Taylor CTR')].sort(), ['kim', 'taylor']);
});

test('two candidates are ambiguous, never assigned', () => {
  const r = m.matchAuthor({ key: 'x', displayName: 'Casey Broo' }, m.buildAuthorIndex(roster.slice(1, 3), roster.slice(1, 3)));
  assert.strictEqual(r.member, null);
  assert.strictEqual(r.reason, 'ambiguous');
  assert.strictEqual(r.candidates.length, 2);
});

test('asciiLower folds the l-with-stroke', () => {
  assert.strictEqual(m.asciiLower('Łucja Bérard'), 'lucja berard');
  assert.strictEqual(m.matchAuthor({ key: 'x', displayName: 'Lucja Berard' }, idx).member.id, '4');
});

test('a non-included roster member is a token target too (exact hit is that member)', () => {
  const local = m.buildAuthorIndex(roster, [roster[1]]);
  const r = m.matchAuthor({ key: 'x', displayName: 'Casey Brookfield' }, local);
  assert.strictEqual(r.member.id, '3');
});

test('an exact token-set match wins over a token superset', () => {
  const local = m.buildAuthorIndex([
    { id: 'a', first_name: 'Alex', last_name: 'Morgan' },
    { id: 'b', first_name: 'Alex', last_name: 'Morgan-Reed' },
  ], []);
  assert.strictEqual(m.matchAuthor({ key: 'x', displayName: 'Alex Morgan' }, local).member.id, 'a');
  assert.strictEqual(m.matchAuthor({ key: 'x', displayName: 'Morgan Alex' }, local).member.id, 'a');
});
