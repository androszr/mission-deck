---
name: pre-ship-audit
description: >-
  Comprehensive audit of changes before a commit or push in the mission-deck repo.
  Use when the user says "audit my changes", "check my changes before commit",
  "ready to push", "ship check", or calls /pre-ship-audit. First the
  deterministic gates (`scripts/gates.js`) and the conventions check
  (`scripts/check-conventions.js`), then three to four auditors
  (code-quality, security, QA automation, plus cockpit-guardian when something
  is left to judge) in parallel, and finally one prioritised report with a VERDICT.
  The auditors get the change digest (`scripts/diff-digest.js`), not the raw diff.

---

# Pre-Ship Audit

> **When to use — quick decision table:**
>
> | Goal | Use |
> |---|---|
> | Review staged changes before committing | `/pre-ship-audit` (default, no flag) |
> | Review everything on this branch before pushing | `/pre-ship-audit --push` |
> | Graph-aware blast-radius review of a PR or branch | `/review-pr` |
> | Whole-repo test coverage + quality audit | `/qa-audit` |
>
> Runs `scripts/gates.js` first (Phase 1). If any gate fails, it stops there — no agent work until the code is clean. Then `scripts/check-conventions.js` (Phase 1.4) and `scripts/diff-digest.js` (Phase 1.6), whose outputs the auditors receive instead of a raw diff.

## Scope detection

Determine the diff scope before anything else:

- Default (no flag): **pre-commit** — `git diff --staged`
- `--push`: **pre-push** — `git diff @{u}..HEAD`; fall back to `git diff main..HEAD` when there is no upstream
- `--branch`: **full branch** — `git diff main..HEAD`

If the scope yields an empty diff, stop and tell the user. Also collect `git status --short`.

## Phase 1 — Deterministic gates (fail fast)

One command, three lines of output on a green run:

| Scope | Command |
|---|---|
| default (staged), `js/` or `tests/test_*.mjs` only | `node scripts/gates.js --lint --unit` |
| `server.js` or `tests/` touched | `node scripts/gates.js --lint --unit --api` |
| `--push` / `--branch` | `node scripts/gates.js --all` |

Exit 0 = every gate passed; exit 1 = at least one failed and the script already printed the failing
lines only. **If any gate fails, stop here — do not proceed to Phase 2.** Never invoke
`--no-verify`. Never add an `eslint-disable` as a way to pass a gate.

## Phase 1.4 — Conventions check (annotate, do not stop)

```
node scripts/check-conventions.js --base main --json      # or --staged for the default scope
```

It covers every mechanical cockpit rule: DS classes, ASCII, the view triple in every direction,
`data-perspective`, `jsonResponse`, handler placement, a test per new route, port drift, forbidden
git/process operations, the modal `.open` contract, hex literals in `styles.css`.

A `BLOCK` here does **not** stop the run — the hard stop is scoped to Phase 1 gates. Conventions
findings are exactly what the auditors should see in context, so they are passed into every Phase 2
prompt as `script_findings` and folded into the Phase 3 report as BLOCKER-band findings.

## Phase 1.5 — Graph scope summary (non-blocking)

If the `mcp__gitnexus__*` tools are unavailable, print one line —
``Run `node scripts/bootstrap-gitnexus.js` and restart Claude Code`` — and continue without it.

When available:

1. `mcp__gitnexus__list_repos` — match the entry by path, save as `REPO_NAME`. Never hardcode it.
2. `mcp__gitnexus__detect_changes({repo: REPO_NAME, scope: "compare", base_ref: "main"})`.
3. Condense the result into a short scope summary — changed symbols, affected execution flows,
   risk level — and pass that same summary to **every** auditor in Phase 2, so all of them reason
   about the same blast radius.

## Phase 1.6 — Change digest

```
node scripts/diff-digest.js --base main --json            # or --staged
```

The digest — changed files with +/- counts, added and removed symbols, added routes, added views,
added tests, cosmetic-only files, `size_class` — is what every Phase 2 prompt carries **instead of
the raw diff**. Auditors read the files they need themselves. A raw diff in a prompt is a defect
here: it enters the context three times, once per auditor.

## Phase 2 — Judgment audit (parallel)

**Banners.** the `PreToolUse` hook on `Agent` (`scripts/hook-agent-banner.js`, wired in `.claude/settings.json`) shows one banner per auditor as each `Agent({...})` call fires -
`pre-ship-audit/quality` (code-quality-auditor), `security` (security-auditor), `qa`
(qa-automation-auditor), `guardian` (cockpit-guardian, only when dispatched) - with the model that
will really run the agent (`Agent({model})` > `model:` frontmatter > session model). Do not run
`scripts/agent-banner.js` and do not paste a banner yourself; a pasted copy is a duplicate.

Dispatch in a **single message** with Agent tool calls so they run concurrently. Each agent
receives: the Phase 1.6 `digest` JSON, the changed-file list, the Phase 1.4 `script_findings` JSON,
the Phase 1.5 scope summary (or the note that it is unavailable), a pointer to its reference under
`.claude/skills/pre-ship-audit/references/`, and the output schema from `references/output-schema.md`.
**Never the raw diff** — the digest names every changed file and every auditor can `Read` them.

**Always dispatch:** `code-quality-auditor`, `security-auditor`, `qa-automation-auditor`.

**Conditionally dispatch `cockpit-guardian`** (mode `review-impl`) — only when Phase 1.4 left
something needing judgment, i.e. one of:

- `check-conventions.js` emitted any `WARN` or `NOTE`, or
- the digest touches `css/ds.css` or `css/ds-tokens*.css`.

A clean `check-conventions` run on a change that does not touch the Design System means the
guardian has nothing to add — skip it. When dispatched, pass `changed_files`, `digest` and
`script_findings`; it judges what a regex cannot (a hand-rolled `ds-card`, the right DS component,
one outer `try/finally` around an async click handler, the right `server.js` section for a route)
and must not re-report a mechanical finding the script already made.

`qa-automation-auditor` runs in **diff mode** here — it reviews the tests in the diff and the tests
that should have been added for new branches. Whole-repo gap analysis belongs to `/qa-audit`.

## Phase 3 — Synthesis

1. **Dedupe** — two agents flagging the same `file:line` for different reasons become one finding
   citing both lenses. A `check-conventions` finding and a guardian finding on the same line are
   one finding, credited to the script.
2. **Calibrate severity** — on disagreement take the higher and say why.
3. **Rank** — Blockers, then Should-fix, then Nits; alphabetical by file within each band.
4. **Render** per `references/output-schema.md`.
5. End with a single VERDICT line.

## Phase 4 — Persist the report

Write the synthesized report to the gitignored `user-data/audits/` directory:

- Path: `user-data/audits/pre-ship-audit-<YYYY-MM-DD>-<HHMM>.md` (`date +%Y-%m-%d-%H%M`).
- `mkdir -p user-data/audits` if missing.
- Content: the Phase 3 report, prefixed with a `# Pre-Ship Audit Report` heading and a one-line
  metadata block (`Scope`, `Changed files: N`, `Size class`, `Generated: <ISO timestamp>`,
  `Branch`, `HEAD`).
- Then print the absolute path and the VERDICT line. Do NOT dump the full report inline — the file
  is the source of truth.

Audits stay local on purpose: `user-data/` is gitignored, so reports never leak into commits.

## Phase 5 — Optional implementation (delegated to a Sonnet subagent)

After writing the file, print one line:
`Reply "apply" to implement BLOCKER + SHOULD-FIX items, or "ignore" to stop.`

On "apply" / "fix", **do not implement in this context**. Spawn a `general-purpose` Agent with
`model: "sonnet"` and a self-contained prompt:

- The path to the audit file (the subagent Reads it itself).
- Implement every BLOCKER and SHOULD-FIX that carries a concrete `Suggested:` edit. Skip Nits and
  findings without a concrete fix.
- After each batch of edits run `node scripts/gates.js --lint --unit` (add `--api` when `server.js`
  or `tests/` were touched) and `node scripts/check-conventions.js --base main`.
- Never commit. Report what was applied, what was skipped and why, and the gate results.

Relay the subagent's summary verbatim and stop. Do not re-run the audit.
On "ignore" or anything else, stop without action.
