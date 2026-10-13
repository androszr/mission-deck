'use strict';
// modules/usage-analytics/server/index.js
// Routes under /api/m/usage-analytics/ (exact paths, no /:id):
//   GET /status          what the view needs before it paints (storage, keys, busy, cache span)
//   GET /data            the committed aggregate (aggregated.json) or a calm "no data" answer
//   GET /widget          read-only tile data: KPI of the 7-day window, 14 daily points, top 5 modules (never per-person rows)
//   GET /refresh-stream  SSE: fetch missing Amplitude days -> local cache -> aggregate -> ONE file in data-tier-0
// The module never pushes: the person sends the new file with the normal sync UI.
//
// Keys (AMPLITUDE_COCKPIT_API_KEY / _SECRET_KEY) are read from process.env inside the
// handler, handed to amplitude.fetchDay as `auth`, and never logged, stored or returned.

const path = require('path');
const pathsMod = require('./paths.js');
const amplitude = require('./amplitude.js');
const modulesMap = require('./modules-map.js');
const { aggregate } = require('./aggregate.js');
const { runSseStream } = require('./sse.js');

// Read on every call, never frozen at require() time.
function _isTestMode() {
  return process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';
}

const STORAGE_UNAVAILABLE_MESSAGE = 'No team data on this computer. Pull the "Team data" source in the Sync panel.';
const NO_KEYS_MESSAGE = 'The Amplitude keys for Mission Deck are missing from the team vault - unlock the vault in the top bar.';
const BUSY_MESSAGE = 'A refresh is already running.';
const TEST_MODE_MESSAGE = 'Fetching from Amplitude is disabled in this environment.';
const FETCH_ATTEMPTS = 4;
const RETRY_DELAY_MS = 3000;
const BAD_KEYS_MESSAGE = 'Amplitude rejected the Mission Deck keys (check the team vault).';
const NO_DATA_MESSAGE = 'No data yet. Click "Refresh" to fetch events from Amplitude.';

function register(ctx) {
  const p = pathsMod.paths(ctx.rootDir, ctx.dataDir, pathsMod.repoDir(ctx));
  const withLock = ctx.makeLock();
  let refreshInFlight = false;

  function keys() {
    const key = process.env.AMPLITUDE_COCKPIT_API_KEY;
    const secret = process.env.AMPLITUDE_COCKPIT_SECRET_KEY;
    return key && secret ? { key, secret } : null;
  }

  function handleStatus(_req, res) {
    const storage = pathsMod.storageState(p.repoDir);
    const agg = storage === 'ok' ? pathsMod.readJsonSafe(p.aggregateFile) : null;
    const cached = amplitude.listCacheDays(p.cacheDir);
    ctx.jsonResponse(res, 200, {
      ok: true,
      storage,
      keysPresent: !!keys(),
      testMode: _isTestMode(),
      busy: refreshInFlight,
      aggregate: agg ? { generated_at: agg.generated_at || null, range: agg.range || null, last_full_day: agg.last_full_day || null } : null,
      cache: { firstDay: cached[0] || null, lastDay: cached[cached.length - 1] || null, count: cached.length },
    });
  }

  function handleData(_req, res) {
    if (pathsMod.storageState(p.repoDir) !== 'ok') {
      return ctx.jsonResponse(res, 200, { ok: false, error: 'storage-unavailable', message: STORAGE_UNAVAILABLE_MESSAGE });
    }
    const agg = pathsMod.readJsonSafe(p.aggregateFile);
    if (!agg) {
      return ctx.jsonResponse(res, 200, { ok: false, error: 'no-data', message: NO_DATA_MESSAGE });
    }
    return ctx.jsonResponse(res, 200, { ok: true, aggregate: agg });
  }

  // -- GET /widget ------------------------------------------------------------
  // The dashboard tile's route. Read-only, no lock. It slices the aggregate down to
  // MODULE-level numbers: the KPI of the 7-day window, the last 14 days of the 30-day
  // series and the five busiest modules. Per-user rows (periods[].users, by_user,
  // names, aliases) are never copied - /data carries them, the tile must not.
  const WIDGET_DAYS = 14;
  const WIDGET_TOP = 5;

  function _n(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }

  function handleWidget(_req, res) {
    if (pathsMod.storageState(p.repoDir) !== 'ok') {
      return ctx.jsonResponse(res, 200, { ok: false, error: 'storage-unavailable', message: STORAGE_UNAVAILABLE_MESSAGE });
    }
    const agg = pathsMod.readJsonSafe(p.aggregateFile);
    const week = agg && agg.periods && agg.periods['7'];
    if (!week || !week.kpi) {
      return ctx.jsonResponse(res, 200, { ok: false, error: 'no-data', message: NO_DATA_MESSAGE });
    }
    const k = week.kpi;
    const d = k.delta && typeof k.delta === 'object' ? k.delta : {};
    const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const month = agg.periods['30'];
    const daily = ((month && Array.isArray(month.daily)) ? month.daily : (Array.isArray(week.daily) ? week.daily : []))
      .slice(-WIDGET_DAYS)
      .map((x) => ({ date: String(x.date || ''), page_views: _n(x.page_views), active_users: _n(x.active_users) }));
    const topModules = (Array.isArray(week.modules) ? week.modules : [])
      .slice(0, WIDGET_TOP)
      .map((m) => ({ id: String(m.id), label: String(m.name || m.id), page_views: _n(m.page_views) }));
    // The gauge compares like with like: kpi.modules_in_use also counts 'core' and ids
    // missing from the module dictionary, so the tile counts only dictionary modules
    // that had a page view in the window, over the dictionary size.
    const dictIds = new Set(agg.modules && typeof agg.modules === 'object' ? Object.keys(agg.modules) : []);
    const modulesInUse = (Array.isArray(week.modules) ? week.modules : [])
      .filter((m) => m && dictIds.has(String(m.id)) && _n(m.page_views) > 0).length;
    return ctx.jsonResponse(res, 200, {
      ok: true,
      generated_at: agg.generated_at || null,
      last_full_day: agg.last_full_day || null,
      kpi: {
        active_users: _n(k.active_users),
        sessions: _n(k.sessions),
        page_views: _n(k.page_views),
        modules_in_use: _n(k.modules_in_use),
        median_view_ms: typeof k.median_view_ms === 'number' ? k.median_view_ms : null,
        delta: { active_users_pct: pct(d.active_users_pct), sessions_pct: pct(d.sessions_pct), page_views_pct: pct(d.page_views_pct) },
      },
      daily,
      topModules,
      modulesTotal: dictIds.size,
      modulesInUse,
    });
  }

  // A browser EventSource fires a bare 'error' on any non-event-stream answer, so a
  // JSON 409 would never reach the modal. Every refusal therefore OPENS the stream and
  // answers with an SSE 'error' event {error, message}.
  // The client also reads /status first and normally never reaches a refusal.
  function refuse(req, res, error, message) {
    return runSseStream(req, res, async () => ({ ok: false, error, message }));
  }

  async function handleRefreshStream(req, res) {
    if (_isTestMode()) return refuse(req, res, 'test-mode', TEST_MODE_MESSAGE);
    if (pathsMod.storageState(p.repoDir) !== 'ok') return refuse(req, res, 'storage-unavailable', STORAGE_UNAVAILABLE_MESSAGE);
    const auth = keys();
    if (!auth) return refuse(req, res, 'no-keys', NO_KEYS_MESSAGE);
    if (refreshInFlight) return refuse(req, res, 'busy', BUSY_MESSAGE);

    // Lazy: register(ctx) must succeed against a fake rootDir. Resolved BEFORE the flag is set.
    const readZip = require(path.join(ctx.rootDir, 'scripts', 'zip.js')).readZip;

    refreshInFlight = true; // synchronously, before the first await
    return runSseStream(req, res, async (helpers) => {
      try {
        const today = amplitude.todayCet();
        const before = amplitude.readCache(p.cacheDir);
        const settled = before.days.filter((d) => d.full).map((d) => d.date);
        const days = amplitude.planDays(settled, today, amplitude.FLOOR_DAY);
        if (!before.days.length && days.length) {
          helpers.log('Empty cache - fetching from ' + days[0] + ', about ' + days.length + ' days.');
        }

        let daysFetched = 0;
        for (let i = 0; i < days.length; i++) {
          if (helpers.signal.aborted) throw new Error('Cancelled.');
          const day = days[i];
          helpers.progress(Math.round((i / days.length) * 90), 'Day ' + day);
          let events;
          for (let attempt = 1; ; attempt++) {
            try {
              events = await amplitude.fetchDay(day, auth, (u, o) => fetch(u, o), readZip, helpers.signal);
              break;
            } catch (err) {
              if (err && (err.status === 401 || err.status === 403)) {
                const e = new Error(BAD_KEYS_MESSAGE);
                e.code = 'bad-keys';
                throw e;
              }
              // 5xx / 429 / network blips are normal for this API: retry the day a few times
              const transient = !err || !err.status || err.status >= 500 || err.status === 429;
              if (!transient || attempt >= FETCH_ATTEMPTS || helpers.signal.aborted) throw err;
              helpers.log(day + ': retrying (' + attempt + '/' + FETCH_ATTEMPTS + ')');
              await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
            }
          }
          amplitude.writeDayFile(p.cacheDir, day, events);
          daysFetched += 1;
          helpers.log(day + ': ' + events.length + ' events');
        }
        if (!days.length) helpers.progress(90, 'no new days');

        helpers.progress(93, 'Computing the summary');
        const cache = amplitude.readCache(p.cacheDir);
        const previous = pathsMod.readJsonSafe(p.aggregateFile);
        const dict = modulesMap.mergeModuleDicts(previous && previous.modules, modulesMap.scanInstalledModules(ctx.rootDir));
        const directory = pathsMod.readJsonSafe(p.teamFile);
        const aliases = pathsMod.readJsonSafe(p.aliasesFile);
        const result = aggregate(cache.events, { today, modulesDict: dict, members: directory && directory.team_members, aliases });

        // End of day can wipe the plaintext tree while the fetch ran: re-check INSIDE the lock, right before the write.
        return await withLock(() => {
          if (pathsMod.storageState(p.repoDir) !== 'ok') {
            return { ok: false, error: 'storage-unavailable', message: STORAGE_UNAVAILABLE_MESSAGE };
          }
          pathsMod.writeAggregate(p, result);
          helpers.progress(100, 'Saved');
          return { ok: true, daysFetched, eventsKept: result.meta.events_kept, generated_at: result.generated_at };
        });
      } catch (err) {
        if (err && err.code === 'storage-unavailable') return { ok: false, error: 'storage-unavailable', message: STORAGE_UNAVAILABLE_MESSAGE };
        if (err && err.code === 'bad-keys') return { ok: false, error: 'bad-keys', message: err.message };
        ctx.log('refresh failed: ' + (err && err.message ? err.message : err));
        return { ok: false, error: 'error', message: 'Could not fetch data from Amplitude: ' + (err && err.message ? err.message : String(err)) };
      } finally {
        refreshInFlight = false;
      }
    });
  }

  return {
    routes: [
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'GET', path: '/data', handler: handleData },
      { method: 'GET', path: '/widget', handler: handleWidget },
      { method: 'GET', path: '/refresh-stream', handler: handleRefreshStream },
    ],
  };
}

module.exports = register;
