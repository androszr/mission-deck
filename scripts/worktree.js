#!/usr/bin/env node
'use strict';
// scripts/worktree.js
// Linked git worktrees for parallel work on the core, deterministically.
// The /new-idea branch gate (Phase 6) offers a worktree when another session
// already works in the main tree; this script creates it, equips it with the
// gitignored state it needs (and never with team data or the key), runs its
// verification server on its own port and removes it only when that is safe.
//
//   node scripts/worktree.js recommend --plan <md> [--json]
//   node scripts/worktree.js create <slug> [--from <ref>] [--branch <name>] [--link-modules]
//   node scripts/worktree.js prepare <path> [--link-modules]
//   node scripts/worktree.js serve <slug> | stop <slug>
//   node scripts/worktree.js list [--json] | status <slug> [--json]
//   node scripts/worktree.js remove <slug> [--keep-branch] [--discard-local-data] | prune
//
// The main tree is found from the current directory (git's common dir), so a
// call from inside a worktree still manages the main tree's worktrees;
// --repo <dir> names it explicitly.
// Never: `git worktree remove --force`, `git branch -D`, a kill by port, a
// symlink or copy of data-sub-repositories/ or .encryption-key.
// Exit: 0 done, 1 refused (the reason and the remedy are printed), 2 usage or internal error.
// Docs: docs/architecture/worktrees.md

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const R = require('./_report');
const W = require('./_worktree');

const HELP = `
worktree.js - separate working copies (git worktree) for parallel work on the core

Usage:
  node scripts/worktree.js recommend --plan <plan.md> [--forced] [--json]
  node scripts/worktree.js create <slug> [--from <ref>] [--branch <name>] [--link-modules] [--json]
  node scripts/worktree.js prepare <path> [--link-modules] [--json]
  node scripts/worktree.js serve <slug> [--json]
  node scripts/worktree.js stop <slug> [--json]
  node scripts/worktree.js list [--json]
  node scripts/worktree.js status <slug> [--json]
  node scripts/worktree.js remove <slug> [--keep-branch] [--discard-local-data] [--json]
  node scripts/worktree.js prune [--json]

Commands:
  recommend  recommendation for a plan: module-only | branch | worktree, with reasons
  create     git worktree add .claude/worktrees/<slug> on a new branch wt/<slug>
             (or --branch <existing branch>), then prepare
  prepare    equips the worktree: node_modules symlink, a copy of .env with its own PORT=
             (3101-3199), a copy of .core-dev only when the main tree has one,
             its own empty data/, user-data/, data-sub-repositories/;
             never .encryption-key, .gitnexus, plans/; idempotent
  serve      the worktree's verification server on its own port, always in test mode
  stop       stops ONLY the process from the worktree's PID file (never by port)
  list       every worktree under .claude/worktrees/
  status     one worktree, with its server address
  remove     removes a clean, merged worktree (git worktree remove without --force,
             git branch -d, never -D); --keep-branch keeps the branch (only when
             there is one - a detached HEAD with unmerged commits always refuses);
             files in its own data/, user-data/, data-sub-repositories/ block
             removal unless --discard-local-data
  prune      git worktree prune plus a report of orphaned directories (deletes nothing)

Common: --repo <dir> points at the repository (default: the current directory).
Exit codes: 0 done, 1 refusal (with a reason and a hint), 2 usage or internal error.
Details: docs/architecture/worktrees.md
`;

const SERVER_PID_NAME = 'worktree-server.pid';
const SERVER_LOG_NAME = 'worktree-server.log';
const EXCLUDE_LINES = ['/.claude/worktrees/', '/node_modules', '/modules'];
const EXCLUDE_HEADER = '# scripts/worktree.js: prepare symlinks (a pattern with a trailing slash does not match a symlink) and the worktree directory';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function gitRun(cwd, args) {
  const r = spawnSync('git', ['-C', cwd].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: (r.stderr || '').trim() };
}

function realOr(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readPid(file) {
  try {
    const n = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

class Refusal extends Error {
  constructor(code, message, fix) { super(message); this.code = code; this.fix = fix || null; }
}

function out(flags, obj, text) {
  if (flags.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  else process.stdout.write(text.replace(/\n*$/, '\n'));
}

// ---------------------------------------------------------------------------
// repository facts
// ---------------------------------------------------------------------------

/** Main tree root + common git dir, from --repo, the cwd, or this script. */
function resolveMain(flags) {
  const candidates = flags.repo ? [path.resolve(String(flags.repo))] : [process.cwd(), R.ROOT];
  for (const base of candidates) {
    const r = gitRun(base, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!r.ok) continue;
    const common = realOr(r.stdout.trim());
    return { root: realOr(path.dirname(common)), commonDir: common };
  }
  throw new Refusal('no-repo', 'No git repository found (neither the current directory nor --repo).', null);
}

/** `git worktree list --porcelain` -> entries with realpath'd paths. */
function listWorktrees(main) {
  const r = gitRun(main.root, ['worktree', 'list', '--porcelain']);
  if (!r.ok) throw new Error('git worktree list: ' + r.stderr);
  const entries = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: realOr(line.slice(9)), head: null, branch: null, detached: false, prunable: false };
      entries.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5);
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      cur.detached = true;
    } else if (line.startsWith('prunable')) {
      cur.prunable = true;
    }
  }
  return entries;
}

function worktreesDir(main) { return path.join(main.root, W.WORKTREES_DIR); }

function slugPath(main, slug) { return path.join(worktreesDir(main), slug); }

function managedWorktrees(main) {
  const dir = realOr(worktreesDir(main)) + path.sep;
  return listWorktrees(main).filter((e) => (e.path + path.sep).startsWith(dir) && e.path + path.sep !== dir);
}

function findWorktree(main, slug) {
  const want = realOr(slugPath(main, slug));
  return listWorktrees(main).find((e) => e.path === want) || null;
}

function mainBranch(main) {
  const r = gitRun(main.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.stdout.trim() : 'HEAD';
}

function envPortOf(dir) {
  return W.readEnvPort(readText(path.join(dir, '.env')));
}

function requireSlug(slug) {
  if (!slug) R.usageError('brak <slug>');
  if (!W.SLUG_RE.test(slug)) {
    throw new Refusal('bad-slug', 'Invalid slug "' + slug + '": lowercase letters, digits and hyphens, 2-40 characters, starting with a letter or digit.', null);
  }
}

// ---------------------------------------------------------------------------
// ports and server liveness
// ---------------------------------------------------------------------------

function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function chooseFreePort(main, selfPath) {
  const taken = new Set([envPortOf(main.root) || 3001]);
  for (const e of listWorktrees(main)) {
    if (e.path === main.root || e.path === selfPath) continue;
    const p = envPortOf(e.path);
    if (p) taken.add(p);
  }
  for (;;) {
    const p = W.pickPort({ taken });
    if (p === null) return null;
    if (await portIsFree(p)) return p;
    taken.add(p);
  }
}

/**
 * Live server of a worktree: our own PID file first, then server.js's. A PID
 * that is alive but whose command line is not `<wt>/server.js` (a reboot or
 * PID reuse left the file behind) is NOT this server: it is reported in
 * `stale` and never blocks serve/remove, and nothing ever signals it.
 */
function serverState(wtPath) {
  const port = envPortOf(wtPath);
  const own = path.join(wtPath, 'data', SERVER_PID_NAME);
  const srv = port ? path.join(wtPath, 'data', 'server-' + port + '.pid') : null;
  const stale = [];
  for (const file of [own, srv]) {
    if (!file) continue;
    const pid = readPid(file);
    if (!pid) continue;
    if (!isAlive(pid) || W.pidOwnership(processCommandLine(pid), wtPath) === 'foreign') {
      stale.push({ pid, pidFile: file });
      continue;
    }
    return { alive: true, pid, pidFile: file, port, stale };
  }
  return { alive: false, pid: null, pidFile: own, port, stale };
}

function processCommandLine(pid) {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      '(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '").CommandLine'], { encoding: 'utf8', windowsHide: true });
    return (r.stdout || '').trim();
  }
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

function ensureExclude(main) {
  const file = path.join(main.commonDir, 'info', 'exclude');
  const text = readText(file) || '';
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = EXCLUDE_LINES.filter((l) => !have.has(l));
  if (missing.length === 0) return [];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prefix = text === '' || text.endsWith('\n') ? '' : '\n';
  const header = have.has(EXCLUDE_HEADER) ? '' : EXCLUDE_HEADER + '\n';
  fs.appendFileSync(file, prefix + header + missing.join('\n') + '\n');
  return missing;
}

function makeLink(src, dst) {
  if (process.platform === 'win32') {
    // A junction needs no elevation; it is absolute by construction.
    fs.symlinkSync(src, dst, 'junction');
  } else {
    fs.symlinkSync(path.relative(path.dirname(dst), src), dst, 'dir');
  }
}

/**
 * Walk PREPARE_TABLE for one worktree. Idempotent: an entry that exists is
 * never touched again, so a second run keeps the port.
 */
async function prepareWorktree(main, wtPath, opts) {
  const wt = realOr(wtPath);
  if (wt === main.root) throw new Refusal('main-tree', 'This is the main tree, not a worktree - prepare works only on a working copy.', null);
  const top = gitRun(wt, ['rev-parse', '--show-toplevel']);
  const common = gitRun(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!top.ok || !common.ok || realOr(top.stdout.trim()) !== wt || realOr(common.stdout.trim()) !== main.commonDir) {
    throw new Refusal('not-a-worktree', 'Path ' + wt + ' is not a worktree of this repository.', 'Create it: node scripts/worktree.js create <slug>');
  }

  const excluded = ensureExclude(main);
  const results = [];
  let failed = false;
  for (const row of W.PREPARE_TABLE) {
    const src = path.join(main.root, row.name);
    const dst = path.join(wt, row.name);
    const dstStat = lstatOrNull(dst);
    const rec = { name: row.name, action: row.action, result: null, detail: null };
    try {
      if (row.action === 'link' || row.action === 'link-opt-in') {
        if (row.action === 'link-opt-in' && !(opts && opts.linkModules)) rec.result = 'skipped';
        else if (dstStat) rec.result = 'exists';
        else if (!fs.existsSync(src)) rec.result = 'missing-source';
        else { makeLink(src, dst); rec.result = 'linked'; }
      } else if (row.action === 'copy-rewrite-port') {
        if (dstStat) {
          rec.result = 'exists';
          rec.detail = 'PORT=' + (W.readEnvPort(readText(dst)) || 'none');
        } else {
          const port = await chooseFreePort(main, wt);
          if (port === null) throw new Refusal('no-port', 'No free port in the range ' + W.PORT_MIN + '-' + W.PORT_MAX + '.', 'Remove unused worktrees: node scripts/worktree.js list');
          const text = readText(src);
          fs.writeFileSync(dst, W.rewriteEnvPort(text || '', port), { mode: 0o600 });
          rec.result = text === null ? 'created' : 'copied';
          rec.detail = 'PORT=' + port;
        }
      } else if (row.action === 'copy-if-present') {
        if (dstStat) rec.result = 'exists';
        else if (!fs.existsSync(src)) rec.result = 'missing-source';
        else { fs.copyFileSync(src, dst); rec.result = 'copied'; }
      } else if (row.action === 'own-empty') {
        if (dstStat && dstStat.isSymbolicLink()) {
          rec.result = 'error';
          rec.detail = row.name + ' in the worktree is a symlink - data is never shared. Remove the symlink (not its target) and run prepare again.';
          failed = true;
        } else if (dstStat) rec.result = 'exists';
        else { fs.mkdirSync(dst, { recursive: true }); rec.result = 'created'; }
      } else if (row.action === 'never') {
        const leaked = row.name === 'plans'
          ? (dstStat ? fs.readdirSync(dst).filter((n) => n !== 'README.md') : []).length > 0
          : Boolean(dstStat);
        rec.result = leaked ? 'error' : 'never';
        if (leaked) {
          rec.detail = row.name + ' exists in the worktree and must not (the "never" list). Remove it from the worktree - not from the main tree.';
          failed = true;
        }
      }
    } catch (e) {
      if (e instanceof Refusal) throw e;
      rec.result = 'error';
      failed = true;
      rec.detail = (e.code === 'EPERM' || e.code === 'EACCES')
        ? 'No permission to create ' + row.name + ' (' + e.code + '). On Windows turn on Developer Mode or run the terminal as administrator and repeat prepare.'
        : 'Could not prepare ' + row.name + ': ' + (e.code || e.message);
    }
    results.push(rec);
  }
  return { path: wt, port: envPortOf(wt), prepared: results, excludeAdded: excluded, failed };
}

const RESULT_LABEL = {
  linked: 'symlink created',
  exists: 'already there',
  'missing-source': 'not in the main tree - skipped',
  skipped: 'skipped (no --link-modules)',
  copied: 'copied',
  created: 'created',
  never: 'never (by rule)',
  error: 'ERROR',
};

function renderPrepared(prep) {
  const lines = [];
  for (const r of prep.prepared) {
    lines.push('  ' + r.name.padEnd(22) + (RESULT_LABEL[r.result] || r.result) + (r.detail ? ' - ' + r.detail : ''));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// worktree facts (list / status / remove)
// ---------------------------------------------------------------------------

function worktreeDirt(wtPath) {
  const r = gitRun(wtPath, ['status', '--porcelain']);
  const entries = W.parsePorcelain(r.ok ? r.stdout : '');
  return entries.filter((e) => !W.isPrepareArtefact(e, (name) => {
    const st = lstatOrNull(path.join(wtPath, name));
    return Boolean(st && st.isSymbolicLink());
  }));
}

/** Every file under the worktree's own data dirs, relative and `/` separated. Links are not followed. */
function listLocalData(wtPath) {
  const files = [];
  const walk = (rel) => {
    let names;
    try { names = fs.readdirSync(path.join(wtPath, rel)); } catch { return; }
    for (const n of names) {
      const r = rel + '/' + n;
      const st = lstatOrNull(path.join(wtPath, r));
      if (!st) continue;
      if (st.isDirectory()) walk(r);
      else files.push(r);
    }
  };
  for (const d of W.LOCAL_DATA_DIRS) {
    const st = lstatOrNull(path.join(wtPath, d));
    if (st && st.isDirectory()) walk(d);
  }
  return files;
}

function isMerged(main, entry) {
  const ref = entry.branch ? 'refs/heads/' + entry.branch : entry.head;
  if (!ref) return false;
  return gitRun(main.root, ['merge-base', '--is-ancestor', ref, 'HEAD']).ok;
}

function describe(main, entry) {
  const wt = entry.path;
  const base = mainBranch(main);
  let ahead = null;
  let behind = null;
  if (entry.branch) {
    const r = gitRun(main.root, ['rev-list', '--left-right', '--count', 'HEAD...refs/heads/' + entry.branch]);
    if (r.ok) {
      const [b, a] = r.stdout.trim().split(/\s+/).map(Number);
      ahead = a; behind = b;
    }
  }
  const dirt = worktreeDirt(wt);
  const port = envPortOf(wt);
  const srv = serverState(wt);
  const nm = lstatOrNull(path.join(wt, 'node_modules'));
  let nodeModulesOk = false;
  if (nm && nm.isSymbolicLink()) {
    try { nodeModulesOk = fs.statSync(path.join(wt, 'node_modules')).isDirectory(); } catch { nodeModulesOk = false; }
  }
  const lockMain = readText(path.join(main.root, 'package-lock.json'));
  const lockWt = readText(path.join(wt, 'package-lock.json'));
  return {
    slug: path.basename(wt),
    path: wt,
    branch: entry.branch,
    detached: entry.detached,
    base,
    ahead,
    behind,
    changes: dirt.length,
    port,
    serverAlive: srv.alive,
    serverPid: srv.pid,
    merged: isMerged(main, entry),
    coreDev: fs.existsSync(path.join(wt, '.core-dev')),
    nodeModulesOk,
    packageLockDiffers: lockMain !== null && lockWt !== null && lockMain !== lockWt,
    prunable: entry.prunable,
  };
}

function renderInfo(i, withUrl) {
  const yes = (b) => (b ? 'yes' : 'no');
  const lines = [
    i.slug + '  ' + i.path,
    '  branch: ' + (i.branch || '(detached HEAD)') + (i.ahead === null ? '' : '  (+' + i.ahead + ' / -' + i.behind + ' against ' + i.base + ')'),
    '  uncommitted changes: ' + i.changes + '   merged into ' + i.base + ': ' + yes(i.merged),
    '  port: ' + (i.port || 'no .env - run prepare') + '   server: ' + (i.serverAlive ? 'running (PID ' + i.serverPid + ')' : 'not running'),
    '  .core-dev: ' + yes(i.coreDev) + '   node_modules: ' + (i.nodeModulesOk ? 'ok' : 'missing or broken symlink - run prepare'),
  ];
  if (withUrl && i.serverUrl) lines.push('  address: ' + i.serverUrl);
  if (i.packageLockDiffers) lines.push('  WARNING: package-lock.json differs from the main tree - node_modules is shared through a symlink; do not run npm install here.');
  if (i.prunable) lines.push('  WARNING: git marks this worktree as prunable - node scripts/worktree.js prune');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

async function cmdRecommend(flags) {
  if (!flags.plan || flags.plan === true) R.usageError('recommend wymaga --plan <plan.md>');
  const main = resolveMain(flags);
  const planFile = path.resolve(String(flags.plan));
  const md = readText(planFile);
  if (md === null) R.usageError('cannot read the plan ' + planFile);
  const planPaths = W.parsePlanPaths(md);
  const layers = W.classifyPlanLayers(planPaths);
  const status = gitRun(main.root, ['status', '--porcelain']);
  const result = W.recommendWorktree({
    planPaths,
    porcelain: status.ok ? status.stdout : '',
    splitLayers: layers.split ? [layers.backend, layers.frontend] : [],
    forced: Boolean(flags.forced),
  });
  const existing = managedWorktrees(main).map((e) => ({ slug: path.basename(e.path), path: e.path, branch: e.branch }));
  const payload = {
    script: 'worktree',
    command: 'recommend',
    plan: planFile,
    recommendation: result.recommendation,
    reasons: result.reasons,
    path: layers.split ? 'split' : 'fast',
    planPaths: planPaths.length,
    layers: { backend: layers.backend.length, frontend: layers.frontend.length, other: layers.other.length },
    foreignChanges: result.foreignChanges,
    overlapping: result.overlapping,
    existingWorktrees: existing,
  };
  const label = { 'module-only': 'module (its own repository)', branch: 'current branch', worktree: 'separate worktree' }[result.recommendation];
  const text = [
    'Recommendation: ' + label + ' (' + result.recommendation + ')',
    ...result.reasons.map((r) => '- ' + r),
    'Implementation path: ' + payload.path + ' (' + planPaths.length + ' files)',
    existing.length ? 'Existing worktrees: ' + existing.map((e) => e.slug).join(', ') : 'Existing worktrees: none',
  ].join('\n');
  out(flags, payload, text);
  return 0;
}

async function cmdCreate(flags, slug) {
  requireSlug(slug);
  const main = resolveMain(flags);
  const wt = slugPath(main, slug);
  if (lstatOrNull(wt)) {
    throw new Refusal('exists', 'Directory ' + wt + ' already exists.', 'Check it: node scripts/worktree.js status ' + slug + ' (or pick another slug)');
  }
  let branch;
  let args;
  if (flags.branch && flags.branch !== true) {
    branch = String(flags.branch);
    if (!gitRun(main.root, ['show-ref', '--verify', '--quiet', 'refs/heads/' + branch]).ok) {
      throw new Refusal('no-branch', 'Branch ' + branch + ' does not exist.', 'Without --branch the script creates a new branch ' + W.BRANCH_PREFIX + slug);
    }
    const holder = listWorktrees(main).find((e) => e.branch === branch);
    if (holder) {
      throw new Refusal('branch-checked-out', 'Branch ' + branch + ' is already checked out in ' + holder.path + '.', 'A branch can be active in only one tree - pick another or work there.');
    }
    args = ['worktree', 'add', wt, branch];
  } else {
    branch = W.BRANCH_PREFIX + slug;
    if (gitRun(main.root, ['show-ref', '--verify', '--quiet', 'refs/heads/' + branch]).ok) {
      throw new Refusal('branch-exists', 'Branch ' + branch + ' already exists.', 'Use it explicitly: --branch ' + branch + ', or pick another slug.');
    }
    if (flags.from === true) R.usageError('--from needs a value (branch, tag or commit)');
    const from = flags.from ? String(flags.from) : 'HEAD';
    if (from.startsWith('-')) R.usageError('--from must not start with "-" (that would be a git option, not a revision): ' + from);
    args = ['worktree', 'add', '-b', branch, wt, from];
  }
  ensureExclude(main);
  fs.mkdirSync(worktreesDir(main), { recursive: true });
  const add = gitRun(main.root, args);
  if (!add.ok) throw new Refusal('git-failed', 'git worktree add failed: ' + add.stderr, null);
  const prep = await prepareWorktree(main, wt, { linkModules: Boolean(flags['link-modules']) });
  const payload = { script: 'worktree', command: 'create', path: prep.path, branch, port: prep.port, prepared: prep.prepared, ok: !prep.failed };
  const text = [
    'Worktree ready: ' + prep.path,
    'Branch: ' + branch,
    'Verification server port: ' + prep.port + ' (node scripts/worktree.js serve ' + slug + ')',
    'Preparation:',
    renderPrepared(prep),
    'Note: uncommitted changes in the main tree do NOT carry over to the worktree - it starts from ' + (args[args.length - 1] === branch ? branch : args[args.length - 1]) + '.',
  ].join('\n');
  out(flags, payload, text);
  return prep.failed ? 1 : 0;
}

async function cmdPrepare(flags, target) {
  if (!target) R.usageError('prepare needs <path>');
  const main = resolveMain(flags);
  const prep = await prepareWorktree(main, path.resolve(target), { linkModules: Boolean(flags['link-modules']) });
  const payload = { script: 'worktree', command: 'prepare', path: prep.path, port: prep.port, prepared: prep.prepared, ok: !prep.failed };
  out(flags, payload, ['Preparing ' + prep.path + ' (port ' + prep.port + '):', renderPrepared(prep)].join('\n'));
  return prep.failed ? 1 : 0;
}

async function waitForVersion(port, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/api/app/version', { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* not listening yet */ }
    if (!isAlive(pid) || Date.now() > deadline) return false;
    await new Promise((res) => setTimeout(res, 200));
  }
}

async function cmdServe(flags, slug) {
  requireSlug(slug);
  const main = resolveMain(flags);
  const entry = findWorktree(main, slug);
  if (!entry) throw new Refusal('no-worktree', 'There is no worktree ' + slug + '.', 'Create it: node scripts/worktree.js create ' + slug);
  const wt = entry.path;
  const port = envPortOf(wt);
  const mainPort = envPortOf(main.root) || 3001;
  if (!port) throw new Refusal('no-env', 'The worktree has no .env with its own PORT= - the server would start on the main tree\'s port.', 'Run: node scripts/worktree.js prepare ' + wt);
  if (port === mainPort) throw new Refusal('main-port', 'PORT=' + port + ' in the worktree is the main tree\'s port.', 'Remove .env from the worktree and run prepare again - it will get a port from the range ' + W.PORT_MIN + '-' + W.PORT_MAX + '.');
  // server.js resolves unmerged index entries with `checkout --theirs` at
  // startup, test mode included - never let that run over a merge in progress.
  const unmerged = gitRun(wt, ['diff', '--name-only', '--diff-filter=U']);
  if (unmerged.ok && unmerged.stdout.trim()) {
    throw new Refusal('unmerged-entries', 'The worktree has unresolved conflicts (' + unmerged.stdout.trim().split('\n').join(', ') + ') - the server would resolve them as "theirs" at startup.', 'Finish the merge in the worktree first, then serve.');
  }
  const srv = serverState(wt);
  const url = 'http://localhost:' + port;
  if (srv.alive) throw new Refusal('already-running', 'This worktree\'s server is already running (PID ' + srv.pid + '): ' + url, 'Stop it: node scripts/worktree.js stop ' + slug);
  if (!(await portIsFree(port))) throw new Refusal('port-busy', 'Port ' + port + ' is taken by another process.', 'Check who holds it; the script never kills processes by port.');

  fs.mkdirSync(path.join(wt, 'data'), { recursive: true });
  const logFile = path.join(wt, 'data', SERVER_LOG_NAME);
  // No secret reaches the test-mode child: every ENV_SCHEMA key of kind
  // `secret` (read from the server.js about to run) plus anything that looks
  // like a credential. Then the worktree's own port and data dirs, explicitly:
  // a .env never overrides the process env, so an inherited value would win.
  const schemaSource = readText(path.join(wt, 'server.js')) || readText(path.join(main.root, 'server.js')) || '';
  const env = W.stripChildEnv(process.env, W.secretEnvKeys(schemaSource));
  Object.assign(env, {
    PORT: String(port),
    NODE_ENV: 'test',
    TEST_DISABLE_RESTART: '1',
    USER_DATA_DIR: path.join(wt, 'user-data'),
    DATA_SUB_REPOS_DIR: path.join(wt, 'data-sub-repositories'),
    DATA_TIER_0_DIR: path.join(wt, 'data-sub-repositories', 'ds-data'),
  });
  const fd = fs.openSync(logFile, 'a');
  let child;
  try {
    child = spawn(process.execPath, [path.join(wt, 'server.js'), String(port)], {
      cwd: wt,
      env,
      stdio: ['ignore', fd, fd],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
  } finally {
    fs.closeSync(fd);
  }
  child.unref();
  fs.writeFileSync(path.join(wt, 'data', SERVER_PID_NAME), String(child.pid));
  const up = await waitForVersion(port, child.pid, 30000);
  if (!up) {
    const tail = (readText(logFile) || '').split('\n').slice(-15).join('\n');
    throw new Refusal('not-started', 'The worktree server did not answer /api/app/version within 30 s. Last lines of ' + logFile + ':\n' + tail, 'Stop the leftovers: node scripts/worktree.js stop ' + slug);
  }
  out(flags, { script: 'worktree', command: 'serve', slug, pid: child.pid, port, serverUrl: url, log: logFile },
    'Verification server of worktree ' + slug + ' is running (test mode, PID ' + child.pid + '): ' + url + '\nLog: ' + logFile + '\nStop: node scripts/worktree.js stop ' + slug);
  return 0;
}

async function cmdStop(flags, slug) {
  requireSlug(slug);
  const main = resolveMain(flags);
  const entry = findWorktree(main, slug);
  if (!entry) throw new Refusal('no-worktree', 'There is no worktree ' + slug + '.', null);
  const wt = entry.path;
  const ownPidFile = path.join(wt, 'data', SERVER_PID_NAME);
  const srv = serverState(wt);
  if (!srv.alive) {
    // Only the worktree's OWN PID file is removed; server-<port>.pid belongs to server.js.
    const ownStale = srv.stale.find((x) => x.pidFile === ownPidFile);
    try { fs.unlinkSync(ownPidFile); } catch { /* none */ }
    out(flags, { script: 'worktree', command: 'stop', slug, stopped: false, wasRunning: false, stalePid: ownStale ? ownStale.pid : null },
      'Worktree server ' + slug + ' is not running.' + (ownStale ? ' Removed a stale PID file (PID ' + ownStale.pid + ' is no longer that server) - no process was signalled.' : ''));
    return 0;
  }
  try { process.kill(srv.pid, 'SIGTERM'); } catch { /* already gone */ }
  const deadline = Date.now() + 3000;
  while (isAlive(srv.pid) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 100));
  let forced = false;
  if (isAlive(srv.pid)) {
    // Last resort, and only for the PID read from this worktree's file.
    forced = true;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(srv.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(srv.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  try { fs.unlinkSync(ownPidFile); } catch { /* none */ }
  out(flags, { script: 'worktree', command: 'stop', slug, stopped: true, pid: srv.pid, forced },
    'Stopped the worktree server ' + slug + ' (PID ' + srv.pid + (forced ? ', forced after 3 s' : '') + ').');
  return 0;
}

async function cmdList(flags) {
  const main = resolveMain(flags);
  const infos = managedWorktrees(main).map((e) => describe(main, e));
  if (flags.json) { process.stdout.write(JSON.stringify(infos, null, 2) + '\n'); return 0; }
  if (infos.length === 0) { process.stdout.write('No worktrees under ' + W.WORKTREES_DIR + '/.\n'); return 0; }
  process.stdout.write(infos.map((i) => renderInfo(i, false)).join('\n\n') + '\n');
  return 0;
}

async function cmdStatus(flags, slug) {
  requireSlug(slug);
  const main = resolveMain(flags);
  const entry = findWorktree(main, slug);
  if (!entry) throw new Refusal('no-worktree', 'There is no worktree ' + slug + '.', 'List: node scripts/worktree.js list');
  const info = describe(main, entry);
  info.serverUrl = info.port ? 'http://localhost:' + info.port : null;
  out(flags, info, renderInfo(info, true));
  return 0;
}

async function cmdRemove(flags, slug) {
  requireSlug(slug);
  const main = resolveMain(flags);
  const entry = findWorktree(main, slug);
  if (!entry) {
    const dir = slugPath(main, slug);
    if (lstatOrNull(dir)) throw new Refusal('not-registered', 'Directory ' + dir + ' is not a registered worktree.', 'See: node scripts/worktree.js prune (reports, deletes nothing)');
    throw new Refusal('no-worktree', 'There is no worktree ' + slug + '.', null);
  }
  const wt = entry.path;
  const dirt = worktreeDirt(wt);
  const verdict = W.removeVerdict({
    porcelain: dirt.map((e) => e.code + ' ' + e.path).join('\n'),
    merged: isMerged(main, entry),
    serverAlive: serverState(wt).alive,
    keepBranch: Boolean(flags['keep-branch']),
    hasBranch: Boolean(entry.branch),
    localData: W.localDataLeftovers(listLocalData(wt)),
    discardLocalData: Boolean(flags['discard-local-data']),
    slug,
  });
  if (!verdict.ok) {
    out(flags, { script: 'worktree', command: 'remove', slug, ok: false, reasons: verdict.reasons },
      ['Refusing to remove worktree ' + slug + ':', ...verdict.reasons.map((r) => '- ' + r.message + '\n  ' + r.fix)].join('\n'));
    return 1;
  }
  // Drop the prepare symlinks first, so nothing ever walks into a target.
  for (const row of W.PREPARE_TABLE) {
    if (row.action !== 'link' && row.action !== 'link-opt-in') continue;
    const p = path.join(wt, row.name);
    const st = lstatOrNull(p);
    if (st && st.isSymbolicLink()) fs.unlinkSync(p);
  }
  const rm = gitRun(main.root, ['worktree', 'remove', wt]);
  if (!rm.ok) {
    throw new Refusal('git-failed', 'git worktree remove refused: ' + rm.stderr, 'The prepare symlinks were removed - restore them: node scripts/worktree.js prepare ' + wt);
  }
  let branchResult = 'kept';
  if (entry.branch && entry.branch.startsWith(W.BRANCH_PREFIX) && !flags['keep-branch']) {
    const del = gitRun(main.root, ['branch', '-d', entry.branch]);
    branchResult = del.ok ? 'deleted' : 'kept (' + del.stderr + ')';
  }
  out(flags, { script: 'worktree', command: 'remove', slug, ok: true, path: wt, branch: entry.branch, branchResult },
    'Removed worktree ' + slug + ' (' + wt + '). Branch ' + (entry.branch || '-') + ': ' + (branchResult === 'deleted' ? 'deleted' : 'kept' + (branchResult === 'kept' ? '' : ' - ' + branchResult)) + '.');
  return 0;
}

async function cmdPrune(flags) {
  const main = resolveMain(flags);
  const pr = gitRun(main.root, ['worktree', 'prune', '-v']);
  const dir = worktreesDir(main);
  const known = new Set(listWorktrees(main).map((e) => e.path));
  let orphans = [];
  try {
    orphans = fs.readdirSync(dir)
      .map((n) => realOr(path.join(dir, n)))
      .filter((p) => !known.has(p));
  } catch { /* no dir */ }
  const text = [
    'git worktree prune: ' + (pr.ok ? (pr.stdout.trim() || pr.stderr || 'nothing to prune') : 'error - ' + pr.stderr),
    orphans.length
      ? 'Orphaned directories (NOT removed - check that they hold no work):\n' + orphans.map((p) => '  ' + p).join('\n')
      : 'Orphaned directories: none',
  ].join('\n');
  out(flags, { script: 'worktree', command: 'prune', ok: pr.ok, orphans }, text);
  return pr.ok ? 0 : 2;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2), { booleans: ['link-modules', 'keep-branch', 'forced', 'discard-local-data'] });
  const [cmd, arg] = positionals;
  if (flags.help || !cmd) {
    process.stdout.write(HELP);
    return flags.help ? 0 : 2;
  }
  const table = {
    recommend: () => cmdRecommend(flags),
    create: () => cmdCreate(flags, arg),
    prepare: () => cmdPrepare(flags, arg),
    serve: () => cmdServe(flags, arg),
    stop: () => cmdStop(flags, arg),
    list: () => cmdList(flags),
    status: () => cmdStatus(flags, arg),
    remove: () => cmdRemove(flags, arg),
    prune: () => cmdPrune(flags),
  };
  if (!table[cmd]) R.usageError('unknown command "' + cmd + '" (see --help)');
  try {
    return await table[cmd]();
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    if (flags.json) process.stdout.write(JSON.stringify({ script: 'worktree', command: cmd, ok: false, error: e.code, message: e.message, fix: e.fix }, null, 2) + '\n');
    else process.stderr.write('Odmowa: ' + e.message + (e.fix ? '\n' + e.fix : '') + '\n');
    return e.code === 'no-repo' ? 2 : 1;
  }
}

if (require.main === module) {
  // exitCode, not exit(): a large --json answer on a pipe is written
  // asynchronously on macOS and exit() could cut it off.
  main().then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write('error: ' + (e && e.stack ? e.stack : e) + '\n');
    process.exitCode = 2;
  });
}

module.exports = { main };
