'use strict';
// tests/test_api_app_stash.js
// The four routes behind the top-bar "Stash" pill:
//   GET  /api/app/stash          - every entry, no file lists
//   GET  /api/app/stash/files    - the files of one entry
//   POST /api/app/stash/apply    - git stash apply (never pop)
//   POST /api/app/stash/drop     - git stash drop
//
// IMPORTANT: this suite never exercises a SUCCESSFUL apply or drop. Both
// handlers operate on ROOT, and the test server runs against the real repo
// root, so a happy path here would put somebody's stash into their working
// tree or delete it. That is exactly why both refuse under IS_TEST_MODE - and
// asserting THAT refusal is the most valuable thing this file can do. The git
// behaviour itself is covered against throwaway repositories in
// tests/test_stash_api_helpers.mjs, where `root` is injected.
//
// Same reasoning the header of tests/test_api_encryption_key.js states, and
// the same reason CLAUDE.md gives for there being no API test on
// POST /api/app/update at all.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const { startServer, waitForServer, stopServer, getJson, postJson, ROOT } = require('./_api_helper');

const PORT = 3526;
let child;

/** The stash list as git itself reports it, so a test can prove nothing moved. */
function stashListRaw() {
  try {
    return execFileSync('git', ['-C', ROOT, 'stash', 'list', '--format=%H'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

let listBefore;

test.before(async () => {
  listBefore = stashListRaw();
  child = startServer(PORT);
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child, PORT);
  assert.strictEqual(stashListRaw(), listBefore, 'the suite must leave the real stash untouched');
});

test('GET /api/app/stash answers 200 with an entry list, whatever this machine holds', async () => {
  const { status, body } = await getJson(PORT, '/api/app/stash');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(Array.isArray(body.entries));
  // Shape, never content: a developer's own stash is whatever it is.
  for (const e of body.entries) {
    assert.match(e.sha, /^[0-9a-f]{40}$/);
    assert.match(e.ref, /^stash@\{\d+\}$/);
    assert.strictEqual(typeof e.message, 'string');
    assert.strictEqual(typeof e.cockpit, 'boolean');
    assert.ok(!('files' in e), 'the list must not carry file lists - that is a second route');
  }
});

test('GET /api/app/stash/files refuses anything that is not a sha, and says so', async () => {
  for (const bad of ['', 'stash@{0}', 'HEAD', '../../etc/passwd', 'zz']) {
    const { status, body } = await getJson(PORT, `/api/app/stash/files?sha=${encodeURIComponent(bad)}`);
    assert.strictEqual(status, 200, `sha=${bad}`);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, 'bad-sha');
    assert.deepStrictEqual(body.files, []);
  }
});

test('GET /api/app/stash/files on a well-formed sha that is not on the stash answers stash-gone', async () => {
  const { status, body } = await getJson(PORT, `/api/app/stash/files?sha=${'e'.repeat(40)}`);
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'stash-gone');
});

test('POST /api/app/stash/apply refuses under IS_TEST_MODE before it can touch the tree', async () => {
  const { status, body } = await postJson(PORT, '/api/app/stash/apply', { sha: 'f'.repeat(40) });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'test-mode');
  assert.match(body.message, /test mode/);
});

test('POST /api/app/stash/drop refuses under IS_TEST_MODE too', async () => {
  const { status, body } = await postJson(PORT, '/api/app/stash/drop', { sha: 'f'.repeat(40) });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'test-mode');
});

test('both writes refuse a request that is not application/json', async () => {
  for (const path of ['/api/app/stash/apply', '/api/app/stash/drop']) {
    const { status } = await postJson(PORT, path, { sha: 'f'.repeat(40) }, { 'Content-Type': 'text/plain' });
    assert.strictEqual(status, 415, path);
  }
});
