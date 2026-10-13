// modules/costs/tests/test_costs.mjs
// Contract test for the costs module. `npm test` discovers it through
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
const MODULE_ID = 'costs';
const VIEW_IDS = ['costs-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('costs: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('costs: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('costs: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('costs: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('costs: the server entry registers at least one route', () => {
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

test('costs: dataRepos are exactly the costs/ write entry and the roster read entry', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(
    manifest.dataRepos.map((d) => [d.name, d.access, d.paths]),
    [['data-tier-0', undefined, ['costs/']], ['data-tier-0', 'read', ['team/']]],
  );
  assert.strictEqual(manifest.sidebar.kind, 'page');
  assert.strictEqual(manifest.sidebar.hub, 'finance');
  assert.strictEqual(manifest.area, undefined);
  assert.ok(manifest.envKeys.some((k) => k.name === 'JIRA_TOKEN'));
});

test('costs: the server registers exactly seven routes', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const result = register({
    moduleId: MODULE_ID, dataDir: DIR, rootDir: DIR, dataTier0Dir: DIR, log: () => {},
    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  assert.strictEqual(result.routes.length, 7);
});

test('costs: no old costs location, default rate or semi-private repo is named in code', () => {
  const forbidden = ['default' + '_rate', 'jira/' + 'costs', 'data-' + 'product'];
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'tests') walk(p); } else files.push(p);
    }
  };
  walk(DIR);
  for (const f of files.filter((x) => /\.(js|json|css)$/.test(x))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const w of forbidden) assert.ok(!src.includes(w), path.relative(DIR, f) + ' mentions ' + w);
  }
});

test('costs: store.js is the only server file that writes', () => {
  const dir = path.join(DIR, 'server');
  const writers = fs.readdirSync(dir).filter((f) => /writeFileSync|writeFile\(|appendFile|renameSync/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepStrictEqual(writers, ['store.js']);
});
