// tests/test_cp.mjs
// scripts/_cp.js - the one place child processes get windowsHide:true. The
// server used to carry a wrapper of its own that covered server.js alone;
// scripts/_module-git.js and every modules/<id>/server/*.js did their own
// require('child_process') and, on a server restarted through the API (no
// console on Windows), opened one console window per git child. So the
// module patches child_process's EXPORTS in place, and that is what these
// tests pin: the injection shapes, the patch itself, and that a caller's own
// options still win.

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CP = require(path.join(ROOT, 'scripts', '_cp.js'));

test('injectWindowsHide covers every call shape and never overrides an explicit value', () => {
  assert.deepStrictEqual(CP.injectWindowsHide(['git', ['status']]), ['git', ['status'], { windowsHide: true }]);
  assert.deepStrictEqual(CP.injectWindowsHide(['git']), ['git', { windowsHide: true }]);
  assert.deepStrictEqual(CP.injectWindowsHide(['git', { cwd: '/x' }]), ['git', { windowsHide: true, cwd: '/x' }]);
  assert.deepStrictEqual(
    CP.injectWindowsHide(['git', ['status'], { cwd: '/x', detached: true }]),
    ['git', ['status'], { windowsHide: true, cwd: '/x', detached: true }],
  );
  // The caller's own windowsHide wins - a GUI child somebody wants visible.
  assert.deepStrictEqual(CP.injectWindowsHide(['app', { windowsHide: false }]), ['app', { windowsHide: false }]);
  // A callback with no options gets the options object inserted before it.
  const cb = () => {};
  assert.deepStrictEqual(CP.injectWindowsHide(['git', ['status'], cb]), ['git', ['status'], { windowsHide: true }, cb]);
  assert.deepStrictEqual(CP.injectWindowsHide(['git', cb]), ['git', { windowsHide: true }, cb]);
  // The command itself is never mistaken for options, even when it is index 0.
  assert.deepStrictEqual(CP.injectWindowsHide([{ notACommand: true }]), [{ notACommand: true }, { windowsHide: true }]);
});

test('child_process exports are patched in place, once, and a bare require sees the patch', () => {
  assert.strictEqual(childProcess[CP.PATCHED], true);
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    assert.strictEqual(childProcess[name], CP[name], name + ' is the patched function on the module');
    assert.strictEqual(childProcess[name].name, name);
  }
  // A second require (the module cache makes it the same instance, but a
  // fresh load through a different key must not wrap the wrappers).
  const before = childProcess.spawn;
  delete require.cache[require.resolve(path.join(ROOT, 'scripts', '_cp.js'))];
  require(path.join(ROOT, 'scripts', '_cp.js'));
  assert.strictEqual(childProcess.spawn, before, 'PATCHED symbol stops a double wrap');
});

test('a spawn through the patched module still runs and hands the child the injected option', () => {
  // The injected option is not visible on the result, so observe the effect
  // on the call shapes instead: with options, with no options at all (the
  // injection appends an object) and with a callback in the options slot.
  const r = childProcess.spawnSync(process.execPath, ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8' });
  assert.strictEqual(r.stdout, 'ok');
  const bare = childProcess.spawnSync(process.execPath, ['-e', 'process.exit(3)']);
  assert.strictEqual(bare.status, 3);
  return new Promise((resolve, reject) => {
    childProcess.execFile(process.execPath, ['-e', 'process.stdout.write("cb")'], (err, out) => {
      if (err) return reject(err);
      assert.strictEqual(String(out), 'cb');
      resolve();
    });
  });
});

test('fork is patched, and the injection lands in the options slot fork accepts', () => {
  // fork was left out of METHODS at first on the theory that it routes through
  // the patched `spawn`. It does not - inside Node it calls the module-LOCAL
  // spawn, so with only `spawn` patched a fork arrived at
  // ChildProcess.prototype.spawn with windowsHide:false (measured, Node 24).
  assert.strictEqual(childProcess.fork, CP.fork, 'fork is the patched function on the module');
  assert.strictEqual(childProcess.fork.name, 'fork');
  // fork(modulePath) -> the options object is appended; Node normalizes a
  // second argument that is a plain object into `options`, so this is the
  // shape fork already accepts rather than an args array.
  assert.deepStrictEqual(CP.injectWindowsHide(['mod.js']), ['mod.js', { windowsHide: true }]);
  // fork(modulePath, args) -> the array is not mistaken for options.
  assert.deepStrictEqual(CP.injectWindowsHide(['mod.js', ['--flag']]), ['mod.js', ['--flag'], { windowsHide: true }]);
  // fork(modulePath, args, options) -> merged, caller's keys kept.
  assert.deepStrictEqual(
    CP.injectWindowsHide(['mod.js', ['--flag'], { silent: true }]),
    ['mod.js', ['--flag'], { windowsHide: true, silent: true }],
  );
});
