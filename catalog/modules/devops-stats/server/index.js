'use strict';
// modules/devops-stats/server/index.js
// register(ctx), mounted under /api/m/devops-stats/. Four routes:
//   GET  /overview        index.json + storage + config + jira_url (always 200)
//   GET  /issues          every stored fact, [] when storage is unavailable
//   POST /config          saves blocked_status_ids and/or cancelled_status_ids
//                         (validated against the index; a key left out keeps its saved value)
//   GET  /refresh-stream  SSE: runs the Node ETL child and merges its output
//
// Nothing here touches fs or spawns at register() time. store.js owns every
// write into jira/devops/; refresh-job.js runs the ETL child; sse.js is the
// SSE plumbing. The pure fact validator lives in scripts/_extract.mjs (ESM)
// and is loaded lazily with import().

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const store = require('./store.js');
const refreshJob = require('./refresh-job.js');
const sse = require('./sse.js');

const REFUSAL_MESSAGES = {
  'test-mode': 'Refresh is disabled in test mode.',
  'busy': 'A refresh is already running - wait for it to finish.',
  'no-token': 'No Jira token - unlock the Bitwarden vault in Settings.',
  'data-missing': 'The team data source is not cloned - pull it in the Sync window.',
};
const DAY_MS = 24 * 60 * 60 * 1000;

let _extractPromise = null;
function loadExtract() {
  if (!_extractPromise) _extractPromise = import(pathToFileURL(path.join(__dirname, '..', 'scripts', '_extract.mjs')).href);
  return _extractPromise;
}

function _cleanupOut(outPath) {
  try { fs.unlinkSync(outPath); } catch { /* already gone, or never written */ }
}

function _jiraUrl() {
  return (process.env.JIRA_URL || 'https://jira.example.com').replace(/\/$/, '');
}

module.exports = function register(ctx) {
  const lock = ctx.makeLock();
  let running = false;

  // -- GET /overview ----------------------------------------------------------
  function handleOverview(_req, res) {
    const dir = store.teamDataDir(ctx);
    const storage = store.storageState(dir);
    ctx.jsonResponse(res, 200, {
      storage,
      index: storage === 'ok' ? store.readIndex(dir) : null,
      config: storage === 'ok' ? store.readConfig(dir) : { blocked_status_ids: [], cancelled_status_ids: null },
      jira_url: _jiraUrl(),
    });
  }

  // -- GET /issues --------------------------------------------------------------
  function handleIssues(_req, res) {
    const dir = store.teamDataDir(ctx);
    const issues = store.storageState(dir) === 'ok' ? store.readAllIssues(dir) : [];
    ctx.jsonResponse(res, 200, { issues });
  }

  // -- POST /config -------------------------------------------------------------
  async function handleConfig(req, res) {
    let body;
    try {
      body = await ctx.readBody(req, 4096);
    } catch {
      return ctx.jsonResponse(res, 400, { error: 'bad-body', message: 'Invalid request body.' });
    }
    const hasBlocked = !!body && Object.prototype.hasOwnProperty.call(body, 'blocked_status_ids');
    const hasCancelled = !!body && Object.prototype.hasOwnProperty.call(body, 'cancelled_status_ids');
    if (!hasBlocked && !hasCancelled) {
      return ctx.jsonResponse(res, 400, { error: 'bad-body', message: 'No status list to save.' });
    }
    const dir = store.teamDataDir(ctx);
    if (store.storageState(dir) !== 'ok') {
      return ctx.jsonResponse(res, 409, { error: 'storage-unavailable', message: 'The team data source is not cloned.' });
    }
    const index = store.readIndex(dir);
    const statuses = index ? index.statuses : [];
    const known = new Set(statuses.map((s) => String(s.id)));
    const done = new Set(statuses.filter((s) => s.category === 'done').map((s) => String(s.id)));
    const bad = (ids, allowed) => !Array.isArray(ids) || ids.length > 50 || ids.some((x) => typeof x !== 'string' || !allowed.has(x));
    if (hasBlocked && bad(body.blocked_status_ids, known)) {
      return ctx.jsonResponse(res, 400, { error: 'bad-status', message: 'Unknown blocked status - refresh the data from Jira and try again.' });
    }
    // A cancellation is an END of the work, so only a done-category status may carry it.
    if (hasCancelled && bad(body.cancelled_status_ids, done)) {
      return ctx.jsonResponse(res, 400, { error: 'bad-status', message: 'A cancelled status must be a Jira done status - refresh the data and try again.' });
    }
    const config = await lock(() => {
      const prev = store.readConfig(dir);
      return store.writeConfig(dir, {
        blocked_status_ids: hasBlocked ? [...new Set(body.blocked_status_ids)] : prev.blocked_status_ids,
        cancelled_status_ids: hasCancelled ? [...new Set(body.cancelled_status_ids)] : prev.cancelled_status_ids,
      });
    });
    return ctx.jsonResponse(res, 200, { config });
  }

  // -- GET /refresh-stream[?full=1] ---------------------------------------------
  async function _runRefresh(full, helpers) {
    const { log, progress } = helpers;
    const dir = store.teamDataDir(ctx);
    const index = store.readIndex(dir);
    const sinceMs = index && index.generated_at ? Date.parse(index.generated_at) : NaN;
    const mode = (full || !index || !Number.isFinite(sinceMs)) ? 'full' : 'incremental';
    const since = mode === 'incremental' ? new Date(sinceMs - DAY_MS).toISOString() : null;
    log('DEVOPS Stats refresh started (' + (mode === 'full' ? 'full fetch' : 'changes since ' + since) + ').');

    fs.mkdirSync(ctx.dataDir, { recursive: true });
    const outPath = path.join(ctx.dataDir, 'etl-devops-' + process.pid + '.json');
    try {
      const result = await refreshJob.runEtlStage({
        args: refreshJob.etlArgs(mode, since, outPath),
        handoff: refreshJob.handoffLine(process.env),
        cwd: ctx.rootDir,
        signal: helpers.signal,
        onLine: (line) => {
          const parsed = refreshJob.parseProgressLine(line);
          if (parsed) progress(parsed.pct || 0, parsed.msg || 'DEVOPS');
          else log(line);
        },
      });
      if (!result.ok) {
        return { ok: false, error: 'etl-failed', message: 'Fetching from Jira failed (code ' + result.code + ').', tail: result.tail };
      }
      const etlOut = store.readEtlOut(outPath);
      if (!etlOut) {
        return { ok: false, error: 'etl-failed', message: 'Missing or invalid output file.', tail: result.tail };
      }
      const { validateFact } = await loadExtract();
      const errors = [];
      for (const fact of etlOut.issues) errors.push(...validateFact(fact));
      if (errors.length) {
        log('Invalid data, nothing saved.');
        return { ok: false, error: 'etl-invalid', message: 'The Jira data failed validation - nothing saved.', tail: errors.slice(0, 10) };
      }
      const merged = await lock(() => store.mergeIssues(dir, etlOut.issues, {
        mode, generated_at: etlOut.generated_at, lookback_days: etlOut.lookback_days,
        fields: etlOut.fields, statuses: etlOut.statuses, project: etlOut.project,
      }));
      if (merged.refused) {
        return { ok: false, error: merged.refused, message: 'Jira returned no issues - nothing saved (check your permissions to the DEVOPS project).' };
      }
      log('Done (' + etlOut.issues.length + ' issues, files written: ' + merged.written + ').');
      return { ok: true, written: merged.written, issues: etlOut.issues.length, mode };
    } finally {
      _cleanupOut(outPath);
    }
  }

  function handleRefreshStream(req, res) {
    const url = new URL(req.url, 'http://module.local');
    const full = url.searchParams.get('full') === '1';
    const refusal = refreshJob.refreshRefusal({
      testMode: refreshJob._isTestMode(),
      running,
      token: refreshJob.pickJiraToken(process.env),
      storage: store.storageState(store.teamDataDir(ctx)),
    });
    if (refusal) {
      return sse.runSseStream(req, res, async () => ({ ok: false, error: refusal, message: REFUSAL_MESSAGES[refusal] }));
    }
    running = true;
    return sse.runSseStream(req, res, async (helpers) => {
      try {
        return await _runRefresh(full, helpers);
      } finally {
        running = false;
      }
    });
  }

  return {
    routes: [
      { method: 'GET', path: '/overview', handler: handleOverview },
      { method: 'GET', path: '/issues', handler: handleIssues },
      { method: 'POST', path: '/config', handler: handleConfig },
      { method: 'GET', path: '/refresh-stream', handler: handleRefreshStream },
    ],
  };
};
