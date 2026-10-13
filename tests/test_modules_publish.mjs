// tests/test_modules_publish.mjs
// Pure helpers behind POST /api/modules/publish. No GitLab, no server.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  modulesPublishBranchName, upsertCatalogEntry, buildPublishActions, setManifestStatus, setManifestArea, MODULE_STATUSES,
  _moduleUpdateRows, publishDeleteGuard, publishTakeover, _modulesCatalogTreeAll,
  localCatalogRead, _localCatalogWriteModule, _modulesCatalogTreeUrl, _modulesCatalogFileRawUrl,
  _modulesCatalogCommitsUrl, gitBlobSha,
} = require('../server.js');

// ── module.json status write-back ───────────────────────────────────────────
// The publish modal's status used to reach catalog.json only; now the handler
// writes it into the module's own manifest through this pure helper.

const MANIFEST_TEXT = JSON.stringify({
  schemaVersion: 1, id: 'reports', name: 'Reports', version: '0.1.0', description: 'x',
  sidebar: { label: 'Reports', kind: 'item' }, views: [{ id: 'reports-main', label: 'Glowna' }],
}, null, 2) + '\n';

test('setManifestStatus adds a missing status right after version', () => {
  const r = setManifestStatus(MANIFEST_TEXT, 'stable');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changed, true);
  const keys = Object.keys(JSON.parse(r.text));
  assert.strictEqual(keys[keys.indexOf('version') + 1], 'status');
  assert.strictEqual(JSON.parse(r.text).status, 'stable');
  assert.ok(r.text.endsWith('}\n'));
  assert.ok(r.text.includes('\n  "status": "stable",\n'), 'two-space indent');
});

test('setManifestStatus replaces an existing status in place', () => {
  const withBeta = setManifestStatus(MANIFEST_TEXT, 'beta').text;
  const r = setManifestStatus(withBeta, 'deprecated');
  assert.strictEqual(r.changed, true);
  const before = Object.keys(JSON.parse(withBeta));
  const after = Object.keys(JSON.parse(r.text));
  assert.deepStrictEqual(after, before, 'key order is untouched');
  assert.strictEqual(JSON.parse(r.text).status, 'deprecated');
});

test('setManifestStatus reports an unchanged manifest and returns it verbatim', () => {
  const withBeta = setManifestStatus(MANIFEST_TEXT, 'beta').text;
  const r = setManifestStatus(withBeta, 'beta');
  assert.deepStrictEqual(r, { ok: true, text: withBeta, changed: false });
});

test('setManifestStatus refuses a status outside MODULE_STATUSES and a broken manifest', () => {
  assert.deepStrictEqual(MODULE_STATUSES, ['stable', 'beta', 'deprecated']);
  assert.strictEqual(setManifestStatus(MANIFEST_TEXT, 'alpha').ok, false);
  assert.strictEqual(setManifestStatus('{not json', 'beta').ok, false);
  assert.strictEqual(setManifestStatus('[]', 'beta').ok, false);
});

// ── module.json area write-back ─────────────────────────────────────────────

test('setManifestArea adds a missing area right after status', () => {
  const withStatus = setManifestStatus(MANIFEST_TEXT, 'beta').text;
  const r = setManifestArea(withStatus, 'Product');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changed, true);
  const keys = Object.keys(JSON.parse(r.text));
  assert.strictEqual(keys[keys.indexOf('status') + 1], 'area');
  assert.strictEqual(JSON.parse(r.text).area, 'Product');
  assert.ok(r.text.endsWith('}\n'));
});

test('setManifestArea replaces an existing area in place', () => {
  const withArea = setManifestArea(MANIFEST_TEXT, 'Product').text;
  const r = setManifestArea(withArea, 'AR');
  assert.strictEqual(r.changed, true);
  const before = Object.keys(JSON.parse(withArea));
  const after = Object.keys(JSON.parse(r.text));
  assert.deepStrictEqual(after, before, 'key order is untouched');
  assert.strictEqual(JSON.parse(r.text).area, 'AR');
});

test('setManifestArea reports an unchanged manifest and returns it verbatim', () => {
  const withArea = setManifestArea(MANIFEST_TEXT, 'Product').text;
  const r = setManifestArea(withArea, 'Product');
  assert.deepStrictEqual(r, { ok: true, text: withArea, changed: false });
});

test('setManifestArea refuses an invalid area and a broken manifest', () => {
  assert.strictEqual(setManifestArea(MANIFEST_TEXT, 'Cyber\tstore').ok, false);
  assert.strictEqual(setManifestArea(MANIFEST_TEXT, 'x').ok, false);
  assert.strictEqual(setManifestArea('{not json', 'Product').ok, false);
  assert.strictEqual(setManifestArea('[]', 'Product').ok, false);
});

// ── Branch naming ────────────────────────────────────────────────────────────

test('modulesPublishBranchName carries the module id and a UTC timestamp', () => {
  const name = modulesPublishBranchName('reports', Date.UTC(2026, 8, 5, 18, 30, 5));
  assert.strictEqual(name, 'module/reports-20260905-183005');
});

// A second attempt must not collide with the branch the first one left behind:
// GitLab answers 400 on an existing branch, and the person would have to delete
// it by hand before retrying.
test('modulesPublishBranchName differs between two attempts a second apart', () => {
  const t = Date.UTC(2026, 8, 5, 18, 30, 5);
  assert.notStrictEqual(
    modulesPublishBranchName('reports', t),
    modulesPublishBranchName('reports', t + 1000),
  );
});

// ── catalog.json merge ───────────────────────────────────────────────────────

test('upsertCatalogEntry seeds a curation when catalog.json is absent', () => {
  const r = upsertCatalogEntry('', { id: 'reports', status: 'beta' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'add');
  const doc = JSON.parse(r.text);
  assert.strictEqual(doc.schemaVersion, 1);
  assert.deepStrictEqual(doc.modules, [{ id: 'reports', status: 'beta' }]);
});

test('upsertCatalogEntry keeps every other entry when it adds one', () => {
  const existing = JSON.stringify({
    schemaVersion: 1,
    modules: [{ id: 'stary', status: 'stable', featured: true }],
  });
  const r = upsertCatalogEntry(existing, { id: 'nowy', status: 'beta' });
  assert.strictEqual(r.mode, 'add');
  const ids = JSON.parse(r.text).modules.map((m) => m.id);
  assert.deepStrictEqual(ids, ['nowy', 'stary'], 'a new entry goes before its alphabetical successor');
});

// Every publish used to APPEND, so any two open publish MRs touched the same
// tail lines and the second one to merge always conflicted (2026-10-10:
// !142/!145/!146). A new entry now goes right before its alphabetical
// successor - in an UNSORTED list, so the successor is the smallest greater
// id, not the first greater one in list order.
test('upsertCatalogEntry places a new entry before its alphabetical successor', () => {
  const base = JSON.stringify({ schemaVersion: 1, modules: [
    { id: 'demo-hub' }, { id: 'sites' }, { id: 'ledger' }, { id: 'bot-api' }, { id: 'tickets' },
  ] });
  const at = (id) => JSON.parse(upsertCatalogEntry(base, { id, status: 'beta' }).text).modules.map((m) => m.id);
  assert.deepStrictEqual(at('gardens'), ['demo-hub', 'sites', 'gardens', 'ledger', 'bot-api', 'tickets']);
  assert.deepStrictEqual(at('nps'), ['demo-hub', 'nps', 'sites', 'ledger', 'bot-api', 'tickets']);
  assert.deepStrictEqual(at('zzz'), ['demo-hub', 'sites', 'ledger', 'bot-api', 'tickets', 'zzz']);
  assert.deepStrictEqual(at('aaa'), ['demo-hub', 'sites', 'ledger', 'aaa', 'bot-api', 'tickets']);
});

// The property itself, not the placement: two publishes of different modules
// from the same main must merge with plain git, no conflict.
test('two parallel publishes of non-adjacent ids merge without a conflict', (t) => {
  const base = JSON.stringify({ schemaVersion: 1, modules: [
    { id: 'demo-hub', status: 'stable' }, { id: 'sites', status: 'beta' }, { id: 'ledger', status: 'beta' },
    { id: 'responsibilities', status: 'beta' }, { id: 'support-desk', status: 'beta' },
  ] }, null, 2) + '\n';
  const ours = upsertCatalogEntry(base, { id: 'gardens', status: 'beta', summary: 'A' }).text;
  const theirs = upsertCatalogEntry(base, { id: 'vendor-requests', status: 'beta', summary: 'B' }).text;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-merge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = (n, text) => { const f = path.join(dir, n); fs.writeFileSync(f, text); return f; };
  const [o, b, th] = [p('ours', ours), p('base', base), p('theirs', theirs)];
  const r = spawnSync('git', ['merge-file', '-p', o, b, th], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'git merge-file reported a conflict:\n' + r.stdout);
  const ids = JSON.parse(r.stdout).modules.map((m) => m.id);
  assert.ok(ids.includes('gardens') && ids.includes('vendor-requests'));
});

// Re-publishing must not duplicate the entry, and must not silently drop fields
// a human added in the catalog repo by hand.
test('upsertCatalogEntry replaces in place and preserves untouched fields', () => {
  const existing = JSON.stringify({
    schemaVersion: 1,
    modules: [{ id: 'reports', status: 'beta', author: 'Team', tags: ['reports'] }],
  });
  const r = upsertCatalogEntry(existing, { id: 'reports', status: 'stable' });
  assert.strictEqual(r.mode, 'replace');
  const mods = JSON.parse(r.text).modules;
  assert.strictEqual(mods.length, 1, 'must not duplicate the entry');
  assert.strictEqual(mods[0].status, 'stable', 'the new value wins');
  assert.strictEqual(mods[0].author, 'Team', 'a hand-added field survives');
  assert.deepStrictEqual(mods[0].tags, ['reports']);
});

test('upsertCatalogEntry refuses a malformed or unsupported catalog', () => {
  assert.strictEqual(upsertCatalogEntry('{ nie-json', { id: 'x' }).ok, false);
  assert.strictEqual(upsertCatalogEntry('[]', { id: 'x' }).ok, false);
  assert.strictEqual(upsertCatalogEntry(JSON.stringify({ schemaVersion: 99, modules: [] }), { id: 'x' }).ok, false);
  assert.strictEqual(upsertCatalogEntry('', {}).ok, false);
});

test('upsertCatalogEntry writes a trailing newline and two-space indent', () => {
  const r = upsertCatalogEntry('', { id: 'reports', status: 'beta' });
  assert.ok(r.text.endsWith('\n'), 'a file without a trailing newline is a diff on every write');
  assert.match(r.text, /\n {2}"schemaVersion"/);
});

// ── Commit actions ───────────────────────────────────────────────────────────

const FILES = [
  { path: 'module.json', data: Buffer.from('{"id":"reports"}') },
  { path: 'client/index.js', data: Buffer.from('export const views = {};') },
];

test('buildPublishActions creates every file of a module that is new to the catalog', () => {
  const actions = buildPublishActions(FILES, 'reports', new Set(), { text: '{}\n', exists: false });
  assert.strictEqual(actions.length, 3, 'two module files plus catalog.json');
  assert.ok(actions.slice(0, 2).every((a) => a.action === 'create'));
  assert.deepStrictEqual(actions.map((a) => a.file_path), [
    'modules/reports/module.json',
    'modules/reports/client/index.js',
    'catalog.json',
  ]);
});

// Sending `create` for a path already on the default branch fails the WHOLE
// commit with "A file with this name already exists" - the one error that makes
// a re-publish look broken.
test('buildPublishActions updates a path that already exists on the default branch', () => {
  const existing = new Set(['modules/reports/module.json']);
  const actions = buildPublishActions(FILES, 'reports', existing, { text: '{}\n', exists: true });
  const byPath = Object.fromEntries(actions.map((a) => [a.file_path, a.action]));
  assert.strictEqual(byPath['modules/reports/module.json'], 'update');
  assert.strictEqual(byPath['modules/reports/client/index.js'], 'create');
  assert.strictEqual(byPath['catalog.json'], 'update');
});

test('buildPublishActions sends module files base64 so binaries survive', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const actions = buildPublishActions(
    [{ path: 'client/icon.png', data: png }], 'reports', new Set(), { text: '{}\n', exists: false });
  assert.strictEqual(actions[0].encoding, 'base64');
  assert.ok(Buffer.from(actions[0].content, 'base64').equals(png));
});

test('buildPublishActions namespaces every file under modules/<id>/', () => {
  const actions = buildPublishActions(FILES, 'reports', new Set(), { text: '{}\n', exists: false });
  for (const a of actions) {
    assert.ok(a.file_path === 'catalog.json' || a.file_path.startsWith('modules/reports/'),
      'a module file must never be written outside its own directory: ' + a.file_path);
  }
});

// ── GET /api/modules/updates row join ───────────────────────────────────────
// _moduleUpdateRows is pure: it joins installed[] with entries[] by id and
// delegates the classification to a stub lib, so this needs no ESM import
// from a CJS test.

test('_moduleUpdateRows joins installed modules with the catalog by id and omits the rest', () => {
  const installed = [
    { id: 'reports', manifest: { name: 'Reports', version: '0.1.0' }, enabled: true },
    { id: 'time-off', manifest: { name: 'Time off', version: '0.5.0' }, enabled: false },
    { id: 'unpublished', manifest: { name: 'Unpublished', version: '0.1.0' }, enabled: true },
  ];
  const entries = [
    { id: 'reports', manifest: { version: '0.2.0' } },
    { id: 'time-off', manifest: { version: '0.5.0' } },
  ];
  const lib = { classifyModuleUpdate: (installedVersion, catalogVersion) => (installedVersion === catalogVersion ? 'current' : 'update') };
  const rows = _moduleUpdateRows(installed, entries, lib);

  assert.strictEqual(rows.length, 2, 'a module with no catalog entry is omitted');
  assert.deepStrictEqual(rows.map((r) => r.id), ['reports', 'time-off'], 'sorted by id');

  const reports = rows.find((r) => r.id === 'reports');
  assert.strictEqual(reports.name, 'Reports');
  assert.strictEqual(reports.installedVersion, '0.1.0');
  assert.strictEqual(reports.catalogVersion, '0.2.0');
  assert.strictEqual(reports.state, 'update');
  assert.strictEqual(reports.enabled, true);

  const timeOff = rows.find((r) => r.id === 'time-off');
  assert.strictEqual(timeOff.state, 'current');
  assert.strictEqual(timeOff.enabled, false);
});

test('_moduleUpdateRows reads both versions from the manifests, never elsewhere', () => {
  const installed = [{ id: 'a', manifest: { name: 'A', version: '1.0.0' }, enabled: true }];
  const entries = [{ id: 'a', manifest: { version: '1.1.0' } }];
  let seen = null;
  const lib = { classifyModuleUpdate: (installedVersion, catalogVersion) => { seen = [installedVersion, catalogVersion]; return 'update'; } };
  _moduleUpdateRows(installed, entries, lib);
  assert.deepStrictEqual(seen, ['1.0.0', '1.1.0'], 'installed first, catalog second');
});

test('_moduleUpdateRows tolerates a catalog entry with no manifest', () => {
  const installed = [{ id: 'a', manifest: { name: 'A', version: '1.0.0' }, enabled: true }];
  const entries = [{ id: 'a' }];
  const lib = { classifyModuleUpdate: () => 'unknown' };
  const rows = _moduleUpdateRows(installed, entries, lib);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].catalogVersion, null);
  assert.strictEqual(rows[0].state, 'unknown');
});

// ── publishDeleteGuard ───────────────────────────────────────────────────────
// Thresholds sized for a module (3-10 files), not crypto-sync's whole-mirror
// numbers - see the plan's "Gap 1 - thresholds" note.

test('publishDeleteGuard: no implied deletions is always ok', () => {
  const existing = new Set(['modules/m/module.json', 'modules/m/client/index.js']);
  const files = [{ path: 'module.json' }, { path: 'client/index.js' }];
  const g = publishDeleteGuard(files, 'm', existing);
  assert.deepStrictEqual(g, { ok: true, deletes: [], kept: 2, existing: 2 });
});

test('publishDeleteGuard: kept===0 refuses as publish-tree-mismatch with NO override', () => {
  const existing = new Set(['modules/m/module.json', 'modules/m/a.js', 'modules/m/b.js']);
  const files = [{ path: 'totally-different.js' }];
  const refused = publishDeleteGuard(files, 'm', existing);
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.error, 'publish-tree-mismatch');
  assert.strictEqual(refused.kept, 0);
  // The whole point of this branch: confirm:true does NOT override it, unlike
  // publish-destructive below.
  const stillRefused = publishDeleteGuard(files, 'm', existing, { confirm: true });
  assert.strictEqual(stillRefused.ok, false);
  assert.strictEqual(stillRefused.error, 'publish-tree-mismatch');
});

test('publishDeleteGuard: exactly half kept is NOT destructive (strictly more than half only)', () => {
  // existing=4, deletes=2 -> 2*2 === 4, not > 4 -> ok.
  const existing = new Set(['modules/m/module.json', 'modules/m/a.js', 'modules/m/b.js', 'modules/m/c.js']);
  const files = [{ path: 'module.json' }, { path: 'a.js' }];
  const g = publishDeleteGuard(files, 'm', existing);
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.deletes.length, 2);
  assert.strictEqual(g.existing, 4);
});

test('publishDeleteGuard: strictly more than half refused, overridable with confirm:true', () => {
  const existing = new Set(['modules/m/module.json', 'modules/m/a.js', 'modules/m/b.js']);
  const files = [{ path: 'module.json' }];
  const refused = publishDeleteGuard(files, 'm', existing);
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.error, 'publish-destructive');
  assert.strictEqual(refused.deletes.length, 2);
  assert.ok(refused.message.includes('2') && refused.message.includes('3'));
  const allowed = publishDeleteGuard(files, 'm', existing, { confirm: true });
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.deletes.length, 2);
});

test('publishDeleteGuard: scopes to modules/<id>/ and drops catalog.json defensively', () => {
  const existing = new Set(['modules/m/module.json', 'modules/other/x.js', 'catalog.json']);
  const files = [{ path: 'module.json' }];
  const g = publishDeleteGuard(files, 'm', existing);
  assert.strictEqual(g.existing, 1, 'only modules/m/ paths count, catalog.json and another module are ignored');
  assert.strictEqual(g.ok, true);
});

// ── buildPublishActions with deletes ────────────────────────────────────────

test('buildPublishActions emits a delete action for every implied deletion', () => {
  const existing = new Set(['modules/m/module.json', 'modules/m/old.js']);
  const actions = buildPublishActions(
    [{ path: 'module.json', data: Buffer.from('{}') }], 'm', existing,
    { text: '{}\n', exists: true }, ['modules/m/old.js']);
  const del = actions.find((a) => a.action === 'delete');
  assert.deepStrictEqual(del, { action: 'delete', file_path: 'modules/m/old.js' });
});

test('buildPublishActions never deletes catalog.json or a path outside the module prefix', () => {
  const actions = buildPublishActions(
    [{ path: 'module.json', data: Buffer.from('{}') }], 'm', new Set(),
    { text: '{}\n', exists: true }, ['catalog.json', 'modules/other/x.js', 'modules/m/real.js']);
  const deletes = actions.filter((a) => a.action === 'delete').map((a) => a.file_path);
  assert.deepStrictEqual(deletes, ['modules/m/real.js']);
});

test('buildPublishActions keeps catalog.json last, deletes sitting between the create/update actions and it', () => {
  const actions = buildPublishActions(
    [{ path: 'module.json', data: Buffer.from('{}') }], 'm', new Set(['modules/m/old.js']),
    { text: '{}\n', exists: true }, ['modules/m/old.js']);
  assert.strictEqual(actions[actions.length - 1].file_path, 'catalog.json');
  assert.strictEqual(actions[actions.length - 2].action, 'delete');
  assert.strictEqual(actions[0].action, 'create');
});

test('buildPublishActions with the old 4-argument call still yields the pre-existing shape', () => {
  const actions = buildPublishActions(FILES, 'reports', new Set(), { text: '{}\n', exists: false });
  assert.ok(actions.every((a) => a.action !== 'delete'));
  assert.strictEqual(actions.length, 3);
});

// ── upsertCatalogEntry: owner invariant ─────────────────────────────────────

test('upsertCatalogEntry on add writes owner only with a real, non-empty slug', () => {
  const withOwner = upsertCatalogEntry('', { id: 'm', status: 'beta', owner: { slug: 'taylor-kim', name: 'Taylor Kim' } });
  assert.deepStrictEqual(JSON.parse(withOwner.text).modules[0].owner, { slug: 'taylor-kim', name: 'Taylor Kim' });
  assert.strictEqual(withOwner.previous, null);

  const emptySlug = upsertCatalogEntry('', { id: 'm', status: 'beta', owner: { slug: '' } });
  assert.ok(!('owner' in JSON.parse(emptySlug.text).modules[0]), 'an empty slug must leave the key absent, not undefined');

  const noOwner = upsertCatalogEntry('', { id: 'm', status: 'beta' });
  assert.ok(!('owner' in JSON.parse(noOwner.text).modules[0]));
});

test('upsertCatalogEntry on replace keeps the EXISTING owner and reports it as previous', () => {
  const existing = JSON.stringify({
    schemaVersion: 1,
    modules: [{ id: 'm', status: 'beta', owner: { slug: 'taylor-kim', name: 'Taylor Kim' } }],
  });
  const r = upsertCatalogEntry(existing, { id: 'm', status: 'stable', owner: { slug: 'jordan-lee', name: 'Jordan Lee' } });
  assert.strictEqual(r.mode, 'replace');
  assert.deepStrictEqual(JSON.parse(r.text).modules[0].owner, { slug: 'taylor-kim', name: 'Taylor Kim' }, 'first publisher wins, always');
  assert.deepStrictEqual(r.previous.owner, { slug: 'taylor-kim', name: 'Taylor Kim' });
});

test('upsertCatalogEntry on replace with no previous owner accepts the new one', () => {
  const existing = JSON.stringify({ schemaVersion: 1, modules: [{ id: 'm', status: 'beta' }] });
  const r = upsertCatalogEntry(existing, { id: 'm', status: 'beta', owner: { slug: 'taylor-kim', name: 'Taylor Kim' } });
  assert.deepStrictEqual(JSON.parse(r.text).modules[0].owner, { slug: 'taylor-kim', name: 'Taylor Kim' });
  assert.strictEqual(r.previous.owner, undefined);
});

// ── publishTakeover ──────────────────────────────────────────────────────────

test('publishTakeover: a different slug is a takeover, name falls back to slug when unset', () => {
  const t = publishTakeover({ owner: { slug: 'taylor-kim' } }, { person_slug: 'jordan-lee', display_name: 'Jordan Lee' });
  assert.deepStrictEqual(t, { takeover: true, previousOwner: { slug: 'taylor-kim', name: 'taylor-kim' } });
});

test('publishTakeover: the same slug, no owner, or no identity is never a takeover', () => {
  assert.deepStrictEqual(
    publishTakeover({ owner: { slug: 'jordan-lee', name: 'Jordan Lee' } }, { person_slug: 'jordan-lee', display_name: 'Jordan Lee' }),
    { takeover: false, previousOwner: null });
  assert.deepStrictEqual(publishTakeover({ status: 'beta' }, { person_slug: 'jordan-lee' }), { takeover: false, previousOwner: null });
  assert.deepStrictEqual(publishTakeover(null, { person_slug: 'jordan-lee' }), { takeover: false, previousOwner: null });
  assert.deepStrictEqual(
    publishTakeover({ owner: { slug: 'taylor-kim', name: 'Taylor Kim' } }, null),
    { takeover: false, previousOwner: null }, 'anonymous identity detects no takeover');
});

// ── _modulesCatalogTreeAll: injectable stub, no GitLab ──────────────────────

/**
 * URL-aware stub: a `/repository/tree` URL consumes the next page from
 * `pages`, anything else is the project visibility probe
 * (`GET /projects/<enc>`) and answers `project` - 200 by default, i.e. "the
 * project is visible", which is what every pre-probe case assumed.
 */
function _stubGet(pages, project = { ok: true, status: 200, text: '{}' }) {
  let calls = 0;
  let probes = 0;
  const getFn = async (url) => {
    if (!url.includes('/repository/tree')) {
      probes += 1;
      return project;
    }
    const page = pages[calls];
    calls += 1;
    return page;
  };
  getFn.callCount = () => calls;
  getFn.probeCount = () => probes;
  return getFn;
}

test('_modulesCatalogTreeAll: a 404 on page 1 with a visible project means the module is new, ok:true with no items', async () => {
  const getFn = _stubGet([{ ok: false, status: 404, text: '' }]);
  const r = await _modulesCatalogTreeAll('modules/m', getFn);
  assert.deepStrictEqual(r, { ok: true, status: 404, items: [] });
  assert.strictEqual(getFn.probeCount(), 1, 'a page-1 404 asks the project probe exactly once');
});

test('_modulesCatalogTreeAll: a 404 on page 1 with an invisible project is ok:false, reason no-access', async () => {
  const getFn = _stubGet([{ ok: false, status: 404, text: '' }], { ok: false, status: 404, text: '' });
  const r = await _modulesCatalogTreeAll('modules/m', getFn);
  assert.deepStrictEqual(r, { ok: false, status: 404, reason: 'no-access' });
  assert.strictEqual(getFn.callCount(), 1, 'no second tree page is asked for');
});

test('_modulesCatalogTreeAll: a 404 on page 2+ means the listing broke mid-walk, ok:false', async () => {
  const page1 = {
    ok: true, status: 200, text: JSON.stringify([{ type: 'blob', path: 'modules/m/module.json' }]),
    headers: { get: (n) => (n === 'x-next-page' ? '2' : null) },
  };
  const page2 = { ok: false, status: 404, text: '' };
  const getFn = _stubGet([page1, page2]);
  const r = await _modulesCatalogTreeAll('modules/m', getFn);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'tree-incomplete');
});

test('_modulesCatalogTreeAll: an x-total that disagrees with the collected count is ok:false', async () => {
  const page1 = {
    ok: true, status: 200, text: JSON.stringify([{ type: 'blob', path: 'modules/m/module.json' }]),
    headers: { get: (n) => (n === 'x-total' ? '5' : null) },
  };
  const getFn = _stubGet([page1]);
  const r = await _modulesCatalogTreeAll('modules/m', getFn);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'tree-incomplete');
});

test('_modulesCatalogTreeAll: walks every page and returns the full item list when x-total agrees', async () => {
  const page1 = {
    ok: true, status: 200, text: JSON.stringify([{ type: 'blob', path: 'modules/m/module.json' }]),
    headers: { get: (n) => (n === 'x-next-page' ? '2' : null) },
  };
  const page2 = {
    ok: true, status: 200, text: JSON.stringify([{ type: 'blob', path: 'modules/m/client/index.js' }]),
    headers: { get: (n) => (n === 'x-total' ? '2' : null) },
  };
  const getFn = _stubGet([page1, page2]);
  const r = await _modulesCatalogTreeAll('modules/m', getFn);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(getFn.callCount(), 2);
});

// -- Local catalog source ------------------------------------------------------
// The default catalog is a folder (catalog.json + modules/<id>/). Its reader
// answers the SAME GitLab REST URLs the builders produce, so the crawl, the
// install and the publish tree read run unchanged against it.

function makeLocalCatalog() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-deck-catalog-unit-'));
  fs.mkdirSync(path.join(root, 'modules', 'm', 'client'), { recursive: true });
  fs.writeFileSync(path.join(root, 'catalog.json'), '{"schemaVersion":1,"modules":[]}\n');
  fs.writeFileSync(path.join(root, 'modules', 'm', 'module.json'), '{"id":"m"}\r\n');
  fs.writeFileSync(path.join(root, 'modules', 'm', 'client', 'index.js'), '// m\n');
  fs.writeFileSync(path.join(root, 'modules', 'm', '.env'), 'SECRET=1\n');
  return root;
}

test('localCatalogRead answers a tree listing in the GitLab shape, without dotfiles', async () => {
  const root = makeLocalCatalog();
  try {
    const top = localCatalogRead(_modulesCatalogTreeUrl('modules', { page: 1 }), { root });
    assert.strictEqual(top.status, 200);
    assert.deepStrictEqual(JSON.parse(top.text).map((i) => [i.type, i.name]), [['tree', 'm']]);
    const all = await _modulesCatalogTreeAll('modules/m', (url) => Promise.resolve(localCatalogRead(url, { root })));
    assert.strictEqual(all.ok, true);
    const blobs = all.items.filter((i) => i.type === 'blob');
    assert.deepStrictEqual(blobs.map((i) => i.path), ['modules/m/client/index.js', 'modules/m/module.json']);
    // Blob ids are git's, over the LF bytes a publish would send.
    const manifestRow = blobs.find((i) => i.path === 'modules/m/module.json');
    assert.strictEqual(manifestRow.id, gitBlobSha(Buffer.from('{"id":"m"}\n')));
    assert.strictEqual(manifestRow.mode, '100644');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('localCatalogRead serves raw files and refuses paths outside the folder', () => {
  const root = makeLocalCatalog();
  try {
    const cat = localCatalogRead(_modulesCatalogFileRawUrl('catalog.json'), { root });
    assert.strictEqual(cat.status, 200);
    assert.strictEqual(JSON.parse(cat.text).schemaVersion, 1);
    const bin = localCatalogRead(_modulesCatalogFileRawUrl('modules/m/client/index.js', 'any-ref'), { root, binary: true });
    assert.strictEqual(bin.ok, true);
    assert.strictEqual(bin.buffer.toString('utf8'), '// m\n');
    for (const bad of ['../outside.txt', 'modules/../../outside.txt', 'modules/m', 'missing.json']) {
      assert.strictEqual(localCatalogRead(_modulesCatalogFileRawUrl(bad), { root }).status, 404, bad);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('localCatalogRead: one pseudo-commit per existing path, no branch head, no merge requests', () => {
  const root = makeLocalCatalog();
  try {
    assert.deepStrictEqual(JSON.parse(localCatalogRead(_modulesCatalogCommitsUrl('modules/m/module.json'), { root }).text).map((c) => c.id), ['local']);
    assert.deepStrictEqual(JSON.parse(localCatalogRead(_modulesCatalogCommitsUrl('modules/zz/module.json'), { root }).text), []);
    const base = _modulesCatalogTreeUrl('modules').split('/repository/')[0];
    assert.strictEqual(localCatalogRead(base, { root }).status, 200, 'the project probe sees an existing folder');
    assert.strictEqual(localCatalogRead(base + '/repository/branches/main', { root }).status, 404);
    const mrs = localCatalogRead(base + '/merge_requests?state=opened&per_page=1', { root });
    assert.deepStrictEqual(JSON.parse(mrs.text), []);
    assert.strictEqual(mrs.headers.get('x-total'), '0');
    assert.strictEqual(localCatalogRead(base, { root: path.join(root, 'nope') }).status, 404, 'a missing folder is an invisible project');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('_localCatalogWriteModule writes, deletes, prunes empty folders and keeps dotfiles', () => {
  const root = makeLocalCatalog();
  const dir = path.join(root, 'modules', 'm');
  try {
    fs.mkdirSync(path.join(dir, 'old', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'old', 'deep', 'gone.txt'), 'x');
    _localCatalogWriteModule(dir, [
      { path: 'module.json', data: Buffer.from('{"id":"m","version":"2"}\n') },
      { path: 'server/index.js', data: Buffer.from('// new\n') },
    ], ['modules/m/old/deep/gone.txt', 'modules/other/x.js', 'catalog.json'], 'm');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'server', 'index.js'), 'utf8'), '// new\n');
    assert.ok(!fs.existsSync(path.join(dir, 'old')), 'emptied folders are pruned');
    assert.ok(fs.existsSync(path.join(dir, '.env')), 'a dotfile the publish never sends stays');
    assert.ok(fs.existsSync(path.join(root, 'catalog.json')), 'a delete outside the module prefix is ignored');
    assert.throws(() => _localCatalogWriteModule(dir, [{ path: '../escape.js', data: Buffer.from('x') }], [], 'm'), /unsafe-path/);
    assert.ok(!fs.existsSync(path.join(root, 'modules', 'escape.js')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
