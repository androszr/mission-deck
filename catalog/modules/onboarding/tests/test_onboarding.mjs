// modules/onboarding/tests/test_onboarding.mjs
// Contract test for the onboarding module. `npm test` discovers it through
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
const MODULE_ID = 'onboarding';
const VIEW_IDS = ['onboarding-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('onboarding: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('onboarding: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('onboarding: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('onboarding: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('onboarding: the server entry registers at least one route', () => {
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

// -- manifest placement, dataRepos and the exact route set --

test('onboarding: manifest sidebar/area/icon', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.strictEqual(manifest.sidebar.kind, 'page');
  assert.strictEqual(manifest.sidebar.hub, 'knowledge');
  assert.strictEqual(manifest.area, undefined);
  assert.strictEqual(manifest.icon, '24-ic-e-learning');
});

test('onboarding: dataRepos declares the onboarding/ subtree of data-tier-0', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.ok(Array.isArray(manifest.dataRepos) && manifest.dataRepos.length >= 1);
  const repo = manifest.dataRepos[0];
  assert.strictEqual(repo.name, 'data-tier-0');
  assert.ok(Array.isArray(repo.paths) && repo.paths.includes('onboarding/'));
});

test('onboarding: register(ctx) yields exactly the 8 method+path pairs', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const result = register({
    moduleId: MODULE_ID, dataTier0Dir: '/nonexistent', dataDir: DIR, rootDir: DIR, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  const pairs = result.routes.map((r) => r.method + ' ' + r.path).sort();
  assert.deepStrictEqual(pairs, [
    'DELETE /links', 'DELETE /plans',
    'GET /links', 'GET /plans',
    'POST /links', 'POST /plans',
    'PUT /links', 'PUT /plans',
  ]);
});

test('onboarding: every write route uses a method other than GET (host already checks Origin)', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const result = register({
    moduleId: MODULE_ID, dataTier0Dir: '/nonexistent', dataDir: DIR, rootDir: DIR, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  const writeRoutes = result.routes.filter((r) => r.path === '/links' || r.path === '/plans');
  const writes = writeRoutes.filter((r) => r.method !== 'GET');
  assert.ok(writes.length > 0);
  for (const r of writes) {
    assert.notStrictEqual(r.method, 'GET', r.method + ' ' + r.path + ' should not be a GET');
  }
});
