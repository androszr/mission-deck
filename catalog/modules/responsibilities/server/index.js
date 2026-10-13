'use strict';
// modules/responsibilities/server/index.js
// register(ctx) mounted under /api/m/responsibilities/. Nine routes on the
// per-project matrices in responsibilities/ of the team data plaintext tree:
//   GET  /data?project=                -> the matrix of one project
//   POST /prepare                      -> create the shell / add forward months
//   POST /rating                       -> set one R/A/G rating
//   POST /groups/{add,rename,delete}   -> group CRUD
//   POST /areas/{add,rename,delete}    -> area CRUD
// The project travels in ?project= or the body, never in the path (the host
// mounts routes on an exact method + path match). Writes are atomic
// (tmp + rename) under one chain lock per project. The server does NOT decide
// whether this machine may push data-tier-0 - the client reads canPush.

const store = require('./store.js');

function createRoutes(ctx, deps) {
  const now = (deps && deps.now) || (() => new Date());
  const locks = new Map();

  function lockFor(project) {
    if (!locks.has(project)) locks.set(project, ctx.makeLock());
    return locks.get(project);
  }

  function fail(res, status, error, message) {
    ctx.jsonResponse(res, status, { status: 'error', error, message });
  }

  function projectFrom(req, body) {
    const fromBody = body && typeof body.project === 'string' ? body.project : null;
    let fromQs = null;
    try { fromQs = new URL(req.url, 'http://localhost').searchParams.get('project'); } catch { /* ignore */ }
    const p = fromBody || fromQs || 'main';
    return store.isValidProject(p) ? p : null;
  }

  async function parseBody(req, res) {
    try {
      const body = await ctx.readBody(req, 64 * 1024);
      return body && typeof body === 'object' ? body : {};
    } catch {
      fail(res, 400, 'bad-json', 'Invalid JSON in the request.');
      return null;
    }
  }

  // -- GET /data ----------------------------------------------------------------

  function handleData(req, res) {
    const project = projectFrom(req, null);
    if (!project) { fail(res, 400, 'bad-project', 'Invalid project.'); return; }
    if (!store.dirExists(ctx)) {
      ctx.jsonResponse(res, 200, { available: false, storage: 'unavailable', project, data: null });
      return;
    }
    const r = store.readResp(ctx, project);
    if (!r.ok) {
      ctx.jsonResponse(res, 200, { available: false, storage: 'ok', project, data: null, reason: r.error });
      return;
    }
    ctx.jsonResponse(res, 200, { available: true, storage: 'ok', project, data: r.data });
  }

  // -- POST /prepare --------------------------------------------------------------

  async function handlePrepare(req, res) {
    const body = await parseBody(req, res);
    if (!body) return;
    const project = projectFrom(req, body);
    if (!project) { fail(res, 400, 'bad-project', 'Invalid project.'); return; }
    if (!store.dirExists(ctx)) {
      fail(res, 409, 'data-missing', 'The team data source is not pulled on this computer - open Sync in the top bar.');
      return;
    }
    await lockFor(project)(() => {
      const r = store.readResp(ctx, project);
      if (!r.ok && r.error === 'corrupt') {
        fail(res, 409, 'corrupt-file', 'The responsibilities file is corrupt - nothing was changed.');
        return;
      }
      const existed = r.ok;
      const data = r.ok ? r.data : store.ensureShell({});
      const { added } = store.ensureForwardMonths(data, now);
      if (!existed || added > 0) {
        try { store.writeRespAtomic(ctx, project, data, now); } catch (err) {
          fail(res, 500, 'write-failed', 'Saving failed: ' + err.message);
          return;
        }
      }
      ctx.jsonResponse(res, 200, { status: 'ok', initialized: !existed, monthsAdded: added, months: data.months });
    });
  }

  // -- mutation plumbing ----------------------------------------------------------

  // fn(data, body) mutates `data` and returns { body } to answer 200 or
  // { error: [status, code, message] } to answer without writing.
  function mutation(fn, opts) {
    const allowInit = !!(opts && opts.allowInit);
    return async (req, res) => {
      const body = await parseBody(req, res);
      if (!body) return;
      const project = projectFrom(req, body);
      if (!project) { fail(res, 400, 'bad-project', 'Invalid project.'); return; }
      const pre = fn(null, body, true);
      if (pre && pre.error) { fail(res, pre.error[0], pre.error[1], pre.error[2]); return; }
      await lockFor(project)(() => {
        let data;
        const r = store.readResp(ctx, project);
        if (r.ok) {
          data = r.data;
        } else if (r.error === 'corrupt') {
          fail(res, 409, 'corrupt-file', 'The responsibilities file is corrupt - nothing was changed.');
          return;
        } else if (allowInit && store.dirExists(ctx)) {
          data = store.ensureShell({});
        } else if (!store.dirExists(ctx)) {
          fail(res, 409, 'data-missing', 'The team data source is not pulled on this computer - open Sync in the top bar.');
          return;
        } else {
          fail(res, 404, 'no-file', 'No responsibilities file - prepare it first.');
          return;
        }
        const out = fn(data, body, false);
        if (out.error) { fail(res, out.error[0], out.error[1], out.error[2]); return; }
        try { store.writeRespAtomic(ctx, project, data, now); } catch (err) {
          fail(res, 500, 'write-failed', 'Saving failed: ' + err.message);
          return;
        }
        ctx.jsonResponse(res, 200, out.body);
      });
    };
  }

  const bad = (code, message) => ({ error: [400, code, message] });
  const notFound = (code, message) => ({ error: [404, code, message] });
  const txt = (v) => (typeof v === 'string' ? v.trim() : '');

  // -- POST /rating ----------------------------------------------------------------

  const handleRating = mutation((data, body, pre) => {
    const { groupId, areaId, month, status, actions } = body;
    if (!groupId || !areaId || !month) return bad('missing-fields', 'Group, area or month is missing.');
    if (typeof month !== 'string' || !store.MONTH_RE.test(month)) return bad('bad-month', 'Invalid month.');
    if (!store.VALID_STATUSES.includes(status === undefined ? 'x' : status)) return bad('bad-status', 'Invalid status.');
    if (status === 'red' && !txt(actions)) return bad('actions-required', 'Actions are required for status R.');
    if (actions !== null && actions !== undefined && !store.validateString(actions, store.MAX_TEXT_LEN)) return bad('too-long', 'The actions text is too long.');
    if (pre) return null;
    const group = data.groups.find((g) => g.id === groupId);
    if (!group) return notFound('no-group', 'Group not found.');
    const area = group.areas.find((a) => a.id === areaId);
    if (!area) return notFound('no-area', 'Area not found.');
    if (!area.ratings || typeof area.ratings !== 'object') area.ratings = {};
    area.ratings[month] = { status, actions: actions || null, updated_at: now().toISOString() };
    if (!data.months.includes(month)) { data.months.push(month); data.months.sort(); }
    return { body: { status: 'saved' } };
  });

  // -- groups -----------------------------------------------------------------------

  const handleGroupAdd = mutation((data, body, pre) => {
    const name = txt(body.name);
    if (!name) return bad('name-required', 'A group name is required.');
    if (!store.validateString(body.name, store.MAX_SHORT_LEN)) return bad('too-long', 'The name is too long.');
    if (pre) return null;
    store.ensureForwardMonths(data, now);
    const ids = new Set(data.groups.map((g) => g.id));
    const group = { id: store.makeUniqueId('grp', ids), name, areas: [] };
    data.groups.push(group);
    return { body: { status: 'added', group } };
  }, { allowInit: true });

  const handleGroupRename = mutation((data, body, pre) => {
    const name = txt(body.name);
    if (!body.groupId || !name) return bad('missing-fields', 'Group or name is missing.');
    if (!store.validateString(body.name, store.MAX_SHORT_LEN)) return bad('too-long', 'The name is too long.');
    if (pre) return null;
    const group = data.groups.find((g) => g.id === body.groupId);
    if (!group) return notFound('no-group', 'Group not found.');
    group.name = name;
    return { body: { status: 'saved' } };
  });

  const handleGroupDelete = mutation((data, body, pre) => {
    if (!body.groupId) return bad('missing-fields', 'Group is missing.');
    if (pre) return null;
    const idx = data.groups.findIndex((g) => g.id === body.groupId);
    if (idx === -1) return notFound('no-group', 'Group not found.');
    data.groups.splice(idx, 1);
    return { body: { status: 'deleted' } };
  });

  // -- areas ------------------------------------------------------------------------

  function validateArea(body) {
    if (!txt(body.name) || !txt(body.owner)) return bad('missing-fields', 'Required: group, name and owner.');
    if (!store.validateString(body.name, store.MAX_SHORT_LEN) || !store.validateString(body.owner, store.MAX_SHORT_LEN)) {
      return bad('too-long', 'The name or owner is too long.');
    }
    if (body.description && !store.validateString(body.description, store.MAX_TEXT_LEN)) {
      return bad('too-long', 'The description is too long.');
    }
    return null;
  }

  const handleAreaAdd = mutation((data, body, pre) => {
    if (!body.groupId) return bad('missing-fields', 'Required: group, name and owner.');
    const v = validateArea(body);
    if (v) return v;
    if (pre) return null;
    const group = data.groups.find((g) => g.id === body.groupId);
    if (!group) return notFound('no-group', 'Group not found.');
    const ids = new Set();
    data.groups.forEach((g) => g.areas.forEach((a) => ids.add(a.id)));
    const area = {
      id: store.makeUniqueId('area', ids),
      name: txt(body.name),
      description: txt(body.description),
      owner: txt(body.owner),
      ratings: {},
    };
    group.areas.push(area);
    return { body: { status: 'added', area } };
  });

  const handleAreaRename = mutation((data, body, pre) => {
    if (!body.groupId || !body.areaId) return bad('missing-fields', 'Required: group, area, name and owner.');
    const v = validateArea(body);
    if (v) return v;
    if (pre) return null;
    const group = data.groups.find((g) => g.id === body.groupId);
    if (!group) return notFound('no-group', 'Group not found.');
    const idx = group.areas.findIndex((a) => a.id === body.areaId);
    if (idx === -1) return notFound('no-area', 'Area not found.');
    const target = body.targetGroupId && body.targetGroupId !== body.groupId
      ? data.groups.find((g) => g.id === body.targetGroupId) : null;
    if (body.targetGroupId && body.targetGroupId !== body.groupId && !target) {
      return notFound('no-target-group', 'Target group not found.');
    }
    const area = group.areas[idx];
    area.name = txt(body.name);
    area.description = txt(body.description);
    area.owner = txt(body.owner);
    if (target) { group.areas.splice(idx, 1); target.areas.push(area); }
    return { body: { status: 'saved' } };
  });

  const handleAreaDelete = mutation((data, body, pre) => {
    if (!body.groupId || !body.areaId) return bad('missing-fields', 'Group or area is missing.');
    if (pre) return null;
    const group = data.groups.find((g) => g.id === body.groupId);
    if (!group) return notFound('no-group', 'Group not found.');
    const idx = group.areas.findIndex((a) => a.id === body.areaId);
    if (idx === -1) return notFound('no-area', 'Area not found.');
    group.areas.splice(idx, 1);
    return { body: { status: 'deleted' } };
  });

  return {
    routes: [
      { method: 'GET', path: '/data', handler: handleData },
      { method: 'POST', path: '/prepare', handler: handlePrepare },
      { method: 'POST', path: '/rating', handler: handleRating },
      { method: 'POST', path: '/groups/add', handler: handleGroupAdd },
      { method: 'POST', path: '/groups/rename', handler: handleGroupRename },
      { method: 'POST', path: '/groups/delete', handler: handleGroupDelete },
      { method: 'POST', path: '/areas/add', handler: handleAreaAdd },
      { method: 'POST', path: '/areas/rename', handler: handleAreaRename },
      { method: 'POST', path: '/areas/delete', handler: handleAreaDelete },
    ],
  };
}

function register(ctx) {
  return createRoutes(ctx, {});
}

module.exports = register;
module.exports.createRoutes = createRoutes;
