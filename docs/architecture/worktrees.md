# Worktrees: parallel work on the core

Detail behind one line in `CLAUDE.md` ("Critical rules") and one row of its Automation table. `CLAUDE.md` keeps the rule; this file keeps the reasoning. Add new detail HERE and at most one line to `CLAUDE.md`.

## Why

When several people - or several parallel assistant sessions - work on the shared core, they all write in one directory: somebody overwrites a file, a review shows another person's work, a branch switch in one session breaks the other. Splitting files by hand ("you own these, I own those") worked once for the demo and is not a method. A linked git worktree gives each plan its own checkout of the same repository: its own working tree, its own branch, shared objects.

## Decision rule (`scripts/worktree.js recommend`)

`recommendWorktree` in `scripts/_worktree.js` (pure, unit-tested) answers one of three:

| Answer | When |
|---|---|
| `module-only` | Every path of `## Files to change` and `## New files` is under ONE `modules/<id>/`. The module has its own repository; nothing changes in the core. |
| `worktree` | The plan touches the core AND one of: `git status --porcelain` of the main tree shows a changed TRACKED file outside `plans/`, `user-data/` and the plan's own paths (another session works there); the plan goes the split path and one file is in more than one layer (`tests/test_api_x.mjs` matches both `tests/test_api_*` and `tests/test_*.mjs`); the person chose it (`--forced`). |
| `branch` | The core, one implementer, a clean tree - the Phase 6 branch gate exactly as before. |

Untracked files (`??`) never count: they are new work nobody can overwrite by checking out a branch. Not used for `/prototype` (mockups live in a data repository) or `/mini` (its branch gate is in somebody else's repository).

In `/new-idea` the answer only decides which option of the Phase 6 question "Where should this change be made?" carries "(recommended)" - the person chooses. A worktree is a VARIANT of the branch gate, so it too is created at `accept` and never earlier. One worktree per plan, not per agent.

## What a worktree gets (`prepare`) - symlink, copy, never

`PREPARE_TABLE` in `scripts/_worktree.js`, walked by `prepare` (and by `create`, which calls it). Idempotent: an entry that exists is never touched again, so a second run keeps the port.

| Entry | Action | Why |
|---|---|---|
| `node_modules` | relative symlink (a junction on Windows) | Same dependencies; no second install. Never `npm install` inside a worktree - it would write through the symlink into the main tree. `status` warns when `package-lock.json` differs from the main tree. |
| `.env` | COPY, `PORT=` rewritten to the lowest free port of 3101-3199 | Never a symlink. `scripts/_port.js` reads `PORT=` from `.env` next to it with 3001 as the default, and `scripts/kill-port.js` / `scripts/stop-server.js` kill BY PORT - a worktree without its own port would have `npm stop` kill the main server. Taken ports: the main tree's `.env` (or 3001), every other worktree's `.env`, and anything that refuses a bind. A main tree with no `.env` gives a worktree `.env` with the `PORT=` line alone. |
| `.core-dev` | copy only when the main tree has it | The core-scope opt-out is a per-machine decision (`scripts/_core-scope.js`); `scripts/hook-core-scope.js` reads it from the root of the tree the commit happens in, so without the copy the person could not commit in the worktree. The script never CREATES the marker - that would let a worktree bypass the gate on a machine that never opted out. |
| `modules` | symlink only with `--link-modules` | Installed modules are local repositories; a worktree server could write into them. |
| `data/`, `user-data/`, `data-sub-repositories/` | own EMPTY directory | Own cache (PID file, server log). A symlinked one is reported as an error. |
| `.encryption-key`, `.gitnexus`, `plans/` (beyond the tracked README) | NEVER | No flag changes this. Two processes on one plaintext directory and one mirror is the class of the 2026-09-05 incident (`clear-plaintext` in one tree while the other reads; `_acquireRepoFileLock` protects the mirror, not the plaintext). Without the key a worktree server answers "not cloned" and can neither decrypt nor push. Consequence: views reading team data show empty states in a worktree; their visual checks end in the main tree after the merge. |

`prepare` also appends `/.claude/worktrees/`, `/node_modules` and `/modules` to the shared `.git/info/exclude`. The reason is measured, not theoretical: `.gitignore` says `node_modules/` and `/modules/`, a trailing-slash pattern matches only a DIRECTORY, and a symlink is not one to git - without the exclude every worktree showed `?? node_modules`, which made `git worktree remove` refuse and invited `git add -A` to commit the link. The lines are harmless for the main tree (its real directories are already ignored).

`.gitignore` carries `/.claude/worktrees/` itself: a nested worktree is otherwise an untracked directory that `git add -A` adds as an embedded repository and that `_appUpdateDirtEntries` counts as a dirty tree.

## Verification server (`serve` / `stop`)

`serve <slug>` spawns `node <worktree>/server.js <port>` with `cwd` = the worktree and ALWAYS in test mode (`NODE_ENV=test`, `TEST_DISABLE_RESTART=1`): no browser auto-open, no startup auto-update (which would reset the worktree's branch to `FETCH_HEAD`), no sync loop, no restart, `tools/run`, `shutdown` or stash writes, no `VERSION_AUTOBUMP`. Because `.env` never overrides the process environment, the child gets `PORT`, `USER_DATA_DIR`, `DATA_SUB_REPOS_DIR` and `DATA_TIER_0_DIR` explicitly (all inside the worktree). No secret reaches it (`stripChildEnv`): every `ENV_SCHEMA` key of kind `secret`, read by `secretEnvKeys` from the `server.js` about to run, plus every key matching `TOKEN|SECRET|PASSWORD|API_KEY|ENCRYPTION_KEY|BW_`, plus `PORT`, `COCKPIT_EMBEDDED` and `VERSION_AUTOBUMP` - so a shell with exported tokens never hands them to the test-mode child. Output goes to `data/worktree-server.log` through file descriptors (a pipe would break once the CLI exits); the PID goes to `data/worktree-server.pid`; `detached: process.platform !== 'win32'`, `windowsHide: true`. It waits for `GET /api/app/version` and prints the address. It refuses when the worktree has unmerged index entries (the startup self-heal in `server.js` resolves them with `checkout --theirs` even in test mode), when the worktree has no `.env` port, when that port is the main tree's, when a server of this worktree is alive, or when the port is held by anything else.

`stop <slug>` signals ONLY the PID from the worktree's own PID file (`worktree-server.pid`, then the server's `data/server-<port>.pid`), never by port; a PID whose command line is not this worktree's `server.js` (a file left behind by a reboot or PID reuse, `pidOwnership`) counts as NOT alive everywhere - it blocks neither `serve` nor `remove` and is never signalled; `stop` deletes the worktree's own stale `worktree-server.pid` and says so (it never deletes `server.js`'s `server-<port>.pid`). An unreadable command line trusts the PID file. SIGTERM, up to 3 s, then `taskkill /PID <pid> /T /F` on Windows or SIGKILL - only for that PID. Never `npm start` in a worktree; `server.js` writes its PID file per tree and per port (`data/server-<port>.pid`), so `killOldInstance()` never reaches the other tree.

## Hooks, scripts and agents in a worktree

- `.husky/` is tracked, `core.hooksPath=.husky` is relative and lives in the shared `.git/config`, git runs hooks from the worktree root - so the worktree runs its own copy. `scripts/hook-lint-staged.js` finds `node_modules/lint-staged` through the symlink; `restore-agent-models-for-commit.js` reads `.claude/default-models.json` relative to itself. The person commits in the worktree like anywhere else.
- Automation scripts resolve the repository from their own location (`scripts/_report.js` `ROOT`), so `/new-idea` calls them BY PATH: `node <repo_root>/scripts/diff-digest.js --base main --json`, `node <repo_root>/scripts/gates.js`. `scripts/worktree.js` is the exception: it finds the MAIN tree through git's common directory from the current directory (or `--repo`), so it manages the same set of worktrees from either tree.
- Agents get `repo_root:` (implementers also `owned_files:`, `playwright-specialist` `server_url:`); they still never commit.
- Claude Code hooks in `.claude/settings.json` use `$CLAUDE_PROJECT_DIR` and therefore run the MAIN tree's scripts even from a session in a worktree - acceptable while those files are the same at HEAD; a plan that changes `scripts/hook-*.js` tests them in the worktree by calling them directly.

## GitNexus

The index (`.gitnexus/`) is one per machine and built for the main tree; worktrees are not indexed (a full index of `server.js` takes minutes). `impact` / `context` go to the main index (`repo: "mission-deck"`). `detect_changes` on a linked worktree the server was not started from answers ZERO changes and looks clean (`.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md`), so Phase 6.6 in worktree mode passes `worktree: <repo_root>` or records `graph review: skipped (worktree)` - never "clean".

## Tests in two trees

`scripts/kill-stale-tests.js` (`pretest`, `pretest:core`, `pretest:api`, `scripts/run-api-one.js`) used to kill EVERY `server.js <digits>` process on the machine, so `npm test` in one tree killed the other tree's test servers and its verification server. It now kills only command lines naming THIS tree's `server.js` by absolute path (`tests/_api_helper.js` always spawns that way) or the legacy bare relative `server.js <digits>`; `isOwnStaleTestServer` is unit-tested in `tests/test_kill_stale_tests.mjs`. The API suites still use FIXED ports per file, so `npm run test:api` runs in ONE tree at a time on a machine; `status` shows which servers are alive. Offsetting the test ports is deliberately out of scope.

## File ownership - the lighter alternative

Several implementers may share ONE tree, each with `owned_files:`, when all of these hold: the file sets are disjoint; nobody touches `index.html` or `server.js` from two sides; nobody switches branches; the gates run on a quiet tree. After each slice the skill compares `files[]` of `diff-digest` with the slice's `owned_files` - a file outside the list is `partial` naming that file. Overlapping sets get separate worktrees (`<slug>-a`, `<slug>-b`) and the person merges.

## Life cycle

1. `node scripts/worktree.js create <slug>` - `git worktree add -b wt/<slug> .claude/worktrees/<slug> <--from|HEAD>` (or `--branch <existing>` that no tree has checked out), then `prepare`. Refuses an existing directory or branch. Uncommitted changes of the main tree do NOT travel into the worktree.
2. Implementation, gates and verification inside it (`serve` / `stop` for the visual check).
3. The person reviews (`git -C <path> diff`), commits IN the worktree, merges `wt/<slug>` into their branch.
4. `node scripts/worktree.js remove <slug>` - refuses a running server, uncommitted work, or a branch not merged into the main tree's HEAD (unless `--keep-branch`), each with the command that fixes it. `--keep-branch` is honoured only when there IS a branch: a detached HEAD with commits the main tree lacks always refuses, because removing the worktree would drop them. It also refuses when the worktree's own ignored directories (`data/`, `user-data/`, `data-sub-repositories/`) hold files - git does not track them and `git worktree remove` deletes them with the tree - listing them, unless `--discard-local-data` says the loss is deliberate. The verification server's own `data/worktree-server.log`, `worktree-server.pid` and `server-<port>.pid` do not count. Then it unlinks the prepare symlinks (so nothing walks into their targets), runs `git worktree remove` WITHOUT `--force` and `git branch -d wt/<slug>` (never `-D`; a branch not named `wt/` is never deleted).
5. `prune` = `git worktree prune` plus a report of orphan directories under `.claude/worktrees/`; it deletes nothing.

`list` / `status <slug>` show per worktree: path, branch, ahead/behind against the main tree's branch, uncommitted changes, port, whether the server is alive, merged or not, `.core-dev`, whether the `node_modules` link resolves; `status` adds `serverUrl`.

## Claude Code's own worktrees

Observed on this machine: in other projects Claude Code keeps native worktrees under `.claude/worktrees/` and writes `**/.claude/worktrees/` into `.git/info/exclude` (seen in `~/Documents/sf-test`). That is the location `Agent isolation: "worktree"` and `EnterWorktree` use, and the reason `scripts/worktree.js` uses it too. NOT confirmed during the implementation (no native worktree existed to inspect): the branch name the native tools pick and what happens to an empty worktree when its agent ends. `/new-idea` does not use native per-agent isolation - it gives every spawn an unprepared tree (no `.env` port, no `node_modules`, no `.core-dev`), while 6a -> 6b -> 6c must work on ONE tree. A natively created worktree can still be made usable with `node scripts/worktree.js prepare <path>`.
