'use strict';
// modules/meeting-archive/server/paths.js
// Where the meeting archive lives on this machine: the meeting-archive/
// directory of the team data repo (data-tier-0, plaintext dir ds-data/).
// Nothing here creates or changes a path.

const fs = require('fs');
const path = require('path');

const FOLDER_RE = /^[A-Za-z0-9_.\-]+$/;

/**
 * Plaintext root of the team data source (data-tier-0). Resolved at CALL time
 * so a test can point DATA_SUB_REPOS_DIR at a temp tree.
 * @param {string} rootDir ctx.rootDir
 * @returns {string}
 */
function teamDataDir(rootDir) {
  const base = process.env.DATA_SUB_REPOS_DIR
    ? path.resolve(process.env.DATA_SUB_REPOS_DIR)
    : path.join(rootDir, 'data-sub-repositories');
  return path.join(base, 'ds-data');
}

/** @param {string} rootDir ctx.rootDir */
function meetingsDir(rootDir) {
  return path.join(teamDataDir(rootDir), 'meeting-archive');
}

/**
 * 'ok' when meeting-archive/ holds at least one directory, else 'unavailable'.
 * @param {string} rootDir ctx.rootDir
 * @returns {'ok'|'unavailable'}
 */
function storageState(rootDir) {
  try {
    const entries = fs.readdirSync(meetingsDir(rootDir), { withFileTypes: true });
    return entries.some((e) => e.isDirectory()) ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * A folder name a client may ask for: plain token, not a dot name, not a
 * shared file (those start with an underscore).
 * @param {unknown} name
 * @returns {boolean}
 */
function isValidFolder(name) {
  if (typeof name !== 'string' || !name || name.length > 200) return false;
  if (name === '.' || name === '..' || name.startsWith('_')) return false;
  return FOLDER_RE.test(name);
}

/**
 * Absolute folder path inside meeting-archive/, or null when it would escape.
 * @param {string} rootDir ctx.rootDir
 * @param {string} folder
 * @returns {string|null}
 */
function meetingDir(rootDir, folder) {
  if (!isValidFolder(folder)) return null;
  const base = meetingsDir(rootDir);
  const resolved = path.resolve(base, folder);
  return resolved.startsWith(base + path.sep) ? resolved : null;
}

module.exports = { FOLDER_RE, teamDataDir, meetingsDir, storageState, isValidFolder, meetingDir };
