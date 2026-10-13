import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const register = require('../server/index.js');

const FENCE = '```';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function makeCtx(rootDir) {
  const sent = [];
  let chain = Promise.resolve();
  const { routes } = register({
    moduleId: 'meeting-archive', rootDir, dataDir: rootDir, log: () => {},
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
    readBody: async (req) => req.body,
    makeLock: () => (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; },
  });
  const call = (p, qs) => {
    routes.find((r) => r.method === 'GET' && r.path === p).handler({ url: '/api/m/meeting-archive' + p + (qs || '') }, {});
    return sent[sent.length - 1];
  };
  const post = async (p, body) => {
    await routes.find((r) => r.method === 'POST' && r.path === p).handler({ url: '/api/m/meeting-archive' + p, body }, {});
    return sent[sent.length - 1];
  };
  return { call, post };
}

function seed(sub) {
  const mdir = path.join(sub, 'ds-data', 'meeting-archive');
  const put = (folder, files) => {
    fs.mkdirSync(path.join(mdir, folder), { recursive: true });
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(mdir, folder, n), typeof c === 'string' ? c : JSON.stringify(c));
  };
  put('2026-06-10_10-00_pipeline', {
    'metadata.json': { status: 'ok', duration_sec: 90, has_transcript: true },
    'meeting-info.json': { title: 'Pipeline', brief: 'Description', participants: [{ name: 'Sam Rivera', member_id: 'tm-1' }] },
    'meeting-user-meta.json': { categories: ['c1'], virtual_folder_id: 'f1' },
    'summary.md': FENCE + 'json\n{"summary_md":"# Heading"}\n' + FENCE,
    'transcript.json': { segments: [{ speaker_id: 'Sam', start: 0, end: 1, text: 'hello' }] },
    'report.html': '<p>report</p>',
    'audio.mp3': 'JUNK',
  });
  put('manual-2026-06-11_22-33-12', {
    'metadata.json': { is_manual: true, status: 'ok', custom_title: 'Manual', meeting_date: '2026-06-11' },
    'meeting-info.json': { title: '', brief: '', participants: [] },
    'summary.md': '# Manual notes',
    'summary.html': '<p>x</p>',
  });
  put('2026-05-01_09-00_broken', {
    'metadata.json': { status: 'error', errorReason: 'no audio' },
    'meeting-info.json': { title: 'Broken' },
  });
  fs.writeFileSync(path.join(mdir, '_categories.json'), JSON.stringify({ categories: [{ id: 'c1', name: 'Workspace' }] }));
  fs.writeFileSync(path.join(mdir, '_folder-tree.json'), JSON.stringify({ folders: [{ id: 'f1', name: 'Workspace', parent_id: null, order: 1 }] }));
  return mdir;
}

test('/list without a clone answers storage unavailable', () => {
  const prev = process.env.DATA_SUB_REPOS_DIR;
  process.env.DATA_SUB_REPOS_DIR = tmp('ma-empty-');
  try {
    const r = makeCtx(tmp('ma-root-')).call('/list');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.storage, 'unavailable');
    assert.deepStrictEqual(r.body.meetings, []);
  } finally {
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
  }
});

test('/list scans the seeded tree and never opens the audio file', () => {
  const prev = process.env.DATA_SUB_REPOS_DIR;
  const sub = tmp('ma-sub-');
  process.env.DATA_SUB_REPOS_DIR = sub;
  const opened = [];
  const origOpen = fs.openSync;
  const origRead = fs.readFileSync;
  fs.openSync = (p, ...a) => { opened.push(String(p)); return origOpen(p, ...a); };
  fs.readFileSync = (p, ...a) => { opened.push(String(p)); return origRead(p, ...a); };
  try {
    seed(sub);
    opened.length = 0;
    const r = makeCtx(tmp('ma-root-')).call('/list');
    assert.strictEqual(r.body.storage, 'ok');
    assert.strictEqual(r.body.meetings.length, 3);
    assert.deepStrictEqual(r.body.meetings.map((m) => m.title).sort(), ['Pipeline', 'Manual', 'Broken'].sort());
    assert.strictEqual(r.body.meetings[0].date, '2026-06-11');
    assert.strictEqual(r.body.categories.length, 1);
    assert.strictEqual(r.body.folders[0].parentId, null);
    assert.ok(!opened.some((p) => p.endsWith('.mp3')), 'audio opened');
    assert.strictEqual(r.body.meetings.find((m) => m.title === 'Broken').status, 'error');
  } finally {
    fs.openSync = origOpen;
    fs.readFileSync = origRead;
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
  }
});

test('/meeting refuses bad folders and answers 404 for unknown ones', () => {
  const prev = process.env.DATA_SUB_REPOS_DIR;
  const sub = tmp('ma-sub-');
  process.env.DATA_SUB_REPOS_DIR = sub;
  try {
    seed(sub);
    const c = makeCtx(tmp('ma-root-'));
    assert.strictEqual(c.call('/meeting', '?folder=../x').status, 400);
    assert.strictEqual(c.call('/meeting', '?folder=_categories.json').status, 400);
    assert.strictEqual(c.call('/meeting', '?folder=missing').status, 404);
    const ok = c.call('/meeting', '?folder=2026-06-10_10-00_pipeline');
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.summaryMd, '# Heading');
    assert.strictEqual(ok.body.transcript.length, 1);
    assert.deepStrictEqual(ok.body.categories, [{ id: 'c1', name: 'Workspace' }]);
  } finally {
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
  }
});

test('/meeting on the manual folder and /html kinds', () => {
  const prev = process.env.DATA_SUB_REPOS_DIR;
  const sub = tmp('ma-sub-');
  process.env.DATA_SUB_REPOS_DIR = sub;
  try {
    seed(sub);
    const c = makeCtx(tmp('ma-root-'));
    const m = c.call('/meeting', '?folder=manual-2026-06-11_22-33-12');
    assert.strictEqual(m.body.summaryMd, '# Manual notes');
    assert.strictEqual(m.body.transcript, null);
    assert.deepStrictEqual(m.body.htmlKinds, ['summary']);
    assert.strictEqual(m.body.isManual, true);
    assert.strictEqual(c.call('/html', '?folder=manual-2026-06-11_22-33-12&kind=report').status, 404);
    assert.strictEqual(c.call('/html', '?folder=manual-2026-06-11_22-33-12&kind=evil').status, 400);
    const h = c.call('/html', '?folder=manual-2026-06-11_22-33-12&kind=summary');
    assert.strictEqual(h.status, 200);
    assert.strictEqual(h.body.html, '<p>x</p>');
  } finally {
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
  }
});

// -- writes (0.2.0). The push runs against the live port, which team-push
// refuses under `node --test` (push.error 'test-mode') - the write itself is
// what these tests pin.

function withSub(fn) {
  return async () => {
    const prev = process.env.DATA_SUB_REPOS_DIR;
    const sub = tmp('ma-sub-');
    process.env.DATA_SUB_REPOS_DIR = sub;
    try { await fn(sub); } finally {
      if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
    }
  };
}

const TRANSCRIPT = '2026-10-08-012000-refinement-atlas.json';
function seedTranscript(root) {
  const dir = path.join(root, 'user-data', 'transcripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, TRANSCRIPT), JSON.stringify({
    schemaVersion: 1, source_file: 'Refinement.mp4', recorded_at: '2026-10-01T07:30:00Z', processed_at: '2026-10-08T01:20:00Z',
    duration_sec: 60, title: 'Refinement Atlas', brief: 'b', participants: [{ name: 'Sam Rivera', speaker_id: 'Sam Rivera' }],
    segments: [{ speaker_id: 'Sam Rivera', start: 0, end: 1, text: 'hello' }], transcript_txt: 'x',
    summary: { summary_md: '# S' },
  }));
  fs.writeFileSync(path.join(dir, TRANSCRIPT.replace(/\.json$/, '.html')), '<p>r</p>');
}

test('POST /publish writes the folder once, a republish keeps the user meta', withSub(async (sub) => {
  const mdir = seed(sub);
  const root = tmp('ma-root-');
  seedTranscript(root);
  const c = makeCtx(root);
  assert.strictEqual((await c.post('/publish', { name: '../x.json' })).status, 400);
  const r = await c.post('/publish', { name: TRANSCRIPT });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.folder, '2026-10-01_09-30_refinement-atlas');
  assert.strictEqual(r.body.republished, false);
  assert.strictEqual(r.body.push.ok, false);
  const dir = path.join(mdir, r.body.folder);
  for (const f of ['metadata.json', 'meeting-info.json', 'meeting-user-meta.json', 'summary.md', 'transcript.json', 'transcript.txt', 'report.html']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  const um = path.join(dir, 'meeting-user-meta.json');
  fs.writeFileSync(um, JSON.stringify({ categories: ['c1'], virtual_folder_id: 'f1', meeting_date: '2026-10-01' }));
  const again = await c.post('/publish', { name: TRANSCRIPT });
  assert.strictEqual(again.body.folder, r.body.folder);
  assert.strictEqual(again.body.republished, true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(um, 'utf8')).categories, ['c1']);
  const src = c.call('/sources');
  assert.strictEqual(src.body.sources[TRANSCRIPT].folder, r.body.folder);
  assert.ok(src.body.sourceFiles.includes('Refinement.mp4'));
}));

test('writes refuse while the archive is absent (not cloned or wiped at day end)', withSub(async () => {
  const root = tmp('ma-root-');
  seedTranscript(root);
  const r = await makeCtx(root).post('/publish', { name: TRANSCRIPT });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'storage-unavailable');
}));

test('POST /meta validates ids, POST /delete removes the folder', withSub(async (sub) => {
  const mdir = seed(sub);
  const c = makeCtx(tmp('ma-root-'));
  const folder = '2026-06-10_10-00_pipeline';
  assert.strictEqual((await c.post('/meta', { folder, categoryIds: ['cat-x-0000'] })).status, 400);
  const ok = await c.post('/meta', { folder, title: 'New', date: '2026-06-09', categoryIds: [], folderId: null });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  const meta = JSON.parse(fs.readFileSync(path.join(mdir, folder, 'meeting-user-meta.json'), 'utf8'));
  assert.strictEqual(meta.custom_title, 'New');
  assert.strictEqual(meta.virtual_folder_id, null);
  assert.strictEqual((await c.post('/delete', { folder: '../../etc' })).status, 400);
  assert.strictEqual((await c.post('/delete', { folder })).status, 200);
  assert.ok(!fs.existsSync(path.join(mdir, folder)));
}));

test('POST /folders: add, then delete moves its meetings one level up', withSub(async (sub) => {
  const mdir = seed(sub);
  const c = makeCtx(tmp('ma-root-'));
  const add = await c.post('/folders', { action: 'add', name: 'Subfolder', parentId: 'f1' });
  assert.strictEqual(add.status, 200, JSON.stringify(add.body));
  const um = path.join(mdir, '2026-06-10_10-00_pipeline', 'meeting-user-meta.json');
  fs.writeFileSync(um, JSON.stringify({ categories: [], virtual_folder_id: add.body.id }));
  assert.strictEqual((await c.post('/folders', { action: 'move', id: 'f1', parentId: add.body.id })).body.error, 'bad-parent');
  assert.strictEqual((await c.post('/folders', { action: 'delete', id: add.body.id })).status, 200);
  assert.strictEqual(JSON.parse(fs.readFileSync(um, 'utf8')).virtual_folder_id, 'f1');
  const cat = await c.post('/categories', { action: 'add', name: 'Workspace' });
  assert.strictEqual(cat.body.error, 'duplicate');
}));

test('writes refuse a non-object body and never overwrite an unreadable shared list', withSub(async (sub) => {
  const mdir = seed(sub);
  const c = makeCtx(tmp('ma-root-'));
  const nul = await c.post('/categories', null);
  assert.strictEqual(nul.status, 400);
  assert.strictEqual(nul.body.error, 'bad-body');
  const file = path.join(mdir, '_categories.json');
  fs.writeFileSync(file, '{"categories": [ <<<<<<< broken');
  const r = await c.post('/categories', { action: 'add', name: 'Fresh' });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'shared-file-unreadable');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"categories": [ <<<<<<< broken');
  assert.deepStrictEqual(fs.readdirSync(mdir).filter((n) => n.includes('.tmp.')), []);
}));
