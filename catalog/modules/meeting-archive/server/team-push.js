'use strict';
// modules/meeting-archive/server/team-push.js
// "Send it to the team now": runs the core's scoped push of THIS module's
// files (meeting-archive/) in data-tier-0 over loopback SSE -
//   GET /api/data/data-tier-0/push-stream?module=meeting-archive
// The core does the pull, the per-file encryption, the commit and the push
// under its own locks; this file only reads the outcome. Never throws.

const http = require('http');

const REPO_ID = 'data-tier-0';
const MODULE_ID = 'meeting-archive';
const PUSH_TIMEOUT_MS = 5 * 60 * 1000;
const LIVE_SERVER_PORT = 3001;

function serverPort() {
  return parseInt(process.env.PORT, 10) || LIVE_SERVER_PORT;
}

/**
 * Parse an SSE body into [{event, data}].
 * @param {string} text
 * @returns {{event: string, data: any}[]}
 */
function parseSse(text) {
  const out = [];
  for (const block of String(text || '').split(/\n\n+/)) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    let parsed;
    try { parsed = JSON.parse(data.join('\n')); } catch { parsed = data.join('\n'); }
    out.push({ event, data: parsed });
  }
  return out;
}

/**
 * Outcome of one push run from its events.
 * @param {{event: string, data: any}[]} events
 * @param {number} status HTTP status
 * @param {any} body JSON body of a non-SSE answer
 * @returns {{ok: boolean, error?: string, message?: string, files?: number}}
 */
function pushOutcome(events, status, body) {
  if (status !== 200) {
    const code = (body && body.error) || ('http-' + status);
    return { ok: false, error: code, message: (body && body.message) || '' };
  }
  const done = events.find((e) => e.event === 'done');
  const err = events.find((e) => e.event === 'error');
  if (done && done.data && done.data.ok !== false) {
    const d = done.data;
    const files = Number(d.files) || (d.counts ? (Number(d.counts.files_added) || 0) + (Number(d.counts.files_removed) || 0) : undefined);
    return { ok: true, message: d.message || '', files };
  }
  const src = (done && done.data) || (err && err.data) || {};
  return { ok: false, error: src.error || 'push-failed', message: src.message || '' };
}

/**
 * @param {{port?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, error?: string, message?: string, files?: number}>}
 */
function pushModuleNow(opts) {
  const o = opts || {};
  const port = o.port || serverPort();
  // Under `node --test` nothing may reach the live server.
  if (process.env.NODE_TEST_CONTEXT && port === LIVE_SERVER_PORT) {
    return Promise.resolve({ ok: false, error: 'test-mode', message: '' });
  }
  const pathName = '/api/data/' + REPO_ID + '/push-stream?module=' + MODULE_ID;
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathName, headers: { Accept: 'text/event-stream' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; if (text.length > 4 * 1024 * 1024) text = text.slice(-1024 * 1024); });
      res.on('end', () => {
        let body = null;
        if (res.statusCode !== 200) { try { body = JSON.parse(text); } catch { body = null; } }
        resolve(pushOutcome(res.statusCode === 200 ? parseSse(text) : [], res.statusCode, body));
      });
      res.on('error', (e) => resolve({ ok: false, error: 'push-error', message: e.message }));
      // A connection cut mid-stream may close without 'end' or 'error'; a
      // promise that never settles would keep the write request open forever.
      res.on('close', () => { if (!res.complete) resolve({ ok: false, error: 'push-error', message: 'connection closed' }); });
    });
    req.setTimeout(o.timeoutMs || PUSH_TIMEOUT_MS, () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ ok: false, error: e.message === 'timeout' ? 'timeout' : 'push-error', message: e.message }));
  });
}

module.exports = { REPO_ID, MODULE_ID, parseSse, pushOutcome, pushModuleNow };
