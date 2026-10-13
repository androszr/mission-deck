// modules/roadmap/tests/test_roadmap.mjs
// Contract test for the roadmap module. `npm test` discovers it through
// scripts/test-unit-js.js, which walks modules/<id>/tests/ as well as tests/.
//
// Scaffolded by scripts/new-module.js - extend it with real behaviour tests.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
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
const MODULE_ID = 'roadmap';
const VIEW_IDS = ['roadmap-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('roadmap: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));
});

test('roadmap: the manifest declares exactly the expected views', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);
});

test('roadmap: the client exports one view per manifest entry', () => {
  const src = read('client/index.js');
  assert.match(src, /export const views\s*=/);
  for (const id of VIEW_IDS) {
    assert.ok(src.includes("'" + id + "'"), 'client/index.js has no view ' + id);
  }
});

test('roadmap: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('roadmap: the server entry registers at least one route', () => {
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

test('roadmap: manifest metadata (area, hub, no own data repo, author)', () => {
  const m = JSON.parse(read('module.json'));
  assert.strictEqual(m.area, 'Product');
  assert.strictEqual(m.sidebar.kind, 'page');
  assert.strictEqual(m.sidebar.hub, 'initiatives');
  // This module is the SOURCE of discovery-tasks/: a write entry, so the files
  // are pushed in its scope. The Tempo file and the time log stay read-only.
  assert.deepStrictEqual(m.dataRepos.map((r) => [r.name, r.access || 'write', r.paths]),
    [['data-tier-0', 'write', ['discovery-tasks/']], ['data-tier-0', 'read', ['discovery-tasks-tempo.json']], ['data-tier-0', 'read', ['time-log/']]]);
  assert.strictEqual(m.author, 'androszr');
  assert.ok(Array.isArray(m.tags) && m.tags.length >= 3);
});

// ---- server handler (temporary data dir, read-only module) -----------------

function makeCtx(rootDir) {
  const calls = [];
  return {
    calls,
    ctx: {
      moduleId: MODULE_ID, dataDir: rootDir, rootDir, log: () => {},
      jsonResponse: (_res, status, body) => calls.push({ status, body }),
      readBody: async () => ({}), checkOrigin: () => true,
      makeLock: () => (fn) => fn(),
    },
  };
}

async function withDataDir(files, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-'));
  const prev = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = tmp;
  try {
    if (files) {
      const dir = path.join(tmp, 'ds-data', 'discovery-tasks');
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    }
    await fn(tmp);
  } finally {
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function routeOf(ctx, p) {
  const register = require(path.join(DIR, 'server', 'index.js'));
  return register(ctx).routes.find((r) => r.path === p);
}

test('roadmap server: /initiatives sorts, rehydrates and skips broken files', async () => {
  await withDataDir({
    'dt-aaaaaaaa.json': JSON.stringify({ id: 'a', title: 'A', rank: 5, taskScope: ['x'], comments: [{ a: 1 }] }),
    'dt-bbbbbbbb.json': JSON.stringify({ id: 'b', title: 'B', rank: 2 }),
    'dt-cccccccc.json': '{ not json',
    'dt-seed-001.json': JSON.stringify({ id: 'seed', title: 'Seed', rank: 24 }),
    'dt-..json': JSON.stringify({ id: 'dots', rank: 1 }),
    'other.json': '{}',
  }, async (tmp) => {
    const { ctx, calls } = makeCtx(tmp);
    await routeOf(ctx, '/initiatives').handler({}, {});
    assert.strictEqual(calls[0].status, 200);
    const body = calls[0].body;
    assert.strictEqual(body.storage, 'ok');
    assert.deepStrictEqual(body.initiatives.map((i) => i.id), ['b', 'a', 'seed']);
    assert.strictEqual(body.count, 3);
    assert.strictEqual(body.initiatives[0].taskScope.length, 10);
    assert.ok(Array.isArray(body.initiatives[0].comments));
    assert.deepStrictEqual(body.initiatives[1].taskScope, ['x']);
    assert.deepStrictEqual(body.skipped, ['dt-cccccccc.json']);
  });
});

test('roadmap server: /initiatives answers 409 storage-unavailable without data', async () => {
  await withDataDir(null, async (tmp) => {
    const { ctx, calls } = makeCtx(tmp);
    await routeOf(ctx, '/initiatives').handler({}, {});
    assert.strictEqual(calls[0].status, 409);
    assert.strictEqual(calls[0].body.error, 'storage-unavailable');
    assert.ok(calls[0].body.message.includes('Team data'));
  });
});

test('roadmap server: routes are the list GETs, epic-children and field-id, the sync POSTs, the transition POST, the four Kanban routes and the update/reorder/delete POSTs', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const { ctx } = makeCtx(DIR);
  const routes = register(ctx).routes;
  assert.deepStrictEqual(routes.map((r) => r.method + ' ' + r.path).sort(),
    ['GET /initiatives', 'GET /jira/epic-children', 'GET /jira/field-id', 'GET /kanban/board', 'GET /kanban/status', 'GET /status', 'GET /tempo', 'GET /widget', 'GET /worklogs', 'POST /delete', 'POST /jira-sync', 'POST /jira-sync-all', 'POST /jira/transition', 'POST /kanban/create-task', 'POST /kanban/transition', 'POST /reorder', 'POST /update']);
});

test('roadmap server: the only file write lives in one function (writeInitiativeFile), the Jira writes in transitionIssue and server/kanban.js only', () => {
  const idx = read('server/index.js');
  assert.strictEqual((idx.match(/writeFileSync|renameSync|unlinkSync|rmSync|mkdirSync|appendFileSync/g) || []).length, 3, 'writeFileSync + renameSync in writeInitiativeFile, unlinkSync in removeInitiativeFile');
  const fn = idx.slice(idx.indexOf('function writeInitiativeFile'), idx.indexOf('function removeInitiativeFile'));
  assert.ok(fn.includes('writeFileSync') && fn.includes('renameSync') && !fn.includes('unlinkSync'));
  const rm = idx.slice(idx.indexOf('function removeInitiativeFile'), idx.indexOf('function writeSyncPatch'));
  assert.ok(rm.includes('unlinkSync') && !/rmSync|writeFileSync/.test(rm));
  const j = read('server/jira.js');
  assert.ok(!/writeFileSync|\.fs\b|require\('fs'\)/.test(j));
  // jira.js: exactly one Jira write (the Table transition) plus the generic sendJson client the Kanban writes use.
  assert.strictEqual((j.match(/method:\s*'(POST|PUT|DELETE)'/g) || []).length, 1);
  const tr = j.slice(j.indexOf('async function transitionIssue'), j.indexOf('module.exports'));
  assert.ok(/method:\s*'POST'/.test(tr), 'the POST lives in transitionIssue');
  // kanban.js: three writes (transition POST, create POST, "Dotyczy" PUT), never DELETE, never a direct fetch, no file access.
  const k = read('server/kanban.js');
  assert.strictEqual((k.match(/method:\s*'(POST|PUT|DELETE)', headers/g) || []).map((m) => m.split("'")[1]).join(','), 'POST,POST,PUT');
  assert.ok(!/\bfetch\(|require\('fs'\)|process\.env/.test(k), 'kanban.js talks through the injected http client only and reads no token');
});

test('pickTransition matches the target status without case or diacritics', () => {
  const list = [
    { id: '11', name: 'Start', to: { name: 'In progress' } },
    { id: '31', name: 'Close', to: { name: 'Clôsed' } },
  ];
  assert.strictEqual(J.pickTransition(list, 'closed').id, '31');
  assert.strictEqual(J.pickTransition(list, 'Clôsed').id, '31');
  assert.strictEqual(J.pickTransition(list, 'Close').id, '31');
  assert.strictEqual(J.pickTransition(list, 'Done'), null);
  assert.strictEqual(J.pickTransition([], 'Closed'), null);
});

// ---- Jira sync (stage 2) ----------------------------------------------------

const J = require(path.join(DIR, 'server', 'jira.js'));
const register = require(path.join(DIR, 'server', 'index.js'));
const CFG = { token: 't', jiraUrl: 'https://jira.test', ok: true };

const issue = (key, summary, extra = {}) => ({ key, fields: { summary, status: { name: 'W toku', statusCategory: { key: 'indeterminate' } }, updated: '2026-10-01T10:00:00.000+0200', ...extra } });

test('jira: jiraConfig prefers the personal token, falls back to the technical one, ignores placeholders', () => {
  assert.strictEqual(J.jiraConfig({ JIRA_TOKEN: 'a', JIRA_TECH_TOKEN: 'b' }).token, 'a');
  assert.strictEqual(J.jiraConfig({ JIRA_TOKEN: 'your_jira_token_here', JIRA_TECH_TOKEN: 'b' }).token, 'b');
  assert.strictEqual(J.jiraConfig({}).ok, false);
  assert.strictEqual(J.jiraConfig({ JIRA_TOKEN: 'a', JIRA_URL: 'https://x.test/' }).jiraUrl, 'https://x.test');
  assert.strictEqual(J.jiraConfig({ JIRA_TOKEN: 'a' }).jiraUrl, 'https://jira.example.com');
});

test('jira: reconcileIssues matches by label without diacritics, first issue per definition wins, rest unmatched', () => {
  const issues = [
    issue('DISC-1', '[PROD-9] Solution architécture', { assignee: { displayName: 'CTR Rivera Sam' }, timetracking: { timeSpentSeconds: 3600 } }),
    issue('DISC-2', 'Solution architecture - addendum'),
    issue('DISC-3', 'Something else entirely'),
    issue('DISC-4', 'Mockups and prototypes'),
  ];
  const wl = { 'DISC-1': [{ author: 'Rivera Sam', timeSpentSeconds: 1800, started: '2026-09-30' }, { author: 'Rivera Sam', timeSpentSeconds: 600, started: '2026-09-30' }] };
  const r = J.reconcileIssues(issues, wl, 'https://jira.test');
  assert.strictEqual(r.tasks.length, 10);
  const arch = r.tasks.find((t) => t.defId === 'architecture');
  assert.strictEqual(arch.key, 'DISC-1');
  assert.strictEqual(arch.assignee, 'Rivera Sam');
  assert.strictEqual(arch.url, 'https://jira.test/browse/DISC-1');
  assert.deepStrictEqual(arch.timeByPerson, { 'Rivera Sam': 2400 });
  assert.deepStrictEqual(arch.timeByPersonByDay, { 'Rivera Sam': { '2026-09-30': 2400 } });
  assert.strictEqual(r.tasks.find((t) => t.defId === 'mockups-prototypes').key, 'DISC-4');
  assert.strictEqual(r.tasks.find((t) => t.defId === 'refinements').key, null);
  assert.deepStrictEqual(r.unmatched.map((u) => u.key), ['DISC-2', 'DISC-3']);
});

test('jira: parseEpicFields and parseTriggeringLinks', () => {
  const f = J.parseEpicFields({ fields: { customfield_17308: { id: '1', value: 'Large' }, customfield_29000: null, customfield_29001: ['Platform', 'X'] } });
  assert.deepStrictEqual(f, { changeType: { id: '1', name: 'Large' }, workType: null, appliesTo: 'Platform' });
  assert.strictEqual(J.parseEpicFields(null), null);
  const links = J.parseTriggeringLinks({ fields: { issuelinks: [
    { type: { outward: 'is triggering' }, outwardIssue: issue('PROD-7', 'Epik delivery') },
    { type: { outward: 'relates to' }, outwardIssue: issue('PROD-8', 'No') },
    { type: { outward: 'is triggering' } },
  ] } }, 'https://jira.test');
  assert.deepStrictEqual(links.map((l) => [l.key, l.source, l.statusCategory]), [['PROD-7', 'jira-triggering', 'indeterminate']]);
});

test('jira: mergeJiraTasks keeps order, excluded keys and unmatched assignments', () => {
  const init = {
    jiraExcludedKeys: ['DISC-9'],
    jiraTasks: [{ defId: 'refinements', key: 'OLD-1' }, { defId: 'architecture', key: 'OLD-2' }],
    jiraUnmatched: [{ key: 'DISC-2', assignedDefId: 'architecture' }],
  };
  const server = [{ defId: 'architecture', key: 'DISC-1' }, { defId: 'mockups-prototypes', key: 'DISC-9', summary: 's' }];
  const m = J.mergeJiraTasks(init, server, [{ key: 'DISC-2' }, { key: 'DISC-9' }, { key: 'DISC-3' }]);
  assert.deepStrictEqual(m.jiraTasks.map((t) => [t.defId, t.key]), [['refinements', 'OLD-1'], ['architecture', 'DISC-1'], ['mockups-prototypes', null]]);
  assert.deepStrictEqual(m.jiraUnmatched, [{ key: 'DISC-2', assignedDefId: 'architecture' }, { key: 'DISC-3' }]);
});

test('jira: mergeDeliveryEpics keeps manual epics, refreshes enriched ones, keeps stored auto epics when links were unreadable', () => {
  const existing = [{ key: 'A-1', source: 'jira-triggering' }, { key: 'M-1', source: 'manual', summary: 'old' }, { key: 'A-2', source: 'manual' }];
  const out = J.mergeDeliveryEpics(existing, [{ key: 'A-2', source: 'jira-triggering' }], { 'M-1': { key: 'M-1', source: 'manual', summary: 'new' } });
  assert.deepStrictEqual(out.map((e) => [e.key, e.source, e.summary]), [['A-2', 'jira-triggering', undefined], ['M-1', 'manual', 'new']]);
  const kept = J.mergeDeliveryEpics(existing, null, {});
  assert.deepStrictEqual(kept.map((e) => e.key), ['A-1', 'M-1', 'A-2']);
});

function fakeJira(routes) {
  const calls = [];
  return {
    calls,
    async fetchJson(url, opts) {
      calls.push({ url, opts });
      assert.ok(!url.includes('POST'), 'only GET shaped calls');
      const u = decodeURIComponent(url);
      for (const [needle, answer] of routes) {
        if (u.includes(needle)) {
          if (answer instanceof Error) throw answer;
          return typeof answer === 'function' ? answer(u) : answer;
        }
      }
      throw Object.assign(new Error('HTTP 404'), { status: 404 });
    },
  };
}

test('jira: fetchEpicChildren dedups by key, skips a 400 JQL and excludes the epic itself', async () => {
  const http = fakeJira([
    ['"Parent Link" = PROD-5784', Object.assign(new Error('HTTP 400'), { status: 400 })],
    ['"Epic Link" = PROD-5784', { issues: [issue('PROD-1', 'Jeden', { issuetype: { name: 'Story' } }), issue('PROD-5784', 'Sam')] }],
    ['parent = PROD-5784', { issues: [issue('PROD-1', 'Jeden'), issue('PROD-2', 'Dwa', { issuetype: { name: 'Task' } })] }],
    ['linkedIssues(PROD-5784)', { issues: [issue('PROD-2', 'Dwa'), issue('CYB-3', 'Trzy')] }],
  ]);
  const out = await J.fetchEpicChildren({ http, cfg: CFG, key: 'PROD-5784' });
  assert.deepStrictEqual(out.map((i) => [i.key, i.relation, i.issueType]), [['PROD-1', 'epic-link', 'Story'], ['PROD-2', 'parent', 'Task'], ['CYB-3', 'linked', null]]);
  assert.deepStrictEqual(Object.keys(out[0]), ['key', 'summary', 'status', 'statusCategory', 'issueType', 'relation']);
  assert.strictEqual(http.calls.length, 4);
  assert.strictEqual(http.calls[0].opts.headers.Authorization, 'Bearer t');
  const denied = fakeJira([['Parent Link', Object.assign(new Error('HTTP 401'), { status: 401 })]]);
  await assert.rejects(() => J.fetchEpicChildren({ http: denied, cfg: CFG, key: 'PROD-1' }), (e) => e.status === 401);
});

// A realistic raw file: unusual key order, 4-space-free 2-space format, Polish text.
const RAW = {
  id: 'dt-aaaaaaaa', title: 'Combined orders', ticket: 'PROD-100', rank: 3,
  jiraTasks: [], po: 'Sam Rivera', jiraExcludedKeys: [], epicFields: null, jiraUnmatched: [],
  comments: [{ author: 'X', text: 'é' }], deliveryEpics: [{ key: 'M-1', source: 'manual', summary: 'old' }],
  discoveryEnd: '2026-11-01',
};

const syncRoutes = () => [
  ['issue/DISC-1/worklog', { worklogs: [{ author: { displayName: 'Rivera Sam' }, timeSpentSeconds: 600, started: '2026-09-30T08:00:00.000+0200' }] }],
  ['issue/PROD-100?fields=customfield', { fields: { customfield_17308: { id: '5', value: 'Small' }, customfield_29000: { id: '6', value: 'Development' }, customfield_29001: ['Platform'] } }],
  ['issue/DISC-5?fields=issuelinks', { fields: { issuelinks: [{ type: { outward: 'is triggering' }, outwardIssue: issue('PROD-200', 'Epik delivery') }] } }],
  ['issue/PROD-200?fields=summary', issue('PROD-200', 'Epik delivery')],
  ['issue/M-1?fields=summary', issue('M-1', 'Manual epic')],
  ['/worklog', { worklogs: [] }],
  ['"Epic Link" = PROD-100', { issues: [issue('DISC-1', 'Solution architecture'), issue('DISC-5', 'Business requirements and breakdown into stages'), issue('DISC-6', 'Other')] }],
  ['"Epic Link" = M-1', { issues: [] }],
  ['"Epic Link" = PROD-200', { issues: [issue('DISC-7', 'Podzadanie')] }],
];

async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { await fn(); } finally {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    register._setHttpForTests(null);
  }
}

const LIVE = { NODE_ENV: undefined, COCKPIT_EMBEDDED: undefined, JIRA_TOKEN: 'tok', JIRA_TECH_TOKEN: undefined };

test('roadmap server: /jira-sync writes only the four fields, keeps key order and the stable byte format', async () => {
  await withDataDir({ 'dt-aaaaaaaa.json': JSON.stringify(RAW, null, 2) + '\n' }, async (tmp) => {
    await withEnv(LIVE, async () => {
      register._setHttpForTests(fakeJira(syncRoutes()));
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'dt-aaaaaaaa' });
      await routeOf(ctx, '/jira-sync').handler({}, {});
      assert.strictEqual(calls[0].status, 200, JSON.stringify(calls[0].body));
      assert.strictEqual(calls[0].body.ok, true);
      assert.strictEqual(calls[0].body.counts.tasks, 2);
      assert.strictEqual(calls[0].body.initiative.taskScope.length, 10, 'response is rehydrated');
      const file = path.join(tmp, 'ds-data', 'discovery-tasks', 'dt-aaaaaaaa.json');
      const text = fs.readFileSync(file, 'utf8');
      const disk = JSON.parse(text);
      assert.strictEqual(text, JSON.stringify(disk, null, 2) + '\n');
      assert.deepStrictEqual(Object.keys(disk), Object.keys(RAW), 'no key added, order unchanged');
      assert.ok(!('taskScope' in disk), 'rehydrated defaults are not persisted');
      for (const k of Object.keys(RAW)) {
        if (!['jiraTasks', 'jiraUnmatched', 'epicFields', 'deliveryEpics'].includes(k)) assert.deepStrictEqual(disk[k], RAW[k], k);
      }
      assert.deepStrictEqual(disk.epicFields, { changeType: { id: '5', name: 'Small' }, workType: { id: '6', name: 'Development' }, appliesTo: 'Platform' });
      assert.deepStrictEqual(disk.jiraTasks.filter((t) => t.key).map((t) => t.defId), ['requirements-breakdown', 'architecture']);
      assert.deepStrictEqual(disk.jiraUnmatched.map((u) => u.key), ['DISC-6']);
      assert.deepStrictEqual(disk.deliveryEpics.map((e) => [e.key, e.source]), [['PROD-200', 'jira-triggering'], ['M-1', 'manual']]);
      assert.strictEqual(disk.deliveryEpics[1].summary, 'Manual epic');
      assert.strictEqual(disk.deliveryEpics[0].subtasks[0].key, 'DISC-7');
      assert.deepStrictEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), []);
    });
  });
});

test('roadmap server: /jira-sync answers 404, 400 and 409', async () => {
  await withDataDir({ 'dt-aaaaaaaa.json': JSON.stringify({ id: 'a', title: 'A' }) }, async (tmp) => {
    await withEnv(LIVE, async () => {
      register._setHttpForTests(fakeJira([]));
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'nope' });
      await routeOf(ctx, '/jira-sync').handler({}, {});
      assert.strictEqual(calls[0].status, 404);
      ctx.readBody = async () => ({ id: 'a' });
      await routeOf(ctx, '/jira-sync').handler({}, {});
      assert.strictEqual(calls[1].status, 400);
      assert.strictEqual(calls[1].body.error, 'no-ticket');
      ctx.readBody = async () => ({});
      await routeOf(ctx, '/jira-sync').handler({}, {});
      assert.strictEqual(calls[2].status, 400);
    });
  });
  await withDataDir(null, async (tmp) => {
    await withEnv(LIVE, async () => {
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'a' });
      await routeOf(ctx, '/jira-sync').handler({}, {});
      assert.strictEqual(calls[0].status, 409);
      assert.strictEqual(calls[0].body.error, 'storage-unavailable');
    });
  });
});

test('roadmap server: no token -> 503 no-token, 401 from Jira -> 503 token-unauthorized, network -> 502', async () => {
  await withDataDir({ 'dt-aaaaaaaa.json': JSON.stringify(RAW) }, async (tmp) => {
    await withEnv({ ...LIVE, JIRA_TOKEN: undefined }, async () => {
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'dt-aaaaaaaa' });
      await routeOf(ctx, '/jira-sync').handler({}, {});
      await routeOf(ctx, '/jira-sync-all').handler({}, {});
      await routeOf(ctx, '/jira/epic-children').handler({ url: '/jira/epic-children?key=PROD-1' }, {});
      for (const c of calls) {
        assert.strictEqual(c.status, 503);
        assert.strictEqual(c.body.error, 'no-token');
        assert.ok(c.body.message.includes('No Jira token - unlock the Bitwarden vault in the top bar'));
      }
    });
    await withEnv(LIVE, async () => {
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'dt-aaaaaaaa' });
      register._setHttpForTests(fakeJira([['jql=', Object.assign(new Error('HTTP 401'), { status: 401 })]]));
      await routeOf(ctx, '/jira-sync').handler({}, {});
      assert.strictEqual(calls[0].status, 503);
      assert.strictEqual(calls[0].body.error, 'token-unauthorized');
      assert.ok(calls[0].body.message.indexOf('VPN') < calls[0].body.message.indexOf('token'));
      register._setHttpForTests(fakeJira([['jql=', new Error('fetch failed')]]));
      await routeOf(ctx, '/jira-sync').handler({}, {});
      assert.strictEqual(calls[1].status, 502);
      assert.strictEqual(calls[1].body.error, 'jira-unreachable');
      const before = fs.readFileSync(path.join(tmp, 'ds-data', 'discovery-tasks', 'dt-aaaaaaaa.json'), 'utf8');
      assert.strictEqual(before, JSON.stringify(RAW), 'a failed sync leaves the file untouched');
    });
  });
});

test('roadmap server: test mode refuses every Jira route with 409 test-mode', async () => {
  await withDataDir({ 'dt-aaaaaaaa.json': JSON.stringify(RAW) }, async (tmp) => {
    await withEnv({ ...LIVE, NODE_ENV: 'test' }, async () => {
      register._setHttpForTests(fakeJira([]));
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'dt-aaaaaaaa' });
      await routeOf(ctx, '/jira-sync').handler({}, {});
      await routeOf(ctx, '/jira-sync-all').handler({}, {});
      await routeOf(ctx, '/jira/epic-children').handler({ url: '/jira/epic-children?key=PROD-1' }, {});
      assert.deepStrictEqual(calls.map((c) => [c.status, c.body.error]), [[409, 'test-mode'], [409, 'test-mode'], [409, 'test-mode']]);
    });
  });
});

test('roadmap server: /jira-sync-all syncs ticketed initiatives in order, reports per id, rejects a concurrent run', async () => {
  await withDataDir({
    'dt-aaaaaaaa.json': JSON.stringify(RAW),
    'dt-bbbbbbbb.json': JSON.stringify({ id: 'dt-bbbbbbbb', title: 'B', rank: 1 }),
    'dt-cccccccc.json': JSON.stringify({ id: 'dt-cccccccc', title: 'C', ticket: 'PROD-300', rank: 2 }),
  }, async (tmp) => {
    await withEnv(LIVE, async () => {
      let release;
      const gateP = new Promise((r) => { release = r; });
      const http = fakeJira([
        ['PROD-300', Object.assign(new Error('HTTP 500'), { status: 500 })],
        ...syncRoutes(),
      ]);
      const inner = http.fetchJson.bind(http);
      http.fetchJson = async (u, o) => { await gateP; return inner(u, o); };
      register._setHttpForTests(http);
      const { ctx, calls } = makeCtx(tmp);
      const routes = register(ctx).routes; // ONE registration, like the host
      const syncAll = routes.find((r) => r.path === '/jira-sync-all').handler;
      const first = syncAll({}, {});
      await new Promise((r) => setImmediate(r));
      await syncAll({}, {});
      assert.strictEqual(calls[0].status, 409);
      assert.strictEqual(calls[0].body.error, 'busy');
      release();
      await first;
      const body = calls[1].body;
      assert.strictEqual(calls[1].status, 200);
      assert.deepStrictEqual(body.results.map((r) => [r.id, r.ticket, r.ok]), [['dt-cccccccc', 'PROD-300', false], ['dt-aaaaaaaa', 'PROD-100', true]]);
      assert.strictEqual(body.results[0].error, 'jira-error');
      assert.deepStrictEqual(body.totals, { total: 2, ok: 1, failed: 1 });
    });
  });
});

test('roadmap server: /jira/epic-children validates the key', async () => {
  await withEnv(LIVE, async () => {
    const { ctx, calls } = makeCtx(DIR);
    for (const url of ['/jira/epic-children', '/jira/epic-children?key=abc', '/jira/epic-children?key=PROD-1%20OR%201=1']) {
      await routeOf(ctx, '/jira/epic-children').handler({ url }, {});
    }
    assert.deepStrictEqual(calls.map((c) => c.status), [400, 400, 400]);
  });
});


// ---- helpers (client/helpers.js) - frontend-implementer adds cases below ----
// FRONTEND-TESTS-START
const H = await import(new URL('../client/helpers.js', import.meta.url).href);
const flip = (n) => (n === 'Rivera Sam' ? 'Sam Rivera' : n);

test('helpers: sortInitiatives uses 999 for a missing rank and is stable', () => {
  const out = H.sortInitiatives([{ id: 'a' }, { id: 'b', rank: 3 }, { id: 'c' }, { id: 'd', rank: 1 }]);
  assert.deepStrictEqual(out.map((i) => i.id), ['d', 'b', 'a', 'c']);
});





test('helpers: timeByPersonTotals merges both name orders through the canonicaliser', () => {
  const init = { jiraTasks: [{ timeByPerson: { 'Rivera Sam': 3600 } }],
    jiraUnmatched: [{ timeByPerson: { 'Sam Rivera': 1800 } }],
    deliveryEpics: [{ timeByPerson: { 'Jordan Lee': 900 }, subtasks: [{ timeByPerson: { 'Jordan Lee': 100 } }] }] };
  const t = H.timeByPersonTotals(init, flip);
  assert.deepStrictEqual(t.entries, [['Sam Rivera', 5400], ['Jordan Lee', 1000]]);
  assert.strictEqual(t.total, 6400);
});

test('helpers: formatMd', () => {
  assert.strictEqual(H.formatMd(0), '0 MD');
  assert.strictEqual(H.formatMd(null), '');
  assert.strictEqual(H.formatMd(undefined), '');
  assert.strictEqual(H.formatMd(12600), '0,4 MD');
});

test('helpers: polishHolidays covers movable feasts', () => {
  const h = H.polishHolidays(2026);
  assert.ok(h.has('2026-04-06'), 'Easter Monday');
  assert.ok(h.has('2026-06-04'), 'Corpus Christi');
  assert.ok(h.has('2026-05-03'));
});

test('helpers: workingDaysLabel with an injected today', () => {
  const today = new Date('2026-10-05T10:00:00');
  assert.strictEqual(H.workingDaysLabel('', false, today), '');
  assert.strictEqual(H.workingDaysLabel('2026-10-05', false, today), '(today)');
  assert.strictEqual(H.workingDaysLabel('2026-10-01', false, today), '(overdue)');
  assert.strictEqual(H.workingDaysLabel('2026-10-01', true, today), '(done)');
  assert.strictEqual(H.workingDaysLabel('2026-10-09', false, today), '(5 working days)');
});

test('helpers: isDateDone follows stageStatus', () => {
  assert.strictEqual(H.isDateDone({ stageStatus: ['delivery'] }, 'discoveryEnd'), true);
  assert.strictEqual(H.isDateDone({ stageStatus: ['delivery'] }, 'goLiveDate'), false);
  assert.strictEqual(H.isDateDone({}, 'deliveryEnd'), false);
});

test('helpers: filterInitiatives searches without diacritics and filters by canonical person', () => {
  const list = [
    { id: '1', title: 'Café orders', ticket: 'PROD-1', po: 'Sam Rivera' },
    { id: '2', title: 'Other', ticket: 'PLAT-9', analyst: 'Jordan Lee' },
  ];
  assert.deepStrictEqual(H.filterInitiatives(list, { search: 'cafe orders' }).map((i) => i.id), ['1']);
  assert.deepStrictEqual(H.filterInitiatives(list, { search: 'plat' }).map((i) => i.id), ['2']);
  assert.deepStrictEqual(H.filterInitiatives(list, { persons: new Set(['Jordan Lee']) }).map((i) => i.id), ['2']);
  assert.deepStrictEqual(H.collectPersons(list), ['Jordan Lee', 'Sam Rivera']);
});






// FRONTEND-TESTS-END

// ---- Stage 3: inline editing, ordering, sync modal ---------------------------

test('helpers: validateInitiativePatch is a strict whitelist', () => {
  const ok = H.validateInitiativePatch({ ragStatus: 'amber', stageStatus: ['preparation', 'preparation', 'pilot'], discoveryEnd: ' 2026-11-30 ', goLiveDate: '', po: ' Sam Rivera ' });
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.patch, { ragStatus: 'amber', stageStatus: ['preparation', 'pilot'], discoveryEnd: '2026-11-30', goLiveDate: '', po: 'Sam Rivera' });
  assert.deepStrictEqual(H.validateInitiativePatch({ ragStatus: null }).patch, { ragStatus: null });
  const bad = [
    {}, null, [], { title: 'x' }, { id: 'x' }, { jiraTasks: [] }, { rank: 1 },
    { ragStatus: 'blue' }, { ragStatus: '' }, { stageStatus: 'delivery' }, { stageStatus: ['nope'] },
    { deliveryEnd: '2026-02-30' }, { goLiveDate: '30.11.2026' }, { goLiveDate: null }, { discoveryEnd: 5 },
    { po: 5 }, { designer: 'x'.repeat(121) }, { analyst: null },
  ];
  for (const b of bad) assert.strictEqual(H.validateInitiativePatch(b).ok, false, JSON.stringify(b));
  assert.strictEqual(H.validateInitiativePatch({ architect: 'x'.repeat(120) }).ok, true);
});

test('helpers: ragPatch, toggleStagePatch follow the toggle rules', () => {
  assert.deepStrictEqual(H.ragPatch('red', 'red'), { ragStatus: null });
  assert.deepStrictEqual(H.ragPatch('red', 'green'), { ragStatus: 'green' });
  assert.deepStrictEqual(H.ragPatch(null, 'amber'), { ragStatus: 'amber' });
  assert.deepStrictEqual(H.toggleStagePatch(['preparation'], 'delivery'), { stageStatus: ['preparation', 'delivery'] });
  assert.deepStrictEqual(H.toggleStagePatch(['preparation', 'delivery'], 'preparation'), { stageStatus: ['delivery'] });
  assert.deepStrictEqual(H.toggleStagePatch(undefined, 'pilot'), { stageStatus: ['pilot'] });
});

test('helpers: moveInOrder, stepInOrder and computeReorder', () => {
  const o = ['a', 'b', 'c', 'd'];
  assert.deepStrictEqual(H.moveInOrder(o, 'a', 'c', true), ['b', 'c', 'a', 'd']);
  assert.deepStrictEqual(H.moveInOrder(o, 'd', 'b', false), ['a', 'd', 'b', 'c']);
  assert.deepStrictEqual(H.moveInOrder(o, 'b', 'b', true), o);
  assert.deepStrictEqual(H.moveInOrder(o, 'x', 'b', true), o);
  assert.deepStrictEqual(H.moveInOrder(o, 'a', 'x', true), o);
  assert.deepStrictEqual(H.stepInOrder(o, 'b', -1), ['b', 'a', 'c', 'd']);
  assert.deepStrictEqual(H.stepInOrder(o, 'a', -1), o);
  assert.deepStrictEqual(H.stepInOrder(o, 'd', 1), o);
  const items = [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c' }];
  assert.deepStrictEqual(H.computeReorder(items, ['a', 'b', 'c']), { ok: true, changes: [{ id: 'c', rank: 3 }] });
  assert.deepStrictEqual(H.computeReorder(items, ['c', 'a', 'b']).changes.map((c) => c.id), ['a', 'b', 'c']);
  for (const bad of [[], ['a', 'b'], ['a', 'a', 'b'], ['a', 'b', 'z'], ['a', 'b', 'c', 'c'], 'abc', null, ['a', 'b', 1]]) {
    assert.strictEqual(H.computeReorder(items, bad).ok, false, JSON.stringify(bad));
  }
});

test('helpers: moveToPosition inserts at the position, clamps to 1..n, ignores unknown ids and non-integers', () => {
  const o = ['a', 'b', 'c', 'd'];
  assert.deepStrictEqual(H.moveToPosition(o, 'd', 2), ['a', 'd', 'b', 'c']);
  assert.deepStrictEqual(H.moveToPosition(o, 'a', 3), ['b', 'c', 'a', 'd']);
  assert.deepStrictEqual(H.moveToPosition(o, 'b', 2), o);
  assert.deepStrictEqual(H.moveToPosition(o, 'a', 99), ['b', 'c', 'd', 'a']);
  assert.deepStrictEqual(H.moveToPosition(o, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.deepStrictEqual(H.moveToPosition(o, 'x', 2), o);
  assert.deepStrictEqual(H.moveToPosition(o, 'c', 1), ['c', 'a', 'b', 'd']);
  assert.deepStrictEqual(H.moveToPosition(o, 'b', 4), ['a', 'c', 'd', 'b']);
  assert.deepStrictEqual(H.moveToPosition(o, 'a', 2.5), o);
  assert.deepStrictEqual(H.moveToPosition(o, 'a', NaN), o);
  assert.notStrictEqual(H.moveToPosition(o, 'b', 2), o);
  assert.deepStrictEqual(o, ['a', 'b', 'c', 'd']);
});

test('helpers: syncTargets lists ticketed initiatives in table order; fatal codes stop the modal', () => {
  const list = [{ id: 'a', title: 'A', ticket: 'prod-2', rank: 2 }, { id: 'b', title: 'B', rank: 1 }, { id: 'c', ticket: 'PLAT-7', rank: 0 }, { id: 'd', ticket: 'bad', rank: 5 }];
  assert.deepStrictEqual(H.syncTargets(list), [{ id: 'c', ticket: 'PLAT-7', title: '(untitled)' }, { id: 'a', ticket: 'PROD-2', title: 'A' }]);
  assert.strictEqual(H.isFatalSyncError('token-unauthorized'), true);
  assert.strictEqual(H.isFatalSyncError('jira-error'), false);
});

const DAY = (f) => path.join(f, 'ds-data', 'discovery-tasks');
const UPD_RAW = { id: 'dt-aaaaaaaa', title: 'Orders', ticket: 'PROD-100', rank: 3, po: 'Sam Rivera', comments: [{ author: 'X', text: 'é' }], ragStatus: null };

test('roadmap server: /update writes only the patched keys in the stable byte format, appends missing keys, rehydrates the answer', async () => {
  await withDataDir({ 'dt-aaaaaaaa.json': JSON.stringify(UPD_RAW, null, 2) + '\n' }, async (tmp) => {
    await withEnv(LIVE, async () => {
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'dt-aaaaaaaa', patch: { ragStatus: 'red', designer: 'Jordan Lee', po: '', goLiveDate: '2026-12-01' } });
      await routeOf(ctx, '/update').handler({}, {});
      assert.strictEqual(calls[0].status, 200, JSON.stringify(calls[0].body));
      assert.strictEqual(calls[0].body.initiative.taskScope.length, 10);
      const file = path.join(DAY(tmp), 'dt-aaaaaaaa.json');
      const text = fs.readFileSync(file, 'utf8');
      const disk = JSON.parse(text);
      assert.strictEqual(text, JSON.stringify(disk, null, 2) + '\n');
      assert.deepStrictEqual(Object.keys(disk), [...Object.keys(UPD_RAW), 'designer', 'goLiveDate'], 'existing order kept, new keys appended in patch order');
      assert.strictEqual(disk.ragStatus, 'red');
      assert.strictEqual(disk.po, '');
      assert.deepStrictEqual(disk.comments, UPD_RAW.comments);
      assert.ok(!('taskScope' in disk));
      assert.deepStrictEqual(fs.readdirSync(DAY(tmp)).filter((f) => f.endsWith('.tmp')), []);
    });
  });
});

test('roadmap server: /update validates, answers 400/404/409 and writes nothing on refusal', async () => {
  await withDataDir({ 'dt-aaaaaaaa.json': JSON.stringify(UPD_RAW) }, async (tmp) => {
    await withEnv(LIVE, async () => {
      const { ctx, calls } = makeCtx(tmp);
      const run = async (body) => { ctx.readBody = async () => body; await routeOf(ctx, '/update').handler({}, {}); return calls[calls.length - 1]; };
      assert.strictEqual((await run({ patch: { ragStatus: 'red' } })).status, 400);
      assert.strictEqual((await run({ id: 'dt-aaaaaaaa' })).status, 400);
      assert.strictEqual((await run({ id: 'dt-aaaaaaaa', patch: { title: 'hack' } })).status, 400);
      assert.strictEqual((await run({ id: 'dt-aaaaaaaa', patch: { ragStatus: 'purple' } })).body.error, 'bad-patch');
      assert.strictEqual((await run({ id: '../../x', patch: { ragStatus: 'red' } })).status, 404);
      assert.strictEqual((await run({ id: 'nope', patch: { ragStatus: 'red' } })).body.error, 'not-found');
      assert.strictEqual(fs.readFileSync(path.join(DAY(tmp), 'dt-aaaaaaaa.json'), 'utf8'), JSON.stringify(UPD_RAW), 'file untouched');
    });
    await withEnv({ ...LIVE, NODE_ENV: 'test' }, async () => {
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'dt-aaaaaaaa', patch: { ragStatus: 'red' } });
      await routeOf(ctx, '/update').handler({}, {});
      ctx.readBody = async () => ({ order: ['dt-aaaaaaaa'] });
      await routeOf(ctx, '/reorder').handler({}, {});
      assert.deepStrictEqual(calls.map((c) => [c.status, c.body.error]), [[409, 'test-mode'], [409, 'test-mode']]);
    });
  });
  const { ctx, calls } = makeCtx(DIR);
  await withEnv(LIVE, async () => {
    const prev = process.env.DATA_SUB_REPOS_DIR;
    process.env.DATA_SUB_REPOS_DIR = path.join(os.tmpdir(), 'crm-missing-' + process.pid);
    try {
      ctx.readBody = async () => ({ id: 'a', patch: { ragStatus: 'red' } });
      await routeOf(ctx, '/update').handler({}, {});
      assert.strictEqual(calls[0].status, 409);
      assert.strictEqual(calls[0].body.error, 'storage-unavailable');
    } finally {
      if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
    }
  });
});

test('roadmap server: /reorder demands a permutation, renumbers by position and rewrites only changed files', async () => {
  const mk = (id, k, extra = {}) => JSON.stringify({ id, title: id, rank: k, ...extra }, null, 2) + '\n';
  await withDataDir({
    'dt-aaaaaaaa.json': mk('a', 1), 'dt-bbbbbbbb.json': mk('b', 2), 'dt-cccccccc.json': mk('c', 3, { zeta: 1, alfa: 2 }),
    'dt-dddddddd.json': '{ broken',
  }, async (tmp) => {
    await withEnv(LIVE, async () => {
      const { ctx, calls } = makeCtx(tmp);
      const run = async (order) => { ctx.readBody = async () => ({ order }); await routeOf(ctx, '/reorder').handler({}, {}); return calls[calls.length - 1]; };
      for (const bad of [undefined, [], ['a', 'b'], ['a', 'a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'b', 'zz'], 'abc']) {
        const r = await run(bad);
        assert.strictEqual(r.status, 400, JSON.stringify(bad));
        assert.strictEqual(r.body.error, 'bad-order');
      }
      const before = {};
      for (const f of fs.readdirSync(DAY(tmp))) before[f] = fs.readFileSync(path.join(DAY(tmp), f), 'utf8');
      const same = await run(['a', 'b', 'c']);
      assert.strictEqual(same.status, 200);
      assert.strictEqual(same.body.changed, 0);
      const mtimeB = fs.statSync(path.join(DAY(tmp), 'dt-bbbbbbbb.json')).mtimeMs;
      await new Promise((r) => setTimeout(r, 15));
      const r = await run(['c', 'a', 'b']);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(r.body.initiatives.map((i) => [i.id, i.rank]), [['c', 1], ['a', 2], ['b', 3]]);
      assert.strictEqual(r.body.changed, 3);
      const c = fs.readFileSync(path.join(DAY(tmp), 'dt-cccccccc.json'), 'utf8');
      assert.strictEqual(c, JSON.stringify(JSON.parse(c), null, 2) + '\n');
      assert.deepStrictEqual(Object.keys(JSON.parse(c)), ['id', 'title', 'rank', 'zeta', 'alfa'], 'key order kept');
      assert.strictEqual(fs.readFileSync(path.join(DAY(tmp), 'dt-dddddddd.json'), 'utf8'), before['dt-dddddddd.json'], 'broken file untouched');
      assert.ok(fs.statSync(path.join(DAY(tmp), 'dt-bbbbbbbb.json')).mtimeMs >= mtimeB);
      // moving only the last to the end of the same order rewrites nothing
      const noop = await run(['c', 'a', 'b']);
      assert.strictEqual(noop.body.changed, 0);
      assert.deepStrictEqual(fs.readdirSync(DAY(tmp)).filter((f) => f.endsWith('.tmp')), []);
    });
  });
});

test('roadmap server: /reorder numbers an initiative without rank and keeps a pre-numbered one in place', async () => {
  await withDataDir({
    'dt-aaaaaaaa.json': JSON.stringify({ id: 'a' }), 'dt-bbbbbbbb.json': JSON.stringify({ id: 'b', rank: 2 }),
  }, async (tmp) => {
    await withEnv(LIVE, async () => {
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ order: ['a', 'b'] });
      await routeOf(ctx, '/reorder').handler({}, {});
      assert.strictEqual(calls[0].body.changed, 1);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(DAY(tmp), 'dt-aaaaaaaa.json'), 'utf8')), { id: 'a', rank: 1 });
    });
  });
});

test('jira: a failed worklog read keeps the stored MD of the same key; a successful one refreshes it', async () => {
  const stored = { ...RAW, jiraTasks: [{ defId: 'architecture', key: 'DISC-1', summary: 'Solution architecture', timeSpentSeconds: 7200, timeByPerson: { 'Sam Rivera': 7200 }, timeByPersonByDay: { 'Sam Rivera': { '2026-09-30': 7200 } } }] };
  const routesFor = (worklog) => [
    ['issue/DISC-1/worklog', worklog],
    ['issue/PROD-100?fields=customfield', { fields: {} }],
    ['"Epic Link" = PROD-100', { issues: [issue('DISC-1', 'Solution architecture', { timetracking: { timeSpentSeconds: 9000 } })] }],
  ];
  const fetchAndPatch = async (worklog) => {
    const data = await J.fetchSyncData({ http: fakeJira(routesFor(worklog)), cfg: CFG, epic: 'PROD-100', existingDeliveryEpics: [] });
    return J.buildSyncPatch(stored, data);
  };
  const failed = await fetchAndPatch(Object.assign(new Error('HTTP 500'), { status: 500 }));
  const keptTask = failed.jiraTasks.find((t) => t.key === 'DISC-1');
  assert.deepStrictEqual(keptTask.timeByPerson, { 'Sam Rivera': 7200 }, 'transient failure does not zero MD');
  assert.strictEqual(keptTask.timeSpentSeconds, 7200);
  assert.strictEqual(keptTask.summary, 'Solution architecture');
  const fresh = await fetchAndPatch({ worklogs: [{ author: { displayName: 'Rivera Sam' }, timeSpentSeconds: 3600, started: '2026-10-01T08:00:00.000+0200' }] });
  const t = fresh.jiraTasks.find((x) => x.key === 'DISC-1');
  assert.deepStrictEqual(t.timeByPerson, { 'Rivera Sam': 3600 });
  assert.strictEqual(t.timeSpentSeconds, 9000);
  assert.ok(!('worklogFailed' in t) && !('incomplete' in t), 'no transient flag is persisted');
  // empty but successful worklog = really no time logged -> refreshed to empty
  const empty = await fetchAndPatch({ worklogs: [] });
  assert.deepStrictEqual(empty.jiraTasks.find((x) => x.key === 'DISC-1').timeByPerson, {});
});

test('jira: MD after a sync equals the reference sum (tasks + unmatched + delivery epics + subtasks), keys stay mapped', async () => {
  await withDataDir({ 'dt-aaaaaaaa.json': JSON.stringify(RAW, null, 2) + '\n' }, async (tmp) => {
    await withEnv(LIVE, async () => {
      const wl = (name, s) => ({ worklogs: [{ author: { displayName: name }, timeSpentSeconds: s, started: '2026-10-01T08:00:00.000+0200' }] });
      register._setHttpForTests(fakeJira([
        ['issue/DISC-1/worklog', wl('Rivera Sam', 3600)],
        ['issue/DISC-6/worklog', wl('Jordan Lee', 1800)],
        ['issue/DISC-7/worklog', wl('Jordan Lee', 600)],
        ['issue/PROD-200/worklog', wl('Casey Novak', 900)],
        ...syncRoutes(),
      ]));
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'dt-aaaaaaaa' });
      await routeOf(ctx, '/jira-sync').handler({}, {});
      assert.strictEqual(calls[0].status, 200, JSON.stringify(calls[0].body));
      const disk = JSON.parse(fs.readFileSync(path.join(DAY(tmp), 'dt-aaaaaaaa.json'), 'utf8'));
      const old = {}; // a reference accumulation, written out independently
      const add = (m) => { for (const [n, v] of Object.entries(m || {})) old[n] = (old[n] || 0) + v; };
      for (const x of disk.jiraTasks) add(x.timeByPerson);
      for (const x of disk.jiraUnmatched) add(x.timeByPerson);
      for (const e of disk.deliveryEpics) { add(e.timeByPerson); for (const sub of e.subtasks || []) add(sub.timeByPerson); }
      const total = H.timeByPersonTotals(disk).total;
      assert.strictEqual(total, Object.values(old).reduce((a, b) => a + b, 0));
      assert.strictEqual(total, 3600 + 1800 + 600 + 900);
      assert.strictEqual(H.formatMd(total), '0,2 MD');
      const mapped = disk.jiraTasks.filter((t) => t.key).map((t) => t.defId + '=' + t.key).sort();
      assert.deepStrictEqual(mapped, ['architecture=DISC-1', 'requirements-breakdown=DISC-5']);
    });
  });
});

test('roadmap client: no details panel, 11 columns, no slug deep link, edit hooks and the sync modal present', () => {
  const src = read('client/index.js');
  for (const gone of ['data-crm-open', '_paintPreview', '_previewHtml', 'data-crm-back', 'data-crm-sync-one', 'findBySlug', 'slugify', 'crm-title-btn', 'SVG_EYE', 'Initiative preview']) {
    assert.ok(!src.includes(gone), 'dead preview code left: ' + gone);
  }
  assert.ok(!/old cockpit/i.test(src));
  const head = src.slice(src.indexOf('<thead>'), src.indexOf('</thead>'));
  assert.strictEqual((head.match(/<th[ >]/g) || []).length, 11);
  for (const hook of ['data-crm-rag', 'data-crm-stage', 'data-crm-date', 'data-crm-people', 'data-crm-drag', 'data-crm-move', 'data-crm-rank', 'data-crm-rank-input', 'crm-rank-input', 'moveToPosition', "'/update'", "'/reorder'", "'/jira-sync'", 'crm-sync-cancel', 'ds-progress-fill']) {
    assert.ok(src.includes(hook), 'missing: ' + hook);
  }
  assert.ok(src.includes("'Content-Type': 'application/json'"));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(read('client/style.css')), 'no hex colours');
  assert.ok(!/crm-pv-|crm-step|crm-comment|crm-task-/.test(read('client/style.css')), 'preview CSS removed');
});

test('jira sync keeps the stored slot shape: every jiraTasks entry carries statusName and timeByPersonByDay in file order', () => {
  const ORDER = ['defId', 'key', 'summary', 'statusCategory', 'statusName', 'assignee', 'updated', 'url', 'timeSpentSeconds', 'timeByPerson', 'timeByPersonByDay'];
  // Jira returned nothing for this epic: every slot is empty.
  const { tasks } = J.reconcileIssues([], []);
  for (const t of tasks) assert.deepStrictEqual(Object.keys(t), ORDER, t.defId);
  // A stored file in the full shape, merged with an empty server answer, keeps its shape.
  const init = { jiraTasks: tasks.map((t) => ({ ...t })), jiraUnmatched: [] };
  const merged = J.mergeJiraTasks(init, tasks.map((t) => {
    const { statusName, timeByPersonByDay, ...legacy } = t; // the old, shorter slot
    void statusName; void timeByPersonByDay;
    return legacy;
  }), []);
  for (const t of merged.jiraTasks) {
    assert.deepStrictEqual(Object.keys(t), ORDER, t.defId);
    assert.strictEqual(t.statusName, null);
    assert.deepStrictEqual(t.timeByPersonByDay, {});
  }
});

// ---- Activity strip ------------------------------------------------------------


const ymd = (d) => H.toYmd(d);

test('helpers: stripDays gives ten past working days, today and the next working day', () => {
  // Wednesday 2026-09-30 -> tomorrow Thursday 2026-10-01
  const days = H.stripDays(new Date(2026, 8, 30, 15, 0));
  assert.strictEqual(days.length, 12);
  assert.deepStrictEqual(days.slice(-2).map((d) => [d.dateStr, d.zone]), [['2026-09-30', 'today'], ['2026-10-01', 'tomorrow']]);
  assert.ok(days.slice(0, 10).every((d) => d.zone === 'past' && d.dow !== 0 && d.dow !== 6));
  assert.strictEqual(days[9].dateStr, '2026-09-29');
  assert.strictEqual(days[0].dateStr, '2026-09-16');
});

test('helpers: stripDays on a Saturday keeps today and jumps to Monday; skips holidays', () => {
  const sat = H.stripDays(new Date(2026, 9, 3));
  assert.strictEqual(sat[10].dateStr, '2026-10-03');
  assert.strictEqual(sat[10].dow, 6);
  assert.strictEqual(sat[11].dateStr, '2026-10-05');
  assert.strictEqual(sat[9].dateStr, '2026-10-02');
  // Friday 2026-04-03: Easter Monday 2026-04-06 is a holiday -> tomorrow is Tuesday 07
  const fri = H.stripDays(new Date(2026, 3, 3));
  assert.strictEqual(fri[11].dateStr, '2026-04-07');
  // 2026-05-01 (Fri) and 05-03 are holidays: the past list from Tue 05-05 skips 05-01
  const may = H.stripDays(new Date(2026, 4, 5));
  assert.ok(!may.map((d) => d.dateStr).includes('2026-05-01'));
});

test('helpers: roleForAssignee, rolePersons and the role filter', () => {
  const inits = [{ po: 'Taylor Kim', analyst: 'Alex Morgan', designer: '', deliveryEpics: [{ subtasks: [{ assignee: 'Robin Dev', statusCategory: 'indeterminate' }] }] }];
  assert.strictEqual(H.roleForAssignee(inits[0], 'Kim Taylor'), 'po');
  assert.strictEqual(H.roleForAssignee(inits[0], 'Robin Dev'), 'analyst');
  assert.strictEqual(H.roleForAssignee(inits[0], 'Robin Dev', () => 'Senior Designer'), 'designer');
  assert.deepStrictEqual([...H.rolePersons(inits, 'all')].sort(), ['Alex Morgan', 'Robin Dev', 'Taylor Kim']);
  assert.deepStrictEqual([...H.rolePersons(inits, 'po')], ['Taylor Kim']);
  assert.deepStrictEqual([...H.rolePersons(inits, 'analyst')].sort(), ['Alex Morgan', 'Robin Dev']);
});

test('helpers: buildActivityStrip - past = logged time on the roadmap by assigned people, today/tomorrow = in-progress work, role filter narrows', () => {
  const inits = [{
    id: 'a', title: 'Init A', po: 'Taylor Kim', analyst: 'Alex Morgan', rank: 1, ticket: 'DISC-100',
    jiraTasks: [
      { defId: 'process-mapping', key: 'DISC-1', statusCategory: 'indeterminate', assignee: 'Alex Morgan', statusName: 'In progress', summary: 'Mapping', timeByPersonByDay: { 'Morgan Alex': { '2026-09-29': 3600 }, 'Stranger Person': { '2026-09-29': 600 } } },
      { defId: 'scope-gate-start', key: 'DISC-2', statusCategory: 'done', assignee: 'Taylor Kim' },
    ],
    jiraUnmatched: [{ key: 'DISC-3', statusCategory: 'indeterminate', assignee: 'Taylor Kim', summary: 'x', timeByPersonByDay: { 'Taylor Kim': { '2026-09-28': 1800, '2000-01-01': 5 } } }],
    deliveryEpics: [{ key: 'PROD-9', timeByPersonByDay: { 'Alex Morgan': { '2026-09-28': 900 } }, subtasks: [{ key: 'PROD-10', timeByPersonByDay: { 'Alex Morgan': { '2026-09-25': 7200 } } }] }],
  }];
  const tempo = { discoveryKeys: [], worklogs: {
    'Morgan Alex': { '2026-09-29': [{ issueKey: 'DISC-1', seconds: 3600, summary: 'dup' }], '2026-09-24': [{ issueKey: 'DISC-3', seconds: 1200, summary: 'From tempo' }, { issueKey: 'OTHER-9', seconds: 99 }] },
    'Stranger Person': { '2026-09-29': [{ issueKey: 'DISC-1', seconds: 60 }] },
  } };
  const canon = (n) => ({ 'Kim Taylor': 'Taylor Kim', 'Morgan Alex': 'Alex Morgan' }[n] || n);
  const today = new Date(2026, 8, 30);
  const all = H.buildActivityStrip({ initiatives: inits, tempo, today, roleFilter: 'all', canonical: canon });
  const byDate = Object.fromEntries(all.days.map((d) => [d.dateStr, d.names]));
  assert.deepStrictEqual(byDate['2026-09-29'], ['Alex Morgan']); // the stranger is not assigned to an initiative
  assert.deepStrictEqual(byDate['2026-09-28'], ['Alex Morgan', 'Taylor Kim']);
  assert.deepStrictEqual(byDate['2026-09-24'], ['Alex Morgan']); // tempo covers more
  assert.deepStrictEqual(byDate['2026-09-25'], ['Alex Morgan']); // subtask of a delivery epic
  assert.deepStrictEqual(byDate['2026-09-30'], ['Alex Morgan', 'Taylor Kim']);
  assert.deepStrictEqual(byDate['2026-10-01'], ['Alex Morgan', 'Taylor Kim']);
  assert.deepStrictEqual(byDate['2026-09-23'], []);
  // no double counting of the same issue/day present in both sources
  assert.strictEqual(all.worklogs['2026-09-29']['Alex Morgan'].length, 1);
  assert.strictEqual(all.worklogs['2026-09-29']['Alex Morgan'][0].loggedSeconds, 3600);
  assert.strictEqual(all.worklogs['2026-09-29']['Alex Morgan'][0].title, 'Init A');
  assert.deepStrictEqual(all.worklogs['2026-09-28']['Alex Morgan'].map((e) => e.jiraKey), ['PROD-9']);
  assert.strictEqual(all.worklogs['2026-09-24']['Alex Morgan'].length, 1); // OTHER-9 is not on the roadmap
  const po = H.buildActivityStrip({ initiatives: inits, tempo, today, roleFilter: 'po', canonical: canon });
  assert.deepStrictEqual(po.days.find((d) => d.dateStr === '2026-09-28').names, ['Taylor Kim']);
  assert.deepStrictEqual(po.days.find((d) => d.dateStr === '2026-09-29').names, []);
  assert.deepStrictEqual(po.days.find((d) => d.zone === 'today').names, ['Taylor Kim']);
  const an = H.buildActivityStrip({ initiatives: inits, tempo, today, roleFilter: 'analyst', canonical: canon });
  assert.deepStrictEqual(an.days.find((d) => d.zone === 'tomorrow').names, ['Alex Morgan']);
  const none = H.buildActivityStrip({ initiatives: [], tempo: H.normalizeTempo(null), today, roleFilter: 'all', canonical: canon });
  assert.ok(none.days.every((d) => d.names.length === 0));
  assert.strictEqual(ymd(today), '2026-09-30');
});

test('helpers: formatHours and normalizeTempo', () => {
  assert.strictEqual(H.formatHours(3600), '1h');
  assert.strictEqual(H.formatHours(5400), '1.5h');
  assert.deepStrictEqual(H.normalizeTempo({ worklogs: [], discoveryKeys: 'x' }), { worklogs: {}, discoveryKeys: [], dateFrom: null, dateTo: null, fetchedAt: null });
  assert.deepStrictEqual(H.normalizeTempo({ worklogs: { a: {} }, discoveryKeys: ['K-1'], dateFrom: '2026-01-01' }).discoveryKeys, ['K-1']);
});

test('roadmap server: /tempo serves the file, an empty structure when missing or broken, 409 without storage - and writes nothing', async () => {
  await withDataDir({}, async (tmp) => {
    const { ctx, calls } = makeCtx(tmp);
    await routeOf(ctx, '/tempo').handler({}, {});
    assert.strictEqual(calls[0].status, 200);
    assert.deepStrictEqual(calls[0].body.worklogs, {});
    assert.deepStrictEqual(calls[0].body.discoveryKeys, []);
    const file = path.join(tmp, 'ds-data', 'discovery-tasks-tempo.json');
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: 'x', dateFrom: '2026-06-14', dateTo: '2026-09-14', discoveryKeys: ['DISC-1'], worklogs: { A: { '2026-09-10': [{ issueKey: 'DISC-1', seconds: 60 }] } } }));
    await routeOf(ctx, '/tempo').handler({}, {});
    assert.strictEqual(calls[1].status, 200);
    assert.deepStrictEqual(calls[1].body.discoveryKeys, ['DISC-1']);
    assert.strictEqual(calls[1].body.worklogs.A['2026-09-10'][0].seconds, 60);
    fs.writeFileSync(file, '{ bad');
    await routeOf(ctx, '/tempo').handler({}, {});
    assert.strictEqual(calls[2].status, 200);
    assert.deepStrictEqual(calls[2].body.worklogs, {});
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ bad');
  });
  await withDataDir(null, async (tmp) => {
    const { ctx, calls } = makeCtx(tmp);
    await routeOf(ctx, '/tempo').handler({}, {});
    assert.strictEqual(calls[0].status, 409);
    assert.strictEqual(calls[0].body.error, 'storage-unavailable');
  });
});

// ---- Row edit mode: draft -> one combined patch -------------------------------

test('helpers: draftChanges keeps only fields that really differ', () => {
  const init = { ragStatus: 'amber', stageStatus: ['delivery'], discoveryEnd: '2026-08-31', deliveryEnd: '', goLiveDate: '', po: 'Kim Taylor', analyst: '', designer: 'X', architect: '' };
  const canon = (n) => (n === 'Kim Taylor' ? 'Taylor Kim' : n);
  assert.deepStrictEqual(H.draftChanges(init, {}, canon), {});
  // equal to stored value, to the canonical form, same stage set in another order, '' vs null: no change
  assert.deepStrictEqual(H.draftChanges(init, { ragStatus: 'amber', po: 'Taylor Kim', stageStatus: ['delivery'], deliveryEnd: '', analyst: '' }, canon), {});
  assert.deepStrictEqual(H.draftChanges(init, {
    ragStatus: null, analyst: ' Alex Morgan ', architect: 'Eve Z', stageStatus: ['pilot', 'delivery'], goLiveDate: '2026-12-31', discoveryEnd: '2026-08-31',
  }, canon), { ragStatus: null, analyst: 'Alex Morgan', architect: 'Eve Z', stageStatus: ['pilot', 'delivery'], goLiveDate: '2026-12-31' });
  assert.deepStrictEqual(H.draftChanges(init, { po: '' }, canon), { po: '' });
  assert.deepStrictEqual(H.draftChanges(init, { title: 'nope', rank: 3 }, canon), {});
});

test('helpers: cellChanged maps changed fields to table cells', () => {
  const init = { ragStatus: null, po: 'A', designer: 'B', analyst: 'C', architect: 'D', stageStatus: [] };
  const draft = { architect: 'E', stageStatus: ['pilot'] };
  assert.strictEqual(H.cellChanged(init, draft, 'analyst,architect'), true);
  assert.strictEqual(H.cellChanged(init, draft, 'stages'), true);
  assert.strictEqual(H.cellChanged(init, draft, 'po,designer'), false);
  assert.strictEqual(H.cellChanged(init, draft, 'rag'), false);
});

test('helpers: buildEditPatch builds ONE validated combined patch, empty and invalid drafts send nothing', () => {
  const init = { ragStatus: 'red', stageStatus: [], discoveryEnd: '2026-08-31', po: 'A', analyst: '', architect: '' };
  assert.deepStrictEqual(H.buildEditPatch(init, {}), { ok: false, empty: true });
  assert.deepStrictEqual(H.buildEditPatch(init, { po: 'A' }), { ok: false, empty: true });
  const r = H.buildEditPatch(init, { analyst: 'Alex Morgan', architect: 'Eve Z', discoveryEnd: '2026-09-30', goLiveDate: '2026-12-31', stageStatus: ['delivery', 'pilot'], ragStatus: 'green' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.patch, { analyst: 'Alex Morgan', architect: 'Eve Z', discoveryEnd: '2026-09-30', goLiveDate: '2026-12-31', stageStatus: ['delivery', 'pilot'], ragStatus: 'green' });
  assert.strictEqual(H.validateInitiativePatch(r.patch).ok, true);
  const bad = H.buildEditPatch(init, { discoveryEnd: '2026-13-45' });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.message);
  const tooLong = H.buildEditPatch(init, { analyst: 'x'.repeat(121) });
  assert.strictEqual(tooLong.ok, false);
});

test('roadmap client: row edit mode - no grey lock, one combined POST /update', () => {
  const src = read('client/index.js');
  const css = read('client/style.css');
  assert.ok(!/crm-row--busy/.test(src + css), 'the grey lock is gone');
  assert.ok(src.includes('crm-row--editing') && css.includes('--state-warning-icon'));
  assert.strictEqual((src.match(/'\/update'/g) || []).length, 1, 'exactly one place posts to /update');
  assert.ok(src.includes('data-crm-edit-save') && src.includes('data-crm-edit-cancel'));
});

test('roadmap server: /delete removes exactly one file, keeps the others and their rank, 404 / 400 / test-mode / unavailable', async () => {
  const mk = (id, k) => JSON.stringify({ id, title: id, rank: k }, null, 2) + '\n';
  await withDataDir({ 'dt-aaaaaaaa.json': mk('a', 1), 'dt-bbbbbbbb.json': mk('b', 2), 'dt-cccccccc.json': mk('c', 3) }, async (tmp) => {
    await withEnv(LIVE, async () => {
      const { ctx, calls } = makeCtx(tmp);
      const run = async (body) => { ctx.readBody = async () => body; await routeOf(ctx, '/delete').handler({}, {}); return calls[calls.length - 1]; };
      const before = fs.readFileSync(path.join(DAY(tmp), 'dt-cccccccc.json'), 'utf8');
      const ok = await run({ id: 'b' });
      assert.strictEqual(ok.status, 200);
      assert.deepStrictEqual(fs.readdirSync(DAY(tmp)).sort(), ['dt-aaaaaaaa.json', 'dt-cccccccc.json']);
      assert.strictEqual(fs.readFileSync(path.join(DAY(tmp), 'dt-cccccccc.json'), 'utf8'), before, 'rank of the others untouched');
      assert.strictEqual((await run({ id: 'b' })).status, 404);
      for (const bad of [{}, { id: '' }, { id: 42 }, { id: '../x' }, { id: 'a/b' }, { id: '..' }, { id: 'a.json' }]) {
        assert.strictEqual((await run(bad)).status, 400, JSON.stringify(bad));
      }
      assert.strictEqual(fs.readdirSync(DAY(tmp)).length, 2);
    });
    await withEnv({ NODE_ENV: 'test' }, async () => {
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'a' });
      await routeOf(ctx, '/delete').handler({}, {});
      assert.strictEqual(calls[0].status, 409);
      assert.strictEqual(calls[0].body.error, 'test-mode');
      assert.ok(fs.existsSync(path.join(DAY(tmp), 'dt-aaaaaaaa.json')));
    });
  });
  await withDataDir(null, async (tmp) => {
    await withEnv(LIVE, async () => {
      const { ctx, calls } = makeCtx(tmp);
      ctx.readBody = async () => ({ id: 'a' });
      await routeOf(ctx, '/delete').handler({}, {});
      assert.strictEqual(calls[0].status, 409);
      assert.strictEqual(calls[0].body.error, 'storage-unavailable');
    });
  });
});

test('roadmap client: the trash button exists only in edit mode and a confirmation precedes the one POST /delete', () => {
  const src = read('client/index.js');
  assert.strictEqual((src.match(/'\/delete'/g) || []).length, 1);
  const cells = src.slice(src.indexOf('function _editCells'), src.indexOf('function _rowInner'));
  assert.ok(cells.includes('data-crm-edit-delete') && cells.includes('aria-label="Delete initiative"'));
  assert.ok(!src.slice(src.indexOf('function _rowInner'), src.indexOf('function _rowHtml')).includes('data-crm-edit-delete'), 'not in the plain row');
  const fn = src.slice(src.indexOf('async function _deleteEditRow'), src.indexOf('async function _applyOrder'));
  assert.ok(fn.indexOf('confirmDsModal') > -1 && fn.indexOf('confirmDsModal') < fn.indexOf("'/delete'"), 'confirm before POST');
  assert.ok(fn.includes('Do you really want to delete the initiative "') && fn.includes("okLabel: 'Delete'") && fn.includes('the Jira issue stays'));
  assert.ok(fn.includes('_repaintTable') && fn.includes('_repaintStrip'));
});

// ---- Other (non-roadmap) logged time in the day popover ------------------------

test('roadmap: splitDayWorklogs separates roadmap keys from the rest, sums per key', async () => {
  const H = await import(path.join(DIR, 'client', 'helpers.js'));
  const keys = H.roadmapKeySet([{ ticket: 'prod-1', jiraTasks: [{ key: 'DISC-5' }], deliveryEpics: [{ key: 'PROD-9', subtasks: [{ key: 'PROD-10' }] }] }]);
  assert.ok(keys.has('PROD-1') && keys.has('DISC-5') && keys.has('PROD-10'));
  const r = H.splitDayWorklogs([
    { issueKey: 'DISC-5', seconds: 3600, summary: 'a' },
    { issueKey: 'PROD-77', seconds: 1800, summary: 'Daily' },
    { issueKey: 'PROD-77', seconds: 1800 },
    { issueKey: 'PROD-80', seconds: 7200, summary: 'Big' },
    { issueKey: 'PROD-81', seconds: 0 }, { issueKey: '', seconds: 5 }, null,
  ], keys);
  assert.strictEqual(r.roadmap.length, 1);
  assert.deepStrictEqual(r.other.map((o) => [o.jiraKey, o.loggedSeconds, o.summary]), [['PROD-80', 7200, 'Big'], ['PROD-77', 3600, 'Daily']]);
  assert.deepStrictEqual(H.splitDayWorklogs(undefined, keys), { roadmap: [], other: [] });
});

test('roadmap: otherWorklogsFor matches the person without diacritics and skips roadmap keys', async () => {
  const H = await import(path.join(DIR, 'client', 'helpers.js'));
  const all = { 'Morgan Blake': { '2026-10-01': [{ issueKey: 'PROD-5', seconds: 3600, summary: 'X' }, { issueKey: 'DISC-1', seconds: 600 }] } };
  const out = H.otherWorklogsFor(all, 'Morgan Blake', '2026-10-01', new Set(['DISC-1']));
  assert.deepStrictEqual(out.map((o) => o.jiraKey), ['PROD-5']);
  assert.deepStrictEqual(H.otherWorklogsFor(all, 'Somebody Else', '2026-10-01', new Set()), []);
  assert.deepStrictEqual(H.otherWorklogsFor({}, 'Morgan Blake', '2026-10-01', new Set()), []);
});

test('roadmap: formatDayTotal and safeJiraHref', async () => {
  const H = await import(path.join(DIR, 'client', 'helpers.js'));
  assert.strictEqual(H.formatDayTotal(10800, 0), '3h');
  assert.strictEqual(H.formatDayTotal(10800, 7200), '5h (3h roadmap)');
  assert.strictEqual(H.formatDayTotal(0, 5400), '1.5h');
  assert.strictEqual(H.formatDayTotal(0, 0), '');
  assert.strictEqual(H.safeJiraHref('https://j.example/browse/', 'PROD-12'), 'https://j.example/browse/PROD-12');
  assert.strictEqual(H.safeJiraHref('javascript:alert(1)//', 'PROD-12'), '');
  assert.strictEqual(H.safeJiraHref('https://j.example/browse/', 'x"><b'), '');
  assert.deepStrictEqual(H.normalizeWorklogs(null), { available: false, worklogs: {} });
});

test('roadmap server: /worklogs reads time-log shards read-only; missing data is empty', async () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-wl-'));
  try {
    assert.deepStrictEqual(register.readAllWorklogs(tmp), { available: false, worklogs: {} });
    assert.deepStrictEqual(register.readAllWorklogs(undefined), { available: false, worklogs: {} });
    const dir = path.join(tmp, 'time-log', 'people');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'morgan-blake.json'), JSON.stringify({ name: 'Morgan Blake', days: [
      { date: '2026-10-01', issues: [{ key: 'PROD-5', summary: 'Task', hours: 1.5 }, { key: 'PROD-6', hours: 0 }] },
      { date: '2026-09-30', issues: [] },
    ] }));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
    const before = fs.readdirSync(dir).sort();
    assert.deepStrictEqual(register.readAllWorklogs(tmp), { available: true, worklogs: { 'Morgan Blake': { '2026-10-01': [{ issueKey: 'PROD-5', summary: 'Task', seconds: 5400 }] } } });
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), before);
    const { ctx, calls } = makeCtx(tmp);
    ctx.dataTier0Dir = tmp;
    await routeOf(ctx, '/worklogs').handler({}, {});
    assert.strictEqual(calls[0].status, 200);
    assert.strictEqual(calls[0].body.available, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- Tabs and the timeline ---------------------------------------------

test('roadmap: tabFromSubPath / tabHash route the three tabs', async () => {
  const H = await import(path.join(DIR, 'client', 'helpers.js'));
  assert.deepStrictEqual(H.VIEW_TABS.map((t) => t.id), ['table', 'timeline', 'kanban']);
  assert.strictEqual(H.tabFromSubPath('timeline'), 'timeline');
  assert.strictEqual(H.tabFromSubPath('/Kanban?x=1'), 'kanban');
  assert.strictEqual(H.tabFromSubPath('#timeline/abc'), 'timeline');
  for (const bad of ['', undefined, null, 'anything', 'table2', 42]) assert.strictEqual(H.tabFromSubPath(bad), 'table');
  assert.strictEqual(H.tabHash('roadmap-main', 'timeline'), '#roadmap-main/timeline');
  assert.strictEqual(H.tabHash('roadmap-main', 'table'), '#roadmap-main');
  assert.strictEqual(H.tabHash('roadmap-main', 'bogus'), '#roadmap-main');
});

test('roadmap: dayNumber validates dates, localYmd and yearOptions', async () => {
  const R = await import(path.join(DIR, 'client', 'roadmap-helpers.js'));
  assert.ok(Number.isNaN(R.dayNumber('2026-02-30')));
  assert.ok(Number.isNaN(R.dayNumber('26-1-1')));
  assert.strictEqual(R.dayNumber('2026-01-02') - R.dayNumber('2026-01-01'), 1);
  assert.strictEqual(R.dayToYmd(R.dayNumber('2026-10-03')), '2026-10-03');
  assert.strictEqual(R.daysInYear(2024), 366);
  assert.strictEqual(R.daysInYear(2026), 365);
  assert.strictEqual(R.localYmd(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.deepStrictEqual(R.yearOptions([{ deliveryEnd: '2028-03-01' }, { goLiveDate: 'x' }], 2026), [2025, 2026, 2027, 2028]);
});

test('roadmap: buildScale gives month and quarter headers that tile 100%', async () => {
  const R = await import(path.join(DIR, 'client', 'roadmap-helpers.js'));
  const s = R.buildScale(2026);
  assert.strictEqual(s.months.length, 12);
  assert.deepStrictEqual(s.quarters.map((q) => q.label), ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
  assert.ok(Math.abs(s.quarters.reduce((a, q) => a + q.widthPct, 0) - 100) < 1e-9);
  assert.ok(Math.abs(s.quarters[1].leftPct - 25) < 1e-9);
  assert.strictEqual(R.headerCells(s, 'quarters').length, 4);
  assert.strictEqual(R.headerCells(s, 'months').length, 12);
  assert.strictEqual(R.gridLines(s, 'months').length, 11);
  assert.strictEqual(R.MONTH_LABELS[9], 'Oct');
});

test('roadmap: dayToPct maps dates, clamps outside the year and honours collapsed quarters', async () => {
  const R = await import(path.join(DIR, 'client', 'roadmap-helpers.js'));
  const s = R.buildScale(2026);
  assert.strictEqual(R.ymdToPct(s, '2026-01-01'), 0);
  assert.ok(Math.abs(R.ymdToPct(s, '2026-04-01') - 25) < 1e-9);
  assert.ok(Math.abs(R.ymdToPct(s, '2026-07-01') - 50) < 1e-9);
  assert.strictEqual(R.ymdToPct(s, '2025-06-01'), 0);
  assert.ok(Math.abs(R.ymdToPct(s, '2027-06-01') - 100) < 1e-9);
  assert.strictEqual(R.ymdToPct(s, 'x'), null);
  const c = R.buildScale(2026, [0]);
  assert.ok(c.quarters[0].widthPct < 5 && c.quarters[0].collapsed);
  assert.ok(Math.abs(R.ymdToPct(c, '2026-04-01') - c.quarters[0].widthPct) < 1e-9);
  assert.ok(Math.abs(c.quarters.reduce((a, q) => a + q.widthPct, 0) - 100) < 1e-9);
  assert.deepStrictEqual(R.toggleCollapsed([], 2), [2]);
  assert.deepStrictEqual(R.toggleCollapsed([2, 0], 2), [0]);
  assert.deepStrictEqual(R.toggleCollapsed([1], 9), [1]);
});

test('roadmap: todayPct places the marker only inside the year', async () => {
  const R = await import(path.join(DIR, 'client', 'roadmap-helpers.js'));
  const s = R.buildScale(2026);
  assert.ok(Math.abs(R.todayPct(s, '2026-07-01') - 50) < 1e-9);
  assert.strictEqual(R.todayPct(s, '2025-12-31'), null);
  assert.strictEqual(R.todayPct(s, '2027-01-01'), null);
  assert.strictEqual(R.todayPct(s, 'zle'), null);
});

test('roadmap: computeBarStart, classifyPhase and phaseCounts follow the phase rules', async () => {
  const R = await import(path.join(DIR, 'client', 'roadmap-helpers.js'));
  const init = {
    discoveryEnd: '2026-05-10',
    jiraTasks: [{ timeByPersonByDay: { A: { '2026-03-02': 60 }, B: { '2026-02-11': 60 } } }],
    deliveryEpics: [{ timeByPersonByDay: { C: { '2026-04-01': 5 } }, subtasks: [{ timeByPersonByDay: { D: { '2026-01-20': 5 } } }] }],
  };
  assert.strictEqual(R.computeBarStart(init), '2026-01-20');
  assert.strictEqual(R.computeBarStart({ discoveryEnd: '2026-05-10' }), '2026-05-10');
  assert.strictEqual(R.computeBarStart({}), null);
  assert.strictEqual(R.countLoggedPersons(init), 4);
  assert.strictEqual(R.classifyPhase({}, '2026-06-01'), 'no-dates');
  assert.strictEqual(R.classifyPhase({ discoveryEnd: '2026-05-10', deliveryEnd: '2026-09-01' }, '2026-05-09'), 'discovery');
  assert.strictEqual(R.classifyPhase({ discoveryEnd: '2026-05-10', deliveryEnd: '2026-09-01' }, '2026-05-10'), 'delivery');
  assert.strictEqual(R.classifyPhase({ discoveryEnd: '2026-05-10', deliveryEnd: '2026-09-01' }, '2026-09-01'), 'finished');
  assert.strictEqual(R.classifyPhase({ deliveryEnd: '2026-09-01' }, '2026-06-01'), 'discovery');
  const c = R.phaseCounts([{}, { discoveryEnd: '2026-12-01' }, { deliveryEnd: '2026-01-01' }], '2026-06-01');
  assert.deepStrictEqual(c, { total: 3, discovery: 1, delivery: 0, finished: 1, 'no-dates': 1 });
});

test('roadmap: barModel draws discovery + delivery segments, the go-live marker and hides what is outside the year', async () => {
  const R = await import(path.join(DIR, 'client', 'roadmap-helpers.js'));
  const s = R.buildScale(2026);
  const b = R.barModel({ discoveryEnd: '2026-04-01', deliveryEnd: '2026-07-01', goLiveDate: '2026-10-01', jiraTasks: [{ timeByPersonByDay: { A: { '2026-01-01': 1 } } }] }, s);
  assert.strictEqual(b.visible, true);
  assert.ok(Math.abs(b.disc.left) < 1e-9 && Math.abs(b.disc.width - 25) < 1e-9);
  assert.ok(Math.abs(b.del.left - 25) < 1e-9 && Math.abs(b.del.width - 25) < 1e-9);
  assert.ok(b.goLive && b.goLive.left > 74 && b.goLive.left < 76);
  const onlyDel = R.barModel({ deliveryEnd: '2026-07-01' }, s);
  assert.strictEqual(onlyDel.disc.width > 0, true);
  assert.strictEqual(onlyDel.visible, true);
  const outside = R.barModel({ discoveryEnd: '2025-02-01', deliveryEnd: '2025-06-01', goLiveDate: '2025-07-01' }, s);
  assert.deepStrictEqual([outside.visible, outside.disc, outside.del, outside.goLive], [false, null, null, null]);
  const none = R.barModel({}, s);
  assert.strictEqual(none.visible, false);
  const clipped = R.barModel({ discoveryEnd: '2025-11-01', deliveryEnd: '2026-02-01' }, s);
  assert.ok(clipped.visible && clipped.disc === null && clipped.del.left === 0 && clipped.del.width > 0);
  assert.deepStrictEqual(R.stageLabels({ stageStatus: ['pilot', 'preparation'] }, [{ id: 'preparation', short: 'Prep' }, { id: 'pilot', short: 'Pil' }]), ['Prep', 'Pil']);
});

test('roadmap: the client wires three tabs, a Kanban stub module and no new write routes for the roadmap', () => {
  const idx = read('client/index.js');
  assert.match(idx, /from '\.\/roadmap\.js'/);
  assert.match(idx, /from '\.\/kanban\.js'/);
  assert.match(idx, /data-crm-tab/);
  assert.match(idx, /history\.replaceState/);
  assert.match(read('client/kanban.js'), /export function renderKanban\(root, deps\)/);
  assert.ok(!/fetch\(|method:\s*'POST'/.test(read('client/roadmap.js')), 'the roadmap tab is read-only');
});

// ---- Kanban tab --------------------------------------------------------------------

const KH = await import(path.join(DIR, 'client', 'kanban-helpers.js'));
const KS = require(path.join(DIR, 'server', 'kanban.js'));

const kIssue = (key, statusId, extra = {}) => ({ key, summary: 'Task ' + key, statusId, statusName: 'x', assignee: null, issueType: 'Task', priority: 'Medium', updated: '2026-10-01T10:00:00.000+0200', ...extra });

test('kanban helpers: columns bucket by status id; unknown statuses (Cancelled) are dropped', () => {
  assert.deepStrictEqual(KH.KANBAN_COLUMNS.map((c) => c.id), ['preparation', 'todo', 'in-progress', 'blocked', 'done']);
  assert.strictEqual(KH.colForStatus(1).id, 'preparation');
  assert.strictEqual(KH.colForStatus(11100).id, 'preparation');
  assert.strictEqual(KH.colForStatus('10804').id, 'todo');
  assert.strictEqual(KH.colForStatus(11711), null);
  assert.strictEqual(KH.colForStatus(null), null);
  const g = KH.groupBoard({
    issues: [kIssue('DISC-1', 3), kIssue('DISC-2', 11711), kIssue('DISC-3', 10100), kIssue('DISC-4', 3), kIssue('DISC-5', 1)],
    lanes: [{ id: 'b', title: 'B', rank: 2, epicKey: 'PROD-2' }, { id: 'a', title: 'A', rank: 1, epicKey: 'PROD-1' }, { id: 'c', title: 'Pusta', rank: 3 }],
    laneMap: { 'DISC-1': 'a', 'DISC-3': 'a', 'DISC-4': 'b' },
  });
  assert.deepStrictEqual(g.lanes.map((l) => [l.id, l.total]), [['a', 2], ['b', 1], ['c', 0], ['__other__', 1]]);
  assert.deepStrictEqual(g.colTotals, { preparation: 1, 'todo': 0, 'in-progress': 2, blocked: 0, done: 1 });
  assert.strictEqual(g.total, 4);
  assert.strictEqual(g.lanes[3].title, 'Other (not assigned to an initiative)');
});

test('kanban helpers: filters (search without diacritics, unassigned, persons) and empty lanes while filtering', () => {
  const board = {
    issues: [
      kIssue('DISC-1', 3, { summary: 'Zażółć orders', assignee: { displayName: 'Sam Rivera' } }),
      kIssue('DISC-2', 3, { summary: 'Other' }),
      kIssue('DISC-3', 3, { assignee: { displayName: 'Jordan Lee' } }),
    ],
    lanes: [{ id: 'a', title: 'A', rank: 1 }, { id: 'b', title: 'B', rank: 2 }],
    laneMap: { 'DISC-1': 'a', 'DISC-3': 'b' },
  };
  const ids = (f) => KH.groupBoard(board, f).lanes.flatMap((l) => Object.values(l.cols).flat()).map((i) => i.key);
  assert.deepStrictEqual(ids({ search: 'zazolc ord' }), ['DISC-1']);
  assert.deepStrictEqual(ids({ search: 'disc-3' }), ['DISC-3']);
  assert.deepStrictEqual(ids({ unassigned: true }), ['DISC-2']);
  assert.deepStrictEqual(ids({ persons: ['Jordan Lee'] }), ['DISC-3']);
  assert.deepStrictEqual(ids({ persons: new Set(['Jordan Lee', 'Sam Rivera']) }), ['DISC-1', 'DISC-3']);
  assert.deepStrictEqual(KH.groupBoard(board, { search: 'disc-3' }).lanes.map((l) => l.id), ['b']); // lane A hidden while filtering
  assert.strictEqual(KH.groupBoard(board, {}).lanes.length, 3); // lanes A, B and Other when not filtering
  assert.deepStrictEqual(KH.togglePerson(null, 'X', ['X', 'Y']), ['X']);
  assert.deepStrictEqual(KH.togglePerson(['X'], 'Y', ['X', 'Y']), null);
  assert.deepStrictEqual(KH.togglePerson(['X'], 'X', ['X', 'Y']), null);
  // Jira names are surname-first; without a directory name a two-word name is swapped.
  assert.deepStrictEqual(KH.collectPersons(board.issues).map((p) => p.label), ['Lee Jordan', 'Rivera Sam']);
});

test('kanban helpers: card-limit collapse, moves, keyboard neighbours', () => {
  const cards = [1, 2, 3, 4].map((n) => kIssue('DISC-' + n, 1));
  assert.deepStrictEqual([KH.cellView(cards, 'preparation', false).visible.length, KH.cellView(cards, 'preparation', false).hidden], [2, 2]);
  assert.strictEqual(KH.cellView(cards, 'preparation', true).visible.length, 4);
  assert.strictEqual(KH.cellView(cards, 'in-progress', false).visible.length, 4); // only two columns collapse
  const moved = KH.moveIssue({ issues: cards, lanes: [], laneMap: {} }, 'DISC-1', 'done');
  assert.strictEqual(moved.issues[0].statusId, 10100);
  assert.strictEqual(moved.issues[1].statusId, 1);
  assert.strictEqual(KH.stepColumn(kIssue('X-1', 3), -1).id, 'todo');
  assert.strictEqual(KH.stepColumn(kIssue('X-1', 3), 1).id, 'blocked');
  assert.strictEqual(KH.stepColumn(kIssue('X-1', 1), -1), null);
  assert.strictEqual(KH.stepColumn(kIssue('X-1', 10100), 1), null);
  assert.strictEqual(KH.moveTargets(kIssue('X-1', 3)).length, 4);
});

test('kanban helpers: the form values are exactly the <select> option ids and Applies-to values', () => {
  assert.deepStrictEqual(KH.CHANGE_TYPE_OPTIONS.map((o) => o.value), ['40222', '20736', '20737', '20738']);
  assert.deepStrictEqual(KH.WORK_TYPE_OPTIONS.map((o) => o.value), ['40215', '40216', '40500', '40217', '40218', '40219', '40220', '40221']);
  assert.deepStrictEqual(KH.APPLIES_TO_OPTIONS.map((o) => o.value), ['Platform', 'Ordering', 'Marketplace']);
  assert.ok(KH.APPLIES_TO_OPTIONS.every((o) => /^[\x20-\x7e]+$/.test(o.value)), 'the value sent to Jira stays ASCII');
  assert.deepStrictEqual([KH.DEFAULT_CHANGE_TYPE, KH.DEFAULT_WORK_TYPE, KH.DEFAULT_APPLIES_TO], ['40222', '40216', 'Platform']);
});

test('kanban helpers: payload builders and validators', () => {
  const body = KH.buildCreatePayload({ summary: '  Title ', description: ' ', appliesTo: 'Platform', changeTypeId: '40222', workTypeId: '40216', assignee: '' }, 'PROD-1');
  assert.deepStrictEqual(body, { epicKey: 'PROD-1', summary: 'Title', appliesTo: 'Platform', changeTypeId: '40222', workTypeId: '40216' });
  assert.strictEqual(KH.validateCreateTask(body).ok, true);
  assert.strictEqual(KH.validateCreateTask({ ...body, epicKey: 'prod-12' }).payload.epicKey, 'PROD-12');
  const bad = [
    { ...body, epicKey: 'DISC-1' }, { ...body, epicKey: 'PROD-1 OR 1=1' }, { ...body, summary: '   ' }, { ...body, summary: 'x'.repeat(256) },
    { ...body, changeTypeId: '1' }, { ...body, workTypeId: '9999' }, { ...body, appliesTo: 'Anything' }, { ...body, assignee: 'x'.repeat(121) },
  ];
  for (const b of bad) assert.strictEqual(KH.validateCreateTask(b).ok, false, JSON.stringify(b).slice(0, 80));
  const defaults = KH.validateCreateTask({ epicKey: 'PLAT-3', summary: 'A' });
  assert.deepStrictEqual([defaults.payload.changeTypeId, defaults.payload.workTypeId, defaults.payload.appliesTo], ['40222', '40216', '']);
  assert.deepStrictEqual(KH.validateTransition({ key: 'disc-12', targetColId: 'done' }).payload, { key: 'DISC-12', targetColId: 'done' });
  for (const b of [{ key: 'PROD-1', targetColId: 'done' }, { key: 'DISC-1', targetColId: 'cancelled' }, { key: 'DISC-1' }, null]) assert.strictEqual(KH.validateTransition(b).ok, false);
  assert.deepStrictEqual(KH.buildTransitionPayload('DISC-1', 'done'), { key: 'DISC-1', targetColId: 'done' });
  assert.deepStrictEqual(KH.normalizeStatus({ token: 'personal' }), { token: 'personal', canWrite: true, testMode: false });
  assert.deepStrictEqual(KH.normalizeStatus({ token: 'technical' }), { token: 'technical', canWrite: false, testMode: false });
  assert.strictEqual(KH.normalizeStatus({ token: 'x' }).token, null);
  assert.strictEqual(KH.normalizeStatus({ token: 'personal', testMode: true }).canWrite, false);
  assert.strictEqual(KH.TECH_TOKEN_NOTE, 'You are using the technical token - unlock the vault to work on your own account.');
});

test('token policy: personal first, technical only as a fallback, and nothing else in the module reads a token', () => {
  const c = (env) => J.jiraConfig(env);
  assert.deepStrictEqual([c({ JIRA_TOKEN: 'p', JIRA_TECH_TOKEN: 't' }).token, c({ JIRA_TOKEN: 'p', JIRA_TECH_TOKEN: 't' }).source], ['p', 'personal']);
  assert.deepStrictEqual([c({ JIRA_TECH_TOKEN: 't' }).token, c({ JIRA_TECH_TOKEN: 't' }).source], ['t', 'technical']);
  assert.strictEqual(c({ JIRA_TOKEN: '  ', JIRA_TECH_TOKEN: 't' }).source, 'technical');
  assert.strictEqual(c({ JIRA_TOKEN: 'your_jira_token_here', JIRA_TECH_TOKEN: 't' }).source, 'technical');
  assert.deepStrictEqual([c({}).ok, c({}).source, c({}).token], [false, null, '']);
  // The module has exactly ONE reader of the token variables (server/jira.js jiraConfig); the client never sees them.
  const hits = [];
  for (const dir of ['server', 'client']) {
    for (const f of fs.readdirSync(path.join(DIR, dir))) {
      if (!f.endsWith('.js')) continue;
      const src = read(dir + '/' + f);
      if (/JIRA_TECH_TOKEN|JIRA_TOKEN|BW_SESSION/.test(src)) hits.push(dir + '/' + f);
      if (dir === 'server' && f !== 'index.js' && f !== 'paths.js') assert.ok(!/process\.env/.test(src) || f === 'jira.js', f + ' must not read the environment');
    }
  }
  assert.deepStrictEqual(hits, ['server/jira.js']);
  // The one process.env read of index.js hands the whole env to jiraConfig and nothing else.
  assert.strictEqual((read('server/index.js').match(/jira\.jiraConfig\(process\.env\)/g) || []).length, 2);
});

function kanbanHttp(routes) {
  const calls = [];
  const find = (url) => { const u = decodeURIComponent(url); const hit = routes.find(([n]) => u.includes(n)); return hit ? hit[1] : null; };
  return {
    calls,
    async fetchJson(url, opts) {
      calls.push({ kind: 'GET', url: decodeURIComponent(url), opts });
      const a = find(url);
      if (a instanceof Error) throw a;
      if (a === null) throw Object.assign(new Error('HTTP 404'), { status: 404 });
      return typeof a === 'function' ? a(decodeURIComponent(url)) : a;
    },
    async sendJson(url, opts) {
      calls.push({ kind: opts.method, url, opts });
      const a = find('SEND ' + opts.method + ' ' + url);
      if (a instanceof Error) throw a;
      return a === null ? {} : a;
    },
  };
}

const rawIssue = (key, statusId, extra = {}) => ({ key, fields: { summary: ' T ' + key, status: { id: String(statusId), name: 'S' }, assignee: { displayName: 'Rivera Sam', avatarUrls: { '48x48': 'https://x/a.png' } }, issuetype: { name: 'Task' }, priority: { name: 'High' }, updated: '2026-10-01', ...extra } });

test('kanban server: buildBoard maps issues to lanes (explicit lists first, epic link as the fallback) and drops avatar URLs', () => {
  const board = KS.buildBoard(
    [rawIssue('DISC-1', 3), rawIssue('DISC-1', 3), rawIssue('DISC-2', 1, { customfield_10001: 'PROD-9' }), rawIssue('DISC-3', 10100), rawIssue('DISC-4', 3)],
    [{ id: 'a', title: 'A', ticket: 'PROD-9', rank: 2, jiraTasks: [{ key: 'DISC-1' }] }, { id: 'b', title: 'B', rank: 1, jiraUnmatched: [{ key: 'DISC-3' }], deliveryEpics: [{ subtasks: [{ key: 'DISC-4' }] }] }, { title: 'bez id' }],
  );
  assert.strictEqual(board.issues.length, 4);
  assert.deepStrictEqual(board.laneMap, { 'DISC-1': 'a', 'DISC-3': 'b', 'DISC-4': 'b', 'DISC-2': 'a' });
  assert.deepStrictEqual(board.lanes.map((l) => [l.id, l.epicKey, l.rank]), [['a', 'PROD-9', 2], ['b', null, 1]]);
  assert.deepStrictEqual(board.issues[0], { key: 'DISC-1', summary: 'T DISC-1', statusId: 3, statusName: 'S', assignee: { displayName: 'Rivera Sam' }, issueType: 'Task', priority: 'High', updated: '2026-10-01' });
  assert.strictEqual(KS.pickColumnTransition([{ id: '1', to: { id: '3' } }, { id: '2', to: { id: '10100' } }], [10100]).id, '2');
  assert.strictEqual(KS.pickColumnTransition([{ id: '1', to: { id: '3' } }], [10100]), null);
  const f = KS.buildCreateFields({ epicKey: 'PLAT-1', summary: 'S', description: 'D', changeTypeId: '40222', workTypeId: '40216' }, 'sam.rivera');
  assert.deepStrictEqual([f.project.key, f.issuetype.name, f.customfield_10001, f.labels, f.assignee.name, f.customfield_17308.id, f.customfield_29000.id], ['DISC', 'Task', 'PLAT-1', ['Discovery'], 'sam.rivera', '40222', '40216']);
  assert.strictEqual(KS.buildCreateFields({ epicKey: 'PROD-1', summary: 'S', changeTypeId: '1', workTypeId: '2' }, null).labels, undefined);
  assert.strictEqual(KS.pickUser([{ name: 'a', displayName: 'Jordan Smith' }, { name: 'b', displayName: 'Rivera Sam' }], 'Sam Rivera'), 'b');
  assert.strictEqual(KS.pickUser([{ name: 'a', displayName: 'Zoë' }], 'Somebody'), 'a');
  assert.strictEqual(KS.pickUser([], 'Somebody'), null);
});

const PERSONAL = { ...LIVE, JIRA_TOKEN: 'personal-secret', JIRA_TECH_TOKEN: 'tech-secret' };
const TECH_ONLY = { ...LIVE, JIRA_TOKEN: undefined, JIRA_TECH_TOKEN: 'tech-secret' };
const NO_TOKEN = { ...LIVE, JIRA_TOKEN: undefined, JIRA_TECH_TOKEN: undefined };

async function callKanban(tmp, p, body, url) {
  const { ctx, calls } = makeCtx(tmp);
  ctx.readBody = async () => body;
  await routeOf(ctx, p).handler({ url: url || p }, {});
  return calls[0];
}

test('kanban server: GET /kanban/status names the token in use, never the token', async () => {
  for (const [env, want] of [[PERSONAL, 'personal'], [TECH_ONLY, 'technical'], [NO_TOKEN, null]]) {
    await withEnv(env, async () => {
      const r = await callKanban(DIR, '/kanban/status');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body, { token: want, canWrite: want === 'personal', testMode: false });
      assert.ok(!JSON.stringify(r.body).includes('secret'));
    });
  }
  await withEnv({ ...PERSONAL, NODE_ENV: 'test' }, async () => {
    const r = await callKanban(DIR, '/kanban/status');
    assert.deepStrictEqual(r.body, { token: 'personal', canWrite: false, testMode: true });
  });
});

test('kanban server: GET /kanban/board reads with the personal token first and falls back to the technical one', async () => {
  await withDataDir({ 'dt-aaaaaaaa.json': JSON.stringify({ id: 'a', title: 'A', ticket: 'PROD-1', rank: 1, jiraTasks: [{ key: 'DISC-1' }] }) }, async (tmp) => {
    for (const [env, bearer, source] of [[PERSONAL, 'Bearer personal-secret', 'personal'], [TECH_ONLY, 'Bearer tech-secret', 'technical']]) {
      await withEnv(env, async () => {
        const http = kanbanHttp([['status IN (10100, 11711)', { issues: [rawIssue('DISC-3', 10100)], total: 1 }], ['status NOT IN', { issues: [rawIssue('DISC-1', 3)], total: 1 }]]);
        register._setHttpForTests(http);
        const r = await callKanban(tmp, '/kanban/board');
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.ok, true);
        assert.strictEqual(r.body.token, source);
        assert.deepStrictEqual(r.body.issues.map((i) => i.key), ['DISC-1', 'DISC-3']);
        assert.deepStrictEqual(r.body.laneMap, { 'DISC-1': 'a' });
        assert.strictEqual(r.body.jiraBase, 'https://jira.example.com/browse/');
        assert.ok(http.calls.length === 2 && http.calls.every((c) => c.kind === 'GET' && c.opts.headers.Authorization === bearer));
        assert.ok(!JSON.stringify(r.body).includes('secret'));
      });
    }
  });
});

test('kanban server: the board pages through all results', async () => {
  await withEnv(PERSONAL, async () => {
    const page = (from, n, total) => ({ issues: Array.from({ length: n }, (_, i) => rawIssue('DISC-' + (from + i), 3)), total });
    const http = kanbanHttp([['status IN (10100', { issues: [], total: 0 }], ['startAt=100', page(101, 20, 120)], ['startAt=0', page(1, 100, 120)]]);
    register._setHttpForTests(http);
    const r = await callKanban(DIR, '/kanban/board');
    assert.strictEqual(r.body.issues.length, 120);
  });
});

test('kanban server: no token -> 503 no-token with the vault hint; Jira errors map like the rest of the module', async () => {
  await withEnv(NO_TOKEN, async () => {
    register._setHttpForTests(kanbanHttp([]));
    const r = await callKanban(DIR, '/kanban/board');
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.body.error, 'no-token');
    assert.ok(r.body.message.includes('unlock the Bitwarden vault in the top bar'));
  });
  await withEnv(PERSONAL, async () => {
    register._setHttpForTests(kanbanHttp([['jql', Object.assign(new Error('HTTP 401'), { status: 401 })]]));
    assert.strictEqual((await callKanban(DIR, '/kanban/board')).body.error, 'token-unauthorized');
    register._setHttpForTests(kanbanHttp([['jql', new Error('fetch failed')]]));
    assert.strictEqual((await callKanban(DIR, '/kanban/board')).body.error, 'jira-unreachable');
  });
});

test('kanban server: a technical token refuses every write with 409 personal-token-required and calls Jira for nothing', async () => {
  await withEnv(TECH_ONLY, async () => {
    const http = kanbanHttp([]);
    register._setHttpForTests(http);
    const t = await callKanban(DIR, '/kanban/transition', { key: 'DISC-1', targetColId: 'done' });
    const c = await callKanban(DIR, '/kanban/create-task', { epicKey: 'PROD-1', summary: 'S' });
    const table = await callKanban(DIR, '/jira/transition', { key: 'DISC-1', to: 'Closed' });
    for (const r of [t, c, table]) {
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.body.error, 'personal-token-required');
      assert.ok(r.body.message.includes('personal token'));
    }
    assert.strictEqual(http.calls.length, 0);
  });
  await withEnv(NO_TOKEN, async () => {
    const r = await callKanban(DIR, '/kanban/transition', { key: 'DISC-1', targetColId: 'done' });
    assert.strictEqual(r.body.error, 'no-token');
  });
});

test('kanban server: validation answers 400 before any Jira call', async () => {
  await withEnv(PERSONAL, async () => {
    const http = kanbanHttp([]);
    register._setHttpForTests(http);
    const bad = [
      ['/kanban/transition', { key: 'PROD-1', targetColId: 'done' }], ['/kanban/transition', { key: 'DISC-1', targetColId: 'nope' }], ['/kanban/transition', null],
      ['/kanban/create-task', { epicKey: 'DISC-1', summary: 'S' }], ['/kanban/create-task', { epicKey: 'PROD-1', summary: '' }],
      ['/kanban/create-task', { epicKey: 'PROD-1', summary: 'S', changeTypeId: '1' }], ['/kanban/create-task', { epicKey: 'PROD-1', summary: 'S', workTypeId: '1' }],
      ['/kanban/create-task', { epicKey: 'PROD-1', summary: 'S', appliesTo: 'x' }], ['/kanban/create-task', null],
    ];
    for (const [p, b] of bad) {
      const r = await callKanban(DIR, p, b);
      assert.strictEqual(r.status, 400, p + JSON.stringify(b));
      assert.strictEqual(r.body.error, 'bad-request');
    }
    assert.strictEqual(http.calls.length, 0);
  });
});

test('kanban server: transition with the personal token reads the transitions and posts the one into the column', async () => {
  await withEnv(PERSONAL, async () => {
    const http = kanbanHttp([['/transitions', { transitions: [{ id: '11', to: { id: '3' } }, { id: '31', to: { id: '10100' } }] }]]);
    register._setHttpForTests(http);
    const r = await callKanban(DIR, '/kanban/transition', { key: 'disc-7', targetColId: 'done' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body, { ok: true, key: 'DISC-7', targetColId: 'done' });
    const post = http.calls.find((c) => c.kind === 'POST');
    assert.strictEqual(post.url, 'https://jira.example.com/rest/api/2/issue/DISC-7/transitions');
    assert.deepStrictEqual(post.opts.body, { transition: { id: '31' } });
    assert.strictEqual(post.opts.headers.Authorization, 'Bearer personal-secret');
    // no transition into the column -> 409 and nothing posted
    const none = kanbanHttp([['/transitions', { transitions: [{ id: '11', to: { id: '3' } }] }]]);
    register._setHttpForTests(none);
    const r2 = await callKanban(DIR, '/kanban/transition', { key: 'DISC-7', targetColId: 'done' });
    assert.strictEqual(r2.status, 409);
    assert.strictEqual(r2.body.error, 'no-transition');
    assert.ok(!none.calls.some((c) => c.kind === 'POST'));
    // unknown issue -> 404
    register._setHttpForTests(kanbanHttp([['/transitions', Object.assign(new Error('HTTP 404'), { status: 404 })]]));
    assert.strictEqual((await callKanban(DIR, '/kanban/transition', { key: 'DISC-7', targetColId: 'done' })).status, 404);
  });
});

test('kanban server: create-task validates the token, resolves the assignee, creates, then sets Dotyczy', async () => {
  await withEnv(PERSONAL, async () => {
    const http = kanbanHttp([
      ['/myself', { name: 'ja' }],
      ['user/picker', { users: [{ name: 'sam.rivera', displayName: 'Rivera Sam' }] }],
      ['SEND POST https://jira.example.com/rest/api/2/issue', { key: 'DISC-99' }],
    ]);
    register._setHttpForTests(http);
    const r = await callKanban(DIR, '/kanban/create-task', { epicKey: 'plat-5', summary: ' New ', description: 'Description', assignee: 'Sam Rivera', appliesTo: 'Ordering', changeTypeId: '20736', workTypeId: '40500' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body, { ok: true, key: 'DISC-99', url: 'https://jira.example.com/browse/DISC-99', summary: 'New', assigneeRequested: true, assigneeResolved: true, appliesToApplied: true });
    const writes = http.calls.filter((c) => c.kind !== 'GET');
    assert.deepStrictEqual(writes.map((c) => c.kind), ['POST', 'PUT']);
    const f = writes[0].opts.body.fields;
    assert.deepStrictEqual([f.project.key, f.summary, f.issuetype.name, f.customfield_10001, f.customfield_17308.id, f.customfield_29000.id, f.assignee.name, f.labels], ['DISC', 'New', 'Task', 'PLAT-5', '20736', '40500', 'sam.rivera', ['Discovery']]);
    assert.strictEqual(writes[1].url, 'https://jira.example.com/rest/api/2/issue/DISC-99');
    assert.deepStrictEqual(writes[1].opts.body, { fields: { customfield_29001: ['Ordering'] } });
    assert.ok(writes.every((c) => c.opts.headers.Authorization === 'Bearer personal-secret'));
    // the very first call proves the token; /myself comes before any write
    assert.ok(http.calls[0].url.includes('/myself'));
  });
});

test('kanban server: create-task keeps the task when Dotyczy or the assignee fail, and reports a rejection', async () => {
  await withEnv(PERSONAL, async () => {
    const http = kanbanHttp([
      ['/myself', {}], ['user/picker', Object.assign(new Error('HTTP 500'), { status: 500 })],
      ['SEND POST https://jira.example.com/rest/api/2/issue', { key: 'DISC-5' }],
      ['SEND PUT', Object.assign(new Error('HTTP 400'), { status: 400 })],
    ]);
    register._setHttpForTests(http);
    const r = await callKanban(DIR, '/kanban/create-task', { epicKey: 'PROD-1', summary: 'S', assignee: 'Somebody', appliesTo: 'Platform' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.assigneeRequested, r.body.assigneeResolved, r.body.appliesToApplied], [true, false, false]);
    assert.ok(!http.calls.find((c) => c.kind === 'POST').opts.body.fields.assignee);
    register._setHttpForTests(kanbanHttp([['/myself', {}], ['SEND POST', Object.assign(new Error('HTTP 400'), { status: 400, detail: 'x' })]]));
    const bad = await callKanban(DIR, '/kanban/create-task', { epicKey: 'PROD-1', summary: 'S' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.error, 'jira-rejected');
    register._setHttpForTests(kanbanHttp([['/myself', {}], ['SEND POST', {}]]));
    assert.strictEqual((await callKanban(DIR, '/kanban/create-task', { epicKey: 'PROD-1', summary: 'S' })).body.error, 'jira-no-key');
  });
});

test('kanban server: test mode gates every route that touches Jira', async () => {
  await withEnv({ ...PERSONAL, NODE_ENV: 'test' }, async () => {
    const http = kanbanHttp([]);
    register._setHttpForTests(http);
    for (const [p, b] of [['/kanban/board'], ['/kanban/transition', { key: 'DISC-1', targetColId: 'done' }], ['/kanban/create-task', { epicKey: 'PROD-1', summary: 'S' }]]) {
      const r = await callKanban(DIR, p, b);
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.body.error, 'test-mode');
    }
    assert.strictEqual(http.calls.length, 0);
  });
});

test('kanban client: the view uses only apiBase/kanban routes, no write outside the two POSTs, and wires the keyboard and drag paths', () => {
  const src = read('client/kanban.js');
  // every network call goes through getJson/postJson over `apiBase + path`
  assert.strictEqual((src.match(/\bfetch\(/g) || []).length, 2, 'two fetch calls: getJson and postJson');
  assert.ok(/fetch\(apiBase \+ path/.test(src));
  const paths = [...src.matchAll(/(?:getJson|postJson)\('(\/[^']*)'/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(paths, ['/kanban/board', '/kanban/create-task', '/kanban/status', '/kanban/transition']);
  assert.ok(!/https?:\/\/|\/api\//.test(src.replace(/\/\/ .*$/gm, '')), 'no absolute or core API url');
  assert.ok(!/localStorage|sessionStorage|JIRA_|Authorization/.test(src));
  assert.match(src, /'Content-Type': 'application\/json'/);
  assert.match(src, /draggable/);
  assert.match(src, /ArrowLeft/);
  assert.match(src, /confirmDsModal/);
  assert.match(src, /TECH_TOKEN_NOTE/);
  assert.match(src, /export function renderKanban\(root, deps\)/);
  assert.ok(!/<style|style="[^"]*#[0-9a-fA-F]{3,6}/.test(src), 'no hardcoded colours');
  const css = read('client/style.css');
  assert.ok(!/\.crk-[^{]*\{[^}]*#[0-9a-fA-F]{3,8}\b/.test(css), 'kanban css uses tokens only');
});
