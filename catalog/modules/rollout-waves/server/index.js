'use strict';
// rollout-waves/server/index.js
// register(ctx), mounted under /api/m/rollout-waves/. Three routes:
//   GET  /dashboard         - KPI + wave table + location list, computed
//                             on the fly from the plaintext team data tree
//   POST /import-training   - merge-only import of location codes (column A)
//   POST /import-webinar    - same, into webinar-done/
//
// The location directory belongs to the `locations` module: this module only
// READS its light index (locations/locations.index.json - no phone, no
// e-mail) and never writes it. `locations/` is therefore deliberately
// absent from this module's dataRepos[].paths.
//
// Domain logic lives in rollout-core.js (pure, zero requires); sharded disk
// access for the two confirmation imports lives in shard-store.js. The XLSX
// parser (xlsx-lite.js) is pure too. This file is the only one that touches
// ctx, request/response and fs paths.
//
// scripts/zip.js (readZip) is required LAZILY inside the import handler -
// register(ctx) must not touch disk or require the app's scripts at load
// time (the contract test registers this module with a rootDir that does
// not exist). The host runs checkOrigin before any non-GET handler.
//
// Import body shape: the host's checkOrigin answers 415 to a non-JSON body
// on every non-GET route, so the file travels INSIDE the JSON body:
//   { "name": "<file name>.xlsx", "file_base64": "<base64>" }
//
// One thing this module cannot fix: ctx.readBody destroys the socket the
// moment an oversize body is detected, so a genuinely oversize upload can
// reach the browser as a bare connection failure instead of the
// 'too-large' body below. The client checks the size before uploading.

const fs = require('fs');
const path = require('path');

const core = require('./rollout-core.js');
const shardStore = require('./shard-store.js');
const xlsxLite = require('./xlsx-lite.js');

const MODULE_SUBDIR = 'rollout-waves';
const LOCATIONS_INDEX = ['locations', 'locations.index.json'];
const DONE_SUBDIRS = { training: 'training-done', webinar: 'webinar-done' };
const WAVE_CONFIG_FILE = 'waves-config.json';

// The user-facing limit is "10 MB of file". Base64 inflates by 4/3 (about
// 13.98 MB for a 10 MB file) and the JSON envelope adds a little more, so
// the cap on the JSON body sits comfortably above that.
const MAX_CODES_UPLOAD_BYTES = 15 * 1024 * 1024;

const ZIP_LIMITS_CODES = { maxEntries: 64, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 };

/**
 * `name` (from the JSON body) -> a safe file name, or null. Letters (any
 * script) and digits, plus space, dot, underscore, parens and a hyphen; must
 * end in .xlsx. No path separator or control character can match. The name
 * is only ever used in the text of an error message, never joined into a path.
 */
function sanitizeXlsxFilename(rawName) {
  const name = String(rawName === undefined || rawName === null ? '' : rawName).trim();
  if (!name) return null;
  if (!/^[\p{L}\p{N} ._()-]+$/u.test(name)) return null;
  if (!/\.xlsx$/i.test(name)) return null;
  return name;
}

function dataRootOf(ctx) {
  if (ctx.dataTier0Dir) return ctx.dataTier0Dir;
  if (typeof ctx.dataRepoDir === 'function') {
    const dir = ctx.dataRepoDir('data-tier-0');
    if (dir) return dir;
  }
  return path.join(ctx.rootDir, 'data-sub-repositories', 'ds-data');
}

module.exports = function register(ctx) {
  const repoDir = dataRootOf(ctx);
  const moduleDir = path.join(repoDir, MODULE_SUBDIR);
  const locationsIndexFile = path.join(repoDir, ...LOCATIONS_INDEX);
  const doneDirs = {
    training: path.join(moduleDir, DONE_SUBDIRS.training),
    webinar: path.join(moduleDir, DONE_SUBDIRS.webinar),
  };
  const waveConfigFile = path.join(moduleDir, WAVE_CONFIG_FILE);

  const withLock = ctx.makeLock();
  const importing = { training: false, webinar: false };
  let cache = { key: null, dashboard: null };

  // -- Reading the plaintext tree ---------------------------------------------

  function fourMtimesKey() {
    const files = [locationsIndexFile, path.join(doneDirs.training, 'index.json'), path.join(doneDirs.webinar, 'index.json'), waveConfigFile];
    return files.map((f) => {
      try { return fs.statSync(f).mtimeMs; } catch { return 0; }
    }).join('|');
  }

  /**
   * The locations module's light index. `null` on a missing or malformed
   * file (readJsonSafe never throws), which the caller turns into the
   * `directory: { present: false }` branch.
   * @returns {{metadata: object, rows: object[]}|null}
   */
  function readLocationsIndex() {
    const idx = shardStore.readJsonSafe(locationsIndexFile);
    if (!idx || !Array.isArray(idx.rows)) return null;
    return idx;
  }

  function flattenDoneStores(dir) {
    const { shards } = shardStore.readShardedDir(dir);
    const stores = {};
    for (const payload of shards.values()) {
      if (payload && payload.stores && typeof payload.stores === 'object') Object.assign(stores, payload.stores);
    }
    return stores;
  }

  // One canonical shape for every branch, so the client never has to guess
  // which keys a given answer carries.
  function emptyDashboard(overrides) {
    return {
      available: true,
      storage: 'ok',
      directory: null,
      config: null,
      kpi: null,
      waves: [],
      stores: [],
      diagnostics: null,
      next_start: null,
      generated_at: null,
      ...overrides,
    };
  }

  function buildDashboardPayload() {
    if (!fs.existsSync(repoDir)) {
      return emptyDashboard({ available: false, storage: 'unavailable' });
    }

    const waveConfig = shardStore.readWaveConfigFile(waveConfigFile);
    const configPayload = {
      first_wave_start: waveConfig.firstWaveStart,
      waves_count: waveConfig.wavesCount,
      managers_count: Object.keys(waveConfig.managers || {}).length,
      source: waveConfig.source,
    };

    const directory = readLocationsIndex();
    if (!directory) {
      return emptyDashboard({ directory: { present: false }, config: configPayload });
    }

    const meta = directory.metadata || {};
    const rows = directory.rows;
    const trainingsDone = flattenDoneStores(doneDirs.training);
    const webinarDone = flattenDoneStores(doneDirs.webinar);
    const today = new Date().toISOString().slice(0, 10);

    const { stores, diagnostics } = core.buildStores(rows, waveConfig, trainingsDone, webinarDone, today);
    const dashboard = core.buildDashboard(stores, diagnostics, waveConfig, today, {
      present: true,
      total_rows: meta.row_count || rows.length,
      updated_at: meta.generated_at || null,
      source_file: meta.source_file || null,
    });

    return emptyDashboard({
      generated_at: meta.generated_at || null,
      kpi: dashboard.kpi,
      waves: dashboard.waves,
      next_start: dashboard.next_start,
      diagnostics: dashboard.diagnostics,
      stores: dashboard.stores,
      config: dashboard.config,
      directory: dashboard.directory,
    });
  }

  function getDashboard() {
    const key = fourMtimesKey();
    if (cache.key === key && cache.dashboard) return cache.dashboard;
    const dashboard = buildDashboardPayload();
    cache = { key, dashboard };
    return dashboard;
  }

  function invalidateCache() {
    cache = { key: null, dashboard: null };
  }

  // -- GET /dashboard -----------------------------------------------------

  function handleDashboard(req, res) {
    let dashboard;
    try {
      dashboard = getDashboard();
    } catch (e) {
      ctx.log('dashboard-failed:', e.message);
      ctx.jsonResponse(res, 500, { error: 'dashboard-failed', message: 'Could not build the dashboard data: ' + e.message });
      return;
    }
    const rawUrl = (req && req.url) || '/';
    const lean = new URL(rawUrl, 'http://localhost').searchParams.get('lean') === '1';
    if (lean) {
      const { stores: _stores, ...rest } = dashboard;
      ctx.jsonResponse(res, 200, rest);
      return;
    }
    ctx.jsonResponse(res, 200, dashboard);
  }

  // -- POST /import-training, /import-webinar ------------------------------

  async function handleImport(kind, req, res) {
    if (!fs.existsSync(repoDir)) {
      ctx.jsonResponse(res, 409, {
        error: 'repo-missing',
        message: 'The team data repository is not on this computer - fetch it from the sync panel on the top bar.',
      });
      return;
    }
    if (importing[kind]) {
      ctx.jsonResponse(res, 409, { error: 'busy', message: 'This import is already running.' });
      return;
    }

    let body;
    try {
      body = await ctx.readBody(req, MAX_CODES_UPLOAD_BYTES);
    } catch (e) {
      // ctx.readBody rejects with 'Payload too large (...)' or 'Invalid JSON';
      // a body that never was JSON reads like a workbook this route could not
      // make sense of, so it comes back as 'bad-xlsx'.
      const message = (e && e.message) || '';
      if (message.startsWith('Payload too large')) {
        ctx.jsonResponse(res, 413, { error: 'too-large', message: 'The file is too large - the limit is 10 MB.' });
      } else {
        ctx.jsonResponse(res, 400, { error: 'bad-xlsx', message: 'Could not read the import request.' });
      }
      return;
    }

    const filename = sanitizeXlsxFilename(body && body.name);
    if (!filename) {
      ctx.jsonResponse(res, 400, { error: 'bad-file-name', message: 'Missing or invalid file name (.xlsx only).' });
      return;
    }

    // A missing or non-string file_base64 is a malformed request, not an
    // empty upload; an empty STRING falls through to the zero-length check.
    if (typeof (body && body.file_base64) !== 'string') {
      ctx.jsonResponse(res, 400, { error: 'bad-xlsx', message: 'The file content is missing (file_base64).' });
      return;
    }

    // Buffer.from(..., 'base64') never throws on malformed input; the zip
    // reader below is what rejects garbage, as 'bad-xlsx'.
    const buf = Buffer.from(body.file_base64, 'base64');
    if (!buf.length) {
      ctx.jsonResponse(res, 400, { error: 'empty-file', message: 'The file is empty.' });
      return;
    }

    importing[kind] = true;
    try {
      let readZip;
      try {
        readZip = require(path.join(ctx.rootDir, 'scripts', 'zip.js')).readZip;
      } catch (e) {
        ctx.jsonResponse(res, 500, { error: 'zip-unavailable', message: 'Could not load the zip reader: ' + e.message });
        return;
      }

      let parsed;
      try {
        parsed = xlsxLite.parseFirstSheet(buf, { readZip, limits: ZIP_LIMITS_CODES });
      } catch (e) {
        ctx.jsonResponse(res, 400, { error: 'bad-xlsx', message: 'Could not read the sheet: ' + e.message });
        return;
      }

      const codes = xlsxLite.codesFromColumnA(parsed.rows);
      const directory = readLocationsIndex();
      if (!directory) {
        ctx.jsonResponse(res, 409, {
          error: 'directory-missing',
          message: 'The locations directory is not in the team data yet - pull the latest data from the sync panel and try again.',
        });
        return;
      }

      const knownCodes = new Set(directory.rows.map((r) => String(r.code || '').toUpperCase()).filter(Boolean));
      const doneDir = doneDirs[kind];
      const currentStores = flattenDoneStores(doneDir);
      const importedAt = new Date().toISOString();
      const merged = core.mergeDoneCodes(currentStores, codes, knownCodes, importedAt, 'xlsx');

      const touchedPayloads = new Map();
      for (const prefix of merged.touchedPrefixes) {
        const storesForPrefix = {};
        for (const code of Object.keys(merged.stores)) {
          if (shardStore.prefixOf(code) === prefix) storesForPrefix[code] = merged.stores[code];
        }
        touchedPayloads.set(prefix, { stores: storesForPrefix });
      }

      let result = { written: 0, unchanged: 0, removed: 0, total: 0 };
      if (touchedPayloads.size > 0) {
        result = await withLock(() => shardStore.writeShardedDir(doneDir, touchedPayloads, { dataset: DONE_SUBDIRS[kind] }));
      }

      ctx.jsonResponse(res, 200, { status: 'ok', imported: merged.imported, unknown: merged.unknown, written: result.written });
    } catch (e) {
      ctx.log('import-failed', kind, e.message);
      ctx.jsonResponse(res, 500, { error: 'import-failed', message: 'The import failed: ' + e.message });
    } finally {
      importing[kind] = false;
      invalidateCache();
    }
  }

  return {
    routes: [
      { method: 'GET', path: '/dashboard', handler: handleDashboard },
      { method: 'POST', path: '/import-training', handler: (req, res) => handleImport('training', req, res) },
      { method: 'POST', path: '/import-webinar', handler: (req, res) => handleImport('webinar', req, res) },
    ],
  };
};
