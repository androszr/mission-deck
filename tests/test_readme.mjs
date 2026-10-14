// tests/test_readme.mjs
// The README is a product page for a non-developer: a fixed order of sections,
// no data-protection jargon before "Your data stays yours", every picture and
// every relative link resolves, the screenshots listed in docs/images/shots.json
// exist and stay under their size budget.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

const ORDER = [
  'Why Mission Deck', 'Get going in five minutes', 'A day with Mission Deck', 'Modules: the catalog is the product',
  'Mini Deck', 'Your data stays yours', 'Claude Code inside', 'Safety in brief', 'Troubleshooting', 'Uninstall',
  'Everything else', 'Contributing', 'Credits', 'License',
];

describe('README structure', () => {
  it('follows the first-day order', () => {
    const headings = [...README.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ORDER);
  });

  it('opens with a picture of the product', () => {
    const hero = README.indexOf('docs/images/showcase/hero-mission-deck.png');
    assert.ok(hero > 0 && hero < README.indexOf('## Why Mission Deck'));
  });

  it('frames its sections with the showcase posters, each from a layout', () => {
    const posters = [...README.matchAll(/docs\/images\/showcase\/([a-z0-9-]+)\.png/g)].map((m) => m[1]);
    assert.ok(posters.length >= 5, 'only ' + posters.length + ' posters');
    for (const name of posters) {
      assert.ok(fs.existsSync(path.join(ROOT, 'docs/images/showcase/src', name + '.html')), name + ' has no layout');
      assert.ok(fs.statSync(path.join(ROOT, 'docs/images/showcase', name + '.png')).size < 800 * 1024, name + ' is over 800 KB');
    }
  });

  it('keeps the demo link and its chapter deep links', () => {
    assert.ok(README.includes('https://androszr.github.io/mission-deck/)'));
    for (const id of ['guides', 'start', 'sprints', 'roadmap', 'team']) {
      assert.ok(README.includes('https://androszr.github.io/mission-deck/#' + id + '/0'), id);
    }
  });

  it('keeps the data-protection vocabulary out of everything before "Your data stays yours"', () => {
    const before = README.slice(0, README.indexOf('## Your data stays yours'));
    assert.ok(before.length > 1000);
    assert.doesNotMatch(before, /vault|encrypt|decrypt|bitwarden|AES|cipher|\.encryption-key|HKDF/i);
  });
});

describe('README links and images', () => {
  const targets = [...README.matchAll(/(?:\]\(|src=")([^)"\s]+)/g)].map((m) => m[1])
    .filter((t) => !/^(https?:|mailto:|#)/.test(t));

  it('finds a healthy number of them', () => {
    assert.ok(targets.length > 30, 'only ' + targets.length);
  });

  it('every relative target is a file or folder in the repository', () => {
    for (const t of new Set(targets)) {
      const rel = decodeURIComponent(t.split('#')[0]);
      assert.ok(fs.existsSync(path.join(ROOT, rel)), t + ' does not exist');
    }
  });

  it('every #anchor of a linked doc exists as a heading there', () => {
    for (const t of new Set(targets.filter((x) => x.includes('#')))) {
      const [file, anchor] = t.split('#');
      if (!file.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const slugs = [...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-'));
      assert.ok(slugs.includes(anchor), t);
    }
  });

  it('every picture has alternative text', () => {
    for (const m of README.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /alt="[^"]+"/, m[0]);
    for (const m of README.matchAll(/!\[([^\]]*)\]\(/g)) assert.ok(m[1].length > 3, 'empty alt text');
  });
});

describe('screenshots', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/images/shots.json'), 'utf8'));

  it('every listed shot exists and is a PNG', () => {
    assert.ok(doc.shots.length >= 15);
    for (const s of doc.shots) {
      const file = path.join(ROOT, 'docs/images', s.file);
      assert.ok(fs.existsSync(file), s.file);
      assert.deepEqual([...fs.readFileSync(file).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], s.file);
    }
  });

  it('the pictures stay within 4 MB in total', () => {
    const dir = path.join(ROOT, 'docs/images');
    const sizes = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.png')).reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0);
    const total = sizes(dir) + sizes(path.join(dir, 'showcase'));
    assert.ok(total <= 4 * 1024 * 1024, total + ' bytes');
  });

  it('the README uses the screenshots it should, and no unlisted PNG', () => {
    const used = [...README.matchAll(/docs\/images\/([a-z0-9-]+\.png)/g)].map((m) => m[1]);
    const listed = new Set(doc.shots.map((s) => s.file));
    for (const f of used) assert.ok(listed.has(f), f + ' is not in shots.json');
  });

  it('every shot has a unique id and file and a valid way to find its screen', () => {
    const ids = new Set();
    for (const s of doc.shots) {
      assert.ok(!ids.has(s.id), s.id);
      ids.add(s.id);
      assert.ok(s.hash !== undefined || s.url, s.id);
    }
  });
});

describe('scripts/readme-shots.mjs', () => {
  it('parses its arguments and validates shots.json without starting anything', async () => {
    const { parseArgs, loadShots } = await import('../scripts/readme-shots.mjs');
    assert.deepEqual(parseArgs(['--only', 'a,b', '--port', '3800']), { only: ['a', 'b'], port: 3800, list: false, help: false });
    assert.throws(() => parseArgs(['--nope']));
    assert.throws(() => parseArgs(['--port', '80']));
    assert.ok(loadShots().shots.length >= 15);
  });

  it('never touches the real data folders: everything runs in a temp directory in sample mode', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/readme-shots.mjs'), 'utf8');
    for (const key of ['SAMPLE_DATA_DIR', 'MODULES_DIR', 'DASHBOARD_LAYOUT_FILE', "NODE_ENV: 'test'", 'mkdtempSync']) assert.ok(src.includes(key), key);
    assert.match(src, /\/api\/sample-mode\/enter/);
  });

  it('freezes the clock on the sample quarter and greets a sample person, not the git user', async () => {
    const { loadShots, identityEnv } = await import('../scripts/readme-shots.mjs');
    const doc = loadShots();
    assert.equal(doc.clock, '2026-09-30T16:00:00Z');
    assert.equal(doc.identity, 'Alex Morgan');
    const team = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/sample-team/ds-data/team/team-members.json'), 'utf8'));
    assert.ok(team.team_members.some((m) => m.first_name + ' ' + m.last_name === doc.identity), 'the identity is on the sample team');
    assert.deepEqual(identityEnv('Alex Morgan'), { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Alex Morgan' });
    assert.deepEqual(identityEnv(undefined), {});
    const src = fs.readFileSync(path.join(ROOT, 'scripts/readme-shots.mjs'), 'utf8');
    assert.match(src, /context\.clock\.setFixedTime\(new Date\(doc\.clock\)\)/);
  });
});

describe('scripts/readme-showcase.mjs', () => {
  it('phones show the whole screen, tab bar included, never a cropped top', () => {
    const css = fs.readFileSync(path.join(ROOT, 'docs/images/showcase/src/poster.css'), 'utf8');
    assert.match(css, /\.phone img \{[^}]*height: auto;/);
    assert.doesNotMatch(css, /\.phone img \{[^}]*object-fit: cover/);
  });

  it('parses its arguments and lists one poster per layout without starting anything', async () => {
    const { parseArgs, listLayouts, POSTER_SIZE, PHONE_SHOTS } = await import('../scripts/readme-showcase.mjs');
    assert.deepEqual(parseArgs([]), { step: 'all', port: 3778, help: false });
    assert.deepEqual(parseArgs(['compose', '--port', '3900']), { step: 'compose', port: 3900, help: false });
    assert.throws(() => parseArgs(['--nope']));
    assert.throws(() => parseArgs(['--port', '80']));
    assert.deepEqual(POSTER_SIZE, { width: 1200, height: 1200 });
    const layouts = listLayouts();
    assert.ok(layouts.length >= 5);
    for (const name of layouts) assert.ok(fs.existsSync(path.join(ROOT, 'docs/images/showcase', name + '.png')), name + '.png was never rendered');
    for (const shot of PHONE_SHOTS) assert.ok(fs.existsSync(path.join(ROOT, 'docs/images', shot.file)), shot.file);
  });

  it('every picture a layout reads exists in the repository', () => {
    const dir = path.join(ROOT, 'docs/images/showcase/src');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html') || x.endsWith('.css'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of text.matchAll(/(?:src="|url\(')([^"')]+)/g)) {
        assert.ok(fs.existsSync(path.resolve(dir, m[1])), f + ': ' + m[1]);
      }
    }
  });

  it('the posters take their accent colours from the DS brand ramp', () => {
    const css = fs.readFileSync(path.join(ROOT, 'docs/images/showcase/src/poster.css'), 'utf8');
    const tokens = fs.readFileSync(path.join(ROOT, 'css/ds-tokens.css'), 'utf8');
    for (const [name, token] of [['accent', 'ds-brand-55'], ['accent-strong', 'ds-brand-50'], ['accent-ink', 'ds-brand-15']]) {
      const want = tokens.match(new RegExp('--' + token + ':\\s*(#[0-9a-f]{6})'))[1];
      assert.match(css, new RegExp('--' + name + ':\\s*' + want + ';'), name + ' should be ' + token);
    }
  });
});
