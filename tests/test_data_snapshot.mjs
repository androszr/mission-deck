// tests/test_data_snapshot.mjs
// The core snapshot service behind ctx.captureDataSnapshot
// (_captureDataSnapshotImpl in server.js), driven against throwaway
// directories and injected locks: the copy runs under each source's real
// lockFn and mirror file lock in registry order, refuses a destination
// outside the module's dataDir, retries once when an input changes mid-copy
// and never writes into a source. docs/architecture/modules.md
// (step 14, AC4).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');

function makeLock() {
  let chain = Promise.resolve();
  return function withLock(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
}

function makeEnv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
  const dataDir = path.join(tmp, 'module-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const events = [];
  const repos = ['data-reports', 'data-docs'].map((id) => {
    const plainDir = path.join(tmp, 'ds-' + id);
    fs.mkdirSync(path.join(plainDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(plainDir, 'a.json'), JSON.stringify({ id, v: 1 }));
    fs.writeFileSync(path.join(plainDir, 'sub', 'b.json'), JSON.stringify({ id, v: 2 }));
    fs.writeFileSync(path.join(plainDir, '.hidden'), 'x');
    const lock = makeLock();
    return {
      id,
      plainDir,
      dir: plainDir + '-encrypted',
      lockFn: (fn) => { events.push('lock:' + id); return lock(async () => { try { return await fn(); } finally { events.push('unlock:' + id); } }); },
      gitExecFn: async () => ({ code: 0, stdout: 'abc123-' + id + '\n', stderr: '' }),
    };
  });
  const fileLocks = [];
  const env = {
    repos,
    dataDir,
    acquireFileLock: async (dir) => { fileLocks.push('acquire:' + path.basename(dir)); return { ok: true, lockPath: 'x' }; },
    releaseFileLock: (dir) => { fileLocks.push('release:' + path.basename(dir)); },
    log: () => {},
  };
  return { tmp, dataDir, repos, env, events, fileLocks };
}

test('copies the selection per source in registry order under lockFn and the file lock, and records HEAD plus hashes', async () => {
  const { tmp, dataDir, env, events, fileLocks, repos } = makeEnv();
  try {
    const destination = path.join(dataDir, 'snapshots', 'run-1');
    const res = await srv._captureDataSnapshotImpl({
      // Caller order is reversed on purpose: the service must use the registry's.
      repoIds: ['data-docs', 'data-reports'],
      selections: { 'data-reports': ['a.json', 'sub'], 'data-docs': ['sub'] },
      destination,
    }, env);
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.deepStrictEqual(Object.keys(res.snapshot.sources), ['data-reports', 'data-docs']);
    assert.strictEqual(res.snapshot.sources['data-reports'].head, 'abc123-data-reports');
    assert.strictEqual(res.snapshot.sources['data-reports'].fileCount, 2);
    assert.strictEqual(res.snapshot.sources['data-docs'].fileCount, 1);
    assert.ok(fs.existsSync(path.join(destination, 'data-reports', 'a.json')));
    assert.ok(fs.existsSync(path.join(destination, 'data-reports', 'sub', 'b.json')));
    assert.ok(!fs.existsSync(path.join(destination, 'data-docs', 'a.json')), 'unselected file not copied');
    assert.ok(!fs.existsSync(path.join(destination, 'data-reports', '.hidden')), 'dotfiles never copied');
    assert.deepStrictEqual(events, ['lock:data-reports', 'unlock:data-reports', 'lock:data-docs', 'unlock:data-docs']);
    assert.deepStrictEqual(fileLocks, ['acquire:ds-data-reports-encrypted', 'release:ds-data-reports-encrypted', 'acquire:ds-data-docs-encrypted', 'release:ds-data-docs-encrypted']);
    // Sources untouched.
    assert.deepStrictEqual(fs.readdirSync(repos[0].plainDir).sort(), ['.hidden', 'a.json', 'sub']);
    const hashes = res.snapshot.sources['data-reports'].files;
    assert.ok(/^[0-9a-f]{64}$/.test(hashes['a.json']));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('refuses a destination outside the module dataDir, the dataDir itself, an unknown repo id and a traversal selection', async () => {
  const { tmp, dataDir, env } = makeEnv();
  try {
    const outside = await srv._captureDataSnapshotImpl({ repoIds: ['data-reports'], selections: { 'data-reports': ['a.json'] }, destination: path.join(tmp, 'elsewhere') }, env);
    assert.strictEqual(outside.error, 'snapshot-destination');
    const self = await srv._captureDataSnapshotImpl({ repoIds: ['data-reports'], selections: { 'data-reports': ['a.json'] }, destination: dataDir }, env);
    assert.strictEqual(self.error, 'snapshot-destination');
    const unknown = await srv._captureDataSnapshotImpl({ repoIds: ['data-mirror'], selections: {}, destination: path.join(dataDir, 's') }, env);
    assert.strictEqual(unknown.error, 'snapshot-unknown-repo');
    const traversal = await srv._captureDataSnapshotImpl({ repoIds: ['data-reports'], selections: { 'data-reports': ['../secret'] }, destination: path.join(dataDir, 's') }, env);
    assert.strictEqual(traversal.error, 'snapshot-selection');
    assert.ok(!fs.existsSync(path.join(dataDir, 's')), 'nothing written on refusal');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a copy waits for a pull that holds the source lock, and a held file lock answers locked', async () => {
  const { tmp, dataDir, env, repos } = makeEnv();
  try {
    // Simulate a running pull: hold the lockFn chain, rewrite the source, release.
    let release;
    const pulling = repos[0].lockFn(() => new Promise((r) => { release = r; }));
    const snapshotP = srv._captureDataSnapshotImpl({ repoIds: ['data-reports'], selections: { 'data-reports': ['a.json'] }, destination: path.join(dataDir, 's') }, env);
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(path.join(repos[0].plainDir, 'a.json'), JSON.stringify({ v: 'after-pull' }));
    release();
    await pulling;
    const res = await snapshotP;
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 's', 'data-reports', 'a.json'), 'utf8')), { v: 'after-pull' });

    const lockedEnv = { ...env, acquireFileLock: async () => ({ ok: false, error: 'locked' }) };
    const locked = await srv._captureDataSnapshotImpl({ repoIds: ['data-reports'], selections: { 'data-reports': ['a.json'] }, destination: path.join(dataDir, 's2') }, lockedEnv);
    assert.strictEqual(locked.error, 'locked');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an input that changes during the copy is retried once and then refused as snapshot-unstable', async () => {
  const { tmp, dataDir, env, repos } = makeEnv();
  try {
    const target = path.join(repos[0].plainDir, 'a.json');
    // Every hash pass reads the file; flipping it on every read means before/after never agree.
    let n = 0;
    const origRead = fs.readFileSync;
    fs.readFileSync = function patched(file, ...rest) {
      if (file === target) { n += 1; fs.writeFileSync(target, JSON.stringify({ n }), 'utf8'); }
      return origRead.call(fs, file, ...rest);
    };
    let res;
    try {
      res = await srv._captureDataSnapshotImpl({ repoIds: ['data-reports'], selections: { 'data-reports': ['a.json'] }, destination: path.join(dataDir, 's') }, env);
    } finally {
      fs.readFileSync = origRead;
    }
    assert.strictEqual(res.error, 'snapshot-unstable');
    assert.ok(!fs.existsSync(path.join(dataDir, 's', 'data-reports')), 'the half-copied directory is removed');
    assert.ok(n >= 4, 'two attempts, each hashing before and after: ' + n);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a source that is not cloned answers snapshot-source-missing before any lock is taken', async () => {
  const { tmp, dataDir, env, repos, events } = makeEnv();
  try {
    fs.rmSync(repos[1].plainDir, { recursive: true, force: true });
    const res = await srv._captureDataSnapshotImpl({ repoIds: ['data-docs'], selections: { 'data-docs': ['sub'] }, destination: path.join(dataDir, 's') }, env);
    assert.strictEqual(res.error, 'snapshot-source-missing');
    assert.strictEqual(res.repoId, 'data-docs');
    assert.deepStrictEqual(events, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
