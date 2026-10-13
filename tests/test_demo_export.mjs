// tests/test_demo_export.mjs
// scripts/demo-export.js: the demo/ presentation exported as a prototype
// directory. Runs the real exporter against the real demo/ into a tmp dir
// (no network, no server, nothing under data-sub-repositories/).
//  1. contract files, merged spec.json, flat assets/
//  2. determinism: identical bytes on re-run, an owned file is restored
//  3. no leftover absolute URL in code, every relative reference resolves
//  4. token harvest: icons, Pip, illustrations, fonts
//  5. the prototype gates (import allowlist, check-proto-ds) pass
//  6. refusals: missing spec.json (exit 2), name collision and bare import (exit 1)
// Run: node --test tests/test_demo_export.mjs

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
const { disallowedProtoImports } = require('../scripts/_proto-imports.js');
const { CHAPTER_ORDER } = await import('../demo/scenario-schema.mjs');
const { run: checkProtoDs } = require('../scripts/check-proto-ds.js');

const RELEASES = [{ date: '2026-10-01', items: ['Utworzono z szablonu startera'] }];
const TODAY = '2026-10-04';

let tmp;
let out;
let first;

function snapshot(dir) {
  const map = new Map();
  for (const rel of ['index.tsx', 'styles.css', 'spec.json']) map.set(rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, rel))).digest('hex'));
  for (const f of fs.readdirSync(path.join(dir, 'assets'))) {
    map.set('assets/' + f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'assets', f))).digest('hex'));
  }
  return map;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-export-'));
  out = path.join(tmp, 'proto-demo-test');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'spec.json'), JSON.stringify({
    updated: '2026-10-01', summary: 'starter', scope: [], releases: RELEASES, customElements: [{ name: 'x' }], frame: 'app-shell',
  }, null, 2));
  first = await X.runExport({ out, today: TODAY });
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

describe('demo-export', () => {
  it('writes the contract files, a merged spec and a flat assets/', () => {
    for (const rel of ['index.tsx', 'styles.css', 'spec.json', 'assets/demo__index.html', 'assets/host__index.html',
      'assets/demo__main.js', 'assets/host__js__ds-modal.js', 'assets/host__js__utils.js', 'assets/host__js__theme-boot.js',
      'assets/host__styles.css', 'assets/host__css__ds.css', 'assets/demo__manifest.json']) {
      assert.ok(fs.existsSync(path.join(out, rel)), 'brak ' + rel);
    }
    const spec = JSON.parse(fs.readFileSync(path.join(out, 'spec.json'), 'utf8'));
    assert.ok(!('frame' in spec));
    assert.deepEqual(spec.customElements, []);
    assert.deepEqual(spec.releases, RELEASES);
    assert.equal(spec.scope.length, CHAPTER_ORDER.length, 'scope: one entry per chapter');
    assert.equal(spec.updated, TODAY);
    assert.equal(spec.demoExport.sourceSha256, first.sourceSha256);
    assert.match(fs.readFileSync(path.join(out, 'index.tsx'), 'utf8'), /\/proto-assets\/demo-test\/demo__index\.html/);
    for (const e of fs.readdirSync(path.join(out, 'assets'), { withFileTypes: true })) {
      assert.ok(e.isFile(), 'podkatalog w assets/: ' + e.name);
    }
    for (const f of first.files) assert.ok(!f.replace(/^assets\//, '').includes('/'), f);
  });

  it('is deterministic and restores an owned file', async () => {
    const before1 = snapshot(out);
    const second = await X.runExport({ out, today: '2027-01-01' });
    assert.deepEqual(second.deleted, []);
    assert.deepEqual(second.written, []);
    assert.equal(second.sourceSha256, first.sourceSha256);
    assert.deepEqual(snapshot(out), before1);
    fs.unlinkSync(path.join(out, 'assets', 'demo__main.js'));
    const third = await X.runExport({ out, today: '2027-01-01' });
    assert.deepEqual(third.written, ['assets/demo__main.js']);
    assert.deepEqual(snapshot(out), before1);
  });

  it('leaves no absolute URL in code and every relative reference resolves', () => {
    const assets = path.join(out, 'assets');
    const names = new Set(fs.readdirSync(assets));
    for (const f of [...names].filter((n) => /\.(?:js|css|html)$/.test(n))) {
      const text = fs.readFileSync(path.join(assets, f), 'utf8');
      assert.equal(X.leftovers(text, f), null, f);
      const refs = [];
      if (f.endsWith('.js')) refs.push(...X.jsImportRefs(text).map((r) => r.ref));
      if (f.endsWith('.css')) for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(\s*['"]?([^'")\s]+)/g)) refs.push(m[1]);
      if (f.endsWith('.html')) for (const m of text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\s(?:src|href)="([^"]*)"/g)) refs.push(m[1]);
      for (const ref of refs) {
        if (/^(?:#|data:|https?:|mailto:)/.test(ref)) continue;
        const bare = ref.replace(/[?#].*$/, '');
        assert.match(bare, /^\.\/[^/]+$/, f + ': ' + ref);
        const target = bare.slice(2);
        assert.ok(names.has(target), f + ' -> ' + ref);
      }
    }
    const shell = fs.readFileSync(path.join(assets, 'host__index.html'), 'utf8');
    assert.ok(!shell.includes('<script'));
    assert.match(fs.readFileSync(path.join(assets, 'demo__index.html'), 'utf8'), /<html[^>]*\sdata-demo-shell="\.\/host__index\.html"/);
  });

  it('harvests every icon the sources name, plus the mascot poses and fonts', () => {
    const assets = new Set(fs.readdirSync(path.join(out, 'assets')));
    const icons = new Set(fs.readdirSync(path.join(ROOT, 'assets/icons/ds')));
    const texts = walk(path.join(ROOT, 'demo')).filter((p) => p.endsWith('.mjs'))
      .concat([path.join(ROOT, 'styles.css'), path.join(ROOT, 'index.html')])
      .map((p) => fs.readFileSync(p, 'utf8'));
    let seen = 0;
    for (const t of texts) {
      for (const m of t.matchAll(/(?<![\w-])(\d+-ic-[\w-]+)(?![\w-])/g)) {
        const file = m[1] + '.svg';
        if (!icons.has(file)) continue;
        seen++;
        assert.ok(assets.has(file), 'brak ' + file);
      }
    }
    assert.ok(seen > 20, 'the test checks nothing');
    for (const f of fs.readdirSync(path.join(ROOT, 'assets/mascot'))) {
      if (f.endsWith('.svg')) assert.ok(assets.has(f), 'missing mascot pose ' + f);
    }
    const fonts = [...assets].filter((f) => /\.(?:ttf|woff2?)$/.test(f));
    assert.equal(fonts.length, 4, fonts.join(', '));
  });

  it('passes the prototype gates', () => {
    assert.deepEqual(disallowedProtoImports(fs.readFileSync(path.join(out, 'index.tsx'), 'utf8')), []);
    const rep = checkProtoDs(out);
    const blocks = rep.findings.filter((f) => f.severity === 'BLOCK');
    assert.deepEqual(blocks, []);
  });

  // The publish pipeline of the build shell runs `trufflehog filesystem --fail`
  // and aborts with exit 183 on any hit, verified or not: its GitLab rule reads
  // a 20-22 char id within 40 chars after the word "GitLab" as a token. Same
  // scanner here, so a hit fails locally instead of in the pipeline. Skipped
  // where trufflehog is not installed.
  it('passes the secret scanner the publish pipeline runs', (t) => {
    const probe = spawnSync('trufflehog', ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) { t.skip('trufflehog not installed'); return; }
    const r = spawnSync('trufflehog', ['filesystem', out, '--no-update', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const hits = (r.stdout || '').split('\n').filter((l) => l.includes('"DetectorName"')).map((l) => {
      const d = JSON.parse(l);
      return `${d.DetectorName}: ${d.SourceMetadata?.Data?.Filesystem?.file}:${d.SourceMetadata?.Data?.Filesystem?.line} ${d.Raw}`;
    });
    assert.deepEqual(hits, []);
  });

  it('refuses a directory without spec.json, a name collision and a bare import', () => {
    const empty = path.join(tmp, 'proto-empty');
    fs.mkdirSync(empty);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/demo-export.js'), '--out', empty], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(!fs.existsSync(path.join(empty, 'assets')));

    assert.throws(() => X.buildNameMap(['assets/icons/ds/x.svg', 'assets/mascot/x.svg']), (e) => {
      return e instanceof X.ExportError && e.code === 1
        && e.message.includes('assets/icons/ds/x.svg') && e.message.includes('assets/mascot/x.svg');
    });

    const fx = path.join(tmp, 'fixture-root');
    fs.mkdirSync(path.join(fx, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(fx, 'demo/index.html'), '<html><head><script type="module" src="./main.mjs"></script></head></html>');
    fs.writeFileSync(path.join(fx, 'demo/main.mjs'), "import x from 'lodash';\nconst s = `import y from 'react'`;\n");
    assert.throws(() => X.collectGraph(fx), (e) => e instanceof X.ExportError && e.code === 1 && /lodash/.test(e.message) && /demo\/main\.mjs/.test(e.message));
  });
});
