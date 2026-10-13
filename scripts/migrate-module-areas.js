#!/usr/bin/env node
'use strict';
// scripts/migrate-module-areas.js
// One-time, idempotent backfill of the `area` field (plan
// 2026-09-12-obszary-modulow.md) across every LOCAL module manifest under
// modules/. This is the ONLY place in the whole plan that writes a default
// value into `area` - every other function (validateModuleManifest,
// renderAreaBadge, ...) must never guess one, so a module this script has not
// reached yet stays visibly "Obszar nieokreslony" rather than silently
// "Product".
//
//   node scripts/migrate-module-areas.js --dry-run   preview only
//   node scripts/migrate-module-areas.js             writes modules/*/module.json
//   node scripts/migrate-module-areas.js --json       machine-readable report
//   node scripts/migrate-module-areas.js --root <dir> scan a different root (tests)
//
// A module that already has a (valid) `area` is left untouched and reported
// as `skip-has-area` - running this twice must report zero `set` decisions
// the second time (AC6).
//
// Exit: 0 success, 1 failed writes, 2 usage or read error.

const fs = require('fs');
const path = require('path');
const R = require('./_report');

const HELP = `
migrate-module-areas.js - one-time backfill of module.json "area"

Usage:
  node scripts/migrate-module-areas.js [--dry-run] [--json] [--root <dir>]

Default area: Product.
A module that already has an area is skipped, never overwritten.

Exit codes: 0 ok, 1 failed writes, 2 usage or read error.
`;

// Mirrors server.js MODULE_AREA_SUGGESTIONS[0] as the migration default -
// deliberately NOT required to import server.js (this script must keep
// working while server.js is mid-edit, same reasoning as scripts/new-module.js).
const DEFAULT_AREA = 'Product';
const AREA_OVERRIDES = {};

/**
 * Pure decision function - no I/O. For every module id, decide whether this
 * run would SET an area (and which one) or SKIP it because it already has
 * one.
 * @param {string[]} ids module directory names found under modules/
 * @param {{defaultArea?: string, overrides?: Object<string,string>, existing?: Object<string,unknown>}} opts
 *   `existing` maps id -> the module's current `area` value (or undefined).
 * @returns {{id: string, decision: 'set'|'skip-has-area', area?: string}[]}
 */
function planAreaMigration(ids, opts = {}) {
  const defaultArea = opts.defaultArea || DEFAULT_AREA;
  const overrides = opts.overrides || AREA_OVERRIDES;
  const existing = opts.existing || {};
  return ids.map((id) => {
    const current = existing[id];
    if (typeof current === 'string' && current.trim()) {
      return { id, decision: 'skip-has-area' };
    }
    const area = Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : defaultArea;
    return { id, decision: 'set', area };
  });
}

/**
 * Writes `area` into one module.json, right after `status` when present
 * (same convention as setManifestArea in server.js), otherwise at the end.
 * Two-space indent, trailing newline, tmp + rename - same shape every
 * generator in this repo writes.
 * @param {string} manifestPath
 * @param {string} area
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function writeManifestArea(manifestPath, area) {
  let text;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch (e) {
    return { ok: false, error: 'cannot read ' + manifestPath + ': ' + e.message };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'invalid JSON in ' + manifestPath + ': ' + e.message };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: manifestPath + ' is not a JSON object' };
  }
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'area') continue;
    out[k] = v;
    if (k === 'status' && !placed) { out.area = area; placed = true; }
  }
  if (!placed) out.area = area;
  const next = JSON.stringify(out, null, 2) + '\n';
  const tmp = manifestPath + '.tmp';
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, manifestPath);
  return { ok: true };
}

function run(flags) {
  const root = flags.root ? path.resolve(String(flags.root)) : R.ROOT;
  const modulesDir = path.join(root, 'modules');

  const ids = fs.readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  const existing = {};
  for (const id of ids) {
    const manifestPath = path.join(modulesDir, id, 'module.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error(manifestPath + ' is not a JSON object');
    }
    existing[id] = manifest.area;
  }

  const decisions = planAreaMigration(ids, { existing });
  return { modulesDir, decisions };
}

function main() {
  const { flags } = R.parseArgs(process.argv.slice(2), { booleans: ['dry-run'] });
  if (flags.help) R.showHelp(HELP);

  let plan;
  try {
    plan = run(flags);
  } catch (error) {
    process.stderr.write('Module area migration failed: ' + error.message + '\n');
    process.exitCode = 2;
    return;
  }
  const { modulesDir, decisions } = plan;
  const toSet = decisions.filter((d) => d.decision === 'set');
  const results = [];

  if (!flags['dry-run']) {
    for (const d of toSet) {
      const manifestPath = path.join(modulesDir, d.id, 'module.json');
      const written = writeManifestArea(manifestPath, d.area);
      results.push({ id: d.id, area: d.area, ok: written.ok, error: written.ok ? null : written.error });
    }
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({
      script: 'migrate-module-areas',
      dry_run: Boolean(flags['dry-run']),
      decisions,
      written: results,
    }, null, 2) + '\n');
  } else {
    const t = ['MIGRATE MODULE AREAS' + (flags['dry-run'] ? ' (dry run)' : ''), ''];
    for (const d of decisions) {
      if (d.decision === 'skip-has-area') t.push('  skip   ' + d.id + '  (already has an area)');
      else {
        const outcome = flags['dry-run'] ? 'would set' : results.find((r) => r.id === d.id)?.ok ? 'set      ' : 'failed   ';
        t.push('  ' + outcome + ' ' + d.id + '  -> "' + d.area + '"');
      }
    }
    if (decisions.length === 0) t.push('  (no modules found under ' + modulesDir + ')');
    const updated = flags['dry-run'] ? toSet.length : results.filter((r) => r.ok).length;
    t.push('', updated + ' module(s) ' + (flags['dry-run'] ? 'would be updated' : 'updated') + ', '
      + (decisions.length - toSet.length) + ' skipped (already had an area).');
    if (!flags['dry-run']) {
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        t.push('', 'FAILED to write:');
        for (const f of failed) t.push('  ' + f.id + ': ' + f.error);
      }
    }
    process.stdout.write(t.join('\n') + '\n');
  }
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
}

if (require.main === module) {
  main();
} else {
  module.exports = { planAreaMigration, writeManifestArea, run, DEFAULT_AREA, AREA_OVERRIDES };
}
