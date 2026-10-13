'use strict';
// modules/sprint-review/server/index.js
// createRoutes(ctx, { http, now, env }) is the testable core - tests inject
// a fake http client, a fixed `now` and an `env` object (never the real
// process.env, never the network). register(ctx) is the real loader entry:
// it wires the real fetch-based client, or null under IS_TEST_MODE so no
// test:api-style run ever reaches Confluence.
//
// checkOrigin for non-GET methods is applied by the CORE dispatcher
// (handleModuleRoute) before a handler here ever runs - see
// modules-template/README.md - a handler never calls ctx.checkOrigin a
// second time.
//
// Ten routes, matched by EXACT path (no ":id" - handleModuleRoute does not
// support it): every identifier lives in the query string and is validated
// before it reaches store.js.

const crypto = require('crypto');

const session = require('./session.js');
const store = require('./store.js');
const confluence = require('./confluence.js');

const CONFLUENCE_BASE_URL_DEFAULT = 'https://confluence.example.com';
const READ_BODY_MAX_BYTES = 64 * 1024;

const IS_TEST_MODE = process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';

function parseQuery(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

function statsDirFor(ctx) {
  return session.teamStatsDir(ctx);
}

/** Empty session list without touching disk when the repo is not cloned. */
function safeListSessions(ctx) {
  if (store.storageState(ctx) === 'unavailable') return [];
  return store.listSessions(ctx);
}

function confluenceBaseUrl(env) {
  const raw = env.CONFLUENCE_BASE_URL;
  return (typeof raw === 'string' && raw.trim()) ? raw.trim().replace(/\/+$/, '') : CONFLUENCE_BASE_URL_DEFAULT;
}

async function readJsonBody(ctx, req) {
  try {
    return { body: await ctx.readBody(req, READ_BODY_MAX_BYTES) };
  } catch {
    return { error: { status: 400, payload: { error: 'invalid-json', message: 'The request body is not valid JSON.' } } };
  }
}

function confluenceErrorResponse(err) {
  if (err instanceof confluence.ConfluenceError) {
    if (err.code === 'confluence-http') {
      return { status: 502, payload: { error: 'confluence-http', status: err.status, message: 'Confluence answered with HTTP error ' + err.status + '.' } };
    }
    return {
      status: 502,
      payload: {
        error: 'confluence-unreachable',
        message: 'Confluence answered with a login page instead of data - check the VPN connection and the CONFLUENCE_TOKEN key.',
      },
    };
  }
  return { status: 502, payload: { error: 'confluence-unreachable', message: 'Could not connect to Confluence: ' + ((err && err.message) || 'unknown error') + '.' } };
}

function createRoutes(ctx, deps) {
  const http = deps && deps.http;
  const now = (deps && deps.now) || (() => new Date());
  const env = (deps && deps.env) || process.env;

  const withLock = ctx.makeLock();
  const meetingConfig = session.MEETINGS[session.MEETING_KEY];

  // -- GET /status ------------------------------------------------------------

  function handleStatus(_req, res) {
    const goals = session.readSprintGoals(statsDirFor(ctx), meetingConfig.defaultTeams);
    ctx.jsonResponse(res, 200, {
      storage: store.storageState(ctx),
      meeting: {
        key: session.MEETING_KEY,
        label: meetingConfig.label,
        // Seeding lineup for "New session" ONLY - never the card list. The
        // card list a client paints is session.teamGoals order (see the
        // module README).
        teams: meetingConfig.defaultTeams,
        dualSectionTeams: session.DUAL_SECTION_TEAMS,
        confluenceParentId: session.confluenceParentId(env),
      },
      confluence: {
        tokenPresent: !!env.CONFLUENCE_TOKEN,
        baseUrl: confluenceBaseUrl(env),
        enabled: !!http,
      },
      sprintGoals: { available: !!goals },
    });
  }

  // -- GET /sessions ---------------------------------------------------------

  function handleSessions(_req, res) {
    const storage = store.storageState(ctx);
    ctx.jsonResponse(res, 200, { storage, sessions: storage === 'unavailable' ? [] : store.listSessions(ctx) });
  }

  // -- GET /session?id= -------------------------------------------------------

  function handleSession(req, res) {
    const id = parseQuery(req).get('id') || '';
    if (!store.SESSION_ID_RE.test(id)) {
      ctx.jsonResponse(res, 400, { error: 'bad-id', message: 'Invalid session id.' });
      return;
    }
    const found = store.readSession(ctx, id);
    if (!found) {
      ctx.jsonResponse(res, 404, { error: 'not-found', message: 'Session not found.' });
      return;
    }
    ctx.jsonResponse(res, 200, found);
  }

  // -- POST /sessions ------------------------------------------------------------

  async function handlePostSessions(req, res) {
    const parsed = await readJsonBody(ctx, req);
    if (parsed.error) { ctx.jsonResponse(res, parsed.error.status, parsed.error.payload); return; }
    const body = parsed.body;

    if (store.storageState(ctx) === 'unavailable') {
      ctx.jsonResponse(res, 409, {
        error: 'storage-unavailable',
        message: 'The team data is not fetched to this computer yet - fetch the Team data source (data-tier-0) in the Sync window on the top bar.',
      });
      return;
    }

    const reviewDate = body && typeof body.reviewDate === 'string' ? body.reviewDate.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) {
      ctx.jsonResponse(res, 400, { error: 'reviewDate-required', message: 'The "reviewDate" field (YYYY-MM-DD) is required.' });
      return;
    }
    const facilitatorPo = body && typeof body.facilitatorPo === 'string' ? body.facilitatorPo.slice(0, 200) : '';
    const goals = session.readSprintGoals(statsDirFor(ctx), meetingConfig.defaultTeams);
    const newSession = session.buildNewSession({ reviewDate, facilitatorPo, sprintGoals: goals, now, randomBytes: crypto.randomBytes });

    await withLock(() => store.writeSession(ctx, newSession));
    ctx.jsonResponse(res, 201, newSession);
  }

  // -- PUT /session?id= -----------------------------------------------------

  async function handlePutSession(req, res) {
    const id = parseQuery(req).get('id') || '';
    if (!store.SESSION_ID_RE.test(id)) {
      ctx.jsonResponse(res, 400, { error: 'bad-id', message: 'Invalid session id.' });
      return;
    }
    const parsed = await readJsonBody(ctx, req);
    if (parsed.error) { ctx.jsonResponse(res, parsed.error.status, parsed.error.payload); return; }

    let outcome = null;
    await withLock(() => {
      const existing = store.readSession(ctx, id);
      if (!existing) { outcome = { status: 404, payload: { error: 'not-found', message: 'Session not found.' } }; return; }
      const result = session.applySessionPatch(existing, parsed.body, now);
      if (result.error) { outcome = { status: 400, payload: result }; return; }
      store.writeSession(ctx, result.session);
      outcome = { status: 200, payload: result.session };
    });
    ctx.jsonResponse(res, outcome.status, outcome.payload);
  }

  // -- DELETE /session?id= --------------------------------------------------

  async function handleDeleteSession(req, res) {
    const id = parseQuery(req).get('id') || '';
    if (!store.SESSION_ID_RE.test(id)) {
      ctx.jsonResponse(res, 400, { error: 'bad-id', message: 'Invalid session id.' });
      return;
    }
    const existed = await withLock(() => store.deleteSession(ctx, id));
    if (!existed) {
      ctx.jsonResponse(res, 404, { error: 'not-found', message: 'Session not found.' });
      return;
    }
    ctx.jsonResponse(res, 200, { deleted: true });
  }

  // -- PUT /session/team?id=&team= -----------------------------------------

  async function handlePutSessionTeam(req, res) {
    const query = parseQuery(req);
    const id = query.get('id') || '';
    const team = query.get('team') || '';
    if (!store.SESSION_ID_RE.test(id)) {
      ctx.jsonResponse(res, 400, { error: 'bad-id', message: 'Invalid session id.' });
      return;
    }
    if (!team) {
      ctx.jsonResponse(res, 400, { error: 'bad-team', message: 'Give a team name.' });
      return;
    }
    const parsed = await readJsonBody(ctx, req);
    if (parsed.error) { ctx.jsonResponse(res, parsed.error.status, parsed.error.payload); return; }

    // Whether `team` is valid is decided from the SESSION's own teams
    // (session.sessionTeams), never from a static roster - a team is
    // whatever is on this session's teamGoals/submissions, which reflects
    // whichever teams the Confluence page carried at import time.
    let outcome = null;
    await withLock(() => {
      const existing = store.readSession(ctx, id);
      if (!existing) { outcome = { status: 404, payload: { error: 'not-found', message: 'Session not found.' } }; return; }
      const result = session.applyTeamPatch(existing, team, parsed.body, crypto.randomBytes);
      if (result.error) { outcome = { status: 400, payload: result }; return; }
      const withUpdatedAt = { ...result.session, updatedAt: now().toISOString() };
      store.writeSession(ctx, withUpdatedAt);
      outcome = { status: 200, payload: withUpdatedAt };
    });
    ctx.jsonResponse(res, outcome.status, outcome.payload);
  }

  // -- GET /confluence-discover ---------------------------------------------

  async function handleConfluenceDiscover(_req, res) {
    if (!http) {
      ctx.jsonResponse(res, 503, { error: 'confluence-disabled', message: 'Importing from Confluence is disabled in test mode.' });
      return;
    }
    const token = env.CONFLUENCE_TOKEN;
    if (!token) {
      ctx.jsonResponse(res, 400, { error: 'no-token', message: 'No Confluence key - add CONFLUENCE_TOKEN in Settings > Keys or unlock the vault.' });
      return;
    }

    const client = confluence.createConfluenceClient({ http, baseUrl: confluenceBaseUrl(env), token });
    let data;
    try {
      data = await client.childPages(session.confluenceParentId(env));
    } catch (err) {
      const mapped = confluenceErrorResponse(err);
      ctx.jsonResponse(res, mapped.status, mapped.payload);
      return;
    }

    const existingByPageId = new Map(safeListSessions(ctx).filter((s) => s.confluencePageId).map((s) => [s.confluencePageId, s]));
    const rawPages = (data && Array.isArray(data.results)) ? data.results : [];
    const pages = rawPages
      .filter((p) => /\d{2}\.\d{2}\.\d{4}/.test(p.title || '') && /sprint/i.test(p.title || ''))
      .map((p) => {
        const parsedTitle = confluence.parseTitle(p.title);
        return {
          pageId: String(p.id),
          title: p.title,
          sprintN: parsedTitle.sprintN,
          reviewDate: parsedTitle.reviewDate,
          status: confluence.discoverStatus(p, existingByPageId.get(String(p.id)) || null),
          confluenceVersion: p.version && p.version.number,
        };
      })
      .sort((a, b) => (b.sprintN || 0) - (a.sprintN || 0));

    ctx.jsonResponse(res, 200, { storage: store.storageState(ctx), pages });
  }

  // -- POST /confluence-import?pageId= -------------------------------------

  async function handleConfluenceImport(req, res) {
    const pageId = parseQuery(req).get('pageId') || '';
    if (!/^\d+$/.test(pageId)) {
      ctx.jsonResponse(res, 400, { error: 'pageId-required', message: 'Give a valid pageId (digits only).' });
      return;
    }
    if (store.storageState(ctx) === 'unavailable') {
      ctx.jsonResponse(res, 409, {
        error: 'storage-unavailable',
        message: 'The team data is not fetched to this computer yet - fetch the Team data source (data-tier-0) in the Sync window on the top bar.',
      });
      return;
    }
    if (!http) {
      ctx.jsonResponse(res, 503, { error: 'confluence-disabled', message: 'Importing from Confluence is disabled in test mode.' });
      return;
    }
    const token = env.CONFLUENCE_TOKEN;
    if (!token) {
      ctx.jsonResponse(res, 400, { error: 'no-token', message: 'No Confluence key - add CONFLUENCE_TOKEN in Settings > Keys or unlock the vault.' });
      return;
    }

    const client = confluence.createConfluenceClient({ http, baseUrl: confluenceBaseUrl(env), token });
    const outcome = await importPage(client, pageId);
    ctx.jsonResponse(res, outcome.status, outcome.payload);
  }

  // -- POST /confluence-sync-all --------------------------------------------
  // One unattended pass (for a scheduler): discover the meeting's pages and
  // import every page that is `new` or `outdated` - the same importPage()
  // the per-page route runs, so a re-import merges submissions exactly like
  // the "Refresh" button. `synced` pages are not fetched.
  // 200 { ok, totals: { total, imported, refreshed, unchanged, failed }, results }.

  async function handleConfluenceSyncAll(_req, res) {
    if (store.storageState(ctx) === 'unavailable') {
      ctx.jsonResponse(res, 409, {
        error: 'storage-unavailable',
        message: 'The team data is not fetched to this computer yet - fetch the Team data source (data-tier-0) in the Sync window on the top bar.',
      });
      return;
    }
    if (!http) {
      ctx.jsonResponse(res, 503, { error: 'confluence-disabled', message: 'Importing from Confluence is disabled in test mode.' });
      return;
    }
    const token = env.CONFLUENCE_TOKEN;
    if (!token) {
      ctx.jsonResponse(res, 400, { error: 'no-token', message: 'No Confluence key - add CONFLUENCE_TOKEN in Settings > Keys or unlock the vault.' });
      return;
    }

    const client = confluence.createConfluenceClient({ http, baseUrl: confluenceBaseUrl(env), token });
    let data;
    try {
      data = await client.childPages(session.confluenceParentId(env));
    } catch (err) {
      const mapped = confluenceErrorResponse(err);
      ctx.jsonResponse(res, mapped.status, mapped.payload);
      return;
    }

    const existingByPageId = new Map(safeListSessions(ctx).filter((s) => s.confluencePageId).map((s) => [s.confluencePageId, s]));
    const rawPages = (data && Array.isArray(data.results)) ? data.results : [];
    const pages = rawPages.filter((p) => /\d{2}\.\d{2}\.\d{4}/.test(p.title || '') && /sprint/i.test(p.title || ''));

    const totals = { total: pages.length, imported: 0, refreshed: 0, unchanged: 0, failed: 0 };
    const results = [];
    for (const p of pages) {
      const pageId = String(p.id);
      const status = confluence.discoverStatus(p, existingByPageId.get(pageId) || null);
      if (status === 'synced') {
        totals.unchanged += 1;
        continue;
      }
      let outcome;
      try {
        outcome = await importPage(client, pageId);
      } catch (err) {
        outcome = confluenceErrorResponse(err);
      }
      if (outcome.status === 200 || outcome.status === 201) {
        if (outcome.status === 201) totals.imported += 1; else totals.refreshed += 1;
        results.push({ pageId, title: p.title, outcome: outcome.status === 201 ? 'imported' : 'refreshed' });
      } else {
        totals.failed += 1;
        results.push({ pageId, title: p.title, outcome: 'failed', error: (outcome.payload && outcome.payload.error) || 'error' });
      }
    }

    ctx.jsonResponse(res, 200, { ok: totals.failed === 0, totals, results });
  }

  // Fetches one page and writes it as a new session or merges it into the
  // session that already carries its confluencePageId. Returns
  // { status, payload } - 201 new, 200 re-import, 502 Confluence error.
  async function importPage(client, pageId) {
    let page;
    try {
      page = await client.page(pageId);
    } catch (err) {
      return confluenceErrorResponse(err);
    }

    const title = page.title || '';
    const body = (page.body && page.body.storage && page.body.storage.value) || '';
    const confluenceVersion = (page.version && page.version.number) || null;

    const userkeys = [...new Set([...body.matchAll(/ri:userkey="([^"]+)"/g)].map((m) => m[1]))];
    const userMap = await confluence.resolveUsers(client, userkeys);

    const freshSession = confluence.buildImportedSession({
      title,
      body,
      userMap,
      aliases: session.TEAM_ALIASES,
      dualSectionTeams: session.DUAL_SECTION_TEAMS,
      meetingKey: session.MEETING_KEY,
      pageId,
      version: confluenceVersion,
      now,
      randomBytes: crypto.randomBytes,
      deadlineFromReviewDate: session.deadlineFromReviewDate,
    });

    let outcome = null;
    await withLock(() => {
      const existingEntry = store.listSessions(ctx).find((s) => s.confluencePageId === pageId);
      if (existingEntry) {
        const oldSession = store.readSession(ctx, existingEntry.id);
        const merged = {
          ...freshSession,
          id: oldSession.id,
          createdAt: oldSession.createdAt,
          updatedAt: now().toISOString(),
          submissions: confluence.mergeReimportedSubmissions(oldSession.submissions, freshSession.submissions, session.DUAL_SECTION_TEAMS),
        };
        store.writeSession(ctx, merged);
        outcome = { status: 200, payload: merged };
        return;
      }
      store.writeSession(ctx, freshSession);
      outcome = { status: 201, payload: freshSession };
    });
    return outcome;
  }

  return {
    routes: [
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'GET', path: '/sessions', handler: handleSessions },
      { method: 'GET', path: '/session', handler: handleSession },
      { method: 'POST', path: '/sessions', handler: handlePostSessions },
      { method: 'PUT', path: '/session', handler: handlePutSession },
      { method: 'DELETE', path: '/session', handler: handleDeleteSession },
      { method: 'PUT', path: '/session/team', handler: handlePutSessionTeam },
      { method: 'GET', path: '/confluence-discover', handler: handleConfluenceDiscover },
      { method: 'POST', path: '/confluence-import', handler: handleConfluenceImport },
      { method: 'POST', path: '/confluence-sync-all', handler: handleConfluenceSyncAll },
    ],
  };
}

function register(ctx) {
  // Dependency injection, not a child-process spawn: createRoutes() reads
  // CONFLUENCE_TOKEN/CONFLUENCE_BASE_URL off this object and never hands it
  // to a subprocess, which is the only thing check-conventions'
  // spawn-env-spread watches for (a bare `env: process.env` counts only next
  // to a spawn/exec call on the same line).
  return createRoutes(ctx, {
    http: IS_TEST_MODE ? null : (u, o) => fetch(u, o),
    now: () => new Date(),
    env: process.env,
  });
}

module.exports = register;
module.exports.createRoutes = createRoutes;
