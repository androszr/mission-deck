'use strict';
// modules/qa-tests/server/same-site.js (own copy of the shared same-site guard;
// a module cannot require() another module's file)
// Cross-site guard for the GET routes that DO work. Core handleModuleRoute runs
// checkOrigin only for non-GET methods, but /refresh-stream starts work on a
// GET (EventSource cannot POST): a 20-minute Jira fetch that rewrites
// jira/qa-automation/ in the team data tree. Without this, any web
// page the person opened while the cockpit was running could fire
// <img src="http://localhost:3001/api/m/qa-tests/refresh-stream">.
//
// Browsers mark every request with Sec-Fetch-Site; the app's own EventSource is
// 'same-origin'. An absent header is a non-browser client (curl from the
// terminal) and passes - the attacker here is a web page, and a page cannot
// strip the header. An Origin, when present, must be the local cockpit.

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Pure: true when the request may start work. */
function isSameSiteRequest(headers) {
  const h = headers || {};
  const site = String(h['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = String(h.origin || '');
  if (origin && !LOCAL_ORIGIN_RE.test(origin)) return false;
  return true;
}

/** Wraps every GET `*-stream` route so a cross-site request gets 403 before its handler runs. */
function guardStreamRoutes(routes, jsonResponse) {
  return routes.map((r) => {
    if (r.method !== 'GET' || !/-stream$/.test(r.path)) return r;
    const handler = r.handler;
    return {
      ...r,
      handler(req, res) {
        if (!isSameSiteRequest(req.headers)) {
          return jsonResponse(res, 403, { error: 'cross-site', message: 'A cross-site request was refused.' });
        }
        return handler(req, res);
      },
    };
  });
}

module.exports = { isSameSiteRequest, guardStreamRoutes };
