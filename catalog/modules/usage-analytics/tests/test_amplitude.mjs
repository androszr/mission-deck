import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeEvent, planDays, FLOOR_DAY, fetchDay } = require('../server/amplitude.js');

test('normalizeEvent keeps only starter-stamped whitelisted events and a closed property set', () => {
  const base = { event_type: 'View Viewed', event_time: '2026-10-06 08:00:00.5', user_id: 'x', session_id: 12, user_properties: { full_name: ' X Y ', email: 'a@b' } };
  assert.strictEqual(normalizeEvent({ ...base, event_properties: { view: 'a' } }), null);
  assert.strictEqual(normalizeEvent({ ...base, event_properties: { cockpit: 'other-app' } }), null);
  assert.strictEqual(normalizeEvent({ ...base, event_type: 'Api Request Completed', event_properties: { cockpit: 'starter' } }), null);
  const rec = normalizeEvent({ ...base, event_properties: { cockpit: 'starter', view: 'a', secret: 'nope', email: 'a@b' } }, '2026-10-06');
  assert.deepStrictEqual(rec, { t: '2026-10-06 10:00:00', e: 'View Viewed', u: 'x', s: 12, p: { view: 'a' }, up: { full_name: 'X Y' } });
  assert.strictEqual(normalizeEvent({ ...base, event_properties: { cockpit: 'starter' } }, '2026-10-05'), null);
  assert.strictEqual(normalizeEvent({ ...base, session_id: -1, event_properties: { cockpit: 'starter' } }).s, null);
});

test('planDays: today and yesterday always, cached days skipped, floor and 180 day clamp honoured', () => {
  const today = '2026-10-09';
  const days = planDays(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'], today, '2026-10-05');
  assert.deepStrictEqual(days, ['2026-10-05', '2026-10-08', '2026-10-09']);
  assert.ok(!planDays(['2026-10-06'], today, '2026-10-05').includes('2026-10-06'));
  const first = planDays([], today, '2020-01-01');
  assert.strictEqual(first[0], '2026-04-12'); // today - 180
  assert.strictEqual(planDays([], today)[0], FLOOR_DAY);
});

test('fetchDay maps 404 to no events and other failures to an error with status', async () => {
  const auth = { key: 'k', secret: 's' };
  assert.deepStrictEqual(await fetchDay('2026-10-06', auth, async () => ({ status: 404, ok: false }), () => []), []);
  await assert.rejects(fetchDay('2026-10-06', auth, async () => ({ status: 401, ok: false }), () => []), (e) => e.status === 401);
});
