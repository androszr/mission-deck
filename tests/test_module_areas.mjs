// tests/test_module_areas.mjs
// Pure helpers behind the module business-area field (plan
// 2026-09-12-obszary-modulow.md): validateModuleArea / normalizeModuleArea
// from server.js, and planAreaMigration from scripts/migrate-module-areas.js.

import { createRequire } from 'node:module';
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const {
  validateModuleArea, normalizeModuleArea, MODULE_AREA_SUGGESTIONS, MODULE_AREA_MAX,
  planCatalogAreaBackfill, setCatalogEntryAreas,
} = require('../server.js');
const { planAreaMigration, writeManifestArea, run } = require('../scripts/migrate-module-areas.js');

// -- normalizeModuleArea --

test('normalizeModuleArea trims and collapses runs of plain spaces', () => {
  assert.strictEqual(normalizeModuleArea('  Product  '), 'Product');
  assert.strictEqual(normalizeModuleArea('Field    Operations'), 'Field Operations');
});

test('normalizeModuleArea never strips a control character', () => {
  // This is the one thing normalizeModuleArea must NEVER do on its own -
  // validateModuleArea below is what refuses a control character, on the RAW
  // value, before this function ever gets to run.
  const withTab = normalizeModuleArea('Cyber\tstore');
  assert.ok(withTab.includes('\t'), 'a control character survives normalization unchanged');
});

// -- validateModuleArea --

test('validateModuleArea accepts the three suggested names', () => {
  for (const area of MODULE_AREA_SUGGESTIONS) {
    const r = validateModuleArea(area);
    assert.strictEqual(r.ok, true, area + ' should be a valid area');
    assert.strictEqual(r.value, area);
  }
});

test('validateModuleArea rejects a raw control character BEFORE normalization runs', () => {
  // Order matters (plan Risks): if trim/collapse ran first, this value would
  // come out looking clean and pass. It must fail here, on the raw input.
  assert.strictEqual(validateModuleArea('Cyber\tstore').ok, false);
  assert.strictEqual(validateModuleArea('Cyber\nstore').ok, false);
  assert.strictEqual(validateModuleArea('Cyber\x00store').ok, false);
});

test('validateModuleArea rejects a non-string value', () => {
  assert.strictEqual(validateModuleArea(42).ok, false);
  assert.strictEqual(validateModuleArea(null).ok, false);
  assert.strictEqual(validateModuleArea(undefined).ok, false);
});

test('validateModuleArea rejects a value that is too short or too long', () => {
  assert.strictEqual(validateModuleArea('A').ok, false, 'one letter is too short');
  assert.strictEqual(validateModuleArea('A'.repeat(MODULE_AREA_MAX + 1)).ok, false, 'over the max is rejected');
  assert.strictEqual(validateModuleArea('A'.repeat(MODULE_AREA_MAX)).ok, true, 'exactly the max is accepted');
});

test('validateModuleArea rejects characters outside the allowed set', () => {
  assert.strictEqual(validateModuleArea('Product!').ok, false);
  assert.strictEqual(validateModuleArea('Product <script>').ok, false);
});

test('validateModuleArea accepts accented letters and the allowed punctuation', () => {
  const r1 = validateModuleArea('Field Operations');
  assert.strictEqual(r1.ok, true);
  const r2 = validateModuleArea('Paiements et Règlements');
  assert.strictEqual(r2.ok, true, 'accented letters are letters, not punctuation');
  const r3 = validateModuleArea('Vente B2B/B2C');
  assert.strictEqual(r3.ok, true, 'slash is an allowed separator');
  const r4 = validateModuleArea('R&D');
  assert.strictEqual(r4.ok, true, 'ampersand is allowed');
});

test('validateModuleArea normalizes the accepted value (trim + collapse spaces)', () => {
  const r = validateModuleArea('  Product   Retail  ');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 'Product Retail');
});

// -- planAreaMigration --

test('planAreaMigration sets the default area for every module with none', () => {
  const decisions = planAreaMigration(['demo-hub', 'locations'], { existing: {} });
  assert.deepStrictEqual(decisions, [
    { id: 'demo-hub', decision: 'set', area: 'Product' },
    { id: 'locations', decision: 'set', area: 'Product' },
  ]);
});

test('planAreaMigration applies an explicit per-module override', () => {
  const decisions = planAreaMigration(['gantt-roadmap', 'time-off'], { existing: {}, overrides: { 'gantt-roadmap': 'Engineering' } });
  assert.deepStrictEqual(decisions, [
    { id: 'gantt-roadmap', decision: 'set', area: 'Engineering' },
    { id: 'time-off', decision: 'set', area: 'Product' },
  ]);
});

test('planAreaMigration skips a module that already has an area, and never overwrites it', () => {
  const decisions = planAreaMigration(['time-off', 'gantt-roadmap'], {
    existing: { 'time-off': 'Product', 'gantt-roadmap': 'Engineering' },
  });
  assert.deepStrictEqual(decisions, [
    { id: 'time-off', decision: 'skip-has-area' },
    { id: 'gantt-roadmap', decision: 'skip-has-area' },
  ]);
});

test('planAreaMigration treats a blank existing area as absent, not as already set', () => {
  const decisions = planAreaMigration(['locations'], { existing: { locations: '   ' } });
  assert.deepStrictEqual(decisions, [{ id: 'locations', decision: 'set', area: 'Product' }]);
});

test('migration replaces a blank area after status and preserves other manifest fields', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-area-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'modules', 'sample');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'module.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'sample', status: 'beta', area: '', name: 'Sample' }));
  assert.strictEqual(writeManifestArea(file, 'Product').ok, true);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(written, { id: 'sample', status: 'beta', area: 'Product', name: 'Sample' });
  assert.deepStrictEqual(Object.keys(written), ['id', 'status', 'area', 'name']);
  assert.deepStrictEqual(run({ root }).decisions, [{ id: 'sample', decision: 'skip-has-area' }]);
  assert.strictEqual(fs.existsSync(file + '.tmp'), false);
});

test('migration refuses unreadable inventory instead of reporting a successful empty run', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-area-bad-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => run({ root }), /ENOENT/);
  const dir = path.join(root, 'modules', 'broken');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'module.json'), '{broken');
  assert.throws(() => run({ root }), SyntaxError);
  const script = fileURLToPath(new URL('../scripts/migrate-module-areas.js', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--root', root, '--dry-run', '--json'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /migration failed/);
  assert.strictEqual(result.stdout, '');
});

test('import retains the area current at lock acquisition, not an earlier snapshot', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-area-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = 'lock-area';
  const target = path.join(root, id);
  fs.mkdirSync(target);
  const manifest = {
    schemaVersion: 1, id, name: 'Lock area', version: '0.1.0',
    sidebar: { kind: 'item', label: 'Lock area' },
    views: [{ id: id + '-main', label: 'Main' }],
  };
  fs.writeFileSync(path.join(target, 'module.json'), JSON.stringify({ ...manifest, area: 'Product' }));
  const zip = require('../scripts/zip.js');
  const dataBase64 = zip.writeZip([
    { name: 'module.json', data: Buffer.from(JSON.stringify(manifest)) },
  ]).toString('base64');
  const server = require('../server.js');
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const handlerSource = source.match(/async function handleModuleImport\([\s\S]*?\n\}/)[0];
  let lockHeld = false;
  let response;
  const handler = vm.runInNewContext('(' + handlerSource + ')', {
    Buffer, path, process, console,
    fs: {
      ...fs,
      readFileSync(file, ...args) {
        if (file === path.join(target, 'module.json')) assert.ok(lockHeld, 'fallback read must hold the swap lock');
        return fs.readFileSync(file, ...args);
      },
    },
    MODULES_DIR: root, MODULE_IMPORT_MAX_B64: 1024 * 1024, MODULE_IMPORT_MAX_ZIP_BYTES: 1024 * 1024,
    checkOrigin: () => true,
    readBody: async () => ({ dataBase64, overwrite: true }),
    readZip: zip.readZip, isSafeEntryName: zip.isSafeEntryName,
    _isIncidentalImportEntry: () => false,
    validateModuleManifest: server.validateModuleManifest,
    validateModuleArea: server.validateModuleArea,
    setManifestArea: server.setManifestArea,
    _moduleAreaSuggestions: () => ['AR', 'Product'],
    _findStaleModuleBackup: () => null,
    _moduleGitOpts: () => ({}),
    MG: { moduleGitStatus: async () => ({ present: false }), moduleGitInit: async () => ({ ok: true }) },
    _setModuleOrigin: () => {},
    jsonResponse: (_res, status, body) => { response = { status, body }; },
    withModulesLock: async (callback) => {
      // A preceding operation changed the area before handing us the lock.
      fs.writeFileSync(path.join(target, 'module.json'), JSON.stringify({ ...manifest, area: 'AR' }));
      lockHeld = true;
      try { return await callback(); } finally { lockHeld = false; }
    },
  });
  await handler({}, {});
  assert.strictEqual(response.status, 200, JSON.stringify(response));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(target, 'module.json'), 'utf8')).area, 'AR');
});

// -- planCatalogAreaBackfill (POST /api/modules/catalog/migrate-areas) --

test('planCatalogAreaBackfill: request wins, installed fills, has-area and no-source are skipped', () => {
  const entries = [
    { id: 'a', area: '', curated: true },
    { id: 'b', area: 'AR', curated: true },
    { id: 'c', area: '', curated: false },
    { id: 'd', area: '' },
    { id: 'e', area: '   ' },
  ];
  const plan = planCatalogAreaBackfill(entries, { a: 'Product', c: '  Field   Operations ', e: 'Cyber\tstore' }, { a: 'AR' });
  assert.deepStrictEqual(plan.set, [
    { id: 'a', area: 'AR', source: 'request', curated: true },
    { id: 'c', area: 'Field Operations', source: 'installed', curated: false },
  ]);
  assert.deepStrictEqual(plan.skipped, [
    { id: 'b', reason: 'has-area' },
    { id: 'd', reason: 'no-source' },
    // A control character in the installed manifest is refused, never repaired.
    { id: 'e', reason: 'no-source' },
  ]);
});

test('planCatalogAreaBackfill never guesses: empty inputs plan nothing', () => {
  assert.deepStrictEqual(planCatalogAreaBackfill([], {}, {}), { set: [], skipped: [] });
  assert.deepStrictEqual(planCatalogAreaBackfill(null, null, null), { set: [], skipped: [] });
  const plan = planCatalogAreaBackfill([{ id: 'x', area: '' }], {}, { x: 'a' });
  assert.deepStrictEqual(plan, { set: [], skipped: [{ id: 'x', reason: 'area-invalid' }] });
});

// -- setCatalogEntryAreas --

test('setCatalogEntryAreas places area after status, keeps owner, never adds an entry', () => {
  const text = JSON.stringify({
    schemaVersion: 1,
    modules: [
      { id: 'a', status: 'beta', summary: 's', owner: { slug: 'kto' } },
      { id: 'b', featured: true, area: 'AR' },
      { id: 'c' },
    ],
  }, null, 2) + '\n';
  const out = setCatalogEntryAreas(text, { a: 'Product', b: 'AR', c: ' Field  Operations ', zzz: 'AR' });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.changed, ['a', 'c']);
  assert.deepStrictEqual(out.missing, ['zzz']);
  const doc = JSON.parse(out.text);
  assert.deepStrictEqual(Object.keys(doc.modules[0]), ['id', 'status', 'area', 'summary', 'owner']);
  assert.strictEqual(doc.modules[0].area, 'Product');
  assert.deepStrictEqual(doc.modules[0].owner, { slug: 'kto' });
  assert.deepStrictEqual(doc.modules[1], { id: 'b', featured: true, area: 'AR' });
  assert.deepStrictEqual(doc.modules[2], { id: 'c', area: 'Field Operations' });
  assert.strictEqual(doc.modules.length, 3, 'a missing id never becomes a new curation entry');
  assert.ok(out.text.endsWith('}\n'));
  assert.ok(out.text.includes('\n  "modules"'), 'two-space indent, like upsertCatalogEntry');
});

test('setCatalogEntryAreas refuses a broken catalog or an invalid area without writing', () => {
  assert.strictEqual(setCatalogEntryAreas('not json', { a: 'AR' }).ok, false);
  assert.strictEqual(setCatalogEntryAreas('[]', { a: 'AR' }).ok, false);
  assert.strictEqual(setCatalogEntryAreas(JSON.stringify({ schemaVersion: 2, modules: [] }), { a: 'AR' }).ok, false);
  assert.strictEqual(setCatalogEntryAreas(JSON.stringify({ schemaVersion: 1, modules: {} }), { a: 'AR' }).ok, false);
  const bad = setCatalogEntryAreas(JSON.stringify({ schemaVersion: 1, modules: [{ id: 'a' }] }), { a: 'Cyber\tstore' });
  assert.deepStrictEqual(bad, { ok: false, error: 'area-invalid: a' });
});
