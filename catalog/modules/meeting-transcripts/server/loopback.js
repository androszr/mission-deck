'use strict';
// modules/meeting-transcripts/server/loopback.js
// JSON calls to this Mission Deck's own server (127.0.0.1:PORT) - how the queue
// hands a finished transcript to the meeting-archive module. Never throws.

const http = require('http');

const LIVE_SERVER_PORT = 3001;

function serverPort() {
  return parseInt(process.env.PORT, 10) || LIVE_SERVER_PORT;
}

/**
 * @param {'GET'|'POST'} method
 * @param {string} urlPath e.g. /api/m/meeting-archive/publish
 * @param {object|null} body
 * @param {{port?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<{status: number, body: any, error?: string}>}
 */
function request(method, urlPath, body, opts) {
  const o = opts || {};
  const port = o.port || serverPort();
  // Under `node --test` nothing may reach the live server.
  if (process.env.NODE_TEST_CONTEXT && port === LIVE_SERVER_PORT) {
    return Promise.resolve({ status: 0, body: null, error: 'test-mode' });
  }
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.setTimeout(o.timeoutMs || 10 * 60 * 1000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, body: null, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { request, serverPort };
