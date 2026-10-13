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

// -- parity: server validator vs DS gate ----------------------------------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-imports-'));
const starter = fs.readFileSync(path.join(ROOT, 'templates/prototype/starter/index.tsx'), 'utf8')
  .replace('{{PROTO_NAME_JSON}}', JSON.stringify('New prototype'));
const starterCss = fs.readFileSync(path.join(ROOT, 'templates/prototype/starter/styles.css'), 'utf8');
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
