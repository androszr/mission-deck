'use strict';
// modules/knowledge-base/server/paths.js
// Where the knowledge base lives on this machine: the knowledge-base/
// directory of the team data repo (data-tier-0, plaintext dir ds-data/).
// Read-only module: nothing here creates a directory. DATA_SUB_REPOS_DIR is
// read at CALL time (the API test suite sets it mid-case; a frozen
// module-level const would read the developer's own checkout).

const fs = require('fs');
const path = require('path');

const SKIPPED = new Set(['meetings', 'sql']);

/**
 * Knowledge base root inside the data-tier-0 plaintext tree.
 * @param {string} rootDir ctx.rootDir
 * @returns {string}
 */
function hubDir(rootDir) {
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(rootDir, 'data-sub-repositories');
  return path.join(base, 'ds-data', 'knowledge-base');
}

/**
 * 'ok' when the dir holds knowledge-base-areas.json or at least one
 * non-meetings area directory, else 'unavailable'.
 * @param {string} rootDir ctx.rootDir
 * @returns {'ok'|'unavailable'}
 */
function storageState(rootDir) {
  const dir = hubDir(rootDir);
  try {
    if (fs.existsSync(path.join(dir, 'knowledge-base-areas.json'))) return 'ok';
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const hit = entries.some((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIPPED.has(e.name));
    return hit ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

module.exports = { hubDir, storageState };
