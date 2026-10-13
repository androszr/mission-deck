'use strict';
// modules/sprint-planning/server/index.js
// createRoutes(ctx, { now, randomBytes }) is the testable core; register(ctx)
// is the loader entry. Routes match by EXACT path; ids live in the query
// string and are validated before they reach store.js. checkOrigin for
// non-GET is applied by the core dispatcher.

const crypto = require('crypto');

const { TEAMS, teamById } = require('./teams.js');
const plan = require('./plan.js');
const store = require('./store.js');
const sources = require('./sources.js');

const READ_BODY_MAX_BYTES = 64 * 1024;

function parseQuery(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

function createRoutes(ctx, deps) {
  const now = (deps && deps.now) || (() => new Date());
  const randomBytes = (deps && deps.randomBytes) || crypto.randomBytes;
  const withLock = ctx.makeLock();

  /** { ok: true, body } or { ok: false } after a 400 was sent (a valid JSON `null` is ok with body null). */
  async function readJsonBody(req, res) {
    try {
      return { ok: true, body: await ctx.readBody(req, READ_BODY_MAX_BYTES) };
    } catch {
      ctx.jsonResponse(res, 400, { error: 'invalid-json', message: 'The request body is not valid JSON.' });
      return { ok: false };
    }
  }

  function corrupt(res, id) {
    ctx.jsonResponse(res, 409, { error: 'corrupt', id, message: 'The planning file is corrupt (for example a conflict after sync) - fix it or delete it by hand in the team data.' });
  }

  /** { plan } (null when missing) or { corrupt: true }. */
  function tryReadPlan(id) {
    try {
      return { plan: store.readPlan(ctx, id) };
    } catch (e) {
      if (e instanceof store.CorruptPlanError) return { corrupt: true };
      throw e;
    }
  }

  function badId(res) {
    ctx.jsonResponse(res, 400, { error: 'bad-id', message: 'Invalid planning id.' });
  }

  function notFound(res) {
    ctx.jsonResponse(res, 404, { error: 'not-found', message: 'Planning not found.' });
  }

  function handleStatus(_req, res) {
    const storage = store.storageState(ctx);
    ctx.jsonResponse(res, 200, {
      storage,
      teams: TEAMS,
      jiraUrl: String(process.env.JIRA_URL || 'https://jira.example.com').replace(/\/+$/, ''),
      boards: sources.readBoards(ctx, [...new Set(TEAMS.map((t) => t.sprintSrc))]),
      plans: storage === 'unavailable' ? [] : store.listPlans(ctx),
      settings: storage === 'unavailable' ? plan.emptySettings() : store.readSettings(ctx),
    });
  }

  function storageUnavailable(res) {
    ctx.jsonResponse(res, 409, {
      error: 'storage-unavailable',
      message: 'Team data has not been downloaded to this computer yet - pull the Team data source (data-tier-0) from the sync window in the top bar.',
    });
  }

  /** Dates for a team's sprint n: team settings first, else Jira history. */
  function datesFor(team, n) {
    const cfg = store.readSettings(ctx).teams[team.id] || null;
    const fromSettings = plan.datesFromSettings(cfg, n, store.listPlans(ctx).filter((p) => p.team === team.id));
    return fromSettings || plan.sprintDatesFor(sources.readSprintHistory(ctx, team).sprints, n);
  }

  function handleGetPlan(req, res) {
    const id = parseQuery(req).get('id') || '';
    if (!plan.PLAN_ID_RE.test(id)) { badId(res); return; }
    const read = tryReadPlan(id);
    if (read.corrupt) { corrupt(res, id); return; }
    if (!read.plan) { notFound(res); return; }
    ctx.jsonResponse(res, 200, read.plan);
  }

  async function handlePostPlan(req, res) {
    const parsed = await readJsonBody(req, res);
    if (!parsed.ok) return;
    const body = parsed.body;
    const team = teamById(body && body.team);
    if (!team) {
      ctx.jsonResponse(res, 400, { error: 'bad-team', message: 'Unknown team.' });
      return;
    }
    const sprintN = typeof body.sprintN === 'string' && /^\d+$/.test(body.sprintN) ? Number(body.sprintN) : body.sprintN;
    if (!Number.isInteger(sprintN) || sprintN < 1 || sprintN > 999) {
      ctx.jsonResponse(res, 400, { error: 'bad-sprint', message: 'The sprint number must be a number from 1 to 999.' });
      return;
    }
    if (store.storageState(ctx) === 'unavailable') { storageUnavailable(res); return; }
    await withLock(() => {
      const id = plan.planIdOf(team.id, sprintN);
      if (store.planFileExists(ctx, id)) {
        ctx.jsonResponse(res, 409, { error: 'exists', id, message: 'A planning for this sprint already exists.' });
        return;
      }
      const dates = datesFor(team, sprintN);
      const created = plan.buildNewPlan({ team: team.id, sprintN, dateFrom: dates.dateFrom, dateTo: dates.dateTo, now: now() });
      created.datesSource = dates.source;
      store.writePlan(ctx, created);
      ctx.jsonResponse(res, 201, created);
    });
  }

  async function handlePutPlan(req, res) {
    const id = parseQuery(req).get('id') || '';
    if (!plan.PLAN_ID_RE.test(id)) { badId(res); return; }
    const parsed = await readJsonBody(req, res);
    if (!parsed.ok) return;
    const body = parsed.body;
    await withLock(() => {
      const read = tryReadPlan(id);
      if (read.corrupt) { corrupt(res, id); return; }
      const current = read.plan;
      if (!current) { notFound(res); return; }
      if (!body || body.baseUpdatedAt !== current.updatedAt) {
        ctx.jsonResponse(res, 409, { error: 'stale', message: 'Someone saved changes before you - load the latest version.' });
        return;
      }
      // resetDates: true -> dates recomputed from the team settings (drops a manual exception).
      let patch = body;
      let reset = null;
      if (body.resetDates !== undefined) {
        if (body.resetDates !== true || body.dateFrom !== undefined || body.dateTo !== undefined) {
          ctx.jsonResponse(res, 400, { error: 'bad-patch', message: 'The "resetDates" field accepts only true and cannot be combined with dates.' });
          return;
        }
        const team = teamById(current.team);
        const cfg = team ? store.readSettings(ctx).teams[team.id] || null : null;
        const others = store.listPlans(ctx).filter((p) => p.team === current.team && p.id !== current.id);
        reset = plan.datesFromSettings(cfg, current.sprintN, others);
        if (!reset) {
          ctx.jsonResponse(res, 409, { error: 'no-settings', message: 'The team has no sprint settings covering this sprint.' });
          return;
        }
        patch = { ...body, dateFrom: reset.dateFrom, dateTo: reset.dateTo };
        delete patch.resetDates;
      }
      const result = plan.applyPlanPatch(current, patch, now(), randomBytes);
      if (result.error) {
        ctx.jsonResponse(res, 400, { error: 'bad-patch', message: result.error });
        return;
      }
      if (reset) result.plan.datesSource = reset.source;
      store.writePlan(ctx, result.plan);
      ctx.jsonResponse(res, 200, result.plan);
    });
  }

  async function handleDeletePlan(req, res) {
    const id = parseQuery(req).get('id') || '';
    if (!plan.PLAN_ID_RE.test(id)) { badId(res); return; }
    await withLock(() => {
      if (!store.deletePlan(ctx, id)) { notFound(res); return; }
      ctx.jsonResponse(res, 200, { deleted: true });
    });
  }

  async function handlePutSettings(req, res) {
    const parsed = await readJsonBody(req, res);
    if (!parsed.ok) return;
    const body = parsed.body;
    if (store.storageState(ctx) === 'unavailable') { storageUnavailable(res); return; }
    const checked = plan.validateSettingsTeams(body && body.teams);
    if (checked.error) {
      ctx.jsonResponse(res, 400, { error: 'bad-settings', message: checked.error });
      return;
    }
    await withLock(() => {
      const current = store.readSettings(ctx);
      if (current.unreadable) {
        ctx.jsonResponse(res, 409, { error: 'settings-corrupt', message: 'The sprint settings file is corrupt - fix it or delete it by hand in the team data before saving new settings.' });
        return;
      }
      if (!body || (body.baseUpdatedAt || null) !== current.updatedAt) {
        ctx.jsonResponse(res, 409, { error: 'stale', message: 'Someone saved the settings before you - load the latest version.' });
        return;
      }
      const next = plan.mergeSettings(current, checked.teams, now());
      store.writeSettings(ctx, next);
      ctx.jsonResponse(res, 200, next);
    });
  }

  function handleContext(req, res) {
    const q = parseQuery(req);
    const team = teamById(q.get('team'));
    if (!team) {
      ctx.jsonResponse(res, 400, { error: 'bad-team', message: 'Unknown team.' });
      return;
    }
    const from = q.get('from') || '';
    const to = q.get('to') || '';
    if (!plan.validRange(from, to)) {
      ctx.jsonResponse(res, 400, { error: 'bad-range', message: 'Dates must be YYYY-MM-DD, the start no later than the end, at most 42 days.' });
      return;
    }
    const roster = sources.readRoster(ctx, team.rosterTeam);
    ctx.jsonResponse(res, 200, {
      roster,
      duties: sources.readDuties(ctx, from, to),
      absences: sources.readAbsences(ctx, roster.members.map((m) => m.slug), from, to),
      history: sources.readSprintHistory(ctx, team),
    });
  }

  return {
    routes: [
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'GET', path: '/plan', handler: handleGetPlan },
      { method: 'POST', path: '/plan', handler: handlePostPlan },
      { method: 'PUT', path: '/plan', handler: handlePutPlan },
      { method: 'DELETE', path: '/plan', handler: handleDeletePlan },
      { method: 'GET', path: '/context', handler: handleContext },
      { method: 'PUT', path: '/settings', handler: handlePutSettings },
    ],
  };
}

function register(ctx) {
  return createRoutes(ctx, { now: () => new Date(), randomBytes: crypto.randomBytes });
}

module.exports = register;
module.exports.register = register;
module.exports.createRoutes = createRoutes;
