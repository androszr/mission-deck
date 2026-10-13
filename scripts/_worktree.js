'use strict';
// scripts/_worktree.js
// Pure decisions behind scripts/worktree.js - no disk, no git, no processes.
// Same shape as scripts/_core-scope.js: the CLI gathers facts and injects
// them, so every rule here is unit-testable without a repository.
//
// Exports:
//   SLUG_RE / PORT_MIN / PORT_MAX / WORKTREES_DIR / BRANCH_PREFIX
//   PREPARE_TABLE          - what a linked worktree gets from the main tree
//   parsePlanPaths         - paths listed under ## Files to change / ## New files
//   classifyPlanLayers     - the /new-idea Phase 6 path decision, per file
//   parsePorcelain         - `git status --porcelain` -> [{ code, path }]
//   recommendWorktree      - module-only | branch | worktree, with reasons
//   pickPort               - lowest free port of the worktree range
//   readEnvPort            - PORT= value of a .env text, or null
//   rewriteEnvPort         - set PORT= in a .env text, rest byte for byte
//   removeVerdict          - may this worktree be removed now?
//   isPrepareArtefact      - porcelain entry that is a symlink prepare made
//   localDataLeftovers     - files remove would destroy in data/, user-data/, ...
//   pidOwnership           - is a PID from the PID file really this worktree's server?
//   secretEnvKeys / stripChildEnv - the env of the test-mode child, without secrets
//
// Docs: docs/architecture/worktrees.md. User-visible strings are English.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PORT_MIN = 3101;
const PORT_MAX = 3199;
const WORKTREES_DIR = '.claude/worktrees';
const BRANCH_PREFIX = 'wt/';

// What `prepare` does with each piece of gitignored state, and why. The
// order is the order prepare walks it. The `never` rows are absolute: there is
// no flag that turns them into anything else.
//   link              - relative symlink to the main tree's entry (junction on Windows)
//   link-opt-in       - the same, only with --link-modules; otherwise skipped
//   copy-rewrite-port - copied once, PORT= rewritten to a free worktree port
//   copy-if-present   - copied once, only when the main tree has it
//   own-empty         - an empty directory of the worktree's own
//   never             - never created, linked or copied
const PREPARE_TABLE = Object.freeze([
  {
    name: 'node_modules',
    action: 'link',
    why: 'Dependencies are the same as in the main tree; a symlink instead of a second install. Do not run `npm install` in the worktree - it would write through the symlink into the main tree.',
  },
  {
    name: '.env',
    action: 'copy-rewrite-port',
    why: 'A copy, never a symlink: the worktree needs its own PORT=, otherwise `npm stop` / `npm run restart` in it would kill the main server on 3001.',
  },
  {
    name: '.core-dev',
    action: 'copy-if-present',
    why: 'Permission to change the core is a per-machine decision; copied only when the main tree has it - the script never creates the marker from scratch.',
  },
  {
    name: 'modules',
    action: 'link-opt-in',
    why: 'Installed modules are local repositories; linked only on request (--link-modules), because the worktree server could write into them.',
  },
  {
    name: 'data',
    action: 'own-empty',
    why: 'Its own app cache: PID file, worktree server log, preferences - nothing from the main tree.',
  },
  {
    name: 'user-data',
    action: 'own-empty',
    why: 'User documents stay in the main tree; the worktree gets an empty directory.',
  },
  {
    name: 'data-sub-repositories',
    action: 'own-empty',
    why: 'Team data is never shared: two processes on one plaintext directory and one mirror is a known class of data-loss incident.',
  },
  {
    name: '.encryption-key',
    action: 'never',
    why: 'The encryption key stays in the main tree only; without it the worktree server can neither decrypt nor send anything.',
  },
  {
    name: '.gitnexus',
    action: 'never',
    why: 'There is one GitNexus index per machine (the main tree); a worktree is not indexed.',
  },
  {
    name: 'plans',
    action: 'never',
    why: 'Plans are local and live in the main tree (apart from the tracked README); agents get an absolute path.',
  },
]);

// Layer table of /new-idea PHASES.md "Path decision". A path may match both
// (tests/test_api_x.mjs) - that is exactly an overlapping file.
const BACKEND_RE = /^(?:server\.js$|scripts\/|tests\/test_api_)/;
const FRONTEND_RE = /^(?:index\.html$|js\/|styles\.css$|css\/|tests\/test_[^/]*\.mjs$)/;
const MODULE_RE = /^modules\/([^/]+)\//;

/**
 * Paths listed in the plan's `## Files to change` and `## New files`: list
 * lines starting with `- `; every inline-code span before the description dash
 * is a path (`a`, `b` - opis).
 * @param {string} markdown
 * @returns {string[]} unique, in order of appearance
 */
function parsePlanPaths(markdown) {
  const out = [];
  const seen = new Set();
  let inSection = false;
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(raw);
    if (h) {
      inSection = /^(Files to change|New files)$/i.test(h[1]);
      continue;
    }
    if (!inSection) continue;
    if (!/^\s*-\s+`/.test(raw)) continue;
    // `a`, `b`, `c` - description: every code span before the dash is a path.
    const head = raw.split(/\s[—–-]\s/)[0];
    const spans = head.match(/`[^`]+`/g) || [];
    for (const span of spans) {
      const p = span.slice(1, -1).trim().replace(/^\.\//, '');
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/**
 * The Phase 6 path decision for a list of plan paths.
 * @param {string[]} paths
 * @returns {{backend: string[], frontend: string[], other: string[], split: boolean, overlapping: string[]}}
 */
function classifyPlanLayers(paths) {
  const backend = [];
  const frontend = [];
  const other = [];
  const overlapping = [];
  for (const p of paths || []) {
    const b = BACKEND_RE.test(p);
    const f = FRONTEND_RE.test(p);
    if (b) backend.push(p);
    if (f) frontend.push(p);
    if (b && f) overlapping.push(p);
    if (!b && !f) other.push(p);
  }
  const split = (paths || []).length > 6 || (backend.length > 0 && frontend.length > 0);
  return { backend, frontend, other, split, overlapping };
}

/**
 * `git status --porcelain` (v1) text -> entries. A rename keeps the new path.
 * @param {string} text
 * @returns {Array<{code: string, path: string}>}
 */
function parsePorcelain(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let p = line.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    out.push({ code, path: p });
  }
  return out;
}

function _moduleOnlyId(paths) {
  if (!paths || paths.length === 0) return null;
  let id = null;
  for (const p of paths) {
    const m = MODULE_RE.exec(p);
    if (!m) return null;
    if (id && id !== m[1]) return null;
    id = m[1];
  }
  return id;
}

function _coveredByPlan(p, planPaths) {
  for (const pp of planPaths) {
    if (p === pp) return true;
    if (pp.endsWith('/') && p.startsWith(pp)) return true;
    if (p.endsWith('/') && pp.startsWith(p)) return true;
  }
  return false;
}

/**
 * Where should this plan be implemented?
 *   module-only - every path under one modules/<id>/ (own repository)
 *   worktree    - the plan touches the core AND (another session already has
 *                 tracked changes in the main tree, OR the split path has a
 *                 file in more than one layer, OR the person chose it)
 *   branch      - the core, alone, on a clean tree: the branch gate as before
 * @param {{planPaths: string[], porcelain?: string, splitLayers?: string[][], forced?: boolean}} input
 *   splitLayers - the file list of each slice when the plan goes the split
 *   path (e.g. [backend, frontend]); a file in two lists overlaps.
 * @returns {{recommendation: 'module-only'|'branch'|'worktree', reasons: string[], foreignChanges: string[], overlapping: string[]}}
 */
function recommendWorktree(input) {
  const planPaths = (input && input.planPaths) || [];
  const reasons = [];
  const moduleId = _moduleOnlyId(planPaths);
  if (moduleId) {
    reasons.push('The plan lies entirely in modules/' + moduleId + '/ - the module has its own repository, the core does not change; no worktree needed.');
    return { recommendation: 'module-only', reasons, foreignChanges: [], overlapping: [] };
  }

  const foreignChanges = parsePorcelain(input && input.porcelain)
    .filter((e) => e.code !== '??' && e.code !== '!!')
    .map((e) => e.path)
    .filter((p) => !/^(?:plans|user-data)\//.test(p))
    .filter((p) => !_coveredByPlan(p, planPaths));

  const counts = new Map();
  for (const list of (input && input.splitLayers) || []) {
    for (const p of new Set(list || [])) counts.set(p, (counts.get(p) || 0) + 1);
  }
  const overlapping = [...counts.entries()].filter(([, n]) => n > 1).map(([p]) => p);

  if (input && input.forced) reasons.push('User choice: a separate working copy.');
  if (foreignChanges.length > 0) {
    const shown = foreignChanges.slice(0, 5).join(', ') + (foreignChanges.length > 5 ? ', ...' : '');
    reasons.push('The main tree has changed tracked files outside the plan (' + foreignChanges.length + '): ' + shown + ' - someone else is already working here.');
  }
  if (overlapping.length > 0) {
    reasons.push('Split path with a file in more than one layer: ' + overlapping.join(', ') + '.');
  }
  if (reasons.length > 0) return { recommendation: 'worktree', reasons, foreignChanges, overlapping };

  reasons.push('The plan changes the core, the main tree is clean (apart from the plan files) and nothing overlaps - the current branch is enough.');
  return { recommendation: 'branch', reasons, foreignChanges, overlapping };
}

/**
 * Lowest port of the range that is not taken.
 * @param {{taken?: Iterable<number>, min?: number, max?: number}} opts
 * @returns {number|null} null once the range is exhausted
 */
function pickPort(opts) {
  const taken = new Set([...((opts && opts.taken) || [])].map(Number));
  const min = (opts && opts.min) || PORT_MIN;
  const max = (opts && opts.max) || PORT_MAX;
  for (let p = min; p <= max; p++) if (!taken.has(p)) return p;
  return null;
}

const ENV_PORT_RE = /^[ \t]*PORT[ \t]*=.*$/gm;

/**
 * The PORT= value of a .env text (the first line wins, as in scripts/_port.js).
 * @param {string} text
 * @returns {number|null}
 */
function readEnvPort(text) {
  const m = /^\s*PORT\s*=\s*(\d+)\s*$/m.exec(String(text || ''));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Set PORT=<port> in a .env text: every existing PORT= line is replaced, or
 * one line is appended. Everything else stays byte for byte (line endings too).
 * @param {string} text
 * @param {number} port
 * @returns {string}
 */
function rewriteEnvPort(text, port) {
  const src = String(text || '');
  const line = 'PORT=' + String(port);
  // `$` before a \r\n leaves the \r on the line: keep it out of the match.
  let found = false;
  const replaced = src.replace(ENV_PORT_RE, (m) => {
    found = true;
    return m.endsWith('\r') ? line + '\r' : line;
  });
  if (found) return replaced;
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  if (src === '') return line + eol;
  return src + (/\r?\n$/.test(src) ? '' : eol) + line + eol;
}

/**
 * May the worktree be removed now? `git worktree remove` without --force and
 * `git branch -d` (never -D) do the work; this decides first and explains.
 * @param {{porcelain?: string, merged?: boolean, serverAlive?: boolean, keepBranch?: boolean,
 *   hasBranch?: boolean, localData?: string[], discardLocalData?: boolean, slug?: string}} input
 *   porcelain - `git status --porcelain` of the WORKTREE, prepare artefacts already filtered
 *   hasBranch - false for a DETACHED HEAD: there is no branch to keep, so
 *               --keep-branch cannot save unmerged commits and is not honoured
 *   localData - files in the worktree's own ignored dirs (localDataLeftovers)
 * @returns {{ok: boolean, reasons: Array<{code: string, message: string, fix: string}>}}
 */
function removeVerdict(input) {
  const i = input || {};
  const slug = i.slug || '<slug>';
  const reasons = [];
  if (i.serverAlive) {
    reasons.push({
      code: 'server-alive',
      message: 'This worktree\'s verification server is still running.',
      fix: 'Stop the server: node scripts/worktree.js stop ' + slug,
    });
  }
  const dirty = parsePorcelain(i.porcelain);
  if (dirty.length > 0) {
    reasons.push({
      code: 'dirty',
      message: 'The worktree has uncommitted changes (' + dirty.length + ').',
      fix: 'Commit them in the worktree (git -C <path> commit) or deliberately discard them; a worktree is never removed with unsaved work.',
    });
  }
  const hasBranch = i.hasBranch !== false;
  if (!i.merged && !(i.keepBranch && hasBranch)) {
    reasons.push(hasBranch ? {
      code: 'unmerged',
      message: 'The worktree branch is not merged into the main tree\'s branch.',
      fix: 'Merge it (git merge <branch>) or remove just the worktree and keep the branch: node scripts/worktree.js remove ' + slug + ' --keep-branch',
    } : {
      code: 'unmerged',
      message: 'The worktree has a detached HEAD with commits the main tree does not have - with no branch, --keep-branch would save nothing.',
      fix: 'Create a branch on them (git -C <path> switch -c <name>) or merge them, then remove the worktree.',
    });
  }
  const local = i.localData || [];
  if (local.length > 0 && !i.discardLocalData) {
    const shown = local.slice(0, 10).join(', ') + (local.length > 10 ? ', ... (' + local.length + ' in total)' : '');
    reasons.push({
      code: 'local-data',
      message: 'The worktree\'s own directories (data/, user-data/, data-sub-repositories/) contain files: ' + shown + '. Git does not track them, so removing the worktree deletes them for good.',
      fix: 'Move what you need, or confirm deliberately: node scripts/worktree.js remove ' + slug + ' --discard-local-data',
    });
  }
  return { ok: reasons.length === 0, reasons };
}

// The worktree's own ignored directories: git does not track them and
// `git worktree remove` deletes them with the worktree.
const LOCAL_DATA_DIRS = PREPARE_TABLE.filter((r) => r.action === 'own-empty').map((r) => r.name);
// Files the verification server itself leaves in data/: never somebody's work.
const _SERVER_ARTEFACT_RE = /^data\/(?:worktree-server\.(?:log|pid)|server-\d+\.pid)$/;

/**
 * Files in the worktree's own data directories that removal would destroy.
 * @param {string[]} files paths relative to the worktree, `/` separated
 * @returns {string[]}
 */
function localDataLeftovers(files) {
  return (files || []).filter((f) => !_SERVER_ARTEFACT_RE.test(f));
}

/**
 * Does a PID's command line belong to the server of this worktree?
 * @param {string} cmdline the process command line ('' when unreadable)
 * @param {string} wtPath absolute worktree path
 * @returns {'ours'|'foreign'|'unknown'} unknown = the line could not be read
 *   (then the PID file is trusted, as before); foreign = a stale PID file
 *   after a reboot or PID reuse, never signalled and never "alive"
 */
function pidOwnership(cmdline, wtPath) {
  const text = String(cmdline || '').trim();
  if (!text) return 'unknown';
  const win = /\\/.test(text) || /^[A-Za-z]:/.test(String(wtPath || ''));
  const norm = (x) => { const t = String(x).replace(/\\/g, '/'); return win ? t.toLowerCase() : t; };
  if (norm(text).indexOf(norm(wtPath).replace(/\/+$/, '') + '/server.js') !== -1) return 'ours';
  // A server started by hand inside the worktree (`node server.js`) carries no
  // directory: the line cannot prove whose it is, so trust the PID file.
  if (/(?:^|\s)(?:\.\/)?server\.js(?:\s|$)/.test(norm(text))) return 'unknown';
  return 'foreign';
}

// Keys that never reach the test-mode child, whatever ENV_SCHEMA says.
const SECRET_ENV_RE = /TOKEN|SECRET|PASSWORD|API_KEY|ENCRYPTION_KEY|BW_/i;
const ALWAYS_STRIPPED = ['PORT', 'DATA_ENCRYPTION_KEY', 'BW_SESSION', 'COCKPIT_EMBEDDED', 'VERSION_AUTOBUMP'];

/**
 * Every ENV_SCHEMA key of kind `secret` in a server.js source. Reads the
 * `const ENV_SCHEMA = [` block only; an entry is `{ key: 'X', ..., kind: 'secret' }`.
 * @param {string} source server.js text
 * @returns {string[]}
 */
function secretEnvKeys(source) {
  const text = String(source || '');
  const start = text.indexOf('const ENV_SCHEMA = [');
  if (start === -1) return [];
  const endMark = text.indexOf('const ENV_SCHEMA_KEYS', start);
  const block = text.slice(start, endMark === -1 ? undefined : endMark);
  const out = [];
  const re = /key:\s*'([A-Za-z0-9_]+)'[^}]*?kind:\s*'secret'/g;
  let m;
  while ((m = re.exec(block)) !== null) out.push(m[1]);
  return out;
}

/**
 * The environment for the worktree's test-mode server: a copy without the
 * ENV_SCHEMA secrets, without anything that looks like a credential, and
 * without the keys serve sets itself.
 * @param {Object} env usually process.env
 * @param {string[]} secretKeys from secretEnvKeys
 * @returns {Object} a new object
 */
function stripChildEnv(env, secretKeys) {
  const drop = new Set(ALWAYS_STRIPPED.concat(secretKeys || []));
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (drop.has(k) || SECRET_ENV_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// Porcelain entries prepare itself produces: the symlinks. A trailing-slash
// ignore pattern (`node_modules/`, `/modules/`) does not match a symlink, so
// without an exclude entry git lists them as untracked. prepare adds the
// exclude; this is the second line of defence for a worktree prepared by
// something else.
const _LINK_NAMES = new Set(PREPARE_TABLE.filter((r) => r.action === 'link' || r.action === 'link-opt-in').map((r) => r.name));

/**
 * @param {{code: string, path: string}} entry porcelain entry
 * @param {(name: string) => boolean} isSymlink lstat check injected by the caller
 * @returns {boolean}
 */
function isPrepareArtefact(entry, isSymlink) {
  if (!entry || entry.code !== '??') return false;
  const name = entry.path.replace(/\/$/, '');
  return _LINK_NAMES.has(name) && Boolean(isSymlink && isSymlink(name));
}

module.exports = {
  SLUG_RE,
  PORT_MIN,
  PORT_MAX,
  WORKTREES_DIR,
  BRANCH_PREFIX,
  PREPARE_TABLE,
  parsePlanPaths,
  classifyPlanLayers,
  parsePorcelain,
  recommendWorktree,
  pickPort,
  readEnvPort,
  rewriteEnvPort,
  removeVerdict,
  isPrepareArtefact,
  LOCAL_DATA_DIRS,
  localDataLeftovers,
  pidOwnership,
  secretEnvKeys,
  stripChildEnv,
};
