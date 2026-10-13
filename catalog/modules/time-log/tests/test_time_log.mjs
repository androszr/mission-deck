// modules/time-log/tests/test_time_log.mjs
// Contract test for the time-log module. `npm test` discovers it through
// scripts/test-unit-js.js, which walks modules/<id>/tests/ as well as tests/.
//
// Extended past the scripts/new-module.js scaffold with the manifest shape
// this module requires (dataRepos, envKeys, hub) and two
// copy-consistency checks: TEAMS (client vs server, CJS
// cannot import the ESM client) and ROLE_CODES (server/match.js vs the
// ROLE_CODE_RE literal in js/team-directory.js, which CJS also cannot
// import - both are read as text instead).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { APP_ROOT } from './_root.mjs';

const require = createRequire(import.meta.url);
const { validateModuleManifest } = require(path.join(APP_ROOT, 'server.js'));

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = APP_ROOT;
const MODULE_ID = 'time-log';
const VIEW_IDS = ['time-log-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('time-log: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('time-log: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('time-log: the manifest is a page in the team hub with data-tier-0 and JIRA_TOKEN declared', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.strictEqual(manifest.sidebar.kind, 'page');
  assert.strictEqual(manifest.sidebar.hub, 'team');
  assert.strictEqual(manifest.area, undefined);
  // One write entry (its own folder) and one read view of the team roster.
  assert.deepStrictEqual(manifest.dataRepos.map((r) => [r.name, r.access, r.paths]),
    [['data-tier-0', undefined, ['time-log/']], ['data-tier-0', 'read', ['team/']]]);
  const envNames = manifest.envKeys.map((e) => (typeof e === 'string' ? e : e.name));
  assert.ok(envNames.includes('JIRA_TOKEN'));
  assert.strictEqual(manifest.server.entry, 'server/index.js');
});

test('time-log: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('time-log: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('time-log: the server entry registers exactly the three routes', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  assert.strictEqual(typeof register, 'function');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'time-log-contract-'));
  try {
    const result = register({
      moduleId: MODULE_ID, dataDir: tmp, dataTier0Dir: tmp, rootDir: DIR, log: () => {},
      jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,
      makeLock: () => (fn) => Promise.resolve().then(fn),
    });
    assert.ok(Array.isArray(result.routes) && result.routes.length === 3);
    const paths = result.routes.map((r) => r.method + ' ' + r.path).sort();
    assert.deepStrictEqual(paths, ['GET /data', 'GET /refresh-stream', 'GET /status']);
    for (const r of result.routes) {
      assert.match(r.path, /^\//, 'a route path starts with /');
      assert.strictEqual(typeof r.handler, 'function');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('time-log: TEAMS is identical between client/time-log-lib.js and server/build.js', async () => {
  const { TEAMS: teamsServer } = require(path.join(DIR, 'server', 'build.js'));
  const clientMod = await import(path.join(DIR, 'client', 'time-log-lib.js'));
  assert.deepStrictEqual(clientMod.TEAMS, teamsServer);
});

test('time-log: ROLE_CODES matches the ROLE_CODE_RE literal in js/team-directory.js', () => {
  const { ROLE_CODES } = require(path.join(DIR, 'server', 'match.js'));
  const src = fs.readFileSync(path.join(ROOT, 'js', 'team-directory.js'), 'utf8');
  const m = /ROLE_CODE_RE\s*=\s*\/\^\(\?:([^)]+)\)/.exec(src);
  assert.ok(m, 'js/team-directory.js: could not find ROLE_CODE_RE');
  const codesFromCore = m[1].split('|');
  assert.deepStrictEqual([...ROLE_CODES].sort(), [...codesFromCore].sort());
});
