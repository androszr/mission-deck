#!/usr/bin/env node
'use strict';
// scripts/check-conventions.js
// The mechanical half of the cockpit-guardian agent, run over a diff.
// Emits BLOCK / WARN / NOTE findings plus a VERDICT in the exact shape the
// guardian returns today, so /new-idea and /pre-ship-audit can consume either.
//
//   node scripts/check-conventions.js --base main
//   node scripts/check-conventions.js --files index.html,js/foo.js --json
//   node scripts/check-conventions.js --diff-file /tmp/change.diff
//
// Exit: 0 clean or warnings only, 1 at least one BLOCK, 2 usage error.
//
// What is deliberately NOT here (it needs judgment - spawn the guardian):
//   "is this <div> a hand-rolled ds-card", "does this async handler need one
//   outer try/finally", "is this DS component the right one".

const fs = require('fs');
const path = require('path');
const R = require('./_report');
const CS = require('./_core-scope');

const HELP = `
check-conventions.js - deterministic cockpit conventions check over a diff

Usage:
  node scripts/check-conventions.js [--base <ref>] [--staged] [--files a,b]
                                    [--diff-file <path>] [--modules]
                                    [--root <dir>] [--json]

Scope resolution (first match wins):
  --modules    every installed module under modules/ - whole content checked
  --diff-file  a unified diff on disk
  --files      comma-separated paths, whole content treated as added
  --staged     git diff --staged
  --base <ref> git diff <ref>...HEAD plus the working tree
  (fallback)   git diff HEAD, else "no-baseline" with a NOTE

modules/ is gitignored, so a module never appears in any diff and the default
scopes cannot see it. --modules is the way to hold module code to the same
conventions as the core: ASCII identifiers with English copy in the strings, DS
classes, tokens instead of hex, jsonResponse for every JSON answer.

Core ownership (rule core-scope): in a --staged / --base / working-tree scope,
a changed file outside modules/ is a BLOCK unless this machine opted in with a
.core-dev marker file or COCKPIT_CORE_DEV=1. See scripts/_core-scope.js.

Six WARN rules over js/**, index.html and a module's client/ hold the button
hierarchy and the modal contract (conventions section 2a/2b) to the same
mechanical check as the DS classes above - all WARN, never BLOCK, because the
right read needs a human, same as ds-tabs-variant:
  btn-primary-per-view      more than one big ds-btn--primary on one file
  btn-header-size           ds-btn--sm inside the page-header-actions slot
  modal-a11y                ds-modal-overlay with no js/ds-modal.js and no role
  window-confirm-in-module  raw confirm(...) in a module instead of confirmDsModal
  icon-btn-aria             icon-only <button> with no aria-label
  md-non-english            non-English prose in a .md people read (WARN)
  ui-non-english            non-English UI string (toast, label, placeholder) (WARN)
  ds-callout-stack          several direct children in a ds-callout (a flex row)
  clickable-non-control     cursor: pointer under a selector naming no control (CSS)
  flex-wrap-tiles           flex-wrap: wrap on a tile/stat/metric/panel row (CSS)
  flex-on-table-cell        display:flex/grid on a <td>/<th> (drops it from the row) (CSS)
  tabs-aria-half            role="tab" with no tabpanel / aria-controls in the change
  spawn-env-spread          ...process.env handed to a child process (server code)
  detached-on-win32         detached: true with no win32 guard (opens console windows on Windows)
  app-fetch-refspec         git fetch by URL into the app repo with no refspec (freezes origin/main)
  proto-shell-autostash     --autostash on the prototype build shell (_protoGitExec) - conflicts exit 0
  autostash-unmerged-gate   --autostash with no unmerged-path check right after it - exit 0 is not success
  stdio-inherit-in-process  stdio: 'inherit' in server-process code (drops windowsHide on Windows)
  module-data-undeclared    module client/server code reaches team data, module.json declares no dataRepos (WARN)
  module-data-repo-unknown  module.json dataRepos[].name is not a data repo route id (WARN)

Exit codes: 0 clean/warn, 1 blocking findings, 2 usage or internal error.
`;

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.css', '.json']);

function isCode(p) { return CODE_EXT.has(path.extname(p).toLowerCase()); }

/** A module's client code - the surface that renders DS markup. */
const MODULE_CLIENT_RE = /^modules\/[^/]+\/client\//;
/** Any file belonging to an installed module. */
const MODULE_ANY_RE = /^modules\/[^/]+\//;

/**
 * Every code file under modules/<id>/, as repo-relative paths. modules/ is
 * gitignored, so these files reach no diff and no commit hook - this walk is
 * the only way the conventions check can see them.
 * @param {string} root
 * @returns {string[]}
 */
function listModuleFiles(root) {
  const out = [];
  const base = path.join(root, 'modules');
  const walk = (abs, rel) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_e) { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const childAbs = path.join(abs, e.name);
      const childRel = rel + '/' + e.name;
      if (e.isDirectory()) walk(childAbs, childRel);
      else if (isCode(childRel)) out.push(childRel.replace(/^\//, ''));
    }
  };
  walk(base, '/modules');
  return out.sort();
}

function readPost(root, rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_e) { return null; }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** R1/R2 - DS classes on buttons, inputs and selects. */
function ruleDsElements(rep, file) {
  // Markup surfaces only. server.js is a .js file but never renders DS markup,
  // and its comments mention <select>/<input> as prose. `templates/` and
  // `.claude/` hold standalone documents (the deck, the kudos page, meeting
  // reports) - self-contained HTML that never loads css/ds.css, so the DS
  // classes have nothing to attach to there.
  if (/^(templates|\.claude|docs)\//.test(file.path)) return;
  if (!/\.html?$/i.test(file.path) && !/^js\//.test(file.path) && !MODULE_CLIENT_RE.test(file.path)) return;
  const added = file.added;
  for (let i = 0; i < added.length; i++) {
    const { line, text } = added[i];
    // Look at the tag plus up to two following added lines (tags wrap).
    let tag = text;
    for (let k = 1; k <= 2 && i + k < added.length; k++) {
      if (added[i + k].line === line + k) tag += ' ' + added[i + k].text; else break;
    }

    if (/<button\b/i.test(text) && !/\bds-[a-z-]*btn\b|\bds-[a-z-]+\b/i.test(tag)) {
      rep.block({
        rule: 'ds-btn', file: file.path, line,
        message: 'a <button> with no DS class',
        fix: 'use `ds-btn ds-btn--primary|secondary|tertiary|danger` (or ds-icon-btn / ds-modal-close)',
      });
    }
    if (/<input\b/i.test(text)
      && !/type\s*=\s*["'](checkbox|radio|hidden|file|range)["']/i.test(tag)
      && !/\bds-[a-z-]+\b/i.test(tag)) {
      rep.block({
        rule: 'ds-input', file: file.path, line,
        message: 'an <input> with no DS class',
        fix: 'use `ds-input` (css/ds.css)',
      });
    }
    if (/<select\b/i.test(text) && !/\bds-[a-z-]+\b/i.test(tag)) {
      rep.warn({
        rule: 'ds-select', file: file.path, line,
        message: 'a bare <select>',
        fix: 'the DS answer for a select is js/ds-select.js, not a raw <select>',
      });
    }
  }
}

/**
 * Column ranges on `line` that sit inside a multi-line template literal.
 * `nonAsciiFindings` reads one line at a time, so the middle of a template
 * literal - where most of the app's UI copy lives - looks like bare
 * code to it. Reading the whole file closes that gap.
 */
function _templateRangesFor(cache, root, filePath, line) {
  if (!/\.(js|mjs|cjs)$/i.test(filePath)) return [];
  if (!cache.has(filePath)) {
    const src = R.readFileSafe(path.join(root, filePath));
    cache.set(filePath, src ? R.templateStringRanges(src) : new Map());
  }
  return cache.get(filePath).get(line) || [];
}

/** R3 - non-ASCII outside string literals / HTML text. */
function ruleAscii(rep, file, root, cache) {
  if (!isCode(file.path) && !/\.(sh|mjs)$/i.test(file.path)) return;
  for (const { line, text } of file.added) {
    let hits = R.nonAsciiFindings(text, file.path);
    if (hits.length === 0) continue;
    const tpl = _templateRangesFor(cache || new Map(), root || R.ROOT, file.path, line);
    if (tpl.length > 0) hits = hits.filter((h) => !tpl.some(([a, b]) => h.col - 1 >= a && h.col - 1 <= b));
    if (hits.length === 0) continue;
    rep.block({
      rule: 'ascii', file: file.path, line,
      message: 'non-ASCII ' + hits[0].code + ' (`' + hits[0].char + '`) outside a string literal (col ' + hits[0].col + ')',
      fix: 'identifiers, comments and log lines are ASCII-only; user-visible copy belongs inside a quoted UI string or an HTML text node',
    });
  }
}

/** R4 - no perspectives. */
function rulePerspectives(rep, file) {
  for (const { line, text } of file.added) {
    const m = /(data-perspective|applyPerspective|_VALID_PERSPECTIVES)/.exec(text);
    if (m) {
      rep.block({
        rule: 'no-perspectives', file: file.path, line,
        message: 'perspective model reference `' + m[1] + '`',
        fix: 'this repo has no perspective model - remove it (conventions section 4)',
      });
    }
  }
}

/** R5 - jsonResponse instead of a raw res.end(JSON.stringify(...)). */
function ruleJsonResponse(rep, file) {
  if (!/\.js$/i.test(file.path)) return;
  for (const { line, text } of file.added) {
    if (/res\.(end|write)\(\s*JSON\.stringify\(/.test(text)) {
      rep.block({
        rule: 'json-response', file: file.path, line,
        message: 'JSON written with `res.' + (/res\.end/.test(text) ? 'end' : 'write') + '(JSON.stringify(...))`',
        fix: 'every JSON response goes through `jsonResponse(res, status, body)` (gzip + ETag)',
      });
    }
  }
}

/** R6 - server section headers and handler placement. */
function ruleServerSections(rep, file, root) {
  if (path.basename(file.path) !== 'server.js') return;
  const newHandlers = file.added.filter((l) => /^\s*(async\s+)?function\s+handle[A-Z]/.test(l.text));
  if (newHandlers.length === 0) return;

  const addedHeader = file.added.some((l) => /^\s*\/\/\s*(─{2,}|-{3,}|—)/.test(l.text) || /^\/\/\s+\S.*\s(─{3,}|-{3,})\s*$/.test(l.text));
  if (newHandlers.length >= 2 && !addedHeader) {
    rep.warn({
      rule: 'server-section', file: file.path, line: newHandlers[0].line,
      message: newHandlers.length + ' new handlers added with no new `// -- Name --` section header',
      fix: 'a new endpoint group gets its own section header (conventions section 6)',
    });
  }

  // A handler defined BELOW the route dispatch ladder was appended at the
  // bottom of the file instead of placed in its section.
  const post = readPost(root, file.path);
  if (!post) return;
  const postLines = post.split('\n');
  const dispatchIdx = postLines.findIndex((t) => /^\/\/\s*.*Route dispatch/.test(t));
  if (dispatchIdx === -1) {
    rep.note({ rule: 'server-section', file: file.path, message: 'no `Route dispatch` section header found - placement check skipped' });
    return;
  }
  for (const h of newHandlers) {
    if (h.line > dispatchIdx + 1) {
      rep.block({
        rule: 'server-section', file: file.path, line: h.line,
        message: 'handler defined below the `Route dispatch` section (appended at the bottom of the file)',
        fix: 'move it into the matching `// -- Name --` section above the dispatch ladder',
      });
    }
  }
}

/** Extract the ids that make up the view triple, from the post-image files. */
function viewTripleState(root) {
  const html = readPost(root, 'index.html') || '';
  const registry = readPost(root, 'js/view-registry.js') || '';
  // The hub PAGES live in js/core-hubs.mjs since hubs became core property;
  // js/sidebar-flyout-config.js is a loop over that file. Both are read and
  // unioned so this rule keeps working either way - an item in the config file
  // is no longer written by hand, but a plan that puts one there is not wrong.
  const flyout = (readPost(root, 'js/core-hubs.mjs') || '')
    + '\n' + (readPost(root, 'js/sidebar-flyout-config.js') || '');
  const sections = new Set();
  let m;
  const secRe = /class="view-section[^"]*"\s+id="view-([a-z0-9-]+)"|id="view-([a-z0-9-]+)"\s+class="view-section/gi;
  while ((m = secRe.exec(html)) !== null) sections.add(m[1] || m[2]);
  const reg = new Set();
  const regBody = /export const VIEW_REGISTRY\s*=\s*\{([\s\S]*?)\n\};/.exec(registry);
  if (regBody) {
    const keyRe = /^\s*'([a-z0-9-]+)'\s*:\s*\{/gm;
    while ((m = keyRe.exec(regBody[1])) !== null) reg.add(m[1]);
  }
  const hub = new Set();
  // A flyout item's view may be a sub-route (`dokumenty/claude-md`). Sub-routes
  // are handled by their parent view - js/app.js _initPlaceholderAreas() skips
  // any item whose view contains a "/" - so they never need a triple.
  const hubRe = /view:\s*'([a-z0-9-]+(?:\/[a-z0-9-]+)*)'/g;
  while ((m = hubRe.exec(flyout)) !== null) hub.add(m[1]);
  return { sections, reg, hub };
}

/**
 * True when `id` is reachable from somewhere other than the registry and the
 * flyout config - a dashboard card, a sidebar item, a data-back-view, app.js.
 * Views like `settings` and `dashboard` are deliberately not flyout items.
 */
function _reachableElsewhere(root, id) {
  const probes = ['index.html'];
  try {
    for (const f of fs.readdirSync(path.join(root, 'js'))) {
      if (f === 'view-registry.js' || f === 'sidebar-flyout-config.js' || f === 'core-hubs.mjs') continue;
      if (f.endsWith('.js')) probes.push('js/' + f);
    }
  } catch (_e) { /* no js dir */ }
  const needles = ['#' + id, '"' + id + '"', "'" + id + "'"];
  for (const rel of probes) {
    const text = readPost(root, rel);
    if (!text) continue;
    // Ignore the view's own section markup.
    const stripped = text.replace(new RegExp('id="view-' + id + '"', 'g'), '');
    if (needles.some((n) => stripped.indexOf(n) !== -1)) return true;
  }
  return false;
}

/**
 * R7 - the view triple, in every direction, calibrated against how this repo
 * actually works:
 *   section + no VIEW_REGISTRY entry -> BLOCK only when js/<id>.js exists
 *     (a static markup-only view needs no module and no entry)
 *   VIEW_REGISTRY entry + no section -> BLOCK unless the id is a hub page
 *     (js/app.js _initPlaceholderAreas generates that section at boot)
 *   hub page + neither               -> WARN (that is a boot placeholder stub)
 *   section/entry + in no hub        -> WARN only when nothing else links it
 */
function ruleViewTriple(rep, files, root, scopeMode) {
  if (scopeMode === 'no-baseline') return;
  const state = viewTripleState(root);
  const byPath = new Map(files.map((f) => [f.path, f]));

  const addedSections = new Set();
  const htmlFile = byPath.get('index.html');
  if (htmlFile) {
    for (const { line, text } of htmlFile.added) {
      const m = /id="view-([a-z0-9-]+)"/.exec(text);
      if (m && /view-section/.test(text)) addedSections.add({ id: m[1], line });
    }
  }
  const addedReg = new Set();
  const regFile = byPath.get('js/view-registry.js');
  if (regFile) {
    for (const { line, text } of regFile.added) {
      const m = /^\s*'([a-z0-9-]+)'\s*:\s*\{/.exec(text);
      if (m) addedReg.add({ id: m[1], line });
    }
  }
  const addedHub = new Set();
  // Either file can carry a new page: the declaration (js/core-hubs.mjs, where
  // scripts/new-view.js writes) or the built map, for a hand edit.
  for (const rel of ['js/core-hubs.mjs', 'js/sidebar-flyout-config.js']) {
    const hubFile = byPath.get(rel);
    if (!hubFile) continue;
    for (const { line, text } of hubFile.added) {
      const m = /view:\s*'([a-z0-9-]+(?:\/[a-z0-9-]+)*)'/.exec(text);
      if (m && m[1].indexOf('/') === -1) addedHub.add({ id: m[1], line, file: rel });
    }
  }

  const tripleFix = (id) => 'the triple is all-or-nothing: #view-' + id
    + ' section (index.html) + VIEW_REGISTRY entry + a `pages` entry on a hub'
    + ' row in js/core-hubs.mjs (node scripts/new-view.js writes all three)';

  const flyoutCheck = (id, line, file) => {
    if (state.hub.has(id)) return;
    if (_reachableElsewhere(root, id)) return;
    rep.warn({
      rule: 'view-triple', file, line,
      message: 'view `' + id + '` is in no hub (js/core-hubs.mjs) and nothing else links it - it is unreachable',
      fix: tripleFix(id),
    });
  };

  for (const { id, line } of addedSections) {
    const hasModule = fs.existsSync(path.join(root, 'js', id + '.js'));
    if (!state.reg.has(id) && hasModule) {
      rep.block({
        rule: 'view-triple', file: 'index.html', line,
        message: 'view `' + id + '` has a module js/' + id + '.js but no VIEW_REGISTRY entry - the module is never imported',
        fix: tripleFix(id),
      });
    } else if (!state.reg.has(id)) {
      rep.note({
        rule: 'view-triple', file: 'index.html', line,
        message: 'view `' + id + '` is static markup only (no js/' + id + '.js, no VIEW_REGISTRY entry)',
      });
    }
    flyoutCheck(id, line, 'index.html');
  }
  for (const { id, line } of addedReg) {
    if (!state.sections.has(id) && !state.hub.has(id)) {
      rep.block({
        rule: 'view-triple', file: 'js/view-registry.js', line,
        message: 'registry entry `' + id + '` has neither a #view-' + id + ' section nor a hub page entry - it renders into nothing',
        fix: tripleFix(id),
      });
      continue;
    }
    flyoutCheck(id, line, 'js/view-registry.js');
  }
  for (const { id, line, file } of addedHub) {
    // A HUB_FLYOUT item with no section is legal: js/app.js
    // _initPlaceholderAreas() generates a placeholder section at boot. That is
    // a stub, not a view - WARN so the author knows what they actually shipped.
    const missing = [];
    if (!state.sections.has(id)) missing.push('a #view-' + id + ' section');
    if (!state.reg.has(id)) missing.push('a VIEW_REGISTRY entry');
    if (missing.length) {
      rep.warn({
        rule: 'view-triple', file, line,
        message: 'flyout item `' + id + '` has no ' + missing.join(' and ') + ' - it renders as a boot-generated placeholder',
        fix: 'add the section and the registry entry, or accept the placeholder deliberately',
      });
    }
  }
}

/** R8 - a new route needs a tests/test_api_*.js case. */
function ruleRouteTest(rep, files, root) {
  const server = files.find((f) => path.basename(f.path) === 'server.js');
  if (!server) return;
  const routes = [];
  for (const { line, text } of server.added) {
    const m = /urlPath\s*===\s*'([^']+)'|urlPath\.startsWith\(\s*'([^']+)'/.exec(text);
    if (!m) continue;
    const route = m[1] || m[2];
    if (!route.startsWith('/api/')) continue; // static prefixes are not routes
    if (routes.some((r) => r.route === route)) continue;
    routes.push({ route, line });
  }
  if (routes.length === 0) return;
  let testCorpus = '';
  const testsDir = path.join(root, 'tests');
  try {
    for (const f of fs.readdirSync(testsDir)) {
      if (/^test_api_.*\.js$/.test(f)) testCorpus += fs.readFileSync(path.join(testsDir, f), 'utf8');
    }
  } catch (_e) { /* no tests dir */ }
  for (const { route, line } of routes) {
    if (testCorpus.indexOf(route) === -1) {
      rep.block({
        rule: 'route-test', file: 'server.js', line,
        message: 'new route `' + route + '` has no tests/test_api_*.js case',
        fix: 'add an API test case for it (conventions section 7)',
      });
    }
  }
}

/** R9 - port literal drift. */
function rulePort(rep, file) {
  for (const { line, text } of file.added) {
    let m;
    const re = /(?:localhost|127\.0\.0\.1):(\d{2,5})|\bPORT\s*[=:]\s*(\d{2,5})/g;
    while ((m = re.exec(text)) !== null) {
      const p = m[1] || m[2];
      if (p === String(R.CANONICAL_PORT)) continue;
      // The api test suites deliberately use dedicated high ports.
      if (/^tests\//.test(file.path)) continue;
      // demo/ is a standalone page that never calls /api/: a localhost URL
      // there is mocked terminal or browser copy (the Vite preview on 5173),
      // not a port the code connects to.
      if (/^demo\//.test(file.path)) continue;
      rep.warn({
        rule: 'port', file: file.path, line,
        message: 'port literal ' + p + ' (canonical port is ' + R.CANONICAL_PORT + ')',
        fix: 'resolve the port once from .env PORT=, fallback ' + R.CANONICAL_PORT,
      });
    }
  }
}

/** R10 - forbidden git / process operations. */
function ruleForbidden(rep, file) {
  if (!isCode(file.path) && !/\.(sh|yml|yaml)$/i.test(file.path)) return;
  const FORBIDDEN = [
    [/git\s+reset\s+--hard/, 'git reset --hard'],
    [/--no-verify/, '--no-verify'],
    [/kill\s+-9/, 'kill -9'],
  ];
  for (const { line, text } of file.added) {
    if (R.NEGATION_RE.test(text)) continue;
    for (const [re, label] of FORBIDDEN) {
      if (re.test(text)) {
        rep.block({
          rule: 'forbidden-op', file: file.path, line,
          message: 'forbidden operation `' + label + '`',
          fix: 'use git stash / git restore / git reset --soft; never bypass hooks; stop the server via POST /api/settings/restart',
        });
        break;
      }
    }
  }
}

/** R13 - an image file committed directly in the repo root (stray screenshot). */
function ruleRootImage(rep, file) {
  if (!/^[^/]+\.(png|jpe?g|gif|webp)$/i.test(file.path)) return;
  rep.block({
    rule: 'root-image', file: file.path, line: 0,
    message: 'image file in the repo root (stray screenshot?)',
    fix: 'move it to user-data/screenshots/ (gitignored) or assets/; the PreToolUse hook and .gitignore should have caught this',
  });
}

/** R11 - a modal toggled with `hidden` alone, without the `.open` class. */
function ruleModalOpen(rep, file) {
  if (!/\.(js|mjs)$/i.test(file.path)) return;
  if (/js\/ds-modal\.js$/.test(file.path)) return; // the helper itself owns the contract
  const added = file.added;
  const window = added.map((l) => l.text).join('\n');
  const hasOpenClass = /classList\.(add|remove|toggle)\(\s*['"]open['"]/.test(window)
    || /openDsModal|closeDsModal/.test(window);
  for (const { line, text } of added) {
    const m = /([A-Za-z_$][\w$]*)\.hidden\s*=\s*(true|false)/.exec(text);
    if (!m) continue;
    if (!/modal|overlay|dialog/i.test(m[1])) continue;
    if (hasOpenClass) continue;
    rep.warn({
      rule: 'modal-open', file: file.path, line,
      message: 'modal `' + m[1] + '` toggled with `hidden` alone',
      fix: 'a ds-modal-overlay needs BOTH hidden and the `.open` class - use openDsModal/closeDsModal from js/ds-modal.js',
    });
  }
}

/**
 * R14 - DS controls that are only half a component on their own.
 *
 * Both findings here are WARN, not BLOCK, and the reason is the same in each
 * case: the correct answer depends on the composition, which no regex can see.
 *
 * `ds-tabs-list` has TWO legitimate shapes and picking the wrong one shows.
 * Bare, it is the full-width page strip: its border-bottom is a rule meant to
 * run under the content it switches, so it needs a row of its own. With
 * `ds-framed-tabs` it is a self-contained bordered box, for tabs that sit
 * INSIDE something - a toolbar, a card, a modal header. Neither is wrong; a
 * bare strip wedged into a filter row beside a 36px segmented pill is. The
 * warning asks which one this is.
 *
 * `ds-segment` is a CHILD of `ds-segmented`, which owns the pill track. The
 * wrapper is looked for anywhere in the same file's added lines rather than on
 * a neighbouring line, because segments are usually emitted from a `.map()`
 * whose body sits well below its wrapper.
 *
 * Only class ATTRIBUTES are read, never a `querySelector('.ds-tabs-list')`:
 * matching raw text would turn every lookup of the class into a finding.
 */

/**
 * Every class list written on one line: the value of a class attribute, plus
 * the arguments of a classList.add/remove/toggle call.
 * @param {string} text
 * @returns {string[]}
 */
function _classListsOn(text) {
  const out = [];
  const attr = /\bclass(?:Name)?\s*=\s*(["'`])([\s\S]*?)\1/g;
  let m;
  while ((m = attr.exec(text)) !== null) out.push(m[2]);
  const api = /classList\.(?:add|remove|toggle)\(([^)]*)\)/g;
  while ((m = api.exec(text)) !== null) out.push(m[1].replace(/['"`,]/g, ' '));
  return out;
}

/** True when `cls` is a whole token of the class list (never a prefix). */
function _hasClass(classList, cls) {
  return classList.split(/[\s${}]+/).includes(cls);
}

function ruleDsCompanions(rep, file) {
  if (/^(templates|\.claude|docs)\//.test(file.path)) return;
  if (!/\.html?$/i.test(file.path) && !/^js\//.test(file.path) && !MODULE_CLIENT_RE.test(file.path)) return;
  const added = file.added;
  // File-scope, the way ruleModalOpen reads its window: a wrapper written
  // anywhere in this change counts as the wrapper for its segments.
  const whole = added.map(l => l.text).join('\n');
  const hasSegmentedWrapper = /\bds-segmented\b/.test(whole);

  for (const { line, text } of added) {
    const classLists = _classListsOn(text);
    if (!classLists.length) continue;

    if (classLists.some(cl => _hasClass(cl, 'ds-tabs-list'))) {
      const framed = classLists.some(cl => _hasClass(cl, 'ds-tabs-list') && _hasClass(cl, 'ds-framed-tabs'));
      if (!framed) {
        rep.warn({
          rule: 'ds-tabs-variant', file: file.path, line,
          message: 'bare `ds-tabs-list` - the full-width page-strip variant',
          fix: 'a bare strip needs a row of its own (its border-bottom is the rule under the content it switches); tabs sitting INSIDE a toolbar, card or modal header take `ds-framed-tabs` instead',
        });
      }
    }

    if (!hasSegmentedWrapper && classLists.some(cl => _hasClass(cl, 'ds-segment'))) {
      rep.warn({
        rule: 'ds-segment-wrap', file: file.path, line,
        message: '`ds-segment` with no `ds-segmented` wrapper in this change',
        fix: 'wrap the buttons in `<div class="ds-segmented">` - the pill track lives on the wrapper, the segment carries nothing but its label',
      });
    }
  }
}

/**
 * Markup surface shared by the five button/modal WARN rules below: js/**,
 * index.html or a module's client/ - the same surface ruleDsCompanions reads -
 * minus js/ds-modal.js itself, which OWNS the modal contract these rules check
 * callers against and would otherwise flag its own reference implementation.
 * @param {string} p
 * @returns {boolean}
 */
function _isButtonSurface(p) {
  if (/^(templates|\.claude|docs)\//.test(p)) return false;
  if (/(^|\/)js\/ds-modal\.js$/.test(p)) return false;
  if (!/\.(js|mjs|html)$/i.test(p)) return false;
  return p === 'index.html' || /^js\//.test(p) || MODULE_CLIENT_RE.test(p);
}

/** True when one of the class lists written on `text` carries `cls`. */
function _lineHasClass(text, cls) {
  return _classListsOn(text).some((cl) => _hasClass(cl, cls));
}

/**
 * R15 - one ds-btn--primary per view. Plan 2026-09-13-przyciski-akcje-modale-spojnosc.
 *
 * Counts, in `file.added`, lines whose class list carries `ds-btn--primary`
 * without `ds-btn--sm` (a BIG primary - the view/header/footer weight, not a
 * small in-content one). Two exclusions keep this from firing on shapes that
 * are correct on purpose: a skeleton line (`data-skel`) is the same button
 * painted twice on purpose (loading vs. real), and a modal footer's own
 * primary (within 6 added lines after a `ds-modal-footer` line) belongs to the
 * DIALOG's hierarchy, not the view's - a view primary plus a confirm button in
 * a modal opened from it is not "two primaries on one view".
 *
 * A per-FILE heuristic, not per-view: a client file that paints several views
 * (a hub module) can trip this on legitimate code, the same tradeoff
 * ds-tabs-variant makes - WARN, not BLOCK, because the right read needs a
 * human.
 */
function ruleBtnPrimaryPerView(rep, file) {
  if (!_isButtonSurface(file.path)) return;
  const added = file.added;
  const footerLines = [];
  for (const { line, text } of added) {
    if (/ds-modal-footer/.test(text)) footerLines.push(line);
  }
  const hits = [];
  for (const { line, text } of added) {
    if (/data-skel/.test(text)) continue;
    if (footerLines.some((fl) => line > fl && line <= fl + 6)) continue;
    if (!_lineHasClass(text, 'ds-btn--primary')) continue;
    if (_lineHasClass(text, 'ds-btn--sm')) continue;
    hits.push(line);
  }
  if (hits.length > 1) {
    rep.warn({
      rule: 'btn-primary-per-view', file: file.path, line: hits[1],
      message: hits.length + ' big ds-btn--primary buttons on lines ' + hits.join(', '),
      fix: 'one primary per view - the action the view exists for; alternatives take ds-btn--secondary',
    });
  }
}

/**
 * R16 - the header action slot (`page-header-actions`) is BIG, never `--sm`.
 * The slot anchor is matched as plain text (the id is built with escHtml at
 * runtime, so it never appears as a literal class attribute), then the same
 * line and the next 8 added lines are searched for a `ds-btn--sm`, stopping at
 * the first `</div>` - the slot's own closing tag.
 */
function ruleBtnHeaderSize(rep, file) {
  if (!_isButtonSurface(file.path)) return;
  const added = file.added;
  for (let i = 0; i < added.length; i++) {
    const { line, text } = added[i];
    if (!/page-header-actions/.test(text)) continue;
    let hitLine = null;
    if (_lineHasClass(text, 'ds-btn--sm')) {
      hitLine = line;
    } else {
      for (let k = 1; k <= 8 && i + k < added.length; k++) {
        const next = added[i + k];
        if (_lineHasClass(next.text, 'ds-btn--sm')) { hitLine = next.line; break; }
        if (/<\/div>/.test(next.text)) break;
      }
    }
    if (hitLine !== null) {
      rep.warn({
        rule: 'btn-header-size', file: file.path, line: hitLine,
        message: 'ds-btn--sm inside a page-header-actions slot',
        fix: 'the view header slot is big (48px); ds-btn--sm belongs in the content',
      });
    }
  }
}

/**
 * R17 - a hand-rolled `ds-modal-overlay` with no accessibility layer. Reading
 * only class lists (never raw text) so a `querySelector('.ds-modal-overlay')`
 * is not a finding, same discipline as ruleDsCompanions. `js/ds-modal.js`
 * itself sets `role="dialog"` at runtime, so importing it OR writing the role
 * by hand both count as covered; one WARN per file, on the first overlay line.
 */
function ruleModalA11y(rep, file) {
  if (!_isButtonSurface(file.path)) return;
  const added = file.added;
  let overlayLine = null;
  for (const { line, text } of added) {
    if (_lineHasClass(text, 'ds-modal-overlay')) { overlayLine = line; break; }
  }
  if (overlayLine === null) return;
  const whole = added.map((l) => l.text).join('\n');
  if (/ds-modal\.js/.test(whole)) return;
  if (/role\s*=\s*["']dialog["']/.test(whole)) return;
  rep.warn({
    rule: 'modal-a11y', file: file.path, line: overlayLine,
    message: 'ds-modal-overlay markup with no js/ds-modal.js import and no role="dialog"',
    fix: 'open it through openDsModal/confirmDsModal (js/ds-modal.js) - it sets role, aria-modal and focus for you',
  });
}

/**
 * R18 - a module reaching for the browser's own `confirm()` instead of
 * `confirmDsModal` (js/ds-modal.js). Module client code only: core files
 * carry a documented exception (`window.confirm` / `stashConfirmText`,
 * conventions section 2b) that is out of scope for this plan. The negative
 * lookbehind keeps `confirmDsModal(` and `_confirm(` from matching - both are
 * legitimate call sites, not the browser dialog.
 */
function ruleWindowConfirmInModule(rep, file) {
  if (!MODULE_CLIENT_RE.test(file.path)) return;
  const RE = /(?<![\w$.])(?:window\.)?confirm\s*\(/;
  for (const { line, text } of file.added) {
    if (/^\s*(\/\/|\/\*|\*)/.test(text)) continue;
    if (RE.test(text)) {
      rep.warn({
        rule: 'window-confirm-in-module', file: file.path, line,
        message: 'raw confirm(...) instead of confirmDsModal',
        fix: 'use confirmDsModal({ title, body, okLabel, danger, trigger }) from js/ds-modal.js',
      });
    }
  }
}

/**
 * R20 - English copy, in a `.md` file people read (templates/, docs/, the
 * module template, the catalog template and READMEs). The ASCII rule above
 * guards CODE (non-ASCII outside a string literal); this is its mirror image
 * for COPY: every sentence a person reads is written in English. The project
 * was translated from Polish, so the heuristic looks for what a leftover
 * looks like: a word carrying a Polish diacritic letter, or a word from a
 * closed list of common Polish words that are not English words (the same
 * words typed without diacritics included). A heuristic, so WARN: it counts
 * DISTINCT words, ignores fenced code, inline code and URLs, and fires once
 * per file only from three distinct hits - one stray name or quoted term in
 * an otherwise English text is not a finding.
 */
const PROSE_DOC_RE = /^(templates\/|docs\/|modules-template\/|catalog-repo-template\/|README\.md$|modules\/[^/]+\/README\.md$)/;
const NON_ENGLISH_WORDS = [
  'nie', 'sie', 'jest', 'oraz', 'albo', 'tylko', 'przez', 'jesli', 'zeby', 'juz', 'moze', 'mozna', 'wiec',
  'czy', 'dla', 'gdy', 'jako', 'ktory', 'ktora', 'ktore', 'ktorych', 'ktorego', 'ktorej', 'ktorym', 'wlasnie',
  'rowniez', 'wiecej', 'kazdy', 'kazda', 'kazde', 'kazdego', 'tresc', 'tresci', 'wartosc', 'wartosci', 'uzyc',
  'uzyj', 'uzytkownik', 'uzytkownika', 'uzytkownicy', 'wlasny', 'wlasna', 'wlasne', 'zrodlo', 'sciezka',
  'blad', 'bledy', 'wyslij', 'wyslac', 'gdzie', 'kiedy', 'teraz', 'potem', 'najpierw', 'tutaj', 'zadanie',
  'zadania', 'spotkanie', 'spotkania', 'opis', 'uwagi', 'termin', 'klucz', 'kliknij', 'dodaj', 'zapisz',
  'usun', 'pobierz', 'sprawdz', 'odswiez', 'sprobuj', 'udalo', 'dane', 'danych', 'zespol', 'zespolu',
  'modul', 'modulu', 'plik', 'pliku', 'brak', 'wybierz', 'otworz', 'uruchom', 'ponizej', 'powyzej',
];
// A word carrying one of the nine Polish diacritic letters (escaped, the source
// stays ASCII), or a listed word bounded by non-letters.
const NON_ENGLISH_RE = new RegExp(
  '(\\p{L}*[\\u0105\\u0107\\u0119\\u0142\\u0144\\u015b\\u017a\\u017c\\u0104\\u0106\\u0118\\u0141\\u0143\\u015a\\u0179\\u017b]\\p{L}*'
  + '|(?<!\\p{L})(?:' + NON_ENGLISH_WORDS.join('|') + ')(?!\\p{L}))', 'giu',
);

function _isProseDoc(p) {
  return /\.md$/.test(p) && PROSE_DOC_RE.test(p);
}

function _collectNonEnglish(seen, text, line) {
  let m;
  NON_ENGLISH_RE.lastIndex = 0;
  while ((m = NON_ENGLISH_RE.exec(text)) !== null) {
    const w = m[1].toLowerCase();
    if (!seen.has(w)) seen.set(w, line);
  }
}

function ruleMdNonEnglish(rep, file) {
  if (!_isProseDoc(file.path)) return;
  const seen = new Map(); // word -> first line
  let inFence = false;
  for (const { line, text } of file.added) {
    if (/^\s*(```|~~~)/.test(text)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const prose = text
      .replace(/`[^`]*`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[\w.-]+\.(md|js|mjs|json|css|py|sh|png|pptx|pdf|jpg)\b/gi, ' ');
    _collectNonEnglish(seen, prose, line);
  }
  if (seen.size < 3) return;
  const sample = [...seen.entries()].slice(0, 5).map(([w, l]) => `${w} (line ${l})`).join(', ');
  const [, firstLine] = [...seen.entries()][0];
  rep.warn({
    rule: 'md-non-english', file: file.path, line: firstLine,
    message: `non-English prose in a document people read - ${seen.size} words: ${sample}`,
    fix: 'documents, templates and READMEs are written in English; code and identifiers stay ASCII',
  });
}

/**
 * ui-non-english (WARN) - md-non-english one file type over. The same word
 * test, read inside STRING content of js/, index.html, server.js and a
 * module's client/ and server/ - where every toast, label, placeholder and
 * error message lives.
 *
 * Three things keep it quiet. A string counts as prose only when it holds at
 * least two words - a single token is a key, an id, a path or a CSS class,
 * ASCII by rule, which is what keeps a legacy id like `'settings-uzytkownicy'`
 * out. A comment or log line is skipped whole, because those are ASCII by the
 * same rule. And it is a WARN with one finding per file, like its sibling: a
 * word list has no way to know whether a phrase is copy or an example - a
 * human does.
 */
const UI_STRING_FILE_RE = /^(js\/.*\.(js|mjs)|index\.html|server\.js|modules\/[^/]+\/(client|server)\/.*\.(js|mjs|html))$/;
const LOG_OR_COMMENT_LINE_RE = /^\s*(\/\/|\*|\/\*)|\b(console\.\w+|log|warn|info|debug|error)\(/;
const TWO_WORDS_RE = /[\p{L}]\s+[\p{L}]/u;
const COMMENT_SHAPED_STRING_RE = /^\s*(\/\/|\/\*|\*|#|<!--)/;
const HTML_COPY_ATTR_RE = /\b(?:title|placeholder|aria-label|alt|data-toast-title|data-toast-body)="([^"]*)"/g;

function _uiStringSegments(file, text, line, root, cache) {
  const segs = [];
  if (/\.html$/i.test(file.path)) {
    segs.push(text.replace(/<[^>]*>/g, ' '));
    let m;
    HTML_COPY_ATTR_RE.lastIndex = 0;
    while ((m = HTML_COPY_ATTR_RE.exec(text)) !== null) segs.push(m[1]);
    return segs;
  }
  // A `//` outside every quote starts a trailing comment: a quoted phrase after
  // it is a comment, not copy (`[]; // rows across "Show more" pages`).
  const quoted = R.quotedRanges(text, '"\'');
  let cut = text.length;
  for (let i = text.indexOf('//'); i !== -1; i = text.indexOf('//', i + 1)) {
    if (!quoted.some(([a, b]) => i >= a && i <= b)) { cut = i; break; }
  }
  for (const [a, b] of quoted) if (a < cut) segs.push(text.slice(a + 1, b));
  for (const [a, b] of _templateRangesFor(cache, root, file.path, line)) segs.push(text.slice(a, b + 1));
  return segs;
}

function ruleUiNonEnglish(rep, file, root, cache) {
  if (!UI_STRING_FILE_RE.test(file.path)) return;
  const seen = new Map(); // word -> first line
  const isHtml = /\.html$/i.test(file.path);
  let inHtmlComment = false; // <!-- ... --> spanning lines: ASCII by rule, like a JS comment
  for (const { line, text } of file.added) {
    if (isHtml) {
      const wasIn = inHtmlComment;
      if (/<!--/.test(text) && !/-->/.test(text.slice(text.indexOf('<!--')))) inHtmlComment = true;
      if (/-->/.test(text)) inHtmlComment = false;
      if (wasIn || /^\s*<!--/.test(text)) continue;
    }
    if (LOG_OR_COMMENT_LINE_RE.test(text)) continue;
    for (const seg of _uiStringSegments(file, text, line, root, cache)) {
      if (!TWO_WORDS_RE.test(seg)) continue;
      if (COMMENT_SHAPED_STRING_RE.test(seg)) continue; // a comment line written INTO generated source
      _collectNonEnglish(seen, seg, line);
    }
  }
  if (seen.size === 0) return;
  const sample = [...seen.entries()].slice(0, 5).map(([w, l]) => `${w} (line ${l})`).join(', ');
  const [, firstLine] = [...seen.entries()][0];
  rep.warn({
    rule: 'ui-non-english', file: file.path, line: firstLine,
    message: `non-English UI string - ${seen.size} words: ${sample}`,
    fix: 'a string a person reads (label, toast, placeholder, error message) is written in English; a key, an id, a path or a log line stays ASCII and single-token',
  });
}

/**
 * R19 - an icon-only `<button>` with no `aria-label`. Deliberately narrow: it
 * only reads a button whose opening tag, text and closing tag sit on ONE
 * added line, because that is the only shape a regex can read without
 * building a real parser - a button assembled from createElement calls (several core
 * modals) or wrapping onto several lines does not match and is not a finding.
 * "Icon-only" here means the text between `>` and `</button>` is a single
 * non-alphanumeric character (`&times;` already decoded would be `×`, but the
 * source usually carries the entity), an HTML entity, or nothing but an
 * `<svg>`/`<img>`.
 */
function ruleIconBtnAria(rep, file) {
  if (!_isButtonSurface(file.path)) return;
  const RE = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  for (const { line, text } of file.added) {
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(text)) !== null) {
      const attrs = m[1];
      const content = m[2].trim();
      if (/\baria-label\s*=/.test(attrs)) continue;
      const isSingleChar = content.length === 1 && !/[A-Za-z0-9]/.test(content);
      const isEntity = /^&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);$/.test(content);
      const isSvgOnly = /^<svg\b[\s\S]*<\/svg>$/i.test(content);
      const isImgOnly = /^<img\b[^>]*\/?>$/i.test(content);
      if (isSingleChar || isEntity || isSvgOnly || isImgOnly) {
        rep.warn({
          rule: 'icon-btn-aria', file: file.path, line,
          message: 'icon-only <button> with no aria-label',
          fix: 'add aria-label="..." naming the action for a screen reader',
        });
      }
    }
  }
}

/**
 * R17 - ds-callout with more than one flex item of prose. Plan-less fix of
 * 2026-09-13 (an app build summary).
 *
 * `.ds-callout` in css/ds.css is `display: flex; align-items: center` - a
 * ROW, built for an icon, one line of text and a button side by side. Every
 * direct child is a flex item, so a summary written as `<strong>Done.</strong>
 * <div>counts</div><ul>...</ul>` paints as three COLUMNS, the heading floating
 * mid-height next to a tall list. The repo's own shape is one wrapping child:
 * `<div class="ds-callout ..."><div>...all the prose...</div></div>`.
 *
 * Reads the content that follows a `ds-callout` opening tag on the same added
 * line, tracking nesting depth so a wrapper's own children never count, and
 * warns when at depth 0 there is either more than one block element
 * (div/p/ul/ol/table/pre/h1-6) or one block element next to loose content
 * (text, an inline tag, a `${...}` interpolation). A `<div>text</div><button>`
 * row is the DESIGNED shape and stays clean: a button is not a block. A
 * callout whose children are ALL interpolations (`${a}${b}`) cannot be read
 * statically and is carried by the conventions prose, not by this rule -
 * the same limit ds-tabs-variant states for composition. WARN, never BLOCK.
 */
const _CALLOUT_BLOCK_TAGS = new Set(['div', 'p', 'ul', 'ol', 'table', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'details']);
const _CALLOUT_VOID_TAGS = new Set(['br', 'img', 'input', 'hr', 'wbr']);

/**
 * Walks the markup after one `ds-callout` opening tag and returns what sits
 * directly under it: block elements and whether loose content is there.
 * @param {string} rest text after the opening tag's `>`
 * @returns {{blocks: number, loose: boolean}}
 */
function _calloutTopLevel(rest) {
  // A `${...}` interpolation is NOT skipped as a unit: a conditional such as
  // `${x ? `<ul>...</ul>` : ''}` puts a real <ul> under the callout, and the
  // expression glue around it reads as loose content, which it is - whatever
  // the branch renders lands directly in the flex row.
  const TOKEN = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>|[^<]+/g;
  let depth = 0;
  let blocks = 0;
  let loose = false;
  let m;
  while ((m = TOKEN.exec(rest)) !== null) {
    const tok = m[0];
    if (tok.startsWith('</')) {
      if (depth === 0) break; // the callout's own closing tag
      depth -= 1;
      continue;
    }
    if (tok.startsWith('<')) {
      const tag = m[1].toLowerCase();
      const selfClosing = tok.endsWith('/>') || _CALLOUT_VOID_TAGS.has(tag);
      if (depth === 0) {
        if (_CALLOUT_BLOCK_TAGS.has(tag)) blocks += 1;
        else if (tag !== 'button' && tag !== 'a' && tag !== 'svg' && tag !== 'img' && tag !== 'input') loose = true;
      }
      if (!selfClosing) depth += 1;
      continue;
    }
    if (depth === 0 && tok.trim()) loose = true;
  }
  return { blocks, loose };
}

function ruleDsCalloutStack(rep, file) {
  if (!_isButtonSurface(file.path)) return;
  const OPEN = /<(?:div|section|p)\b[^>]*\bclass\s*=\s*(["'`])([^"'`]*)\1[^>]*>/g;
  for (const { line, text } of file.added) {
    let m;
    OPEN.lastIndex = 0;
    while ((m = OPEN.exec(text)) !== null) {
      if (!_hasClass(m[2], 'ds-callout')) continue;
      const { blocks, loose } = _calloutTopLevel(text.slice(m.index + m[0].length));
      if (blocks >= 2 || (blocks >= 1 && loose)) {
        rep.warn({
          rule: 'ds-callout-stack', file: file.path, line,
          message: '`ds-callout` with several direct children - it is a flex ROW, so they paint as columns',
          fix: 'put the whole prose (heading, counts, list) inside ONE wrapping <div> and stack it there; the callout itself holds only icon + text + button side by side',
        });
      }
    }
  }
}

/**
 * R12 - hardcoded hex colors. Conventions section 2 scopes this to styles.css
 * and inline styles: `css/*.css` IS the Design System implementation and owns
 * the literal values (css/ds.css carries 20 of them today, deliberately).
 */
function ruleHexColors(rep, file) {
  if (/^css\//.test(file.path)) return;
  // A module owns no part of the Design System, so EVERY stylesheet it ships
  // is token-only - not just one called styles.css.
  const isModuleCss = MODULE_ANY_RE.test(file.path) && /\.css$/i.test(file.path);
  if (!isModuleCss && !/(^|\/)styles\.css$|\.(html|js|mjs)$/i.test(file.path)) return;
  for (const { line, text } of file.added) {
    // In JS the literal is a colour when it sits in an inline style OR stands
    // alone as a quoted six-digit value in a palette array - the confetti
    // palette in js/academy.js passed the inline-style check alone.
    // tests/ and scripts/ paint nothing, so a quoted value there is a fixture
    // or a pattern, never a colour on screen.
    const quotedIsColour = !/^(tests|scripts)\//.test(file.path) && /['"`]#[0-9a-fA-F]{6}['"`]/.test(text);
    if (/\.(js|mjs|html)$/i.test(file.path)
      && !/style\s*=|style\.|cssText|<style/i.test(text)
      && !quotedIsColour) continue;
    // Declaring a custom property IS how a token is defined - only USING a
    // literal where a token belongs is the violation.
    if (/^\s*--[a-zA-Z0-9-]+\s*:/.test(text)) continue;
    const m = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/.exec(text);
    if (!m) continue;
    if (/^#[0-9]{3}$/.test(m[0])) continue;
    rep.block({
      rule: 'hex-color', file: file.path, line,
      message: 'hardcoded hex color `' + m[0] + '`',
      fix: 'use a token from css/ds-tokens.css / css/ds-tokens-dark.css',
    });
  }
}

/**
 * Layout and keyboard-access rules, all WARN, added 2026-09-13 after the
 * Sprint Stats port shipped with a flex-wrapped tile row that broke 2+2 across
 * the page, a clickable <tr> nobody could reach from the keyboard and a
 * `role="tab"` list with no panel behind it - none of which any rule above
 * could see. Each one flags the mechanical tell and leaves the read to a
 * person (conventions section 2c).
 *
 *   clickable-non-control   `cursor: pointer` under a selector that names no
 *                           control (btn, tab, chip, link, toggle, [role...])
 *   flex-wrap-tiles         `flex-wrap: wrap` on a tile/stat/metric/panel row
 *                           - a grid is what keeps the columns aligned
 *   tabs-aria-half          role="tab" with no role="tabpanel" / aria-controls
 *                           in the same change - half an ARIA pattern
 */
const _CSS_SURFACE_RE = /(^|\/)styles\.css$|^modules\/[^/]+\/client\/.*\.css$/i;
const _CONTROL_SELECTOR_RE = /\b(btn|button|tab|chip|link|toggle|segment|nav|menu|option|opt|trigger|switch|handle|thumb|close|dropzone)\b|\[role|:hover|:focus|^\s*(a|button|summary|label)\b|\ba\b|\bbutton\b|\bsummary\b|\blabel\b/i;
// Only the LAST word of the selector counts (`.sprint-stats-legend` is not a
// tile row because the module is called sprint-stats).
const _TILE_SELECTOR_RE = /(?:^|[\s>+~.#_-])(tile|tiles|stat|stats|kpi|kpis|metric|metrics|panel|panels|charts|cards)(?:-(?:row|bar|grid|list|wrap))?\s*$/i;

/**
 * The selector a declaration at `idx` belongs to: the text before the nearest
 * `{` walking back through the added lines, or `null` when the block opener
 * is not part of this change.
 * @param {{line: number, text: string}[]} added
 * @param {number} idx
 * @returns {string|null}
 */
function _cssSelectorBefore(added, idx) {
  let b = -1;
  for (let i = idx; i >= 0; i--) {
    if (/\{/.test(added[i].text)) { b = i; break; }
    if (i < idx && /\}/.test(added[i].text)) return null;
  }
  if (b < 0) return null;
  const head = added[b].text.slice(0, added[b].text.indexOf('{'));
  const parts = [head];
  // A selector list may continue upward, one line per `,`-terminated part.
  for (let i = b - 1; i >= 0 && /,\s*$/.test(added[i].text) && added[i].line === added[i + 1].line - 1; i--) {
    parts.unshift(added[i].text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim() || null;
}

function ruleLayoutA11y(rep, file) {
  if (!_CSS_SURFACE_RE.test(file.path)) return;
  const added = file.added;
  for (let i = 0; i < added.length; i++) {
    const { line, text } = added[i];
    if (/^\s*cursor\s*:\s*pointer\b/.test(text)) {
      const sel = _cssSelectorBefore(added, i);
      if (sel && !_CONTROL_SELECTOR_RE.test(sel)) {
        rep.warn({
          rule: 'clickable-non-control', file: file.path, line,
          message: '`cursor: pointer` on `' + sel.replace(/\s+/g, ' ').slice(0, 60) + '` - a clickable element that names no control',
          fix: 'put a real <button> (ds-btn, ds-row-toggle, ds-icon-btn) inside the row/card and bind the click to it - a <tr> or <div> is not focusable, so a keyboard or a screen reader cannot open it',
        });
      }
    }
    if (/^\s*flex-wrap\s*:\s*wrap\b/.test(text)) {
      const sel = _cssSelectorBefore(added, i);
      if (sel && _TILE_SELECTOR_RE.test(sel)) {
        rep.warn({
          rule: 'flex-wrap-tiles', file: file.path, line,
          message: '`flex-wrap: wrap` on `' + sel.replace(/\s+/g, ' ').slice(0, 60) + '` - tiles that wrap never line up between rows',
          fix: 'use the DS grid: `.ds-stat-row` (label + N equal tiles, full width) for metric tiles, `grid-template-columns: repeat(N, minmax(0, 1fr))` for chart panels',
        });
      }
    }
  }
}

/**
 * `flex-on-table-cell` (WARN, whole-set): `display: flex|grid|inline-flex|
 * inline-grid` applied to a `<td>`/`<th>` takes the cell OUT of the table row
 * model - it stops being a `table-cell`, no longer stretches to the row
 * height, and its `border-bottom` draws at the cell's own height instead of
 * the row's, so the action column's dividers drift away from the content
 * column's (a recurring bug: Sprint Review topics table, 2026-09-13). The
 * flex/grid layout belongs on an INNER `<div>`, never on the cell.
 *
 * It is a whole-set rule because the tell spans two files: the cell class is
 * used on a `<td>` in a .js/.html file, and the `display:flex` is in the CSS.
 * A bare `td`/`th` ELEMENT selector with flex/grid is flagged on its own.
 * Cell classes are harvested from ADDED lines only, like every other
 * whole-set rule here: `display: flex` added to a class whose `<td class>`
 * already sits in HEAD is not seen, so a clean run is evidence about the
 * diff, not about the table.
 * @param {{path: string, added: {line: number, text: string}[]}[]} files
 */
function _cssKeyClasses(sel) {
  // The rightmost compound selector (after the last combinator) - the element
  // the rule actually paints; an ancestor `.cell .inner` is not the cell.
  const key = String(sel).split(/[\s>+~]+/).filter(Boolean).pop() || '';
  const classes = (key.match(/\.[A-Za-z0-9_-]+/g) || []).map((c) => c.slice(1));
  const isCellElement = /(^|[^A-Za-z0-9_-])(td|th)(\.|:|$)/.test(key);
  return { classes, isCellElement };
}
function ruleFlexOnTableCell(rep, files) {
  const cellClasses = new Set();
  const CELL_CLASS_RE = /<t[dh]\b[^>]*\bclass\s*=\s*["']([^"']+)["']/gi;
  for (const f of files) {
    if (!/\.(js|mjs|cjs|html)$/i.test(f.path)) continue;
    for (const { text } of f.added) {
      let m;
      CELL_CLASS_RE.lastIndex = 0;
      while ((m = CELL_CLASS_RE.exec(text)) !== null) {
        m[1].split(/\s+/).filter(Boolean).forEach((c) => cellClasses.add(c));
      }
    }
  }
  // `(^|[{;])` and not `^`: the shortest way to write the bug is a one-line
  // rule `.cell { display: flex; }`, where `display` follows the brace.
  const DISPLAY_RE = /(^|[{;])\s*display\s*:\s*(flex|inline-flex|grid|inline-grid)\b/;
  for (const file of files) {
    if (!_CSS_SURFACE_RE.test(file.path)) continue;
    const added = file.added;
    for (let i = 0; i < added.length; i++) {
      if (!DISPLAY_RE.test(added[i].text)) continue;
      const sel = _cssSelectorBefore(added, i);
      if (!sel) continue;
      const { classes, isCellElement } = _cssKeyClasses(sel);
      const onCellClass = classes.some((c) => cellClasses.has(c));
      if (isCellElement || onCellClass) {
        rep.warn({
          rule: 'flex-on-table-cell', file: file.path, line: added[i].line,
          message: '`display: ' + added[i].text.replace(/^.*?display\s*:\s*/, '').replace(/[;}].*$/, '').trim()
            + '` on `' + sel.replace(/\s+/g, ' ').slice(0, 60) + '` - a <td>/<th> styled flex/grid leaves the table row model and its border drifts from the row',
          fix: 'keep the cell a real table-cell (no display on it) and wrap its contents in an inner <div> that carries the flex/grid layout',
        });
      }
    }
  }
}

function ruleTabsAriaHalf(rep, file) {
  if (!_isButtonSurface(file.path)) return;
  let tabLine = 0;
  let hasPanel = false;
  for (const { line, text } of file.added) {
    if (!tabLine && /role\s*=\s*["'`]tab["'`]/.test(text)) tabLine = line;
    if (/role\s*=\s*["'`]tabpanel["'`]|aria-controls\s*=/.test(text)) hasPanel = true;
  }
  if (tabLine && !hasPanel) {
    rep.warn({
      rule: 'tabs-aria-half', file: file.path, line: tabLine,
      message: '`role="tab"` with no `role="tabpanel"` / `aria-controls` in this change - half an ARIA pattern',
      fix: 'either give the switched content role="tabpanel" with an id each tab names in aria-controls (and aria-selected on the tab), or drop the roles and let the tabs be plain buttons - half-done ARIA announces a tab that leads nowhere',
    });
  }
}

/**
 * spawn-env-spread (WARN) - a child process handed the parent's whole
 * environment. Added 2026-09-13 after the Sprint Stats module's Python ETL
 * shipped with `env: childEnv(process.env)` where childEnv was `{ ...env }`
 * minus the two Jira keys: every secret the Bitwarden unlock assigns into
 * process.env after boot (28 of them) rode into a child that runs for up to
 * twenty minutes, and `ps eww <pid>` prints a child's envp to anyone on the
 * same account. The mechanical tell is the SPREAD (or a bare `env:
 * process.env`); what the child really needs is an allowlist, the shape
 * server.js's _protoAnalyticsRunScript uses. WARN, never BLOCK: a helper that
 * spreads and then strips a closed list (server.js's _restartChildEnv) is a
 * deliberate design somebody can read and wave through. Server-side code
 * only - a browser module has no process.env to leak.
 */
const _SERVER_CODE_RE = /^(server\.js|scripts\/.*\.(js|mjs|cjs)|modules\/[^/]+\/server\/.*\.(js|mjs|cjs))$/;
// The spread is the tell on its own. A bare `env: process.env` is one only
// next to a child-process call on the same line: `env` is also an ordinary
// dependency-injection key (createRoutes(ctx, { env: process.env }) reads
// CONFLUENCE_TOKEN from it and spawns nothing), and flagging that taught the
// first module to alias process.env to dodge the regex instead.
const _ENV_SPREAD_RE = /\.\.\.\s*\(?\s*(?:[A-Za-z_$][\w$]*\s*\|\|\s*)?process\.env\b/;
const _ENV_BARE_RE = /\benv\s*:\s*process\.env\b/;
const _CHILD_CALL_RE = /\b(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/;

// The checker itself names the pattern it looks for - in its HELP text, in
// the warn message, in the regexes above - so it is the one server-side file
// this rule never reads, or every diff touching it would carry two permanent
// WARNs and the column would stop being read.
const _SPAWN_ENV_SELF = 'scripts/check-conventions.js';

// Single-line string literals cut out before matching: a message that QUOTES
// `...process.env` (a log line, a fix hint in a module's own checker) is not
// a spawn. Multi-line template literals are not reachable this way, which is
// what the self-exclusion above is for.
const _STRING_LITERAL_RE = /(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g;

function ruleSpawnEnvSpread(rep, file) {
  if (!_SERVER_CODE_RE.test(file.path)) return;
  if (file.path === _SPAWN_ENV_SELF) return;
  for (const { line, text: rawText } of file.added) {
    if (/^\s*(\/\/|\*|\/\*)/.test(rawText)) continue;
    if (R.NEGATION_RE.test(rawText)) continue;
    const text = rawText.replace(_STRING_LITERAL_RE, '""');
    const hit = _ENV_SPREAD_RE.test(text) || (_ENV_BARE_RE.test(text) && _CHILD_CALL_RE.test(text));
    if (!hit) continue;
    rep.warn({
      rule: 'spawn-env-spread', file: file.path, line,
      message: 'the parent environment spread into a child (`...process.env`) - every vault-loaded secret rides along and `ps eww` shows it',
      fix: 'build the child env from an ALLOWLIST of the keys it needs (PATH, HOME, temp dirs, locale, CA/proxy variables) and hand secrets over stdin - see _protoAnalyticsRunScript in server.js and childEnv in modules/sprint-stats/server/refresh-job.js',
    });
  }
}

/**
 * detached-on-win32 (WARN) - a child spawned with a literal `detached: true`
 * in server-side code. On Windows that flag is DETACHED_PROCESS, and the Win32
 * rule is that CREATE_NO_WINDOW - the hidden console `windowsHide: true` asks
 * for, and what scripts/_cp.js gives every spawn in the server process - is
 * IGNORED next to it. The child then runs with no console at all and every
 * console child IT starts (git-remote-https under a clone, vite under
 * `npm run dev`) opens a visible window of its own, cascaded across the
 * screen for as long as it runs (2026-09-14, from a screenshot). The shape
 * that keeps the process group on posix and the hidden console on Windows is
 * `detached: process.platform !== 'win32'` plus `taskkill /T` for the kill
 * (server.js _toolKill) - so a line that names `win32` is quiet. WARN, not
 * BLOCK: the restart child in server.js must outlive its parent and is the
 * one legitimate exception, which a reviewer can read and wave through.
 */
const _DETACHED_TRUE_RE = /\bdetached\s*:\s*true\b/;
const _DETACHED_SELF = new Set(['scripts/check-conventions.js', 'scripts/_cp.js']);

function ruleDetachedOnWin32(rep, file) {
  if (!_SERVER_CODE_RE.test(file.path)) return;
  if (_DETACHED_SELF.has(file.path)) return;
  for (const { line, text: rawText } of file.added) {
    if (/^\s*(\/\/|\*|\/\*)/.test(rawText)) continue;
    if (R.NEGATION_RE.test(rawText)) continue;
    const text = rawText.replace(_STRING_LITERAL_RE, '""');
    if (!_DETACHED_TRUE_RE.test(text)) continue;
    if (/win32/.test(text)) continue;
    rep.warn({
      rule: 'detached-on-win32', file: file.path, line,
      message: 'child spawned with a literal `detached: true` - on Windows that is DETACHED_PROCESS, which discards the hidden console windowsHide asks for, so every console child it starts opens a visible window',
      fix: 'use `detached: process.platform !== \'win32\'` and kill the tree with taskkill /T on Windows (server.js _toolKill); keep a bare `detached: true` only for a child that must outlive the server, with a comment saying so',
    });
  }
}

/**
 * The data repo route ids a module.json dataRepos[].name may carry, mirrored
 * from server.js (DATA_REPO_DEFS ids + DATA_TIER_0_NAME) like the copy in
 * scripts/new-module.js; tests/test_new_module.mjs pins that one, this one is
 * pinned there too. `ds-data-tier-0` is the remote name of data-tier-0 and still
 * resolves server-side (_resolveDataRepoId), so it is tolerated here - but a
 * manifest should carry the route id.
 */
const DATA_REPO_IDS = ['data-tier-0'];

/**
 * module-data-undeclared (WARN) - module client/server code that reaches the
 * team data (an /api/data/ call, the data-tier-0 directory, the data repos'
 * plaintext folders) while its module.json declares no dataRepos. The sync
 * window and the module's status bar are built from that declaration alone
 * (dataRepos[], access 'write' | 'read'), so an undeclared module has no row
 * and its files fall into the anonymous "Cockpit Core". Once per FILE, not per
 * line: a --modules walk treats the whole file as added and a server file can
 * name the directory fifty times. Reads module.json from `root`; a missing or
 * unparsable manifest counts as undeclared.
 */
const _MODULE_DATA_TOUCH_RE = /\/api\/data\/|ctx\.dataTier0Dir|data-sub-repositories\/|\/ds-data\b/;
const _MODULE_RUNTIME_RE = /^modules\/([^/]+)\/(client|server)\/.*\.(js|mjs|cjs)$/;

function _readModuleManifest(root, moduleId) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'modules', moduleId, 'module.json'), 'utf8')); } catch (_e) { return null; }
}

function ruleModuleDataUndeclared(rep, file, root) {
  const m = _MODULE_RUNTIME_RE.exec(file.path);
  if (!m) return;
  const hit = file.added.find(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text) && _MODULE_DATA_TOUCH_RE.test(text));
  if (!hit) return;
  const manifest = _readModuleManifest(root, m[1]);
  if (manifest && Array.isArray(manifest.dataRepos) && manifest.dataRepos.length > 0) return;
  rep.warn({
    rule: 'module-data-undeclared', file: file.path, line: hit.line,
    message: 'module code reaches team data but modules/' + m[1] + '/module.json declares no dataRepos - the sync window has no row for it',
    fix: "declare the repo and paths in module.json dataRepos[] (access: 'read' when the module only reads)",
  });
}

/**
 * module-data-repo-unknown (WARN) - a module.json dataRepos[].name that no
 * data repo answers to. _resolveDataRepoId drops it silently, so the module
 * gets no sync row and no status bar and nothing says why.
 */
function ruleModuleDataRepoUnknown(rep, file, root) {
  const m = /^modules\/([^/]+)\/module\.json$/.exec(file.path);
  if (!m) return;
  const manifest = _readModuleManifest(root, m[1]);
  if (!manifest || !Array.isArray(manifest.dataRepos)) return;
  for (const entry of manifest.dataRepos) {
    const name = typeof entry === 'string' ? entry : (entry && entry.name);
    if (typeof name !== 'string' || DATA_REPO_IDS.includes(name) || name === 'ds-data-tier-0') continue;
    rep.warn({
      rule: 'module-data-repo-unknown', file: file.path, line: 1,
      message: 'dataRepos names "' + name + '", which is not a data repo route id - the module gets no row in the sync window',
      fix: 'use the route id (e.g. data-tier-0), one of: ' + DATA_REPO_IDS.join(', '),
    });
  }
}

/**
 * stdio-inherit-in-process (WARN) - `stdio: 'inherit'` on a child spawned from
 * code that runs INSIDE the server process. It reads as the harmless choice
 * and is not: libuv adds CREATE_NO_WINDOW - what `windowsHide: true` asks for,
 * and what scripts/_cp.js puts on every spawn in the process - only when NO
 * stdio slot is UV_INHERIT_FD ("Avoid creating console window if stdio is not
 * inherited", src/win/process.c). An inherited fd drops the flag silently, so
 * on a server restarted through the API - which has no console of its own -
 * the child allocates a VISIBLE console window for as long as it runs. Three
 * `npm install` spawns did exactly that through every update path until
 * server.js `_spawnNpmInstall` replaced them with drained pipes.
 *
 * Scope is deliberately NARROWER than _SERVER_CODE_RE: a CLI entry point under
 * scripts/ (the test runners, the bootstrappers, the hooks) is run from a real
 * terminal by a person who wants to watch it, and 'inherit' is right there.
 * Only server.js, the shared scripts/_*.js libraries the server requires
 * in-process, and module server code are in scope.
 *
 * Reads SINGLE-LINE forms only, because file.added is per line: an `stdio`
 * array broken across lines slips through. That is the usual shape trade-off
 * in this checker, not a claim of full coverage - the comment on
 * _spawnNpmInstall is what carries the rule for a reader.
 */
const _IN_PROCESS_CODE_RE = /^(server\.js|scripts\/_[^/]*\.(js|mjs|cjs)|modules\/[^/]+\/server\/.*\.(js|mjs|cjs))$/;
const _STDIO_INHERIT_RE = /\bstdio\s*:\s*(['"`]inherit['"`]|\[[^\]]*['"`]inherit['"`])/;
const _STDIO_SELF = new Set(['scripts/check-conventions.js', 'scripts/_cp.js']);

function ruleStdioInheritInProcess(rep, file) {
  if (!_IN_PROCESS_CODE_RE.test(file.path)) return;
  if (_STDIO_SELF.has(file.path)) return;
  for (const { line, text: rawText } of file.added) {
    if (/^\s*(\/\/|\*|\/\*)/.test(rawText)) continue;
    if (R.NEGATION_RE.test(rawText)) continue;
    if (!_STDIO_INHERIT_RE.test(rawText)) continue;
    rep.warn({
      rule: 'stdio-inherit-in-process', file: file.path, line,
      message: "`stdio: 'inherit'` in code that runs inside the server process - an inherited fd makes libuv skip CREATE_NO_WINDOW, so windowsHide is dropped and the child opens a visible console window on a restarted (console-less) Windows server",
      fix: "use `stdio: ['ignore', 'pipe', 'pipe']` and forward the pipes with process.stdout.write / process.stderr.write - draining them is mandatory, an undrained pipe blocks the child (server.js _spawnNpmInstall is the worked example)",
    });
  }
}

/**
 * app-fetch-refspec (WARN) - a `git fetch` into the APPLICATION repository
 * (`-C <root>`) whose remote is a URL rather than a named remote, carrying
 * no destination refspec.
 *
 * Such a fetch writes FETCH_HEAD and NOTHING else: git does not match the
 * URL against a configured remote, so refs/remotes/origin/main is left
 * wherever the clone or the adopt put it. The updater then walks local
 * `main` forward release after release against a remote-tracking ref that
 * never moves, and the editor reads the gap as outgoing commits - it offered
 * one person thirteen of the maintainer's own commits to push, behind a
 * GitLab sign-in they had no business completing (2026-09-15). A token that
 * must stay out of `remote.origin.url` is the reason these fetch by URL at
 * all, and that is fine - the fix is to name the destination, exactly as
 * ORIGIN_MAIN_REFSPEC does, never to switch to the named remote.
 *
 * Data-repo git is out of scope by construction: it goes through
 * `d.gitExecFn(['fetch', ...])` with a NAMED remote and no `-C` literal.
 * WARN rather than BLOCK: server.js already funnels both update paths
 * through _appUpdateFetchArgs, so a hit here is a new call site a reviewer
 * should look at, not a certainty.
 */
const _ROOT_FETCH_RE = /\[\s*['"`]-C['"`]\s*,\s*[A-Za-z_$][\w$]*\s*,\s*['"`]fetch['"`]/;
const _FETCH_URL_ARG_RE = /['"`]fetch['"`]\s*,\s*[A-Za-z_$][\w$]*[Uu]rl\b/;
const _FETCH_REFSPEC_RE = /refs\/|REFSPEC/;
const _APP_FETCH_SELF = new Set(['scripts/check-conventions.js']);

function ruleAppFetchRefspec(rep, file) {
  if (!_SERVER_CODE_RE.test(file.path)) return;
  if (_APP_FETCH_SELF.has(file.path)) return;
  for (const { line, text } of file.added) {
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
    if (!_ROOT_FETCH_RE.test(text)) continue;
    if (!_FETCH_URL_ARG_RE.test(text)) continue;
    if (_FETCH_REFSPEC_RE.test(text)) continue;
    rep.warn({
      rule: 'app-fetch-refspec', file: file.path, line,
      message: 'git fetch by URL into the app repo with no refspec - it writes FETCH_HEAD alone and leaves refs/remotes/origin/main frozen, so every later update reads as an outgoing commit in the editor',
      fix: 'name the destination: pass _appUpdateFetchArgs(root, authUrl) (server.js), or the ORIGIN_MAIN_REFSPEC constant from scripts/_app-repo-adopt.js - keep the URL, the token must stay out of remote.origin.url',
    });
  }
}

/**
 * proto-shell-autostash (BLOCK) - `--autostash` on a git call into the
 * prototype build shell (`_protoGitExec`).
 *
 * When the stashed local change touches a file the pull brings in, git
 * re-applies it WITH CONFLICTS and still exits 0 ("Applying autostash
 * resulted in conflicts"). The publish took that as success, left UU files in
 * data-sub-repositories/data-prototypes/, and every later publish from that
 * machine died on "Pulling is not possible because you have unmerged files"
 * (2026-10-08). The shell syncs only through _protoShellSyncWithOrigin, which
 * parks overlapping files in a named stash first and checks for unmerged
 * paths afterwards. Data-repo pulls (`d.gitExecFn`) are out of THIS rule's
 * scope; autostash-unmerged-gate below covers every `--autostash` call.
 */
const _PROTO_AUTOSTASH_SELF = new Set(['scripts/check-conventions.js']);

function ruleProtoShellAutostash(rep, file) {
  if (!_SERVER_CODE_RE.test(file.path)) return;
  if (_PROTO_AUTOSTASH_SELF.has(file.path)) return;
  for (const { line, text } of file.added) {
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
    if (!/_protoGitExec\s*\(/.test(text)) continue;
    if (!/['"`]--autostash['"`]/.test(text)) continue;
    rep.block({
      rule: 'proto-shell-autostash', file: file.path, line,
      message: '`--autostash` on the prototype build shell - a conflicting re-apply exits 0, leaves UU files in data-prototypes/ and blocks every later publish from that machine',
      fix: 'sync the shell through _protoShellSyncWithOrigin (server.js): it parks files changed both locally and in origin in a named stash and refuses on any unmerged path after the pull',
    });
  }
}

/**
 * autostash-unmerged-gate (BLOCK) - a `--autostash` git call with no check
 * for unmerged paths in the lines that follow it.
 *
 * The general form of proto-shell-autostash, wherever the pull runs. A
 * conflicting autostash re-apply exits 0, so the exit code proves nothing; the
 * index does. 2026-10-09: `_repoPull` on Mini aplikacje took that 0 as success,
 * left four UU `.enc` files in the mirror, decryptTree aborted on the first of
 * them and the plaintext silently stayed at the previous pull - a teammate's
 * files included - one "Send" away from overwriting their work. A pull
 * passes when `--diff-filter=U` (or a helper named *unmerged* or
 * *AutostashConflict*, e.g. `_repoAutostashConflict`) appears within
 * the next AUTOSTASH_GATE_WINDOW lines of the post-change file.
 */
const AUTOSTASH_GATE_WINDOW = 40;

function ruleAutostashUnmergedGate(rep, file, root) {
  if (!_SERVER_CODE_RE.test(file.path)) return;
  if (_PROTO_AUTOSTASH_SELF.has(file.path)) return;
  const post = readPost(root, file.path);
  const postLines = post === null ? null : post.split('\n');
  const addedByLine = new Map(file.added.map((a) => [a.line, a.text]));
  for (const { line, text } of file.added) {
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
    if (!/['"`]--autostash['"`]/.test(text)) continue;
    if (/_protoGitExec\s*\(/.test(text)) continue; // proto-shell-autostash owns that one
    const after = [];
    for (let n = line + 1; n <= line + AUTOSTASH_GATE_WINDOW; n++) {
      const t = postLines ? postLines[n - 1] : addedByLine.get(n);
      if (t !== undefined) after.push(t);
    }
    if (after.some((t) => /--diff-filter=U|unmerged|AutostashConflict\s*\(/i.test(t))) continue;
    rep.block({
      rule: 'autostash-unmerged-gate', file: file.path, line,
      message: '`--autostash` with no unmerged-path check after it - a conflicting re-apply exits 0 and leaves UU files that the caller then treats as a clean pull',
      fix: "right after the pull, run `git diff --name-only --diff-filter=U` and refuse on any path (see _repoAutostashConflict in _repoPull / _protoShellSyncWithOrigin in server.js); for an encrypted mirror, merge on plaintext first (_repoReconcileBeforePull)",
    });
  }
}

// R14 - the boot-time manifest snapshot read as if it were the disk.
// GET /api/modules/manifest answers what loadModules() LOADED at boot (hence
// `restartRequired` everywhere); GET /api/modules/installed is the fresh disk
// scan. A browser file that compares versions, checks dirtiness or lists what
// is installed off the manifest sees a module.json bumped after the last
// restart as the old version (2026-09-13: six up-to-date modules offered
// "Aktualizuj" in the Katalog, straight into the 409 module-dirty guard).
// js/module-host.js is the one legitimate consumer - it builds the sidebar
// and VIEW_REGISTRY for the modules that ARE loaded, which is the snapshot's
// only true meaning.
const _MANIFEST_SNAPSHOT_RE = /\/api\/modules\/manifest\b/;
const _MANIFEST_SNAPSHOT_ALLOWED = new Set(['js/module-host.js']);
const _BROWSER_CODE_RE = /^(js\/.*\.(js|mjs)|modules\/[^/]+\/client\/.*\.(js|mjs))$/;

function ruleManifestSnapshot(rep, file) {
  if (!_BROWSER_CODE_RE.test(file.path)) return;
  if (_MANIFEST_SNAPSHOT_ALLOWED.has(file.path)) return;
  for (const { line, text } of file.added) {
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
    if (R.NEGATION_RE.test(text)) continue;
    if (!_MANIFEST_SNAPSHOT_RE.test(text)) continue;
    rep.warn({
      rule: 'manifest-boot-snapshot', file: file.path, line,
      message: 'GET /api/modules/manifest is the boot-time loadModules() snapshot - a module.json changed after the last restart is invisible there',
      fix: 'read installed modules, their versions and git state from GET /api/modules/installed (fresh disk scan); the manifest is for what is LOADED - js/module-host.js only',
    });
  }
}

/**
 * R13 - who owns the core on this machine. The team builds MODULES; the core
 * is a base people pull. On a machine that has not opted in
 * (scripts/_core-scope.js), a changed file outside modules/ is a BLOCK.
 *
 * Two things keep this from being a nuisance. It only fires in a scope that
 * describes real work - `--files` and `--diff-file` are an explicit manual
 * selection, and the whole existing test corpus drives the checker that way.
 * And a file whose entire diff is one GENERATED line (the `model:` preference,
 * the GitNexus banner) is reported as a NOTE in every scope instead: nobody
 * typed it, so it must not read as editing the core, but it must not ride into
 * a commit on `git add -A` either.
 */
function ruleCoreScope(rep, files, root, mode) {
  const { blocked, generated } = CS.partitionCoreChanges(files);

  for (const g of generated) {
    rep.note({
      rule: 'generated-line', file: g.path,
      message: 'the whole diff is a generated line (' + g.what + ')',
      fix: 'keep it out of the commit - `git restore ' + g.path + '`, or skip it when staging',
    });
  }

  if (!CS.coreScopeApplies(mode)) return;
  if (CS.coreEditAllowedIn(root)) return;
  for (const b of blocked) {
    rep.block({
      rule: 'core-scope', file: b.path,
      message: 'core file changed on a machine that has not opted in',
      fix: 'the team\'s work goes into modules/; a core maintainer creates '
        + CS.CORE_DEV_MARKER + ' locally (it is gitignored)',
    });
  }
}

// ---------------------------------------------------------------------------

function run(flags) {
  const root = flags.root ? path.resolve(String(flags.root)) : R.ROOT;

  let scope;
  if (flags.modules) {
    const list = listModuleFiles(root);
    if (list.length === 0) {
      const empty = new R.Report('check-conventions', { scope: 'modules', changed_files: 0 });
      empty.info('No modules installed under modules/ - nothing to check.');
      return empty;
    }
    // Reuse the --files path verbatim (whole content treated as added), then
    // relabel the mode so the caller can tell the two scopes apart.
    scope = R.resolveScope({ files: list.join(',') }, { root });
    scope.mode = 'modules';
  } else {
    scope = R.resolveScope(flags, { root });
  }

  const files = scope.files.filter((f) => f.status !== 'D');

  const rep = new R.Report('check-conventions', {
    scope: scope.mode,
    changed_files: files.length,
  });
  const templateCache = new Map(); // path -> template-literal ranges, one run only
  if (scope.degraded && scope.reason) rep.info('NOTE: ' + scope.reason);
  if (scope.mode === 'no-baseline') {
    rep.note({ rule: 'scope', message: 'no diff baseline - nothing checked', fix: 'pass --files a,b or --diff-file <path>' });
    return rep;
  }

  for (const f of files) {
    ruleDsElements(rep, f);
    ruleAscii(rep, f, root, templateCache);
    rulePerspectives(rep, f);
    ruleJsonResponse(rep, f);
    ruleServerSections(rep, f, root);
    rulePort(rep, f);
    ruleForbidden(rep, f);
    ruleModalOpen(rep, f);
    ruleDsCompanions(rep, f);
    ruleHexColors(rep, f);
    ruleRootImage(rep, f);
    ruleBtnPrimaryPerView(rep, f);
    ruleBtnHeaderSize(rep, f);
    ruleModalA11y(rep, f);
    ruleWindowConfirmInModule(rep, f);
    ruleIconBtnAria(rep, f);
    ruleDsCalloutStack(rep, f);
    ruleMdNonEnglish(rep, f);
    ruleUiNonEnglish(rep, f, root, templateCache);
    ruleLayoutA11y(rep, f);
    ruleTabsAriaHalf(rep, f);
    ruleSpawnEnvSpread(rep, f);
    ruleDetachedOnWin32(rep, f);
    ruleAppFetchRefspec(rep, f);
    ruleProtoShellAutostash(rep, f);
    ruleAutostashUnmergedGate(rep, f, root);
    ruleStdioInheritInProcess(rep, f);
    ruleManifestSnapshot(rep, f);
    ruleModuleDataUndeclared(rep, f, root);
    ruleModuleDataRepoUnknown(rep, f, root);
  }
  ruleViewTriple(rep, files, root, scope.mode);
  ruleRouteTest(rep, files, root);
  ruleFlexOnTableCell(rep, files);
  // scope.files, not `files`: the shared list drops status 'D' before any rule
  // sees it (the content rules have nothing to read in a deleted file), but
  // deleting a core file IS changing the core.
  ruleCoreScope(rep, scope.files, root, scope.mode);

  return rep;
}

function main() {
  const { flags } = R.parseArgs(process.argv.slice(2), { booleans: ['staged', 'modules'] });
  if (flags.help) R.showHelp(HELP);
  const rep = run(flags);
  rep.emit(flags, 'GUARDIAN');
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('check-conventions internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = {
    run, viewTripleState, ruleDsElements, ruleAscii, ruleModalOpen, ruleDsCompanions, ruleHexColors, ruleCoreScope, listModuleFiles,
    ruleBtnPrimaryPerView, ruleBtnHeaderSize, ruleModalA11y, ruleWindowConfirmInModule, ruleIconBtnAria, ruleDsCalloutStack,
    ruleMdNonEnglish, ruleUiNonEnglish, DATA_REPO_IDS,
  };
}
