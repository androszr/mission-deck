'use strict';
// modules/sprint-stats/server/index.js
// register(ctx), mounted under /api/m/sprint-stats/. Six routes:
//   GET  /overview        index.json (trimmed) + storage/python facts
//   GET  /sprint           one or two full shards (?main=N&platform=M)
//   GET  /discover          active sprints on both boards, 60s cache
//   GET  /refresh-stream    SSE: runs the Python ETL for MAIN then PLATFORM
//   GET  /spillover             spillover aggregate of closed MAIN sprints + file state
//   POST /spillover/recompute  rewrites sprint-stats/spillover.json (only when it changed)
//
// Nothing here touches fs or spawns a process at register() time - every
// path below only runs inside a route handler, so register() succeeds even
// with a rootDir that does not exist (the scaffolded contract test calls it
// that way).
//
// store.js owns every write into sprint-stats/; normalize.js is the pure
// mapping layer; refresh-job.js resolves Python and runs the ETL child;
// sse.js is the module's own copy of the SSE helper (a module cannot
// require() another module's file).

const fs = require('fs');
const path = require('path');

const store = require('./store.js');
const normalize = require('./normalize.js');
const spillover = require('./spillover.js');
const refreshJob = require('./refresh-job.js');
const sse = require('./sse.js');

const REFUSAL_MESSAGES = {
  'test-mode': 'Refreshing is disabled in test mode.',
  'busy': 'A refresh is already running - wait for it to finish.',
  'no-token': 'No Jira token - unlock the Bitwarden vault in Settings.',
  'data-missing': 'The team data source is not cloned - fetch it in the Sync window.',
  'no-python': 'Python was not found - check Settings > Tools.',
};

// 'discover-failed' is NOT one of the codes above and is deliberately not
// folded into refreshJob.refreshRefusal's order. That table is a
// synchronous, purely local decision (test mode, a run already in flight, a
// token, a clone, a Python interpreter) that handleRefreshStream checks
// BEFORE opening the SSE stream, precisely so a refusal never itself spawns
// a process. Whether the active-sprint discovery on the Jira boards
// actually succeeded is only known after really attempting it, and it only
// matters for the DEFAULT scope - force=1 fetches every sprint and needs no
// active-sprint list at all. So it is _runRefresh's own early return, one
// level below the synchronous table, after discover has actually been
// tried.
const DISCOVER_FAILED_MESSAGE = 'Could not fetch the list of active sprints from the Jira board - try again or use the full refresh.';

const PYTHON_CACHE_TTL_MS = 60000;

/** @param {string} raw @returns {number|null} */
function _parseSprintN(raw) {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function _cleanupOut(outPath) {
  try { fs.unlinkSync(outPath); } catch { /* already gone, or never written */ }
}

module.exports = function register(ctx) {
  const lock = ctx.makeLock();
  let running = false;
  let pythonCache = { at: 0, available: false };

  function cachedPythonAvailable() {
    const now = Date.now();
    if (now - pythonCache.at < PYTHON_CACHE_TTL_MS) return pythonCache.available;
    const available = !!refreshJob.resolvePython(process.platform);
    pythonCache = { at: now, available };
    return available;
  }

  // Rebuilds sprint-stats/spillover.json from index.json. Synchronous on
  // purpose: callers wrap this in lock(...). An index with no closed MAIN
  // sprint (missing or empty) never overwrites spillover.json with an empty
  // aggregate - a reader of the file would show an empty screen.
  function _recomputeSpillover(dir) {
    const aggregate = spillover.buildSpilloverAggregate(store.readIndex(dir));
    if (!aggregate.sprints.length) return { written: false, reason: 'no-index' };
    return store.writeSpilloverIfChanged(dir, spillover.spilloverText(aggregate));
  }

  // The data stage already succeeded when this runs: a failed recompute is
  // logged and reported, never turned into a failed refresh.
  function _recomputeSpilloverSafe(dir) {
    try {
      return _recomputeSpillover(dir);
    } catch (e) {
      ctx.log('spillover recompute failed: ' + (e && e.message ? e.message : String(e)));
      return { written: false, reason: 'error' };
    }
  }

  // -- GET /overview --------------------------------------------------------
  function handleOverview(_req, res) {
    const dir = store.teamDataDir(ctx);
    const storage = store.storageState(dir);
    const index = storage === 'ok' ? store.readIndex(dir) : { schema_version: 1, boards: {}, sprints: [] };
    ctx.jsonResponse(res, 200, {
      storage,
      index,
      python: { available: cachedPythonAvailable() },
      // Base for every Jira link the view renders (issue keys and sprint
      // boards) - the same JIRA_URL the ETL child gets on stdin, so a
      // deployment pointed at another Jira never links to the default host.
      jira_url: (process.env.JIRA_URL || 'https://jira.example.com').replace(/\/$/, ''),
    });
  }

  // -- GET /sprint?main=N&platform=M -------------------------------------------
  function handleSprint(req, res) {
    const url = new URL(req.url, 'http://module.local');
    const rawMain = url.searchParams.get('main');
    const rawPlatform = url.searchParams.get('platform');
    if (rawMain === null && rawPlatform === null) {
      return ctx.jsonResponse(res, 400, { error: 'bad-n', message: 'Give at least one sprint number (main or platform).' });
    }
    let mainN = null;
    let platformN = null;
    if (rawMain !== null) {
      mainN = _parseSprintN(rawMain);
      if (mainN === null) {
        return ctx.jsonResponse(res, 400, { error: 'bad-n', message: 'Invalid main sprint number: ' + rawMain });
      }
    }
    if (rawPlatform !== null) {
      platformN = _parseSprintN(rawPlatform);
      if (platformN === null) {
        return ctx.jsonResponse(res, 400, { error: 'bad-n', message: 'Invalid platform sprint number: ' + rawPlatform });
      }
    }
    const dir = store.teamDataDir(ctx);
    ctx.jsonResponse(res, 200, {
      main: mainN === null ? null : store.readShard(dir, 'main', mainN),
      platform: platformN === null ? null : store.readShard(dir, 'platform', platformN),
    });
  }

  // -- GET /spillover ---------------------------------------------------------------
  function handleSpillover(_req, res) {
    const dir = store.teamDataDir(ctx);
    const storage = store.storageState(dir);
    if (storage !== 'ok') {
      return ctx.jsonResponse(res, 200, { storage, aggregate: null, file: { present: false, current: false } });
    }
    const aggregate = spillover.buildSpilloverAggregate(store.readIndex(dir));
    const onDisk = store.readSpilloverText(dir);
    return ctx.jsonResponse(res, 200, {
      storage,
      aggregate,
      file: { present: onDisk !== null, current: onDisk === spillover.spilloverText(aggregate) },
    });
  }

  // -- POST /spillover/recompute -----------------------------------------------------
  async function handleSpilloverRecompute(req, res) {
    try { await ctx.readBody(req, 1024); } catch { /* body is optional, ignored */ }
    const dir = store.teamDataDir(ctx);
    if (store.storageState(dir) !== 'ok') {
      return ctx.jsonResponse(res, 409, { error: 'storage-unavailable', message: 'The team data source is not cloned.' });
    }
    let result;
    try {
      result = await lock(() => _recomputeSpillover(dir));
    } catch (e) {
      ctx.log('spillover recompute failed: ' + (e && e.message ? e.message : String(e)));
      return ctx.jsonResponse(res, 500, { error: 'recompute-failed', message: 'Could not recalculate the spillover file.' });
    }
    if (result.reason === 'no-index') {
      return ctx.jsonResponse(res, 409, { error: 'no-index', message: 'No closed MAIN sprints - refresh the sprint data first.' });
    }
    return ctx.jsonResponse(res, 200, { written: result.written, present: true });
  }

  // -- GET /discover ----------------------------------------------------------
  async function handleDiscover(_req, res) {
    const data = await refreshJob.loadDiscover(ctx, {});
    ctx.jsonResponse(res, 200, data);
  }

  // -- GET /refresh-stream[?force=1] -------------------------------------------
  async function _runOneStage(dir, src, python, force, discover, helpers) {
    const { log, progress } = helpers;
    let selection = [];
    if (!force && discover && discover.available) {
      const board = discover[src];
      selection = (board && Array.isArray(board.active)) ? board.active : [];
    }
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    const outPath = path.join(ctx.dataDir, 'etl-' + src + '-' + process.pid + '.json');
    const args = refreshJob.etlArgs(src, selection, outPath);
    const handoff = refreshJob.handoffLine(process.env);

    const result = await refreshJob.runEtlStage({
      python,
      args,
      handoff,
      cwd: ctx.rootDir,
      signal: helpers.signal,
      onLine: (line) => {
        const parsed = refreshJob.parseProgressLine(line);
        if (parsed) progress(refreshJob.scaleStageProgress(src, parsed.pct || 0), parsed.msg || src);
        else log(line);
      },
    });

    if (!result.ok) {
      _cleanupOut(outPath);
      log(src.toUpperCase() + ': failed (code ' + result.code + ').');
      return { ok: false, tail: result.tail };
    }

    const etlOut = store.readEtlOut(outPath);
    _cleanupOut(outPath);
    if (!etlOut) {
      log(src.toUpperCase() + ': missing or invalid output file.');
      return { ok: false, tail: result.tail };
    }

    const validationErrors = [];
    for (const entry of etlOut.sprints || []) {
      for (const team of entry.teams || []) validationErrors.push(...normalize.validateTeamSprint(team));
    }
    if (validationErrors.length) {
      log(src.toUpperCase() + ': invalid data, nothing was written.');
      return { ok: false, tail: validationErrors.slice(0, 10) };
    }

    const sprints = (etlOut.sprints || []).map((s) => ({ src, sprint_n: s.sprint_n, phase: s.phase, teams: s.teams }));
    const boards = etlOut.board ? { [src]: etlOut.board } : {};
    const mergeResult = await lock(() => store.mergeSprints(dir, sprints, { onlyMissing: false, boards }));
    log(src.toUpperCase() + ': done (' + mergeResult.written + ' sprints).');
    return { ok: true, written: mergeResult.written };
  }

  async function _runRefresh(force, helpers) {
    const { log } = helpers;
    const dir = store.teamDataDir(ctx);
    const python = refreshJob.resolvePython(process.platform);
    log('Sprint Stats refresh started' + (force ? ' (full fetch).' : '.'));

    // force=1 fetches every sprint on both boards and needs no active-sprint
    // list at all, so it never calls discover - a discover failure must not
    // turn "re-fetch everything" into a second way to refuse. Without
    // force, the default scope IS the active-sprint list: if discover comes
    // back unavailable there is nothing to select, and etlArgs would then
    // silently receive an empty selection - which sprint_stats_main.py and
    // sprint_stats_platform.py both read as "no --sprints/--sprint-ids flag",
    // i.e. a full from-scratch fetch. That is the bug this guard closes:
    // "Refresh active sprints" must never silently become the 20-minute
    // full run, so a failed discover refuses instead, before either ETL
    // stage is spawned.
    let discover = null;
    if (!force) {
      discover = await refreshJob.loadDiscover(ctx, { force: true });
      if (!discover.available) {
        log('Could not fetch the list of active sprints from the Jira board.');
        return { ok: false, error: 'discover-failed', message: DISCOVER_FAILED_MESSAGE };
      }
    }

    const stages = {};
    let written = 0;
    for (const src of ['main', 'platform']) {
      log(src.toUpperCase() + ': start.');
      const stage = await _runOneStage(dir, src, python, force, discover, helpers);
      stages[src] = stage;
      if (stage.ok) written += stage.written;
    }

    refreshJob.invalidateDiscoverCache();

    // PLATFORM does not feed the aggregate; a failed MAIN stage leaves the
    // previous spillover.json untouched.
    if (stages.main && stages.main.ok) {
      const spilloverResult = await lock(() => _recomputeSpilloverSafe(dir));
      log('Spillover: spillover.json ' + (spilloverResult.written ? 'written.'
        : spilloverResult.reason === 'error' ? 'could not be recalculated (the sprint data is saved).'
          : spilloverResult.reason === 'no-index' ? 'skipped - no closed sprints.' : 'unchanged.'));
    }

    const ok = stages.main && stages.main.ok && stages.platform && stages.platform.ok;
    if (ok) return { ok: true, stages, written };
    return {
      ok: false,
      error: 'etl-failed',
      message: 'The refresh failed for at least one source.',
      stages,
      written,
    };
  }

  function handleRefreshStream(req, res) {
    const url = new URL(req.url, 'http://module.local');
    const force = url.searchParams.get('force') === '1';

    // Refusal order (refreshJob.refreshRefusal): test-mode, busy, no-token,
    // data-missing, no-python. Checked lazily and in that order so nothing
    // below the first hit spawns a process - test mode in particular must
    // never call resolvePython.
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
        return await _runRefresh(force, helpers);
      } finally {
        running = false;
      }
    });
  }

  return {
    routes: [
      { method: 'GET', path: '/overview', handler: handleOverview },
      { method: 'GET', path: '/sprint', handler: handleSprint },
      { method: 'GET', path: '/discover', handler: handleDiscover },
      { method: 'GET', path: '/refresh-stream', handler: handleRefreshStream },
      { method: 'GET', path: '/spillover', handler: handleSpillover },
      { method: 'POST', path: '/spillover/recompute', handler: handleSpilloverRecompute },
    ],
  };
};
