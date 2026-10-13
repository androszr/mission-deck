// tests/test_module_updates.mjs
// Pure helpers behind the module-update banner (js/module-updates.mjs). Real
// ESM import, no server, no document access - node --test picks this up as tests/test_*.mjs.

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyModuleUpdate,
  catalogRowState,
  installedVersionMap,
  publishVersionGate,
  publishBaseWarning,
  parseSnoozed,
  isSnoozed,
  withSnooze,
  pruneSnoozed,
  visibleModuleUpdates,
  pluralModules,
  bannerModel,
  batchUpdateOrder,
} from '../js/module-updates.mjs';

// ── classifyModuleUpdate ─────────────────────────────────────────────────────

test('classifyModuleUpdate: catalog ahead of installed -> update', () => {
  assert.strictEqual(classifyModuleUpdate('0.1.0', '0.2.0'), 'update');
});

test('classifyModuleUpdate: equal versions -> current', () => {
  assert.strictEqual(classifyModuleUpdate('0.2.0', '0.2.0'), 'current');
});

test('classifyModuleUpdate: installed ahead of catalog -> ahead', () => {
  assert.strictEqual(classifyModuleUpdate('0.3.0', '0.2.0'), 'ahead');
});

test('classifyModuleUpdate: unparsable version on either side -> unknown', () => {
  assert.strictEqual(classifyModuleUpdate('nie-semver', '0.2.0'), 'unknown');
  assert.strictEqual(classifyModuleUpdate('0.2.0', 'nie-semver'), 'unknown');
  assert.strictEqual(classifyModuleUpdate(null, '0.2.0'), 'unknown');
  assert.strictEqual(classifyModuleUpdate('0.2.0', undefined), 'unknown');
});

test('classifyModuleUpdate: a leading v is accepted on both sides', () => {
  assert.strictEqual(classifyModuleUpdate('v0.1.0', 'v0.2.0'), 'update');
});

// ── publishVersionGate ───────────────────────────────────────────────────────

test('publishVersionGate: module absent from the catalog passes unchecked', () => {
  assert.deepStrictEqual(publishVersionGate('0.1.0', null), { ok: true, checked: false });
  assert.deepStrictEqual(publishVersionGate('0.1.0', undefined), { ok: true, checked: false });
});

test('publishVersionGate: equal version is refused', () => {
  const gate = publishVersionGate('0.2.0', '0.2.0');
  assert.strictEqual(gate.ok, false);
  assert.strictEqual(gate.error, 'version-not-bumped');
  assert.strictEqual(gate.localVersion, '0.2.0');
  assert.strictEqual(gate.catalogVersion, '0.2.0');
  assert.ok(gate.message.includes('0.2.0'), 'message must name the catalog version');
});

test('publishVersionGate: a lower local version is refused, message names both', () => {
  const gate = publishVersionGate('0.1.0', '0.3.0');
  assert.strictEqual(gate.ok, false);
  assert.strictEqual(gate.error, 'version-not-bumped');
  assert.ok(gate.message.includes('0.1.0') && gate.message.includes('0.3.0'));
});

test('publishVersionGate: a higher local version passes and is marked checked', () => {
  assert.deepStrictEqual(publishVersionGate('0.3.0', '0.2.0'), { ok: true, checked: true });
});

test('publishVersionGate: an unparsable version on either side passes unchecked', () => {
  assert.deepStrictEqual(
    publishVersionGate('nie-semver', '0.2.0'),
    { ok: true, checked: false, unparsable: true },
  );
  assert.deepStrictEqual(
    publishVersionGate('0.2.0', 'nie-semver'),
    { ok: true, checked: false, unparsable: true },
  );
});

// ── publishBaseWarning ───────────────────────────────────────────────────────
// The gap publishVersionGate cannot see: a version bump alone does not prove
// the local tree still contains everyone else's work published in between.

test('publishBaseWarning: a strictly older base warns, message names both versions', () => {
  const w = publishBaseWarning('0.1.0', '0.3.0');
  assert.strictEqual(w.warn, true);
  assert.strictEqual(w.code, 'base-outdated');
  assert.strictEqual(w.baseVersion, '0.1.0');
  assert.strictEqual(w.catalogVersion, '0.3.0');
  assert.ok(w.message.includes('0.1.0') && w.message.includes('0.3.0'));
});

test('publishBaseWarning: an equal or newer base never warns', () => {
  assert.deepStrictEqual(publishBaseWarning('0.3.0', '0.3.0'), { warn: false });
  assert.deepStrictEqual(publishBaseWarning('0.4.0', '0.3.0'), { warn: false });
});

test('publishBaseWarning: undefined (no origin record, the shape the server actually passes) never warns', () => {
  assert.deepStrictEqual(publishBaseWarning(undefined, '0.3.0'), { warn: false });
});

test('publishBaseWarning: null or an unparsable version on either side never warns', () => {
  assert.deepStrictEqual(publishBaseWarning(null, '0.3.0'), { warn: false });
  assert.deepStrictEqual(publishBaseWarning('nie-semver', '0.3.0'), { warn: false });
  assert.deepStrictEqual(publishBaseWarning('0.1.0', 'nie-semver'), { warn: false });
  assert.deepStrictEqual(publishBaseWarning('0.1.0', undefined), { warn: false });
});

// ── parseSnoozed ─────────────────────────────────────────────────────────────

test('parseSnoozed: null, missing or garbage input never throws and yields {}', () => {
  assert.deepStrictEqual(parseSnoozed(null), {});
  assert.deepStrictEqual(parseSnoozed(undefined), {});
  assert.deepStrictEqual(parseSnoozed('{bad'), {});
});

test('parseSnoozed: a JSON array is not a plain object -> {}', () => {
  assert.deepStrictEqual(parseSnoozed('[]'), {});
});

test('parseSnoozed: a valid object round-trips', () => {
  assert.deepStrictEqual(parseSnoozed('{"time-off":"0.2.0"}'), { 'time-off': '0.2.0' });
});

// ── withSnooze ───────────────────────────────────────────────────────────────

test('withSnooze: returns a new object and does not mutate the input', () => {
  const before = { a: '1.0.0' };
  const after = withSnooze(before, 'b', '2.0.0');
  assert.deepStrictEqual(before, { a: '1.0.0' }, 'input must not be mutated');
  assert.deepStrictEqual(after, { a: '1.0.0', b: '2.0.0' });
  assert.notStrictEqual(after, before);
});

// ── pruneSnoozed ─────────────────────────────────────────────────────────────

test('pruneSnoozed: drops a module that moved on to a newer catalog version', () => {
  const snoozed = { 'time-off': '0.2.0' };
  const modules = [{ id: 'time-off', state: 'update', catalogVersion: '0.3.0' }];
  assert.deepStrictEqual(pruneSnoozed(snoozed, modules), {});
});

test('pruneSnoozed: drops a module that is no longer installed', () => {
  const snoozed = { 'time-off': '0.2.0', other: '1.0.0' };
  const modules = [{ id: 'other', state: 'update', catalogVersion: '1.0.0' }];
  assert.deepStrictEqual(pruneSnoozed(snoozed, modules), { other: '1.0.0' });
});

// ── visibleModuleUpdates ─────────────────────────────────────────────────────

test('visibleModuleUpdates: hides a snoozed row and every non-update state', () => {
  const modules = [
    { id: 'a', name: 'Alfa', state: 'update', catalogVersion: '0.2.0' },
    { id: 'b', name: 'Beta', state: 'update', catalogVersion: '0.3.0' },
    { id: 'c', name: 'Cyryl', state: 'current', catalogVersion: '1.0.0' },
    { id: 'd', name: 'Delta', state: 'ahead', catalogVersion: '0.1.0' },
    { id: 'e', name: 'Epsilon', state: 'unknown', catalogVersion: null },
  ];
  const snoozed = { a: '0.2.0' };
  const visible = visibleModuleUpdates(modules, snoozed);
  assert.deepStrictEqual(visible.map((m) => m.id), ['b']);
});

test('visibleModuleUpdates: a disabled module is hidden, one with no enabled field stays visible', () => {
  const modules = [
    { id: 'a', name: 'Alfa', state: 'update', catalogVersion: '0.2.0', enabled: false },
    { id: 'b', name: 'Beta', state: 'update', catalogVersion: '0.3.0' },
  ];
  const visible = visibleModuleUpdates(modules, {});
  assert.deepStrictEqual(visible.map((m) => m.id), ['b']);
});

test('visibleModuleUpdates: sorts by name', () => {
  const modules = [
    { id: 'z', name: 'Zorro', state: 'update', catalogVersion: '1.0.0' },
    { id: 'a', name: 'Alfa', state: 'update', catalogVersion: '1.0.0' },
  ];
  const visible = visibleModuleUpdates(modules, {});
  assert.deepStrictEqual(visible.map((m) => m.id), ['a', 'z']);
});

// ── pluralModules ────────────────────────────────────────────────────────────

test('pluralModules: English plural rule', () => {
  assert.strictEqual(pluralModules(1), '1 module');
  assert.strictEqual(pluralModules(2), '2 modules');
  assert.strictEqual(pluralModules(5), '5 modules');
  assert.strictEqual(pluralModules(12), '12 modules');
  assert.strictEqual(pluralModules(22), '22 modules');
});

// ── bannerModel ──────────────────────────────────────────────────────────────

test('bannerModel: no items -> empty, not expandable', () => {
  assert.deepStrictEqual(bannerModel(false, []), { items: [], summary: null, expandable: false });
});

test('bannerModel: one module only, no summary, not expandable', () => {
  const rows = [{ id: 'time-off', name: 'Time off', installedVersion: '0.1.0', catalogVersion: '0.2.0', dirty: false }];
  const model = bannerModel(false, rows);
  assert.strictEqual(model.items.length, 1);
  assert.strictEqual(model.items[0].kind, 'module');
  assert.strictEqual(model.summary, null);
  assert.strictEqual(model.expandable, false);
});

test('bannerModel: app update alone, no summary, not expandable', () => {
  const model = bannerModel(true, []);
  assert.deepStrictEqual(model.items, [{ kind: 'app' }]);
  assert.strictEqual(model.summary, null);
  assert.strictEqual(model.expandable, false);
});

test('bannerModel: app plus two modules -> exact summary text, expandable', () => {
  const rows = [
    { id: 'a', name: 'Alfa', installedVersion: '0.1.0', catalogVersion: '0.2.0', dirty: false },
    { id: 'b', name: 'Beta', installedVersion: '1.0.0', catalogVersion: '1.1.0', dirty: true },
  ];
  const model = bannerModel(true, rows);
  assert.strictEqual(model.items.length, 3);
  assert.strictEqual(model.items[0].kind, 'app');
  assert.strictEqual(model.summary, 'Updates available: the app and 2 modules');
  assert.strictEqual(model.expandable, true);
});

test('bannerModel: two modules and no app -> summary omits the app clause', () => {
  const rows = [
    { id: 'a', name: 'Alfa', installedVersion: '0.1.0', catalogVersion: '0.2.0', dirty: false },
    { id: 'b', name: 'Beta', installedVersion: '1.0.0', catalogVersion: '1.1.0', dirty: false },
  ];
  const model = bannerModel(false, rows);
  assert.strictEqual(model.summary, 'Updates available: 2 modules');
});

// ── batchUpdateOrder ─────────────────────────────────────────────────────────

test('batchUpdateOrder: app + two modules (one dirty) -> both module ids in order, no skipped key', () => {
  const items = [
    { kind: 'app' },
    { kind: 'module', id: 'a', name: 'Alfa', dirty: false },
    { kind: 'module', id: 'b', name: 'Beta', dirty: true },
  ];
  const res = batchUpdateOrder(items);
  assert.deepStrictEqual(res.toUpdate.map((i) => i.id), ['a', 'b']);
  assert.strictEqual('skipped' in res, false);
});

test('batchUpdateOrder: no module items -> empty toUpdate', () => {
  assert.deepStrictEqual(batchUpdateOrder([{ kind: 'app' }]), { toUpdate: [] });
  assert.deepStrictEqual(batchUpdateOrder([]), { toUpdate: [] });
});

// ── catalogRowState / installedVersionMap (the Katalog table) ────────────────
// 2026-09-13: six modules bumped and published after the last restart read
// "Aktualizuj" in the Katalog while the banner said `current`, because the
// table compared against /api/modules/manifest (the boot snapshot) with a
// comparator of its own. The state is now derived from classifyModuleUpdate
// over the disk scan; these pin both halves.

test('catalogRowState: not installed -> dostepny, whatever the catalog says', () => {
  assert.strictEqual(catalogRowState(undefined, '0.1.2'), 'dostepny');
  assert.strictEqual(catalogRowState(null, '0.1.2'), 'dostepny');
  assert.strictEqual(catalogRowState('', '0.1.2'), 'dostepny');
});

test('catalogRowState: agrees with classifyModuleUpdate on every branch', () => {
  assert.strictEqual(catalogRowState('0.1.1', '0.1.2'), 'dostepna-aktualizacja');
  // The real case: disk already at the catalog version -> installed, not an update.
  assert.strictEqual(catalogRowState('0.1.2', '0.1.2'), 'zainstalowany');
  // Local newer than the catalog -> never propose a downgrade.
  assert.strictEqual(catalogRowState('0.2.0', '0.1.2'), 'zainstalowany');
  // Unparsable on either side -> installed, never a guessed update.
  assert.strictEqual(catalogRowState('0.1.2', 'nie-semver'), 'zainstalowany');
  assert.strictEqual(catalogRowState('nie-semver', '0.1.2'), 'zainstalowany');
  assert.strictEqual(catalogRowState('0.1.2', undefined), 'zainstalowany');
});

test('installedVersionMap: reads installed[].manifest.version off the disk-scan payload, skips rows without one', () => {
  const map = installedVersionMap({
    installed: [
      { id: 'time-off', manifest: { version: '0.1.2' } },
      { id: 'bez-wersji', manifest: {} },
      { id: 'liczba', manifest: { version: 1 } },
      { manifest: { version: '0.1.0' } },
      null,
    ],
    invalid: [],
  });
  assert.deepStrictEqual(map, { 'time-off': '0.1.2' });
  assert.deepStrictEqual(installedVersionMap(null), {});
  assert.deepStrictEqual(installedVersionMap({}), {});
  assert.deepStrictEqual(installedVersionMap({ installed: 'x' }), {});
});

test('Katalog reads installed versions from the disk scan, never the boot-time manifest snapshot', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'js', 'settings-moduly-katalog.js'), 'utf8');
  const fetches = src.split('\n').filter((l) => !/^\s*\/\//.test(l) && /\/api\/modules\/manifest/.test(l));
  assert.deepStrictEqual(fetches, [], '/api/modules/manifest is what is LOADED, not what is on disk - a version comparison belongs to /api/modules/installed');
  assert.match(src, /\/api\/modules\/installed/);
  // And no second semver comparator next to the shared one.
  assert.ok(!/compareSemver/.test(src), 'the Katalog must decide its row state through catalogRowState, not its own compareSemver');
});

test('Katalog repaints both module tables after a successful install, restart callout included', () => {
  // 2026-10-05: install inserted the restart callout by hand and never
  // repainted, so an installed row kept its "Zainstaluj" button.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'js', 'settings-moduly-katalog.js'), 'utf8');
  const click = src.slice(src.indexOf('async function _handleInnerClick'));
  assert.match(click, /_restartPending = true;/, 'a successful install must mark the restart as pending');
  assert.match(click, /renderModulySection\(\{ onRestart: _lastOnRestart \}\)/, 'a successful install must repaint the whole Modules section');
  assert.ok(!/insertBefore\(/.test(click), 'the restart callout is painted by _paintHeader, not inserted once by hand');
  const renderInto = src.slice(src.indexOf('async function _renderInto'), src.indexOf('async function _wireHeader'));
  assert.ok(!/slot\.innerHTML = _renderHeader\(\)/.test(renderInto), 'every header paint goes through _paintHeader so the callout survives');
  assert.match(src, /_restartPending \? _renderRestartCallout\(\) : ''/);
});
