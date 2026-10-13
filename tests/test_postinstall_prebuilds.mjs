// tests/test_postinstall_prebuilds.mjs
// Unit tests for scripts/postinstall.js: foreignPrebuildDirs, the pure
// function that decides which node-pty prebuild directories to delete.
// Pure, no server, no disk access (node --test).

import { createRequire } from 'node:module';
import assert from 'node:assert';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { foreignPrebuildDirs } = require('../scripts/postinstall.js');

test('macOS keeps both darwin-* entries and marks both win32-* entries foreign', () => {
  const entries = ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'];
  const result = foreignPrebuildDirs(entries, 'darwin');
  assert.deepStrictEqual(result.sort(), ['win32-arm64', 'win32-x64']);
});

test('Windows keeps both win32-* entries and marks both darwin-* entries foreign', () => {
  const entries = ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'];
  const result = foreignPrebuildDirs(entries, 'win32');
  assert.deepStrictEqual(result.sort(), ['darwin-arm64', 'darwin-x64']);
});

test('an entry name with no dash is never marked foreign', () => {
  const entries = ['darwin-arm64', 'unrecognized'];
  const result = foreignPrebuildDirs(entries, 'darwin');
  assert.deepStrictEqual(result, []);
});

test('an empty list produces an empty list', () => {
  assert.deepStrictEqual(foreignPrebuildDirs([], 'darwin'), []);
});

test('an already-filtered list produces an empty list (idempotent)', () => {
  const entries = ['darwin-arm64', 'darwin-x64'];
  assert.deepStrictEqual(foreignPrebuildDirs(entries, 'darwin'), []);
});
