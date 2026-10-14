// tests/test_demo_site_smoke.mjs
// Static smoke test for the built demo site: a tiny http server serves the
// --site output; every file the page references answers 200 and nothing in
// the site fetches /api/. Also checks the Pages workflow and the README links.
// Run: node --test tests/test_demo_site_smoke.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const X = require('../scripts/demo-export.js');
const { CHAPTER_ORDER } = await import('../demo/scenario-schema.mjs');

let tmp;
let site;
let server;
let base;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-smoke-'));
  site = path.join(tmp, 'site');
  await X.runSite({ site });
  server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split(/[?#]/)[0]).replace(/^\/+/, '') || 'index.html';
    const abs = path.join(site, name);
    if (name.includes('/') || !fs.existsSync(abs)) { res.statusCode = 404; res.end('no'); return; }
    res.statusCode = 200;
    res.end(fs.readFileSync(abs));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

const get = async (name) => fetch(base + name);

describe('demo site served statically', () => {
  it('answers 200 for the page, the 404 page, robots.txt and the OG image', async () => {
    for (const f of ['index.html', '404.html', 'robots.txt', 'demo-og.png']) {
      const r = await get(f);
      assert.equal(r.status, 200, f);
      await r.arrayBuffer();
    }
  });

  it('answers 200 for every file the page and its modules reference', async () => {
    const page = await (await get('index.html')).text();
    const refs = new Set();
    for (const m of page.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\s(?:src|href)="(\.\/[^"?#]+)/g)) refs.add(m[1].slice(2));
    const og = /property="og:image" content="[^"]*\/([^/"]+)"/.exec(page);
    assert.ok(og, 'og:image');
    refs.add(og[1]);
    const shell = '' + await (await get('host__index.html')).text();
    for (const m of shell.matchAll(/\s(?:src|href)="(\.\/[^"?#]+)/g)) refs.add(m[1].slice(2));
    assert.ok(refs.size > 10);
    for (const f of refs) {
      const r = await get(f);
      assert.equal(r.status, 200, f);
      await r.arrayBuffer();
    }
  });

  it('every chapter hash resolves against the one page (no per-chapter file needed)', async () => {
    assert.equal((await get('index.html')).status, 200);
    assert.ok(CHAPTER_ORDER.length >= 20);
  });

  it('no file in the site fetches /api/', () => {
    for (const f of fs.readdirSync(site)) {
      if (!/\.(?:js|html|css)$/.test(f)) continue;
      const text = fs.readFileSync(path.join(site, f), 'utf8');
      assert.ok(!/fetch\(\s*['"`]\/api\//.test(text), f);
      // 404.html holds the one deliberate root-absolute path (its redirect target).
      if (f !== '404.html') assert.equal(X.leftovers(text, f), null, f);
    }
  });
});

describe('Pages workflow', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/demo-pages.yml'), 'utf8');

  it('has the Pages shape (text checks, always run)', () => {
    assert.match(wf, /^on:\s*\n\s+push:\s*\n\s+branches: \[main\]/m);
    for (const p of ['demo/**', 'index.html', 'css/**', 'styles.css', 'assets/**', 'js/**', 'fonts/**', 'scripts/demo-export.js']) {
      assert.ok(wf.includes("- '" + p + "'"), p);
    }
    assert.match(wf, /^\s+workflow_dispatch:/m);
    assert.match(wf, /^permissions:[\s\S]*?\n\s+pages: write\n\s+id-token: write/m);
    assert.match(wf, /environment:\s*\n\s+name: github-pages/);
    assert.ok(!/\t/.test(wf), 'no tabs in YAML');
    let doc = null;
    try { doc = require('yaml').parse(wf); } catch { /* optional extra */ }
    if (doc) {
      assert.deepEqual(doc.on.push.branches, ['main']);
      assert.equal(doc.permissions.pages, 'write');
      assert.equal(doc.jobs.deploy.environment.name, 'github-pages');
    }
  });

  it('builds the site, checks it, deploys it, and references no secrets', () => {
    assert.match(wf, /node scripts\/demo-export\.js --site _site/);
    assert.match(wf, /actions\/configure-pages@/);
    assert.match(wf, /actions\/upload-pages-artifact@/);
    assert.match(wf, /actions\/deploy-pages@/);
    assert.match(wf, /\/api\//);
    assert.ok(!/secrets\./.test(wf));
  });
});

describe('README demo links', () => {
  it('links the demo and at least four chapters whose ids exist', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    assert.ok(readme.includes('https://androszr.github.io/mission-deck/)'));
    const ids = [...readme.matchAll(/https:\/\/androszr\.github\.io\/mission-deck\/#([a-z0-9-]+)\/0/g)].map((m) => m[1]);
    assert.ok(ids.includes('guides'));
    assert.ok(new Set(ids).size >= 4, 'guides plus three other chapters');
    for (const id of ids) assert.ok(CHAPTER_ORDER.includes(id), id);
  });
});
