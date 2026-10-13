// modules/onboarding/tests/test_onboarding_routes.mjs
// createRoutes(ctx) against a temp dataTier0Dir - never the real ds-data.
// Shape follows modules/time-log/tests/.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRoutes } = require(path.join(DIR, 'server', 'index.js'));

function makeTmpDataTier0Dir() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-routes-'));
  return path.join(base, 'ds-data');
}

function makeLock() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(() => fn());
    chain = run.catch(() => {});
    return run;
  };
}

function makeCtx(dataTier0Dir) {
  return {
    moduleId: 'onboarding',
    dataTier0Dir,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-data-')),
    rootDir: DIR,
    log: () => {},
    jsonResponse: (res, status, body) => { res.statusCode = status; res.body = body; },
    readBody: async (req) => req._body || {},
    checkOrigin: () => true,
    makeLock: () => makeLock(),
  };
}

function findRoute(routes, method, p) {
  const r = routes.find((x) => x.method === method && x.path === p);
  assert.ok(r, 'no route ' + method + ' ' + p);
  return r;
}

function makeReq(body, id) {
  const query = id !== undefined ? '?id=' + encodeURIComponent(id) : '';
  return { url: '/links' + query, _body: body };
}

function makeRes() {
  return { statusCode: null, body: null };
}

test('[empty-state] GET /links and GET /plans answer 200 with empty lists and storage unavailable when dataTier0Dir does not exist', () => {
  const dataTier0Dir = makeTmpDataTier0Dir(); // mkdtemp base exists, but ds-data itself does not
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);

  const resLinks = makeRes();
  findRoute(routes, 'GET', '/links').handler({}, resLinks);
  assert.strictEqual(resLinks.statusCode, 200);
  assert.deepStrictEqual(resLinks.body, { links: [], generated_at: null, storage: 'unavailable' });

  const resPlans = makeRes();
  findRoute(routes, 'GET', '/plans').handler({}, resPlans);
  assert.strictEqual(resPlans.statusCode, 200);
  assert.deepStrictEqual(resPlans.body, { plans: [], generated_at: null, storage: 'unavailable' });
});

test('[empty-state] POST /plans answers 409 repo-missing when dataTier0Dir does not exist', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);
  const res = makeRes();
  await findRoute(routes, 'POST', '/plans').handler({ url: '/plans', _body: { name: 'Someone' } }, res);
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.error, 'repo-missing');
});

test('[empty-state] GET /links and GET /plans answer 200 empty with storage ok when the repo exists but onboarding/ does not', () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  fs.mkdirSync(dataTier0Dir, { recursive: true });
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);

  const resLinks = makeRes();
  findRoute(routes, 'GET', '/links').handler({}, resLinks);
  assert.deepStrictEqual(resLinks.body, { links: [], generated_at: null, storage: 'ok' });

  const resPlans = makeRes();
  findRoute(routes, 'GET', '/plans').handler({}, resPlans);
  assert.deepStrictEqual(resPlans.body, { plans: [], generated_at: null, storage: 'ok' });
});

test('POST /links rejects a bad url and adds a valid one, writing only links.json', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  fs.mkdirSync(dataTier0Dir, { recursive: true });
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);

  const badRes = makeRes();
  await findRoute(routes, 'POST', '/links').handler({ url: '/links', _body: { title: 'X', url: 'ftp://x' } }, badRes);
  assert.strictEqual(badRes.statusCode, 400);

  const okRes = makeRes();
  await findRoute(routes, 'POST', '/links').handler({ url: '/links', _body: { title: 'Jira', url: 'https://example.com', description: 'desc' } }, okRes);
  assert.strictEqual(okRes.statusCode, 200);
  assert.strictEqual(okRes.body.status, 'added');
  assert.strictEqual(okRes.body.link.title, 'Jira');

  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  assert.strictEqual(fs.existsSync(path.join(moduleDir, 'links.json')), true);
  assert.strictEqual(fs.existsSync(path.join(moduleDir, 'template.json')), false);
});

test('POST /plans copies the template rows into a new people/<slug>.json, colliding names get -2', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'template.json'), JSON.stringify({
    id: 'default', name: 'Template', rows: [{ topic: 'A', description: '', who: '', when: '' }], generated_at: '2026-01-01T00:00:00.000Z',
  }));
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);

  const res1 = makeRes();
  await findRoute(routes, 'POST', '/plans').handler({ url: '/plans', _body: { name: 'New Person' } }, res1);
  assert.strictEqual(res1.statusCode, 200);
  assert.strictEqual(res1.body.plan.slug, 'new-person');
  assert.strictEqual(res1.body.plan.rows.length, 1);

  const res2 = makeRes();
  await findRoute(routes, 'POST', '/plans').handler({ url: '/plans', _body: { name: 'New Person' } }, res2);
  assert.strictEqual(res2.statusCode, 200);
  assert.strictEqual(res2.body.plan.slug, 'new-person-2');
});

test('[per-file] PUT /plans?id=<person> changes only that shard - template.json and a second shard are untouched byte-for-byte', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  const personsDir = path.join(moduleDir, 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  const templateBytes = JSON.stringify({ id: 'default', name: 'Template', rows: [], generated_at: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n';
  fs.writeFileSync(path.join(moduleDir, 'template.json'), templateBytes);
  const otherBytes = JSON.stringify({ id: 'plan-2', name: 'Other Person', slug: 'other-person', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n';
  fs.writeFileSync(path.join(personsDir, 'other-person.json'), otherBytes);
  fs.writeFileSync(path.join(personsDir, 'this-person.json'), JSON.stringify({ id: 'plan-1', name: 'This Person', slug: 'this-person', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n');

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);
  const res = makeRes();
  await findRoute(routes, 'PUT', '/plans').handler(makeReq({ rows: [{ topic: 'New', description: '', who: '', when: '' }] }, 'plan-1'), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.plan.rows.length, 1);

  assert.strictEqual(fs.readFileSync(path.join(moduleDir, 'template.json'), 'utf8'), templateBytes, 'template.json must not change');
  assert.strictEqual(fs.readFileSync(path.join(personsDir, 'other-person.json'), 'utf8'), otherBytes, 'the other shard must not change');
});

test('[per-file] PUT /plans?id=default changes only template.json', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  const personsDir = path.join(moduleDir, 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'template.json'), JSON.stringify({ id: 'default', name: 'Template', rows: [], generated_at: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n');
  const personBytes = JSON.stringify({ id: 'plan-1', name: 'This Person', slug: 'this-person', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n';
  fs.writeFileSync(path.join(personsDir, 'this-person.json'), personBytes);

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);
  const res = makeRes();
  await findRoute(routes, 'PUT', '/plans').handler(makeReq({ rows: [{ topic: 'Change', description: '', who: '', when: '' }] }, 'default'), res);
  assert.strictEqual(res.statusCode, 200);

  assert.strictEqual(fs.readFileSync(path.join(personsDir, 'this-person.json'), 'utf8'), personBytes, 'the person shard must not change');
  const template = JSON.parse(fs.readFileSync(path.join(moduleDir, 'template.json'), 'utf8'));
  assert.strictEqual(template.rows.length, 1);
});

test('[default-guard] rename and delete of the default plan are refused, unknown id is 404, missing id is 400', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'template.json'), JSON.stringify({ id: 'default', name: 'Template', rows: [], generated_at: '2026-01-01T00:00:00.000Z' }));

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);

  const renameRes = makeRes();
  await findRoute(routes, 'PUT', '/plans').handler(makeReq({ name: 'New name' }, 'default'), renameRes);
  assert.strictEqual(renameRes.statusCode, 403);
  assert.strictEqual(renameRes.body.error, 'cannot-rename-default');

  const deleteRes = makeRes();
  await findRoute(routes, 'DELETE', '/plans').handler(makeReq(undefined, 'default'), deleteRes);
  assert.strictEqual(deleteRes.statusCode, 403);
  assert.strictEqual(deleteRes.body.error, 'cannot-delete-default');

  const notFoundRes = makeRes();
  await findRoute(routes, 'DELETE', '/plans').handler(makeReq(undefined, 'plan-nieznany'), notFoundRes);
  assert.strictEqual(notFoundRes.statusCode, 404);

  const missingIdRes = makeRes();
  await findRoute(routes, 'PUT', '/plans').handler({ url: '/plans', _body: { name: 'X' } }, missingIdRes);
  assert.strictEqual(missingIdRes.statusCode, 400);
  assert.strictEqual(missingIdRes.body.error, 'missing-id');
});

test('DELETE /plans removes the shard by id (not by re-slugifying the current name)', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  const personsDir = path.join(moduleDir, 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  // The file name (slug) is frozen at creation; the in-file `name` has since
  // changed via a rename, so slugifying `name` today would look for the
  // wrong file. DELETE must find the shard by scanning for `id`.
  fs.writeFileSync(path.join(personsDir, 'old-person.json'), JSON.stringify({
    id: 'plan-1', name: 'New Name After Rename', slug: 'old-person', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z',
  }));

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);
  const res = makeRes();
  await findRoute(routes, 'DELETE', '/plans').handler(makeReq(undefined, 'plan-1'), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(fs.existsSync(path.join(personsDir, 'old-person.json')), false);
});

test('PUT /plans rejects more than 200 rows with 400', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'template.json'), JSON.stringify({ id: 'default', name: 'Template', rows: [], generated_at: '2026-01-01T00:00:00.000Z' }));
  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);
  const res = makeRes();
  await findRoute(routes, 'PUT', '/plans').handler(makeReq({ rows: new Array(201).fill({ topic: 'x' }) }, 'default'), res);
  assert.strictEqual(res.statusCode, 400);
});

test('a write that throws (e.g. unlink racing a concurrent delete) answers 500 instead of hanging', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  const personsDir = path.join(moduleDir, 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(personsDir, 'this-person.json'), JSON.stringify({ id: 'plan-1', name: 'This Person', slug: 'this-person', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z' }));

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);
  const res = makeRes();
  // Remove the file between the (fresh) readPersons() find and the unlink
  // the handler is about to do, by monkey-patching fs.unlinkSync for one call.
  const realUnlink = fs.unlinkSync;
  fs.unlinkSync = () => { throw new Error('ENOENT: simulated race'); };
  try {
    await findRoute(routes, 'DELETE', '/plans').handler(makeReq(undefined, 'plan-1'), res);
  } finally {
    fs.unlinkSync = realUnlink;
  }
  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(res.body.error, 'write-failed');
});

test('[bug FUNC-blocker] POST /plans with a path-traversal name writes only inside people/, nothing lands outside it', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  fs.mkdirSync(moduleDir, { recursive: true });
  // The mkdtemp base one level above ds-data/ - four '../' from
  // people/ lands exactly here, so this is what must gain no new entry.
  const mkdtempBase = path.dirname(dataTier0Dir);
  const beforeEntries = fs.readdirSync(mkdtempBase);

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);

  const res = makeRes();
  await findRoute(routes, 'POST', '/plans').handler({ url: '/plans', _body: { name: '../../../../tmp/x' } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(!/[./\\]/.test(res.body.plan.slug), 'the stored slug must carry no path-meaningful character: ' + res.body.plan.slug);

  const personsDir = path.join(moduleDir, 'people');
  const written = fs.readdirSync(personsDir);
  assert.strictEqual(written.length, 1);
  const writtenFull = path.resolve(personsDir, written[0]);
  assert.ok(writtenFull.startsWith(path.resolve(personsDir) + path.sep));
  // Nothing appeared outside dataTier0Dir - the traversal name must not
  // have escaped the people/ directory it was supposed to be confined to.
  assert.deepStrictEqual(fs.readdirSync(mkdtempBase), beforeEntries, 'the traversal target directory must gain no new entry');
});

test('[bug FUNC-blocker] a shard with a traversal slug on disk is skipped by GET, and PUT/DELETE answer 404 rather than touching a path outside people/', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  const personsDir = path.join(moduleDir, 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(personsDir, 'evil.json'), JSON.stringify({
    id: 'plan-evil', name: 'Bad', slug: '../evil', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z',
  }));

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);

  const getRes = makeRes();
  findRoute(routes, 'GET', '/plans').handler({}, getRes);
  assert.strictEqual(getRes.body.plans.length, 0, 'the traversal shard must never surface as a real plan');

  const putRes = makeRes();
  await findRoute(routes, 'PUT', '/plans').handler(makeReq({ name: 'Nowa' }, 'plan-evil'), putRes);
  assert.strictEqual(putRes.statusCode, 404, 'the shard is invisible to readPersons, so the id resolves to not-found, never to a write outside people/');

  const deleteRes = makeRes();
  await findRoute(routes, 'DELETE', '/plans').handler(makeReq(undefined, 'plan-evil'), deleteRes);
  assert.strictEqual(deleteRes.statusCode, 404);

  // The file on disk (however it got there) is left exactly alone - no
  // unlink was ever attempted outside people/, and the file itself is
  // untouched since the handler never resolved a path for it.
  assert.strictEqual(fs.existsSync(path.join(personsDir, 'evil.json')), true);
});

test('[bug FUNC-blocker] a legacy shard with an unusual-but-safe slug (parenthesised suffix) stays visible and editable through PUT', async () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  const personsDir = path.join(moduleDir, 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(personsDir, 'sam-rivera-(bs).json'), JSON.stringify({
    id: 'plan-legacy', name: 'Sam Rivera (BS)', slug: 'sam-rivera-(bs)', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z',
  }));

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);

  const getRes = makeRes();
  findRoute(routes, 'GET', '/plans').handler({}, getRes);
  assert.strictEqual(getRes.body.plans.length, 1, 'a merely unusual legacy slug must not be dropped like a traversal payload');

  const putRes = makeRes();
  await findRoute(routes, 'PUT', '/plans').handler(makeReq({ rows: [{ topic: 'X', description: '', who: '', when: '' }] }, 'plan-legacy'), putRes);
  assert.strictEqual(putRes.statusCode, 200);
  assert.strictEqual(fs.existsSync(path.join(personsDir, 'sam-rivera-(bs).json')), true, 'the same shard file is rewritten in place');
});

test('a corrupted person shard is logged and skipped, does not fail GET /plans', () => {
  const dataTier0Dir = makeTmpDataTier0Dir();
  const moduleDir = path.join(dataTier0Dir, 'onboarding');
  const personsDir = path.join(moduleDir, 'people');
  fs.mkdirSync(personsDir, { recursive: true });
  fs.writeFileSync(path.join(personsDir, 'broken.json'), '{ not json');
  fs.writeFileSync(path.join(personsDir, 'good.json'), JSON.stringify({ id: 'plan-1', name: 'Good', slug: 'good', rows: [], created_at: '2026-01-01T00:00:00.000Z', generated_at: '2026-01-01T00:00:00.000Z' }));

  const ctx = makeCtx(dataTier0Dir);
  const { routes } = createRoutes(ctx);
  const res = makeRes();
  findRoute(routes, 'GET', '/plans').handler({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.plans.length, 1);
  assert.strictEqual(res.body.plans[0].slug, 'good');
});
