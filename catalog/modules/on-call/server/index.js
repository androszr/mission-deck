'use strict';
// on-call/server/index.js
// register(ctx) mounted under /api/m/on-call/. Three routes:
//   GET /data?month=YYYY-MM  -> index + one month shard
//   GET /status              -> token/config/storage/lastRun probe, no network
//   POST /sync               -> fetch the Confluence page, parse, write shards
//
// createRoutes(ctx, { http, now }) is the testable core - tests inject a
// fake http client (never the network) and a fixed now(). register(ctx)
// wires the real fetch-based client, or null under test mode so the API
// suite can never reach a real wiki.
//
// Data lives under ctx.dataTier0Dir (the plaintext team-data working tree),
// never built from ctx.rootDir plus a hand-joined path.

const fs = require('fs');
const path = require('path');
const { confluenceConfig, pageUrl, fetchPage, defaultHttp } = require('./confluence.js');
const { parseScheduleHtml } = require('./parse-schedule.js');
const { buildShards } = require('./build.js');

const MODULE_SUBDIR = 'on-call';
const MONTHS_SUBDIR = 'months';
const INDEX_FILE = 'index.json';
const RAW_HTML_FILE = 'last-fetch.html';
const LAST_RUN_FILE = 'last-sync.json';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const IS_TEST_MODE = process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function currentYM(now) {
  const d = now();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function readJson(file) {
  try {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function createRoutes(ctx, deps) {
  const http = deps && deps.http;
  const now = (deps && deps.now) || (() => new Date());

  const moduleDir = path.join(ctx.dataTier0Dir, MODULE_SUBDIR);
  const monthsDir = path.join(moduleDir, MONTHS_SUBDIR);
  const indexFile = path.join(moduleDir, INDEX_FILE);
  const rawHtmlFile = path.join(ctx.dataDir, RAW_HTML_FILE);
  const lastRunFile = path.join(ctx.dataDir, LAST_RUN_FILE);

  const withLock = ctx.makeLock();
  let job = { running: false };

  const readIndex = () => readJson(indexFile);
  const readMonthShard = (ym) => readJson(path.join(monthsDir, ym + '.json'));
  const readLastRun = () => readJson(lastRunFile);

  // -- GET /data --------------------------------------------------------------

  function handleData(req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) {
      ctx.jsonResponse(res, 200, { available: false, storage: 'unavailable', months: [], pageUrl: pageUrl(process.env) });
      return;
    }

    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { url = null; }
    const requested = url ? url.searchParams.get('month') : null;
    const ym = requested || currentYM(now);
    if (!MONTH_RE.test(ym)) {
      ctx.jsonResponse(res, 400, { error: 'bad-month', message: 'Invalid month: ' + ym });
      return;
    }

    const index = readIndex();
    if (!index) {
      ctx.jsonResponse(res, 200, { available: false, storage: 'ok', months: [], pageUrl: pageUrl(process.env) });
      return;
    }

    ctx.jsonResponse(res, 200, {
      available: true,
      storage: 'ok',
      index,
      month: readMonthShard(ym),
      months: Array.isArray(index.months) ? index.months : [],
      ym,
      pageUrl: pageUrl(process.env),
    });
  }

  // -- GET /status --------------------------------------------------------------

  function handleStatus(_req, res) {
    const cfg = confluenceConfig(process.env);
    ctx.jsonResponse(res, 200, {
      token: !!cfg.token,
      configured: !!cfg.pageId,
      storage: fs.existsSync(ctx.dataTier0Dir) ? 'ok' : 'unavailable',
      job: { running: job.running },
      lastRun: readLastRun(),
    });
  }

  function recordFailure(error) {
    try { writeJsonAtomic(lastRunFile, { ok: false, at: now().toISOString(), error }); } catch { /* best effort */ }
  }

  // -- POST /sync --------------------------------------------------------------

  async function handleSync(req, res) {
    try { await ctx.readBody(req, 4096); } catch { /* an empty or malformed body is fine - no fields are read from it */ }

    if (!fs.existsSync(ctx.dataTier0Dir)) {
      ctx.jsonResponse(res, 409, {
        error: 'data-missing',
        message: 'The team data repository is not cloned on this computer - clone it from the Sync window in the top bar.',
      });
      return;
    }

    const cfg = confluenceConfig(process.env);
    if (!cfg.token) {
      ctx.jsonResponse(res, 409, {
        error: 'no-confluence-token',
        message: 'Unlock the vault (padlock in the top bar) so Mission Deck can reach Confluence.',
      });
      return;
    }
    if (!cfg.pageId) {
      ctx.jsonResponse(res, 409, {
        error: 'not-configured',
        message: 'Set ONCALL_PAGE_ID in .env to the id of the Confluence page that holds the on-call schedule.',
      });
      return;
    }

    const started = await withLock(() => {
      if (job.running) return false;
      job = { running: true };
      return true;
    });
    if (!started) {
      ctx.jsonResponse(res, 409, { error: 'job-running', message: 'A sync is already running.' });
      return;
    }

    if (!http) {
      job = { running: false };
      ctx.jsonResponse(res, 409, { error: 'test-mode', message: 'Sync is disabled in test mode.' });
      return;
    }

    try {
      const page = await fetchPage({ http, baseUrl: cfg.baseUrl, token: cfg.token, pageId: cfg.pageId });

      fs.mkdirSync(path.dirname(rawHtmlFile), { recursive: true });
      const tmpHtml = rawHtmlFile + '.tmp.' + process.pid;
      fs.writeFileSync(tmpHtml, page.html, 'utf8');
      fs.renameSync(tmpHtml, rawHtmlFile);

      const anchorDate = page.updated ? new Date(page.updated) : now();
      const parsed = parseScheduleHtml(page.html, { anchorDate });

      const generated_at = now().toISOString();
      const meta = {
        generated_at,
        source_url: page.url,
        source_page_id: cfg.pageId,
        source_version: page.version,
        source_updated: page.updated,
        source_title: page.title,
      };
      const built = buildShards(parsed, meta, readIndex());

      if (built.error) {
        job = { running: false };
        writeJsonAtomic(lastRunFile, { ok: false, at: generated_at, error: built.message });
        ctx.jsonResponse(res, 422, { error: built.error, message: built.message });
        return;
      }

      await withLock(() => {
        fs.mkdirSync(monthsDir, { recursive: true });
        for (const ym of Object.keys(built.months)) {
          writeJsonAtomic(path.join(monthsDir, ym + '.json'), built.months[ym]);
        }
        // months on the index is the list of shard files ON DISK after the
        // write - older months this run did not touch stay as history, so
        // the list must be read back, not just merged in memory.
        let onDisk = [];
        try { onDisk = fs.readdirSync(monthsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch { /* first write - handled above */ }
        built.index.months = onDisk;
        writeJsonAtomic(indexFile, built.index);
        writeJsonAtomic(lastRunFile, {
          ok: true,
          at: generated_at,
          entries: parsed.entries.length,
          months: Object.keys(built.months).length,
          warnings: built.index.warnings.length,
        });
      });

      job = { running: false };
      ctx.jsonResponse(res, 200, {
        ok: true,
        months: built.index.months,
        entries: parsed.entries.length,
        roster: built.index.roster.length,
        warnings: built.index.warnings,
        source_version: page.version,
        source_updated: page.updated,
        generated_at,
      });
    } catch (e) {
      job = { running: false };
      const code = (e && e.code) || 'sync-failed';
      if (code === 'confluence-unreachable') {
        recordFailure('confluence-unreachable');
        ctx.jsonResponse(res, 502, {
          error: 'confluence-unreachable',
          message: 'Cannot reach Confluence - check your VPN.',
        });
        return;
      }
      if (code === 'confluence-http') {
        recordFailure('confluence-http ' + e.status);
        ctx.jsonResponse(res, 502, {
          error: 'confluence-http',
          message: 'Confluence answered with HTTP error ' + (e.status || '?') + '.',
        });
        return;
      }
      recordFailure((e && e.message) || 'unknown error');
      ctx.jsonResponse(res, 500, { error: 'sync-failed', message: 'Unexpected sync error: ' + ((e && e.message) || 'unknown error') });
    }
  }

  return {
    routes: [
      { method: 'GET', path: '/data', handler: handleData },
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'POST', path: '/sync', handler: handleSync },
    ],
  };
}

function register(ctx) {
  return createRoutes(ctx, { http: IS_TEST_MODE ? null : defaultHttp(), now: () => new Date() });
}

module.exports = register;
module.exports.createRoutes = createRoutes;
