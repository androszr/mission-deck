'use strict';
// modules/qa-tests/server/index.js
// register(ctx), mounted under /api/m/qa-tests/. Two routes:
//   GET  /overview        storage + index facts + python availability
//   GET  /refresh-stream  SSE: runs the Python QA ETL script
//
// Every GET *-stream route is wrapped by same-site.js: the core checks the
// Origin only for non-GET routes, and /refresh-stream starts a 20-minute Jira
// fetch that rewrites team data.
//
// Nothing here touches fs or spawns a process at register() time - every
// path below only runs inside a route handler.
//
// store.js owns reads from jira/qa-automation/; refresh-job.js resolves
// Python and runs the ETL child; sse.js is a copy of
// modules/sprint-stats/server/sse.js (a module cannot require() another
// module's file).

const path = require('path');

const store = require('./store.js');
const refreshJob = require('./refresh-job.js');
const sse = require('./sse.js');
const { guardStreamRoutes } = require('./same-site.js');

const REFUSAL_MESSAGES = {
  'test-mode': 'Refreshing is disabled in test mode.',
  'busy': 'A refresh is already running - wait for it to finish.',
  'no-token': 'No Jira token - unlock the Bitwarden vault in Settings.',
  'data-missing': 'The team data source is not cloned - fetch it in the Sync window.',
  'no-python': 'Python was not found - check Settings > Tools.',
};

// Retry window for a NEGATIVE probe only; a found interpreter is cached for
// the process lifetime (installing Python never needs a re-probe to vanish).
const PYTHON_CACHE_TTL_MS = 60000;

// qa_automation.py exit code: the team data tree vanished mid-run
// (_common.EXIT_DATA_MISSING); nothing was written.
const EXIT_DATA_MISSING = 3;

module.exports = function register(ctx) {
  const lock = ctx.makeLock();
  let running = false;
  let pythonCache = { at: 0, available: false };

  function cachedPythonAvailable() {
    const now = Date.now();
    if (pythonCache.available) return true;
    if (now - pythonCache.at < PYTHON_CACHE_TTL_MS) return false;
    const available = !!refreshJob.resolvePython(process.platform);
    pythonCache = { at: now, available };
    return available;
  }

  // -- GET /overview -----------------------------------------------------------
  function handleOverview(_req, res) {
    const dir = store.teamDataDir(ctx);
    const storage = store.storageState(dir);
    const index = storage === 'ok' ? store.readIndex(dir) : { meta: {}, shard_to_module: {}, aggregates: {} };
    ctx.jsonResponse(res, 200, {
      storage,
      index,
      python: { available: cachedPythonAvailable() },
      jira_url: (process.env.JIRA_URL || 'https://jira.example.com').replace(/\/$/, ''),
    });
  }

  // -- GET /refresh-stream -----------------------------------------------------
  async function _runRefresh(helpers) {
    const { log, progress } = helpers;
    const python = refreshJob.resolvePython(process.platform);
    log('Starting the QA Tests refresh.');
    progress(0, 'Starting the QA script...');

    // The script writes shards directly to jira/qa-automation/ inside the
    // team data tree. --out receives the shard directory path; Node hands
    // it as the only filesystem privilege the child gets (the child env is
    // allowlisted and carries no credentials to other repos).
    // Re-checked under the lock: the request-time check may be minutes old.
    const dir = store.teamDataDir(ctx);
    if (store.storageState(dir) !== 'ok') {
      return { ok: false, error: 'data-missing', message: REFUSAL_MESSAGES['data-missing'] };
    }
    const shardDir = path.join(dir, 'jira', 'qa-automation');
    const args = refreshJob.etlArgs(shardDir);
    const handoff = refreshJob.handoffLine(process.env);

    const result = await refreshJob.runEtlStage({
      python,
      args,
      handoff,
      cwd: ctx.rootDir,
      signal: helpers.signal,
      onLine: (line) => {
        const parsed = refreshJob.parseProgressLine(line);
        if (parsed) progress(parsed.pct || 0, parsed.msg || 'QA');
        else log(line);
      },
    });

    if (!result.ok && result.code === EXIT_DATA_MISSING) {
      log('The team data directory vanished during the refresh - nothing was written.');
      return { ok: false, error: 'data-missing', message: REFUSAL_MESSAGES['data-missing'] };
    }
    if (!result.ok) {
      log('QA ETL failed (code ' + result.code + ').');
      return {
        ok: false,
        error: 'etl-failed',
        message: 'The QA Tests refresh failed.',
        tail: result.tail,
      };
    }

    log('QA Tests: done.');
    return { ok: true };
  }

  function handleRefreshStream(req, res) {
    // Refusal order: test-mode, busy, no-token, data-missing, no-python.
    if (refreshJob._isTestMode()) {
      return sse.runSseStream(req, res, async () => ({ ok: false, error: 'test-mode', message: REFUSAL_MESSAGES['test-mode'] }));
    }
    if (running) {
      return sse.runSseStream(req, res, async () => ({ ok: false, error: 'busy', message: REFUSAL_MESSAGES.busy }));
    }
    const token = refreshJob.pickJiraToken(process.env);
    if (!token) {
      return sse.runSseStream(req, res, async () => ({ ok: false, error: 'no-token', message: REFUSAL_MESSAGES['no-token'] }));
    }
    const storage = store.storageState(store.teamDataDir(ctx));
    if (storage !== 'ok') {
      return sse.runSseStream(req, res, async () => ({ ok: false, error: 'data-missing', message: REFUSAL_MESSAGES['data-missing'] }));
    }
    const python = refreshJob.resolvePython(process.platform);
    if (!python) {
      return sse.runSseStream(req, res, async () => ({ ok: false, error: 'no-python', message: REFUSAL_MESSAGES['no-python'] }));
    }

    running = true;
    return sse.runSseStream(req, res, async (helpers) => {
      try {
        return await lock(() => _runRefresh(helpers));
      } finally {
        running = false;
      }
    });
  }

  return {
    routes: guardStreamRoutes([
      { method: 'GET', path: '/overview', handler: handleOverview },
      { method: 'GET', path: '/refresh-stream', handler: handleRefreshStream },
    ], ctx.jsonResponse),
  };
};
