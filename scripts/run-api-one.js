#!/usr/bin/env node
// scripts/run-api-one.js
//
// Scoped single-api-file runner. Validates the file argument, pre-kills
// stale test servers, then delegates to run-with-timeout.js so exit 124
// (timeout) is propagated cleanly.
//
// Usage:
//   node scripts/run-api-one.js tests/test_api_infra.js
//   node scripts/run-api-one.js test_api_infra.js       (bare filename also accepted)
//
// Environment:
//   TEST_API_ONE_TIMEOUT_MS  Wall-clock cap in ms (default 120000).
//
// Exit codes:
//   0   child test suite passed
//   2   bad invocation (missing arg, file not found, not a test_api_ file)
//   124 timeout (propagated from run-with-timeout.js)
//   N   child exit code propagated unchanged

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const TESTS_DIR = path.resolve(__dirname, '..', 'tests');
const RUN_WITH_TIMEOUT = path.resolve(__dirname, 'run-with-timeout.js');
const KILL_STALE = path.resolve(__dirname, 'kill-stale-tests.js');

const DEFAULT_TIMEOUT_MS = 120000;

// --- arg validation --------------------------------------------------------

const rawArg = process.argv[2];

if (!rawArg) {
  process.stderr.write(
    'Usage: node scripts/run-api-one.js <test_api_file>\n' +
    'Examples:\n' +
    '  node scripts/run-api-one.js tests/test_api_infra.js\n' +
    '  node scripts/run-api-one.js test_api_infra.js\n',
  );
  process.exit(2);
}

// Accept bare filename or tests/<filename>
const basename = path.basename(rawArg);

// Accept test_api_* always, plus any known server-bound non-api files listed
// below. Reject pure-unit files (test_state.mjs etc.) — they belong to test:js,
// and running them here would apply a meaningless stale-server pre-kill + 120s
// cap that misrepresents this runner's contract.
const SERVER_BOUND_NON_API = new Set();

if (!basename.startsWith('test_api_') && !SERVER_BOUND_NON_API.has(basename)) {
  process.stderr.write(
    `[run-api-one] "${basename}" is not a supported api test file.\n` +
    'Only tests/test_api_* and known server-bound files are supported.\n' +
    'For pure-unit tests use: node --test tests/<file>\n',
  );
  process.exit(2);
}

const resolvedFile = path.resolve(TESTS_DIR, basename);

if (!fs.existsSync(resolvedFile)) {
  process.stderr.write(
    `[run-api-one] File not found: ${resolvedFile}\n`,
  );
  process.exit(2);
}

// --- pre-kill stale servers ------------------------------------------------

// npm pre* hooks do not fire for bare `node scripts/run-api-one.js` invocations,
// so we call kill-stale-tests.js directly here.
spawnSync(process.execPath, [KILL_STALE], { stdio: 'inherit' });

// --- run with timeout ------------------------------------------------------

const timeoutMs = Number(process.env.TEST_API_ONE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

const result = spawnSync(
  process.execPath,
  [RUN_WITH_TIMEOUT, String(timeoutMs), 'node', '--test', resolvedFile],
  { stdio: 'inherit' },
);

process.exit(result.status !== null ? result.status : 1);
