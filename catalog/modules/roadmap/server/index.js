'use strict';
// modules/roadmap/server/index.js
// Routes under /api/m/roadmap/. The two GET list routes list
// <team data>/discovery-tasks/dt-<id>.json, parse, fill defaults and sort by
// `rank`. Stage 2 adds Jira synchronisation: Jira is only READ (jira.js)
// and the sync writes through writeSyncPatch() below - four fields
// (jiraTasks, jiraUnmatched, epicFields, deliveryEpics) of one existing file,
// in a stable byte format. No query parameter or body field ever reaches a
// file path.
// Stage 3 adds two more writers - POST /update (a strict whitelist: RAG, stages,
// three dates, four people) and POST /reorder (`rank`); all three writers go
// through the single writeInitiativeFile() under ONE lock. POST /delete removes one
// file via removeInitiativeFile(), under the same lock.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { teamDataDir, discoveryTasksDir, storageState } = require('./paths.js');
const jira = require('./jira.js');
const kanbanRoutes = require('./kanban.js');
const widgetRoute = require('./widget.js');

// Evaluated per call (tests flip it); same definition as the core's IS_TEST_MODE.
function isTestMode() {
  return process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';
}

// Tests inject a fake http client here; production uses the fetch-based one.
let _httpOverride = null;
const SYNC_FIELDS = ['jiraTasks', 'jiraUnmatched', 'epicFields', 'deliveryEpics'];

// Every dt-*.json counts, including hand-seeded ids like dt-seed-001. Names come from readdirSync (basenames
// only) and the charset excludes separators and dots, so no path escapes.
const FILE_RE = /^dt-[A-Za-z0-9_-]+\.json$/;

// Initiative id as sent by the client (never a path; the file comes from findRaw()).
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

// The 10 task ids live in client/helpers.js (one source for server and view).
let _helpersP = null;
function _helpers() {
  if (!_helpersP) _helpersP = import(pathToFileURL(path.join(__dirname, '..', 'client', 'helpers.js')).href);
  return _helpersP;
}

// The Kanban tab's pure helpers (columns, whitelisted Jira values, validation) - same file as the view.
let _kanbanHelpersP = null;
function _kanbanHelpers() {
  if (!_kanbanHelpersP) _kanbanHelpersP = import(pathToFileURL(path.join(__dirname, '..', 'client', 'kanban-helpers.js')).href);
  return _kanbanHelpersP;
}

function rehydrateDefaults(init, allTaskIds) {
  if (!Array.isArray(init.taskScope) || init.taskScope.length === 0) init.taskScope = allTaskIds.slice();
  if (!Array.isArray(init.jiraTasks)) init.jiraTasks = [];
  if (typeof init.appliesTo !== 'string') init.appliesTo = '';
  if (!Array.isArray(init.links)) init.links = [];
  if (!Array.isArray(init.jiraUnmatched)) init.jiraUnmatched = [];
  if (init.vmoName === undefined) init.vmoName = null;
  if (!Array.isArray(init.deliveryEpics)) init.deliveryEpics = [];
  if (init.ragStatus === undefined) init.ragStatus = null;
  if (!Array.isArray(init.comments)) init.comments = [];
  if (!Array.isArray(init.stageStatus)) init.stageStatus = [];
  return init;
}

const UNAVAILABLE_MESSAGE = 'Team data has not been downloaded to this computer yet - pull the Team data source in the Sync window.';

// Per-person shards of the time-log module; the first layout that exists wins.
const TIME_LOG_DIRS = [['time-log', 'people'], ['time-log', 'persons']];

/** Pure read of <tier0>/time-log/people/*.json (exported as register.readAllWorklogs for tests). */
function readAllWorklogs(tier0Dir) {
  const out = { available: false, worklogs: {} };
  if (!tier0Dir) return out;
  const dir = TIME_LOG_DIRS.map((p) => path.join(tier0Dir, ...p))
    .find((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  if (!dir) return out;
  let files;
  try { files = fs.readdirSync(dir).filter((f) => /^[a-z0-9][a-z0-9._-]*\.json$/i.test(f)); } catch { return out; }
  for (const f of files) {
    let shard;
    try { shard = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!shard || typeof shard.name !== 'string' || !Array.isArray(shard.days)) continue;
    out.available = true;
    for (const day of shard.days) {
      if (!day || typeof day.date !== 'string' || !Array.isArray(day.issues)) continue;
      const entries = day.issues
        .filter((i) => i && typeof i.key === 'string' && Number(i.hours) > 0)
        .map((i) => ({ issueKey: i.key, summary: typeof i.summary === 'string' ? i.summary : '', seconds: Math.round(Number(i.hours) * 3600) }));
      if (entries.length > 0) (out.worklogs[shard.name] = out.worklogs[shard.name] || {})[day.date] = entries;
    }
  }
  return out;
}

module.exports = function register(ctx) {
  const rootDir = ctx.rootDir;

  function unavailable(res) {
    ctx.jsonResponse(res, 409, { error: 'storage-unavailable', message: UNAVAILABLE_MESSAGE });
  }

  function listFiles() {
    try {
      return fs.readdirSync(discoveryTasksDir(rootDir)).filter((f) => FILE_RE.test(f));
    } catch {
      return [];
    }
  }

  function handleStatus(_req, res) {
    const state = storageState(rootDir);
    ctx.jsonResponse(res, 200, { storage: state, count: state === 'ok' ? listFiles().length : 0 });
  }

  async function handleInitiatives(_req, res) {
    if (storageState(rootDir) !== 'ok') return unavailable(res);
    let allTaskIds;
    try {
      const helpers = await _helpers();
      allTaskIds = helpers.ALL_TASK_IDS;
    } catch (e) {
      ctx.log('helpers import failed: ' + e.message);
      return ctx.jsonResponse(res, 500, { error: 'internal', message: 'Could not load the initiatives.' });
    }
    const dir = discoveryTasksDir(rootDir);
    const initiatives = [];
    const skipped = [];
    for (const file of listFiles()) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.id) throw new Error('no id');
        initiatives.push(rehydrateDefaults(parsed, allTaskIds));
      } catch (e) {
        skipped.push(file);
        ctx.log('skipped ' + file + ': ' + e.message);
      }
    }
    initiatives.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    ctx.jsonResponse(res, 200, { storage: 'ok', initiatives, count: initiatives.length, skipped });
  }

  // READ-ONLY. Slim answer for the dashboard tile (server/widget.js): top 5 by
  // `rank`, closed shape, no files written. Same storage semantics as /initiatives.
  function handleWidget(_req, res) {
    if (storageState(rootDir) !== 'ok') return unavailable(res);
    ctx.jsonResponse(res, 200, widgetRoute.buildWidget(discoveryTasksDir(rootDir)));
  }

  // READ-ONLY. Optional pre-fetched Tempo worklogs of the activity strip in
  // <team data>/discovery-tasks-tempo.json. A missing or broken file is an
  // empty structure, never an error.
  async function handleTempo(_req, res) {
    if (storageState(rootDir) !== 'ok') return unavailable(res);
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(teamDataDir(rootDir), 'discovery-tasks-tempo.json'), 'utf8'));
    } catch {
      raw = null;
    }
    try {
      const helpers = await _helpers();
      ctx.jsonResponse(res, 200, helpers.normalizeTempo(raw));
    } catch (e) {
      ctx.log('helpers import failed: ' + e.message);
      ctx.jsonResponse(res, 500, { error: 'internal', message: 'Could not load the logged time.' });
    }
  }

  // READ-ONLY. All logged time per person from the time-log module's data in
  // the team data (ctx.dataTier0Dir/time-log/people/<slug>.json), reshaped like the
  // Tempo file: { name: { date: [{ issueKey, summary, seconds }] } }. Missing or
  // broken data is { available: false, worklogs: {} }, never an error.
  async function handleWorklogs(_req, res) {
    ctx.jsonResponse(res, 200, readAllWorklogs(ctx.dataTier0Dir));
  }

  // ---- Jira synchronisation (stage 2) --------------------------------------

  const withLock = ctx.makeLock();
  let syncAllRunning = false;

  function httpClient() { return _httpOverride || jira.defaultHttp(); }

  function sendJiraError(res, e) {
    if (e && e.code === 'no-token') {
      return ctx.jsonResponse(res, 503, { error: 'no-token', message: 'No Jira token - unlock the Bitwarden vault in the top bar and try again.' });
    }
    if (e && e.code === 'personal-token-required') {
      return ctx.jsonResponse(res, 409, { error: 'personal-token-required', message: 'Changes in Jira need your personal token - unlock the Bitwarden vault in the top bar. The technical account may not change anything.' });
    }
    if (e && (e.status === 401 || e.status === 403)) {
      return ctx.jsonResponse(res, 503, { error: 'token-unauthorized', message: 'Jira refused access - first check that you are on the VPN, then that the token in the Bitwarden vault is current.' });
    }
    if (e && e.status !== undefined) {
      return ctx.jsonResponse(res, 502, { error: 'jira-error', message: 'Jira answered with HTTP error ' + e.status + '.' });
    }
    ctx.log('jira call failed: ' + String((e && e.message) || e).slice(0, 200));
    return ctx.jsonResponse(res, 502, { error: 'jira-unreachable', message: 'Could not connect to Jira - check the VPN and try again.' });
  }

  function jiraCfg() {
    const cfg = jira.jiraConfig(process.env);
    if (!cfg.ok) throw Object.assign(new Error('no token'), { code: 'no-token' });
    return cfg;
  }

  // Every Jira WRITE of the module goes through this: the technical token may read, never author a change.
  function jiraWriteCfg() {
    const cfg = jiraCfg();
    if (cfg.source !== 'personal') throw Object.assign(new Error('personal token required'), { code: 'personal-token-required' });
    return cfg;
  }

  /** Locates the RAW file of an initiative by its id (never rehydrated). */
  function findRaw(id) {
    const dir = discoveryTasksDir(rootDir);
    for (const file of listFiles()) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.id === id) return { file: path.join(dir, file), raw };
      } catch { /* a broken file is skipped like in the list */ }
    }
    return null;
  }

  // THE ONLY FILE WRITE of this module (tmp + rename), in a stable format
  // (2-space JSON plus a newline); `file` always comes from findRaw()/listFiles().
  function writeInitiativeFile(file, raw) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    return raw;
  }

  // THE ONLY FILE REMOVAL of this module: one existing dt-<id>.json, `file` always
  // from findRaw(). Other files (and their `rank`) are never touched.
  function removeInitiativeFile(file) {
    fs.unlinkSync(file);
  }

  // Touches the four sync fields of one existing file; every other key keeps
  // its value and position, new keys append.
  function writeSyncPatch(file, raw, patch) {
    for (const k of SYNC_FIELDS) raw[k] = patch[k];
    return writeInitiativeFile(file, raw);
  }

  /** Raw parsed initiative files for the Kanban lanes; [] without data (the board then has one "Other" lane). */
  function readInitiatives() {
    if (storageState(rootDir) !== 'ok') return [];
    const dir = discoveryTasksDir(rootDir);
    const out = [];
    for (const file of listFiles()) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.id) out.push(raw);
      } catch { /* a broken file is skipped like in the list */ }
    }
    return out;
  }

  function rehydrated(raw, allTaskIds) { return rehydrateDefaults(JSON.parse(JSON.stringify(raw)), allTaskIds); }

  /** One initiative: read raw, fetch, merge, write. Throws coded errors. */
  async function syncOne(id, cfg) {
    const found = findRaw(id);
    if (!found) throw Object.assign(new Error('not found'), { code: 'not-found' });
    const ticket = typeof found.raw.ticket === 'string' ? found.raw.ticket.trim().toUpperCase() : '';
    if (!jira.KEY_RE.test(ticket)) throw Object.assign(new Error('no ticket'), { code: 'no-ticket' });
    const data = await jira.fetchSyncData({ http: httpClient(), cfg, epic: ticket, existingDeliveryEpics: found.raw.deliveryEpics });
    return withLock(async () => {
      // Re-read under the lock: the file may have changed while Jira answered.
      const fresh = findRaw(id) || found;
      const patch = jira.buildSyncPatch(fresh.raw, data);
      const raw = writeSyncPatch(fresh.file, fresh.raw, patch);
      const helpers = await _helpers();
      return {
        ticket,
        initiative: rehydrated(raw, helpers.ALL_TASK_IDS),
        counts: {
          tasks: patch.jiraTasks.filter((t) => t && t.key).length,
          unmatched: patch.jiraUnmatched.length,
          deliveryEpics: patch.deliveryEpics.length,
        },
      };
    });
  }

  function gate(res) {
    if (isTestMode()) {
      ctx.jsonResponse(res, 409, { error: 'test-mode', message: 'Jira sync is disabled in test mode.' });
      return false;
    }
    return true;
  }

  async function handleJiraSync(req, res) {
    if (!gate(res)) return;
    let body;
    try { body = await ctx.readBody(req); } catch { body = null; }
    const id = body && typeof body.id === 'string' ? body.id : '';
    if (!id) return ctx.jsonResponse(res, 400, { error: 'bad-request', message: 'Missing initiative id.' });
    if (storageState(rootDir) !== 'ok') return unavailable(res);
    if (!findRaw(id)) return ctx.jsonResponse(res, 404, { error: 'not-found', message: 'No such initiative.' });
    try {
      const cfg = jiraCfg();
      const r = await syncOne(id, cfg);
      ctx.jsonResponse(res, 200, { ok: true, initiative: r.initiative, counts: r.counts });
    } catch (e) {
      if (e && e.code === 'no-ticket') {
        return ctx.jsonResponse(res, 400, { error: 'no-ticket', message: 'The initiative has no Jira epic key.' });
      }
      if (e && e.code === 'not-found') return ctx.jsonResponse(res, 404, { error: 'not-found', message: 'No such initiative.' });
      sendJiraError(res, e);
    }
  }

  async function handleJiraSyncAll(_req, res) {
    if (!gate(res)) return;
    if (storageState(rootDir) !== 'ok') return unavailable(res);
    if (syncAllRunning) return ctx.jsonResponse(res, 409, { error: 'busy', message: 'A Jira sync is already running.' });
    let cfg;
    try { cfg = jiraCfg(); } catch (e) { return sendJiraError(res, e); }
    syncAllRunning = true;
    try {
      const results = [];
      const targets = [];
      for (const file of listFiles()) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(discoveryTasksDir(rootDir), file), 'utf8'));
          if (raw && raw.id && typeof raw.ticket === 'string' && jira.KEY_RE.test(raw.ticket.trim().toUpperCase())) {
            targets.push({ id: raw.id, ticket: raw.ticket.trim().toUpperCase(), rank: raw.rank });
          }
        } catch { /* skipped */ }
      }
      targets.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      let aborted = null;
      for (const t of targets) {
        if (aborted) { results.push({ id: t.id, ticket: t.ticket, ok: false, error: aborted }); continue; }
        try {
          await syncOne(t.id, cfg);
          results.push({ id: t.id, ticket: t.ticket, ok: true });
        } catch (e) {
          const fatal = e && (e.status === 401 || e.status === 403);
          const unreachable = e && e.status === undefined && !e.code;
          const msg = fatal ? 'token-unauthorized' : unreachable ? 'jira-unreachable' : (e && e.status ? 'jira-error' : String((e && e.code) || 'error'));
          results.push({ id: t.id, ticket: t.ticket, ok: false, error: msg });
          if (fatal || unreachable) aborted = msg;
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      ctx.jsonResponse(res, 200, { ok: okCount === results.length, results, totals: { total: results.length, ok: okCount, failed: results.length - okCount } });
    } finally {
      syncAllRunning = false;
    }
  }

  // ---- Inline editing and ordering (stage 3) -------------------------------

  function writeGate(res) {
    if (isTestMode()) {
      ctx.jsonResponse(res, 409, { error: 'test-mode', message: 'Saving is disabled in test mode.' });
      return false;
    }
    return true;
  }

  async function handleUpdate(req, res) {
    if (!writeGate(res)) return;
    let body;
    try { body = await ctx.readBody(req); } catch { body = null; }
    const id = body && typeof body.id === 'string' ? body.id : '';
    if (!id) return ctx.jsonResponse(res, 400, { error: 'bad-request', message: 'Missing initiative id.' });
    const helpers = await _helpers();
    const v = helpers.validateInitiativePatch(body.patch);
    if (!v.ok) return ctx.jsonResponse(res, 400, { error: 'bad-patch', message: v.message });
    if (storageState(rootDir) !== 'ok') return unavailable(res);
    return withLock(async () => {
      const found = findRaw(id);
      if (!found) return ctx.jsonResponse(res, 404, { error: 'not-found', message: 'No such initiative.' });
      // Existing keys keep their position, missing ones append.
      for (const k of Object.keys(v.patch)) found.raw[k] = v.patch[k];
      try {
        writeInitiativeFile(found.file, found.raw);
      } catch (e) {
        ctx.log('update write failed: ' + e.message);
        return ctx.jsonResponse(res, 500, { error: 'write-failed', message: 'Could not save the change.' });
      }
      return ctx.jsonResponse(res, 200, { ok: true, initiative: rehydrated(found.raw, helpers.ALL_TASK_IDS) });
    });
  }

  async function handleReorder(req, res) {
    if (!writeGate(res)) return;
    let body;
    try { body = await ctx.readBody(req); } catch { body = null; }
    const order = body && body.order;
    if (storageState(rootDir) !== 'ok') return unavailable(res);
    const helpers = await _helpers();
    return withLock(async () => {
      const dir = discoveryTasksDir(rootDir);
      const entries = [];
      for (const file of listFiles()) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.id) entries.push({ file: path.join(dir, file), raw });
        } catch { /* a broken file is skipped like in the list */ }
      }
      const plan = helpers.computeReorder(entries.map((e) => e.raw), order);
      if (!plan.ok) return ctx.jsonResponse(res, 400, { error: 'bad-order', message: plan.message });
      const pos = new Map(plan.changes.map((c) => [c.id, c.rank]));
      try {
        for (const e of entries) {
          if (!pos.has(e.raw.id)) continue; // only files whose number really changes are rewritten
          e.raw.rank = pos.get(e.raw.id);
          writeInitiativeFile(e.file, e.raw);
        }
      } catch (err) {
        ctx.log('reorder write failed: ' + err.message);
        return ctx.jsonResponse(res, 500, { error: 'write-failed', message: 'Could not save the order.' });
      }
      const initiatives = entries.map((e) => rehydrated(e.raw, helpers.ALL_TASK_IDS));
      initiatives.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      return ctx.jsonResponse(res, 200, { ok: true, changed: plan.changes.length, initiatives });
    });
  }

  async function handleDelete(req, res) {
    if (!writeGate(res)) return;
    let body;
    try { body = await ctx.readBody(req); } catch { body = null; }
    const id = body && typeof body.id === 'string' ? body.id : '';
    if (!ID_RE.test(id)) return ctx.jsonResponse(res, 400, { error: 'bad-request', message: 'Missing a valid initiative id.' });
    if (storageState(rootDir) !== 'ok') return unavailable(res);
    return withLock(async () => {
      const found = findRaw(id);
      if (!found) return ctx.jsonResponse(res, 404, { error: 'not-found', message: 'No such initiative.' });
      try {
        removeInitiativeFile(found.file);
      } catch (e) {
        ctx.log('delete failed: ' + e.message);
        return ctx.jsonResponse(res, 500, { error: 'write-failed', message: 'Could not delete the initiative.' });
      }
      return ctx.jsonResponse(res, 200, { ok: true, id });
    });
  }

  async function handleEpicChildren(req, res) {
    if (!gate(res)) return;
    let key = '';
    try { key = (new URL(req.url, 'http://localhost').searchParams.get('key') || '').trim().toUpperCase(); } catch { key = ''; }
    if (!jira.KEY_RE.test(key)) {
      return ctx.jsonResponse(res, 400, { error: 'bad-key', message: 'The epic key must look like PROD-123.' });
    }
    try {
      const cfg = jiraCfg();
      const issues = await jira.fetchEpicChildren({ http: httpClient(), cfg, key });
      ctx.jsonResponse(res, 200, issues);
    } catch (e) {
      sendJiraError(res, e);
    }
  }

  async function handleFieldId(req, res) {
    if (!gate(res)) return;
    let name = '';
    try { name = (new URL(req.url, 'http://localhost').searchParams.get('name') || '').trim(); } catch { name = ''; }
    if (!name || name.length > 80) {
      return ctx.jsonResponse(res, 400, { error: 'bad-name', message: 'Enter a Jira field name.' });
    }
    try {
      const field = await jira.fetchFieldId({ http: httpClient(), cfg: jiraCfg(), name });
      if (!field) return ctx.jsonResponse(res, 404, { error: 'unknown-field', message: 'Jira has no field with this name.' });
      ctx.jsonResponse(res, 200, field);
    } catch (e) {
      sendJiraError(res, e);
    }
  }

  async function handleTransition(req, res) {
    if (!gate(res)) return;
    let body;
    try { body = await ctx.readBody(req); } catch { body = null; }
    const key = body && typeof body.key === 'string' ? body.key.trim().toUpperCase() : '';
    const to = body && typeof body.to === 'string' ? body.to.trim() : '';
    if (!jira.KEY_RE.test(key) || !to || to.length > 60) {
      return ctx.jsonResponse(res, 400, { error: 'bad-request', message: 'Enter the issue key and the target status.' });
    }
    try {
      const r = await jira.transitionIssue({ http: httpClient(), cfg: jiraWriteCfg(), key, target: to });
      if (!r.done && !r.already) {
        return ctx.jsonResponse(res, 409, { error: 'no-transition', key, from: r.from, available: r.available, message: 'There is no transition from "' + r.from + '" to "' + to + '".' });
      }
      ctx.log('jira transition ' + key + ': ' + r.from + ' -> ' + (r.to || r.from));
      ctx.jsonResponse(res, 200, { ok: true, key, ...r });
    } catch (e) {
      if (e && e.status === 400) {
        return ctx.jsonResponse(res, 400, { error: 'jira-rejected', key, message: 'Jira rejected the status change.', detail: e.detail || '' });
      }
      sendJiraError(res, e);
    }
  }

  const kanban = kanbanRoutes({
    ctx, isTestMode, httpClient, jiraConfig: () => jira.jiraConfig(process.env), jiraCfg, jiraWriteCfg, sendJiraError, readInitiatives, kanbanHelpers: _kanbanHelpers,
  });

  return {
    routes: [
      ...kanban,
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'GET', path: '/initiatives', handler: handleInitiatives },
      { method: 'GET', path: '/widget', handler: handleWidget },
      { method: 'GET', path: '/tempo', handler: handleTempo },
      { method: 'GET', path: '/worklogs', handler: handleWorklogs },
      { method: 'POST', path: '/jira-sync', handler: handleJiraSync },
      { method: 'POST', path: '/jira-sync-all', handler: handleJiraSyncAll },
      { method: 'POST', path: '/update', handler: handleUpdate },
      { method: 'POST', path: '/reorder', handler: handleReorder },
      { method: 'POST', path: '/delete', handler: handleDelete },
      { method: 'GET', path: '/jira/epic-children', handler: handleEpicChildren },
      { method: 'GET', path: '/jira/field-id', handler: handleFieldId },
      { method: 'POST', path: '/jira/transition', handler: handleTransition },
    ],
  };
};

module.exports.readAllWorklogs = readAllWorklogs;
module.exports._setHttpForTests = (h) => { _httpOverride = h; };
