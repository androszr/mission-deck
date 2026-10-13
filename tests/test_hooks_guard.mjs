// tests/test_hooks_guard.mjs
// Unit tests for the pure functions behind the git hooks:
// scripts/prepare.js (shouldSetHooksPath) and
// scripts/hook-lint-staged.js (shouldBlockCommit).
// Pure, no server, no git, no disk access (node --test).

import { createRequire } from 'node:module';
import assert from 'node:assert';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { shouldSetHooksPath } = require('../scripts/prepare.js');
const { shouldBlockCommit } = require('../scripts/hook-lint-staged.js');

test('shouldSetHooksPath is true when both .git and .husky exist', () => {
  assert.strictEqual(shouldSetHooksPath({ hasGitDir: true, hasHooksDir: true }), true);
});

test('shouldSetHooksPath is false when .git is missing', () => {
  assert.strictEqual(shouldSetHooksPath({ hasGitDir: false, hasHooksDir: true }), false);
});

test('shouldSetHooksPath is false when .husky is missing', () => {
  assert.strictEqual(shouldSetHooksPath({ hasGitDir: true, hasHooksDir: false }), false);
});

test('shouldBlockCommit never blocks when lint-staged is installed', () => {
  assert.strictEqual(shouldBlockCommit(['server.js', 'README.md'], true), false);
});

test('shouldBlockCommit blocks a staged .js file when lint-staged is missing', () => {
  assert.strictEqual(shouldBlockCommit(['js/app.js'], false), true);
});

test('shouldBlockCommit does not block a docs-only commit when lint-staged is missing', () => {
  assert.strictEqual(shouldBlockCommit(['docs/troubleshooting.md', 'README.md'], false), false);
});

test('shouldBlockCommit does not block an empty staged list', () => {
  assert.strictEqual(shouldBlockCommit([], false), false);
});

// Fail-closed cases: an unreadable staged list must not be mistaken for an
// empty one, or the gate would open exactly when it cannot see what it guards.
test('shouldBlockCommit blocks when the staged list could not be read', () => {
  assert.strictEqual(shouldBlockCommit([], false, true), true);
});

test('a read failure still does not block when lint-staged is installed', () => {
  assert.strictEqual(shouldBlockCommit([], true, true), false);
});
