'use strict';
// modules/time-log/server/index.js
// register(ctx) mounted under /api/m/time-log/. Three routes:
//   GET /data            -> merged heatmap data (index.json + people/<slug>.json)
//   GET /status          -> token/roster/storage/job/lastRun probe, no network
//   GET /refresh-stream  -> SSE job: fetches Tempo worklogs and writes the shards
//
// createRoutes(ctx, { http, now }) is the testable core - tests inject a fake
// http client (never the network) and a fixed `now`. register(ctx) is the
// real entry the module loader calls: it wires the real fetch-based client
// behind a per-request test-mode read, so no test:api run ever reaches Tempo.
//
// Data lives under ctx.dataTier0Dir (the plaintext ds-data working tree),
// NEVER built from ctx.rootDir plus a hand-joined sub-repositories path -
// that would write to the real team data repo from a unit test.

const fs = require('fs');
const path = require('path');
const { windowDates } = require('./calendar.js');
const { buildTimeLog, mergeShards, readTrackedEmails } = require('./build.js');
const { tempoConfig, readProjects, fetchAllWorklogs, defaultHttp } = require('./tempo.js');

const MODULE_SUBDIR = 'time-log';
const PERSONS_SUBDIR = 'people';
const INDEX_FILE = 'index.json';
const CONFIG_FILE = 'config.json';
const LAST_RUN_FILE = 'last-run.json';
const WINDOW_DAYS = 14;
const RUN_DEADLINE_MS = 5 * 60 * 1000;
// Mirrors the ratio half of encryptTree's encrypt-destructive guard
// (scripts/crypto-sync.js DESTRUCTIVE_RATIO/DESTRUCTIVE_MIN_FILES), scaled to
// this module's domain: a roster of a few dozen people, not hundreds of mirror
// files. DESTRUCTIVE_MIN_EXISTING keeps ordinary roster churn - one person
// leaving the six teams and their stale shard being dropped, see the
// "drops a stale one" route test - from tripping the ratio on a small
// existing set; below it a run is never blocked on ratio alone.
const DESTRUCTIVE_RATIO = 0.3;
const DESTRUCTIVE_MIN_EXISTING = 5;

/** Read on every call, never frozen at require() - see createRoutes. */
function isTestMode() {
  return process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';
}

// -- SSE helpers --------------------------------------------------------------

function sseOpen(req, res) {
  if (req.socket && typeof req.socket.setTimeout === 'function') req.socket.setTimeout(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function sseSend(res, event, obj) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(obj) + '\n\n');
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function todayIsoLocal(now) {
  const d = now();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function createRoutes(ctx, deps) {
  // `http` may be a client object (tests inject a fake) or a FUNCTION that
  // answers one per call - register() passes the latter so test mode is read
  // on every request, never frozen at require() time (the rule
  // modules/sprint-stats/server/refresh-job.js _isTestMode states: a test
  // flips COCKPIT_EMBEDDED mid-case and expects the next request to see it).
  const resolveHttp = () => (typeof deps?.http === 'function' ? deps.http() : (deps && deps.http) || null);
  const now = (deps && deps.now) || (() => new Date());
  // Injectable for the routes test that drives the deadline; the real value
  // is RUN_DEADLINE_MS.
  const resolveDeadlineMs = () => {
    const v = deps && deps.runDeadlineMs;
    return Number.isFinite(v) && v > 0 ? v : RUN_DEADLINE_MS;
  };

  const moduleDir = path.join(ctx.dataTier0Dir, MODULE_SUBDIR);
  const personsDir = path.join(moduleDir, PERSONS_SUBDIR);
  const indexFile = path.join(moduleDir, INDEX_FILE);
  const rosterFile = path.join(ctx.dataTier0Dir, 'team', 'team-members.json');
  const configFile = path.join(ctx.dataDir, CONFIG_FILE);
  const lastRunFile = path.join(ctx.dataDir, LAST_RUN_FILE);

  const withLock = ctx.makeLock();
  let job = { running: false, startedAt: null, abort: null };

  // -- Shared reads ---------------------------------------------------------

  function readShard(file) {
    try {
      const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!obj || typeof obj !== 'object' || typeof obj.slug !== 'string' || !Array.isArray(obj.days)) {
        ctx.log('time-log: shard has an unexpected shape, skipping:', file);
        return null;
      }
      return obj;
    } catch (e) {
      ctx.log('time-log: corrupt shard, skipping:', file, e.message);
      return null;
    }
  }

  function readIndex() {
    try {
      const obj = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      return null;
    }
  }

  function loadRoster() {
    try {
      const obj = JSON.parse(fs.readFileSync(rosterFile, 'utf8'));
      if (!obj || !Array.isArray(obj.team_members)) {
        ctx.log('time-log: team-members.json has an unexpected shape (no team_members array) - the team directory is empty for this run');
        return [];
      }
      return obj.team_members;
    } catch (e) {
      ctx.log('time-log: could not read the team directory (' + ((e && e.message) || 'unknown error') + ') - the team directory is empty for this run');
      return [];
    }
  }

  // -- Write-phase guard ----------------------------------------------------
  // buildTimeLog([], ...) returns { shards: [] } without throwing, so a
  // roster that read empty or unreadable (loadRoster() above) would let the
  // write phase below diff an empty keep-set against every shard already on
  // disk and rm every one of them, then report `done { ok: true, persons: 0
  // }` - a silent, successful-looking wipe. Mirrors encryptTree's
  // encrypt-destructive guard (scripts/crypto-sync.js): decide BEFORE a
  // single file is touched, refuse the whole write, never partially.
  function computeWriteGuard(shards, existingFiles) {
    if (shards.length === 0) {
      return {
        error: 'roster-empty',
        message: 'The team directory (team/team-members.json) is empty or could not be read - the write was stopped so the time logs saved earlier are not deleted. Check the file in the Sync window and try again.',
      };
    }
    if (existingFiles.length >= DESTRUCTIVE_MIN_EXISTING) {
      const keep = new Set(shards.map((s) => s.slug + '.json'));
      const toRemove = existingFiles.filter((f) => !keep.has(f));
      const ratio = toRemove.length / existingFiles.length;
      if (ratio > DESTRUCTIVE_RATIO) {
        return {
          error: 'destructive',
          message: 'This run would remove ' + toRemove.length + ' of ' + existingFiles.length
            + ' people saved earlier (' + Math.round(ratio * 100) + '%) - the write was stopped so the'
            + ' team\'s time logs are not deleted. The team directory (team/team-members.json) looks heavily'
            + ' trimmed compared with the previous run - check it and try again.',
        };
      }
    }
    return null;
  }

  function loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (e) {
      if (e && e.code !== 'ENOENT') {
        ctx.log('time-log: config.json is invalid, using the defaults (' + e.message + ')');
      }
      return null;
    }
  }

  function loadProjects() {
    return readProjects(loadConfig());
  }

  function loadLastRun() {
    try {
      const obj = JSON.parse(fs.readFileSync(lastRunFile, 'utf8'));
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      return null;
    }
  }

  // -- GET /data --------------------------------------------------------------

  function handleData(_req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) {
      ctx.jsonResponse(res, 200, { available: false, storage: 'unavailable', persons: [] });
      return;
    }
    const index = readIndex();
    if (!index) {
      ctx.jsonResponse(res, 200, { available: false, storage: 'ok', persons: [] });
      return;
    }
    let shardFiles = [];
    try { shardFiles = fs.readdirSync(personsDir).filter((f) => f.endsWith('.json')); } catch { /* the directory does not exist yet - empty state */ }
    const persons = [];
    for (const slug of Object.keys(index.persons || {}).sort((a, b) => (index.persons[b].miss_days_count - index.persons[a].miss_days_count) || (index.persons[a].name < index.persons[b].name ? -1 : 1))) {
      const file = path.join(personsDir, slug + '.json');
      if (!shardFiles.includes(slug + '.json')) continue;
      const shard = readShard(file);
      if (shard) persons.push(shard);
    }
    ctx.jsonResponse(res, 200, mergeShards(index, persons));
  }

  // -- GET /status --------------------------------------------------------------

  function handleStatus(_req, res) {
    const cfg = tempoConfig(process.env);
    ctx.jsonResponse(res, 200, {
      token: cfg.ok,
      jiraUrl: cfg.jiraUrl,
      storage: fs.existsSync(ctx.dataTier0Dir) ? 'ok' : 'unavailable',
      roster: fs.existsSync(rosterFile),
      projects: loadProjects(),
      job: { running: job.running, startedAt: job.startedAt },
      lastRun: loadLastRun(),
    });
  }

  // -- GET /refresh-stream ------------------------------------------------------

  async function handleRefreshStream(req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) {
      ctx.jsonResponse(res, 409, {
        error: 'data-missing',
        message: 'The team data repository is not cloned on this computer - clone it in the Sync window on the top bar.',
      });
      return;
    }
    if (!fs.existsSync(rosterFile)) {
      ctx.jsonResponse(res, 409, {
        error: 'data-missing',
        message: 'The team directory (team/team-members.json) is not available on this computer yet - clone the data repository in the Sync window on the top bar.',
      });
      return;
    }

    // The running-flag decision has to happen inside the lock: two clicks
    // that both read job.running=false before either writes it back would
    // both start a run.
    const started = await withLock(() => {
      if (job.running) return false;
      job = { running: true, startedAt: new Date().toISOString(), abort: new AbortController() };
      return true;
    });
    if (!started) {
      ctx.jsonResponse(res, 409, { error: 'job-running', message: 'A fetch is already running.' });
      return;
    }

    // `settled` means "the client has been answered (or has gone)"; the job
    // slot is a separate thing and is released ONLY in the finally below,
    // once every phase of this run - the fetch AND the write - has come to
    // rest. The first version released it from the deadline timer and the
    // client-close handler as well: a deadline that fired during the write
    // phase told the person "timeout", still wrote every shard, and let a
    // second click start a parallel run while the first was mid-write.
    sseOpen(req, res);

    let settled = false;
    let deadlineTimer = null;
    const stopWatching = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = null;
      req.removeListener('close', onClientClose);
    };
    const onClientClose = () => {
      if (settled) return;
      settled = true;
      if (job.abort) job.abort.abort();
      stopWatching();
    };
    req.on('close', onClientClose);

    deadlineTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (job.abort) job.abort.abort();
      stopWatching();
      sseSend(res, 'error', { error: 'timeout', message: 'Fetching the Tempo data took longer than 5 minutes.' });
      res.end();
    }, resolveDeadlineMs());
    if (deadlineTimer.unref) deadlineTimer.unref();

    // Answers the client once and stops the watchers; safe to call from any
    // exit path, and a no-op after the client has already been answered.
    const answer = (event, payload) => {
      if (settled) return;
      settled = true;
      stopWatching();
      sseSend(res, event, payload);
      res.end();
    };

    try {
      const http = resolveHttp();
      if (!http) {
        answer('error', { error: 'test-mode', message: 'Fetching is disabled in test mode.' });
        return;
      }

      const cfg = tempoConfig(process.env);
      if (!cfg.ok) {
        answer('error', { error: 'no-token', message: 'No Jira token - unlock the Bitwarden vault on the top bar and try again.' });
        return;
      }

      const config = loadConfig();
      const projects = readProjects(config);
      const trackedEmails = readTrackedEmails(config);
      const todayIso = todayIsoLocal(now);
      const dates = windowDates(todayIso, WINDOW_DAYS);
      const dateFrom = dates[dates.length - 1];
      const dateTo = dates[0];

      // Read once, now, before the (up to 5-minute) sequential Tempo fetch -
      // not after it. Reading it again once the fetch finished let the file
      // become empty or unreadable in the meantime and matched worklogs
      // against a roster the initial data-missing preflight never saw.
      const roster = loadRoster();

      let worklogs;
      try {
        worklogs = await fetchAllWorklogs({
          http,
          cfg,
          projects,
          dateFrom,
          dateTo,
          signal: job.abort.signal,
          onProgress: (i, total, projectKey) => {
            if (settled) return;
            const percent = total > 0 ? Math.round((i / total) * 80) : 0;
            sseSend(res, 'progress', { percent, message: 'Fetching worklogs of project ' + projectKey + ' (' + (i + 1) + '/' + total + ')' });
          },
        });
      } catch (e) {
        if (settled) return; // the deadline or the client already ended this run
        const message = 'Could not fetch the Tempo data: ' + ((e && e.message) || 'unknown error') + '.';
        try {
          writeJsonAtomic(lastRunFile, { ok: false, at: new Date().toISOString(), persons: 0, worklogs: 0, unmatched: 0, error: message });
        } catch { /* recording the failure is best effort */ }
        answer('error', { error: 'tempo-failed', message });
        return;
      }
      if (settled) return;

      sseSend(res, 'progress', { percent: 85, message: 'Matching authors to the team directory' });
      const built = buildTimeLog(worklogs, roster, dates, { now, trackedEmails });

      sseSend(res, 'progress', { percent: 95, message: 'Saving the data on this computer' });
      let guard = null;
      let skipped = false;
      await withLock(() => {
        // A run the client already gave up on (deadline, closed tab) writes
        // nothing: the person was told it did not happen, so it must not.
        if (settled) { skipped = true; return; }
        fs.mkdirSync(personsDir, { recursive: true });
        let existing = [];
        try { existing = fs.readdirSync(personsDir).filter((f) => f.endsWith('.json')); } catch { /* first write - the directory is still empty */ }
        guard = computeWriteGuard(built.shards, existing);
        if (guard) return;
        const keepFiles = new Set(built.shards.map((s) => s.slug + '.json'));
        for (const f of existing) {
          if (!keepFiles.has(f)) fs.rmSync(path.join(personsDir, f), { force: true });
        }
        for (const shard of built.shards) writeJsonAtomic(path.join(personsDir, shard.slug + '.json'), shard);
        writeJsonAtomic(indexFile, built.index);
        writeJsonAtomic(lastRunFile, {
          ok: true,
          at: built.index.generated_at,
          persons: built.shards.length,
          worklogs: worklogs.length,
          unmatched: built.unmatched.length,
          error: null,
        });
      });
      if (skipped) return;

      if (guard) {
        try {
          writeJsonAtomic(lastRunFile, {
            ok: false,
            at: new Date().toISOString(),
            persons: 0,
            worklogs: worklogs.length,
            unmatched: built.unmatched.length,
            error: guard.message,
          });
        } catch { /* recording the failure is best effort */ }
        answer('error', guard);
        return;
      }

      answer('done', {
        ok: true,
        persons: built.shards.length,
        worklogs: worklogs.length,
        unmatched: built.unmatched.length,
        generated_at: built.index.generated_at,
        dates,
      });
    } catch (e) {
      const message = 'Could not process the Tempo data: ' + ((e && e.message) || 'unknown error') + '.';
      try {
        writeJsonAtomic(lastRunFile, { ok: false, at: new Date().toISOString(), persons: 0, worklogs: 0, unmatched: 0, error: message });
      } catch { /* recording the failure is best effort */ }
      answer('error', { error: 'tempo-failed', message });
    } finally {
      stopWatching();
      job = { running: false, startedAt: null, abort: null };
    }
  }

  return {
    routes: [
      { method: 'GET', path: '/data', handler: handleData },
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'GET', path: '/refresh-stream', handler: handleRefreshStream },
    ],
  };
}

function register(ctx) {
  const http = defaultHttp();
  return createRoutes(ctx, { http: () => (isTestMode() ? null : http), now: () => new Date() });
}

module.exports = register;
module.exports.createRoutes = createRoutes;
