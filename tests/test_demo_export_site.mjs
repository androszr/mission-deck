// tests/test_demo_export_site.mjs
// scripts/demo-export.js --site: the demo as a static website.
//  1. file set: index.html + alias, no prototype files, extras (404, robots, OG)
//  2. determinism: two runs, byte-identical trees
//  3. refusals: --site with --out (exit 2), a foreign non-empty dir
//  4. the leftover-URL check still refuses a planted absolute path
//  5. the GitHub link exists in the site and stays hidden in the app's demo
// Run: node --test tests/test_demo_export_site.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const X = require('../scripts/demo-export.js');
const SCRIPT = path.join(ROOT, 'scripts/demo-export.js');

let tmp;
let siteA;
let siteB;

function tree(dir) {
  const map = new Map();
  for (const f of fs.readdirSync(dir).sort()) {
    map.set(f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'));
  }
  return map;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-site-'));
  siteA = path.join(tmp, 'a');
  siteB = path.join(tmp, 'b');
  await X.runSite({ site: siteA });
  await X.runSite({ site: siteB });
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

describe('demo-export --site', () => {
  it('writes the demo page, the alias and no prototype files', () => {
    const names = new Set(fs.readdirSync(siteA));
    for (const f of ['index.html', 'demo__index.html', 'host__index.html', 'demo__main.js', '404.html', 'robots.txt', 'demo-og.png', 'demo__manifest.json']) {
      assert.ok(names.has(f), 'missing ' + f);
    }
    for (const f of ['index.tsx', 'styles.css', 'spec.json']) assert.ok(!names.has(f), 'unexpected ' + f);
    for (const e of fs.readdirSync(siteA, { withFileTypes: true })) assert.ok(e.isFile(), 'subdirectory: ' + e.name);
    assert.deepEqual(fs.readFileSync(path.join(siteA, 'index.html')), fs.readFileSync(path.join(siteA, 'demo__index.html')));
  });

  it('writes the 404 redirect, robots.txt and the Open Graph tags', () => {
    const nf = fs.readFileSync(path.join(siteA, '404.html'), 'utf8');
    assert.equal(X.SITE_INDEX_PATH, '/mission-deck/index.html');
    assert.ok(nf.includes('location.replace("/mission-deck/index.html" + location.hash)'));
    assert.ok(nf.includes('url=/mission-deck/index.html'));
    // A nested missing URL must land on the site index, not under its own directory.
    const target = new URL(/location\.replace\("([^"]+)"/.exec(nf)[1], 'https://androszr.github.io/mission-deck/guides/0');
    assert.equal(target.pathname, '/mission-deck/index.html');
    assert.equal(fs.readFileSync(path.join(siteA, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\n');
    const html = fs.readFileSync(path.join(siteA, 'index.html'), 'utf8');
    for (const key of ['og:title', 'og:description', 'og:image', 'twitter:card', 'twitter:image']) {
      assert.ok(html.includes('"' + key + '"'), 'missing ' + key);
    }
    assert.match(html, /property="og:image" content="[^"]*\/demo-og\.png"/);
    const png = fs.readFileSync(path.join(siteA, 'demo-og.png'));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  });

  it('is deterministic: two runs, byte-identical trees', () => {
    assert.deepEqual(tree(siteA), tree(siteB));
  });

  it('rewrites a re-run in place and refuses a foreign non-empty directory', async () => {
    const again = await X.runSite({ site: siteA });
    assert.deepEqual(again.written, []);
    const foreign = path.join(tmp, 'foreign');
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'keep.txt'), 'mine');
    const r = spawnSync(process.execPath, [SCRIPT, '--site', foreign], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.ok(fs.existsSync(path.join(foreign, 'keep.txt')));
  });

  it('refuses --site together with --out (exit 2)', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--site', path.join(tmp, 'c'), '--out', path.join(tmp, 'proto-x')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot be combined/);
  });

  it('refuses a site extra whose name an exported file already uses', () => {
    const files = new Map([['index.html', Buffer.from('x')]]);
    assert.throws(() => X.addSiteFile(files, 'index.html', Buffer.from('y')), /Name collision/);
    X.addSiteFile(files, '404.html', Buffer.from('z'));
    assert.ok(files.has('404.html'));
  });

  it('lets Enter and Space through on links (the GitHub link stays operable)', () => {
    const main = fs.readFileSync(path.join(ROOT, 'demo/main.mjs'), 'utf8');
    assert.match(main, /closest\('\[data-demo-track\], \[data-demo-mode\], a\[href\]'\)\) return;/);
  });

  it('shrinks the GitHub link on narrow windows so the bar keeps fitting', () => {
    const css = fs.readFileSync(path.join(ROOT, 'demo/demo.css'), 'utf8');
    assert.match(css, /@media \(max-width: 1439px\)\s*\{[^}]*\.demo-bar-github-full\s*\{\s*display:\s*none/);
    assert.match(css, /\.demo-bar-github-short\s*\{\s*display:\s*none/);
    const html = fs.readFileSync(path.join(ROOT, 'demo/index.html'), 'utf8');
    assert.match(html, /id="demo-github-link"[^>]*aria-label="Get Mission Deck on GitHub"/);
  });

  it('works through the CLI and does not need a proto-* name or spec.json', () => {
    const dir = path.join(tmp, 'cli-site');
    const r = spawnSync(process.execPath, [SCRIPT, '--site', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'index.html')));
    assert.ok(!/Pliki/.test(r.stdout), 'the log line is English');
    assert.match(r.stdout, /Files by kind:/);
  });

  it('still fails the leftover check on a planted absolute path', () => {
    const html = fs.readFileSync(path.join(siteA, 'index.html'), 'utf8');
    assert.equal(X.leftovers(html, 'demo__index.html'), null);
    const planted = html.replace('</head>', '<link rel="stylesheet" href="/css/ds.css"></head>');
    assert.notEqual(X.leftovers(planted, 'demo__index.html'), null);
    const js = fs.readFileSync(path.join(siteA, 'demo__main.js'), 'utf8') + "\nfetch('/api/x');\n";
    assert.equal(X.leftovers(js, 'demo__main.js'), '/api/');
  });

  it('sets data-demo-site and shows a GitHub link only in the site', () => {
    const site = fs.readFileSync(path.join(siteA, 'index.html'), 'utf8');
    assert.match(site, /<html[^>]*\sdata-demo-site="1"/);
    assert.ok(site.includes('id="demo-github-link"'));
    assert.ok(site.includes(X.SITE_REPO_URL));
    assert.equal(X.SITE_REPO_URL, 'https://github.com/androszr/mission-deck');

    const app = fs.readFileSync(path.join(ROOT, 'demo/index.html'), 'utf8');
    assert.ok(!/data-demo-site/.test(app.replace(/<!--[\s\S]*?-->/g, '')), 'the in-app demo never sets data-demo-site');
    const css = fs.readFileSync(path.join(ROOT, 'demo/demo.css'), 'utf8');
    assert.match(css, /html:not\(\[data-demo-site\]\)\s+\.demo-bar-github\s*\{\s*display:\s*none/);
    const siteCss = fs.readFileSync(path.join(siteA, 'demo__demo.css'), 'utf8');
    assert.match(siteCss, /html:not\(\[data-demo-site\]\)\s+\.demo-bar-github/);
  });
});
