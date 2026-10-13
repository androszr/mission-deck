'use strict';
// modules/prod-bugs/server/index.js
// register(ctx), mounted under /api/m/prod-bugs/. Four routes (all GET):
//   GET /overview             every shard in one answer + storage/python facts
//   GET /sprint?sprint=N      one shard
//   GET /widget               counters of the newest shard + a short series (dashboard widget)
//   GET /refresh-stream       SSE: runs the Python ETL (?force=1 = every sprint)
//
// Nothing here touches fs or spawns at register() time. This file never
// writes into the data repository: the ETL script does, tmp + rename, with
// one fixed serialization (see README.md).

const fs = require('fs');
const path = require('path');

const store = require('./store.js');
const refreshJob = require('./refresh-job.js');
const sse = require('./sse.js');

const REFUSAL_MESSAGES = {
  'test-mode': 'Refreshing is disabled in test mode.',
  'busy': 'A refresh is already running - wait for it to finish.',
  'no-token': 'No Jira token - unlock the Bitwarden vault in Settings.',
  'data-missing': 'The team data source is not cloned - fetch it in the Sync window.',
  'no-python': 'Python was not found - check Settings > Tools.',
};

const PYTHON_CACHE_TTL_MS = 60000;

module.exports = function register(ctx) {
  let running = false;
  let pythonCache = { at: 0, available: false };

  function cachedPythonAvailable() {
    const now = Date.now();
    if (now - pythonCache.at < PYTHON_CACHE_TTL_MS) return pythonCache.available;
    const available = !!refreshJob.resolvePython(process.platform);
    pythonCache = { at: now, available };
    return available;
  }

  function jiraUrl() {
    return (process.env.JIRA_URL || 'https://jira.example.com').replace(/\/$/, '');
  }

  // -- GET /overview --------------------------------------------------------
  function handleOverview(_req, res) {
    const dir = store.teamDataDir(ctx);
    const storage = store.storageState(dir);
    const base = {
      storage,
      sprints: [],
      availableSprints: [],
      manifestSprints: [],
      skipped: [],
      python: { available: cachedPythonAvailable() },
      jira_url: jiraUrl(),
      fetchedAt: null,
    };
    if (storage === 'ok') {
      const pDir = store.progressDir(dir);
      const listed = store.listShards(pDir);
      base.sprints = listed.sprints;
      base.availableSprints = listed.availableSprints;
      base.skipped = listed.skipped;
      base.manifestSprints = store.readManifestSprints(pDir);
      let newest = null;
      for (const s of listed.sprints) {
        if (typeof s.fetchedAt === 'string' && (newest === null || s.fetchedAt > newest)) newest = s.fetchedAt;
      }
      base.fetchedAt = newest;
    }
    ctx.jsonResponse(res, 200, base);
  }

  // -- GET /sprint?sprint=N ---------------------------------------------------
  function handleSprint(req, res) {
    const url = new URL(req.url, 'http://module.local');
    const raw = url.searchParams.get('sprint');
    const n = store.parseSprintN(raw === null ? '' : raw);
    if (n === null) {
      return ctx.jsonResponse(res, 400, { error: 'bad-n', message: 'Invalid sprint number: ' + (raw === null ? '' : raw) });
    }
    const shard = store.readShard(store.progressDir(store.teamDataDir(ctx)), n);
    if (!shard) {
      return ctx.jsonResponse(res, 404, { error: 'not-found', message: 'No data for sprint ' + n + '.' });
    }
    return ctx.jsonResponse(res, 200, shard);
  }

  // -- GET /widget ------------------------------------------------------------
  // The dashboard widget's route: the per-area COUNTERS of the newest shard and
  // the open-bug totals of the last few sprints. No bug lists (summaries are
  // not for a dashboard), and only the newest WIDGET_SERIES shards are opened,
  // where /overview parses every sprint with every list.
  const WIDGET_SERIES = 8;
  const WIDGET_AREAS = ['orders', 'otherModules', 'platform'];

  function _counters(area) {
    const a = area && typeof area === 'object' ? area : {};
    const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      bugs: n(a.bugs),
      resolvedCount: n(a.resolvedCount),
      createdCount: n(a.createdCount),
      bugFixTime: typeof a.bugFixTime === 'number' && Number.isFinite(a.bugFixTime) ? a.bugFixTime : null,
    };
  }

  // Open bugs per priority label of one shard - counts only, never the bugs.
  function _priorityCounts(shard) {
    const out = {};
    for (const k of WIDGET_AREAS) {
      const list = shard.areas && shard.areas[k] && Array.isArray(shard.areas[k].openBugs) ? shard.areas[k].openBugs : [];
      for (const b of list) {
        const name = b && typeof b.priority === 'string' && b.priority ? b.priority : 'None';
        out[name] = (out[name] || 0) + 1;
      }
    }
    return out;
  }

  function handleWidget(_req, res) {
    const dir = store.teamDataDir(ctx);
    const storage = store.storageState(dir);
    const empty = { storage, latest: null, series: [], fetchedAt: null };
    if (storage !== 'ok') return ctx.jsonResponse(res, 200, empty);
    const pDir = store.progressDir(dir);
    const numbers = store.shardNumbers(pDir).slice(-WIDGET_SERIES);
    const shards = [];
    for (const n of numbers) {
      const shard = store.readShard(pDir, n);
      if (shard) shards.push({ n, shard });
    }
    if (shards.length === 0) return ctx.jsonResponse(res, 200, empty);
    const total = (s) => WIDGET_AREAS.reduce((sum, k) => sum + _counters(s.areas && s.areas[k]).bugs, 0);
    const newest = shards[shards.length - 1];
    const areas = {};
    for (const k of WIDGET_AREAS) areas[k] = _counters(newest.shard.areas && newest.shard.areas[k]);
    return ctx.jsonResponse(res, 200, {
      storage,
      latest: {
        sprint: typeof newest.shard.sprint === 'number' ? newest.shard.sprint : newest.n,
        sprintName: typeof newest.shard.sprintName === 'string' ? newest.shard.sprintName : 'Sprint ' + newest.n,
        dateRangeDisplay: typeof newest.shard.dateRangeDisplay === 'string' ? newest.shard.dateRangeDisplay : '',
        areas,
      },
      series: shards.map(({ n, shard }) => ({
        sprint: typeof shard.sprint === 'number' ? shard.sprint : n,
        bugs: total(shard),
        areas: Object.fromEntries(WIDGET_AREAS.map((k) => [k, _counters(shard.areas && shard.areas[k]).bugs])),
        priorities: _priorityCounts(shard),
      })),
      fetchedAt: typeof newest.shard.fetchedAt === 'string' ? newest.shard.fetchedAt : null,
    });
  }

  // -- GET /refresh-stream[?force=1] -------------------------------------------
  async function _runRefresh(force, python, helpers) {
    const { log, progress } = helpers;
    const dir = store.teamDataDir(ctx);
    const pDir = store.progressDir(dir);
    const cacheDir = path.join(ctx.dataDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    log('Starting the production bugs refresh' + (force ? ' (all sprints).' : ' (current sprint).'));

    let written = 0;
    const result = await refreshJob.runEtl({
      python,
      args: refreshJob.etlArgs(force, pDir, cacheDir),
      handoff: refreshJob.handoffLine(process.env),
      cwd: ctx.rootDir,
      signal: helpers.signal,
      onLine: (line) => {
        const parsed = refreshJob.parseProgressLine(line);
        if (parsed) {
          progress(parsed.pct || 0, parsed.msg || '');
        } else {
          if (line.indexOf('Saved ->') >= 0) written += 1;
          log(line);
        }
      },
    });

    if (!result.ok) {
      return {
        ok: false,
        error: 'etl-failed',
        message: 'The refresh failed (code ' + result.code + ').',
        tail: result.tail,
      };
    }
    return { ok: true, written, availableSprints: store.listShards(pDir).availableSprints };
  }

  function handleRefreshStream(req, res) {
    const url = new URL(req.url, 'http://module.local');
    const force = url.searchParams.get('force') === '1';

    // Refusals come as an `error` event on the same stream and spawn nothing.
    // Order is refreshJob.refreshRefusal's; python is resolved only once every
    // earlier check passed, so test mode never probes an interpreter.
    const early = refreshJob.refreshRefusal({
      testMode: refreshJob._isTestMode(),
      running,
      token: refreshJob.pickJiraToken(process.env),
      storage: store.storageState(store.teamDataDir(ctx)),
      python: { placeholder: true },
    });
    let python = null;
    let code = early;
    if (!code) {
      python = refreshJob.resolvePython(process.platform);
      code = refreshJob.refreshRefusal({ token: 'x', storage: 'ok', python });
    }
    if (code) {
      return sse.runSseStream(req, res, async () => ({ ok: false, error: code, message: REFUSAL_MESSAGES[code] }));
    }

    running = true;
    return sse.runSseStream(req, res, async (helpers) => {
      try {
        return await _runRefresh(force, python, helpers);
      } finally {
        running = false;
      }
    });
  }

  return {
    routes: [
      { method: 'GET', path: '/overview', handler: handleOverview },
      { method: 'GET', path: '/sprint', handler: handleSprint },
      { method: 'GET', path: '/widget', handler: handleWidget },
      { method: 'GET', path: '/refresh-stream', handler: handleRefreshStream },
    ],
  };
};
