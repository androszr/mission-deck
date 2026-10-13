// tests/test_settings_demo_tab.mjs
// Settings > Demo: the static tab that opens the presentation page - two
// entry points (short track, full track) plus one link per chapter (full).
// Read as TEXT, like tests/test_settings_deeplinks.mjs: js/settings.js touches
// the document at import time and what is under test is markup.
// Run: node --test tests/test_settings_demo_tab.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHAPTER_ORDER, parseDemoHash, resolveTrack } from '../demo/scenario-schema.mjs';
import { TRACKS, DEFAULT_TRACK } from '../demo/tracks.mjs';
import scenario from '../demo/scenario.mjs';
import { DURATIONS } from '../demo/durations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SETTINGS = fs.readFileSync(path.join(ROOT, 'js', 'settings.js'), 'utf8');

/** The markup of the Demo panel, from its opening tag to the next panel or the view end. */
function demoPanel() {
  const start = INDEX.indexOf('data-sett-panel="demo"');
  assert.ok(start > 0, 'no demo panel');
  const end = INDEX.indexOf('<!-- ── GitLab activity', start);
  return INDEX.slice(start, end > 0 ? end : undefined);
}

describe('Settings > Demo tab', () => {
  it('demo is the LAST id of SETT_TAB_IDS', () => {
    const m = SETTINGS.match(/const SETT_TAB_IDS = \[([^\]]+)\]/);
    assert.ok(m);
    const ids = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    assert.equal(ids[ids.length - 1], 'demo');
  });

  it('the tab button sits after Tools', () => {
    const a = INDEX.indexOf('data-sett-tab="tools"');
    const b = INDEX.indexOf('data-sett-tab="demo"');
    assert.ok(a > 0 && b > a);
  });

  it('two entry points: short (the one primary) and full (secondary), both in a new tab', () => {
    const panel = demoPanel();
    const primaries = [...panel.matchAll(/<a class="ds-btn ds-btn--primary"[^>]*>([\s\S]*?)<\/a>/g)];
    assert.equal(primaries.length, 1, 'exactly one primary button in the panel');
    assert.match(primaries[0][0], /href="\/demo\/index\.html#short"/);
    assert.match(primaries[0][1], /^\s*<img[^>]*>\s*Open the Short version\s*$/);
    const full = panel.match(/<a class="ds-btn ds-btn--secondary"[^>]*>([\s\S]*?)<\/a>/);
    assert.ok(full, 'the full-version button is missing');
    assert.match(full[0], /href="\/demo\/index\.html#full"/);
    assert.match(full[1], /^\s*<img[^>]*>\s*Open the Full version\s*$/);
    for (const m of [primaries[0][0], full[0]]) {
      assert.match(m, /target="_blank"/);
      assert.match(m, /rel="noopener noreferrer"/);
    }
  });

  it('both entry hashes name a real track and open its first step', () => {
    for (const id of ['short', 'full']) {
      assert.ok(Object.prototype.hasOwnProperty.call(TRACKS, id), id);
      const p = parseDemoHash('#' + id, scenario, TRACKS, DEFAULT_TRACK);
      const first = resolveTrack(TRACKS[id], scenario)[0];
      assert.deepEqual([p.track, p.chapter, p.step], [id, first.ci, first.steps[0]]);
    }
  });

  it('the hint under the buttons names both track totals, equal to the chapter list sums', () => {
    const m = demoPanel().match(/<p class="sett-tab-desc" data-demo-durations[^>]*>([^<]+)<\/p>/);
    assert.ok(m, 'no hint with the demo duration');
    const sum = (id) => Object.values(DURATIONS[id]).reduce((a, b) => a + b, 0);
    assert.equal(m[1], `Running time with commentary: Short approx. ${sum('short')} min · Full approx. ${sum('full')} min`);
  });

  it('durations cover exactly the chapters of each track', () => {
    assert.deepEqual(Object.keys(DURATIONS.full), CHAPTER_ORDER);
    assert.deepEqual(Object.keys(DURATIONS.short), TRACKS.short.map((e) => e.chapter));
    for (const id of ['full', 'short']) {
      for (const v of Object.values(DURATIONS[id])) assert.ok(Number.isInteger(v) && v >= 1, id + ': ' + v);
    }
  });

  it('every /demo/ link names index.html (/demo/ alone answers 404)', () => {
    const hrefs = [...INDEX.matchAll(/href="(\/demo\/[^"]*)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0);
    for (const h of hrefs) assert.match(h, /^\/demo\/index\.html(#|$)/, h);
  });

  it('lists one link per chapter, in CHAPTER_ORDER, labelled with the chapter title', () => {
    const links = [...demoPanel().matchAll(/<a class="ds-btn ds-btn--tertiary ds-btn--sm" href="\/demo\/index\.html#([a-z0-9-]+)\/0"([^>]*)>([^<]+)<\/a>/g)];
    assert.deepEqual(links.map((m) => m[1]), CHAPTER_ORDER);
    links.forEach((m, i) => {
      assert.match(m[2], /target="_blank"/);
      assert.match(m[2], /rel="[^"]*noopener/);
      assert.equal(m[3].trim(), `${i + 1}. ${scenario.chapters[i].title}`);
    });
  });
});
