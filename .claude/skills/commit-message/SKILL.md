---
name: commit-message
description: >-
  Analyses the current diff and proposes a commit message in the
  Conventional Commits style. Judges whether the diff is coherent (one commit) or
  spans several topics (a proposed split) and lets the user choose. Use when the
  user says "suggest a commit message", "how should I name this commit",
  "draft commit msg", or calls /commit-message. Runs on Haiku through a
  subagent - cheap and fast. Only proposes; commits only after confirmation.

---

# Commit Message

> **TL;DR:** Proposes Conventional Commits message(s) for the staged (or all) changes, then commits only on an explicit confirm. **Branch guard built in** — on `main` it asks you to move to a feature branch first. Runs on Haiku (cheap). Empty diff -> stops immediately with "No changes to describe."

## Args

Optional scope:
- `staged` (default when anything is staged)
- `unstaged` (default when nothing is staged)
- `all` — staged plus unstaged (`git diff HEAD`)

## Steps

1. Precheck with `git status --short`. Clean tree -> "No changes to describe." and stop. Do not
   spawn the agent.

1a. **Branch guard.** `git rev-parse --abbrev-ref HEAD`. If the branch is `main` or `master`, do
   not draft yet. Tell the user: "You are on `<branch>`. A commit here is usually not what you
   want - move the changes to a working branch?" and prompt:

   ```
   Options:
     branch <name>  — create `<name>`, carry the changes over, commit there
     branch         — I'll suggest a name from the diff
     stay           — commit on `<branch>` anyway (I'll confirm once more)
     no             — stop
   ```

   - On `branch [<name>]`: without a name, derive a short kebab-case slug from the most prominent
     changed area (`fix/sidebar-collapse`, `feat/obszar-a-1`). Verify the name is free (suffix
     `-2`, `-3` on collision). Run `git checkout -b <name>` — uncommitted changes carry over.
     Confirm with `git rev-parse --abbrev-ref HEAD`, then continue to step 2.
   - On `stay`: re-confirm once ("Commit straight onto `<branch>`? yes / no"), then continue.
   - On `no`: stop.

   Skip the guard entirely on any other branch.

2. Pick the scope: honor the arg if given; otherwise `staged` when `git diff --staged --quiet`
   exits non-zero, else `unstaged`.

3. Spawn the **commit-message-writer** subagent (pinned to Haiku). the `PreToolUse` hook on `Agent` (`scripts/hook-agent-banner.js`, wired in `.claude/settings.json`) shows the `commit-message/writer` banner as the call fires -
   do not run `scripts/agent-banner.js` and do not paste a banner yourself:

   ```
   Agent({
     subagent_type: "commit-message-writer",
     description: "Draft commit message",
     prompt: "Scope: <staged|unstaged|all>. Draft a commit message per your instructions. Also assess whether a multi-commit split is warranted and, if so, return both a single-commit and a split proposal."
   })
   ```

   Do not pass the diff — the agent runs `git diff` itself.

4. If the agent returns `NO_CHANGES`, tell the user and stop.

5. Parse the response. Either a single fenced message, or a `SINGLE:` block followed by a
   `SPLIT (N commits):` block.

6. Present:
   - Single only: show it fenced and prompt `Run git commit with this message? (yes / edit / no)`
   - With a split: show both and prompt `Choose: (single / split / edit / no)`

7. **On `yes` / `single`:** one `git commit` with a HEREDOC message plus the `Co-Authored-By`
   trailer. Stage first when the scope was `unstaged` or `all`, using the explicit file list from
   `git status` — never `git add -A`.

8. **On `split`:** execute the sequence. For each commit in order: `git add <explicit paths>`, then
   `git commit` via HEREDOC. If a hook fails, stop the sequence, surface the error, and do not move
   on. Afterwards run `git status` and `git log -<N> --oneline`. If the sequence stopped midway,
   say clearly which commits landed and which did not.

9. **On `edit`:** take the revised message, re-present, ask again. Loop until yes/single/split/no.

## Notes

- Never bypass hooks (no `--no-verify`). Never `--amend` unless the user asks.
- The subagent is intentionally on Haiku — do not "upgrade" by doing the analysis in the main session.
- Every changed file must be covered by exactly one split group; the skill verifies this before
  executing.
- Each split group should be independently buildable. If a clean split is not possible, prefer a
  single commit.
- Messages are ASCII-only.
