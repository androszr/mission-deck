---
name: review-pr
description: >-
  Review of a branch or MR using the gitnexus MCP server - blast radius and
  structural context. Use when the user says "review this branch", "review my branch",
  "review MR", "check changes against main", or calls /review-pr. Unlike
  /pre-ship-audit (diff + specialist auditors) this skill is graph-aware
  and analyses callers, callees and test coverage across the whole branch.
argument-hint: "[branch name]"
---

# Review PR (graph-aware)

> **PREREQUISITE — the gitnexus MCP must be running.** If the `mcp__gitnexus__*` tools are unavailable, stop and tell the user: _"Run `node scripts/bootstrap-gitnexus.js` and restart Claude Code."_ Do not attempt the review without the graph — this is the one skill where the graph is a gate, not an aid.
>
> **TL;DR:** Graph-aware branch review. Maps diff hunks to symbols, computes blast radius (what breaks if you change this), then does a per-file deep dive on the high-impact surfaces. Complements `/pre-ship-audit` (lint + specialist auditors on a staged diff) — use both for high-stakes merges.

Key tools:

| Tool | Purpose |
|---|---|
| `mcp__gitnexus__detect_changes` | Map git diff hunks to changed symbols and affected execution flows |
| `mcp__gitnexus__impact` | Blast radius: what breaks if you change a symbol (upstream/downstream) |
| `mcp__gitnexus__context` | 360-degree view of a symbol: callers, callees, imports, flows |
| `mcp__gitnexus__query` | Keyword search across the indexed graph |
| `mcp__gitnexus__trace` | Trace execution flows through the codebase |
| `mcp__gitnexus__check` | Health check on the index |
| `mcp__gitnexus__explain` | Natural-language question about the codebase |

Call these instead of `Read`-ing whole files where possible.

**Token discipline:** `context` for targeted symbol lookups; `impact` with `summaryOnly: true` or a
small `limit` on hub symbols. Do not put full file contents in the final report unless asked.

**Repo name:** gitnexus assigns repo names at indexing time and they may differ from the directory
name. Discover it with `mcp__gitnexus__list_repos` and match by path. Never hardcode.

**Remote:** this repo has a single remote, `origin` (GitLab). Merge requests are opened in GitLab
itself; there is no second remote to reconcile.

## Steps

1. **Identify the diff scope.** A branch name in args -> `git diff main...<branch>`. Otherwise
   auto-detect the current branch against `main`. Empty diff -> stop and say so.

2. **Discover the repo name** with `mcp__gitnexus__list_repos`; pick the entry whose path matches
   the working directory. Save as `REPO_NAME`.

3. **Detect changed symbols and affected flows:**
   `mcp__gitnexus__detect_changes({repo: REPO_NAME, scope: "compare", base_ref: "main"})`.

4. **Compute blast radius for high-risk symbols.** For each changed symbol in a high-traffic file
   (`server.js`, `js/app.js`, `js/view-registry.js`, `js/sidebar-flyout-config.js`):
   ```
   mcp__gitnexus__impact({
     repo: REPO_NAME,
     target: "<symbol>",
     direction: "upstream",
     file_path: "<file>",
     maxDepth: 2,
     limit: 30
   })
   ```
   Note the symbols with the largest upstream reach. Use `summaryOnly: true` on hub symbols.

5. **Per-file deep dive, high-risk first.**
   - Risky functions: `mcp__gitnexus__context({repo: REPO_NAME, name: "<func>", file_path: "<file>"})`
     to see who breaks if the contract changes.
   - Test coverage: `mcp__gitnexus__impact({repo: REPO_NAME, target: "<func>", direction: "upstream", includeTests: true})`.
     A changed risky function with no test reference is a finding. Fall back to
     `grep -rn "<func>" tests/`.
   - Only `Read` the source when the graph is insufficient.
   - Run the project checks below now and capture their raw output for step 6.

6. **Delegate synthesis.** Compile a `review_bundle` from every piece of raw evidence gathered in
   steps 1-5 (diff stat, graph output, bash findings, file excerpts).

   Render the banner and paste the script output as a fenced code block in your text response
   (Bash results are collapsed and the user cannot scroll back to them):

   ```
   node scripts/agent-banner.js review-pr/review
   ```

   This is the one banner in the repo with no `{{MODEL}}` placeholder: the synthesis runs on the
   built-in `general-purpose` agent, which is not in `.claude/agents/` and inherits the session
   model, so there is no `model:` line for the script to read. Never Read the raw `.txt` and edit
   a model into it by hand.

   Then spawn:

   ```
   Agent({
     // No model override: inherits the session model.
     description: "PR Review synthesis: <branch>",
     prompt: `You are a senior engineer writing a structured PR review report.
   You have been given raw evidence collected by graph tools and bash commands.
   Do NOT run any tools - all data you need is below. Synthesise it into the
   structured report format specified at the end.

   ## Branch
   <branch name>

   ## Diff stat
   <output of git diff main...HEAD --stat>

   ## Graph: changed symbols + affected flows
   <detect_changes output>

   ## Graph: blast radius (per high-risk symbol)
   <impact outputs, one block per symbol>

   ## Graph: symbol context (per high-risk symbol)
   <context outputs, one block per symbol>

   ## Bash findings
   <raw output of every check run in step 5, labelled by check name>

   ## Project-specific checklist to evaluate (use the bash findings above as evidence)
   - **View triple**: a new view needs all three - a <div class="view-section" id="view-<id>">
     in index.html, a VIEW_REGISTRY entry in js/view-registry.js, and a { label, view } entry
     in the pages array of a hub row in js/core-hubs.mjs. Fewer than three means the view is
     unreachable. NEVER report js/sidebar-flyout-config.js as a missing leg: it is a generated
     loop over js/core-hubs.mjs and must not be edited by hand. A core view deliberately left
     out of every hub (academy, onboarding-wizard) is reachable only if something links
     its hash - check that before calling it unreachable.
   - **No perspectives**: any data-perspective attribute or applyPerspective reference is a finding.
   - **DS classes**: every new interactive or structural element uses ds-* classes; no ad-hoc
     buttons, badges, modals or inputs; no hardcoded hex colors.
   - **Server endpoints**: new routes live in the matching // -- Nazwa -- section, respond through
     jsonResponse, and wrap every shared write in withLock with tmp+rename.
   - **Tests**: every new route has a tests/test_api_*.js case; new branching helpers in js/ have
     a tests/test_*.mjs case.
   - **View cleanup**: timers, intervals, window listeners and EventSource instances register with
     runActiveViewCleanup (js/view-lifecycle.js).
   - **ASCII code, English copy**: identifiers, comments and file names are ASCII; user-visible strings are plain English.
   - **Process**: no hard git resets, no --no-verify, no npm start as an agent action, no
     POST /api/app/update from code, no git operations inside data-sub-repositories/.

   ## Report format (output this exact structure)
   ## PR Review: <branch>

   ### Summary
   <1-3 sentences>

   ### Risk assessment
   - Overall risk: Low / Medium / High
   - Blast radius: X files, Y functions impacted
   - Test coverage: N changed functions covered / M total

   ### File-by-file
   #### <path>
   - Changes: <what>
   - Impact: <who depends on it>
   - Issues: <bugs, conventions, footguns>

   ### Missing tests
   - <function> in <file> - no test coverage found
   (write "None found." if coverage looks adequate)

   ### Recommendations
   1. <actionable, labelled BLOCK / WARN / NOTE>

   VERDICT: Ship / Fix-then-ship / Block
   `
   })
   ```

   Output the agent's report directly. Do not summarise or re-wrap it — the agent's text IS the
   final report.

## Tips

- Large branches: sort by impact and review the most-depended-on files first.
- `mcp__gitnexus__query({repo: REPO_NAME, search_query: "<concept>"})` finds related code the diff
  may have missed (a renamed concept with stale callers elsewhere).
- Renames and moves: `impact({target: "<old_name>", direction: "upstream"})` to confirm zero stale
  references remain.
- `mcp__gitnexus__trace` follows execution paths through long call chains.
