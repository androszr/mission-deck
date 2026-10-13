// modules/onboarding/tests/test_onboarding_store.mjs
// Pure functions of server/onboarding-store.js: slugify, uniqueSlug,
// validateLink, sanitizeRows, sortPlans and copyTemplate.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = require(path.join(DIR, 'server', 'onboarding-store.js'));

test('slugify: ASCII-fold + kebab-case, matches modules/time-off/client/time-off-lib.js shape', () => {
  assert.strictEqual(store.slugify('Alex Morgan'), 'alex-morgan');
  assert.strictEqual(store.slugify('Rivera-Kim Sam'), 'rivera-kim-sam');
  assert.strictEqual(store.slugify('Zo\u00eb \u0141\u00f3pez'), 'zoe-lopez');
});

test('[bug FUNC-blocker] slugify: never lets a path-traversal or path-separator character through', () => {
  assert.strictEqual(store.slugify('../../../../tmp/x'), 'tmp-x');
  assert.strictEqual(store.slugify('a/b\\c'), 'a-b-c');
  assert.strictEqual(store.slugify('...'), 'plan', 'a name made entirely of stripped characters falls back to plan, never empty');
  assert.strictEqual(store.slugify(''), 'plan');
  assert.strictEqual(store.slugify('/'), 'plan');
  // Every output must itself satisfy the safety regex - this is the
  // property personFile relies on.
  for (const input of ['../../../../tmp/x', 'a/b\\c', '...', '', '/', 'Zo\u00eb/../\u0141\u00f3pez']) {
    assert.strictEqual(store.isValidSlug(store.slugify(input)), true, 'slugify(' + JSON.stringify(input) + ') must be a valid slug');
  }
});

test('[bug FUNC-blocker] isValidSlug / SLUG_RE: rejects anything outside [a-z0-9-]', () => {
  assert.strictEqual(store.isValidSlug('alex-morgan'), true);
  assert.strictEqual(store.isValidSlug('plan-2'), true);
  assert.strictEqual(store.isValidSlug('../evil'), false);
  assert.strictEqual(store.isValidSlug('a/b'), false);
  assert.strictEqual(store.isValidSlug('a\\b'), false);
  assert.strictEqual(store.isValidSlug(''), false);
  assert.strictEqual(store.isValidSlug(null), false);
  assert.strictEqual(store.isValidSlug(undefined), false);
  assert.strictEqual(store.isValidSlug(42), false);
});

test('[bug FUNC-blocker] isPathSafeSegment: the security boundary - rejects a separator or a literal dot-segment, nothing else', () => {
  assert.strictEqual(store.isPathSafeSegment('alex-morgan'), true);
  assert.strictEqual(store.isPathSafeSegment('sam-rivera-(bs)'), true, 'an unusual but harmless legacy slug stays safe');
  assert.strictEqual(store.isPathSafeSegment("o'brien"), true);
  assert.strictEqual(store.isPathSafeSegment('...'), true, 'dots alone never resolve outside the directory - only a separator can');
  assert.strictEqual(store.isPathSafeSegment('..'), false, 'the literal parent-directory segment is the one dot-only case that is dangerous');
  assert.strictEqual(store.isPathSafeSegment('.'), false);
  assert.strictEqual(store.isPathSafeSegment('../evil'), false);
  assert.strictEqual(store.isPathSafeSegment('a/b'), false);
  assert.strictEqual(store.isPathSafeSegment('a\\b'), false);
  assert.strictEqual(store.isPathSafeSegment(''), false);
  assert.strictEqual(store.isPathSafeSegment(null), false);
  assert.strictEqual(store.isPathSafeSegment(undefined), false);
});

test('[bug FUNC-blocker] personFile: throws on a traversal slug instead of returning a path outside people/', () => {
  const dataTier0Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-personfile-'));
  assert.throws(() => store.personFile(dataTier0Dir, '../../../../tmp/evil'));
  assert.throws(() => store.personFile(dataTier0Dir, '..'));
  assert.throws(() => store.personFile(dataTier0Dir, 'a/b'));
  assert.throws(() => store.personFile(dataTier0Dir, ''));
  assert.throws(() => store.personFile(dataTier0Dir, null));
  // A safe slug still resolves inside people/ - including one that is
  // unusual but not dangerous, which personFile must serve for an existing
  // shard even though slugify would never mint it today.
  const safe = store.personFile(dataTier0Dir, 'alex-morgan');
  const peopleDir = path.resolve(store.personsDir(dataTier0Dir)) + path.sep;
  assert.ok(path.resolve(safe).startsWith(peopleDir));
  const legacy = store.personFile(dataTier0Dir, 'sam-rivera-(bs)');
  assert.ok(path.resolve(legacy).startsWith(peopleDir));
});

test('personFileIn: the same gate keyed on the people/ directory itself', () => {
  const people = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-people-'));
  assert.throws(() => store.personFileIn(people, '../evil'));
  assert.throws(() => store.personFileIn(people, 'a/b'));
  const ok = store.personFileIn(people, 'casey-novak');
  assert.strictEqual(ok, path.join(people, 'casey-novak.json'));
  // personFile is a thin wrapper over it, so the two cannot drift.
  const tier0 = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-tier0-'));
  assert.strictEqual(store.personFile(tier0, 'casey-novak'), store.personFileIn(store.personsDir(tier0), 'casey-novak'));
});

test('[bug FUNC-blocker] readPersons: skips a shard whose slug fails isPathSafeSegment rather than letting it reach existing.slug', () => {
  const dataTier0Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-readpersons-'));
  const personsDir = store.personsDir(dataTier0Dir);
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(personsDir, 'evil.json'), JSON.stringify({
    id: 'plan-evil', name: 'Bad', slug: '../evil', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z',
  }));
  fs.writeFileSync(path.join(personsDir, 'good.json'), JSON.stringify({
    id: 'plan-good', name: 'Good', slug: 'good', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z',
  }));
  const logs = [];
  const persons = store.readPersons(dataTier0Dir, (...args) => logs.push(args.join(' ')));
  assert.strictEqual(persons.length, 1);
  assert.strictEqual(persons[0].slug, 'good');
  assert.ok(logs.some((l) => l.includes('unexpected shape')));
});

test('[bug FUNC-blocker] readPersons: keeps a legacy shard whose slug is unusual but safe (no regression on pre-existing data)', () => {
  const dataTier0Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-readpersons-legacy-'));
  const personsDir = store.personsDir(dataTier0Dir);
  fs.mkdirSync(personsDir, { recursive: true });
  // Predates the strict [a-z0-9-] slugify convention - the old slugify
  // only collapsed hyphens/underscores/whitespace and let a parenthesised
  // contract-code suffix through unchanged.
  fs.writeFileSync(path.join(personsDir, 'sam-rivera-(bs).json'), JSON.stringify({
    id: 'plan-legacy', name: 'Sam Rivera (BS)', slug: 'sam-rivera-(bs)', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z',
  }));
  const persons = store.readPersons(dataTier0Dir, () => {});
  assert.strictEqual(persons.length, 1, 'an unusual-but-safe legacy slug must stay visible, not be dropped like a traversal payload');
  assert.strictEqual(persons[0].slug, 'sam-rivera-(bs)');
});

test('[bug FUNC-blocker] listPersonFileSlugs: reads raw file names off disk, independent of readPersons filtering', () => {
  const dataTier0Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-listslugs-'));
  const personsDir = store.personsDir(dataTier0Dir);
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(personsDir, 'good.json'), JSON.stringify({ id: 'plan-1', slug: 'good' }));
  fs.writeFileSync(path.join(personsDir, 'broken.json'), '{ not json');
  assert.deepStrictEqual(store.listPersonFileSlugs(dataTier0Dir).sort(), ['broken', 'good']);
  assert.deepStrictEqual(store.listPersonFileSlugs(path.join(dataTier0Dir, 'nope')), []);
});

test('uniqueSlug: appends -2, -3 on collision', () => {
  const taken = new Set(['taylor-kim']);
  assert.strictEqual(store.uniqueSlug('taylor-kim', taken), 'taylor-kim-2');
  taken.add('taylor-kim-2');
  assert.strictEqual(store.uniqueSlug('taylor-kim', taken), 'taylor-kim-3');
  assert.strictEqual(store.uniqueSlug('new-person', taken), 'new-person');
});

test('validateLink: title/url required, url scheme enforced', () => {
  assert.strictEqual(store.validateLink({ title: '', url: 'https://x' }, { partial: false }).ok, false);
  assert.strictEqual(store.validateLink({ title: 'X', url: '' }, { partial: false }).ok, false);
  assert.strictEqual(store.validateLink({ title: 'X', url: 'ftp://x' }, { partial: false }).ok, false);
  const viewOk = store.validateLink({ title: 'X', url: 'view://x' }, { partial: false });
  assert.strictEqual(viewOk.ok, true);
  assert.strictEqual(viewOk.value.url, 'view://x');
  const httpOk = store.validateLink({ title: 'X', url: 'https://x' }, { partial: false });
  assert.strictEqual(httpOk.ok, true);
});

test('sanitizeRows: strips unknown keys, coerces done to boolean, caps at 200', () => {
  const result = store.sanitizeRows([
    { topic: 'A', description: 'B', who: 'C', when: 'D', done: 1, extra: 'ignore-me' },
  ]);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.value, [{ topic: 'A', description: 'B', who: 'C', when: 'D', done: true }]);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.value[0], 'extra'), false);

  const tooMany = store.sanitizeRows(new Array(201).fill({ topic: 'x' }));
  assert.strictEqual(tooMany.ok, false);
});

test('sortPlans: template first, then created_at ascending, then name', () => {
  const template = { id: 'default', name: 'Template' };
  const persons = [
    { id: 'p2', name: 'Beta', created_at: '2026-02-01T00:00:00.000Z' },
    { id: 'p1', name: 'Alpha', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'p3', name: 'Alpha earlier', created_at: '2026-01-01T00:00:00.000Z' },
  ];
  const sorted = store.sortPlans(template, persons);
  assert.deepStrictEqual(sorted.map((p) => p.id), ['default', 'p1', 'p3', 'p2']);
});

test('copyTemplate: deep copy, rows independent from the template', () => {
  const template = { id: 'default', name: 'Template', rows: [{ topic: 'A' }] };
  const plan = store.copyTemplate(template, 'New Person', 'new-person', '2026-09-13T00:00:00.000Z');
  assert.strictEqual(plan.name, 'New Person');
  assert.strictEqual(plan.slug, 'new-person');
  assert.strictEqual(plan.rows.length, 1);
  plan.rows[0].topic = 'changed';
  assert.strictEqual(template.rows[0].topic, 'A', 'the template row must not be mutated through the copy');
});
