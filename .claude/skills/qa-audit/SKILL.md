---
name: qa-audit
description: >-
  Review of test coverage and test quality across the whole mission-deck repo.
  Use when the user says "audit tests", "review the tests", "find gaps in the tests",
  "do we have good tests", "QA review", or calls /qa-audit. Inventories
  every test in the project, runs the qa-automation-auditor agent and saves a
  prioritised report. Different from /pre-ship-audit, which looks only at the diff.

---

# QA Audit

> **TL;DR:** Whole-repo test coverage + test quality review. Dispatches `qa-automation-auditor` (Opus) with a full inventory of `tests/`, `js/`, `server.js` and `scripts/`. Writes a report to `user-data/audits/qa-audit-<date>.md`. Different from `/pre-ship-audit`, which is diff-scoped — use this when you want the full picture, not just "did I break something today".

Answers two questions:

1. **Where are the gaps?** — what ships untested, especially on high-risk surfaces (server routes,
   shared-write paths behind `withLock`, the `.env` loader, the JSON self-heal path).
2. **Are the existing tests any good?** — do they verify behaviour, or do they pass for the sake of
   passing (tautologies, over-mocking, pinned internals, unexplained skips)?

There is no coverage tooling in this repo — the analysis is structural. Do not ask for or invent a
coverage percentage.

## Phase 1 — Inventory (deterministic)

Collect once, in parallel:

- `ls tests/` — every test file, split into `test_*.mjs` (unit) and `test_api_*.js` (API)
- `ls js/*.js` — frontend modules
- `grep -n "^// --" server.js` — the route-group sections (units under test)
- `grep -nE "'/api/[a-z0-9/-]+'" server.js | head -100` — the route inventory
- `ls scripts/*.js` — helper scripts
- `git log --oneline -20` — recent activity, to spot deprecated paths

If `tests/` is missing or empty, stop and tell the user — nothing to audit.

## Phase 2 — Dispatch

The `PreToolUse` hook on `Agent` (`scripts/hook-agent-banner.js`, wired in `.claude/settings.json`) shows the `qa-audit/auditor` banner as the `Agent({...})` call fires, with the
model that will really run the agent. Do not run `scripts/agent-banner.js` and do not paste a
banner yourself; a pasted copy is a duplicate.

Spawn `qa-automation-auditor` in **whole-repo mode** with:

- The Phase 1 inventory (test files, source files, route list, recent commits)
- A pointer to `.claude/skills/pre-ship-audit/references/output-schema.md` for the severity rubric
  and the per-finding format
- A pointer to `.claude/skills/pre-ship-audit/references/conventions.md` for the test conventions

Single agent, no parallel dispatch — there is no second lens to dedupe against. The agent's report
is the report.

## Phase 3 — Persist the report

Write the agent's report to the gitignored `user-data/audits/` directory:

- Path: `user-data/audits/qa-audit-<YYYY-MM-DD>-<HHMM>.md` (`date +%Y-%m-%d-%H%M`)
- `mkdir -p user-data/audits` if missing
- Content: the agent's report verbatim, prefixed with a `# QA Audit Report` heading and a one-line
  metadata block (`Scope: whole-repo`, `Tests: N`, `Sources: M`, `Generated: <ISO timestamp>`,
  `Branch`, `HEAD`)
- Do NOT re-synthesize, re-rank or rewrite findings — the agent already applied the rubric
- Print the absolute path and the VERDICT line. Do NOT dump the full report inline.

## Phase 4 — Optional implementation (delegated to a Sonnet subagent)

After writing the file, print one line:
`Reply with the finding ID(s) to draft tests for (e.g. "fill the gap on /api/data-tier-0/push"), or "ignore" to stop.`

If the user names specific findings, **do not implement in this context**. Spawn a
`general-purpose` Agent with `model: "sonnet"` and a self-contained prompt:

- The path to the audit file (the subagent Reads it itself) and the named finding(s)
- Hard constraint: tests must verify **real behaviour**. Tautological, shape-only or fixture-echo
  assertions are not acceptable. If the honest assertion is unclear, report back rather than invent
  a weak test.
- API tests go to `tests/test_api_*.js` and must stop the server they spawn; unit tests go to
  `tests/test_*.mjs`.
- Run the relevant suite afterwards and iterate until it passes for the right reason. Never commit.
- Report back: what was written, what was skipped and why, gate results.

Relay the subagent's summary verbatim and stop. On "ignore" or anything else, stop without action.
