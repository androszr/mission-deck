import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildResolver, normalizeTokens } = require('../server/identity.js');
const { aggregate } = require('../server/aggregate.js');

const M = (first_name, last_name, email) => ({ first_name, last_name, email });
const MEMBERS = [
  M('Alex', 'Morgan', 'morgan.alex@example.com'),
  M('Sam', 'Rivera', 'bs.s.rivera@example.com'),
  M('Harper', 'Quinn', 'quinn.harper@example.org'),
  M('Casey', 'Fairbanks', 'fairbanks.casey@example.com'),
  M('Taylor', 'Brönner', 'bronner.taylor@example.com'),
  M('Kai', 'Lindqvist', 'lindqvist.kai@example.com'),
  M('Jordan', 'Walsh', 'walsh.jordan@example.com'),
  M('Robin', 'Ashford', 'ashford.robin@example.com'),
  M('Robin', 'Pryce', 'pryce.robin@example.com'),
  M('Sam', 'Novak-Ellis', 'novak-ellis.sam@example.com'),
];
const who = (id, aliases) => buildResolver(MEMBERS, aliases)(id);

test('rule A: reversed order, email, quotes, prefixes and suffixes land on one person', () => {
  for (const id of ['alex-morgan', 'morgan-alex', 'morgan.alex', 'Morgan.Alex@example.com']) {
    assert.strictEqual(who(id).key, 'morgan.alex@example.com', id);
  }
  assert.strictEqual(who('„quinn.harper”').key, 'quinn.harper@example.org');
  assert.strictEqual(who('harper-quinn').display_name, 'Harper Quinn');
  assert.strictEqual(who('bs.s.rivera').key, 'bs.s.rivera@example.com');
  assert.strictEqual(who('sam-rivera').key, 'bs.s.rivera@example.com');
  assert.strictEqual(who('jordan-walsh-app-access').key, 'walsh.jordan@example.com');
  assert.strictEqual(who('sam-novak-ellis').key, 'novak-ellis.sam@example.com');
  assert.deepStrictEqual(normalizeTokens('fr-walshjo'), ['walshjo']);
});

test('rule B: login style prefix(last) + prefix(first)', () => {
  assert.strictEqual(who('fairbc').key, 'fairbanks.casey@example.com');
  assert.strictEqual(who('bronnt').key, 'bronner.taylor@example.com');
  assert.strictEqual(who('lindqk').key, 'lindqvist.kai@example.com');
  assert.strictEqual(who('fr-walshjo').key, 'walsh.jordan@example.com');
});

test('ambiguous or unknown ids stay unmatched under their own id', () => {
  assert.deepStrictEqual(who('robin'), { key: 'robin', display_name: null, matched: false });
  assert.strictEqual(who('nobody-here').matched, false);
});

test('alias file overrides everything', () => {
  const r = who('robin', { robin: 'ashford.robin@example.com' });
  assert.strictEqual(r.key, 'ashford.robin@example.com');
  assert.strictEqual(r.display_name, 'Robin Ashford');
});

const ev = (u, t, s, hash, name) => ({ t, e: 'View Viewed', u, s, p: { view: 'x', base_view: 'x', app_hash: hash }, ...(name ? { up: { full_name: name } } : {}) });

test('aggregate merges aliases: sessions deduped, active day by any alias, unmatched listed', () => {
  const events = [
    ev('alex-morgan', '2026-10-06 08:00:00', 1, 'aaa11111x'),
    ev('morgan.alex@example.com', '2026-10-06 09:00:00', 1, 'aaa11111x'), // same session id, same day
    ev('morgan-alex', '2026-10-07 09:00:00', 2, 'bbb22222x'),
    ev('robin', '2026-10-07 10:00:00', 3, 'bbb22222x', 'Rob'),
  ];
  const agg = aggregate(events, { today: '2026-10-09', members: MEMBERS, now: 'x' });
  const p = agg.periods['7'];
  assert.strictEqual(p.users.length, 2);
  assert.strictEqual(p.kpi.active_users, 2);
  const r = p.users.find((u) => u.matched);
  assert.strictEqual(r.user_id, 'morgan.alex@example.com');
  assert.strictEqual(r.display_name, 'Alex Morgan');
  assert.deepStrictEqual(r.aliases, ['alex-morgan', 'morgan-alex', 'morgan.alex@example.com']);
  assert.strictEqual(r.sessions, 2);
  assert.strictEqual(r.active_days, 2);
  assert.deepStrictEqual(agg.meta.unmatched_ids, ['robin']);
  assert.strictEqual(p.users.find((u) => !u.matched).display_name, 'Rob');
});

test('app_hash: newest build is the latest first-seen hash and must be a day old to flag anyone', () => {
  const base = [
    ev('a-one', '2026-10-01 08:00:00', 1, 'old00000aaaa'),
    ev('b-two', '2026-10-02 08:00:00', 2, 'old00000aaaa'),
    ev('a-one', '2026-10-05 08:00:00', 3, 'new11111bbbb'),
  ];
  let agg = aggregate(base.concat(ev('c-three', '2026-10-06 20:00:00', 4, 'new11111bbbb')), { today: '2026-10-09', now: 'x' });
  assert.strictEqual(agg.latest_app_hash, 'new11111bbbb');
  assert.strictEqual(agg.latest_app_hash_first_seen, '2026-10-05 08:00:00');
  const byId = (a) => Object.fromEntries(a.periods['30'].users.map((u) => [u.user_id, u]));
  assert.strictEqual(byId(agg)['b-two'].app_outdated, true);
  assert.strictEqual(byId(agg)['b-two'].app_hash_short, 'old00000');
  assert.strictEqual(byId(agg)['a-one'].app_outdated, false);
  // newest build seen for less than a day -> nobody is flagged
  agg = aggregate(base.slice(0, 2).concat(ev('a-one', '2026-10-08 08:00:00', 3, 'new11111bbbb'), ev('c', '2026-10-08 09:00:00', 4, 'new11111bbbb')), { today: '2026-10-09', now: 'x' });
  assert.strictEqual(byId(agg)['b-two'].app_outdated, false);
});
