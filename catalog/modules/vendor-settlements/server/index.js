'use strict';
// vendor-settlements/server/index.js
// register(ctx) mounted under /api/m/vendor-settlements/. Routes:
//   GET  /status                 storage, cost sources and their age, docx/mammoth presence
//   GET  /data                   everything the view paints from, in one request
//   GET  /protocols-all          protocols of every project with area and vendor
//   GET  /costs?area=            assembled worklog costs of one area (read-only)
//   POST /summary/add | update | delete | mark-accepted
//   POST /vendor-info/add        upsert by case-insensitive name
//   POST /protocols/generate?format=pdf&project=<area>   .docx download or print page
// createRoutes(ctx, { now, rand, docx, mammoth, readMembers, env }) is the testable
// core; register(ctx) wires the real clock, crypto and the lazily required libraries.
//
// The host already runs checkOrigin on every non-GET route; the handlers call
// it again only when ctx offers it (a second call is harmless).

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const store = require('./store.js');
const sync = require('./sync.js');
const costs = require('./costs.js');
const protocol = require('./protocol-docx.js');

const { AREAS } = store;
const RECORD_LIMIT = 64 * 1024;
const GENERATE_LIMIT = 2 * 1024 * 1024;
const MAX_SHORT_LEN = 500;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DATA_MISSING_MESSAGE = 'The team data is not pulled and decrypted on this computer - pull it in the Sync window on the top bar.';
const DEPS_MESSAGE = 'The document generator library is missing. Run `npm ci --omit=dev` in the modules/vendor-settlements directory.';

function readJsonOrNull(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function isStr(v, max) {
  return typeof v === 'string' && v.length <= max;
}

function foldKey(name) {
  return protocol.protAsciiFold(name).replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}

function createRoutes(ctx, deps) {
  const d = deps || {};
  const now = d.now || (() => new Date());
  const rand = d.rand || ((n) => crypto.randomBytes(n));
  const envVars = d.env || process.env;
  const lib = (x) => (typeof x === 'function' ? x() : (x || null));
  const getDocx = () => lib(d.docx);
  const getMammoth = () => lib(d.mammoth);
  const send = (res, status, body) => ctx.jsonResponse(res, status, body);
  const modDir = () => store.moduleRoot(ctx);
  const ready = () => store.rootReady(ctx);
  const env = () => ({ dir: modDir(), now, rand });

  const locks = {};
  const lockOf = (key) => {
    if (!locks[key]) locks[key] = ctx.makeLock();
    return locks[key];
  };

  const dataMissing = (res) => send(res, 409, { status: 'error', error: 'data-missing', message: DATA_MISSING_MESSAGE });
  const bad = (res, message) => send(res, 400, { status: 'error', error: 'invalid', message });
  const readFailed = (res, file) => send(res, 500, { status: 'error', error: 'read-failed', message: 'Could not read ' + file + '.' });
  const failed = (res, err, fallback) => {
    if (err && err.code === 'data-missing') return dataMissing(res);
    return send(res, 500, { status: 'error', error: fallback, message: 'The file operation failed.' });
  };
  const originOk = (req, res) => (typeof ctx.checkOrigin === 'function' ? ctx.checkOrigin(req, res) : true);

  async function body(req, res, limit) {
    try {
      return { data: await ctx.readBody(req, limit) };
    } catch (err) {
      if (err && /^Payload too large/.test(String(err.message))) {
        send(res, 413, { status: 'error', error: 'too-large', message: 'The request body is too large.' });
      } else {
        send(res, 400, { status: 'error', error: 'invalid', message: 'Invalid JSON.' });
      }
      return null;
    }
  }

  function queryOf(req) {
    try { return new URL(req.url, 'http://localhost').searchParams; } catch { return new URLSearchParams(); }
  }

  function jiraBrowseUrl() {
    const base = String(envVars.JIRA_BASE_URL || '').replace(/\/+$/, '');
    return /^https?:\/\//i.test(base) ? base + '/browse/' : '';
  }

  // -- GET /status ----------------------------------------------------------
  function handleStatus(_req, res) {
    send(res, 200, {
      storage: ready() ? 'ok' : 'unavailable',
      costs: costs.costsStatus(ready() ? modDir() : null),
      deps: { docx: !!getDocx(), mammoth: !!getMammoth() },
    });
  }

  // -- GET /data ------------------------------------------------------------
  function vendorInfoOrEmpty() {
    try { return store.readVendorInfo(modDir()); } catch { return { meta: { last_updated: null }, vendors: [] }; }
  }

  function handleData(_req, res) {
    if (!ready()) {
      return send(res, 200, {
        storage: 'unavailable',
        summary: { meta: { last_updated: null, total_assignments: 0 }, assignments: [] },
        protocols: { meta: { last_updated: null, total: 0 }, protocols: [] },
        vendorInfo: { meta: { last_updated: null }, vendors: [] },
        purchaseOrders: [],
        teamMembers: [],
        jiraBrowseUrl: jiraBrowseUrl(),
      });
    }
    let summary;
    try { summary = store.readSummary(modDir()); } catch { return readFailed(res, 'summary.json'); }
    return send(res, 200, {
      storage: 'ok',
      summary,
      protocols: sync.buildProtocolsAll(env()),
      vendorInfo: vendorInfoOrEmpty(),
      purchaseOrders: store.readPurchaseOrders(modDir()),
      teamMembers: memberNames(),
      jiraBrowseUrl: jiraBrowseUrl(),
    });
  }

  // -- GET /protocols-all ---------------------------------------------------
  function handleProtocolsAll(_req, res) {
    if (!ready()) return send(res, 200, { storage: 'unavailable', meta: { last_updated: null, total: 0 }, protocols: [] });
    return send(res, 200, { storage: 'ok', ...sync.buildProtocolsAll(env()) });
  }

  // -- GET /costs?area= -----------------------------------------------------
  async function handleCosts(req, res) {
    const area = queryOf(req).get('area');
    if (!AREAS.includes(area)) {
      return send(res, 400, { status: 'error', error: 'bad-area', message: 'Unknown area. Allowed: ' + AREAS.join(', ') + '.' });
    }
    if (!ready()) return send(res, 200, { storage: 'unavailable', _missing: true });
    const r = await costs.readCostsForArea(modDir(), area, { warn: (...a) => ctx.log && ctx.log(...a) });
    if (!r) return send(res, 200, { _missing: true });
    return send(res, 200, r.data);
  }

  // -- POST /summary/* ------------------------------------------------------
  // Chains nest in a fixed order, summary -> protocols-<project>, so two
  // writers cannot deadlock. Readiness is checked INSIDE the lock, right
  // before the write.
  const withProtocols = (project, fn) => lockOf('protocols-' + project)(fn);

  const pickFields = (input) => {
    const { area, title, period_from, period_to, vendor, mode, items, amount, amount_full, po_number, po_name, protocol_link } = input;
    return { area, title, period_from, period_to, vendor, mode, items, amount, amount_full, po_number, po_name, protocol_link };
  };

  async function handleAdd(req, res) {
    if (!originOk(req, res)) return undefined;
    const b = await body(req, res, RECORD_LIMIT);
    if (!b) return undefined;
    const err = sync.validateSummaryBody(b.data, false);
    if (err) return bad(res, err);
    const f = pickFields(b.data);
    return lockOf('summary')(async () => {
      if (!ready()) return dataMissing(res);
      const dir = modDir();
      // Decided before any write. The protocols file of `target` is created
      // after summary.json (its anchor) exists, so only the summary is checked.
      const target = sync.areaToProtocolProject(f.area);
      if (!store.canWriteTarget(dir, store.SUMMARY_FILE)) return dataMissing(res);
      let data;
      try { data = store.readSummary(dir); } catch { return readFailed(res, 'summary.json'); }
      const stamp = now().toISOString();
      const item = {
        id: store.nextSummaryId(data.assignments, rand),
        area: f.area,
        title: f.title || null,
        period_from: f.period_from,
        period_to: f.period_to,
        vendor: f.vendor,
        mode: f.mode,
        items: Array.isArray(f.items) ? f.items : [],
        amount: Number(f.amount),
        amount_full: f.amount_full !== undefined ? Number(f.amount_full) : Number(f.amount),
        po_number: f.po_number,
        po_name: f.po_name || null,
        protocol_link: f.protocol_link || '',
        accepted_at: null,
        created_at: stamp,
        updated_at: stamp,
      };
      data.assignments.push(item);
      try { store.writeSummary(dir, data, now()); } catch (e) { return failed(res, e, 'write-failed'); }

      let protocolSynced = true;
      if (target) {
        const protocolId = await withProtocols(target, () => sync.protocolSyncCreate(env(), target, item));
        if (protocolId) {
          item.protocol_id = protocolId;
          try { store.writeSummary(dir, data, now()); } catch { /* best-effort re-save */ }
        } else {
          protocolSynced = false;
        }
      }
      return send(res, 200, { status: 'added', assignment: item, protocolSynced });
    });
  }

  async function handleUpdate(req, res) {
    if (!originOk(req, res)) return undefined;
    const b = await body(req, res, RECORD_LIMIT);
    if (!b) return undefined;
    const err = sync.validateSummaryBody(b.data, true);
    if (err) return bad(res, err);
    const input = b.data;
    const f = pickFields(input);
    return lockOf('summary')(async () => {
      if (!ready()) return dataMissing(res);
      const dir = modDir();
      let data;
      try { data = store.readSummary(dir); } catch { return readFailed(res, 'summary.json'); }
      const item = data.assignments.find((a) => a.id === input.id);
      if (!item) return send(res, 404, { status: 'error', error: 'not-found', message: 'The settlement was not found.' });
      const oldProject = sync.areaToProtocolProject(item.area);
      const oldProtocolId = item.protocol_id || null;
      const newProject = sync.areaToProtocolProject(f.area);
      // Decided before any write: a project change needs the new protocols file to be writable.
      if (newProject && newProject !== oldProject && !store.canWriteTarget(dir, store.protocolsFile(newProject))) {
        return dataMissing(res);
      }

      Object.assign(item, {
        area: f.area,
        title: f.title !== undefined ? (f.title || null) : item.title,
        period_from: f.period_from,
        period_to: f.period_to,
        vendor: f.vendor,
        mode: f.mode,
        items: Array.isArray(f.items) ? f.items : [],
        amount: Number(f.amount),
        amount_full: f.amount_full !== undefined ? Number(f.amount_full) : item.amount_full,
        po_number: f.po_number,
        po_name: f.po_name !== undefined ? f.po_name : item.po_name,
        protocol_link: f.protocol_link !== undefined ? (f.protocol_link || '') : (item.protocol_link || ''),
        updated_at: now().toISOString(),
      });
      try { store.writeSummary(dir, data, now()); } catch (e) { return failed(res, e, 'write-failed'); }

      let protocolSynced = true;
      if (newProject === oldProject) {
        if (newProject && oldProtocolId) {
          await withProtocols(newProject, () => sync.protocolSyncUpdate(env(), newProject, oldProtocolId, item));
        }
      } else {
        // The area moved to another protocols file (or to/from an area without
        // one): create in the new file first, then drop the old protocol, then
        // repoint protocol_id.
        let newId = null;
        if (newProject) {
          newId = await withProtocols(newProject, () => sync.protocolSyncCreate(env(), newProject, item));
          if (!newId) protocolSynced = false;
        }
        if (oldProject && oldProtocolId && (newId || !newProject)) {
          await withProtocols(oldProject, () => sync.protocolSyncDelete(env(), oldProject, oldProtocolId));
        }
        // A failed create keeps the old link and protocol untouched (protocolSynced:false tells the client).
        if (newId) item.protocol_id = newId;
        else if (!newProject) delete item.protocol_id;
        if (newId || !newProject) {
          try { store.writeSummary(dir, data, now()); } catch { /* best-effort re-save */ }
        }
      }
      return send(res, 200, { status: 'saved', assignment: item, protocolSynced });
    });
  }

  async function handleDelete(req, res) {
    if (!originOk(req, res)) return undefined;
    const b = await body(req, res, RECORD_LIMIT);
    if (!b) return undefined;
    const id = b.data && b.data.id;
    if (!id || typeof id !== 'string') return bad(res, 'The settlement id is missing.');
    return lockOf('summary')(async () => {
      if (!ready()) return dataMissing(res);
      const dir = modDir();
      let data;
      try { data = store.readSummary(dir); } catch { return readFailed(res, 'summary.json'); }
      const idx = data.assignments.findIndex((a) => a.id === id);
      if (idx === -1) return send(res, 404, { status: 'error', error: 'not-found', message: 'The settlement was not found.' });
      const deleted = data.assignments[idx];
      data.assignments.splice(idx, 1);
      try { store.writeSummary(dir, data, now()); } catch (e) { return failed(res, e, 'write-failed'); }

      const project = sync.areaToProtocolProject(deleted.area);
      if (project && deleted.protocol_id) {
        await withProtocols(project, () => sync.protocolSyncDelete(env(), project, deleted.protocol_id));
      }
      return send(res, 200, { status: 'deleted' });
    });
  }

  async function handleMarkAccepted(req, res) {
    if (!originOk(req, res)) return undefined;
    const b = await body(req, res, RECORD_LIMIT);
    if (!b) return undefined;
    const { id, accepted_at } = b.data || {};
    if (!id || typeof id !== 'string' || id.length > 64) {
      return bad(res, 'The settlement id is required (at most 64 characters).');
    }
    if (!accepted_at || typeof accepted_at !== 'string' || !sync.ISO_RE.test(accepted_at)) {
      return bad(res, 'The acceptance date must be ISO 8601.');
    }
    return lockOf('summary')(async () => {
      if (!ready()) return dataMissing(res);
      const dir = modDir();
      let data;
      try { data = store.readSummary(dir); } catch { return readFailed(res, 'summary.json'); }
      const assignment = data.assignments.find((a) => a.id === id);
      if (!assignment) return send(res, 404, { status: 'error', error: 'not-found', message: 'The settlement was not found.' });
      if (assignment.accepted_at) {
        return send(res, 409, { status: 'error', error: 'already-accepted', message: 'This settlement is already marked as accepted.' });
      }
      assignment.accepted_at = accepted_at;
      assignment.updated_at = now().toISOString();
      try { store.writeSummary(dir, data, now()); } catch (e) { return failed(res, e, 'write-failed'); }

      const project = sync.areaToProtocolProject(assignment.area);
      if (project && assignment.protocol_id) {
        await withProtocols(project, () => sync.protocolSyncMarkAccepted(env(), project, assignment.protocol_id));
      }
      return send(res, 200, { status: 'accepted', assignment });
    });
  }

  // -- POST /vendor-info/add ------------------------------------------------
  async function handleVendorAdd(req, res) {
    if (!originOk(req, res)) return undefined;
    const b = await body(req, res, RECORD_LIMIT);
    if (!b) return undefined;
    const { name, full_name, tax_id, registry_no, address } = b.data || {};
    if (!name || typeof name !== 'string' || !name.trim()) return bad(res, 'A vendor name is required.');
    if (!isStr(name, MAX_SHORT_LEN)) return bad(res, 'The vendor name is too long.');
    if (full_name && !isStr(full_name, MAX_SHORT_LEN)) return bad(res, 'The full company name is too long.');
    if (address && !isStr(address, MAX_SHORT_LEN)) return bad(res, 'The address is too long.');
    if (tax_id && !isStr(tax_id, 20)) return bad(res, 'The tax ID is too long.');
    if (registry_no && !isStr(registry_no, 20)) return bad(res, 'The registry number is too long.');
    return lockOf('vendor-info')(() => {
      if (!ready()) return dataMissing(res);
      const nameTrimmed = name.trim();
      const entry = {
        name: nameTrimmed,
        full_name: full_name || '',
        address: address || '',
        tax_id: tax_id || '',
        registry_no: registry_no || '',
      };
      try {
        store.updateVendorInfo(modDir(), (data) => {
          const existing = data.vendors.find((v) => String(v.name).toLowerCase() === nameTrimmed.toLowerCase());
          if (existing) Object.assign(existing, entry); else data.vendors.push(entry);
        }, now());
      } catch (e) {
        if (e && e.code === 'read-failed') return readFailed(res, 'vendor-info.json');
        return failed(res, e, 'write-failed');
      }
      return send(res, 200, { status: 'saved', vendor: entry });
    });
  }

  // -- POST /protocols/generate ---------------------------------------------
  function memberNames() {
    if (typeof d.readMembers === 'function') return d.readMembers();
    return [];
  }

  async function handleGenerate(req, res) {
    if (!originOk(req, res)) return undefined;
    const b = await body(req, res, GENERATE_LIMIT);
    if (!b) return undefined;
    const q = queryOf(req);
    const input = b.data && typeof b.data === 'object' ? b.data : {};
    const project = q.get('project') || input.project || 'delta';
    if (!AREAS.includes(project)) {
      return send(res, 400, { status: 'error', error: 'bad-area', message: 'Unknown area. Allowed: ' + AREAS.join(', ') + '.' });
    }
    const { company, month, persons, po_name, po_number, protocol_number, protocol_date, vendor } = input;
    if (!company || !month || !protocol_number || !protocol_date) {
      return bad(res, 'Required fields are missing: company, month, protocol number, protocol date.');
    }
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return bad(res, 'The month must be YYYY-MM.');
    if (!Array.isArray(persons) || persons.length === 0) return bad(res, 'The list of people cannot be empty.');
    if (!isStr(company, MAX_SHORT_LEN) || !isStr(protocol_number, MAX_SHORT_LEN)) {
      return bad(res, 'The company name or the protocol number is invalid or too long.');
    }
    const wantPdf = q.get('format') === 'pdf';
    const docx = getDocx();
    const mammoth = getMammoth();
    if (!docx || (wantPdf && !mammoth)) {
      return send(res, 503, { status: 'error', error: 'deps-missing', message: DEPS_MESSAGE });
    }

    const [yr, mo] = month.split('-');
    const monthLabel = (MONTH_NAMES[parseInt(mo, 10)] || mo) + ' ' + yr;
    const totalAmount = persons.reduce((s, p) => s + (Number(p && p.amount) || 0), 0);
    const payload = {
      company,
      vendor: vendor || null,
      customer: protocol.customerLines(envVars),
      po_name: po_name || '',
      po_number: po_number || '',
      month,
      month_label: monthLabel,
      protocol_number,
      protocol_date,
      persons: protocol.resolveProtocolPersonNames(persons, memberNames()),
      total_amount: totalAmount,
    };
    const safeCompany = company.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'PROTOCOL';

    return lockOf('protocols-gen-' + project)(async () => {
      let buf;
      try {
        buf = await protocol.buildProtocolDocx(payload, docx);
      } catch (err) {
        if (ctx.log) ctx.log('[vendor-settlements] docx build failed:', err && err.message);
        return send(res, 500, { status: 'error', error: 'build-failed', message: 'Could not build the document.' });
      }

      if (wantPdf) {
        let html;
        try {
          html = (await mammoth.convertToHtml({ buffer: buf })).value;
        } catch (err) {
          if (ctx.log) ctx.log('[vendor-settlements] print page failed:', err && err.message);
          return send(res, 500, { status: 'error', error: 'build-failed', message: 'Could not prepare the print page.' });
        }
        const pdfFilename = safeCompany + '-protocol-' + yr + '-' + mo + '.pdf';
        const pageBuf = Buffer.from(protocol.buildPrintPage(html, pdfFilename), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': 'inline; filename="' + pdfFilename + '"',
          'Content-Length': pageBuf.length,
        });
        return res.end(pageBuf);
      }

      const filename = safeCompany + '-protocol-' + yr + '-' + mo + '.docx';
      res.writeHead(200, {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': 'attachment; filename="' + filename + '"',
        'Content-Length': buf.length,
      });
      return res.end(buf);
    });
  }

  return {
    routes: [
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'GET', path: '/data', handler: handleData },
      { method: 'GET', path: '/protocols-all', handler: handleProtocolsAll },
      { method: 'GET', path: '/costs', handler: handleCosts },
      { method: 'POST', path: '/summary/add', handler: handleAdd },
      { method: 'POST', path: '/summary/update', handler: handleUpdate },
      { method: 'POST', path: '/summary/delete', handler: handleDelete },
      { method: 'POST', path: '/summary/mark-accepted', handler: handleMarkAccepted },
      { method: 'POST', path: '/vendor-info/add', handler: handleVendorAdd },
      { method: 'POST', path: '/protocols/generate', handler: handleGenerate },
    ],
  };
}

// A library required lazily and never cached on failure: `npm install` run
// after the server started is picked up by the next request.
function lazyRequire(name) {
  let mod = null;
  return () => {
    if (mod) return mod;
    try { mod = require(name); } catch { mod = null; }
    return mod;
  };
}

/** Canonical "First Last" names from the team directory (team/team-members.json), de-duplicated. */
function readMemberNames(ctx) {
  const names = [];
  const seen = new Set();
  const root = store.dataRoot(ctx);
  const dir = root ? readJsonOrNull(path.join(root, 'team', 'team-members.json')) : null;
  for (const m of (dir && Array.isArray(dir.team_members) ? dir.team_members : [])) {
    const name = m ? [m.first_name, m.last_name].filter(Boolean).join(' ').trim() : '';
    const k = name ? foldKey(name) : '';
    if (!k || seen.has(k)) continue;
    seen.add(k);
    names.push(name);
  }
  return names;
}

function register(ctx) {
  return createRoutes(ctx, {
    now: () => new Date(),
    rand: (n) => crypto.randomBytes(n),
    docx: lazyRequire('docx'),
    mammoth: lazyRequire('mammoth'),
    readMembers: () => readMemberNames(ctx),
    env: process.env,
  });
}

module.exports = register;
module.exports.register = register;
module.exports.createRoutes = createRoutes;
module.exports.readMemberNames = readMemberNames;
