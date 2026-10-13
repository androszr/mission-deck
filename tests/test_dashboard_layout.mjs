// tests/test_dashboard_layout.mjs
// Unit tests for the server's pure dashboard helpers (moduleWidgets,
// normalizeDashboardLayout). The js/dashboard-layout.mjs cases are appended by
// the frontend slice.

import { createRequire } from 'node:module';
import assert from 'node:assert';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { moduleWidgets, normalizeDashboardLayout, mergeDashboardLayoutItems } = require('../server.js');

const PLAIN = {
  id: 'plain', name: 'Plain', description: 'Opis', icon: 'module:icon.svg',
  views: [{ id: 'plain-main', label: 'M' }, { id: 'plain-other', label: 'O' }],
};
const DECLARED = {
  id: 'decl', name: 'Decl', views: [{ id: 'decl-main', label: 'M' }],
  widgets: [{
    id: 'kpi', label: 'KPI', client: 'client/widget.js',
    variants: [{ id: 's', label: 'Small', cols: 2, rows: 1 }, { id: 'm', label: 'Medium', cols: 3, rows: 1 }],
    defaultVariant: 'm',
  }],
};

test('moduleWidgets: a module without widgets gets the shortcut widget', () => {
  const r = moduleWidgets(PLAIN);
  assert.strictEqual(r.module, 'plain');
  assert.strictEqual(r.entryView, 'plain-main');
  assert.strictEqual(r.widgets.length, 1);
  const w = r.widgets[0];
  assert.strictEqual(w.id, 'shortcut');
  assert.strictEqual(w.builtin, true);
  assert.strictEqual(w.description, 'Opis');
  assert.deepStrictEqual(w.variants, [{ id: 's', label: 'Small', cols: 2, rows: 1 }]);
  assert.strictEqual(moduleWidgets({ ...PLAIN, widgets: [] }).widgets[0].id, 'shortcut');
});

test('moduleWidgets: declared widgets pass through with the export defaulted', () => {
  const w = moduleWidgets(DECLARED).widgets[0];
  assert.strictEqual(w.id, 'kpi');
  assert.strictEqual(w.builtin, false);
  assert.strictEqual(w.export, 'renderWidget');
  assert.strictEqual(w.defaultVariant, 'm');
});

const AVAILABLE = [moduleWidgets(PLAIN), moduleWidgets(DECLARED)];

test('normalizeDashboardLayout: drops unknown module and widget, maps unknown variant to default', () => {
  const r = normalizeDashboardLayout({ items: [
    { module: 'nope', widget: 'shortcut', variant: 's' },
    { module: 'decl', widget: 'nope', variant: 's' },
    { module: 'decl', widget: 'kpi', variant: 'zzz' },
  ] }, AVAILABLE);
  assert.deepStrictEqual(r, { version: 1, items: [{ module: 'decl', widget: 'kpi', variant: 'm' }] });
});

test('normalizeDashboardLayout: dedupes keeping the first and caps at 40', () => {
  const dup = normalizeDashboardLayout({ items: [
    { module: 'decl', widget: 'kpi', variant: 's' },
    { module: 'decl', widget: 'kpi', variant: 'm' },
  ] }, AVAILABLE);
  assert.deepStrictEqual(dup.items, [{ module: 'decl', widget: 'kpi', variant: 's' }]);
  const many = Array.from({ length: 60 }, (_, i) => `m${i}`).map((id) => moduleWidgets({ ...PLAIN, id }));
  const items = many.map((a) => ({ module: a.module, widget: 'shortcut', variant: 's' }));
  assert.strictEqual(normalizeDashboardLayout({ items }, many).items.length, 40);
});

test('normalizeDashboardLayout: survives null, a string and a non-array items', () => {
  const empty = { version: 1, items: [] };
  assert.deepStrictEqual(normalizeDashboardLayout(null, AVAILABLE), empty);
  assert.deepStrictEqual(normalizeDashboardLayout('x', AVAILABLE), empty);
  assert.deepStrictEqual(normalizeDashboardLayout({ items: 'x' }, AVAILABLE), empty);
  assert.deepStrictEqual(normalizeDashboardLayout({ items: [null, 3] }, undefined), empty);
});

// -- js/dashboard-layout.mjs (DOM-free list helpers of the config window) ------

const L = await import('../js/dashboard-layout.mjs');
const AV = [moduleWidgets(PLAIN), moduleWidgets(DECLARED)];

test('itemKey joins module and widget', () => {
  assert.strictEqual(L.itemKey({ module: 'decl', widget: 'kpi' }), 'decl/kpi');
});

test('setVariant changes a known variant and ignores an unknown one', () => {
  const items = [{ module: 'decl', widget: 'kpi', variant: 'm' }];
  assert.strictEqual(L.setVariant(items, AV, 'decl', 'kpi', 's')[0].variant, 's');
  assert.strictEqual(L.setVariant(items, AV, 'decl', 'kpi', 'xxl')[0].variant, 'm');
  assert.strictEqual(items[0].variant, 'm', 'input is not mutated');
});

test('mergeDashboardLayoutItems: an item of a module that is not loaded survives a save at its old position', () => {
  const available = [{ module: 'a' }, { module: 'c' }];
  const stored = [
    { module: 'a', widget: 'x', variant: 's' },
    { module: 'b', widget: 'y', variant: 'm' },
    { module: 'c', widget: 'z', variant: 'l' },
  ];
  const submitted = [{ module: 'a', widget: 'x', variant: 'm' }, { module: 'c', widget: 'z', variant: 'l' }];
  const out = mergeDashboardLayoutItems(submitted, stored, available);
  assert.deepStrictEqual(out.map(i => i.module + '/' + i.widget + ':' + i.variant), ['a/x:m', 'b/y:m', 'c/z:l']);
});

test('mergeDashboardLayoutItems: an item of a LOADED module the person removed stays removed', () => {
  const out = mergeDashboardLayoutItems([], [{ module: 'a', widget: 'x', variant: 's' }], [{ module: 'a' }]);
  assert.deepStrictEqual(out, []);
});

test('mergeDashboardLayoutItems: garbage in the stored file and duplicates are ignored', () => {
  const out = mergeDashboardLayoutItems(
    [{ module: 'b', widget: 'y', variant: 's' }],
    [null, { module: 'b', widget: 'y', variant: 'm' }, { module: 7 }, { module: 'd', widget: 'w', variant: 's' }],
    [],
  );
  assert.deepStrictEqual(out.map(i => i.module + '/' + i.widget + ':' + i.variant), ['b/y:s', 'd/w:s']);
});

test('moveTo: drag semantics (item ends at the target index), out of range and no-op change nothing', () => {
  const l = [{ module: 'a', widget: 'x' }, { module: 'b', widget: 'x' }, { module: 'c', widget: 'x' }];
  assert.deepStrictEqual(L.moveTo(l, 2, 0).map((i) => i.module), ['c', 'a', 'b']);
  assert.deepStrictEqual(L.moveTo(l, 0, 2).map((i) => i.module), ['b', 'c', 'a']);
  assert.deepStrictEqual(L.moveTo(l, 1, 1), l);
  assert.deepStrictEqual(L.moveTo(l, 0, 5), l);
  assert.deepStrictEqual(L.moveTo(l, -1, 0), l);
  assert.notStrictEqual(L.moveTo(l, 1, 1), l);
});

test('removeItem and addItem: pure, add uses the default variant and refuses duplicates and unknowns', () => {
  const available = [{ module: 'decl', name: 'Decl', widgets: [{ id: 'kpi', label: 'KPI', defaultVariant: 'm', variants: [{ id: 'm' }] }] }];
  const l = [{ module: 'decl', widget: 'kpi', variant: 's' }];
  assert.deepStrictEqual(L.removeItem(l, 'decl', 'kpi'), []);
  assert.strictEqual(l.length, 1);
  assert.deepStrictEqual(L.removeItem(l, 'decl', 'nope'), l);
  assert.deepStrictEqual(L.addItem([], available, 'decl', 'kpi'), [{ module: 'decl', widget: 'kpi', variant: 'm' }]);
  assert.strictEqual(L.addItem(l, available, 'decl', 'kpi').length, 1);
  assert.strictEqual(L.addItem([], available, 'decl', 'zzz').length, 0);
});

test('addableGroups: only widgets not on the dashboard, grouped by module, filtered by query', () => {
  const available = [
    { module: 'a', name: 'Alfa', description: 'opis alfa', widgets: [{ id: 'one', label: 'Pierwszy', builtin: true }, { id: 'two', label: 'Drugi', description: 'sprint' }] },
    { module: 'b', name: 'Beta', widgets: [{ id: 'one', label: 'Trzeci' }] },
  ];
  const used = [{ module: 'a', widget: 'one' }];
  const g = L.addableGroups(used, available, '');
  assert.deepStrictEqual(g.map((x) => [x.module, x.widgets.map((w) => w.widget)]), [['a', ['two']], ['b', ['one']]]);
  assert.deepStrictEqual(L.addableGroups(used, available, 'SPRINT').map((x) => x.module), ['a']);
  assert.deepStrictEqual(L.addableGroups(used, available, 'beta').map((x) => x.module), ['b']);
  assert.deepStrictEqual(L.addableGroups([...used, { module: 'a', widget: 'two' }, { module: 'b', widget: 'one' }], available, ''), []);
});

test('addableGroups: modules with real data widgets come before the automatic shortcuts', () => {
  const available = [
    { module: 'short', name: 'Shortcut A', widgets: [{ id: 'shortcut', label: 'Shortcut', builtin: true }] },
    { module: 'real', name: 'Prawdziwy', widgets: [{ id: 'kpi', label: 'KPI' }] },
    { module: 'short2', name: 'Shortcut B', widgets: [{ id: 'shortcut', label: 'Shortcut', builtin: true }] },
  ];
  assert.deepStrictEqual(L.addableGroups([], available, '').map((g) => g.module), ['real', 'short', 'short2']);
});
