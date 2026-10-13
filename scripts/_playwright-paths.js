'use strict';
// scripts/_playwright-paths.js
// Where Playwright keeps its browsers, and which chromium builds are on disk.
//
// ONE source of truth, shared by two callers that must never disagree:
//   - scripts/bootstrap-playwright.js, which DOWNLOADS the browser
//   - server.js GET /api/tools/status, which REPORTS whether it is there
// A copied implementation would drift on the first Playwright path change and
// paint Settings > Tools green on a machine the bootstrapper still fixes.

const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Mirrors Playwright's own resolution order so the check matches reality.
 * @returns {string} absolute path to the browsers directory
 */
function browsersRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'ms-playwright');
  }
  return path.join(home, '.cache', 'ms-playwright');
}

/**
 * The chromium build directories already on disk, newest name last.
 * A missing or unreadable root is an empty list, never a throw: "no browser"
 * is an answer both callers know how to handle.
 * @returns {string[]}
 */
function installedChromium() {
  const root = browsersRoot();
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch (_) {
    return [];
  }
  return entries.filter((e) => /^chromium(_headless_shell)?-\d+$/.test(e)).sort();
}

module.exports = { browsersRoot, installedChromium };
