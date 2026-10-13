// tests/test_demo_shell_contract.mjs
// Anti-drift and no-network gate for the demo page (demo/).
//  1. Every selector in demo/shell-contract.mjs still exists in index.html,
//     so renaming a shell element fails here, not silently on the stage.
//  2. demo/ performs no real operation: no /api/, no stream, no socket, no
//     download, no storage write, and the ONE fetch is GET /index.html.
//  3. Every /js/ module the demo imports - followed transitively - has no
//     network call either (js/toast.js is NOT importable for that reason: it
//     pulls in js/analytics.js).
//  4. CSP: demo/index.html has no inline <script>.
//  5. Colours: no hex literal in demo/ outside the --vsc-* declarations.
// Run: node --test tests/test_demo_shell_contract.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHELL_CONTRACT } from '../demo/shell-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function demoFiles(dir = path.join(ROOT, 'demo')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? demoFiles(p) : [p];
  });
}
const rel = (p) => path.relative(ROOT, p);

/** The id, classes and attribute values one selector needs from the markup. */
function selectorParts(sel) {
  const ids = [...sel.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...sel.matchAll(/\[([\w-]+)="([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
  return { ids, classes, attrs };
}

describe('demo shell contract', () => {
  it('every SHELL_CONTRACT selector exists in index.html', () => {
    assert.ok(SHELL_CONTRACT.length > 30);
    for (const { selector, purpose } of SHELL_CONTRACT) {
      assert.ok(purpose, selector + ' bez purpose');
      const { ids, classes, attrs } = selectorParts(selector);
      for (const id of ids) assert.ok(INDEX.includes(`id="${id}"`), `${selector}: missing id="${id}"`);
      for (const c of classes) {
        assert.ok(new RegExp(`class="[^"]*\\b${c}\\b`).test(INDEX), `${selector}: missing class ${c}`);
      }
      for (const [k, v] of attrs) assert.ok(INDEX.includes(`${k}="${v}"`), `${selector}: missing ${k}="${v}"`);
    }
  });

  it('index.html has exactly one Demo tab and one Demo panel', () => {
    assert.equal(INDEX.split('data-sett-tab="demo"').length - 1, 1);
    assert.equal(INDEX.split('data-sett-panel="demo"').length - 1, 1);
  });

  it('demo/ performs no real operation and fetches only /index.html', () => {
    const FORBIDDEN = ['/api/', 'EventSource(', 'WebSocket(', 'XMLHttpRequest', 'sendBeacon', 'createObjectURL(',
      '.download =', 'localStorage.setItem', 'sessionStorage.setItem', 'window.open(', 'confirmDsModal(', "from '/js/toast.js'"];
    // The ONE allowed occurrence of '/api/': the Vex spawn banner, copied verbatim from
    // .claude/skills/new-idea/banners/ and shown as terminal text - decorative, never a request.
    const DECORATIVE = [{ file: path.join('demo', 'mocks', 'ch-new-module.mjs'), text: "'  |  $ node scripts/new-endpoint.js POST /api/...     |'" }];
    let fetches = 0;
    for (const f of demoFiles().filter((p) => /\.(mjs|js|html)$/.test(p))) {
      let src = fs.readFileSync(f, 'utf8');
      for (const d of DECORATIVE) if (rel(f) === d.file) src = src.split(d.text).join('');
      for (const bad of FORBIDDEN) assert.ok(!src.includes(bad), `${rel(f)} zawiera ${bad}`);
      const n = (src.match(/\bfetch\(/g) || []).length;
      if (n) {
        assert.equal(rel(f), path.join('demo', 'shell-loader.mjs'), rel(f) + ' calls fetch(');
        // The standalone export may point the one fetch elsewhere
        // (data-demo-shell); in the cockpit '/index.html' stays the default.
        assert.match(src, /fetch\(STANDALONE_SHELL \|\| '\/index\.html'/);
      }
      fetches += n;
    }
    assert.equal(fetches, 1);
  });

  it('every /js/ module the demo imports, transitively, has no network call', () => {
    const seen = new Set();
    const queue = [];
    for (const f of demoFiles().filter((p) => p.endsWith('.mjs'))) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'(\/js\/[^']+)'/g)) {
        queue.push(path.join(ROOT, m[1]));
      }
    }
    assert.ok(queue.length > 0, 'the demo imports nothing from /js/ - the test checks nothing');
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf8');
      for (const bad of ['fetch(', 'EventSource(', 'WebSocket(', 'XMLHttpRequest', 'sendBeacon']) {
        assert.ok(!src.includes(bad), `${rel(file)} (imported by the demo) contains ${bad}`);
      }
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
        queue.push(path.resolve(path.dirname(file), m[1]));
      }
    }
  });

  it('demo/index.html carries no inline script (CSP script-src self)', () => {
    const html = fs.readFileSync(path.join(ROOT, 'demo', 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 2);
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /\bsrc=/, 'skrypt bez src');
      assert.equal(body.trim(), '', 'content inside the script tag');
    }
    assert.ok(!/\son[a-z]+="/.test(html), 'atrybut on* w demo/index.html');
  });

  it('no hex colour in demo/ outside the --vsc-* declarations of demo/vscode.css', () => {
    const HEX = /(?<!&)#[0-9a-fA-F]{3,8}\b/; // &#39; is an entity, not a colour
    for (const f of demoFiles().filter((p) => /\.(mjs|js|html|css)$/.test(p))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!HEX.test(line)) return;
        const ok = f.endsWith('vscode.css') && /^\s*--vsc-[\w-]+:/.test(line);
        assert.ok(ok, `${rel(f)}:${i + 1} colour outside the tokens: ${line.trim()}`);
      });
    }
  });
});
