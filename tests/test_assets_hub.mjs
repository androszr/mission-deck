// tests/test_assets_hub.mjs
// The four Design pages the CORE ships - the only core hub that has pages of
// its own. The hub is declared in js/core-hubs.mjs under the id 'assets' with
// the LABEL "Design". The hub itself (rail item, reserved id, no section of its
// own, position in the rail) is covered by tests/test_core_hubs.mjs; what is
// checked here is the part that hub does not share with the other seven - the
// view triple of each page (index.html section + VIEW_REGISTRY entry +
// HUB_FLYOUT item), or the flyout would offer a page that does not exist.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const HUB_ID = 'assets';

// Read the declaration and the built map rather than regex-ing the source:
// js/sidebar-flyout-config.js is now a loop over js/core-hubs.mjs, so there is
// no 'assets': { ... } literal left to match.
const coreHubsNs = await import(pathToFileURL(path.join(ROOT, 'js', 'core-hubs.mjs')).href);
const { coreHub } = coreHubsNs;
const { HUB_FLYOUT } = await import(
  pathToFileURL(path.join(ROOT, 'js', 'sidebar-flyout-config.js')).href
);

/** viewId -> the render/init pair js/view-registry.js calls. */
const VIEWS = {
  'assets-design-system': ['renderAssetsDesignSystemView', 'initAssetsDesignSystem'],
  'assets-icons': ['renderAssetsIconsView', 'initAssetsIcons'],
  'assets-illustrations': ['renderAssetsIllustrationsView', 'initAssetsIllustrations'],
  'assets-mascot': ['renderAssetsMascotView', 'initAssetsMascot'],
};

// ── The hub itself ───────────────────────────────────────────────────────────

test('the hub is declared in the core and labelled "Design"', () => {
  const hub = coreHub(HUB_ID);
  assert.ok(hub, 'js/core-hubs.mjs declares the hub');
  assert.strictEqual(hub.label, 'Design');
  assert.strictEqual(HUB_FLYOUT[HUB_ID].label, 'Design');
});

test('it is the ONE core hub that ships pages of its own', () => {
  const { CORE_HUBS } = coreHubsNs;
  const withPages = CORE_HUBS.filter((h) => (h.pages || []).length > 0).map((h) => h.id);
  assert.deepStrictEqual(withPages, [HUB_ID], 'the other seven hubs wait for module pages');
  assert.strictEqual(coreHub(HUB_ID).pages.length, 5);
});

// ── The four view triples ────────────────────────────────────────────────────

for (const [viewId, [renderFn, initFn]] of Object.entries(VIEWS)) {
  test(`${viewId}: the view triple is complete`, () => {
    assert.match(read('index.html'), new RegExp(`id="view-${viewId}"`));
    const registry = read('js/view-registry.js');
    assert.match(registry, new RegExp(`'${viewId}':\\s*\\{`));
    assert.match(registry, new RegExp(renderFn));
    assert.ok(HUB_FLYOUT[HUB_ID].items.some((it) => it.view === viewId),
      `${viewId} is a flyout item of the hub`);
  });

  test(`${viewId}: the module exports the pair the registry calls`, () => {
    const src = read(`js/${viewId}.js`);
    assert.match(src, new RegExp(`export (async )?function ${renderFn}\\b`));
    assert.match(src, new RegExp(`export function ${initFn}\\b`));
  });

  test(`${viewId}: the section carries the root the module paints into`, () => {
    assert.match(read('index.html'), new RegExp(`id="${viewId}-root"`));
  });
}

test('the core declares exactly these four view-triple pages plus prototypy under the hub', () => {
  // A module may APPEND to HUB_FLYOUT[HUB_ID].items at boot, so the closed
  // list is the declaration in js/core-hubs.mjs, not the live map. `prototypy`
  // (js/prototypy.js) is the fifth page - its own view triple is asserted in
  // tests/test_view_prototypy.mjs, not duplicated here.
  const listed = (coreHub(HUB_ID).pages || []).map((p) => p.view);
  assert.deepStrictEqual(listed.sort(), [...Object.keys(VIEWS), 'prototypy'].sort());
});

// ── The data the views read is committed, not generated ──────────────────────

test('the files the Design views fetch exist in the repo', () => {
  for (const f of [
    'css/ds-tokens.css',
    'assets/icons/ds/manifest.json',
    'assets/mascot/manifest.json',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
  }
});

test('every icon the icon manifest names is on disk, with its slug as file name', () => {
  const data = JSON.parse(read('assets/icons/ds/manifest.json'));
  assert.ok(Array.isArray(data.icons) && data.icons.length > 0, 'the icon manifest is empty');
  for (const icon of data.icons) {
    assert.strictEqual(icon.file, `${icon.slug}.svg`);
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/icons/ds', icon.file)), `${icon.slug} is missing`);
    assert.ok([16, 24, 32, 48].includes(icon.size), `${icon.slug} has size ${icon.size}`);
  }
});

test('every icon slug used by a core hub or a catalog module.json is in the set', () => {
  const have = new Set(JSON.parse(read('assets/icons/ds/manifest.json')).icons.map((i) => i.slug));
  const used = new Set();
  for (const h of coreHubsNs.CORE_HUBS) used.add(h.icon);
  const catDir = path.join(ROOT, 'catalog', 'modules');
  if (fs.existsSync(catDir)) {
    for (const id of fs.readdirSync(catDir)) {
      const mf = path.join(catDir, id, 'module.json');
      if (!fs.existsSync(mf)) continue;
      const text = fs.readFileSync(mf, 'utf8');
      for (const m of text.matchAll(/"icon"\s*:\s*"([^"]+)"/g)) used.add(m[1]);
    }
  }
  const missing = [...used].filter((slug) => !have.has(slug));
  assert.deepStrictEqual(missing, [], 'icon slugs without a file');
});

test('every mascot pose the manifest names is on disk', () => {
  const data = JSON.parse(read('assets/mascot/manifest.json'));
  assert.ok(data.poses.length >= 8);
  for (const p of data.poses) {
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/mascot', p.file)), `${p.file} is missing`);
  }
});

test('the token parser lists the custom properties of css/ds-tokens.css', async () => {
  const ds = await import(pathToFileURL(path.join(ROOT, 'js', 'assets-design-system.js')).href);
  const tokens = ds.parseTokenCss(read('css/ds-tokens.css'));
  const names = new Set(tokens.map((t) => t.name));
  assert.ok(tokens.length > 100, `only ${tokens.length} tokens parsed`);
  assert.ok(names.has('--ds-brand-35'));
  assert.ok(names.has('--font-main'));
  assert.strictEqual(ds.tokenGroup('--ds-brand-35'), 'palette');
  assert.strictEqual(ds.tokenGroup('--clickable-primary-default-bg'), 'semantic');
  assert.strictEqual(ds.tokenGroup('--space-16'), 'spacing');
  assert.deepStrictEqual(ds.parseTokenCss(':root { /* --gone: 1px; */ --kept: 2px; }'), [{ name: '--kept', value: '2px' }]);
});

test('no empty state tells the person to run an extraction pipeline', () => {
  for (const viewId of Object.keys(VIEWS)) {
    const src = read(`js/${viewId}.js`);
    assert.ok(!/figma_ds_extract|python3/.test(src), `js/${viewId}.js names a pipeline that is not here`);
  }
  assert.ok(!/figma_ds_extract|python3/.test(read('js/assets-svg-catalog.js')));
});
