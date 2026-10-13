// tests/test_settings_deeplinks.mjs
// Guard for the Settings deep links - `#settings/<tab>`, the sub-route
// js/app.js resolves by splitting on "/" and handing the tail to
// renderSettingsView(subPath), which activates that tab instead of the one
// localStorage happens to remember.
// Run: node --test tests/test_settings_deeplinks.mjs
//
// The defect this exists for is silent in both directions. A link that says
// "Settings > Modules" but carries a bare `#settings` still navigates, so
// nothing looks broken - you simply land on whatever tab you used last, and
// the copy quietly lies. A link that carries a tab id nobody defined navigates
// too: SETT_TAB_IDS.includes(subPath) is false, so it falls back to the stored
// tab, exactly as if the sub-route had never been written.
//
// Source is read as TEXT rather than imported: js/settings.js and
// js/academy.js both touch the document at import time, and the thing under
// test is markup, not behaviour.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'js');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The tab roster, read from its one declaration in js/settings.js. */
function settingsTabIds() {
  const src = read(path.join('js', 'settings.js'));
  const m = src.match(/const SETT_TAB_IDS = \[([^\]]+)\]/);
  assert.ok(m, 'SETT_TAB_IDS not found in js/settings.js');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

// The two shapes a deep link takes. Both REQUIRE their prefix, which is what
// keeps the endpoint paths out of this: `/api/settings/encryption-status` is
// neither a hash nor a navigate() argument, and matching a bare
// `settings/<word>` would drag every one of them in as a phantom tab.
const DEEPLINK_PATTERNS = [
  /#settings\/([a-z0-9-]+)/g,                    // href="#settings/keys", location.hash
  /_navigate\(\s*['"]settings\/([a-z0-9-]+)/g,   // _navigate('settings/tools')
];

/** Every Settings deep link in js/, with the file it came from. */
function settingsSubRoutes() {
  const out = [];
  for (const name of fs.readdirSync(JS_DIR)) {
    if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue;
    const src = fs.readFileSync(path.join(JS_DIR, name), 'utf8');
    for (const re of DEEPLINK_PATTERNS) {
      for (const m of src.matchAll(re)) out.push({ file: 'js/' + name, tab: m[1] });
    }
  }
  return out;
}

describe('settings deep links', () => {
  it('every #settings/<tab> in js/ names a tab that exists', () => {
    const ids = settingsTabIds();
    assert.ok(ids.length >= 7, 'expected the full tab roster');
    const routes = settingsSubRoutes();
    assert.ok(routes.length > 0, 'no #settings/<tab> deep link found at all');
    for (const { file, tab } of routes) {
      assert.ok(ids.includes(tab), `${file} deep-links to "${tab}", which is not in SETT_TAB_IDS`);
    }
  });

  // The three links that used to carry a bare `#settings` while their own text
  // named a tab. Anchored on the href alone: the Polish label may be reworded,
  // the destination may not silently go back to "wherever you were last".
  it('the Academy links carry the tab their label promises', () => {
    const src = read(path.join('js', 'academy.js'));
    for (const href of ['#settings/keys', '#settings/system', '#settings/modules']) {
      assert.ok(src.includes(`href="${href}"`), `js/academy.js lost the ${href} link`);
    }
  });

  it('no link in js/ points at a bare #settings while naming a tab in its text', () => {
    const ids = settingsTabIds();
    // The tab NAMES as a person reads them, mapped to their ids. A bare
    // `#settings` next to one of these words is the defect.
    const labels = {
      'System': 'system',
      'Keys': 'keys',
      'Agents': 'agents',
      'Skills': 'skills',
      'Modules': 'modules',
      'Users': 'users',
      'Tools': 'tools',
    };
    for (const id of Object.values(labels)) assert.ok(ids.includes(id), `stale label map: ${id}`);

    const offenders = [];
    for (const name of fs.readdirSync(JS_DIR)) {
      if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue;
      const src = fs.readFileSync(path.join(JS_DIR, name), 'utf8');
      // One anchor at a time, so a bare #settings elsewhere in the same file
      // (the generic gear, the dashboard tile) is never blamed for this.
      for (const m of src.matchAll(/<a[^>]*href="#settings"[^>]*>([\s\S]*?)<\/a>/g)) {
        const text = m[1];
        for (const label of Object.keys(labels)) {
          if (text.includes(label)) offenders.push(`js/${name}: "${text.trim()}" -> #settings`);
        }
      }
    }
    assert.deepEqual(offenders, [], 'these links name a tab but do not open it');
  });
});
