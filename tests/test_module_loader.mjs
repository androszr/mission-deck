// tests/test_module_loader.mjs
// Unit tests for validateModuleManifest (pure function, no server).

import { createRequire } from 'node:module';
import assert from 'node:assert';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { validateModuleManifest, _safeFilenamePart } = require('../server.js');

const VALID_MANIFEST = {
  schemaVersion: 1,
  id: 'my-mod',
  name: 'My Module',
  version: '0.1.0',
  sidebar: { label: 'My Mod', kind: 'item' },
  views: [{ id: 'my-mod-main', label: 'Main' }],
};

test('valid manifest returns { valid: true }', () => {
  const result = validateModuleManifest(VALID_MANIFEST, 'my-mod');
  assert.strictEqual(result.valid, true);
  assert.ok(result.manifest, 'manifest must be returned');
});

test('missing id returns invalid', () => {
  const m = { ...VALID_MANIFEST, id: undefined };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test('bad id format ("123abc") returns invalid', () => {
  const m = { ...VALID_MANIFEST, id: '123abc' };
  const result = validateModuleManifest(m, '123abc');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('format')));
});

test('reserved id ("dashboard") returns invalid', () => {
  const m = { ...VALID_MANIFEST, id: 'dashboard' };
  const result = validateModuleManifest(m, 'dashboard');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('reserved')));
});

test('view id without module prefix ("main" instead of "my-mod-main") returns invalid', () => {
  const m = { ...VALID_MANIFEST, views: [{ id: 'main', label: 'Main' }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('view id')));
});

test('unknown schemaVersion (99) returns invalid', () => {
  const m = { ...VALID_MANIFEST, schemaVersion: 99 };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('schemaVersion')));
});

test('dataRepos field is passed through without errors', () => {
  const m = { ...VALID_MANIFEST, dataRepos: ['ds-data'] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, true);
});

test('dataRepos entry with a valid paths array is valid', () => {
  const m = { ...VALID_MANIFEST, dataRepos: [{ name: 'x', paths: ['a/', 'b/c.json'] }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, true);
});

test('dataRepos entry with a non-array paths returns invalid', () => {
  const m = { ...VALID_MANIFEST, dataRepos: [{ name: 'x', paths: 'a/' }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('dataRepos[0].paths')));
});

test('dataRepos entry with a ".." path segment returns invalid', () => {
  const m = { ...VALID_MANIFEST, dataRepos: [{ name: 'x', paths: ['../x'] }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('dataRepos[0].paths')));
});

test('dataRepos paths entry "prefix*" (star as last character) is valid', () => {
  const m = { ...VALID_MANIFEST, dataRepos: [{ name: 'x', paths: ['plik.json', 'katalog/', 'savings-*'] }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, true);
});

test('dataRepos paths entry with a star in the middle ("a*b") is invalid', () => {
  const m = { ...VALID_MANIFEST, dataRepos: [{ name: 'x', paths: ['a*b'] }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('dataRepos[0].paths')));
});

test('dataRepos paths entry that is just "*" is invalid', () => {
  const m = { ...VALID_MANIFEST, dataRepos: [{ name: 'x', paths: ['*'] }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('dataRepos[0].paths')));
});

// dataRepos[].access: 'read' is a VIEW on the sync row and needs explicit paths.
test('dataRepos entry with access "read" and paths is valid; "write" and no access too', () => {
  for (const access of ['read', 'write', undefined]) {
    const m = { ...VALID_MANIFEST, dataRepos: [{ name: 'data-tier-0', access, paths: ['team/'] }] };
    assert.strictEqual(validateModuleManifest(m, 'my-mod').valid, true, String(access));
  }
});

test('dataRepos entry with access "read" and no paths is invalid', () => {
  for (const entry of [{ name: 'x', access: 'read' }, { name: 'x', access: 'read', paths: [] }]) {
    const result = validateModuleManifest({ ...VALID_MANIFEST, dataRepos: [entry] }, 'my-mod');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('dataRepos[0].access "read" requires non-empty paths')));
  }
});

test('dataRepos entry with an unknown access value is invalid; a bare string stays valid', () => {
  const bad = validateModuleManifest({ ...VALID_MANIFEST, dataRepos: [{ name: 'x', access: 'nope', paths: ['a/'] }] }, 'my-mod');
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.errors.some(e => e.includes('dataRepos[0].access must be "write" or "read"')));
  assert.strictEqual(validateModuleManifest({ ...VALID_MANIFEST, dataRepos: ['data-tier-0'] }, 'my-mod').valid, true);
});

// envKeys reaches the module card (js/module-card.mjs), so its shape is
// validated rather than trusted - an envKeys entry takes the
// same two forms as a dataRepos entry so ONE renderer draws both rows.
test('envKeys accepts a bare uppercase name and an object with a name', () => {
  const m = { ...VALID_MANIFEST, envKeys: ['JIRA_TOKEN', { name: 'FIGMA_TOKEN', description: 'Token do Figmy' }] };
  assert.strictEqual(validateModuleManifest(m, 'my-mod').valid, true);
});

test('envKeys entry that is not an uppercase env name returns invalid', () => {
  const m = { ...VALID_MANIFEST, envKeys: ['jira_token'] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('envKeys[0]')));
});

test('envKeys entry with a non-string description returns invalid', () => {
  const m = { ...VALID_MANIFEST, envKeys: [{ name: 'JIRA_TOKEN', description: 7 }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('envKeys[0].description')));
});

test('envKeys that is not an array returns invalid', () => {
  const m = { ...VALID_MANIFEST, envKeys: 'JIRA_TOKEN' };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('envKeys must be an array')));
});

// `status` is the maturity the publish modal asks for and writes back into
// module.json; the card renders it, so the value set is closed.
test('status accepts stable, beta and deprecated', () => {
  for (const status of ['stable', 'beta', 'deprecated']) {
    assert.strictEqual(validateModuleManifest({ ...VALID_MANIFEST, status }, 'my-mod').valid, true, status);
  }
  assert.strictEqual(validateModuleManifest(VALID_MANIFEST, 'my-mod').valid, true, 'status is optional');
});

test('status outside the closed list returns invalid', () => {
  for (const status of ['alpha', '', 1, null]) {
    const result = validateModuleManifest({ ...VALID_MANIFEST, status }, 'my-mod');
    assert.strictEqual(result.valid, false, String(status));
    assert.ok(result.errors.some(e => e.includes('status')));
  }
});

test('sidebar.kind "hub" with two views is valid', () => {
  const m = {
    ...VALID_MANIFEST,
    sidebar: { label: 'My Mod', kind: 'hub' },
    views: [
      { id: 'my-mod-lista', label: 'Lista' },
      { id: 'my-mod-raport', label: 'Raport' },
    ],
  };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, true);
});

// ── sidebar.kind "page": the module puts its views in a CORE hub ───────────
// The normal shape since hubs moved into the core (js/core-hubs.mjs). The hub
// is validated by NAME and not merely as a slug, because the client's only
// answer to an unknown hub is to give the module no menu entry at all - the
// install is the last place that can say so out loud.

test('sidebar.kind "page" with a real core hub is valid', () => {
  const m = { ...VALID_MANIFEST, sidebar: { label: 'My Mod', kind: 'page', hub: 'support' } };
  assert.strictEqual(validateModuleManifest(m, 'my-mod').valid, true);
});

test('sidebar.kind "page" without a hub returns invalid', () => {
  const m = { ...VALID_MANIFEST, sidebar: { label: 'My Mod', kind: 'page' } };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('sidebar.hub is required')));
});

test('sidebar.kind "page" naming a hub that does not exist returns invalid', () => {
  const m = { ...VALID_MANIFEST, sidebar: { label: 'My Mod', kind: 'page', hub: 'no-such-id' } };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('is not a core hub')));
});

test('sidebar.hub on a kind that is not "page" returns invalid', () => {
  // Otherwise a manifest could claim a hub and still take a rail item, and the
  // two answers would disagree about where the module lives.
  const m = { ...VALID_MANIFEST, sidebar: { label: 'My Mod', kind: 'item', hub: 'support' } };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('only allowed when')));
});

test('an unknown sidebar.kind returns invalid and names the three shapes', () => {
  const m = { ...VALID_MANIFEST, sidebar: { label: 'My Mod', kind: 'flyout' } };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('"hub", "item" or "page"')));
});

test('a module id equal to a core hub id is reserved', () => {
  const m = { ...VALID_MANIFEST, id: 'support', views: [{ id: 'support-main', label: 'X' }] };
  const result = validateModuleManifest(m, 'support');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('reserved')));
});

test('hub view id without the module-id prefix returns invalid', () => {
  const m = {
    ...VALID_MANIFEST,
    sidebar: { label: 'My Mod', kind: 'hub' },
    views: [
      { id: 'my-mod-lista', label: 'Lista' },
      { id: 'raport', label: 'Raport' },
    ],
  };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('view id')));
});

const CR_CHAR = String.fromCharCode(13);
const LF_CHAR = String.fromCharCode(10);
// A version an honest author could plausibly type, outside Latin1.
const NON_LATIN1 = String.fromCharCode(0x4E2D, 0x6587);

// Regression: `version` reaches a Content-Disposition header on the export
// path, and the manifest contract only promises it is a non-empty string.
// res.writeHead throws ERR_INVALID_CHAR synchronously on a control character
// or on anything outside Latin1, which breaks export for an honest author with
// an accented version just as surely as for a crafted imported manifest.
test('_safeFilenamePart keeps ordinary versions intact', () => {
  assert.strictEqual(_safeFilenamePart('1.2.3', '0.0.0'), '1.2.3');
  assert.strictEqual(_safeFilenamePart('1.0.0-beta.2', '0.0.0'), '1.0.0-beta.2');
});

test('_safeFilenamePart strips CR, LF, quotes and non-Latin1', () => {
  const withCrlf = '1.0' + CR_CHAR + LF_CHAR + 'X-Injected: 1';
  const out = _safeFilenamePart(withCrlf, '0.0.0');
  assert.ok(!out.includes(CR_CHAR) && !out.includes(LF_CHAR), 'CR/LF must never survive');
  assert.ok(!_safeFilenamePart('1.0"q"', '0.0.0').includes('"'));
  assert.strictEqual(_safeFilenamePart(NON_LATIN1, '0.0.0'), '0.0.0');
});

test('_safeFilenamePart falls back when nothing usable is left', () => {
  assert.strictEqual(_safeFilenamePart('///', '0.0.0'), '0.0.0');
  assert.strictEqual(_safeFilenamePart('', '0.0.0'), '0.0.0');
  assert.strictEqual(_safeFilenamePart(null, '0.0.0'), '0.0.0');
  assert.strictEqual(_safeFilenamePart(undefined, '0.0.0'), '0.0.0');
});

test('_safeFilenamePart output is always a valid HTTP header value', () => {
  const http = require('http');
  const weird = ['1.0' + CR_CHAR + LF_CHAR + 'X: 1', '1.0"quoted"', '1.0 ', NON_LATIN1, '///'];
  for (const v of weird) {
    const safe = _safeFilenamePart(v, '0.0.0');
    assert.doesNotThrow(
      () => http.validateHeaderValue('Content-Disposition', 'attachment; filename="m-' + safe + '.zip"'),
      'header must stay valid for version ' + JSON.stringify(v),
    );
  }
});

// A view id becomes an element id, a hash route and a VIEW_REGISTRY key. The
// prefix rule alone let a non-slug id through, which then reached
// _createViewSection's `id="..."` attribute in js/module-host.js.
test('view id with markup characters returns invalid', () => {
  const m = { ...VALID_MANIFEST, views: [{ id: 'my-mod-"><img src=x onerror=alert(1)>', label: 'X' }] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('format invalid')));
});

test('view id with uppercase or underscore returns invalid', () => {
  for (const bad of ['my-mod-Main', 'my-mod-main_2', 'my-mod-']) {
    const result = validateModuleManifest({ ...VALID_MANIFEST, views: [{ id: bad, label: 'X' }] }, 'my-mod');
    assert.strictEqual(result.valid, false, bad + ' must be rejected');
  }
});

test('a plain slug view id with the module prefix stays valid', () => {
  const m = { ...VALID_MANIFEST, views: [{ id: 'my-mod-raport-2', label: 'Raport' }] };
  assert.strictEqual(validateModuleManifest(m, 'my-mod').valid, true);
});

// ── author / tags: the self-description fields the module cards render ────────
// They were added so every section on a Settings > Modules card has a home in
// module.json. Both are optional; both are type-checked, because a manifest
// that puts a number in `tags` would otherwise reach innerHTML as one.

test('author and tags are optional', () => {
  const result = validateModuleManifest(VALID_MANIFEST, 'my-mod');
  assert.strictEqual(result.valid, true);
});

test('a string author and a string[] tags are accepted', () => {
  const m = { ...VALID_MANIFEST, author: 'Mission Deck team', tags: ['dane', 'raporty'] };
  const result = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(result.valid, true);
});

test('a non-string author returns invalid', () => {
  const result = validateModuleManifest({ ...VALID_MANIFEST, author: 42 }, 'my-mod');
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('author')));
});

test('tags that are not an array of strings return invalid', () => {
  const notArray = validateModuleManifest({ ...VALID_MANIFEST, tags: 'dane' }, 'my-mod');
  assert.strictEqual(notArray.valid, false);
  assert.ok(notArray.errors.some(e => e.includes('tags')));

  const badItem = validateModuleManifest({ ...VALID_MANIFEST, tags: ['ok', 7] }, 'my-mod');
  assert.strictEqual(badItem.valid, false);
  assert.ok(badItem.errors.some(e => e.includes('tags')));
});

// ── area: business domain, temporary strict/soft compatibility boundary ─────
// See plan 2026-09-12-obszary-modulow.md. strict mode is for install/import
// (an artifact that can be given an area before it is ever mounted); soft
// mode is for the disk scan and the remote catalog read, where an existing
// artifact cannot be fixed in place.

test('strict mode rejects a manifest with no area', () => {
  const result = validateModuleManifest(VALID_MANIFEST, 'my-mod', { strict: true });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('area')));
});

test('soft mode accepts a manifest with no area, but carries a warning', () => {
  const result = validateModuleManifest(VALID_MANIFEST, 'my-mod');
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.warnings, ['area-missing']);
});

test('an invalid area value is always an error, strict or not', () => {
  const m = { ...VALID_MANIFEST, area: 'Cyber\tstore' };
  assert.strictEqual(validateModuleManifest(m, 'my-mod').valid, false);
  assert.strictEqual(validateModuleManifest(m, 'my-mod', { strict: true }).valid, false);
});

test('a valid area passes in both modes and carries no warning', () => {
  const m = { ...VALID_MANIFEST, area: 'Product' };
  const soft = validateModuleManifest(m, 'my-mod');
  assert.strictEqual(soft.valid, true);
  assert.strictEqual(soft.warnings, undefined);
  assert.strictEqual(validateModuleManifest(m, 'my-mod', { strict: true }).valid, true);
});

// -- widgets[] (dashboard tiles) --
const WIDGET = {
  id: 'licznik',
  label: 'Licznik',
  client: 'client/widget.js',
  variants: [{ id: 's', label: 'Small', cols: 2, rows: 1 }],
  defaultVariant: 's',
};
const withWidgets = (widgets) => validateModuleManifest({ ...VALID_MANIFEST, widgets }, 'my-mod');

test('widgets[]: a valid declaration passes and a manifest without widgets stays valid', () => {
  assert.strictEqual(withWidgets([WIDGET]).valid, true);
  assert.strictEqual(validateModuleManifest(VALID_MANIFEST, 'my-mod').valid, true);
});

test('widgets[]: cols 4 is refused', () => {
  const r = withWidgets([{ ...WIDGET, variants: [{ id: 's', label: 'S', cols: 4, rows: 1 }] }]);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('cols')));
});

test('widgets[]: an unknown defaultVariant is refused', () => {
  const r = withWidgets([{ ...WIDGET, defaultVariant: 'zzz' }]);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('defaultVariant')));
});

test('widgets[]: client paths outside client/ or with ".." are refused', () => {
  assert.strictEqual(withWidgets([{ ...WIDGET, client: 'client/../x.js' }]).valid, false);
  // Percent-encoded dot segments resolve to `..` in the browser's URL parser.
  for (const client of ['client/%2e%2e/x.js', 'client/.%2e/x.js', 'client/x.js?y', 'client/.hidden.js', 'client/a b.js']) {
    assert.strictEqual(withWidgets([{ ...WIDGET, client }]).valid, false, client);
  }
  assert.strictEqual(withWidgets([{ ...WIDGET, client: 'client/sub/widget.v2.js' }]).valid, true);
  assert.strictEqual(withWidgets([{ ...WIDGET, client: 'server/w.js' }]).valid, false);
});

test('widgets[]: a duplicate widget id is refused', () => {
  assert.strictEqual(withWidgets([WIDGET, WIDGET]).valid, false);
});

test('widgets[]: a non-array value is refused', () => {
  assert.strictEqual(withWidgets('x').valid, false);
});
