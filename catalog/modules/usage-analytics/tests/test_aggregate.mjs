// Pure aggregation over a hand-written fixture of raw Amplitude export records.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const { normalizeEvent } = require('../server/amplitude.js');
const { aggregate, VIEW_DURATION_CAP_MS, median } = require('../server/aggregate.js');
const { resolveModule, mergeModuleDicts } = require('../server/modules-map.js');

const RAW = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures', 'events-sample.json'), 'utf8'));
const DICT = {
  'sprint-stats': { name: 'Sprint Stats', views: [{ id: 'sprint-stats-main', label: 'Sprint Stats' }] },
  'team-directory': { name: 'Team directory', views: [] },
};
const NORMALIZED = RAW.map((r) => normalizeEvent(r)).filter(Boolean);
const AGG = aggregate(NORMALIZED, { today: '2026-10-09', modulesDict: DICT, now: '2026-10-09T10:00:00.000Z' });
const P7 = AGG.periods['7'];
const user = (id) => P7.users.find((u) => u.user_id === id);

test('events without the cockpit stamp never reach any count', () => {
  assert.ok(NORMALIZED.length < RAW.length);
  assert.ok(!P7.users.some((u) => u.user_id === 'zed'));
  assert.ok(!P7.modules.some((m) => m.views.some((v) => v.id === 'dashboard-other')));
  assert.strictEqual(P7.kpi.active_users, 2);
});

test('resolveModule: exact view id, longest prefix, else core', () => {
  assert.strictEqual(resolveModule('sprint-stats-main', DICT), 'sprint-stats');
  assert.strictEqual(resolveModule('team-directory-list', DICT), 'team-directory');
  assert.strictEqual(resolveModule('settings', DICT), 'core');
  const d = { sprint: { name: 'Sprint', views: [] }, 'sprint-stats': { name: 'S', views: [] } };
  assert.strictEqual(resolveModule('sprint-stats-main', d), 'sprint-stats');
  assert.deepStrictEqual(Object.keys(mergeModuleDicts({ old: { name: 'Old', views: [] } }, [{ id: 'new', name: 'New', views: [] }])).sort(), ['new', 'old']);
});

test('a 25 hour View Exited counts as the 30 minute cap; median of 1 min, 2 min, 25 h is 2 min', () => {
  assert.strictEqual(VIEW_DURATION_CAP_MS, 30 * 60 * 1000);
  assert.strictEqual(AGG.meta.rules.view_duration_cap_ms, 1800000);
  assert.strictEqual(user('alex-morgan').median_view_ms, 120000);
  const core = P7.modules.find((m) => m.id === 'core');
  assert.strictEqual(core.time_capped_ms, 1800000);
  assert.strictEqual(median([1, 5, 3]), 3);
});

test('two page views on one CET day are one active day; 22:30 UTC lands on the next CET day', () => {
  const a = user('alex-morgan');
  assert.strictEqual(a.active_days, 2); // 10-06 (3 views) and 10-08 (22:30 UTC view + the sessionless one)
  const day = (d) => P7.daily.find((x) => x.date === d);
  assert.strictEqual(day('2026-10-06').page_views, 3);
  assert.strictEqual(day('2026-10-07').page_views, 1); // only B
  assert.strictEqual(day('2026-10-08').page_views, 2);
  assert.strictEqual(day('2026-10-08').active_users, 1);
});

test('sessions are distinct session ids; session -1 adds none', () => {
  assert.strictEqual(user('alex-morgan').sessions, 2);
  assert.strictEqual(user('alex-morgan').page_views, 5);
});

test('trend compares with the equal window before from; null when empty', () => {
  assert.strictEqual(P7.from, '2026-10-02');
  assert.strictEqual(P7.kpi.delta.active_users_pct, 100); // 2 now vs 1 (B, 30.09)
  assert.strictEqual(P7.kpi.delta.page_views_pct, 500); // 6 vs 1
  assert.strictEqual(AGG.periods['90'].kpi.delta.page_views_pct, null);
});

test('events with no user are dropped and counted', () => {
  assert.strictEqual(AGG.meta.dropped_anonymous, 1);
  assert.strictEqual(AGG.meta.events_kept, NORMALIZED.length - 1);
});

test('app_version_outdated is true for the user whose last version is below the newest seen', () => {
  assert.strictEqual(AGG.latest_app_version, '1.6.0');
  assert.strictEqual(user('sam-rivera').app_version_outdated, true);
  assert.strictEqual(user('alex-morgan').app_version_outdated, false);
  assert.deepStrictEqual(user('sam-rivera').errors, [{ view: 'team-directory-list', message: 'boom', count: 2 }]);
  assert.strictEqual(user('sam-rivera').display_name, 'Sam Rivera');
});
