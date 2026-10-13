// tests/test_sync_modules.mjs
// Pure-function unit tests for the sync-modules classification server.js
// exports for GET /api/sync-modules and GET /api/sync-modules/files:
// _syncEntryMatches (path-to-scope matcher), _classifySyncPending (per-module
// bucketing with the "Cockpit Core" complement), _classifyMtimesByScope
// ("localAt" per module/core), _newestCommitDateByPath plus
// _classifyCommitDatesByScope (the per-module "serwer"/"lokalnie" commit
// dates - one name-only log walk, scoped like everything else here),
// _classifyRemoteAhead ("filesToFetch" per module/core), _resolveRemoteAheadNames (resolves an upstream-only .enc name
// to a plaintext relPath before classification, bounded and batched) and
// _resolveDataRepoId (route id / remote name alias resolution) and
// _afterRemoteRefreshSuccess (the per-module memo invalidation a successful
// remote fetch must trigger - see the test below for why this file, and not
// the API suite, is what proves it). No server is started - requiring
// server.js from a non-main module only exports the pure helpers.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');
const {
  _syncEntryMatches, _classifySyncPending, _classifyMtimesByScope, _classifyRemoteAhead,
  _classifyRemoteAheadFiles, _newestCommitDateByPath, _classifyCommitDatesByScope,
  _resolveRemoteAheadNames, _matchPushPaths, _resolveDataRepoId, _pendingMtimes, _repoLocalAt,
  _afterRemoteRefreshSuccess, _syncModulesStatusCache,
  SYNC_CORE_ID,
} = srv;

/** A `_repoPendingSet`-shaped Map: encRelPath -> {relPath, status}, with the
 * probe's full mtime map hung on it the way the real function does. */
function pendingWith(entries, mtimeByRelPath) {
  const m = new Map(entries);
  m.mtimeByRelPath = mtimeByRelPath;
  return m;
}

test('_syncEntryMatches: "dir/" catches the directory itself and anything under it, never a sibling with a shared prefix', () => {
  assert.strictEqual(_syncEntryMatches('a', 'a/'), true);
  assert.strictEqual(_syncEntryMatches('a/x', 'a/'), true);
  assert.strictEqual(_syncEntryMatches('a/x/y.json', 'a/'), true);
  assert.strictEqual(_syncEntryMatches('ab', 'a/'), false);
  assert.strictEqual(_syncEntryMatches('ab/x', 'a/'), false);
});

test('_syncEntryMatches: "prefix*" is a literal prefix, not a directory boundary', () => {
  assert.strictEqual(_syncEntryMatches('savings.json', 'sav*'), true);
  assert.strictEqual(_syncEntryMatches('savings/report.json', 'sav*'), true);
  assert.strictEqual(_syncEntryMatches('sa.json', 'sav*'), false);
  assert.strictEqual(_syncEntryMatches('other/sav.json', 'sav*'), false);
});

test('_syncEntryMatches: an exact entry never matches a prefix of itself', () => {
  assert.strictEqual(_syncEntryMatches('report.json', 'report.json'), true);
  assert.strictEqual(_syncEntryMatches('report.json.bak', 'report.json'), false);
  assert.strictEqual(_syncEntryMatches('report', 'report.json'), false);
});

function pendingMap(entries) {
  // entries: [encRelPath, relPath, status]
  const m = new Map();
  for (const [encRelPath, relPath, status] of entries) m.set(encRelPath, { relPath, status });
  return m;
}

test('_classifySyncPending: a file matching two modules is counted once, under the first module by id', () => {
  const scopes = [
    { id: 'aaa-mod', label: 'A', entries: ['shared/'] },
    { id: 'zzz-mod', label: 'Z', entries: ['shared/'] },
  ];
  const pending = pendingMap([['e1.enc', 'shared/x.json', 'M']]);
  const { byModule, core } = _classifySyncPending(pending, scopes);
  assert.strictEqual((byModule.get('aaa-mod') || []).length, 1);
  assert.strictEqual((byModule.get('zzz-mod') || []).length, 0);
  assert.strictEqual(core.length, 0);
});

test('_classifySyncPending: a file matching no module falls into Cockpit Core', () => {
  const scopes = [{ id: 'my-mod', label: 'M', entries: ['my-mod/'] }];
  const pending = pendingMap([['e1.enc', 'unrelated/x.json', 'M']]);
  const { byModule, core } = _classifySyncPending(pending, scopes);
  assert.strictEqual((byModule.get('my-mod') || []).length, 0);
  assert.strictEqual(core.length, 1);
  assert.strictEqual(core[0].relPath, 'unrelated/x.json');
});

test('_classifySyncPending: an unresolved relPath (null) always falls into Cockpit Core', () => {
  const scopes = [{ id: 'my-mod', label: 'M', entries: ['/'] }];
  const pending = pendingMap([['e1.enc', null, 'D']]);
  const { byModule, core } = _classifySyncPending(pending, scopes);
  assert.strictEqual(byModule.size, 0);
  assert.strictEqual(core.length, 1);
  assert.strictEqual(core[0].relPath, null);
});

test('_classifySyncPending: the sum invariant holds for 40 random paths across several modules', () => {
  const scopes = [
    { id: 'mod-a', label: 'A', entries: ['mod-a/'] },
    { id: 'mod-b', label: 'B', entries: ['mod-b/', 'shared-b-*'] },
    { id: 'mod-c', label: 'C', entries: ['exact-file.json'] },
  ];
  const buckets = ['mod-a/x', 'mod-b/y', 'shared-b-report.json', 'exact-file.json', 'core/z', null];
  const pending = new Map();
  for (let i = 0; i < 40; i++) {
    const relPath = buckets[i % buckets.length];
    const status = ['A', 'M', 'D'][i % 3];
    pending.set('file' + i + '.enc', { relPath, status });
  }
  const { byModule, core } = _classifySyncPending(pending, scopes);
  let sum = core.length;
  for (const list of byModule.values()) sum += list.length;
  assert.strictEqual(sum, pending.size);
});

test('_pendingMtimes: only the pending files keep their mtime - an unchanged file the pull just rewrote drops out, a deletion has none', () => {
  const pending = pendingWith([
    ['e1.enc', { relPath: 'mod-a/edited.json', status: 'M' }],
    ['e2.enc', { relPath: 'mod-a/gone.json', status: 'D' }],
    ['e3.enc', { relPath: null, status: 'M' }],
  ], new Map([
    ['mod-a/edited.json', 5000],
    ['mod-a/untouched.json', 9000], // newest on disk (decryptTree stamped it at the last pull), NOT pending
  ]));
  const out = _pendingMtimes(pending);
  assert.deepStrictEqual([...out], [['mod-a/edited.json', 5000]]);
});

// -- per-module commit dates (the "serwer" / "lokalnie" lines of a module row) --

const LOG = [
  '\x012026-09-13T21:00:52+02:00', 'aa.enc', '',
  '\x012026-09-13T17:08:21+02:00', 'bb.enc', 'cc.enc', '',
  '\x012026-09-10T09:00:00+02:00', 'aa.enc', 'dd.enc', 'team/café-photo.jpg.enc', '',
].join('\n');

test('_newestCommitDateByPath: the FIRST commit a name appears under wins (newest-first log), later hits are ignored', () => {
  const m = _newestCommitDateByPath(LOG);
  assert.strictEqual(m.get('aa.enc'), '2026-09-13T21:00:52+02:00');
  assert.strictEqual(m.get('bb.enc'), '2026-09-13T17:08:21+02:00');
  assert.strictEqual(m.get('cc.enc'), '2026-09-13T17:08:21+02:00');
  assert.strictEqual(m.get('dd.enc'), '2026-09-10T09:00:00+02:00');
  // a v1 name with a Polish letter, taken verbatim (the caller disables core.quotePath)
  assert.strictEqual(m.get('team/café-photo.jpg.enc'), '2026-09-10T09:00:00+02:00');
  assert.strictEqual(m.size, 5);
});

test('_newestCommitDateByPath: a merge commit lists no names (back-to-back date lines) - its date is never handed to the next commit\'s files', () => {
  // A pull merged a teammate's commit: the merge (21:30) shows no names under
  // --name-only, the merged commit (17:08) right below it does. bb.enc must
  // read 17:08 - the change - and never the merge's 21:30.
  const log = ['\x012026-09-13T21:30:00+02:00', '', '\x012026-09-13T17:08:21+02:00', 'bb.enc', ''].join('\n');
  const m = _newestCommitDateByPath(log);
  assert.strictEqual(m.get('bb.enc'), '2026-09-13T17:08:21+02:00');
  assert.strictEqual(m.size, 1);
});

test('_newestCommitDateByPath: empty output, a blank ref, and names before any date line answer an empty map', () => {
  assert.strictEqual(_newestCommitDateByPath('').size, 0);
  assert.strictEqual(_newestCommitDateByPath(null).size, 0);
  assert.strictEqual(_newestCommitDateByPath('orphan.enc\n\x01\nx.enc\n').size, 0);
});

test('_classifyCommitDatesByScope: each module reads the newest commit touching ITS files, never the repo-wide newest', () => {
  const scopes = [
    { id: 'monitoring', label: 'Monitoring', entries: ['monitoring/'] },
    { id: 'time-log', label: 'Time', entries: ['time-log/'] },
    { id: 'time-off', label: 'Time off', entries: ['time-off/'] },
  ];
  const nameMap = new Map([
    ['aa.enc', 'monitoring/index.json'],
    ['bb.enc', 'time-log/index.json'],
    ['cc.enc', 'time-log/people/x.json'],
    ['dd.enc', 'team/team-members.json'],
  ]);
  const { byModule, core } = _classifyCommitDatesByScope(_newestCommitDateByPath(LOG), nameMap, scopes);
  assert.strictEqual(byModule.get('monitoring'), '2026-09-13T21:00:52+02:00');
  // the case from the sync table: pushed at 17:08, the repo's last commit at 21:00 - the row must say 17:08
  assert.strictEqual(byModule.get('time-log'), '2026-09-13T17:08:21+02:00');
  // a module no commit touched has NO entry - the row renders "-", not the repo date
  assert.strictEqual(byModule.has('time-off'), false);
  // Core = the complement (team/) plus every name nameMap cannot resolve
  assert.strictEqual(core, '2026-09-10T09:00:00+02:00');
});

test('_classifyCommitDatesByScope: dates compare as instants across offsets, and an unresolved name counts for Core', () => {
  const scopes = [{ id: 'm', label: 'M', entries: ['m/'] }];
  const dates = new Map([
    ['a.enc', '2026-09-13T10:00:00+02:00'], // 08:00Z
    ['b.enc', '2026-09-13T09:30:00+00:00'], // 09:30Z - later as an instant, earlier as a string
    ['ghost.enc', '2026-09-13T23:00:00+02:00'],
  ]);
  const nameMap = new Map([['a.enc', 'm/a.json'], ['b.enc', 'm/b.json']]);
  const { byModule, core } = _classifyCommitDatesByScope(dates, nameMap, scopes);
  assert.strictEqual(byModule.get('m'), '2026-09-13T09:30:00+00:00');
  assert.strictEqual(core, '2026-09-13T23:00:00+02:00');
  assert.deepStrictEqual(_classifyCommitDatesByScope(new Map(), nameMap, scopes), { byModule: new Map(), core: null });
});

test('_pendingMtimes: no probe map (no key, empty tree) answers an empty map, never a thrown error', () => {
  assert.strictEqual(_pendingMtimes(new Map()).size, 0);
  assert.strictEqual(_pendingMtimes(pendingWith([['e1.enc', { relPath: 'a', status: 'M' }]], new Map())).size, 0);
});

test('_repoLocalAt: nothing pending -> the local HEAD date, so a repo in step with the server shows the SAME date on both lines', () => {
  const headAt = '2026-09-04T19:14:00+02:00';
  const pending = pendingWith([], new Map([['team/x.json', Date.parse('2026-09-06T15:01:00Z')]]));
  assert.strictEqual(_repoLocalAt(pending, headAt), headAt);
  assert.strictEqual(_repoLocalAt(pending, null), null);
});

test('_repoLocalAt: with pending files -> the newest PENDING mtime, never the newest file on disk', () => {
  const pending = pendingWith([
    ['e1.enc', { relPath: 'a.json', status: 'M' }],
    ['e2.enc', { relPath: 'b.json', status: 'A' }],
  ], new Map([
    ['a.json', Date.parse('2026-09-06T10:00:00Z')],
    ['b.json', Date.parse('2026-09-06T12:00:00Z')],
    ['c.json', Date.parse('2026-09-06T18:00:00Z')], // rewritten by the last pull, not pending
  ]));
  assert.strictEqual(_repoLocalAt(pending, '2026-09-04T19:14:00+02:00'), '2026-09-06T12:00:00.000Z');
});

test('_repoLocalAt: only deletions pending (no plaintext mtime to read) -> falls back to the HEAD date', () => {
  const pending = pendingWith([['e1.enc', { relPath: 'gone.json', status: 'D' }]], new Map());
  assert.strictEqual(_repoLocalAt(pending, '2026-09-04T19:14:00+02:00'), '2026-09-04T19:14:00+02:00');
});

test('_classifyMtimesByScope: newest mtime per module and per core over the map it is handed (the caller passes pending files only)', () => {
  const scopes = [
    { id: 'mod-a', label: 'A', entries: ['mod-a/'] },
    { id: 'mod-b', label: 'B', entries: ['mod-b/'] },
  ];
  const mtimeByRelPath = new Map([
    ['mod-a/old.json', 1000],
    ['mod-a/new.json', 5000], // newest for mod-a
    ['mod-b/x.json', 2000],
    ['core/y.json', 9000], // newest overall, but unmatched -> core, never mod-a/mod-b
  ]);
  const { maxByModule, maxCore } = _classifyMtimesByScope(mtimeByRelPath, scopes);
  assert.strictEqual(maxByModule.get('mod-a'), 5000);
  assert.strictEqual(maxByModule.get('mod-b'), 2000);
  assert.strictEqual(maxCore, 9000);
});

test('_classifyMtimesByScope: an empty map answers empty results, never a thrown error', () => {
  const { maxByModule, maxCore } = _classifyMtimesByScope(new Map(), [{ id: 'a', entries: ['a/'] }]);
  assert.strictEqual(maxByModule.size, 0);
  assert.strictEqual(maxCore, 0);
});

test('_classifyRemoteAhead: resolves each encRelPath through nameMap then the SAME _syncEntryMatches rule as the push side', () => {
  const scopes = [{ id: 'mod-a', label: 'A', entries: ['mod-a/'] }];
  const nameMap = new Map([
    ['e1.enc', 'mod-a/x.json'],
    ['e2.enc', 'unrelated/y.json'],
    // e3.enc has no nameMap entry - genuinely new on the remote, never pulled
    // here, so it cannot be traced without a decrypt this classifier does
    // not spend.
  ]);
  const { byModule, core } = _classifyRemoteAhead(['e1.enc', 'e2.enc', 'e3.enc'], nameMap, scopes);
  assert.strictEqual(byModule.get('mod-a'), 1);
  assert.strictEqual(core, 2);
});

test('_classifyRemoteAhead: the sum invariant holds - byModule + core always equals the input length', () => {
  const scopes = [
    { id: 'mod-a', label: 'A', entries: ['mod-a/'] },
    { id: 'mod-b', label: 'B', entries: ['exact.json'] },
  ];
  const nameMap = new Map([
    ['e0.enc', 'mod-a/1.json'], ['e1.enc', 'mod-a/2.json'], ['e2.enc', 'exact.json'],
    ['e3.enc', 'core/1.json'],
  ]);
  const encRelPaths = ['e0.enc', 'e1.enc', 'e2.enc', 'e3.enc', 'e4.enc'];
  const { byModule, core } = _classifyRemoteAhead(encRelPaths, nameMap, scopes);
  let sum = core;
  for (const n of byModule.values()) sum += n;
  assert.strictEqual(sum, encRelPaths.length);
});

test('_classifyRemoteAheadFiles: returns the ITEMS behind the counts, so the level-3 list and the level-2 counter cannot disagree', () => {
  const scopes = [{ id: 'mod-a', label: 'A', entries: ['mod-a/'] }];
  const nameMap = new Map([
    ['e1.enc', 'mod-a/x.json'],
    ['e2.enc', 'unrelated/y.json'],
  ]);
  const encRelPaths = ['e1.enc', 'e2.enc', 'e3.enc'];
  const { byModule, core } = _classifyRemoteAheadFiles(encRelPaths, nameMap, scopes);
  assert.deepStrictEqual(byModule.get('mod-a'), [{ encRelPath: 'e1.enc', relPath: 'mod-a/x.json' }]);
  // An unresolved name (e3) falls into Cockpit Core carrying relPath null -
  // the level-3 row then renders "(nazwa niedostepna)" rather than guessing.
  assert.deepStrictEqual(core, [
    { encRelPath: 'e2.enc', relPath: 'unrelated/y.json' },
    { encRelPath: 'e3.enc', relPath: null },
  ]);

  // The counter is a `.length` over exactly this, never a second pass.
  const counts = _classifyRemoteAhead(encRelPaths, nameMap, scopes);
  assert.strictEqual(counts.byModule.get('mod-a'), byModule.get('mod-a').length);
  assert.strictEqual(counts.core, core.length);
});

test('_resolveRemoteAheadNames: names already in nameMap are skipped, a v1 name resolves for free, a v2 name spends a call, a null result is omitted, and nameMap is never mutated', async () => {
  const nameMap = new Map([['known.enc', 'already/seen.json']]);
  const nameMapSnapshot = new Map(nameMap);
  const calls = [];
  const resolveFn = async (encRelPath) => {
    calls.push(encRelPath);
    if (encRelPath === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.enc') return 'mod-a/new.json';
    return null; // wrong key / unreadable blob / not actually v2
  };
  const encRelPaths = [
    'known.enc', // already resolved - resolveFn must not be called for it
    'team/nowa-osoba.json.enc', // v1: legacy name IS the path, no call
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.enc', // v2: resolves via resolveFn
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.enc', // v2: resolveFn returns null
  ];
  const resolved = await _resolveRemoteAheadNames(encRelPaths, nameMap, resolveFn);
  assert.deepStrictEqual(calls, ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.enc', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.enc'],
    'only the two v2 names not already in nameMap are resolved');
  assert.strictEqual(resolved.has('known.enc'), false, 'an already-known name is not re-resolved or re-emitted');
  assert.strictEqual(resolved.get('team/nowa-osoba.json.enc'), 'team/nowa-osoba.json', 'v1 name minus .enc, no call spent');
  assert.strictEqual(resolved.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.enc'), 'mod-a/new.json');
  assert.strictEqual(resolved.has('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.enc'), false, 'a null resolveFn result is omitted, not stored as null');
  assert.deepStrictEqual(nameMap, nameMapSnapshot, 'the input nameMap is never mutated - the caller decides how to merge');
});

test('_resolveRemoteAheadNames: max caps the total resolveFn calls, batch bounds how many run concurrently', async () => {
  const v2Names = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(32, '0') + '.enc');
  let inFlight = 0;
  let maxInFlight = 0;
  const resolveFn = async (encRelPath) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return 'core/' + encRelPath;
  };
  const resolved = await _resolveRemoteAheadNames(v2Names, new Map(), resolveFn, { max: 5, batch: 2 });
  assert.strictEqual(resolved.size, 5, 'max caps how many names ever get resolved');
  assert.ok(maxInFlight <= 2, `batch must bound concurrency, saw ${maxInFlight} in flight at once`);
});

test('_afterRemoteRefreshSuccess: clears the stale per-module memo for the source that just fetched, and resets its check cache - leaving other sources untouched', () => {
  // This is the honest coverage of the invalidation line added to
  // _repoRefreshRemote. tests/test_api_sync_overview_refresh.js cannot prove
  // it: its fixture's origin is file://, which _gitExecRepo refuses for every
  // remote op, so the real `r.code === 0` success branch never runs there -
  // and even if it did, that suite's follow-up read is
  // GET /api/sync-modules?force=1, which bypasses the 30 s memo on its own.
  _syncModulesStatusCache.set('data-tier-0', { expiresAt: Date.now() + 30000, result: { modules: [] } });
  _syncModulesStatusCache.set('data-leads', { expiresAt: Date.now() + 30000, result: { modules: [] } });

  let resetCalls = 0;
  const fakeRepo = { id: 'data-tier-0', resetCheckCache: () => { resetCalls++; } };
  _afterRemoteRefreshSuccess(fakeRepo);

  assert.strictEqual(resetCalls, 1, 'resetCheckCache is called once for the source that fetched');
  assert.strictEqual(_syncModulesStatusCache.has('data-tier-0'), false, 'the stale memo for the fetched source is gone');
  assert.strictEqual(_syncModulesStatusCache.has('data-leads'), true, 'an unrelated source keeps its memo');

  _syncModulesStatusCache.delete('data-leads');
});

test('_repoRefreshRemote calls _afterRemoteRefreshSuccess only after the non-zero-exit early return - source-level pin, no live git needed', () => {
  // The plan's AC3 named a fixed sed line window (8150-8175) for
  // "_invalidateSyncModules(d.id) sits inside _repoRefreshRemote"; that
  // window had already drifted before this retry (earlier steps in the same
  // plan added code above it) and drifts further once the invalidation moves
  // into _afterRemoteRefreshSuccess, so a grep over a hardcoded window is no
  // longer a reliable proxy for the intent. This pin checks the same fact
  // (the call sits on the SUCCESS side of the function, after the failed-fetch
  // early return) directly against the function's own source text, so it
  // survives every future line shift.
  const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const from = src.indexOf('async function _repoRefreshRemote(d) {');
  assert.ok(from > -1, '_repoRefreshRemote still exists');
  const fn = src.slice(from, src.indexOf('\n}\n', from));
  const errIdx = fn.indexOf('if (r.code !== 0)');
  const callIdx = fn.indexOf('_afterRemoteRefreshSuccess(d)');
  assert.ok(errIdx > -1, 'the failed-fetch early return is still there');
  assert.ok(callIdx > -1, '_repoRefreshRemote calls _afterRemoteRefreshSuccess');
  assert.ok(callIdx > errIdx, 'the invalidation runs after the early return, on the success path only');
});

test('_matchPushPaths: an explicit path list resolves to the matching pending records, in request order', () => {
  const pending = new Map([
    ['e1.enc', { relPath: 'a.json', status: 'M' }],
    ['e2.enc', { relPath: 'b.json', status: 'A' }],
  ]);
  const { matched, unknown } = _matchPushPaths(pending, ['b.json', 'a.json']);
  assert.strictEqual(unknown.length, 0);
  assert.deepStrictEqual(matched.map((m) => m.relPath), ['b.json', 'a.json']);
  assert.strictEqual(matched[0].encRelPath, 'e2.enc');
});

test('_matchPushPaths: a path not in the server\'s own pending record is reported in unknown, never silently matched', () => {
  const pending = new Map([['e1.enc', { relPath: 'a.json', status: 'M' }]]);
  const { matched, unknown } = _matchPushPaths(pending, ['a.json', '../../etc/passwd', 'missing.json']);
  assert.strictEqual(matched.length, 1);
  assert.deepStrictEqual(unknown, ['../../etc/passwd', 'missing.json']);
});

test('_matchPushPaths: an entry with no resolved relPath (bare mirror name) can never be targeted by a client path', () => {
  const pending = new Map([['e1.enc', { relPath: null, status: 'D' }]]);
  const { matched, unknown } = _matchPushPaths(pending, ['e1.enc']);
  assert.strictEqual(matched.length, 0);
  assert.deepStrictEqual(unknown, ['e1.enc']);
});

test('_resolveDataRepoId: the canonical route id resolves to itself', () => {
  assert.strictEqual(_resolveDataRepoId('data-tier-0'), 'data-tier-0');
});

test('_resolveDataRepoId: the remote-name alias of the team repo resolves to its route id', () => {
  assert.strictEqual(_resolveDataRepoId('mission-deck-data'), 'data-tier-0');
});

test('_resolveDataRepoId: an unknown name resolves to null', () => {
  assert.strictEqual(_resolveDataRepoId('does-not-exist'), null);
  assert.strictEqual(_resolveDataRepoId(''), null);
  assert.strictEqual(_resolveDataRepoId(undefined), null);
});

test('SYNC_CORE_ID is the ASCII id the classifier and the endpoints agree on', () => {
  assert.strictEqual(SYNC_CORE_ID, '_core');
});
