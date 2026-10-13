// ── Mission Deck — js/module-updates.mjs ───────────────────────────────
// DOM-free pure helpers shared by server.js (lazy `await import(...)`, mirroring
// js/academy-stages.mjs) and js/update-banner.js. Semver stays in ONE
// place: every comparison here goes through compareSemver from
// js/version-format.js, never a second implementation (AC4).

import { compareSemver } from './version-format.js';

/**
 * Classifies an installed module against the catalog version of the same id.
 * @param {string|null|undefined} installedVersion local module.json version
 * @param {string|null|undefined} catalogVersion catalog module.json version
 * @returns {'update'|'current'|'ahead'|'unknown'}
 */
export function classifyModuleUpdate(installedVersion, catalogVersion) {
  const cmp = compareSemver(catalogVersion, installedVersion);
  if (cmp === null) return 'unknown';
  if (cmp === 1) return 'update';
  if (cmp === 0) return 'current';
  return 'ahead';
}

/**
 * The Katalog table's row state, derived from classifyModuleUpdate so the
 * catalog and the update banner can never disagree about the same pair of
 * versions (2026-09-13: the katalog kept a second comparator and read the
 * installed version from the boot-time /api/modules/manifest snapshot, so
 * six modules bumped after the last restart showed "Update" while the
 * banner said `current`). `ahead` and `unknown` both read as installed -
 * the table never proposes a downgrade and never guesses on an unparsable
 * version.
 * @param {string|null|undefined} installedVersion version on DISK, from
 *   /api/modules/installed - never from /api/modules/manifest
 * @param {string|null|undefined} catalogVersion the catalog entry's version
 * @returns {'dostepny'|'dostepna-aktualizacja'|'zainstalowany'}
 */
export function catalogRowState(installedVersion, catalogVersion) {
  if (typeof installedVersion !== 'string' || installedVersion.length === 0) return 'dostepny';
  return classifyModuleUpdate(installedVersion, catalogVersion) === 'update'
    ? 'dostepna-aktualizacja'
    : 'zainstalowany';
}

/**
 * `{ id: version }` off a GET /api/modules/installed payload - the fresh disk
 * scan, the same source handleModulesUpdates classifies from. Rows without a
 * string version are skipped rather than mapped to undefined, so a consumer's
 * `id in map` check answers "installed" only for a module that can be
 * compared.
 * @param {{installed?: Array<{id?: string, manifest?: {version?: unknown}}>}|null|undefined} payload
 * @returns {Object<string,string>}
 */
export function installedVersionMap(payload) {
  const out = {};
  const rows = payload && Array.isArray(payload.installed) ? payload.installed : [];
  for (const m of rows) {
    if (m && typeof m.id === 'string' && m.manifest && typeof m.manifest.version === 'string') {
      out[m.id] = m.manifest.version;
    }
  }
  return out;
}

/**
 * Refuses a publish that would not raise the catalog's version. Runs BEFORE
 * the module.json status write-back on the server, so a refusal leaves
 * nothing changed on disk.
 * @param {string|null|undefined} localVersion the module's own module.json version
 * @param {string|null|undefined} catalogVersion the catalog's current version, or
 *   null/undefined when the module is not in the catalog yet
 * @returns {{ok: true, checked: false}|{ok: true, checked: false, unparsable: true}|
 *   {ok: false, error: 'version-not-bumped', localVersion, catalogVersion, message: string}|
 *   {ok: true, checked: true}}
 */
export function publishVersionGate(localVersion, catalogVersion) {
  if (catalogVersion === null || catalogVersion === undefined) {
    return { ok: true, checked: false };
  }
  const cmp = compareSemver(localVersion, catalogVersion);
  if (cmp === null) {
    return { ok: true, checked: false, unparsable: true };
  }
  if (cmp <= 0) {
    return {
      ok: false,
      error: 'version-not-bumped',
      localVersion,
      catalogVersion,
      message: 'Raise the version in module.json — the catalog already has ' + catalogVersion
        + ' and you are publishing ' + localVersion + '.',
    };
  }
  return { ok: true, checked: true };
}

/**
 * Warns (never blocks) when the base a local copy was built on is strictly
 * older than the catalog's current version - the case publishVersionGate
 * cannot see: a version bump alone does not prove the local tree still
 * contains everyone else's work published in between.
 * @param {string|null|undefined} baseVersion the recorded origin version
 *   (`data/modules-origin.json`); the server passes `base && base.version`,
 *   so this arrives as `undefined`, not `null`, when there is no record
 * @param {string|null|undefined} catalogVersion the catalog's current version
 * @returns {{warn: false}|{warn: true, code: 'base-outdated', baseVersion: string,
 *   catalogVersion: string, message: string}}
 */
export function publishBaseWarning(baseVersion, catalogVersion) {
  const cmp = compareSemver(baseVersion, catalogVersion);
  if (cmp === null || cmp >= 0) return { warn: false };
  return {
    warn: true,
    code: 'base-outdated',
    baseVersion,
    catalogVersion,
    message: 'You are publishing on top of version ' + baseVersion + ', but the catalog already has ' + catalogVersion
      + ' - this may overwrite someone else\'s newer work.',
  };
}

/**
 * Parses the `cockpit.moduleUpdateSnoozed` localStorage string. Never throws:
 * anything unparsable or not a plain object comes back as `{}`.
 * @param {string|null|undefined} raw
 * @returns {Object<string,string>}
 */
export function parseSnoozed(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return { ...parsed };
}

/**
 * @param {Object<string,string>} snoozed
 * @param {string} id
 * @param {string} catalogVersion
 * @returns {boolean} true when this exact (id, catalogVersion) pair was snoozed
 */
export function isSnoozed(snoozed, id, catalogVersion) {
  return Boolean(snoozed) && snoozed[id] === catalogVersion;
}

/**
 * Returns a NEW object with the entry set - never mutates `snoozed`.
 * @param {Object<string,string>} snoozed
 * @param {string} id
 * @param {string} catalogVersion
 * @returns {Object<string,string>}
 */
export function withSnooze(snoozed, id, catalogVersion) {
  return { ...snoozed, [id]: catalogVersion };
}

/**
 * Drops stale snooze entries - a module that is no longer `update` at the
 * remembered version (removed, updated already, catalog moved on again) - so
 * the stored object never grows without bound.
 * @param {Object<string,string>} snoozed
 * @param {Array<{id: string, state: string, catalogVersion: (string|null)}>} modules
 * @returns {Object<string,string>}
 */
export function pruneSnoozed(snoozed, modules) {
  const byId = new Map((modules || []).map((m) => [m.id, m]));
  const out = {};
  for (const [id, version] of Object.entries(snoozed || {})) {
    const m = byId.get(id);
    if (m && m.state === 'update' && m.catalogVersion === version) out[id] = version;
  }
  return out;
}

/**
 * @param {Array<{id: string, state: string, name: string, enabled: (boolean|undefined)}>} modules
 * @param {Object<string,string>} snoozed
 * @returns {Array} modules with a pending, un-snoozed update on an ENABLED
 *   module, sorted by name. A module the person disabled in Settings >
 *   Modules must not appear in the banner - `enabled === false` is dropped;
 *   `enabled` missing entirely (an older payload shape) still counts as
 *   visible.
 */
export function visibleModuleUpdates(modules, snoozed) {
  return (modules || [])
    .filter((m) => m.state === 'update' && m.enabled !== false
      && !isSnoozed(snoozed, m.id, m.catalogVersion))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * English plural of "module": 1 -> "module", the rest -> "modules".
 * @param {number} n
 * @returns {string}
 */
export function pluralModules(n) {
  const word = _pluralWord(n);
  return n + ' ' + word;
}

function _pluralWord(n) {
  const abs = Math.abs(n);
  return abs === 1 ? 'module' : 'modules';
}

/**
 * Builds the banner's render model: one item per pending update (app first,
 * then modules), a summary sentence only when there is more than one, and
 * whether the list is expandable at all.
 * @param {boolean} appUpdate an application update is available
 * @param {Array} moduleRows visible module rows (already filtered/sorted)
 * @returns {{items: Array, summary: (string|null), expandable: boolean}}
 */
export function bannerModel(appUpdate, moduleRows) {
  const rows = moduleRows || [];
  const items = [];
  if (appUpdate) items.push({ kind: 'app' });
  for (const m of rows) {
    items.push({
      kind: 'module',
      id: m.id,
      name: m.name,
      installedVersion: m.installedVersion,
      catalogVersion: m.catalogVersion,
      dirty: Boolean(m.dirty),
    });
  }
  if (items.length === 0) return { items: [], summary: null, expandable: false };
  if (items.length === 1) return { items, summary: null, expandable: false };

  const moduleCount = rows.length;
  const summary = appUpdate
    ? `Updates available: the app and ${pluralModules(moduleCount)}`
    : `Updates available: ${pluralModules(moduleCount)}`;
  return { items, summary, expandable: true };
}

/**
 * Banner items a batch run attempts: every module row, in model order. A
 * module with local changes is NOT skipped here - the server's reconcile
 * (plan 2026-10-07) decides per module, and a 409 `module-dirty` lands in
 * that row's message. App items are never part of a batch: only "Update"
 * on the app row updates the app itself.
 * @param {Array} items bannerModel(...).items
 * @returns {{toUpdate: Array}}
 */
export function batchUpdateOrder(items) {
  const toUpdate = [];
  for (const item of items || []) {
    if (item.kind === 'module') toUpdate.push(item);
  }
  return { toUpdate };
}
