'use strict';
// modules/gantt-roadmap/server/index.js
// register(ctx) mounts all CRUD routes for the gantt-roadmap module under
// /api/m/gantt-roadmap/. Identifiers live in the query string; none from the
// request body or query string is ever joined into a file path without
// validation in store.js.
//
// checkOrigin for non-GET methods is applied by the CORE dispatcher
// (handleModuleRoute) before any handler here runs — do NOT call
// ctx.checkOrigin() again.

const path = require('path');
const { pathToFileURL } = require('url');

const store = require('./store.js');
const { buildWidgetPayload } = require('./widget.js');
const { storageState, useCoreResolver } = require('./paths.js');

const READ_BODY_MAX = 64 * 1024; // 64 KB

// The one list of area colors lives in client/gantt.js (the swatch picker reads
// it too); the server never keeps a second copy, or a new swatch reads as
// invalid-color here.
let _ganttModP = null;
function _ganttMod() {
  if (!_ganttModP) _ganttModP = import(pathToFileURL(path.join(__dirname, '..', 'client', 'gantt.js')).href);
  return _ganttModP;
}
async function _areaColors() {
  return (await _ganttMod()).AREA_COLORS;
}

function parseQuery(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

function unavailableResponse(ctx, res) {
  ctx.jsonResponse(res, 409, {
    error: 'storage-unavailable',
    message: 'Team data has not been downloaded to this computer yet - pull the Team data source in the Sync window.',
  });
}

async function readBody(ctx, req) {
  const invalid = { error: { status: 400, payload: { error: 'invalid-json', message: 'The request body is not valid JSON.' } } };
  let body;
  try {
    body = await ctx.readBody(req, READ_BODY_MAX);
  } catch {
    return invalid;
  }
  // `null`, an array or a number are valid JSON too; every handler reads
  // fields off a plain object, so anything else is refused here once.
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid;
  return { body };
}

// Validation codes PUT /task may answer 400 with: normRow's, plus the area
// check. Anything else (a disk error) is a real failure, never a 400.
const PUT_TASK_VALIDATION_CODES = new Set([
  'area-not-found', 'invalid-title', 'invalid-s', 'invalid-l', 'invalid-who',
  'invalid-ph', 'invalid-area', 'invalid-o',
]);

function notFound(ctx, res, msg) {
  ctx.jsonResponse(res, 404, { error: 'not-found', message: msg || 'Not found.' });
}

function badRequest(ctx, res, code, msg) {
  ctx.jsonResponse(res, 400, { error: code, message: msg });
}

function register(ctx) {
  useCoreResolver(ctx);
  const withLock = ctx.makeLock();
  const rootDir = ctx.rootDir;

  // ---- GET /status --------------------------------------------------------
  async function handleStatus(req, res) {
    const state = storageState(rootDir);
    const index = state === 'ok' ? store.readIndex(rootDir) : null;
    ctx.jsonResponse(res, 200, {
      storage: state,
      activeQuarter: (index && index.activeQuarter) || null,
      quarters: (index && index.quarters) || [],
    });
  }

  // ---- GET /quarter -------------------------------------------------------
  async function handleGetQuarter(req, res) {
    const q = parseQuery(req);
    const qId = q.get('id');
    if (!qId) return badRequest(ctx, res, 'missing-id', 'Missing quarter id parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);
    try {
      // Pass the ONE shared withLock so duplicate-fix persists through the same
      // lock chain as all writes. This handler is NOT inside withLock — safe.
      const data = await store.readQuarter(rootDir, qId, { log: ctx.log, withLock });
      ctx.jsonResponse(res, 200, data);
    } catch (e) {
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      throw e;
    }
  }

  // ---- GET /widget --------------------------------------------------------
  // Dashboard tile: this week's aggregates. READ-ONLY by design - no lock, no
  // write, no duplicate repair (that is what makes /quarter unfit for a tile
  // fetched on every dashboard visit).
  function handleWidget(_req, res) {
    ctx.jsonResponse(res, 200, buildWidgetPayload(rootDir));
  }

  // ---- POST /task ---------------------------------------------------------
  async function handlePostTask(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    if (!qId) return badRequest(ctx, res, 'missing-qid', 'Missing qid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    const { body, error } = await readBody(ctx, req);
    if (error) return ctx.jsonResponse(res, error.status, error.payload);

    // validate area exists
    let meta;
    try {
      meta = store.readQuarterMeta(rootDir, qId);
    } catch (e) {
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      throw e;
    }
    if (!meta) return notFound(ctx, res, 'The quarter does not exist.');

    const areas = store.listAreas(rootDir, qId);
    const areaExists = areas.some((a) => a.id === body.a);
    if (!areaExists) return badRequest(ctx, res, 'area-not-found', 'The area does not exist: ' + body.a);

    let task;
    try {
      await withLock(async () => {
        task = store.createTask(rootDir, qId, body, meta.weeksN || 14);
      });
    } catch (e) {
      if (e.code === 'bad-id' || e.code === 'invalid-title' || e.code === 'invalid-area') {
        return badRequest(ctx, res, e.code, e.message);
      }
      throw e;
    }
    ctx.jsonResponse(res, 201, task);
  }

  // ---- PUT /task ----------------------------------------------------------
  async function handlePutTask(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    const uid = q.get('uid');
    if (!qId || !uid) return badRequest(ctx, res, 'missing-params', 'Missing qid or uid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    const { body, error } = await readBody(ctx, req);
    if (error) return ctx.jsonResponse(res, error.status, error.payload);

    let task;
    try {
      await withLock(async () => {
        const existing = store.readTask(rootDir, qId, uid);
        if (!existing) throw Object.assign(new Error('not-found'), { code: 'not-found' });

        // load gantt helpers for normRow
        const ganttPath = path.join(__dirname, '..', 'client', 'gantt.js');
        const g = await import(pathToFileURL(ganttPath).href);

        const meta = store.readQuarterMeta(rootDir, qId);
        const weeksN = (meta && meta.weeksN) || 14;
        const roster = (meta && meta.roster) || [];
        const rosterIds = roster.map((p) => p.id);

        // validate area if changing
        if ('a' in body) {
          const areas = store.listAreas(rootDir, qId);
          const areaExists = areas.some((a) => a.id === body.a);
          if (!areaExists) throw Object.assign(new Error('area-not-found'), { code: 'area-not-found', message: 'The area does not exist: ' + body.a });
        }

        let patch;
        try {
          patch = g.normRow(existing, body, { weeksN, rosterIds });
        } catch (ve) {
          throw Object.assign(new Error(ve.message), { code: ve.code, message: ve.message });
        }

        task = { ...existing, ...patch, updatedAt: new Date().toISOString() };
        store.writeTask(rootDir, qId, task);
      });
    } catch (e) {
      if (e.code === 'not-found') return notFound(ctx, res, 'The task does not exist.');
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      if (PUT_TASK_VALIDATION_CODES.has(e.code)) return badRequest(ctx, res, e.code, e.message);
      throw e;
    }
    ctx.jsonResponse(res, 200, task);
  }

  // ---- DELETE /task -------------------------------------------------------
  async function handleDeleteTask(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    const uid = q.get('uid');
    if (!qId || !uid) return badRequest(ctx, res, 'missing-params', 'Missing qid or uid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    let deleted;
    try {
      await withLock(async () => {
        deleted = store.deleteTask(rootDir, qId, uid);
      });
    } catch (e) {
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      throw e;
    }
    if (!deleted) return notFound(ctx, res, 'The task does not exist.');
    ctx.jsonResponse(res, 200, { deleted: true });
  }

  // ---- POST /task/demote --------------------------------------------------
  async function handleDemoteTask(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    const uid = q.get('uid');
    if (!qId || !uid) return badRequest(ctx, res, 'missing-params', 'Missing qid or uid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    let result;
    try {
      await withLock(async () => {
        result = store.demoteTask(rootDir, qId, uid);
      });
    } catch (e) {
      if (e.code === 'not-found') return notFound(ctx, res, 'The task does not exist.');
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      throw e;
    }
    ctx.jsonResponse(res, 200, result);
  }

  // ---- POST /task/swap ----------------------------------------------------
  // Body: { uid: "<task-uid>", dir: "up"|"down" }
  // Response: { tasks: [taskA, taskB] }  (the two shards after the swap)
  async function handleSwapTask(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    if (!qId) return badRequest(ctx, res, 'missing-qid', 'Missing qid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    const { body, error } = await readBody(ctx, req);
    if (error) return ctx.jsonResponse(res, error.status, error.payload);

    const { uid, dir } = body;
    if (!uid) return badRequest(ctx, res, 'missing-uid', 'Missing task uid in the request body.');
    if (dir !== 'up' && dir !== 'down') {
      return badRequest(ctx, res, 'invalid-dir', 'The direction must be "up" or "down".');
    }

    let result;
    try {
      await withLock(async () => {
        result = store.swapTaskOrder(rootDir, qId, uid, dir);
      });
    } catch (e) {
      if (e.code === 'not-found') return notFound(ctx, res, 'The task does not exist.');
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      if (e.code === 'boundary') return badRequest(ctx, res, 'boundary', e.message);
      throw e;
    }
    ctx.jsonResponse(res, 200, { tasks: [result.task, result.neighbour] });
  }

  // ---- POST /area ---------------------------------------------------------
  async function handlePostArea(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    if (!qId) return badRequest(ctx, res, 'missing-qid', 'Missing qid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    const { body, error } = await readBody(ctx, req);
    if (error) return ctx.jsonResponse(res, error.status, error.payload);

    if (!body.name || !String(body.name).trim()) {
      return badRequest(ctx, res, 'invalid-name', 'The area name cannot be empty.');
    }
    if (!(await _areaColors()).includes(body.color)) {
      return badRequest(ctx, res, 'invalid-color', 'Invalid area colour.');
    }

    // generate slug from name
    let slug;
    try {
      const ganttPath = path.join(__dirname, '..', 'client', 'gantt.js');
      const g = await import(pathToFileURL(ganttPath).href);
      slug = g.areaSlugFromName(String(body.name).trim());
    } catch {
      return badRequest(ctx, res, 'invalid-name', 'Cannot generate an id from this name.');
    }

    let area;
    try {
      await withLock(async () => {
        // ensure uniqueness
        const existing = store.listAreas(rootDir, qId);
        if (existing.some((a) => a.id === slug)) {
          slug = slug + '-' + Date.now().toString(36);
        }
        const maxO = existing.reduce((m, a) => Math.max(m, a.o || 0), 0);
        area = {
          id: slug,
          name: String(body.name).trim(),
          color: body.color,
          note: typeof body.note === 'string' ? body.note.trim() : '',
          o: maxO + 1,
        };
        store.writeArea(rootDir, qId, area);
      });
    } catch (e) {
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      throw e;
    }
    ctx.jsonResponse(res, 201, area);
  }

  // ---- PUT /area ----------------------------------------------------------
  async function handlePutArea(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    const areaId = q.get('id');
    if (!qId || !areaId) return badRequest(ctx, res, 'missing-params', 'Missing qid or id parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    const { body, error } = await readBody(ctx, req);
    if (error) return ctx.jsonResponse(res, error.status, error.payload);

    const areaColors = await _areaColors();

    let area;
    try {
      await withLock(async () => {
        const existing = store.readArea(rootDir, qId, areaId);
        if (!existing) throw Object.assign(new Error('not-found'), { code: 'not-found' });

        if ('color' in body && !areaColors.includes(body.color)) {
          throw Object.assign(new Error('Invalid area colour.'), { code: 'invalid-color' });
        }
        if ('name' in body && !String(body.name || '').trim()) {
          throw Object.assign(new Error('The area name cannot be empty.'), { code: 'invalid-name' });
        }

        area = { ...existing };
        if ('name' in body) area.name = String(body.name).trim();
        if ('color' in body) area.color = body.color;
        if ('note' in body) area.note = typeof body.note === 'string' ? body.note.trim() : '';
        if ('o' in body) area.o = Math.round(Number(body.o));

        store.writeArea(rootDir, qId, area);
      });
    } catch (e) {
      if (e.code === 'not-found') return notFound(ctx, res, 'The area does not exist.');
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      if (e.code === 'invalid-color' || e.code === 'invalid-name') return badRequest(ctx, res, e.code, e.message);
      throw e;
    }
    ctx.jsonResponse(res, 200, area);
  }

  // ---- DELETE /area -------------------------------------------------------
  async function handleDeleteArea(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    const areaId = q.get('id');
    if (!qId || !areaId) return badRequest(ctx, res, 'missing-params', 'Missing qid or id parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    let result;
    try {
      await withLock(async () => {
        // check no tasks in this area
        const tasks = store.listTaskShards(rootDir, qId);
        const taskCount = tasks.filter((t) => t.a === areaId).length;
        if (taskCount > 0) {
          throw Object.assign(new Error('The area has ' + taskCount + ' task(s) - move them to another area first.'), { code: 'area-not-empty', taskCount });
        }
        const existed = store.deleteArea(rootDir, qId, areaId);
        if (!existed) throw Object.assign(new Error('not-found'), { code: 'not-found' });
        result = { deleted: true };
      });
    } catch (e) {
      if (e.code === 'not-found') return notFound(ctx, res, 'The area does not exist.');
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      if (e.code === 'area-not-empty') {
        return ctx.jsonResponse(res, 409, { error: 'area-not-empty', taskCount: e.taskCount, message: e.message });
      }
      throw e;
    }
    ctx.jsonResponse(res, 200, result);
  }

  // ---- POST /backlog -------------------------------------------------------
  async function handlePostBacklog(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    if (!qId) return badRequest(ctx, res, 'missing-qid', 'Missing qid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    const { body, error } = await readBody(ctx, req);
    if (error) return ctx.jsonResponse(res, error.status, error.payload);

    let item;
    try {
      await withLock(async () => {
        item = store.createBacklogItem(rootDir, qId, body);
      });
    } catch (e) {
      if (e.code === 'bad-id' || e.code === 'invalid-title') return badRequest(ctx, res, e.code, e.message);
      throw e;
    }
    ctx.jsonResponse(res, 201, item);
  }

  // ---- PUT /backlog --------------------------------------------------------
  async function handlePutBacklog(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    const uid = q.get('uid');
    if (!qId || !uid) return badRequest(ctx, res, 'missing-params', 'Missing qid or uid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    const { body, error } = await readBody(ctx, req);
    if (error) return ctx.jsonResponse(res, error.status, error.payload);

    let item;
    try {
      await withLock(async () => {
        const existing = store.readBacklogItem(rootDir, qId, uid);
        if (!existing) throw Object.assign(new Error('not-found'), { code: 'not-found' });
        if ('t' in body) {
          const t = String(body.t || '').trim();
          if (!t) throw Object.assign(new Error('The title cannot be empty.'), { code: 'invalid-title' });
          existing.t = t;
        }
        existing.updatedAt = new Date().toISOString();
        store.writeBacklogItem(rootDir, qId, existing);
        item = existing;
      });
    } catch (e) {
      if (e.code === 'not-found') return notFound(ctx, res, 'The backlog item does not exist.');
      if (e.code === 'bad-id' || e.code === 'invalid-title') return badRequest(ctx, res, e.code, e.message);
      throw e;
    }
    ctx.jsonResponse(res, 200, item);
  }

  // ---- DELETE /backlog -----------------------------------------------------
  async function handleDeleteBacklog(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    const uid = q.get('uid');
    if (!qId || !uid) return badRequest(ctx, res, 'missing-params', 'Missing qid or uid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    let deleted;
    try {
      await withLock(async () => {
        deleted = store.deleteBacklogItem(rootDir, qId, uid);
      });
    } catch (e) {
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      throw e;
    }
    if (!deleted) return notFound(ctx, res, 'The backlog item does not exist.');
    ctx.jsonResponse(res, 200, { deleted: true });
  }

  // ---- POST /backlog/promote -----------------------------------------------
  async function handlePromoteBacklog(req, res) {
    const q = parseQuery(req);
    const qId = q.get('qid');
    if (!qId) return badRequest(ctx, res, 'missing-qid', 'Missing qid parameter.');
    if (storageState(rootDir) !== 'ok') return unavailableResponse(ctx, res);

    const { body, error } = await readBody(ctx, req);
    if (error) return ctx.jsonResponse(res, error.status, error.payload);

    const { uid, areaId } = body;
    if (!uid || !areaId) return badRequest(ctx, res, 'missing-params', 'Missing uid or areaId in the request body.');

    const areas = store.listAreas(rootDir, qId);
    if (!areas.some((a) => a.id === areaId)) {
      return badRequest(ctx, res, 'area-not-found', 'The area does not exist: ' + areaId);
    }

    let result;
    try {
      await withLock(async () => {
        const meta = store.readQuarterMeta(rootDir, qId);
        const weeksN = (meta && meta.weeksN) || 14;
        result = store.promoteBacklogItem(rootDir, qId, uid, areaId, weeksN);
      });
    } catch (e) {
      if (e.code === 'not-found') return notFound(ctx, res, 'The backlog item does not exist.');
      if (e.code === 'bad-id') return badRequest(ctx, res, 'bad-id', e.message);
      throw e;
    }
    ctx.jsonResponse(res, 200, result);
  }

  return {
    routes: [
      { method: 'GET',    path: '/status',           handler: handleStatus },
      { method: 'GET',    path: '/quarter',           handler: handleGetQuarter },
      { method: 'GET',    path: '/widget',            handler: handleWidget },
      { method: 'POST',   path: '/task',              handler: handlePostTask },
      { method: 'PUT',    path: '/task',              handler: handlePutTask },
      { method: 'DELETE', path: '/task',              handler: handleDeleteTask },
      { method: 'POST',   path: '/task/demote',       handler: handleDemoteTask },
      { method: 'POST',   path: '/task/swap',         handler: handleSwapTask },
      { method: 'POST',   path: '/area',              handler: handlePostArea },
      { method: 'PUT',    path: '/area',              handler: handlePutArea },
      { method: 'DELETE', path: '/area',              handler: handleDeleteArea },
      { method: 'POST',   path: '/backlog',           handler: handlePostBacklog },
      { method: 'PUT',    path: '/backlog',           handler: handlePutBacklog },
      { method: 'DELETE', path: '/backlog',           handler: handleDeleteBacklog },
      { method: 'POST',   path: '/backlog/promote',   handler: handlePromoteBacklog },
    ],
  };
}

module.exports = register;
