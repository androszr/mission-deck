// tests/test_module_host_escaping.mjs
// Values from an installed module's module.json (view title/subtitle/id,
// sidebar label, icon path, flyout labels) are attacker-controlled as far as
// the host is concerned: a module arrives as a zip or as a directory copied
// onto disk. Every one of them reaches innerHTML, so every one is escaped.
//
// Source-level assertions - js/module-host.js and js/app.js are browser ES
// modules that import each other and touch document at import time, so they
// cannot be loaded in node. The regexes below pin the escape call at each
// interpolation point.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const host = read('js/module-host.js');
const app = read('js/app.js');

test('module-host imports escHtml from utils', () => {
  assert.match(host, /import\s*\{[^}]*\bescHtml\b[^}]*\}\s*from\s*'\.\/utils\.js'/);
});

test('view section escapes title, subtitle and the root id', () => {
  assert.match(host, /const title = escHtml\(view\.title \|\| view\.label \|\| viewId\)/);
  assert.match(host, /const subtitle = escHtml\(view\.subtitle \|\| ''\)/);
  assert.match(host, /id="' \+ escHtml\(viewId\) \+ '-root"/);
});

test('view section interpolates no raw manifest value into innerHTML', () => {
  const block = /_createViewSection[\s\S]*?\n\}/.exec(host);
  assert.ok(block, '_createViewSection not found');
  for (const raw of ["+ title +", "+ subtitle +", "+ viewId +"]) {
    assert.ok(
      !block[0].includes("'" + raw.slice(2, -2).trim() + " '"),
      'unexpected raw interpolation: ' + raw,
    );
  }
  // The section id is set through the element property, which never parses markup.
  assert.match(block[0], /sec\.id = 'view-' \+ viewId;/);
});

test('sidebar rail item escapes the icon path and the label', () => {
  assert.match(host, /src="' \+ escHtml\(iconSrc\) \+ '"/);
  assert.match(host, /escHtml\(sidebar\.label \|\| manifest\.name\)/);
});

test('app.js imports escHtml', () => {
  assert.match(app, /import\s*\{[^}]*\bescHtml\b[^}]*\}\s*from\s*'\.\/utils\.js'/);
});

test('hub flyout escapes every value it renders', () => {
  const block = /function _openHubFlyout[\s\S]*?\n\}/.exec(app);
  assert.ok(block, '_openHubFlyout not found');
  const src = block[0];
  for (const expr of ['config.label', 'sub.view', 'sub.label', 'sub.badge', 'hubView']) {
    assert.ok(
      src.includes('escHtml(' + expr + ')'),
      expr + ' is interpolated into the flyout without escHtml',
    );
    assert.ok(
      !src.includes('${' + expr + '}'),
      expr + ' still has a raw ${...} interpolation',
    );
  }
});
