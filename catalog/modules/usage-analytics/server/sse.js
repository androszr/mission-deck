'use strict';
// modules/usage-analytics/server/sse.js
// SSE plumbing for GET /refresh-stream. Modules never import from other modules,
// so this is a local copy. Frame shape and the 25 s keepalive mirror
// server.js (sseEvent/sseOpen), so the client parses a module stream like a core one.
//
//
// Event vocabulary: 'progress' ({ percent, step }), 'log' ({ text }),
// 'done' ({ ...result }), 'error' ({ error, message }). A bare `: ping\n\n`
// comment every 25s keeps proxies/browsers from dropping the connection.

const PING_INTERVAL_MS = 25000;

/** Writes the SSE response headers. Call once, before any sseEvent(). */
function sseOpen(req, res) {
  if (req.socket && typeof req.socket.setTimeout === 'function') req.socket.setTimeout(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function sseEvent(res, eventType, data) {
  if (res.writableEnded) return;
  res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

let _opSeq = 0;

/** A fresh operation id: process-unique, carried by every event of one stream. */
function newOpId() {
  _opSeq += 1;
  return `${Date.now().toString(36)}-${process.pid}-${_opSeq}`;
}

/**
 * Opens the stream, starts the keepalive ping, and guarantees cleanup on
 * every exit path (req 'close', normal return, thrown error). Every event
 * carries the operation id (`opId`), and a client that disconnects before
 * the work is done ABORTS it through `helpers.signal` - the work must then
 * stop (spawn.js honours the signal) and never restart on its own: the
 * client side (client/progress-stream.js) closes its EventSource rather than
 * letting it reconnect, because a reconnect is a NEW request and would start
 * a second build.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {(helpers: {log: Function, progress: Function, signal: AbortSignal, opId: string}) => Promise<object>} fn
 *   runs the actual work; its resolved value is sent as `done` when
 *   `result.ok` is true, `error` otherwise. A thrown error becomes an
 *   `error` event too - the stream never leaves an open connection hanging.
 */
async function runSseStream(req, res, fn, opts) {
  const opId = (opts && opts.opId) || newOpId();
  sseOpen(req, res);
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, PING_INTERVAL_MS);
  const controller = new AbortController();
  let finished = false;
  const onClose = () => {
    clearInterval(keepAlive);
    if (!finished) controller.abort();
  };
  req.on('close', onClose);

  const log = (text) => sseEvent(res, 'log', { text, opId });
  const progress = (percent, step, phase) => sseEvent(res, 'progress', { percent, step, ...(phase ? { phase } : {}), opId });
  sseEvent(res, 'start', { opId });

  try {
    const result = await fn({ log, progress, signal: controller.signal, opId });
    finished = true;
    if (result && result.ok) sseEvent(res, 'done', { ...result, opId });
    else sseEvent(res, 'error', { ...(result || { error: 'error', message: 'Unknown error.' }), opId });
  } catch (err) {
    finished = true;
    sseEvent(res, 'error', { error: 'error', message: err && err.message ? err.message : String(err), opId });
  } finally {
    clearInterval(keepAlive);
    req.removeListener('close', onClose);
    if (!res.writableEnded) res.end();
  }
}

module.exports = { sseOpen, sseEvent, runSseStream, newOpId, PING_INTERVAL_MS };
