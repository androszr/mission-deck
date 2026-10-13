// on-call/tests/test_oncall.mjs
// Contract test for the on-call module. `npm test` discovers it through
// scripts/test-unit-js.js, which walks modules/<id>/tests/ as well as tests/.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { APP_ROOT } from './_root.mjs';

const require = createRequire(import.meta.url);
const { validateModuleManifest } = require(path.join(APP_ROOT, 'server.js'));

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'on-call';
const VIEW_IDS = ['on-call-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('on-call: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('on-call: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('on-call: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('on-call: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('on-call: the server entry registers the three routes', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  assert.strictEqual(typeof register, 'function');
  const result = register({
    moduleId: MODULE_ID, dataDir: DIR, rootDir: DIR, dataTier0Dir: DIR, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  assert.ok(Array.isArray(result.routes) && result.routes.length === 3);
  for (const r of result.routes) {
    assert.match(r.path, /^\//, 'a route path starts with /');
    assert.strictEqual(typeof r.handler, 'function');
  }
  const byPath = Object.fromEntries(result.routes.map((r) => [r.method + ' ' + r.path, r]));
  assert.ok(byPath['GET /data'], 'GET /data is registered');
  assert.ok(byPath['GET /status'], 'GET /status is registered');
  assert.ok(byPath['POST /sync'], 'POST /sync is registered');
});

test('on-call: manifest facts - hub, area, icon, dataRepos, envKeys', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.strictEqual(manifest.sidebar.kind, 'page');
  assert.strictEqual(manifest.sidebar.hub, 'support');
  assert.strictEqual(manifest.area, 'Operations');
  assert.strictEqual(manifest.author, 'androszr');
  assert.strictEqual(manifest.icon, '24-ic-calendar');
  assert.ok(Array.isArray(manifest.dataRepos) && manifest.dataRepos.length >= 1);
  assert.ok(manifest.dataRepos.some((r) => Array.isArray(r.paths) && r.paths.includes('on-call/')));
  assert.ok(manifest.dataRepos.every((r) => r.name === 'data-tier-0'));
  for (const key of ['CONFLUENCE_TOKEN', 'CONFLUENCE_BASE_URL', 'ONCALL_PAGE_ID']) {
    assert.ok(manifest.envKeys.some((k) => k.name === key), 'envKeys lists ' + key);
  }
});

test('on-call: client/index.js has no static core /js/ import', () => {
  const src = read('client/index.js');
  const staticImportRe = /^import .*['"]\/js\//m;
  assert.strictEqual(staticImportRe.test(src), false, 'client/index.js imports core /js/ statically - must be dynamic inside init()');
});
