// tests/test_unit_discovery.mjs
// discoverTests() in scripts/test-unit-js.js decides what `npm test` runs.
// It must pick up an installed module's own tests/test_*.mjs, skip a module
// without them, and still work on a fresh clone that has no modules/ at all.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { discoverTests } = require('../scripts/test-unit-js.js');

/** Build a throwaway repo root; `spec` maps a relative dir to its file names. */
function makeRoot(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-discover-'));
  for (const [dir, names] of Object.entries(spec)) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(root, dir, n), '// fixture\n');
  }
  return root;
}

test('core tests are discovered and sorted', () => {
  const root = makeRoot({ tests: ['test_b.mjs', 'test_a.mjs'] });
  assert.deepStrictEqual(discoverTests(root), [
    path.join('tests', 'test_a.mjs'),
    path.join('tests', 'test_b.mjs'),
  ]);
});

test('non-unit files in tests/ are ignored', () => {
  const root = makeRoot({ tests: ['test_a.mjs', 'test_api_x.js', '_api_helper.js', 'notes.md'] });
  assert.deepStrictEqual(discoverTests(root), [path.join('tests', 'test_a.mjs')]);
});

test('an installed module contributes its own tests, after the core ones', () => {
  const root = makeRoot({
    tests: ['test_core.mjs'],
    'modules/zamowienia/tests': ['test_zamowienia.mjs'],
  });
  assert.deepStrictEqual(discoverTests(root), [
    path.join('tests', 'test_core.mjs'),
    path.join('modules', 'zamowienia', 'tests', 'test_zamowienia.mjs'),
  ]);
});

test('modules are walked in a stable order', () => {
  const root = makeRoot({
    tests: [],
    'modules/b-mod/tests': ['test_b.mjs'],
    'modules/a-mod/tests': ['test_a.mjs'],
  });
  assert.deepStrictEqual(discoverTests(root), [
    path.join('modules', 'a-mod', 'tests', 'test_a.mjs'),
    path.join('modules', 'b-mod', 'tests', 'test_b.mjs'),
  ]);
});

test('a module with no tests/ directory is skipped, not an error', () => {
  const root = makeRoot({ tests: ['test_core.mjs'], 'modules/pusty/client': ['index.js'] });
  assert.deepStrictEqual(discoverTests(root), [path.join('tests', 'test_core.mjs')]);
});

test("a module's node_modules and dotfiles are never walked", () => {
  const root = makeRoot({
    tests: [],
    'modules/node_modules/tests': ['test_nope.mjs'],
    'modules/.cache/tests': ['test_nope.mjs'],
  });
  assert.deepStrictEqual(discoverTests(root), []);
});

test('a fresh clone with no modules/ still returns the core suite', () => {
  const root = makeRoot({ tests: ['test_core.mjs'] });
  assert.ok(!fs.existsSync(path.join(root, 'modules')));
  assert.deepStrictEqual(discoverTests(root), [path.join('tests', 'test_core.mjs')]);
});

test('an empty repo returns an empty list rather than throwing', () => {
  const root = makeRoot({});
  assert.deepStrictEqual(discoverTests(root), []);
});

// --core is what .husky/pre-push runs. modules/ is gitignored and is never
// part of a push of this repo, so a test inside somebody else's downloaded
// module must not be able to refuse that push. Regression guard for exactly
// that: a catalog module published with a manifest its own bundled test
// contradicted blocked every core push by everyone who had installed it.
test('includeModules:false returns the core suite alone - the push gate scope', () => {
  const root = makeRoot({
    tests: ['test_core.mjs', 'test_other.mjs'],
    'modules/foreign-mod/tests': ['test_foreign.mjs'],
  });
  const core = [path.join('tests', 'test_core.mjs'), path.join('tests', 'test_other.mjs')];
  assert.deepStrictEqual(discoverTests(root, { includeModules: false }), core);
  // The default is unchanged: `npm test` still runs the module's tests.
  assert.deepStrictEqual(discoverTests(root), [
    ...core,
    path.join('modules', 'foreign-mod', 'tests', 'test_foreign.mjs'),
  ]);
  // Only an explicit false narrows the scope - a missing or odd opts object
  // must never silently drop a module from `npm test`.
  for (const opts of [undefined, {}, { includeModules: true }]) {
    assert.strictEqual(discoverTests(root, opts).length, 3, JSON.stringify(opts));
  }
});

test('includeModules:false on a repo with no core tests is empty, not the modules', () => {
  const root = makeRoot({ tests: [], 'modules/foreign-mod/tests': ['test_foreign.mjs'] });
  assert.deepStrictEqual(discoverTests(root, { includeModules: false }), []);
});

// The bundled catalog (catalog/modules/<id>/) ships with the repository, so
// `npm test` runs its modules' tests too - after the core, before the
// installed modules - and --core still leaves them out.
test('catalog modules contribute their tests after the core and before installed ones', () => {
  const root = makeRoot({
    tests: ['test_core.mjs'],
    'catalog/modules/b-cat/tests': ['test_b.mjs'],
    'catalog/modules/a-cat/tests': ['test_a.mjs'],
    'modules/z-inst/tests': ['test_z.mjs'],
  });
  assert.deepStrictEqual(discoverTests(root), [
    path.join('tests', 'test_core.mjs'),
    path.join('catalog', 'modules', 'a-cat', 'tests', 'test_a.mjs'),
    path.join('catalog', 'modules', 'b-cat', 'tests', 'test_b.mjs'),
    path.join('modules', 'z-inst', 'tests', 'test_z.mjs'),
  ]);
  assert.deepStrictEqual(discoverTests(root, { includeModules: false }), [path.join('tests', 'test_core.mjs')]);
});

test('a module that is both in the catalog and installed runs once, from its installed copy', () => {
  const root = makeRoot({
    tests: [],
    'catalog/modules/shared/tests': ['test_shared.mjs'],
    'modules/shared/tests': ['test_shared.mjs'],
  });
  assert.deepStrictEqual(discoverTests(root), [path.join('modules', 'shared', 'tests', 'test_shared.mjs')]);
});

test('catalog dotfiles and node_modules are never walked', () => {
  const root = makeRoot({
    tests: [],
    'catalog/modules/node_modules/tests': ['test_nope.mjs'],
    'catalog/modules/.tmp/tests': ['test_nope.mjs'],
  });
  assert.deepStrictEqual(discoverTests(root), []);
});
