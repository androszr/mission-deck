'use strict';
// tests/test_api_prototypes.js
// Stage 1 of the prototypes migration: the read routes under /api/prototypes/*.
// One private data tree injected through DATA_SUB_REPOS_DIR (the pattern of
// tests/test_api_data_repos.js:36, tests/test_api_data_decrypt.js:78), so the
// suite is green on a machine without a clone of the team data too.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { startServer, waitForServer, stopServer, getJson, postJson, apiUrl } = require('./_api_helper');

// _api_helper.js only carries getJson/postJson (see the block comment atop
// that file) - PUT and DELETE go through fetch() directly, same as the style
// and asset GET cases above already do for non-JSON responses.
async function putJson(port, p, payload, extraHeaders) {
  const r = await fetch(apiUrl(port, p), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(payload === undefined ? {} : payload),
    signal: AbortSignal.timeout(20000),
  });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  return { status: r.status, body };
}

async function deleteJson(port, p, extraHeaders) {
  const r = await fetch(apiUrl(port, p), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    signal: AbortSignal.timeout(20000),
  });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  return { status: r.status, body };
}

function _rawPrototypesJson() {
  return JSON.parse(fs.readFileSync(path.join(PROTOTYPES_DIR, 'prototypes.json'), 'utf8'));
}

const PORT = 3560;
let child;

const TMP_SUB_REPOS_DIR = path.join(os.tmpdir(), `cockpit-test-prototypes-${process.pid}`);
const PRODUCT_DIR = path.join(TMP_SUB_REPOS_DIR, 'ds-data');
const PROTOTYPES_DIR = path.join(PRODUCT_DIR, 'prototypes');
const PROTO_ID = 'proto-test1234';
const PROTO_DIR = path.join(PROTOTYPES_DIR, PROTO_ID);
const DISCOVERY_DIR = path.join(PRODUCT_DIR, 'discovery-tasks');

test.before(async () => {
  fs.mkdirSync(path.join(PROTO_DIR, 'assets'), { recursive: true });
  // Discovery cards: one referenced by the prototype (it must resolve) and one
  // nobody uses (it must never reach the answer - the route reads only the
  // ids present in prototypes.json).
  fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
  fs.writeFileSync(path.join(DISCOVERY_DIR, 'dt-aaaa1111.json'), JSON.stringify({ id: 'dt-aaaa1111', title: 'Test initiative' }));
  fs.writeFileSync(path.join(DISCOVERY_DIR, 'dt-bbbb2222.json'), JSON.stringify({ id: 'dt-bbbb2222', title: 'Unused' }));
  fs.writeFileSync(path.join(PROTOTYPES_DIR, 'prototypes.json'), JSON.stringify({
    items: [
      { id: PROTO_ID, name: 'Test prototype', created_at: '2026-01-01T00:00:00.000Z', area: 'cs', owners: [], discoveryTaskId: 'dt-aaaa1111' },
    ],
  }));
  fs.writeFileSync(path.join(PROTO_DIR, 'index.tsx'), 'export default function P() { return null; }');
  fs.writeFileSync(path.join(PROTO_DIR, 'spec.json'), JSON.stringify({ scope: ['a', 'b'] }));
  fs.writeFileSync(path.join(PROTO_DIR, 'compliance.json'), JSON.stringify({ requirements: [] }));
  fs.writeFileSync(path.join(PROTO_DIR, 'assets', 'shot-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(PROTO_DIR, 'styles.css'), '.proto-test { color: red; }');

  child = startServer(PORT, {
    DATA_SUB_REPOS_DIR: TMP_SUB_REPOS_DIR,
    DATA_TIER_0_DIR: path.join(TMP_SUB_REPOS_DIR, 'ds-data'),
    AUTO_SYNC_ENABLED: '0',
    // Publishing deliberately unconfigured: otherwise deploy-status would
    // depend on the .env of whoever runs the suite.
    PROTO_BUILD_REPO_URL: '',
    PROTO_PAGES_BASE_URL: '',
    PROTO_DEPLOY_TOKEN: '',
  });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(TMP_SUB_REPOS_DIR, { recursive: true, force: true });
});

test('GET /api/prototypes returns the seeded item with format computed at read time', async () => {
  const { status, body } = await getJson(PORT, '/api/prototypes');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.items.length, 1);
  assert.strictEqual(body.items[0].id, PROTO_ID);
  assert.strictEqual(body.items[0].format, 'react');
});

test('GET /api/prototypes/spec/<id> returns spec.json content', async () => {
  const { status, body } = await getJson(PORT, `/api/prototypes/spec/${PROTO_ID}`);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.scope, ['a', 'b']);
});

// There is no compliance review (a product decision).
// A compliance.json file may sit in the team data - the seed above creates one - and
// it must be IGNORED: there is no read route, and a request for it ends in 404.
test('GET /api/prototypes/compliance/<id> is not served - the compliance tab was not migrated', async () => {
  const { status } = await getJson(PORT, `/api/prototypes/compliance/${PROTO_ID}`);
  assert.strictEqual(status, 404);
});

// The initiative name instead of the dt-* id. The route reads ONLY the cards
// the registry points at - hence a second, unused file in the seed.
test('GET /api/prototypes/initiatives maps only the referenced discovery ids to titles', async () => {
  const { status, body } = await getJson(PORT, '/api/prototypes/initiatives');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.map['dt-aaaa1111'], 'Test initiative');
  assert.strictEqual(Object.keys(body.map).length, 1);
});

test('GET /api/prototypes/style/<id> serves the prototype own stylesheet', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/prototypes/style/${PROTO_ID}`, { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'text/css');
  const text = await r.text();
  assert.ok(text.includes('.proto-test'));
});

test('GET /api/prototypes/code/<id> answers 404 for a react-format prototype (no render.js)', async () => {
  const { status, body } = await getJson(PORT, `/api/prototypes/code/${PROTO_ID}`);
  assert.strictEqual(status, 404);
  assert.strictEqual(body._missing, true);
});

test('GET /api/prototypes/asset/<id>/<file> serves the binary asset', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/prototypes/asset/${PROTO_ID}/shot-1.png`, { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.strictEqual(buf.length, 4);
});

test('GET /api/prototypes/ds-icon/<slug> serves a known icon of the set', async () => {
  const catalogRaw = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icons', 'ds', 'manifest.json'), 'utf8');
  const catalog = JSON.parse(catalogRaw);
  const firstSlug = catalog.icons[0].slug;
  const r = await fetch(`http://127.0.0.1:${PORT}/api/prototypes/ds-icon/${firstSlug}`, { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/svg+xml');
});

test('GET /api/prototypes/ds-illustration/<slug> serves a known illustration (mascot pose)', async () => {
  const catalogRaw = fs.readFileSync(path.join(__dirname, '..', 'assets', 'mascot', 'manifest.json'), 'utf8');
  const catalog = JSON.parse(catalogRaw);
  const firstSlug = catalog.poses[0].file.replace(/\.svg$/, '');
  const r = await fetch(`http://127.0.0.1:${PORT}/api/prototypes/ds-illustration/${firstSlug}`, { signal: AbortSignal.timeout(20000) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/svg+xml');
});

// `enabled` is about publishing and depends ONLY on PROTO_BUILD_REPO_URL,
// which this suite leaves empty - `canBuild` is a separate answer, because
// the local preview works without any remote (the seed in templates/).
test('GET /api/prototypes/deploy-status answers enabled:false without a publishing remote', async () => {
  const { status, body } = await getJson(PORT, '/api/prototypes/deploy-status');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.enabled, false);
  assert.strictEqual(body.hasToken, false);
  assert.strictEqual(typeof body.cloned, 'boolean');
  assert.strictEqual(typeof body.canBuild, 'boolean');
  assert.strictEqual(body.baseUrl, '', 'the pages URL is env-only');
});

// IS_TEST_MODE must cut off both routes that run npm, git or Vite:
// the API suite walks the tree of whoever runs it.
test('POST /api/prototypes/local-preview/<id> is refused under IS_TEST_MODE', async () => {
  const { status, body } = await postJson(PORT, `/api/prototypes/local-preview/${PROTO_ID}`, {});
  assert.strictEqual(status, 503);
  assert.ok(String(body.message || '').length > 0);
  // The refusal is the test-mode gate, reached BEFORE anything that runs npm:
  // never the deps-missing branch (that one is driven at function level in
  // tests/test_proto_shell_upkeep.mjs, because the gate makes it unreachable here).
  assert.match(body.message, /test mode/);
  assert.notStrictEqual(body.error, 'deps-missing');
});

test('GET /api/prototypes/deploy-stream answers an SSE error event under IS_TEST_MODE', async () => {
  const r = await fetch(apiUrl(PORT, `/api/prototypes/deploy-stream?id=${PROTO_ID}`), {
    headers: { Accept: 'text/event-stream' },
    signal: AbortSignal.timeout(20000),
  });
  assert.strictEqual(r.status, 200, 'the stream always comes up - the error rides as an event, not an HTTP code');
  assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
  const text = await r.text();
  assert.match(text, /event: error/);
  assert.match(text, /test-mode/);
});

test('GET /api/prototypes/spec/<id outside PROTO_ID_RE> is refused', async () => {
  const { status } = await getJson(PORT, '/api/prototypes/spec/../secrets');
  assert.notStrictEqual(status, 200);
});

test('GET /api/prototypes/asset/<id>/<escaping filename> is refused', async () => {
  const { status } = await getJson(PORT, `/api/prototypes/asset/${PROTO_ID}/..%2f..%2fserver.js`);
  assert.notStrictEqual(status, 200);
});

// -- Stage 2: write routes -----------------------------------------------------

test('POST /api/prototypes creates an entry with a server-generated id and stamps, format never persisted', async () => {
  const { status, body } = await postJson(PORT, '/api/prototypes', { name: 'New prototype', area: 'idp', owners: ['Alex Morgan'] });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'added');
  assert.match(body.item.id, /^proto-[a-f0-9]{12}$/);
  assert.strictEqual(body.item.name, 'New prototype');
  assert.strictEqual(typeof body.item.created_at, 'string');
  assert.strictEqual(body.item.created_at, body.item.updated_at);
  // format comes back in the answer (computed at read time) ...
  assert.strictEqual(typeof body.item.format, 'string');

  // ... but is NEVER written to prototypes.json.
  const onDisk = _rawPrototypesJson();
  const stored = onDisk.items.find((it) => it.id === body.item.id);
  assert.ok(stored, 'the new entry must be in prototypes.json');
  assert.strictEqual(stored.format, undefined);
  assert.strictEqual(stored.created_at, stored.updated_at);
});

test('POST /api/prototypes refuses a missing name', async () => {
  const { status, body } = await postJson(PORT, '/api/prototypes', { area: 'idp' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.error, 'name-required');
});

// -- The React starter in POST ----------------------------------------------
// This block uses the REAL templates/prototype/starter/ (the test server does
// not override PROTOTYPE_STARTER_DIR) - the same source production copies.

test('POST /api/prototypes copies the React starter atomically: index.tsx, styles.css, spec.json', async () => {
  const { status, body } = await postJson(PORT, '/api/prototypes', { name: 'Test starter' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.starter, 'copied');
  assert.strictEqual(body.item.format, 'react');

  const dir = path.join(PROTOTYPES_DIR, body.item.id);
  const indexTsx = fs.readFileSync(path.join(dir, 'index.tsx'), 'utf8');
  assert.ok(!indexTsx.includes('{{PROTO_NAME_JSON}}'), 'the token must be substituted');
  assert.ok(indexTsx.includes(JSON.stringify('Test starter')), 'the name goes in as a JSON literal');
  assert.ok(indexTsx.includes('export default'));
  assert.ok(fs.existsSync(path.join(dir, 'styles.css')));
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'spec.json'), 'utf8'));
  assert.strictEqual(typeof spec.summary, 'string');
  assert.ok(spec.summary.includes('Test starter'));
  assert.ok(Array.isArray(spec.scope) && spec.scope.length > 0);
  // scripts/check-proto-ds.js (a deterministic gate)
  // BLOCKS every React prototype whose spec.json has no `customElements`
  // array - today's starter has no CUSTOM marker in styles.css, so this must
  // be a real, empty array.
  assert.ok(Array.isArray(spec.customElements));
  assert.deepStrictEqual(spec.customElements, []);

  // The registry holds none of these files as entry fields - format and spec
  // stay computed/read separately.
  const stored = _rawPrototypesJson().items.find((it) => it.id === body.item.id);
  assert.strictEqual(stored.format, undefined);
});

test('POST /api/prototypes embeds an apostrophe/quote/newline/accented name safely via JSON.stringify, never raw substitution', async () => {
  const cases = [
    "Till with an apostrophe O'Brien",
    'A name with a "quote" inside',
    'Several\nlines\nof text',
    'Back-office screen: rounding, loading and error - ąćęłńóśźż',
  ];
  for (const name of cases) {
    const { status, body } = await postJson(PORT, '/api/prototypes', { name });
    assert.strictEqual(status, 200, name);
    const dir = path.join(PROTOTYPES_DIR, body.item.id);
    const indexTsx = fs.readFileSync(path.join(dir, 'index.tsx'), 'utf8');
    const m = /const PROTOTYPE_NAME = (.*);/.exec(indexTsx);
    assert.ok(m, `the name literal must be present for: ${name}`);
    // The inverse of JSON.stringify must give EXACTLY the original name - the
    // only proof the substitution went through JSON.stringify and not through
    // hand-escaping of quotes.
    assert.strictEqual(JSON.parse(m[1]), name, name);
  }
});

test('POST /api/prototypes assigns a fresh id even when a same-named orphan directory already exists on disk', async () => {
  // A directory without a matching registry entry (left over from an interrupted
  // write of an older handler version) - the new id MUST avoid it.
  const orphanId = 'proto-orphan000001';
  fs.mkdirSync(path.join(PROTOTYPES_DIR, orphanId), { recursive: true });
  try {
    const { status, body } = await postJson(PORT, '/api/prototypes', { name: 'After an orphaned directory' });
    assert.strictEqual(status, 200);
    assert.notStrictEqual(body.item.id, orphanId);
  } finally {
    fs.rmSync(path.join(PROTOTYPES_DIR, orphanId), { recursive: true, force: true });
  }
});

// -- The registry write fails AFTER a successful starter staging: the staged
// -- directory must be rolled back, never left as an orphan without an entry.
// -- Fixture: prototypes.json marked immutable (chflags uchg on macOS/BSD) -
// -- rename tmp -> prototypes.json fails with EPERM, although the directory is
// -- still writable (staging passes normally). The test skips itself when
// -- `chflags` does not exist (non-BSD hosts).
test('POST /api/prototypes rolls back the staged starter directory when the registry write itself fails', async (t) => {
  const registryPath = path.join(PROTOTYPES_DIR, 'prototypes.json');
  const registryBefore = fs.readFileSync(registryPath, 'utf8');
  try {
    cp.execFileSync('chflags', ['uchg', registryPath]);
  } catch {
    t.skip('chflags not available on this host - the fixture needs macOS/BSD');
    return;
  }
  try {
    const dirsBefore = fs.readdirSync(PROTOTYPES_DIR).filter((f) => f.startsWith('proto-'));
    const { status, body } = await postJson(PORT, '/api/prototypes', { name: 'Unwritable registry' });
    assert.strictEqual(status, 500);
    assert.strictEqual(body.error, 'write-failed');

    // The starter staging had to pass (the directory is writable), but after the
    // registry write failed there MUST NOT be an orphaned directory without an entry.
    const dirsAfter = fs.readdirSync(PROTOTYPES_DIR).filter((f) => f.startsWith('proto-'));
    assert.deepStrictEqual(dirsAfter, dirsBefore, 'no new prototype directory may survive the failed write');

    // The file is immutable (uchg), so the content MUST be byte for byte what
    // it was before the attempt - not just the same number of entries.
    assert.strictEqual(fs.readFileSync(registryPath, 'utf8'), registryBefore, 'the registry stays exactly as it was before the attempt');
  } finally {
    cp.execFileSync('chflags', ['nouchg', registryPath]);
  }
});

test('PUT /api/prototypes/<id> merges over the existing entry: area and discoveryTaskId survive an update that only touches name', async () => {
  const before = _rawPrototypesJson().items.find((it) => it.id === PROTO_ID);
  assert.strictEqual(before.area, 'cs');
  assert.strictEqual(before.discoveryTaskId, 'dt-aaaa1111');

  const { status, body } = await putJson(PORT, `/api/prototypes/${PROTO_ID}`, { name: 'Name after edit' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'updated');
  assert.strictEqual(body.item.name, 'Name after edit');
  // The plan's criterion: area and discoveryTaskId survive BYTE-IDENTICAL.
  assert.strictEqual(body.item.area, before.area);
  assert.strictEqual(body.item.discoveryTaskId, before.discoveryTaskId);
  assert.strictEqual(body.item.created_at, before.created_at);
  assert.notStrictEqual(body.item.updated_at, before.updated_at);

  const after = _rawPrototypesJson().items.find((it) => it.id === PROTO_ID);
  assert.strictEqual(after.area, before.area);
  assert.strictEqual(after.discoveryTaskId, before.discoveryTaskId);
  assert.strictEqual(after.created_at, before.created_at);
  assert.strictEqual(after.name, 'Name after edit');
  assert.strictEqual(after.format, undefined);
});

test('PUT /api/prototypes/<id outside PROTO_ID_RE> is refused', async () => {
  const { status } = await putJson(PORT, '/api/prototypes/..%2fsecrets', { name: 'x' });
  assert.notStrictEqual(status, 200);
});

test('POST /api/prototypes with a forbidden Origin is refused', async () => {
  const { status } = await postJson(PORT, '/api/prototypes', { name: 'x' }, { Origin: 'https://evil.example' });
  assert.strictEqual(status, 403);
});

test('POST /api/prototypes with a null or array JSON body is refused cleanly, never throws on body.name', async () => {
  for (const payload of [null, [1, 2, 3], 'a string', 42]) {
    const { status, body } = await postJson(PORT, '/api/prototypes', payload);
    assert.strictEqual(status, 400, JSON.stringify(payload));
    assert.strictEqual(body.error, 'name-required', JSON.stringify(payload));
  }
});

test('PUT /api/prototypes/<id> with a null or array JSON body leaves the entry untouched (no fields to merge)', async () => {
  const before = _rawPrototypesJson().items.find((it) => it.id === PROTO_ID);
  for (const payload of [null, [1, 2, 3]]) {
    const { status, body } = await putJson(PORT, `/api/prototypes/${PROTO_ID}`, payload);
    assert.strictEqual(status, 200, JSON.stringify(payload));
    assert.strictEqual(body.item.name, before.name);
  }
});

test('DELETE /api/prototypes/<id> removes the registry entry AND the prototype directory', async () => {
  const created = await postJson(PORT, '/api/prototypes', { name: 'To be deleted' });
  assert.strictEqual(created.status, 200);
  const doomedId = created.body.item.id;
  const doomedDir = path.join(PROTOTYPES_DIR, doomedId);
  fs.mkdirSync(doomedDir, { recursive: true });
  fs.writeFileSync(path.join(doomedDir, 'index.tsx'), 'export default function P() { return null; }');
  assert.ok(fs.existsSync(doomedDir));

  const { status, body } = await deleteJson(PORT, `/api/prototypes/${doomedId}`);
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'deleted');

  const after = _rawPrototypesJson();
  assert.ok(!after.items.some((it) => it.id === doomedId));
  assert.strictEqual(fs.existsSync(doomedDir), false);
});

test('DELETE /api/prototypes/<id> answers 404 for an id that is not registered', async () => {
  const { status } = await deleteJson(PORT, '/api/prototypes/proto-does-not-exist');
  assert.strictEqual(status, 404);
});

// -- Starter absent: POST refuses hard, NO compatibility fallback -----------
// A dedicated server pointing PROTOTYPE_STARTER_DIR at an empty directory -
// templates/prototype/starter/ is a fixed contract now, so its absence at POST
// is a 500 error, never a silent success without files. A GET of existing,
// older metadata entries without sources still reads format:'missing' - that
// is another test (see the main suite of test_api_prototypes, "format
// computed at read time", and test_proto_build.mjs).

const PORT_NO_STARTER = 3561;
let childNoStarter;
const TMP_NO_STARTER_DIR = path.join(os.tmpdir(), `cockpit-test-proto-no-starter-${process.pid}`);
const NO_STARTER_PRODUCT_DIR = path.join(TMP_NO_STARTER_DIR, 'ds-data');
const NO_STARTER_PROTOTYPES_DIR = path.join(NO_STARTER_PRODUCT_DIR, 'prototypes');
const EMPTY_STARTER_TEMPLATE_DIR = path.join(TMP_NO_STARTER_DIR, 'empty-starter-template');

test.before(async () => {
  fs.mkdirSync(NO_STARTER_PROTOTYPES_DIR, { recursive: true });
  fs.mkdirSync(EMPTY_STARTER_TEMPLATE_DIR, { recursive: true }); // no index.tsx inside
  childNoStarter = startServer(PORT_NO_STARTER, {
    DATA_SUB_REPOS_DIR: TMP_NO_STARTER_DIR,
    DATA_TIER_0_DIR: path.join(TMP_NO_STARTER_DIR, 'ds-data'),
    AUTO_SYNC_ENABLED: '0',
    PROTO_BUILD_REPO_URL: '',
    PROTOTYPE_STARTER_DIR: EMPTY_STARTER_TEMPLATE_DIR,
  });
  await waitForServer(PORT_NO_STARTER);
});

test.after(async () => {
  await stopServer(childNoStarter);
  fs.rmSync(TMP_NO_STARTER_DIR, { recursive: true, force: true });
});

test('POST /api/prototypes without a starter template refuses 500 starter-copy-failed, registry and disk stay untouched', async () => {
  const { status, body } = await postJson(PORT_NO_STARTER, '/api/prototypes', { name: 'No template' });
  assert.strictEqual(status, 500);
  assert.strictEqual(body.error, 'starter-copy-failed');
  assert.match(body.message, /index\.tsx/);

  // The registry was NEVER touched - staging failed before any write, so
  // prototypes.json may not even exist on disk yet (this test directory had
  // no successful write before).
  const registryPath = path.join(NO_STARTER_PROTOTYPES_DIR, 'prototypes.json');
  const registry = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf8')) : { items: [] };
  assert.strictEqual(registry.items.length, 0, 'a missing template creates no registry entry');

  const listed = await getJson(PORT_NO_STARTER, '/api/prototypes');
  assert.strictEqual(listed.body.items.length, 0);

  const entries = fs.readdirSync(NO_STARTER_PROTOTYPES_DIR).filter((f) => f !== 'prototypes.json');
  assert.deepStrictEqual(entries, [], 'a missing template leaves no directory (not even an orphan)');
});

test('POST /api/prototypes with a starter template missing only styles.css also refuses 500, not a silent empty CSS', async () => {
  const noCssDir = path.join(TMP_NO_STARTER_DIR, 'no-css-starter-template');
  fs.mkdirSync(noCssDir, { recursive: true });
  fs.writeFileSync(path.join(noCssDir, 'index.tsx'), 'export default function P() { return null }\n');
  // Deliberately NO styles.css.
  const port = 3564;
  const child = startServer(port, {
    DATA_SUB_REPOS_DIR: TMP_NO_STARTER_DIR,
    DATA_TIER_0_DIR: path.join(TMP_NO_STARTER_DIR, 'ds-data'),
    AUTO_SYNC_ENABLED: '0',
    PROTO_BUILD_REPO_URL: '',
    PROTOTYPE_STARTER_DIR: noCssDir,
  });
  try {
    await waitForServer(port);
    const { status, body } = await postJson(port, '/api/prototypes', { name: 'Bez CSS' });
    assert.strictEqual(status, 500);
    assert.strictEqual(body.error, 'starter-copy-failed');
    assert.match(body.message, /styles\.css/);
  } finally {
    await stopServer(child);
    fs.rmSync(noCssDir, { recursive: true, force: true });
  }
});

// -- A metadata entry without sources (an older record from before the starter,
// -- or one created another way) - GET still returns format:'missing',
// -- explicitly, never guessing 'vanilla'. That is the only legal way to get
// -- format:'missing' after this change - POST no longer produces it.
test('GET /api/prototypes reads format:missing for a registry entry with no index.tsx/render.js on disk', async () => {
  const dirlessId = 'proto-nosrc0001';
  const registryPath = path.join(NO_STARTER_PROTOTYPES_DIR, 'prototypes.json');
  // prototypes.json may not exist yet (no POST in this file has managed to write
  // it so far - that is the point of the previous two tests), so we start
  // from an empty registry instead of assuming an existing file.
  const before = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf8')) : { items: [] };
  before.items.push({ id: dirlessId, name: 'Record without sources', created_at: '2026-01-01T00:00:00.000Z', area: '', owners: [] });
  fs.writeFileSync(registryPath, JSON.stringify(before, null, 2));
  // Deliberately NO proto-nosrc0001/ directory on disk - the format must come
  // out 'missing', never by guessing the default 'vanilla'.

  const { status, body } = await getJson(PORT_NO_STARTER, '/api/prototypes');
  assert.strictEqual(status, 200);
  const found = body.items.find((it) => it.id === dirlessId);
  assert.ok(found, 'the registry entry must be visible despite missing source files');
  assert.strictEqual(found.format, 'missing');
});

// -- A starter template with a forbidden import: the copy refuses, the -------
// -- registry sees no entry without sources (no "added" without files) -------

const PORT_BAD_STARTER = 3562;
let childBadStarter;
const TMP_BAD_STARTER_DIR = path.join(os.tmpdir(), `cockpit-test-proto-bad-starter-${process.pid}`);
const BAD_STARTER_PRODUCT_DIR = path.join(TMP_BAD_STARTER_DIR, 'ds-data');
const BAD_STARTER_PROTOTYPES_DIR = path.join(BAD_STARTER_PRODUCT_DIR, 'prototypes');
const BAD_STARTER_TEMPLATE_DIR = path.join(TMP_BAD_STARTER_DIR, 'bad-starter-template');

test.before(async () => {
  fs.mkdirSync(BAD_STARTER_PROTOTYPES_DIR, { recursive: true });
  fs.mkdirSync(BAD_STARTER_TEMPLATE_DIR, { recursive: true });
  // An import outside the allowlist (_protoValidateTsx) - the copy must refuse.
  fs.writeFileSync(
    path.join(BAD_STARTER_TEMPLATE_DIR, 'index.tsx'),
    "import lodash from 'lodash';\nconst PROTOTYPE_NAME = {{PROTO_NAME_JSON}};\nexport default function P() { return null }\n",
  );
  fs.writeFileSync(path.join(BAD_STARTER_TEMPLATE_DIR, 'styles.css'), '.x { color: red; }');
  childBadStarter = startServer(PORT_BAD_STARTER, {
    DATA_SUB_REPOS_DIR: TMP_BAD_STARTER_DIR,
    DATA_TIER_0_DIR: path.join(TMP_BAD_STARTER_DIR, 'ds-data'),
    AUTO_SYNC_ENABLED: '0',
    PROTO_BUILD_REPO_URL: '',
    PROTOTYPE_STARTER_DIR: BAD_STARTER_TEMPLATE_DIR,
  });
  await waitForServer(PORT_BAD_STARTER);
});

test.after(async () => {
  await stopServer(childBadStarter);
  fs.rmSync(TMP_BAD_STARTER_DIR, { recursive: true, force: true });
});

test('POST /api/prototypes refuses when the starter template exists but fails validation - no "added" without files, registry untouched', async () => {
  const before = fs.existsSync(path.join(BAD_STARTER_PROTOTYPES_DIR, 'prototypes.json'))
    ? fs.readFileSync(path.join(BAD_STARTER_PROTOTYPES_DIR, 'prototypes.json'), 'utf8')
    : null;

  const { status, body } = await postJson(PORT_BAD_STARTER, '/api/prototypes', { name: 'Bad template' });
  assert.strictEqual(status, 500);
  assert.strictEqual(body.error, 'starter-copy-failed');
  assert.match(body.message, /disallowed import/);

  // The registry gained no entry without sources - no file or an unchanged file.
  const after = fs.existsSync(path.join(BAD_STARTER_PROTOTYPES_DIR, 'prototypes.json'))
    ? fs.readFileSync(path.join(BAD_STARTER_PROTOTYPES_DIR, 'prototypes.json'), 'utf8')
    : null;
  assert.strictEqual(after, before);
  // No prototype directory was orphaned on disk.
  const leftoverDirs = fs.readdirSync(BAD_STARTER_PROTOTYPES_DIR).filter((f) => f.startsWith('proto-'));
  assert.deepStrictEqual(leftoverDirs, []);
});

// -- A corrupt registry: the read-for-write refuses, never overwrites ---------
// -- it with an empty collection {items: []} ---------------------------------

const PORT_BAD_REGISTRY = 3563;
let childBadRegistry;
const TMP_BAD_REGISTRY_DIR = path.join(os.tmpdir(), `cockpit-test-proto-bad-registry-${process.pid}`);
const BAD_REGISTRY_PRODUCT_DIR = path.join(TMP_BAD_REGISTRY_DIR, 'ds-data');
const BAD_REGISTRY_PROTOTYPES_DIR = path.join(BAD_REGISTRY_PRODUCT_DIR, 'prototypes');
const BAD_REGISTRY_JSON_PATH = path.join(BAD_REGISTRY_PROTOTYPES_DIR, 'prototypes.json');

test.before(async () => {
  fs.mkdirSync(BAD_REGISTRY_PROTOTYPES_DIR, { recursive: true });
  // The file exists but holds invalid JSON - that is NOT a missing file.
  fs.writeFileSync(BAD_REGISTRY_JSON_PATH, '{ "items": [ this is not valid json');
  childBadRegistry = startServer(PORT_BAD_REGISTRY, {
    DATA_SUB_REPOS_DIR: TMP_BAD_REGISTRY_DIR,
    DATA_TIER_0_DIR: path.join(TMP_BAD_REGISTRY_DIR, 'ds-data'),
    AUTO_SYNC_ENABLED: '0',
    PROTO_BUILD_REPO_URL: '',
  });
  await waitForServer(PORT_BAD_REGISTRY);
});

test.after(async () => {
  await stopServer(childBadRegistry);
  fs.rmSync(TMP_BAD_REGISTRY_DIR, { recursive: true, force: true });
});

test('GET /api/prototypes on a malformed registry still answers 200 with an empty list (read path stays lenient)', async () => {
  const { status, body } = await getJson(PORT_BAD_REGISTRY, '/api/prototypes');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.items, []);
});

test('POST /api/prototypes on a malformed registry refuses the write instead of overwriting it with {items: []}', async () => {
  const before = fs.readFileSync(BAD_REGISTRY_JSON_PATH, 'utf8');
  const { status, body } = await postJson(PORT_BAD_REGISTRY, '/api/prototypes', { name: 'x' });
  assert.strictEqual(status, 409);
  assert.strictEqual(body.error, 'registry-unreadable');
  const after = fs.readFileSync(BAD_REGISTRY_JSON_PATH, 'utf8');
  assert.strictEqual(after, before, 'the corrupt file on disk was not overwritten with an empty collection');
});

test('PUT /api/prototypes/<id> on a malformed registry also refuses instead of silently succeeding on an empty collection', async () => {
  const { status, body } = await putJson(PORT_BAD_REGISTRY, '/api/prototypes/proto-whatever000', { name: 'x' });
  assert.strictEqual(status, 409);
  assert.strictEqual(body.error, 'registry-unreadable');
});

test('DELETE /api/prototypes/<id> on a malformed registry also refuses', async () => {
  const { status, body } = await deleteJson(PORT_BAD_REGISTRY, '/api/prototypes/proto-whatever000');
  assert.strictEqual(status, 409);
  assert.strictEqual(body.error, 'registry-unreadable');
});
