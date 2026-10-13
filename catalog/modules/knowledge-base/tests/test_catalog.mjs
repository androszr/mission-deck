// Unit tests for server/catalog.js on a tmp tree.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const c = require('../server/catalog.js');

function seed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-cat-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  fs.writeFileSync(path.join(dir, 'knowledge-base-areas.json'), JSON.stringify({
    areas: [{ slug: 'atlas', label: 'Atlas', subareas: [{ slug: 'pilot', label: 'Pilot' }] }],
  }));
  put('atlas/pilot/research/a.md', '---\ntitle: "A"\ndate: 2026-01-02\nsummary: s\n---\nbody');
  put('atlas/pilot/research/a.html', '<p>x</p>');
  put('atlas/interviews/b.md', '# no frontmatter');
  put('meetings/x/summary.md', '---\ntitle: m\n---\n');
  put('atlas/assets/c.md', 'x');
  put('atlas/interviews/.hidden.md', 'x');
  put('atlas/interviews/d.refresh-pending.md', 'x');
  put('atlas/interviews/big.md', 'x'.repeat(c.MAX_FILE_BYTES + 1));
  return dir;
}

test('parseFrontmatter: quoted values, arrays, none', () => {
  const r = c.parseFrontmatter('---\ntitle: "T"\ntags: ["a", \'b\']\nbad line\n---\nB');
  assert.strictEqual(r.fields.title, 'T');
  assert.deepStrictEqual(r.fields.tags, ['a', 'b']);
  assert.strictEqual(r.body, 'B');
  const n = c.parseFrontmatter('plain');
  assert.deepStrictEqual(n.fields, {});
  assert.strictEqual(n.body, 'plain');
});

test('normalizeCategory and classifyPath', () => {
  assert.strictEqual(c.normalizeCategory('research'), 'research');
  assert.strictEqual(c.normalizeCategory('_general'), 'general');
  assert.strictEqual(c.normalizeCategory('requirements'), 'business-requirements');
  assert.strictEqual(c.normalizeCategory('zzz'), 'other');
  const areas = [{ slug: 'atlas', subareas: [{ slug: 'pilot' }, { slug: '_general' }] }];
  assert.deepStrictEqual(c.classifyPath('atlas/interviews/x.md', areas), { area: 'atlas', subArea: null, category: 'interviews' });
  assert.deepStrictEqual(c.classifyPath('atlas/pilot/research/x.md', areas), { area: 'atlas', subArea: 'pilot', category: 'research' });
  assert.strictEqual(c.classifyPath('atlas/_general/meetings/sprint-review/x.md', areas).category, 'meetings');
  assert.strictEqual(c.classifyPath('atlas/x.md', areas).category, 'other');
});

test('resolveArticlePath refuses unsafe paths and accepts a good one', () => {
  const dir = seed();
  for (const bad of ['../x.md', '/etc/passwd', 'meetings/x/summary.md', 'sql/a.md', 'atlas/.h.md',
    'atlas/interviews/d.refresh-pending.md', 'atlas/a.txt', 'atlas/../../x.md', '']) {
    assert.strictEqual(c.resolveArticlePath(dir, bad), null, bad);
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-out-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), 's');
  fs.symlinkSync(outside, path.join(dir, 'atlas', 'link'));
  assert.strictEqual(c.resolveArticlePath(dir, 'atlas/link/secret.md'), null);
  assert.ok(c.resolveArticlePath(dir, 'atlas/pilot/research/a.md'));
});

test('scanCatalog skips junk, flags hasHtml, honours the cap', () => {
  const dir = seed();
  const r = c.scanCatalog(dir);
  const paths = r.articles.map((a) => a.path).sort();
  assert.deepStrictEqual(paths, ['atlas/interviews/b.md', 'atlas/pilot/research/a.md']);
  assert.strictEqual(r.skipped.tooLarge, 1);
  const a = r.articles.find((x) => x.path.endsWith('a.md'));
  assert.strictEqual(a.hasHtml, true);
  assert.strictEqual(a.subArea, 'pilot');
  assert.strictEqual(r.articles.find((x) => x.path.endsWith('b.md')).hasHtml, false);
  const capped = c.scanCatalog(dir, { maxFiles: 1 });
  assert.strictEqual(capped.articles.length, 1);
  assert.strictEqual(capped.skipped.overCap, 1);
});

test('readAreas tolerates a missing or malformed file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-areas-'));
  assert.deepStrictEqual(c.readAreas(dir), []);
  fs.writeFileSync(path.join(dir, 'knowledge-base-areas.json'), '{nope');
  assert.deepStrictEqual(c.readAreas(dir), []);
});
