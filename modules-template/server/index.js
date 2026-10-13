'use strict';
// Module server entry point.
// Export a register(ctx) function. Return an object with a `routes` array.
// Each route: { method, path, handler(req, res) }.
//
// ctx properties:
//   moduleId   - the module directory name (e.g. "my-module")
//   jsonResponse(res, status, body) - sends gzipped JSON with ETag
//   readBody(req, maxBytes)         - reads and parses JSON request body
//   checkOrigin(req, res)           - CSRF guard; returns false and sends 403 if invalid
//   makeLock()                      - returns a withLock(fn) for serializing writes
//   dataDir                         - absolute path to data/modules/<id>/ (created on load)
//   rootDir                         - absolute path to the cockpit root
//   log(...args)                    - console.log prefixed with [module:<id>]

module.exports = function register(ctx) {
  return {
    routes: [
      {
        method: 'GET',
        path: '/status',
        handler: (_req, res) => {
          ctx.jsonResponse(res, 200, { ok: true, id: ctx.moduleId });
        },
      },
    ],
  };
};
