'use strict';
// modules/meeting-transcripts/server/browser-channels.js
// Copied and adapted from modules/locations/server/browser-channels.js.
// Never imported from it - trust boundary (modules-template/README.md).
// Which Playwright `channel` values (chrome/msedge) can launch on THIS
// machine, checked against the known install paths per platform - no
// Chromium build on disk matches the pinned Playwright version, so the
// worker always drives a real browser
// install instead. Pure: `existsFn` is injected, this file never touches fs
// itself so it stays unit-testable without a real disk.

function knownExecutables(platform, env) {
  const e = env || {};
  if (platform === 'darwin') {
    return {
      chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      msedge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    };
  }
  if (platform === 'win32') {
    const programFiles = e.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = e['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = e.LOCALAPPDATA || '';
    const chrome = [
      programFiles + '\\Google\\Chrome\\Application\\chrome.exe',
      programFilesX86 + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    const msedge = [
      programFiles + '\\Microsoft\\Edge\\Application\\msedge.exe',
      programFilesX86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    if (localAppData) {
      chrome.push(localAppData + '\\Google\\Chrome\\Application\\chrome.exe');
      msedge.push(localAppData + '\\Microsoft\\Edge\\Application\\msedge.exe');
    }
    return { chrome, msedge };
  }
  // Linux
  return {
    chrome: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome'],
    msedge: ['/usr/bin/microsoft-edge'],
  };
}

/**
 * @param {string} platform process.platform
 * @param {object} env process.env-shaped object (for the Windows program-files variables)
 * @param {Function} existsFn fs.existsSync-shaped, injected for tests
 * @returns {Array<'chrome'|'msedge'>} subset present on this machine, in that order
 */
function availableChannels(platform, env, existsFn) {
  const exists = existsFn || (() => false);
  const known = knownExecutables(platform, env);
  const channels = [];
  if (known.chrome.some((p) => exists(p))) channels.push('chrome');
  if (known.msedge.some((p) => exists(p))) channels.push('msedge');
  return channels;
}

module.exports = { knownExecutables, availableChannels };
