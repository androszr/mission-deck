'use strict';
// modules/roadmap/server/paths.js
// Paths to the team data (data-tier-0) plaintext tree and its discovery-tasks/
// directory. Computed from an explicit rootDir at every call, never a frozen
// constant: the API test suite may set DATA_SUB_REPOS_DIR / DATA_TIER_0_DIR mid-case.

const fs = require('fs');
const path = require('path');

const JUNK_ENTRIES = new Set(['.gitignore', '.DS_Store']);

function teamDataDir(rootDir) {
  if (process.env.DATA_TIER_0_DIR && !process.env.DATA_SUB_REPOS_DIR) return path.resolve(process.env.DATA_TIER_0_DIR);
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(rootDir, 'data-sub-repositories');
  return path.join(base, 'ds-data');
}

function discoveryTasksDir(rootDir) {
  return path.join(teamDataDir(rootDir), 'discovery-tasks');
}

// 'unavailable' when the team data directory is missing or holds nothing but junk.
function storageState(rootDir) {
  let entries;
  try {
    entries = fs.readdirSync(teamDataDir(rootDir));
  } catch {
    return 'unavailable';
  }
  return entries.some((e) => !JUNK_ENTRIES.has(e)) ? 'ok' : 'unavailable';
}

module.exports = { teamDataDir, discoveryTasksDir, storageState };
