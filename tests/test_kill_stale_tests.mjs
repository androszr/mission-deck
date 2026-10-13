// tests/test_kill_stale_tests.mjs
// scripts/kill-stale-tests.js runs before every suite. Since parallel work
// lives in git worktrees it must kill only the test servers of ITS OWN tree -
// a second checkout's servers are somebody else's run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isOwnStaleTestServer } = require('../scripts/kill-stale-tests.js');

const ROOT = '/Users/example/mission-deck';

test('own absolute server.js with a port is a stale test server', () => {
  assert.equal(isOwnStaleTestServer(`4242 /usr/local/bin/node ${ROOT}/server.js 3499`, ROOT), true);
});

test('another tree (a worktree or another checkout) is left alone', () => {
  assert.equal(isOwnStaleTestServer('4242 node /tmp/other/server.js 3499', ROOT), false);
  assert.equal(isOwnStaleTestServer(`4242 node ${ROOT}/.claude/worktrees/x/server.js 3101`, ROOT), false);
});

test('the legacy relative shape `server.js <port>` still qualifies', () => {
  assert.equal(isOwnStaleTestServer('4242 node server.js 3499', ROOT), true);
});

test('kb-mcp-server is never a test server', () => {
  assert.equal(isOwnStaleTestServer(`4242 node ${ROOT}/scripts/kb-mcp-server.js 3499`, ROOT), false);
});
