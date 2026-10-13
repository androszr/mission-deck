// tests/test_check_proto_ds.mjs
// scripts/check-proto-ds.js against fixture prototypes written to a temp dir.
// The catalog and the tokens come from the real repo, so the fixtures reference
// real token names - that is exactly what the linter is asked to prove.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linter = require(path.join(ROOT, 'scripts', 'check-proto-ds.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-ds-'));

function writeProto(name, files) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  const base = {
    'index.html': '<!doctype html><html><body><div id="proto-root"></div></body></html>',
    'render.js': "export const breakpoints = [375];\nexport function render(rootEl) { rootEl.textContent = 'x'; }\n",
    'styles.css': '.demo-card { background: var(--body-primary-bg); color: var(--body-primary-text); }\n',
    'spec.json': JSON.stringify({ id: name, title: name, scope: [], releases: [], customElements: [] }, null, 2),
  };
  for (const [f, content] of Object.entries({ ...base, ...files })) {
    if (content === null) continue;
    fs.writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

function findings(rep, rule) {
  return rep.findings.filter((f) => f.rule === rule);
}

test('a compliant prototype passes', () => {
  const dir = writeProto('clean', {});
  const rep = linter.run(dir);
  assert.strictEqual(rep.verdict(), 'PASS', JSON.stringify(rep.findings, null, 2));
  assert.strictEqual(rep.exitCode(), 0);
});

test('a hex literal outside device chrome is a BLOCK, inside it is not', () => {
  const dir = writeProto('hex', {
    'styles.css': [
      '.demo-btn { background: #00B05A; }',
      '.pnz-phone { background: #111111; }',
      '.demo-row { color: rgba(0,0,0,.5); }',
    ].join('\n'),
  });
  const rep = linter.run(dir);
  const hits = findings(rep, 'hardcoded-color');
  assert.strictEqual(hits.length, 2, 'the device-chrome rule is exempt');
  assert.ok(hits.every((f) => f.severity === 'BLOCK'));
  assert.strictEqual(rep.exitCode(), 1);
});

test('an unknown token is a BLOCK, a locally defined one is not', () => {
  const dir = writeProto('tokens', {
    'styles.css': [
      ':root { --demo-gap: 8px; }',
      '.demo { gap: var(--demo-gap); color: var(--body-primary-text); background: var(--not-a-token); }',
    ].join('\n'),
  });
  const rep = linter.run(dir);
  const hits = findings(rep, 'unknown-token');
  assert.strictEqual(hits.length, 1);
  assert.match(hits[0].message, /--not-a-token/);
});

test('an unknown icon slug is a BLOCK and a real one passes', () => {
  const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/icons/ds/manifest.json'), 'utf8'));
  const realSlug = icons.icons[0].slug;
  const dir = writeProto('icons', {
    'render.js': [
      'export const breakpoints = [375];',
      'export function render(rootEl) {',
      `  rootEl.innerHTML = '<img src="/assets/icons/ds/${realSlug}.svg">'`,
      `    + '<img src="/assets/icons/ds/nope-not-a-slug.svg">';`,
      '}',
    ].join('\n'),
  });
  const rep = linter.run(dir);
  const hits = findings(rep, 'unknown-icon');
  assert.strictEqual(hits.length, 1);
  assert.match(hits[0].message, /nope-not-a-slug/);
});

test('render.js importing from the host bundle is a BLOCK', () => {
  const dir = writeProto('import', {
    'render.js': "import { escHtml } from '/js/utils.js';\nexport const breakpoints = [375];\nexport function render() { return escHtml; }\n",
  });
  const rep = linter.run(dir);
  assert.strictEqual(findings(rep, 'js-import').length, 1);
  assert.strictEqual(rep.exitCode(), 1);
});

test('the custom element registry must match the CSS markers', () => {
  const dir = writeProto('registry', {
    'styles.css': '/* CUSTOM: demo-strip - no catalog equivalent */\n.demo-strip { gap: 4px; }\n',
    'spec.json': JSON.stringify({ id: 'registry', customElements: [] }),
  });
  const rep = linter.run(dir);
  assert.strictEqual(findings(rep, 'registry-mismatch').length, 1);

  const ok = writeProto('registry-ok', {
    'styles.css': '/* CUSTOM: demo-strip - no catalog equivalent */\n.demo-strip { gap: 4px; }\n',
    'spec.json': JSON.stringify({ id: 'x', customElements: [{ name: 'demo-strip', reason: 'nothing in the catalog', lead_confirmed: true }] }),
  });
  const repOk = linter.run(ok);
  assert.strictEqual(findings(repOk, 'registry-mismatch').length, 0);
  assert.strictEqual(findings(repOk, 'stale-registration').length, 0);
});

test('a registered element nothing references is a stale registration', () => {
  const dir = writeProto('stale', {
    'spec.json': JSON.stringify({ id: 'x', customElements: [{ name: 'gone-widget', reason: 'r', lead_confirmed: true }] }),
    'styles.css': '/* CUSTOM: gone-widget */\n.demo { gap: 4px; }\n',
  });
  const rep = linter.run(dir);
  assert.strictEqual(findings(rep, 'stale-registration').length, 1);
});

test('a custom element that mirrors a catalog component is a WARN', () => {
  const dir = writeProto('suspect', {
    'styles.css': '/* CUSTOM: demo-btn - looks custom */\n.demo-btn { gap: 4px; }\n',
    'spec.json': JSON.stringify({ id: 'x', customElements: [{ name: 'demo-btn', reason: 'r', lead_confirmed: true }] }),
  });
  const rep = linter.run(dir);
  const hits = findings(rep, 'suspect-registration');
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((f) => f.severity === 'WARN'), 'a suspect registration never fails the run');
  assert.strictEqual(rep.exitCode(), 0);
});

test('a missing contract file is a BLOCK', () => {
  const dir = path.join(TMP, 'empty');
  fs.mkdirSync(dir, { recursive: true });
  const rep = linter.run(dir);
  assert.strictEqual(findings(rep, 'missing-file').length, 4);
  assert.strictEqual(rep.exitCode(), 1);
});

const starter = fs.readFileSync(path.join(ROOT, 'templates/prototype/starter/index.tsx'), 'utf8')
  .replace('{{PROTO_NAME_JSON}}', JSON.stringify('New prototype'));
const starterCss = fs.readFileSync(path.join(ROOT, 'templates/prototype/starter/styles.css'), 'utf8');
let reactCount = 0;
const reactFixture = (files = {}) => writeProto('react-' + reactCount++, {
  'render.js': null, 'index.html': null, 'index.tsx': starter, 'styles.css': starterCss, ...files,
});
const blocks = (dir) => linter.run(dir).findings.filter((f) => f.severity === 'BLOCK');

test('React starter passes without legacy index.html or render.js', () => {
  assert.deepStrictEqual(blocks(reactFixture()), []);
});

test('starter keeps the shell height contract', () => {
  assert.match(starterCss, /\.proto-starter\s*\{[^}]*height:\s*100%/);
});

test('React tokens come from the build shell and the app tokens, nothing else', () => {
  const dir = reactFixture({ 'styles.css': '.x { color: var(--body-primary-text); gap: var(--space-8); }' });
  assert.deepStrictEqual(linter.run(dir).findings.filter((f) => f.severity === 'BLOCK'), []);
  fs.writeFileSync(path.join(dir, 'styles.css'), '.x { color: var(--fds-removed-token); }');
  assert.ok(linter.run(dir).findings.some((f) => f.rule === 'unknown-token'));
});

test('React cannot use host or direct production imports, including dynamic and side-effect', () => {
  for (const statement of [
    "import '/css/ds.css';",
    "import { Button } from '@acme/ui';",
    "const m = import('/js/utils.js');",
    "import helper from './helper';",
    "import helper from './assets/helper.ts';",
    "import icon from './icon.svg';",
    "import secret from './assets/../../private.json';",
  ]) {
    assert.ok(blocks(reactFixture({ 'index.tsx': statement + '\n' + starter })).some((f) => f.rule === 'react-import'), statement);
  }
});

test('React requires implemented demo states and breakpoints', () => {
  assert.ok(blocks(reactFixture({ 'index.tsx': starter.replaceAll('export const breakpoints', 'const widths') })).some((f) => f.rule === 'react-contract'));
  assert.ok(blocks(reactFixture({ 'index.tsx': starter.replace("state === 'screen-error'", "state === 'absent'") })).some((f) => f.rule === 'demo-states'));
  assert.ok(blocks(reactFixture({ 'index.tsx': starter.replace("useDemoState(demoStates, 'screen')", "'screen'") })).some((f) => f.rule === 'demo-states'));
});

test('React blocks unstageable source siblings, raw controls and viewport width queries', () => {
  const dir = reactFixture({
    'helper.ts': 'export const x = 1;',
    'index.tsx': starter + '\nconst Raw = () => <button>Bad</button>;',
    'styles.css': starterCss + '\n@media (min-width: 900px) { .x { display: block; } }',
  });
  for (const rule of ['sibling-source', 'raw-control', 'container-query']) assert.ok(blocks(dir).some((f) => f.rule === rule), rule);
});

// The starter's store-picker search was migrated from a raw <input> to
// DSSearchInput, but its hand-built field box stayed in styles.css (height
// 40px, border, radius, background) - so the real 48px field rendered inside
// a facsimile of itself and the gate said PASS. Pinned on the exact shape.
test('React blocks a DS field adapter wrapped in a box that draws its own frame', () => {
  // The starter no longer carries a search wrapper of its own, so the fixture adds one.
  const searchTsx = starter + '\nconst Search = () => <div className="pst-dsp-search"><DSSearchInput value="" onChange={() => {}} /></div>;\n';
  const wrapped = (extra) => reactFixture({
    'index.tsx': searchTsx,
    'styles.css': starterCss + '\n.pst-dsp-search {' + extra + '}\n',
  });
  assert.deepStrictEqual(blocks(reactFixture()).filter((f) => f.rule === 'adapter-frame'), [], 'the shipped starter must not trip the rule');
  for (const decl of ['height: 40px;', 'border: 1px solid var(--body-tertiary-border);', 'border-radius: 8px;']) {
    assert.ok(blocks(wrapped(decl)).some((f) => f.rule === 'adapter-frame'), decl);
  }
  // layout on the wrapper is fine: the sticky menu search row keeps a
  // background and padding, a divider under it is not a frame
  for (const decl of ['background: var(--surface-primary);', 'padding: 0 12px;', 'border-bottom: 1px solid var(--body-tertiary-border);', 'min-height: 48px;']) {
    assert.deepStrictEqual(blocks(wrapped(decl)).filter((f) => f.rule === 'adapter-frame'), [], decl);
  }
  // a comment before the selector must not hide the block from the rule
  assert.ok(blocks(wrapped('height: 40px;')).some((f) => f.rule === 'adapter-frame' && /pst-dsp-search/.test(f.message)));
});

test('React colours have no legacy chrome exemptions and icon API names are checked', () => {
  const invalidDeclaration = JSON.stringify({ color: '#abc' });
  const dir = reactFixture({
    'styles.css': '.pnz-frame { color: #abc; }',
    'index.tsx': starter + `\nconst Icon = () => <DSIcon name="not-a-catalog-icon-99999" />;\nconst Badge = () => <div style={${invalidDeclaration}} />;`,
  });
  assert.ok(blocks(dir).filter((f) => f.rule === 'hardcoded-color').length >= 2);
  assert.ok(blocks(dir).some((f) => f.rule === 'unknown-icon'));
  assert.ok(blocks(reactFixture({ 'styles.css': '.x { background: url("/api/ds-icon/not-a-catalog-icon-99999"); }' })).some((f) => f.rule === 'unknown-icon'));
});

test('React spec and custom-element approval cannot pass as empty or mismatched metadata', () => {
  for (const value of [null, [], { customElements: 'invalid' }]) {
    assert.ok(blocks(reactFixture({ 'spec.json': JSON.stringify(value) })).some((f) => f.rule === 'registry-mismatch'));
  }
  const custom = {
    'styles.css': '/* CUSTOM: example-strip */\n.example-strip { gap: var(--space-16); }',
    'spec.json': JSON.stringify({ customElements: [{ name: 'example-strip', reason: 'No equivalent' }] }),
  };
  assert.ok(blocks(reactFixture(custom)).some((f) => f.rule === 'suspect-registration'));
  assert.ok(blocks(reactFixture({ ...custom, 'spec.json': JSON.stringify({ customElements: [{ name: 'other-strip', reason: 'x', lead_confirmed: true }] }) })).some((f) => f.rule === 'registry-mismatch'));
  assert.ok(blocks(reactFixture({ 'styles.css': ':root { --fds-self-defined: 12px; } .x { gap: var(--fds-self-defined); }' })).some((f) => f.rule === 'unknown-token'));
});

// The first comment stripper removed `/* ... */` with a regex BEFORE line
// comments, so a `//` line carrying `./*` (the import allowlist prose every
// prototype header has) opened a block comment that swallowed the file up to
// the next `*/` - and the gate reported a complete React prototype as
// "missing default export", "missing demoStates". Pinned on the exact shape.
test('a line comment containing "./*" does not swallow the exports that follow it', () => {
  const prose = "// Allowed imports: react, ./* (files here), ../_shared/*, ../../ds\n";
  const later = "/* eslint-disable react-hooks/set-state-in-effect */\n";
  const dir = reactFixture({ 'index.tsx': prose + starter.replace('/* eslint-disable react-hooks/set-state-in-effect */', later) });
  const found = blocks(dir).filter((f) => f.rule === 'react-contract' || f.rule === 'demo-states');
  assert.deepStrictEqual(found, [], 'the stripper still treats ./* inside a // comment as a block-comment opener');
  // and a real block comment hiding an export is still seen as missing
  assert.ok(blocks(reactFixture({ 'index.tsx': starter.replace('export default function', '/* export default function */ function') })).some((f) => f.rule === 'react-contract'));
  // strings and template literals are opaque to the stripper: a URL with //
  // inside a template literal, a `/*` inside a string and an apostrophe in a
  // double-quoted string must not swallow the exports that follow them.
  const opaque = "const U = `url('/ds-icons/x.svg')`; const S = 'a /* b'; const T = \"it's\"; const R = /\\/\\*/;\n";
  assert.deepStrictEqual(
    blocks(reactFixture({ 'index.tsx': opaque + starter })).filter((f) => f.rule === 'react-contract' || f.rule === 'demo-states'),
    [],
    'a string or template literal is being read as a comment opener'
  );
});

// -- R-11: a raw control inside a registered custom element ------------------

const scopedCss = starterCss + '\n/* CUSTOM: demo-menu */\n.demo-menu { gap: var(--space-8); }\n';
const scopedSpec = (entry) => JSON.stringify({ customElements: [{ reason: 'no catalog row menu', lead_confirmed: true, ...entry }] });

test('a raw control inside a registered custom element is a NOTE, outside it stays a BLOCK', () => {
  const tsx = starter + [
    '',
    'function RowMenu() { return <div className="demo-menu"><button>Edytuj</button><input /></div>; }',
    'const Loose = () => <button>Bad</button>;',
  ].join('\n');
  // registered through owns[]
  let rep = linter.run(reactFixture({ 'index.tsx': tsx, 'styles.css': scopedCss, 'spec.json': scopedSpec({ name: 'demo-menu', owns: ['RowMenu'] }) }));
  assert.strictEqual(rep.findings.filter((f) => f.rule === 'raw-control-scoped' && f.severity === 'NOTE').length, 2);
  const raw = rep.findings.filter((f) => f.rule === 'raw-control');
  assert.strictEqual(raw.length, 1, 'the <button> in Loose is outside every registered body');
  assert.strictEqual(raw[0].severity, 'BLOCK');
  // registered by the element name itself (PascalCase registrations)
  const byName = tsx.replaceAll('RowMenu', 'DemoMenu');
  rep = linter.run(reactFixture({ 'index.tsx': byName, 'styles.css': scopedCss.replace('CUSTOM: demo-menu', 'CUSTOM: DemoMenu').replace('.demo-menu {', '.DemoMenu {'), 'spec.json': scopedSpec({ name: 'DemoMenu' }) }));
  assert.strictEqual(rep.findings.filter((f) => f.rule === 'raw-control-scoped').length, 2);
  // not registered at all: every raw control blocks, as before
  rep = linter.run(reactFixture({ 'index.tsx': tsx }));
  assert.strictEqual(rep.findings.filter((f) => f.rule === 'raw-control' && f.severity === 'BLOCK').length, 3);
});

test('without --baseline a NEW prototype keeps full strictness: missing demoStates and a new @media block', () => {
  const noStates = starter.replace(/^export const demoStates/m, 'const demoStatesX');
  assert.ok(blocks(reactFixture({ 'index.tsx': noStates })).some((f) => f.rule === 'demo-states'));
  const media = blocks(reactFixture({ 'styles.css': starterCss + '\n@media (min-width: 900px) { .x { display: block; } }\n/* @media (max-width: 10px) in a comment is not a query */' }));
  assert.strictEqual(media.filter((f) => f.rule === 'container-query').length, 1);
  assert.ok(media.find((f) => f.rule === 'container-query').line > 1, 'the query carries its own line');
});

// -- R-12: --baseline -----------------------------------------------------------

function jsonOf(rep) {
  return JSON.parse(JSON.stringify(rep.toJSON()));
}

test('--baseline: known findings become NOTE baseline, new ones still block', () => {
  const dir = reactFixture({
    'index.tsx': starter + '\nconst Raw = () => <button>Bad</button>;\n',
    'styles.css': starterCss + '\n@media (min-width: 900px) { .x { display: block; } }\n',
  });
  const before = jsonOf(linter.run(dir));
  assert.ok(before.counts.BLOCK >= 2);
  for (const f of before.findings) assert.match(f.fingerprint, /^[0-9a-f]{16}$/);
  // unchanged prototype: nothing new
  let rep = linter.run(dir, { baseline: before });
  assert.strictEqual(rep.counts().BLOCK, 0, JSON.stringify(rep.findings.filter((f) => f.severity === 'BLOCK')));
  assert.strictEqual(rep.exitCode(), 0);
  assert.ok(rep.findings.every((f) => f.rule !== 'baseline' || (f.severity === 'NOTE' && f.baselineRule && f.baselineSeverity)));
  assert.strictEqual(rep.meta.baseline.newBlock, 0);
  // a second raw <button>, a second @media and a missing demoStates are new
  fs.appendFileSync(path.join(dir, 'index.tsx'), 'const Raw2 = () => <button>Worse</button>;\n');
  fs.appendFileSync(path.join(dir, 'styles.css'), '@media (min-width: 1200px) { .y { display: none; } }\n');
  rep = linter.run(dir, { baseline: before });
  assert.deepStrictEqual(rep.findings.filter((f) => f.severity === 'BLOCK').map((f) => f.rule).sort(), ['container-query', 'raw-control']);
  assert.strictEqual(rep.exitCode(), 1);
  const tsx = fs.readFileSync(path.join(dir, 'index.tsx'), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.tsx'), tsx.replace(/^export const demoStates/m, 'const demoStatesX'));
  assert.ok(linter.run(dir, { baseline: before }).findings.some((f) => f.severity === 'BLOCK' && f.rule === 'demo-states'));
});

test('--baseline: shifting every line does not change a fingerprint', () => {
  const dir = reactFixture({
    'index.tsx': starter + '\nconst Raw = () => <button>Bad</button>;\n',
    'styles.css': starterCss + '\n.x { color: #abcdef; }\n',
  });
  const before = jsonOf(linter.run(dir));
  const fps = before.findings.map((f) => f.fingerprint).sort();
  fs.writeFileSync(path.join(dir, 'index.tsx'), '\n\n\n// moved\n' + fs.readFileSync(path.join(dir, 'index.tsx'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'styles.css'), '\n\n' + fs.readFileSync(path.join(dir, 'styles.css'), 'utf8'));
  const after = jsonOf(linter.run(dir));
  assert.deepStrictEqual(after.findings.map((f) => f.fingerprint).sort(), fps);
  assert.notDeepStrictEqual(after.findings.map((f) => f.line), before.findings.map((f) => f.line));
  assert.strictEqual(linter.run(dir, { baseline: before }).counts().BLOCK, 0);
});

test('--baseline: a baseline written before fingerprints existed matches on rule, file and message', () => {
  const dir = reactFixture({ 'index.tsx': starter + '\nconst Raw = () => <button>Bad</button>;\n' });
  const legacy = jsonOf(linter.run(dir));
  for (const f of legacy.findings) { delete f.fingerprint; delete f.snippet; f.line = (f.line || 0) + 40; }
  assert.strictEqual(linter.run(dir, { baseline: legacy }).counts().BLOCK, 0);
  fs.appendFileSync(path.join(dir, 'index.tsx'), 'const Raw2 = () => <button>Worse</button>;\n');
  assert.strictEqual(linter.run(dir, { baseline: legacy }).counts().BLOCK, 1, 'a multiset: one known <button> excuses one');
});

test('--baseline in the old format (no fingerprint field): looser rule+file+message match, a new rule still blocks', () => {
  const dir = reactFixture({ 'index.tsx': starter + '\nconst Raw = () => <button>Bad</button>;\n' });
  const modern = jsonOf(linter.run(dir));
  const legacy = JSON.parse(JSON.stringify(modern));
  for (const f of legacy.findings) { delete f.fingerprint; delete f.snippet; }
  assert.ok(legacy.findings.some((f) => f.rule === 'raw-control'), 'the fixture carries one raw <button>');
  // Rewrite the SAME finding on a different source line: the snippet changes,
  // rule + file + message do not.
  const file = path.join(dir, 'index.tsx');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<button>Bad</button>', '<button type="button">Zupelnie inny</button>'));
  // The modern baseline fingerprints the snippet, so the rewritten line is NEW.
  assert.strictEqual(linter.run(dir, { baseline: modern }).findings.filter((f) => f.severity === 'BLOCK' && f.rule === 'raw-control').length, 1,
    'a fingerprinted baseline sees the rewritten <button> as a new finding');
  // The old-format baseline is LOOSER by design: it matches on rule + file +
  // message only, so the same rule on any line of the same file is excused.
  let rep = linter.run(dir, { baseline: legacy });
  assert.strictEqual(rep.counts().BLOCK, 0, 'old format: rule + file + message excuses the rewritten line (looser than a fingerprint)');
  assert.ok(rep.notes.some((n) => /no fingerprint/.test(n) && /rule \+ file \+ message/.test(n)), 'the looser match is announced in the report');
  // ...but it never excuses a finding of ANOTHER rule: a new hardcoded colour blocks.
  fs.appendFileSync(path.join(dir, 'styles.css'), '\n.x { color: #abcdef; }\n');
  rep = linter.run(dir, { baseline: legacy });
  const open = rep.findings.filter((f) => f.severity === 'BLOCK');
  assert.deepStrictEqual(open.map((f) => f.rule), ['hardcoded-color'], JSON.stringify(open));
  assert.strictEqual(rep.exitCode(), 1, 'a new finding of another rule still fails the gate');
});

test('--baseline: only the old whole-file container-query verdict excuses every occurrence', () => {
  const dir = reactFixture({
    'styles.css': starterCss + '\n@media (min-width: 900px) { .x { display: block; } }\n@media (min-width: 1200px) { .y { display: none; } }\n',
    'spec.json': JSON.stringify({ customElements: [{ name: 'a-strip', reason: 'x', lead_confirmed: true }, { name: 'b-strip', reason: 'x', lead_confirmed: true }] }),
  });
  const file = path.relative(ROOT, dir) + '/';
  const legacy = {
    prototype: path.relative(ROOT, dir),
    findings: [
      { severity: 'BLOCK', rule: 'container-query', file: file + 'styles.css', line: null, message: 'viewport-width query in a React prototype' },
      { severity: 'BLOCK', rule: 'registry-mismatch', file: file + 'spec.json', line: null, message: 'custom registration has no matching named CSS marker' },
    ],
  };
  const rep = linter.run(dir, { baseline: legacy });
  const open = rep.findings.filter((f) => f.severity === 'BLOCK');
  assert.deepStrictEqual(open.filter((f) => f.rule === 'container-query'), [], 'both queries are covered by the old whole-file verdict');
  assert.strictEqual(open.filter((f) => f.rule === 'registry-mismatch' && /no matching named CSS marker/.test(f.message)).length, 1, 'one legacy registry entry excuses one, not two');
  assert.ok(rep.notes.some((n) => /no fingerprint/.test(n)), 'a legacy baseline says it should be regenerated');
});

test('--baseline on the CLI: missing or malformed file is a usage error', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = reactFixture();
  const cli = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-proto-ds.js'), dir, ...args], { encoding: 'utf8' });
  assert.strictEqual(cli(['--baseline', path.join(TMP, 'absent.json')]).status, 2);
  const bad = path.join(TMP, 'bad.json');
  fs.writeFileSync(bad, '{"no":"findings"}');
  assert.strictEqual(cli(['--baseline', bad]).status, 2);
  const good = path.join(TMP, 'good.json');
  fs.writeFileSync(good, JSON.stringify(jsonOf(linter.run(dir))));
  const res = cli(['--baseline', good, '--json']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).baseline.newBlock, 0);
  // a baseline taken for another prototype is refused
  const other = path.join(TMP, 'other.json');
  fs.writeFileSync(other, JSON.stringify(jsonOf(linter.run(reactFixture()))));
  assert.strictEqual(cli(['--baseline', other]).status, 2);
});

// -- R-22: deterministic halves of the guardian review (WARN) -------------------

const warns = (dir, rule) => linter.run(dir).findings.filter((f) => f.rule === rule && f.severity === 'WARN');

test('dsicon-svg-paint: an svg rule that paints is a WARN, a sizing one or a class named *-svg is not', () => {
  assert.strictEqual(warns(reactFixture({ 'styles.css': starterCss + '\n.x-row svg { color: var(--body-primary-text); }\n.x-row > svg:hover, .y { fill: currentColor; }\n' }), 'dsicon-svg-paint').length, 2);
  assert.deepStrictEqual(warns(reactFixture({ 'styles.css': starterCss + '\n.x-row svg { width: 16px; }\n.x-line-svg { stroke: var(--body-primary-text); }\n.x th:has(svg) { color: var(--body-primary-text); }\n' }), 'dsicon-svg-paint'), []);
  assert.deepStrictEqual(warns(reactFixture(), 'dsicon-svg-paint'), [], 'the starter is clean');
});

test('outline-none: without a focus replacement is a WARN, with one it is not', () => {
  assert.strictEqual(warns(reactFixture({ 'styles.css': starterCss + '\n.x-tile { outline: none; }\n' }), 'outline-none').length, 1);
  assert.deepStrictEqual(warns(reactFixture({ 'styles.css': starterCss + '\n.x-tile { outline: none; }\n.x-tile:focus-visible { box-shadow: 0 0 0 2px var(--clickable-primary-pressed-bg); }\n' }), 'outline-none'), []);
  assert.deepStrictEqual(warns(reactFixture({ 'styles.css': starterCss + '\n.x-field:focus-visible { outline: none; border-color: var(--form-primary-focused-border); }\n' }), 'outline-none'), []);
  assert.deepStrictEqual(warns(reactFixture(), 'outline-none'), [], 'the starter is clean');
});

test('hashed-class: a selector on a CSS-module class is a WARN, a structural one is not', () => {
  assert.strictEqual(warns(reactFixture({ 'styles.css': starterCss + '\n.x-tabs ._tab_149a3_1 { min-width: 120px; }\n' }), 'hashed-class').length, 1);
  assert.deepStrictEqual(warns(reactFixture({ 'styles.css': starterCss + '\n.x-tabs button[role="tab"] { min-width: 120px; }\n.x_tab_1 { gap: 0; }\n' }), 'hashed-class'), []);
  assert.deepStrictEqual(warns(reactFixture(), 'hashed-class'), [], 'the starter is clean');
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
