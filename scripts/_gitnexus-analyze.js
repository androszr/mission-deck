'use strict';
// scripts/_gitnexus-analyze.js
// How this repo runs `gitnexus analyze`, in one place.
//
// Shared by the two callers that must never disagree:
//   - scripts/bootstrap-gitnexus.js, the first-run setup
//   - server.js POST /api/tools/gitnexus-reindex, the button in
//     Settings > Tools
//
// The two environment values below are NOT tuning knobs, they are the
// difference between an index and a lie:
//
//   MAX_FILE_SIZE - server.js is ~2.9 MB and grows every commit, while the
//   analyzer's default cap is 512 KB. Below this value the single most-edited
//   file in the repo is silently dropped from the graph, every `impact` and
//   `context` call against a server symbol answers "not found", and the
//   "run impact before editing" rule in CLAUDE.md degrades to a no-op with
//   nothing but one line in the analyze log to say so.
//
//   WORKER_TIMEOUT_MS - a 2.9 MB single-file parse blows the 30 s default
//   worker idle timeout: the job is retired, the File row still lands, and ZERO
//   symbols are extracted. That looks exactly like a clean index.
//
// Run the analyzer without these and you get a green card over an empty graph,
// which is worse than no card at all.

const path = require('path');
const fs = require('fs');

// The CLI version this repo is pinned to. Lives here, not in the bootstrapper,
// because the "Install" button in Settings > Tools installs the same
// pin - two places would mean two different gitnexus versions in one team.
const CLI_VERSION = '1.6.9';

const MAX_FILE_SIZE = '4096';
const WORKER_TIMEOUT_MS = '300000';

const ANALYZE_ENV = {
  GITNEXUS_MAX_FILE_SIZE: MAX_FILE_SIZE,
  GITNEXUS_WORKER_SUB_BATCH_TIMEOUT_MS: WORKER_TIMEOUT_MS,
};

/**
 * How to invoke the analyzer from `rootDir`.
 *
 * `.gitnexus/run.cjs` is gitnexus's own launcher and is itself the single
 * source of truth for picking a working runner (global CLI, pnpm dlx, npx) -
 * so it is preferred whenever the repo has already been indexed once. A repo
 * with no `.gitnexus/` yet has no launcher, and there the global CLI is all
 * there is; that is the case scripts/bootstrap-gitnexus.js handles.
 *
 * A source archive (the GitLab zip) has no `.git` and the analyzer refuses it
 * outright; `--skip-git` indexes the tree without history. Decided here so the
 * bootstrapper and the Tools button cannot disagree about it.
 *
 * @param {string} rootDir repository root
 * @returns {{cmd: string, args: string[], via: 'runner'|'cli'}}
 */
function analyzeInvocation(rootDir) {
  const analyzeArgs = analyzeCliArgs(rootDir);
  const runner = path.join(rootDir, '.gitnexus', 'run.cjs');
  if (fs.existsSync(runner)) {
    return { cmd: process.execPath, args: [runner, ...analyzeArgs], via: 'runner' };
  }
  return {
    cmd: process.platform === 'win32' ? 'gitnexus.cmd' : 'gitnexus',
    args: analyzeArgs,
    via: 'cli',
  };
}

/**
 * The analyzer's own arguments for `rootDir`: `analyze --index-only`, plus
 * `--skip-git` when the root is not a repository (a source archive before
 * adoption).
 *
 * `--index-only` is what keeps a reindex out of everybody's `git status`.
 * Without it the analyzer INJECTS files as a side effect of indexing: it
 * rewrites the banner block in AGENTS.md and CLAUDE.md and it reinstalls its
 * own skill documents under `.claude/skills/gitnexus/`. All of those are
 * COMMITTED here - a fresh clone already carries them - so the injection never
 * adds anything, it only overwrites the reviewed copy with whatever the
 * installed CLI happens to ship. A newer CLI therefore turned "refresh the
 * index" into nine modified tracked files nobody typed, on every machine that
 * reindexed, and moved the sub-skills to a flat layout while leaving the old
 * directories behind as duplicates. The index itself is unaffected:
 * `.gitnexus/meta.json` is still written with `lastCommit`, `indexedAt` and
 * `stats`, which is exactly what the freshness probe behind the Tools card
 * reads (measured, not read off `--help`).
 *
 * The price is that the banner's symbol counts freeze at the committed values.
 * They are documentation and nothing branches on them; refreshing them is a
 * deliberate act - run the analyzer once without this flag, read the diff,
 * commit it. `_isGitnexusBannerOnlyDiff` in server.js stays as the safety net
 * for whoever does that, and stops being load-bearing.
 *
 * @param {string} rootDir repository root
 * @returns {string[]}
 */
function analyzeCliArgs(rootDir) {
  const args = ['analyze', '--index-only'];
  if (!fs.existsSync(path.join(rootDir, '.git'))) args.push('--skip-git');
  return args;
}

module.exports = { ANALYZE_ENV, CLI_VERSION, MAX_FILE_SIZE, WORKER_TIMEOUT_MS, analyzeInvocation, analyzeCliArgs };
