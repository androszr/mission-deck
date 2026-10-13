'use strict';
// vendor-settlements/server/store.js
// The ONLY file in this module that writes. Everything lives under
// vendor-settlements/ in the team data repo (data-tier-0):
//   summary.json              the settlements (JSON.stringify(data, null, 2) + LF)
//   protocols-<project>.json  acceptance protocols per protocol project
//   vendor-info.json          vendor details for the generated protocol
//   purchase-orders.json      READ ONLY here - the order pool, kept by hand
//   costs/                    READ ONLY here - see costs.js
// The data root itself is never created here.

const fs = require('fs');
const path = require('path');

const MODULE_SUBDIR = 'vendor-settlements';
// Areas a settlement can belong to (example teams - rename to your own).
const AREAS = ['atlas', 'borealis', 'comet', 'delta'];
// Areas that keep their own protocols file.
const PROTOCOL_PROJECTS = ['atlas', 'borealis'];
const SUMMARY_FILE = 'summary.json';
const VENDOR_INFO_FILE = 'vendor-info.json';
const PURCHASE_ORDERS_FILE = 'purchase-orders.json';

function protocolsFile(project) {
  return 'protocols-' + project + '.json';
}

const ALLOWED = new Set([SUMMARY_FILE, VENDOR_INFO_FILE, ...PROTOCOL_PROJECTS.map(protocolsFile)]);

function fail(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

/** The plaintext team data root (data-tier-0), or null. */
function dataRoot(ctx) {
  if (ctx.dataTier0Dir) return ctx.dataTier0Dir;
  if (typeof ctx.dataRepoDir === 'function') return ctx.dataRepoDir('data-tier-0');
  return null;
}

/** <data root>/vendor-settlements, or null. */
function moduleRoot(ctx) {
  const root = dataRoot(ctx);
  return root ? path.join(root, MODULE_SUBDIR) : null;
}

function _hasEntries(dir) {
  try {
    return fs.readdirSync(dir).some((n) => !n.startsWith('.'));
  } catch {
    return false;
  }
}

/**
 * The team data tree is present and decrypted: the root exists and is not
 * empty. An empty root ("end of day" clears the plaintext) must never get an
 * invented file - its next push would publish a wipe.
 */
function rootReady(ctx) {
  const root = dataRoot(ctx);
  return typeof root === 'string' && !!root && _hasEntries(root);
}

/**
 * May `name` be written under the module dir `dir`? An existing target always
 * may. A MISSING summary.json may be created only when none of the files this
 * module writes exists yet (a fresh start - the hand-kept purchase-orders.json
 * and costs/ do not count); next to vendor-info.json or a protocols file it
 * means a half-decrypted tree and is refused. A missing protocols file may be
 * created once summary.json exists; vendor-info.json may always be created.
 */
function canWriteTarget(dir, name) {
  if (typeof dir !== 'string' || !dir) return false;
  if (fs.existsSync(path.join(dir, name))) return true;
  if (name === VENDOR_INFO_FILE) return true;
  if (name === SUMMARY_FILE) return ![...ALLOWED].some((f) => fs.existsSync(path.join(dir, f)));
  return fs.existsSync(path.join(dir, SUMMARY_FILE));
}

function _atomicWrite(dir, name, data, eol) {
  if (!ALLOWED.has(name)) throw fail('path-outside');
  if (!canWriteTarget(dir, name)) throw fail('data-missing');
  const abs = path.resolve(dir, name);
  if (abs !== path.join(path.resolve(dir), name)) throw fail('path-outside');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = abs + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + (eol ? '\n' : ''), 'utf8');
    fs.renameSync(tmp, abs);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    throw err;
  }
}

function emptySummary() {
  return { meta: { last_updated: null, total_assignments: 0 }, assignments: [] };
}

/** The parsed file, or an empty one when absent. Corrupt JSON throws. */
function readSummary(dir) {
  const p = path.join(dir, SUMMARY_FILE);
  if (!fs.existsSync(p)) return emptySummary();
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!data || typeof data !== 'object' || !Array.isArray(data.assignments)) throw fail('read-failed');
  data.meta = data.meta || {};
  return data;
}

function writeSummary(dir, data, now) {
  data.meta = data.meta || {};
  data.meta.last_updated = (now || new Date()).toISOString();
  data.meta.total_assignments = data.assignments.length;
  _atomicWrite(dir, SUMMARY_FILE, data, true);
}

function protocolsExist(dir, project) {
  return fs.existsSync(path.join(dir, protocolsFile(project)));
}

function emptyProtocols(now) {
  return { meta: { last_updated: (now || new Date()).toISOString(), total_orders: 0 }, protocols: [], orders: [] };
}

/** Throws when the file is missing or corrupt (the sync helpers decide what that means). */
function readProtocols(dir, project) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, protocolsFile(project)), 'utf8'));
  if (!data || typeof data !== 'object') throw fail('read-failed');
  return data;
}

function writeProtocols(dir, project, data, now) {
  data.meta = data.meta || {};
  data.meta.last_updated = (now || new Date()).toISOString();
  data.meta.total_orders = (data.orders || []).length;
  _atomicWrite(dir, protocolsFile(project), data, false);
}

function _emptyVendorInfo() {
  return { meta: { last_updated: null }, vendors: [] };
}

function _parseVendorFile(p) {
  let data;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw fail('read-failed'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.vendors)) throw fail('read-failed');
  return data;
}

/** An existing but unparsable file throws read-failed - never treated as empty. */
function readVendorInfo(dir) {
  const p = typeof dir === 'string' && dir ? path.join(dir, VENDOR_INFO_FILE) : null;
  if (!p || !fs.existsSync(p)) return _emptyVendorInfo();
  return _parseVendorFile(p);
}

/** Read-modify-write of vendor-info.json. Call inside the lock. */
function updateVendorInfo(dir, mutate, now) {
  const p = path.join(dir, VENDOR_INFO_FILE);
  const data = fs.existsSync(p) ? _parseVendorFile(p) : _emptyVendorInfo();
  const result = mutate(data);
  data.meta = data.meta || {};
  data.meta.last_updated = (now || new Date()).toISOString();
  _atomicWrite(dir, VENDOR_INFO_FILE, data, false);
  return result;
}

/** The order pool, `[]` when the file is absent or unreadable. */
function readPurchaseOrders(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, PURCHASE_ORDERS_FILE), 'utf8'));
    return data && Array.isArray(data.orders) ? data.orders : [];
  } catch {
    return [];
  }
}

/** `<prefix>-` + 4 random bytes as hex, unique within `existing` (a Set). */
function makeUniqueId(prefix, existing, rand) {
  const gen = rand || ((n) => require('crypto').randomBytes(n));
  for (let i = 0; i < 20; i++) {
    const id = prefix + '-' + Buffer.from(gen(4)).toString('hex');
    if (!existing.has(id)) return id;
  }
  throw new Error('Could not generate unique id for ' + prefix);
}

function nextSummaryId(assignments, rand) {
  return makeUniqueId('st', new Set(assignments.map((a) => a.id)), rand);
}

function nextProtocolId(data, rand) {
  return makeUniqueId('pr', new Set((data.protocols || []).map((p) => p.id)), rand);
}

module.exports = {
  MODULE_SUBDIR, AREAS, PROTOCOL_PROJECTS, SUMMARY_FILE, VENDOR_INFO_FILE, PURCHASE_ORDERS_FILE,
  protocolsFile, dataRoot, moduleRoot, rootReady, canWriteTarget,
  readSummary, writeSummary, protocolsExist, emptyProtocols, readProtocols, writeProtocols,
  readVendorInfo, updateVendorInfo, readPurchaseOrders,
  makeUniqueId, nextSummaryId, nextProtocolId, _atomicWrite,
};
