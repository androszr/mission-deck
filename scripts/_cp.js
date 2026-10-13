'use strict';
// The one place child processes get their Windows defaults. Required by
// server.js before anything else that touches child_process.
//
// On Windows a console child INHERITS its parent's console and opens no
// window of its own. The in-app restart (`_spawnRestartChild` in server.js)
// respawns the server with `detached: true`, which is DETACHED_PROCESS: the
// new server has no console at all, and from then on every git/npm/python
// child spawned without `windowsHide: true` gets a brand-new VISIBLE console
// window - one per process, cascaded across the screen for as long as the
// child runs (2026-09-14, from a screenshot: five empty frames over VS Code,
// two `git` per installed module from GET /api/modules/updates).
//
// The first fix was a wrapper local to server.js. That covered server.js and
// nothing else: scripts/_module-git.js, every modules/<id>/server/*.js and
// any dependency loaded in-process do their own `require('child_process')`
// and got the bare functions. So this module patches the child_process
// EXPORTS in place, once, before those files are required - a module author
// writing `const { execFile } = require('child_process')` gets the hidden
// console without knowing the rule exists. An explicit `windowsHide: false`
// at a call site still wins (the caller's options are spread last).
//
// Three things the patch cannot do, written down so nobody looks for them here:
//   - `detached: true` on Windows defeats it. CREATE_NO_WINDOW (what
//     windowsHide sets) is IGNORED next to DETACHED_PROCESS, so the child has
//     no console and ITS children open visible ones. Use
//     `detached: process.platform !== 'win32'` unless the child must outlive
//     the server (the restart child is the one such case). The
//     `detached-on-win32` rule in scripts/check-conventions.js says so.
//   - an INHERITED stdio fd defeats it just as quietly, and this one looks
//     harmless at the call site. libuv adds CREATE_NO_WINDOW only when no
//     stdio slot is UV_INHERIT_FD ("Avoid creating console window if stdio is
//     not inherited", src/win/process.c), so `stdio: 'inherit'` - or a bare
//     numeric fd, or `process.stdout` - drops the flag however this module
//     sets it. Pipe and forward instead; server.js `_spawnNpmInstall` is the
//     worked example and the `stdio-inherit-in-process` rule in
//     scripts/check-conventions.js is the gate.
//   - a child spawned by a SEPARATE process (a worker script, Playwright's
//     own launcher inside one) inherits that process's hidden console, which
//     is fine - but its options are its own, and a `detached` there is the
//     same trap one level down.
//
// Everywhere else (macOS, Linux) libuv ignores windowsHide, so the patch is a
// no-op and the unit suite runs the same code on every platform.

const cp = require('child_process');

const PATCHED = Symbol.for('cockpit.child_process.windowsHide');

/**
 * Puts `windowsHide: true` into the options of one child_process call,
 * whatever shape the call has: `(cmd, args, opts)`, `(cmd, opts)`,
 * `(cmd, args, cb)`, `(cmd, cb)`, `(cmd)`. An options object the caller
 * passed keeps every key it has - including an explicit windowsHide.
 * @param {any[]} args the call's arguments (mutated and returned)
 * @returns {any[]}
 */
function injectWindowsHide(args) {
  for (let i = args.length - 1; i >= 1; i--) {
    const a = args[i];
    if (a && typeof a === 'object' && !Array.isArray(a) && typeof a !== 'function') {
      args[i] = { windowsHide: true, ...a };
      return args;
    }
  }
  const cbIdx = args.findIndex((a, i) => i >= 1 && typeof a === 'function');
  const opts = { windowsHide: true };
  if (cbIdx >= 1) args.splice(cbIdx, 0, opts); else args.push(opts);
  return args;
}

// Every entry point is patched directly rather than relying on one routing
// into another: inside Node `exec` calls the module-LOCAL `execFile`, `fork`
// the module-local `spawn`, and `execSync`/`execFileSync` the local spawnSync,
// so a patch on the export is invisible to them. Measured on Node 24: with
// only `spawn` patched, `fork` still arrived at ChildProcess.prototype.spawn
// with `windowsHide: false`. A second injection over an options object that
// already carries windowsHide changes nothing, so listing all seven is safe.
//
// `fork` is listed to close `fork(mod, { silent: true })` and to keep the
// default from being a silent trap - but it is NOT fully covered, and the
// reason is the inherited-fd rule above: a default `fork()` sets its own
// stdio to `[0, 1, 2, 'ipc']` (measured), every one of those an inherited fd,
// so libuv drops CREATE_NO_WINDOW no matter what windowsHide says. A `fork`
// from the server process on Windows therefore needs `silent: true` (pipes)
// to be windowless. Nothing in the core or in an installed module forks today.
const METHODS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'];

if (!cp[PATCHED]) {
  for (const name of METHODS) {
    const original = cp[name];
    const wrapped = (...a) => original.apply(cp, injectWindowsHide(a));
    Object.defineProperty(wrapped, 'name', { value: name });
    cp[name] = wrapped;
  }
  cp[PATCHED] = true;
}

module.exports = {
  cp,
  PATCHED,
  injectWindowsHide,
  spawn: cp.spawn,
  spawnSync: cp.spawnSync,
  execFile: cp.execFile,
  execFileSync: cp.execFileSync,
  exec: cp.exec,
  execSync: cp.execSync,
  fork: cp.fork,
};
