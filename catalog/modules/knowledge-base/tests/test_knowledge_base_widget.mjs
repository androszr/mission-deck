// Dashboard widget contract + GET /widget route (fixture tree, no data, no heavy keys).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const register = require('../server/index.js');

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The app root: modules/<id>/ when installed, catalog/modules/<id>/ in the
// source tree. Walk up until server.js is found.
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'server.js')) && fs.existsSync(path.join(d, 'js'))) return d;
    d = path.dirname(d);
  }
  throw new Error('app root (server.js) not found above ' + start);
}
const ROOT = findRoot(DIR);
const { validateModuleManifest } = require(path.join(ROOT, 'server.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const { kit } = await import(pathToFileURL(path.join(ROOT, 'js/dashboard-widget-kit.js')).href);
const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));

function callWidget(base) {
  const prev = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = base;
  try {
    const out = {};
    const { routes } = register({ moduleId: 'knowledge-base', rootDir: base, dataDir: base, log: () => {}, jsonResponse: (_r, status, body) => { out.status = status; out.body = body; } });
    const r = routes.find((x) => x.method === 'GET' && x.path === '/widget');
    assert.ok(r, 'GET /widget registered');
    r.handler({ url: '/widget', method: 'GET' }, {});
    return out;
  } finally {
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
  }
}

function seed() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-widget-'));
  const hub = path.join(base, 'ds-data', 'knowledge-base');
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  for (let i = 1; i <= 7; i++) {
    const rel = path.join(hub, 'atlas', 'research', 'a' + i + '.md');
    fs.mkdirSync(path.dirname(rel), { recursive: true });
    fs.writeFileSync(rel, '---\ntitle: "Art ' + i + '"\ndate: ' + (i <= 2 ? ym + '-0' + i : '2020-01-0' + i) + '\ntype: ' + (i % 2 ? 'interview' : 'study') + '\nauthor: Alex Morgan\n---\nSECRET-BODY');
  }
  fs.writeFileSync(path.join(hub, 'knowledge-base-areas.json'), '{"areas":[{"slug":"atlas","label":"Atlas","subareas":[]}]}');
  return base;
}

test('widget manifest passes the host validator', () => {
  const r = validateModuleManifest(manifest, 'knowledge-base');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'knowledge-new');
  assert.ok(w.variants.some((v) => v.rows === 2) && w.variants.length <= 6);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
});

test('GET /widget: newest 5, total, no bodies or heavy keys', () => {
  const r = callWidget(seed());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.storage, 'ok');
  assert.strictEqual(r.body.total, 7);
  assert.strictEqual(r.body.articles.length, 5);
  assert.strictEqual(r.body.newThisMonth, 2);
  assert.strictEqual(r.body.months.length, 4);
  assert.deepStrictEqual(r.body.categories, [{ category: 'research', count: 7 }]);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes('SECRET'));
  for (const k of ['areas"', 'skipped', 'summary', 'confluence', 'size']) assert.ok(!text.includes(k), k);
  assert.deepStrictEqual(Object.keys(r.body.articles[0]).sort(), ['area', 'author', 'date', 'path', 'title', 'type']);
});

test('GET /widget: no data -> storage unavailable', () => {
  const r = callWidget(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-widget-empty-')));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.storage, 'unavailable');
  assert.deepStrictEqual(r.body.articles, []);
});

test('widget: blocks, variants and empty state', () => {
  const data = callWidget(seed()).body;
  const { blocks } = widget.buildBlocks(data);
  assert.strictEqual(blocks.big.value, '7');
  assert.strictEqual(blocks.big.unit, 'documents');
  assert.strictEqual(blocks.timeline.events.length, 5);
  assert.strictEqual(blocks.line.series[0].values.length, 4);
  assert.strictEqual(widget.documentsLabel(1), 'document');
  assert.strictEqual(widget.documentsLabel(22), 'documents');
  assert.strictEqual(widget.shortDate('2026-10-06'), '06.10');
  assert.strictEqual(widget.shortDate(''), '-');
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(data, id, sizes[id], kit).includes('dash-kit-'), id);
  assert.strictEqual((widget.paint(data, 's', sizes.s, kit).match(/class="dash-kit-big"/g) || []).length, 1);
  assert.ok(widget.paint(data, 'm2', sizes.m2, kit).includes('dash-kit-tl'));
  for (const d of [{ storage: 'unavailable' }, null]) assert.match(widget.buildBlocks(d).empty, /Sync window/);
  assert.match(widget.buildBlocks({ storage: 'ok', total: 0 }).empty, /is empty/);
});

test('widget: plural of new documents, type split by the module lib, avatars only for names', () => {
  assert.deepStrictEqual([0, 1, 3].map(widget.newLabel), ['0 new', '1 new', '3 new']);
  assert.deepStrictEqual(widget.typeSplit([
    { category: 'research', count: 47 }, { category: 'other', count: 39 }, { category: 'meetings', count: 10 },
    { category: 'workshop', count: 3 }, { category: 'interviews', count: 9 }, { category: 'ux-brief', count: 4 },
  ]), [{ label: 'Research', count: 47 }, { label: 'Meetings', count: 13 }, { label: 'Interviews', count: 9 }, { label: 'Other', count: 43 }]);
  const labels = widget.buildBlocks({ storage: 'ok', total: 5, categories: [{ category: 'other', count: 5 }] }).blocks.pie.segments.map((x) => x.label);
  assert.deepStrictEqual(labels, ['Other']);
  assert.strictEqual(widget.authorPerson('Alex Morgan'), 'Alex Morgan');
  assert.strictEqual(widget.authorPerson('Confluence import'), '');
  assert.strictEqual(widget.authorPerson('Sam (team Atlas)'), '');
  const tl = widget.buildBlocks({ storage: 'ok', total: 2, articles: [{ title: 'A', date: '2026-10-01', author: 'Confluence import' }, { title: 'B', date: '2026-09-01', author: 'Alex Morgan' }] }).blocks.timeline;
  assert.deepStrictEqual(tl.events.map((e) => e.person), [undefined, 'Alex Morgan']);
});

test('widget: a 404 shows the restart hint and never asks /list', async () => {
  const urls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => { urls.push(u); return { ok: false, status: 404 }; };
  try {
    const el = { innerHTML: '' };
    await widget.renderWidget(el, { apiBase: '/api/m/knowledge-base', kit, variant: { id: 'm', cols: 3, rows: 1 } });
    assert.deepStrictEqual(urls, ['/api/m/knowledge-base/widget']);
    assert.strictEqual(el.innerHTML, kit.empty('This tile needs a server restart: Settings > Restart server.'));
  } finally {
    globalThis.fetch = orig;
  }
});
