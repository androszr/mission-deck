// Dashboard widget "Top initiatives": manifest, read-only /widget route (closed shape,
// no files written), client blocks per variant, empty states, 404 -> restart hint.
import test from 'node:test';
import assert from 'node:assert';
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
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const { kit } = await import(pathToFileURL(path.join(findAppRoot(DIR), 'js', 'dashboard-widget-kit.js')).href);
const register = require(path.join(DIR, 'server', 'index.js'));

function makeCtx(rootDir) {
  const calls = [];
  return {
    calls,
    ctx: {
      moduleId: 'roadmap', dataDir: rootDir, rootDir, log: () => {},
      jsonResponse: (_res, status, body) => calls.push({ status, body }),
      readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(),
    },
  };
}

async function withDataDir(files, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crmw-'));
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

const task = (cat) => ({ key: 'DISC-1', statusCategory: cat, assignee: 'Secret Person', timeByPerson: { 'Secret Person': 60 } });
const init = (n, extra = {}) => JSON.stringify({
  id: 'i' + n, title: 'Initiative ' + n, ticket: 'PROD-' + n, po: 'Alex Morgan', rank: n,
  jiraTasks: [task('done'), task('indeterminate'), task('new')], comments: [{ text: 'top-secret' }], links: ['x'], description: 'a long description', ...extra,
});

function files() {
  const out = {};
  for (let n = 7; n >= 1; n--) out['dt-0000000' + n + '.json'] = init(n, n === 1 ? { goLiveDate: '2026-12-15' } : {});
  out['dt-broken.json'] = '{ nope';
  return out;
}

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'roadmap');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'top-initiatives');
  assert.ok(w.variants.length <= 6);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2));
});

test('widget route: top 5 by rank, closed shape, forbidden keys absent, nothing written', async () => {
  await withDataDir(files(), async (tmp) => {
    const dir = path.join(tmp, 'ds-data', 'discovery-tasks');
    const before = fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    const { ctx, calls } = makeCtx(tmp);
    const route = register(ctx).routes.find((r) => r.method === 'GET' && r.path === '/widget');
    assert.ok(route);
    await route.handler({}, {});
    await route.handler({}, {}); // memoised second call
    assert.strictEqual(calls[0].status, 200);
    const body = calls[0].body;
    assert.strictEqual(body.storage, 'ok');
    assert.strictEqual(body.count, 7);
    assert.deepStrictEqual(body.initiatives.map((i) => i.id), ['i1', 'i2', 'i3', 'i4', 'i5']);
    assert.deepStrictEqual(Object.keys(body.initiatives[0]).sort(),
      ['done', 'goLiveDate', 'id', 'inProgress', 'rank', 'po', 'ragStatus', 'title', 'ticket', 'total'].sort());
    assert.strictEqual(body.initiatives[0].done, 1);
    assert.strictEqual(body.initiatives[0].total, 3);
    assert.strictEqual(body.initiatives[0].goLiveDate, '2026-12-15');
    const json = JSON.stringify(body);
    for (const k of ['comments', 'links', 'description', 'jiraTasks', 'timeByPerson', 'assignee', 'Secret Person', 'top-secret']) assert.ok(!json.includes(k), k);
    assert.ok(!('skipped' in body));
    assert.deepStrictEqual(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]), before);
  });
});

test('widget route: no data -> 409 storage-unavailable; empty directory -> 200 with no initiatives', async () => {
  await withDataDir(null, async (tmp) => {
    const { ctx, calls } = makeCtx(tmp);
    await register(ctx).routes.find((r) => r.path === '/widget').handler({}, {});
    assert.strictEqual(calls[0].status, 409);
    assert.strictEqual(calls[0].body.error, 'storage-unavailable');
  });
  await withDataDir({ 'README.md': 'x' }, async (tmp) => {
    const { ctx, calls } = makeCtx(tmp);
    await register(ctx).routes.find((r) => r.path === '/widget').handler({}, {});
    assert.strictEqual(calls[0].status, 200);
    assert.deepStrictEqual(calls[0].body, { storage: 'ok', initiatives: [], count: 0 });
  });
});

const DATA = {
  storage: 'ok', count: 3,
  initiatives: [
    { id: 'a', title: 'Attributes', ticket: 'PROD-1', po: 'Alex M.', rank: 1, done: 4, inProgress: 1, total: 7, goLiveDate: '2026-12-15', ragStatus: null },
    { id: 'b', title: 'Filters', ticket: '', po: 'Sam R.', rank: 2, done: 0, inProgress: 0, total: 7, goLiveDate: '2026-11-20', ragStatus: null },
    { id: 'c', title: 'No tasks', ticket: '', po: '', rank: 3, done: 0, inProgress: 0, total: 0, goLiveDate: null, ragStatus: null },
  ],
};

test('widget: blocks and tones, dates from the payload', () => {
  const { blocks } = widget.buildBlocks(DATA);
  assert.deepStrictEqual(blocks.progress.rows.map((r) => r.tone), ['info', 'warn', 'neutral']);
  assert.strictEqual(blocks.progress.rows[0].display, '4/7');
  assert.strictEqual(blocks.progress.rows[2].display, 'no tasks');
  assert.deepStrictEqual(blocks.timeline.events.map((e) => e.date), ['20.11', '15.12']);
  assert.strictEqual(blocks.segments.segments[0].value, 4);
});

test('widget: every variant paints, 2x1-style single block never empty', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(DATA, id, sizes[id], kit).length > 50, id);
  assert.ok(widget.paint(DATA, 'xl', sizes.xl, kit).includes('Attributes'));
});

test('widget: empty states, and a 404 never falls back to /initiatives', async () => {
  assert.match(widget.buildBlocks({ error: 'storage-unavailable' }).empty, /Sync window/);
  assert.match(widget.buildBlocks({ storage: 'ok', initiatives: [], count: 0 }).empty, /No initiatives/);
  const urls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (u) => { urls.push(u); return { ok: false, status: 404 }; };
  try {
    const el = { innerHTML: '' };
    await widget.renderWidget(el, { apiBase: '/api/m/x', kit, variant: { id: 'l', cols: 6, rows: 1 } });
    assert.deepStrictEqual(urls, ['/api/m/x/widget']);
    assert.strictEqual(el.innerHTML, kit.empty('The tile needs a server restart: Settings > Restart server.'));
  } finally { globalThis.fetch = saved; }
});

test('widget route: placeholder rows (no Jira key) and steps outside taskScope are not counted', () => {
  const { countedTasks } = require(path.join(DIR, 'server', 'widget.js'));
  const t = (defId, key, cat) => ({ defId, key, statusCategory: cat });
  const initiative = {
    taskScope: ['a', 'b', 'c'],
    jiraTasks: [t('a', 'X-1', 'done'), t('b', 'X-2', 'new'), t('c', null, null), t('d', 'X-4', 'done'), t('e', '', null)],
  };
  assert.deepStrictEqual(countedTasks(initiative).map((x) => x.key), ['X-1', 'X-2']);
  assert.strictEqual(countedTasks({ taskScope: [], jiraTasks: [t('z', null, null), t('d', 'X-4', 'done')] }).length, 1);
  assert.strictEqual(countedTasks({}).length, 0);
});

test('widget: a Go-Live already past with open work reads as late', () => {
  const now = new Date(2026, 11, 1);
  const { blocks } = widget.buildBlocks(DATA, now);
  assert.deepStrictEqual(blocks.timeline.events.map((e) => e.tone), ['warn', 'info']);
  assert.match(blocks.timeline.events[0].label, /^Overdue: Filters/);
  assert.strictEqual(widget.goLiveTone({ done: 7, total: 7, goLiveDate: '2020-01-01' }, '2026-12-01'), 'ok');
});
