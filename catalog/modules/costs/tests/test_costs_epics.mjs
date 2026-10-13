import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const c = require('../server/compute.js');
const { resolveIssueDetails } = require('../server/jira.js');
const rates = require('../server/rates.js');
const store = require('../server/store.js');
const { createRoutes } = require('../server/index.js');
const lib = await import('../client/costs-lib.js');

const H = 3600;
const wl = (name, display, day, secs, key) => ({
  author: { name, displayName: display }, dateStarted: day + 'T09:00:00.000+0200', timeSpentSeconds: secs, ...(key ? { issue: { key } } : {}),
});

// -- tempo aggregation --------------------------------------------------------

test('aggregateWorklogs keeps seconds per issue per month; issueKey and a missing key are handled', () => {
  const agg = c.aggregateWorklogs([
    wl('a@example.com', 'A', '2026-01-05', H, 'ATL-1'), wl('a@example.com', 'A', '2026-01-06', H, 'ATL-1'),
    wl('a@example.com', 'A', '2026-01-07', 2 * H, 'bor-2'),
    { ...wl('a@example.com', 'A', '2026-02-01', H), issueKey: 'ATL-9' },
    wl('a@example.com', 'A', '2026-02-02', H),
  ]);
  assert.deepStrictEqual(agg.authors[0].issues['2026-01'], { 'ATL-1': 2 * H, 'BOR-2': 2 * H });
  assert.deepStrictEqual(agg.authors[0].issues['2026-02'], { 'ATL-9': H, _: H });
  const split = c.splitByMonth(agg, ['2026-01', '2026-02']);
  assert.deepStrictEqual(split['2026-01'].authors[0].issues, { 'ATL-1': 2 * H, 'BOR-2': 2 * H });
  assert.strictEqual(split['2026-01'].authors[0].seconds, 4 * H);
});

// -- jira details ---------------------------------------------------------------

function fakeJira(db) {
  const calls = [];
  return {
    calls,
    http: {
      fetchJson: async (url) => {
        calls.push(url);
        const jql = decodeURIComponent(/jql=([^&]*)/.exec(url)[1]);
        const keys = /\(([^)]*)\)/.exec(jql)[1].split(',');
        return { issues: keys.filter((k) => db[k]).map((k) => ({ key: k, fields: db[k] })) };
      },
    },
  };
}

test('resolveIssueDetails: batches of 100, subtask -> parent -> epic, parent fetched when missing', async () => {
  const db = {
    'ATL-2': { summary: 'Subtask', issuetype: { name: 'Sub-task' }, parent: { key: 'ATL-1' } },
    'ATL-3': { summary: 'Task one', issuetype: { name: 'Task' }, customfield_10001: 'ATL-100' },
    'ATL-1': { summary: 'Parent', issuetype: { name: 'Story' }, customfield_10001: 'ATL-100' },
    'ATL-100': { summary: 'Epic Alpha', issuetype: { name: 'Epic' } },
    'ATL-4': { summary: 'No epic', issuetype: { name: 'Task' } },
  };
  const j = fakeJira(db);
  const cfg = { token: 't', jiraUrl: 'https://jira.example' };
  const out = await resolveIssueDetails({ http: j.http, cfg, keys: ['ATL-2', 'ATL-3', 'ATL-4', 'bad key'] });
  assert.deepStrictEqual(out.warnings, []);
  assert.deepStrictEqual(out.issues['ATL-2'], { summary: 'Subtask', type: 'Sub-task', epicKey: 'ATL-100', epicName: 'Epic Alpha' });
  assert.strictEqual(out.issues['ATL-3'].epicName, 'Epic Alpha');
  assert.strictEqual(out.issues['ATL-4'].epicKey, '');
  assert.ok(!('bad key' in out.issues));
  assert.ok(j.calls[0].startsWith('https://jira.example/rest/api/2/search?jql='));
  assert.ok(j.calls[0].includes('maxResults=100'));
  assert.strictEqual(j.calls.length, 3); // issues, missing parent, epic summary

  const many = Array.from({ length: 250 }, (_, i) => 'AAA-' + (i + 1));
  const j2 = fakeJira({});
  await resolveIssueDetails({ http: j2.http, cfg, keys: many });
  assert.strictEqual(j2.calls.length, 3);
});

test('resolveIssueDetails: a failing Jira never throws, it warns', async () => {
  const http = { fetchJson: async () => { throw new Error('HTTP 503'); } };
  const out = await resolveIssueDetails({ http, cfg: { token: 't', jiraUrl: 'https://j' }, keys: ['ATL-1'] });
  assert.deepStrictEqual(out.issues, {});
  assert.strictEqual(out.warnings.length, 1);
});

// -- epic tree --------------------------------------------------------------------

const roster = [
  { id: 'tm-1', first_name: 'Alex', last_name: 'Morgan', email: 'alex@example.com' },
  { id: 'tm-2', first_name: 'Sam', last_name: 'River', email: 'sam@example.com' },
];
const config = { members: [
  { id: 'tm-1', included: true, areas: ['borealis'] }, { id: 'tm-2', included: true, areas: ['borealis'] },
] };
const shardV2 = {
  schemaVersion: 2, month: '2026-01',
  authors: [
    { key: 'alex@example.com', displayName: 'Alex Morgan', seconds: 16 * H, issues: { 'BOR-1': 8 * H, 'BOR-2': 8 * H } },
    { key: 'sam@example.com', displayName: 'Sam River', seconds: 8 * H, issues: { 'BOR-1': 8 * H } },
  ],
  issues: { 'BOR-1': { summary: 'One', type: 'Task', epicKey: 'BOR-100', epicName: 'Epic' }, 'BOR-2': { summary: 'Two', type: 'Task', epicKey: '', epicName: '' } },
};

test('buildEpicTree: priced and unpriced hours share a cell; no-epic issues go under "No epic"', () => {
  const t = c.buildEpicTree({ shards: [shardV2], config, rates: { rates: [{ id: 'tm-1', daily_rate: 1000 }] }, roster, months: ['2026-01'], area: 'borealis' });
  assert.deepStrictEqual(t.legacyMonths, []);
  const epic = t.epics.find((e) => e.key === 'BOR-100');
  assert.strictEqual(epic.name, 'Epic');
  assert.strictEqual(epic.total.hours, 16);
  assert.strictEqual(epic.total.cost, 1000); // only Alex is priced
  assert.strictEqual(epic.total.noRateHours, 8);
  const issue = epic.issues[0];
  assert.strictEqual(issue.persons.length, 2);
  assert.strictEqual(issue.persons.find((p) => p.id === 'tm-2').rateMissing, true);
  assert.strictEqual(issue.persons.find((p) => p.id === 'tm-2').total.cost, 0);
  const none = t.epics.find((e) => e.key === '');
  assert.strictEqual(none.name, 'No epic');
  assert.strictEqual(none.total.cost, 1000);
  assert.strictEqual(t.totals.total.hours, 24);
  assert.strictEqual(t.epics[0].key, 'BOR-100', 'cost tie broken by hours');
});

test('buildEpicTree: area filter, and schemaVersion 1 months are legacy', () => {
  const v1 = { schemaVersion: 1, month: '2026-02', authors: [{ key: 'alex@example.com', displayName: 'Alex Morgan', seconds: H }] };
  const t = c.buildEpicTree({ shards: [shardV2, v1], config, rates: { rates: [] }, roster, months: ['2026-01', '2026-02'], area: 'delta' });
  assert.deepStrictEqual(t.epics, []);
  assert.deepStrictEqual(t.legacyMonths, ['2026-02']);
  const t2 = c.buildEpicTree({ shards: [shardV2, v1], config, rates: { rates: [] }, roster, months: ['2026-01', '2026-02'], area: 'borealis' });
  assert.deepStrictEqual(t2.legacyMonths, ['2026-02']);
  assert.strictEqual(t2.totals.months['2026-02'].hours, 0);
});

// -- external members ---------------------------------------------------------------

test('matching: an external member joins the e-mail index and the token targets', () => {
  const cfg = { members: [{ id: 'ext:lane', name: 'Quinn Lane', email: 'lane@example.com', external: true, included: true, areas: ['borealis'] }] };
  const agg = { authors: [
    { key: 'lane@example.com', displayName: 'Whatever', months: { '2026-01': 2 * H } },
    { key: 'x', displayName: 'VND Quinn Lane [X]', months: { '2026-01': 3 * H } },
  ] };
  const out = c.buildCosts({ aggregated: agg, config: cfg, rates: { rates: [{ id: 'ext:lane', daily_rate: 800 }] }, roster, months: ['2026-01'] });
  assert.strictEqual(out.persons[0].external, true);
  assert.strictEqual(out.persons[0].total.hours, 5);
  assert.strictEqual(out.persons[0].total.cost, 500);
  assert.strictEqual(out.unassigned.length, 0);
});

// -- team-rates.json --------------------------------------------------------------------

const doc = { team_rates: [{ name: 'Morgan Alex', daily_rate: 900, note: 'x' }, { name: 'Someone Else', daily_rate: 500 }], meta: 1 };

test('rates: mapping by name, unmatched entries listed', () => {
  const m = rates.mapRates(doc, [{ id: 'tm-1', name: 'Alex Morgan' }, { id: 'tm-2', name: 'Sam River' }]);
  assert.deepStrictEqual(m.rates, [{ id: 'tm-1', daily_rate: 900 }]);
  assert.deepStrictEqual(m.unmatched, [{ name: 'Someone Else', daily_rate: 500 }]);
});

test('rates: update in place keeps spelling, order and extra fields; append; null removes', () => {
  const up = rates.applyRate(doc, 'Alex Morgan', 950);
  assert.deepStrictEqual(up.doc.team_rates[0], { name: 'Morgan Alex', daily_rate: 950, note: 'x' });
  assert.strictEqual(up.doc.team_rates[1].name, 'Someone Else');
  assert.strictEqual(up.doc.meta, 1);
  const ap = rates.applyRate(doc, 'Sam River', 700);
  assert.deepStrictEqual(ap.doc.team_rates[2], { name: 'Sam River', daily_rate: 700 });
  assert.strictEqual(ap.doc.team_rates.length, 3);
  const rm = rates.applyRate(doc, 'Alex Morgan', null);
  assert.deepStrictEqual(rm.doc.team_rates.map((e) => e.name), ['Someone Else']);
  assert.strictEqual(rates.applyRate(doc, 'Nobody Here', null).doc.team_rates.length, 2);
  const amb = rates.applyRate({ team_rates: [{ name: 'Sam Riverside', daily_rate: 1 }, { name: 'Sam Riverton', daily_rate: 2 }] }, 'Sam River', 5);
  assert.strictEqual(amb.ok, false);
});

test('store: containment allows costs/ only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'costs-rates-'));
  fs.writeFileSync(path.join(root, 'README.md'), 'team data\n');
  store.writeJsonPrivate(root, 'costs/team-rates.json', { team_rates: [] });
  assert.ok(fs.existsSync(path.join(root, 'costs', 'team-rates.json')));
  for (const bad of ['team-rates.json', 'team-rates.json.bak', 'other.json', 'costs/../team-rates2.json', '../team-rates.json', 'x/team-rates.json', 'costs']) {
    assert.throws(() => store.writeJsonPrivate(root, bad, {}), { code: 'path-outside' }, bad);
  }
});

// -- routes -------------------------------------------------------------------------------

const ROSTER = { team_members: roster };
function setup({ http = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'costs-epics-'));
  const priv = path.join(base, 'priv');
  const tier0 = path.join(base, 'tier0');
  const dataDir = path.join(base, 'cache');
  fs.mkdirSync(path.join(tier0, 'team'), { recursive: true });
  fs.mkdirSync(dataDir);
  fs.mkdirSync(priv);
  fs.mkdirSync(path.join(priv, 'costs'));
  fs.writeFileSync(path.join(priv, 'costs', 'team-rates.json'), JSON.stringify({ team_rates: [] }));
  fs.writeFileSync(path.join(tier0, 'team', 'team-members.json'), JSON.stringify(ROSTER));
  let last = null;
  const ctx = {
    dataRepoDir: () => priv, dataTier0Dir: tier0, dataDir, log: () => {},
    makeLock: () => (fn) => Promise.resolve().then(fn),
    jsonResponse: (_res, status, body) => { last = { status, body }; },
    readBody: async (req) => req.body,
  };
  const api = createRoutes(ctx, { http: () => http, now: () => new Date(2026, 9, 9, 12), env: { JIRA_TOKEN: 'tok' } });
  const call = async (method, p, body, query) => {
    await api.routes.find((r) => r.method === method && r.path === p).handler({ url: '/x' + (query || ''), body }, {});
    return last;
  };
  return { priv, api, call };
}

test('POST /config external: create, duplicate refused, edit, rate, remove keeps the rate', async () => {
  const { priv, call } = setup();
  const bad = await call('POST', '/config', { external: true, name: 'x' });
  assert.strictEqual(bad.status, 400);
  const ok = await call('POST', '/config', { external: true, name: 'Quinn Lane', email: 'Lane@Example.com', included: true, areas: ['borealis', 'delta'] });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.member.id, 'ext:lane@example.com');
  assert.strictEqual(ok.body.member.email, 'lane@example.com');
  for (const dup of [{ name: 'Other Name', email: 'lane@example.com' }, { name: 'Lane Quinn' }, { name: 'Alex Morgan' }, { name: 'Someone', email: 'alex@example.com' }]) {
    assert.strictEqual((await call('POST', '/config', { external: true, ...dup })).status, 409, JSON.stringify(dup));
  }
  const edit = await call('POST', '/config', { id: 'ext:lane@example.com', areas: ['comet'] });
  assert.deepStrictEqual(edit.body.member.areas, ['comet']);
  const rate = await call('POST', '/rate', { id: 'ext:lane@example.com', daily_rate: 800 });
  assert.strictEqual(rate.status, 200);
  const file = JSON.parse(fs.readFileSync(path.join(priv, 'costs', 'team-rates.json'), 'utf8'));
  assert.deepStrictEqual(file.team_rates, [{ name: 'Quinn Lane', daily_rate: 800 }]);
  const get = await call('GET', '/config');
  const row = get.body.members.find((m) => m.id === 'ext:lane@example.com');
  assert.strictEqual(row.external, true);
  assert.strictEqual(row.rate, 800);
  assert.deepStrictEqual(get.body.ratesUnmatched, []);
  await call('POST', '/config', { id: 'ext:lane@example.com', remove: true });
  const after = await call('GET', '/config');
  assert.ok(!after.body.members.some((m) => m.external));
  assert.deepStrictEqual(after.body.ratesUnmatched, [{ name: 'Quinn Lane', daily_rate: 800 }]);
});

test('POST /rate writes into an existing team-rates.json in place', async () => {
  const { priv, call } = setup();
  fs.writeFileSync(path.join(priv, 'costs', 'team-rates.json'), JSON.stringify(doc));
  const g = await call('GET', '/config');
  assert.strictEqual(g.body.members.find((m) => m.id === 'tm-1').rate, 900);
  await call('POST', '/rate', { id: 'tm-1', daily_rate: 1000.456 });
  const file = JSON.parse(fs.readFileSync(path.join(priv, 'costs', 'team-rates.json'), 'utf8'));
  assert.deepStrictEqual(file.team_rates[0], { name: 'Morgan Alex', daily_rate: 1000.46, note: 'x' });
  assert.strictEqual(file.meta, 1);
  assert.ok(!fs.existsSync(path.join(priv, 'costs', 'rates.json')));
});

test('POST /refresh writes schemaVersion 3 shards with Jira details; Jira failure keeps hours and warns; /epics serves the tree', async () => {
  const worklogs = [
    wl('alex@example.com', 'Alex Morgan', '2026-09-02', 8 * H, 'BOR-1'),
  ];
  const mk = (jiraOk) => ({
    fetchJson: async (url) => {
      if (url.includes('tempo-timesheets')) return url.includes('projectKey=APP&') ? worklogs : [];
      if (!jiraOk) throw new Error('HTTP 500');
      const keys = /\(([^)]*)\)/.exec(decodeURIComponent(url))[1].split(',');
      const db = { 'BOR-1': { summary: 'One', issuetype: { name: 'Task' }, customfield_10001: 'BOR-100' }, 'BOR-100': { summary: 'Epic', issuetype: { name: 'Epic' } } };
      return { issues: keys.filter((k) => db[k]).map((k) => ({ key: k, fields: db[k] })) };
    },
  });
  const run = async (http) => {
    const s = setup({ http });
    await call_(s, 'POST', '/config', { id: 'tm-1', included: true, areas: ['borealis'] });
    await call_(s, 'POST', '/rate', { id: 'tm-1', daily_rate: 800 });
    await call_(s, 'POST', '/refresh', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    await s.api.idle();
    return s;
  };
  const call_ = (s, m, p, b) => s.call(m, p, b);
  const good = await run(mk(true));
  const shard = JSON.parse(fs.readFileSync(path.join(good.priv, 'costs', 'hours', '2026-09.json'), 'utf8'));
  assert.strictEqual(shard.schemaVersion, 3);
  assert.deepStrictEqual(shard.authors[0].issues, { 'BOR-1': 8 * H });
  assert.deepStrictEqual(shard.issues['BOR-1'], { summary: 'One', type: 'Task', epicKey: 'BOR-100', epicName: 'Epic' });
  const tree = await good.call('GET', '/epics', null, '?year=2026&area=borealis');
  assert.strictEqual(tree.body.epics[0].name, 'Epic');
  assert.strictEqual(tree.body.epics[0].total.cost, 800);
  assert.strictEqual((await good.call('GET', '/epics', null, '?area=zz')).status, 400);

  const bad = await run(mk(false));
  const shard2 = JSON.parse(fs.readFileSync(path.join(bad.priv, 'costs', 'hours', '2026-09.json'), 'utf8'));
  assert.strictEqual(shard2.authors[0].seconds, 8 * H);
  assert.deepStrictEqual(shard2.issues, {});
  const st = await bad.call('GET', '/status');
  assert.ok(st.body.lastRun.ok);
  assert.ok(st.body.lastRun.warnings.length >= 1);
  const t2 = await bad.call('GET', '/epics', null, '?year=2026&area=borealis');
  assert.strictEqual(t2.body.epics[0].issues[0].key, 'BOR-1');
  assert.strictEqual(t2.body.epics[0].issues[0].summary, '');
});

// -- client lib ----------------------------------------------------------------------------

test('client lib: cell text with dashes and unpriced marker, search filter, sums, name cleanup', () => {
  assert.strictEqual(lib.treeCellText({ hours: 0, days: 0, cost: 0, noRateHours: 0 }, 'cost'), '—');
  assert.strictEqual(lib.treeCellText({ hours: 8, days: 1, cost: 0, noRateHours: 8 }, 'cost'), '—');
  assert.strictEqual(lib.treeCellUnpriced({ hours: 8, days: 1, cost: 0, noRateHours: 8 }, 'cost'), true);
  assert.strictEqual(lib.treeCellUnpriced({ hours: 8, days: 1, cost: 0, noRateHours: 8 }, 'hours'), false);
  assert.match(lib.treeCellText({ hours: 8, days: 1, cost: 0, noRateHours: 8 }, 'hours'), /8\.0 h/);
  const cell = (h) => ({ hours: h, days: h / 8, cost: h * 10, noRateHours: 0 });
  const mk = (key, name, issues) => ({ key, name, issues, months: {}, total: cell(1) });
  const is = (key, summary) => ({ key, summary, months: { '2026-01': cell(2) }, total: cell(2), persons: [] });
  const epics = [mk('E-1', 'Café payments', [is('A-1', 'Card'), is('A-2', 'Wallet')]), mk('E-2', 'Other', [is('A-3', 'Report')])];
  assert.deepStrictEqual(lib.filterEpics(epics, 'cafe pay').map((e) => e.key), ['E-1']);
  assert.strictEqual(lib.filterEpics(epics, 'cafe pay')[0].issues.length, 2);
  assert.deepStrictEqual(lib.filterEpics(epics, 'wallet')[0].issues.map((i) => i.key), ['A-2']);
  assert.deepStrictEqual(lib.filterEpics(epics, 'a-3').map((e) => e.key), ['E-2']);
  const sum = lib.sumEpics(lib.filterEpics(epics, 'wallet'), ['2026-01']);
  assert.strictEqual(sum['2026-01'].hours, 2);
  assert.strictEqual(lib.cleanTempoName('VND Quinn Lane [X]'), 'Quinn Lane');
});
