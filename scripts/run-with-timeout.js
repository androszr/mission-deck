#!/usr/bin/env node
// scripts/run-with-timeout.js
//
// Pure-Node, cross-platform wall-clock timeout wrapper.
// Usage: node scripts/run-with-timeout.js <ms> <command> [args...]
//
// Spawns <command> [args...], pipes stdio through, arms a timer for <ms> ms.
// On timeout: kills the entire child process group (posix) or tree (win32),
//   prints "[run-with-timeout] TIMEOUT after <ms>ms — killed" to stderr,
//   exits 124.
// On normal completion: exits with the child's exit code (propagates non-124
//   failures unchanged so callers can reliably treat 124 as "timeout -> partial,
//   continue" and any other non-zero as a real failure).
//
// Exit codes:
//   0   child succeeded
//   1   child crashed / signal / command-not-found (not 124 — avoids collision)
//   2   bad invocation (usage error)
//   N   child exited with code N (N != 124 preserved faithfully)
//   124 timeout (matches GNU `timeout` convention)

'use strict';

const { spawn, spawnSync } = require('child_process');

// --- arg validation --------------------------------------------------------

const rawMs = process.argv[2];
const command = process.argv[3];
const args = process.argv.slice(4);

if (!rawMs || !command) {
  process.stderr.write('Usage: node scripts/run-with-timeout.js <ms> <command> [args...]\n');
  process.exit(2);
}

const cap = Number(rawMs);
if (!Number.isInteger(cap) || cap <= 0) {
  process.stderr.write(`[run-with-timeout] Invalid timeout "${rawMs}" — must be a positive integer (ms)\n`);
  process.exit(2);
}

// --- spawn -----------------------------------------------------------------

// detached on posix so we can kill the whole process group with -pid
const isWin = process.platform === 'win32';

const child = spawn(command, args, {
  stdio: 'inherit',
  detached: !isWin,
});

// --- timeout handler -------------------------------------------------------

function onTimeout() {
  process.stderr.write(`[run-with-timeout] TIMEOUT after ${cap}ms — killed\n`);

  if (isWin) {
    // taskkill /T kills the whole child tree
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    // Negative pid targets the process group (requires detached spawn above)
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { /* already dead */ }
  }

  process.exit(124);
}

const timer = setTimeout(onTimeout, cap);
// Unref so the timer itself never keeps the wrapper alive if the child exits first
timer.unref();

// --- forward signals so Ctrl-C cascades ------------------------------------

function forwardSignal(sig) {
  try {
    if (isWin) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, sig);
    }
  } catch (_) { /* already dead */ }
}

process.on('SIGINT',  () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

// --- normal completion -----------------------------------------------------

child.on('error', (err) => {
  clearTimeout(timer);
  process.stderr.write(`[run-with-timeout] Failed to start "${command}": ${err.message}\n`);
  // Use exit code 1 (not 124) so callers don't misread this as a timeout
  process.exit(1);
});

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (signal) {
    // Child was killed by a signal (e.g. SIGKILL from our onTimeout —
    // but that path calls process.exit(124) directly so we should not reach
    // here in the timeout branch). Use 1 as a safe generic failure code.
    process.exit(1);
  }
  // Propagate the child's exit code faithfully (including non-zero).
  // If somehow the child exited with 124, propagate it — it is the child's
  // own semantic and the wrapping layer is not involved.
  process.exit(code !== null ? code : 1);
});
