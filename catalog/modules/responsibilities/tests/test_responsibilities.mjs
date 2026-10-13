// modules/responsibilities/tests/test_responsibilities.mjs
// Contract test for the responsibilities module. `npm test` discovers it through
// scripts/test-unit-js.js, which walks modules/<id>/tests/ as well as tests/.
//
// Scaffolded by scripts/new-module.js - extend it with real behaviour tests.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The app root: modules/<id>/ when installed, catalog/modules/<id>/ in the
// source tree. Walk up until server.js is found.
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'server.js')) && fs.existsSync(path.join(d, 'js'))) return d;
    d = path.dirname(d);
  }
  throw new Error('app root (server.js) not found above ' + start);
}
const ROOT = findRoot(DIR);
const { validateModuleManifest } = require(path.join(ROOT, 'server.js'));
const MODULE_ID = 'responsibilities';
const VIEW_IDS = ['responsibilities-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('responsibilities: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('responsibilities: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('responsibilities: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('responsibilities: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

const EXPECTED_ROUTES = [
  'GET /data', 'POST /areas/add', 'POST /areas/delete', 'POST /areas/rename',
  'POST /groups/add', 'POST /groups/delete', 'POST /groups/rename', 'POST /prepare', 'POST /rating',
];

test('responsibilities: register(ctx) returns exactly the nine routes', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const result = register({
    moduleId: MODULE_ID, dataDir: DIR, rootDir: DIR, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  assert.deepStrictEqual(result.routes.map((r) => r.method + ' ' + r.path).sort(), EXPECTED_ROUTES);
});

test('responsibilities: manifest facts (hub, area, icon, dataRepos)', () => {
  const m = JSON.parse(read('module.json'));
  assert.strictEqual(m.sidebar.kind, 'page');
  assert.strictEqual(m.sidebar.hub, 'support');
  assert.strictEqual(m.area, undefined);
  assert.strictEqual(m.icon, '24-ic-task-done');
  assert.strictEqual(m.dataRepos[0].name, 'data-tier-0');
  assert.deepStrictEqual(m.dataRepos[0].paths, ['responsibilities/']);
});

test('responsibilities: the client has no static core import and no window.confirm', () => {
  const src = read('client/index.js');
  assert.ok(!/^import .* from '\/js\//m.test(src), 'static import of /js/');
  assert.ok(!/(^|[^A-Za-z_.])confirm\(/.test(src), 'raw confirm(');
});

test('responsibilities: the client reads canPush for data-tier-0 (read-only gate)', () => {
  const src = read('client/index.js');
  assert.match(src, /canPush/);
  assert.match(src, /data-tier-0/);
  assert.match(src, /\/api\/sync-overview/);
});

test('responsibilities: no core registry names and no hex colours', () => {
  for (const f of ['client/index.js', 'server/index.js', 'server/store.js', 'module.json']) {
    assert.ok(!/VIEW_REGISTRY|HUB_FLYOUT/.test(read(f)), f);
  }
  assert.ok(!/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\b/.test(read('client/style.css')));
});

test('responsibilities: the server entry registers at least one route', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  assert.strictEqual(typeof register, 'function');
  const result = register({
    moduleId: MODULE_ID, dataDir: DIR, rootDir: DIR, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  assert.ok(Array.isArray(result.routes) && result.routes.length > 0);
  for (const r of result.routes) {
    assert.match(r.path, /^\//, 'a route path starts with /');
    assert.strictEqual(typeof r.handler, 'function');
  }
});
