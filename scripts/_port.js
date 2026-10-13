'use strict';
// scripts/_port.js
// Single source of truth for the server port used by the npm lifecycle scripts.
// Resolution order: process.env.PORT -> PORT= line in .env -> 3001.
// Kept dependency-free so kill-port.js / stop-server.js can run before npm install.
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 3001;

function resolvePort() {
  const fromEnv = parseInt(process.env.PORT, 10);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = envText.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (m) {
      const p = parseInt(m[1], 10);
      if (Number.isInteger(p) && p > 0) return p;
    }
  } catch { /* no .env yet */ }
  return DEFAULT_PORT;
}

/**
 * PIDs LISTENING on `port` in `netstat -ano` output (Windows).
 *
 * A bare `findstr :3001` also matches rows whose FOREIGN address is :3001 -
 * every browser tab and curl talking to the server - and ports 30010-30019,
 * and the last column of such a row is the CLIENT's pid, which `taskkill /F`
 * then kills. Only TCP rows carry a state column and only a LISTENING row
 * with the port in its LOCAL address is the server.
 * @param {string} output raw netstat text
 * @param {number|string} port
 * @returns {string[]} unique pids, never "0"
 */
function listeningPidsFromNetstat(output, port) {
  const re = new RegExp('^\\s*TCP\\s+\\S+:' + String(port) + '\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$', 'i');
  const pids = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.match(re);
    if (m && m[1] !== '0') pids.add(m[1]);
  }
  return [...pids];
}

function pidFilePath(port) {
  return path.join(__dirname, '..', 'data', `server-${port}.pid`);
}

module.exports = { resolvePort, pidFilePath, listeningPidsFromNetstat, DEFAULT_PORT };
