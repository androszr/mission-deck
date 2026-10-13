// tests/test_gitlab_activity_helpers.mjs
// Pure-helper unit tests for the "Aktywnosc GitLab" (project access tokens)
// feature. Requiring server.js from a non-main module exports the helpers and
// never starts the HTTP server - see tests/test_server_helpers.mjs.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

test('_activityGroupPeople groups two tokens of the same person and keeps the later last_used_at', () => {
  const rawTokens = [
    { id: 1, name: 'jordan-lee-COCKPIT-APP', created_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01', last_used_at: '2026-09-05T10:00:00.000Z', revoked: false, active: true, scopes: ['api'], access_level: 30 },
    { id: 2, name: 'jordan-lee-COCKPIT-DATA', created_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01', last_used_at: '2026-09-05T11:30:00.000Z', revoked: false, active: true, scopes: ['read_repository'], access_level: 40 },
  ];
  const people = srv._activityGroupPeople(rawTokens, NOW);
  assert.strictEqual(people.length, 1, 'both tokens must fold into a single person');
  const [person] = people;
  assert.strictEqual(person.person_slug, 'jordan-lee');
  assert.strictEqual(person.token_count, 2);
  assert.strictEqual(person.last_activity, '2026-09-05T11:30:00.000Z', 'must pick the LATER of the two last_used_at values');
});

test('_activityGroupPeople sets expiring_soon within 30 days and not for a farther date', () => {
  const soon = new Date(NOW + 10 * DAY_MS).toISOString();
  const far = new Date(NOW + 90 * DAY_MS).toISOString();
  const people = srv._activityGroupPeople([
    { id: 1, name: 'anna-nowak-COCKPIT-APP', expires_at: soon, last_used_at: null, revoked: false, active: true, scopes: [], access_level: 30 },
    { id: 2, name: 'piotr-zajac-COCKPIT-APP', expires_at: far, last_used_at: null, revoked: false, active: true, scopes: [], access_level: 30 },
  ], NOW);
  const anna = people.find((p) => p.person_slug === 'anna-nowak');
  const piotr = people.find((p) => p.person_slug === 'piotr-zajac');
  assert.strictEqual(anna.expiring_soon, true, 'a token expiring in 10 days must be flagged');
  assert.strictEqual(piotr.expiring_soon, false, 'a token expiring in 90 days must NOT be flagged');
});

test('_activityActiveWithin cuts a person active 61 minutes ago and keeps one active 5 minutes ago', () => {
  const people = [
    { person_slug: 'too-old', display_name: 'Too Old', last_activity: new Date(NOW - 61 * 60 * 1000).toISOString() },
    { person_slug: 'recent', display_name: 'Recent', last_activity: new Date(NOW - 5 * 60 * 1000).toISOString() },
  ];
  const active = srv._activityActiveWithin(people, HOUR_MS, NOW);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].person_slug, 'recent');
});

test('_activityActiveWithin deduplicates the same person seen from two repositories', () => {
  const olderRow = { person_slug: 'jordan-lee', display_name: 'Jordan Lee', last_activity: new Date(NOW - 40 * 60 * 1000).toISOString() };
  const newerRow = { person_slug: 'jordan-lee', display_name: 'Jordan Lee', last_activity: new Date(NOW - 5 * 60 * 1000).toISOString() };
  const active = srv._activityActiveWithin([olderRow, newerRow], HOUR_MS, NOW);
  assert.strictEqual(active.length, 1, 'the same person from two repos must fold into one row');
  assert.strictEqual(active[0].last_used_at, newerRow.last_activity, 'must keep the MORE RECENT of the two occurrences');
});
