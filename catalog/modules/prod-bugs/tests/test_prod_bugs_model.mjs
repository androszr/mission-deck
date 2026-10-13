import test from 'node:test';
import assert from 'node:assert';
import {
  AREA_CONFIG, sortSprints, selectSprint, collectBugs, collectResolvedAllSprints,
  applyFilters, statusCategory, bugTone, fmtDays, fmtDate,
} from '../client/prod-bugs-model.mjs';

const mk = (n, extra = {}) => ({
  sprint: n,
  areas: {
    orders: { openBugs: [{ key: 'APP-' + n, summary: 'Basket does not work', status: 'New', priority: 'High' }],
      resolvedBugs: [{ key: 'APP-R' + n, summary: 'Old', status: 'Closed', resolved: '2026-07-28', fixDays: 2 }] },
    platform: { openBugs: ['WEB-' + n], resolvedBugs: [] },
  },
  ...extra,
});

test('sortSprints sorts ascending without mutating', () => {
  const src = [mk(10), mk(2), mk(3)];
  assert.deepStrictEqual(sortSprints(src).map((s) => s.sprint), [2, 3, 10]);
  assert.strictEqual(src[0].sprint, 10);
});

test('selectSprint: latest, existing, missing, empty', () => {
  const l = [mk(3), mk(1), mk(2)];
  assert.strictEqual(selectSprint(l, 'latest').sprint, 3);
  assert.strictEqual(selectSprint(l, '2').sprint, 2);
  assert.strictEqual(selectSprint(l, 99).sprint, 3);
  assert.strictEqual(selectSprint([], 'latest'), null);
});

test('collectBugs tolerates string entries and tags area/sprint', () => {
  const bugs = collectBugs(mk(5), 'open');
  assert.strictEqual(bugs.length, 2);
  assert.deepStrictEqual(bugs[1], { key: 'WEB-5', area: 'platform', areaLabel: AREA_CONFIG[2].label, bucket: 'open', sprint: 5 });
  assert.strictEqual(bugs[0].areaLabel, 'Orders');
});

test('collectResolvedAllSprints de-duplicates by key_sprint', () => {
  const a = mk(1);
  a.areas.orders.resolvedBugs.push({ key: 'APP-R1' });
  const all = collectResolvedAllSprints([a, mk(2)]);
  assert.deepStrictEqual(all.map((b) => b.key + '/' + b.sprint), ['APP-R1/1', 'APP-R2/2']);
});

test('applyFilters by area and case-insensitive search', () => {
  const bugs = collectBugs(mk(5), 'open');
  assert.strictEqual(applyFilters(bugs, 'orders', '').length, 1);
  assert.strictEqual(applyFilters(bugs, 'all', 'basket').length, 1);
  assert.strictEqual(applyFilters(bugs, 'all', 'web-').length, 1);
  assert.strictEqual(applyFilters(bugs, 'all', 'HIGH').length, 1);
  assert.strictEqual(applyFilters(bugs, 'all', 'new').length, 1);
  assert.strictEqual(applyFilters(bugs, 'all', 'zzz').length, 0);
});

test('statusCategory', () => {
  const c = (status) => statusCategory({ status });
  assert.strictEqual(c('Closed'), 'resolved');
  assert.strictEqual(c('Done'), 'resolved');
  assert.strictEqual(c('Blocked'), 'blocked');
  assert.strictEqual(c('Ready for test'), 'testing');
  assert.strictEqual(c('New'), 'new');
  assert.strictEqual(c('In Progress'), 'open');
});

test('bugTone thresholds', () => {
  assert.deepStrictEqual([0, 1, 3, 4].map(bugTone), ['success', 'warning', 'warning', 'danger']);
});

test('formatters', () => {
  assert.strictEqual(fmtDays(1.5), '1.5 days');
  assert.strictEqual(fmtDays(null), '—');
  assert.strictEqual(fmtDate('2026-07-28'), '28.07.2026');
  assert.strictEqual(fmtDate(''), '—');
});
