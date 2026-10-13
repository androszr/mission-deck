// modules/knowledge-base/tests/test_knowledge_base.mjs
// Contract test for the knowledge-base module. `npm test` discovers it through
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
const { validateModuleManifest } = require(path.join(findRoot(DIR), 'server.js'));

const MODULE_ID = 'knowledge-base';
const VIEW_IDS = ['knowledge-base-list'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('knowledge-base: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('knowledge-base: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('knowledge-base: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('knowledge-base: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('knowledge-base: the server entry registers at least one route', () => {
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

test('knowledge-base: manifest is in the knowledge hub, on data-tier-0, without meetings', () => {
  const m = JSON.parse(read('module.json'));
  assert.strictEqual(m.sidebar.kind, 'page');
  assert.strictEqual(m.sidebar.hub, 'knowledge');
  assert.strictEqual(m.area, undefined);
  assert.ok(typeof m.author === 'string' && m.author.length > 0);
  assert.strictEqual(m.dataRepos.length, 1);
  const d = m.dataRepos[0];
  assert.strictEqual(d.name, 'data-tier-0');
  assert.deepStrictEqual(d.paths, ['knowledge-base/']);
  assert.ok(!d.paths.some((p) => p.startsWith('meetings')));
});

test('knowledge-base: every route is a GET', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const { routes } = register({ moduleId: MODULE_ID, rootDir: DIR, jsonResponse: () => {} });
  assert.deepStrictEqual(routes.map((r) => r.path).sort(), ['/article', '/file', '/list', '/widget']);
  assert.ok(routes.every((r) => r.method === 'GET'));
});
