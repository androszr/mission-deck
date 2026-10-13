'use strict';
// tests/_api_helper.js
// Shared spawn/poll/fetch plumbing for the tests/test_api_*.js suites.
//
// Every api test spawns its OWN server on a dedicated port so the suites never
// collide with the developer's dev server. The port arg is passed on argv (as
// `node server.js <PORT>`) because scripts/kill-stale-tests.js identifies stale
// test servers by exactly that shape; NODE_ENV=test is what actually puts the
// server in test mode (no browser auto-open, no auto-update, no sync loop).

const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');

function startServer(port, extraEnv) {
  const child = spawn(process.execPath, [SERVER, String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      TEST_DISABLE_RESTART: '1',
      ...(extraEnv || {}),
    },
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/app/version`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`server on port ${port} did not start within ${timeoutMs} ms`);
    await new Promise(r => setTimeout(r, 150));
  }
}

async function stopServer(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 4000);
    child.on('exit', () => { clearTimeout(t); resolve(); });
  });
}

function apiUrl(port, p) {
  return `http://127.0.0.1:${port}${p}`;
}

async function getJson(port, p) {
  const r = await fetch(apiUrl(port, p), { signal: AbortSignal.timeout(20000) });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  return { status: r.status, headers: r.headers, body };
}

async function postJson(port, p, payload, extraHeaders) {
  const r = await fetch(apiUrl(port, p), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(payload === undefined ? {} : payload),
    signal: AbortSignal.timeout(20000),
  });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  return { status: r.status, headers: r.headers, body };
}

async function putJson(port, p, payload, extraHeaders) {
  const r = await fetch(apiUrl(port, p), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(payload === undefined ? {} : payload),
    signal: AbortSignal.timeout(20000),
  });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  return { status: r.status, headers: r.headers, body };
}

module.exports = { startServer, waitForServer, stopServer, apiUrl, getJson, postJson, putJson, ROOT };
