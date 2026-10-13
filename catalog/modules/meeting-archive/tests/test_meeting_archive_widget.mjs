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

function callWidget(sub, qs) {
  const prev = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = sub;
  try {
    const out = {};
    const { routes } = register({
      moduleId: 'meeting-archive', rootDir: sub, dataDir: sub, log: () => {},
      jsonResponse: (_r, status, body) => { out.status = status; out.body = body; },
      readBody: async () => ({}), makeLock: () => (fn) => fn(),
    });
    const r = routes.find((x) => x.method === 'GET' && x.path === '/widget');
    assert.ok(r, 'GET /widget registered');
    r.handler({ url: '/api/m/meeting-archive/widget' + (qs || ''), method: 'GET' }, {});
    return out;
  } finally {
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
  }
}

function seed(n) {
  const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-widget-'));
  const mdir = path.join(sub, 'ds-data', 'meeting-archive');
  for (let i = 1; i <= n; i++) {
    const day = String(i).padStart(2, '0');
    const f = path.join(mdir, '2026-03-' + day + '_10-00_meeting' + i);
    fs.mkdirSync(f, { recursive: true });
    fs.writeFileSync(path.join(f, 'metadata.json'), JSON.stringify({ status: i === 2 ? 'error' : 'ok' }));
    fs.writeFileSync(path.join(f, 'meeting-info.json'), JSON.stringify({
      title: 'Meeting ' + i, brief: 'SECRET-BRIEF',
      participants: [{ name: 'Sam Rivera ' + i, member_id: 'tm-' + i }, { name: 'Taylor Kim', member_id: 'tm-e' }],
    }));
    fs.writeFileSync(path.join(f, 'transcript.json'), '{"segments":[{"text":"SECRET-TRANSCRIPT"}]}');
  }
  fs.writeFileSync(path.join(mdir, '_categories.json'), '{"categories":[{"id":"c1","name":"SECRET-CATEGORY"}]}');
  return sub;
}

test('widget manifest passes the host validator', () => {
  const r = validateModuleManifest(manifest, 'meeting-archive');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'recent-meetings');
  assert.ok(w.variants.some((v) => v.rows === 2) && w.variants.length <= 6);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
});

test('GET /widget: newest first, limit clamped, participants of the newest only, no heavy keys', () => {
  const sub = seed(12);
  const r = callWidget(sub);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.storage, 'ok');
  assert.strictEqual(r.body.total, 12);
  assert.strictEqual(r.body.meetings.length, 5);
  assert.strictEqual(r.body.meetings[0].title, 'Meeting 12');
  assert.deepStrictEqual(Object.keys(r.body.meetings[0]).sort(), ['date', 'folder', 'participantCount', 'status', 'title']);
  assert.strictEqual(r.body.meetings[0].participantCount, 2);
  assert.deepStrictEqual(r.body.participants, [{ name: 'Sam Rivera 12' }, { name: 'Taylor Kim' }]);
  assert.strictEqual(r.body.statusCounts.error, 1);
  assert.strictEqual(r.body.month.days.length >= 28, true);
  const text = JSON.stringify(r.body);
  for (const leak of ['SECRET', 'brief', 'categories', 'folders', 'transcript', 'htmlKinds']) assert.ok(!text.includes(leak), leak);
  assert.strictEqual(callWidget(sub, '?limit=99').body.meetings.length, 10);
  assert.strictEqual(callWidget(sub, '?limit=0').body.meetings.length, 5);
  assert.strictEqual(callWidget(sub, '?limit=2').body.meetings.length, 2);
  assert.strictEqual(callWidget(sub, '?limit=abc').body.meetings.length, 5);
});

test('GET /widget: two meetings on the newest day -> the later folder is the newest', () => {
  const sub = seed(3);
  const f = path.join(sub, 'ds-data', 'meeting-archive', '2026-03-03_15-30_afternoon');
  fs.mkdirSync(f, { recursive: true });
  fs.writeFileSync(path.join(f, 'metadata.json'), JSON.stringify({ status: 'ok' }));
  fs.writeFileSync(path.join(f, 'meeting-info.json'), JSON.stringify({ title: 'Afternoon', participants: [{ name: 'Jordan Lee' }] }));
  const r = callWidget(sub);
  assert.strictEqual(r.body.meetings[0].title, 'Afternoon');
  assert.strictEqual(r.body.participantsFolder, '2026-03-03_15-30_afternoon');
  assert.deepStrictEqual(r.body.participants, [{ name: 'Jordan Lee' }]);
});

test('GET /widget: no archive -> storage unavailable', () => {
  const r = callWidget(fs.mkdtempSync(path.join(os.tmpdir(), 'ma-widget-empty-')));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.storage, 'unavailable');
  assert.deepStrictEqual(r.body.meetings, []);
  assert.deepStrictEqual(r.body.participants, []);
});

test('widget: blocks, variants and empty state', () => {
  const data = callWidget(seed(6)).body;
  const { blocks } = widget.buildBlocks(data);
  assert.strictEqual(blocks.timeline.events.length, 5);
  assert.strictEqual(blocks.timeline.events[0].date, '06.03');
  assert.ok(blocks.timeline.events.some((e) => e.tone === 'error'));
  assert.strictEqual(blocks.avatars.people.length, 2);
  assert.strictEqual(blocks.segments.segments[1].value, 1);
  assert.match(blocks.big.label, /in the archive/);
  assert.strictEqual(widget.meetingsLabel(1), 'meeting');
  assert.strictEqual(widget.meetingsLabel(3), 'meetings');
  assert.strictEqual(widget.meetingsLabel(12), 'meetings');
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(data, id, sizes[id], kit).includes('dash-kit-'), id);
  assert.ok(widget.paint(data, 'm', sizes.m, kit).includes('data-person'));
  assert.ok(widget.paint(data, 'm2', sizes.m2, kit).includes('dash-kit-cal'));
  assert.ok(!widget.paint(data, 's', sizes.s, kit).includes('dash-kit-tl'));
  assert.match(widget.buildBlocks({ storage: 'ok', total: 0, meetings: [] }).empty, /No meetings in the archive/);
  for (const d of [{ storage: 'unavailable', meetings: [] }, null]) {
    assert.match(widget.buildBlocks(d).empty, /Sync window/);
  }
});

test('widget: a 404 shows the restart hint and never asks /list', async () => {
  const urls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => { urls.push(u); return { ok: false, status: 404 }; };
  try {
    const el = { innerHTML: '' };
    await widget.renderWidget(el, { apiBase: '/api/m/meeting-archive', kit, variant: { id: 'm2', cols: 3, rows: 2 } });
    assert.deepStrictEqual(urls, ['/api/m/meeting-archive/widget?limit=5']);
    assert.strictEqual(el.innerHTML, kit.empty('This tile needs a server restart: Settings > Restart server.'));
  } finally {
    globalThis.fetch = orig;
  }
});
