// time-off/tests/test_time_off.mjs
// Contract test for the time-off module. `npm test` discovers it through
// scripts/test-unit-js.js, which walks modules/<id>/tests/ as well as tests/.
//
// Manifest contract, register(ctx) route shape, GET /data storage-unavailable,
// GET /fetch-stream repo-missing and not-configured, then the client's pure
// functions (slugify parity against fixtures/slug-cases.json, publicHolidays,
// buildMonthGrid, buildRange, mergeShards, daysBetween/fmtDate, search).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import { APP_ROOT } from './_root.mjs';

const require = createRequire(import.meta.url);
const { validateModuleManifest } = require(path.join(APP_ROOT, 'server.js'));

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_ID = 'time-off';
const VIEW_IDS = ['time-off-main'];
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');

test('time-off: module.json passes the host validator', () => {
  const manifest = JSON.parse(read('module.json'));
  const result = validateModuleManifest(manifest, MODULE_ID);
  assert.equal(result.valid, true, (result.errors || []).join('; '));
});

test('time-off: the manifest declares exactly the expected views and data', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.deepEqual(manifest.views.map((v) => v.id), VIEW_IDS);
  assert.equal(manifest.icon, '24-ic-calendar');
  assert.ok(Array.isArray(manifest.dataRepos) && manifest.dataRepos.length === 1);
  assert.equal(manifest.dataRepos[0].name, 'data-tier-0');
  assert.ok(manifest.dataRepos[0].paths.includes('time-off/'));
  assert.equal(manifest.author, 'androszr');
  assert.equal(manifest.envKeys.length, 2);
  assert.deepEqual(
    manifest.envKeys.map((k) => k.name).sort(),
    ['TIMEOFF_SHAREPOINT_DOWNLOAD_URL', 'TIMEOFF_SHAREPOINT_URL'],
  );
});

// This module puts a PAGE into the core's Support hub - it does not own a rail
// item. A hub belongs to the core (js/core-hubs.mjs), so "Support" is not this
// module's name to give; what the person sees in the flyout is the VIEW label.
test('time-off: the module is a page in the core Support hub, not its own rail item', () => {
  const manifest = JSON.parse(read('module.json'));
  assert.equal(manifest.sidebar.kind, 'page');
  assert.equal(manifest.sidebar.hub, 'support');
  assert.equal(manifest.views[0].label, 'Time off');
});

test('time-off: every file the manifest points at exists', () => {
  const manifest = JSON.parse(read('module.json'));
  for (const rel of [manifest.client && manifest.client.entry,
    manifest.client && manifest.client.style,
    manifest.server && manifest.server.entry]) {
    if (!rel) continue;
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
  for (const rel of ['scripts/sharepoint_time_off.py', 'scripts/requirements.txt', 'client/time-off-lib.js', 'client/holidays.js']) {
    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);
  }
});

test('time-off: the client exports one view per manifest entry', async () => {
  const ns = await import(path.join(DIR, 'client/index.js'));
  assert.deepEqual(Object.keys(ns.views).sort(), [...VIEW_IDS].sort());
  for (const id of VIEW_IDS) {
    assert.equal(typeof ns.views[id].init, 'function');
    assert.equal(typeof ns.views[id].render, 'function');
  }
});

test('time-off: register(ctx) declares exactly the five routes and never touches disk', () => {
  // rootDir does not exist on purpose: register() must not stat/read/mkdir
  // anything at module-load time, or the real loader would mark the module
  // "server entry failed" on a fresh clone with no team data yet.
  const register = require(path.join(DIR, 'server', 'index.js'));
  const reg = register({
    moduleId: MODULE_ID,
    dataDir: '/tmp/does-not-exist/data',
    rootDir: '/tmp/does-not-exist',
    log: () => {},
    jsonResponse: () => {},
    readBody: async () => ({}),
    checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  const sigs = reg.routes.map((r) => r.method + ' ' + r.path).sort();
  assert.deepEqual(sigs, ['GET /data', 'GET /fetch-stream', 'GET /status', 'POST /session-keepalive', 'POST /session-login']);
  for (const r of reg.routes) {
    assert.match(r.path, /^\//, 'a route path starts with /');
    assert.equal(typeof r.handler, 'function');
  }
});

test('time-off: GET /data with no team data clone answers 200 storage unavailable', async () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const sent = [];
  const reg = register({
    moduleId: MODULE_ID,
    dataDir: '/tmp/does-not-exist/data',
    rootDir: '/tmp/does-not-exist',
    log: () => {},
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
    readBody: async () => ({}),
    checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  const route = reg.routes.find((r) => r.method === 'GET' && r.path === '/data');
  await route.handler({}, {});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 200);
  assert.deepEqual(sent[0].body, {
    available: false,
    storage: 'unavailable',
    fetched_at: null,
    source_mtime: null,
    persons: [],
    entries: [],
  });
});

test('time-off: GET /fetch-stream with no team data clone answers 409 repo-missing', async () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const sent = [];
  const reg = register({
    moduleId: MODULE_ID,
    dataDir: '/tmp/does-not-exist/data',
    rootDir: '/tmp/does-not-exist',
    log: () => {},
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
    readBody: async () => ({}),
    checkOrigin: () => true,
    makeLock: () => (fn) => fn(),
  });
  const route = reg.routes.find((r) => r.method === 'GET' && r.path === '/fetch-stream');
  // A minimal req/res: this branch answers through ctx.jsonResponse (mocked
  // above) before it ever reaches sseOpen/writeHead, so no real socket needed.
  const req = { socket: null, on: () => {} };
  const res = { headersSent: false, writableEnded: false };
  await route.handler(req, res);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 409);
  assert.equal(sent[0].body.error, 'repo-missing');
  assert.match(sent[0].body.message, /team data/);
});

test('time-off: GET /fetch-stream without the SharePoint addresses answers 409 not-configured', async () => {
  const prev = { url: process.env.TIMEOFF_SHAREPOINT_URL, dl: process.env.TIMEOFF_SHAREPOINT_DOWNLOAD_URL, env: process.env.NODE_ENV, emb: process.env.COCKPIT_EMBEDDED };
  delete process.env.TIMEOFF_SHAREPOINT_URL;
  delete process.env.TIMEOFF_SHAREPOINT_DOWNLOAD_URL;
  delete process.env.NODE_ENV;
  delete process.env.COCKPIT_EMBEDDED;
  const indexPath = path.join(DIR, 'server', 'index.js');
  delete require.cache[require.resolve(indexPath)];
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'time-off-cfg-'));
  try {
    const register = require(indexPath);
    const sent = [];
    const reg = register({
      moduleId: MODULE_ID, dataDir: path.join(dataRoot, 'module'), rootDir: dataRoot, dataTier0Dir: dataRoot,
      log: () => {}, jsonResponse: (_res, status, body) => sent.push({ status, body }),
      readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(),
    });
    const route = reg.routes.find((r) => r.path === '/fetch-stream');
    await route.handler({ socket: null, on: () => {} }, {});
    assert.equal(sent[0].status, 409);
    assert.equal(sent[0].body.error, 'not-configured');
    assert.equal(register.isConfigured({ TIMEOFF_SHAREPOINT_URL: 'a', TIMEOFF_SHAREPOINT_DOWNLOAD_URL: 'b' }), true);
  } finally {
    delete require.cache[require.resolve(indexPath)];
    fs.rmSync(dataRoot, { recursive: true, force: true });
    for (const [k, v] of [['TIMEOFF_SHAREPOINT_URL', prev.url], ['TIMEOFF_SHAREPOINT_DOWNLOAD_URL', prev.dl], ['NODE_ENV', prev.env], ['COCKPIT_EMBEDDED', prev.emb]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

// ── Client: client/time-off-lib.js and client/holidays.js ─────────────────
// Pure functions, no browser document - imported directly, same as the manifest/register
// cases above.

const { publicHolidays } = await import(path.join(DIR, 'client', 'holidays.js'));
const {
  slugify, buildMonthGrid, buildRange, mergeShards, daysBetween, fmtDate,
  normalizeSearch, filterEntriesByPerson, countPersons,
} = await import(path.join(DIR, 'client', 'time-off-lib.js'));

test('time-off: publicHolidays(2026) has the moving holidays and Christmas Eve', () => {
  const set = publicHolidays(2026);
  assert.ok(set.has('2026-04-06'), 'Easter Monday');
  assert.ok(set.has('2026-06-04'), 'Corpus Christi');
  assert.ok(set.has('2026-12-24'), 'Christmas Eve (since 2025)');
  assert.ok(set.has('2026-01-06'), 'Epiphany');
  assert.ok(!set.has('2026-04-07'), 'the Tuesday after Easter Monday is not a holiday');
});

test('time-off: publicHolidays(2024) has no Christmas Eve - it was not a public holiday yet', () => {
  const set = publicHolidays(2024);
  assert.ok(!set.has('2024-12-24'));
});

test('time-off: buildMonthGrid(2026, 9, holidays) has 35 cells and starts on 2026-09-01', () => {
  const holidays = publicHolidays(2026);
  const cells = buildMonthGrid(2026, 9, holidays);
  assert.equal(cells.length, 35);
  const firstReal = cells.find((c) => c !== null);
  assert.equal(firstReal.dateStr, '2026-09-01');
  const weekendCount = cells.filter((c) => c && c.isWeekend).length;
  assert.ok(weekendCount > 0, 'September 2026 has at least one weekend day');
});

test('time-off: buildRange trims startYM to the data range, and defaults to the current month', () => {
  const entries = [
    { dateFrom: '2025-09-10', dateTo: '2025-09-15' },
    { dateFrom: '2026-02-01', dateTo: '2026-02-05' },
  ];
  const range = buildRange(entries, new Date(2026, 8, 6)); // 2026-09-06
  assert.equal(range.minYM, '2025-09');
  assert.equal(range.maxYM, '2026-02');
  assert.equal(range.startYM, '2026-02');

  const empty = buildRange([], new Date(2026, 8, 6));
  assert.deepEqual(empty, { minYM: '2026-09', maxYM: '2026-09', startYM: '2026-09' });
});

test('time-off: mergeShards gives id `<slug>-<i>` sorted by dateFrom', () => {
  const index = { persons: { 'alex-morgan': { name: 'Alex Morgan' } } };
  const shards = {
    'alex-morgan': {
      name: 'Alex Morgan',
      entries: [
        { dateFrom: '2026-05-10', dateTo: '2026-05-12', submittedAt: null, submittedBy: null },
        { dateFrom: '2026-01-02', dateTo: '2026-01-03', submittedAt: null, submittedBy: null },
      ],
    },
  };
  const merged = mergeShards(index, shards);
  // id tracks the position in the shard's own entries array (i), which is
  // NOT the same as the sort position - the list below is re-sorted by
  // dateFrom, so the earlier date (originally at index 1) sorts first while
  // keeping the id "alex-morgan-1" it was assigned before the sort.
  assert.deepEqual(merged.map((e) => e.id), ['alex-morgan-1', 'alex-morgan-0']);
  assert.deepEqual(merged.map((e) => e.dateFrom), ['2026-01-02', '2026-05-10']);
  assert.equal(merged[0].person, 'Alex Morgan');
  assert.equal(merged[0].person_slug, 'alex-morgan');
});

test('time-off: daysBetween and fmtDate', () => {
  assert.equal(daysBetween('2026-09-08', '2026-09-19'), 12);
  assert.equal(fmtDate('2026-09-08'), '08.09.2026');
});

test('time-off: slugify matches the shared fixture (parity with the Python side)', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(DIR, 'tests', 'fixtures', 'slug-cases.json'), 'utf8'));
  for (const [input, expected] of cases) {
    assert.equal(slugify(input), expected, 'slugify(' + JSON.stringify(input) + ')');
  }
});

// ── Person search (the box next to the team select) ───────────────────────

test('time-off: normalizeSearch folds diacritics and case', () => {
  assert.equal(normalizeSearch('\u0141\u0105ka \u0106ma'), 'laka cma');
  assert.equal(normalizeSearch('\u015a\u0107ie\u017cka \u017ar\u00f3d\u0142o'), 'sciezka zrodlo');
  assert.equal(normalizeSearch(null), '');
});

test('time-off: filterEntriesByPerson needs every word, ignores case and diacritics', () => {
  const entries = [
    { person: 'Alex Morgan' },
    { person: 'Jordan \u0141\u0105k' },
    { person: 'XY Sam Rivera' },
  ];
  assert.deepEqual(filterEntriesByPerson(entries, 'lak').map((e) => e.person), ['Jordan \u0141\u0105k']);
  assert.deepEqual(filterEntriesByPerson(entries, 'alex mor').map((e) => e.person), ['Alex Morgan']);
  // A contract-code prefix in the sheet must not hide the person.
  assert.equal(filterEntriesByPerson(entries, 'rivera').length, 1);
  // An empty or blank query is not a filter - it returns the list untouched.
  assert.equal(filterEntriesByPerson(entries, '').length, 3);
  assert.equal(filterEntriesByPerson(entries, '   ').length, 3);
  assert.equal(filterEntriesByPerson(entries, 'nobody').length, 0);
});

test('time-off: filterEntriesByPerson also searches the displayed name', () => {
  // The sheet spells the name surname-first; the team directory resolves the
  // name a person actually reads, and the query has to match either.
  const entries = [{ person: 'Morgan Alex' }];
  const shown = () => 'Alex Morgan';
  assert.equal(filterEntriesByPerson(entries, 'alex morgan', shown).length, 1);
  assert.equal(filterEntriesByPerson(entries, 'alex morgan').length, 1);
  assert.equal(filterEntriesByPerson([{ person: 'someone else' }], 'alex', shown).length, 1);
});

test('time-off: countPersons counts distinct people, not entries', () => {
  assert.equal(countPersons([{ person_slug: 'a' }, { person_slug: 'a' }, { person_slug: 'b' }]), 2);
  assert.equal(countPersons([{ person: 'Alex Morgan' }]), 1);
  assert.equal(countPersons([]), 0);
  assert.equal(countPersons(null), 0);
});

test('childEnv: the Python child gets an allowlist - the SharePoint addresses pass, no vault secret does', () => {
  const register = require(path.join(DIR, 'server', 'index.js'));
  const parent = {
    PATH: '/usr/bin', HOME: '/home/user', TIMEOFF_SHAREPOINT_URL: 'https://sp.example.com/x', DISPLAY: ':0',
    JIRA_TOKEN: 'j', CONFLUENCE_TOKEN: 'c', GITLAB_MINI_TOKEN: 'g', COCKPIT_API_KEY: 'a', BW_SESSION: 'b', ADO_PERSONAL_TOKEN: 'p', EMPTY: '',
  };
  const env = register.childEnv(parent);
  const allowed = new Set(register.CHILD_ENV_ALLOW.concat(['PYTHONUNBUFFERED']));
  for (const key of Object.keys(env)) assert.ok(allowed.has(key), 'leaked into the child env: ' + key);
  for (const key of ['JIRA_TOKEN', 'CONFLUENCE_TOKEN', 'GITLAB_MINI_TOKEN', 'COCKPIT_API_KEY', 'BW_SESSION', 'ADO_PERSONAL_TOKEN', 'EMPTY']) {
    assert.equal(key in env, false, key + ' must not reach the child');
  }
  assert.equal(env.TIMEOFF_SHAREPOINT_URL, 'https://sp.example.com/x');
  assert.equal(env.PYTHONUNBUFFERED, '1');
  assert.equal(env.PYTHONIOENCODING, 'utf-8');
  // Every child-process call in the file carries the allowlist - the spread
  // this replaced is exactly what check-conventions' spawn-env-spread flags.
  const src = read('server/index.js');
  const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  assert.equal(codeLines.some((l) => /\.\.\.process\.env/.test(l)), false, 'no ...process.env spread may come back');
  const calls = codeLines.filter((l) => /\b(spawn|execFile)\(/.test(l) && !/taskkill/.test(l));
  assert.ok(calls.length >= 2, 'expected the probe and the scraper spawn');
});
