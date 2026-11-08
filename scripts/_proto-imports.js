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
// the shell: styles.css, top-level *.json and assets/ with its sub-folders
// (audit Z-10). A sibling
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

// `import.meta.glob('./assets/frames/*.jpg', ...)` loads a prototype's own
// pictures by pattern (a briefing's recorded frames). The pattern is a
// specifier too: it must stay inside the prototype's assets/ folder, which is
// exactly what the staging copies next to the source.
// Backtick literals count; the argument is read by protoImportSpecifiers, and
// anything that is not a plain literal (template with `${`, a variable, a
// call) is reported as GLOB_NON_LITERAL, which the allowlist always refuses.
// Fail closed, anchored on the word itself: EVERY standalone `glob` identifier
// in the source (strings, comments, casts, `bare glob(`, all of it) must be the
// exact canonical call `import.meta.glob<strict type arg>?( literal ...` (see
// parseGlobCall); every other occurrence yields GLOB_NON_LITERAL. `globalThis`,
// `global` and `declare global` are different words and do not match.
const GLOB_WORD_RE = /(?<![A-Za-z0-9_$])glob(?![A-Za-z0-9_$])/g;
const GLOB_PREFIX_RE = /(?<![A-Za-z0-9_$.])import\s*\.\s*meta\s*\.\s*$/;
const GLOB_NON_LITERAL = '<non-literal import.meta.glob pattern>';
const GLOB_BAD_OPTIONS = '<disallowed import.meta.glob options>';
// Strict shape: plain path characters only (no braces, classes or extglobs in
// the directory part, so vite cannot expand a segment to `..`) and an
// extension from the asset list, optionally as a `{a,b}` group of the same list.
const GLOB_EXT = '(?:json|png|svg|webp|jpe?g|gif|avif|woff2?|mp4|webm)';
const GLOB_ASSET_RE = new RegExp(
  '^\\./assets/(?:[A-Za-z0-9_*.-]+/)*[A-Za-z0-9_*.-]*\\.(?:' + GLOB_EXT + '|\\{' + GLOB_EXT + '(?:,' + GLOB_EXT + ')*\\})$',
);

const ASSET_RE = /^\.\/assets\/[^?]+\.(?:json|png|svg|webp|jpe?g|gif|avif|woff2?|mp4|webm)(?:\?url)?$/;

/**
 * True when `spec` may appear in a prototype's index.tsx. `opts.glob` marks a
 * pattern given to `import.meta.glob`: it must be ./assets/... with no `..`.
 * @param {string} spec
 * @param {{glob?: boolean}} [opts]
 * @returns {boolean}
 */
function isAllowedProtoImport(spec, opts) {
  if (typeof spec !== 'string' || !spec) return false;
  if (opts && opts.glob) {
    return !spec.split('/').some((seg) => seg.startsWith('..')) && GLOB_ASSET_RE.test(spec);
  }
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

// esbuild decodes `\uXXXX` / `\u{...}` inside identifiers, so `import.meta.\u{67}lob`
// is a glob call. Decode only escapes that yield an identifier character; any other
// escape stays as written (a backslash inside a pattern literal is refused anyway).
function decodeIdentEscapes(src) {
  return src.replace(/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/g, (all, a, b) => {
    const cp = parseInt(a || b, 16);
    if (!(cp <= 0x10ffff)) return all;
    const ch = String.fromCodePoint(cp);
    return /^[A-Za-z0-9_$]$/.test(ch) ? ch : all;
  });
}

// Parses what follows the `glob` token: optional strict TS generic `<...>`, `(`, then
// one string/backtick literal or an array of only such literals, immediately
// followed by `,` or `)`. Returns the literal contents, or null for anything else.
function parseGlobCall(src, from) {
  let i = from;
  const n = src.length;
  const ws = () => { while (i < n && /\s/.test(src[i])) i++; };
  ws();
  if (src[i] === '<') {
    // Strict type argument: plain type characters only (no quote, slash,
    // backtick, paren, `=` or `*`), balanced, ending in `>`.
    let depth = 0;
    for (; i < n; i++) {
      const ch = src[i];
      if (ch === '<') depth++;
      else if (ch === '>') { depth--; if (depth === 0) { i++; break; } }
      else if (!/[A-Za-z0-9_\s,{}:;[\]|]/.test(ch)) return null;
    }
    if (depth !== 0) return null;
    ws();
  }
  if (src[i] !== '(') return null;
  i++;
  ws();
  const literal = () => {
    const q = src[i];
    if (q !== "'" && q !== '"' && q !== '`') return null;
    let j = i + 1;
    while (j < n && src[j] !== q) {
      if (src[j] === '\\' || (q === '`' && src[j] === '$') || (q !== '`' && src[j] === '\n')) return null;
      j++;
    }
    if (j >= n) return null;
    const val = src.slice(i + 1, j);
    i = j + 1;
    return val || null;
  };
  const parts = [];
  if (src[i] === '[') {
    i++;
    ws();
    while (src[i] !== ']') {
      const v = literal();
      if (v === null) return null;
      parts.push(v);
      ws();
      if (src[i] === ',') { i++; ws(); } else if (src[i] !== ']') return null;
    }
    i++;
    if (!parts.length) return null;
  } else {
    const v = literal();
    if (v === null) return null;
    parts.push(v);
  }
  ws();
  if (src[i] === ')') return parts;
  if (src[i] !== ',') return null;
  i++;
  ws();
  if (src[i] === ')') return parts;
  // Second argument: a strict options allowlist, fail closed. Vite pastes `import`
  // into a generated static import line, so no free text may pass.
  const refuse = () => GLOB_BAD_OPTIONS;
  if (src[i] !== '{') return refuse();
  i++;
  ws();
  const seen = new Set();
  while (src[i] !== '}') {
    const km = /^(?:'(eager|import|query)'|"(eager|import|query)"|(eager|import|query)(?![A-Za-z0-9_$]))/.exec(src.slice(i, i + 12));
    if (!km) return refuse();
    const key = km[1] || km[2] || km[3];
    if (seen.has(key)) return refuse();
    seen.add(key);
    i += km[0].length;
    ws();
    if (src[i] !== ':') return refuse();
    i++;
    ws();
    const rest = src.slice(i, i + 200);
    let vm;
    if (key === 'eager') vm = /^(?:true|false)(?![A-Za-z0-9_$])/.exec(rest);
    else if (key === 'query') vm = /^(?:'\?(?:url|raw)'|"\?(?:url|raw)")/.exec(rest);
    else vm = /^(?:'(?:[A-Za-z_$][A-Za-z0-9_$]*|\*)'|"(?:[A-Za-z_$][A-Za-z0-9_$]*|\*)")/.exec(rest);
    if (!vm) return refuse();
    i += vm[0].length;
    ws();
    if (src[i] === ',') { i++; ws(); } else if (src[i] !== '}') return refuse();
  }
  i++;
  ws();
  if (src[i] === ',') { i++; ws(); }
  return src[i] === ')' ? parts : refuse();
}

const IMPORT_RE = /\b(?:import|export)\s+(?:(?:[\w*{][\s\S]*?)\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Every import specifier in `src`: static, `import type`, side-effect,
 * `export ... from`, dynamic `import('x')` and the patterns of
 * `import.meta.glob(...)` (reported with `glob: true`). Comments are blanked first.
 * @param {string} src
 * @returns {{spec: string, index: number, glob?: boolean}[]}
 */
function protoImportSpecifiers(src) {
  const raw = String(src || '');
  const source = stripComments(raw);
  const out = [];
  for (const m of source.matchAll(IMPORT_RE)) out.push({ spec: m[1] || m[2], index: m.index });
  // The glob scan reads the RAW source (escape-decoded), never the stripped one:
  // the stripper does not know regex literals or JSX text and can blank a real call.
  // Every standalone `glob` word must be a canonical import.meta.glob call.
  const globSrc = decodeIdentEscapes(raw);
  for (const m of globSrc.matchAll(GLOB_WORD_RE)) {
    const before = globSrc.slice(Math.max(0, m.index - 300), m.index);
    const parts = GLOB_PREFIX_RE.test(before) ? parseGlobCall(globSrc, m.index + m[0].length) : null;
    if (parts === GLOB_BAD_OPTIONS) out.push({ spec: GLOB_BAD_OPTIONS, index: m.index, glob: true });
    else if (!parts) out.push({ spec: GLOB_NON_LITERAL, index: m.index, glob: true });
    else for (const part of parts) out.push({ spec: part, index: m.index, glob: true });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * The specifiers in `src` that the allowlist rejects, in source order.
 * @param {string} src
 * @returns {{spec: string, index: number}[]}
 */
function disallowedProtoImports(src) {
  return protoImportSpecifiers(src).filter((x) => !isAllowedProtoImport(x.spec, { glob: x.glob === true }));
}

module.exports = {
  PROTO_IMPORT_PACKAGES,
  isAllowedProtoImport,
  protoImportSpecifiers,
  disallowedProtoImports,
  stripComments,
};
