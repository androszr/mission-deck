// tests/test_restart_handoff.mjs
// End-to-end test of the restart handoff PIPE, the one part of the mechanism a
// pure-helper test cannot reach: the write side ends with process.exit(0), so
// it only runs in a process of its own.
//
// Shape: this test spawns a PARENT process that loads server.js, puts a fake
// session plus a fake token into its module state (through the real
// _applyRestartHandoff), spawns a CHILD the way _spawnRestartChild does, and
// hands over with the real _handOffAndExit. The child reads with the real
// _readRestartHandoff and writes what it adopted to a JSON file.
//
// What it proves, and what nothing else does: the payload survives a parent
// that exits inside the write callback, and it never travels in the child's
// environment.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.js');
const SESSION = 'fake-session-key-not-a-real-one==';
const TOKEN_VALUE = 'figd-fake-handoff-value';

function childScript(outPath) {
  return `
const srv = require(${JSON.stringify(SERVER)});
(async () => {
  const raw = await srv._readRestartHandoff();
  const parsed = srv._parseRestartHandoff(raw);
  const applied = srv._applyRestartHandoff(parsed);
  require('fs').writeFileSync(${JSON.stringify(outPath)}, JSON.stringify({
    rawLength: raw.length,
    session: applied.session,
    secrets: applied.secrets,
    // The value has to be in the heap...
    figmaToken: process.env.FIGMA_TOKEN || null,
    // ...and the session must NOT be in the environment, or it would flow into
    // every git, PTY and Playwright child and land back in \`ps\` output.
    bwSessionInEnv: process.env.BW_SESSION || null,
  }));
  process.exit(0);
})();
`;
}

function parentScript(outPath) {
  return `
const { spawn } = require('child_process');
const srv = require(${JSON.stringify(SERVER)});
// Populate this process's vault state the way an unlock would, using the real
// apply path so _restartHandoffPayload() below builds a genuine payload.
srv._applyRestartHandoff(srv._parseRestartHandoff(JSON.stringify({
  v: srv.RESTART_HANDOFF_VERSION,
  bwSession: ${JSON.stringify(SESSION)},
  loadedSecrets: ['FIGMA_TOKEN'],
  secrets: { FIGMA_TOKEN: ${JSON.stringify(TOKEN_VALUE)} },
})));
const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript(outPath))}], {
  detached: true,
  stdio: ['pipe', 'ignore', 'ignore'],
  env: { ...srv._restartChildEnv(process.env), COCKPIT_RESTART_CHILD: '1' },
});
child.unref();
srv._handOffAndExit(child);
`;
}

function runParent(script) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', TEST_DISABLE_RESTART: '1' },
    });
    let stderr = '';
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stderr }));
  });
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      if (raw.trim()) return JSON.parse(raw);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`child never wrote ${file}`);
}

test('the handoff carries the session and the tokens across a real respawn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-handoff-'));
  const out = path.join(dir, 'adopted.json');
  try {
    const parent = await runParent(parentScript(out));
    assert.strictEqual(parent.code, 0, `parent exited ${parent.code}: ${parent.stderr}`);

    const adopted = await waitForFile(out, 10000);
    assert.strictEqual(adopted.session, true, 'child did not adopt the vault session');
    assert.deepStrictEqual(adopted.secrets, ['FIGMA_TOKEN']);
    assert.strictEqual(adopted.figmaToken, TOKEN_VALUE, 'the token value did not survive the pipe');
    // The property the whole design exists for: `ps eww` prints a process's
    // spawn-time environment to anyone on the same account, so the session key
    // must reach the child through the pipe and through nothing else.
    assert.strictEqual(adopted.bwSessionInEnv, null, 'BW_SESSION leaked into the child environment');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a restart child with nothing handed over boots locked instead of hanging', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-handoff-empty-'));
  const out = path.join(dir, 'adopted.json');
  try {
    // Same parent, minus the vault state: _restartHandoffPayload() returns ''
    // and the child gets EOF. This is every restart of a locked cockpit. (The
    // FIRST restart after this ships is a different shape - the old parent
    // still inherits its terminal onto fd 0 - and the isTTY guard in
    // _readRestartHandoff is what makes that one resolve immediately too.)
    const script = `
const { spawn } = require('child_process');
const srv = require(${JSON.stringify(SERVER)});
const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript(out))}], {
  detached: true,
  stdio: ['pipe', 'ignore', 'ignore'],
  env: { ...srv._restartChildEnv(process.env), COCKPIT_RESTART_CHILD: '1' },
});
child.unref();
srv._handOffAndExit(child);
`;
    const parent = await runParent(script);
    assert.strictEqual(parent.code, 0, `parent exited ${parent.code}: ${parent.stderr}`);

    const adopted = await waitForFile(out, 10000);
    assert.strictEqual(adopted.rawLength, 0);
    assert.strictEqual(adopted.session, false);
    assert.deepStrictEqual(adopted.secrets, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a normal start never reads stdin, so it cannot swallow the terminal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-handoff-normal-'));
  const out = path.join(dir, 'adopted.json');
  try {
    // No COCKPIT_RESTART_CHILD, and stdin left open on purpose: _readRestartHandoff
    // must resolve immediately rather than waiting on an operator's terminal.
    const p = spawn(process.execPath, ['-e', childScript(out)], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', COCKPIT_RESTART_CHILD: '' },
    });
    const started = Date.now();
    const code = await new Promise((resolve, reject) => {
      p.on('error', reject);
      p.on('close', resolve);
    });
    assert.strictEqual(code, 0);
    // The read-side guard is 1500 ms; resolving without touching stdin is well
    // under it even on a cold require.
    assert.ok(Date.now() - started < 1400, 'a normal start waited on stdin');
    const adopted = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.strictEqual(adopted.rawLength, 0);
    assert.strictEqual(adopted.session, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
