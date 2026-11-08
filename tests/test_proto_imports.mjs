// tests/test_proto_imports.mjs
// scripts/_proto-imports.js is the ONE import allowlist of a prototype's
// index.tsx. Two real entry points read it: the build/publish validator in
// server.js (_protoValidateTsx, throws) and the DS gate
// scripts/check-proto-ds.js (rule react-import). Before 2026-09-29 each had
// its own list and they disagreed - the server let Bryntum through and the
// gate blocked it - so the parity block below drives BOTH entry points over
// the same specifiers, never the shared predicate against itself.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imports = require(path.join(ROOT, 'scripts', '_proto-imports.js'));
const linter = require(path.join(ROOT, 'scripts', 'check-proto-ds.js'));
const srv = require(path.join(ROOT, 'server.js'));

const ALLOWED = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  './styles.css', './stores.json', './assets/icon.svg', './assets/photo.png?url',
  '../_shared/demo-state', '../_shared/proto-utils.css',
  '../../ds', '../../ds/Button', '../../components', '../../components/Card',
  '../../components/frame', '../../components/frame/AppFrame',
  '@bryntum/scheduler', '@bryntum/scheduler/scheduler.css', '@bryntum/scheduler-react', '@bryntum/scheduler-trial',
  'write-excel-file', 'write-excel-file/browser', 'jspdf', 'html2canvas',
];
const DENIED = [
  '@bryntum/gantt', '@bryntum/scheduler-pro', '@acme/ui', 'lodash', 'jspdf/dist/jspdf.es', 'html2canvas/dist/x',
  './helpers', './Widget.tsx', './other.css', './sub/data.json', './assets/helper.ts', './icon.svg',
  './assets/../../private.json', 'react/../../server', '../../../server.js', '/js/utils.js',
  'https://example.com/mod.js',
];

test('the shared predicate: required cases', () => {
  for (const spec of ALLOWED) assert.strictEqual(imports.isAllowedProtoImport(spec), true, spec);
  for (const spec of DENIED) assert.strictEqual(imports.isAllowedProtoImport(spec), false, spec);
});

test('extraction sees static, type, side-effect, re-export and dynamic imports, never comments', () => {
  const src = [
    "import React from 'react';",
    "import type { Schema } from 'write-excel-file/browser';",
    "import './styles.css';",
    "export { x } from '../../ds';",
    "const pdf = await import('jspdf');",
    "// import Bad from 'lodash';",
    "/* import Worse from 'left-pad'; */",
  ].join('\n');
  assert.deepStrictEqual(imports.protoImportSpecifiers(src).map((x) => x.spec),
    ['react', 'write-excel-file/browser', './styles.css', '../../ds', 'jspdf']);
  assert.deepStrictEqual(imports.disallowedProtoImports(src), []);
});

// `import.meta.glob('./assets/...')` loads a briefing's recorded frames by
// pattern. The pattern is a specifier: inside the prototype's own assets/
// folder it is allowed, anywhere else it is not.
const GLOB_ALLOWED = ['./assets/frames/*.jpg', './assets/*.png', './assets/**/*.{jpg,png}'];
const GLOB_DENIED = ['../x/*.jpg', './assets/../../secret/*.json', './assets/*.ts', './other/*.jpg', '/etc/*.json', '../../ds/*.png',
  './assets/{x,..}/{x,..}/{x,..}/{x,..}/{x,..}/*.json', './assets/*.{ts,js}', './assets/*.{png,ts}', './assets/[.][.]/*.json', './assets/!(x)/*.json', './assets/@(a|b)/*.png', './assets/+(a)/*.png', './assets/{a,b}/*.png', './assets/a?/*.png'];

test('import.meta.glob: patterns are specifiers, kept inside ./assets/', () => {
  for (const spec of GLOB_ALLOWED) {
    const src = `const f = import.meta.glob('${spec}', { eager: true, query: '?url', import: 'default' });`;
    assert.deepStrictEqual(imports.protoImportSpecifiers(src).map((x) => [x.spec, x.glob]), [[spec, true]], spec);
    assert.deepStrictEqual(imports.disallowedProtoImports(src), [], spec);
    assert.strictEqual(imports.isAllowedProtoImport(spec, { glob: true }), true, spec);
  }
  for (const spec of GLOB_DENIED) {
    const src = `const f = import.meta.glob('${spec}');`;
    assert.deepStrictEqual(imports.disallowedProtoImports(src).map((x) => x.spec), [spec], spec);
  }
  // An array of patterns is checked element by element.
  const arr = "import.meta.glob(['./assets/a/*.png', '../b/*.png'])";
  assert.deepStrictEqual(imports.disallowedProtoImports(arr).map((x) => x.spec), ['../b/*.png']);
  // A comment that mentions it is not a use.
  // Raw-source scan (fail closed): a glob call spelled inside a comment is still read.
  assert.deepStrictEqual(imports.protoImportSpecifiers("// import.meta.glob('../x/*.jpg')").map((x) => x.spec), ['../x/*.jpg']);
  // Backtick literals are read like quotes.
  assert.deepStrictEqual(imports.disallowedProtoImports('import.meta.glob(`./assets/frames/*.jpg`)'), []);
  assert.deepStrictEqual(imports.disallowedProtoImports('import.meta.glob(`../../../**/*.ts`)').map((x) => x.spec), ['../../../**/*.ts']);
  // Anything that is not a plain literal is refused outright.
  for (const bad of ['import.meta.glob(`./assets/${dir}/*.jpg`)', 'import.meta.glob(pattern)', "import.meta.glob(['./assets/a.png', other])", "import.meta.glob('./assets/' + x)"]) {
    assert.strictEqual(imports.disallowedProtoImports(bad).length > 0, true, bad);
  }
});

// Fail closed on every spelling of the call, not only `import.meta.glob(`.
const GLOB_SPELLINGS_REFUSED = [
  "import.meta.glob<string>('../../../../.encryption-key', { query: '?raw', import: 'default', eager: true })",
  "import.meta.glob<Record<string,string>>('../../*.json')",
  "import . meta . glob('../../*.json')",
  "(import.meta).glob('../../*.json')",
  "import.meta /* c */.glob('../../*.json')",
  "import.meta\n  .glob('../../*.json')",
  "import.meta.glob('./assets/a.png' + '/../../../../*.json')",
  "import.meta.glob<string>('./assets/a.png' + x)",
  "import.meta['glob']('../../*.json')",
];
test('import.meta.glob: every spelling resolves to a recognised literal call or is refused', () => {
  for (const src of GLOB_SPELLINGS_REFUSED) {
    assert.strictEqual(imports.disallowedProtoImports(`const f = ${src};`).length > 0, true, src);
  }
  const ok = "const f = import.meta.glob<string>('./assets/frames/*.jpg', { query: '?url', import: 'default', eager: true });";
  assert.deepStrictEqual(imports.disallowedProtoImports(ok), []);
  assert.deepStrictEqual(imports.protoImportSpecifiers(ok).map((x) => x.spec), ['./assets/frames/*.jpg']);
});

// The options argument is a strict allowlist: Vite pastes `import` into a generated
// static import line, so free text there is a file-read primitive.
test('import.meta.glob: options object is a strict allowlist', () => {
  const g = (o) => `const f = import.meta.glob('./assets/*.png', ${o});`;
  const refused = [
    "{ eager: true, import: 'default as k } from \"/abs/secret.txt?raw\"; console.log(\"LEAK\", k); import { default' }",
    "{ import: 'default as k' }", '{ exhaustive: true }', "{ base: '../..' }", "{ as: 'raw' }",
    "{ query: '?raw&x' }", '{ query: someVar }', '{ eager: !0 }', '{ ...o }',
    "{ ['import']: 'default' }", "{ eager: true /* c */ }", "{ eager: true, eager: false }",
    "{ import: `default` }", "{ eager: true }, extra", 'opts', '{ eager: true, nested: { a: 1 } }',
  ];
  for (const o of refused) {
    const d = imports.disallowedProtoImports(g(o));
    assert.strictEqual(d.length > 0, true, o);
    assert.strictEqual(d[0].spec, '<disallowed import.meta.glob options>', o);
  }
  const ok = [
    '{ eager: true }', "{ eager: false, query: '?url', import: 'default' }", "{ 'import': '*', \"query\": \"?raw\", }",
    "{import:'default',eager:true,}", "{ import: 'myExport_1' }", '{}',
  ];
  for (const o of ok) assert.deepStrictEqual(imports.disallowedProtoImports(g(o)), [], o);
  assert.deepStrictEqual(imports.disallowedProtoImports("import.meta.glob('./assets/*.png',)"), []);
  assert.deepStrictEqual(imports.disallowedProtoImports("import.meta.glob<{ default: string }>('./assets/*.png', { eager: true })"), []);
  assert.deepStrictEqual(imports.disallowedProtoImports("import.meta.glob(['./assets/*.{png,svg}', './assets/b/*.png'], { query: '?url', import: 'default' })"), []);
  assert.deepStrictEqual(imports.disallowedProtoImports('import.meta.glob(`./assets/*.png`, { eager: true })'), []);
});

// Escapes and the comment stripper's blind spots (regex literals, JSX text).
const GLOB_BYPASSES_REFUSED = [
  "const f = import.meta.glob('../../../**/*.json', {eager:true});",
  "const f = import.meta.\\u{67}lob('../../../**/*.json');",
  "const f = import.meta.gl\\u006fb('../../../**/*.json');",
  "const f = \\u0069mport.meta.glob('../../../**/*.json');",
  "const f = import.\\u006deta.glob('../../../**/*.json');",
  "const r = /x\\//; const f = import.meta.glob('../../../**/*.json');",
  "const r = /'/; const s = '/*'; const f = import.meta.glob('../../../**/*.json'); const e = '*/';",
  "const j = <div>see //{import.meta.glob('../../../**/*.json')}</div>;",
  "const j = <p>a /*</p>; const f = import.meta.glob('../../../**/*.json'); const k = <p>*/</p>;",
  // documented fail-closed outcome: a token inside a real comment is refused too
  "// import.meta.glob(pattern)\nconst x = 1;",
  "// import.meta.glob('../x/*.jpg')\nconst x = 1;",
];
test('import.meta.glob: escapes and stripper desync cannot hide a call', () => {
  for (const src of GLOB_BYPASSES_REFUSED) {
    assert.strictEqual(imports.disallowedProtoImports(src).length > 0, true, src);
  }
  for (const ok of [
    "const f = import.meta.glob('./assets/frames/*.jpg', { eager: true, import: 'default' });",
    "const f = import.meta.glob<{ default: string }>('./assets/frames/*.jpg', {eager:true,import:'default'});",
  ]) assert.deepStrictEqual(imports.disallowedProtoImports(ok), [], ok);
});

// Glob-anchored fail-closed rule: every standalone `glob` word must be the exact
// canonical `import.meta.glob<strict>?(` call. These all compile to a plain
// import.meta.glob in esbuild and used to slip past the detector.
const GLOB_ANCHOR_REFUSED = [
  "import.meta!.glob('../../../x/*.json')",
  "(import.meta as any).glob('../../../x/*.json')",
  "(import.meta satisfies ImportMeta).glob('../../../x/*.json')",
  "import.meta.glob<\">('./assets/a.png')\">('../../../x/*.json')",
  "import.meta.glob</*>('./assets/a.png')*/ any>('../../../x/*.json')",
  "const s = \"meta/*\"; const f = import.meta.glob('../../../x/*.json', {query:'?raw', eager:true}); const t = \"*/glob('./assets/a.png')\";",
  "const s = `meta/*`; const f = import.meta.glob('../../../x/*.json', {query:'?raw', eager:true}); const t = `*/glob('./assets/a.png')`;",
  "const s = \"meta//\"; const f = import.meta.glob('../../../x/*.json');\n\"glob('./assets/a.png')\";",
  "export const k = import.meta!.glob('../../../../.encryption-key', { query: '?raw', eager: true, import: 'default' });",
  "import /* c */ .meta.glob('./assets/a.png')",
  "import.meta./* c */glob('./assets/a.png')",
  "glob('./assets/a.png')",
  "const s = 'glob';",
  "foo.import.meta.glob('./assets/a.png')",
  "import.meta.glob('./assets/..*/x.json')",
  "import.meta.glob<string = 'x'>('./assets/a.png')",
];
test('import.meta.glob: glob-anchored rule refuses every non-canonical occurrence', () => {
  for (const src of GLOB_ANCHOR_REFUSED) {
    assert.strictEqual(imports.disallowedProtoImports(src).length > 0, true, src);
  }
  for (const ok of [
    "import.meta.glob('./assets/frames/*.jpg', { eager: true, import: 'default' })",
    "import.meta.glob<{ default: string }>('./assets/frames/*.jpg', {eager:true,import:'default'})",
    "import.meta.glob<string>('./assets/frames/*.jpg')",
    "import.meta.glob(['./assets/a/*.{png,svg}'], { query: '?url', import: 'default' })",
    'import.meta.glob(`./assets/frames/*.jpg`)',
    'import . meta . glob(\'./assets/a.png\')',
  ]) assert.deepStrictEqual(imports.disallowedProtoImports(ok), [], ok);
  for (const ok of [
    'const g = globalThis.x; declare global { interface Window { a: 1 } }',
    'const global = 1; const a$glob = 2; const globby = 3;',
  ]) assert.deepStrictEqual(imports.disallowedProtoImports(ok), [], ok);
});

// -- parity: server validator vs DS gate ----------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-imports-'));
const starter = fs.readFileSync(path.join(ROOT, 'templates/prototype/starter/blank/index.tsx'), 'utf8')
  .replace('{{PROTO_NAME_JSON}}', JSON.stringify('New prototype'));
const starterCss = fs.readFileSync(path.join(ROOT, 'templates/prototype/starter/blank/styles.css'), 'utf8');
let n = 0;

function serverVerdict(tsx) {
  try { srv._protoValidateTsx(tsx); return true; } catch (e) {
    if (/disallowed import/.test(e.message)) return false;
    throw e;
  }
}

function linterVerdict(tsx) {
  const dir = path.join(TMP, 'p' + n++);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'index.tsx'), tsx);
  fs.writeFileSync(path.join(dir, 'styles.css'), starterCss);
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify({ customElements: [] }));
  return !linter.run(dir).findings.some((f) => f.rule === 'react-import');
}

test('parity: the server validator and the DS gate give the same verdict on every glob pattern', () => {
  for (const spec of [...GLOB_ALLOWED, ...GLOB_DENIED]) {
    const tsx = `const f = import.meta.glob('${spec}', { eager: true });\n` + starter;
    const server = serverVerdict(tsx);
    const gate = linterVerdict(tsx);
    assert.strictEqual(server, gate, `${spec}: server ${server}, gate ${gate}`);
    assert.strictEqual(server, GLOB_ALLOWED.includes(spec), spec);
  }
  for (const src of GLOB_SPELLINGS_REFUSED) {
    const tsx = `const f = ${src};\n` + starter;
    assert.strictEqual(serverVerdict(tsx), false, src);
    assert.strictEqual(linterVerdict(tsx), false, src);
  }
});

test('parity: the server validator and the DS gate give the same verdict on every specifier', () => {
  for (const spec of [...ALLOWED, ...DENIED]) {
    for (const statement of [`import X from '${spec}';`, `const m = import('${spec}');`]) {
      const tsx = statement + '\n' + starter;
      const server = serverVerdict(tsx);
      const gate = linterVerdict(tsx);
      assert.strictEqual(server, gate, `${statement}: server ${server}, gate ${gate}`);
      assert.strictEqual(server, ALLOWED.includes(spec), statement);
    }
  }
});

// Regression gate for the shared allowlist: tightening it must never turn a
// prototype the team already has into a build/publish error. Read-only - it
// walks the plaintext tree and never writes there.
test('regression: the server validator accepts EVERY index.tsx in ds-data/prototypes', (t) => {
  const root = path.join(process.env.DATA_TIER_0_DIR || path.join(ROOT, 'data-sub-repositories', 'ds-data'), 'prototypes');
  if (!fs.existsSync(root)) { t.skip('ds-data/prototypes is not on this machine'); return; }
  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name, 'index.tsx'))
    .filter((f) => fs.existsSync(f));
  if (!files.length) { t.skip('no prototype index.tsx on this machine'); return; }
  const failures = [];
  for (const file of files) {
    try { srv._protoValidateTsx(fs.readFileSync(file, 'utf8')); } catch (e) {
      failures.push(path.basename(path.dirname(file)) + ': ' + e.message);
    }
  }
  assert.deepStrictEqual(failures, [], `${failures.length} of ${files.length} prototypes rejected`);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
