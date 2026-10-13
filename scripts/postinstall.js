#!/usr/bin/env node
// Run automatically after `npm install`. Jobs, all cross-platform:
//
// 1. Fix execute permissions on node-pty's spawn-helper binaries on macOS -
//    without it the in-app Claude terminal cannot spawn a PTY. On Windows and
//    Linux these binaries are absent or not needed, so that part is a no-op.
// 2. Delete node-pty's prebuild directories for every platform other than
//    this one - `optionalDependencies` still ships every prebuild in the
//    tarball, and only one of them will ever run on this machine.
// 3. Print a one-line hint when the optional tooling (Playwright browsers,
//    GitNexus index, dev toolchain) is missing. None of these fail the
//    install on purpose - the browser download alone is ~150 MB and only
//    the visual verification path needs it, and the lean start profile is
//    meant to skip devDependencies entirely.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Returns the entries of `entries` (prebuild directory names such as
// "darwin-arm64" or "win32-x64") whose platform segment - everything before
// the first "-" - does not match `platform`. A name with no "-" has an
// unrecognized shape and is never returned: this function only ever deletes
// directories it can positively identify as belonging to another platform.
function foreignPrebuildDirs(entries, platform) {
  return (entries || []).filter((name) => {
    const dashIndex = name.indexOf('-');
    if (dashIndex === -1) return false;
    const entryPlatform = name.slice(0, dashIndex);
    return entryPlatform !== platform;
  });
}

function main() {
  if (process.platform === 'darwin') {
    const prebuilds = ['darwin-arm64', 'darwin-x64'];
    let fixed = 0;
    for (const arch of prebuilds) {
      const helper = path.join('node_modules', 'node-pty', 'prebuilds', arch, 'spawn-helper');
      try {
        fs.accessSync(helper, fs.constants.F_OK);
        fs.chmodSync(helper, 0o755);
        fixed++;
      } catch (_) { /* prebuild for this arch not installed, skip */ }
    }
    if (fixed > 0) {
      console.log(`[postinstall] node-pty spawn-helper chmod +x applied (${fixed} arch)`);
    }
  }

  // ── Foreign node-pty prebuilds cleanup (never fatal) ────────────────────
  try {
    const prebuildsDir = path.join('node_modules', 'node-pty', 'prebuilds');
    const entries = fs.readdirSync(prebuildsDir);
    const foreign = foreignPrebuildDirs(entries, process.platform);
    for (const name of foreign) {
      fs.rmSync(path.join(prebuildsDir, name), { recursive: true, force: true });
    }
    if (foreign.length > 0) {
      console.log(`[postinstall] node-pty prebuilds: removed ${foreign.length} foreign target(s) (${foreign.join(', ')})`);
    }
  } catch (_) { /* node-pty not installed (optionalDependencies), no permission, or anything else - no-op */ }

  // ── Optional tooling hints (never fatal) ─────────────────────────────────

  try {
    if (!fs.existsSync(path.join('node_modules', 'eslint'))) {
      console.log('[postinstall] Dev tools not installed. Co-create profile: npm install --include=dev');
    }
    if (!hasChromium()) {
      console.log('[postinstall] Visual verification needs a browser. Run: node scripts/bootstrap-playwright.js');
    }
    if (!fs.existsSync(path.join(__dirname, '..', '.gitnexus'))) {
      console.log('[postinstall] Code-graph review needs an index. Run: node scripts/bootstrap-gitnexus.js');
    }
  } catch (_) { /* hints are best-effort - never fail the install */ }
}

function playwrightBrowsersRoot() {
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

function hasChromium() {
  try {
    return fs.readdirSync(playwrightBrowsersRoot())
      .some((e) => /^chromium(_headless_shell)?-\d+$/.test(e));
  } catch (_) {
    return false;
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { foreignPrebuildDirs };
}
