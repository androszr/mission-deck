// tests/test_new_module.mjs
// scripts/new-module.js scaffolds a plug & play module. Two things must hold:
// what it writes is a manifest the host accepts, and the id rules it enforces
// stay identical to the ones server.js applies at load time.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const NM = require('../scripts/new-module.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEW_MODULE_SCRIPT = path.join(ROOT, 'scripts', 'new-module.js');

let GIT_AVAILABLE = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { GIT_AVAILABLE = false; }

function scaffold(flags, positionals) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-'));
  const out = NM.run({ area: 'Product', ...flags, root }, positionals);
  for (const e of out.edits) {
    const abs = path.join(root, e.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, e.next, 'utf8');
  }
  return { root, out };
}

// -- drift gate -------------------------------------------------------------
// new-module.js mirrors these two rules instead of requiring server.js, so
// that a scaffold keeps working while server.js is mid-edit. This test is what
// makes the copy safe: it reads the literals out of server.js as TEXT (never
// requiring it) and fails the moment the two definitions diverge.

test('the module id regex matches the one in server.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = /const MODULE_ID_RE = (\/.+?\/);/.exec(src);
  assert.ok(m, 'MODULE_ID_RE not found in server.js');
  assert.strictEqual('/' + NM.MODULE_ID_RE.source + '/', m[1]);
});

test('the reserved id set matches the one in server.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = /const RESERVED_MODULE_IDS = new Set\(\[(.*?)\]\)/s.exec(src);
  assert.ok(m, 'RESERVED_MODULE_IDS not found in server.js');
  // Both sides spread the eight core hub ids in rather than listing them
  // (js/core-hubs.mjs is the declaration; tests/test_core_hubs.mjs gates the
  // copies), so the spread is expanded here before the two are compared.
  const hubs = /const CORE_HUB_IDS = new Set\(\[(.*?)\]\)/s.exec(src);
  assert.ok(hubs, 'CORE_HUB_IDS not found in server.js');
  const expandSpread = (body) => body.replace('...CORE_HUB_IDS', hubs[1]);
  const fromServer = expandSpread(m[1]).split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepStrictEqual([...NM.RESERVED_MODULE_IDS].sort(), fromServer.sort());
});

test('the area max length matches the one in server.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = /const MODULE_AREA_MAX = (\d+);/.exec(src);
  assert.ok(m, 'MODULE_AREA_MAX not found in server.js');
  assert.strictEqual(NM.MODULE_AREA_MAX, Number(m[1]));
});

test('--area is required - missing it is a usage error (exit 2), and writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-'));
  assert.throws(
    () => execFileSync(process.execPath, [NEW_MODULE_SCRIPT, 'orders', 'Orders', '--root', root], { stdio: 'pipe' }),
    (e) => e.status === 2,
  );
  assert.ok(!fs.existsSync(path.join(root, 'modules')));
});

test('--area rejects an invalid value (too short) with exit 2', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-'));
  assert.throws(
    () => execFileSync(process.execPath, [NEW_MODULE_SCRIPT, 'orders', 'Orders', '--area', 'A', '--root', root], { stdio: 'pipe' }),
    (e) => e.status === 2,
  );
});

test('--area writes the normalized area into module.json, right after status', () => {
  const { root } = scaffold({ area: '  Product   Retail  ' }, ['orders', 'Orders']);
  const text = fs.readFileSync(path.join(root, 'modules/orders/module.json'), 'utf8');
  const manifest = JSON.parse(text);
  assert.strictEqual(manifest.area, 'Product Retail');
  assert.ok(/"status":[^\n]*\n\s*"area":/.test(text), 'area must be written right after status');
});

test('--hub refuses anything but a core hub, and writes sidebar.kind "page"', () => {
  const manifest = JSON.parse(NM.manifestSource('time-off', 'Time off', NM.parseViews(undefined, 'time-off', 'Time off'), '24-ic-calendar', true, 'support', 'Product'));
  assert.deepStrictEqual(manifest.sidebar, { label: 'Time off', kind: 'page', hub: 'support' });
  // No --hub keeps the old shape: the module owns its rail entry.
  const own = JSON.parse(NM.manifestSource('reports', 'Reports', NM.parseViews(undefined, 'reports', 'Reports'), undefined, true, null, 'Product'));
  assert.deepStrictEqual(own.sidebar, { label: 'Reports', kind: 'item' });
  assert.ok(NM.CORE_HUB_IDS.includes('support'));
  assert.ok(!NM.CORE_HUB_IDS.includes('no-such-id'));
});

test('DATA_REPO_IDS mirrors the data repo route ids in server.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const defs = /const DATA_REPO_DEFS = \[(.*?)\n\];/s.exec(src);
  assert.ok(defs, 'DATA_REPO_DEFS not found in server.js');
  const ids = [...defs[1].matchAll(/^\s*\{ id: '([a-z0-9-]+)'/gm)].map((m) => m[1]);
  const tier0 = /const DATA_TIER_0_NAME = '([a-z0-9-]+)';/.exec(src);
  assert.ok(tier0, 'DATA_TIER_0_NAME not found in server.js');
  assert.deepStrictEqual([...NM.DATA_REPO_IDS].sort(), [tier0[1], ...ids].sort());
});

test('--data: a repo alone writes <id>/, paths narrow it, ":read" makes a read view', () => {
  assert.deepStrictEqual(NM.parseDataRepos(undefined, 'sample'), []);
  assert.deepStrictEqual(NM.parseDataRepos('data-tier-0', 'sample').map((e) => [e.name, e.access, e.paths]), [['data-tier-0', undefined, ['sample/']]]);
  assert.deepStrictEqual(NM.parseDataRepos('data-tier-0:src/,public/', 'sample')[0].paths, ['src/', 'public/']);
  const out = NM.parseDataRepos('data-tier-0:jira/sprints/:read', 'sample');
  assert.deepStrictEqual(out.map((e) => e.name), ['data-tier-0']);
  assert.strictEqual(out[0].access, 'read');
  assert.deepStrictEqual(out[0].paths, ['jira/sprints/']);
  // What it writes is accepted by the host's own validator.
  const { validateModuleManifest } = require('../server.js');
  const manifest = JSON.parse(NM.manifestSource('sample', 'Sample', NM.parseViews(undefined, 'sample', 'Sample'), undefined, true, null, 'AR', out));
  assert.strictEqual(validateModuleManifest(manifest, 'sample').valid, true);
});

test('--data with an unknown repo or a read entry without paths is a usage error (exit 2)', () => {
  for (const spec of ['nope', 'data-tier-0:read', 'ds-data-tier-0']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-'));
    assert.throws(
      () => execFileSync(process.execPath, [NEW_MODULE_SCRIPT, 'sample', 'Sample', '--area', 'AR', '--data', spec, '--root', root], { stdio: 'pipe' }),
      (e) => e.status === 2,
      spec,
    );
    assert.ok(!fs.existsSync(path.join(root, 'modules')));
  }
});

test('--data --dry-run --json prints the dataRepos it would write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-'));
  const raw = execFileSync(process.execPath, [NEW_MODULE_SCRIPT, 'sample', 'Sample', '--area', 'AR',
    '--data', 'data-tier-0', '--dry-run', '--json', '--root', root], { encoding: 'utf8' });
  const json = JSON.parse(raw);
  assert.deepStrictEqual(json.dataRepos.map((e) => [e.name, e.access, e.paths]),
    [['data-tier-0', undefined, ['sample/']]]);
});

// -- view parsing -----------------------------------------------------------

test('no --views gives one "<id>-main" view labelled by the module label', () => {
  assert.deepStrictEqual(NM.parseViews(undefined, 'orders', 'Orders').map((v) => v.id), ['orders-main']);
});

test('--views prefixes every id with the module id', () => {
  const views = NM.parseViews('list:List,archive:Archive', 'reports', 'Reports');
  assert.deepStrictEqual(views.map((v) => v.id), ['reports-list', 'reports-archive']);
  assert.deepStrictEqual(views.map((v) => v.label), ['List', 'Archive']);
});

test('a view id that is not a slug is rejected', () => {
  assert.throws(() => NM.parseViews('Not Slug:X', 'ok', 'Ok'), /not a slug/);
});

test('duplicate view ids are rejected', () => {
  assert.throws(() => NM.parseViews('a:A,a:B', 'ok', 'Ok'), /duplicate/);
});

// -- what it writes ---------------------------------------------------------

test('a single-view module produces an "item" manifest the host accepts', () => {
  const { root, out } = scaffold({}, ['orders', 'Orders']);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'modules/orders/module.json'), 'utf8'));
  assert.strictEqual(manifest.schemaVersion, 1);
  assert.strictEqual(manifest.id, 'orders');
  assert.strictEqual(manifest.sidebar.kind, 'item');
  assert.strictEqual(out.kind, 'item');
  for (const v of manifest.views) assert.ok(v.id.startsWith('orders-'));
});

test('two or more views produce a "hub" manifest', () => {
  const { root } = scaffold({ views: 'list:List,archive:Archive' }, ['reports', 'Reports']);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'modules/reports/module.json'), 'utf8'));
  assert.strictEqual(manifest.sidebar.kind, 'hub');
  assert.strictEqual(manifest.views.length, 2);
});

test('every path the manifest declares is actually written', () => {
  const { root } = scaffold({}, ['orders', 'Orders']);
  const dir = path.join(root, 'modules/orders');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
  for (const rel of [manifest.client.entry, manifest.client.style, manifest.server.entry]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), 'missing ' + rel);
  }
  assert.ok(fs.existsSync(path.join(dir, 'tests', 'test_orders.mjs')));
  assert.ok(fs.existsSync(path.join(dir, 'README.md')));
});

test('--no-server writes no server entry and declares none', () => {
  const { root } = scaffold({ 'no-server': true }, ['prosty', 'Prosty']);
  const dir = path.join(root, 'modules/prosty');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
  assert.strictEqual(manifest.server, undefined);
  assert.ok(!fs.existsSync(path.join(dir, 'server')));
});

test('the client exports a views key per manifest view', () => {
  const { root } = scaffold({ views: 'list:List,archive:Archive' }, ['reports', 'Reports']);
  const client = fs.readFileSync(path.join(root, 'modules/reports/client/index.js'), 'utf8');
  assert.match(client, /export const views = \{/);
  assert.ok(client.includes("'reports-list'"));
  assert.ok(client.includes("'reports-archive'"));
});

// Plan 2026-09-13-przyciski-akcje-modale-spojnosc: the scaffold paints the
// host's header slot with the button hierarchy conventions section 2a asks
// for, and points at confirmDsModal instead of the browser confirm().
test('the scaffolded client paints the header slot with one primary and points at confirmDsModal', () => {
  const { root } = scaffold({}, ['proba-akcje', 'Proba akcje']);
  const client = fs.readFileSync(path.join(root, 'modules/proba-akcje/client/index.js'), 'utf8');
  assert.ok(client.includes("-actions'"), 'no reference to the <view-id>-actions slot');
  assert.ok(client.includes('ds-actions'), 'no ds-actions row in the card body');
  assert.ok(client.includes('confirmDsModal'), 'no confirmDsModal example');
  // Real markup only (a class="..." attribute) - the header comment above the
  // scaffold also names ds-btn--primary in prose, which is not a button.
  const primaryLines = client.split('\n')
    .filter((l) => /class="[^"]*\bds-btn--primary\b[^"]*"/.test(l) && !/\bds-btn--sm\b/.test(l));
  assert.strictEqual(primaryLines.length, 1, 'exactly one big ds-btn--primary line expected');
});

// modules-template/client/index.js and clientSource() are two copies of the
// same pattern (the template is what a person copies by hand, the scaffold is
// what the script writes). Neither gate reads the template, so the copies
// could drift in silence: pin the load-bearing fragments to be present in BOTH.
test('the module template and the scaffold carry the same action-slot pattern', () => {
  const { root } = scaffold({}, ['proba-akcje', 'Proba akcje']);
  const generated = fs.readFileSync(path.join(root, 'modules/proba-akcje/client/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(ROOT, 'modules-template', 'client', 'index.js'), 'utf8');
  const fragments = [
    "-actions'",                       // the header slot is looked up by id
    'class="ds-btn ds-btn--primary"',  // one big primary in the slot
    'class="ds-btn ds-btn--secondary"',
    'ds-actions',                      // the content row
    'ds-btn--sm',                      // content buttons are small
    "import('/js/ds-modal.js')",       // dynamic, inside init()
    'confirmDsModal',
    'registerViewCleanup',
    '_wired',                          // idempotent slot wiring, reset in cleanup
  ];
  for (const f of fragments) {
    assert.ok(generated.includes(f), `scaffold lacks ${f}`);
    assert.ok(template.includes(f), `modules-template/client/index.js lacks ${f}`);
  }
});

test('the generated server entry registers a route and returns it', () => {
  const { root } = scaffold({}, ['orders', 'Orders']);
  const register = require(path.join(root, 'modules/orders/server/index.js'));
  const result = register({ moduleId: 'orders', jsonResponse: () => {} });
  assert.ok(Array.isArray(result.routes) && result.routes.length > 0);
  assert.strictEqual(result.routes[0].method, 'GET');
  assert.match(result.routes[0].path, /^\//);
});

// The scaffold writes non-ASCII labels into the files it generates. Accented copy
// is legal inside a quoted string or an HTML text node and nowhere else, so
// running the repo's own ASCII rule over the output is the only way to be sure
// the generator cannot emit a convention violation - it already did once, in a
// CSS comment built from the module label.
test('nothing the scaffold generates trips the repo ASCII rule', () => {
  const CC = require('../scripts/check-conventions.js');
  const { root, out } = scaffold({ views: 'list:List,report:Report' }, ['trial', 'Caf\u00e9 m\u00f6dule']);
  for (const e of out.edits) {
    if (!/\.(js|mjs|css|json|html)$/i.test(e.file)) continue;
    const rep = { findings: [], block(f) { this.findings.push(f); }, warn() {}, note() {} };
    const lines = fs.readFileSync(path.join(root, e.file), 'utf8').split('\n');
    CC.ruleAscii(rep, {
      path: e.file.split(path.sep).join('/'),
      added: lines.map((text, i) => ({ line: i + 1, text })),
    });
    assert.deepStrictEqual(
      rep.findings.map((f) => f.file + ':' + f.line + ' ' + f.message), [],
      'ASCII violation in generated ' + e.file,
    );
  }
});

test('an accented label still reaches the files a person reads', () => {
  const { root } = scaffold({}, ['trial', 'Caf\u00e9 m\u00f6dule']);
  const dir = path.join(root, 'modules/trial');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
  assert.strictEqual(manifest.name, 'Caf\u00e9 m\u00f6dule');
  assert.strictEqual(manifest.sidebar.label, 'Caf\u00e9 m\u00f6dule');
  assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /Caf\u00e9 m\u00f6dule/);
});

test('generated CSS carries no hardcoded hex colour', () => {
  const { root } = scaffold({}, ['orders', 'Orders']);
  const css = fs.readFileSync(path.join(root, 'modules/orders/client/style.css'), 'utf8');
  assert.ok(!/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/.test(css), 'a token belongs here, not a hex');
});

test('it refuses rather than overwriting an existing module', () => {
  const { root } = scaffold({}, ['orders', 'Orders']);
  const again = NM.run({ root, area: 'Product' }, ['orders', 'Orders']);
  assert.strictEqual(again.refused, true);
  assert.match(again.reason, /already exists/);
  assert.strictEqual(again.edits.length, 0);
});

// -- local git repository (scripts/_module-git.js) --------------------------
// These three spawn the CLI as a real child process (main() is async and
// process.exit-based, unlike the pure run() the tests above call directly),
// because the git step only runs from main().

test('by default the scaffold leaves a .git with a "initial state" commit', { skip: !GIT_AVAILABLE && 'git not on PATH' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-git-'));
  execFileSync(process.execPath, [NEW_MODULE_SCRIPT, 'orders', 'Orders', '--area', 'Product', '--root', root]);
  const dir = path.join(root, 'modules', 'orders');
  assert.ok(fs.existsSync(path.join(dir, '.git')));
  const log = execFileSync('git', ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, 'log', '--oneline'], { encoding: 'utf8' });
  assert.match(log, /initial state/);
});

test('--no-git writes no .git at all', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-git-'));
  execFileSync(process.execPath, [NEW_MODULE_SCRIPT, 'orders', 'Orders', '--area', 'Product', '--root', root, '--no-git']);
  const dir = path.join(root, 'modules', 'orders');
  assert.ok(fs.existsSync(path.join(dir, 'module.json')));
  assert.ok(!fs.existsSync(path.join(dir, '.git')));
});

test('--dry-run mentions the git step and writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-git-'));
  const out = execFileSync(process.execPath, [NEW_MODULE_SCRIPT, 'orders', 'Orders', '--area', 'Product', '--root', root, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /git/);
  assert.ok(!fs.existsSync(path.join(root, 'modules')));
});

// -- --widgets ----------------------------------------------------------------

test('--widgets accepts the two-row presets s2 and m2', () => {
  const { validateModuleManifest } = require('../server.js');
  const { root } = scaffold({ widgets: 'wysoki:Wysoki:s2,m2,xl' }, ['kafel2', 'Kafel2']);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'modules/kafel2/module.json'), 'utf8'));
  const v = manifest.widgets[0].variants;
  assert.deepStrictEqual(v.map((x) => [x.id, x.cols, x.rows]), [['s2', 2, 2], ['m2', 3, 2], ['xl', 6, 2]]);
  assert.strictEqual(manifest.widgets[0].defaultVariant, 's2');
  assert.strictEqual(validateModuleManifest(manifest, 'kafel2').valid, true);
});

test('--widgets writes a widgets[] the host accepts, plus client/widget.js', () => {
  const { validateModuleManifest } = require('../server.js');
  const { root } = scaffold({ widgets: 'przeglad:Przeglad' }, ['kafel', 'Kafel']);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'modules/kafel/module.json'), 'utf8'));
  assert.strictEqual(manifest.widgets.length, 1);
  assert.deepStrictEqual(manifest.widgets[0].variants.map((v) => v.id), ['s', 'm', 'l']);
  assert.strictEqual(manifest.widgets[0].defaultVariant, 'm');
  assert.strictEqual(validateModuleManifest(manifest, 'kafel').valid, true);
  const src = fs.readFileSync(path.join(root, 'modules/kafel/client/widget.js'), 'utf8');
  assert.match(src, /export async function renderWidget\(/);
});

test('without --widgets the manifest has no widgets key and no widget file', () => {
  const { root } = scaffold({}, ['bezkafla', 'Bez kafla']);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'modules/bezkafla/module.json'), 'utf8'));
  assert.ok(!('widgets' in manifest));
  assert.ok(!fs.existsSync(path.join(root, 'modules/bezkafla/client/widget.js')));
});

test('--widgets with an unknown preset is a usage error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-newmod-'));
  assert.throws(
    () => execFileSync(process.execPath, [NEW_MODULE_SCRIPT, 'sample', 'Probka', '--area', 'AR', '--widgets', 'x:Y:zz', '--root', root], { stdio: 'pipe' }),
    (e) => e.status === 2,
  );
  assert.ok(!fs.existsSync(path.join(root, 'modules')));
});
