#!/usr/bin/env node
'use strict';
// scripts/new-view.js
// Scaffolds the whole view triple (plus the module and a test stub) in one
// command. Adding a view is the most common task in this repo and today costs
// four coordinated edits; missing one leaves a view that exists but is
// unreachable - the single most common defect here.
//
//   node scripts/new-view.js obszar-c-1 "Obszar C - strona 1" --hub obszar-c
//   node scripts/new-view.js raporty "Raporty" --hub obszar-a --dry-run
//
// Writes:
//   index.html                    <div class="view-section" id="view-<id>">
//   js/<id>.js                    render<Name>View() + init<Name>()
//   js/view-registry.js           VIEW_REGISTRY entry
//   js/core-hubs.mjs              `pages` entry under the --hub row
//   tests/test_view_<id>.mjs      triple-completeness unit test (unless --no-test)
//
// Everything is located by anchor, never by line number. A missing anchor is a
// hard failure with a message, never a half-written edit. Idempotent: it
// refuses rather than overwriting.
//
// Exit: 0 written (or dry-run printed), 1 refused (already exists), 2 usage /
// missing anchor.

const fs = require('fs');
const path = require('path');
const R = require('./_report');

const HELP = `
new-view.js - scaffold the complete view triple in one command

Usage:
  node scripts/new-view.js <view-id> "<Label>" [--hub <hub-id>]
                           [--no-test] [--dry-run] [--root <dir>] [--json]

  <view-id>   kebab-case, ASCII, e.g. obszar-c-1
  <Label>     the sidebar / page heading text (English copy)
  --hub       core hub the page goes under - an id from js/core-hubs.mjs:
              team, activity, finance, initiatives, support, knowledge,
              assets, apps (default: the id's own prefix when it names a hub,
              else the first hub). A hub is CORE property, so this scaffolds a
              CORE view; a page shipped by a module declares its hub in
              module.json instead (sidebar.kind "page").
  --no-test   skip tests/test_view_<id>.mjs
  --dry-run   print every planned edit, write nothing

Exit codes: 0 ok, 1 refused (the view already exists), 2 usage / missing anchor.
`;

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** obszar-c-1 -> ObszarC1 */
function pascal(id) {
  return id.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Edit builders - each returns { file, next } or throws with an anchor message
// ---------------------------------------------------------------------------

function editIndexHtml(text, id, label) {
  if (text.indexOf('id="view-' + id + '"') !== -1) return null; // already present
  // Anchor: the LAST `</main>` closing tag. Never a line number.
  const m = /\n([ \t]*)<\/main>/g;
  let last = null;
  let hit;
  while ((hit = m.exec(text)) !== null) last = hit;
  if (!last) throw new Error('index.html: anchor `</main>` not found - cannot place the view section');
  const indent = last[1];
  const block = [
    '',
    indent + '  <!-- ' + esc(label) + ' (scaffolded by scripts/new-view.js) -->',
    indent + '  <div class="view-section" id="view-' + id + '">',
    indent + '    <div class="page-header">',
    indent + '      <div class="page-header-row">',
    indent + '        <div>',
    indent + '          <h1>' + esc(label) + '</h1>',
    indent + '          <div class="subtitle">Widok w budowie.</div>',
    indent + '        </div>',
    indent + '      </div>',
    indent + '    </div>',
    indent + '    <div class="view-data" id="' + id + '-root">',
    indent + '      <!-- Rendered by js/' + id + '.js render' + pascal(id) + 'View() -->',
    indent + '    </div>',
    indent + '  </div>',
    '',
  ].join('\n');
  const at = last.index;
  return { file: 'index.html', next: text.slice(0, at) + block + text.slice(at) };
}

function moduleSource(id, label) {
  const N = pascal(id);
  return [
    '// Mission Deck - js/' + id + '.js',
    '// ' + label + ' view. Scaffolded by scripts/new-view.js.',
    '// Exports: render' + N + 'View() and init' + N + '().',
    '//',
    '// Registered in js/view-registry.js (lazy import) and reachable through the',
    '// `pages` entry on the hub row in js/core-hubs.mjs. DS classes only.',
    '',
    "import { registerViewCleanup } from './view-lifecycle.js';",
    '',
    "const VIEW_ID = '" + id + "';",
    '',
    '/**',
    ' * Render the static body of the view. Called on every navigation into it.',
    ' */',
    'export function render' + N + 'View() {',
    "  const root = document.getElementById('" + id + "-root');",
    '  if (!root) return;',
    '  root.innerHTML =',
    "    '<div class=\"ds-card\"><div class=\"ds-card-body\">'",
    "    + '<div class=\"ds-callout ds-callout--info\">View under construction - coming soon.</div>'",
    "    + '</div></div>';",
    '}',
    '',
    '/**',
    ' * Wire up listeners and data loading. Anything that starts a timer, adds a',
    ' * window/document listener or opens an EventSource MUST be torn down here',
    ' * through registerViewCleanup - js/app.js runs it when the user leaves.',
    ' */',
    'export function init' + N + '() {',
    '  registerViewCleanup(VIEW_ID, () => {',
    '    // Clear intervals, remove listeners, close EventSource instances here.',
    '  });',
    '}',
    '',
  ].join('\n');
}

function editViewRegistry(text, id) {
  if (new RegExp("^\\s*'" + id + "'\\s*:\\s*\\{", 'm').test(text)) return null;
  const open = text.indexOf('export const VIEW_REGISTRY');
  if (open === -1) throw new Error('js/view-registry.js: anchor `export const VIEW_REGISTRY` not found');
  const brace = text.indexOf('{', open);
  if (brace === -1) throw new Error('js/view-registry.js: VIEW_REGISTRY object literal not found');
  // Match the closing `};` at column 0 that ends the literal.
  const close = text.indexOf('\n};', brace);
  if (close === -1) throw new Error('js/view-registry.js: end of the VIEW_REGISTRY literal (`\\n};`) not found');
  const N = pascal(id);
  const entry = [
    '',
    "  '" + id + "': {",
    "    importFn: () => import('./" + id + ".js'),",
    "    render: 'render" + N + "View',",
    '    runInit: (mod) => mod.init' + N + '(),',
    '  },',
  ].join('\n');
  return { file: 'js/view-registry.js', next: text.slice(0, close) + entry + text.slice(close) };
}

/** Available hub ids, read out of js/core-hubs.mjs. */
function coreHubIds(text) {
  return Array.from(text.matchAll(/\bid: '([a-z0-9-]+)'/g)).map((x) => x[1]);
}

/**
 * Adds the page to the --hub row's `pages` array in js/core-hubs.mjs - the ONE
 * place a hub is declared. js/sidebar-flyout-config.js is a loop over that file
 * and is never edited by hand.
 *
 * A hub row comes in two shapes and both have to work: the seven that ship with
 * no pages are one-liners with no `pages` key at all, so the first page added to
 * one rewrites the row into its multi-line form.
 */
function editCoreHubs(text, id, label, hub) {
  if (new RegExp("view: '" + id + "'").test(text)) return null;
  const FILE = 'js/core-hubs.mjs';
  const at = text.indexOf("id: '" + hub + "'");
  if (at === -1) {
    const available = coreHubIds(text);
    throw new Error(FILE + ": hub '" + hub + "' not found"
      + (available.length ? ' (available: ' + available.join(', ') + ')' : ''));
  }

  // The object literal around that id.
  const objStart = text.lastIndexOf('{', at);
  if (objStart === -1) throw new Error(FILE + ": unbalanced hub row for '" + hub + "'");
  let depth = 0;
  let objEnd = -1;
  for (let i = objStart; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { objEnd = i; break; } }
  }
  if (objEnd === -1) throw new Error(FILE + ": unbalanced hub row for '" + hub + "'");

  const rowIndent = text.slice(text.lastIndexOf('\n', objStart) + 1, objStart);
  const pageEntry = (indent) => indent + "{ label: '" + String(label).replace(/'/g, "\\'")
    + "', view: '" + id + "' },\n";

  const pagesAt = text.indexOf('pages: [', objStart);
  if (pagesAt !== -1 && pagesAt < objEnd) {
    // Existing array: insert before its closing bracket.
    let bracketDepth = 0;
    let end = -1;
    for (let i = text.indexOf('[', pagesAt); i < text.length; i++) {
      if (text[i] === '[') bracketDepth++;
      else if (text[i] === ']') { bracketDepth--; if (bracketDepth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error(FILE + ": unbalanced `pages: [` inside hub '" + hub + "'");
    const lineStart = text.lastIndexOf('\n', end) + 1;
    const entry = pageEntry(text.slice(lineStart, end) + '  ');
    return { file: FILE, next: text.slice(0, lineStart) + entry + text.slice(lineStart) };
  }

  // No pages yet: rebuild the one-liner as a multi-line row that has them.
  const row = text.slice(objStart, objEnd + 1);
  const field = (name) => {
    const m = new RegExp('\\b' + name + ": '((?:[^'\\\\]|\\\\.)*)'").exec(row);
    return m ? m[1] : null;
  };
  const hubLabel = field('label');
  const hubIcon = field('icon');
  if (hubLabel === null || hubIcon === null) {
    throw new Error(FILE + ": hub '" + hub + "' row has no label/icon to rewrite - add `pages: []` by hand");
  }
  const inner = rowIndent + '  ';
  const rebuilt = [
    '{',
    inner + "id: '" + hub + "',",
    inner + "label: '" + hubLabel + "',",
    inner + "icon: '" + hubIcon + "',",
    inner + 'pages: [',
    pageEntry(inner + '  ').replace(/\n$/, ''),
    inner + '],',
    rowIndent + '}',
  ].join('\n');
  return { file: FILE, next: text.slice(0, objStart) + rebuilt + text.slice(objEnd + 1) };
}

function testSource(id, label, hub) {
  const N = pascal(id);
  return [
    "// tests/test_view_" + id + ".mjs",
    "// The view triple for `" + id + "` (" + label + ") stays complete: the",
    "// index.html section, the VIEW_REGISTRY entry and the HUB_FLYOUT item.",
    "// Scaffolded by scripts/new-view.js - extend it with real behaviour tests.",
    '',
    "import test from 'node:test';",
    "import assert from 'node:assert';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    "const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');",
    "const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');",
    '',
    "test('" + id + ": index.html declares the view section', () => {",
    "  assert.match(read('index.html'), /id=\"view-" + id + "\"/);",
    '});',
    '',
    "test('" + id + ": VIEW_REGISTRY has the entry with render and runInit', () => {",
    "  const src = read('js/view-registry.js');",
    "  assert.match(src, /'" + id + "':\\s*\\{/);",
    "  assert.match(src, /render" + N + "View/);",
    '});',
    '',
    "test('" + id + ": the " + hub + " hub lists the page', () => {",
    "  // js/core-hubs.mjs is the declaration; js/sidebar-flyout-config.js is a",
    "  // loop over it, so the page is asserted where it is written.",
    "  assert.match(read('js/core-hubs.mjs'), /view: '" + id + "'/);",
    '});',
    '',
    "test('" + id + ": the module exports render and init', () => {",
    "  const src = read('js/" + id + ".js');",
    "  assert.match(src, /export function render" + N + "View/);",
    "  assert.match(src, /export function init" + N + "/);",
    '});',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------

function run(flags, positionals) {
  const root = flags.root ? path.resolve(String(flags.root)) : R.ROOT;
  const id = String(positionals[0] || '').trim();
  const label = String(positionals[1] || '').trim();
  if (!ID_RE.test(id)) R.usageError('view id must be kebab-case ASCII (got "' + id + '")');
  if (!label) R.usageError('a "<Label>" argument is required');
  if (!/^[\x20-\x7E]*$/.test(id)) R.usageError('view id must be ASCII-only');

  const modRel = 'js/' + id + '.js';
  const testRel = 'tests/test_view_' + id + '.mjs';

  const readRel = (rel) => {
    const t = R.readFileSafe(path.join(root, rel));
    if (t === null) throw new Error(rel + ' not found under ' + root);
    return t;
  };

  // Refuse before touching anything.
  const existing = [];
  if (fs.existsSync(path.join(root, modRel))) existing.push(modRel);
  if (readRel('index.html').indexOf('id="view-' + id + '"') !== -1) existing.push('index.html #view-' + id);
  if (new RegExp("^\\s*'" + id + "'\\s*:\\s*\\{", 'm').test(readRel('js/view-registry.js'))) existing.push('VIEW_REGISTRY.' + id);
  if (existing.length > 0) {
    return { refused: true, reason: 'already exists: ' + existing.join(', '), edits: [] };
  }

  // Hub: explicit, else the id's own prefix, else the first core hub.
  const hubsText = readRel('js/core-hubs.mjs');
  const hubs = coreHubIds(hubsText);
  let hub = flags.hub ? String(flags.hub) : null;
  if (!hub) {
    const prefix = id.replace(/-[a-z0-9]+$/, '');
    hub = hubs.includes(prefix) ? prefix : (hubs[0] || null);
  }
  if (!hub) throw new Error('js/core-hubs.mjs: no hub found - pass --hub explicitly');

  const edits = [];
  const push = (e) => { if (e) edits.push(e); };

  push(editIndexHtml(readRel('index.html'), id, label));
  push({ file: modRel, next: moduleSource(id, label), create: true });
  push(editViewRegistry(readRel('js/view-registry.js'), id));
  push(editCoreHubs(hubsText, id, label, hub));
  if (!flags['no-test']) {
    if (fs.existsSync(path.join(root, testRel))) {
      return { refused: true, reason: 'already exists: ' + testRel, edits: [] };
    }
    push({ file: testRel, next: testSource(id, label, hub), create: true });
  }

  return { refused: false, reason: null, edits, hub, id, label, root };
}

function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2), { booleans: ['dry-run', 'no-test'] });
  if (flags.help || positionals.length < 2) R.showHelp(HELP);

  let out;
  try { out = run(flags, positionals); } catch (e) { R.usageError(e.message); }

  if (out.refused) {
    const msg = 'new-view: refused - ' + out.reason;
    if (flags.json) process.stdout.write(JSON.stringify({ script: 'new-view', refused: true, reason: out.reason }, null, 2) + '\n');
    else process.stdout.write(msg + '\n');
    process.exit(1);
  }

  const root = out.root;
  const summary = out.edits.map((e) => ({ file: e.file, action: e.create ? 'create' : 'edit', bytes: e.next.length }));

  if (flags['dry-run']) {
    if (flags.json) {
      process.stdout.write(JSON.stringify({ script: 'new-view', dry_run: true, id: out.id, hub: out.hub, edits: summary }, null, 2) + '\n');
    } else {
      const t = ['NEW VIEW (dry run): ' + out.id + '  label: "' + out.label + '"  hub: ' + out.hub, ''];
      for (const e of summary) t.push('  ' + e.action.padEnd(6) + ' ' + e.file + '  (' + e.bytes + ' bytes after)');
      t.push('');
      t.push('Nothing written. Re-run without --dry-run to apply.');
      process.stdout.write(t.join('\n') + '\n');
    }
    process.exit(0);
  }

  for (const e of out.edits) {
    const abs = path.join(root, e.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, e.next, 'utf8');
  }

  if (flags.json) process.stdout.write(JSON.stringify({ script: 'new-view', id: out.id, hub: out.hub, edits: summary }, null, 2) + '\n');
  else {
    const t = ['NEW VIEW: ' + out.id + '  hub: ' + out.hub, ''];
    for (const e of summary) t.push('  ' + e.action.padEnd(6) + ' ' + e.file);
    t.push('');
    t.push('Next: `npm run lint` and `npm test`, then fill in js/' + out.id + '.js.');
    process.stdout.write(t.join('\n') + '\n');
  }
  process.exit(0);
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('new-view internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { run, pascal, editIndexHtml, editViewRegistry, editCoreHubs, coreHubIds, moduleSource, testSource };
}
