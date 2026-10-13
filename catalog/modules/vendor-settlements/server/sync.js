'use strict';
// vendor-settlements/server/sync.js
// Keeps protocols-<project>.json in step with summary.json, builds the
// protocols-all payload and validates the add/update body. Clock and id
// source are injected through `env` = { dir, now, rand } so tests can pin them.
// The protocolSync* helpers are best-effort: a failed sync never fails the
// summary write (the caller reports protocolSynced: false instead).

const store = require('./store.js');

/** Number(v) when it is a finite number (0 included), else the fallback. null/''/undefined never count. */
function finiteOr(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** atlas -> atlas, borealis -> borealis, comet -> atlas, delta -> null (no protocols file). */
function areaToProtocolProject(area) {
  if (area === 'atlas') return 'atlas';
  if (area === 'borealis') return 'borealis';
  if (area === 'comet') return 'atlas';
  return null;
}

// protocolSync* are read-modify-write with no await between read and write.
function protocolSyncCreate(env, project, assignment) {
  let data;
  try {
    data = store.readProtocols(env.dir, project);
  } catch {
    if (!store.protocolsExist(env.dir, project)) {
      data = store.emptyProtocols(env.now());
    } else {
      return null;
    }
  }
  if (!data.protocols) data.protocols = [];
  const stamp = env.now().toISOString();
  const protocol = {
    id: store.nextProtocolId(data, env.rand),
    po_number: assignment.po_number || '',
    protocol_number: assignment.title || '',
    vendor: assignment.vendor || '',
    amount: finiteOr(assignment.amount, 0),
    protocol_link: assignment.protocol_link || '',
    invoice_number: '',
    accepted_on: null,
    status: 'new',
    status_manual: false,
    created_on: stamp.slice(0, 10),
    settlement_month: assignment.period_from ? assignment.period_from.slice(0, 7) : null,
    updated_at: stamp,
  };
  data.protocols.push(protocol);
  try {
    store.writeProtocols(env.dir, project, data, env.now());
    return protocol.id;
  } catch {
    return null;
  }
}

function protocolSyncUpdate(env, project, protocolId, assignment) {
  let data;
  try { data = store.readProtocols(env.dir, project); } catch { return; }
  const p = (data.protocols || []).find((x) => x.id === protocolId);
  if (!p) return;
  p.protocol_number = assignment.title || p.protocol_number;
  if (typeof assignment.po_number === 'string') p.po_number = assignment.po_number;
  if (typeof assignment.vendor === 'string' && assignment.vendor) p.vendor = assignment.vendor;
  p.amount = finiteOr(assignment.amount, p.amount);
  p.settlement_month = assignment.period_from ? assignment.period_from.slice(0, 7) : p.settlement_month;
  if (assignment.protocol_link !== undefined) p.protocol_link = assignment.protocol_link || '';
  p.updated_at = env.now().toISOString();
  try { store.writeProtocols(env.dir, project, data, env.now()); } catch { /* best-effort */ }
}

function protocolSyncMarkAccepted(env, project, protocolId) {
  let data;
  try { data = store.readProtocols(env.dir, project); } catch { return; }
  const p = (data.protocols || []).find((x) => x.id === protocolId);
  if (!p) return;
  const stamp = env.now().toISOString();
  p.status = 'accepted';
  p.status_manual = false;
  p.accepted_on = stamp.slice(0, 10);
  p.updated_at = stamp;
  try { store.writeProtocols(env.dir, project, data, env.now()); } catch { /* best-effort */ }
}

function protocolSyncDelete(env, project, protocolId) {
  let data;
  try { data = store.readProtocols(env.dir, project); } catch { return; }
  const idx = (data.protocols || []).findIndex((x) => x.id === protocolId);
  if (idx !== -1) data.protocols.splice(idx, 1);
  try { store.writeProtocols(env.dir, project, data, env.now()); } catch { /* best-effort */ }
}

/** The protocols-all payload: every protocol of every project with `area` and `vendor`. */
function buildProtocolsAll(env) {
  const vendorByPo = {};
  for (const o of store.readPurchaseOrders(env.dir)) {
    if (o && o.po_number && o.vendor && !vendorByPo[o.po_number]) vendorByPo[o.po_number] = o.vendor;
  }
  const out = [];
  for (const project of store.PROTOCOL_PROJECTS) {
    let data;
    try { data = store.readProtocols(env.dir, project); } catch { data = { protocols: [] }; }
    const vendorByOrder = {};
    for (const order of (data.orders || [])) {
      for (const v of (order.vendors || [])) {
        if (v.po_number && v.name && !vendorByOrder[v.po_number]) vendorByOrder[v.po_number] = v.name;
      }
    }
    for (const p of (data.protocols || [])) {
      out.push({ ...p, area: project, vendor: p.vendor || vendorByOrder[p.po_number] || vendorByPo[p.po_number] || '' });
    }
  }
  return {
    meta: { last_updated: env.now().toISOString(), total: out.length },
    protocols: out,
  };
}

const VALID_MODES = ['epics', 'persons', 'custom'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

/** null when valid, else a message for the person. */
function validateSummaryBody(body, requireId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Invalid data.';
  const { id, area, period_from, period_to, vendor, mode, items, amount, po_number } = body;
  if (requireId && !id) return 'The settlement id is missing.';
  if (!store.AREAS.includes(area)) return 'Invalid area (allowed: ' + store.AREAS.join(', ') + ').';
  if (typeof period_from !== 'string' || typeof period_to !== 'string' || !DATE_RE.test(period_from) || !DATE_RE.test(period_to)) {
    return 'Period dates must be YYYY-MM-DD.';
  }
  if (period_from > period_to) return 'The period cannot start after it ends.';
  if (!vendor || typeof vendor !== 'string' || vendor.length > 200) {
    return 'A vendor is required (at most 200 characters).';
  }
  if (body.title !== undefined && body.title !== null && !(typeof body.title === 'string' && body.title.length <= 500)) {
    return 'The title must be text (at most 500 characters).';
  }
  if (body.po_name !== undefined && body.po_name !== null
    && !(typeof body.po_name === 'string' && body.po_name.length <= 500)) {
    return 'The order name must be text (at most 500 characters).';
  }
  if (body.protocol_link !== undefined && body.protocol_link !== null && body.protocol_link !== '') {
    const l = body.protocol_link;
    if (typeof l !== 'string' || l.length > 2000 || !/^https?:\/\//i.test(l)) {
      return 'The protocol link must start with http:// or https:// (at most 2000 characters).';
    }
  }
  if (!VALID_MODES.includes(mode)) return 'Invalid aggregation mode.';
  if (!Array.isArray(items)) return 'Items must be a list.';
  if (mode !== 'custom' && items.length === 0) return 'Choose at least one item (epics or persons mode).';
  if (items.length > 2000 || !items.every((it) => typeof it === 'string' && it.length <= 500)) {
    return 'Items must be text (at most 500 characters each).';
  }
  if (amount === null || amount === '' || typeof amount === 'boolean' || !Number.isFinite(Number(amount))) {
    return 'The amount must be a number.';
  }
  if (body.amount_full !== undefined && (typeof body.amount_full === 'boolean' || !Number.isFinite(Number(body.amount_full)))) {
    return 'The full amount must be a number.';
  }
  if (typeof po_number !== 'string' || po_number.length > 200) return 'The order number must be text (at most 200 characters).';
  return null;
}

module.exports = {
  VALID_MODES, ISO_RE,
  areaToProtocolProject, finiteOr,
  protocolSyncCreate, protocolSyncUpdate, protocolSyncMarkAccepted, protocolSyncDelete,
  buildProtocolsAll, validateSummaryBody,
};
