// modules/time-log/tests/test_time_log_match.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildAuthorIndex, matchAuthor, personSlug } = require(path.join(DIR, 'server', 'match.js'));

test('matchAuthor: an email differing only by case matches by e-mail', () => {
  const members = [{ first_name: 'Alex', last_name: 'Morgan', email: 'ctr.a.morgan@example.com' }];
  const idx = buildAuthorIndex(members);
  const member = matchAuthor({ name: 'CTR.A.Morgan@Example.COM', displayName: 'anyone' }, idx);
  assert.strictEqual(member, members[0]);
});

test('matchAuthor: a displayName with a contract-code prefix matches by tokens when no e-mail is known', () => {
  const members = [{ first_name: 'Alex', last_name: 'Morgan', email: '' }];
  const idx = buildAuthorIndex(members);
  const member = matchAuthor({ name: 'unknown@example.com', displayName: 'CTR Morgan Alex' }, idx);
  assert.strictEqual(member, members[0]);
});

test('matchAuthor: "Sam Rive" does not match "Sam Riverton" without a >= 4-char prefix the other way', () => {
  const members = [{ first_name: 'Sam', last_name: 'Rive', email: '' }];
  const idx = buildAuthorIndex(members);
  const member = matchAuthor({ name: '', displayName: 'Sam Riverton' }, idx);
  assert.strictEqual(member, null);
});

test('personSlug: strips diacritics and resolves a collision with -2', () => {
  const taken = new Set();
  const a = personSlug({ first_name: 'Zoë', last_name: 'Ångström' }, taken);
  assert.strictEqual(a, 'zoe-angstrom');
  const b = personSlug({ first_name: 'Zoe', last_name: 'Angstrom' }, taken);
  assert.strictEqual(b, 'zoe-angstrom-2');
});
