// tests/test_gates_scope.mjs
// One rule, held for every gate that exists now and every gate added later:
// nothing that decides whether THIS repository is green may reach modules/.
//
// An installed module is somebody else's code. It arrives from the shared
// catalog, it lives in a gitignored directory, and it is never part of a
// commit or a push of this repository. It happened twice over: a catalog
// module published with `status: "stable"` in its manifest while its own
// bundled test still asserted "beta" turned the pre-push `npm test` red for
// everybody who had installed it, and `npm run lint` carried the same
// exposure through a "modules/*/**" glob that its own documentation never
// claimed. Both are gates in the sense that matters - they refuse work - and
// neither failure was caused by, or fixable from, this repository.
//
// The module-facing equivalents deliberately stay inclusive and gate nothing:
// `npm test`, `npm run lint:modules`, `check-conventions.js --modules`.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { GATES } = require('../scripts/gates.js');

/** Any mention of the installed-modules directory, glob or plain path. */
const REACHES_MODULES = /(^|[\s"'([{=])modules\//;

// The npm scripts a gate is allowed to invoke, and the hook that invokes one.
const GATE_SCRIPTS = ['lint', 'test:core'];
const HOOK = '.husky/pre-push';

test('no core gate script reaches modules/', () => {
  for (const name of GATE_SCRIPTS) {
    const cmd = pkg.scripts[name];
    assert.ok(cmd, `package.json is missing the "${name}" script a gate depends on`);
    assert.ok(
      !REACHES_MODULES.test(cmd),
      `npm run ${name} must not reach modules/ - a foreign module would gate this repo:\n  ${cmd}`,
    );
  }
});

test('every gates.js gate runs one of the core-scoped scripts', () => {
  // Whatever is added to GATES later has to land in GATE_SCRIPTS above, which
  // means somebody has to decide, in this file, that it is core-scoped.
  const allowed = new Set([...GATE_SCRIPTS, 'test:api']);
  for (const [key, gate] of Object.entries(GATES)) {
    const script = gate.args[0] === 'run' ? gate.args[1] : gate.args[0];
    assert.ok(
      allowed.has(script),
      `gates.js gate "${key}" runs "npm ${gate.args.join(' ')}", which is not a known core-scoped `
      + `script. Add it to GATE_SCRIPTS here once you have confirmed it cannot reach modules/.`,
    );
  }
  // The bare `npm test` is core + modules by design; a gate must never be it.
  for (const [key, gate] of Object.entries(GATES)) {
    assert.notDeepStrictEqual(
      gate.args, ['test'],
      `gates.js gate "${key}" runs the full \`npm test\`, which includes installed modules`,
    );
  }
});

test('the pre-push hook runs the core suite, not the full one', () => {
  const hook = fs.readFileSync(path.join(ROOT, HOOK), 'utf8');
  assert.ok(/npm run test:core/.test(hook), `${HOOK} must run \`npm run test:core\``);
  assert.ok(
    !/^\s*npm test\s*$/m.test(hook),
    `${HOOK} must not run the full \`npm test\` - it includes installed modules`,
  );
});

test('the module-facing commands still exist and still cover modules/', () => {
  // The other half of the rule: scoping the gates must not leave a module
  // author with no way to lint or test their own code.
  assert.ok(REACHES_MODULES.test(pkg.scripts['lint:modules'] || ''), 'lint:modules must cover modules/');
  assert.ok(REACHES_MODULES.test(pkg.scripts['lint:modules:fix'] || ''), 'lint:modules:fix must cover modules/');
  assert.strictEqual(pkg.scripts.test, 'node scripts/test-unit-js.js',
    'the bare `npm test` stays core + modules - it is the module author\'s run');
});

test('lint:fix never rewrites a module author\'s files', () => {
  // Sharper than the read-only gate rule: `--fix` on a glob that reached
  // modules/ would silently edit code this repo does not own.
  assert.ok(!REACHES_MODULES.test(pkg.scripts['lint:fix']), 'lint:fix must not reach modules/');
});

test('the core gates never reach apps/', () => {
  // apps/ holds standalone workspaces (Mini Deck) with their own dependencies.
  // They are gated by test:apps / lint:apps / build:apps, never by the core run.
  const REACHES_APPS = /(^|[\s"'([{=])apps\//;
  for (const name of [...GATE_SCRIPTS, 'test', 'lint:fix', 'lint:modules']) {
    assert.ok(!REACHES_APPS.test(pkg.scripts[name] || ''), `npm run ${name} must not reach apps/`);
  }
  for (const name of ['lint:apps', 'test:apps', 'build:apps']) {
    assert.match(pkg.scripts[name] || '', /--prefix apps\/mini-deck/, `${name} must run inside apps/mini-deck`);
  }
  const runner = fs.readFileSync(path.join(ROOT, 'scripts/test-unit-js.js'), 'utf8');
  assert.ok(!/apps\//.test(runner), 'the unit-test runner must not scan apps/');
});
