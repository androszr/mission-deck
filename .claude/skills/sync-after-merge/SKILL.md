---
name: sync-after-merge
description: >-
  Clean-up after a merge - switch to main, pull from origin (GitLab, may contain
  squashed commits), interactive deletion of local branches already merged,
  and finally a status summary. Use when the user says "sync after merge",
  "clean up after merge", "post-merge sync", or calls /sync-after-merge.
  One remote: `origin`. Always asks before deleting a branch.

---

# Sync After Merge

> **TL;DR:** Post-merge cleanup — switches to `main`, pulls from `origin` (GitLab), interactively deletes merged branches, prints the final state.
>
> **When NOT to use:** a dirty working tree. The skill stops in Step 1 and will NOT auto-stash — commit or stash yourself first.

Routine cleanup after a work branch was merged on GitLab (squash merge). Aligns the local repo
with `origin`. This repo has exactly one remote.

## Steps

1. **Precheck.** `git status --porcelain`. Dirty tree -> stop and tell the user. Do not auto-stash.

2. **Verify the remote.** `git remote -v`. Expect a single `origin`. If it is named differently,
   surface the actual name and ask which to use before continuing. If there is more than one
   remote, ask which one is GitLab and use only that.

3. **Switch to main and pull.**
   ```
   git checkout main
   git pull origin main
   ```
   If the pull fails (non-fast-forward, conflicts), stop and report.

4. **Find local branches merged into main.**
   ```
   git branch --merged main | grep -v '^\*' | grep -vE '^\s*(main|master)\s*$'
   ```
   Squash-merged branches do not show up there. Detect them too:
   ```
   for b in $(git branch --format='%(refname:short)' | grep -vE '^(main|master)$'); do
     mb=$(git merge-base main "$b")
     tree=$(git rev-parse "$b^{tree}")
     squashed=$(git commit-tree "$tree" -p "$mb" -m _ 2>/dev/null)
     if git cherry main "$squashed" 2>/dev/null | grep -q '^-'; then
       echo "$b (squash-merged)"
     fi
   done
   ```
   Combine both lists and dedupe. Every branch here is an ordinary git branch and follows the
   same rules.

5. **Interactive delete.** Show the candidates and prompt:
   ```
   Delete which branches?
     all     — delete every candidate
     <names> — space-separated subset
     none    — skip
   ```
   For each chosen branch: try `git branch -d <name>` first (safe). If it refuses (the
   squash-merge case), confirm once with the user and then use `git branch -D <name>`.
   Never delete `main`, `master` or the current branch.

6. **Prune stale remote-tracking refs.** `git fetch --prune origin`, then report which
   `origin/*` refs disappeared.

7. **Final report.**
   - `git rev-parse --abbrev-ref HEAD` (should be `main`)
   - `git log --oneline -3`
   - Branches deleted
   - Remote refs pruned

## Hard rules

- Never delete the current branch or `main` / `master`.
- Never force-push. If a push is genuinely needed, tell the user the exact command and let them run it.
- Never bypass hooks (`--no-verify`).
- Never auto-stash or discard uncommitted work — stop and ask.
- Never touch `data-sub-repositories/` — it is a separate repo synced through the app UI.

## Notes

- `origin` is GitLab and merges arrive squashed; the `commit-tree` trick in step 4 is what catches
  those branches.
- Merge requests are opened in GitLab, not from this skill.
- This is routine maintenance — fast, no agents, no subprocess work.
