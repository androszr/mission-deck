'use strict';
// locations/server/index.js
// register(ctx), mounted under /api/m/locations/. Owns locations/ in the team
// data repo (data-tier-0):
//   locations.json        - the full directory, including contact details
//   locations.index.json  - a light index (no phone, no e-mail) plus search_text
//
// Routes:
//   GET  /directory?q=&status=&region=&group=&offset=&limit=  - filtered, paged index
//   GET  /location?code=                                      - one full record
//   GET  /files                                               - file metadata
//   POST /import   { name, file_base64, modified_at? }        - full replace from .xlsx or .csv
//
// Domain logic lives in pure siblings (locations-import.js, xlsx-lite.js);
// json-store.js is the tmp+rename writer. scripts/zip.js is required LAZILY
// inside the import handler - register(ctx) never touches disk (the contract
// test registers this module with a rootDir that does not exist).
//
// The import body is JSON (base64 file) because the host's checkOrigin
// answers 415 to a non-JSON Content-Type on every non-GET route.
//
// This module writes ONLY plaintext in the team data working tree; sending a
// change to the team is a human decision made in the sync panel.

const fs = require('fs');
const path = require('path');

const jsonStore = require('./json-store.js');
const xlsxLite = require('./xlsx-lite.js');
const locImport = require('./locations-import.js');

const MODULE_SUBDIR = 'locations';
const FILE_NAMES = { full: 'locations.json', index: 'locations.index.json' };
const ZIP_LIMITS = { maxEntries: 256, maxFileBytes: 96 * 1024 * 1024, maxTotalBytes: 192 * 1024 * 1024 };
// The user-facing limit is 20 MB of FILE, checked in the browser before
// encoding; base64 inflates by 4/3, so the body cap sits above that.
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const OPEN_STATUS_RE = /^(open|active)$/i;

/**
 * The uploaded file name -> a safe name, or null. Letters (any script),
 * digits, space, dot, underscore, parens and hyphen, ending in .xlsx or
 * .csv. The name is only recorded as metadata, never joined into a path.
 */
function sanitizeUploadName(rawName) {
  const name = String(rawName === undefined || rawName === null ? '' : rawName).trim();
  if (!name) return null;
  if (!/^[\p{L}\p{N} ._()-]+$/u.test(name)) return null;
  if (!/\.(xlsx|csv)$/i.test(name)) return null;
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

function countBy(rows, pick) {
  const counts = new Map();
  for (const r of rows) {
    for (const value of pick(r)) {
      if (value === undefined || value === null || value === '') continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

function register(ctx) {
  const repoDir = dataRootOf(ctx);
  const dir = path.join(repoDir, MODULE_SUBDIR);
  const FILES = { full: path.join(dir, FILE_NAMES.full), index: path.join(dir, FILE_NAMES.index) };

  const withLock = ctx.makeLock();
  let busy = false;
  let indexCache = { key: null, data: null };
  let fullCache = { key: null, byCode: null };

  // -- Reading -----------------------------------------------------------------

  function getIndexData() {
    const key = jsonStore.mtimeOf(FILES.index);
    if (indexCache.key === key && indexCache.data) return indexCache.data;
    const idx = jsonStore.readJsonSafe(FILES.index);
    let data;
    if (!idx || !Array.isArray(idx.rows)) {
      data = { rows: [], facets: { statuses: [], regions: [], groups: [] }, meta: null };
    } else {
      const rows = idx.rows.map(locImport.withVacantManager);
      data = {
        rows,
        facets: {
          statuses: countBy(rows, (r) => [r.status]).sort((a, b) => b.count - a.count),
          regions: countBy(rows, (r) => [r.region]).sort((a, b) => String(a.value).localeCompare(String(b.value), 'en', { numeric: true })),
          groups: countBy(rows, (r) => r.groups || []).sort((a, b) => String(a.value).localeCompare(String(b.value), 'en')),
        },
        meta: idx.metadata || null,
      };
    }
    indexCache = { key, data };
    return data;
  }

  function getFullByCode() {
    const key = jsonStore.mtimeOf(FILES.full);
    if (fullCache.key === key && fullCache.byCode) return fullCache.byCode;
    const full = jsonStore.readJsonSafe(FILES.full);
    const byCode = new Map();
    if (full && Array.isArray(full.rows)) {
      for (const row of full.rows) if (row && row.code) byCode.set(row.code, locImport.withVacantManager(row));
    }
    fullCache = { key, byCode };
    return byCode;
  }

  function invalidateCaches() {
    indexCache = { key: null, data: null };
    fullCache = { key: null, byCode: null };
  }

  // -- GET /directory ----------------------------------------------------------

  function handleDirectory(req, res) {
    if (!fs.existsSync(repoDir)) {
      ctx.jsonResponse(res, 200, { available: false, storage: 'unavailable' });
      return;
    }
    const data = getIndexData();
    if (data.rows.length === 0) {
      ctx.jsonResponse(res, 200, {
        available: true,
        storage: 'ok',
        directory: { present: false },
        facets: data.facets,
        summary: { filtered: 0, total: 0, open_total: 0, inactive_total: 0, status_kinds: 0, cities_filtered: 0 },
        page: { offset: 0, limit: 60, returned: 0, has_more: false },
        rows: [],
      });
      return;
    }

    const params = new URL((req && req.url) || '/', 'http://localhost').searchParams;
    const q = (params.get('q') || '').slice(0, 200);
    const status = params.get('status') || '';
    const region = params.get('region') || '';
    const group = params.get('group') || '';
    let offset = parseInt(params.get('offset'), 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    let limit = parseInt(params.get('limit'), 10);
    if (!Number.isFinite(limit)) limit = 60;
    limit = Math.min(200, Math.max(1, limit));

    const tokens = q ? locImport.normalize(q).split(' ').filter(Boolean) : [];
    let filtered = data.rows;
    if (tokens.length) filtered = filtered.filter((r) => tokens.every((t) => (r.search_text || '').includes(t)));
    if (status) filtered = filtered.filter((r) => r.status === status);
    if (region) filtered = filtered.filter((r) => String(r.region) === region);
    if (group) filtered = filtered.filter((r) => (r.groups || []).includes(group));

    const openTotal = data.rows.filter((r) => OPEN_STATUS_RE.test(r.status || '')).length;
    const pageRows = filtered.slice(offset, offset + limit).map((r) => {
      const row = { ...r };
      delete row.search_text;
      return row;
    });

    ctx.jsonResponse(res, 200, {
      available: true,
      storage: 'ok',
      directory: {
        present: true,
        row_count: data.rows.length,
        source_file: (data.meta && data.meta.source_file) || null,
        generated_at: (data.meta && data.meta.generated_at) || null,
      },
      facets: data.facets,
      summary: {
        filtered: filtered.length,
        total: data.rows.length,
        open_total: openTotal,
        inactive_total: data.rows.length - openTotal,
        status_kinds: new Set(filtered.map((r) => r.status)).size,
        cities_filtered: new Set(filtered.map((r) => r.city).filter(Boolean)).size,
      },
      page: { offset, limit, returned: pageRows.length, has_more: offset + pageRows.length < filtered.length },
      rows: pageRows,
    });
  }

  // -- GET /location -----------------------------------------------------------

  function handleLocation(req, res) {
    const params = new URL((req && req.url) || '/', 'http://localhost').searchParams;
    const code = (params.get('code') || '').toUpperCase();
    if (!/^[A-Z0-9_-]{1,32}$/.test(code)) {
      ctx.jsonResponse(res, 400, { error: 'bad-code', message: 'Invalid location code.' });
      return;
    }
    const byCode = getFullByCode();
    if (byCode.size === 0) {
      ctx.jsonResponse(res, 409, {
        error: 'directory-missing',
        message: 'The locations directory is not in the team data yet - pull the latest data from the sync panel and try again.',
      });
      return;
    }
    const location = byCode.get(code);
    if (!location) {
      ctx.jsonResponse(res, 404, { error: 'location-not-found', message: 'Location ' + code + ' was not found.' });
      return;
    }
    ctx.jsonResponse(res, 200, { location });
  }

  // -- GET /files --------------------------------------------------------------

  function handleFiles(_req, res) {
    if (!fs.existsSync(repoDir)) {
      ctx.jsonResponse(res, 200, { available: false, files: {} });
      return;
    }
    const full = jsonStore.readJsonSafe(FILES.full);
    const idx = jsonStore.readJsonSafe(FILES.index);
    let info = { present: false, bytes: 0, updated_at: null, source_file: null, total_rows: null };
    if (full || idx) {
      const meta = (full && full.metadata) || {};
      const idxMeta = (idx && idx.metadata) || {};
      const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
      info = {
        present: true,
        bytes: size(FILES.full) + size(FILES.index),
        updated_at: meta.updated_at || idxMeta.generated_at || null,
        source_file: meta.source_file || idxMeta.source_file || null,
        total_rows: meta.total_rows !== undefined ? meta.total_rows : (idxMeta.row_count !== undefined ? idxMeta.row_count : null),
      };
    }
    ctx.jsonResponse(res, 200, { available: true, files: { directory: info } });
  }

  // -- POST /import ------------------------------------------------------------

  async function handleImport(req, res) {
    if (!fs.existsSync(repoDir)) {
      ctx.jsonResponse(res, 409, {
        error: 'repo-missing',
        message: 'The team data repository is not on this computer - fetch it from the sync panel.',
      });
      return;
    }
    if (busy) {
      ctx.jsonResponse(res, 409, { error: 'busy', message: 'Another import is already running.' });
      return;
    }

    let body;
    try {
      body = await ctx.readBody(req, MAX_BODY_BYTES);
    } catch (e) {
      if (((e && e.message) || '').startsWith('Payload too large')) {
        ctx.jsonResponse(res, 413, { error: 'too-large', message: 'The file is too large.' });
      } else {
        ctx.jsonResponse(res, 400, { error: 'bad-request', message: 'Could not read the import request.' });
      }
      return;
    }

    const filename = sanitizeUploadName(body && body.name);
    if (!filename) {
      ctx.jsonResponse(res, 400, { error: 'bad-file-name', message: 'Missing or invalid file name (.xlsx or .csv).' });
      return;
    }
    if (typeof (body && body.file_base64) !== 'string') {
      ctx.jsonResponse(res, 400, { error: 'bad-file', message: 'The file content is missing (file_base64).' });
      return;
    }
    const buf = Buffer.from(body.file_base64, 'base64');
    if (!buf.length) {
      ctx.jsonResponse(res, 400, { error: 'empty-file', message: 'The file is empty.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const sourceModIso = typeof body.modified_at === 'number' ? new Date(body.modified_at).toISOString() : nowIso;

    busy = true;
    try {
      let rows;
      if (/\.csv$/i.test(filename)) {
        rows = locImport.parseCsv(buf.toString('utf8'));
      } else {
        let readZip;
        try {
          readZip = require(path.join(ctx.rootDir, 'scripts', 'zip.js')).readZip;
        } catch (e) {
          ctx.jsonResponse(res, 500, { error: 'zip-unavailable', message: 'Could not load the zip reader: ' + e.message });
          return;
        }
        try {
          rows = xlsxLite.parseFirstSheet(buf, { readZip, limits: ZIP_LIMITS }).rows;
        } catch (e) {
          ctx.jsonResponse(res, 400, { error: 'bad-file', message: 'This is not a readable .xlsx file: ' + e.message });
          return;
        }
      }

      const built = locImport.buildLocations(rows);
      if (!built.ok) {
        const messages = {
          'header-not-found': 'No header row with a "Code" column was found in the first 10 rows.',
          'missing-columns': 'Required columns are missing.',
          'no-rows': 'The file has no location rows.',
        };
        ctx.jsonResponse(res, 400, { error: built.error, message: messages[built.error], missing: built.missing || [] });
        return;
      }

      const { full, index } = locImport.buildPayloads(built.locations, built.warnings, { sourceFile: filename, nowIso, sourceModIso });
      const result = await withLock(async () => ({
        full: jsonStore.writeJsonIfChanged(FILES.full, full),
        index: jsonStore.writeJsonIfChanged(FILES.index, index),
      }));
      ctx.jsonResponse(res, 200, {
        ok: true,
        total_rows: built.locations.length,
        warnings: built.warnings,
        written: result.full.status === 'written' || result.index.status === 'written',
      });
    } catch (e) {
      ctx.log('import-failed', e.message);
      ctx.jsonResponse(res, 500, { error: 'import-failed', message: 'The import failed: ' + e.message });
    } finally {
      busy = false;
      invalidateCaches();
    }
  }

  return {
    routes: [
      { method: 'GET', path: '/directory', handler: handleDirectory },
      { method: 'GET', path: '/location', handler: handleLocation },
      { method: 'GET', path: '/files', handler: handleFiles },
      { method: 'POST', path: '/import', handler: handleImport },
    ],
  };
}

module.exports = register;
module.exports.sanitizeUploadName = sanitizeUploadName;
