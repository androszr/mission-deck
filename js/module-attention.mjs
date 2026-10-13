// ── Mission Deck — js/module-attention.mjs ────────────────────────────
// The two to-do lists at the top of Settings > Modules > Installed:
// modules that need PUBLISHING (never in the catalog, or a local version
// above the catalog's) and modules that need UPDATING (the catalog has a
// newer version). Everything else stays in the menu-grouped table below.
//
// Versions are compared by classifyModuleUpdate (js/module-updates.mjs) - the
// one comparator the Katalog rows and the update banner use - so the three
// places can never disagree about the same pair of versions. A publish that
// is already waiting for review (an open MR from GET
// /api/modules/pending-publishes) stays on the publish list, marked as
// waiting, because the catalog's `main` only moves when somebody merges -
// but only while that MR carries the LOCAL version: a module bumped past its
// open MR (or a colleague's MR on the same id) needs a new publish, so the
// row keeps its "Publish" and merely links the MR.
// A module whose files differ from the published copy while its version is
// the SAME (GET /api/modules/publish-drift) is on the publish list too, as
// `same-version`: the publish gate would refuse it until the version is
// bumped, and nextPatchVersion() names the version the bump button offers.
//
// DOM-free on purpose: the unit suite imports this file directly.

import { classifyModuleUpdate } from './module-updates.mjs';

/**
 * @param {Array<{id: string, manifest?: {version?: string}}>} installed
 *   GET /api/modules/installed `installed[]` (the disk, never the boot snapshot)
 * @param {Array<{id: string, manifest?: {version?: string}}>|null} catalogEntries
 *   GET /api/modules/catalog `entries[]`, or null when the catalog could not be
 *   read - then nothing is classified, because "not in the catalog" would be
 *   a guess
 * @param {Array<{id: string, mrUrl?: string, version?: string|null}>} [pending] open publish MRs
 *   (`version` = module.json on the MR branch, null when unreadable)
 * @param {Array<{id: string, added?: number, changed?: number, removed?: number}>} [drift]
 *   modules whose files differ from the catalog copy at an equal version
 * @returns {{ catalogKnown: boolean,
 *   publish: Array<{id: string, item: object, reason: 'local'|'ahead'|'same-version', localVersion: string|null, catalogVersion: string|null, mrUrl: string|null, mrVersion: string|null, waiting: boolean, drift?: object, nextVersion?: string|null}>,
 *   update: Array<{id: string, item: object, localVersion: string|null, catalogVersion: string}> }}
 */
export function moduleAttention(installed, catalogEntries, pending = [], drift = []) {
  if (!Array.isArray(catalogEntries)) return { catalogKnown: false, publish: [], update: [] };
  const catalogById = new Map(catalogEntries.filter(e => e && typeof e.id === 'string').map(e => [e.id, e]));
  const pendingById = new Map((Array.isArray(pending) ? pending : [])
    .filter(p => p && typeof p.id === 'string').map(p => [p.id, p]));
  const driftById = new Map((Array.isArray(drift) ? drift : [])
    .filter(d => d && typeof d.id === 'string').map(d => [d.id, d]));
  const publish = [];
  const update = [];
  for (const item of Array.isArray(installed) ? installed : []) {
    if (!item || typeof item.id !== 'string') continue;
    const localVersion = typeof item.manifest?.version === 'string' ? item.manifest.version : null;
    const entry = catalogById.get(item.id);
    const catalogVersion = typeof entry?.manifest?.version === 'string' ? entry.manifest.version : null;
    const pend = pendingById.get(item.id);
    const mrUrl = pend ? (pend.mrUrl || '') : null;
    const mrVersion = pend && typeof pend.version === 'string' ? pend.version : null;
    // An MR whose version could not be read still counts as waiting - the
    // safer guess right after a publish, and the row links it either way.
    const waiting = Boolean(pend) && (mrVersion === null || mrVersion === localVersion);
    const mr = { mrUrl, mrVersion, waiting };
    if (!entry) {
      publish.push({ id: item.id, item, reason: 'local', localVersion, catalogVersion: null, ...mr });
      continue;
    }
    const state = classifyModuleUpdate(localVersion, catalogVersion);
    if (state === 'ahead') publish.push({ id: item.id, item, reason: 'ahead', localVersion, catalogVersion, ...mr });
    else if (state === 'update') update.push({ id: item.id, item, localVersion, catalogVersion });
    else if (state === 'current' && driftById.has(item.id)) {
      publish.push({
        id: item.id, item, reason: 'same-version', localVersion, catalogVersion, ...mr,
        drift: driftById.get(item.id), nextVersion: nextPatchVersion(localVersion),
      });
    }
  }
  const byName = (a, b) => ((a.item.manifest && a.item.manifest.name) || a.id)
    .localeCompare((b.item.manifest && b.item.manifest.name) || b.id, 'en');
  return { catalogKnown: true, publish: publish.sort(byName), update: update.sort(byName) };
}

/**
 * The version the "Bump version" button offers: patch + 1, the same rule the
 * server's bumpManifestPatch applies, keeping an optional leading "v" (the
 * forms compareSemver accepts). null for anything else, so the button is
 * never offered for a version the server would refuse.
 * @param {string|null|undefined} version
 * @returns {string|null}
 */
export function nextPatchVersion(version) {
  const m = typeof version === 'string' ? version.match(/^(v?)(\d+)\.(\d+)\.(\d+)$/) : null;
  return m ? m[1] + m[2] + '.' + m[3] + '.' + (Number(m[4]) + 1) : null;
}
