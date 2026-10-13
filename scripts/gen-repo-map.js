#!/usr/bin/env node
'use strict';
// scripts/gen-repo-map.js
// Regenerates the machine-derivable half of
// .claude/skills/new-idea/templates/repo-map/overview.md from the tree, so the
// /new-idea planner reads a map that is always current instead of exploring.
//
//   node scripts/gen-repo-map.js            # rewrite the generated region
//   node scripts/gen-repo-map.js --check    # drift gate, exit 1 when stale
//   node scripts/gen-repo-map.js --stdout   # print the generated region only
//
// Only the region between the markers is touched:
//     <!-- generated:start -->  ...  <!-- generated:end -->
// Everything outside (stack summary, tree, footguns) is hand-written prose and
// is never rewritten. Output is fully sorted, so a re-run produces no diff.
//
// Exit: 0 ok / in sync, 1 drift under --check, 2 usage or internal error.

const fs = require('fs');
const path = require('path');
const R = require('./_report');

const HELP = `
gen-repo-map.js - regenerate the derived half of the /new-idea repo map

Usage:
  node scripts/gen-repo-map.js [--check] [--stdout] [--root <dir>]
                               [--out <path>] [--json]

  --check   do not write; exit 1 when the file is out of date
  --stdout  print the generated region and exit
  --out     target file (default .claude/skills/new-idea/templates/repo-map/overview.md)

Exit codes: 0 ok, 1 drift (--check only), 2 usage or internal error.
`;

const START = '<!-- generated:start -->';
const END = '<!-- generated:end -->';
const DEFAULT_OUT = path.join('.claude', 'skills', 'new-idea', 'templates', 'repo-map', 'overview.md');

// Box-drawing horizontal line, written as an escape so this file stays ASCII.
const BANNER_CHAR = '\u2500';

function readText(root, rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_e) { return null; }
}

function listDir(root, rel, filter) {
  try {
    return fs.readdirSync(path.join(root, rel)).filter(filter).sort();
  } catch (_e) { return []; }
}

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

/** VIEW_REGISTRY keys with their module and render function. */
function collectRegistry(root) {
  const text = readText(root, 'js/view-registry.js') || '';
  const body = /export const VIEW_REGISTRY\s*=\s*\{([\s\S]*?)\n\};/.exec(text);
  const out = [];
  if (!body) return out;
  const entryRe = /^\s*'([a-z0-9-]+)'\s*:\s*\{([\s\S]*?)^\s*\},/gm;
  let m;
  while ((m = entryRe.exec(body[1] + '\n')) !== null) {
    const inner = m[2];
    const mod = /import\('\.\/([^']+)'\)/.exec(inner);
    const render = /render:\s*'([^']+)'/.exec(inner);
    out.push({ id: m[1], module: mod ? 'js/' + mod[1] : '-', render: render ? render[1] : '-' });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** `#view-<id>` sections declared statically in index.html. */
function collectSections(root) {
  const html = readText(root, 'index.html') || '';
  const ids = new Set();
  const re = /class="view-section[^"]*"\s+id="view-([a-z0-9-]+)"|id="view-([a-z0-9-]+)"\s+class="view-section/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1] || m[2]);
  return Array.from(ids).sort();
}

/**
 * The rail's hubs and the pages the CORE ships in them, read from
 * js/core-hubs.mjs - the one place a hub is declared. js/sidebar-flyout-config.js
 * is a loop over that file, so it carries no hub literal to parse. Module pages
 * are not here: they arrive at boot from module.json.
 *
 * Rail ORDER is kept, because that is what the file declares and what the
 * planner needs to read; an alphabetical sort would invent an ordering.
 */
function collectHubs(root) {
  const text = readText(root, 'js/core-hubs.mjs') || '';
  const start = text.indexOf('export const CORE_HUBS');
  const hubs = [];
  if (start === -1) return hubs;
  const arrayStart = text.indexOf('[', start);
  if (arrayStart === -1) return hubs;

  // Walk the array, taking each top-level object literal whole - a row is
  // either a one-liner or a multi-line object with a `pages` array.
  let depth = 0;
  let objStart = -1;
  for (let i = arrayStart; i < text.length; i++) {
    const c = text[i];
    if (c === ']' && depth === 0) break;
    if (c === '{') { if (depth === 0) objStart = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const row = text.slice(objStart, i + 1);
        const id = /\bid: '([a-z0-9-]+)'/.exec(row);
        if (id) {
          const label = /\blabel: '((?:[^'\\]|\\.)*)'/.exec(row);
          const items = [];
          const itemRe = /view: '([a-z0-9-]+(?:\/[a-z0-9-]+)*)'/g;
          let it;
          while ((it = itemRe.exec(row)) !== null) items.push(it[1]);
          hubs.push({ id: id[1], label: label ? label[1] : id[1], items });
        }
        objStart = -1;
      }
    }
  }
  return hubs;
}

/**
 * Routes from the dispatch ladder, grouped by the inline `// Group ---` comment.
 * Recovers the irregular arms too: `urlPath.startsWith(...)` and the
 * `_isWave2Route(urlPath)` / static-fallback arms.
 */
function collectRoutes(root) {
  const text = readText(root, 'server.js') || '';
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => new RegExp('^//\\s*' + BANNER_CHAR + '+\\s*Route dispatch').test(l));
  if (startIdx === -1) return { groups: [], total: 0, found: false };
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (new RegExp('^//\\s*' + BANNER_CHAR + '{2,}').test(lines[i])) { endIdx = i; break; }
  }

  const groups = [];
  let cur = { name: 'Ungrouped', routes: [] };
  let total = 0;
  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i];
    const g = /^\s*\/\/\s+([A-Za-z0-9 /()_.-]+?)\s*-{3,}\s*$/.exec(line);
    if (g) {
      if (cur.routes.length) groups.push(cur);
      cur = { name: g[1].trim(), routes: [] };
      continue;
    }
    const eq = /method\s*===\s*'([A-Z]+)'\s*&&\s*urlPath\s*===\s*'([^']+)'/.exec(line);
    if (eq) { cur.routes.push(eq[1] + ' ' + eq[2]); total++; continue; }
    const sw = /method\s*===\s*'([A-Z]+)'\s*&&\s*urlPath\.startsWith\(\s*'([^']+)'/.exec(line);
    if (sw) { cur.routes.push(sw[1] + ' ' + sw[2] + '*'); total++; continue; }
    const helper = /\}\s*else if\s*\(\s*(_[A-Za-z0-9_]+)\(\s*urlPath\s*\)\s*\)/.exec(line);
    if (helper) { cur.routes.push('(matched by ' + helper[1] + ')'); total++; continue; }
    const bareEq = /urlPath\s*===\s*'([^']+)'/.exec(line);
    if (bareEq && /else if|^\s*if\s*\(/.test(line)) { cur.routes.push('? ' + bareEq[1]); total++; }
  }
  if (cur.routes.length) groups.push(cur);
  for (const gr of groups) gr.routes.sort();
  return { groups, total, found: true };
}

/** WebSocket upgrade paths handled outside the dispatch ladder. */
function collectUpgrades(root) {
  const text = readText(root, 'server.js') || '';
  const out = new Set();
  const re = /pathname\s*(?:===|\.startsWith\()\s*'(\/api\/[^']+)'/g;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return Array.from(out).sort();
}

/** server.js section headers, in file order. */
function collectServerSections(root) {
  const text = readText(root, 'server.js') || '';
  const out = [];
  const re = new RegExp('^//\\s*' + BANNER_CHAR + '+\\s*(.+?)\\s*' + BANNER_CHAR + '*\\s*$', 'gm');
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].replace(new RegExp(BANNER_CHAR + '+$'), '').trim();
    if (name) out.push(name);
  }
  return out;
}

/** One-line purpose for each js/ module, taken from its header comment. */
function collectModules(root) {
  // .mjs too: the DOM-free modules both sides share (js/core-hubs.mjs,
  // js/module-card.mjs, js/academy-stages.mjs) are exactly the files a
  // planner must see, and they were invisible here while the filter said .js.
  const files = listDir(root, 'js', (f) => f.endsWith('.js') || f.endsWith('.mjs'));
  const out = [];
  for (const f of files) {
    const text = readText(root, 'js/' + f) || '';
    const lines = text.split('\n').slice(0, 12);
    let purpose = '';
    for (const l of lines) {
      if (!/^\s*\/\//.test(l)) { if (l.trim() === '') continue; else break; }
      const body = l.replace(/^\s*\/\/\s?/, '').trim();
      if (!body) continue;
      // Skip the header banner line that only names the file.
      const bare = body
        .replace(new RegExp(BANNER_CHAR, 'g'), ' ')
        .replace(/(Starter|Product) Cockpit( 2\.0)?/gi, ' ')
        .replace(/(^|\s)[-\u2014\u2013]+(\s|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (bare === '' || bare === 'js/' + f || bare === f) continue;
      purpose = body
        .replace(new RegExp(BANNER_CHAR, 'g'), '')
        .replace(new RegExp('^\\s*((Starter|Product) Cockpit( 2\\.0)?)?\\s*[-\\u2014\\u2013]*\\s*(js/)?' + f.replace('.', '\\.') + '\\s*[-\\u2014\\u2013:]*\\s*'), '')
        .replace(/^\s*[-\u2014\u2013]+\s*/, '')
        .trim();
      break;
    }
    if (purpose.length > 120) purpose = purpose.slice(0, 117) + '...';
    out.push({ file: 'js/' + f, purpose: purpose || '-' });
  }
  return out;
}

function collectTests(root) {
  return {
    unit: listDir(root, 'tests', (f) => /^test_.*\.mjs$/.test(f)).map((f) => 'tests/' + f),
    api: listDir(root, 'tests', (f) => /^test_api_.*\.js$/.test(f)).map((f) => 'tests/' + f),
  };
}

function collectScripts(root) {
  return listDir(root, 'scripts', (f) => f.endsWith('.js')).map((f) => {
    const text = readText(root, 'scripts/' + f) || '';
    const lines = text.split('\n').slice(0, 10);
    let purpose = '';
    for (const l of lines) {
      if (!/^\s*\/\//.test(l)) continue;
      const body = l.replace(/^\s*\/\/\s?/, '').trim();
      if (!body || body === 'scripts/' + f || body.endsWith(f)) continue;
      if (/^!/.test(body)) continue;
      purpose = body;
      break;
    }
    if (purpose.length > 100) purpose = purpose.slice(0, 97) + '...';
    return { file: 'scripts/' + f, purpose: purpose || '-' };
  });
}

function collectTemplates(root) {
  const out = [];
  const walk = (rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (_e) { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = rel + '/' + e.name;
      if (e.isDirectory()) { if (depth < 2) walk(child, depth + 1); continue; }
      if (/\.(md|html)$/.test(e.name) && e.name.toLowerCase() !== 'readme.md') out.push(child);
    }
  };
  walk('templates', 0);
  return out.sort();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function generate(root) {
  const registry = collectRegistry(root);
  const sections = collectSections(root);
  const hubs = collectHubs(root);
  const routes = collectRoutes(root);
  const upgrades = collectUpgrades(root);
  const serverSections = collectServerSections(root);
  const modules = collectModules(root);
  const tests = collectTests(root);
  const scripts = collectScripts(root);
  const templates = collectTemplates(root);

  const L = [];
  L.push(START);
  L.push('<!-- Regenerated by `node scripts/gen-repo-map.js`. Do not hand-edit this region;');
  L.push('     `node scripts/gen-repo-map.js --check` fails when it is stale. -->');
  L.push('');

  L.push('## Views');
  L.push('');
  L.push('| View id | `#view-<id>` section | VIEW_REGISTRY | Module | Hub flyout |');
  L.push('|---|---|---|---|---|');
  const allIds = Array.from(new Set([].concat(
    sections,
    registry.map((r) => r.id),
    // Sub-route items (`dokumenty/claude-md`) belong to their parent view.
    hubs.reduce((acc, h) => acc.concat(h.items.filter((i) => i.indexOf('/') === -1)), []),
  ))).sort();
  const regById = new Map(registry.map((r) => [r.id, r]));
  const hubOf = new Map();
  for (const h of hubs) for (const it of h.items) hubOf.set(it, h.id);
  for (const id of allIds) {
    const r = regById.get(id);
    L.push('| `' + id + '` | ' + (sections.includes(id) ? 'yes' : 'no (boot placeholder)')
      + ' | ' + (r ? 'yes' : 'no')
      + ' | ' + (r ? '`' + r.module + '`' : '-')
      + ' | ' + (hubOf.has(id) ? '`' + hubOf.get(id) + '`' : '-') + ' |');
  }
  L.push('');
  L.push('The eight core hubs (js/core-hubs.mjs), in rail order, with the pages the CORE ships');
  L.push('in each. A hub is a flyout opener with no section of its own and redirects to the');
  L.push('dashboard when navigated to directly. Module pages are NOT listed - they are appended');
  L.push('at boot from module.json (`sidebar.kind: "page"` plus `sidebar.hub`):');
  L.push('');
  for (const h of hubs) {
    L.push('- `' + h.id + '` (' + h.label + ')' + (sections.includes(h.id) ? ' `+ page`' : '')
      + ' - ' + (h.items.length
        ? h.items.map((i) => '`' + i + '`').join(', ')
        : 'no core pages'));
  }
  L.push('');

  L.push('## Server sections');
  L.push('');
  L.push(serverSections.map((s) => '`' + s + '`').join(', ') + '.');
  L.push('');

  L.push('## Routes (dispatch ladder order)');
  L.push('');
  if (!routes.found) {
    L.push('_The `Route dispatch` section header was not found in `server.js`; routes not extracted._');
  } else {
    L.push('| Group | Routes |');
    L.push('|---|---|');
    for (const g of routes.groups) {
      L.push('| ' + g.name + ' | ' + g.routes.map((r) => '`' + r + '`').join(', ') + ' |');
    }
    L.push('');
    L.push('Total dispatch arms: ' + routes.total + '.');
    if (upgrades.length) L.push('WebSocket upgrade paths: ' + upgrades.map((u) => '`' + u + '`').join(', ') + '.');
  }
  L.push('');

  L.push('## Frontend modules');
  L.push('');
  L.push('| Module | Purpose |');
  L.push('|---|---|');
  for (const m of modules) L.push('| `' + m.file + '` | ' + m.purpose + ' |');
  L.push('');

  L.push('## Tests');
  L.push('');
  L.push('Unit (`node --test`, no server): ' + (tests.unit.length ? tests.unit.map((t) => '`' + t + '`').join(', ') : 'none') + '.');
  L.push('');
  L.push('API (spawn a server, sequential): ' + (tests.api.length ? tests.api.map((t) => '`' + t + '`').join(', ') : 'none') + '.');
  L.push('');

  L.push('## Scripts');
  L.push('');
  L.push('| Script | Purpose |');
  L.push('|---|---|');
  for (const s of scripts) L.push('| `' + s.file + '` | ' + s.purpose + ' |');
  L.push('');

  L.push('## Document templates');
  L.push('');
  L.push(templates.length ? templates.map((t) => '`' + t + '`').join(', ') + '.' : '_none_');
  L.push('');
  L.push(END);
  return L.join('\n');
}

function splice(existing, generated) {
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s === -1 || e === -1 || e < s) return null;
  return existing.slice(0, s) + generated + existing.slice(e + END.length);
}

function main() {
  const { flags } = R.parseArgs(process.argv.slice(2), { booleans: ['check', 'stdout'] });
  if (flags.help) R.showHelp(HELP);
  const root = flags.root ? path.resolve(String(flags.root)) : R.ROOT;
  const outRel = flags.out ? String(flags.out) : DEFAULT_OUT;
  const outAbs = path.isAbsolute(outRel) ? outRel : path.join(root, outRel);

  const generated = generate(root);
  if (flags.stdout) { process.stdout.write(generated + '\n'); process.exit(0); }

  const existing = R.readFileSafe(outAbs);
  if (existing === null) R.usageError('repo map not found: ' + outRel);
  const next = splice(existing, generated);
  if (next === null) {
    R.usageError('markers ' + START + ' / ' + END + ' not found in ' + outRel
      + ' - add them around the generated region first');
  }

  const drift = next !== existing;
  const result = { script: 'gen-repo-map', file: outRel, drift, mode: flags.check ? 'check' : 'write' };

  if (flags.check) {
    if (flags.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stdout.write(drift
      ? 'REPO MAP: STALE - run `node scripts/gen-repo-map.js` (' + outRel + ')\n'
      : 'REPO MAP: up to date (' + outRel + ')\n');
    process.exit(drift ? 1 : 0);
  }

  if (drift) fs.writeFileSync(outAbs, next, 'utf8');
  if (flags.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else process.stdout.write('REPO MAP: ' + (drift ? 'regenerated' : 'already current') + ' (' + outRel + ')\n');
  process.exit(0);
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('gen-repo-map internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = {
    generate, splice, collectRegistry, collectSections, collectHubs,
    collectRoutes, collectModules, collectScripts, collectServerSections, START, END,
  };
}
