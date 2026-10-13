# Output Schema — Pre-Ship Audit

## Severity rubric

**BLOCKER**
Correctness, security, data integrity, or convention violation that will cause
user-visible breakage, data loss, a silent wrong-bucket write, or a CI failure.
Ship-blocking. Must be resolved before commit/push.

**SHOULD-FIX**
Design issue, missing test for a new code branch, missed parallel-script update,
maintainability problem that will compound, or a convention gap that will confuse
the next engineer. Not ship-blocking but must be addressed in this PR or a
tracked follow-up. Never defer a Should-fix silently.

**NIT**
Naming preference, minor cleanup, stylistic suggestion. Mention once, do not
belabor. Auto-apply is never allowed for Nits.

## Calibration rules

- If two agents disagree on severity for the same issue, take the higher and note why.
- A "missing test" is Should-fix only if the changed logic has a new branch. Pure
  refactors with no behavior change do not require new tests.
- A Nit that has already been noted in a prior finding in the same session is
  suppressed (don't repeat).

## Per-finding format

```
[SEVERITY] <agent-name> — <file>:<line>
  <one-sentence description of the problem>
  Suggested: <concrete edit or action; omit if no clear fix exists>
```

Examples:

```
[BLOCKER] security-auditor — server.js:1842
  Unvalidated `keys` param flows directly into spawn(); regex-allowlist missing.
  Suggested: validate against /^[A-Z]+-\d+(,[A-Z]+-\d+)*$/ before spawn call.

[SHOULD-FIX] repo-conventions-auditor — scripts/sprint_stats.py:88
  CS parallel script sprint_stats_team.py not updated with the same logic fix.
  Suggested: apply identical change at scripts/sprint_stats_team.py:91.

[NIT] code-quality-auditor — js/gate-start.js:204
  Variable `tmp` could be named `pendingSessionKey` for clarity.
```

## Report structure

```
## Pre-Ship Audit Report
Scope: <pre-commit | pre-push | branch>  Changed files: N

### Blockers (N)
... findings ...

### Should-fix (N)
... findings ...

### Nits (N)
... findings ...

VERDICT: <OK TO SHIP | BLOCKERS — N issue(s) must be fixed | REVIEW — N should-fix issue(s), no blockers>
```

If there are zero findings in a band, omit that section header entirely.
If there are zero findings total: output only the VERDICT line as `VERDICT: OK TO SHIP — no issues found`.
