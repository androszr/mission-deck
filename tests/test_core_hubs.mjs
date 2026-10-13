// tests/test_core_hubs.mjs
// The eight core hubs (js/core-hubs.mjs) and every copy of that list.
//
// A hub is declared in ONE file, but three other places have to agree with it
// and none of them can import an ESM module: the static rail markup in
// index.html (bound synchronously by js/app.js, so it cannot be generated at
// boot), the CORE_HUB_IDS Set in server.js (CJS, and validateModuleManifest is
// sync) and RESERVED_MODULE_IDS in both server.js and scripts/new-module.js.
// This file is the gate that keeps them identical - the same arrangement the
// two copies of RESERVED_MODULE_IDS have always had.
//
// What a drift would actually cost: a hub in core-hubs.mjs with no rail item is
// a flyout nobody can open, a rail item with no HUB_FLYOUT key is bound as a
// plain page and navigates to a section that does not exist, and a hub id that
// is not reserved can be claimed by a module directory.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { CORE_HUBS, CORE_HUB_IDS, isCoreHub, coreHub, coreHubLabel } =
  await import(pathToFileURL(path.join(ROOT, 'js', 'core-hubs.mjs')).href);
// js/sidebar-flyout-config.js has no document dependency, so the built map can be
// asserted directly rather than regex-read out of the source.
const { HUB_FLYOUT } = await import(
  pathToFileURL(path.join(ROOT, 'js', 'sidebar-flyout-config.js')).href
);

const EXPECTED = ['team', 'activity', 'finance', 'initiatives', 'support', 'knowledge', 'assets', 'apps'];

// ── The declaration ─────────────────────────────────────────────────────────

test('the eight hubs are declared in rail order', () => {
  assert.deepStrictEqual(CORE_HUB_IDS, EXPECTED);
  assert.strictEqual(CORE_HUBS.length, 8);
});

test('every id is an ASCII slug and every label is English copy', () => {
  for (const hub of CORE_HUBS) {
    assert.match(hub.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, `id "${hub.id}"`);
    assert.ok(hub.label && typeof hub.label === 'string', `label of "${hub.id}"`);
  }
  // The rail is the most-read copy in the app.
  assert.strictEqual(coreHubLabel('team'), 'Team');
  assert.strictEqual(coreHubLabel('activity'), 'Activity');
});

test('every hub icon is a real file in the icon set', () => {
  for (const hub of CORE_HUBS) {
    const file = path.join(ROOT, 'assets/icons/ds', hub.icon + '.svg');
    assert.ok(fs.existsSync(file), `${hub.id} names a missing icon: ${hub.icon}`);
  }
});

test('isCoreHub and coreHub answer for a real hub and refuse anything else', () => {
  assert.strictEqual(isCoreHub('support'), true);
  assert.strictEqual(isCoreHub('no-such-id'), false);
  assert.strictEqual(isCoreHub(undefined), false);
  assert.strictEqual(isCoreHub(null), false);
  assert.strictEqual(coreHub('support').label, 'Support');
  assert.strictEqual(coreHub('no-such-id'), null);
});

// ── HUB_FLYOUT is built from it, not written twice ──────────────────────────

test('HUB_FLYOUT carries exactly these hubs, built from the declaration', () => {
  assert.deepStrictEqual(Object.keys(HUB_FLYOUT), EXPECTED);
  for (const hub of CORE_HUBS) {
    assert.strictEqual(HUB_FLYOUT[hub.id].label, hub.label);
    assert.strictEqual(HUB_FLYOUT[hub.id].icon, hub.icon);
  }
});

test('a hub with no core pages ships an EMPTY items array, never a missing one', () => {
  // js/app.js reads config.items on every flyout open and js/module-host.js
  // pushes into it; a hub without the array would throw on the first hover.
  for (const id of EXPECTED) {
    assert.ok(Array.isArray(HUB_FLYOUT[id].items), `${id} has an items array`);
  }
  assert.deepStrictEqual(HUB_FLYOUT.support.items, [], 'Support ships empty - modules fill it');
  assert.strictEqual(HUB_FLYOUT.assets.items.length, 5, 'Design ships the five core pages');
});

test('the items array is a copy - a module appending pages cannot edit the declaration', () => {
  HUB_FLYOUT.assets.items.push({ label: 'x', view: 'x' });
  assert.strictEqual(coreHub('assets').pages.length, 5, 'the declaration is untouched');
  HUB_FLYOUT.assets.items.pop();
});

// ── The copies that cannot import it ────────────────────────────────────────

test('index.html carries one static rail item per hub, in the same order', () => {
  const html = read('index.html');
  const order = [...html.matchAll(/class="sidebar-item sidebar-item--hub" data-view="([a-z0-9-]+)"/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual(order, EXPECTED, 'the rail markup and js/core-hubs.mjs disagree');
  for (const hub of CORE_HUBS) {
    assert.ok(html.includes('/assets/icons/ds/' + hub.icon + '.svg'), `${hub.id} icon in the markup`);
    assert.ok(html.includes('nav-label"> ' + hub.label + '</span>'), `${hub.id} label in the markup`);
    assert.ok(html.includes('href="#' + hub.id + '"'), `${hub.id} href in the markup`);
  }
});

test('no hub has a section of its own - js/app.js would treat it as a page', () => {
  const html = read('index.html');
  for (const id of EXPECTED) {
    assert.ok(!html.includes('id="view-' + id + '"'), `#view-${id} must not exist`);
  }
});

test('the hubs sit above the spacer, so the pinned group is "Start here" and Settings', () => {
  const html = read('index.html');
  const spacer = html.indexOf('sidebar-spacer');
  const start = html.indexOf('data-view="onboarding-wizard"');
  const settings = html.indexOf('sidebar-item--settings');
  for (const id of EXPECTED) {
    assert.ok(html.indexOf('data-view="' + id + '"') < spacer, `${id} is above the spacer`);
  }
  assert.ok(spacer < start && start < settings, 'the pinned group order is unchanged');
});

test('server.js CORE_HUB_IDS is the same list', () => {
  const line = /const CORE_HUB_IDS = new Set\(\[([^\]]*)\]\)/.exec(read('server.js'));
  assert.ok(line, 'server.js declares CORE_HUB_IDS');
  const ids = [...line[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, EXPECTED, 'server.js and js/core-hubs.mjs disagree');
});

test('every hub id is a reserved module id, in the server and in the scaffold', () => {
  for (const file of ['server.js', 'scripts/new-module.js']) {
    const src = read(file);
    const line = /const RESERVED_MODULE_IDS = new Set\(\[([\s\S]*?)\]\)/.exec(src);
    assert.ok(line, `${file} declares RESERVED_MODULE_IDS`);
    const spreadsHubs = /\.\.\.CORE_HUB_IDS/.test(line[1]);
    const listed = [...line[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    for (const id of EXPECTED) {
      assert.ok(spreadsHubs || listed.includes(id), `${file} does not reserve "${id}"`);
    }
  }
});

// ── scripts/new-view.js writes into the declaration, not into the loop ──────
// js/sidebar-flyout-config.js is a loop over js/core-hubs.mjs, so the scaffold
// has to edit the declaration. It used to insert into an `items: [` array in
// the config file - an anchor that no longer exists there.

const NV = createRequire(import.meta.url)('../scripts/new-view.js');

/**
 * Writes a candidate core-hubs source to a scratch file and imports it, so the
 * edit is checked as real ESM and not as text. A one-line hub row being rebuilt
 * into its multi-line form is exactly where that can break.
 * @param {string} source
 * @returns {Promise<object>}
 */
async function importSource(source) {
  // os.tmpdir(), not ROOT/data - that directory is the running server's live
  // cache. js/core-hubs.mjs imports nothing, so it resolves anywhere.
  const tmp = path.join(os.tmpdir(), 'test-core-hubs-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.mjs');
  try {
    fs.writeFileSync(tmp, source, 'utf8');
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

test('new-view reads the hub ids out of the declaration', () => {
  assert.deepStrictEqual(NV.coreHubIds(read('js/core-hubs.mjs')), EXPECTED);
});

test('new-view adds a page to a hub that has none, rewriting the one-line row', async () => {
  const edit = NV.editCoreHubs(read('js/core-hubs.mjs'), 'team-presence', 'Presence', 'team');
  assert.strictEqual(edit.file, 'js/core-hubs.mjs');
  const ns = await importSource(edit.next);
  assert.deepStrictEqual(ns.coreHub('team').pages, [{ label: 'Presence', view: 'team-presence' }]);
  assert.deepStrictEqual(ns.CORE_HUB_IDS, EXPECTED, 'every other row survives the rewrite');
});

test('new-view appends to a hub that already has pages', async () => {
  const edit = NV.editCoreHubs(read('js/core-hubs.mjs'), 'assets-nowe', 'Nowe', 'assets');
  const ns = await importSource(edit.next);
  const views = ns.coreHub('assets').pages.map((pg) => pg.view);
  assert.strictEqual(views.length, 6);
  assert.strictEqual(views[views.length - 1], 'assets-nowe', 'appended, not prepended');
  assert.ok(views.includes('assets-mascot'), 'the five core pages stay');
});

test('new-view is idempotent and names the real hubs when one is missing', () => {
  const src = read('js/core-hubs.mjs');
  assert.strictEqual(NV.editCoreHubs(src, 'assets-mascot', 'Mascot', 'assets'), null, 'an existing page is a no-op');
  assert.throws(() => NV.editCoreHubs(src, 'x-y', 'X', 'no-such-id'), /available: team/);
});

/** The source of one top-level function: from its `function <name>(` to the next top-level `function `. */
function fnBody(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, 'js/app.js defines ' + name);
  const next = src.indexOf('\nfunction ', at + 1);
  return next === -1 ? src.slice(at) : src.slice(at, next);
}

// ── The empty hub ───────────────────────────────────────────────────────────
// Seven of the eight hubs ship with no pages, so on a fresh install THIS is the
// flyout a person sees first. It used to be no flyout at all.

test('an empty hub still opens its flyout and says so', () => {
  const app = read('js/app.js');
  const fn = fnBody(app, '_openHubFlyout');
  assert.ok(!/rows\.length === 0\)\s*\{\s*_closeHubFlyout\(\);\s*return;/.test(fn),
    'the early return that closed the panel on an empty hub must stay gone');
  assert.match(fn, /sidebar-flyout-empty/, 'the empty state renders its own element');
  assert.match(fn, /Nothing here yet/, 'the empty state carries the sentence');
  assert.match(fn, /Settings &gt; Modules/, 'the ">" in the hint is escaped for innerHTML');
  assert.match(read('styles.css'), /\.sidebar-flyout-empty\s*\{/, 'styles.css styles the empty state');
});

test('a hub item gets no collapsed-rail tooltip - the flyout already names it', () => {
  const app = read('js/app.js');
  const fn = fnBody(app, 'bindSidebarItem');
  assert.match(fn, /if \(text && !config\)/, 'the tooltip binding is guarded on NOT being a hub');
});
