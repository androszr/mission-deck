// Unit tests for scripts/crypto-sync.js - the encrypt-at-rest layer between the
// plaintext data directory and the mirror that git actually tracks.
// Run: node --test tests/test_crypto_sync.mjs
//
// Every test works on a throwaway tree under os.tmpdir() and its own random
// key, so nothing here touches .encryption-key or data-sub-repositories/.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodeCrypto from 'node:crypto';

const require = createRequire(import.meta.url);
const crypto_sync = require('../scripts/crypto-sync.js');

let ROOT;
const KEY = Buffer.from(crypto_sync.generateKey(), 'base64');

function mk(dir, rel, content) {
  const p = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

before(() => { ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-crypto-')); });
after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

// ── Key file ──────────────────────────────────────────────────────────────────

describe('key file - one line per repo, foreign lines untouched', () => {
  // The core knows ONE key id (ds-data). A source declared later joins
  // KNOWN_REPO_IDS (and OWN_LINE_ONLY_IDS when its key is born here); the
  // helper below declares such a source for the duration of one test.
  const withDeclaredSource = (id, ownLineOnly, fn) => {
    crypto_sync.KNOWN_REPO_IDS.add(id);
    if (ownLineOnly) crypto_sync.OWN_LINE_ONLY_IDS.add(id);
    try { return fn(); } finally {
      crypto_sync.KNOWN_REPO_IDS.delete(id);
      crypto_sync.OWN_LINE_ONLY_IDS.delete(id);
    }
  };

  it('knows exactly the ds-data key id and no own-line-only source by default', () => {
    assert.deepEqual([...crypto_sync.KNOWN_REPO_IDS], ['ds-data']);
    assert.deepEqual([...crypto_sync.OWN_LINE_ONLY_IDS], []);
  });

  it('reads a line for every known repo id and ignores an unknown one', () => {
    withDeclaredSource('data-example', false, () => {
      const dir = fs.mkdtempSync(path.join(ROOT, 'keys-'));
      const mine = crypto_sync.generateKey();
      const extra = crypto_sync.generateKey();
      fs.writeFileSync(path.join(dir, '.encryption-key'),
        'data-example=' + extra + '\n'
        + 'some-other-tool=' + crypto_sync.generateKey() + '\n'
        + 'ds-data=' + mine + '\n');
      const map = crypto_sync.readKeyMap(dir);
      assert.equal(map.repoKeys['ds-data'], mine);
      // A declared source is a known id, not foreign. Dropping it here is what
      // made loadMasterKey report `key-missing` for a key sitting in the file.
      assert.equal(map.repoKeys['data-example'], extra);
      assert.equal(map.repoKeys['some-other-tool'], undefined);
      // An unknown `<id>=<key>` line must NOT be mistaken for a bare key.
      assert.equal(map.bareKey, null);
      assert.ok(crypto_sync.loadMasterKey({}, dir, 'ds-data').equals(Buffer.from(mine, 'base64')));
      assert.ok(crypto_sync.loadMasterKey({}, dir, 'data-example').equals(Buffer.from(extra, 'base64')));
    });
  });

  it('every id in KNOWN_REPO_IDS round-trips through saveRepoKey and loadMasterKey', () => {
    const dir = fs.mkdtempSync(path.join(ROOT, 'keys-all-'));
    const written = {};
    for (const id of crypto_sync.KNOWN_REPO_IDS) {
      written[id] = crypto_sync.generateKey();
      crypto_sync.saveRepoKey(dir, id, written[id]);
    }
    for (const id of crypto_sync.KNOWN_REPO_IDS) {
      assert.ok(crypto_sync.loadMasterKey({}, dir, id).equals(Buffer.from(written[id], 'base64')),
        'key of repo ' + id + ' does not come back from the file');
    }
  });

  it('an own-line-only id ignores a bare line and reports key-missing', () => {
    withDeclaredSource('data-example', true, () => {
      const dir = fs.mkdtempSync(path.join(ROOT, 'keys-own1-'));
      // Unpadded: a padded base64 line carries an '=' and is parsed as another
      // tool's `<id>=<key>` line, never as a bare key.
      const bare = crypto_sync.generateKey().replace(/=+$/, '');
      fs.writeFileSync(path.join(dir, '.encryption-key'), bare + '\n');
      assert.ok(crypto_sync.readKeyMap(dir).bareKey, 'fixture must really be a bare key');
      assert.throws(() => crypto_sync.loadMasterKey({}, dir, 'data-example'),
        (e) => e.code === 'key-missing' && /data-example=/.test(e.message));
    });
  });

  it('a bare line still serves ds-data (it is not own-line-only)', () => {
    const dir = fs.mkdtempSync(path.join(ROOT, 'keys-own2-'));
    const bare = crypto_sync.generateKey().replace(/=+$/, '');
    fs.writeFileSync(path.join(dir, '.encryption-key'), bare + '\n');
    assert.ok(crypto_sync.loadMasterKey({}, dir, 'ds-data').equals(Buffer.from(bare, 'base64')));
  });

  it('DATA_ENCRYPTION_KEY still wins for an own-line-only id', () => {
    withDeclaredSource('data-example', true, () => {
      const dir = fs.mkdtempSync(path.join(ROOT, 'keys-own3-'));
      const envKey = crypto_sync.generateKey();
      assert.ok(crypto_sync.loadMasterKey({ DATA_ENCRYPTION_KEY: envKey }, dir, 'data-example').equals(Buffer.from(envKey, 'base64')));
    });
  });

  it('generateRepoKey writes a 32-byte own line once, returns nothing, and refuses shared ids', () => {
    withDeclaredSource('data-example', true, () => {
      const dir = fs.mkdtempSync(path.join(ROOT, 'keys-own4-'));
      assert.equal(crypto_sync.generateRepoKey(dir, 'data-example'), undefined);
      const line = crypto_sync.readKeyMap(dir).repoKeys['data-example'];
      assert.equal(Buffer.from(line, 'base64').length, 32);
      assert.throws(() => crypto_sync.generateRepoKey(dir, 'data-example'), (e) => e.code === 'key-exists');
      assert.equal(crypto_sync.readKeyMap(dir).repoKeys['data-example'], line, 'second call must not overwrite');
      assert.throws(() => crypto_sync.generateRepoKey(dir, 'ds-data'), (e) => e.code === 'key-not-generatable');
    });
  });

  it('adds the ds-data line without disturbing the others', () => {
    const dir = fs.mkdtempSync(path.join(ROOT, 'keys2-'));
    const foreign = 'some-other-tool=' + crypto_sync.generateKey();
    fs.writeFileSync(path.join(dir, '.encryption-key'), foreign + '\n');
    const mine = crypto_sync.generateKey();
    crypto_sync.saveRepoKey(dir, 'ds-data', mine);
    const text = fs.readFileSync(path.join(dir, '.encryption-key'), 'utf8');
    assert.ok(text.includes(foreign), 'foreign line survives');
    assert.equal(crypto_sync.readKeyMap(dir).repoKeys['ds-data'], mine);
  });

  it('replaces rather than duplicates an existing ds-data line', () => {
    const dir = fs.mkdtempSync(path.join(ROOT, 'keys3-'));
    crypto_sync.saveRepoKey(dir, 'ds-data', crypto_sync.generateKey());
    const second = crypto_sync.generateKey();
    crypto_sync.saveRepoKey(dir, 'ds-data', second);
    const lines = fs.readFileSync(path.join(dir, '.encryption-key'), 'utf8').trim().split('\n');
    assert.equal(lines.filter(l => l.startsWith('ds-data=')).length, 1);
    assert.equal(crypto_sync.readKeyMap(dir).repoKeys['ds-data'], second);
  });

  it('rejects a key that is not 32 bytes and reports a missing one', () => {
    assert.throws(() => crypto_sync.validateKey('dG9vLXNob3J0'), /32 bytes/);
    assert.throws(() => crypto_sync.validateKey(''), /empty/);
    const empty = fs.mkdtempSync(path.join(ROOT, 'keys4-'));
    assert.throws(() => crypto_sync.loadMasterKey({}, empty, 'ds-data'), /encryption-key/);
  });
});

// ── One file ──────────────────────────────────────────────────────────────────

describe('encryptBuffer / decryptBuffer', () => {
  it('round-trips bytes and the path that travels with them', () => {
    const rel = 'team/avatars/taylor kim.png';
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    const encName = crypto_sync.encryptRelPath(rel, KEY);
    const out = crypto_sync.decryptBuffer(crypto_sync.encryptBuffer(body, rel, encName, KEY), encName, KEY);
    assert.equal(out.relPath, rel);
    assert.ok(out.body.equals(body));
  });

  it('names the file in the mirror without spelling the path out', () => {
    const encName = crypto_sync.encryptRelPath('team/avatars/taylorkim.png', KEY);
    assert.match(encName, /^[0-9a-f]{32}$/);
    assert.ok(!encName.includes('taylorkim'));
    // Stable, so an unchanged file keeps its name.
    assert.equal(encName, crypto_sync.encryptRelPath('team/avatars/taylorkim.png', KEY));
  });

  it('refuses a blob renamed to another file name', () => {
    const armored = crypto_sync.encryptBuffer(Buffer.from('x'), 'a.txt', crypto_sync.encryptRelPath('a.txt', KEY), KEY);
    const otherName = crypto_sync.encryptRelPath('b.txt', KEY);
    assert.throws(() => crypto_sync.decryptBuffer(armored, otherName, KEY), /Salt mismatch/);
  });

  it('refuses a tampered blob and a wrong key', () => {
    const rel = 'a.txt';
    const encName = crypto_sync.encryptRelPath(rel, KEY);
    const armored = crypto_sync.encryptBuffer(Buffer.from('secret'), rel, encName, KEY);
    const tampered = armored.slice(0, -6) + 'AAAAA=';
    assert.throws(() => crypto_sync.decryptBuffer(tampered, encName, KEY));
    const otherKey = Buffer.from(crypto_sync.generateKey(), 'base64');
    assert.throws(() => crypto_sync.decryptBuffer(armored, encName, otherKey), /GCM/);
  });

  it('rejects anything that is not a v2 blob', () => {
    assert.throws(() => crypto_sync.decryptBuffer("plain text", "x", KEY), /v2 format/);
  });
});

// ── Whole trees ───────────────────────────────────────────────────────────────

describe('encryptTree / decryptTree', () => {
  it('round-trips a tree byte for byte and leaves no readable name behind', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'tree-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    const back = path.join(base, 'back');
    mk(plain, 'team/team-members.json', '{"team_members":[{"last_name":"Zoltanska"}]}');
    mk(plain, 'team/avatars/anitazoltanska.png', Buffer.from([1, 2, 3, 4, 5]));
    mk(plain, 'prototypes/p1/index.html', '<h1>x</h1>');

    const enc = crypto_sync.encryptTree(plain, mirror, KEY);
    assert.equal(enc.written, 3);
    assert.equal(enc.removed, 0);
    // Flat directory of opaque names: no folder or file leaks a word.
    const mirrored = fs.readdirSync(mirror);
    assert.equal(mirrored.length, 3);
    assert.ok(mirrored.every(f => /^[0-9a-f]{32}\.enc$/.test(f)));

    const dec = crypto_sync.decryptTree(mirror, back, KEY);
    assert.equal(dec.written, 3);
    assert.deepEqual(listFiles(back), listFiles(plain));
    for (const rel of listFiles(plain)) {
      assert.ok(
        fs.readFileSync(path.join(plain, ...rel.split('/')))
          .equals(fs.readFileSync(path.join(back, ...rel.split('/')))),
        rel + ' differs',
      );
    }
  });

  it('is deterministic, so an unchanged tree produces no diff', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'det-'));
    const plain = path.join(base, 'plain');
    mk(plain, 'a/b.txt', 'constant content');
    const m1 = path.join(base, 'm1');
    const m2 = path.join(base, 'm2');
    crypto_sync.encryptTree(plain, m1, KEY);
    crypto_sync.encryptTree(plain, m2, KEY);
    const names = fs.readdirSync(m1);
    assert.deepEqual(names, fs.readdirSync(m2));
    for (const n of names) {
      assert.ok(fs.readFileSync(path.join(m1, n)).equals(fs.readFileSync(path.join(m2, n))));
    }
  });

  it('propagates a deletion in both directions', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'del-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    const back = path.join(base, 'back');
    mk(plain, 'keep.txt', 'a');
    mk(plain, 'drop.txt', 'b');
    crypto_sync.encryptTree(plain, mirror, KEY);
    crypto_sync.decryptTree(mirror, back, KEY);
    assert.deepEqual(listFiles(back), ['drop.txt', 'keep.txt']);

    fs.unlinkSync(path.join(plain, 'drop.txt'));
    const second = crypto_sync.encryptTree(plain, mirror, KEY);
    assert.equal(second.removed, 1);
    const dec = crypto_sync.decryptTree(mirror, back, KEY);
    assert.equal(dec.removed, 1);
    assert.deepEqual(listFiles(back), ['keep.txt']);
  });

  it('never mirrors node_modules or a stray .env, in either direction', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'excl-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'data.json', '{}');
    mk(plain, 'node_modules/pkg/index.js', 'module.exports=1');
    mk(plain, '.env', 'TOKEN=secret');
    const enc = crypto_sync.encryptTree(plain, mirror, KEY);
    assert.deepEqual(enc.files, ['data.json']);
    assert.equal(fs.readdirSync(mirror).length, 1);

    // And the receiver keeps its own copies rather than deleting them.
    const dec = crypto_sync.decryptTree(mirror, plain, KEY);
    assert.equal(dec.removed, 0);
    assert.ok(fs.existsSync(path.join(plain, '.env')));
    assert.ok(fs.existsSync(path.join(plain, 'node_modules/pkg/index.js')));
  });

  it('leaves the plaintext tree untouched when one blob fails to authenticate', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'atomic-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    const back = path.join(base, 'back');
    mk(plain, 'one.txt', 'first');
    mk(plain, 'two.txt', 'second');
    crypto_sync.encryptTree(plain, mirror, KEY);
    crypto_sync.decryptTree(mirror, back, KEY);
    const before = listFiles(back).map(r => fs.readFileSync(path.join(back, r), 'utf8'));

    const victim = fs.readdirSync(mirror)[0];
    fs.writeFileSync(path.join(mirror, victim), 'v2:AAAA');
    assert.throws(() => crypto_sync.decryptTree(mirror, back, KEY));
    assert.deepEqual(listFiles(back).map(r => fs.readFileSync(path.join(back, r), 'utf8')), before);
    assert.equal(fs.readdirSync(back).filter(n => n.startsWith('.crypto-staging-')).length, 0);
  });

  it('refuses a decrypt that would wipe most of the plaintext tree', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'guard-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    for (let i = 0; i < 80; i++) mk(plain, 'f' + i + '.txt', 'x' + i);
    mk(plain, 'kept.txt', 'k');
    crypto_sync.encryptTree(plain, mirror, KEY);
    // A partial clone: only one blob arrived.
    const keep = fs.readdirSync(mirror)[0];
    for (const f of fs.readdirSync(mirror)) if (f !== keep) fs.unlinkSync(path.join(mirror, f));
    assert.throws(() => crypto_sync.decryptTree(mirror, plain, KEY), /Aborted/);
    assert.equal(listFiles(plain).length, 81, 'nothing was deleted');
  });
});

// plaintextAheadOfMirror - the read-only probe /api/data-tier-0/status polls
// every 60 s. Every case here also proves the function never writes: each
// test snapshots directory listings (and, in the dedicated read-only case,
// file contents and mtimes) before and after the call.
describe('plaintextAheadOfMirror - read-only probe', () => {
  it('reports dirty:false right after encryptTree, checked equal to file count', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-clean-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'constant content a');
    mk(plain, 'b.txt', 'constant content b');
    crypto_sync.encryptTree(plain, mirror, KEY);
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY);
    assert.deepEqual(probe, { dirty: false, added: 0, changed: 0, removed: 0, checked: 2, legacy: 0 });
  });

  it('detects an edited plaintext file as changed', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-changed-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'version 1');
    crypto_sync.encryptTree(plain, mirror, KEY);
    fs.writeFileSync(path.join(plain, 'a.txt'), 'version 2 - longer content');
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY);
    assert.equal(probe.changed, 1);
    assert.equal(probe.dirty, true);
  });

  it('detects a brand-new plaintext file as added', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-added-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'a');
    crypto_sync.encryptTree(plain, mirror, KEY);
    mk(plain, 'new.txt', 'fresh file');
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY);
    assert.equal(probe.added, 1);
    assert.equal(probe.dirty, true);
  });

  it('detects a deleted plaintext file as removed', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-removed-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'a');
    mk(plain, 'drop.txt', 'to be removed');
    crypto_sync.encryptTree(plain, mirror, KEY);
    fs.unlinkSync(path.join(plain, 'drop.txt'));
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY);
    assert.equal(probe.removed, 1);
    assert.equal(probe.dirty, true);
  });

  it('is not fooled by mtime alone - byte compare, not just the gate', () => {
    // decryptTree always leaves the plaintext file NEWER than the mirror it
    // came from, so a probe that trusted mtime alone would report "dirty"
    // after every ordinary pull. Reproduce that shape directly: touch the
    // plaintext file forward without changing its bytes.
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-mtime-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'unchanged content');
    crypto_sync.encryptTree(plain, mirror, KEY);
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(plain, 'a.txt'), future, future);

    const cache = new Map();
    const first = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { compareCache: cache });
    assert.equal(first.dirty, false, 'identical bytes must not count as dirty even with a newer mtime');
    assert.equal(cache.size, 1, 'the byte compare must have been memoised');

    const second = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { compareCache: cache });
    assert.equal(second.dirty, false);
    assert.equal(cache.size, 1, 'a second poll of the same file must hit the cache, not grow it');
  });

  it('an empty plaintext tree next to a full mirror is clean, not "all removed"', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-empty-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    const seed = path.join(base, 'seed');
    mk(seed, 'a.txt', 'a');
    mk(seed, 'b.txt', 'b');
    crypto_sync.encryptTree(seed, mirror, KEY);
    fs.mkdirSync(plain, { recursive: true }); // plaintext tree exists but is empty
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY);
    assert.equal(probe.dirty, false);
    assert.equal(probe.plaintextEmpty, true);
  });

  it('collectPaths returns .enc names that can be summed with git status', () => {
    // The "To send / to fetch" column joins this result with `status --porcelain`
    // on the same mirror. Both sides must speak the same `<name>.enc` names,
    // otherwise a file both uncommitted in the mirror AND changed again in the
    // plaintext tree would count twice.
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-paths-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'constant content a');
    mk(plain, 'b.txt', 'constant content b');
    crypto_sync.encryptTree(plain, mirror, KEY);

    fs.writeFileSync(path.join(plain, 'a.txt'), 'zmieniona');
    mk(plain, 'c.txt', 'brand new');
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { collectPaths: true });

    assert.equal(probe.added, 1);
    assert.equal(probe.changed, 1);
    assert.equal(probe.encPaths.length, 2);
    for (const p of probe.encPaths) {
      assert.match(p, /^[0-9a-f]{32}\.enc$/, 'a mirror-shaped name, not a plaintext path');
    }
    // Exactly the names encryptTree would write for these two files.
    const expected = ['a.txt', 'c.txt'].map(r => crypto_sync.encryptRelPath(r, KEY) + '.enc');
    assert.deepEqual(probe.encPaths.slice().sort(), expected.sort());
  });

  it('collectPaths also covers a file removed from the plaintext tree', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-paths-del-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'constant content a');
    mk(plain, 'b.txt', 'constant content b');
    crypto_sync.encryptTree(plain, mirror, KEY);
    const encB = crypto_sync.encryptRelPath('b.txt', KEY) + '.enc';
    fs.unlinkSync(path.join(plain, 'b.txt'));

    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { collectPaths: true });
    assert.equal(probe.removed, 1);
    assert.deepEqual(probe.encPaths, [encB]);
  });

  it('collectPaths returns pendingPaths with relPath and kind for every change', () => {
    // The per-module classification (server.js _repoPendingSet) reads relPath
    // straight from pendingPaths instead of decrypting the .enc name - that must
    // work for each of the three kinds of change.
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-pending-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'constant content a');
    mk(plain, 'b.txt', 'constant content b');
    crypto_sync.encryptTree(plain, mirror, KEY);

    fs.writeFileSync(path.join(plain, 'a.txt'), 'zmieniona');
    mk(plain, 'c.txt', 'brand new');
    fs.unlinkSync(path.join(plain, 'b.txt'));

    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { collectPaths: true });
    const byKind = Object.fromEntries(probe.pendingPaths.map((p) => [p.kind, p]));

    assert.equal(byKind.added.relPath, 'c.txt');
    assert.equal(byKind.added.encRelPath, crypto_sync.encryptRelPath('c.txt', KEY) + '.enc');
    assert.equal(byKind.changed.relPath, 'a.txt');
    assert.equal(byKind.removed.relPath, null);
    assert.equal(byKind.removed.encRelPath, crypto_sync.encryptRelPath('b.txt', KEY) + '.enc');
    assert.equal(probe.pendingPaths.length, 3);
  });

  it('collectPaths in a v1 mirror gives the relPath of a removed file (the .enc name is plain)', () => {
    // Without it the sync window put every deletion in a v1 source into the
    // anonymous "Core" row instead of the scope that owns the file.
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-pending-v1-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'discovery-tasks/dt-a.json', '{"id":"dt-a"}');
    mk(plain, 'discovery-tasks/dt-b.json', '{"id":"dt-b"}');
    crypto_sync.encryptTree(plain, mirror, KEY, undefined, { format: 'v1' });
    fs.unlinkSync(path.join(plain, 'discovery-tasks', 'dt-b.json'));

    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { collectPaths: true, format: 'v1' });
    const removed = probe.pendingPaths.filter((p) => p.kind === 'removed');
    assert.equal(removed.length, 1);
    assert.equal(removed[0].encRelPath, 'discovery-tasks/dt-b.json.enc');
    assert.equal(removed[0].relPath, 'discovery-tasks/dt-b.json');
  });

  it('collectPaths returns nameMap for every scanned file, unchanged ones too', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-namemap-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'constant content a');
    mk(plain, 'b.txt', 'constant content b');
    crypto_sync.encryptTree(plain, mirror, KEY);
    fs.writeFileSync(path.join(plain, 'a.txt'), 'zmieniona');

    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { collectPaths: true });
    assert.equal(probe.nameMap.size, 2, 'nameMap also covers b.txt, which did not change');
    assert.equal(probe.nameMap.get(crypto_sync.encryptRelPath('a.txt', KEY) + '.enc'), 'a.txt');
    assert.equal(probe.nameMap.get(crypto_sync.encryptRelPath('b.txt', KEY) + '.enc'), 'b.txt');
  });

  it('collectPaths returns mtimeByRelPath with the mtime of every scanned file, unchanged and legacy v1 too', () => {
    // server.js computes "localAt" from it (when the data changed on this
    // computer) - it must work for unchanged files (b.txt) and for files in a
    // v1 mirror (no v2 name), so one pass serves both.
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-mtime-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'constant content a');
    mk(plain, 'b.txt', 'constant content b');
    crypto_sync.encryptTree(plain, mirror, KEY);
    fs.writeFileSync(path.join(plain, 'a.txt'), 'zmieniona');

    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { collectPaths: true });
    assert.equal(probe.mtimeByRelPath.size, 2);
    assert.equal(typeof probe.mtimeByRelPath.get('a.txt'), 'number');
    assert.equal(typeof probe.mtimeByRelPath.get('b.txt'), 'number');
    assert.equal(probe.mtimeByRelPath.get('a.txt'), fs.statSync(path.join(plain, 'a.txt')).mtimeMs);
  });

  it('without collectPaths the result carries no encPaths', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-paths-off-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'content');
    crypto_sync.encryptTree(plain, mirror, KEY);
    fs.writeFileSync(path.join(plain, 'a.txt'), 'inna');
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY);
    assert.equal(probe.changed, 1);
    assert.equal('encPaths' in probe, false);
  });

  it('never writes to either tree - listing, bytes and mtimes are unchanged', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'probe-readonly-'));
    const plain = path.join(base, 'plain');
    const mirror = path.join(base, 'mirror');
    mk(plain, 'a.txt', 'a');
    mk(plain, 'sub/b.txt', 'b');
    crypto_sync.encryptTree(plain, mirror, KEY);

    const snapshot = (dir) => {
      const files = listFiles(dir);
      const detail = files.map((rel) => {
        const full = path.join(dir, ...rel.split('/'));
        const st = fs.statSync(full);
        return rel + '|' + st.mtimeMs + '|' + fs.readFileSync(full, 'utf8');
      });
      return { files, detail };
    };
    const beforePlain = snapshot(plain);
    const beforeMirror = snapshot(mirror);

    crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, undefined, { compareCache: new Map(), stopAtFirst: true });

    const afterPlain = snapshot(plain);
    const afterMirror = snapshot(mirror);
    assert.deepEqual(afterPlain.files, beforePlain.files);
    assert.deepEqual(afterPlain.detail, beforePlain.detail);
    assert.deepEqual(afterMirror.files, beforeMirror.files);
    assert.deepEqual(afterMirror.detail, beforeMirror.detail);
  });
});

// Why _repoPull in server.js encrypts BEFORE it pulls. These two tests are the
// evidence: the mirror is git's only view of the data, so plaintext work that
// was never encrypted is invisible to the merge and gets overwritten. They fail
// the moment someone reorders those two steps back.
describe('encryption order and local changes', () => {
  function _freshPair(name) {
    const plain = path.join(ROOT, name, 'plain');
    const mirror = path.join(ROOT, name, 'mirror');
    fs.mkdirSync(plain, { recursive: true });
    fs.mkdirSync(mirror, { recursive: true });
    for (const f of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(plain, f), 'team version ' + f);
    crypto_sync.encryptTree(plain, mirror, KEY);
    return { plain, mirror };
  }

  it('decrypt without a prior encrypt deletes unsent work', () => {
    const { plain, mirror } = _freshPair('order-wrong');
    fs.writeFileSync(path.join(plain, 'b.txt'), 'MY WORK');
    fs.writeFileSync(path.join(plain, 'new.txt'), 'NEW FILE');
    crypto_sync.decryptTree(mirror, plain, KEY);
    assert.equal(fs.readFileSync(path.join(plain, 'b.txt'), 'utf8'), 'team version b.txt',
      'the edit is overwritten - this is why a pull must encrypt first');
    assert.equal(fs.existsSync(path.join(plain, 'new.txt')), false,
      'the new file disappears - it is not in the mirror');
  });

  it('encrypt before decrypt keeps the edit and the new file', () => {
    const { plain, mirror } = _freshPair('kolejnosc-dobra');
    fs.writeFileSync(path.join(plain, 'b.txt'), 'MY WORK');
    fs.writeFileSync(path.join(plain, 'new.txt'), 'NEW FILE');
    crypto_sync.encryptTree(plain, mirror, KEY);
    crypto_sync.decryptTree(mirror, plain, KEY);
    assert.equal(fs.readFileSync(path.join(plain, 'b.txt'), 'utf8'), 'MY WORK');
    assert.equal(fs.readFileSync(path.join(plain, 'new.txt'), 'utf8'), 'NEW FILE');
  });

  it('encryption is incremental - with no changes it writes nothing', () => {
    const { plain, mirror } = _freshPair('przyrostowosc');
    const again = crypto_sync.encryptTree(plain, mirror, KEY);
    assert.equal(again.written, 0, 'an unchanged file is not encrypted again');
    assert.equal(again.skipped, 2);
    fs.writeFileSync(path.join(plain, 'a.txt'), 'change');
    const oneChanged = crypto_sync.encryptTree(plain, mirror, KEY);
    assert.equal(oneChanged.written, 1, 'only the changed file');
    assert.equal(oneChanged.skipped, 1);
  });
});

describe('format v1 (reading legacy-layout mirrors)', () => {
  // A v1 mirror keeps its ciphertext in the old layout: the file name is the
  // real path with `.enc` appended, the body is bare base64 with no prefix, and
  // the salt comes from the PATH, not from the file name. The fixture below
  // rebuilds that format from node:crypto alone, so the test does not depend
  // on a second repository on disk.
  const V1_INFO = Buffer.from('cockpit-data-po-v1');

  function writeV1(mirror, relPath, body, key = KEY, info = V1_INFO) {
    const salt = nodeCrypto.createHash('sha256').update(relPath).digest().subarray(0, 16);
    const iv = nodeCrypto.createHash('sha256').update(body).digest().subarray(0, 12);
    const subKey = Buffer.from(nodeCrypto.hkdfSync('sha256', key, salt, info, 32));
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', subKey, iv);
    const enc = Buffer.concat([cipher.update(body), cipher.final()]);
    const armored = Buffer.concat([salt, iv, enc, cipher.getAuthTag()]).toString('base64');
    const full = path.join(mirror, ...(relPath + '.enc').split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, armored);
    return armored;
  }

  function freshDirs(name) {
    const mirror = path.join(ROOT, name + '-mirror');
    const plain = path.join(ROOT, name + '-plain');
    fs.rmSync(mirror, { recursive: true, force: true });
    fs.rmSync(plain, { recursive: true, force: true });
    fs.mkdirSync(mirror, { recursive: true });
    fs.mkdirSync(plain, { recursive: true });
    return { mirror, plain };
  }

  it('decryptTree reads a v1 file sitting in a subdirectory', () => {
    // The regression this test guards: the v1 salt is computed from the WHOLE
    // path, so using the bare file name breaks every file outside the root and
    // looks like a wrong key rather than a wrong format.
    const { mirror, plain } = freshDirs('v1-zagniezdzony');
    writeV1(mirror, 'a/b/nested.md', Buffer.from('# deeper\n'));
    writeV1(mirror, 'responsibilities.json', Buffer.from('{"po":"ok"}'));
    const stats = crypto_sync.decryptTree(mirror, plain, KEY, V1_INFO);
    assert.deepEqual(stats.files.sort(), ['a/b/nested.md', 'responsibilities.json']);
    assert.equal(fs.readFileSync(path.join(plain, 'a', 'b', 'nested.md'), 'utf8'), '# deeper\n');
    assert.equal(fs.readFileSync(path.join(plain, 'responsibilities.json'), 'utf8'), '{"po":"ok"}');
  });

  it('a mixed v1 + v2 tree decrypts in one pass', () => {
    // A source mid-migration holds both layouts at once, and the only reliable
    // distinction is the `v2:` prefix - hence a decision per FILE, not per repo.
    const { mirror, plain } = freshDirs('v1-mieszane');
    writeV1(mirror, 'old.txt', Buffer.from('old layout'));
    const encName = crypto_sync.encryptRelPath('new/file.txt', KEY, V1_INFO);
    fs.writeFileSync(path.join(mirror, encName + '.enc'),
      crypto_sync.encryptBuffer(Buffer.from('new layout'), 'new/file.txt', encName, KEY, V1_INFO));
    const stats = crypto_sync.decryptTree(mirror, plain, KEY, V1_INFO);
    assert.deepEqual(stats.files.sort(), ['new/file.txt', 'old.txt']);
    assert.equal(fs.readFileSync(path.join(plain, 'old.txt'), 'utf8'), 'old layout');
    assert.equal(fs.readFileSync(path.join(plain, 'new', 'file.txt'), 'utf8'), 'new layout');
  });

  it('another hkdfInfo ends in an error, never silent garbage', () => {
    // Each legacy source has its own HKDF context string. Using the default
    // ('cockpit-ds-data-v1') gives a correct-looking key that passes no auth
    // tag - that must be a loud error.
    const { mirror, plain } = freshDirs('v1-zly-info');
    writeV1(mirror, 'x.txt', Buffer.from('content'));
    assert.throws(() => crypto_sync.decryptTree(mirror, plain, KEY, crypto_sync.DEFAULT_HKDF_INFO),
      (e) => e.code === 'decrypt-failed');
  });

  it('a swapped v1 file name is rejected by the salt', () => {
    const { mirror, plain } = freshDirs('v1-swap');
    const armored = writeV1(mirror, 'genuine.txt', Buffer.from('content'));
    fs.writeFileSync(path.join(mirror, 'impostor.txt.enc'), armored);
    assert.throws(() => crypto_sync.decryptTree(mirror, plain, KEY, V1_INFO),
      (e) => e.code === 'decrypt-failed');
  });

  it('the probe reports no changes right after cloning a v1 repository', () => {
    // A production regression: the probe counted only v2 names (`<hmac>.enc`),
    // of which a v1 mirror has none, so EVERY decrypted file looked added and a
    // fresh clone got the "local changes" badge at once - while the button that
    // would show them was disabled.
    const { mirror, plain } = freshDirs('v1-sonda');
    writeV1(mirror, 'responsibilities.json', Buffer.from('{"po":"ok"}'));
    writeV1(mirror, 'a/b/nested.md', Buffer.from('# deeper\n'));
    crypto_sync.decryptTree(mirror, plain, KEY, V1_INFO);
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, V1_INFO);
    assert.equal(probe.dirty, false, 'a fresh v1 clone is clean');
    assert.equal(probe.legacy, 2, 'both files recognised as the v1 layout');
    assert.equal(probe.removed, 0, 'no mirror entry is orphaned');
  });

  it('the probe reports no changes after a clone with stopAtFirst', () => {
    // The path that really runs in /api/data/<id>/status.
    const { mirror, plain } = freshDirs('v1-sonda-stop');
    writeV1(mirror, 'file.txt', Buffer.from('content'));
    crypto_sync.decryptTree(mirror, plain, KEY, V1_INFO);
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, V1_INFO,
      { compareCache: new Map(), stopAtFirst: true });
    assert.equal(probe.dirty, false);
  });

  it('a new file next to a v1 tree is still detected', () => {
    // Recognising the v1 layout must not silence the probe entirely: a file that
    // is in the mirror under NEITHER of the two names is a real local change.
    const { mirror, plain } = freshDirs('v1-sonda-nowy');
    writeV1(mirror, 'file.txt', Buffer.from('content'));
    crypto_sync.decryptTree(mirror, plain, KEY, V1_INFO);
    fs.writeFileSync(path.join(plain, 'added.txt'), 'my work');
    const probe = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, V1_INFO);
    assert.equal(probe.dirty, true);
    assert.equal(probe.added, 1);
  });

  it('encryptTree on a v1 mirror DESTROYS it - which is why a pull never encrypts read-only sources', () => {
    // This is why the gate in _repoPull (server.js) exists: encryptTree writes
    // v2 names, a v1 mirror has none, so the mtime gate never skips a file and
    // the pruning pass removes EVERY original `.enc`. One "Fetch" on an
    // already-cloned v1 source would rewrite the whole mirror into a format the
    // other reader cannot read - with no way back, because local-changes and
    // discard are disabled there.
    const { mirror, plain } = freshDirs('v1-encrypt-niszczy');
    writeV1(mirror, 'responsibilities.json', Buffer.from('{"po":"ok"}'));
    writeV1(mirror, 'a/b/nested.md', Buffer.from('# deeper\n'));
    crypto_sync.decryptTree(mirror, plain, KEY, V1_INFO);

    const before = fs.readdirSync(mirror).sort();
    assert.ok(before.includes('responsibilities.json.enc'), 'the mirror starts in the v1 layout');

    crypto_sync.encryptTree(plain, mirror, KEY, V1_INFO);

    const after = new Set(fs.readdirSync(mirror));
    assert.equal(after.has('responsibilities.json.enc'), false,
      'the original v1 entry was deleted - exactly what the gate prevents');
    assert.equal(after.has('a'), false, 'the v1 directory disappears too');
  });

  it('decryptBufferV1 returns the body alone, without the path inside', () => {
    const { mirror } = freshDirs('v1-buffer');
    writeV1(mirror, 'file.txt', Buffer.from('exactly this'));
    const armored = fs.readFileSync(path.join(mirror, 'file.txt.enc'), 'utf8');
    const body = crypto_sync.decryptBufferV1(armored, 'file.txt', KEY, V1_INFO);
    assert.equal(body.toString('utf8'), 'exactly this');
  });
});

// ── encryptTree guard: never publish the deletion of a tree that was never here ──

describe('encryptTree destructive guard and prune:false', () => {
  function seedMirror(base, n) {
    // A team tree, encrypted into a mirror - the state after somebody's push.
    const team = path.join(base, 'team-plain');
    for (let i = 0; i < n; i++) mk(team, `team/f${i}.json`, `{"i":${i}}`);
    mk(team, 'team/team-members.json', '[]');
    const mirror = path.join(base, 'mirror');
    crypto_sync.encryptTree(team, mirror, KEY);
    return { team, mirror, encCount: n + 1 };
  }

  it('refuses to encrypt an EMPTY plaintext tree over a non-empty mirror (clone before the key)', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'guard-empty-'));
    const { mirror, encCount } = seedMirror(base, 5);
    const plain = path.join(base, 'plain');
    fs.mkdirSync(plain);
    assert.throws(() => crypto_sync.encryptTree(plain, mirror, KEY), (e) => e.code === 'encrypt-destructive');
    assert.equal(fs.readdirSync(mirror).filter(f => f.endsWith('.enc')).length, encCount, 'nothing removed');
  });

  it('refuses when the plaintext tree shares no file with the mirror (a module download on a never-decrypted clone)', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'guard-overlap-'));
    const { mirror, encCount } = seedMirror(base, 5);
    const plain = path.join(base, 'plain');
    mk(plain, 'time-off/persons/anna.json', '{"days":[]}');
    assert.throws(() => crypto_sync.encryptTree(plain, mirror, KEY), /undecrypted/);
    // Fail-closed BEFORE any write: the module's file was not encrypted in either.
    assert.equal(fs.readdirSync(mirror).filter(f => f.endsWith('.enc')).length, encCount);
  });

  it('prune:false writes the new file and removes nothing - what a pull falls back to', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'guard-noprune-'));
    const { mirror, encCount } = seedMirror(base, 5);
    const plain = path.join(base, 'plain');
    mk(plain, 'time-off/persons/anna.json', '{"days":[]}');
    const r = crypto_sync.encryptTree(plain, mirror, KEY, undefined, { prune: false });
    assert.equal(r.written, 1);
    assert.equal(r.removed, 0);
    assert.equal(fs.readdirSync(mirror).filter(f => f.endsWith('.enc')).length, encCount + 1);
  });

  it('still lets an ordinary deletion travel when the tree overlaps the mirror', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'guard-ok-'));
    const { team, mirror, encCount } = seedMirror(base, 5);
    fs.unlinkSync(path.join(team, 'team', 'f0.json'));
    const r = crypto_sync.encryptTree(team, mirror, KEY);
    assert.equal(r.removed, 1);
    assert.equal(fs.readdirSync(mirror).filter(f => f.endsWith('.enc')).length, encCount - 1);
  });

  it('refuses a run that would drop most of a large mirror even with some overlap', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'guard-ratio-'));
    const { team, mirror } = seedMirror(base, 80);
    // Keep 10 files, delete 71 of 81: over DESTRUCTIVE_MIN_FILES and over 30%.
    for (let i = 10; i < 80; i++) fs.unlinkSync(path.join(team, 'team', `f${i}.json`));
    fs.unlinkSync(path.join(team, 'team', 'team-members.json'));
    assert.throws(() => crypto_sync.encryptTree(team, mirror, KEY), /Aborted/);
    assert.equal(fs.readdirSync(mirror).filter(f => f.endsWith('.enc')).length, 81);
  });

  it('mirrorOverlap: zero for a never-decrypted tree, full after a decrypt, counts v1 names too', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'overlap-'));
    const { mirror, encCount } = seedMirror(base, 3);
    const plain = path.join(base, 'plain');
    fs.mkdirSync(plain);
    assert.deepEqual(crypto_sync.mirrorOverlap(plain, mirror, KEY), { plaintextFiles: 0, mirrorEnc: encCount, overlap: 0 });
    mk(plain, 'time-off/x.json', '{}');
    assert.equal(crypto_sync.mirrorOverlap(plain, mirror, KEY).overlap, 0);
    crypto_sync.decryptTree(mirror, plain, KEY, undefined, { prune: false });
    const o = crypto_sync.mirrorOverlap(plain, mirror, KEY);
    assert.equal(o.overlap, encCount);
    assert.equal(o.plaintextFiles, encCount + 1, 'the module file survived a prune:false decrypt');
    // Legacy v1 layout: <relPath>.enc in the mirror counts as present.
    const v1 = path.join(base, 'v1-mirror');
    mk(v1, 'docs/a.md.enc', 'v1-body');
    const p2 = path.join(base, 'v1-plain');
    mk(p2, 'docs/a.md', 'a');
    assert.equal(crypto_sync.mirrorOverlap(p2, v1, KEY).overlap, 1);
  });

  it('decryptTree prune:false keeps plaintext-only files, the default still removes them', () => {
    const base = fs.mkdtempSync(path.join(ROOT, 'dec-noprune-'));
    const { mirror } = seedMirror(base, 3);
    const plain = path.join(base, 'plain');
    mk(plain, 'time-off/persons/anna.json', '{"days":[]}');
    const r1 = crypto_sync.decryptTree(mirror, plain, KEY, undefined, { prune: false });
    assert.equal(r1.removed, 0);
    assert.ok(fs.existsSync(path.join(plain, 'time-off', 'persons', 'anna.json')));
    const r2 = crypto_sync.decryptTree(mirror, plain, KEY);
    assert.equal(r2.removed, 1);
    assert.ok(!fs.existsSync(path.join(plain, 'time-off', 'persons', 'anna.json')));
  });
});

// ── writer v1: encryptTree(..., { format: 'v1' }), byte-compatible with the ──
// ── legacy v1 writer (see tests/fixtures/crypto-v1) ─────────────────────────

describe('writer v1 - encryptBufferV1 and format per source', () => {
  const FIXTURE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'crypto-v1');
  const FIXTURE_KEY = Buffer.from(fs.readFileSync(path.join(FIXTURE_DIR, 'key.txt'), 'utf8').trim(), 'base64');
  const FIXTURE_INFO = Buffer.from('cockpit-data-mini-v1');

  function freshDirs(name) {
    const mirror = path.join(ROOT, name + '-mirror');
    const plain = path.join(ROOT, name + '-plain');
    fs.rmSync(mirror, { recursive: true, force: true });
    fs.rmSync(plain, { recursive: true, force: true });
    fs.mkdirSync(mirror, { recursive: true });
    fs.mkdirSync(plain, { recursive: true });
    return { mirror, plain };
  }

  it('encryptBufferV1 is reversible by decryptBufferV1', () => {
    const plaintext = Buffer.from('content to check the roundtrip');
    const armored = crypto_sync.encryptBufferV1(plaintext, 'a/b/file.json', KEY, Buffer.from('cockpit-data-mini-v1'));
    const back = crypto_sync.decryptBufferV1(armored, 'a/b/file.json', KEY, Buffer.from('cockpit-data-mini-v1'));
    assert.ok(back.equals(plaintext));
  });

  it('encryptBufferV1 is byte-equal to the fixture made by the legacy writer', () => {
    const plain = fs.readFileSync(path.join(FIXTURE_DIR, 'plain', 'public', 'allowed-users.json'));
    const mirrorArmored = fs.readFileSync(path.join(FIXTURE_DIR, 'mirror', 'public', 'allowed-users.json.enc'), 'utf8').trim();
    const armored = crypto_sync.encryptBufferV1(plain, 'public/allowed-users.json', FIXTURE_KEY, FIXTURE_INFO);
    assert.equal(armored, mirrorArmored);
  });

  it("encryptTree({ format: 'v1' }) over an unchanged tree next to a v1 mirror writes nothing, after touching one file it rewrites exactly one v1 name", () => {
    const { mirror, plain } = freshDirs('v1-writer-niezmienione');
    mk(plain, 'public/allowed-users.json', '{"emails":[]}');
    mk(plain, 'mini-analytics/wdrozenia/meta.json', '{"days":1}');
    const first = crypto_sync.encryptTree(plain, mirror, KEY, FIXTURE_INFO, { format: 'v1' });
    assert.equal(first.written, 2);
    assert.equal(first.removed, 0);

    const noop = crypto_sync.encryptTree(plain, mirror, KEY, FIXTURE_INFO, { format: 'v1' });
    assert.equal(noop.written, 0, 'the mirror is already byte-correct - nothing to write');
    assert.equal(noop.removed, 0);

    // Touch mtime forward so the incremental gate does not skip it.
    const target = path.join(plain, 'public', 'allowed-users.json');
    fs.writeFileSync(target, '{"emails":["a@example.com"]}');
    const future = Date.now() / 1000 + 5;
    fs.utimesSync(target, future, future);
    const afterTouch = crypto_sync.encryptTree(plain, mirror, KEY, FIXTURE_INFO, { format: 'v1' });
    assert.equal(afterTouch.written, 1, 'exactly one file rewritten');
    assert.equal(afterTouch.removed, 0);

    const mirrorNames = fs.readdirSync(path.join(mirror, 'public'));
    assert.deepEqual(mirrorNames, ['allowed-users.json.enc'], 'a v1 name - relPath + .enc, no hexadecimal name');
  });

  it("encryptTree({ format: 'v1' }) over an empty plaintext refuses as encrypt-destructive", () => {
    const { mirror, plain } = freshDirs('v1-writer-pusty');
    mk(plain, 'public/allowed-users.json', '{}');
    crypto_sync.encryptTree(plain, mirror, KEY, FIXTURE_INFO, { format: 'v1' });
    fs.rmSync(path.join(plain, 'public', 'allowed-users.json'));
    assert.throws(() => crypto_sync.encryptTree(plain, mirror, KEY, FIXTURE_INFO, { format: 'v1' }),
      (e) => e.code === 'encrypt-destructive');
  });

  it("plaintextAheadOfMirror({ format: 'v1' }) reports an edited legacy file as changed with encRelPath = relPath + '.enc', { format: 'v2' } still as legacy", () => {
    const { mirror, plain } = freshDirs('v1-writer-sonda');
    mk(plain, 'public/allowed-users.json', '{"emails":[]}');
    crypto_sync.encryptTree(plain, mirror, KEY, FIXTURE_INFO, { format: 'v1' });

    // v2 (default): this source's mirror holds only the v1 name, so the probe
    // reports it as `legacy` - unchanged, because a v2-format caller has no
    // writer for that name.
    const asV2 = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, FIXTURE_INFO);
    assert.equal(asV2.legacy, 1);
    assert.equal(asV2.dirty, false);

    // v1: the SAME name is this source's primary layout, so a real edit must
    // be seen as `changed`, not swallowed by the legacy branch.
    fs.writeFileSync(path.join(plain, 'public', 'allowed-users.json'), '{"emails":["a@example.com"]}');
    const asV1 = crypto_sync.plaintextAheadOfMirror(plain, mirror, KEY, FIXTURE_INFO, { format: 'v1', collectPaths: true });
    assert.equal(asV1.dirty, true);
    assert.equal(asV1.changed, 1);
    assert.equal(asV1.pendingPaths[0].encRelPath, 'public/allowed-users.json.enc');
  });
});

describe('.syncignore - regenerable local state never reaches the mirror', () => {
  const POLICY = ['# comment', 'reports/_cache/', '*.bak', '**/index.json.lock', 'hub/src/confluence/*.png', ''].join('\n');
  const FORMATS = ['v2', 'v1'];

  function mkTier() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-sync-syncignore-'));
    const plain = path.join(base, 'plain');
    const enc = path.join(base, 'enc');
    const dst = path.join(base, 'dst');
    const write = (root, rel, body) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    };
    write(plain, '.syncignore', POLICY);
    write(plain, 'reports/summary.json', '{"view":"data"}');
    write(plain, 'reports/_cache/2026-01-01.json', '{"cache":1}');
    write(plain, 'stores-directory.json.bak', 'backup');
    write(plain, 'nps/history/index.json.lock', 'lock');
    write(plain, 'hub/src/confluence/1-img.png', 'png');
    write(plain, 'hub/src/confluence/1.json', '{"rest":true}');
    return { base, plain, enc, dst, write };
  }
  const encCount = (dir) => fs.readdirSync(dir, { recursive: true }).filter(p => String(p).endsWith('.enc')).length;

  it('pattern matching follows the gitignore subset', () => {
    const rules = crypto_sync._parseSyncIgnore(POLICY);
    for (const p of ['reports/_cache/a.json', 'reports/_cache/sub/b.json', 'x.bak', 'deep/dir/y.json.bak',
      'index.json.lock', 'a/b/index.json.lock', 'hub/src/confluence/1.png']) {
      assert.ok(crypto_sync._isSyncIgnored(p, rules), `${p} must be excluded`);
    }
    for (const p of ['reports/summary.json', 'reports/_cache.json', 'x.bak.json', 'hub/src/confluence/1.json',
      'other/hub/src/confluence/1.png', 'hub/src/confluence/sub/1.png']) {
      assert.ok(!crypto_sync._isSyncIgnored(p, rules), `${p} must stay shared`);
    }
  });

  it('encryptTree skips excluded paths but ships the policy file and view data', () => {
    for (const format of FORMATS) {
      const { base, plain, enc } = mkTier();
      try {
        const result = crypto_sync.encryptTree(plain, enc, KEY, undefined, { format });
        assert.equal(encCount(enc), 3, format);
        assert.ok(!fs.existsSync(path.join(enc, 'workspace', '_cache')));
        assert.equal(result.files.length, 3, format);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
  });

  it('a full pass sweeps previously mirrored excluded .enc out of the mirror (v1 and v2)', () => {
    for (const format of FORMATS) {
      const { base, plain, enc } = mkTier();
      try {
        const policy = fs.readFileSync(path.join(plain, '.syncignore'));
        fs.rmSync(path.join(plain, '.syncignore'));
        crypto_sync.encryptTree(plain, enc, KEY, undefined, { format });
        assert.equal(encCount(enc), 6, 'without a policy everything ships (old behaviour)');
        fs.writeFileSync(path.join(plain, '.syncignore'), policy);
        const after = crypto_sync.encryptTree(plain, enc, KEY, undefined, { format });
        assert.equal(after.removed, 4, format);
        assert.equal(encCount(enc), 3, format);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
  });

  it('the read-only probes ignore excluded paths and report the stale mirror blobs as removals', () => {
    for (const format of FORMATS) {
      const { base, plain, enc } = mkTier();
      try {
        const policy = fs.readFileSync(path.join(plain, '.syncignore'));
        fs.rmSync(path.join(plain, '.syncignore'));
        crypto_sync.encryptTree(plain, enc, KEY, undefined, { format });
        fs.writeFileSync(path.join(plain, '.syncignore'), policy);
        const probe = crypto_sync.plaintextAheadOfMirror(plain, enc, KEY, undefined, { format });
        assert.equal(probe.removed, 4, format);
        assert.equal(probe.added, 1, 'only the policy file itself is new');
        assert.equal(crypto_sync.mirrorOverlap(plain, enc, KEY).plaintextFiles, 3, format);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
  });

  it("decryptTree keeps the receiver's local excluded files and never writes stale excluded blobs", () => {
    for (const format of FORMATS) {
      const { base, plain, enc, dst, write } = mkTier();
      try {
        // A client WITHOUT .syncignore support pushed the cache into the mirror,
        // then the policy blob arrived on its own.
        const policy = fs.readFileSync(path.join(plain, '.syncignore'));
        fs.rmSync(path.join(plain, '.syncignore'));
        crypto_sync.encryptTree(plain, enc, KEY, undefined, { format });
        const legacyMirror = encCount(enc);
        fs.writeFileSync(path.join(plain, '.syncignore'), policy);
        const staged = path.join(base, 'policy-only');
        write(staged, '.syncignore', POLICY);
        crypto_sync.encryptTree(staged, enc, KEY, undefined, { format, prune: false });
        assert.equal(encCount(enc), legacyMirror + 1);

        write(dst, 'reports/_cache/2026-01-01.json', '{"local":true}');
        write(dst, 'reports/_cache/only-local.json', '{"local":true}');
        write(dst, 'local.bak', 'mine');

        crypto_sync.decryptTree(enc, dst, KEY);

        assert.equal(fs.readFileSync(path.join(dst, 'reports/_cache/2026-01-01.json'), 'utf8'), '{"local":true}', format);
        assert.ok(fs.existsSync(path.join(dst, 'reports/_cache/only-local.json')));
        assert.ok(fs.existsSync(path.join(dst, 'local.bak')));
        assert.ok(!fs.existsSync(path.join(dst, 'stores-directory.json.bak')));
        assert.equal(fs.readFileSync(path.join(dst, 'reports/summary.json'), 'utf8'), '{"view":"data"}');
        assert.ok(fs.existsSync(path.join(dst, '.syncignore')), 'the policy itself is shared');
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
  });

  it('a policy that newly excludes most of the mirror is refused by the destructive guard, not applied silently', () => {
    for (const format of FORMATS) {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-sync-syncignore-guard-'));
      const plain = path.join(base, 'plain');
      const enc = path.join(base, 'enc');
      try {
        fs.mkdirSync(path.join(plain, 'cache'), { recursive: true });
        for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(plain, 'cache', `c${i}.json`), '{"c":' + i + '}');
        for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(plain, `keep${i}.json`), '{"k":' + i + '}');
        crypto_sync.encryptTree(plain, enc, KEY, undefined, { format });
        const before = encCount(enc);
        assert.equal(before, 70, format);
        // The policy arrives AFTER the cache was shared: 60 of 70 blobs (86%) would leave the mirror.
        fs.writeFileSync(path.join(plain, '.syncignore'), 'cache/\n');
        assert.throws(
          () => crypto_sync.encryptTree(plain, enc, KEY, undefined, { format }),
          (e) => e.code === 'encrypt-destructive' || /encrypt-destructive/.test(String(e.code || e.message)),
          format,
        );
        assert.equal(encCount(enc), before, 'a refused run leaves the mirror untouched');
        // prune:false is the escape the pull path uses: nothing is removed.
        crypto_sync.encryptTree(plain, enc, KEY, undefined, { format, prune: false });
        assert.ok(encCount(enc) >= before, 'no removal without prune');
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
  });
});
