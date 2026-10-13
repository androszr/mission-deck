'use strict';
module.exports = function register(ctx) {
  return {
    routes: [
      {
        method: 'GET',
        path: '/ping',
        handler: (_req, res) => ctx.jsonResponse(res, 200, { pong: true, id: ctx.moduleId }),
      },
      {
        method: 'POST',
        path: '/echo',
        handler: async (req, res) => {
          const body = await ctx.readBody(req, 4096);
          ctx.jsonResponse(res, 200, { echo: body });
        },
      },
      // Shorter prefix registered FIRST: /x/deep/* below must still win for
      // /x/deep/..., because the longest prefix wins, not the order.
      {
        method: 'GET',
        path: '/x/*',
        handler: (req, res) => ctx.jsonResponse(res, 200, { rest: req.moduleRest }),
      },
      {
        method: 'GET',
        path: '/x/deep/*',
        handler: (req, res) => ctx.jsonResponse(res, 200, { deep: req.moduleRest }),
      },
      // Exact route at /x/exact wins over the prefix above
      {
        method: 'GET',
        path: '/x/exact',
        handler: (_req, res) => ctx.jsonResponse(res, 200, { exact: true }),
      },
    ],
  };
};
