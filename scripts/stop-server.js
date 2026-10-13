#!/usr/bin/env node
// Cross-platform: gracefully stop the cockpit server.
//
// The server can re-spawn itself as a *detached* child (settings restart /
// app update). A detached respawn loses its controlling terminal, so Ctrl+C
// never reaches it and it keeps holding the port. This script kills it
// reliably regardless of how it was started:
//   1. SIGTERM the PID in data/server-<port>.pid -> graceful exit handler.
//   2. Fallback: kill whatever still listens on the port.
const fs = require('fs');
const { execSync } = require('child_process');
const { resolvePort, pidFilePath, listeningPidsFromNetstat } = require('./_port');

const PORT = resolvePort();
const PID_FILE = pidFilePath(PORT);

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

let stopped = false;

try {
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  if (!isNaN(pid) && pid !== process.pid && alive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    const deadline = Date.now() + 3000;
    const waiter = new Int32Array(new SharedArrayBuffer(4));
    while (alive(pid) && Date.now() < deadline) {
      Atomics.wait(waiter, 0, 0, 100);
    }
    if (alive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }
    console.log(`Stopped server (PID ${pid}).`);
    stopped = true;
  }
} catch { /* no PID file - fall through to port kill */ }

try {
  if (process.platform === 'win32') {
    // Same parser as kill-port.js: LISTENING rows on the LOCAL port only.
    const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    for (const pid of listeningPidsFromNetstat(out, PORT)) {
      try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); stopped = true; } catch { /* gone */ }
    }
  } else {
    const out = execSync(`lsof -ti :${PORT} || true`, { encoding: 'utf8' }).trim();
    if (out) {
      execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
      stopped = true;
    }
  }
} catch { /* port was free */ }

try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }

console.log(stopped ? 'Server stopped.' : `No server running on port ${PORT}.`);
