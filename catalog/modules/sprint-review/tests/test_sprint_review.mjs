// modules/sprint-review/tests/test_sprint_review.mjs
// Contract test for the sprint-review module. `npm test` discovers it
// through scripts/test-unit-js.js, which walks modules/<id>/tests/ as well
// as tests/.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
const MODULE_ID = 'sprint-review';
const VIEW_IDS = ['sprint-review-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('sprint-review: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.equal(result.valid, true, (result.errors || []).join('; '));
});

test('sprint-review: the manifest declares exactly the expected shape', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepEqual(manifest.views.map((v) => v.id), VIEW_IDS);
  assert.equal(manifest.area, undefined);
  assert.equal(manifest.status, 'beta');
  assert.equal(manifest.sidebar.kind, 'page');
  assert.equal(manifest.sidebar.hub, 'activity');
  assert.equal(manifest.dataRepos.length, 2);
  assert.equal(manifest.dataRepos[0].name, 'data-tier-0');
  assert.deepEqual(manifest.dataRepos[0].paths, ['sprint-review/']);
  assert.equal(manifest.dataRepos[0].access, undefined);
  // Sprint goals are read from sprint-stats' data in the same source - a view, never a write.
  assert.equal(manifest.dataRepos[1].name, 'data-tier-0');
  assert.equal(manifest.dataRepos[1].access, 'read');
  assert.deepEqual(manifest.dataRepos[1].paths, ['sprint-stats/']);
  const envNames = manifest.envKeys.map((e) => (typeof e === 'string' ? e : e.name));
  assert.ok(envNames.includes('CONFLUENCE_TOKEN'));
  assert.ok(envNames.includes('CONFLUENCE_BASE_URL'));
});

test('sprint-review: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('sprint-review: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
  assert.ok(fs.existsSync(path.join(DIR, 'server', 'session.js')));
  assert.ok(fs.existsSync(path.join(DIR, 'server', 'store.js')));
  assert.ok(fs.existsSync(path.join(DIR, 'server', 'confluence.js')));
});

test('sprint-review: the server entry registers exactly nine routes matched by exact path', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  assert.equal(typeof register, 'function');
  const dataTier0Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-review-contract-'));
  const result = register({
    moduleId: MODULE_ID, dataDir: DIR, rootDir: DIR, dataTier0Dir, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  assert.ok(Array.isArray(result.routes));
  assert.equal(result.routes.length, 10);
  for (const r of result.routes) {
    assert.match(r.path, /^\//, 'a route path starts with /');
    assert.equal(r.path.includes(':'), false, 'handleModuleRoute matches an exact path - no :params');
    assert.equal(typeof r.handler, 'function');
  }
  const key = (r) => r.method + ' ' + r.path;
  const paths = result.routes.map(key);
  for (const expected of [
    'GET /status', 'GET /sessions', 'GET /session', 'POST /sessions', 'PUT /session',
    'DELETE /session', 'PUT /session/team', 'GET /confluence-discover', 'POST /confluence-import',
    'POST /confluence-sync-all',
  ]) {
    assert.ok(paths.includes(expected), 'missing route ' + expected);
  }
});
