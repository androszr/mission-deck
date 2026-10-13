// modules/qa-tests/tests/test_qa_tests.mjs
// Contract test for the qa-tests module. `npm test` discovers it through
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

// The module runs from modules/<id>/ when installed and from
// catalog/modules/<id>/ in the source tree: find the core server.js upwards.
function _coreServerPath() {
  const _fs = require('node:fs');
  const _path = require('node:path');
  let dir = _path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    dir = _path.dirname(dir);
    const candidate = _path.join(dir, 'server.js');
    if (_fs.existsSync(candidate) && _fs.existsSync(_path.join(dir, 'package.json'))) return candidate;
  }
  return '../../../server.js';
}

const { validateModuleManifest } = require(_coreServerPath());

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'qa-tests';
const VIEW_IDS = ['qa-tests-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('qa-tests: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('qa-tests: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('qa-tests: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('qa-tests: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('qa-tests: the server entry registers at least one route', () => {
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
