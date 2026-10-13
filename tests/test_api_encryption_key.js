'use strict';
// tests/test_api_encryption_key.js
// The two endpoints behind the onboarding wizard's key step:
//   GET  /api/settings/encryption-status  - what the client builds its form from
//   POST /api/settings/encryption-key     - one repo id per call
//
// IMPORTANT: this suite never exercises a SUCCESSFUL save. The handler writes to
// `<repo root>/.encryption-key`, and the test server runs against the real repo
// root, so a happy-path write here would rewrite the developer's own key file.
// The write itself is covered where it can be sandboxed - saveRepoKey against a
// temp dir in tests/test_crypto_sync.mjs. What is tested here is everything that
// must NOT write, plus the guarantee that the status answer carries no key
// material. Every rejection path is asserted to leave the file byte-identical.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer, waitForServer, stopServer, getJson, postJson, ROOT } = require('./_api_helper');

const PORT = 3514;
const KEY_FILE = path.join(ROOT, '.encryption-key');
let child;

/** Hash of the real key file, or null when there is none. */
function keyFileFingerprint() {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(KEY_FILE)).digest('hex');
  } catch {
    return null;
  }
}

let fingerprintBefore;
// An empty sub-repos directory, so an EK source cloned on the developer's
// machine can never reach the generate handler's fetch.
const SUB_REPOS = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-enckey-'));

test.before(async () => {
  fingerprintBefore = keyFileFingerprint();
  child = startServer(PORT, { DATA_SUB_REPOS_DIR: SUB_REPOS });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(SUB_REPOS, { recursive: true, force: true });
  assert.strictEqual(keyFileFingerprint(), fingerprintBefore,
    'the suite must not change the .encryption-key file');
});

test('GET /api/settings/encryption-status describes every encrypted repo', async () => {
  const { status, body } = await getJson(PORT, '/api/settings/encryption-status');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.repos), 'repos must be an array');
  assert.ok(body.repos.length > 0, 'expected at least the team data repo');
  for (const r of body.repos) {
    assert.strictEqual(typeof r.id, 'string');
    assert.strictEqual(typeof r.label, 'string');
    assert.strictEqual(typeof r.keyPresent, 'boolean');
    assert.strictEqual(typeof r.hasOwnKey, 'boolean');
    // The wizard lists only the rows whose GitLab token the vault loaded and
    // needs to name the missing entry; both facts come from the server.
    assert.strictEqual(typeof r.hasToken, 'boolean');
    assert.strictEqual(typeof r.tokenEnvVar, 'string');
    // Offered only for a cloned, key-less, empty EK source / a source with an
    // own line that can go on the clipboard.
    assert.strictEqual(typeof r.keyGeneratable, 'boolean');
    assert.strictEqual(typeof r.keyCopyable, 'boolean');
  }
  assert.strictEqual(typeof body.keyPresent, 'boolean');
  assert.strictEqual(typeof body.bitwardenLocked, 'boolean');
  assert.ok(body.keySource === null || ['env', 'file'].includes(body.keySource));
});

test('the status answer never carries key material', async () => {
  // The whole point of the endpoint: the client learns WHETHER a key is there,
  // never WHAT it is. Asserted on the serialized payload so a key smuggled in
  // under any field name is caught, not just the ones this test knows about.
  const { body } = await getJson(PORT, '/api/settings/encryption-status');
  const raw = JSON.stringify(body);
  let realKeys = [];
  try {
    realKeys = fs.readFileSync(KEY_FILE, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => (l.includes('=') ? l.slice(l.indexOf('=') + 1).trim() : l))
      .filter(Boolean);
  } catch { /* no key file on this machine - the assertion below is then vacuous */ }
  for (const key of realKeys) {
    assert.ok(!raw.includes(key), 'payload zawiera material klucza');
  }
  // A 32-byte base64 value is 44 chars; nothing that long should appear at all.
  assert.ok(!/[A-Za-z0-9+/]{40,}={0,2}/.test(raw), 'payload zawiera dlugi ciag base64');
});

test('repos[].id is the allowed-id list and matches the crypto layer', async () => {
  // The client renders its form from these ids and validates against them, so
  // they must be exactly what saveRepoKey will accept. A drift here is what
  // silently dropped seven present keys before.
  const { body } = await getJson(PORT, '/api/settings/encryption-status');
  const known = require(path.join(ROOT, 'scripts', 'crypto-sync.js')).KNOWN_REPO_IDS;
  for (const r of body.repos) {
    assert.ok(known.has(r.id), 'repo id ' + r.id + ' is not known to crypto-sync');
  }
  assert.ok(body.repos.some(r => r.id === 'ds-data'), 'no ds-data row');
});

test('POST /api/settings/encryption-key rejects an unknown repo id without writing', async () => {
  const before = keyFileFingerprint();
  const { status, body } = await postJson(PORT, '/api/settings/encryption-key', {
    repoId: '../../etc/passwd', key: 'a'.repeat(44),
  });
  // 200 with ok:false, not a 4xx: the client renders one row per pasted line and
  // a rejected line is a normal outcome of that form.
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'unknown-repo');
  assert.strictEqual(keyFileFingerprint(), before, 'a rejected repoId must not write');
});

test('POST /api/settings/encryption-key rejects a key of the wrong length', async () => {
  const before = keyFileFingerprint();
  const { status, body } = await postJson(PORT, '/api/settings/encryption-key', {
    repoId: 'ds-data', key: 'abc',
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'key-invalid');
  assert.strictEqual(keyFileFingerprint(), before, 'a bad key must not write');
});

test('POST /api/settings/encryption-key rejects an empty body without writing', async () => {
  const before = keyFileFingerprint();
  const { status, body } = await postJson(PORT, '/api/settings/encryption-key', {});
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(keyFileFingerprint(), before, 'an empty request must not write');
});

test('POST /api/settings/encryption-key/generate refuses unknown and shared sources without writing or leaking a key', async () => {
  const before = keyFileFingerprint();
  const answers = [];
  for (const repoId of ['nope', 'ds-data']) {
    const { status, body } = await postJson(PORT, '/api/settings/encryption-key/generate', { repoId });
    assert.strictEqual(status, 200, repoId);
    assert.strictEqual(body.ok, false, repoId);
    answers.push(body);
  }
  assert.strictEqual(answers[0].error, 'unknown-repo');
  assert.strictEqual(answers[1].error, 'not-generatable');
  assert.strictEqual(keyFileFingerprint(), before, 'a rejected generation must not write');
  assert.ok(!/[A-Za-z0-9+/]{40,}={0,2}/.test(JSON.stringify(answers)), 'odpowiedz zawiera dlugi ciag base64');
});

test('POST /api/settings/encryption-key/export refuses unknown and shared ids', async () => {
  const before = keyFileFingerprint();
  const unknown = await postJson(PORT, '/api/settings/encryption-key/export', { repoId: 'nope' });
  assert.strictEqual(unknown.body.ok, false);
  assert.strictEqual(unknown.body.error, 'unknown-repo');
  const shared = await postJson(PORT, '/api/settings/encryption-key/export', { repoId: 'ds-data' });
  assert.strictEqual(shared.body.ok, false);
  assert.strictEqual(shared.body.error, 'not-generatable');
  assert.ok(!/[A-Za-z0-9+/]{40,}={0,2}/.test(JSON.stringify([unknown.body, shared.body])));
  assert.strictEqual(keyFileFingerprint(), before);
});
