'use strict';
// scripts/_proto-imports.js
// The ONE list of import specifiers a prototype's index.tsx may use, shared by
// the build/publish validator in server.js (_protoValidateTsx) and by the DS
// gate scripts/check-proto-ds.js (rule react-import). There used to be two
// lists: the server accepted Bryntum and the linter blocked it, the linter
// rejected `./assets/x.ts` and the server let it through - so the verdict of
// /prototype depended on which tool was asked (audit R-01/R-02, 2026-09-29).
// Both callers now require this module; tests/test_proto_imports.mjs drives
// the two real entry points over the same specifiers and asserts one verdict.
//
// Packages are the UNION of the two former lists plus the export libraries
// the production schedules app uses. Local paths keep the stricter rule the
// linter had, because it matches what _protoStageSources really copies into
// the shell: styles.css, top-level *.json and assets/ (audit Z-10). A sibling
// TS module, a second stylesheet or a path climbing out with `..` would build
// here and break in the shell or on the publishing host.
//
// No design-system package is listed: '../../ds' is the one DS surface of a
// prototype, which is what lets the compliance tools reason about one import
// path instead of every package export.
//
// Dependency-free, CommonJS, no side effects: server.js requires it lazily
// next to the validator and the linter requires it at the top.

// Bare package specifiers. `exact` must equal the specifier, `prefix` also
// admits a subpath (`write-excel-file/browser`).
const PROTO_IMPORT_PACKAGES = Object.freeze([
  Object.freeze({ name: 'react', subpaths: true }),
  Object.freeze({ name: 'react-dom', subpaths: true }),
  // Schedules are the one case the DS does not cover: the build shell declares
  // Bryntum itself (the licensed name or the trial it is aliased to).
  Object.freeze({ name: '@bryntum/scheduler', subpaths: true }),
  Object.freeze({ name: '@bryntum/scheduler-react', subpaths: true }),
  Object.freeze({ name: '@bryntum/scheduler-trial', subpaths: true }),
  // File-producing export libraries (xlsx, pdf, screenshot).
  Object.freeze({ name: 'write-excel-file', subpaths: true }),
  Object.freeze({ name: 'jspdf', subpaths: false }),
  Object.freeze({ name: 'html2canvas', subpaths: false }),
]);

const ASSET_RE = /^\.\/assets\/[^?]+\.(?:json|png|svg|webp|jpe?g|gif|avif|woff2?|mp4|webm)(?:\?url)?$/;

/**
 * True when `spec` may appear in a prototype's index.tsx.
 * @param {string} spec
 * @returns {boolean}
 */
function isAllowedProtoImport(spec) {
  if (typeof spec !== 'string' || !spec) return false;
  // `..` after the leading `./` / `../..` prefix would climb out of the
  // staged tree (`./assets/../../x.json`, `react/../../x`).
  const segs = spec.split('/');
  let lead = 0;
  while (lead < segs.length && (segs[lead] === '.' || segs[lead] === '..')) lead++;
  if (segs.slice(lead).includes('..')) return false;
  for (const p of PROTO_IMPORT_PACKAGES) {
    if (spec === p.name) return true;
    if (p.subpaths && spec.startsWith(p.name + '/')) return true;
  }
  if (spec === './styles.css') return true;
  if (/^\.\/[^/]+\.json$/.test(spec)) return true;
  if (ASSET_RE.test(spec)) return true;
  // The shared layers the shell stages next to every prototype.
  if (spec.startsWith('../_shared/')) return true;
  if (spec === '../../ds' || spec.startsWith('../../ds/')) return true;
  if (spec === '../../components' || spec.startsWith('../../components/')) return true;
  return false;
}

// Blanks every comment in a TS/TSX source while keeping its length, so the
// indexes callers report still map to the original lines. A sequential scan,
// not two regexes: the first version stripped `/* ... */` before `//`, and a
// line comment carrying `./*` (the starter's import-allowlist prose) opened a
// block comment that swallowed everything up to the next `*/`. Strings and
// template literals are skipped so a `//` inside a URL does not start a
// comment either.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      while (i < stop) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { out += src[i]; i++; }
        if (i < n) { out += src[i]; i++; }
        if (c !== '`' && src[i - 1] === '\n') break;
      }
      if (i < n) { out += src[i]; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const IMPORT_RE = /\b(?:import|export)\s+(?:(?:[\w*{][\s\S]*?)\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Every import specifier in `src`: static, `import type`, side-effect,
 * `export ... from` and dynamic `import('x')`. Comments are blanked first.
 * @param {string} src
 * @returns {{spec: string, index: number}[]}
 */
function protoImportSpecifiers(src) {
  const source = stripComments(String(src || ''));
  const out = [];
  for (const m of source.matchAll(IMPORT_RE)) out.push({ spec: m[1] || m[2], index: m.index });
  return out;
}

/**
 * The specifiers in `src` that the allowlist rejects, in source order.
 * @param {string} src
 * @returns {{spec: string, index: number}[]}
 */
function disallowedProtoImports(src) {
  return protoImportSpecifiers(src).filter((x) => !isAllowedProtoImport(x.spec));
}

module.exports = {
  PROTO_IMPORT_PACKAGES,
  isAllowedProtoImport,
  protoImportSpecifiers,
  disallowedProtoImports,
  stripComments,
};
