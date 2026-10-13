'use strict';
// tests/test_api_modules_catalog_local.js
// The LOCAL module catalog: the default source, a folder holding catalog.json
// and modules/<id>/ (MODULES_CATALOG_DIR, <repo>/catalog when unset). No
// token, no network: list, install, publish and the catalog.json upsert all
// happen on this disk. The GitLab source keeps its own suite in
// tests/test_api_modules_catalog.js.
//
// The server gets a throwaway catalog folder, a throwaway MODULES_DIR and a
// throwaway origin file, and an empty MODULES_CATALOG_REPO_URL (set, so a
// developer's .env cannot switch it back to GitLab). GITLAB_API_BASE_URL
// points at a port nothing listens on: if anything in local mode tried the
// network it would fail loudly instead of reaching a real host.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');

const PORT = 3580;
const UNREACHABLE_API = 'http://127.0.0.1:9/api/v4';

let child;
let workDir;
let catalogDir;
let modulesDir;
let originFile;

function manifest(id, version, extra) {
  return {
    schemaVersion: 1,
    id,
    name: id === 'local-demo' ? 'Local Demo' : 'Local Second',
    version,
    area: 'Platform',
    description: 'A module used by the local catalog tests',
    sidebar: { label: id, kind: 'item' },
    views: [{ id: id + '-main', label: 'Main' }],
    client: { entry: 'client/index.js' },
    ...(extra || {}),
  };
}

function writeModule(root, id, version, files) {
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, 'client'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(manifest(id, version), null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), '// ' + id + ' ' + version + '\n');
  for (const [rel, text] of Object.entries(files || {})) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function readCatalog() {
  return JSON.parse(fs.readFileSync(path.join(catalogDir, 'catalog.json'), 'utf8'));
}

test.before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-deck-local-catalog-'));
  catalogDir = path.join(workDir, 'catalog');
  modulesDir = path.join(workDir, 'modules');
  originFile = path.join(workDir, 'modules-origin.json');
  fs.mkdirSync(path.join(catalogDir, 'modules'), { recursive: true });
  fs.mkdirSync(modulesDir, { recursive: true });
  writeModule(path.join(catalogDir, 'modules'), 'local-demo', '0.1.0', { 'docs/notes.md': '# Notes\n' });
  // A dotfile in the catalog copy is never listed, installed or touched by a publish.
  fs.writeFileSync(path.join(catalogDir, 'modules', 'local-demo', '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(catalogDir, 'catalog.json'), JSON.stringify({
    schemaVersion: 1,
    modules: [{
      id: 'local-demo', status: 'beta', area: 'Platform', summary: 'Curated summary',
      owner: { slug: 'androszr', name: 'androszr' },
    }],
  }, null, 2) + '\n');

  child = startServer(PORT, {
    MODULES_DIR: modulesDir,
    MODULES_ORIGIN_FILE: originFile,
    MODULES_CATALOG_DIR: catalogDir,
    MODULES_CATALOG_REPO_URL: '',
    COCKPIT_MODULES_TOKEN: '',
    COCKPIT_APP_TOKEN: '',
    GITLAB_API_BASE_URL: UNREACHABLE_API,
    // No git on PATH: install and publish must not depend on it.
    PATH: path.join(workDir, 'no-executables'),
  });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('local catalog: GET /api/modules/catalog lists the folder with no token and names its source', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/catalog?force=1');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  assert.strictEqual(body.source, 'local');
  assert.strictEqual(body.catalogSource.mode, 'local');
  assert.ok(body.catalogSource.location.endsWith('catalog/'), body.catalogSource.location);
  assert.deepStrictEqual(body.errors, []);
  assert.deepStrictEqual(body.entries.map((e) => e.id), ['local-demo']);
  const entry = body.entries[0];
  assert.strictEqual(entry.curated, true);
  assert.strictEqual(entry.summary, 'Curated summary');
  assert.strictEqual(entry.manifest.version, '0.1.0');
});

test('local catalog: a module folder without a curation entry is still listed', async () => {
  writeModule(path.join(catalogDir, 'modules'), 'local-second', '1.0.0');
  try {
    const { body } = await getJson(PORT, '/api/modules/catalog?force=1');
    assert.strictEqual(body.ok, true);
    const second = body.entries.find((e) => e.id === 'local-second');
    assert.ok(second, 'uncurated folder is listed');
    assert.strictEqual(second.curated, false);
  } finally {
    fs.rmSync(path.join(catalogDir, 'modules', 'local-second'), { recursive: true, force: true });
  }
});

test('local catalog: install copies modules/<id> from the folder, without dotfiles', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/install', { id: 'local-demo' });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.files, 3);
  const target = path.join(modulesDir, 'local-demo');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(target, 'module.json'), 'utf8')).version, '0.1.0');
  assert.strictEqual(fs.readFileSync(path.join(target, 'docs', 'notes.md'), 'utf8'), '# Notes\n');
  assert.ok(!fs.existsSync(path.join(target, '.gitignore')), 'a catalog dotfile is not installed');
  const origin = JSON.parse(fs.readFileSync(originFile, 'utf8'));
  assert.strictEqual(origin['local-demo'].source, 'catalog');
  assert.strictEqual(origin['local-demo'].version, '0.1.0');
  // A second install without overwrite is refused, as on GitLab.
  const again = await postJson(PORT, '/api/modules/install', { id: 'local-demo' });
  assert.strictEqual(again.status, 409);
});

test('local catalog: installing an id that is not in the folder answers not-found', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/install', { id: 'no-such-module' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'not-found');
  assert.ok(!fs.existsSync(path.join(modulesDir, 'no-such-module')));
});

test('local catalog: publish refuses a version that is not higher than the catalog one', async () => {
  const { status, body } = await postJson(PORT, '/api/modules/publish', { id: 'local-demo' });
  assert.strictEqual(status, 409, JSON.stringify(body));
  assert.strictEqual(body.error, 'version-not-bumped');
});

test('local catalog: publish copies the module into the folder and upserts catalog.json', async () => {
  const dir = path.join(modulesDir, 'local-demo');
  fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(manifest('local-demo', '0.2.0'), null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'client', 'index.js'), '// local-demo 0.2.0\n');
  fs.writeFileSync(path.join(dir, 'client', 'extra.js'), '// new file\n');
  // A removed file: one of three existing paths goes, which the guard allows.
  fs.rmSync(path.join(dir, 'docs'), { recursive: true });

  const { status, body } = await postJson(PORT, '/api/modules/publish', { id: 'local-demo', summary: 'Updated summary', status: 'stable' });
  assert.strictEqual(status, 200, JSON.stringify(body));
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  assert.strictEqual(body.local, true);
  assert.strictEqual(body.branch, null);
  assert.strictEqual(body.mrUrl, null);
  assert.strictEqual(body.catalogMode, 'replace');
  assert.strictEqual(body.deleted, 1);
  assert.deepStrictEqual(body.deletes, ['modules/local-demo/docs/notes.md']);

  const copy = path.join(catalogDir, 'modules', 'local-demo');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(copy, 'module.json'), 'utf8')).version, '0.2.0');
  assert.strictEqual(fs.readFileSync(path.join(copy, 'client', 'extra.js'), 'utf8'), '// new file\n');
  assert.ok(!fs.existsSync(path.join(copy, 'docs')), 'the deleted file and its emptied folder are gone');
  assert.ok(fs.existsSync(path.join(copy, '.gitignore')), 'a dotfile in the catalog copy is left alone');

  const cat = readCatalog();
  assert.strictEqual(cat.modules.length, 1);
  assert.strictEqual(cat.modules[0].summary, 'Updated summary');
  assert.strictEqual(cat.modules[0].status, 'stable');
  assert.deepStrictEqual(cat.modules[0].owner, { slug: 'androszr', name: 'androszr' }, 'the first owner is kept');

  // The very next read sees the new version - no stale snapshot.
  const list = await getJson(PORT, '/api/modules/catalog');
  assert.strictEqual(list.body.entries.find((e) => e.id === 'local-demo').manifest.version, '0.2.0');
  const origin = JSON.parse(fs.readFileSync(originFile, 'utf8'));
  assert.strictEqual(origin['local-demo'].source, 'publish');
});

test('local catalog: publishing a new module adds its entry to catalog.json in id order', async () => {
  writeModule(modulesDir, 'aaa-first', '0.1.0');
  try {
    const { status, body } = await postJson(PORT, '/api/modules/publish', { id: 'aaa-first' });
    assert.strictEqual(status, 200, JSON.stringify(body));
    assert.strictEqual(body.ok, true, JSON.stringify(body));
    assert.strictEqual(body.catalogMode, 'add');
    const cat = readCatalog();
    assert.deepStrictEqual(cat.modules.map((m) => m.id), ['aaa-first', 'local-demo']);
    assert.strictEqual(cat.modules[0].summary, 'A module used by the local catalog tests');
    assert.ok(fs.existsSync(path.join(catalogDir, 'modules', 'aaa-first', 'client', 'index.js')));
  } finally {
    fs.rmSync(path.join(modulesDir, 'aaa-first'), { recursive: true, force: true });
  }
});

test('local catalog: the publish delete guard still refuses a destructive publish', async () => {
  const dir = path.join(modulesDir, 'local-demo');
  // Bump the version so only the guard can refuse.
  fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(manifest('local-demo', '0.3.0'), null, 2) + '\n');
  fs.rmSync(path.join(dir, 'client'), { recursive: true });
  try {
    const { status, body } = await postJson(PORT, '/api/modules/publish', { id: 'local-demo' });
    assert.strictEqual(status, 409, JSON.stringify(body));
    assert.strictEqual(body.error, 'publish-destructive');
    assert.ok(fs.existsSync(path.join(catalogDir, 'modules', 'local-demo', 'client', 'extra.js')), 'nothing was deleted');
  } finally {
    fs.mkdirSync(path.join(dir, 'client'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'client', 'index.js'), '// local-demo 0.2.0\n');
    fs.writeFileSync(path.join(dir, 'client', 'extra.js'), '// new file\n');
  }
});

test('local catalog: pending publishes are always empty and the MR chips carry no catalog row', async () => {
  const pending = await getJson(PORT, '/api/modules/pending-publishes?force=1');
  assert.strictEqual(pending.status, 200);
  assert.strictEqual(pending.body.ok, true);
  assert.deepStrictEqual(pending.body.items, []);
  assert.strictEqual(pending.body.error, undefined);

  const counts = await getJson(PORT, '/api/merge-requests/counts');
  assert.strictEqual(counts.status, 200);
  assert.ok(!counts.body.repos.some((r) => r.key === 'modules'), JSON.stringify(counts.body));
});

test('local catalog: updates compare installed modules with the folder, no token needed', async () => {
  const { status, body } = await getJson(PORT, '/api/modules/updates');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true, JSON.stringify(body));
  const row = body.modules.find((m) => m.id === 'local-demo');
  assert.ok(row);
  assert.strictEqual(row.catalogVersion, '0.2.0');
});
