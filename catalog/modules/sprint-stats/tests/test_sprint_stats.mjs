// modules/sprint-stats/tests/test_sprint_stats.mjs
// Contract test for the sprint-stats module. `npm test` discovers it through
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
const MODULE_ID = 'sprint-stats';
const VIEW_IDS = ['sprint-stats-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('sprint-stats: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('sprint-stats: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('sprint-stats: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('sprint-stats: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('sprint-stats: the server entry registers at least one route', () => {
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

test('sprint-stats: register(ctx) with a rootDir that does not exist still returns 6 routes', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const missingRoot = path.join(DIR, 'this-does-not-exist-' + Date.now());
  const result = register({
    moduleId: MODULE_ID, dataDir: missingRoot, rootDir: missingRoot, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  assert.strictEqual(result.routes.length, 6);
  const byPathMethod = result.routes.map((r) => r.method + ' ' + r.path).sort();
  assert.deepStrictEqual(byPathMethod, [
    'GET /discover',
    'GET /overview',
    'GET /refresh-stream',
    'GET /spillover',
    'GET /sprint',
    'POST /spillover/recompute',
  ]);
});

test('sprint-stats: manifest shape - hub, area, dataRepos and envKeys', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.strictEqual(manifest.id, 'sprint-stats');
  assert.strictEqual(manifest.area, undefined);
  assert.strictEqual(manifest.status, 'beta');
  assert.strictEqual(manifest.icon, '24-ic-reports');
  assert.strictEqual(manifest.sidebar.kind, 'page');
  assert.strictEqual(manifest.sidebar.hub, 'activity');
  assert.deepStrictEqual(manifest.dataRepos[0].paths, ['sprint-stats/']);
  assert.strictEqual(manifest.dataRepos[0].name, 'data-tier-0');
  const envNames = manifest.envKeys.map((e) => (typeof e === 'string' ? e : e.name));
  assert.ok(envNames.includes('JIRA_TOKEN'));
  assert.ok(envNames.includes('JIRA_TECH_TOKEN'));
});
