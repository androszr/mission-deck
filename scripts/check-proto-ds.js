#!/usr/bin/env node
'use strict';
// scripts/check-proto-ds.js
// Deterministic Design System conformance linter for a prototype built by
// /prototype. Reads a prototype directory (normally
// data-sub-repositories/ds-data/prototypes/<id>/) and checks it against the
// icon set (assets/icons/ds/manifest.json), the illustration set
// (assets/mascot/manifest.json) and the token layer in css/ds-tokens*.css.
//
//   node scripts/check-proto-ds.js data-sub-repositories/ds-data/prototypes/foo
//   node scripts/check-proto-ds.js <dir> --json
//   node scripts/check-proto-ds.js <dir> --baseline before.json   (iteration gate)
//
// BLOCK categories:
//   hardcoded-color       hex / rgb() / hsl() in styles.css outside device chrome
//   unknown-token         var(--x) that is neither a DS token nor defined locally
//   unknown-icon          /assets/icons/ds/<slug>.svg with an unknown slug
//   unknown-illustration  same for /assets/mascot/<slug>.svg and ds-illustration/<slug>
//   js-import             render.js importing from /js/ (must be self-contained)
//   adapter-frame         a DS field adapter wrapped in a box that draws its own field frame
//   registry-mismatch     /* CUSTOM */ marker count != spec.json customElements[]
//   stale-registration    a customElements[] entry no code or CSS mentions
//   missing-file          the prototype contract file is absent
//   react-import          an import outside scripts/_proto-imports.js (React)
//   raw-control           raw button/input/select/textarea/table outside a
//                         registered custom element (React)
// WARN categories:
//   suspect-registration  a custom element whose name hints at a catalog component
//   inline-svg            <svg> in render.js where a catalog icon route belongs
//   max-width-media       a max-width media query (mobile-first means min-width)
//   dsicon-svg-paint      an `svg` rule setting color/fill/stroke (React)
//   outline-none          `outline: none` with no focus replacement (React)
//   hashed-class          a selector on a hashed CSS-module class (React)
// NOTE categories:
//   raw-control-scoped    a raw control inside a spec.json customElements[] /
//                         owns[] function body (React)
//   baseline              a finding already present in the --baseline file
//
// Every finding carries `snippet` and `fingerprint` in --json (line-free).
// Exit: 0 no BLOCK, 1 at least one BLOCK, 2 usage or missing catalog.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('./_report');
const {
  disallowedProtoImports, stripComments,
} = require('./_proto-imports');

const HELP = `
check-proto-ds.js - Design System conformance linter for a prototype build

Usage:
  node scripts/check-proto-ds.js <prototype-dir> [--json] [--baseline <file.json>]

Options:
  --json               machine-readable envelope (verdict, counts, findings);
                       every finding carries a line-free \`fingerprint\`
  --baseline <file>    the --json output of this linter from BEFORE the change:
                       findings already there become NOTE \`baseline\` and only
                       NEW ones block (iterating an existing prototype). Leave
                       it out for a new prototype - full strictness.
  --help               this text

Reads the icon and illustration manifests under assets/. React tokens come from the build
shell's tokens.css plus the app tokens it copies (css/ds*.css); legacy tokens
come from css/ds*.css.
Exit codes: 0 clean or warnings only, 1 blocking findings, 2 usage or internal error.
`;

const TOKEN_FILES = [
  path.join('css', 'ds-tokens.css'),
  path.join('css', 'ds-tokens-dark.css'),
  path.join('css', 'ds.css'),
];
const ICONS_JSON = path.join('assets', 'icons', 'ds', 'manifest.json');
const ILLUS_JSON = path.join('assets', 'mascot', 'manifest.json');

const TOKEN_DEF_RE = /(^|[;{\s])(--[a-z0-9-]+)\s*:/gi;
const VAR_REF_RE = /var\(\s*(--[a-z0-9-]+)\s*[,)]/gi;
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC_COLOR_RE = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;
const ICON_REF_RE = /(?:icons\/ds\/|ds-icon\/)([a-z0-9._-]+?)(?:\.svg\b|(?=['"`)\s]))/gi;
const ILLUS_REF_RE = /(?:assets\/mascot\/|ds-illustration\/)([a-z0-9._-]+?)(?:\.svg\b|(?=['"`)\s]))/gi;
const JS_IMPORT_RE = /\bfrom\s*['"](\/js\/[^'"]*)['"]|\bimport\s*['"](\/js\/[^'"]*)['"]/g;
const CUSTOM_MARKER_RE = /\/\*\s*CUSTOM\s*:/gi;
const INLINE_SVG_RE = /<svg\b/gi;
const MAX_WIDTH_RE = /@media[^{]*max-width/gi;
const SELECTOR_CLASS_RE = /\.([A-Za-z0-9_-]+)/g;

// The simulated device frame may use raw geometry values - it models hardware,
// not a DS component. Only these literal class families are exempt.
const CHROME_EXACT = new Set(['proto-frame', 'proto-screen', 'proto-notch', 'proto-home', 'proto-stage']);
const CHROME_PREFIXES = ['proto-mac-', 'proto-web-', 'proto-viewport-', 'proto-cq-', 'pnz-'];

// A custom element whose name contains one of these probably mirrors a catalog
// component and should not have been custom in the first place.
const COMPONENT_HINTS = {
  btn: 'button', button: 'button', card: 'card', badge: 'badge', callout: 'callout',
  input: 'input', tab: 'tabs', modal: 'modal', select: 'dropdown', dropdown: 'dropdown',
  toast: 'toast', tooltip: 'tooltip', accordion: 'accordion', checkbox: 'checkbox',
  divider: 'divider', empty: 'empty-state', progress: 'progress-bar', avatar: 'avatar',
  link: 'link', segment: 'segmented-controls',
};

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function loadTokens(root) {
  const tokens = new Set();
  let found = false;
  for (const rel of TOKEN_FILES) {
    const text = readSafe(path.join(root, rel));
    if (text === null) continue;
    found = true;
    let m;
    TOKEN_DEF_RE.lastIndex = 0;
    while ((m = TOKEN_DEF_RE.exec(text)) !== null) tokens.add(m[2]);
  }
  if (!found) throw new Error('no token file found under ' + root + '/css/');
  return tokens;
}

function loadSlugs(root, rel) {
  const text = readSafe(path.join(root, rel));
  if (text === null) return null; // catalog part absent - skip that check
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  const slugs = new Set();
  // Icon manifest: {icons: [{slug, file}]}; mascot manifest: {poses: [{file}]},
  // whose slug is the file name without .svg.
  for (const v of (data && Array.isArray(data.icons)) ? data.icons : []) {
    if (v && typeof v.slug === 'string') slugs.add(v.slug);
  }
  for (const v of (data && Array.isArray(data.poses)) ? data.poses : []) {
    if (v && typeof v.file === 'string') slugs.add(v.file.replace(/\.svg$/i, ''));
  }
  return slugs;
}

/** Split CSS into (selector, body, bodyStart) triples. Never throws on bad CSS. */
function cssBlocks(css) {
  const out = [];
  let pos = 0;
  while (pos < css.length) {
    const close = css.indexOf('}', pos);
    const chunk = close === -1 ? css.slice(pos) : css.slice(pos, close);
    const brace = chunk.indexOf('{');
    if (brace !== -1) {
      out.push({ selector: chunk.slice(0, brace).trim(), body: chunk.slice(brace + 1), start: pos + brace + 1 });
    }
    if (close === -1) break;
    pos = close + 1;
  }
  return out;
}

function isDeviceChrome(selector) {
  let m;
  SELECTOR_CLASS_RE.lastIndex = 0;
  while ((m = SELECTOR_CLASS_RE.exec(selector)) !== null) {
    const cls = m[1];
    if (CHROME_EXACT.has(cls)) return true;
    if (CHROME_PREFIXES.some((p) => cls.startsWith(p))) return true;
  }
  return false;
}

function hintFor(name) {
  const segs = String(name).toLowerCase().split(/[-_\s]+/);
  for (const s of segs) if (COMPONENT_HINTS[s]) return COMPONENT_HINTS[s];
  return null;
}

function reactTokens(root) {
  // The build shell carries its own tokens.css and receives the app tokens
  // (server.js _protoCopyAppTokens) - exactly what a prototype can resolve.
  const files = [
    path.join(root, 'templates/prototype-build-shell/src/tokens.css'),
    ...TOKEN_FILES.map((f) => path.join(root, f)),
  ];
  const tokens = new Set();
  for (const file of files) {
    const text = readSafe(file);
    if (text === null) continue;
    for (const m of text.matchAll(new RegExp(TOKEN_DEF_RE.source, 'gi'))) tokens.add(m[2]);
  }
  return tokens;
}

// Top-level component declarations (PascalCase, the React naming rule), as
// [{name, start, end}] where a range ends where the next declaration starts.
// An offset heuristic ported from sf-test's _component_ranges, not scope
// tracking - but good enough to say "this <button> is written inside
// RowMenu". Runs on comment-stripped source so a commented-out function does
// not open a range.
const COMPONENT_DECL_RE = /^[ \t]*(?:export\s+(?:default\s+)?)?(?:function\s+([A-Z][A-Za-z0-9_]*)\s*(?:<[^>\n]*>)?\s*\(|const\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=\n]+)?=\s*(?:\([^)\n]*\)|[A-Za-z0-9_]+)\s*(?::[^=\n]+)?(?:=>|\{))/gm;

function componentRanges(source) {
  const starts = [];
  for (const m of source.matchAll(COMPONENT_DECL_RE)) starts.push({ name: m[1] || m[2], start: m.index });
  return starts.map((s, i) => ({ name: s.name, start: s.start, end: i + 1 < starts.length ? starts[i + 1].start : source.length }));
}

function ownerAt(ranges, offset) {
  for (const r of ranges) if (r.start <= offset && offset < r.end) return r.name;
  return null;
}

// The names a raw control may live inside: the leading identifier of every
// customElements[].name ('pnz-filter / pnz-filter--active' -> 'pnz-filter')
// plus every owns[] helper. owns[] names are functions, never CSS classes, so
// they feed this scope only and never the marker/stale-registration checks.
function registeredComponentNames(specText) {
  const names = new Set();
  let spec = null;
  try { spec = JSON.parse(specText); } catch { return names; }
  const entries = spec && Array.isArray(spec.customElements) ? spec.customElements : [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const m = /^[A-Za-z0-9_-]+/.exec(String(e.name || '').trim());
    if (m) names.add(m[0]);
    for (const o of Array.isArray(e.owns) ? e.owns : []) if (typeof o === 'string' && o) names.add(o);
  }
  return names;
}

// CSS rules as {selector, body, selIndex, bodyIndex}, one per innermost rule:
// `@media (...) { .a { ... } }` yields `.a`, never the at-rule. Comments are
// blanked with their length kept, so every index maps to the original text.
function cssLeafRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  let pos = 0;
  while (pos < clean.length) {
    const close = clean.indexOf('}', pos);
    const chunk = close === -1 ? clean.slice(pos) : clean.slice(pos, close);
    const b = chunk.lastIndexOf('{');
    if (b !== -1) {
      const from = Math.max(chunk.lastIndexOf('{', b - 1), chunk.lastIndexOf(';', b - 1)) + 1;
      const raw = chunk.slice(from, b);
      const selector = raw.trim();
      if (selector && !selector.startsWith('@')) {
        out.push({ selector, body: chunk.slice(b + 1), selIndex: pos + from + (raw.length - raw.trimStart().length), bodyIndex: pos + b + 1 });
      }
    }
    if (close === -1) break;
    pos = close + 1;
  }
  return out;
}

const SVG_SUBJECT_RE = /(?:^|[\s>+~])svg(?![\w-])/;
const PAINT_DECL_RE = /(?:^|[;{\s])(color|fill|stroke)\s*:/i;
const OUTLINE_NONE_RE = /(?:^|[;{\s])outline\s*:\s*(?:none|0)\s*(?:!important\s*)?(?:;|$)/i;
const FOCUS_RING_RE = /(?:^|[;{\s])(?:box-shadow\s*:\s*(?!none)|background(?:-color)?\s*:|outline\s*:\s*(?!none|0\s*[;!]|0\s*$)|outline-(?:color|style|width)\s*:|border(?:-color)?\s*:)/i;
const HASHED_CLASS_RE = /\._[A-Za-z][A-Za-z0-9]*_[0-9a-f]{5}_/;

function selectorParts(selector) {
  return selector.split(',').map((p) => p.trim()).filter(Boolean);
}

function lastClass(part) {
  const all = [...part.replace(/:[\w-]+(?:\([^)]*\))?/g, '').matchAll(/\.([A-Za-z0-9_-]+)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

// Deterministic halves of the guardian's review (audit R-22), WARN only:
//   dsicon-svg-paint  a rule whose subject is `svg` sets color/fill/stroke.
//                     DSIcon paints through a currentColor mask, so the rule
//                     is dead; set `color` on the element that holds the icon.
//   outline-none      `outline: none` with no focus ring replacing it, in the
//                     same rule or in a :focus rule for the same class. The
//                     runtime draws focus centrally; removing it hides focus.
//   hashed-class      a selector on a CSS-module class (`._tab_149a3_1`),
//                     which changes on every build of the DS package.
function checkReactCss(rep, rel, css) {
  const file = rel + '/styles.css';
  const rules = cssLeafRules(css);
  const focusRules = rules.filter((r) => /:focus/.test(r.selector) && FOCUS_RING_RE.test(r.body));
  for (const r of rules) {
    const parts = selectorParts(r.selector);
    const sel = r.selector.replace(/\s+/g, ' ').slice(0, 80);
    if (!isDeviceChrome(r.selector) && PAINT_DECL_RE.test(r.body)
      && parts.some((p) => SVG_SUBJECT_RE.test(p.replace(/:(?:has|not|is|where)\([^)]*\)/g, '')))) {
      rep.warn({ rule: 'dsicon-svg-paint', file, line: lineOf(css, r.selIndex), message: 'rule on `svg` sets color/fill/stroke in `' + sel + '`', fix: 'DSIcon renders a currentColor mask: set `color` on the element that contains the icon' });
    }
    const off = OUTLINE_NONE_RE.exec(r.body);
    if (off) {
      const replacedHere = /:focus/.test(r.selector) && FOCUS_RING_RE.test(r.body);
      const replacedElsewhere = parts.some((p) => {
        const cls = lastClass(p);
        return cls && focusRules.some((f) => f !== r && selectorParts(f.selector).some((fp) => lastClass(fp) === cls));
      });
      if (!replacedHere && !replacedElsewhere) {
        rep.warn({ rule: 'outline-none', file, line: lineOf(css, r.bodyIndex + off.index), message: '`outline: none` without a focus replacement in `' + sel + '`', fix: 'keep the central focus ring, or draw one in a :focus-visible rule for the same element' });
      }
    }
    if (HASHED_CLASS_RE.test(r.selector)) {
      rep.warn({ rule: 'hashed-class', file, line: lineOf(css, r.selIndex), message: 'selector targets a hashed CSS-module class in `' + sel + '`', fix: 'target the element structure under your own wrapper class (e.g. `.x button[role="tab"]`)' });
    }
  }
}

function checkReact(rep, rel, js, css, dir, icons) {
  const source = stripComments(js);
  // A finding with no source site (a missing export, an unimplemented
  // scenario) carries no line: --baseline fingerprints it on its message, and
  // a fake `line 1` would tie it to whatever the first line says.
  const block = (rule, message, fix, index) => rep.block({
    rule, file: rel + '/index.tsx', line: index === undefined ? null : lineOf(js, index), message, fix,
  });
  if (!/\bexport\s+default\b/.test(source)) block('react-contract', 'missing default React export', 'export the prototype component');
  if (!/\bexport\s+const\s+breakpoints(?:\s*:[^=]+)?\s*=\s*\[[^\]]+\]/.test(source)) {
    block('react-contract', 'missing literal breakpoints export', 'declare the preset widths actually built');
  }
  if (!/\bexport\s+(?:const\s+demoStates\b|\{[^}]*\bdemoStates\b)/.test(source)) {
    block('demo-states', 'missing demoStates export', 'export the reviewable scenarios');
  }
  if (!/\buseDemoState\s*\(/.test(source)) block('demo-states', 'demo states are not connected to useDemoState', 'read the shared viewer state channel');
  const states = /\b(?:const|let)\s+demoStates(?:\s*:[^=]+)?\s*=\s*\[([\s\S]*?)\]\s*;?/.exec(source);
  if (states) {
    const ids = [...states[1].matchAll(/\bid\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const outside = source.slice(0, states.index) + source.slice(states.index + states[0].length);
    if (!ids.length || new Set(ids).size !== ids.length) block('demo-states', 'empty or duplicate demo-state ids', 'declare unique scenario ids');
    for (const id of ids) {
      if (!/^[a-z0-9-]+$/.test(id)) block('demo-states', 'invalid demo-state id: ' + id, 'use ASCII kebab-case ids');
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`['"]${escaped}['"]`).test(outside)) {
        block('demo-states', 'scenario has no implementation reference: ' + id, 'implement the scenario outside its metadata declaration');
      }
    }
  } else {
    rep.warn({ rule: 'demo-states-review', file: rel + '/index.tsx', message: 'computed demoStates require semantic verification', fix: 'verify every exported state against its actual screen' });
  }
  // One allowlist for this gate and for the server's build validator
  // (_protoValidateTsx): scripts/_proto-imports.js.
  for (const { spec, index } of disallowedProtoImports(js)) {
    block('react-import', 'unsupported prototype import: ' + spec, 'use ../../ds, ../../components, ../_shared, copied data/assets or a package listed in scripts/_proto-imports.js', index);
  }
  for (const file of fs.readdirSync(dir)) {
    if (file !== 'index.tsx' && /\.(?:tsx?|jsx?)$/.test(file)) {
      rep.block({ rule: 'sibling-source', file: rel + '/' + file, message: 'the pipeline does not copy sibling source modules', fix: 'keep implementation in index.tsx; shared changes need a separate plan' });
    }
  }
  // A raw control inside the body of a custom element the guardian already
  // confirmed (spec.json customElements[].name, or one of its owns[] helper
  // functions) is that element's own markup - a NOTE, as in sf-test's
  // ds-component-scoped. Anywhere else it stays a BLOCK: this gate is
  // deliberately stricter than sf-test's WARN for everything unregistered.
  const registered = registeredComponentNames(readSafe(path.join(dir, 'spec.json')));
  const ranges = componentRanges(source);
  for (const m of source.matchAll(/<(button|input|select|textarea|table)\b/g)) {
    const owner = ownerAt(ranges, m.index);
    if (owner && registered.has(owner)) {
      rep.note({ rule: 'raw-control-scoped', file: rel + '/index.tsx', line: lineOf(js, m.index), message: 'raw ' + m[1] + ' inside the registered custom element ' + owner, fix: null });
      continue;
    }
    block('raw-control', 'raw ' + m[1] + ' bypasses the DS adapter', 'use the corresponding component from ../../ds', m.index);
  }
  // A DS field adapter draws its own frame - border, radius, background and
  // a fixed height (48px in the DS Input). A wrapper that ALSO declares a
  // frame is the fingerprint of a half-finished migration: the raw <input>
  // was swapped for the adapter and its hand-built field box stayed in
  // styles.css, so the real field renders inside a facsimile of itself
  // (double outline, 48px overflowing a 40px box). Only the shorthand
  // `border`, `border-radius` and `height` count - a sticky search row with
  // a background or a bottom divider is layout, not a frame.
  if (css) {
    const blocksByClass = new Map();
    for (const b of cssBlocks(css)) {
      // cssBlocks keeps a comment that precedes the selector inside it.
      const m = /^\.([A-Za-z_][\w-]*)$/.exec(b.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim());
      if (m) blocksByClass.set(m[1], b);
    }
    for (const m of source.matchAll(/<(?:div|span|label)\b[^>]*\bclassName\s*=\s*["']([^"']+)["'][^>]*>\s*<DS(?:SearchInput|Input|Select|Textarea|Datepicker|RangePicker)\b/g)) {
      for (const cls of m[1].split(/\s+/).filter(Boolean)) {
        const b = blocksByClass.get(cls);
        if (b && /(?:^|[\s;{])(?:border|border-radius|height)\s*:/.test(b.body)) {
          block('adapter-frame', 'wrapper `.' + cls + '` draws a field frame around a DS adapter', 'the adapter renders its own border, radius and height - keep only layout (margin, padding, width) on the wrapper', m.index);
        }
      }
    }
  }
  for (const m of source.matchAll(/<DSIcon\b[^>]*\bname\s*=\s*['"]([^'"]+)['"]/g)) {
    if (icons && !icons.has(m[1])) block('unknown-icon', 'unknown icon slug `' + m[1] + '`', 'use a verified catalog slug', m.index);
  }
  for (const m of source.matchAll(/style\s*=\s*\{\{([\s\S]*?)\}\}/g)) {
    if (new RegExp(HEX_RE.source).test(m[1]) || /\b(?:rgb|rgba|hsl|hsla)\s*\(/i.test(m[1])) {
      block('hardcoded-color', 'literal colour in a React inline style', 'use a production DS token', m.index);
    }
  }
  if (css) checkReactCss(rep, rel, css);
  // One finding per query, with its line, so --baseline can tell an existing
  // @media from a new one. Comments are blanked first (length kept): a
  // comment explaining why a query exists is not a query.
  if (css) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of clean.matchAll(/@media[^{]*(?:min|max)-width/gi)) {
      rep.block({ rule: 'container-query', file: rel + '/styles.css', line: lineOf(css, m.index), message: 'viewport-width query in a React prototype', fix: 'use @container proto (min-width: ...)' });
    }
  }
}

function run(dirArg, options = {}) {
  const root = R.ROOT;
  const dir = path.isAbsolute(dirArg) ? dirArg : path.join(root, dirArg);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    R.usageError('not a directory: ' + dirArg);
  }
  const rel = path.relative(root, dir) || dirArg;
  const rep = new R.Report('check-proto-ds', { prototype: rel });

  const react = fs.existsSync(path.join(dir, 'index.tsx'));
  let tokens;
  try { tokens = react ? reactTokens(root) : loadTokens(root); } catch (e) { R.usageError(e.message); }
  const icons = loadSlugs(root, ICONS_JSON);
  const illus = loadSlugs(root, ILLUS_JSON);

  const cssPath = path.join(dir, 'styles.css');
  const jsLabel = react ? 'index.tsx' : 'render.js';
  const jsPath = path.join(dir, jsLabel);
  const htmlPath = path.join(dir, 'index.html');
  const specPath = path.join(dir, 'spec.json');

  const css = readSafe(cssPath);
  const js = readSafe(jsPath);
  const html = readSafe(htmlPath);

  const required = [[cssPath, 'styles.css'], [jsPath, jsLabel], [specPath, 'spec.json']];
  if (!react) required.push([htmlPath, 'index.html']);
  for (const [p, label] of required) {
    if (readSafe(p) === null) {
      rep.block({ rule: 'missing-file', file: rel + '/' + label, message: 'prototype contract file is missing', fix: react ? 'React requires index.tsx + styles.css + spec.json' : 'legacy requires index.html + render.js + styles.css + spec.json' });
    }
  }

  // Tokens defined by the prototype itself count as known (they are built from DS tokens).
  const localTokens = new Set();
  if (css) {
    let m;
    TOKEN_DEF_RE.lastIndex = 0;
    while ((m = TOKEN_DEF_RE.exec(css)) !== null) localTokens.add(m[2]);
  }

  // -- hardcoded colours (styles.css, outside device chrome) ----------------
  if (css) {
    for (const b of cssBlocks(css)) {
      if (!react && isDeviceChrome(b.selector)) continue;
      const sel = b.selector.replace(/\s+/g, ' ').slice(0, 80) || '(top-level)';
      let m;
      HEX_RE.lastIndex = 0;
      while ((m = HEX_RE.exec(b.body)) !== null) {
        rep.block({ rule: 'hardcoded-color', file: rel + '/styles.css', line: lineOf(css, b.start + m.index), message: 'hardcoded colour `' + m[0] + '` in `' + sel + '`', fix: 'use a token from css/ds-tokens.css' });
      }
      FUNC_COLOR_RE.lastIndex = 0;
      while ((m = FUNC_COLOR_RE.exec(b.body)) !== null) {
        rep.block({ rule: 'hardcoded-color', file: rel + '/styles.css', line: lineOf(css, b.start + m.index), message: 'hardcoded colour `' + m[0] + ')` in `' + sel + '`', fix: 'use a token from css/ds-tokens.css' });
      }
    }
    MAX_WIDTH_RE.lastIndex = 0;
    let mw;
    while ((mw = MAX_WIDTH_RE.exec(css)) !== null) {
      rep.warn({ rule: 'max-width-media', file: rel + '/styles.css', line: lineOf(css, mw.index), message: 'max-width media query', fix: 'prototypes are mobile-first: mobile is the base, wider tiers are additive `min-width` blocks' });
    }
  }

  // -- unknown var() references ---------------------------------------------
  for (const [text, label] of [[css, 'styles.css'], [js, jsLabel], [html, 'index.html']]) {
    if (!text) continue;
    let m;
    VAR_REF_RE.lastIndex = 0;
    while ((m = VAR_REF_RE.exec(text)) !== null) {
      const name = m[1];
      if ((!react || !name.startsWith('--fds-')) && (tokens.has(name) || localTokens.has(name))) continue;
      rep.block({ rule: 'unknown-token', file: rel + '/' + label, line: lineOf(text, m.index), message: 'unknown token `' + name + '`', fix: react ? 'use a token defined in templates/prototype-build-shell/src/tokens.css or css/ds-tokens.css' : 'use a token defined in css/ds-tokens.css, css/ds-tokens-dark.css or css/ds.css' });
    }
  }

  // -- unknown icon / illustration slugs ------------------------------------
  const refChecks = [
    [icons, ICON_REF_RE, 'unknown-icon', 'icon', 'assets/icons/ds/manifest.json'],
    [illus, ILLUS_REF_RE, 'unknown-illustration', 'illustration', 'assets/mascot/manifest.json'],
  ];
  for (const [set, re, rule, word, source] of refChecks) {
    if (!set) continue;
    for (const [text, label] of [[css, 'styles.css'], [js, jsLabel], [html, 'index.html']]) {
      if (!text) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        if (set.has(m[1])) continue;
        rep.block({ rule, file: rel + '/' + label, line: lineOf(text, m.index), message: 'unknown ' + word + ' slug `' + m[1] + '`', fix: 'pick a slug listed in ' + source });
      }
    }
  }

  // -- render.js must be self-contained -------------------------------------
  if (react && js) checkReact(rep, rel, js, css, dir, icons, options);
  if (js) {
    let m;
    JS_IMPORT_RE.lastIndex = 0;
    while ((m = JS_IMPORT_RE.exec(js)) !== null) {
      rep.block({ rule: 'js-import', file: rel + '/' + jsLabel, line: lineOf(js, m.index), message: 'import from the host bundle `' + (m[1] || m[2]) + '`', fix: 'use the prototype contract, never host helpers' });
    }
    INLINE_SVG_RE.lastIndex = 0;
    while ((m = INLINE_SVG_RE.exec(js)) !== null) {
      rep.warn({ rule: 'inline-svg', file: rel + '/' + jsLabel, line: lineOf(js, m.index), message: 'inline <svg>', fix: 'use DSIcon or the catalog route' });
    }
  }

  // -- custom element registry ----------------------------------------------
  const specText = readSafe(specPath);
  let spec = null;
  if (specText !== null) {
    try { spec = JSON.parse(specText); } catch {
      rep.block({ rule: 'registry-mismatch', file: rel + '/spec.json', message: 'spec.json is not valid JSON', fix: 'fix the JSON - it is the scope source of truth' });
    }
  }
  if (react && specText !== null && (!spec || typeof spec !== 'object' || Array.isArray(spec) || !Array.isArray(spec.customElements))) {
    rep.block({ rule: 'registry-mismatch', file: rel + '/spec.json', message: 'React spec must be an object with a customElements array', fix: 'keep the complete starter spec contract' });
  }
  if (spec) {
    const entries = Array.isArray(spec.customElements) ? spec.customElements : [];
    const markerNames = css ? [...css.matchAll(/\/\*\s*CUSTOM\s*:\s*([a-zA-Z0-9_-]+)/g)].map((m) => m[1]) : [];
    const markerCount = css ? (css.match(CUSTOM_MARKER_RE) || []).length : 0;
    if (markerCount !== entries.length) {
      rep.block({ rule: 'registry-mismatch', file: rel + '/spec.json', message: 'spec.json lists ' + entries.length + ' custom element(s) but styles.css carries ' + markerCount + ' `/* CUSTOM: */` marker(s)', fix: 'every custom element is both registered in spec.json and marked in styles.css' });
    }
    // The CUSTOM marker itself names the element, so it is stripped before the
    // search: a marker without a matching selector is exactly what "stale" means.
    const cssWithoutMarkers = css ? css.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '') : '';
    for (const e of entries) {
      const name = String((e && e.name) || '').trim().split(/[\s(/]/)[0];
      if (!name || (react && !markerNames.includes(name))) {
        rep.block({ rule: 'registry-mismatch', file: rel + '/spec.json', message: 'custom registration has no matching named CSS marker', fix: 'use the same non-empty name in customElements and CUSTOM marker' });
        continue;
      }
      const mentioned = cssWithoutMarkers.includes(name) || (js && js.includes(name));
      if (!mentioned) {
        rep.block({ rule: 'stale-registration', file: rel + '/spec.json', message: 'customElements[] entry `' + name + '` appears in neither styles.css nor ' + jsLabel, fix: 'remove the stale entry or add the element' });
      }
      if (!e || e.lead_confirmed !== true || !e.reason) {
        const finding = { rule: 'suspect-registration', file: rel + '/spec.json', message: 'customElements[] entry `' + name + '` is missing `reason` or `lead_confirmed: true`', fix: 'the proto-ds-guardian confirms a custom element; record why the catalog does not cover it' };
        if (react) rep.block(finding); else rep.warn(finding);
      }
      const hint = hintFor(name);
      if (hint) {
        rep.warn({ rule: 'suspect-registration', file: rel + '/spec.json', message: 'custom element `' + name + '` looks like the catalog component `' + hint + '`', fix: 'use the DS ' + hint + ' (css/ds.css, Design > Design System) instead of building a custom element' });
      }
    }
  }

  const texts = { 'styles.css': css, [jsLabel]: js, 'index.html': html, 'spec.json': specText };
  stampFingerprints(rep, rel, texts);
  if (options.baseline) applyBaseline(rep, options.baseline, options.baselineFile || null);
  return rep;
}

// -- fingerprints and --baseline ----------------------------------------------
//
// An iteration of an EXISTING prototype must not have to migrate the whole
// file before anything passes (audit R-12). `--baseline <file>` takes the
// `--json` output of this linter from before the change and blocks only the
// findings that are NEW relative to it; the ones already there are reported
// as NOTE `baseline`. Without the flag nothing changes - a new prototype
// faces the full strictness.
//
// A finding's identity must survive an edit ABOVE it, which moves every line
// below, so the fingerprint never contains a line number: it is rule + file
// (relative to the prototype directory, so a relocated data dir still
// matches) + message + the whitespace-normalised text of the source line the
// finding points at (empty for a finding with no source site). Matching is a
// multiset: 61 identical raw <button> lines in the baseline excuse 61, not 62.
// A baseline written before fingerprints existed has no `fingerprint` field;
// its entries match on rule + file + message, which carries no line either.


function protoRelFile(file, prototypeRel) {
  const f = String(file || '');
  if (prototypeRel && f.startsWith(prototypeRel + '/')) return f.slice(prototypeRel.length + 1);
  return f.includes('/') ? f.slice(f.lastIndexOf('/') + 1) : f;
}

function normaliseSnippet(line) {
  return String(line || '').replace(/\s+/g, ' ').trim();
}

function legacyKey(rule, file, message) {
  return [rule || '', file, message || ''].join('\u0000');
}

function fingerprintOf(rule, file, message, snippet) {
  return crypto.createHash('sha1').update([rule || '', file, message || '', snippet].join('\u0000')).digest('hex').slice(0, 16);
}

function stampFingerprints(rep, prototypeRel, texts) {
  const lines = {};
  for (const [label, text] of Object.entries(texts)) if (typeof text === 'string') lines[label] = text.split('\n');
  for (const f of rep.findings) {
    const file = protoRelFile(f.file, prototypeRel);
    const src = f.line && lines[file] ? lines[file][f.line - 1] : '';
    f.snippet = normaliseSnippet(src).slice(0, 200);
    f.fingerprint = fingerprintOf(f.rule, file, f.message, f.snippet);
  }
}

/**
 * Downgrade every finding already present in `baseline` (a parsed --json
 * envelope of this linter) to NOTE `baseline`. Mutates `rep`.
 * @returns {{matched: number, newBlock: number, newWarn: number}}
 */
function applyBaseline(rep, baseline, baselineFile) {
  const list = baseline && Array.isArray(baseline.findings) ? baseline.findings : null;
  if (!list) throw new Error('baseline has no findings[] array - pass the --json output of check-proto-ds');
  const baseRel = typeof baseline.prototype === 'string' ? baseline.prototype : null;
  const byFp = new Map();
  const byLegacy = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  let legacyEntries = 0;
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.fingerprint === 'string' && b.fingerprint) { bump(byFp, b.fingerprint); continue; }
    const rule = b.rule === 'baseline' && b.baselineRule ? b.baselineRule : b.rule;
    const message = b.rule === 'baseline' && typeof b.baselineMessage === 'string' ? b.baselineMessage : b.message;
    const key = legacyKey(rule, protoRelFile(b.file, baseRel), message);
    legacyEntries++;
    // The old container-query rule was a whole-file verdict with no line
    // ("this file has viewport queries", once), so that one entry excuses
    // every occurrence the per-line rule now reports for the file. Every
    // other rule keeps its count.
    if (rule === 'container-query' && (b.line === null || b.line === undefined)) byLegacy.set(key, Infinity);
    else bump(byLegacy, key);
  }
  if (legacyEntries) {
    rep.info('baseline: ' + legacyEntries + ' entr(y/ies) carry no fingerprint (written by an older linter) and match on rule + file + message only - regenerate the baseline with --json before the next edit');
  }
  const take = (map, key) => {
    const n = map.get(key) || 0;
    if (n <= 0) return false;
    map.set(key, n - 1);
    return true;
  };
  const stats = { matched: 0, newBlock: 0, newWarn: 0 };
  const protoRel = rep.meta.prototype;
  for (const f of rep.findings) {
    if (f.severity === R.SEV.NOTE) continue;
    const known = take(byFp, f.fingerprint) || take(byLegacy, legacyKey(f.rule, protoRelFile(f.file, protoRel), f.message));
    if (!known) {
      if (f.severity === R.SEV.BLOCK) stats.newBlock++; else stats.newWarn++;
      continue;
    }
    stats.matched++;
    f.baselineRule = f.rule;
    f.baselineSeverity = f.severity;
    f.baselineMessage = f.message;
    f.severity = R.SEV.NOTE;
    f.rule = 'baseline';
    f.message = '[' + f.baselineRule + '] ' + f.message + ' (already in the baseline)';
  }
  rep.meta.baseline = Object.assign({ file: baselineFile }, stats);
  rep.info('baseline: ' + stats.matched + ' known finding(s) reported as NOTE, ' + stats.newBlock + ' new BLOCK, ' + stats.newWarn + ' new WARN');
  return stats;
}

function readBaseline(file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  const text = readSafe(abs);
  if (text === null) R.usageError('cannot read baseline file: ' + file);
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { R.usageError('baseline is not valid JSON: ' + file + ' (' + e.message + ')'); }
  if (!parsed || !Array.isArray(parsed.findings)) R.usageError('baseline has no findings[] array - pass the --json output of check-proto-ds: ' + file);
  return parsed;
}

function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2));
  if (flags.help || positionals.length === 0) R.showHelp(HELP);
  if (flags.baseline === true) R.usageError('--baseline needs a file (the --json output of this linter from before the change)');
  const options = {};
  if (typeof flags.baseline === 'string') {
    options.baseline = readBaseline(flags.baseline);
    options.baselineFile = flags.baseline;
    // A baseline of ANOTHER prototype would excuse findings it never saw.
    const baseProto = typeof options.baseline.prototype === 'string' ? path.basename(options.baseline.prototype) : null;
    if (baseProto && baseProto !== path.basename(path.resolve(positionals[0]))) {
      R.usageError('baseline ' + flags.baseline + ' was taken for ' + baseProto + ', not for ' + path.basename(path.resolve(positionals[0])));
    }
  }
  const rep = run(positionals[0], options);
  rep.emit(flags, 'PROTO-DS');
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('check-proto-ds internal error: ' + ((e && e.stack) || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { run, cssBlocks, cssLeafRules, isDeviceChrome, hintFor, componentRanges, registeredComponentNames, applyBaseline, fingerprintOf };
}
