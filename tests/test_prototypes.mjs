// tests/test_prototypes.mjs
// Pure helpers exported from js/prototypy.js - the part of the Etap 1 slice
// that carries branching logic and needs no document. Budget: one file, four
// cases, per the plan (2026-09-12-prototypy-migracja.md).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  protoIsReact,
  protoLaunchUrl,
  filterPrototypes,
  matchOwnerMembers,
  ownerIdsInUse,
  validatePrototypeName,
  protoErrorMessage,
  protoStartCommand,
  PROTO_NAME_MAX_LEN,
} = await import(pathToFileURL(path.join(ROOT, 'js', 'prototypy.js')).href);

// ── Format recognition ───────────────────────────────────────────────────────
// `format` is computed server-side (server.js `_protoFormat`, presence of
// index.tsx) - the client only ever READS the field, never re-derives it.

test('protoIsReact reads the server-computed format field, defensively', () => {
  assert.strictEqual(protoIsReact({ format: 'react' }), true);
  assert.strictEqual(protoIsReact({ format: 'vanilla' }), false);
  assert.strictEqual(protoIsReact({}), false);
  assert.strictEqual(protoIsReact(null), false);
  assert.strictEqual(protoIsReact(undefined), false);
});

// ── Built-version URL builder ────────────────────────────────────────────────

test('protoLaunchUrl strips the proto- prefix and a trailing slash on baseUrl', () => {
  assert.strictEqual(
    protoLaunchUrl('https://prototypes.example.com', 'proto-planner'),
    'https://prototypes.example.com/planner',
  );
  assert.strictEqual(
    protoLaunchUrl('https://prototypes.example.com/', 'proto-63a72b7fd077'),
    'https://prototypes.example.com/63a72b7fd077',
  );
  // An id with no "proto-" prefix (defensive - every real id carries one) is
  // used verbatim rather than mangled.
  assert.strictEqual(protoLaunchUrl('https://x.dev', 'no-prefix'), 'https://x.dev/no-prefix');
});

// ── Registry search filter ───────────────────────────────────────────────────

// The owner filter narrows BEFORE the query, so both criteria work together,
// not one instead of the other. ownerIdsInUse feeds the dropdown only with what
// actually occurs in the registry.
test('filterPrototypes narrows by owner and combines it with the query', () => {
  const items = [
    { id: 'proto-a', name: 'Retail orders', owners: ['tm-1', 'tm-2'] },
    { id: 'proto-b', name: 'Wholesale orders', owners: ['tm-2'] },
    { id: 'proto-c', name: 'KPIx', owners: [] },
    { id: 'proto-d', name: 'No owners field' },
  ];
  assert.deepStrictEqual(filterPrototypes(items, '', '').map((i) => i.id), ['proto-a', 'proto-b', 'proto-c', 'proto-d'], 'no owner selected returns everything');
  assert.deepStrictEqual(filterPrototypes(items, '', 'tm-1').map((i) => i.id), ['proto-a']);
  assert.deepStrictEqual(filterPrototypes(items, '', 'tm-2').map((i) => i.id), ['proto-a', 'proto-b']);
  assert.deepStrictEqual(filterPrototypes(items, 'wholesale', 'tm-2').map((i) => i.id), ['proto-b'], 'owner and query both apply');
  assert.deepStrictEqual(filterPrototypes(items, 'wholesale', 'tm-1'), [], 'contradictory criteria yield nothing');
  assert.deepStrictEqual(filterPrototypes(items, '', 'tm-unknown'), []);
});

test('ownerIdsInUse returns the distinct, sorted owner ids actually present', () => {
  const items = [
    { id: 'proto-a', owners: ['tm-2', 'tm-1'] },
    { id: 'proto-b', owners: ['tm-1', '', null] },
    { id: 'proto-c', owners: [] },
    { id: 'proto-d' },
  ];
  assert.deepStrictEqual(ownerIdsInUse(items), ['tm-1', 'tm-2'], 'deduplicated, sorted, empty entries dropped');
  assert.deepStrictEqual(ownerIdsInUse([]), []);
  assert.deepStrictEqual(ownerIdsInUse(null), [], 'defensive on a non-array input');
});

// The card shows the initiative name, so the search must cover it - otherwise
// typing what is on screen gives zero results (caught in the browser: the
// prototype "proto-planner" is called "Team goals...", and "Planner"
// is its initiative).
test('filterPrototypes also matches the discovery initiative title shown on the card', () => {
  const items = [
    { id: 'proto-planner', name: 'Team goals and performance indicators', discoveryTaskId: 'dt-1' },
    { id: 'proto-b', name: 'Orders - Ledger', discoveryTaskId: 'dt-2' },
    { id: 'proto-c', name: 'Without initiative' },
  ];
  const initiatives = { 'dt-1': 'Change planner', 'dt-2': 'Orders pace and tops' };
  assert.deepStrictEqual(filterPrototypes(items, 'change planner', '', initiatives).map((i) => i.id), ['proto-planner'], 'initiative matched');
  assert.deepStrictEqual(filterPrototypes(items, 'Change Planner', '', initiatives).map((i) => i.id), ['proto-planner']);
  assert.deepStrictEqual(filterPrototypes(items, 'ledger', '', initiatives).map((i) => i.id), ['proto-b'], 'the prototype name still matches');
  assert.deepStrictEqual(filterPrototypes(items, 'orders', '', initiatives).map((i) => i.id), ['proto-b'], 'name and initiative both hit the same card, listed once');
  assert.deepStrictEqual(filterPrototypes(items, 'change planner', '').map((i) => i.id), [], 'no map supplied - falls back to name only, never throws');
  assert.deepStrictEqual(filterPrototypes(items, 'without initiative', '', initiatives).map((i) => i.id), ['proto-c'], 'an item with no discoveryTaskId is unaffected');
});

test('filterPrototypes matches by name, diacritic- and case-insensitive', () => {
  const items = [
    { id: 'proto-a', name: 'Café goals and indicators' },
    { id: 'proto-b', name: 'Scheduling' },
    { id: 'proto-c', name: 'KPIx' },
  ];
  assert.deepStrictEqual(filterPrototypes(items, ''), items, 'empty query returns everything');
  assert.deepStrictEqual(filterPrototypes(items, 'cafe').map((i) => i.id), ['proto-a']);
  assert.deepStrictEqual(filterPrototypes(items, 'KPIX').map((i) => i.id), ['proto-c']);
  assert.deepStrictEqual(filterPrototypes(items, 'no such thing'), []);
  assert.deepStrictEqual(filterPrototypes(null, 'x'), [], 'defensive on a non-array input');
});

// ── Compliance review: NOT carried over ─────────────────────────────────────
// Product decision - the Compliance tab fell out of scope, so the module no
// longer exposes complianceStatusMeta. This test guards against that surface
// coming back by accident with copied code.

test('the compliance surface is gone from the module public API', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'js', 'prototypy.js')).href);
  assert.strictEqual(mod.complianceStatusMeta, undefined);
  const src = fs.readFileSync(path.join(ROOT, 'js', 'prototypy.js'), 'utf8');
  assert.ok(!src.includes('/api/prototypes/compliance/'), 'client must not call the removed route');
  assert.ok(!src.includes('data-proto-tab'), 'the detail page has no tab strip any more');
});

// ── Etap 2: walidacja i tlumaczenie bledow formularza ───────────────────────

test('validatePrototypeName requires a non-empty, trimmed name under the server limit', () => {
  assert.deepStrictEqual(validatePrototypeName('  Rejestr sklepow  '), { valid: true, value: 'Rejestr sklepow' });
  assert.strictEqual(validatePrototypeName('').valid, false);
  assert.strictEqual(validatePrototypeName('   ').valid, false);
  assert.strictEqual(validatePrototypeName(null).valid, false);
  const tooLong = 'x'.repeat(PROTO_NAME_MAX_LEN + 1);
  assert.strictEqual(validatePrototypeName(tooLong).valid, false);
  assert.strictEqual(validatePrototypeName('x'.repeat(PROTO_NAME_MAX_LEN)).valid, true);
});

test('protoErrorMessage translates every server error code to a sentence and never echoes an unknown code', () => {
  assert.strictEqual(protoErrorMessage('name-required'), 'A prototype name is required.');
  assert.strictEqual(protoErrorMessage('not-found'), 'Prototype not found - someone else may have removed it.');
  assert.strictEqual(protoErrorMessage('write-failed'), 'Saving failed. Try again.');
  const fallback = protoErrorMessage('some-unmapped-code');
  assert.strictEqual(fallback, 'Could not save the changes. Try again.');
  assert.ok(!fallback.includes('some-unmapped-code'), 'must never print the raw code');
  assert.strictEqual(protoErrorMessage(null), fallback);
  assert.strictEqual(protoErrorMessage(undefined), fallback);
});

// ── Stage C/step 3: new error codes of the atomic POST (server.js _protoCreate) ──

test('protoErrorMessage covers the atomic-create failure codes distinctly from write-failed', () => {
  const registryMsg = protoErrorMessage('registry-unreadable');
  const starterMsg = protoErrorMessage('starter-copy-failed');
  const writeMsg = protoErrorMessage('write-failed');
  assert.ok(registryMsg.length > 0 && registryMsg !== writeMsg);
  assert.ok(starterMsg.length > 0 && starterMsg !== writeMsg);
  assert.ok(registryMsg !== starterMsg);
  // No message lies about success - they all speak of failure.
  for (const msg of [registryMsg, starterMsg]) {
    assert.ok(/not |could not|damaged|failed|error/i.test(msg), `expected a failure message, got: ${msg}`);
  }
});

// ── Phase C/step 4: copyable start command ────────────────────────────

test('protoStartCommand carries the exact id, the team data path and the React contract', () => {
  const cmd = protoStartCommand({ id: 'proto-kasa', name: 'Kasa', format: 'missing' });
  assert.ok(cmd.startsWith('/prototype '), 'must be a copy-pasteable slash command');
  assert.ok(cmd.includes('proto-kasa'), 'must name the exact id, never a guessed one');
  assert.ok(cmd.includes('data-sub-repositories/ds-data/prototypes/proto-kasa'), 'must point at the real team data path');
  assert.ok(cmd.includes('React'), 'contract is React-only for a fresh prototype');
  assert.ok(cmd.includes('Kasa'));
});

test('protoStartCommand sanitizes a name with quotes/newlines so the command stays one safe line', () => {
  const cmd = protoStartCommand({ id: 'proto-x', name: 'Ala\nma "koty"\r\n' });
  assert.ok(!cmd.includes('\n') && !cmd.includes('\r'), 'newlines in the name must not break the single-line command');
  assert.ok(!cmd.includes('"koty"'), 'straight quotes from the name must not reopen the command quoting');
  assert.ok(cmd.includes('proto-x'));
});

test('protoStartCommand falls back to the id when the name is missing', () => {
  const cmd = protoStartCommand({ id: 'proto-y' });
  assert.ok(cmd.includes('proto-y'));
});

test('matchOwnerMembers finds people by name in either order, role and team, without diacritics', () => {
  const members = [
    { id: 'tm-1', first_name: 'Alex', last_name: 'Morgan', role: 'Product Owner', team: 'Cockpit' },
    { id: 'tm-2', first_name: 'Sam', last_name: 'Rivera', role: 'Product Designer', team: 'Echo' },
    { id: 'tm-3', first_name: 'Łukasz', last_name: 'Żak', role: 'Developer', team: 'Cockpit' },
  ];
  const ids = (q) => Array.from(matchOwnerMembers(members, q)).sort();
  assert.deepStrictEqual(ids(''), ['tm-1', 'tm-2', 'tm-3'], 'empty query keeps everyone');
  assert.deepStrictEqual(ids('morgan alex'), ['tm-1'], 'surname first works');
  assert.deepStrictEqual(ids('lukasz zak'), ['tm-3'], 'diacritics are ignored');
  assert.deepStrictEqual(ids('designer'), ['tm-2'], 'role matches');
  assert.deepStrictEqual(ids('cockpit'), ['tm-1', 'tm-3'], 'team matches');
  assert.deepStrictEqual(ids('nikt'), [], 'no hit is an empty set');
  assert.deepStrictEqual(ids(null), ['tm-1', 'tm-2', 'tm-3']);
});

