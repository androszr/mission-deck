'use strict';
// tests/test_api_cocreate.js
// The "-- Academy --" section in server.js: progress, unlock, verify-step,
// modules gallery, open-file and admin reset. Runs with DATA_TIER_0_DIR pointed
// at a directory that never existed, so ds-data is guaranteed NOT cloned - the
// contract this suite pins is that every route still answers cleanly (200/400/
// 403/404), never a 501 (wave-2 leftover) and never a 503 (a fresh install with
// no data repo is a normal state, not an outage).

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3515;
let child;

const TMP_DATA_TIER_0_DIR = path.join(os.tmpdir(), `cockpit-test-cocreate-${process.pid}`);

test.before(async () => {
  child = startServer(PORT, {
    COCKPIT_DATA_TOKEN: '',
    DATA_TIER_0_REPO_URL: '',
    DATA_TIER_0_DIR: TMP_DATA_TIER_0_DIR,
    AUTO_SYNC_ENABLED: '0',
    COCKPIT_MODULES_TOKEN: '',
    // The GitLab catalog source with no token: the local folder default would answer.
    MODULES_CATALOG_REPO_URL: 'https://gitlab.example.com/your-group/mission-deck-modules.git',
  });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(TMP_DATA_TIER_0_DIR, { recursive: true, force: true });
});

test('GET /api/cocreate/progress answers 200 with the full shape, storage unavailable', async () => {
  const { status, body } = await getJson(PORT, '/api/cocreate/progress');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.version, 1);
  assert.ok(body.unlocks && typeof body.unlocks === 'object');
  assert.ok(body.steps && typeof body.steps === 'object');
  assert.ok(body.completed && typeof body.completed === 'object');
  assert.ok(Array.isArray(body.unlockable));
  assert.strictEqual(body.storage, 'unavailable');
  assert.notStrictEqual(status, 501);
});

test('GET /api/cocreate/mural answers 200 with an empty shape when ds-data is not cloned', async () => {
  const { status, body } = await getJson(PORT, '/api/cocreate/mural');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.entries));
  assert.strictEqual(body.entries.length, 0);
  assert.strictEqual(body.storage, 'unavailable');
  assert.notStrictEqual(status, 501);
});

test('POST /api/cocreate/mural with repo missing answers 409, never 503', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/mural', { content: 'Hi, I am new here.' });
  // 400 when this machine has no resolvable identity at all - the repo check
  // sits behind it. Never 503: a fresh install with no data repo is normal.
  assert.ok([400, 409].includes(status), `unexpected status ${status}`);
  if (status === 409) assert.strictEqual(body.error, 'repo-missing');
});

test('POST /api/cocreate/mural rejects a non-string body and an over-long entry', async () => {
  const bad = await postJson(PORT, '/api/cocreate/mural', { content: { nope: true } });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error, 'bad-request');
  const long = await postJson(PORT, '/api/cocreate/mural', { content: 'x'.repeat(8001) });
  assert.strictEqual(long.status, 400);
  assert.strictEqual(long.body.error, 'too-long');
});

test('verify-step on etap-1/step-6 runs the mural check, never the self-attest default', async () => {
  // A missing COCREATE_SERVER_CHECKS entry does not fail loudly - it falls
  // through to "potwierdzone na Twoje slowo", which would silently turn the
  // mural step into a click. With no data repo the real check must say no.
  const { status, body } = await postJson(PORT, '/api/cocreate/verify-step', { etap: 'etap-1', step: 'step-6' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.pass, false);
});

test('POST /api/cocreate/unlock on etap-2 without a completed etap-1 answers 403', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/unlock', { etap: 'etap-2' });
  assert.strictEqual(status, 403);
  assert.strictEqual(body.error, 'locked');
  assert.notStrictEqual(status, 501);
});

test('POST /api/cocreate/unlock on etap-1 (ungated) never answers 403 for a known identity', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/unlock', { etap: 'etap-1' });
  // 200 (write succeeded), 409 (repo-missing) or 400 (no resolvable identity
  // on this machine) are all normal; only 403 or 501 would mean the
  // always-open etap-1 rule (or the wave-2 leftover) broke.
  assert.ok([200, 400, 409].includes(status), `unexpected status ${status}`);
  assert.notStrictEqual(status, 403);
  assert.notStrictEqual(status, 501);
  void body;
});

test('POST /api/cocreate/unlock with an unknown etap answers 400', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/unlock', { etap: 'etap-does-not-exist' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'bad-request');
});

test('POST /api/cocreate/verify-step with an unknown etap answers 400', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/verify-step', { etap: 'etap-99', step: 'step-1' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'bad-request');
  assert.notStrictEqual(status, 501);
});

test('POST /api/cocreate/verify-step with an unknown step answers 400', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/verify-step', { etap: 'etap-1', step: 'step-does-not-exist' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'bad-request');
  assert.notStrictEqual(status, 501);
});

test('GET /api/cocreate/modules answers 200 and degrades readably with no catalog token', async () => {
  const { status, body } = await getJson(PORT, '/api/cocreate/modules');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.entries));
  assert.strictEqual(body.catalogAvailable, false);
  assert.notStrictEqual(status, 501);
});

test('POST /api/cocreate/open-file with a key outside the closed map answers 400', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/open-file', { key: '../.env' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'bad-request');
  assert.notStrictEqual(status, 501);
});

test('POST /api/cocreate/open-file with an allowlisted key never invents a path', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/open-file', { key: 'claude-md' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.path, 'CLAUDE.md');
  assert.ok(body.uri.startsWith('vscode://file'));
});

// Both files etap-3/step-3b opens must really resolve: the step is the one
// place the course sends a person into the full rules, and open-file 404s on a
// key whose file is missing, so a renamed README would break the step silently.
test('POST /api/cocreate/open-file resolves the readme key etap-3/step-3b uses', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/open-file', { key: 'readme' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.path, 'README.md');
  assert.ok(body.uri.startsWith('vscode://file'));
});

test('POST /api/cocreate/admin/reset is off by default: 403 admin-disabled whatever the body', async () => {
  // The gate comes BEFORE body validation - a disabled route tells nothing
  // about which fields it would have wanted.
  const noUser = await postJson(PORT, '/api/cocreate/admin/reset', {});
  assert.strictEqual(noUser.status, 403);
  assert.strictEqual(noUser.body.error, 'admin-disabled');
  const withUser = await postJson(PORT, '/api/cocreate/admin/reset', { user: 'jordan-lee' });
  assert.strictEqual(withUser.status, 403);
  assert.strictEqual(withUser.body.error, 'admin-disabled');
  assert.notStrictEqual(withUser.status, 501);
});

// -- POST /api/cocreate/open-file -------------------------------------------
// The one handler in this section that turns request input into a filesystem
// path. It must resolve a KEY from a closed map and never a path from the body.

test('POST /api/cocreate/open-file resolves the repo guide etap-1/step-3 points at', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/open-file', { key: 'przewodnik-po-repo' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.path, 'docs/guides/repo-guide.md');
  assert.ok(body.uri.startsWith('vscode://file'), 'expected a vscode:// URI, got ' + body.uri);
});

test('POST /api/cocreate/open-file resolves a key from the closed map', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/open-file', { key: 'claude-md' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.path, 'CLAUDE.md');
  assert.ok(body.uri.startsWith('vscode://file'), 'expected a vscode:// URI, got ' + body.uri);
});

test('POST /api/cocreate/open-file refuses a path smuggled in as the key', async () => {
  // Every one of these is a PATH, not a key. The map lookup is what rejects
  // them - there is no path arithmetic on request input to defeat.
  const attempts = [
    '../../etc/passwd',
    '/etc/passwd',
    'CLAUDE.md',
    '.env',
    '.encryption-key',
    'modules/demo-hub/../../.env',
    '..\\..\\windows\\system32',
  ];
  for (const key of attempts) {
    const { status, body } = await postJson(PORT, '/api/cocreate/open-file', { key });
    assert.strictEqual(status, 400, 'expected 400 for key ' + JSON.stringify(key));
    assert.strictEqual(body.error, 'bad-request');
    assert.ok(!body.absPath, 'no path may leak for key ' + JSON.stringify(key));
    assert.ok(!body.uri, 'no URI may leak for key ' + JSON.stringify(key));
  }
});

test('POST /api/cocreate/open-file rejects a non-string key without throwing', async () => {
  for (const key of [null, 42, { toString: 'x' }, ['claude-md'], true]) {
    const { status, body } = await postJson(PORT, '/api/cocreate/open-file', { key });
    assert.strictEqual(status, 400, 'expected 400 for key ' + JSON.stringify(key));
    assert.strictEqual(body.error, 'bad-request');
  }
  // A missing body key at all.
  const { status } = await postJson(PORT, '/api/cocreate/open-file', {});
  assert.strictEqual(status, 400);
});

// -- POST /api/cocreate/verify-step ------------------------------------------
// The handler that mutates persisted progress. Its guards run BEFORE any write,
// so an unknown etap or step must be rejected without touching the store.

test('POST /api/cocreate/verify-step rejects an unknown etap', async () => {
  const { status, body } = await postJson(PORT, '/api/cocreate/verify-step', {
    etap: 'etap-nie-istnieje', step: 'cokolwiek',
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'bad-request');
  assert.match(body.message, /etap/i);
});

test('POST /api/cocreate/verify-step rejects an unknown step inside a real etap', async () => {
  const { body: progress } = await getJson(PORT, '/api/cocreate/progress');
  const etap = Object.keys(progress.steps || {})[0] || 'etap-1';
  const { status, body } = await postJson(PORT, '/api/cocreate/verify-step', {
    etap, step: 'krok-nie-istnieje',
  });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'bad-request');
  assert.match(body.message, /krok/i);
});

test('POST /api/cocreate/verify-step never answers 501 or 503 without a data repo', async () => {
  // The suite runs with DATA_TIER_0_DIR pointed at a directory that never
  // existed. A fresh install with no clone is a normal state: the route may
  // refuse the write (409) but must not look like an unimplemented wave-2 stub
  // or an outage.
  const { body: progress } = await getJson(PORT, '/api/cocreate/progress');
  const etap = Object.keys(progress.steps || {})[0] || 'etap-1';
  const { status } = await postJson(PORT, '/api/cocreate/verify-step', { etap, step: 'x' });
  assert.notStrictEqual(status, 501);
  assert.notStrictEqual(status, 503);
});

test('POST /api/cocreate/verify-step and open-file require a same-origin request', async () => {
  for (const route of ['/api/cocreate/verify-step', '/api/cocreate/open-file']) {
    const { status } = await postJson(PORT, route, { etap: 'x', key: 'claude-md' },
      { Origin: 'https://zly-serwis.example' });
    assert.strictEqual(status, 403, route + ' must refuse a foreign origin');
  }
});


// ── Progress per person + autopublish ────────────────────────────────────────
// A SECOND server, this one with a real (existing) data dir, so the write path
// runs for real. NODE_ENV=test is what _cocreatePushPersonFile checks first, so
// these tests also pin the property that a test run never pushes anything.

const PORT_LIVE = 3516;
const TMP_LIVE_DIR = path.join(os.tmpdir(), `cockpit-test-cocreate-live-${process.pid}`);
const TMP_LIVE_MIRROR = TMP_LIVE_DIR + '-encrypted';
let liveChild;

test.before(async () => {
  // dataTier0Exists() keys off `<mirror>/.git`, not off the plaintext tree, so a
  // usable fixture needs BOTH halves of the plaintext/encrypted split: the
  // plaintext dir the progress files live in, and an initialised mirror next to
  // it. Without the second one every write short-circuits as 'repo-missing'.
  fs.mkdirSync(TMP_LIVE_DIR, { recursive: true });
  fs.mkdirSync(path.join(TMP_LIVE_MIRROR, '.git'), { recursive: true });
  liveChild = startServer(PORT_LIVE, {
    DATA_TIER_0_GIT_DIR: TMP_LIVE_MIRROR,
    COCKPIT_DATA_TOKEN: '',
    DATA_TIER_0_REPO_URL: '',
    DATA_TIER_0_DIR: TMP_LIVE_DIR,
    AUTO_SYNC_ENABLED: '0',
    COCKPIT_MODULES_TOKEN: '',
    // The GitLab catalog source with no token: the local folder default would answer.
    MODULES_CATALOG_REPO_URL: 'https://gitlab.example.com/your-group/mission-deck-modules.git',
  });
  await waitForServer(PORT_LIVE);
});

test.after(async () => {
  await stopServer(liveChild);
  fs.rmSync(TMP_LIVE_DIR, { recursive: true, force: true });
  fs.rmSync(TMP_LIVE_MIRROR, { recursive: true, force: true });
});

const progressDir = () => path.join(TMP_LIVE_DIR, 'academy', 'progress');

test('a verified step writes ONE file named after that person, and nobody else\'s', async () => {
  const me = (await getJson(PORT_LIVE, '/api/cocreate/progress')).body.me;
  if (!me) return; // no resolvable identity on this machine - the write path is a no-op by design

  // A teammate's file that must survive untouched.
  fs.mkdirSync(progressDir(), { recursive: true });
  const foreign = path.join(progressDir(), 'jordan-lee.json');
  const foreignBody = JSON.stringify({
    version: 1, person_slug: 'jordan-lee', display_name: 'Jordan Lee',
    unlocks: { 'etap-1': '2026-01-01T00:00:00.000Z' },
    steps: { 'etap-1': { 'step-1': { checked_at: '2026-01-01T00:00:00.000Z', method: 'server' } } },
    completed: { 'etap-1': '2026-01-01T00:00:00.000Z' },
  }, null, 2);
  fs.writeFileSync(foreign, foreignBody, 'utf8');

  await postJson(PORT_LIVE, '/api/cocreate/unlock', { etap: 'etap-1' });
  const { status, body } = await postJson(PORT_LIVE, '/api/cocreate/verify-step', { etap: 'etap-1', step: 'step-2c' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.pass, true);

  assert.ok(fs.existsSync(path.join(progressDir(), me.person_slug + '.json')),
    'the caller gets a file named after their own slug');
  assert.strictEqual(fs.readFileSync(foreign, 'utf8'), foreignBody,
    'a teammate file is never rewritten by somebody else\'s step');
});

test('a test run never publishes: sync is reported and skipped', async () => {
  const me = (await getJson(PORT_LIVE, '/api/cocreate/progress')).body.me;
  if (!me) return;
  const { body } = await postJson(PORT_LIVE, '/api/cocreate/verify-step', { etap: 'etap-1', step: 'step-4' });
  assert.ok(body.sync, 'the answer carries the publish outcome');
  assert.strictEqual(body.sync.state, 'skipped');
  assert.strictEqual(body.sync.reason, 'test-mode', 'NODE_ENV=test must short-circuit before any git call');
});

test('team-wide completed aggregates other people, own steps stay projected to the caller', async () => {
  const me = (await getJson(PORT_LIVE, '/api/cocreate/progress')).body.me;
  if (!me) return;
  fs.mkdirSync(progressDir(), { recursive: true });
  fs.writeFileSync(path.join(progressDir(), 'casey-novak.json'), JSON.stringify({
    version: 1, person_slug: 'casey-novak', display_name: 'Casey Novak',
    unlocks: {}, steps: { 'etap-2': { 'step-1': { checked_at: 'x', method: 'self-attest' } } },
    completed: { 'etap-2': '2026-01-01T00:00:00.000Z' },
  }, null, 2), 'utf8');

  const { body } = await getJson(PORT_LIVE, '/api/cocreate/progress');
  const slugs = (body.completed['etap-2'] || []).map((e) => e.person_slug);
  assert.ok(slugs.includes('casey-novak'), 'another person\'s finish shows in the team-wide list');
  assert.strictEqual(body.steps['etap-2']['step-1'], false,
    'another person\'s step must never read as the caller\'s own progress');
});

// ── Mural: one file per person, in ds-data ────────────────────────────────────
// the original app kept the mural in the APP repository, so an entry needed a
// branch, a commit and a merge request. Here it is team data: the file lands in
// the plaintext ds-data tree and is published the same way a progress file is.

const muralDir = () => path.join(TMP_LIVE_DIR, 'academy', 'mural');

test('a mural entry lands in ds-data under the caller\'s own slug, never in the app repo', async () => {
  const me = (await getJson(PORT_LIVE, '/api/cocreate/mural')).body.me;
  if (!me) return; // no resolvable identity on this machine - the write path is a no-op by design

  // A teammate's entry that must survive untouched.
  fs.mkdirSync(muralDir(), { recursive: true });
  const foreign = path.join(muralDir(), 'sam-rivera.md');
  const foreignBody = '---\nauthor: Sam Rivera\nperson_slug: sam-rivera\ndate: 2026-01-01\n---\n\nMy entry.\n';
  fs.writeFileSync(foreign, foreignBody, 'utf8');

  const { status, body } = await postJson(PORT_LIVE, '/api/cocreate/mural', {
    content: '## What I learned\n\n- how the cockpit works',
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);

  const mine = path.join(muralDir(), me.person_slug + '.md');
  assert.ok(fs.existsSync(mine), 'the caller gets a file named after their own slug');
  const text = fs.readFileSync(mine, 'utf8');
  assert.match(text, /^---\n/, 'the server owns the frontmatter header');
  assert.match(text, new RegExp('person_slug: ' + me.person_slug));
  assert.match(text, /how the cockpit works/);
  assert.strictEqual(fs.readFileSync(foreign, 'utf8'), foreignBody,
    'a teammate entry is never rewritten by somebody else\'s save');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'co-create', 'mural', me.person_slug + '.md')),
    'nothing is ever written into the application repository');
});

test('a mural save never publishes under NODE_ENV=test', async () => {
  const me = (await getJson(PORT_LIVE, '/api/cocreate/mural')).body.me;
  if (!me) return;
  const { body } = await postJson(PORT_LIVE, '/api/cocreate/mural', { content: 'Drugi wpis.' });
  assert.ok(body.sync, 'the answer carries the publish outcome');
  assert.strictEqual(body.sync.state, 'skipped');
  assert.strictEqual(body.sync.reason, 'test-mode');
});

test('GET /api/cocreate/mural lists the whole team and keeps the header out of the body', async () => {
  fs.mkdirSync(muralDir(), { recursive: true });
  fs.writeFileSync(path.join(muralDir(), 'casey-novak.md'),
    '---\nauthor: Casey Novak\nperson_slug: casey-novak\ndate: 2026-02-02\n---\n\nHi, I am building a module.\n', 'utf8');

  const { status, body } = await getJson(PORT_LIVE, '/api/cocreate/mural');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.storage, 'ok');
  const casey = body.entries.find((e) => e.person_slug === 'casey-novak');
  assert.ok(casey, 'another person\'s entry shows up on the mural');
  assert.strictEqual(casey.display_name, 'Casey Novak');
  assert.strictEqual(casey.date, '2026-02-02');
  assert.strictEqual(casey.content, 'Hi, I am building a module.');
  assert.ok(!casey.content.includes('---'), 'the frontmatter never leaks into the rendered body');
});

test('an empty mural save removes the entry, and only that person\'s', async () => {
  const me = (await getJson(PORT_LIVE, '/api/cocreate/mural')).body.me;
  if (!me) return;
  const { status, body } = await postJson(PORT_LIVE, '/api/cocreate/mural', { content: '   ' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.entry, null);
  assert.ok(!fs.existsSync(path.join(muralDir(), me.person_slug + '.md')));
  assert.ok(fs.existsSync(path.join(muralDir(), 'casey-novak.md')), 'a teammate entry stays put');
});

test('POST /api/cocreate/mural requires a same-origin request', async () => {
  const { status } = await postJson(PORT_LIVE, '/api/cocreate/mural', { content: 'x' }, { Origin: 'http://evil.example' });
  assert.strictEqual(status, 403);
});

test('step-6 passes once this person has an entry and fails once it is gone', async () => {
  const me = (await getJson(PORT_LIVE, '/api/cocreate/mural')).body.me;
  if (!me) return;
  await postJson(PORT_LIVE, '/api/cocreate/mural', { content: 'Moj slad na muralu.' });
  let r = await postJson(PORT_LIVE, '/api/cocreate/verify-step', { etap: 'etap-1', step: 'step-6' });
  assert.strictEqual(r.body.pass, true, 'an entry on disk is what the step checks');
  await postJson(PORT_LIVE, '/api/cocreate/mural', { content: '' });
  r = await postJson(PORT_LIVE, '/api/cocreate/verify-step', { etap: 'etap-1', step: 'step-6' });
  assert.strictEqual(r.body.pass, false, 'somebody else\'s entry never passes this step');
});

// -- POST /api/cocreate/admin/reset with the flag ON ------------------------
// A second server: COCREATE_ADMIN_RESET=1 and a ds-data pair that EXISTS (the
// mirror only needs a .git entry for dataTier0Exists). NODE_ENV=test keeps the
// autopublish in the `skipped` state, so nothing here ever runs git.

const PORT_ADMIN = 3518; // 3516 is PORT_LIVE above and still listening when this suite starts
let adminChild;
const ADMIN_ROOT = path.join(os.tmpdir(), `cockpit-test-cocreate-admin-${process.pid}`);
const ADMIN_PLAIN = path.join(ADMIN_ROOT, 'ds-data');
const ADMIN_MIRROR = path.join(ADMIN_ROOT, 'ds-data-encrypted');
const ADMIN_PROGRESS = path.join(ADMIN_PLAIN, 'academy', 'progress');

function seedProgress(slug) {
  fs.mkdirSync(ADMIN_PROGRESS, { recursive: true });
  fs.writeFileSync(path.join(ADMIN_PROGRESS, slug + '.json'), JSON.stringify({
    version: 1,
    person_slug: slug,
    display_name: 'Jordan Lee',
    unlocks: { 'etap-1': { at: '2026-09-01T10:00:00.000Z' }, 'etap-2': { at: '2026-09-02T10:00:00.000Z' } },
    steps: { 'etap-1': { 'step-1': { at: '2026-09-01T10:05:00.000Z' } }, 'etap-2': { 'step-1': { at: '2026-09-02T10:05:00.000Z' } } },
    completed: { 'etap-1': { at: '2026-09-01T11:00:00.000Z' } },
  }, null, 2), 'utf8');
}

test.describe('admin/reset with COCREATE_ADMIN_RESET=1', () => {
  test.before(async () => {
    fs.mkdirSync(path.join(ADMIN_MIRROR, '.git'), { recursive: true });
    fs.mkdirSync(ADMIN_PLAIN, { recursive: true });
    adminChild = startServer(PORT_ADMIN, {
      COCKPIT_DATA_TOKEN: '',
      DATA_TIER_0_REPO_URL: '',
      DATA_TIER_0_DIR: ADMIN_PLAIN,
      DATA_TIER_0_GIT_DIR: ADMIN_MIRROR,
      AUTO_SYNC_ENABLED: '0',
      COCKPIT_MODULES_TOKEN: '',
      MODULES_CATALOG_REPO_URL: 'https://gitlab.example.com/your-group/mission-deck-modules.git',
    // The GitLab catalog source with no token: the local folder default would answer.
    MODULES_CATALOG_REPO_URL: 'https://gitlab.example.com/your-group/mission-deck-modules.git',
      COCREATE_ADMIN_RESET: '1',
    });
    await waitForServer(PORT_ADMIN);
  });

  test.after(async () => {
    await stopServer(adminChild);
    fs.rmSync(ADMIN_ROOT, { recursive: true, force: true });
  });

  test('without a user answers 400', async () => {
    const { status, body } = await postJson(PORT_ADMIN, '/api/cocreate/admin/reset', {});
    assert.strictEqual(status, 400, 'got ' + status + ' ' + JSON.stringify(body));
    assert.strictEqual(body.error, 'bad-request');
  });

  test('a slug that is not a person_slug answers 400 and touches no file', async () => {
    for (const user of ['../jordan', 'Jordan Lee', 'jordan_lee', '-jordan', 'jordan/lee']) {
      const { status, body } = await postJson(PORT_ADMIN, '/api/cocreate/admin/reset', { user });
      assert.strictEqual(status, 400, user + ' should be rejected');
      assert.strictEqual(body.error, 'bad-request');
    }
    assert.ok(!fs.existsSync(ADMIN_PROGRESS) || fs.readdirSync(ADMIN_PROGRESS).length === 0,
      'a rejected slug must never create a progress file');
  });

  test('resetting one etap with cascade clears it and the later ones, keeps the earlier', async () => {
    seedProgress('jordan-lee');
    const { status, body } = await postJson(PORT_ADMIN, '/api/cocreate/admin/reset', { user: 'jordan-lee', etap: 'etap-2' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.user, 'jordan-lee');
    assert.ok(body.etaps.includes('etap-2') && !body.etaps.includes('etap-1'));
    const doc = JSON.parse(fs.readFileSync(path.join(ADMIN_PROGRESS, 'jordan-lee.json'), 'utf8'));
    assert.ok(doc.unlocks['etap-1'] && doc.steps['etap-1'] && doc.completed['etap-1'], 'etap-1 survives');
    assert.strictEqual(doc.unlocks['etap-2'], undefined);
    assert.strictEqual(doc.steps['etap-2'], undefined);
  });

  test('a full reset removes the file, and in test mode nothing is published', async () => {
    seedProgress('jordan-lee');
    const { status, body } = await postJson(PORT_ADMIN, '/api/cocreate/admin/reset', { user: 'jordan-lee' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(!fs.existsSync(path.join(ADMIN_PROGRESS, 'jordan-lee.json')), 'an empty document is unlinked');
    // The fake mirror has only a .git directory: a real publish would have failed loudly.
    assert.deepStrictEqual(fs.readdirSync(ADMIN_MIRROR), ['.git']);
  });
});
