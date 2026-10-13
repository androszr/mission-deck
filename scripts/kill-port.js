#!/usr/bin/env node
// Cross-platform: kill any process listening on the cockpit port before server start.
// Port comes from PORT env / .env (default 3001) so this cockpit never touches
// another cockpit running on 3000.
const { execSync } = require('child_process');
const { resolvePort, listeningPidsFromNetstat } = require('./_port');
const PORT = resolvePort();

try {
  if (process.platform === 'win32') {
    // findstr is only a pre-filter; the parser keeps LISTENING rows whose
    // LOCAL address is :PORT, so a browser talking to the server survives.
    const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    for (const pid of listeningPidsFromNetstat(out, PORT)) {
      try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
    }
  } else {
    execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  }
} catch { /* port was free */ }
