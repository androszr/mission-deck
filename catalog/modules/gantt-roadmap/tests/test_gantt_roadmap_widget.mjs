// modules/gantt-roadmap/tests/test_gantt_roadmap_widget.mjs
// Dashboard widget: manifest, pure painter, and the READ-ONLY GET /widget route
// (a temp tree with a duplicate display number; no shard may change).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const register = require('../server/index.js');
const { buildWidgetPayload } = require('../server/widget.js');

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const { kit } = await import(pathToFileURL(path.join(findAppRoot(DIR), 'js', 'dashboard-widget-kit.js')).href);

const NOW = new Date(2026, 9, 14, 12, 0, 0); // week 3 of a quarter starting Mon 2026-09-28

function makeTree({ withData = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-widget-'));
  const repo = path.join(root, 'ds-data');
  fs.mkdirSync(repo, { recursive: true });
  const q = path.join(repo, 'gantt-roadmap', 'q4-2026');
  if (withData) {
    fs.mkdirSync(path.join(q, 'areas'), { recursive: true });
    fs.mkdirSync(path.join(q, 'tasks'), { recursive: true });
    const w = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
    w(path.join(repo, 'gantt-roadmap', 'index.json'), { activeQuarter: 'q4-2026', quarters: ['q4-2026'] });
    w(path.join(q, 'quarter.json'), {
      id: 'q4-2026', label: 'Q4 2026', mondayFirst: '2026-09-28', weeksN: 14, weekFirstNo: 40,
      sprints: [{ no: 20, label: 'Sprint 20', start: '2026-10-05', days: 14 }],
      roster: [{ id: 'am', n: 'Alex Morgan' }, { id: 'sr', n: 'Sam Rivera' }],
    });
    w(path.join(q, 'areas', 'availability.json'), { id: 'availability', name: 'Availability', color: 'a', o: 1 });
    const t = (uid, o) => w(path.join(q, 'tasks', uid + '.json'), { uid, a: 'availability', o: 1, who: [], s: 1, l: 1, ph: null, gw: false, ms: false, createdAt: '2026-09-01T00:00:00Z', ...o });
    t('t-0000000000000001', { n: 1, t: 'Threshold model', who: ['am', 'sr'], s: 2, l: 2 });
    t('t-0000000000000002', { n: 1, t: 'Duplicate number', who: ['am'], s: 3, l: 1, ms: true });
    t('t-0000000000000003', { n: 3, t: 'Old task', who: ['sr'], s: 1, l: 1 });
  }
  return { root, repo, q };
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = fs.readFileSync(p, 'utf8') + '|' + fs.statSync(p).mtimeMs;
    }
  };
  walk(dir);
  return out;
}

function makeCtx(root, repo) {
  return {
    moduleId: 'gantt-roadmap', dataDir: path.join(root, '.m'), rootDir: root, log: () => {},
    dataRepoDir: (n) => (n === 'data-tier-0' ? repo : null),
    jsonResponse: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async () => ({}), checkOrigin: () => true,
    makeLock: () => () => { throw new Error('GET /widget must not take a lock'); },
  };
}

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'gantt-roadmap');
  assert.equal(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.ok(w.variants.length <= 6 && w.variants.some((v) => v.rows === 2));
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.deepEqual(w.variants.map((v) => v.id), Object.keys(widget.VARIANT_BLOCKS).sort((a, b) => ['s2', 'm', 'm2', 'l', 'xl'].indexOf(a) - ['s2', 'm', 'm2', 'l', 'xl'].indexOf(b)));
  assert.equal(manifest.version, '0.2.1');
});

test('route: GET /widget answers the week aggregate and writes NOTHING', async () => {
  const { root, repo } = makeTree();
  const routes = register(makeCtx(root, repo)).routes;
  const r = routes.find((x) => x.method === 'GET' && x.path === '/widget');
  assert.ok(r);
  const before = snapshot(repo);
  const body = buildWidgetPayload(root, NOW);
  const res = {};
  await r.handler({ url: '/widget', method: 'GET' }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(snapshot(repo), before, 'no shard, index or quarter file changed');
  assert.equal(body.available, true);
  assert.equal(body.week.index, 3);
  assert.equal(body.week.no, 42);
  assert.equal(body.counts.active, 2);
  assert.equal(body.counts.done, 1);
  assert.equal(body.counts.endingThisWeek, 2);
  assert.equal(body.counts.milestones, 1);
  assert.deepEqual(body.owners.map((o) => [o.name, o.count]), [['Alex Morgan', 2], ['Sam Rivera', 1]]);
  assert.equal(body.sprint.label, 'Sprint 20');
  assert.equal(body.heat.cols.length, 5);
  assert.ok(body.tasks.every((t) => typeof t.title === 'string'));
});

test('route: outside the quarter -> week null; no clone -> unavailable', () => {
  const { root, repo } = makeTree();
  register(makeCtx(root, repo));
  const far = buildWidgetPayload(root, new Date(2027, 5, 1));
  assert.equal(far.available, true);
  assert.equal(far.week, null);
  register({ ...makeCtx(root, repo), dataRepoDir: undefined }); // no core resolver: default layout under rootDir
  const nothing = buildWidgetPayload(path.join(os.tmpdir(), 'gr-widget-missing-' + process.pid), NOW);
  assert.equal(nothing.available, false);
  assert.equal(nothing.storage, 'unavailable');
});

test('widget: blocks per variant, avatars from the data, empty states', () => {
  const { root, repo } = makeTree();
  register(makeCtx(root, repo));
  const data = buildWidgetPayload(root, NOW);
  const { blocks, empty } = widget.buildBlocks(data);
  assert.equal(empty, null);
  assert.equal(blocks.donut.value, 3);
  assert.equal(blocks.donut.max, 14);
  assert.deepEqual(blocks.avatars.people.map((p) => p.name), ['Alex Morgan', 'Sam Rivera']);
  assert.equal(blocks.tiles.tiles[0].value, '2');
  for (const v of manifest.widgets[0].variants) {
    const html = widget.paint(data, v.id, { cols: v.cols, rows: v.rows }, kit);
    assert.ok(html.includes('dash-kit'), v.id);
  }
  assert.match(widget.paint({ available: true, storage: 'ok', quarter: { label: 'Q4 2026' }, week: null }, 'm2', {}, kit), /Outside the range of quarter Q4 2026/);
  assert.match(widget.paint({ storage: 'unavailable' }, 'm2', {}, kit), /Sync window/);
  assert.match(widget.paint({ available: false, storage: 'ok' }, 'm2', {}, kit), /No roadmap for the current quarter/);
});

test('widget: 404 on /widget paints the restart hint and never calls another route', async () => {
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(u); return { ok: false, status: 404 }; };
  const el = { innerHTML: '' };
  await widget.renderWidget(el, { apiBase: '/api/m/gantt-roadmap', signal: new AbortController().signal, kit, variant: { id: 'm2', cols: 3, rows: 2 } });
  assert.match(el.innerHTML, /Restart server/);
  assert.deepEqual(urls, ['/api/m/gantt-roadmap/widget']);
});

test('route: sprint of TODAY (not the one ending on the week Monday), week numbers from weekFirstNo, bad shard skipped', () => {
  const { root, repo, q } = makeTree();
  const meta = JSON.parse(fs.readFileSync(path.join(q, 'quarter.json'), 'utf8'));
  meta.weekFirstNo = 50; // deliberately not the ISO number: the view labels weeks weekFirstNo + i
  meta.sprints = [
    { no: 19, label: 'S19', start: '2026-09-29', days: 14, w1: 1, w2: 2 }, // ends Mon 2026-10-12
    { no: 20, label: 'S20', start: '2026-10-13', days: 14, w1: 3, w2: 4 },
  ];
  fs.writeFileSync(path.join(q, 'quarter.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(q, 'tasks', 't-0000000000000009.json'), JSON.stringify({ uid: 't-0000000000000009', a: 'availability', n: 9, t: 'No start', who: ['am'], s: null, l: 1 }));
  register(makeCtx(root, repo));
  const body = buildWidgetPayload(root, NOW); // Wed 2026-10-14
  assert.equal(body.sprint.label, 'S20');
  assert.equal(body.week.no, 52);
  assert.deepEqual(body.heat.cols, ['T50', 'T51', 'T52', 'T53', 'T54']);
  assert.ok(!body.tasks.some((t) => t.title === 'No start'));
  assert.equal(body.counts.active + body.counts.done + body.counts.upcoming, 3);
});

test('widget: an empty clone is the Sync window sentence, never a zero', () => {
  const { root, repo } = makeTree({ withData: false });
  fs.rmSync(path.join(repo, 'gantt-roadmap'), { recursive: true, force: true });
  register(makeCtx(root, repo));
  const body = buildWidgetPayload(root, NOW);
  assert.equal(body.storage, 'empty');
  assert.equal(body.available, false);
  assert.match(widget.paint(body, 'm2', { cols: 3, rows: 2 }, kit), /Sync window/);
});

test('widget: an aborted mount paints nothing', async () => {
  const ac = new AbortController();
  globalThis.fetch = async () => { ac.abort(); return { ok: true, status: 200, json: async () => ({ storage: 'unavailable' }) }; };
  const el = { innerHTML: 'x' };
  await widget.renderWidget(el, { apiBase: '/api/m/gantt-roadmap', signal: ac.signal, kit, variant: { id: 'm2', cols: 3, rows: 2 } });
  assert.equal(el.innerHTML, 'x');
});
