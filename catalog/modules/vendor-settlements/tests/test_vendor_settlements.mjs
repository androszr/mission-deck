// vendor-settlements/tests/test_vendor_settlements.mjs
// Contract test for the vendor-settlements module: manifest, files, client
// view export and the route table.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { APP_ROOT } from './_root.mjs';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'vendor-settlements';
const VIEW_IDS = ['vendor-settlements-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('vendor-settlements: module.json passes the host validator', () => {
  const { validateModuleManifest } = require(path.join(APP_ROOT, 'server.js'));
  const result = validateModuleManifest(JSON.parse(read('module.json')), MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('vendor-settlements: manifest shape - views, hub, author, data repos', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
  assert.strictEqual(manifest.sidebar.hub, 'finance');
  assert.strictEqual(manifest.author, 'androszr');
  assert.deepStrictEqual(manifest.dataRepos.map((r) => [r.name, r.access || 'write', r.paths]), [
    ['data-tier-0', 'write', ['vendor-settlements/']],
    ['data-tier-0', 'read', ['team/']],
  ]);
});

test('vendor-settlements: the client exports one view per manifest entry', async () => {
  const ns = await import(path.join(DIR, 'client', 'index.js'));
  assert.deepStrictEqual(Object.keys(ns.views), VIEW_IDS);
  assert.strictEqual(typeof ns.views[VIEW_IDS[0]].render, 'function');
});

test('vendor-settlements: the client never calls another module\'s API', () => {
  for (const f of fs.readdirSync(path.join(DIR, 'client')).filter((n) => n.endsWith('.js'))) {
    const src = read(path.join('client', f));
    const others = (src.match(/\/api\/m\/[a-z0-9-]+/g) || []).filter((u) => u !== '/api/m/vendor-settlements');
    assert.deepStrictEqual(others, [], f);
  }
});

test('vendor-settlements: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client.entry, manifest.client.style, manifest.server.entry]) {
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('vendor-settlements: register() touches no disk and exposes the ten routes', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const result = register({
    moduleId: MODULE_ID, dataDir: '/nonexistent', rootDir: '/nonexistent', dataTier0Dir: '/nonexistent/data', log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(),
  });
  assert.deepStrictEqual(result.routes.map((r) => r.method + ' ' + r.path).sort(), [
    'GET /costs', 'GET /data', 'GET /protocols-all', 'GET /status',
    'POST /protocols/generate', 'POST /summary/add', 'POST /summary/delete', 'POST /summary/mark-accepted',
    'POST /summary/update', 'POST /vendor-info/add',
  ]);
});
