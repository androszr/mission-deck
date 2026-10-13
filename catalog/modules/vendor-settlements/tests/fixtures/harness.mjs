// vendor-settlements/tests/fixtures/harness.mjs
// Shared fake-ctx harness for the route tests (not a test file itself).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { createRoutes } = require('../../server/index.js');
export const NOW = new Date('2026-10-09T10:00:00.000Z');

/** rand(4) -> 00000001, 00000002, ... so ids are predictable. */
export function seqRand() {
  let n = 0;
  return () => {
    n += 1;
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
}

// withData:false -> no data root; empty:true -> the root exists but is EMPTY
// (what "end of day" leaves); default -> a decrypted root with one unrelated file.
export function setup(t, opts = {}) {
  const { withData = true, empty = false, deps = {} } = opts;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-routes-'));
  if (t) t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'tier0');
  const dir = path.join(root, 'vendor-settlements');
  if (withData) fs.mkdirSync(root);
  if (withData && !empty) fs.writeFileSync(path.join(root, 'README.md'), 'team data\n');
  let last = null;
  const ctx = {
    dataTier0Dir: root,
    dataDir: path.join(base, 'moddata'),
    log: () => {},
    makeLock: () => {
      let chain = Promise.resolve();
      return (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
    },
    jsonResponse: (res, status, body) => { last = { status, body }; },
    readBody: async (req) => req.body,
  };
  const api = createRoutes(ctx, { now: () => NOW, rand: seqRand(), docx: null, mammoth: null, env: {}, ...deps });
  const route = (method, p) => api.routes.find((r) => r.method === method && r.path === p);
  const call = async (method, p, body, query) => {
    last = null;
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(buf) { last = { status: this.status, headers: this.headers, raw: buf }; },
    };
    await route(method, p).handler({ url: '/x' + (query || ''), body }, res);
    return last;
  };
  const file = (name) => path.join(dir, name);
  const exists = (name) => fs.existsSync(file(name));
  const readJson = (name) => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const put = (name, obj) => { fs.mkdirSync(path.dirname(file(name)), { recursive: true }); fs.writeFileSync(file(name), JSON.stringify(obj)); };
  return { base, root, dir, ctx, api, route, call, file, exists, readJson, put };
}

export const ADD_BOREALIS = {
  area: 'borealis', title: 'Protocol September', period_from: '2026-09-01', period_to: '2026-09-30',
  vendor: 'Acme Ltd', mode: 'epics', items: ['BOR-1'],
  amount: 1000, po_number: 'PO-1', protocol_link: '',
};
