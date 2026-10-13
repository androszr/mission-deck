// tests/test_diff_digest.mjs
// Diff parsing and the size verdict of scripts/diff-digest.js, exercised on
// fixture diffs written to a temp dir - never against the live repo files.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = require(path.join(ROOT, 'scripts', 'diff-digest.js'));
const report = require(path.join(ROOT, 'scripts', '_report.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-fix-'));

function diffFile(name, text) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

function hunk(file, added, removed = [], status = 'M') {
  const head = ['diff --git a/' + file + ' b/' + file];
  if (status === 'A') head.push('new file mode 100644');
  head.push('--- a/' + file, '+++ b/' + file, '@@ -1,' + removed.length + ' +1,' + added.length + ' @@');
  return head.concat(removed.map((l) => '-' + l), added.map((l) => '+' + l)).join('\n') + '\n';
}

function run(text) {
  return digest.run({ 'diff-file': diffFile('d' + Math.random().toString(36).slice(2) + '.diff', text) });
}

test('parseUnifiedDiff tracks per-file +/- counts and post-image line numbers', () => {
  const files = report.parseUnifiedDiff(hunk('js/a.js', ['const a = 1;', 'const b = 2;'], ['const old = 0;']));
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].path, 'js/a.js');
  assert.strictEqual(files[0].addedCount, 2);
  assert.strictEqual(files[0].removedCount, 1);
  assert.strictEqual(files[0].added[0].line, 1);
  assert.strictEqual(files[0].added[1].line, 2);
});

test('a new file is marked A', () => {
  const files = report.parseUnifiedDiff(hunk('js/new.js', ['const x = 1;'], [], 'A'));
  assert.strictEqual(files[0].status, 'A');
});

test('added and removed top-level symbols are extracted', () => {
  const d = run(hunk('js/a.js',
    ['export function renderRaportyView() {}', 'const HELPERS = {};', 'class Foo {}'],
    ['function gone() {}']));
  assert.deepStrictEqual(d.added_symbols, ['js/a.js:Foo', 'js/a.js:HELPERS', 'js/a.js:renderRaportyView']);
  assert.deepStrictEqual(d.removed_symbols, ['js/a.js:gone']);
});

test('added routes are recovered from the dispatch ladder', () => {
  const d = run(hunk('server.js', [
    "  } else if (method === 'POST' && urlPath === '/api/raporty/save') {",
    '    dispatch(handleRaportySave, req, res);',
  ]));
  assert.deepStrictEqual(d.added_routes, ['POST /api/raporty/save']);
});

test('added views are recovered from all three legs, sub-routes excluded', () => {
  const d = run(
    hunk('index.html', ['  <div class="view-section" id="view-raporty"></div>'])
    + hunk('js/view-registry.js', ["  'raporty': {"])
    + hunk('js/sidebar-flyout-config.js', ["      { label: 'R', view: 'raporty' },", "      { label: 'D', view: 'dokumenty/x' },"]));
  assert.deepStrictEqual(d.added_views, ['raporty']);
});

test('added tests are recovered by name and by new file', () => {
  const d = run(hunk('tests/test_api_raporty.js', ["test('GET /api/raporty/list answers JSON', async () => {"], [], 'A'));
  assert.ok(d.added_tests.includes('tests/test_api_raporty.js (new file)'));
  assert.ok(d.added_tests.includes('tests/test_api_raporty.js: GET /api/raporty/list answers JSON'));
});

test('a comment-and-blank-only change is reported as cosmetic', () => {
  const d = run(hunk('js/a.js', ['// a new comment', '']));
  assert.deepStrictEqual(d.cosmetic_files, ['js/a.js']);
  assert.strictEqual(d.touches_server_logic, false);
});

test('the size verdict flips at the documented threshold', () => {
  const small = run(hunk('js/a.js', Array.from({ length: 10 }, (_, i) => 'const a' + i + ' = 1;')));
  assert.strictEqual(small.size_class, 'small');
  assert.strictEqual(small.bug_scan_recommended, false);

  const big = run(hunk('js/a.js', Array.from({ length: report.SIZE_MAX_LINES + 1 }, (_, i) => 'const a' + i + ' = 1;')));
  assert.strictEqual(big.size_class, 'large');
  assert.strictEqual(big.bug_scan_recommended, true);

  const manyFiles = run(Array.from({ length: report.SIZE_MAX_FILES + 1 },
    (_, i) => hunk('js/f' + i + '.js', ['const a = 1;'])).join(''));
  assert.strictEqual(manyFiles.size_class, 'large');
});

test('a server.js logic change recommends the bug scan regardless of size', () => {
  const d = run(hunk('server.js', ['  const x = 1;']));
  assert.strictEqual(d.size_class, 'small');
  assert.strictEqual(d.touches_server_logic, true);
  assert.strictEqual(d.bug_scan_recommended, true);
});

test('a comment-only server.js change does not trigger the bug scan', () => {
  const d = run(hunk('server.js', ['  // just a note']));
  assert.strictEqual(d.touches_server_logic, false);
  assert.strictEqual(d.bug_scan_recommended, false);
});

test('both model vocabularies follow the same single threshold', () => {
  const small = run(hunk('js/a.js', ['const a = 1;']));
  // Dashed id: .claude/default-models.json and the server allowlist.
  assert.strictEqual(small.model_tier, report.TIER_SMALL_DASHED);
  assert.strictEqual(small.model_tier, 'claude-haiku-5-5');
  // Alias: the Agent tool's `model` enum (sonnet|opus|haiku|fable).
  assert.strictEqual(small.agent_model, report.TIER_SMALL_ALIAS);
  assert.strictEqual(small.agent_model, 'haiku');

  const big = run(hunk('js/a.js', Array.from({ length: report.SIZE_MAX_LINES + 1 }, () => 'const a = 1;')));
  assert.strictEqual(big.model_tier, 'claude-sonnet-5-5');
  assert.strictEqual(big.agent_model, 'sonnet');
});

test('a view-triple scaffold (5 files, ~90 lines) stays small', () => {
  // The canonical task in this repo. If this ever reports "large", the
  // conditional bug scan and the model tiering stop being conditional.
  const files = ['index.html', 'js/raporty.js', 'js/view-registry.js',
    'js/sidebar-flyout-config.js', 'tests/test_view_raporty.mjs'];
  const d = run(files.map((f) => hunk(f, Array.from({ length: 18 }, (_, i) => 'line ' + i))).join(''));
  assert.strictEqual(d.totals.files, 5);
  assert.strictEqual(d.size_class, 'small');
  assert.strictEqual(d.bug_scan_recommended, false);
  assert.strictEqual(d.agent_model, 'haiku');
});

test('the same path appearing twice in a diff yields one file record', () => {
  const d = run(hunk('js/a.js', ['const a = 1;']) + hunk('js/a.js', ['const b = 2;']));
  assert.strictEqual(d.totals.files, 1);
  assert.strictEqual(d.totals.added, 2);
});

test('an empty diff yields an empty, non-blocking digest', () => {
  const d = run('');
  assert.strictEqual(d.totals.files, 0);
  assert.strictEqual(d.size_class, 'small');
  assert.match(digest.renderText(d), /No changed files\./);
});

test('resolveScope reports no-baseline instead of guessing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  const scope = report.resolveScope({}, { root: empty });
  assert.strictEqual(scope.mode, 'no-baseline');
  assert.ok(scope.degraded);
  assert.match(scope.reason, /no commit to diff against/);
});

test('resolveScope --files treats whole files as added', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const a = 1;\nconst b = 2;\n', 'utf8');
  const scope = report.resolveScope({ files: 'a.js' }, { root: dir });
  assert.strictEqual(scope.mode, 'files');
  assert.strictEqual(scope.files[0].path, 'a.js');
  assert.strictEqual(scope.files[0].added[0].line, 1);
});

// modules/ is gitignored, so no git-scoped digest can ever see module code.
// Every audit lens is scoped to this envelope, which means silence here would
// read as "nothing to review" exactly when a module is the thing that changed.
test('the digest declares the module code no diff can cover', () => {
  const d = digest.run({ mode: 'files', files: ['server.js'] });
  assert.ok(Array.isArray(d.installed_modules), 'installed_modules must always be an array');
  assert.strictEqual(typeof d.modules_invisible_to_diff, 'boolean');
  // The flag must agree with the list, or a reviewer is told the opposite of
  // what the envelope carries.
  assert.strictEqual(d.modules_invisible_to_diff, d.installed_modules.length > 0);
  for (const m of d.installed_modules) {
    assert.strictEqual(typeof m.id, 'string');
    assert.ok(m.id.length > 0);
    assert.strictEqual(typeof m.files, 'number');
  }
});
