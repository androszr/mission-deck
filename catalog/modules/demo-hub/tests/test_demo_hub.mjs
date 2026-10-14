// demo-hub contract test. `npm test` picks up modules/<id>/tests/test_*.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'demo-hub';
const VIEW_IDS = ['demo-hub-note', 'demo-hub-history'];

const read = (rel) => fs.readFileSync(path.join(MODULE_DIR, rel), 'utf8');
const manifest = JSON.parse(read('module.json'));

test('demo-hub: the manifest declares exactly the expected views', () => {
  assert.equal(manifest.id, MODULE_ID);
  assert.deepEqual(manifest.views.map(v => v.id), VIEW_IDS);
});

test('demo-hub: every file the manifest points at exists', () => {
  const refs = [
    manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry,
  ].filter(Boolean);
  assert.ok(refs.length === 3, 'client entry, style and server entry are all declared');
  for (const rel of refs) {
    assert.ok(fs.existsSync(path.join(MODULE_DIR, rel)), 'missing file: ' + rel);
  }
});

test('demo-hub: the client exports one view per manifest entry', async () => {
  const ns = await import(path.join(MODULE_DIR, 'client/index.js'));
  assert.deepEqual(Object.keys(ns.views).sort(), [...VIEW_IDS].sort());
  for (const id of VIEW_IDS) {
    assert.equal(typeof ns.views[id].render, 'function');
    assert.equal(typeof ns.views[id].init, 'function');
  }
});

test('demo-hub: the server registers the ds-data and history routes', async () => {
  const { createRequire } = await import('node:module');
  const require_ = createRequire(import.meta.url);
  const register = require_(path.join(MODULE_DIR, 'server/index.js'));
  // A rootDir that does not exist is the point: nothing the register call does
  // may touch disk or require the cockpit's own scripts/, or the real loader
  // would mark the module "server entry failed" on a fresh clone.
  const reg = register({
    moduleId: MODULE_ID,
    rootDir: '/tmp/does-not-exist',
    makeLock: () => (fn) => fn(),
    jsonResponse: () => {},
    readBody: async () => ({}),
    log: () => {},
  });
  const sigs = reg.routes.map(r => r.method + ' ' + r.path).sort();
  assert.deepEqual(sigs, ['GET /ds-data', 'GET /history', 'POST /ds-data']);
});

test('demo-hub: an unclonable repo answers, it does not throw', async () => {
  const { createRequire } = await import('node:module');
  const require_ = createRequire(import.meta.url);
  const register = require_(path.join(MODULE_DIR, 'server/index.js'));
  const sent = [];
  const reg = register({
    moduleId: MODULE_ID,
    rootDir: '/tmp/does-not-exist',
    makeLock: () => (fn) => fn(),
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
    readBody: async () => ({}),
    log: () => {},
  });
  const byPath = (m, p) => reg.routes.find(r => r.method === m && r.path === p);

  await byPath('GET', '/ds-data').handler({}, {});
  await byPath('GET', '/history').handler({}, {});
  assert.equal(sent.length, 2);
  for (const { status, body } of sent) {
    assert.equal(status, 200, 'a missing data repo is a normal state, never an error');
    assert.equal(body.available, false);
  }
  assert.deepEqual(sent[1].body.rows, []);
});

test('demo-hub: the manifest says it is the sync test module over ds-data', () => {
  assert.match(manifest.description, /ds-data/);
  assert.match(manifest.name, /test/i);
  assert.equal(manifest.sidebar.label, manifest.name);
  assert.ok(Array.isArray(manifest.dataRepos) && manifest.dataRepos.length > 0);
  // The History view is what renders the per-version authorship, so its
  // heading is part of the contract the plan named.
  const history = manifest.views.find(v => v.id === 'demo-hub-history');
  assert.match(history.title, / history$/);
});

test('demo-hub: the note header is server-owned and round-trips', () => {
  const src = read('server/index.js');
  // The author never comes off the request body - a client naming the author
  // would be a client naming somebody else.
  assert.match(src, /\/api\/whoami/, 'the identity comes from the app, not from the browser');
  assert.doesNotMatch(src, /body\.author|body\.name/, 'the request body never names an author');
  // The mirror name is an HMAC of the posix repo-relative path, and the salt is
  // sha256 of the BARE name - `.enc` appended here breaks every decrypt.
  assert.match(src, /encryptRelPath\(NOTE_REL_PATH, key\)/);
});

test('demo-hub: it follows the team data directory the host gives it, never the default one', async () => {
  const os = await import('node:os');
  const { createRequire } = await import('node:module');
  const register = createRequire(import.meta.url)(path.join(MODULE_DIR, 'server/index.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-hub-ds-'));
  const ds = path.join(tmp, 'ds-data');
  fs.mkdirSync(path.join(ds, 'demo-hub'), { recursive: true });
  fs.writeFileSync(path.join(ds, 'demo-hub', 'note.md'), '---\nauthor: A\n---\n\nhello from the host dir\n');
  const sent = [];
  const reg = register({
    moduleId: MODULE_ID,
    rootDir: path.join(tmp, 'no-such-root'),
    dataTier0Dir: ds,
    makeLock: () => (fn) => fn(),
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
    readBody: async () => ({}),
    log: () => {},
  });
  await reg.routes.find(r => r.method === 'GET' && r.path === '/ds-data').handler({}, {});
  assert.equal(sent[0].body.available, true);
  assert.match(sent[0].body.text, /hello from the host dir/);
  // the mirror is the sibling of the host dir, which is not cloned here: no git call, a calm answer
  await reg.routes.find(r => r.method === 'GET' && r.path === '/history').handler({}, {});
  assert.equal(sent[1].status, 200);
  assert.deepEqual(sent[1].body.rows, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});
