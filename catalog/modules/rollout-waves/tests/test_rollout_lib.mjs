// rollout-waves/tests/test_rollout_lib.mjs
// Pure client helpers - no browser document. Mirrors the shape of
// test_rollout_core.mjs for the domain layer: filters, wave detail, the
// mobile card and the ASCII-key -> label maps.

import test from 'node:test';
import assert from 'node:assert';
import {
  matchesFilters, buildHaystack, buildWaveDetail, buildManagersPerWave, storeCardHtml,
  computeKpi, fmtPct, fmtDate, statusBadgeClass, STATUS_LABELS, WAVE_STATUS_LABELS,
} from '../client/rollout-lib.js';

function store(overrides) {
  return {
    code: 'AA001', district: 'District A', area: 'MR1', region: 'Region 1',
    manager: 'Alex Morgan', partner: 'Partner A', operator: '', city: 'Springfield',
    wave: 1, wave_start: '2026-10-13', training_start: '2026-09-23', training_end: '2026-10-02',
    webinar_date: '2026-09-29', training_done: false, webinar_done: false,
    rollout_status: 'planned',
    ...overrides,
  };
}

// ── matchesFilters ──────────────────────────────────────────────────────────

test('matchesFilters: AND semantics across wave + district + case-insensitive city substring', () => {
  const s = store({ wave: 2, district: 'District B', city: 'Montreal' });
  assert.strictEqual(matchesFilters(s, { activeWave: '2', district: 'District B', search: 'ntre' }), true);
  // one filter mismatching among several passing ones must fail the whole thing
  assert.strictEqual(matchesFilters(s, { activeWave: '2', district: 'District C', search: 'ntre' }), false);
  assert.strictEqual(matchesFilters(s, { activeWave: '3' }), false);
});

test('matchesFilters: "all" wave and empty filters match everything', () => {
  const s = store();
  assert.strictEqual(matchesFilters(s, { activeWave: 'all' }), true);
  assert.strictEqual(matchesFilters(s, {}), true);
});

test('matchesFilters: search matches code, city or operator, case-insensitive; manager/partner stay exact', () => {
  const s = store({ code: 'AA146', city: 'Shelbyville', operator: 'Acme Ltd', manager: 'Sam Rivera', partner: 'Partner X' });
  assert.strictEqual(matchesFilters(s, { search: 'AA146' }), true);
  assert.strictEqual(matchesFilters(s, { search: 'shelby' }), true);
  assert.strictEqual(matchesFilters(s, { search: 'acme' }), true);
  assert.strictEqual(matchesFilters(s, { search: 'ogdenville' }), false);
  assert.strictEqual(matchesFilters(s, { manager: 'Sam Rivera' }), true);
  assert.strictEqual(matchesFilters(s, { manager: 'Alex Morgan' }), false);
  assert.strictEqual(matchesFilters(s, { partner: 'Partner Y' }), false);
});

test('matchesFilters: search is diacritic-insensitive in both directions', () => {
  const withAccent = store({ city: 'Montr\u00e9al' });
  const withoutAccent = store({ city: 'Montreal' });
  // A query typed WITHOUT the accent must still match a value that HAS it.
  assert.strictEqual(matchesFilters(withAccent, { search: 'montreal' }), true);
  // A query typed WITH a diacritic must still match a plain-ASCII value.
  assert.strictEqual(matchesFilters(withoutAccent, { search: 'Montr\u00e9al' }), true);
  // l-with-stroke does not decompose under NFD and needs its own fold.
  const lodz = store({ city: '\u0141\u00f3d\u017a' });
  assert.strictEqual(matchesFilters(lodz, { search: 'lodz' }), true);
});

test('matchesFilters: whitespace splits the query into tokens and every token must match', () => {
  const s = store({ city: 'Montreal', operator: 'Morgan' });
  assert.strictEqual(matchesFilters(s, { search: 'montreal morgan' }), true);
  // one matching token among two is not enough
  assert.strictEqual(matchesFilters(s, { search: 'montreal ogdenville' }), false);
});

test('matchesFilters: an empty or all-whitespace search matches everything', () => {
  const s = store();
  assert.strictEqual(matchesFilters(s, { search: '' }), true);
  assert.strictEqual(matchesFilters(s, { search: '   ' }), true);
});

test('matchesFilters: uses a precomputed __haystack when present, falls back to buildHaystack otherwise', () => {
  const s = store({ city: 'Montreal', manager: 'Alex Morgan' });
  assert.strictEqual(matchesFilters(s, { search: 'montreal' }), true);
  const stale = store({ city: 'Montreal', manager: 'Alex Morgan' });
  stale.__haystack = 'this precomputed value wins over the live fields';
  assert.strictEqual(matchesFilters(stale, { search: 'montreal' }), false);
  assert.strictEqual(matchesFilters(stale, { search: 'precomputed' }), true);
});

// ── buildHaystack ────────────────────────────────────────────────────────────

test('buildHaystack: folds all six searchable fields, diacritics and case included', () => {
  const s = store({
    code: 'AA146', city: 'Montreal', operator: 'ACME', manager: 'Alex Morgan', partner: 'Partner A', district: 'Lodz',
  });
  const hay = buildHaystack(s);
  assert.ok(hay.includes('aa146'));
  assert.ok(hay.includes('montreal'));
  assert.ok(hay.includes('acme'));
  assert.ok(hay.includes('alex morgan'));
  assert.ok(hay.includes('partner a'));
  assert.ok(hay.includes('lodz'));
});

test('buildHaystack: a store with null fields yields no thrown error and no "null" text', () => {
  const s = store({
    code: null, city: null, operator: null, manager: null, partner: null, district: null,
  });
  const hay = buildHaystack(s);
  assert.strictEqual(typeof hay, 'string');
  assert.ok(!hay.includes('null'));
  assert.ok(!hay.includes('undefined'));
});

// ── computeKpi ───────────────────────────────────────────────────────────────

test('computeKpi: counts by ASCII rollout_status key, not a label', () => {
  const stores = [
    store({ rollout_status: 'live', training_done: true, webinar_done: true }),
    store({ rollout_status: 'in-progress', training_done: true, webinar_done: false }),
    store({ rollout_status: 'planned' }),
  ];
  const kpi = computeKpi(stores);
  assert.strictEqual(kpi.locations_count, 3);
  assert.strictEqual(kpi.live, 1);
  assert.strictEqual(kpi.to_go_live, 2);
  assert.strictEqual(kpi.trainings_done, 2);
  assert.strictEqual(kpi.webinar_done, 1);
  assert.ok(Math.abs(kpi.progress_pct - (100 / 3)) < 0.001);
});

test('computeKpi: empty list has zero percent, not NaN', () => {
  const kpi = computeKpi([]);
  assert.strictEqual(kpi.locations_count, 0);
  assert.strictEqual(kpi.progress_pct, 0);
});

// ── buildWaveDetail ──────────────────────────────────────────────────────────

test('buildWaveDetail: unique, "en"-sorted lists, restricted to the given wave', () => {
  const stores = [
    store({ wave: 1, manager: 'Sam Rivera', partner: 'P1', district: 'District B', code: 'AA002' }),
    store({ wave: 1, manager: 'Jordan Lee', partner: 'P1', district: 'District A', code: 'AA001' }),
    store({ wave: 2, manager: 'Alex Morgan', partner: 'P2', district: 'District C', code: 'AA003' }),
  ];
  const detail = buildWaveDetail(stores, 1);
  assert.deepStrictEqual(detail.managers, ['Jordan Lee', 'Sam Rivera']);
  assert.deepStrictEqual(detail.partners, ['P1']);
  assert.deepStrictEqual(detail.districts, ['District A', 'District B']);
  assert.deepStrictEqual(detail.locations, ['AA001', 'AA002']);
});

test('buildWaveDetail: null/placeholder values are dropped, not turned into "null" strings', () => {
  const stores = [
    store({ wave: 5, manager: null, partner: '-', district: '', code: 'AA009' }),
  ];
  const detail = buildWaveDetail(stores, 5);
  assert.deepStrictEqual(detail.managers, []);
  assert.deepStrictEqual(detail.partners, []);
  assert.deepStrictEqual(detail.districts, []);
  assert.deepStrictEqual(detail.locations, ['AA009']);
});

test('buildWaveDetail: a different wave number yields nothing', () => {
  const stores = [store({ wave: 1 })];
  const detail = buildWaveDetail(stores, 9);
  assert.deepStrictEqual(detail.managers, []);
  assert.deepStrictEqual(detail.locations, []);
});

// ── buildManagersPerWave ─────────────────────────────────────────────────────

test('buildManagersPerWave: groups managers by wave with the union of their districts', () => {
  const stores = [
    store({ wave: 1, manager: 'Sam Rivera', district: 'District A' }),
    store({ wave: 1, manager: 'Sam Rivera', district: 'District B' }),
    store({ wave: 2, manager: 'Alex Morgan', district: 'District C' }),
  ];
  const groups = buildManagersPerWave(stores, [{ wave: 1 }, { wave: 2 }]);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].wave, 1);
  assert.strictEqual(groups[0].rows.length, 1);
  assert.strictEqual(groups[0].rows[0].manager, 'Sam Rivera');
  assert.strictEqual(groups[0].rows[0].districts, 'District A, District B');
  assert.strictEqual(groups[1].rows[0].manager, 'Alex Morgan');
});

// ── storeCardHtml ────────────────────────────────────────────────────────────

test('storeCardHtml: escapes a hostile manager name instead of injecting markup', () => {
  const s = store({ manager: '<script>alert(1)</script>' });
  const html = storeCardHtml(s);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('storeCardHtml: an empty field is omitted, not printed blank', () => {
  const s = store({ operator: '', partner: '' });
  const html = storeCardHtml(s);
  assert.ok(!html.includes('Operator'));
  assert.ok(!html.includes('>Partner<'));
  assert.ok(html.includes('Manager'));
});

test('storeCardHtml: renders the status label from the ASCII key, plus both done badges', () => {
  const s = store({ rollout_status: 'live', training_done: true, webinar_done: false });
  const html = storeCardHtml(s);
  assert.ok(html.includes('Live'));
  assert.ok(html.includes('Yes'));
  assert.ok(html.includes('>No<'));
});

// ── labels, formatting, badges ───────────────────────────────────────────────

test('STATUS_LABELS: all three ASCII keys carry a label', () => {
  assert.strictEqual(Object.keys(STATUS_LABELS).length, 3);
  assert.strictEqual(STATUS_LABELS.live, 'Live');
  assert.strictEqual(STATUS_LABELS['in-progress'], 'In progress');
  assert.strictEqual(STATUS_LABELS.planned, 'Planned');
});

test('WAVE_STATUS_LABELS: all three ASCII keys carry a label', () => {
  assert.strictEqual(Object.keys(WAVE_STATUS_LABELS).length, 3);
  assert.strictEqual(WAVE_STATUS_LABELS.done, 'Done');
  assert.strictEqual(WAVE_STATUS_LABELS.current, 'Current');
  assert.strictEqual(WAVE_STATUS_LABELS.planned, 'Planned');
});

test('statusBadgeClass: maps every known key and falls back to gray', () => {
  assert.strictEqual(statusBadgeClass('live'), 'ds-badge--green');
  assert.strictEqual(statusBadgeClass('in-progress'), 'ds-badge--yellow');
  assert.strictEqual(statusBadgeClass('planned'), 'ds-badge--gray');
  assert.strictEqual(statusBadgeClass('done'), 'ds-badge--green');
  assert.strictEqual(statusBadgeClass('current'), 'ds-badge--yellow');
  assert.strictEqual(statusBadgeClass('nope'), 'ds-badge--gray');
});

test('fmtPct: one decimal place, dash for an unusable value', () => {
  assert.strictEqual(fmtPct(12.34), '12.3%');
  assert.strictEqual(fmtPct(null), '—');
  assert.strictEqual(fmtPct(undefined), '—');
  assert.strictEqual(fmtPct(NaN), '—');
});

test('fmtDate: ISO to day.month.year, dash for an unusable value', () => {
  assert.strictEqual(fmtDate('2026-10-13'), '13.10.2026');
  assert.strictEqual(fmtDate(null), '—');
  assert.strictEqual(fmtDate('short'), '—');
});
