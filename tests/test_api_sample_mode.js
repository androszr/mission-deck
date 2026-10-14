'use strict';
// tests/test_api_sample_mode.js
// Sample mode ("Try it with sample data"): status, enter, leave, the boot with
// the marker present, the 409 `sample-mode` refusal of every data-tier-0 sync
// operation, and the modules reading the sample copy.
//
// Four servers, each on its own port and sharing one throwaway folder:
//   OFF     no SAMPLE_DATA_DIR -> the mode refuses to change anything in test mode
//   FIRST   enter -> copy + modules + marker (the mode is not active until a restart)
//   SAMPLE  boots with the marker: team data = the copy, sync refused, leave works
//   AFTER   boots after leave: the normal state again
// Nothing here touches the real data/ folder, modules/ folder or data-sub-repositories/.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, waitForServer, stopServer, getJson, postJson, ROOT } = require('./_api_helper');

const PORT_OFF = 3590;
const PORT_FIRST = 3591;
const PORT_SAMPLE = 3592;
const PORT_AFTER = 3593;

let work;
let env;
let child;

test.before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-deck-sample-mode-'));
  env = {
    SAMPLE_DATA_DIR: path.join(work, 'data'),
    MODULES_DIR: path.join(work, 'modules'),
    MODULES_DATA_DIR: path.join(work, 'modules-data'),
    MODULES_ORIGIN_FILE: path.join(work, 'modules-origin.json'),
    MODULES_REGISTRY_FILE: path.join(work, 'modules-registry.json'),
    MODULES_CATALOG_REPO_URL: '',
    COCKPIT_MODULES_TOKEN: '',
    COCKPIT_APP_TOKEN: '',
    GITLAB_API_BASE_URL: 'http://127.0.0.1:9/api/v4',
    // A developer's .env must not point the data at a real folder.
    DATA_TIER_0_DIR: '',
    DATA_SUB_REPOS_DIR: '',
  };
  fs.mkdirSync(env.MODULES_DIR, { recursive: true });
  fs.mkdirSync(env.SAMPLE_DATA_DIR, { recursive: true });
});

test.afterEach(async () => {
  if (child) { await stopServer(child); child = null; }
});

test.after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

async function boot(port, extra) {
  child = startServer(port, { ...env, ...(extra || {}) });
  await waitForServer(port);
}

function treeEquals(a, b) {
  const list = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? list(path.join(d, e.name)).map((x) => e.name + '/' + x) : [e.name]));
  const la = list(a).sort();
  const lb = list(b).sort();
  assert.deepStrictEqual(la, lb);
  for (const rel of la) assert.ok(fs.readFileSync(path.join(a, rel)).equals(fs.readFileSync(path.join(b, rel))), rel);
}

test('OFF: without SAMPLE_DATA_DIR the mode is inactive and refuses to change in test mode', async () => {
  child = startServer(PORT_OFF, { MODULES_CATALOG_REPO_URL: '', DATA_TIER_0_DIR: path.join(work, 'unused-ds') });
  await waitForServer(PORT_OFF);
  const st = await getJson(PORT_OFF, '/api/sample-mode');
  assert.strictEqual(st.status, 200);
  assert.strictEqual(st.body.active, false);
  assert.strictEqual(st.body.since, null);
  assert.strictEqual(st.body.available, true, 'examples/sample-team ships with the repo');
  assert.strictEqual(st.body.blockedByEnv, true);
  const enter = await postJson(PORT_OFF, '/api/sample-mode/enter', {});
  assert.strictEqual(enter.status, 409);
  assert.strictEqual(enter.body.error, 'test-mode');
  const leave = await postJson(PORT_OFF, '/api/sample-mode/leave', {});
  assert.strictEqual(leave.status, 409);
  assert.strictEqual(leave.body.error, 'test-mode');
  // the real data/ folder was not touched
  assert.ok(!fs.existsSync(path.join(ROOT, 'data', 'sample-mode.json')));
});

test('FIRST: enter copies the data, installs the catalog modules and writes the marker last', async () => {
  await boot(PORT_FIRST);
  const before = await getJson(PORT_FIRST, '/api/sample-mode');
  assert.strictEqual(before.body.active, false);
  assert.strictEqual(before.body.restartRequired, false);

  const bad = await fetch('http://127.0.0.1:' + PORT_FIRST + '/api/sample-mode/enter', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}',
  });
  assert.strictEqual(bad.status, 403, 'checkOrigin guards the write');
  assert.ok(!fs.existsSync(path.join(env.SAMPLE_DATA_DIR, 'sample-mode.json')));

  const enter = await postJson(PORT_FIRST, '/api/sample-mode/enter', {});
  assert.strictEqual(enter.status, 200, JSON.stringify(enter.body));
  assert.strictEqual(enter.body.status, 'entered');
  assert.strictEqual(enter.body.restartRequired, true);
  assert.deepStrictEqual(enter.body.failed, [], JSON.stringify(enter.body.failed));
  assert.strictEqual(enter.body.installed.length, 23);
  assert.strictEqual(fs.readdirSync(env.MODULES_DIR).filter((n) => !n.startsWith('.')).length, 23);

  const marker = JSON.parse(fs.readFileSync(path.join(env.SAMPLE_DATA_DIR, 'sample-mode.json'), 'utf8'));
  assert.strictEqual(marker.active, true);
  assert.match(marker.since, /^\d{4}-\d{2}-\d{2}T/);
  treeEquals(path.join(ROOT, 'examples', 'sample-team', 'ds-data'), path.join(env.SAMPLE_DATA_DIR, 'sample-team', 'ds-data'));

  // not active until the restart, and the answer says so
  const after = await getJson(PORT_FIRST, '/api/sample-mode');
  assert.strictEqual(after.body.active, false);
  assert.strictEqual(after.body.restartRequired, true);

  // a second enter installs nothing new and keeps working
  const again = await postJson(PORT_FIRST, '/api/sample-mode/enter', {});
  assert.strictEqual(again.status, 200);
  assert.deepStrictEqual(again.body.installed, []);
});

test('SAMPLE: booting with the marker serves the copy and refuses every sync operation', async () => {
  // A token and a remote are present: nothing may use them while the mode is on.
  await boot(PORT_SAMPLE, { COCKPIT_DATA_TOKEN: 'glpat-sampletesttoken0000', DATA_TIER_0_REPO_URL: 'http://127.0.0.1:9/team/data.git', PROTO_DEPLOY_TOKEN: 'glpat-sampletesttoken1111' });
  await new Promise((r) => setTimeout(r, 1500)); // the startup chain would have tried the clone by now
  assert.ok(!fs.existsSync(path.join(env.SAMPLE_DATA_DIR, 'sample-team', 'ds-data-encrypted')), 'no clone of the real repository into the sample copy');
  const st = await getJson(PORT_SAMPLE, '/api/sample-mode');
  assert.strictEqual(st.body.active, true);
  assert.match(st.body.since, /^\d{4}-\d{2}-\d{2}T/);
  assert.strictEqual(st.body.restartRequired, false);

  // the browser reads the team data over HTTP: it must be the copy
  const members = await getJson(PORT_SAMPLE, '/data-sub-repositories/ds-data/team/team-members.json');
  assert.strictEqual(members.status, 200);
  assert.strictEqual(members.body.team_members.length, 24);
  const avatar = await fetch('http://127.0.0.1:' + PORT_SAMPLE + '/data-sub-repositories/ds-data/team/avatars/alexmorgan.svg');
  assert.strictEqual(avatar.status, 200);
  // a missing file is "missing", not "forbidden", even when the temp folder sits
  // behind a symlink (macOS /var -> /private/var)
  const absent = await fetch('http://127.0.0.1:' + PORT_SAMPLE + '/data-sub-repositories/ds-data/team/no-such-file.json');
  assert.ok([200, 404].includes(absent.status), 'missing file -> ' + absent.status);
  // a case variant of the prefix never falls through to the real folder under ROOT
  const variant = await fetch('http://127.0.0.1:' + PORT_SAMPLE + '/data-sub-repositories/DS-Data/team/team-members.json');
  assert.strictEqual(variant.status, 404);
  assert.strictEqual((await getJson(PORT_SAMPLE, '/api/team/members')).body.members.length, 24);

  // the installed modules read it too (sprint stats and the knowledge base each resolve the path their own way)
  const stats = await getJson(PORT_SAMPLE, '/api/m/sprint-stats/overview');
  assert.strictEqual(stats.status, 200, JSON.stringify(stats.body).slice(0, 300));
  assert.strictEqual(stats.body.index.sprints.length, 12);
  const kb = await getJson(PORT_SAMPLE, '/api/m/knowledge-base/list');
  assert.strictEqual(kb.body.articles.length, 12);
  const roadmap = await getJson(PORT_SAMPLE, '/api/m/roadmap/initiatives');
  assert.strictEqual(roadmap.body.count, 15);
  const timeLog = await getJson(PORT_SAMPLE, '/api/m/time-log/data');
  assert.strictEqual(timeLog.body.persons.length, 24);
  // the Academy reads the sample copy, which has no clone: the team's progress shows
  const academy = await getJson(PORT_SAMPLE, '/api/cocreate/progress');
  assert.strictEqual(academy.status, 200);
  assert.notStrictEqual(academy.body.storage, 'unavailable', 'the Academy treats the sample copy as storage');
  assert.ok((academy.body.completed['etap-1'] || []).length >= 10, JSON.stringify(academy.body.completed).slice(0, 300));
  const muralList = await getJson(PORT_SAMPLE, '/api/cocreate/mural');
  assert.ok((muralList.body.entries || []).length >= 4, JSON.stringify(muralList.body).slice(0, 300));

  // every sync operation is refused with the same answer
  const refused = [
    ['POST', '/api/data/data-tier-0/pull'], ['GET', '/api/data/data-tier-0/pull-stream'],
    ['POST', '/api/data/data-tier-0/push'], ['GET', '/api/data/data-tier-0/push-stream'],
    ['GET', '/api/data/data-tier-0/push-stream?module=costs'],
    ['POST', '/api/data/data-tier-0/decrypt'], ['POST', '/api/data/data-tier-0/clear-plaintext'],
    ['POST', '/api/data/data-tier-0/resolve-autostash'], ['POST', '/api/data/data-tier-0/pull-overwrite'],
    ['GET', '/api/data/data-tier-0/pull-overwrite-stream'], ['POST', '/api/data/data-tier-0/clone'],
    ['POST', '/api/data-tier-0/pull'], ['POST', '/api/data-tier-0/push'], ['GET', '/api/data-tier-0/push-stream'],
    ['POST', '/api/data-tier-0/clear-plaintext'], ['POST', '/api/data-tier-0/pull-overwrite'],
    ['GET', '/api/prototypes/deploy-stream?id=proto-aaaaaaaa'],
  ];
  for (const [method, url] of refused) {
    const r = await fetch('http://127.0.0.1:' + PORT_SAMPLE + url, {
      method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined,
    });
    const body = await r.json().catch(() => ({}));
    assert.strictEqual(r.status, 409, method + ' ' + url + ' -> ' + r.status);
    assert.strictEqual(body.error, 'sample-mode', method + ' ' + url);
    assert.match(body.message, /Leave sample mode/);
  }
  // no network from the status questions, no publish from the Academy, no second enter
  const cu = await getJson(PORT_SAMPLE, '/api/data/data-tier-0/check-update');
  assert.deepStrictEqual(cu.body, { ok: true, hasUpdate: false, sampleMode: true });
  const rf = await postJson(PORT_SAMPLE, '/api/sync-overview/refresh', {});
  assert.strictEqual(rf.status, 200);
  const mine = (rf.body.refreshed || []).find((x) => x.repo === 'data-tier-0');
  assert.ok(!mine || mine.skipped === 'sample-mode', JSON.stringify(mine));
  const mural = await postJson(PORT_SAMPLE, '/api/cocreate/mural', { content: 'Hello from the sample team.' });
  assert.strictEqual(mural.status, 200, JSON.stringify(mural.body));
  assert.deepStrictEqual({ state: mural.body.sync.state, reason: mural.body.sync.reason }, { state: 'skipped', reason: 'sample-mode' });
  const again = await postJson(PORT_SAMPLE, '/api/sample-mode/enter', {});
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.body.error, 'already-active');
  // the read-only questions stay open
  assert.strictEqual((await getJson(PORT_SAMPLE, '/api/data/data-tier-0/status')).status, 200);
  assert.strictEqual((await getJson(PORT_SAMPLE, '/api/data-tier-0/status')).status, 200);

  // leave: marker and copy are gone, a restart is needed
  const leave = await postJson(PORT_SAMPLE, '/api/sample-mode/leave', {});
  assert.strictEqual(leave.status, 200);
  assert.strictEqual(leave.body.status, 'left');
  assert.strictEqual(leave.body.restartRequired, true);
  assert.ok(!fs.existsSync(path.join(env.SAMPLE_DATA_DIR, 'sample-mode.json')));
  assert.ok(!fs.existsSync(path.join(env.SAMPLE_DATA_DIR, 'sample-team')));
  const mid = await getJson(PORT_SAMPLE, '/api/sample-mode');
  assert.strictEqual(mid.body.active, true, 'still the sample until the restart');
  assert.strictEqual(mid.body.restartRequired, true);
});

test('AFTER: booting after leave is the normal state again', async () => {
  await boot(PORT_AFTER);
  const st = await getJson(PORT_AFTER, '/api/sample-mode');
  assert.strictEqual(st.body.active, false);
  assert.strictEqual(st.body.restartRequired, false);
  const members = await getJson(PORT_AFTER, '/api/team/members');
  assert.notStrictEqual(members.body.members.length, 24, 'the sample team is gone');
});

test('a marker is ignored when DATA_TIER_0_DIR is set explicitly', async () => {
  const dir = path.join(work, 'explicit-ds');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(env.SAMPLE_DATA_DIR, 'sample-mode.json'), JSON.stringify({ active: true, since: '2026-09-30T10:00:00.000Z' }));
  fs.cpSync(path.join(ROOT, 'examples', 'sample-team', 'ds-data'), path.join(env.SAMPLE_DATA_DIR, 'sample-team', 'ds-data'), { recursive: true });
  child = startServer(PORT_AFTER, { ...env, DATA_TIER_0_DIR: dir });
  await waitForServer(PORT_AFTER);
  const st = await getJson(PORT_AFTER, '/api/sample-mode');
  assert.strictEqual(st.body.active, false);
  const r = await fetch('http://127.0.0.1:' + PORT_AFTER + '/api/data/data-tier-0/pull', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const body = await r.json().catch(() => ({}));
  assert.notStrictEqual(body.error, 'sample-mode');
  const enter = await postJson(PORT_AFTER, '/api/sample-mode/enter', {});
  assert.strictEqual(enter.status, 409);
  assert.strictEqual(enter.body.error, 'explicit-data-dir');
});

test('a marker is also ignored when DATA_SUB_REPOS_DIR or DATA_TIER_0_GIT_DIR is set explicitly', async () => {
  fs.writeFileSync(path.join(env.SAMPLE_DATA_DIR, 'sample-mode.json'), JSON.stringify({ active: true, since: '2026-09-30T10:00:00.000Z' }));
  fs.cpSync(path.join(ROOT, 'examples', 'sample-team', 'ds-data'), path.join(env.SAMPLE_DATA_DIR, 'sample-team', 'ds-data'), { recursive: true });
  for (const extra of [{ DATA_SUB_REPOS_DIR: path.join(work, 'subs') }, { DATA_TIER_0_GIT_DIR: path.join(work, 'gitdir') }]) {
    child = startServer(PORT_AFTER, { ...env, ...extra });
    await waitForServer(PORT_AFTER);
    const st = await getJson(PORT_AFTER, '/api/sample-mode');
    assert.strictEqual(st.body.active, false, JSON.stringify(extra));
    assert.strictEqual(st.body.blockedByEnv, true);
    const enter = await postJson(PORT_AFTER, '/api/sample-mode/enter', {});
    assert.strictEqual(enter.body.error, 'explicit-data-dir');
    await stopServer(child);
    child = null;
  }
});

test('the Academy publish and the startup clone check sample mode before anything else', () => {
  // Both are unreachable over HTTP in a sample copy (no clone means the routes answer repo-missing first),
  // so the order of their first statements is pinned here.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const first = (name) => src.slice(src.indexOf('async function ' + name + '(')).split('\n').slice(1, 6).join('\n');
  assert.match(first('_cocreatePushDataFile'), /if \(SAMPLE_MODE_ACTIVE\) return \{ state: 'skipped', reason: 'sample-mode' \};/);
  assert.match(first('_autoCloneDataTier0'), /if \(SAMPLE_MODE_ACTIVE\) return \{ skipped: 'sample-mode' \};/);
});
