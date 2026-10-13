#!/usr/bin/env node
'use strict';
// scripts/diff-digest.js
// A compact structured digest of a change set, carried in agent prompts INSTEAD
// of the raw diff. Agents get the shape plus the file paths and read only the
// parts they actually need.
//
//   node scripts/diff-digest.js --base main
//   node scripts/diff-digest.js --staged --json
//   node scripts/diff-digest.js --files js/foo.js,server.js
//
// It also emits the size verdict itself (`size_class`, `bug_scan_recommended`)
// from the single threshold in scripts/_report.js, so no caller has to count
// lines and the /new-idea gate and the model tiering cannot drift apart.
//
// Exit: 0 always when the scope resolved (a digest is information, not a gate),
// 2 on a usage error.

const fs = require('fs');
const path = require('path');
const R = require('./_report');

const HELP = `
diff-digest.js - compact structured digest of a change set

Usage:
  node scripts/diff-digest.js [--base <ref>] [--staged] [--files a,b]
                              [--diff-file <path>] [--root <dir>] [--json]

Reports: changed files with +/- counts, added and removed top-level symbols,
added routes, added views, added tests, cosmetic-only files, and the size class
(threshold: > ${R.SIZE_MAX_LINES} changed lines or > ${R.SIZE_MAX_FILES} files = "large").

Exit codes: 0 ok, 2 usage or internal error.
`;

const SYMBOL_RES = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=/,
];

function symbolsIn(lines) {
  const out = [];
  for (const { text } of lines) {
    for (const re of SYMBOL_RES) {
      const m = re.exec(text);
      if (m) { out.push(m[1]); break; }
    }
  }
  return out;
}

function uniqSorted(arr) { return Array.from(new Set(arr)).sort(); }

/**
 * Installed modules and how many files each carries. Read straight off disk,
 * because `modules/` is gitignored and therefore invisible to every git-based
 * scope this script otherwise uses.
 * @returns {Array<{id: string, files: number}>}
 */
function listInstalledModules() {
  const base = path.join(process.cwd(), 'modules');
  let ids;
  try {
    ids = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch (e) {
    // A repo with no modules/ is the normal case; anything else is a real
    // failure and must not be swallowed into an empty list that reads as
    // "nothing installed".
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  return ids.map((id) => {
    let count = 0;
    (function walk(rel) {
      let list;
      try { list = fs.readdirSync(path.join(base, id, rel), { withFileTypes: true }); } catch (_e) { return; }
      for (const e of list) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const next = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(next);
        else count++;
      }
    })('');
    return { id, files: count };
  });
}

function run(flags) {
  const root = flags.root ? path.resolve(String(flags.root)) : R.ROOT;
  const scope = R.resolveScope(flags, { root });
  const files = scope.files;

  const digest = {
    scope: scope.mode,
    degraded: scope.degraded,
    reason: scope.reason,
    files: [],
    added_symbols: [],
    removed_symbols: [],
    added_routes: [],
    added_views: [],
    added_tests: [],
    cosmetic_files: [],
    totals: { files: 0, added: 0, removed: 0, changed: 0 },
    size_class: 'small',
    bug_scan_recommended: false,
    installed_modules: [],
    modules_invisible_to_diff: false,
    thresholds: { max_lines: R.SIZE_MAX_LINES, max_files: R.SIZE_MAX_FILES },
  };

  for (const f of files) {
    digest.files.push({ path: f.path, status: f.status, added: f.addedCount, removed: f.removedCount });
    digest.totals.added += f.addedCount;
    digest.totals.removed += f.removedCount;

    if (R.isCosmeticFile(f)) digest.cosmetic_files.push(f.path);

    if (/\.(js|mjs|cjs)$/i.test(f.path)) {
      digest.added_symbols.push(...symbolsIn(f.added).map((s) => f.path + ':' + s));
      digest.removed_symbols.push(...symbolsIn(f.removed).map((s) => f.path + ':' + s));
    }

    if (path.basename(f.path) === 'server.js') {
      for (const { text } of f.added) {
        const m = /method\s*===\s*'([A-Z]+)'[\s\S]{0,60}?urlPath\s*(?:===|\.startsWith\()\s*'([^']+)'/.exec(text);
        if (m && m[2].startsWith('/api/')) digest.added_routes.push(m[1] + ' ' + m[2]);
        else {
          const p = /urlPath\s*(?:===|\.startsWith\()\s*'(\/api\/[^']+)'/.exec(text);
          if (p) digest.added_routes.push('? ' + p[1]);
        }
      }
    }

    if (f.path === 'index.html') {
      for (const { text } of f.added) {
        const m = /id="view-([a-z0-9-]+)"/.exec(text);
        if (m && /view-section/.test(text)) digest.added_views.push(m[1]);
      }
    }
    if (f.path === 'js/view-registry.js') {
      for (const { text } of f.added) {
        const m = /^\s*'([a-z0-9-]+)'\s*:\s*\{/.exec(text);
        if (m) digest.added_views.push(m[1]);
      }
    }
    if (f.path === 'js/sidebar-flyout-config.js') {
      for (const { text } of f.added) {
        const m = /view:\s*'([a-z0-9-]+(?:\/[a-z0-9-]+)*)'/.exec(text);
        if (m && m[1].indexOf('/') === -1) digest.added_views.push(m[1]);
      }
    }

    if (/^tests\//.test(f.path)) {
      if (f.status === 'A') digest.added_tests.push(f.path + ' (new file)');
      for (const { text } of f.added) {
        const m = /^\s*(?:await\s+)?(?:test|it)\s*\(\s*['"`](.+?)['"`]/.exec(text);
        if (m) digest.added_tests.push(f.path + ': ' + m[1]);
      }
    }
  }

  digest.totals.files = digest.files.length;
  digest.totals.changed = digest.totals.added + digest.totals.removed;
  digest.added_symbols = uniqSorted(digest.added_symbols);
  digest.removed_symbols = uniqSorted(digest.removed_symbols);
  digest.added_routes = uniqSorted(digest.added_routes);
  digest.added_views = uniqSorted(digest.added_views);
  digest.added_tests = uniqSorted(digest.added_tests);
  digest.cosmetic_files = uniqSorted(digest.cosmetic_files);
  digest.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const large = digest.totals.changed > R.SIZE_MAX_LINES || digest.totals.files > R.SIZE_MAX_FILES;
  digest.size_class = large ? 'large' : 'small';
  const touchesServerLogic = digest.files.some((f) => path.basename(f.path) === 'server.js')
    && !digest.cosmetic_files.includes('server.js');
  digest.touches_server_logic = touchesServerLogic;
  digest.bug_scan_recommended = large || touchesServerLogic;
  // model_tier   -> .claude/default-models.json vocabulary (dashed id)
  // agent_model   -> the Agent tool's `model` enum (sonnet|opus|haiku|fable).
  // Passing a dashed id to Agent({model}) throws InputValidationError.
  // modules/ is gitignored, so NOTHING under it can ever reach a diff - every
  // lens scoped to this digest is blind to module code by construction. Since
  // a module is now publishable to the whole team, silence here would read as
  // "nothing to review" when the opposite is true. List what is installed and
  // say plainly that the diff does not cover it; the reviewer then reads those
  // files directly or runs `check-conventions.js --modules`.
  digest.installed_modules = listInstalledModules();
  digest.modules_invisible_to_diff = digest.installed_modules.length > 0;

  digest.model_tier = large ? R.TIER_LARGE_DASHED : R.TIER_SMALL_DASHED;
  digest.agent_model = large ? R.TIER_LARGE_ALIAS : R.TIER_SMALL_ALIAS;

  return digest;
}

function renderText(d) {
  const out = [];
  out.push('DIFF DIGEST  scope: ' + d.scope
    + '  files: ' + d.totals.files
    + '  +' + d.totals.added + ' -' + d.totals.removed
    + '  size: ' + d.size_class);
  if (d.reason) out.push('NOTE: ' + d.reason);
  out.push('bug scan recommended: ' + (d.bug_scan_recommended ? 'yes' : 'no')
    + '  (threshold: >' + d.thresholds.max_lines + ' lines or >' + d.thresholds.max_files
    + ' files, or server.js logic)   auditor model: ' + d.agent_model + ' (' + d.model_tier + ')');
  if (d.modules_invisible_to_diff) {
    out.push('');
    out.push('Modules NOT covered by this digest (modules/ is gitignored, so no diff can see them):');
    for (const m of d.installed_modules) out.push('  ' + m.id + '  (' + m.files + ' files)');
    out.push('  Review them directly: node scripts/check-conventions.js --modules');
  }
  out.push('');
  if (d.files.length === 0) { out.push('No changed files.'); return out.join('\n') + '\n'; }

  out.push('Files');
  for (const f of d.files) {
    out.push('  ' + f.status + ' ' + f.path + '  +' + f.added + ' -' + f.removed
      + (d.cosmetic_files.includes(f.path) ? '  [cosmetic only]' : ''));
  }
  const band = (title, arr) => {
    if (arr.length === 0) return;
    out.push('');
    out.push(title + ' (' + arr.length + ')');
    for (const a of arr) out.push('  ' + a);
  };
  band('Added symbols', d.added_symbols);
  band('Removed symbols', d.removed_symbols);
  band('Added routes', d.added_routes);
  band('Added views', d.added_views);
  band('Added tests', d.added_tests);
  return out.join('\n') + '\n';
}

function main() {
  const { flags } = R.parseArgs(process.argv.slice(2), { booleans: ['staged'] });
  if (flags.help) R.showHelp(HELP);
  const d = run(flags);
  if (flags.json) process.stdout.write(JSON.stringify(d, null, 2) + '\n');
  else process.stdout.write(renderText(d));
  process.exit(0);
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('diff-digest internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { run, renderText, symbolsIn };
}
