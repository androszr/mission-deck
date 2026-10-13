'use strict';
// scripts/_module-git.js
// Dependency-free git helper for ONE module's own repository, shared by
// server.js and scripts/new-module.js (both require() it directly, never a
// copy). Plan: docs/architecture/modules.md.
//
// The whole point of this file is one pin. modules/<id>/ sits INSIDE the
// mission-deck work tree, so a bare `git -C modules/<id> status` (or even
// `rev-parse --is-inside-work-tree`) happily answers for the PARENT
// repository the moment modules/<id>/.git does not exist yet - no error, no
// warning, just the wrong repo. Every call below is therefore pinned with
// `--git-dir <dir>/.git --work-tree <dir>` (see _gitArgs), and `present` is a
// plain fs.existsSync check on `<dir>/.git`, never a git answer that a bare
// invocation could have faked.
//
// No dependencies: fs, path, child_process only. Never a shell - git is a
// real binary on every platform, `execFile` only.

const fs = require('fs');
const path = require('path');
// Through scripts/_cp.js, not child_process directly: inside the server the
// module is already patched (windowsHide on every spawn), and this line keeps
// the same default when the file is loaded on its own (tests, scripts).
const { execFile } = require('./_cp');

const DEFAULT_AUTHOR = { name: 'Cockpit', email: 'cockpit@local' };
// One node_modules-ish set of ignores a module is likely to accumulate
// locally; never written over an existing .gitignore (a person's own rules
// win).
const MODULE_GITIGNORE_LINES = ['node_modules/', '__pycache__/', '*.pyc', '.pytest_cache/', 'downloads/'];
// Caches a module regenerates on its own and OS litter - the only paths an
// install swap may drop without asking. Written into `.git/info/exclude`
// (ensureModuleGitExclude), which lives inside `.git`: it survives every
// catalog install (the swap keeps `.git` but rebuilds the tree, and the
// publish never sends the dotfile `.gitignore`, so that file is gone after
// the first install) and it is never published. Without it one Python run
// (`__pycache__/`) made the module "dirty" and every update a false alarm.
// `downloads/` is deliberately NOT here: it holds user files, and once git
// ignores a path the install guard no longer sees it and the swap deletes it.
const MODULE_DROP_SAFE_EXCLUDES = ['__pycache__/', '*.py[co]', 'node_modules/', '.pytest_cache/', '.DS_Store', 'Thumbs.db'];
const EXCLUDE_MARKER = '# cockpit: regenerable module caches (ensureModuleGitExclude)';
const GIT_TIMEOUT_MS = 5000;

/**
 * True for a module-relative path inside a regenerable cache or OS litter -
 * the same set as MODULE_DROP_SAFE_EXCLUDES, as a path test. Pure.
 * @param {string} relPath forward-slash path relative to modules/<id>/
 * @returns {boolean}
 */
function isDropSafeModulePath(relPath) {
  return String(relPath).split('/').some((seg) => seg === '__pycache__' || seg === 'node_modules'
    || seg === '.pytest_cache' || seg === '.DS_Store' || seg === 'Thumbs.db' || /\.py[co]$/.test(seg));
}

/**
 * Idempotently appends MODULE_DROP_SAFE_EXCLUDES to `<dir>/.git/info/exclude`.
 * Called from the read paths (status, unsaved paths) and init, so every
 * existing module repository heals itself on its next status read, with no
 * migration pass. Writes only when a line is missing. Never throws.
 * @param {string} dir absolute path to modules/<id>/
 * @returns {boolean} true when the file now carries every line
 */
function ensureModuleGitExclude(dir) {
  try {
    const gitDir = path.join(dir, '.git');
    if (!fs.statSync(gitDir).isDirectory()) return false;
    const file = path.join(gitDir, 'info', 'exclude');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* missing: created below */ }
    const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const missing = MODULE_DROP_SAFE_EXCLUDES.filter((l) => !have.has(l));
    if (missing.length === 0) return true;
    const head = text && !text.endsWith('\n') ? '\n' : '';
    const block = (have.has(EXCLUDE_MARKER) ? '' : EXCLUDE_MARKER + '\n') + missing.join('\n') + '\n';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, head + block);
    return true;
  } catch {
    return false;
  }
}

let _gitAvailableCache = null;

/**
 * Pins every call to the module's OWN repository, never the enclosing
 * mission-deck work tree. This is the mandatory pin the whole file exists for.
 * @param {string} dir absolute path to modules/<id>/
 * @param {string[]} args git subcommand and its arguments
 * @returns {string[]}
 */
function _gitArgs(dir, args) {
  return ['--git-dir', path.join(dir, '.git'), '--work-tree', dir, ...args];
}

/**
 * Child env for a spawned git: strips GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE
 * (an inherited value would silently redirect every pinned call above) and
 * forces GIT_TERMINAL_PROMPT=0 so a missing credential fails instead of
 * popping a prompt no one can answer from a background request.
 * @param {{env?: object}} opts
 * @returns {object}
 */
function _env(opts) {
  const env = { ...(opts && opts.env ? opts.env : process.env) };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/**
 * Runs one git invocation. Never throws - every outcome (success, non-zero
 * exit, timeout, git missing on PATH) resolves to the same shape.
 * @param {string[]} args
 * @param {{env?: object, timeout?: number}} [opts]
 * @returns {Promise<{ok: boolean, killed: boolean, stdout: string, stderr: string, error: string|null}>}
 */
function _run(args, opts = {}) {
  return new Promise((resolve) => {
    execFile('git', args, {
      timeout: opts.timeout || GIT_TIMEOUT_MS,
      env: _env(opts),
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        killed: Boolean(err && err.killed),
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err ? String(err.message || err) : null,
      });
    });
  });
}

/** First non-empty line of stderr, falling back to the spawn error message. */
function _firstLine(res) {
  const text = String(res.stderr || res.error || res.stdout || '');
  const line = text.split('\n').map((s) => s.trim()).find(Boolean);
  return line || 'git error';
}

/**
 * Is git on PATH at all? Cached per process for the common case (no custom
 * env); a call with a custom `opts.env` (used by tests to probe a PATH-less
 * environment) always runs fresh and never poisons the cache other callers
 * rely on.
 * @param {{env?: object}} [opts]
 * @returns {Promise<boolean>}
 */
async function gitAvailable(opts = {}) {
  if (!opts.env && _gitAvailableCache !== null) return _gitAvailableCache;
  const r = await _run(['--version'], opts);
  if (!opts.env) _gitAvailableCache = r.ok;
  return r.ok;
}

/**
 * The branch name out of the "## ..." header line of `git status --porcelain
 * --branch` (already stripped of its "## " prefix). Shapes: "main",
 * "main...origin/main [ahead 1]", "No commits yet on main", "HEAD (no branch)".
 * @param {string} header
 * @returns {string} empty string when nothing usable is there
 */
function _branchFromStatusHeader(header) {
  let h = String(header || '').trim();
  // 'Initial commit on' is what git before 2.15 printed for the same state.
  const unborn = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(h);
  if (unborn) h = unborn[1];
  if (/^HEAD \(/.test(h)) return 'HEAD';
  const dots = h.indexOf('...');
  if (dots !== -1) h = h.slice(0, dots);
  return h.trim();
}

/**
 * Status of a module's own repository. `present:false` (a plain existsSync,
 * never a git answer) when there is no `<dir>/.git` at all - the state every
 * module scaffolded before this feature is in. Any other failure - git
 * missing on PATH, a corrupt repository - answers `{present:true, error}`
 * rather than throwing, because a card in Settings > Modules must always
 * have something to render.
 * @param {string} dir absolute path to modules/<id>/
 * @param {{env?: object}} [opts]
 * @returns {Promise<{present: boolean, branch?: string, dirty?: boolean, changedFiles?: number, lastCommit?: {sha7: string, date: string, subject: string}|null, error?: string}>}
 */
async function moduleGitStatus(dir, opts = {}) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { present: false };
  ensureModuleGitExclude(dir);

  // One spawn for branch AND dirtiness: `--branch` puts a "## <branch>" line
  // first, which on an UNBORN branch reads "## No commits yet on <branch>" -
  // so a freshly-init'd, not-yet-committed repo still reports branch:'main'
  // (`rev-parse --abbrev-ref HEAD` would fail there). GET /api/modules/installed
  // runs this once per module on every Modules tab render, so a spawn saved here
  // is saved N times per render.
  const statusRes = await _run(_gitArgs(dir, ['status', '--porcelain', '--branch']), opts);
  if (!statusRes.ok) {
    return { present: true, error: _firstLine(statusRes) };
  }
  const lines = statusRes.stdout.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const headerIdx = lines.findIndex((l) => l.startsWith('## '));
  const header = headerIdx === -1 ? '' : lines[headerIdx].slice(3);
  const branch = _branchFromStatusHeader(header) || 'main';
  const changedFiles = lines.filter((l, i) => i !== headerIdx).length;
  const dirty = changedFiles > 0;

  // An unborn branch fails `log` with "does not have any commits yet" - that
  // is the normal post-init, pre-commit state, not an error, so it degrades
  // to lastCommit:null instead of the {present:true, error} shape above.
  const logRes = await _run(_gitArgs(dir, ['log', '-1', '--pretty=%h\x1f%aI\x1f%s']), opts);
  let lastCommit = null;
  if (logRes.ok && logRes.stdout.trim()) {
    const [sha7, date, subject] = logRes.stdout.trim().split('\x1f');
    lastCommit = { sha7, date, subject };
  }

  return { present: true, branch, dirty, changedFiles, lastCommit };
}

const GIT_LOG_DEFAULT_LIMIT = 20;
const GIT_LOG_MAX_LIMIT = 100;

/**
 * Recent commits of a module's own repository, newest first - the list the
 * card's "Historia" toggle expands under the "ostatni zapis" line. Deliberately
 * NOT part of moduleGitStatus: that one runs once per module on every Modules
 * tab render, this one runs once per click. Same three shapes as the status:
 * `present:false` (no `<dir>/.git`), `{present:true, error}` for a git failure,
 * and `{present:true, commits}` - an unborn branch (init, no commit yet)
 * answers an empty list, never an error.
 * @param {string} dir absolute path to modules/<id>/
 * @param {{env?: object, limit?: number}} [opts]
 * @returns {Promise<{present: boolean, commits?: Array<{sha7: string, date: string, subject: string}>, error?: string}>}
 */
async function moduleGitLog(dir, opts = {}) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { present: false };

  const wanted = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : GIT_LOG_DEFAULT_LIMIT;
  const limit = Math.min(wanted, GIT_LOG_MAX_LIMIT);

  const res = await _run(_gitArgs(dir, ['log', '-n', String(limit), '--pretty=%h\x1f%aI\x1f%s']), opts);
  if (!res.ok) {
    // "does not have any commits yet" is the normal post-init state.
    if (/does not have any commits yet|bad default revision|unknown revision/i.test(res.stderr || '')) {
      return { present: true, commits: [] };
    }
    return { present: true, error: _firstLine(res) };
  }
  const commits = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [sha7, date, subject] = line.split('\x1f');
    return { sha7: sha7 || '', date: date || '', subject: subject || '' };
  });
  return { present: true, commits };
}

/**
 * `git add -A` then a commit, pinned to `dir` only. Never throws.
 * @param {string} dir absolute path to modules/<id>/
 * @param {string} message commit subject, trimmed and capped at 200 chars
 * @param {{env?: object, author?: {name: string, email: string}}} [opts]
 * @returns {Promise<{ok: true, sha7: string|null} | {ok: false, reason: string, message?: string}>}
 */
async function moduleGitCommit(dir, message, opts = {}) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { ok: false, reason: 'no-repo' };

  const author = (opts.author && opts.author.name && opts.author.email) ? opts.author : DEFAULT_AUTHOR;
  const msg = String(message || '').trim().slice(0, 200);
  if (!msg) return { ok: false, reason: 'bad-message' };

  // Pinned to dir only - a git add -A that escaped this pin would stage the
  // whole mission-deck tree (see the plan's Risks section).
  const addRes = await _run(_gitArgs(dir, ['add', '-A']), opts);
  if (!addRes.ok) return { ok: false, reason: 'add-failed', message: _firstLine(addRes) };

  return _commitStaged(dir, msg, author, opts);
}

/**
 * The commit + rev-parse tail shared by moduleGitCommit and
 * moduleGitCommitPaths: whatever is staged goes into one commit.
 * @param {string} dir
 * @param {string} msg already trimmed, non-empty
 * @param {{name: string, email: string}} author
 * @param {{env?: object}} opts
 * @returns {Promise<{ok: true, sha7: string|null} | {ok: false, reason: string, message?: string}>}
 */
async function _commitStaged(dir, msg, author, opts) {
  const commitRes = await _run(_gitArgs(dir, [
    '-c', 'user.name=' + author.name,
    '-c', 'user.email=' + author.email,
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', msg,
  ]), opts);

  if (!commitRes.ok) {
    if (/nothing (?:added )?to commit|no changes added to commit/i.test(commitRes.stdout + commitRes.stderr)) {
      return { ok: false, reason: 'nothing-to-commit' };
    }
    return { ok: false, reason: 'commit-failed', message: _firstLine(commitRes) };
  }

  const shaRes = await _run(_gitArgs(dir, ['rev-parse', '--short=7', 'HEAD']), opts);
  return { ok: true, sha7: shaRes.ok ? shaRes.stdout.trim() : null };
}

const ADD_CHUNK = 100;

/**
 * Every path `git status` still reports for the module (tracked changes and
 * untracked, non-ignored files, one entry per file - `-uall`). The install
 * guard reads it AFTER a reconcile commit: whatever is left was never
 * published and never committed, and the install swap would delete it.
 * Never throws.
 * @param {string} dir absolute path to modules/<id>/
 * @param {{env?: object}} [opts]
 * @returns {Promise<{ok: true, paths: string[]} | {ok: false, reason: string, message?: string}>}
 */
async function moduleGitUnsavedPaths(dir, opts = {}) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { ok: false, reason: 'no-repo' };
  ensureModuleGitExclude(dir);
  const res = await _run(_gitArgs(dir, ['status', '--porcelain', '-uall', '-z']), opts);
  if (!res.ok) return { ok: false, reason: 'status-failed', message: _firstLine(res) };
  const parts = res.stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i += 1) {
    const code = parts[i].slice(0, 2);
    paths.push(parts[i].slice(3));
    // A rename/copy entry carries its source path as the next NUL field.
    if (code[0] === 'R' || code[0] === 'C') i += 1;
  }
  return { ok: true, paths };
}

/**
 * Path-scoped commit: stages tracked modifications/deletions (`add -u`) and
 * exactly the named paths, never `add -A` (that would pull in dotfiles and
 * caches the publish excludes). The named paths are added with `-f`: they are
 * what the publish SENT, so a module `.gitignore` entry (the scaffold ignores
 * `downloads/`) must not make git refuse the whole add and leave the commit
 * that records the published tree undone. Never throws.
 * @param {string} dir absolute path to modules/<id>/
 * @param {string} message
 * @param {string[]} relPaths forward-slash paths relative to dir
 * @param {{env?: object, author?: {name: string, email: string}}} [opts]
 * @returns {Promise<{ok: true, sha7: string|null} | {ok: false, reason: string, message?: string}>}
 */
async function moduleGitCommitPaths(dir, message, relPaths, opts = {}) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { ok: false, reason: 'no-repo' };

  const author = (opts.author && opts.author.name && opts.author.email) ? opts.author : DEFAULT_AUTHOR;
  const msg = String(message || '').trim().slice(0, 200);
  if (!msg) return { ok: false, reason: 'bad-message' };

  const badPath = (p) => typeof p !== 'string' || !p.trim()
    || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('\\')
    || p.split(/[\\/]/).includes('..')
    || p === '.git' || p.startsWith('.git/') || p.startsWith('.git\\');
  if (!Array.isArray(relPaths) || relPaths.length === 0 || relPaths.some(badPath)) {
    return { ok: false, reason: 'bad-paths' };
  }

  const upRes = await _run(_gitArgs(dir, ['add', '-u']), opts);
  if (!upRes.ok) return { ok: false, reason: 'add-failed', message: _firstLine(upRes) };
  for (let i = 0; i < relPaths.length; i += ADD_CHUNK) {
    const chunk = relPaths.slice(i, i + ADD_CHUNK);
    const addRes = await _run(_gitArgs(dir, ['--literal-pathspecs', 'add', '-f', '--', ...chunk]), opts);
    if (!addRes.ok) return { ok: false, reason: 'add-failed', message: _firstLine(addRes) };
  }
  return _commitStaged(dir, msg, author, opts);
}

/**
 * `git init` + a module `.gitignore` (only when one is not already there) +
 * a first commit. Never throws for the two expected refusals -
 * `already-present` (a `.git` already exists - use moduleGitCommit instead)
 * and `git-missing` (no git on PATH - the module is still on disk, which is
 * what every caller of this function actually promises).
 * @param {string} dir absolute path to modules/<id>/
 * @param {string} message first commit's subject
 * @param {{env?: object, author?: {name: string, email: string}}} [opts]
 * @returns {Promise<{ok: true, sha7: string|null} | {ok: false, reason: string, message?: string}>}
 */
async function moduleGitInit(dir, message, opts = {}) {
  if (fs.existsSync(path.join(dir, '.git'))) return { ok: false, reason: 'already-present' };
  if (!(await gitAvailable(opts))) return { ok: false, reason: 'git-missing' };

  fs.mkdirSync(dir, { recursive: true });

  // `init` takes the target directory as a positional argument, so it needs
  // no --git-dir/--work-tree pin: the directory it creates .git inside IS
  // the argument, there is no ambient repo to fall back to.
  let initRes = await _run(['init', '-q', '-b', 'main', dir], opts);
  if (!initRes.ok && /unknown switch|unknown option/i.test(initRes.stderr)) {
    // Old git with no `-b`: init on whatever the default branch name is,
    // then rename it before the first commit exists.
    initRes = await _run(['init', '-q', dir], opts);
    if (initRes.ok) {
      await _run(_gitArgs(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']), opts);
    }
  }
  if (!initRes.ok) return { ok: false, reason: 'init-failed', message: _firstLine(initRes) };
  ensureModuleGitExclude(dir);

  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, MODULE_GITIGNORE_LINES.join('\n') + '\n');
  }

  return moduleGitCommit(dir, message, opts);
}

module.exports = {
  gitAvailable,
  moduleGitInit,
  moduleGitStatus,
  moduleGitLog,
  moduleGitCommit,
  moduleGitCommitPaths,
  moduleGitUnsavedPaths,
  MODULE_GITIGNORE_LINES,
  MODULE_DROP_SAFE_EXCLUDES,
  isDropSafeModulePath,
  ensureModuleGitExclude,
  DEFAULT_AUTHOR,
  // exported for tests/test_module_git.mjs only - never required by server.js
  _gitArgs,
  _branchFromStatusHeader,
};
