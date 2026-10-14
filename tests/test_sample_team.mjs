// tests/test_sample_team.mjs
// The "Northwind Product" sample team (scripts/sample-team.js -> examples/sample-team/ds-data).
//   AC1  the generator is deterministic and the committed tree is its output
//   AC2  every dataRepos path of every catalog module has sample data
//   AC3  the data has the SHAPES each module reads: the module's own route
//        handlers answer non-empty data from it, with no error
//   AC4  the content is the fictional Northwind team, ASCII, inside the quarter

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = path.join(ROOT, 'scripts', 'sample-team.js');
const COMMITTED = path.join(ROOT, 'examples', 'sample-team');
const CATALOG = path.join(ROOT, 'catalog', 'modules');
const { generate, QUARTER_START, QUARTER_END } = require(GENERATOR);

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

let tmp;
let treeA;
let treeB;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-team-'));
  treeA = path.join(tmp, 'a');
  treeB = path.join(tmp, 'b');
  generate(treeA);
  generate(treeB);
});
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('AC1: a deterministic generator', () => {
  it('has no clock and no randomness in its source', () => {
    for (const f of ['sample-team.js', '_sample-team-content.js']) {
      const src = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
      assert.doesNotMatch(src, /Date\.now\s*\(/, f);
      assert.doesNotMatch(src, /Math\.random\s*\(/, f);
      assert.doesNotMatch(src, /new Date\(\s*\)/, f);
      assert.doesNotMatch(src, /\brandomBytes\s*\(/, f + ' (use the seeded generator)');
    }
  });

  it('writes a byte-identical tree on a second run', () => {
    const a = walk(path.join(treeA, 'ds-data'));
    const b = walk(path.join(treeB, 'ds-data'));
    assert.deepEqual(a, b);
    assert.ok(a.length > 200, 'only ' + a.length + ' files');
    for (const rel of a) {
      assert.ok(
        fs.readFileSync(path.join(treeA, 'ds-data', rel)).equals(fs.readFileSync(path.join(treeB, 'ds-data', rel))),
        rel + ' differs between two runs',
      );
    }
  });

  it('the committed examples/sample-team tree is what the generator writes today', () => {
    const fresh = walk(path.join(treeA, 'ds-data'));
    const committed = walk(path.join(COMMITTED, 'ds-data'));
    assert.deepEqual(committed, fresh, 'run: node scripts/sample-team.js');
    for (const rel of fresh) {
      assert.ok(
        fs.readFileSync(path.join(treeA, 'ds-data', rel)).equals(fs.readFileSync(path.join(COMMITTED, 'ds-data', rel))),
        rel + ' is stale, run: node scripts/sample-team.js',
      );
    }
  });

  it('the command line writes <out>/ds-data and refuses an unknown flag', () => {
    const out = path.join(tmp, 'cli');
    const ok = spawnSync(process.execPath, [GENERATOR, '--out', out], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(fs.existsSync(path.join(out, 'ds-data', 'team', 'team-members.json')));
    const bad = spawnSync(process.execPath, [GENERATOR, '--nope'], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
  });
});

describe('AC2: every declared module path has sample data', () => {
  const ids = fs.readdirSync(CATALOG).filter((d) => fs.existsSync(path.join(CATALOG, d, 'module.json'))).sort();

  it('covers all catalog modules', () => {
    assert.equal(ids.length, 23);
  });

  for (const id of ids) {
    it(id, () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(CATALOG, id, 'module.json'), 'utf8'));
      for (const repo of manifest.dataRepos || []) {
        for (const p of repo.paths || []) {
          const abs = path.join(COMMITTED, 'ds-data', p);
          assert.ok(fs.existsSync(abs), id + ': missing ' + p);
          if (fs.statSync(abs).isDirectory()) {
            assert.ok(walk(abs).length > 0, id + ': empty ' + p);
          } else {
            assert.ok(fs.statSync(abs).size > 2, id + ': empty ' + p);
          }
        }
      }
    });
  }
});

describe('AC3: the modules read the sample data', () => {
  const DS = path.join(COMMITTED, 'ds-data');
  const savedEnv = {};
  let scratch;

  before(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-team-ctx-'));
    for (const k of ['DATA_SUB_REPOS_DIR', 'DATA_TIER_0_DIR']) savedEnv[k] = process.env[k];
    process.env.DATA_SUB_REPOS_DIR = COMMITTED;
    process.env.DATA_TIER_0_DIR = DS;
  });
  after(() => {
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  function makeCtx() {
    return {
      rootDir: path.join(scratch, 'root'),
      dataDir: path.join(scratch, 'data'),
      dataTier0Dir: DS,
      dataRepoDir: (name) => (name === 'data-tier-0' ? DS : null),
      jsonResponse(res, status, body) { res.status = status; res.body = body; },
      readBody: async () => ({}),
      makeLock: () => async (fn) => fn(),
      log() {},
      checkOrigin: () => true,
    };
  }

  async function get(id, url) {
    const reg = require(path.join(CATALOG, id, 'server', 'index.js'));
    const routes = (typeof reg === 'function' ? reg : reg.register)(makeCtx()).routes;
    const route = routes.find((r) => r.method === 'GET' && r.path === url.split('?')[0]);
    assert.ok(route, id + ' has no GET ' + url);
    const res = {};
    await route.handler({ url, method: 'GET', headers: {} }, res);
    assert.equal(res.status, 200, id + ' ' + url + ' -> ' + JSON.stringify(res.body).slice(0, 200));
    return res.body;
  }

  it('team-directory: the browser loader reads 24 people with avatars on disk', async () => {
    const dir = await import(pathToFileURL(path.join(ROOT, 'js', 'team-directory.js')).href);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/team\/team-members\.json$/);
      const text = fs.readFileSync(path.join(DS, 'team', 'team-members.json'), 'utf8');
      return { ok: true, json: async () => JSON.parse(text) };
    };
    try {
      const members = await dir.loadTeamDirectory(true);
      assert.equal(members.length, 24);
      const alex = dir.memberByName('Alex Morgan');
      assert.ok(alex, 'Alex Morgan is not in the directory');
      assert.equal(dir.memberByEmail(alex.email).id, alex.id);
      for (const m of members) {
        assert.ok(m.avatar && m.avatar.endsWith('.svg'), m.email + ' has no generated avatar');
        assert.ok(fs.existsSync(path.join(DS, 'team', 'avatars', m.avatar)), m.avatar);
      }
    } finally { globalThis.fetch = realFetch; }
  });

  it('sprint-stats: 12 sprint entries, shards, spillover', async () => {
    const ov = await get('sprint-stats', '/overview');
    assert.equal(ov.storage, 'ok');
    assert.equal(ov.index.sprints.length, 12);
    const sp = await get('sprint-stats', '/sprint?main=26&platform=26');
    assert.equal(sp.main.teams.length, 5);
    assert.equal(sp.platform.teams[0].team, 'Delta');
    assert.equal(sp.platform.teams[0].unit, 'MD');
    assert.ok(sp.main.teams[0].issues.length > 3 && sp.main.teams[0].burndown.length === 14);
    const spill = await get('sprint-stats', '/spillover');
    assert.equal(spill.aggregate.sprints.length, 6);
    assert.equal(spill.file.current, true);
  });

  it('sprint-stats: one bad sprint and a recovery (Comet, sprint 23)', async () => {
    const pct = async (n) => {
      const r = await get('sprint-stats', '/sprint?main=' + n);
      return r.main.teams.find((t) => t.team === 'Comet').summary.completion_pct;
    };
    const bad = await pct(23);
    assert.ok(bad < 65, 'sprint 23 completion ' + bad);
    assert.ok(await pct(25) > 85, 'no recovery');
  });

  it('roadmap: 15 initiatives, two slipping, the logged time of the time log', async () => {
    const init = await get('roadmap', '/initiatives');
    assert.equal(init.count, 15);
    assert.deepEqual(init.skipped, []);
    assert.equal(init.initiatives.filter((i) => i.ragStatus === 'red').length, 2);
    const wl = await get('roadmap', '/worklogs');
    assert.equal(wl.available, true);
    assert.ok(Object.keys(wl.worklogs).length >= 20);
    const widget = await get('roadmap', '/widget');
    assert.equal(widget.initiatives.length, 5);
  });

  it('prod-bugs: six sprints with a spike after the release', async () => {
    const ov = await get('prod-bugs', '/overview');
    assert.equal(ov.sprints.length, 6);
    assert.deepEqual(ov.skipped, []);
    const created = ov.sprints.map((s) => Object.values(s.areas).reduce((n, a) => n + a.createdCount, 0));
    const spike = Math.max(...created);
    assert.equal(created.indexOf(spike), 3, 'the spike is in sprint 24: ' + created.join(','));
    assert.ok(spike > 2 * created[0]);
    const widget = await get('prod-bugs', '/widget');
    assert.ok(widget.latest && widget.series.length === 6);
  });

  it('time-log: 24 people over the last 14 days, some days missing', async () => {
    const data = await get('time-log', '/data');
    assert.equal(data.available, true);
    assert.equal(data.persons.length, 24);
    assert.equal(data.dates.length, 14);
    assert.ok(data.persons.some((p) => p.miss_days_count > 0));
    assert.ok(data.persons.some((p) => p.logged_days_count >= 8));
  });

  it('on-call: a rota for September with a roster and one swap', async () => {
    const data = await get('on-call', '/data?month=2026-09');
    assert.equal(data.available, true);
    assert.ok(data.month.entries.length >= 30 * 4);
    assert.ok(data.index.roster.length >= 6);
    assert.deepEqual(data.months, ['2026-07', '2026-08', '2026-09']);
    const aug = await get('on-call', '/data?month=2026-08');
    assert.equal(aug.month.entries.filter((e) => /swap/.test(e.note)).length, 2);
  });

  it('time-off: every person has an entry inside the quarter', async () => {
    const data = await get('time-off', '/data');
    assert.equal(data.persons.length, 24);
    assert.ok(data.entries.length >= 24);
    for (const e of data.entries) {
      assert.ok(e.dateFrom >= QUARTER_START && e.dateTo <= QUARTER_END, JSON.stringify(e));
    }
  });

  it('costs: priced hours for the whole team, nothing unassigned', async () => {
    const data = await get('costs', '/data?year=2026');
    assert.equal(data.available, true);
    assert.deepEqual(data.months, ['2026-07', '2026-08', '2026-09']);
    assert.equal(data.persons.length, 27);
    assert.equal(data.unassigned.length, 0);
    assert.equal(data.summary.all.personsNoRate, 0);
    assert.ok(data.summary.all.cost > 100000);
    const epics = await get('costs', '/epics?year=2026&area=atlas');
    assert.ok(epics.epics.length >= 2);
  });

  it('vendor-settlements: three vendors, nine settlements, one overdue protocol', async () => {
    const data = await get('vendor-settlements', '/data');
    assert.equal(data.storage, 'ok');
    assert.equal(data.summary.assignments.length, 9);
    assert.deepEqual(data.vendorInfo.vendors.map((v) => v.name).sort(), ['Acme Ltd', 'Globex', 'Initech']);
    assert.equal(data.purchaseOrders.length, 3);
    assert.equal(data.teamMembers.length, 24);
    const prot = await get('vendor-settlements', '/protocols-all');
    assert.equal(prot.protocols.length, 9);
    assert.equal(prot.protocols.filter((p) => p.status === 'overdue').length, 1);
  });

  it('knowledge-base: 12 documents in six areas', async () => {
    const list = await get('knowledge-base', '/list');
    assert.equal(list.storage, 'ok');
    assert.equal(list.articles.length, 12);
    assert.equal(list.areas.length, 6);
    assert.deepEqual(list.skipped, { tooLarge: 0, overCap: 0, badName: 0 });
    const art = await get('knowledge-base', '/article?path=' + encodeURIComponent(list.articles[0].path));
    assert.ok(art.body.length > 100);
  });

  it('meeting-archive: 8 meetings, 3 with a transcript', async () => {
    const list = await get('meeting-archive', '/list');
    assert.equal(list.meetings.length, 8);
    assert.equal(list.meetings.filter((m) => m.hasTranscript).length, 3);
    assert.equal(list.meetings.filter((m) => m.status === 'error').length, 0);
    const withTranscript = list.meetings.find((m) => m.hasTranscript);
    const one = await get('meeting-archive', '/meeting?folder=' + encodeURIComponent(withTranscript.folder));
    assert.ok(one.transcript.length >= 3 && one.summaryMd.length > 50);
  });

  it('devops-stats: issues with flow intervals that pass the module validator', async () => {
    const ov = await get('devops-stats', '/overview');
    assert.ok(ov.index.shards.length >= 3);
    const issues = await get('devops-stats', '/issues');
    assert.ok(issues.issues.length >= 20);
    const x = await import(pathToFileURL(path.join(CATALOG, 'devops-stats', 'scripts', '_extract.mjs')).href);
    for (const f of issues.issues) assert.deepEqual(x.validateFact(f), [], f.key);
  });

  it('qa-tests: coverage aggregate and seven area shards', async () => {
    const ov = await get('qa-tests', '/overview');
    assert.ok(ov.index.aggregates.aggregate.active_total > 100);
    const shards = Object.keys(ov.index.shard_to_module);
    assert.equal(shards.length, 7);
    for (const k of shards) {
      const shard = JSON.parse(fs.readFileSync(path.join(DS, 'jira', 'qa-automation', 'module-' + k + '.json'), 'utf8'));
      assert.equal(shard.key, k);
    }
  });

  it('sprint-planning and sprint-review: plans and sessions for the last sprints', async () => {
    const st = await get('sprint-planning', '/status');
    assert.equal(st.storage, 'ok');
    assert.equal(st.plans.length, 16);
    const plan = await get('sprint-planning', '/plan?id=atlas-25');
    assert.equal(plan.sections.goal.done, true);
    const rv = await get('sprint-review', '/sessions');
    assert.equal(rv.sessions.length, 6);
    const one = await get('sprint-review', '/session?id=' + rv.sessions[0].id);
    assert.equal(Object.keys(one.submissions).length, 6);
  });

  it('responsibilities, onboarding, locations, rollout-waves, usage-analytics', async () => {
    const resp = await get('responsibilities', '/data?project=main');
    assert.equal(resp.available, true);
    assert.equal(resp.data.groups.reduce((n, g) => n + g.areas.length, 0), 10);
    const plans = await get('onboarding', '/plans');
    assert.ok(plans.plans.length >= 2);
    const links = await get('onboarding', '/links');
    assert.ok(links.links.length >= 4);
    const dir = await get('locations', '/directory');
    assert.equal(dir.directory.row_count, 30);
    assert.equal(dir.facets.regions.length, 6);
    const dash = await get('rollout-waves', '/dashboard');
    assert.equal(dash.directory.present, true);
    assert.equal(dash.config.waves_count, 4);
    assert.ok(dash.kpi);
    const ua = await get('usage-analytics', '/data');
    assert.equal(ua.ok, true);
    assert.ok(ua.aggregate.periods || ua.aggregate.meta);
  });

  it('gantt-roadmap: two quarters with tasks and a roster', async () => {
    const st = await get('gantt-roadmap', '/status');
    assert.deepEqual(st.quarters, ['q3-2026', 'q4-2026']);
    const q = await get('gantt-roadmap', '/quarter?id=q3-2026');
    assert.ok(q.tasks.length >= 10, 'tasks');
    assert.equal(q.areas.length, 6);
    assert.equal((q.meta || q.quarter).roster.length, 24);
    assert.ok(q.backlog.length >= 2);
  });

  it('demo-hub: the note carries the server-owned header', () => {
    const note = fs.readFileSync(path.join(DS, 'demo-hub', 'note.md'), 'utf8');
    assert.match(note, /^---\nauthor: /);
  });
});

describe('AC4: Northwind Product, fictional and tidy', () => {
  const DS = path.join(COMMITTED, 'ds-data');
  const files = () => walk(DS);

  it('six squads with four people each, invented names, generated avatars', () => {
    const team = JSON.parse(fs.readFileSync(path.join(DS, 'team', 'team-members.json'), 'utf8'));
    const bySquad = {};
    for (const m of team.team_members) (bySquad[m.team] = bySquad[m.team] || []).push(m);
    assert.deepEqual(Object.keys(bySquad).sort(), ['Atlas', 'Borealis', 'Comet', 'Delta', 'Echo', 'Falcon']);
    for (const list of Object.values(bySquad)) assert.equal(list.length, 4);
    for (const m of team.team_members) {
      assert.match(m.email, /@northwind\.example$/);
      const svg = fs.readFileSync(path.join(DS, 'team', 'avatars', m.avatar), 'utf8');
      assert.match(svg, /^<svg /);
      assert.ok(svg.includes((m.first_name[0] + m.last_name[0]).toUpperCase()));
    }
    assert.equal(files().filter((f) => f.startsWith('team/avatars/')).length, 24);
    assert.equal(files().filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).length, 0, 'no photos');
  });

  it('three vendors: Acme Ltd, Globex, Initech', () => {
    const info = JSON.parse(fs.readFileSync(path.join(DS, 'vendor-settlements', 'vendor-info.json'), 'utf8'));
    assert.deepEqual(info.vendors.map((v) => v.name), ['Acme Ltd', 'Globex', 'Initech']);
  });

  it('all text is ASCII English with no real-looking host or secret', () => {
    for (const rel of files()) {
      const text = fs.readFileSync(path.join(DS, rel), 'utf8');
      assert.doesNotMatch(text, /[^\x00-\x7F]/, rel + ' has a non-ASCII character');
      for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        if (m[1] === 'www.w3.org') continue; // the SVG namespace of the generated avatars
        assert.match(m[1], /(^|\.)(example\.com|northwind\.example)$/i, rel + ' mentions a real host: ' + m[0]);
      }
      assert.doesNotMatch(text, /glpat-|AKIA[0-9A-Z]{12}|-----BEGIN|xox[bp]-/, rel + ' looks like a secret');
    }
  });

  it('every date sits inside the quarter, except future roadmap items', () => {
    // only the roadmap looks ahead: initiatives and the next quarter's Gantt
    const futureOk = (rel) => rel.startsWith('discovery-tasks/') || rel.startsWith('gantt-roadmap/q4-2026/');
    const bad = [];
    for (const rel of files()) {
      if (rel.endsWith('.svg') || futureOk(rel)) continue;
      const text = fs.readFileSync(path.join(DS, rel), 'utf8');
      for (const m of text.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)) {
        if (m[1] < QUARTER_START || m[1] > QUARTER_END) bad.push(rel + ': ' + m[1]);
      }
    }
    assert.deepEqual([...new Set(bad)].slice(0, 20), []);
  });

  it('passes the secret scanner of the publish pipeline when it is installed', (t) => {
    const probe = spawnSync('trufflehog', ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) { t.skip('trufflehog not installed'); return; }
    const r = spawnSync('trufflehog', ['filesystem', path.join(ROOT, 'examples'), '--no-update', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const hits = (r.stdout || '').split('\n').filter((l) => l.includes('"DetectorName"'));
    assert.deepEqual(hits, []);
  });
});
