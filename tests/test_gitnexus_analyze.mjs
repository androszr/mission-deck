// tests/test_gitnexus_analyze.mjs
// How this repo invokes `gitnexus analyze`. The flags here are not tuning:
// --index-only is what keeps a reindex out of everybody's `git status`, and
// dropping it silently reintroduces the generated-file churn it exists to
// stop. That is exactly the kind of regression a comment cannot prevent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GA = require('../scripts/_gitnexus-analyze.js');

function tmpdir(withGit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnxa-'));
  if (withGit) fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

test('analyzeCliArgs: always passes --index-only', () => {
  const dir = tmpdir(true);
  try {
    const args = GA.analyzeCliArgs(dir);
    assert.deepEqual(args, ['analyze', '--index-only']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('analyzeCliArgs: adds --skip-git only without a .git directory', () => {
  const bare = tmpdir(false);
  const repo = tmpdir(true);
  try {
    assert.deepEqual(GA.analyzeCliArgs(bare), ['analyze', '--index-only', '--skip-git']);
    assert.ok(!GA.analyzeCliArgs(repo).includes('--skip-git'));
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('analyzeInvocation: both routes carry --index-only', () => {
  // The bootstrapper and the "Zaktualizuj mape" button go through this one
  // function precisely so they cannot disagree about the flags.
  const dir = tmpdir(true);
  try {
    const viaCli = GA.analyzeInvocation(dir);
    assert.equal(viaCli.via, 'cli');
    assert.ok(viaCli.args.includes('--index-only'));

    fs.mkdirSync(path.join(dir, '.gitnexus'));
    fs.writeFileSync(path.join(dir, '.gitnexus', 'run.cjs'), '');
    const viaRunner = GA.analyzeInvocation(dir);
    assert.equal(viaRunner.via, 'runner');
    assert.ok(viaRunner.args.includes('--index-only'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the analyze environment still carries both caps', () => {
  // server.js is past the analyzer's 512 KB default; without these two the
  // index is green and empty. Unrelated to --index-only, pinned here because
  // this is now the file's test.
  assert.equal(GA.ANALYZE_ENV.GITNEXUS_MAX_FILE_SIZE, GA.MAX_FILE_SIZE);
  assert.equal(GA.ANALYZE_ENV.GITNEXUS_WORKER_SUB_BATCH_TIMEOUT_MS, GA.WORKER_TIMEOUT_MS);
  assert.ok(Number(GA.MAX_FILE_SIZE) >= 4096);
});

test('CLI_VERSION is a plain pinned version', () => {
  assert.match(GA.CLI_VERSION, /^\d+\.\d+\.\d+$/);
});
