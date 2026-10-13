// locations/tests/test_locations.mjs
// Contract test for the locations module: manifest shape, register() never
// touching disk, the route table, and every route against a temporary data
// tree (no repo, empty repo, a real import from CSV and from XLSX).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { APP_ROOT } from './_root.mjs';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'locations';
const VIEW_IDS = ['locations-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');
const register = require(path.join(DIR, 'server', 'index.js'));

function fakeCtx(rootDir, dataTier0Dir, bodies) {
  const queue = [...(bodies || [])];
  return {
    moduleId: MODULE_ID,
    dataDir: path.join(rootDir, 'data', 'modules', MODULE_ID),
    rootDir,
    dataTier0Dir,
    log: () => {},
    jsonResponse: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async () => queue.shift() || {},
    checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  };
}

function routesOf(ctx) {
  const out = {};
  for (const r of register(ctx).routes) out[r.method + ' ' + r.path] = r.handler;
  return out;
}

async function call(routes, key, url) {
  const res = {};
  await routes[key]({ url: url || '/' }, res);
  return res;
}

function tempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-'));
  // rootDir needs scripts/zip.js for the XLSX import - point at the real app.
  return { root, data: path.join(root, 'team-data') };
}

const SAMPLE_CSV = fs.readFileSync(path.join(DIR, 'examples', 'locations-sample.csv'), 'utf8');

test('locations: module.json passes the host validator', () => {
  const { validateModuleManifest } = require(path.join(APP_ROOT, 'server.js'));
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('locations: the manifest declares the expected views, hub and data paths', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.strictEqual(manifest.id, MODULE_ID);
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
  assert.strictEqual(manifest.sidebar.kind, 'page');
  assert.strictEqual(manifest.sidebar.hub, 'knowledge');
  assert.strictEqual(manifest.author, 'androszr');
  assert.deepStrictEqual(manifest.dataRepos.map((r) => [r.name, r.paths]), [['data-tier-0', ['locations/']]]);
});

test('locations: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
});

test('locations: register() never touches disk and exposes exactly four routes', () => {
  const ctx = fakeCtx('/nonexistent-root', '/nonexistent-root/data');
  const routes = Object.keys(routesOf(ctx)).sort();
  assert.deepStrictEqual(routes, ['GET /directory', 'GET /files', 'GET /location', 'POST /import']);
});

test('locations: scripts/zip.js is required lazily inside the import handler only', () => {
  const src = read('server/index.js');
  const matches = src.match(/require\(.*'zip\.js'\)/g) || [];
  assert.strictEqual(matches.length, 1);
  assert.ok(src.indexOf(matches[0]) > src.indexOf('async function handleImport'));
});

test('locations: no repo -> available false, import refuses with repo-missing', async () => {
  const { root } = tempTree();
  const routes = routesOf(fakeCtx(root, path.join(root, 'missing')));
  assert.strictEqual((await call(routes, 'GET /directory')).body.available, false);
  assert.strictEqual((await call(routes, 'GET /files')).body.available, false);
  const imp = await call(routes, 'POST /import');
  assert.strictEqual(imp.status, 409);
  assert.strictEqual(imp.body.error, 'repo-missing');
});

test('locations: empty repo -> directory not present, location answers directory-missing', async () => {
  const { root, data } = tempTree();
  fs.mkdirSync(data, { recursive: true });
  const routes = routesOf(fakeCtx(root, data));
  const dirRes = await call(routes, 'GET /directory');
  assert.strictEqual(dirRes.body.available, true);
  assert.strictEqual(dirRes.body.directory.present, false);
  const loc = await call(routes, 'GET /location', '/location?code=LOC-001');
  assert.strictEqual(loc.status, 409);
  assert.strictEqual(loc.body.error, 'directory-missing');
  const bad = await call(routes, 'GET /location', '/location?code=../etc');
  assert.strictEqual(bad.status, 400);
});

test('locations: a CSV import writes both files; the index carries no contact details', async () => {
  const { root, data } = tempTree();
  fs.mkdirSync(data, { recursive: true });
  const body = { name: 'locations.csv', file_base64: Buffer.from(SAMPLE_CSV).toString('base64') };
  const routes = routesOf(fakeCtx(root, data, [body, body]));
  const imp = await call(routes, 'POST /import');
  assert.strictEqual(imp.status, 200, JSON.stringify(imp.body));
  assert.strictEqual(imp.body.total_rows, 4);
  assert.strictEqual(imp.body.written, true);

  const index = JSON.parse(fs.readFileSync(path.join(data, 'locations', 'locations.index.json'), 'utf8'));
  assert.strictEqual(index.rows.length, 4);
  for (const row of index.rows) {
    assert.ok(!('phone' in row) && !('email' in row), 'index row must not carry contact details');
  }

  const again = await call(routes, 'POST /import');
  assert.strictEqual(again.body.written, false, 'the same file twice changes nothing');

  const dir = await call(routes, 'GET /directory', '/directory?q=springfield');
  assert.strictEqual(dir.body.summary.filtered, 2);
  assert.strictEqual(dir.body.summary.total, 4);
  assert.strictEqual(dir.body.summary.open_total, 2);
  assert.ok(dir.body.rows.every((r) => !('search_text' in r)));
  assert.deepStrictEqual(dir.body.facets.groups.map((g) => g.value), ['Flagship', 'Pilot']);

  const byGroup = await call(routes, 'GET /directory', '/directory?group=Pilot');
  assert.deepStrictEqual(byGroup.body.rows.map((r) => r.code), ['LOC-001', 'LOC-002']);

  const vacant = await call(routes, 'GET /directory', '/directory?q=vacant');
  assert.deepStrictEqual(vacant.body.rows.map((r) => [r.code, r.manager]), [['LOC-003', 'Vacant 2']]);

  const loc = await call(routes, 'GET /location', '/location?code=loc-001');
  assert.strictEqual(loc.status, 200);
  assert.strictEqual(loc.body.location.email, 'riverside@example.com');

  const files = await call(routes, 'GET /files');
  assert.strictEqual(files.body.files.directory.total_rows, 4);
  assert.strictEqual(files.body.files.directory.source_file, 'locations.csv');
});

test('locations: an XLSX import goes through scripts/zip.js', async () => {
  const { writeZip } = require(path.join(APP_ROOT, 'scripts', 'zip.js'));
  const cell = (ref, v) => '<c r="' + ref + '" t="inlineStr"><is><t>' + v + '</t></is></c>';
  const sheetXml = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1">' + cell('A1', 'Location export') + '</row>'
    + '<row r="2">' + cell('A2', 'Code') + cell('B2', 'Name') + cell('C2', 'City') + '</row>'
    + '<row r="3">' + cell('A3', 'X-1') + cell('B3', 'First') + cell('C3', 'Springfield') + '</row>'
    + '</sheetData></worksheet>';
  const buf = writeZip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml) },
  ]);
  const { data } = tempTree();
  fs.mkdirSync(data, { recursive: true });
  const routes = routesOf(fakeCtx(APP_ROOT, data, [{ name: 'export.xlsx', file_base64: buf.toString('base64') }]));
  const imp = await call(routes, 'POST /import');
  assert.strictEqual(imp.status, 200, JSON.stringify(imp.body));
  assert.strictEqual(imp.body.total_rows, 1);
});

test('locations: import validation - bad name, missing columns', async () => {
  const { root, data } = tempTree();
  fs.mkdirSync(data, { recursive: true });
  const csv = Buffer.from('Code,Name\nA,B\n').toString('base64');
  const routes = routesOf(fakeCtx(root, data, [
    { name: '../evil.csv', file_base64: csv },
    { name: 'list.csv', file_base64: csv },
  ]));
  const bad = await call(routes, 'POST /import');
  assert.strictEqual(bad.body.error, 'bad-file-name');
  const missing = await call(routes, 'POST /import');
  assert.strictEqual(missing.status, 400);
  assert.strictEqual(missing.body.error, 'missing-columns');
  assert.deepStrictEqual(missing.body.missing, ['city']);
  assert.ok(!fs.existsSync(path.join(data, 'locations')), 'a refused import writes nothing');
});
