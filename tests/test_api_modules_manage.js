'use strict';
// tests/test_api_modules_manage.js
// API tests for the five module management routes: GET /api/modules/installed,
// POST /api/modules/toggle, POST /api/modules/remove, GET /api/modules/export,
// POST /api/modules/import.
//
// CRITICAL: this suite WRITES and DELETES module directories, so it must never
// point at the committed tests/fixtures/modules/. It works entirely inside an
// mkdtempSync() scratch directory, copied from fixtures/modules/fixture-mod at
// test.before and removed at test.after.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');
const { writeZip, readZip } = require('../scripts/zip');

const PORT = 3527;
const FIXTURE_SRC = path.resolve(__dirname, 'fixtures/modules/fixture-mod');

let child;
let workDir;
let modulesDir;
let dataDir;
let registryFile;
let originFile;

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function readRegistry() {
  try { return JSON.parse(fs.readFileSync(registryFile, 'utf8')); }
  catch { return { disabled: [] }; }
}

// The origin file is gitignored runtime data (data/modules-origin.json) -
// this suite points MODULES_ORIGIN_FILE at its own scratch path so it never
// touches the developer's real file.
function readOrigin() {
  try { return JSON.parse(fs.readFileSync(originFile, 'utf8')); }
  catch { return {}; }
}

function buildZip(entries) {
  return writeZip(entries.map((e) => ({ name: e.name, data: Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data) })));
}

test.before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-mod-'));
  modulesDir = path.join(workDir, 'modules');
  dataDir = path.join(workDir, 'data-modules');
  registryFile = path.join(workDir, 'modules-registry.json');
  originFile = path.join(workDir, 'modules-origin.json');
  fs.mkdirSync(modulesDir, { recursive: true });
  copyDirSync(FIXTURE_SRC, path.join(modulesDir, 'fixture-mod'));

  child = startServer(PORT, {
    MODULES_DIR: modulesDir,
    MODULES_DATA_DIR: dataDir,
    MODULES_REGISTRY_FILE: registryFile,
    MODULES_ORIGIN_FILE: originFile,
  });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(workDir, { recursive: true, force: true });
});

// ── GET /api/modules/installed ───────────────────────────────────────────────

test('GET /api/modules/installed returns fixture-mod enabled, no invalid entries', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/installed');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.invalid));
  assert.strictEqual(body.invalid.length, 0);
  const item = body.installed.find((m) => m.id === 'fixture-mod');
  assert.ok(item, 'fixture-mod missing from installed');
  assert.strictEqual(item.enabled, true);
  assert.ok(body.activeIds.includes('fixture-mod'));
});

// ── POST /api/modules/toggle ─────────────────────────────────────────────────

test('POST /api/modules/toggle disables fixture-mod', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/toggle', { id: 'fixture-mod', enabled: false });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.restartRequired, true);
  assert.deepStrictEqual(readRegistry().disabled, ['fixture-mod']);

  const installed = await getJson(PORT, '/api/modules/installed');
  const item = installed.body.installed.find((m) => m.id === 'fixture-mod');
  assert.ok(item, 'fixture-mod must still be listed while disabled');
  assert.strictEqual(item.enabled, false);
});

test('POST /api/modules/toggle re-enables fixture-mod and clears the registry', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/toggle', { id: 'fixture-mod', enabled: true });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.disabled, []);
  assert.deepStrictEqual(readRegistry().disabled, []);
});

test('POST /api/modules/toggle rejects a bad payload', async () => {
  const { status } = await postJson(PORT, '/api/modules/toggle', { id: 'fixture-mod', enabled: 'nope' });
  assert.strictEqual(status, 400);
});

// ── GET /api/modules/export ──────────────────────────────────────────────────

test('GET /api/modules/export returns a zip with the module manifest inside', async () => {
  const url = `http://127.0.0.1:${PORT}/api/modules/export?id=fixture-mod`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
  const entries = readZip(buf, { maxEntries: 1000, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 });
  assert.ok(entries.some((e) => e.name === 'fixture-mod/module.json'));
});

// ── POST /api/modules/import ─────────────────────────────────────────────────

// `area` defaults to 'Product' so every test that is not specifically
// about the area gate keeps working unchanged; pass `area: null` to build a
// manifest with no area at all, for the gate's own tests below.
function newModuleZip(id, area = 'Product') {
  const manifest = {
    schemaVersion: 1,
    id,
    name: 'Imported ' + id,
    version: '0.1.0',
    sidebar: { label: id, kind: 'item' },
    views: [{ id: id + '-main', label: 'Glowna' }],
  };
  if (area !== null) manifest.area = area;
  return buildZip([
    { name: id + '/module.json', data: JSON.stringify(manifest) },
    { name: id + '/client/index.js', data: 'export const views = {};' },
  ]);
}

test('POST /api/modules/import installs a new module', async () => {
  const zipBuf = newModuleZip('imported-mod');
  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'imported-mod.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
  });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.id, 'imported-mod');
  assert.strictEqual(body.restartRequired, true);
  assert.ok(fs.existsSync(path.join(modulesDir, 'imported-mod', 'module.json')));

  // The import records its origin - source: 'zip' - in MODULES_ORIGIN_FILE,
  // and GET /api/modules/installed surfaces it per item.
  const origin = readOrigin();
  assert.ok(origin['imported-mod'], 'origin record missing for imported-mod');
  assert.strictEqual(origin['imported-mod'].source, 'zip');
  assert.strictEqual(origin['imported-mod'].version, '0.1.0');
  assert.ok(typeof origin['imported-mod'].at === 'string' && origin['imported-mod'].at.length > 0);

  const installed = await getJson(PORT, '/api/modules/installed');
  const item = installed.body.installed.find((m) => m.id === 'imported-mod');
  assert.ok(item, 'imported-mod missing from installed');
  assert.strictEqual(item.origin.source, 'zip');
  assert.strictEqual(item.origin.version, '0.1.0');
});

test('POST /api/modules/import rejects a zip-slip entry and writes nothing outside the work dir', async () => {
  const evilZip = buildZip([
    { name: 'module.json', data: JSON.stringify({ schemaVersion: 1, id: 'evil-mod', name: 'Evil', version: '0.1.0', sidebar: { label: 'Evil', kind: 'item' }, views: [{ id: 'evil-mod-main', label: 'Glowna' }] }) },
    { name: '../../evil.txt', data: 'pwned' },
  ]);
  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'evil.zip',
    dataBase64: evilZip.toString('base64'),
    overwrite: false,
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'unsafe-entry');
  assert.ok(!fs.existsSync(path.join(workDir, '..', 'evil.txt')));
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'evil.txt')));
});

test('POST /api/modules/import rejects a reserved id', async () => {
  const zipBuf = buildZip([
    { name: 'module.json', data: JSON.stringify({ schemaVersion: 1, id: 'dashboard', name: 'X', version: '0.1.0', sidebar: { label: 'X', kind: 'item' }, views: [{ id: 'dashboard-main', label: 'Glowna' }] }) },
  ]);
  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'dashboard.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'invalid-manifest');
});

test('POST /api/modules/import rejects an archive without module.json', async () => {
  const zipBuf = buildZip([{ name: 'readme.txt', data: 'no manifest here' }]);
  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'no-manifest.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'no-manifest');
});

test('POST /api/modules/import on an existing id needs overwrite:true', async () => {
  const zipBuf = newModuleZip('imported-mod');
  const first = await postJson(PORT, '/api/modules/import', {
    filename: 'imported-mod.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
  });
  assert.strictEqual(first.status, 409);
  assert.strictEqual(first.body.error, 'exists');

  const second = await postJson(PORT, '/api/modules/import', {
    filename: 'imported-mod.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: true,
  });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.overwritten, true);
});

// ── POST /api/modules/import — area gate (obszar biznesowy) ─────────────────
// A module without an `area` must not be able to reach modules/<id>/ - see
// plan 2026-09-12-obszary-modulow.md step 3a.

test('POST /api/modules/import rejects duplicate manifests before extraction', async () => {
  const id = 'duplicate-manifest';
  const entries = readZip(newModuleZip(id, null), {
    maxEntries: 1000, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024,
  }).map((entry) => ({ ...entry, name: entry.name.slice(id.length + 1) }));
  const manifest = entries.find((entry) => entry.name === 'module.json');
  const beforeOrigin = readOrigin();
  for (const duplicateName of ['module.json', 'MODULE.JSON']) {
    const zip = buildZip([...entries, { name: duplicateName, data: manifest.data }]);
    const { status, body } = await postJson(PORT, '/api/modules/import', {
      filename: id + '.zip', dataBase64: zip.toString('base64'), area: 'Engineering',
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error, 'duplicate-entry');
    assert.strictEqual(fs.existsSync(path.join(modulesDir, id)), false);
    assert.deepStrictEqual(readOrigin(), beforeOrigin);
  }
});

test('POST /api/modules/import validates explicit area even when the artifact declares one', async () => {
  const id = 'valid-artifact-area';
  const zip = newModuleZip(id, 'Engineering');
  for (const area of ['', 42]) {
    const { status, body } = await postJson(PORT, '/api/modules/import', {
      filename: id + '.zip', dataBase64: zip.toString('base64'), area,
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error, 'area-invalid');
    assert.strictEqual(fs.existsSync(path.join(modulesDir, id)), false);
  }
});

test('POST /api/modules/import without area answers 409 area-required and creates no module dir', async () => {
  const zipBuf = newModuleZip('bez-obszaru', null);
  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'bez-obszaru.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
  });
  assert.strictEqual(status, 409);
  assert.strictEqual(body.error, 'area-required');
  assert.strictEqual(body.needsArea, true);
  assert.strictEqual(body.id, 'bez-obszaru');
  assert.ok(Array.isArray(body.suggestions) && body.suggestions.includes('Product'));
  assert.ok(!fs.existsSync(path.join(modulesDir, 'bez-obszaru')), 'no directory must be created on the 409 path');
});

test('POST /api/modules/import repeated with body.area installs the module and saves the field', async () => {
  const zipBuf = newModuleZip('bez-obszaru', null);
  const refused = await postJson(PORT, '/api/modules/import', {
    filename: 'bez-obszaru.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
  });
  assert.strictEqual(refused.status, 409);

  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'bez-obszaru.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
    area: 'Engineering',
  });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.id, 'bez-obszaru');
  const manifest = JSON.parse(fs.readFileSync(path.join(modulesDir, 'bez-obszaru', 'module.json'), 'utf8'));
  assert.strictEqual(manifest.area, 'Engineering');
});

test('POST /api/modules/import overwrite:true on an existing module without area keeps the area already on disk', async () => {
  const before = JSON.parse(fs.readFileSync(path.join(modulesDir, 'fixture-mod', 'module.json'), 'utf8'));
  assert.strictEqual(before.area, 'Product', 'precondition: fixture-mod already has an area');

  const zipBuf = newModuleZip('fixture-mod', null);
  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'fixture-mod.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: true,
  });
  assert.strictEqual(status, 200, JSON.stringify(body));
  const after = JSON.parse(fs.readFileSync(path.join(modulesDir, 'fixture-mod', 'module.json'), 'utf8'));
  assert.strictEqual(after.area, 'Product', 'the update path must never ask and must keep the area on disk');
});

// An explicit body.area that is invalid (empty string, or a non-string) must
// be refused with 400 area-invalid - never silently ignored in favour of the
// overwrite-existing-area fallback or the area-required prompt.
test('POST /api/modules/import: an explicit but invalid body.area is refused with 400, not silently ignored', async () => {
  const zipBuf = newModuleZip('zla-wartosc', null);
  const empty = await postJson(PORT, '/api/modules/import', {
    filename: 'zla-wartosc.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
    area: '',
  });
  assert.strictEqual(empty.status, 400);
  assert.strictEqual(empty.body.error, 'area-invalid');
  assert.ok(!fs.existsSync(path.join(modulesDir, 'zla-wartosc')), 'no directory must be created on an invalid explicit area');

  const nonString = await postJson(PORT, '/api/modules/import', {
    filename: 'zla-wartosc.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
    area: 42,
  });
  assert.strictEqual(nonString.status, 400);
  assert.strictEqual(nonString.body.error, 'area-invalid');
  assert.ok(!fs.existsSync(path.join(modulesDir, 'zla-wartosc')));
});

test('POST /api/modules/import: an explicit invalid body.area on overwrite is refused, never falls back to the area already on disk', async () => {
  const before = JSON.parse(fs.readFileSync(path.join(modulesDir, 'fixture-mod', 'module.json'), 'utf8'));
  assert.strictEqual(before.area, 'Product');
  const zipBuf = newModuleZip('fixture-mod', null);
  const { status, body } = await postJson(PORT, '/api/modules/import', {
    filename: 'fixture-mod.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: true,
    area: '',
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'area-invalid');
  // Nothing was overwritten - the module already on disk is untouched.
  const after = JSON.parse(fs.readFileSync(path.join(modulesDir, 'fixture-mod', 'module.json'), 'utf8'));
  assert.strictEqual(after.area, 'Product');
});

// A read failure on the EXISTING module's manifest while resolving the
// overwrite fallback must not be swallowed as if it simply had no area - a
// parse error is a real invalid-manifest, distinct from area-required.
test('POST /api/modules/import: a corrupt existing manifest on overwrite answers invalid-manifest, not area-required', async () => {
  const manifestPath = path.join(modulesDir, 'fixture-mod', 'module.json');
  const original = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(manifestPath, '{ not json');
  try {
    const zipBuf = newModuleZip('fixture-mod', null);
    const { status, body } = await postJson(PORT, '/api/modules/import', {
      filename: 'fixture-mod.zip',
      dataBase64: zipBuf.toString('base64'),
      overwrite: true,
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error, 'invalid-manifest');
  } finally {
    fs.writeFileSync(manifestPath, original);
  }
});

// ── POST /api/modules/remove ─────────────────────────────────────────────────

test('POST /api/modules/remove deletes the module dir but keeps data by default', async () => {
  fs.mkdirSync(path.join(dataDir, 'imported-mod'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'imported-mod', 'note.txt'), 'keep me');
  assert.ok(readOrigin()['imported-mod'], 'precondition: imported-mod must have an origin record');

  const { status, body } = await postJson(PORT, '/api/modules/remove', { id: 'imported-mod', removeData: false });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.removedData, false);
  assert.ok(!fs.existsSync(path.join(modulesDir, 'imported-mod')));
  assert.ok(fs.existsSync(path.join(dataDir, 'imported-mod', 'note.txt')));
  assert.strictEqual(readOrigin()['imported-mod'], undefined, 'remove must clear the origin record');
});

test('POST /api/modules/remove with removeData:true deletes both trees', async () => {
  const zipBuf = newModuleZip('throwaway-mod');
  await postJson(PORT, '/api/modules/import', {
    filename: 'throwaway-mod.zip',
    dataBase64: zipBuf.toString('base64'),
    overwrite: false,
  });
  fs.mkdirSync(path.join(dataDir, 'throwaway-mod'), { recursive: true });

  const { status, body } = await postJson(PORT, '/api/modules/remove', { id: 'throwaway-mod', removeData: true });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.removedData, true);
  assert.ok(!fs.existsSync(path.join(modulesDir, 'throwaway-mod')));
  assert.ok(!fs.existsSync(path.join(dataDir, 'throwaway-mod')));
});

// ── Path-escape attempts on export/remove/toggle ─────────────────────────────

test('export, remove and toggle reject an id that tries to escape modules/', async () => {
  const exportRes = await getJson(PORT, '/api/modules/export?id=' + encodeURIComponent('../server'));
  assert.strictEqual(exportRes.status, 400);

  const removeRes = await postJson(PORT, '/api/modules/remove', { id: '../server', removeData: false });
  assert.strictEqual(removeRes.status, 400);

  const toggleRes = await postJson(PORT, '/api/modules/toggle', { id: '../server', enabled: false });
  assert.strictEqual(toggleRes.status, 400);

  assert.ok(fs.existsSync(path.resolve(__dirname, '..', 'server.js')), 'the real server.js must be untouched');
});
