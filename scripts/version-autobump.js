'use strict';
// scripts/version-autobump.js
//
// On every real server startup, detects whether the repo's git HEAD moved
// since the last recorded startup and, if so (and only when the current
// branch is `main`), bumps the patch segment of the plaintext VERSION file
// at the repo root. The HEAD seen at the last bump is persisted in a
// gitignored marker file `.version-head` at the repo root.
//
// After a successful bump on main, the module commits the VERSION file
// (pathspec-limited, never sweeps in other changes) with the message
// `release: vX.Y.Z` and, when a `pushUrl` is provided, pushes it to
// `HEAD:main`. Commit-only (no push) when `pushUrl` is falsy. See
// docs/architecture/app-update.md and
// docs/architecture/app-update.md.
//
// If that push is rejected because main moved concurrently (another writer,
// e.g. a release landing through a Merge Request, went first), the module makes one
// fetch+rebase+retry attempt before giving up -- see _fetchRebaseRetry. This
// closes the race that otherwise leaves main permanently diverged from
// origin until someone notices via a failed agent app_update() and fixes it
// by hand (incident 2026-07-23).
//
// Standalone CommonJS module (no server.js dependency) so it stays
// unit-testable against a temp git repo without loading the 36k-LOC server.

const fs = require('fs');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');

const execFileAsync = promisify(execFile);

const MARKER_FILE = '.version-head';
const VERSION_FILE = 'VERSION';
const SHA_RE = /^[0-9a-f]{40}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function git(rootDir, args) {
  return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Mirrors server.js _gitNoPromptEnv -- this module is standalone (no server.js
// dependency), so it keeps its own copy. Git asks for a credential through
// GIT_ASKPASS -> core.askPass -> SSH_ASKPASS -> the terminal, and only the last
// one is gated by GIT_TERMINAL_PROMPT: a server started from an editor terminal
// inherits that editor's askpass helper, so this startup push popped an input
// box asking for a GitLab token on every restart. It must fail silently instead.
function _gitNoPromptEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  delete env.VSCODE_GIT_ASKPASS_NODE;
  delete env.VSCODE_GIT_ASKPASS_MAIN;
  delete env.VSCODE_GIT_ASKPASS_EXTRA_ARGS;
  delete env.VSCODE_GIT_IPC_HANDLE;
  env.GIT_TERMINAL_PROMPT = '0';
  env.SSH_ASKPASS_REQUIRE = 'never';
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'core.askpass';
  env.GIT_CONFIG_VALUE_0 = '';
  return env;
}

// Mirrors server.js:786-789 -- this module is standalone (no server.js
// dependency), so it keeps its own copy.
function _scrubGitTokens(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\/\/[^@\s]*@/g, '//[REDACTED]@');
}

// Pathspec-limited commit -- stages and commits ONLY the VERSION file, even
// if the working tree has other pending changes, and can never sweep in the
// gitignored `.version-head` marker. Never throws; returns false on failure.
function _commitVersionFile(rootDir, version) {
  const authorName = process.env.GIT_AUTHOR_NAME || process.env.GITLAB_USER_NAME || 'Cockpit';
  const authorEmail = process.env.GIT_AUTHOR_EMAIL || process.env.GITLAB_USER_LOGIN || 'cockpit@local';
  try {
    git(rootDir, [
      '-c', `user.name=${authorName}`,
      '-c', `user.email=${authorEmail}`,
      'commit', '-m', `release: v${version}`, '--', VERSION_FILE,
    ]);
    return true;
  } catch (e) {
    console.warn('[startup] version-autobump: commit failed:', _scrubGitTokens(e && e.message));
    return false;
  }
}

// A rejected `push HEAD:main` (no local tracking ref, so git reports
// "(fetch first)" rather than "(non-fast-forward)") means some other writer
// -- e.g. a release landing on main through a Merge Request --
// landed on main between our commit and this push. That's the exact race
// that caused a silent local/origin divergence in the past (see incident
// 2026-07-23): this autobump committed `release: v0.6.28` locally, the push
// failed quietly, and the next agent app_update() refused with
// not-fast-forward until someone noticed and fixed it by hand.
function _isFetchFirstRejection(stderr) {
  const s = String(stderr || '');
  return /\[rejected\]/.test(s) && /(non-fast-forward|fetch first)/i.test(s);
}

// One-shot recovery for that race: fetch the real main from pushUrl and
// rebase our single VERSION-bump commit onto it. Never forces, never resets
// past the original HEAD -- aborts and restores the pre-rebase HEAD on any
// conflict, leaving the local commit exactly as it was so the existing
// "keep the local commit, log a warning" fallback still applies.
async function _fetchRebaseRetry(rootDir, pushUrl) {
  const authorName = process.env.GIT_AUTHOR_NAME || process.env.GITLAB_USER_NAME || 'Cockpit';
  const authorEmail = process.env.GIT_AUTHOR_EMAIL || process.env.GITLAB_USER_LOGIN || 'cockpit@local';

  try {
    await execFileAsync('git', ['-c', 'credential.helper=', 'fetch', pushUrl, 'main'], {
      cwd: rootDir,
      timeout: 30000,
      env: _gitNoPromptEnv(),
    });
  } catch (e) {
    console.warn('[startup] version-autobump: fetch (retry) failed:', _scrubGitTokens(e && (e.stderr || e.message)));
    return false;
  }

  try {
    await execFileAsync(
      'git',
      ['-c', `user.name=${authorName}`, '-c', `user.email=${authorEmail}`, 'rebase', 'FETCH_HEAD'],
      { cwd: rootDir, timeout: 15000 },
    );
    return true;
  } catch (e) {
    console.warn('[startup] version-autobump: rebase (retry) failed, aborting:', _scrubGitTokens(e && (e.stderr || e.message)));
    try { execFileSync('git', ['rebase', '--abort'], { cwd: rootDir, timeout: 5000 }); } catch { /* nothing to abort */ }
    // Resolve any leftover unmerged index entries (e.g. .version-head conflict)
    try {
      const uf = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: rootDir, timeout: 5000, encoding: 'utf8' }).trim();
      if (uf) {
        for (const f of uf.split('\n')) {
          try {
            execFileSync('git', ['checkout', '--theirs', '--', f.trim()], { cwd: rootDir, timeout: 5000 });
            execFileSync('git', ['add', '--', f.trim()], { cwd: rootDir, timeout: 5000 });
          } catch { /* best effort */ }
        }
        console.warn('[startup] version-autobump: resolved leftover unmerged entries:', uf.replace(/\n/g, ', '));
      }
    } catch { /* no unmerged entries */ }
    return false;
  }
}

// Async push (never the sync execFileSync helper) -- a network push can take
// tens of seconds and must not block the Node event loop during startup.
// Never throws; returns false on failure. Never forces the push. On a
// fetch-first rejection, tries exactly one fetch+rebase+retry before giving
// up -- see _fetchRebaseRetry above for why.
async function _pushMain(rootDir, pushUrl) {
  try {
    await execFileAsync('git', ['-c', 'credential.helper=', 'push', pushUrl, 'HEAD:main'], {
      cwd: rootDir,
      timeout: 30000,
      env: _gitNoPromptEnv(),
    });
    return true;
  } catch (e) {
    const stderr = e && (e.stderr || e.message);
    if (!_isFetchFirstRejection(stderr)) {
      console.warn('[startup] version-autobump: push failed:', _scrubGitTokens(stderr));
      return false;
    }
    console.warn('[startup] version-autobump: push rejected (remote moved), retrying via fetch+rebase:', _scrubGitTokens(stderr));
    const rebased = await _fetchRebaseRetry(rootDir, pushUrl);
    if (!rebased) return false;
    try {
      await execFileAsync('git', ['-c', 'credential.helper=', 'push', pushUrl, 'HEAD:main'], {
        cwd: rootDir,
        timeout: 30000,
        env: _gitNoPromptEnv(),
      });
      console.log('[startup] version-autobump: push succeeded after fetch+rebase retry');
      return true;
    } catch (e2) {
      console.warn('[startup] version-autobump: push failed even after fetch+rebase retry:', _scrubGitTokens(e2 && (e2.stderr || e2.message)));
      return false;
    }
  }
}

async function autoBumpVersion({ rootDir, commit, pushUrl }) {
  try {
    // a. Env guard -- keeps test servers (which spawn the real server.js as a
    // child process from the repo root) from ever mutating the real VERSION.
    if (process.env.VERSION_AUTOBUMP === '0' || process.env.NODE_ENV === 'test') {
      return { skipped: 'disabled' };
    }

    // a2. Untrack .version-head if it's still in the index (was committed
    // before being gitignored; tracked copies cause merge conflicts that
    // poison the index on branch switches).
    try {
      const tracked = execFileSync('git', ['ls-files', MARKER_FILE], { cwd: rootDir, timeout: 5000, encoding: 'utf8' }).trim();
      if (tracked) {
        execFileSync('git', ['rm', '--cached', '--', MARKER_FILE], { cwd: rootDir, timeout: 5000 });
        console.log('[startup] version-autobump: untracked .version-head from index');
      }
    } catch { /* already untracked or no git */ }

    // b. Branch guard -- bump only ever fires on main. Anything else
    // (including a git failure) leaves the marker untouched: when the user
    // returns to main with a new HEAD, the bump fires once.
    let branch;
    try {
      branch = git(rootDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    } catch {
      return { skipped: 'no-git' };
    }
    if (branch !== 'main') {
      return { skipped: 'not-main' };
    }

    // c. Current HEAD. Fails on an empty repo (ensureGitRepo git-inits with
    // zero commits) or a missing git binary -- silent no-op.
    let head;
    try {
      head = git(rootDir, ['rev-parse', 'HEAD']);
    } catch {
      return { skipped: 'no-head' };
    }

    const markerPath = path.join(rootDir, MARKER_FILE);

    // d. Marker read.
    let marker = null;
    try {
      const raw = fs.readFileSync(markerPath, 'utf8').trim();
      if (SHA_RE.test(raw)) marker = raw;
    } catch {
      // missing marker file -- treated as unparseable below
    }

    if (!marker) {
      // Seed: first startup after this feature ships, or a fresh clone.
      // No bump on the first sighting.
      fs.writeFileSync(markerPath, head + '\n', 'utf8');
      return { seeded: true };
    }

    if (marker === head) {
      return { skipped: 'unchanged' };
    }

    try {
      git(rootDir, ['cat-file', '-e', marker]);
    } catch {
      // Marker sha is not a known object (history rewrite, gc, different
      // clone) -- re-seed instead of bumping against an unrelated baseline.
      fs.writeFileSync(markerPath, head + '\n', 'utf8');
      return { reseeded: true };
    }

    // e. Manual-bump skip -- the incoming commits already carry a deliberate
    // VERSION change (the "Wersja po merge" MR flow in js/settings.js).
    let changedFiles = '';
    try {
      changedFiles = git(rootDir, ['diff', '--name-only', `${marker}..${head}`, '--', VERSION_FILE]);
    } catch {
      changedFiles = '';
    }
    if (changedFiles.split('\n').map((s) => s.trim()).includes(VERSION_FILE)) {
      fs.writeFileSync(markerPath, head + '\n', 'utf8');
      return { skipped: 'manual-bump' };
    }

    // f. Bump the patch segment.
    const versionPath = path.join(rootDir, VERSION_FILE);
    let from = null;
    try {
      from = fs.readFileSync(versionPath, 'utf8').trim();
    } catch {
      from = null;
    }
    if (!from || !SEMVER_RE.test(from)) {
      console.warn('[startup] version-autobump: VERSION invalid, skipping');
      return { skipped: 'version-invalid' };
    }

    // Always loaded relative to this module's own location (not rootDir) --
    // rootDir may be a throwaway fixture repo in tests, but the semver helper
    // itself is a fixed part of this codebase.
    const versionFormatUrl = pathToFileURL(path.join(__dirname, '..', 'js', 'version-format.js')).href;
    const { bumpPatch } = await import(versionFormatUrl);
    const to = bumpPatch(from);
    if (!to) {
      console.warn('[startup] version-autobump: VERSION invalid, skipping');
      return { skipped: 'version-invalid' };
    }

    fs.writeFileSync(versionPath, to + '\n', 'utf8');
    fs.writeFileSync(markerPath, head + '\n', 'utf8');
    console.log(`[startup] VERSION auto-bump ${from} -> ${to} (HEAD ${head.slice(0, 7)})`);

    if (!commit) {
      return { bumped: true, from, to };
    }

    const committed = _commitVersionFile(rootDir, to);
    let pushed = false;
    if (committed) {
      // Commit moved HEAD -- advance the marker to the new HEAD so the next
      // startup sees a clean `skipped: 'unchanged'` instead of re-taking the
      // manual-bump re-seed path.
      try {
        const newHead = git(rootDir, ['rev-parse', 'HEAD']);
        fs.writeFileSync(markerPath, newHead + '\n', 'utf8');
      } catch (e) {
        console.warn('[startup] version-autobump: post-commit marker update failed:', _scrubGitTokens(e && e.message));
      }
      if (typeof pushUrl === 'string' && pushUrl) {
        pushed = await _pushMain(rootDir, pushUrl);
      }
    }
    return { bumped: true, from, to, committed, pushed };
  } catch (e) {
    // g. Must never throw -- server startup can never be blocked by this.
    console.warn('[startup] version-autobump failed:', e && e.message);
    return { skipped: 'error' };
  }
}

module.exports = { autoBumpVersion };
