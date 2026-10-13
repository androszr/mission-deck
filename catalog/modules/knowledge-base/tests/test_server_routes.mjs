import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const register = require('../server/index.js');

function setup(t, seedTree) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-routes-'));
  process.env.DATA_SUB_REPOS_DIR = base;
  t.after(() => { delete process.env.DATA_SUB_REPOS_DIR; });
  const hub = path.join(base, 'ds-data', 'knowledge-base');
  if (seedTree) {
    const put = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(hub, rel)), { recursive: true });
      fs.writeFileSync(path.join(hub, rel), text);
    };
    put('knowledge-base-areas.json', '{"areas":[{"slug":"atlas","label":"Atlas","subareas":[]}]}');
    put('atlas/research/a.md', '---\ntitle: "A"\ndate: 2026-01-02\n---\nBody A');
    put('atlas/research/a.html', '<p>report</p>');
    put('meetings/x/summary.md', 'secret');
  }
  const sent = [];
  const ctx = {
    moduleId: 'knowledge-base', rootDir: base, dataDir: base, log: () => {},
    jsonResponse: (_res, status, body) => sent.push({ status, body }),
  };
  const { routes } = register(ctx);
  const call = (p, query) => {
    const route = routes.find((r) => r.path === p);
    const raw = { status: 0, headers: null, body: null };
    const res = {
      writeHead: (s, h) => { raw.status = s; raw.headers = h; },
      end: (b) => { raw.body = b; },
    };
    route.handler({ url: '/api/m/knowledge-base' + p + (query || '') }, res);
    return raw;
  };
  const snapshot = () => {
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f); else out.push(f + ':' + fs.statSync(f).mtimeMs);
      }
    };
    if (fs.existsSync(hub)) walk(hub);
    return out.sort().join('|');
  };
  return { sent, call, snapshot, last: () => sent[sent.length - 1] };
}

test('/list without a clone answers 200 unavailable', (t) => {
  const s = setup(t, false);
  s.call('/list');
  assert.strictEqual(s.last().status, 200);
  assert.strictEqual(s.last().body.storage, 'unavailable');
});

test('/list on a seeded tree has no meetings and stays read-only', (t) => {
  const s = setup(t, true);
  const before = s.snapshot();
  s.call('/list');
  const b = s.last().body;
  assert.strictEqual(b.storage, 'ok');
  assert.deepStrictEqual(b.articles.map((a) => a.path), ['atlas/research/a.md']);
  assert.ok(b.skipped);
  assert.strictEqual(s.snapshot(), before);
});

test('/article: 400, 404, 200 without frontmatter', (t) => {
  const s = setup(t, true);
  s.call('/article', '?path=' + encodeURIComponent('../x.md'));
  assert.strictEqual(s.last().status, 400);
  s.call('/article', '?path=' + encodeURIComponent('atlas/research/zzz.md'));
  assert.strictEqual(s.last().status, 404);
  s.call('/article', '?path=' + encodeURIComponent('atlas/research/a.html'));
  assert.strictEqual(s.last().status, 400);
  s.call('/article', '?path=' + encodeURIComponent('atlas/research/a.md'));
  assert.strictEqual(s.last().status, 200);
  assert.strictEqual(s.last().body.body, 'Body A');
  assert.strictEqual(s.last().body.hasHtml, true);
});

test('/file: html content type, attachment only with download=1, meetings refused', (t) => {
  const s = setup(t, true);
  const before = s.snapshot();
  const p = encodeURIComponent('atlas/research/a.html');
  const a = s.call('/file', '?path=' + p);
  assert.strictEqual(a.status, 200);
  assert.match(a.headers['Content-Type'], /^text\/html/);
  assert.strictEqual(a.headers['Content-Disposition'], undefined);
  const b = s.call('/file', '?path=' + p + '&download=1');
  assert.match(b.headers['Content-Disposition'], /attachment; filename="a.html"/);
  s.call('/file', '?path=' + encodeURIComponent('meetings/x/summary.md'));
  assert.strictEqual(s.last().status, 400);
  assert.strictEqual(s.snapshot(), before);
});
