// tests/test_stash_api_helpers.mjs
// The git-facing half of the four /api/app/stash routes, against REAL throwaway
// repositories - same shape as the _appUpdateStashDirty block in
// tests/test_server_helpers.mjs, and for the same reason: every one of these
// helpers takes `root` injected precisely so it never runs against the
// developer's own working tree.
//
// There is no API test on /api/app/stash/apply or /drop and there must not be:
// the handlers operate on ROOT. They refuse under IS_TEST_MODE, which is the
// belt; this file is the braces.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const srv = require('../server.js');

/**
 * A repo with two stash entries: one made the way _appUpdateStashDirty makes
 * them, one made by hand. Newest first means the hand-made one is stash@{0}.
 */
function _makeStashRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-api-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a1\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b1\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'seed']);

  fs.writeFileSync(path.join(repo, 'a.txt'), 'a2\n');
  git(['stash', 'push', '-q', '-m', 'cockpit-update 2026-09-12T08:30:00.000Z v1.2.3']);
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b2\n');
  git(['stash', 'push', '-q', '-m', 'my work']);
  return { repo, git };
}

const cleanup = (repo) => fs.rmSync(repo, { recursive: true, force: true });

// ── _stashParseList (pure) ───────────────────────────────────────────────────

test('_stashParseList strips git own "On <branch>: " prefix and marks cockpit entries', () => {
  const sha = 'a'.repeat(40);
  const out = srv._stashParseList(
    `stash@{0}\t${sha}\t1789220871\tOn main: my work\n`
    + `stash@{1}\t${'b'.repeat(40)}\t1789220000\tWIP on main: cockpit-update 2026-09-12T08:30:00.000Z v1.2.3\n`,
  );
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].message, 'my work');
  assert.strictEqual(out[0].cockpit, false);
  assert.strictEqual(out[0].sha, sha);
  assert.strictEqual(out[1].message, 'cockpit-update 2026-09-12T08:30:00.000Z v1.2.3');
  assert.strictEqual(out[1].cockpit, true);
  assert.match(out[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('_stashParseList drops a line it cannot trust rather than half-rendering it', () => {
  const good = `stash@{0}\t${'a'.repeat(40)}\t1789220871\tOn main: ok`;
  assert.strictEqual(srv._stashParseList(`${good}\nnonsense\n`).length, 1);
  assert.strictEqual(srv._stashParseList(`stash@{0}\tshort\t1\tOn main: x`).length, 0);
  assert.strictEqual(srv._stashParseList(`refs/heads/x\t${'a'.repeat(40)}\t1\tOn main: x`).length, 0);
  assert.deepStrictEqual(srv._stashParseList(''), []);
  assert.deepStrictEqual(srv._stashParseList(null), []);
});

test('_stashParseList: a message carrying a tab survives whole', () => {
  const out = srv._stashParseList(`stash@{0}\t${'a'.repeat(40)}\t1789220871\tOn main: a\tb`);
  assert.strictEqual(out[0].message, 'a\tb');
});

test('_stashParseList: an unusable timestamp renders no date rather than 1970', () => {
  const out = srv._stashParseList(`stash@{0}\t${'a'.repeat(40)}\tnope\tOn main: x`);
  assert.strictEqual(out[0].at, '');
});

test('detached-head-repair counts as a cockpit entry too', () => {
  const out = srv._stashParseList(`stash@{0}\t${'a'.repeat(40)}\t1789220871\tOn main: detached-head-repair`);
  assert.strictEqual(out[0].cockpit, true);
});

// ── _stashParseBody (pure) ───────────────────────────────────────────────────

test('_stashParseBody: nothing throws, and only a string sha reads as a sha', () => {
  assert.deepStrictEqual(srv._stashParseBody(''), { sha: '' });
  assert.deepStrictEqual(srv._stashParseBody('not json'), { sha: '' });
  assert.deepStrictEqual(srv._stashParseBody('null'), { sha: '' });
  assert.deepStrictEqual(srv._stashParseBody('[]'), { sha: '' });
  assert.deepStrictEqual(srv._stashParseBody('{}'), { sha: '' });
  assert.deepStrictEqual(srv._stashParseBody('{"sha":123}'), { sha: '' });
  assert.deepStrictEqual(srv._stashParseBody('{"sha":" ABCDEF "}'), { sha: 'abcdef' });
});

// ── _stashList / _stashResolve ───────────────────────────────────────────────

test('_stashList reads both entries newest first and tells cockpit from hand-made', async () => {
  const { repo } = _makeStashRepo();
  try {
    const r = await srv._stashList(repo);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.entries.length, 2);
    assert.strictEqual(r.entries[0].ref, 'stash@{0}');
    assert.strictEqual(r.entries[0].message, 'my work');
    assert.strictEqual(r.entries[0].cockpit, false);
    assert.strictEqual(r.entries[1].cockpit, true);
  } finally { cleanup(repo); }
});

test('_stashList on a directory that is not a repository is an empty list, not an error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-norepo-'));
  try {
    const r = await srv._stashList(dir);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.entries, []);
  } finally { cleanup(dir); }
});

test('_stashResolve refuses anything that is not a 40-hex sha before touching git', async () => {
  const { repo } = _makeStashRepo();
  try {
    for (const bad of ['', 'stash@{0}', 'HEAD', '../../etc/passwd', 'a'.repeat(39), null]) {
      const r = await srv._stashResolve(repo, bad);
      assert.strictEqual(r.ok, false, `accepted ${String(bad)}`);
      assert.strictEqual(r.error, 'bad-sha');
    }
  } finally { cleanup(repo); }
});

test('_stashResolve finds the entry by sha and reports its CURRENT ref, which is the whole point', async () => {
  const { repo, git } = _makeStashRepo();
  try {
    const listed = await srv._stashList(repo);
    const older = listed.entries[1];       // the cockpit entry, at stash@{1}
    assert.strictEqual(older.ref, 'stash@{1}');

    // Somebody drops the newer entry in a terminal. Every ref shifts.
    git(['stash', 'drop', '-q', 'stash@{0}']);

    const again = await srv._stashResolve(repo, older.sha);
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.entry.ref, 'stash@{0}', 'the sha followed the entry, the ref did not');
    assert.strictEqual(again.entry.message, older.message);
  } finally { cleanup(repo); }
});

test('_stashResolve on a sha that is gone answers stash-gone and touches nothing', async () => {
  const { repo } = _makeStashRepo();
  try {
    const r = await srv._stashResolve(repo, 'c'.repeat(40));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'stash-gone');
    assert.strictEqual((await srv._stashList(repo)).entries.length, 2);
  } finally { cleanup(repo); }
});

// ── _stashFiles ──────────────────────────────────────────────────────────────

test('_stashFiles lists one entry files without needing its ref', async () => {
  const { repo } = _makeStashRepo();
  try {
    const listed = await srv._stashList(repo);
    const cockpitEntry = listed.entries.find((e) => e.cockpit);
    const r = await srv._stashFiles(repo, cockpitEntry.sha);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.files, ['a.txt']);
  } finally { cleanup(repo); }
});

// ── _stashApply ──────────────────────────────────────────────────────────────

test('_stashApply puts the work back and NEVER pops - the entry survives', async () => {
  const { repo } = _makeStashRepo();
  try {
    const listed = await srv._stashList(repo);
    const hand = listed.entries[0];
    const r = await srv._stashApply(repo, hand.sha);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'b2\n');
    assert.ok(r.files.includes('b.txt'));

    const after = await srv._stashList(repo);
    assert.strictEqual(after.entries.length, 2, 'apply, not pop');
    assert.ok(after.entries.some((e) => e.sha === hand.sha));
  } finally { cleanup(repo); }
});

test('_stashApply reports a conflict as conflict - the work IS in the tree, with markers', async () => {
  const { repo, git } = _makeStashRepo();
  try {
    const listed = await srv._stashList(repo);
    const cockpitEntry = listed.entries.find((e) => e.cockpit);
    // The state a cockpit-update stash always lands in: the base moved on.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a-from-upstream\n');
    git(['commit', '-qam', 'upstream moved']);

    const r = await srv._stashApply(repo, cockpitEntry.sha);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'conflict');
    assert.deepStrictEqual(r.conflicts, ['a.txt']);
    assert.match(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), /<<<<<<</);
    // And the entry is still there, which is the reason apply beats pop here.
    assert.ok((await srv._stashList(repo)).entries.some((e) => e.sha === cockpitEntry.sha));
  } finally { cleanup(repo); }
});

test('_stashApply reports the files the ENTRY carried, not the whole dirty tree', async () => {
  const { repo } = _makeStashRepo();
  try {
    // A tree that is already dirty for unrelated reasons - the normal state on
    // the machine this runs on, and the state that made the first version of
    // this answer list forty-one paths for a one-file stash.
    fs.writeFileSync(path.join(repo, 'noise.txt'), 'unrelated work\n');

    const listed = await srv._stashList(repo);
    const hand = listed.entries[0];            // carries b.txt alone
    const r = await srv._stashApply(repo, hand.sha);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.files, ['b.txt']);
  } finally { cleanup(repo); }
});
test('_stashApply does not blame this call for conflict markers that were already there', async () => {
  const { repo, git } = _makeStashRepo();
  try {
    // Leave the tree holding somebody else half-finished merge: c.txt is
    // unmerged before this apply ever runs, and the entry being applied
    // does not touch it.
    fs.writeFileSync(path.join(repo, 'c.txt'), 'base\n');
    git(['add', '-A']); git(['commit', '-q', '-m', 'c']);
    git(['checkout', '-q', '-b', 'side']);
    fs.writeFileSync(path.join(repo, 'c.txt'), 'side\n');
    git(['commit', '-qam', 'side c']);
    git(['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(repo, 'c.txt'), 'main\n');
    git(['commit', '-qam', 'main c']);
    try { git(['merge', 'side']); } catch (_e) { /* the conflict is the point */ }

    const unmergedBefore = execFileSync(
      'git', ['-C', repo, 'diff', '--name-only', '--diff-filter=U'], { encoding: 'utf8' },
    ).trim();
    assert.strictEqual(unmergedBefore, 'c.txt', 'fixture must start with a pre-existing conflict');

    const listed = await srv._stashList(repo);
    const hand = listed.entries[0];          // carries b.txt alone
    const r = await srv._stashApply(repo, hand.sha);
    assert.notStrictEqual(r.error, 'conflict', "c.txt was not made unmerged by this apply");
  } finally { cleanup(repo); }
});
test('_stashApply on a vanished sha changes nothing', async () => {
  const { repo } = _makeStashRepo();
  try {
    const r = await srv._stashApply(repo, 'd'.repeat(40));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'stash-gone');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'a1\n');
  } finally { cleanup(repo); }
});

// ── _stashDrop ───────────────────────────────────────────────────────────────

test('_stashDrop removes exactly the entry the sha names, whatever its ref is now', async () => {
  const { repo } = _makeStashRepo();
  try {
    const listed = await srv._stashList(repo);
    const cockpitEntry = listed.entries.find((e) => e.cockpit);   // stash@{1}
    const r = await srv._stashDrop(repo, cockpitEntry.sha);
    assert.strictEqual(r.ok, true);

    const after = await srv._stashList(repo);
    assert.strictEqual(after.entries.length, 1);
    assert.strictEqual(after.entries[0].message, 'my work');
  } finally { cleanup(repo); }
});

test('_stashDrop refuses a sha that is not on the stash and leaves the list alone', async () => {
  const { repo } = _makeStashRepo();
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const r = await srv._stashDrop(repo, head);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'stash-gone');
    assert.strictEqual((await srv._stashList(repo)).entries.length, 2);
  } finally { cleanup(repo); }
});
