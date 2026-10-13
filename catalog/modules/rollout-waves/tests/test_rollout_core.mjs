// rollout-waves/tests/test_rollout_core.mjs
// Domain logic: wave dates, location status keys, waves-config
// normalisation, the location filter + diagnostics, dashboard aggregation
// and the merge-only done import. rollout-core.js is pure (zero fs, zero
// requires), so every case here works on plain objects.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = require(path.join(DIR, 'server', 'rollout-core.js'));

test('computeWaveDates: wave 1 off a first wave on 2026-10-13', () => {
  const d = core.computeWaveDates(1, '2026-10-13');
  assert.equal(d.start, '2026-10-13');
  assert.equal(d.location_training_start, '2026-09-23');
  assert.equal(d.location_training_end, '2026-10-02');
  assert.equal(d.webinar, '2026-09-29');
  assert.equal(d.staff_training_start, '2026-09-21');
  assert.equal(d.staff_training_end, '2026-09-22');
});

test('computeWaveDates: wave 9 is 8 weeks after the first', () => {
  assert.equal(core.computeWaveDates(9, '2026-10-13').start, '2026-12-08');
});

test('computeStoreStatus: ASCII keys at the three boundaries', () => {
  assert.equal(core.computeStoreStatus('2026-10-13', '2026-09-23', '2026-09-01'), 'planned');
  assert.equal(core.computeStoreStatus('2026-10-13', '2026-09-23', '2026-09-23'), 'in-progress');
  assert.equal(core.computeStoreStatus('2026-10-13', '2026-09-23', '2026-10-13'), 'live');
});

test('normalizeWaveConfig: full shape', () => {
  const r = core.normalizeWaveConfig({ first_wave_start: '2026-10-13', waves_count: 9, managers: { 'Alex Morgan': 1 } });
  assert.equal(r.firstWaveStart, '2026-10-13');
  assert.equal(r.wavesCount, 9);
  assert.equal(r.source, 'new');
  assert.deepEqual(r.managers, { 'Alex Morgan': 1 });
});

test('normalizeWaveConfig: flat shape defaults the first wave and the wave count', () => {
  const r = core.normalizeWaveConfig({ 'Alex Morgan': 2 });
  assert.equal(r.firstWaveStart, core.FIRST_WAVE_DEFAULT);
  assert.equal(r.wavesCount, core.WAVES_COUNT_DEFAULT);
  assert.equal(r.source, 'flat');
  assert.deepEqual(r.managers, { 'Alex Morgan': 2 });
});

test('normalizeWaveConfig: bad fields inside the full shape fall back individually, managers survives', () => {
  const r = core.normalizeWaveConfig({ first_wave_start: 'someday', waves_count: 99, managers: { 'Alex Morgan': 1 } });
  assert.equal(r.firstWaveStart, core.FIRST_WAVE_DEFAULT);
  assert.equal(r.wavesCount, core.WAVES_COUNT_DEFAULT);
  assert.equal(r.source, 'new');
  assert.deepEqual(r.managers, { 'Alex Morgan': 1 });
});

test('normalizeWaveConfig: null/unparsable falls back to full defaults', () => {
  const r = core.normalizeWaveConfig(null);
  assert.equal(r.firstWaveStart, core.FIRST_WAVE_DEFAULT);
  assert.equal(r.wavesCount, core.WAVES_COUNT_DEFAULT);
  assert.equal(r.source, 'default');
  assert.deepEqual(r.managers, {});
});

function row(overrides) {
  return {
    code: 'AA001',
    status: 'Open',
    manager: 'Alex Morgan',
    operator: '',
    city: 'Springfield',
    ...overrides,
  };
}

test('buildStores: status + operator gate, manager-config join, diagnostics', () => {
  const waveConfig = { firstWaveStart: '2026-10-13', wavesCount: 12, managers: { 'Alex Morgan': 1, 'Nobody Assigned': 3 } };
  const rows = [
    row({ code: 'AA001' }), // open, manager in config -> included
    row({ code: 'AA002', status: 'Contract signed', operator: '' }), // conditional, no operator -> excluded
    row({ code: 'AA003', status: 'Contract signed', operator: 'Acme Ltd' }), // conditional + operator -> included
    row({ code: 'AA004', status: 'TEMPORARILY CLOSED', operator: 'Globex' }), // conditional (any case) + operator -> included
    row({ code: 'AA005', status: 'Contract terminated' }), // status not in the allowed set -> excluded
    row({ code: 'AA006', manager: 'Manager Outside Config' }), // open, manager not a config key -> out of config
    row({ code: 'AA007', manager: '', area: '1.3' }), // blank cell, config names `Vacant 1.3` -> included as that
    row({ code: 'AA008', manager: '  ', area: '9.9' }), // blank cell, no such key -> IN the totals with wave null, listed under the key
    row({ code: 'AA009', manager: '', area: '' }), // blank cell, no area -> out of config, unnamed
  ];
  waveConfig.managers['Vacant 1.3'] = 2;
  const { stores, diagnostics } = core.buildStores(rows, waveConfig, {}, {}, '2026-01-01');

  assert.equal(stores.length, 5);
  const a8 = stores.find((s) => s.code === 'AA008');
  assert.deepEqual([a8.manager, a8.wave, a8.wave_start, a8.rollout_status], ['Vacant 9.9', null, null, 'planned'], 'a vacancy without a wave still counts - it has to be rolled out');
  const a7 = stores.find((s) => s.code === 'AA007');
  assert.equal(a7.wave, 2);
  assert.equal(a7.manager, 'Vacant 1.3', 'a blank cell and the typed placeholder are interchangeable');
  assert.equal(core.managerKeyFor({ manager: 'Alex Morgan', area: '1.3' }), 'Alex Morgan');
  assert.equal(core.managerKeyFor({ manager: '', area: '10.5' }), 'Vacant 10.5');
  assert.equal(core.managerKeyFor({}), '');
  assert.deepEqual(stores.map((s) => s.code).sort(), ['AA001', 'AA003', 'AA004', 'AA007', 'AA008']);
  assert.equal(diagnostics.managers_out_of_config, 2);
  assert.deepEqual(diagnostics.managers_out_of_config_list, [{ manager: '(no manager)', stores: 1 }, { manager: 'Manager Outside Config', stores: 1 }]);
  assert.equal(diagnostics.vacant_no_wave, 1);
  assert.deepEqual(diagnostics.vacant_no_wave_list, [{ manager: 'Vacant 9.9', stores: 1 }]);
  const dash = core.buildDashboard(stores, diagnostics, waveConfig, '2026-01-01', null);
  assert.equal(dash.kpi.locations_count, 5);
  assert.equal(dash.kpi.no_wave, 1);
  assert.equal(dash.waves.reduce((n, t) => n + t.locations_count, 0), 4, 'the wave rows carry only assigned locations');
  assert.equal(diagnostics.managers_no_match, 1); // "Nobody Assigned" has no matching location
});

test('buildStores: a vacancy label already written by the locations module is still a vacancy', () => {
  const waveConfig = { firstWaveStart: '2026-10-13', wavesCount: 12, managers: {} };
  const { stores, diagnostics } = core.buildStores([row({ manager: 'Vacant 4' })], waveConfig, {}, {}, '2026-01-01');
  assert.equal(stores.length, 1);
  assert.equal(stores[0].wave, null);
  assert.equal(diagnostics.vacant_no_wave, 1);
});

test('buildStores: a wave number outside 1..wavesCount is skipped', () => {
  const waveConfig = { firstWaveStart: '2026-10-13', wavesCount: 2, managers: { 'Alex Morgan': 13 } };
  const { stores } = core.buildStores([row({})], waveConfig, {}, {}, '2026-01-01');
  assert.equal(stores.length, 0);
});

test('buildStores: the location record never carries contact details', () => {
  const waveConfig = { firstWaveStart: '2026-10-13', wavesCount: 2, managers: { 'Alex Morgan': 1 } };
  const { stores } = core.buildStores([row({ phone: '+48 600 000 001', email: 'aa001@example.com' })], waveConfig, {}, {}, '2026-01-01');
  assert.ok(!('phone' in stores[0]) && !('email' in stores[0]));
});

test('buildDashboard: progress_pct rounds to one decimal, waves.length === wavesCount, next_start', () => {
  const waveConfig = { firstWaveStart: '2026-01-01', wavesCount: 3, managers: {}, source: 'new' };
  const stores = [
    { wave: 1, rollout_status: 'live', training_done: true, webinar_done: false },
    { wave: 1, rollout_status: 'in-progress', training_done: false, webinar_done: false },
    { wave: 2, rollout_status: 'planned', training_done: false, webinar_done: false },
  ];
  const dashboard = core.buildDashboard(stores, { managers_out_of_config: 0, managers_no_match: 0, managers_out_of_config_list: [] }, waveConfig, '2026-01-01', { present: true });

  assert.equal(dashboard.waves.length, 3);
  assert.equal(dashboard.kpi.locations_count, 3);
  assert.equal(dashboard.kpi.live, 1);
  assert.equal(dashboard.kpi.progress_pct, 33.3);
  assert.equal(dashboard.next_start.wave, 1);
  assert.equal(dashboard.directory.present, true);
});

test('buildDashboard: next_start is null once every wave already started', () => {
  const waveConfig = { firstWaveStart: '2020-01-01', wavesCount: 1, managers: {}, source: 'new' };
  const dashboard = core.buildDashboard([], { managers_out_of_config: 0, managers_no_match: 0, managers_out_of_config_list: [] }, waveConfig, '2026-01-01', null);
  assert.equal(dashboard.next_start, null);
});

test('mergeDoneCodes: merge-only, unknown reported, touchedPrefixes only for imported codes', () => {
  const known = new Set(['AA001', 'AA002', 'AB812']);
  const first = core.mergeDoneCodes({}, ['aa001', 'UNKNOWN'], known, '2026-01-01T00:00:00.000Z', 'xlsx');
  assert.equal(first.imported, 1);
  assert.deepEqual(first.unknown, ['UNKNOWN']);
  assert.deepEqual([...first.touchedPrefixes], ['AA0']);

  const second = core.mergeDoneCodes(first.stores, ['AA002', 'AB812'], known, '2026-02-01T00:00:00.000Z', 'xlsx');
  assert.equal(second.imported, 2);
  assert.deepEqual(second.unknown, []);
  // Both earlier and freshly imported codes survive - a merge never drops
  // an entry another import already wrote.
  assert.deepEqual(Object.keys(second.stores).sort(), ['AA001', 'AA002', 'AB812']);
  assert.deepEqual([...second.touchedPrefixes].sort(), ['AA0', 'AB8']);
});
