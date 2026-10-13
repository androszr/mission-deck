'use strict';
// scripts/_app-repo-adopt.js
// Turns an unpacked source archive of THIS application back into a git
// repository, without touching a single file in the working tree.
//
// Why this exists. The starter package handed to a new person is the zip
// GitLab builds with `git archive`: every tracked file, no `.git`. Everything
// that makes the cockpit self-maintaining assumes a repository - the updater
// (`git fetch` + `reset --hard FETCH_HEAD`), the GitNexus index, the training
// path's own branch. `npm install` cannot repair that, because the fetch needs
// the project token and the token lives in Bitwarden, not on disk. So the
// server does it here, the first time it holds a token and finds no `.git`.
//
// What "adopt" means, in order:
//   1. `git init` + `origin` (the canonical HTTPS address),
//   2. fetch `main` with the token,
//   3. find the commit the archive was cut from,
//   4. point `main` at it and load its tree into the INDEX only.
// After step 4 `git status` is clean and `HEAD` is exactly the commit the
// person is running, so the updater's dirty-tree guard and `reset --hard` do
// what they do after a clone. No reset, no checkout of the tree, and exactly
// ONE write outside `.git`: SOURCE_COMMIT is put back to its committed content
// (see below), because the stamped hash differs from the committed placeholder
// and would otherwise show as a modified file that blocks every update.
//
// Step 3 has two answers. The archive carries `SOURCE_COMMIT`, a one-line
// file whose committed content is the literal `$Format:%H$`; `.gitattributes`
// marks it `export-subst`, so `git archive` (and therefore GitLab's download
// button) replaces it with the commit hash. A clone keeps the literal, which
// reads as "no hint". Without a usable hint the last MAX_SCAN_CANDIDATES
// commits of `main` are tried newest-first: load the tree into the index,
// ask `git diff --quiet` whether the working tree differs. The comparison is
// content only - file modes are ignored because a zip tool may drop the
// executable bit, CR at end of line is ignored because a Windows editor may
// have added one - and SOURCE_COMMIT itself is left out of it, because a
// stamped hint that names a commit `main` does not have (a feature-branch
// download) differs from every candidate by construction.
//
// Nothing matches -> the archive is not a commit of `main` (a hand-edited
// tree, a feature-branch download) and the `.git` this call created is
// removed again, so the next call starts from the same clean state. A `.git`
// that existed before the call is never removed.
//
// Dependency-free: fs, path and a git runner the caller injects, so server.js
// hands in its own `_gitP` (askpass stripped, credential helper off for
// remote subcommands) and the unit test hands in a plain execFile.

const fs = require('fs');
const path = require('path');

const SOURCE_COMMIT_FILE = 'SOURCE_COMMIT';
const SOURCE_COMMIT_PLACEHOLDER = '$Format:%H$';
const MAX_SCAN_CANDIDATES = 30;
const SHA_RE = /^[0-9a-f]{40}$/;
const ORIGIN_MAIN_REF = 'refs/remotes/origin/main';
// The one refspec that keeps the remote-tracking ref honest. A fetch given
// only a URL writes FETCH_HEAD and NOTHING else - see repairStaleOriginMain
// below for what that cost - so every fetch of this repository names an
// explicit destination for main. The token rides in the URL argument and
// never reaches remote.origin.url either way.
const ORIGIN_MAIN_REFSPEC = `+refs/heads/main:${ORIGIN_MAIN_REF}`;

/**
 * The commit hash `git archive` stamped into SOURCE_COMMIT, or null when the
 * file is missing, still holds the placeholder (a clone) or is not a hash.
 * @param {string} root
 * @returns {string|null}
 */
function readSourceCommit(root) {
  try {
    const raw = fs.readFileSync(path.join(root, SOURCE_COMMIT_FILE), 'utf8').trim();
    return SHA_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Whether `root` itself is a repository root. An fs check rather than a git
 * answer, because `git -C root` walks up and would report a PARENT repository
 * for a zip unpacked inside one.
 * @param {string} root
 * @returns {boolean}
 */
function hasGitDir(root) {
  return fs.existsSync(path.join(root, '.git'));
}

/**
 * 'none'   - no `.git` at root,
 * 'unborn' - `.git` exists but HEAD points at no commit (an interrupted adopt),
 * 'ready'  - a repository with a commit checked out.
 * @param {string} root
 * @param {(args: string[], timeoutMs: number) => Promise<{code:number, stdout:string, stderr:string}>} run
 * @returns {Promise<'none'|'unborn'|'ready'>}
 */
async function repoState(root, run) {
  if (!hasGitDir(root)) return 'none';
  const r = await run(['-C', root, 'rev-parse', '--verify', '-q', 'HEAD'], 5000);
  return r.code === 0 && r.stdout.trim() ? 'ready' : 'unborn';
}

/**
 * Adopt the working tree at `root` into a repository tracking `remoteUrl`.
 * Never throws; writes nothing outside `root/.git` except restoring
 * SOURCE_COMMIT to its committed content once the hint has been consumed.
 *
 * @param {object} opts
 * @param {string} opts.root absolute path of the application root
 * @param {string} opts.remoteUrl clean HTTPS address recorded as `origin`
 * @param {string} opts.fetchUrl the address used for the one fetch (may carry a token)
 * @param {(args: string[], timeoutMs: number) => Promise<{code:number, stdout:string, stderr:string}>} opts.run
 * @param {number} [opts.maxCandidates]
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ok: boolean, already?: boolean, created?: boolean, commit?: string, matched?: 'source-commit'|'tree-scan', error?: 'git-missing'|'fetch-failed'|'no-match'|'error', stderr?: string}>}
 */
async function adoptAppRepo(opts) {
  const { root, remoteUrl, fetchUrl, run } = opts;
  const maxCandidates = opts.maxCandidates || MAX_SCAN_CANDIDATES;
  const log = opts.log || (() => {});
  const git = (args, timeout) => run(['-C', root, ...args], timeout || 15000);

  const state = await repoState(root, run);
  if (state === 'ready') return { ok: true, already: true };

  const created = state === 'none';
  const undo = () => {
    if (!created) return;
    try { fs.rmSync(path.join(root, '.git'), { recursive: true, force: true }); } catch { /* best effort */ }
  };

  if (created) {
    const init = await git(['init', '-q'], 15000);
    if (init.code !== 0) {
      const missing = /ENOENT|not found|nie jest rozpoznawan|is not recognized/i.test(init.stderr || '');
      return { ok: false, error: missing ? 'git-missing' : 'error', stderr: init.stderr };
    }
  }
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], 5000);

  const hasOrigin = (await git(['remote', 'get-url', 'origin'], 5000)).code === 0;
  const remoteR = await git(hasOrigin ? ['remote', 'set-url', 'origin', remoteUrl] : ['remote', 'add', 'origin', remoteUrl], 5000);
  if (remoteR.code !== 0) { undo(); return { ok: false, error: 'error', stderr: remoteR.stderr }; }

  const fetchR = await git(['fetch', '-q', fetchUrl, ORIGIN_MAIN_REFSPEC], 120000);
  if (fetchR.code !== 0) { undo(); return { ok: false, error: 'fetch-failed', stderr: fetchR.stderr }; }

  // Step 3a: the hash git archive stamped in.
  let base = null;
  let matched = null;
  const hinted = readSourceCommit(root);
  if (hinted) {
    const exists = await git(['cat-file', '-e', `${hinted}^{commit}`], 5000);
    if (exists.code === 0) { base = hinted; matched = 'source-commit'; }
  }

  // Step 3b: newest-first scan of main for a tree identical to the disk.
  if (!base) {
    const list = await git(['rev-list', `--max-count=${maxCandidates}`, 'refs/remotes/origin/main'], 10000);
    const candidates = list.code === 0 ? list.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];
    for (const sha of candidates) {
      const rt = await git(['read-tree', sha], 15000);
      if (rt.code !== 0) continue;
      const diff = await git(['-c', 'core.fileMode=false', 'diff', '--quiet', '--ignore-cr-at-eol', '--', '.', `:(exclude)${SOURCE_COMMIT_FILE}`], 60000);
      if (diff.code === 0) { base = sha; matched = 'tree-scan'; break; }
    }
  }

  if (!base) { undo(); return { ok: false, error: 'no-match' }; }

  // Step 4: refs and index only. The working tree is already the commit.
  const upd = await git(['update-ref', 'refs/heads/main', base], 5000);
  if (upd.code !== 0) { undo(); return { ok: false, error: 'error', stderr: upd.stderr }; }
  const rt = await git(['read-tree', 'HEAD'], 15000);
  if (rt.code !== 0) { undo(); return { ok: false, error: 'error', stderr: rt.stderr }; }
  // The hint has done its job. The stamped hash is not the committed content
  // of SOURCE_COMMIT, so left alone it would be the one modified file in an
  // otherwise clean tree - and the updater refuses over ANY modified file. The
  // committed blob is restored (a commit without the file simply fails here,
  // which is fine: then nothing is dirty).
  if (fs.existsSync(path.join(root, SOURCE_COMMIT_FILE))) {
    await git(['checkout', '-q', 'HEAD', '--', SOURCE_COMMIT_FILE], 10000);
  }
  await git(['update-index', '-q', '--refresh'], 60000);
  await git(['config', 'branch.main.remote', 'origin'], 5000);
  await git(['config', 'branch.main.merge', 'refs/heads/main'], 5000);
  if (fs.existsSync(path.join(root, '.husky'))) {
    await git(['config', 'core.hooksPath', '.husky'], 5000);
  }
  // The scan above compared with `-c core.fileMode=false` because a zip tool
  // may drop the executable bit - but that flag lived only in that one call.
  // Persist it for the repository this call CREATED, so the same dropped bit
  // does not resurface as a modified file the moment the updater runs
  // `status`. A repository that existed before keeps whatever it had.
  if (created) {
    await git(['config', 'core.fileMode', 'false'], 5000);
  }
  log(`adopted ${root} at ${base} (${matched})`);
  return { ok: true, created, commit: base, matched };
}

/**
 * Fast-forward `refs/remotes/origin/main` to HEAD when HEAD is provably a
 * commit this application took from the remote. One ref write, no network.
 *
 * Why this exists. Until 2026-09-15 both update paths fetched by bare URL
 * with no refspec, and a fetch given only a URL writes FETCH_HEAD ALONE:
 * the remote-tracking ref stayed wherever the clone or the adopt left it
 * while the reset --hard walked local `main` forward one release at a
 * time. An editor reads that gap as "you have N commits to push" and offers
 * a person the maintainer's own commits behind a GitLab sign-in they have no
 * business completing - thirteen of them on the machine this was found on.
 * ORIGIN_MAIN_REFSPEC stops it recurring, but it cannot repair a machine
 * that is already apart: the startup updater returns early for every boot
 * that has a recorded state hash, so a machine sitting at the newest release
 * never fetches again and would keep its wrong count for good.
 *
 * Two conditions, both required, both chosen so this can only ever tell the
 * truth about the remote:
 *   - HEAD equals `stateHash`, the hash the updater recorded after its last
 *     successful reset --hard to FETCH_HEAD. That recording is the proof the
 *     commit came from the remote. A commit somebody authored locally fails
 *     the equality and stays visible as an outgoing commit, which is right.
 *   - `origin/main` is an ANCESTOR of HEAD, so the ref only moves forward
 *     along the line it was already on. A ref that is AHEAD (the remote moved
 *     and this machine has not updated yet) or diverged is left alone rather
 *     than rewound - rewinding it would hide an available update.
 *
 * Never throws. Every refusal is a reason string, never an exception.
 *
 * @param {object} opts
 * @param {string} opts.root absolute path of the application root
 * @param {(args: string[], timeoutMs: number) => Promise<{code:number, stdout:string, stderr:string}>} opts.run
 * @param {string|null} opts.stateHash hash recorded by the last successful update
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ok: boolean, moved?: boolean, already?: boolean, from?: string, to?: string, reason?: string, stderr?: string}>}
 */
async function repairStaleOriginMain(opts) {
  const { root, run, stateHash } = opts;
  const log = opts.log || (() => {});
  if (!stateHash || !SHA_RE.test(String(stateHash))) return { ok: false, reason: 'no-state' };
  if (!hasGitDir(root)) return { ok: false, reason: 'no-repo' };
  const git = (args, timeout) => run(['-C', root, ...args], timeout || 5000);

  const headR = await git(['rev-parse', '--verify', '-q', 'HEAD']);
  const head = headR.code === 0 ? headR.stdout.trim() : '';
  if (!head) return { ok: false, reason: 'no-head' };
  if (head !== stateHash) return { ok: false, reason: 'head-not-from-update' };

  const refR = await git(['rev-parse', '--verify', '-q', ORIGIN_MAIN_REF]);
  const ref = refR.code === 0 ? refR.stdout.trim() : '';
  if (!ref) return { ok: false, reason: 'no-ref' };
  if (ref === head) return { ok: true, already: true };

  const anc = await git(['merge-base', '--is-ancestor', ORIGIN_MAIN_REF, 'HEAD']);
  if (anc.code !== 0) return { ok: false, reason: 'not-ancestor' };

  const upd = await git(['update-ref', ORIGIN_MAIN_REF, head]);
  if (upd.code !== 0) return { ok: false, reason: 'error', stderr: upd.stderr };
  log(`origin/main ${ref.slice(0, 7)} -> ${head.slice(0, 7)} (stale remote-tracking ref repaired)`);
  return { ok: true, moved: true, from: ref, to: head };
}

/**
 * Clear `credential.helper` for THIS repository so the machine's helper
 * never opens a sign-in window for it.
 *
 * Why. The people this application is built for do not push it - they run
 * it, and it updates itself with a token that lives in Bitwarden. But the
 * origin they get is HTTPS, so anything that touches the remote behind
 * their back asks the machine's credential helper, and on Windows that is
 * Git Credential Manager: a modal GitLab sign-in, on the repository of an
 * app they never commit to. VS Code's `git.autofetch` is the usual trigger
 * and it fires on every window open (2026-09-15, measured on a reporter's
 * machine). server.js already passes `-c credential.helper=` on its OWN
 * remote calls for the same reason - a stale token there turned into a
 * recurring editor prompt - so this is that decision applied one level up,
 * to the calls the app does not make.
 *
 * An empty value RESETS the helper list, so the global helper stops
 * applying here and only here; git then fails quietly instead of asking.
 * Repository-local, so it is never committed and can never dirty the tree -
 * which is exactly why this is not a `.vscode/settings.json`: `.vscode/` is
 * gitignored here, and un-ignoring it would hand a modified tracked file to
 * everyone who already keeps personal editor settings, blocking the very
 * updates this repository exists to deliver.
 *
 * Two refusals keep it out of a developer's way: an SSH origin never uses a
 * credential helper at all and belongs to somebody who set it up on
 * purpose, and a helper ALREADY configured locally is somebody's decision,
 * not a default to overwrite. `--local --get` answers that unambiguously:
 * exit 1 when the key was never set, exit 0 when it was - including when it
 * was set to the empty string by an earlier boot, which is what makes this
 * idempotent.
 *
 * @param {object} opts
 * @param {string} opts.root
 * @param {(args: string[], timeoutMs: number) => Promise<{code:number, stdout:string, stderr:string}>} opts.run
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ok: boolean, set?: boolean, reason?: string, stderr?: string}>}
 */
async function quietCredentialPrompts(opts) {
  const { root, run } = opts;
  const log = opts.log || (() => {});
  if (!hasGitDir(root)) return { ok: false, reason: 'no-repo' };
  const git = (args, timeout) => run(['-C', root, ...args], timeout || 5000);

  const originR = await git(['remote', 'get-url', 'origin']);
  const origin = originR.code === 0 ? originR.stdout.trim() : '';
  if (!/^https:\/\//i.test(origin)) return { ok: false, reason: 'not-https' };

  const existing = await git(['config', '--local', '--get', 'credential.helper']);
  if (existing.code === 0) return { ok: false, reason: 'already-configured' };

  const set = await git(['config', '--local', 'credential.helper', '']);
  if (set.code !== 0) return { ok: false, reason: 'error', stderr: set.stderr };
  log('credential.helper cleared for this repository - the editor can no longer be asked to sign in to it');
  return { ok: true, set: true };
}

module.exports = {
  SOURCE_COMMIT_FILE,
  SOURCE_COMMIT_PLACEHOLDER,
  MAX_SCAN_CANDIDATES,
  readSourceCommit,
  hasGitDir,
  repoState,
  adoptAppRepo,
  repairStaleOriginMain,
  quietCredentialPrompts,
  ORIGIN_MAIN_REF,
  ORIGIN_MAIN_REFSPEC,
};
