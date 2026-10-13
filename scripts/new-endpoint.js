#!/usr/bin/env node
'use strict';
// scripts/new-endpoint.js
// The server-side twin of scripts/new-view.js: handler stub in the matching
// `// -- Nazwa --` section, dispatch-ladder arm, a lock when the method writes,
// and an API test stub. Everything is located by anchor, never by line number.
//
//   node scripts/new-endpoint.js GET /api/raporty/list
//   node scripts/new-endpoint.js POST /api/raporty/save --lock --dry-run
//
// Rules it encodes so the model does not have to:
//   * handlers go INTO a section, never appended below the dispatch ladder
//   * a write route (POST/PUT/PATCH/DELETE) gets a chain lock plus tmp+rename
//   * mutating routes go through dispatch(...) so the Origin check and the rate
//     limiter still cover them
//   * every JSON response leaves through jsonResponse(...)
//   * every new route gets a tests/test_api_*.js case
//
// It only ever CREATES a test file; it never edits an existing test suite.
//
// Exit: 0 written / dry-run, 1 refused (already exists), 2 usage / missing anchor.

const fs = require('fs');
const path = require('path');
const R = require('./_report');

const HELP = `
new-endpoint.js - scaffold a server.js route, its handler, its lock and its test

Usage:
  node scripts/new-endpoint.js <METHOD> <path> [--handler <name>] [--lock]
                               [--section <name>] [--no-test] [--dry-run]
                               [--root <dir>] [--json]

  <METHOD>    GET | POST | PUT | PATCH | DELETE
  <path>      must start with /api/
  --handler   handler function name (default derived from the path)
  --lock      force a chain lock (implied for POST/PUT/PATCH/DELETE)
  --section   server.js section header to insert into (default: matched from
              the path group, else a new section above the dispatch ladder)
  --no-test   skip the tests/test_api_*.js stub

Exit codes: 0 ok, 1 refused (the route already exists), 2 usage / missing anchor.
`;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Box-drawing horizontal line used by the repo's section headers, as an escape.
const BAR = '\u2500';
const HEADER_WIDTH = 78;

function pascal(s) {
  return String(s).split(/[^a-zA-Z0-9]+/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function sectionHeader(name) {
  const prefix = '// ' + BAR.repeat(2) + ' ' + name + ' ';
  const pad = Math.max(3, HEADER_WIDTH - prefix.length);
  return prefix + BAR.repeat(pad);
}

/** All `// --- Name ---` section headers with their offsets, in file order. */
function findSections(text) {
  const out = [];
  const re = new RegExp('^//\\s*' + BAR + '+\\s*(.+?)\\s*' + BAR + '*\\s*$', 'gm');
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1].replace(new RegExp(BAR + '+$'), '').trim(), start: m.index, headerEnd: m.index + m[0].length });
  }
  return out;
}

function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function handlerSource(opts) {
  const { handler, method, routePath, lock, lockName } = opts;
  const isWrite = WRITE_METHODS.has(method);
  const isAsync = isWrite || lock;
  const L = [];
  L.push('');
  if (lock) {
    L.push('// Serializes access behind ' + method + ' ' + routePath + ' so two clients never');
    L.push('// interleave a read-modify-write on the same JSON file.');
    L.push('const ' + lockName + ' = _makeChainLock();');
    L.push('');
  }
  L.push('/**');
  L.push(' * ' + method + ' ' + routePath);
  L.push(' * Scaffolded by scripts/new-endpoint.js - fill in the body.');
  L.push(' */');
  L.push((isAsync ? 'async ' : '') + 'function ' + handler + '(req, res) {');
  if (isWrite) {
    L.push('  let body;');
    L.push('  try {');
    // readBody PARSES - it resolves the object, not the text. The old template
    // wrapped it in JSON.parse again, which turned every valid body into
    // "[object Object]" and answered 400 invalid-json for a correct request.
    L.push('    body = await readBody(req, 1024 * 64);');
    L.push('  } catch (_e) {');
    L.push("    return jsonResponse(res, 400, { error: 'invalid-json' });");
    L.push('  }');
    L.push('  void body; // TODO: validate every field before it reaches the filesystem.');
    L.push('');
  }
  if (lock) {
    L.push('  const result = await ' + lockName + '(async () => {');
    if (isWrite) {
      L.push('    // TODO: read, modify, then write tmp + rename (never a bare');
      L.push('    // fs.writeFileSync on a shared JSON file).');
    } else {
      L.push('    // TODO: read the data this route serves.');
    }
    L.push('    return { ok: true };');
    L.push('  });');
    L.push('');
    L.push('  jsonResponse(res, 200, result);');
  } else {
    L.push('  // TODO: read the data this route serves.');
    L.push("  jsonResponse(res, 200, { ok: true });");
  }
  L.push('}');
  L.push('');
  return L.join('\n');
}

function dispatchArm(method, routePath, handler, useDispatch) {
  const call = useDispatch
    ? '    dispatch(' + handler + ', req, res);'
    : '    ' + handler + '(req, res);';
  return [
    '',
    '  // ' + method + ' ' + routePath + ' (scaffolded by scripts/new-endpoint.js)',
    "  } else if (method === '" + method + "' && urlPath === '" + routePath + "') {",
    call,
  ].join('\n') + '\n';
}

function testSource(method, routePath, group, port) {
  const isWrite = WRITE_METHODS.has(method);
  const fn = isWrite ? 'postJson' : 'getJson';
  return [
    "'use strict';",
    '// tests/test_api_' + group + '.js',
    '// API test for ' + method + ' ' + routePath + '.',
    '// Scaffolded by scripts/new-endpoint.js - replace the contract assertions',
    '// with the real ones before shipping.',
    '',
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { startServer, waitForServer, stopServer, " + fn + " } = require('./_api_helper');",
    '',
    'const PORT = ' + port + ';',
    'let child;',
    '',
    'test.before(async () => {',
    '  child = startServer(PORT);',
    '  await waitForServer(PORT);',
    '});',
    '',
    'test.after(async () => { await stopServer(child); });',
    '',
    "test('" + method + ' ' + routePath + " answers JSON', async () => {",
    '  const { status, body } = await ' + fn + "(PORT, '" + routePath + "'" + (isWrite ? ', {}' : '') + ');',
    '  assert.ok(status < 500, `unexpected ${status}`);',
    "  assert.strictEqual(typeof body, 'object');",
    '});',
    '',
  ].join('\n');
}

/** A test port that no existing tests/test_api_*.js already claims. */
function pickPort(root) {
  const used = new Set();
  try {
    for (const f of fs.readdirSync(path.join(root, 'tests'))) {
      if (!/^test_api_.*\.js$/.test(f)) continue;
      const text = fs.readFileSync(path.join(root, 'tests', f), 'utf8');
      const m = /const PORT\s*=\s*(\d+)/.exec(text);
      if (m) used.add(parseInt(m[1], 10));
    }
  } catch (_e) { /* no tests dir */ }
  let p = 3490;
  while (used.has(p) && p < 3600) p++;
  return p;
}

function run(flags, positionals) {
  const root = flags.root ? path.resolve(String(flags.root)) : R.ROOT;
  const method = String(positionals[0] || '').toUpperCase();
  const routePath = String(positionals[1] || '');
  if (!METHODS.has(method)) R.usageError('METHOD must be one of GET, POST, PUT, PATCH, DELETE (got "' + positionals[0] + '")');
  if (!/^\/api\/[a-z0-9][a-z0-9/-]*$/.test(routePath)) R.usageError('path must start with /api/ and be lowercase kebab (got "' + routePath + '")');

  const serverRel = 'server.js';
  let text = R.readFileSafe(path.join(root, serverRel));
  if (text === null) throw new Error(serverRel + ' not found under ' + root);

  const segs = routePath.replace(/^\/api\//, '').split('/').filter(Boolean);
  const group = segs[0];
  const handler = flags.handler ? String(flags.handler) : 'handle' + pascal(segs.join('-'));
  const lock = Boolean(flags.lock) || WRITE_METHODS.has(method);
  const lockName = 'with' + pascal(segs.join('-')) + 'Lock';

  // Refuse before touching anything.
  if (text.indexOf("urlPath === '" + routePath + "'") !== -1) {
    return { refused: true, reason: 'route ' + routePath + ' already exists in server.js' };
  }
  if (new RegExp('function\\s+' + handler + '\\s*\\(').test(text)) {
    return { refused: true, reason: 'handler ' + handler + ' already exists in server.js (pass --handler)' };
  }

  // -- Anchors ---------------------------------------------------------------
  const sections = findSections(text);
  if (sections.length === 0) throw new Error('server.js: no `// -- Nazwa --` section headers found - cannot place the handler');
  const dispatchSection = sections.find((s) => /route dispatch/i.test(s.name));
  if (!dispatchSection) throw new Error('server.js: the `Route dispatch` section header was not found - cannot place the handler or the route');

  const chainLockAt = text.indexOf('_makeChainLock');
  if (lock && chainLockAt === -1) throw new Error('server.js: `_makeChainLock` not found - cannot scaffold a lock');

  // Which section does the handler go into?
  const wanted = flags.section ? norm(flags.section) : norm(group);
  let target = null;
  for (const s of sections) {
    if (s.start >= dispatchSection.start) break;
    if (norm(s.name).indexOf(wanted) !== -1) target = s;
  }

  let insertAt;
  let newSectionName = null;
  if (target) {
    // End of that section = the start of the next header.
    const next = sections.find((s) => s.start > target.start);
    insertAt = next ? next.start : dispatchSection.start;
  } else {
    newSectionName = pascal(group) + ' endpoints';
    insertAt = dispatchSection.start;
  }
  // A lock const must sit below the _makeChainLock definition.
  if (lock && insertAt <= chainLockAt) {
    newSectionName = newSectionName || (pascal(group) + ' endpoints');
    insertAt = dispatchSection.start;
    target = null;
  }

  let handlerBlock = handlerSource({ handler, method, routePath, lock, lockName });
  if (newSectionName) handlerBlock = sectionHeader(newSectionName) + '\n' + handlerBlock + '\n';
  text = text.slice(0, insertAt) + handlerBlock + text.slice(insertAt);

  // -- Dispatch arm ----------------------------------------------------------
  // Insert before the first of the trailing arms, so the new route sits inside
  // the ladder and above the catch-alls.
  const ANCHORS = [
    /\n[ \t]*\/\/ Wave 2 placeholders[^\n]*\n/,
    /\n[ \t]*\} else if \(_isWave2Route\(urlPath\)\) \{/,
    /\n[ \t]*\/\/ Fallbacks[^\n]*\n/,
    /\n[ \t]*\} else if \(urlPath\.startsWith\('\/api\/'\)\) \{/,
  ];
  let armAt = -1;
  for (const re of ANCHORS) {
    const m = re.exec(text.slice(dispatchSection.start + handlerBlock.length));
    if (m) { armAt = dispatchSection.start + handlerBlock.length + m.index; break; }
  }
  if (armAt === -1) {
    throw new Error('server.js: no dispatch-ladder tail anchor found '
      + '(expected one of "// Wave 2 placeholders", "_isWave2Route(urlPath)", "// Fallbacks", '
      + '"urlPath.startsWith(\'/api/\')") - the route was NOT written');
  }
  const useDispatch = WRITE_METHODS.has(method) || lock;
  text = text.slice(0, armAt) + dispatchArm(method, routePath, handler, useDispatch) + text.slice(armAt);

  const edits = [{ file: serverRel, next: text }];

  // -- Test stub -------------------------------------------------------------
  let testRel = null;
  if (!flags['no-test']) {
    testRel = 'tests/test_api_' + segs.join('_').replace(/-/g, '_') + '.js';
    if (fs.existsSync(path.join(root, testRel))) {
      return { refused: true, reason: testRel + ' already exists - add the case by hand (this script never edits an existing suite)' };
    }
    edits.push({ file: testRel, next: testSource(method, routePath, segs.join('_').replace(/-/g, '_'), pickPort(root)), create: true });
  }

  return {
    refused: false, edits, root, method, routePath, handler, lock,
    section: target ? target.name : newSectionName, newSection: Boolean(newSectionName), testRel,
  };
}

function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2), { booleans: ['dry-run', 'no-test', 'lock'] });
  if (flags.help || positionals.length < 2) R.showHelp(HELP);

  let out;
  try { out = run(flags, positionals); } catch (e) { R.usageError(e.message); }

  if (out.refused) {
    if (flags.json) process.stdout.write(JSON.stringify({ script: 'new-endpoint', refused: true, reason: out.reason }, null, 2) + '\n');
    else process.stdout.write('new-endpoint: refused - ' + out.reason + '\n');
    process.exit(1);
  }

  const summary = out.edits.map((e) => ({ file: e.file, action: e.create ? 'create' : 'edit' }));
  const meta = {
    script: 'new-endpoint',
    method: out.method,
    path: out.routePath,
    handler: out.handler,
    lock: out.lock,
    section: out.section,
    new_section: out.newSection,
    test: out.testRel,
    edits: summary,
  };

  if (flags['dry-run']) {
    if (flags.json) process.stdout.write(JSON.stringify(Object.assign({ dry_run: true }, meta), null, 2) + '\n');
    else {
      const t = ['NEW ENDPOINT (dry run): ' + out.method + ' ' + out.routePath,
        '  handler: ' + out.handler + (out.lock ? '  (chain lock)' : ''),
        '  section: ' + out.section + (out.newSection ? ' (new)' : ''),
        ''];
      for (const e of summary) t.push('  ' + e.action.padEnd(6) + ' ' + e.file);
      t.push('');
      t.push('Nothing written. Re-run without --dry-run to apply.');
      process.stdout.write(t.join('\n') + '\n');
    }
    process.exit(0);
  }

  for (const e of out.edits) {
    const abs = path.join(out.root, e.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, e.next, 'utf8');
  }

  if (flags.json) process.stdout.write(JSON.stringify(meta, null, 2) + '\n');
  else {
    const t = ['NEW ENDPOINT: ' + out.method + ' ' + out.routePath + '  ->  ' + out.handler,
      '  section: ' + out.section + (out.newSection ? ' (new)' : ''), ''];
    for (const e of summary) t.push('  ' + e.action.padEnd(6) + ' ' + e.file);
    t.push('');
    t.push('Next: fill in the handler, then `npm run lint` and `npm run test:api`.');
    process.stdout.write(t.join('\n') + '\n');
  }
  process.exit(0);
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('new-endpoint internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { run, pascal, findSections, sectionHeader, handlerSource, dispatchArm, testSource };
}
