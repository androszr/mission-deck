'use strict';
// modules/usage-analytics/server/modules-map.js
// base_view -> module. Rule: exact match on a views[].id of any known module,
// else the LONGEST "<module-id>-" prefix, else 'core' ("Mission Deck Core").
// The dictionary is { <module-id>: { name, views: [{ id, label }] } }; the next
// run MERGES the previous aggregate's dictionary with the disk scan, so a module
// uninstalled later keeps its name.

const fs = require('fs');
const path = require('path');

const CORE_ID = 'core';
const CORE_NAME = 'Mission Deck Core';

/** @returns {Array<{id: string, name: string, views: Array<{id: string, label: string}>}>} */
function scanInstalledModules(rootDir) {
  const dir = process.env.MODULES_DIR || path.join(rootDir, 'modules');
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, n, 'module.json'), 'utf8'));
      if (!m || typeof m.id !== 'string' || !m.id) continue;
      const views = (Array.isArray(m.views) ? m.views : [])
        .filter((v) => v && typeof v.id === 'string')
        .map((v) => ({ id: v.id, label: String(v.label || v.title || v.id) }));
      out.push({ id: m.id, name: String(m.name || m.id), views });
    } catch { /* bad or missing manifest: skipped silently */ }
  }
  return out;
}

function _asDict(x) {
  if (!x) return {};
  if (Array.isArray(x)) {
    const d = {};
    for (const m of x) if (m && m.id) d[m.id] = { name: m.name || m.id, views: m.views || [] };
    return d;
  }
  return typeof x === 'object' ? x : {};
}

/** Scanned wins per id, previous ids survive. Accepts a dict or a list on either side. */
function mergeModuleDicts(previous, scanned) {
  const out = {};
  const prev = _asDict(previous);
  const cur = _asDict(scanned);
  for (const id of Object.keys(prev)) out[id] = prev[id];
  for (const id of Object.keys(cur)) out[id] = cur[id];
  return out;
}

const _index = new WeakMap();
function _indexOf(dict) {
  let ix = _index.get(dict);
  if (ix) return ix;
  const views = new Map();
  for (const id of Object.keys(dict)) {
    if (id === CORE_ID) continue;
    for (const v of (dict[id] && dict[id].views) || []) if (v && v.id) views.set(v.id, id);
  }
  const ids = Object.keys(dict).filter((id) => id !== CORE_ID).sort((a, b) => b.length - a.length);
  ix = { views, ids };
  _index.set(dict, ix);
  return ix;
}

/** @returns {string} module id or 'core' */
function resolveModule(baseView, dict) {
  if (!baseView || typeof baseView !== 'string') return CORE_ID;
  const ix = _indexOf(dict || {});
  const exact = ix.views.get(baseView);
  if (exact) return exact;
  for (const id of ix.ids) {
    if (baseView === id || baseView.startsWith(id + '-')) return id;
  }
  return CORE_ID;
}

module.exports = { CORE_ID, CORE_NAME, scanInstalledModules, mergeModuleDicts, resolveModule };
