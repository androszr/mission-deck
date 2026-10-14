// tests/test_fruit_avatars.mjs
// Made-up people get made-up faces: one fruit module (assets/avatars/fruit-avatars.mjs)
// draws every avatar of the sample team, of Mini Deck's demo data and of the
// demo walkthrough.
//  1. the module: twelve distinct fruits, deterministic, square, labelled, no text
//  2. the Node re-export is the same module
//  3. Mini Deck: every team member points at a fruit file that exists
//  4. the demo walkthrough never paints initials in an avatar slot
// Run: node --test tests/test_fruit_avatars.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = await import('../assets/avatars/fruit-avatars.mjs');

describe('assets/avatars/fruit-avatars.mjs', () => {
  it('twelve fruits on eight backgrounds, each one different', () => {
    assert.equal(F.FRUITS.length, 12);
    assert.equal(new Set(F.FRUITS.map((f) => f.id)).size, 12);
    const bodies = new Set();
    for (let i = 0; i < 12; i++) bodies.add(F.fruitAvatarSvg(i, 'x').replace(/<rect[^>]*>/, ''));
    assert.equal(bodies.size, 12, 'the first twelve people get twelve different fruits');
    assert.equal(F.BACKGROUNDS.length, 8);
  });

  it('is a pure function of the index and the name', () => {
    assert.equal(F.fruitAvatarSvg(5, 'Sam Rivera'), F.fruitAvatarSvg(5, 'Sam Rivera'));
    assert.equal(F.fruitFaceFor('Sam Rivera'), F.fruitFaceFor('Sam Rivera'));
    assert.notEqual(F.fruitFaceFor('Sam Rivera'), F.fruitFaceFor('Alex Morgan'));
  });

  it('a square, labelled picture with a face and no initials', () => {
    const svg = F.fruitAvatarSvg(3, 'Ada & "Lovelace"');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 96 96" /);
    assert.match(svg, /role="img" aria-label="Ada  Lovelace"/, 'markup characters are dropped from the label');
    assert.match(svg, /<rect width="96" height="96" /, 'fills its whole box; the slot clips it to a circle');
    assert.doesNotMatch(svg, /<text/);
    assert.equal((svg.match(/<circle /g) || []).length >= 4, true, 'two eyes and two cheeks at least');
  });

  it('the Node generators load the same module', () => {
    const cjs = require('../scripts/_fruit-avatars.js');
    assert.equal(cjs.fruitAvatarSvg(7, 'x'), F.fruitAvatarSvg(7, 'x'));
  });
});

describe('Mini Deck team avatars', () => {
  it('every member points at a fruit that exists, and a second run changes nothing', () => {
    const team = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/mini-deck/public/data/team.json'), 'utf8'));
    const { build } = require('../scripts/mini-deck-avatars.js');
    const { files } = build(team);
    for (const m of team.members) {
      assert.match(m.avatar, /^avatars\/[a-z0-9-]+\.svg$/);
      const disk = fs.readFileSync(path.join(ROOT, 'apps/mini-deck/public', m.avatar), 'utf8');
      assert.equal(disk, files.get(m.avatar), m.avatar + ' is current');
    }
  });
});

describe('demo walkthrough', () => {
  const dir = path.join(ROOT, 'demo/mocks');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));

  it('no avatar slot is painted with literal initials', () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      // The Bitwarden screens imitate Bitwarden's own UI, which shows initials.
      const scan = f === 'onboarding.mjs' ? src.replace(/onb-bwv-avatar[^\n]*/g, '') : src;
      assert.doesNotMatch(scan, /class="[^"]*(avatar|initials)[^"]*">[A-Z]{2}</, f + ' paints initials into an avatar');
    }
  });

  it('no chapter computes initials, except the edit modal before a photo is chosen', () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      // ch-team's "Edit person" modal shows initials until a photo is uploaded,
      // the placeholder the real Settings > Users form shows.
      const scan = f === 'ch-team.mjs' ? src.replace(/uzy-card__avatar--initials[^\n]*_ini\(f, l\)[^\n]*/, '') : src;
      assert.doesNotMatch(scan, /\b(_ini|_initials|initialsOf)\(|\.ini\b/, f + ' computes initials for an avatar');
    }
  });

  it('every chapter that shows people imports the fruit module and the demo styles the slot', () => {
    for (const f of ['ch-academy.mjs', 'ch-on-call-and-time-off.mjs', 'ch-roadmap.mjs', 'ch-sprints.mjs', 'ch-sync.mjs', 'ch-team.mjs', 'ch-team-keys.mjs', 'ch-time-tracking.mjs', 'ch-using-a-module.mjs', 'shell.mjs']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.match(src, /import \{ fruitFaceFor \} from '\.\.\/\.\.\/assets\/avatars\/fruit-avatars\.mjs';/, f);
      assert.match(src, /demo-fruit/, f);
    }
    const css = fs.readFileSync(path.join(ROOT, 'demo/demo.css'), 'utf8');
    assert.match(css, /\.demo-fruit\.demo-fruit \{[^}]*overflow: hidden;/);
    assert.match(css, /\.demo-fruit > svg \{[^}]*width: 100%;/);
  });
});
