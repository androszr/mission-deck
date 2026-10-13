// tests/test_check_conventions.mjs
// Rule logic of scripts/check-conventions.js, exercised against a fixture repo
// in a temp dir - never against the live repo files.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conventions = require(path.join(ROOT, 'scripts', 'check-conventions.js'));

/** Build a throwaway repo skeleton and return its root. */
function fixtureRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-fix-'));
  const base = {
    'index.html': '<main class="main">\n  <div class="view-section" id="view-dashboard"></div>\n</main>\n',
    'js/view-registry.js': "export const VIEW_REGISTRY = {\n\n  'dashboard': {\n    importFn: () => import('./dashboard.js'),\n    render: 'renderDashboardView',\n    runInit: (mod) => mod.initDashboard(),\n  },\n};\n",
    'js/sidebar-flyout-config.js': "export const HUB_FLYOUT = {\n  'area-a': {\n    label: 'Area A',\n    items: [\n      { label: 'A1', view: 'area-a-1' },\n    ],\n  },\n};\n",
    'js/dashboard.js': '// dashboard\n',
    'tests/test_api_infra.js': "// existing api tests\nconst p = '/api/app/version';\n",
  };
  for (const [rel, body] of Object.entries(Object.assign(base, files || {}))) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return dir;
}

/** Build a minimal unified diff that adds `lines` to `file`. */
function diffAdding(file, lines, startAt = 1) {
  const body = lines.map((l) => '+' + l).join('\n');
  return [
    'diff --git a/' + file + ' b/' + file,
    '--- a/' + file,
    '+++ b/' + file,
    '@@ -' + startAt + ',0 +' + startAt + ',' + lines.length + ' @@',
    body,
    '',
  ].join('\n');
}

function runOn(root, diffText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-diff-'));
  const dp = path.join(dir, 'change.diff');
  fs.writeFileSync(dp, diffText, 'utf8');
  return conventions.run({ 'diff-file': dp, root });
}

test('a bare <button> is a BLOCK, a ds-btn button is clean', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('index.html', ['  <button type="button" id="go">Save</button>']));
  assert.ok(bad.findings.some((f) => f.rule === 'ds-btn' && f.severity === 'BLOCK'));

  const good = runOn(root, diffAdding('index.html', ['  <button type="button" class="ds-btn ds-btn--primary">Save</button>']));
  assert.strictEqual(good.findings.filter((f) => f.rule === 'ds-btn').length, 0);
});

test('standalone documents under templates/ are outside the DS rules', () => {
  const root = fixtureRepo();
  // The 22-slide deck and the meeting report are self-contained HTML - they
  // never load css/ds.css, so a bare <button> there is by design.
  const deck = runOn(root, diffAdding('templates/prezentacja.template.html',
    ['  <button class="theme-toggle" title="Toggle theme (D)">&#9790;</button>']));
  assert.strictEqual(deck.findings.filter((f) => f.rule === 'ds-btn').length, 0);

  // The app's own markup is still held to the rule.
  const app = runOn(root, diffAdding('index.html', ['  <button class="theme-toggle">x</button>']));
  assert.ok(app.findings.some((f) => f.rule === 'ds-btn' && f.severity === 'BLOCK'));
});

test('an <input> without a DS class blocks, a checkbox does not', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('index.html', ['  <input type="text" id="q">']));
  assert.ok(bad.findings.some((f) => f.rule === 'ds-input' && f.severity === 'BLOCK'));

  const ok = runOn(root, diffAdding('index.html', ['  <input type="checkbox" id="flag">']));
  assert.strictEqual(ok.findings.filter((f) => f.rule === 'ds-input').length, 0);
});

test('non-ASCII letters in an identifier block, but in a UI string they do not', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js', ['function naïveCafé() { return 1; }']));
  assert.ok(bad.findings.some((f) => f.rule === 'ascii' && f.severity === 'BLOCK'));

  const inString = runOn(root, diffAdding('js/dashboard.js', ["const label = 'Café crème';"]));
  assert.strictEqual(inString.findings.filter((f) => f.rule === 'ascii').length, 0);

  // The repo's own banner style must never trip the rule.
  const banner = runOn(root, diffAdding('js/dashboard.js', ['// ── Mission Deck — js/dashboard.js ───']));
  assert.strictEqual(banner.findings.filter((f) => f.rule === 'ascii').length, 0);
});

test('accented copy inside a multi-line template literal is not an ASCII finding', () => {
  const body = [
    'export function render() {',
    '  return `',
    '    <div class="ds-card">',
    '      <h2>Café crème brûlée</h2>',
    '      <p>Click <strong>Save</strong> to go back to the list – naïve résumé.</p>',
    '    </div>`;',
    '}',
    '',
  ].join('\n');
  const root = fixtureRepo({ 'js/dashboard.js': body });
  const clean = runOn(root, diffAdding('js/dashboard.js', body.split('\n').slice(0, 7)));
  assert.strictEqual(clean.findings.filter((f) => f.rule === 'ascii').length, 0);

  // An identifier inside a ${...} hole is still code, and still a BLOCK.
  const bad = [
    'export function render() {',
    '  return `',
    '    <p>${naïve(1)}</p>`;',
    '}',
    '',
  ].join('\n');
  const root2 = fixtureRepo({ 'js/dashboard.js': bad });
  const rep = runOn(root2, diffAdding('js/dashboard.js', bad.split('\n').slice(0, 4)));
  assert.ok(rep.findings.some((f) => f.rule === 'ascii' && f.severity === 'BLOCK'));
});

test('HTML text that continues from the previous line may carry accented letters', () => {
  const root = fixtureRepo();
  // A wrapped text node: the copy sits BEFORE the first tag on the line.
  const wrapped = runOn(root, diffAdding('index.html', ['      The wizard will be available soon – café. Configure tokens in <a href="#view-settings">Settings</a>.']));
  assert.strictEqual(wrapped.findings.filter((f) => f.rule === 'ascii').length, 0);

  // A whole line of copy with no tag at all is legal too.
  const plain = runOn(root, diffAdding('index.html', ['      Save the changes to go back to the list – café crème.']));
  assert.strictEqual(plain.findings.filter((f) => f.rule === 'ascii').length, 0);

  // An attribute value is copy as well.
  const attr = runOn(root, diffAdding('index.html', ['  <input class="ds-input" placeholder="Search by user name – café">']));
  assert.strictEqual(attr.findings.filter((f) => f.rule === 'ascii').length, 0);
});

test('a bare ds-tabs-list warns about the variant, the framed one does not', () => {
  const root = fixtureRepo();
  // Both shapes are legitimate, so this is a WARN that asks which one it is -
  // a BLOCK would reject a correct full-width page strip.
  const bare = runOn(root, diffAdding('js/dashboard.js',
    ['  const html = `<nav class="ds-tabs-list foo-tabs" role="tablist">`;']));
  const hit = bare.findings.find((f) => f.rule === 'ds-tabs-variant');
  assert.ok(hit, 'a bare ds-tabs-list is reported');
  assert.strictEqual(hit.severity, 'WARN');

  const framed = runOn(root, diffAdding('js/dashboard.js',
    ['  const html = `<nav class="ds-tabs-list ds-framed-tabs foo-tabs" role="tablist">`;']));
  assert.strictEqual(framed.findings.filter((f) => f.rule === 'ds-tabs-variant').length, 0);
});

test('a querySelector for .ds-tabs-list is a lookup, not markup', () => {
  const root = fixtureRepo();
  const rep = runOn(root, diffAdding('js/dashboard.js',
    ["  const tablist = overlay.querySelector('.ds-tabs-list');"]));
  assert.strictEqual(rep.findings.filter((f) => f.rule === 'ds-tabs-variant').length, 0);
});

test('ds-segment is reported only when the change carries no ds-segmented', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js',
    ['  const html = `<button type="button" class="ds-segment active">Web</button>`;']));
  const hit = bad.findings.find((f) => f.rule === 'ds-segment-wrap');
  assert.ok(hit);
  assert.strictEqual(hit.severity, 'WARN');

  // The wrapper is looked for file-wide, not on a neighbouring line: segments
  // come out of a .map() whose body can sit far below its wrapper.
  const good = runOn(root, diffAdding('js/dashboard.js', [
    '  const html = `<div class="ds-segmented">',
    '    ${items.map(p => {',
    '      const on = p === active;',
    '      const label = p.toUpperCase();',
    '      const title = `Platforma ${label}`;',
    '      return `<button type="button" title="${title}" class="ds-segment${on ? \' active\' : \'\'}">${label}</button>`;',
    '    }).join(\'\')}',
    '  </div>`;',
  ]));
  assert.strictEqual(good.findings.filter((f) => f.rule === 'ds-segment-wrap').length, 0);
});

test('a data-perspective attribute is a BLOCK', () => {
  const root = fixtureRepo();
  const rep = runOn(root, diffAdding('index.html', ['  <div data-perspective="pm"></div>']));
  assert.ok(rep.findings.some((f) => f.rule === 'no-perspectives' && f.severity === 'BLOCK'));
});

test('res.end(JSON.stringify(...)) blocks instead of jsonResponse', () => {
  const root = fixtureRepo({ 'server.js': '// server\n' });
  const rep = runOn(root, diffAdding('server.js', ['  res.end(JSON.stringify({ ok: true }));']));
  assert.ok(rep.findings.some((f) => f.rule === 'json-response' && f.severity === 'BLOCK'));
});

test('a new view section without a registry entry blocks only when a module exists', () => {
  const withModule = fixtureRepo({ 'js/raporty.js': '// raporty\n' });
  const rep = runOn(withModule, diffAdding('index.html', ['  <div class="view-section" id="view-raporty"></div>']));
  assert.ok(rep.findings.some((f) => f.rule === 'view-triple' && f.severity === 'BLOCK'));

  const noModule = fixtureRepo();
  const rep2 = runOn(noModule, diffAdding('index.html', ['  <div class="view-section" id="view-statyczny"></div>']));
  assert.strictEqual(rep2.findings.filter((f) => f.rule === 'view-triple' && f.severity === 'BLOCK').length, 0);
});

test('a HUB_FLYOUT item with no section is a WARN, not a BLOCK (boot placeholder)', () => {
  const root = fixtureRepo();
  const rep = runOn(root, diffAdding('js/sidebar-flyout-config.js', ["      { label: 'A2', view: 'area-a-2' },"]));
  const f = rep.findings.find((x) => x.rule === 'view-triple');
  assert.ok(f, 'expected a view-triple finding');
  assert.strictEqual(f.severity, 'WARN');
});

test('a sub-route flyout item (dokumenty/claude-md) is never flagged', () => {
  const root = fixtureRepo();
  const rep = runOn(root, diffAdding('js/sidebar-flyout-config.js', ["      { label: 'Doc', view: 'dokumenty/claude-md' },"]));
  assert.strictEqual(rep.findings.filter((x) => x.rule === 'view-triple').length, 0);
});

test('a new route with no api test blocks; an already-tested route does not', () => {
  const root = fixtureRepo({ 'server.js': '// server\n' });
  const bad = runOn(root, diffAdding('server.js', ["  } else if (method === 'GET' && urlPath === '/api/raporty/list') {"]));
  assert.ok(bad.findings.some((f) => f.rule === 'route-test' && f.severity === 'BLOCK'));

  const ok = runOn(root, diffAdding('server.js', ["  } else if (method === 'GET' && urlPath === '/api/app/version') {"]));
  assert.strictEqual(ok.findings.filter((f) => f.rule === 'route-test').length, 0);
});

test('forbidden operations block, but a "never do X" line does not', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js', ["  run('git reset --hard');"]));
  assert.ok(bad.findings.some((f) => f.rule === 'forbidden-op' && f.severity === 'BLOCK'));

  const ok = runOn(root, diffAdding('js/dashboard.js', ['  // Never run git reset --hard here.']));
  assert.strictEqual(ok.findings.filter((f) => f.rule === 'forbidden-op').length, 0);
});

test('a modal toggled with hidden alone warns; with the open class it does not', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js', ['  modalEl.hidden = false;']));
  assert.ok(bad.findings.some((f) => f.rule === 'modal-open' && f.severity === 'WARN'));

  const ok = runOn(root, diffAdding('js/dashboard.js', ['  modalEl.hidden = false;', "  modalEl.classList.add('open');"]));
  assert.strictEqual(ok.findings.filter((f) => f.rule === 'modal-open').length, 0);
});

test('a hex literal in styles.css blocks, a token declaration does not', () => {
  const root = fixtureRepo({ 'styles.css': '/* styles */\n' });
  const bad = runOn(root, diffAdding('styles.css', ['  color: #ff8800;']));
  assert.ok(bad.findings.some((f) => f.rule === 'hex-color' && f.severity === 'BLOCK'));

  const ok = runOn(root, diffAdding('styles.css', ['  --brand-accent: #00A651;']));
  assert.strictEqual(ok.findings.filter((f) => f.rule === 'hex-color').length, 0);
});

test('a port literal other than 3001 warns', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js', ["  fetch('http://localhost:8080/api/x');"]));
  assert.ok(bad.findings.some((f) => f.rule === 'port' && f.severity === 'WARN'));

  const ok = runOn(root, diffAdding('js/dashboard.js', ["  fetch('http://localhost:3001/api/x');"]));
  assert.strictEqual(ok.findings.filter((f) => f.rule === 'port').length, 0);
});

test('a port literal in demo/ is mocked copy, not a connection: no port warning', () => {
  const root = fixtureRepo();
  const rep = runOn(root, diffAdding('demo/chapters/x.mjs', ["  { role: 'tool', body: ['{\"url\": \"http://localhost:5173/x\"}'] },"]));
  assert.strictEqual(rep.findings.filter((f) => f.rule === 'port').length, 0);
});

test('an image added in the repo root blocks; the same image under assets/ does not', () => {
  const root = fixtureRepo();
  const binDiff = (file) => [
    'diff --git a/' + file + ' b/' + file,
    'new file mode 100644',
    'index 0000000..1111111',
    'Binary files /dev/null and b/' + file + ' differ',
    '',
  ].join('\n');
  const bad = runOn(root, binDiff('pip-s2-before.png'));
  assert.ok(bad.findings.some((f) => f.rule === 'root-image' && f.severity === 'BLOCK'));

  const ok = runOn(root, binDiff('assets/agents/proxy.png'));
  assert.strictEqual(ok.findings.filter((f) => f.rule === 'root-image').length, 0);
});

test('a clean diff produces PASS and exit code 0', () => {
  const root = fixtureRepo();
  const rep = runOn(root, diffAdding('js/dashboard.js', ['const total = 1 + 1;']));
  assert.strictEqual(rep.verdict(), 'PASS');
  assert.strictEqual(rep.exitCode(), 0);
});

test('viewTripleState reads all three legs from the post-image files', () => {
  const root = fixtureRepo();
  const state = conventions.viewTripleState(root);
  assert.ok(state.sections.has('dashboard'));
  assert.ok(state.reg.has('dashboard'));
  assert.ok(state.hub.has('area-a-1'));
});

// ── Regression: an unterminated quote must not shift the line map ─────────────
// A regex character class such as /[&<>"']/ carries a lone double quote. The
// scanner used to treat it as a string opener and swallow the newline, which
// dropped a line++ and handed every later line another line's template ranges.
// UI copy inside a template literal was then reported as bare code.

test('an unterminated quote does not disarm the ASCII rule for later lines', () => {
  // The negative half of the regression: the fix must keep FLAGGING real code
  // after the drift line, not merely stop flagging UI copy.
  const body = [
    'function esc(s) {',
    '  return String(s).replace(/[&<>"\']/g, (c) => c);',
    '}',
    '// a plain comment',
    'function naïve() { return 1; }',
    '',
  ].join('\n');
  const root = fixtureRepo({ 'js/dashboard.js': body });
  const rep = runOn(root, diffAdding('js/dashboard.js', body.split('\n').slice(0, 5)));
  assert.ok(
    rep.findings.some((f) => f.rule === 'ascii' && f.severity === 'BLOCK'),
    'a non-ASCII identifier after the regex line must still BLOCK',
  );
});

test('templateStringRanges: a regex char class with a quote does not shift later lines', () => {
  const report = require(path.join(ROOT, 'scripts', '_report.js'));
  const src = [
    'function esc(s) {',
    '  return String(s).replace(/[&<>"\']/g, (c) => c);',
    '}',
    'function view() {',
    '  return `',
    '    <div>Accented copy – café crème</div>',
    '  `;',
    '}',
  ].join('\n');
  const ranges = report.templateStringRanges(src);
  // The accented line is source line 6 and lives inside the template literal.
  assert.ok(ranges.has(6), 'line 6 must be recorded as template-string content');
  const [start, end] = ranges.get(6)[0];
  assert.ok(start === 0 && end > 20, 'the whole of line 6 must be string content');
});

test('templateStringRanges: a BACKTICK inside a regex char class does not open a template', () => {
  // The real one from js/academy.js:62 - a keyboard-shortcut matcher
  // whose class carries a backtick. Without regex-literal awareness the scanner
  // read that backtick as the start of a template literal, inverted every later
  // line's classification, and reported UI copy inside genuine templates
  // as bare code (four false BLOCKs).
  const report = require(path.join(ROOT, 'scripts', '_report.js'));
  const src = [
    'const KEY_RE = /(?:Cmd|Ctrl)(?:\\+(?:[A-Za-z0-9]+|[,.`\\\\/]))+/g;',
    '// a plain comment, must stay code',
    'const SCREENS = {',
    '  zsh: `',
    '    <div>Last login: today at 09:14</div>`,',
    '};',
  ].join('\n');
  const ranges = report.templateStringRanges(src);
  assert.ok(!ranges.has(2), 'the comment on line 2 must NOT be template content');
  assert.ok(!ranges.has(3), 'the object opener on line 3 must NOT be template content');
  assert.ok(ranges.has(5), 'the HTML text on line 5 MUST be template content');
});

test('templateStringRanges: division is not mistaken for a regex literal', () => {
  // The other half of the lexer ambiguity: `/` after an identifier or a closing
  // bracket is division. Treating it as a regex would swallow real code.
  const report = require(path.join(ROOT, 'scripts', '_report.js'));
  const src = [
    'const pct = done / total;',
    'const half = (a + b) / 2;',
    'const msg = `done ${pct} percent`;',
  ].join('\n');
  const ranges = report.templateStringRanges(src);
  assert.ok(!ranges.has(1), 'plain division must not open a regex');
  assert.ok(ranges.has(3), 'the template on line 3 must still be found');
});

test('accented letters inside a regex literal are copy, not code; a comment after a division still blocks', () => {
  const root = fixtureRepo();
  // The test suite asserts on UI labels with regex literals - the
  // scanner used to read the pattern as bare code (tests/test_sync_center_helpers.mjs:110).
  const inRegex = runOn(root, diffAdding('js/dashboard.js', ['    assert.match(label, /café crème was not there/);']));
  assert.strictEqual(inRegex.findings.filter((f) => f.rule === 'ascii').length, 0);

  // The literal legalises only its own span: the identifier next to it is still code.
  const identifier = runOn(root, diffAdding('js/dashboard.js', ['const naïve = /é/;']));
  assert.ok(identifier.findings.some((f) => f.rule === 'ascii' && f.severity === 'BLOCK'));

  // A slash after an identifier is division, so the comment behind it is scanned.
  const division = runOn(root, diffAdding('js/dashboard.js', ['const half = total / 2; // moitié']));
  assert.ok(division.findings.some((f) => f.rule === 'ascii' && f.severity === 'BLOCK'));
});

test('a quoted hex colour in a JS array blocks even with no style= on the line', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js', ["const COLORS = ['var(--brand-accent)', '#f5c518', '#e0556b'];"]));
  assert.ok(bad.findings.some((f) => f.rule === 'hex-color' && f.severity === 'BLOCK'));

  const ok = runOn(root, diffAdding('js/dashboard.js', [
    "const COLORS = ['var(--brand-accent)', 'var(--ds-yellow-50)'];",
    "const sel = '#view-dashboard';",
  ]));
  assert.strictEqual(ok.findings.filter((f) => f.rule === 'hex-color').length, 0);
});

// -- plan 2026-09-13-przyciski-akcje-modale-spojnosc: five button/modal rules -

test('btn-primary-per-view: two big primaries warn, one view primary plus one in a modal footer does not', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js', [
    '  const html = `<button type="button" class="ds-btn ds-btn--primary">Save</button>',
    '  <button type="button" class="ds-btn ds-btn--primary">Send</button>`;',
  ]));
  const hit = bad.findings.find((f) => f.rule === 'btn-primary-per-view');
  assert.ok(hit, 'two big primaries on one view warn');
  assert.strictEqual(hit.severity, 'WARN');

  // A view's own primary plus a confirm button in a modal footer opened FROM
  // it belongs to the dialog's hierarchy, not the view's - not a second
  // primary on the same view.
  const withFooter = runOn(root, diffAdding('js/dashboard.js', [
    '  const html = `<button type="button" class="ds-btn ds-btn--primary">Save</button>',
    '  <div class="ds-modal-footer">',
    '    <button type="button" class="ds-btn ds-btn--primary">OK</button>',
    '  </div>`;',
  ]));
  assert.strictEqual(withFooter.findings.filter((f) => f.rule === 'btn-primary-per-view').length, 0);
});

test('btn-primary-per-view: a data-skel skeleton duplicate does not count as a second primary', () => {
  const root = fixtureRepo();
  const rep = runOn(root, diffAdding('js/dashboard.js', [
    '  const skeleton = `<button type="button" class="ds-btn ds-btn--primary" data-skel="1" disabled>Save</button>`;',
    '  const html = `<button type="button" class="ds-btn ds-btn--primary">Save</button>`;',
  ]));
  assert.strictEqual(rep.findings.filter((f) => f.rule === 'btn-primary-per-view').length, 0);
});

test('btn-header-size: ds-btn--sm inside page-header-actions warns, a big button does not', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js', [
    '  const html = `<div class="page-header-actions">',
    '    <button type="button" class="ds-btn ds-btn--primary ds-btn--sm">Save</button>',
    '  </div>`;',
  ]));
  const hit = bad.findings.find((f) => f.rule === 'btn-header-size');
  assert.ok(hit);
  assert.strictEqual(hit.severity, 'WARN');

  const good = runOn(root, diffAdding('js/dashboard.js', [
    '  const html = `<div class="page-header-actions">',
    '    <button type="button" class="ds-btn ds-btn--primary">Save</button>',
    '  </div>`;',
  ]));
  assert.strictEqual(good.findings.filter((f) => f.rule === 'btn-header-size').length, 0);
});

test('modal-a11y: a ds-modal-overlay with no import and no role warns once per file', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('js/dashboard.js', [
    '  const html = `<div class="ds-modal-overlay" hidden>`;',
  ]));
  const hit = bad.findings.find((f) => f.rule === 'modal-a11y');
  assert.ok(hit);
  assert.strictEqual(hit.severity, 'WARN');

  const withImport = runOn(root, diffAdding('js/dashboard.js', [
    "  const m = await import('/js/ds-modal.js');",
    '  const html = `<div class="ds-modal-overlay" hidden>`;',
  ]));
  assert.strictEqual(withImport.findings.filter((f) => f.rule === 'modal-a11y').length, 0);

  const withRole = runOn(root, diffAdding('js/dashboard.js', [
    '  const html = `<div class="ds-modal-overlay" role="dialog" hidden>`;',
  ]));
  assert.strictEqual(withRole.findings.filter((f) => f.rule === 'modal-a11y').length, 0);
});

test('window-confirm-in-module: raw confirm() in a module warns, confirmDsModal and core confirm() do not', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('modules/x/client/a.js', [
    "  if (!window.confirm('Are you sure?')) return;",
  ]));
  const hit = bad.findings.find((f) => f.rule === 'window-confirm-in-module');
  assert.ok(hit);
  assert.strictEqual(hit.severity, 'WARN');

  const withHelper = runOn(root, diffAdding('modules/x/client/a.js', [
    "  const ok = await confirmDsModal({ title: 'Delete?' });",
  ]));
  assert.strictEqual(withHelper.findings.filter((f) => f.rule === 'window-confirm-in-module').length, 0);

  const ownHelper = runOn(root, diffAdding('modules/x/client/a.js', [
    "  if (!_confirm('Are you sure?')) return;",
  ]));
  assert.strictEqual(ownHelper.findings.filter((f) => f.rule === 'window-confirm-in-module').length, 0);

  const core = runOn(root, diffAdding('js/settings.js', [
    "  if (!window.confirm('Are you sure?')) return;",
  ]));
  assert.strictEqual(core.findings.filter((f) => f.rule === 'window-confirm-in-module').length, 0);
});

test('module-data-undeclared: module code that reads team data without dataRepos warns once per file', () => {
  const touch = ["const dir = ctx.dataTier0Dir;", "const p = path.join(ctx.dataTier0Dir, 'x');"];
  const undeclared = fixtureRepo({ 'modules/x/module.json': JSON.stringify({ id: 'x', dataRepos: [] }) });
  const hit = runOn(undeclared, diffAdding('modules/x/server/index.js', touch)).findings.filter((f) => f.rule === 'module-data-undeclared');
  assert.strictEqual(hit.length, 1, 'once per file, not per line');
  assert.strictEqual(hit[0].severity, 'WARN');

  const noManifest = runOn(fixtureRepo(), diffAdding('modules/x/client/index.js', ["fetch('/api/data/data-tier-0/status');"]));
  assert.strictEqual(noManifest.findings.filter((f) => f.rule === 'module-data-undeclared').length, 1);

  const declared = fixtureRepo({ 'modules/x/module.json': JSON.stringify({ id: 'x', dataRepos: [{ name: 'data-tier-0', access: 'read', paths: ['team/'] }] }) });
  assert.strictEqual(runOn(declared, diffAdding('modules/x/server/index.js', touch)).findings.filter((f) => f.rule === 'module-data-undeclared').length, 0);
  assert.strictEqual(runOn(undeclared, diffAdding('modules/x/server/index.js', ['const a = 1;'])).findings.filter((f) => f.rule === 'module-data-undeclared').length, 0);
});

test('module-data-repo-unknown: a dataRepos name no repo answers to warns, a route id and the data-tier-0 alias do not', () => {
  const manifest = (name) => fixtureRepo({ 'modules/x/module.json': JSON.stringify({ id: 'x', dataRepos: [{ name, paths: ['x/'] }] }) });
  const run1 = (name) => runOn(manifest(name), diffAdding('modules/x/module.json', ['{}'])).findings.filter((f) => f.rule === 'module-data-repo-unknown');
  const bad = run1('data-nope');
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].severity, 'WARN');
  assert.strictEqual(run1('data-reports').length, 1, 'a source the core no longer ships is unknown');
  assert.strictEqual(run1('data-tier-0').length, 0);
  assert.strictEqual(run1('ds-data-tier-0').length, 0);
});

test('DATA_REPO_IDS in the checker mirrors the one in scripts/new-module.js', () => {
  assert.deepStrictEqual([...conventions.DATA_REPO_IDS], [...require(path.join(ROOT, 'scripts', 'new-module.js')).DATA_REPO_IDS]);
});

test('ds-callout-stack: several direct children in a ds-callout warn, one wrapper or text + button are clean', () => {
  const root = fixtureRepo();
  const warnsOn = (line) => runOn(root, diffAdding('js/foo.js', [line])).findings.filter((f) => f.rule === 'ds-callout-stack');

  // The exact 2026-09-13 shape: a heading, a counts div and a list as siblings.
  const bad = warnsOn('  return `<div class="ds-callout ds-callout--${kind}"><strong>Done.</strong> text<div>counts</div><ul><li>a</li></ul></div>`;');
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].severity, 'WARN');
  // Assembled from interpolations with a conditional list on the same line.
  assert.strictEqual(warnsOn('  return `<div class="ds-callout ds-callout--success">${head}${counts}${list ? `<ul class="x">${list}</ul>` : \'\'}</div>`;').length, 1);
  // Two blocks, no loose text.
  assert.strictEqual(warnsOn('  el.innerHTML = \'<div class="ds-callout ds-callout--info"><div>a</div><div>b</div></div>\';').length, 1);

  // One wrapping child, however much it holds inside.
  assert.strictEqual(warnsOn('  return `<div class="ds-callout ds-callout--success"><div><strong>Done.</strong><div>numbers</div><ul><li>a</li></ul></div></div>`;').length, 0);
  // Text next to an action button is the designed row.
  assert.strictEqual(warnsOn('  el.innerHTML = \'<div class="ds-callout ds-callout--info"><div>No catalog.</div><button type="button" class="ds-btn ds-btn--sm">Import</button></div>\';').length, 0);
  // Bare text alone, and a bare interpolation alone.
  assert.strictEqual(warnsOn('  el.innerHTML = \'<div class="ds-callout ds-callout--danger">That did not work.</div>\';').length, 0);
  assert.strictEqual(warnsOn('  el.innerHTML = `<div class="ds-callout ds-callout--danger">${msg}</div>`;').length, 0);
  // Not a callout at all.
  assert.strictEqual(warnsOn('  el.innerHTML = \'<div class="ds-card"><div>a</div><div>b</div></div>\';').length, 0);
});

test('clickable-non-control: cursor:pointer on a row/card/cell selector warns, on a control selector it is clean', () => {
  const root = fixtureRepo();
  const hits = (file, lines) => runOn(root, diffAdding(file, lines)).findings.filter((f) => f.rule === 'clickable-non-control');

  // The 2026-09-13 shape: a <tr> opened by a click handler.
  const bad = hits('modules/foo/client/style.css', ['.foo-team-row {', '  cursor: pointer;', '}']);
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].severity, 'WARN');
  assert.match(bad[0].message, /\.foo-team-row/);
  // A declaration between the selector and the cursor line does not leak into the selector.
  const spaced = hits('styles.css', ['.foo-card {', '  display: flex;', '  cursor: pointer;', '}']);
  assert.strictEqual(spaced.length, 1);
  assert.match(spaced[0].message, /`\.foo-card`/);
  // Controls are fine: a DS button, a tab, a toggle, an attribute-role selector, an <a>.
  assert.strictEqual(hits('styles.css', ['.foo-btn {', '  cursor: pointer;', '}']).length, 0);
  assert.strictEqual(hits('styles.css', ['.foo-row-toggle {', '  cursor: pointer;', '}']).length, 0);
  assert.strictEqual(hits('styles.css', ['.foo-list [role="button"] {', '  cursor: pointer;', '}']).length, 0);
  assert.strictEqual(hits('styles.css', ['.foo-card a {', '  cursor: pointer;', '}']).length, 0);
  // A selector list continued over lines is read whole.
  assert.strictEqual(hits('styles.css', ['.foo-tab,', '.foo-chip {', '  cursor: pointer;', '}']).length, 0);
  // Only stylesheets that paint: css/ (the DS itself) and js are not this rule's surface.
  assert.strictEqual(hits('css/ds.css', ['.ds-x-row {', '  cursor: pointer;', '}']).length, 0);
});

test('flex-wrap-tiles: flex-wrap on a tiles/stats/panels row warns, on a legend or an actions row it is clean', () => {
  const root = fixtureRepo();
  const hits = (lines) => runOn(root, diffAdding('modules/foo/client/style.css', lines)).findings.filter((f) => f.rule === 'flex-wrap-tiles');
  assert.strictEqual(hits(['.foo-tiles {', '  display: flex;', '  flex-wrap: wrap;', '}']).length, 1);
  assert.strictEqual(hits(['.foo-stat-row {', '  flex-wrap: wrap;', '}']).length, 1);
  assert.strictEqual(hits(['.foo-chart-panels {', '  flex-wrap: wrap;', '}']).length, 1);
  // A module named *-stats must not make every one of its classes a tile row.
  assert.strictEqual(hits(['.sprint-stats-legend {', '  flex-wrap: wrap;', '}']).length, 0);
  assert.strictEqual(hits(['.foo-actions {', '  flex-wrap: wrap;', '}']).length, 0);
});

test('flex-on-table-cell: display:flex on a class used on a <td> warns, on an inner div or a bare td element', () => {
  const root = fixtureRepo();
  const hits = (diff) => runOn(root, diff).findings.filter((f) => f.rule === 'flex-on-table-cell');
  const twoFile = (js, css) =>
    diffAdding('modules/foo/client/index.js', js) + diffAdding('modules/foo/client/style.css', css);

  // The bug: a class that sits on a <td> is styled display:flex.
  assert.strictEqual(hits(twoFile(
    ['  return \'<td class="foo-actions">x</td>\';'],
    ['.foo-actions {', '  display: flex;', '}'],
  )).length, 1);

  // The fix: the cell class stays plain, an inner div carries the flex - clean.
  assert.strictEqual(hits(twoFile(
    ['  return \'<td class="foo-actions"><div class="foo-actions-row">x</div></td>\';'],
    ['.foo-actions { white-space: nowrap; }', '.foo-actions-row {', '  display: flex;', '}'],
  )).length, 0);

  // The shortest spelling of the bug - a one-line rule - is flagged too.
  assert.strictEqual(hits(twoFile(
    ['  return \'<td class="foo-actions">x</td>\';'],
    ['.foo-actions { display: flex; gap: 4px; }'],
  )).length, 1);

  // display:flex on a bare td/th element selector is flagged on its own (no JS needed).
  assert.strictEqual(hits(diffAdding('modules/foo/client/style.css', ['.ds-table td {', '  display: grid;', '}'])).length, 1);

  // A class with the same name used on a <div>, not a cell, is clean.
  assert.strictEqual(hits(twoFile(
    ['  return \'<div class="foo-bar">x</div>\';'],
    ['.foo-bar {', '  display: flex;', '}'],
  )).length, 0);

  // An ancestor cell class with the flex on a descendant is not the cell - clean.
  assert.strictEqual(hits(twoFile(
    ['  return \'<td class="foo-actions">x</td>\';'],
    ['.foo-actions .inner {', '  display: flex;', '}'],
  )).length, 0);
});

test('tabs-aria-half: role="tab" without a tabpanel or aria-controls in the change warns, a paired one is clean', () => {
  const root = fixtureRepo();
  const hits = (lines) => runOn(root, diffAdding('modules/foo/client/index.js', lines)).findings.filter((f) => f.rule === 'tabs-aria-half');
  const bad = hits(['  html += \'<button type="button" class="ds-tab" role="tab" aria-selected="true">Aktywny</button>\';']);
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].severity, 'WARN');
  assert.strictEqual(hits([
    '  html += \'<button type="button" class="ds-tab" role="tab" aria-selected="true" aria-controls="foo-panel">Aktywny</button>\';',
    '  html += \'<div id="foo-panel" role="tabpanel"></div>\';',
  ]).length, 0);
  // Plain buttons with no ARIA roles are not half of anything.
  assert.strictEqual(hits(['  html += \'<button type="button" class="ds-tab active">Aktywny</button>\';']).length, 0);
});

test('icon-btn-aria: an icon-only button with no aria-label warns, with one it is clean', () => {
  const root = fixtureRepo();
  const bad = runOn(root, diffAdding('index.html', [
    '  <button type="button" class="ds-icon-btn">&times;</button>',
  ]));
  const hit = bad.findings.find((f) => f.rule === 'icon-btn-aria');
  assert.ok(hit);
  assert.strictEqual(hit.severity, 'WARN');

  const good = runOn(root, diffAdding('index.html', [
    '  <button type="button" class="ds-icon-btn" aria-label="Close">&times;</button>',
  ]));
  assert.strictEqual(good.findings.filter((f) => f.rule === 'icon-btn-aria').length, 0);
});

test('md-non-english: leftover Polish prose in a templates/ README warns once, English prose and code fences do not', () => {
  const root = fixtureRepo();
  const leftover = runOn(root, diffAdding('templates/deck/README.md', [
    '# Deck template',
    'Gotowy deck z przykładowymi wartościami, po jednym slajdzie na kazda konfiguracje.',
    'Wszystkie elementy sa natywne, ktore mozna edytowac.',
  ]));
  const hits = leftover.findings.filter((f) => f.rule === 'md-non-english');
  assert.strictEqual(hits.length, 1, 'one finding per file');
  assert.strictEqual(hits[0].severity, 'WARN');
  assert.strictEqual(hits[0].line, 2);
  assert.ok(/przykładowymi|wartościami|ktore|mozna/.test(hits[0].message));

  const english = runOn(root, diffAdding('templates/deck/README.md', [
    'A ready deck with sample values, one slide per layout configuration.',
    'Every element is native (shapes, text, chart) and can be edited.',
  ]));
  assert.strictEqual(english.findings.filter((f) => f.rule === 'md-non-english').length, 0);

  // Two stray words are not a finding; a code fence and inline code never count.
  const few = runOn(root, diffAdding('docs/guides/x.md', [
    'The team calls it "nie ma" and that is fine.',
    '```bash',
    'ktory juz sie uzyc wartosc tresc',
    '```',
    'Run `uzyc --ktory sie` in the terminal.',
  ]));
  assert.strictEqual(few.findings.filter((f) => f.rule === 'md-non-english').length, 0);

  // Agent briefs are not prose docs in this rule's scope.
  const brief = runOn(root, diffAdding('.claude/agents/x.md', [
    'ktory juz sie uzyc wartosc tresc kazdy',
  ]));
  assert.strictEqual(brief.findings.filter((f) => f.rule === 'md-non-english').length, 0);
});

test('ui-non-english: a non-English UI string warns once per file; keys, paths, comments and log lines do not', () => {
  const src = [
    "const KEY = 'settings-uzytkownicy';",
    "const PATH = '/api/uzytkownicy/list';",
    "console.log('uzytkownik zapisany, wartosc domyslna');",
    "// komentarz: kazdy uzytkownik moze uzyc sciezki",
    "const rows = []; // rows across \"Pokaz wiecej\" pages",
    "const ok = 'Text copied - paste it into the terminal and practise the shortcuts.';",
    "const bad = 'Ćwiczenie skrótów terminala: wklej go i przećwicz.';",
    "const tpl = `<p>Nie udalo sie zapisac - sprobuj ponownie.</p>`;",
    "const gen = ['// Ta mapa jest czytelna dla kazdego', '// mechanizm kontroli dostepu'];",
  ];
  const root = fixtureRepo({ 'js/academy-stages.mjs': src.join('\n') + '\n' });
  const rep = runOn(root, diffAdding('js/academy-stages.mjs', src));
  const hits = rep.findings.filter((f) => f.rule === 'ui-non-english');
  assert.strictEqual(hits.length, 1, 'one finding per file');
  assert.strictEqual(hits[0].severity, 'WARN');
  assert.strictEqual(hits[0].line, 7, 'anchored on the first non-English UI string, not the key, the log line or the comment');
  assert.ok(/ćwiczenie|skrótów/.test(hits[0].message), 'the exercise text');
  assert.ok(/udalo|sprobuj|nie|sie/.test(hits[0].message), 'the template literal too');
  assert.ok(!/uzytkownik|wartosc|kazdego|dostepu|wiecej/.test(hits[0].message), 'nothing from the key, the path, the log line, the comments or the generated-comment strings');

  // English copy is clean, and so is a single-token string: a key, an id or a
  // class name is ASCII by rule and never prose.
  const clean = [
    "const t = 'Could not save - try again.';",
    "const id = 'uzytkownicy';",
    "const cls = 'ds-btn ds-btn--primary';",
  ];
  const rootOk = fixtureRepo({ 'js/x.js': clean.join('\n') + '\n' });
  assert.strictEqual(runOn(rootOk, diffAdding('js/x.js', clean)).findings.filter((f) => f.rule === 'ui-non-english').length, 0);

  // index.html: a text node and a title attribute count, an HTML comment does not.
  const html = [
    '<!-- Prototypy: tresc dopiero w Etapie 5 - sekcja',
    '     ktorego kazdy widok nie deklaruje -->',
    '<button class="ds-btn" title="Odswiez liste">Sprawdz ponownie</button>',
  ];
  const rootHtml = fixtureRepo({ 'index.html': html.join('\n') + '\n' });
  const h = runOn(rootHtml, diffAdding('index.html', html)).findings.filter((f) => f.rule === 'ui-non-english');
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].line, 3);
  assert.ok(!/tresc|ktorego|kazdy/.test(h[0].message));

  // Tests and scripts are not UI surfaces.
  const rootT = fixtureRepo({ 'tests/test_x.mjs': "test('wartosc domyslna sie zgadza', () => {});\n" });
  assert.strictEqual(runOn(rootT, diffAdding('tests/test_x.mjs', ["test('wartosc domyslna sie zgadza', () => {});"])).findings.filter((f) => f.rule === 'ui-non-english').length, 0);
});

test('spawn-env-spread: a child handed ...process.env warns in server code, an allowlist and a browser file do not', () => {
  const root = fixtureRepo();
  const spread = runOn(root, diffAdding('modules/foo/server/refresh-job.js', [
    'function childEnv(env) {',
    '  const out = { ...env };',
    '  return out;',
    '}',
    "const child = spawn('python3', args, { env: { ...process.env, X: '1' } });",
  ]));
  const hits = spread.findings.filter((f) => f.rule === 'spawn-env-spread');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].severity, 'WARN');
  assert.strictEqual(hits[0].line, 5);

  // The bare form and the "fallback or" form server.js's own helper uses.
  const bare = runOn(root, diffAdding('scripts/run-thing.js', ["spawn(cmd, args, { env: process.env });"]));
  assert.ok(bare.findings.some((f) => f.rule === 'spawn-env-spread'));
  const fallback = runOn(root, diffAdding('server.js', ['  const out = { ...(baseEnv || process.env) };']));
  assert.ok(fallback.findings.some((f) => f.rule === 'spawn-env-spread'));

  // An allowlist copies named keys - nothing to flag; a comment saying
  // "never spread" is prose; a browser module has no process.env.
  const allow = runOn(root, diffAdding('modules/foo/server/refresh-job.js', [
    '// never hand the child { ...process.env } - see spawn-env-spread',
    "const CHILD_ENV_ALLOW = ['PATH', 'HOME'];",
    'function childEnv(env) {',
    '  const out = {};',
    '  for (const key of CHILD_ENV_ALLOW) if (env[key]) out[key] = env[key];',
    '  return out;',
    '}',
  ]));
  assert.strictEqual(allow.findings.filter((f) => f.rule === 'spawn-env-spread').length, 0);
  const client = runOn(root, diffAdding('modules/foo/client/index.js', ['const env = { ...process.env };']));
  assert.strictEqual(client.findings.filter((f) => f.rule === 'spawn-env-spread').length, 0);

  // A bare `env: process.env` handed to a dependency-injection object is not
  // a child process - only the same line's spawn/exec call makes it one.
  const di = runOn(root, diffAdding('modules/foo/server/index.js', ['  return createRoutes(ctx, { http: null, env: process.env });']));
  assert.strictEqual(di.findings.filter((f) => f.rule === 'spawn-env-spread').length, 0);

  // The checker names the pattern in its own help text and warn message, and
  // a log line may QUOTE it: neither is a spawn.
  const self = runOn(root, diffAdding('scripts/check-conventions.js', [
    "  spawn-env-spread          ...process.env handed to a child process (server code)",
    "      message: 'the parent environment spread into a child (`...process.env`)',",
  ]));
  assert.strictEqual(self.findings.filter((f) => f.rule === 'spawn-env-spread').length, 0, 'the checker never flags itself');
  const quoted = runOn(root, diffAdding('scripts/run-thing.js', [
    "console.warn('never hand a child { ...process.env } - use the allowlist');",
    "spawn(cmd, args, { env: childEnv(process.env) });",
  ]));
  assert.strictEqual(quoted.findings.filter((f) => f.rule === 'spawn-env-spread').length, 0, 'a quoted pattern is prose');
});

test('manifest-boot-snapshot: a browser file reading /api/modules/manifest warns, module-host and comments do not', () => {
  const root = fixtureRepo();
  const katalog = runOn(root, diffAdding('js/settings-moduly-katalog.js', [
    "const res = await fetch(`/api/modules/manifest?t=${Date.now()}`);",
  ]));
  const hits = katalog.findings.filter((f) => f.rule === 'manifest-boot-snapshot');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].severity, 'WARN');
  assert.strictEqual(hits[0].line, 1);

  // A module's own client code compares versions the same wrong way.
  const client = runOn(root, diffAdding('modules/foo/client/index.js', ["fetch('/api/modules/manifest')"]));
  assert.ok(client.findings.some((f) => f.rule === 'manifest-boot-snapshot'));

  // The one legitimate consumer, a comment naming the endpoint, the disk scan,
  // and the server that SERVES the route are all quiet.
  const host = runOn(root, diffAdding('js/module-host.js', ["const res = await fetch('/api/modules/manifest');"]));
  assert.strictEqual(host.findings.filter((f) => f.rule === 'manifest-boot-snapshot').length, 0);
  const comment = runOn(root, diffAdding('js/rail-placeholders.js', ['// GET /api/modules/manifest answers at boot']));
  assert.strictEqual(comment.findings.filter((f) => f.rule === 'manifest-boot-snapshot').length, 0);
  const disk = runOn(root, diffAdding('js/settings-moduly-katalog.js', ["fetch('/api/modules/installed')"]));
  assert.strictEqual(disk.findings.filter((f) => f.rule === 'manifest-boot-snapshot').length, 0);
  const server = runOn(root, diffAdding('server.js', ["if (urlPath === '/api/modules/manifest') return dispatch(handleModulesManifest);"]));
  assert.strictEqual(server.findings.filter((f) => f.rule === 'manifest-boot-snapshot').length, 0);
  // A line that names the endpoint to say "never" is prose, not a fetch.
  const negated = runOn(root, diffAdding('js/settings-moduly-katalog.js', [
    "const NOTE = 'never read /api/modules/manifest here - it is the boot snapshot';",
  ]));
  assert.strictEqual(negated.findings.filter((f) => f.rule === 'manifest-boot-snapshot').length, 0);
});

test('proto-shell-autostash: --autostash on the prototype build shell blocks, data-repo pulls do not', () => {
  const root = fixtureRepo();
  // The exact line that left UU files in data-prototypes/ on 2026-10-08.
  const bad = runOn(root, diffAdding('server.js', [
    "        const pull = await _protoGitExec(['pull', '--rebase', '--autostash']);",
  ]));
  const hits = bad.findings.filter((f) => f.rule === 'proto-shell-autostash');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].severity, 'BLOCK');

  // Data-repo pull through d.gitExecFn, the guarded helper's own pull and a
  // comment are all out of scope.
  const dataRepo = runOn(root, diffAdding('server.js', [
    "  const { stdout, stderr, code } = await d.gitExecFn(['pull', '--rebase', '--autostash']);",
    "  const pull = await git(['pull', '--rebase', '--autostash']);",
    "  // never _protoGitExec(['pull', '--rebase', '--autostash'])",
  ]));
  assert.strictEqual(dataRepo.findings.filter((f) => f.rule === 'proto-shell-autostash').length, 0);
});

test('autostash-unmerged-gate: a pull with --autostash blocks unless an unmerged check follows', () => {
  const root = fixtureRepo();
  // The shape that left UU .enc files in the Mini aplikacje mirror on 2026-10-09.
  const bad = runOn(root, diffAdding('server.js', [
    "  const { stdout, stderr, code } = await d.gitExecFn(['pull', '--rebase', '--autostash']);",
    "  if (code !== 0) return { ok: false };",
    "  const dec = d.decryptFn(log);",
  ]));
  const hits = bad.findings.filter((f) => f.rule === 'autostash-unmerged-gate');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].severity, 'BLOCK');

  const good = runOn(root, diffAdding('server.js', [
    "  const { stdout, stderr, code } = await d.gitExecFn(['pull', '--rebase', '--autostash']);",
    "  if (code !== 0) return { ok: false };",
    "  const u = await d.gitExecFn(['diff', '--name-only', '--diff-filter=U']);",
  ]));
  assert.strictEqual(good.findings.filter((f) => f.rule === 'autostash-unmerged-gate').length, 0);

  // A helper named after unmerged paths counts; a comment and the proto shell call do not trigger this rule.
  const other = runOn(root, diffAdding('server.js', [
    "  const pull = await git(['pull', '--rebase', '--autostash']);",
    "  const after = await listUnmerged();",
    "  // git pull --rebase '--autostash'",
    "  const p2 = await _protoGitExec(['pull', '--rebase', '--autostash']);",
    "  const after2 = await listUnmerged();",
  ]));
  assert.strictEqual(other.findings.filter((f) => f.rule === 'autostash-unmerged-gate').length, 0);
});

test('app-fetch-refspec: a bare-URL fetch into the app repo warns, one naming a destination does not', () => {
  const root = fixtureRepo();
  // The exact shape that froze refs/remotes/origin/main and handed a person
  // thirteen of the maintainer's commits to push.
  const bare = runOn(root, diffAdding('server.js', [
    "    const fetchResult = await _gitP(['-C', ROOT, 'fetch', authUrl], 60000);",
  ]));
  const hits = bare.findings.filter((f) => f.rule === 'app-fetch-refspec');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].severity, 'WARN');
  assert.strictEqual(hits[0].line, 1);

  // A bare HEAD is not a destination either - same frozen ref.
  const headOnly = runOn(root, diffAdding('server.js', [
    "    const fetchR = await _gitP(['-C', ROOT, 'fetch', authUrl, 'HEAD'], 15000);",
  ]));
  assert.strictEqual(headOnly.findings.filter((f) => f.rule === 'app-fetch-refspec').length, 1);

  // Naming the destination is the fix, in either spelling.
  const literal = runOn(root, diffAdding('scripts/_app-repo-adopt.js', [
    "  const fetchR = await git(['-C', root, 'fetch', fetchUrl, '+refs/heads/main:refs/remotes/origin/main'], 120000);",
  ]));
  assert.strictEqual(literal.findings.filter((f) => f.rule === 'app-fetch-refspec').length, 0);
  const constant = runOn(root, diffAdding('server.js', [
    "  return ['-C', root, 'fetch', authUrl, _appRepoAdopt.ORIGIN_MAIN_REFSPEC];",
  ]));
  assert.strictEqual(constant.findings.filter((f) => f.rule === 'app-fetch-refspec').length, 0);

  // Out of scope: a data-repo fetch (named remote, no -C literal), a fetch of
  // a named remote, a comment, a browser file, and the checker's own prose.
  const dataRepo = runOn(root, diffAdding('server.js', ["  const r = await d.gitExecFn(['fetch', '--prune']);"]));
  assert.strictEqual(dataRepo.findings.filter((f) => f.rule === 'app-fetch-refspec').length, 0);
  const named = runOn(root, diffAdding('server.js', ["  await _gitP(['-C', ROOT, 'fetch', 'origin'], 60000);"]));
  assert.strictEqual(named.findings.filter((f) => f.rule === 'app-fetch-refspec').length, 0);
  const comment = runOn(root, diffAdding('server.js', ["  // never ['-C', ROOT, 'fetch', authUrl] without a refspec"]));
  assert.strictEqual(comment.findings.filter((f) => f.rule === 'app-fetch-refspec').length, 0);
  const browser = runOn(root, diffAdding('js/thing.js', ["const a = ['-C', ROOT, 'fetch', someUrl];"]));
  assert.strictEqual(browser.findings.filter((f) => f.rule === 'app-fetch-refspec').length, 0);
  const self = runOn(root, diffAdding('scripts/check-conventions.js', ["const x = \"['-C', root, 'fetch', authUrl]\";"]));
  assert.strictEqual(self.findings.filter((f) => f.rule === 'app-fetch-refspec').length, 0);
});

test('detached-on-win32: a literal detached: true in server code warns, a win32-guarded one and a browser file do not', () => {
  const root = fixtureRepo();
  const bare = runOn(root, diffAdding('server.js', [
    "    const child = spawn('git', args, { stdio: 'ignore', detached: true });",
  ]));
  const hits = bare.findings.filter((f) => f.rule === 'detached-on-win32');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].severity, 'WARN');
  assert.strictEqual(hits[0].line, 1);

  // A module's server code is the same process, same trap.
  const mod = runOn(root, diffAdding('modules/foo/server/refresh-job.js', ['  detached: true,']));
  assert.ok(mod.findings.some((f) => f.rule === 'detached-on-win32'));

  // The shape that keeps the process group on posix and the console on
  // Windows, a comment quoting the flag, a browser file, and the two files
  // that name the pattern to describe it are all quiet.
  const guarded = runOn(root, diffAdding('server.js', ["  detached: process.platform !== 'win32',"]));
  assert.strictEqual(guarded.findings.filter((f) => f.rule === 'detached-on-win32').length, 0);
  const comment = runOn(root, diffAdding('server.js', ['  // never spawn with detached: true here']));
  assert.strictEqual(comment.findings.filter((f) => f.rule === 'detached-on-win32').length, 0);
  const browser = runOn(root, diffAdding('js/thing.js', ['const opts = { detached: true };']));
  assert.strictEqual(browser.findings.filter((f) => f.rule === 'detached-on-win32').length, 0);
  const self = runOn(root, diffAdding('scripts/_cp.js', ["//   - `detached: true` on Windows defeats it.", "const x = { detached: true };"]));
  assert.strictEqual(self.findings.filter((f) => f.rule === 'detached-on-win32').length, 0);
  const quoted = runOn(root, diffAdding('scripts/run-thing.js', ["console.warn('use detached: true only for a child that must outlive the server');"]));
  assert.strictEqual(quoted.findings.filter((f) => f.rule === 'detached-on-win32').length, 0);
});

test("stdio-inherit-in-process: 'inherit' warns in server-process code, not in a CLI script", () => {
  const root = fixtureRepo();
  // The shape that cost us a visible console window per npm install on a
  // restarted Windows server: an inherited fd makes libuv skip
  // CREATE_NO_WINDOW, so windowsHide never reaches the child.
  const bare = runOn(root, diffAdding('server.js', [
    "      const p = spawn(npm, ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });",
  ]));
  const hits = bare.findings.filter((f) => f.rule === 'stdio-inherit-in-process');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].severity, 'WARN');
  assert.strictEqual(hits[0].line, 1);

  // The array form is the same trap.
  const arr = runOn(root, diffAdding('server.js', ["  stdio: ['ignore', 'inherit', 'inherit'],"]));
  assert.strictEqual(arr.findings.filter((f) => f.rule === 'stdio-inherit-in-process').length, 1);

  // A module's server code and a shared scripts/_*.js library run in the same
  // process, so both are in scope.
  const mod = runOn(root, diffAdding('modules/foo/server/index.js', ["  const c = spawn('git', a, { stdio: 'inherit' });"]));
  assert.ok(mod.findings.some((f) => f.rule === 'stdio-inherit-in-process'));
  const lib = runOn(root, diffAdding('scripts/_module-git.js', ["  execFile('git', a, { stdio: 'inherit' });"]));
  assert.ok(lib.findings.some((f) => f.rule === 'stdio-inherit-in-process'));

  // A CLI entry point under scripts/ is run from a real terminal by a person
  // who wants to watch it - 'inherit' is correct there and must stay quiet.
  for (const cli of ['scripts/test-unit-js.js', 'scripts/bootstrap-gitnexus.js', 'scripts/run-api-one.js']) {
    const r = runOn(root, diffAdding(cli, ["  spawnSync('node', args, { stdio: 'inherit' });"]));
    assert.strictEqual(r.findings.filter((f) => f.rule === 'stdio-inherit-in-process').length, 0, cli);
  }

  // The drained-pipe replacement, a comment, a browser file and the two files
  // that name the pattern to describe it are all quiet.
  const piped = runOn(root, diffAdding('server.js', ["  stdio: ['ignore', 'pipe', 'pipe'],"]));
  assert.strictEqual(piped.findings.filter((f) => f.rule === 'stdio-inherit-in-process').length, 0);
  const comment = runOn(root, diffAdding('server.js', ["  // never stdio: 'inherit' here - it drops windowsHide"]));
  assert.strictEqual(comment.findings.filter((f) => f.rule === 'stdio-inherit-in-process').length, 0);
  const browser = runOn(root, diffAdding('js/thing.js', ["const o = { stdio: 'inherit' };"]));
  assert.strictEqual(browser.findings.filter((f) => f.rule === 'stdio-inherit-in-process').length, 0);
  const self = runOn(root, diffAdding('scripts/_cp.js', ["//   `stdio: 'inherit'` drops the flag"]));
  assert.strictEqual(self.findings.filter((f) => f.rule === 'stdio-inherit-in-process').length, 0);
});
