// rollout-waves/tests/test_rollout_waves.mjs
// Contract test for the rollout-waves module. `npm test` discovers it
// through scripts/test-unit-js.js, which walks modules/<id>/tests/ as well
// as tests/. Domain logic, the XLSX parser and the shard writer each get
// their own dedicated test file - this one is the manifest/routes/no-disk
// contract plus the reader of the locations module's light index
// (locations/locations.index.json).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { APP_ROOT } from './_root.mjs';

const require = createRequire(import.meta.url);
const { validateModuleManifest } = require(path.join(APP_ROOT, 'server.js'));

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = APP_ROOT;
const MODULE_ID = 'rollout-waves';
const VIEW_IDS = ['rollout-waves-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');
const manifest = JSON.parse(read('module.json'));

test('rollout-waves: module.json passes the host validator', () => {
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('rollout-waves: manifest shape - hub, icon, status, one view, dataRepos, no envKeys', () => {
  assert.strictEqual(manifest.sidebar.kind, 'page');
  assert.strictEqual(manifest.sidebar.hub, 'initiatives');
  assert.strictEqual(manifest.author, 'androszr');
  assert.strictEqual(manifest.icon, '24-ic-truck');
  assert.strictEqual(manifest.status, 'beta');
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
  assert.strictEqual(manifest.dataRepos[0].name, 'data-tier-0');
  assert.deepStrictEqual(manifest.dataRepos[0].paths, ['rollout-waves/']);
  assert.deepStrictEqual([manifest.dataRepos[1].access, manifest.dataRepos[1].paths], ['read', ['locations/']], 'the locations directory is a read-only view');
  assert.strictEqual(manifest.envKeys.length, 0);
});

test('rollout-waves: every file the manifest points at, plus every server/CLI helper, exists', () => {
  const refs = [
    manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry,
    'server/rollout-core.js',
    'server/xlsx-lite.js',
    'server/shard-store.js',
    'client/rollout-lib.js',
  ].filter(Boolean);
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('rollout-waves: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('rollout-waves: server/index.js only requires scripts/zip.js inside a function, never at module scope', () => {
  const src = read('server/index.js');
  const zipRequireLines = src.split('\n').filter((line) => line.includes("'zip.js'"));
  assert.strictEqual(zipRequireLines.length, 1, 'scripts/zip.js should be required exactly once');
  // Every top-level statement in this file (const requires, module.exports=)
  // starts at column 0 - a require reached only per-request sits indented
  // inside register()/handleImport().
  assert.ok(/^\s+/.test(zipRequireLines[0]), 'the zip.js require must be indented (inside a function), not at module scope: ' + zipRequireLines[0]);
});

test('rollout-waves: register(ctx) touches no disk - registers exactly the three routes with a rootDir that does not exist', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  assert.strictEqual(typeof register, 'function');
  const result = register({
    moduleId: MODULE_ID, dataDir: '/tmp/does-not-exist', rootDir: '/tmp/does-not-exist', log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  const sigs = result.routes.map((r) => r.method + ' ' + r.path).sort();
  assert.deepStrictEqual(sigs, ['GET /dashboard', 'POST /import-training', 'POST /import-webinar']);
  for (const r of result.routes) {
    assert.match(r.path, /^\//, 'a route path starts with /');
    assert.strictEqual(typeof r.handler, 'function');
  }
});

test('rollout-waves: GET /dashboard with no cloned repo answers 200 available:false, not a throw', async () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const sent = [];
  const result = register({
    moduleId: MODULE_ID, dataDir: '/tmp/does-not-exist', rootDir: '/tmp/does-not-exist', log: () => {},
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
    readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(),
  });
  const route = result.routes.find((r) => r.method === 'GET' && r.path === '/dashboard');
  await route.handler({ url: '/dashboard' }, {});
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].status, 200);
  assert.strictEqual(sent[0].body.available, false);
  assert.strictEqual(sent[0].body.storage, 'unavailable');
  assert.deepStrictEqual(sent[0].body.stores, []);
  assert.deepStrictEqual(sent[0].body.waves, []);
});

test('rollout-waves: POST /import-training with no cloned repo answers 409 repo-missing BEFORE reading the body', async () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const sent = [];
  const result = register({
    moduleId: MODULE_ID, dataDir: '/tmp/does-not-exist', rootDir: '/tmp/does-not-exist', log: () => {},
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
    readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(),
  });
  const route = result.routes.find((r) => r.method === 'POST' && r.path === '/import-training');
  // A stub req with no properties at all - if the handler tried to read the
  // body before the repo check, ctx.readBody(req, ...) would be called on it
  // and this would throw instead of answering cleanly.
  await route.handler({}, {});
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].status, 409);
  assert.strictEqual(sent[0].body.error, 'repo-missing');
});

// -- Body contract: { name, file_base64 } read through ctx.readBody --------
// checkOrigin() answers 415 on any non-GET route whose Content-Type is not
// application/json, and a module cannot opt out (ctx exposes no
// checkOriginNoBody) - so the file travels as base64 text inside the JSON
// body instead of a raw binary stream with an X-File-Name header. These
// tests stub ctx.readBody directly (as every other test in this file
// already does), which is exactly the seam the real handler now reads
// through - it never touches req.on('data'/'end') itself any more.

function registerAt(tmpRoot, readBody) {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const sent = [];
  const result = register({
    moduleId: MODULE_ID, dataDir: tmpRoot, rootDir: tmpRoot, log: () => {},
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
    readBody, checkOrigin: () => true, makeLock: () => (fn) => fn(),
  });
  return { sent, route: (m, p) => result.routes.find((r) => r.method === m && r.path === p) };
}

test('rollout-waves: a non-ASCII name clears the filename gate; a traversal-shaped one is refused', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-waves-name-'));
  fs.mkdirSync(path.join(tmpRoot, 'data-sub-repositories', 'ds-data'), { recursive: true });
  try {
    // A name with accented letters must clear the filename gate - the empty file_base64
    // behind it then answers 'empty-file', never 'bad-file-name', which is
    // exactly what proves the gate itself let the name through.
    {
      const { sent, route } = registerAt(tmpRoot, async () => ({ name: 'Liste des sites \u00e9t\u00e9.xlsx', file_base64: '' }));
      await route('POST', '/import-training').handler({}, {});
      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0].status, 400);
      assert.strictEqual(sent[0].body.error, 'empty-file');
    }

    // A name shaped like a traversal is refused before file_base64 is even
    // looked at - the wider unicode class still excludes '/' entirely.
    {
      const { sent, route } = registerAt(tmpRoot, async () => ({ name: '../../etc/List.xlsx', file_base64: '' }));
      await route('POST', '/import-training').handler({}, {});
      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0].status, 400);
      assert.strictEqual(sent[0].body.error, 'bad-file-name');
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('rollout-waves: ctx.readBody rejecting on size answers 413 too-large', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-waves-size-'));
  fs.mkdirSync(path.join(tmpRoot, 'data-sub-repositories', 'ds-data'), { recursive: true });
  try {
    // This is exactly the message shape the host's readBody rejects
    // with once the running byte count crosses maxBytes - the handler tells
    // the two rejection shapes apart by this prefix, never by guessing.
    const { sent, route } = registerAt(tmpRoot, async () => { throw new Error('Payload too large (>15360 KB)'); });
    await route('POST', '/import-training').handler({}, {});
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].status, 413);
    assert.strictEqual(sent[0].body.error, 'too-large');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('rollout-waves: ctx.readBody rejecting on invalid JSON answers 400 bad-xlsx, not a throw', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-waves-badjson-'));
  fs.mkdirSync(path.join(tmpRoot, 'data-sub-repositories', 'ds-data'), { recursive: true });
  try {
    const { sent, route } = registerAt(tmpRoot, async () => { throw new Error('Invalid JSON'); });
    await route('POST', '/import-training').handler({}, {});
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].status, 400);
    assert.strictEqual(sent[0].body.error, 'bad-xlsx');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('rollout-waves: a file_base64 that decodes to garbage answers 400 bad-xlsx, not a throw', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-waves-garbage-'));
  fs.mkdirSync(path.join(tmpRoot, 'data-sub-repositories', 'ds-data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'zip.js'), path.join(tmpRoot, 'scripts', 'zip.js'));
  try {
    // Valid base64 alphabet, decodes to real bytes - just not a zip, so
    // readZip/parseFirstSheet is what actually rejects it.
    const garbage = Buffer.from('this is plain text, not an xlsx workbook').toString('base64');
    const { sent, route } = registerAt(tmpRoot, async () => ({ name: 'codes.xlsx', file_base64: garbage }));
    await route('POST', '/import-training').handler({}, {});
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].status, 400);
    assert.strictEqual(sent[0].body.error, 'bad-xlsx');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// -- The locations index reader ---------------------------------------------

function setupTmpRepo() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-waves-index-'));
  const repoDir = path.join(tmpRoot, 'data-sub-repositories', 'ds-data');
  fs.mkdirSync(repoDir, { recursive: true });
  return { tmpRoot, repoDir };
}

function writeLocationsIndex(repoDir, { metadata, rows }) {
  const dir = path.join(repoDir, 'locations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'locations.index.json'), JSON.stringify({ metadata, rows }));
}

function writeWaveConfig(repoDir, config) {
  const dir = path.join(repoDir, 'rollout-waves');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'waves-config.json'), JSON.stringify(config));
}

test('rollout-waves: GET /dashboard reads locations/locations.index.json, never the full directory', async () => {
  const { tmpRoot, repoDir } = setupTmpRepo();
  try {
    writeLocationsIndex(repoDir, {
      metadata: { generated_at: '2026-08-27T17:02:27.041184+00:00', source_file: 'locations.xlsx', row_count: 1 },
      rows: [{ code: 'AA001', status: 'Open', manager: 'Alex Morgan', partner: 'Sam Rivera', operator: '', district: '1.1', area: '1', region: 'North', city: 'Springfield' }],
    });
    writeWaveConfig(repoDir, { first_wave_start: '2026-10-13', waves_count: 1, managers: { 'Alex Morgan': 1 } });
    // The full directory (with contact details) must never be opened, even
    // when it sits on disk next to the index - only the one named index file.
    fs.writeFileSync(path.join(repoDir, 'locations', 'locations.json'), 'THIS MUST NEVER BE PARSED');

    const register = require(path.join(DIR, 'server', 'index.js'));
    const sent = [];
    const result = register({
      moduleId: MODULE_ID, dataDir: tmpRoot, rootDir: tmpRoot, log: () => {},
      jsonResponse: (_res, status, body) => sent.push({ status, body }),
      readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(),
    });
    const route = result.routes.find((r) => r.method === 'GET' && r.path === '/dashboard');
    await route.handler({ url: '/dashboard' }, {});

    assert.strictEqual(sent.length, 1);
    const body = sent[0].body;
    assert.strictEqual(body.available, true);
    assert.strictEqual(body.directory.present, true);
    assert.strictEqual(body.directory.total_rows, 1);
    assert.strictEqual(body.directory.source_file, 'locations.xlsx');
    assert.strictEqual(body.generated_at, '2026-08-27T17:02:27.041184+00:00');
    assert.strictEqual(body.stores.length, 1);
    assert.strictEqual(body.stores[0].code, 'AA001');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('rollout-waves: GET /dashboard with no index file answers directory.present:false, not a throw', async () => {
  const { tmpRoot, repoDir } = setupTmpRepo();
  try {
    writeWaveConfig(repoDir, { first_wave_start: '2026-10-13', waves_count: 1, managers: {} });
    // No locations/ at all - the module reads from a not-yet-synced tree.

    const register = require(path.join(DIR, 'server', 'index.js'));
    const sent = [];
    const result = register({
      moduleId: MODULE_ID, dataDir: tmpRoot, rootDir: tmpRoot, log: () => {},
      jsonResponse: (_res, status, body) => sent.push({ status, body }),
      readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(),
    });
    const route = result.routes.find((r) => r.method === 'GET' && r.path === '/dashboard');
    await route.handler({ url: '/dashboard' }, {});

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].status, 200);
    assert.strictEqual(sent[0].body.available, true);
    assert.strictEqual(sent[0].body.directory.present, false);
    assert.deepStrictEqual(sent[0].body.stores, []);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('rollout-waves: POST /import-training answers 409 directory-missing when the index file is absent', async () => {
  const { tmpRoot, repoDir } = setupTmpRepo();
  try {
    writeWaveConfig(repoDir, { first_wave_start: '2026-10-13', waves_count: 1, managers: {} });
    // server/index.js requires scripts/zip.js relative to ctx.rootDir - copy
    // the real file into the throwaway root so the handler can reach the
    // parsing step this test needs (a missing directory AFTER a valid upload,
    // not a load failure of an unrelated script).
    fs.mkdirSync(path.join(tmpRoot, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'zip.js'), path.join(tmpRoot, 'scripts', 'zip.js'));

    const { readZip, writeZip } = require(path.join(ROOT, 'scripts', 'zip.js'));
    const workbookXml = '<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const relsXml = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
    const sheetXml = '<?xml version="1.0"?><worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>Code</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>AA001</t></is></c></row>'
      + '</sheetData></worksheet>';
    const buf = writeZip([
      { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
      { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships/>') },
      { name: 'xl/workbook.xml', data: Buffer.from(workbookXml) },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml) },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml) },
    ]);
    assert.ok(readZip); // sanity: the injected reader really is the app's own

    const register = require(path.join(DIR, 'server', 'index.js'));
    const sent = [];
    const result = register({
      moduleId: MODULE_ID, dataDir: tmpRoot, rootDir: tmpRoot, log: () => {},
      jsonResponse: (_res, status, body) => sent.push({ status, body }),
      readBody: async () => ({ name: 'codes.xlsx', file_base64: buf.toString('base64') }),
      checkOrigin: () => true, makeLock: () => (fn) => fn(),
    });
    const route = result.routes.find((r) => r.method === 'POST' && r.path === '/import-training');

    await route.handler({}, {});

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].status, 409);
    assert.strictEqual(sent[0].body.error, 'directory-missing');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('rollout-waves: a well-formed { name, file_base64 } import succeeds and merges into training-done/', async () => {
  const { tmpRoot, repoDir } = setupTmpRepo();
  try {
    writeLocationsIndex(repoDir, {
      metadata: { generated_at: '2026-08-27T17:02:27.041184+00:00', source_file: 'locations.xlsx', row_count: 1 },
      rows: [{ code: 'AA001', status: 'Open', manager: 'Alex Morgan', partner: 'Sam Rivera', operator: '', district: '1.1', area: '1', region: 'North', city: 'Springfield' }],
    });
    writeWaveConfig(repoDir, { first_wave_start: '2026-10-13', waves_count: 1, managers: { 'Alex Morgan': 1 } });
    fs.mkdirSync(path.join(tmpRoot, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'zip.js'), path.join(tmpRoot, 'scripts', 'zip.js'));

    const { writeZip } = require(path.join(ROOT, 'scripts', 'zip.js'));
    const workbookXml = '<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const relsXml = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
    const sheetXml = '<?xml version="1.0"?><worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>Code</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>AA001</t></is></c></row>'
      + '</sheetData></worksheet>';
    const buf = writeZip([
      { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
      { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships/>') },
      { name: 'xl/workbook.xml', data: Buffer.from(workbookXml) },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml) },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml) },
    ]);

    const register = require(path.join(DIR, 'server', 'index.js'));
    const sent = [];
    const result = register({
      moduleId: MODULE_ID, dataDir: tmpRoot, rootDir: tmpRoot, log: () => {},
      jsonResponse: (_res, status, body) => sent.push({ status, body }),
      readBody: async () => ({ name: 'codes.xlsx', file_base64: buf.toString('base64') }),
      checkOrigin: () => true, makeLock: () => (fn) => fn(),
    });
    const route = result.routes.find((r) => r.method === 'POST' && r.path === '/import-training');

    await route.handler({}, {});

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].status, 200);
    assert.strictEqual(sent[0].body.status, 'ok');
    assert.strictEqual(sent[0].body.imported, 1);
    assert.deepStrictEqual(sent[0].body.unknown, []);

    const shardPath = path.join(repoDir, 'rollout-waves', 'training-done', 'AA0.json');
    assert.ok(fs.existsSync(shardPath), 'expected a written shard for prefix AA0');
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    assert.ok(shard.stores.AA001, 'AA001 should be recorded as done');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
