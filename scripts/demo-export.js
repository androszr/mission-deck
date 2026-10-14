#!/usr/bin/env node
'use strict';
// scripts/demo-export.js
// Exports the demo/ presentation as a React prototype in team data.
//
// Turns the static presentation under demo/ into a prototype directory under
// data-sub-repositories/ds-data/prototypes/<id>/ that the standard
// publish pipeline can ship: index.tsx (a thin same-origin <iframe> wrapper
// from templates/prototype/demo-export/), styles.css, a merged spec.json and a
// FLAT assets/ directory holding the demo page, its modules, the host
// stylesheets, the shell snapshot of index.html, icons, mascot poses,
// illustrations, fonts and screenshots - every URL rewritten to that flat dir.
//
//   node scripts/demo-export.js --out <abs prototype dir> [--dry-run] [--json]
//   node scripts/demo-export.js --site <dir> [--dry-run] [--json]
//
// --site writes the same flat bundle as a plain static website (index.html, a
// 404 redirect, robots.txt, Open Graph tags and image) for GitHub Pages. It
// shares the collection and rewriting code with --out, so they cannot drift.
//
// Rules this script holds (docs/architecture/automation.md, prototypes.md):
//   - FLAT assets/: _protoCopyAssets copies files only, never a subdirectory,
//     so every exported name is unique and contains no '/' (collision = exit 1).
//   - The URL map is CLOSED. After rewriting, a leftover check over the CODE
//     (comments blanked, bytes untouched) fails the run on any known absolute
//     prefix - a URL the map missed would 404 on the hosting.
//   - Deterministic: sorted lists, no timestamps; spec.json `updated` moves
//     only when the content hash moves. Two runs over one input are identical.
//   - Never creates a prototype: --out must already hold spec.json (the id is
//     always the server's, POST /api/prototypes). Never publishes, never git.
//
// Exit: 0 ok, 1 export refused (collision, bare import, leftover URL, missing
// file), 2 usage or internal error.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const R = require('./_report');
const { protoImportSpecifiers } = require('./_proto-imports');

const HELP = `
demo-export.js - export demo/ as a prototype directory in team data

Usage:
  node scripts/demo-export.js --out <abs prototype dir> [--dry-run] [--json]
  node scripts/demo-export.js --site <dir> [--dry-run] [--json]

  --out       absolute path of an EXISTING prototype directory (it must hold
              spec.json - create the prototype in Design > Prototypy first)
  --site      write a static website into <dir> (created if missing; a
              non-empty dir must come from a previous --site run). Cannot be
              combined with --out
  --dry-run   print the plan (counts, bytes, files to delete), write nothing
  --json      machine-readable envelope

Writes index.tsx, styles.css, spec.json (merged) and a flat assets/ directory.
With --site it writes index.html, demo__index.html (alias), 404.html,
robots.txt, demo-og.png and the flat files at the top of <dir>.
Never publishes and never runs git.

Exit: 0 ok, 1 export refused, 2 usage or internal error.
`;

const TEMPLATE_DIR = 'templates/prototype/demo-export';
const ENTRY_HTML = 'demo/index.html';
const SHELL_HTML = 'index.html';
const MANIFEST = 'demo__manifest.json';
const PAGE_NAME = 'demo__index.html';
const SHELL_NAME = 'host__index.html';

// Site mode (--site): the public page and its link-preview card.
const SITE_URL = 'https://androszr.github.io/mission-deck/';
const SITE_OG_SOURCE = 'assets/demo-og.png';
const SITE_OG_NAME = 'demo-og.png';
const SITE_TITLE = 'Mission Deck - try the demo';
const SITE_DESCRIPTION = 'A click-through tour of Mission Deck, the local cockpit a product team grows itself. No install, no account.';

// Directories copied by token harvest (a name must appear in exported text).
const HARVEST_DIRS = ['assets/icons/ds'];
// Directories copied whole (file names are assembled at runtime).
const WHOLE_DIRS = ['assets/mascot', 'assets/agents', 'demo/assets/proto'];

// The closed string-prefix map for JS, applied outside comments, in order
// (first match at a position wins, so the longer prefixes come first).
const JS_PREFIX_MAP = [
  ['/assets/icons/ds/', './'],
  ['/assets/mascot/', './'],
  ['/assets/agents/', './'],
  ["'assets/proto/'", "'./demo__assets__proto__'"],
];

// Tokens that must not survive in the CODE of an exported text file.
const LEFTOVER_TOKENS = [
  '/api/', "'/js/", '"/js/', '/assets/icons/', '/assets/mascot/', '/assets/agents/',
  "'/styles.css", '"/styles.css', '(/styles.css', "'/css/", '"/css/', '(/css/',
  "'/fonts/", '"/fonts/', '(/fonts/', 'url(/', "url('/", 'url("/', 'src="/', "src='/", 'href="/', "href='/",
  'assets/proto/', 'chapters-css/',
];

// The one known code-level hit: js/theme-boot.js tests whether a same-origin
// fetch PATH starts with /api/ (its analytics patch). It issues no request and
// the demo never fetches /api/, so the literal is behaviour-neutral there.
const LEFTOVER_ALLOWED = {
  'host__js__theme-boot.js': ["pathname.indexOf('/api/') === 0"],
  // The Vex spawn banner shown as terminal text (decorative, never a request);
  // the same named exception lives in tests/test_demo_shell_contract.mjs.
  'demo__mocks__ch-new-module.js': ['POST /api/...'],
};

const TEXT_EXT = new Set(['.html', '.mjs', '.js', '.css']);

class ExportError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code === undefined ? 1 : code;
  }
}

const posix = path.posix;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * Flat name under assets/ for a repo-relative path. demo/ files keep their
 * path as `demo__a__b` (.mjs -> .js), host text files `host__a__b`, catalog
 * and binary assets their basename.
 * @param {string} rel repo-relative POSIX path
 * @returns {string}
 */
function exportedName(rel) {
  const ext = posix.extname(rel);
  if (rel.startsWith('demo/')) {
    const flat = 'demo__' + rel.slice('demo/'.length).split('/').join('__');
    return ext === '.mjs' ? flat.slice(0, -4) + '.js' : flat;
  }
  if (TEXT_EXT.has(ext)) return 'host__' + rel.split('/').join('__').replace(/\.mjs$/, '.js');
  return posix.basename(rel);
}

/**
 * Map every source path to its exported name; a duplicate name is exit 1.
 * @param {Iterable<string>} rels
 * @returns {Map<string, string>} sorted by source path
 */
function buildNameMap(rels) {
  const byName = new Map();
  const out = new Map();
  for (const rel of [...new Set(rels)].sort()) {
    const name = exportedName(rel);
    if (name.includes('/') || name.startsWith('.')) throw new ExportError('Invalid name in assets/: ' + name + ' (from ' + rel + ')');
    if (byName.has(name)) throw new ExportError('Name collision in assets/: ' + byName.get(name) + ' and ' + rel);
    byName.set(name, rel);
    out.set(rel, name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lexical masks: which characters are code, comment, string, template, regex
// ---------------------------------------------------------------------------

const K_CODE = 0;
const K_COMMENT = 1;
const K_STRING = 2;
const K_TEMPLATE = 3;
const K_REGEX = 4;

const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_WORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|delete|new|throw|yield|await)$/;

function _startsRegex(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  if (REGEX_PRECEDERS.has(src[j])) return true;
  if (/[\w$]/.test(src[j])) return REGEX_WORDS.test(src.slice(Math.max(0, j - 12), j + 1));
  return false;
}

/**
 * Per-character kind of a JS source (K_* constants). Template `${}` holes are
 * code again, nested templates included.
 * @param {string} src
 * @returns {Uint8Array}
 */
function jsMask(src) {
  const n = src.length;
  const k = new Uint8Array(n);
  const stack = [];
  let depth = 0;
  let inTpl = false;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (inTpl) {
      k[i] = K_TEMPLATE;
      if (c === '\\') { if (i + 1 < n) k[i + 1] = K_TEMPLATE; i += 2; continue; }
      if (c === '`') { inTpl = false; i++; continue; }
      if (c === '$' && src[i + 1] === '{') { k[i + 1] = K_TEMPLATE; stack.push(depth); depth = 0; inTpl = false; i += 2; continue; }
      i++;
      continue;
    }
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') k[i++] = K_COMMENT; continue; }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const stop = e < 0 ? n : e + 2;
      while (i < stop) k[i++] = K_COMMENT;
      continue;
    }
    if (c === '"' || c === "'") {
      k[i++] = K_STRING;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n) k[i++] = K_STRING;
        k[i++] = K_STRING;
      }
      if (i < n && src[i] === c) k[i++] = K_STRING;
      continue;
    }
    if (c === '`') { k[i++] = K_TEMPLATE; inTpl = true; continue; }
    if (c === '/' && _startsRegex(src, i)) {
      k[i++] = K_REGEX;
      let cls = false;
      while (i < n && src[i] !== '\n') {
        const ch = src[i];
        k[i] = K_REGEX;
        if (ch === '\\') { if (i + 1 < n) k[i + 1] = K_REGEX; i += 2; continue; }
        i++;
        if (ch === '[') cls = true;
        else if (ch === ']') cls = false;
        else if (ch === '/' && !cls) break;
      }
      continue;
    }
    if (stack.length) {
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0) { k[i++] = K_TEMPLATE; depth = stack.pop(); inTpl = true; continue; }
        depth--;
      }
    }
    k[i++] = K_CODE;
  }
  return k;
}

/** Same-length copy of `src` with every character whose kind is in `kinds` blanked. */
function _blank(src, mask, kinds) {
  let out = '';
  for (let i = 0; i < src.length; i++) out += kinds.includes(mask[i]) && src[i] !== '\n' ? ' ' : src[i];
  return out;
}

/** Same-length copy with block comments (CSS) or <!-- --> (HTML) blanked. */
function _blankDelimited(src, open, close) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const s = src.indexOf(open, i);
    if (s < 0) { out += src.slice(i); break; }
    const e = src.indexOf(close, s + open.length);
    const stop = e < 0 ? src.length : e + close.length;
    out += src.slice(i, s) + src.slice(s, stop).replace(/[^\n]/g, ' ');
    i = stop;
  }
  return out;
}

const blankCssComments = (src) => _blankDelimited(src, '/*', '*/');
const blankHtmlComments = (src) => _blankDelimited(src, '<!--', '-->');

// ---------------------------------------------------------------------------
// Reference extraction (shared by the graph walk and the rewriters)
// ---------------------------------------------------------------------------

const SKIP_URL = /^(?:#|[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Resolve a URL found in `fromRel` to a repo-relative path plus its suffix.
 * @returns {{rel: string, suffix: string}|null} null for URLs left as they are
 */
function resolveRef(ref, fromRel) {
  if (!ref || SKIP_URL.test(ref)) return null;
  const m = /^([^?#]*)([?#].*)?$/.exec(ref);
  const p = m[1];
  if (!p) return null;
  const rel = p.startsWith('/') ? posix.normalize(p.slice(1)) : posix.normalize(posix.join(posix.dirname(fromRel), p));
  if (rel.startsWith('..') || posix.isAbsolute(rel)) throw new ExportError('Reference escapes the repository: ' + ref + ' in ' + fromRel);
  return { rel, suffix: m[2] || '' };
}

/** Import specifiers in CODE (never inside a template, string or comment). */
function jsImportRefs(src) {
  const mask = jsMask(src);
  const view = _blank(src, mask, [K_COMMENT, K_TEMPLATE, K_REGEX]);
  const out = [];
  for (const { spec, index } of protoImportSpecifiers(view)) {
    if (mask[index] !== K_CODE) continue;
    let pos = -1;
    for (const q of ["'", '"']) {
      const p = view.indexOf(q + spec + q, index);
      if (p >= 0 && (pos < 0 || p < pos)) pos = p;
    }
    if (pos < 0 || mask[pos] !== K_STRING || (pos > 0 && mask[pos - 1] === K_STRING)) continue;
    out.push({ start: pos + 1, end: pos + 1 + spec.length, ref: spec });
  }
  return out;
}

/** Every url(...) in CSS outside comments (@import url() included). */
function cssUrlRefs(src) {
  const view = blankCssComments(src);
  const out = [];
  for (const m of view.matchAll(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g)) {
    const start = m.index + m[0].indexOf(m[2], 4);
    out.push({ start, end: start + m[2].length, ref: m[2] });
  }
  for (const m of view.matchAll(/@import\s+(['"])([^'"]+)\1/g)) {
    const start = m.index + m[0].indexOf(m[2]);
    out.push({ start, end: start + m[2].length, ref: m[2] });
  }
  return out;
}

/** Every src="" / href="" in HTML outside comments. */
function htmlAttrRefs(src) {
  const view = blankHtmlComments(src);
  const out = [];
  for (const m of view.matchAll(/\s(?:src|href)=(["'])([^"']*)\1/g)) {
    const start = m.index + m[0].indexOf(m[1]) + 1;
    out.push({ start, end: start + m[2].length, ref: m[2] });
  }
  return out;
}

const stripScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

/** Apply non-overlapping edits {start, end, text} to `src`. */
function _splice(src, edits) {
  const sorted = edits.slice().sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const e of sorted) {
    if (e.start < at) continue;
    out += src.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + src.slice(at);
}

function _nameFor(nameOf, rel, fromRel) {
  const name = nameOf(rel);
  if (!name) throw new ExportError('File outside the export: ' + rel + ' (referenced in ' + fromRel + ')');
  return name;
}

// ---------------------------------------------------------------------------
// Rewriters
// ---------------------------------------------------------------------------

/**
 * JS: import specifiers -> './<exported>', then the closed prefix map outside
 * comments.
 * @param {string} src @param {string} fileRel @param {(rel: string) => string|undefined} nameOf
 */
function rewriteJs(src, fileRel, nameOf) {
  const edits = [];
  for (const r of jsImportRefs(src)) {
    if (!/^\.{0,2}\//.test(r.ref)) throw new ExportError('Bare package import: ' + r.ref + ' in ' + fileRel);
    const res = resolveRef(r.ref, fileRel);
    edits.push({ start: r.start, end: r.end, text: './' + _nameFor(nameOf, res.rel, fileRel) });
  }
  const mask = jsMask(src);
  const taken = (i) => edits.some((e) => i >= e.start && i < e.end);
  const importEdits = edits.length;
  for (let i = 0; i < src.length; i++) {
    if (mask[i] === K_COMMENT) continue;
    for (const [from, to] of JS_PREFIX_MAP) {
      if (src.startsWith(from, i) && !taken(i)) {
        edits.push({ start: i, end: i + from.length, text: to });
        i += from.length - 1;
        break;
      }
    }
  }
  return edits.length === 0 && importEdits === 0 ? src : _splice(src, edits);
}

/** CSS: every non-data url() and @import -> './<exported>'. */
function rewriteCss(src, fileRel, nameOf) {
  const edits = [];
  for (const r of cssUrlRefs(src)) {
    const res = resolveRef(r.ref, fileRel);
    if (!res) continue;
    edits.push({ start: r.start, end: r.end, text: './' + _nameFor(nameOf, res.rel, fileRel) + res.suffix });
  }
  return _splice(src, edits);
}

/**
 * HTML: src/href -> './<exported><suffix>'; optionally drop every <script>
 * (the shell snapshot) and mark <html> with data-demo-shell (the page).
 */
function rewriteHtml(src, fileRel, nameOf, opts) {
  const o = opts || {};
  let text = o.stripScripts ? stripScripts(src) : src;
  const edits = [];
  for (const r of htmlAttrRefs(text)) {
    const res = resolveRef(r.ref, fileRel);
    if (!res) continue;
    edits.push({ start: r.start, end: r.end, text: './' + _nameFor(nameOf, res.rel, fileRel) + res.suffix });
  }
  text = _splice(text, edits);
  if (o.standaloneShell) {
    if (!/<html\b/.test(text)) throw new ExportError('No <html> tag in ' + fileRel);
    const siteAttr = o.site ? ' data-demo-site="1"' : '';
    text = text.replace(/<html\b([^>]*)>/, (m, attrs) => '<html' + attrs + ' data-demo-shell="' + o.standaloneShell + '"' + siteAttr + '>');
  }
  if (o.openGraph) {
    if (!/<\/head>/.test(text)) throw new ExportError('No </head> tag in ' + fileRel);
    text = text.replace('</head>', o.openGraph + '</head>');
  }
  return text;
}

/**
 * Known absolute prefixes left in the CODE of an exported text file.
 * Comments are blanked for the check only; the shipped bytes keep them.
 * @returns {string|null} the first offending token, or null
 */
function leftovers(text, name) {
  const ext = posix.extname(name);
  let view;
  if (ext === '.js') view = _blank(text, jsMask(text), [K_COMMENT]);
  else if (ext === '.css') view = blankCssComments(text);
  else view = blankHtmlComments(text);
  for (const snippet of LEFTOVER_ALLOWED[name] || []) view = view.split(snippet).join(' '.repeat(snippet.length));
  for (const t of LEFTOVER_TOKENS) if (view.includes(t)) return t;
  if (ext === '.js') {
    for (const r of jsImportRefs(text)) if (/\.mjs$/.test(r.ref) || !r.ref.startsWith('./')) return r.ref;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

function _read(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new ExportError('File not found: ' + rel);
  return fs.readFileSync(abs);
}

function _listDir(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/**
 * Names (from `basenames`) whose stem appears as a whole [\w-]+ token in any
 * of `texts` - `icon('16-ic-copy')`, `${slug}.svg` tables and url()s alike.
 * @param {string[]} texts @param {string[]} basenames
 * @returns {string[]} sorted
 */
function harvestTokens(texts, basenames) {
  const tokens = new Set();
  for (const t of texts) for (const m of t.matchAll(/[\w-]+/g)) tokens.add(m[0]);
  return basenames.filter((b) => tokens.has(b.replace(/\.[^.]+$/, ''))).sort();
}

/**
 * Walk everything the demo page reaches: the page's own <link>/<script>, the
 * JS import graph, CSS url()/@import, the index.html snapshot (scripts
 * dropped), then the harvested and whole-directory assets.
 * @param {string} root repo root
 * @returns {{names: Map<string,string>, texts: string[], sources: Map<string, Buffer>}}
 */
function collectGraph(root) {
  const sources = new Map();
  const texts = new Set();
  const queue = [ENTRY_HTML];
  const visit = (rel) => {
    if (sources.has(rel)) return;
    queue.push(rel);
  };
  while (queue.length) {
    const rel = queue.shift();
    if (sources.has(rel)) continue;
    const buf = _read(root, rel);
    sources.set(rel, buf);
    const ext = posix.extname(rel);
    if (!TEXT_EXT.has(ext)) continue;
    texts.add(rel);
    const src = buf.toString('utf8');
    let refs;
    if (ext === '.html') refs = htmlAttrRefs(rel === SHELL_HTML ? stripScripts(src) : src);
    else if (ext === '.css') refs = cssUrlRefs(src);
    else {
      refs = jsImportRefs(src);
      for (const r of refs) {
        if (!/^\.{0,2}\//.test(r.ref)) throw new ExportError('Bare package import: ' + r.ref + ' in ' + rel + ' (the export has no bundler)');
      }
    }
    for (const r of refs) {
      const res = resolveRef(r.ref, rel);
      if (!res) continue;
      if (rel === SHELL_HTML && res.rel === ENTRY_HTML) continue;
      if (posix.extname(res.rel) === '.html' && res.rel !== ENTRY_HTML) {
        throw new ExportError('Link to a page outside the demo: ' + r.ref + ' in ' + rel);
      }
      visit(res.rel);
    }
    if (rel === ENTRY_HTML && !sources.has(SHELL_HTML)) visit(SHELL_HTML);
  }

  const textBodies = [...texts].sort().map((rel) => sources.get(rel).toString('utf8'));
  const extra = [];
  for (const dir of HARVEST_DIRS) {
    for (const f of harvestTokens(textBodies, _listDir(root, dir).filter((x) => x.endsWith('.svg')))) extra.push(dir + '/' + f);
  }
  // Whole directories ship their assets, never their manifests.
  for (const dir of WHOLE_DIRS) for (const f of _listDir(root, dir)) if (!f.endsWith('.json')) extra.push(dir + '/' + f);
  for (const rel of extra) if (!sources.has(rel)) sources.set(rel, _read(root, rel));

  const names = buildNameMap(sources.keys());
  return { names, texts: [...texts].sort(), sources };
}

// ---------------------------------------------------------------------------
// spec.json
// ---------------------------------------------------------------------------

/**
 * Merge the export into the server-made spec: drop `frame`, keep `releases`,
 * rewrite summary/scope, `customElements: []`, record the hash; `updated`
 * moves only when the hash moves.
 */
function mergeSpec(previousSpec, info) {
  const prev = previousSpec && typeof previousSpec === 'object' ? previousSpec : {};
  const next = Object.assign({}, prev);
  delete next.frame;
  const shortById = new Map((info.shortChapters || []).map((c) => [c.id, c.steps]));
  next.summary = 'The "How we work with Mission Deck" demo, exported 1:1 from the demo/ directory of the Mission Deck repository '
    + '(scripts/demo-export.js): ' + info.chapters.length + ' chapters in the Full version, '
    + shortById.size + ' in the Short version. The demo page (assets/demo__index.html) runs in a single frame; '
    + 'the version is picked under "Demo states". index.tsx, styles.css and assets/ are generated - '
    + 'make changes in demo/ and run the export again.';
  next.scope = info.chapters.map((c, i) => ({
    group: (i + 1) + '. ' + c.title,
    items: [
      'Steps in the Full version: ' + c.steps,
      shortById.has(c.id) ? 'Steps in the Short version: ' + shortById.get(c.id) : 'Full version only',
    ],
  }));
  next.customElements = [];
  const prevHash = prev.demoExport && prev.demoExport.sourceSha256;
  next.demoExport = { source: 'demo/', sourceSha256: info.sourceSha256, files: info.files };
  if (prevHash !== info.sourceSha256 || !next.updated) next.updated = info.today;
  return next;
}

function _today() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

async function _scenarioInfo(root) {
  const scenario = (await import(pathToFileURL(path.join(root, 'demo/scenario.mjs')).href)).default;
  const tracks = await import(pathToFileURL(path.join(root, 'demo/tracks.mjs')).href);
  const chapters = scenario.chapters.map((c) => ({ id: c.id, title: c.title, steps: (c.steps || []).length }));
  const shortChapters = ((tracks.TRACKS && tracks.TRACKS.short) || []).map((c) => ({ id: c.chapter, steps: (c.steps || []).length }));
  return { chapters, shortChapters };
}

// ---------------------------------------------------------------------------
// Plan and run
// ---------------------------------------------------------------------------

function _checkOut(out) {
  const msg = 'The prototype directory must exist and have a spec.json - create the prototype via Design > Prototypes > Add prototype';
  if (!out || typeof out !== 'string' || !path.isAbsolute(out)) throw new ExportError(msg + ' (pass an absolute --out path)', 2);
  if (!fs.existsSync(path.join(out, 'spec.json'))) throw new ExportError(msg + ': ' + out, 2);
  const id = path.basename(out);
  if (!/^proto-[a-z0-9-]+$/.test(id)) throw new ExportError('The directory name is not a prototype id (proto-...): ' + id, 2);
  return { id, slug: id.replace(/^proto-/, '') };
}

function _readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Everything the run would write, in memory, without writing.
 * @param {{out: string, root?: string, today?: string}} opts
 */
/**
 * Collect, rewrite and leftover-check every exported text file.
 * @param {string} root repo root
 * @param {{site?: boolean}} [mode]
 * @returns {Map<string, Buffer>} 'assets/<name>' -> bytes (sorted by source path)
 */
function buildAssetFiles(root, mode) {
  const { names, texts, sources } = collectGraph(root);
  const nameOf = (rel) => names.get(rel);
  const files = new Map();
  for (const [rel, name] of names) {
    let bytes = sources.get(rel);
    if (texts.includes(rel)) {
      const src = bytes.toString('utf8');
      const ext = posix.extname(rel);
      let text;
      if (rel === ENTRY_HTML) {
        const o = { standaloneShell: './' + SHELL_NAME };
        if (mode && mode.site) { o.site = true; o.openGraph = _openGraphTags(); }
        text = rewriteHtml(src, rel, nameOf, o);
      } else if (rel === SHELL_HTML) text = rewriteHtml(src, rel, nameOf, { stripScripts: true });
      else if (ext === '.html') text = rewriteHtml(src, rel, nameOf);
      else if (ext === '.css') text = rewriteCss(src, rel, nameOf);
      else text = rewriteJs(src, rel, nameOf);
      const bad = leftovers(text, name);
      if (bad) throw new ExportError('Unrewritten reference in ' + name + ' (from ' + rel + '): ' + bad);
      bytes = Buffer.from(text, 'utf8');
    }
    files.set('assets/' + name, bytes);
  }
  if (names.get(ENTRY_HTML) !== PAGE_NAME || names.get(SHELL_HTML) !== SHELL_NAME) {
    throw new ExportError('Unexpected demo page names in assets/', 2);
  }
  return files;
}

function _openGraphTags() {
  const img = SITE_URL + SITE_OG_NAME;
  const meta = (attr, key, val) => '  <meta ' + attr + '="' + key + '" content="' + val + '">\n';
  return '  <meta name="description" content="' + SITE_DESCRIPTION + '">\n'
    + meta('property', 'og:type', 'website')
    + meta('property', 'og:site_name', 'Mission Deck')
    + meta('property', 'og:title', SITE_TITLE)
    + meta('property', 'og:description', SITE_DESCRIPTION)
    + meta('property', 'og:url', SITE_URL)
    + meta('property', 'og:image', img)
    + meta('property', 'og:image:width', '1200')
    + meta('property', 'og:image:height', '630')
    + meta('name', 'twitter:card', 'summary_large_image')
    + meta('name', 'twitter:title', SITE_TITLE)
    + meta('name', 'twitter:description', SITE_DESCRIPTION)
    + meta('name', 'twitter:image', img);
}

// Absolute PATH on the host (not a relative URL): a relative target would
// resolve under the missing URL's own directory and loop on a nested 404.
const SITE_INDEX_PATH = new URL(SITE_URL).pathname + 'index.html';
const SITE_404 = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>Mission Deck demo</title>\n'
  + '  <meta http-equiv="refresh" content="0; url=' + SITE_INDEX_PATH + '">\n'
  + '  <script>location.replace(' + JSON.stringify(SITE_INDEX_PATH) + ' + location.hash);</script>\n'
  + '</head>\n<body>\n  <p>Taking you to the <a href="' + SITE_INDEX_PATH + '">Mission Deck demo</a>.</p>\n</body>\n</html>\n';

const SITE_ROBOTS = 'User-agent: *\nAllow: /\n';

/** Add a site extra; a name already taken by an exported file is a collision. */
function addSiteFile(files, name, buf) {
  if (files.has(name)) throw new ExportError('Name collision in the site root: ' + name);
  files.set(name, buf);
}

/**
 * Everything a --site run would write, in memory.
 * @param {{site: string, root?: string}} opts
 */
function planSite(opts) {
  const root = opts.root || R.ROOT;
  const site = opts.site;
  if (!site || typeof site !== 'string') throw new ExportError('--site needs a directory', 2);
  const assets = buildAssetFiles(root, { site: true });
  const files = new Map();
  for (const [k, v] of assets) files.set(k.slice('assets/'.length), v);
  const page = files.get(PAGE_NAME);
  addSiteFile(files, 'index.html', page);
  addSiteFile(files, '404.html', Buffer.from(SITE_404, 'utf8'));
  addSiteFile(files, 'robots.txt', Buffer.from(SITE_ROBOTS, 'utf8'));
  addSiteFile(files, SITE_OG_NAME, _read(root, SITE_OG_SOURCE));

  const keys = [...files.keys()].sort();
  const sourceSha256 = sha256(keys.map((k) => k + '\t' + sha256(files.get(k)) + '\n').join(''));
  const manifest = { generatedBy: 'scripts/demo-export.js --site', site: true, sourceSha256, files: keys };
  files.set(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));

  const prev = _readJson(path.join(site, MANIFEST));
  const keep = new Set(keys);
  const deleted = (prev && prev.site === true && Array.isArray(prev.files) ? prev.files : [])
    .filter((f) => typeof f === 'string' && /^[^/\\]+$/.test(f) && !f.startsWith('.') && f !== MANIFEST && !keep.has(f))
    .sort();
  let bytes = 0;
  for (const b of files.values()) bytes += b.length;
  return { site, files, sourceSha256, deleted, bytes };
}

/** A --site target is fine when missing, empty, or made by a previous --site run. */
function _checkSite(site) {
  if (!fs.existsSync(site)) return;
  if (!fs.statSync(site).isDirectory()) throw new ExportError('--site target is not a directory: ' + site, 2);
  if (fs.readdirSync(site).length === 0) return;
  const prev = _readJson(path.join(site, MANIFEST));
  if (!prev || prev.site !== true) {
    throw new ExportError('Refusing a non-empty directory that a previous --site run did not produce: ' + site, 2);
  }
}

/**
 * Plan, then write the site atomically (manifest last), then delete what the
 * previous run owned and this one no longer produces.
 * @param {{site: string, dryRun?: boolean, root?: string}} opts
 */
async function runSite(opts) {
  const site = path.resolve(opts.site);
  _checkSite(site);
  const plan = planSite(Object.assign({}, opts, { site }));
  const written = [];
  if (!opts.dryRun) {
    fs.mkdirSync(site, { recursive: true });
    const order = [...plan.files.keys()].filter((k) => k !== MANIFEST).sort();
    order.push(MANIFEST);
    for (const k of order) if (_writeAtomic(path.join(site, k), plan.files.get(k))) written.push(k);
    for (const f of plan.deleted) {
      const abs = path.join(site, f);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
  }
  return {
    site, files: [...plan.files.keys()].sort(), bytes: plan.bytes,
    sourceSha256: plan.sourceSha256, deleted: plan.deleted, written,
  };
}

async function planExport(opts) {
  const root = opts.root || R.ROOT;
  const out = opts.out;
  const { id, slug } = _checkOut(out);
  const files = buildAssetFiles(root); // 'assets/<name>' | 'index.tsx' | 'styles.css' -> Buffer

  const tsx = fs.readFileSync(path.join(root, TEMPLATE_DIR, 'index.tsx'), 'utf8').split('{{PROTO_SLUG}}').join(slug);
  files.set('index.tsx', Buffer.from(tsx, 'utf8'));
  files.set('styles.css', fs.readFileSync(path.join(root, TEMPLATE_DIR, 'styles.css')));

  const keys = [...files.keys()].sort();
  const sourceSha256 = sha256(keys.map((k) => k + '\t' + sha256(files.get(k)) + '\n').join(''));
  const assetNames = keys.filter((k) => k.startsWith('assets/')).map((k) => k.slice('assets/'.length));
  const manifest = { generatedBy: 'scripts/demo-export.js', source: 'demo/', sourceSha256, files: assetNames };
  files.set('assets/' + MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));

  const info = await _scenarioInfo(root);
  const prevSpec = _readJson(path.join(out, 'spec.json')) || {};
  const spec = mergeSpec(prevSpec, Object.assign(info, { sourceSha256, files: assetNames.length + 1, today: opts.today || _today() }));
  files.set('spec.json', Buffer.from(JSON.stringify(spec, null, 2) + '\n', 'utf8'));

  const prevManifest = _readJson(path.join(out, 'assets', MANIFEST));
  const keep = new Set(assetNames);
  const deleted = ((prevManifest && Array.isArray(prevManifest.files)) ? prevManifest.files : [])
    .filter((f) => typeof f === 'string' && /^[^/\\]+$/.test(f) && !f.startsWith('.') && f !== MANIFEST && !keep.has(f))
    .sort();

  let bytes = 0;
  for (const b of files.values()) bytes += b.length;
  return { out, id, slug, files, sourceSha256, deleted, bytes };
}

function _writeAtomic(abs, buf) {
  if (fs.existsSync(abs) && fs.readFileSync(abs).equals(buf)) return false;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), '.' + path.basename(abs) + '.tmp-' + process.pid);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, abs);
  return true;
}

/**
 * Plan, then write every file atomically (manifest last), then delete the
 * files the previous manifest owned and this export no longer produces.
 * @param {{out: string, dryRun?: boolean, root?: string, today?: string}} opts
 */
async function runExport(opts) {
  const plan = await planExport(opts);
  const written = [];
  if (!opts.dryRun) {
    const order = [...plan.files.keys()].filter((k) => k !== 'assets/' + MANIFEST).sort();
    order.push('assets/' + MANIFEST);
    for (const k of order) if (_writeAtomic(path.join(plan.out, k), plan.files.get(k))) written.push(k);
    for (const f of plan.deleted) {
      const abs = path.join(plan.out, 'assets', f);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
  }
  return {
    out: plan.out,
    id: plan.id,
    slug: plan.slug,
    files: [...plan.files.keys()].sort(),
    bytes: plan.bytes,
    sourceSha256: plan.sourceSha256,
    deleted: plan.deleted,
    written,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function _kindOf(name) {
  if (/^demo__.*\.(?:js|html)$/.test(name)) return 'demo-js-html';
  if (/\.css$/.test(name)) return 'css';
  if (/^host__/.test(name)) return 'host';
  if (/\.svg$/.test(name)) return 'svg';
  if (/\.(?:ttf|woff2?)$/.test(name)) return 'font';
  return 'other';
}

async function mainSite(flags) {
  let result;
  try {
    result = await runSite({ site: String(flags.site), dryRun: !!flags['dry-run'] });
  } catch (e) {
    if (!(e instanceof ExportError)) R.usageError('demo-export: ' + (e && e.stack ? e.stack : e));
    if (e.code === 2) R.usageError(e.message);
    const rep = new R.Report('demo-export', { site: String(flags.site) });
    rep.block({ rule: 'demo-export', message: e.message });
    rep.emit(flags, 'DEMO-EXPORT');
    return;
  }
  const counts = {};
  for (const f of result.files) {
    const k = _kindOf(f);
    counts[k] = (counts[k] || 0) + 1;
  }
  const rep = new R.Report('demo-export', {
    site: result.site, dryRun: !!flags['dry-run'], files: result.files.length, bytes: result.bytes,
    sourceSha256: result.sourceSha256, deleted: result.deleted, written: result.written.length,
  });
  rep.info('Files by kind: ' + Object.keys(counts).sort().map((k) => k + '=' + counts[k]).join(', '));
  if (result.deleted.length) rep.info('To delete: ' + result.deleted.join(', '));
  rep.emit(flags, 'DEMO-EXPORT');
}

async function main() {
  const { flags } = R.parseArgs(process.argv.slice(2), { booleans: ['dry-run'] });
  if (flags.help) R.showHelp(HELP);
  if (flags.site !== undefined && flags.out !== undefined) R.usageError('--site and --out cannot be combined');
  if (flags.site !== undefined) {
    if (flags.site === true || !flags.site) R.usageError('--site needs a directory');
    await mainSite(flags);
    return;
  }
  if (!flags.out || flags.out === true) R.usageError('The prototype directory must exist and have a spec.json - create the prototype via Design > Prototypes > Add prototype (missing --out)');
  let result;
  try {
    result = await runExport({ out: String(flags.out), dryRun: !!flags['dry-run'] });
  } catch (e) {
    if (!(e instanceof ExportError)) R.usageError('demo-export: ' + (e && e.stack ? e.stack : e));
    if (e.code === 2) R.usageError(e.message);
    const rep = new R.Report('demo-export', { out: String(flags.out) });
    rep.block({ rule: 'demo-export', message: e.message });
    rep.emit(flags, 'DEMO-EXPORT');
    return;
  }
  const counts = {};
  for (const f of result.files) {
    const k = f.startsWith('assets/') ? _kindOf(f.slice(7)) : 'prototype';
    counts[k] = (counts[k] || 0) + 1;
  }
  const rep = new R.Report('demo-export', {
    out: result.out, id: result.id, slug: result.slug, dryRun: !!flags['dry-run'],
    files: result.files.length, bytes: result.bytes, sourceSha256: result.sourceSha256,
    deleted: result.deleted, written: result.written.length,
  });
  rep.info('Files by kind: ' + Object.keys(counts).sort().map((k) => k + '=' + counts[k]).join(', '));
  if (result.deleted.length) rep.info('To delete: ' + result.deleted.join(', '));
  rep.emit(flags, 'DEMO-EXPORT');
}

if (require.main === module) {
  main().catch((e) => R.usageError('demo-export: ' + (e && e.stack ? e.stack : e)));
} else {
  module.exports = {
    ExportError,
    exportedName,
    buildNameMap,
    jsMask,
    jsImportRefs,
    rewriteJs,
    rewriteCss,
    rewriteHtml,
    leftovers,
    collectGraph,
    harvestTokens,
    mergeSpec,
    planExport,
    runExport,
    planSite,
    addSiteFile,
    runSite,
    SITE_URL,
    SITE_INDEX_PATH,
    LEFTOVER_TOKENS,
  };
}
