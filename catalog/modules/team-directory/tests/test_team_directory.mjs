// modules/team-directory/tests/test_team_directory.mjs
// Contract test for the team-directory module. `npm test` discovers it through
// scripts/test-unit-js.js, which walks modules/<id>/tests/ as well as
// tests/. Domain logic gets its own file - tests/test_team_directory_lib.mjs -
// this one is the manifest/shape contract, plus the two antiregression
// assertions the plan calls out by name: an empty dataRepos (the shared
// team/ folder stays with the core) and a dynamic-only bridge to /js/... (a
// static import would break this very test).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The app root (server.js + js/) is found by walking up, so this test runs both
// from an installed copy (modules/<id>/tests) and from the catalog.
function findAppRoot(start) {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'js'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('app root not found above ' + start);
}
const { validateModuleManifest } = require(path.join(findAppRoot(path.dirname(fileURLToPath(import.meta.url))), 'server.js'));

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'team-directory';
const VIEW_IDS = ['team-directory-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');
const manifest = JSON.parse(read('module.json'));

test('team-directory: module.json passes the host validator', () => {
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('team-directory: manifest shape - page under hub team, one view, no server, team/ read-only', () => {
  assert.strictEqual(manifest.sidebar.kind, 'page');
  assert.strictEqual(manifest.sidebar.hub, 'team');
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
  assert.strictEqual(manifest.views.length, 1);
  assert.strictEqual(manifest.views[0].id, 'team-directory-main');
  // Antiregression: team/ is written by Settings > Users (the core
  // scope "_team"), so this module declares it as a READ view only. A write
  // entry here would reassign the whole team folder to this module in
  // the data sync window.
  assert.ok(Array.isArray(manifest.dataRepos));
  assert.strictEqual(manifest.dataRepos.length, 1);
  assert.strictEqual(manifest.dataRepos[0].name, 'data-tier-0');
  assert.strictEqual(manifest.dataRepos[0].access, 'read');
  assert.deepStrictEqual(manifest.dataRepos[0].paths, ['team/']);
  assert.ok(!manifest.dataRepos.some((r) => r.access !== 'read'), 'no write entry');
  // No server layer - --no-server scaffold, no routes, no tests/test_api_*.
  assert.strictEqual(manifest.server, undefined);
});

test('team-directory: no leftover scaffold placeholder text', () => {
  assert.ok(!read('module.json').includes('TODO'), 'module.json still carries a scaffold placeholder');
});

test('team-directory: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('team-directory: every file the manifest points at exists', () => {
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry,
    'client/team-directory-lib.js']) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('team-directory: client/index.js has no static import of a core /js/... module', () => {
  const src = read('client/index.js');
  const staticCoreImport = src.split('\n').some((line) => /^import .*['"]\/js\//.test(line));
  assert.strictEqual(staticCoreImport, false, 'a static import of /js/... breaks this contract test (no browser document, no URL resolver)');
  // The bridge exists, it is just dynamic - inside a function, in try/catch.
  assert.match(src, /await import\('\/js\/team-directory\.js'\)/);
  assert.match(src, /await import\('\/js\/ds-modal\.js'\)/);
});

test('team-directory: client/team-directory-lib.js has no core /js/... import and no document globals', () => {
  const src = read('client/team-directory-lib.js');
  assert.ok(!/from ['"]\/js\//.test(src), 'team-directory-lib.js must stay dependency-free (no /js/... import)');
  assert.ok(!/\bdocument\./.test(src), 'team-directory-lib.js must stay free of document access');
});
