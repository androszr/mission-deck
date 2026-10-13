'use strict';
// modules/onboarding/server/index.js
// register(ctx) mounted under /api/m/onboarding/. Eight routes:
//   GET    /links          -> { links, generated_at, storage }
//   POST   /links          -> add a link to links.json
//   PUT    /links?id=      -> patch one link in links.json
//   DELETE /links?id=      -> remove one link from links.json
//   GET    /plans          -> { plans: sortPlans(...), generated_at, storage }
//   POST   /plans          -> copy the template into a new people/<slug>.json
//   PUT    /plans?id=      -> patch template.json (id 'default') or one people shard
//   DELETE /plans?id=      -> remove one people shard (never 'default')
//
// Data lives under ctx.dataTier0Dir (the plaintext ds-data working tree),
// never joined by hand from another ctx field: a unit test
// that injects a temporary dataTier0Dir must never be able to reach the
// real team data directory through this file.
//
// The identifier for /links and /plans travels in the query string
// (?id=<id>), not in the path: the host matches a module route by EXACT
// path (server.js dispatch), so a route
// shaped "/links/:id" would never match and every PUT/DELETE would 404.
//
// The host already runs the CSRF/Origin check (and requires
// Content-Type: application/json) for every non-GET module route before the
// handler runs (server.js handleModuleRoute). This file never repeats that
// check - a second call after a 403 would write to an already-closed
// response.

const fs = require('fs');
const store = require('./onboarding-store.js');

function createRoutes(ctx) {
  const withLock = ctx.makeLock();

  function repoMissing(res) {
    ctx.jsonResponse(res, 409, {
      error: 'repo-missing',
      message: 'The team data repository is not cloned - clone it in the Sync window in the top bar.',
    });
  }

  function idFromQuery(req) {
    const url = new URL(req.url, 'http://module.local');
    return url.searchParams.get('id');
  }

  function missingId(res) {
    ctx.jsonResponse(res, 400, { error: 'missing-id', message: 'The ?id= identifier is missing from the address.' });
  }

  // A failed write (a permission error on ds-data, a shard removed by
  // another request between the read and the write) must still answer -
  // otherwise the request just hangs, since jsonResponse was never reached.
  function writeFailed(res, e) {
    ctx.log('onboarding: write error:', e && e.message);
    ctx.jsonResponse(res, 500, { error: 'write-failed', message: 'Could not save the changes to disk.' });
  }

  // -- GET /links -----------------------------------------------------------

  function handleLinksGet(_req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) {
      ctx.jsonResponse(res, 200, { links: [], generated_at: null, storage: 'unavailable' });
      return;
    }
    const data = store.readLinks(ctx.dataTier0Dir, ctx.log);
    ctx.jsonResponse(res, 200, { links: data.links, generated_at: data.generated_at, storage: 'ok' });
  }

  // -- POST /links ------------------------------------------------------------

  async function handleLinksAdd(req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) { repoMissing(res); return; }
    let body;
    try {
      body = await ctx.readBody(req, 64 * 1024);
    } catch {
      ctx.jsonResponse(res, 400, { error: 'invalid-json', message: 'Invalid JSON in the request.' });
      return;
    }
    const validated = store.validateLink(body || {}, { partial: false });
    if (!validated.ok) {
      ctx.jsonResponse(res, 400, { error: 'invalid-link', message: validated.error });
      return;
    }
    try {
      await withLock(() => {
        const data = store.readLinks(ctx.dataTier0Dir, ctx.log);
        if (data.links.length >= store.MAX_LINKS) {
          ctx.jsonResponse(res, 400, { error: 'link-limit', message: 'Link limit reached (' + store.MAX_LINKS + ').' });
          return;
        }
        const link = { id: 'link-' + Date.now(), ...validated.value };
        const nextLinks = data.links.concat([link]);
        const nowIso = new Date().toISOString();
        store.writeJsonAtomic(store.linksFile(ctx.dataTier0Dir), { links: nextLinks, generated_at: nowIso });
        ctx.jsonResponse(res, 200, { status: 'added', link });
      });
    } catch (e) {
      writeFailed(res, e);
    }
  }

  // -- PUT /links?id= ---------------------------------------------------------

  async function handleLinksUpdate(req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) { repoMissing(res); return; }
    const id = idFromQuery(req);
    if (!id) { missingId(res); return; }
    let body;
    try {
      body = await ctx.readBody(req, 64 * 1024);
    } catch {
      ctx.jsonResponse(res, 400, { error: 'invalid-json', message: 'Invalid JSON in the request.' });
      return;
    }
    const validated = store.validateLink(body || {}, { partial: true });
    if (!validated.ok) {
      ctx.jsonResponse(res, 400, { error: 'invalid-link', message: validated.error });
      return;
    }
    try {
      await withLock(() => {
        const data = store.readLinks(ctx.dataTier0Dir, ctx.log);
        const idx = data.links.findIndex((l) => l.id === id);
        if (idx === -1) {
          ctx.jsonResponse(res, 404, { error: 'not-found', message: 'Link not found.' });
          return;
        }
        const link = { ...data.links[idx], ...validated.value };
        const nextLinks = data.links.slice();
        nextLinks[idx] = link;
        const nowIso = new Date().toISOString();
        store.writeJsonAtomic(store.linksFile(ctx.dataTier0Dir), { links: nextLinks, generated_at: nowIso });
        ctx.jsonResponse(res, 200, { status: 'updated', link });
      });
    } catch (e) {
      writeFailed(res, e);
    }
  }

  // -- DELETE /links?id= -------------------------------------------------------

  async function handleLinksDelete(req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) { repoMissing(res); return; }
    const id = idFromQuery(req);
    if (!id) { missingId(res); return; }
    try {
      await withLock(() => {
        const data = store.readLinks(ctx.dataTier0Dir, ctx.log);
        const nextLinks = data.links.filter((l) => l.id !== id);
        if (nextLinks.length === data.links.length) {
          ctx.jsonResponse(res, 404, { error: 'not-found', message: 'Link not found.' });
          return;
        }
        const nowIso = new Date().toISOString();
        store.writeJsonAtomic(store.linksFile(ctx.dataTier0Dir), { links: nextLinks, generated_at: nowIso });
        ctx.jsonResponse(res, 200, { status: 'deleted', deleted: id });
      });
    } catch (e) {
      writeFailed(res, e);
    }
  }

  // -- GET /plans -----------------------------------------------------------

  function handlePlansGet(_req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) {
      ctx.jsonResponse(res, 200, { plans: [], generated_at: null, storage: 'unavailable' });
      return;
    }
    const template = store.readTemplate(ctx.dataTier0Dir, ctx.log);
    const persons = store.readPersons(ctx.dataTier0Dir, ctx.log);
    const plans = store.sortPlans(template, persons);
    const generatedAt = template ? template.generated_at || null : null;
    ctx.jsonResponse(res, 200, { plans, generated_at: generatedAt, storage: 'ok' });
  }

  // -- POST /plans ------------------------------------------------------------

  async function handlePlansAdd(req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) { repoMissing(res); return; }
    let body;
    try {
      body = await ctx.readBody(req, 64 * 1024);
    } catch {
      ctx.jsonResponse(res, 400, { error: 'invalid-json', message: 'Invalid JSON in the request.' });
      return;
    }
    const validatedName = store.validatePlanName(body && body.name);
    if (!validatedName.ok) {
      ctx.jsonResponse(res, 400, { error: 'invalid-name', message: validatedName.error });
      return;
    }
    try {
      await withLock(() => {
        const template = store.readTemplate(ctx.dataTier0Dir, ctx.log);
        // The dedup set is the raw people/ directory listing, not
        // readPersons() - a shard readPersons goes on to skip (a corrupted
        // file, an unusual pre-existing slug) still occupies a real file
        // name on disk, and minting the same slug for a new plan would
        // silently overwrite it on the next write.
        const taken = new Set(store.listPersonFileSlugs(ctx.dataTier0Dir));
        const baseSlug = store.slugify(validatedName.value);
        const slug = store.uniqueSlug(baseSlug, taken);
        const nowIso = new Date().toISOString();
        const plan = store.copyTemplate(template, validatedName.value, slug, nowIso);
        store.writeJsonAtomic(store.personFile(ctx.dataTier0Dir, slug), plan);
        ctx.jsonResponse(res, 200, { status: 'added', plan });
      });
    } catch (e) {
      writeFailed(res, e);
    }
  }

  // -- PUT /plans?id= ---------------------------------------------------------

  async function handlePlansUpdate(req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) { repoMissing(res); return; }
    const id = idFromQuery(req);
    if (!id) { missingId(res); return; }
    let body;
    try {
      body = await ctx.readBody(req, 256 * 1024);
    } catch {
      ctx.jsonResponse(res, 400, { error: 'invalid-json', message: 'Invalid JSON in the request.' });
      return;
    }
    body = body || {};
    if (id === 'default' && body.name !== undefined) {
      ctx.jsonResponse(res, 403, { error: 'cannot-rename-default', message: 'The template cannot be renamed.' });
      return;
    }
    let sanitizedRows = null;
    if (body.rows !== undefined) {
      const sanitized = store.sanitizeRows(body.rows);
      if (!sanitized.ok) {
        ctx.jsonResponse(res, 400, { error: 'invalid-rows', message: sanitized.error });
        return;
      }
      sanitizedRows = sanitized.value;
    }
    let validatedName = null;
    if (body.name !== undefined) {
      const nameResult = store.validatePlanName(body.name);
      if (!nameResult.ok) {
        ctx.jsonResponse(res, 400, { error: 'invalid-name', message: nameResult.error });
        return;
      }
      validatedName = nameResult.value;
    }

    try {
      await withLock(() => {
        const nowIso = new Date().toISOString();
        if (id === 'default') {
          const template = store.readTemplate(ctx.dataTier0Dir, ctx.log);
          if (!template) {
            ctx.jsonResponse(res, 404, { error: 'not-found', message: 'Template not found.' });
            return;
          }
          const plan = { ...template, generated_at: nowIso };
          if (sanitizedRows !== null) plan.rows = sanitizedRows;
          store.writeJsonAtomic(store.templateFile(ctx.dataTier0Dir), plan);
          ctx.jsonResponse(res, 200, { status: 'updated', plan });
          return;
        }

        const persons = store.readPersons(ctx.dataTier0Dir, ctx.log);
        const existing = persons.find((p) => p.id === id);
        if (!existing) {
          ctx.jsonResponse(res, 404, { error: 'not-found', message: 'Plan not found.' });
          return;
        }
        const plan = { ...existing, generated_at: nowIso };
        if (validatedName !== null) plan.name = validatedName;
        if (sanitizedRows !== null) plan.rows = sanitizedRows;
        store.writeJsonAtomic(store.personFile(ctx.dataTier0Dir, existing.slug), plan);
        ctx.jsonResponse(res, 200, { status: 'updated', plan });
      });
    } catch (e) {
      writeFailed(res, e);
    }
  }

  // -- DELETE /plans?id= -------------------------------------------------------

  async function handlePlansDelete(req, res) {
    if (!fs.existsSync(ctx.dataTier0Dir)) { repoMissing(res); return; }
    const id = idFromQuery(req);
    if (!id) { missingId(res); return; }
    if (id === 'default') {
      ctx.jsonResponse(res, 403, { error: 'cannot-delete-default', message: 'The template cannot be deleted.' });
      return;
    }
    try {
      await withLock(() => {
        const persons = store.readPersons(ctx.dataTier0Dir, ctx.log);
        const existing = persons.find((p) => p.id === id);
        if (!existing) {
          ctx.jsonResponse(res, 404, { error: 'not-found', message: 'Plan not found.' });
          return;
        }
        fs.unlinkSync(store.personFile(ctx.dataTier0Dir, existing.slug));
        ctx.jsonResponse(res, 200, { status: 'deleted' });
      });
    } catch (e) {
      writeFailed(res, e);
    }
  }

  return {
    routes: [
      { method: 'GET', path: '/links', handler: handleLinksGet },
      { method: 'POST', path: '/links', handler: handleLinksAdd },
      { method: 'PUT', path: '/links', handler: handleLinksUpdate },
      { method: 'DELETE', path: '/links', handler: handleLinksDelete },
      { method: 'GET', path: '/plans', handler: handlePlansGet },
      { method: 'POST', path: '/plans', handler: handlePlansAdd },
      { method: 'PUT', path: '/plans', handler: handlePlansUpdate },
      { method: 'DELETE', path: '/plans', handler: handlePlansDelete },
    ],
  };
}

function register(ctx) {
  return createRoutes(ctx);
}

module.exports = register;
module.exports.createRoutes = createRoutes;
