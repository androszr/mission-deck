---
name: gitnexus
description: >-
  Knowledge of this repo's code graph - symbols, callers, callees, execution
  flows and the blast radius of a change. Use when the user asks "how does X work", "what
  breaks if I change X", "why is X failing", wants a safe rename or calls /gitnexus. This
  file is a switchboard: it routes to one of six sub-skills (exploring, impact analysis,
  debugging, refactoring, tool guide, CLI) and says what to do when the index is stale or
  the MCP server is missing. GitNexus is a help, never a gate - missing tools end in one
  line of advice, not in stopped work.
---

# GitNexus

> **TL;DR:** The repo is indexed as **mission-deck**. The `mcp__gitnexus__*` tools answer the
> questions grep answers slowly or incompletely: who calls this symbol, what breaks after a change,
> which way this execution flow runs. This file picks the sub-skill; the detail lives in it.

## Which sub-skill

| The user's question | Sub-skill |
|---|---|
| "How does X work?", architecture, an execution flow | [gitnexus-exploring](gitnexus-exploring/SKILL.md) |
| "What breaks if I change X?", is this safe | [gitnexus-impact-analysis](gitnexus-impact-analysis/SKILL.md) |
| "Why is X failing?", where does this error come from | [gitnexus-debugging](gitnexus-debugging/SKILL.md) |
| Rename, extract, split, move | [gitnexus-refactoring](gitnexus-refactoring/SKILL.md) |
| Tool list, graph schema, query reference | [gitnexus-guide](gitnexus-guide/SKILL.md) |
| Indexing, status, cleaning, wiki from the CLI | [gitnexus-cli](gitnexus-cli/SKILL.md) |

## Shared rules

- **Before editing an existing symbol, measure its blast radius:**
  `mcp__gitnexus__impact({repo: "mission-deck", target: "<symbol>", direction: "upstream"})`.
  Report HIGH or CRITICAL to the user before changing anything.
- **Do not guess the repo name** - call `mcp__gitnexus__list_repos` and pick the entry whose path
  matches the working directory.
- **Do not rename with find-and-replace** - `mcp__gitnexus__rename` knows the call graph.
- **Index stale or not built yet?** `node scripts/bootstrap-gitnexus.js` from the repo root - one
  command for both cases. `.gitnexus/` is in `.gitignore`, so a fresh clone has no `run.cjs` and
  `node .gitnexus/run.cjs analyze` ends there in `MODULE_NOT_FOUND`; the bootstrapper also installs
  the CLI and runs the analysis with `ANALYZE_ENV`, without which `server.js` drops out of the
  graph. Detail: the `gitnexus-cli` sub-skill.
- **No MCP tools?** Print one line: ``Run `node scripts/bootstrap-gitnexus.js` and restart Claude
  Code`` and keep working without the graph. GitNexus never stops a task.
- Read large symbols (hubs) with `summaryOnly: true` or a smaller `limit`, so the result does not
  flood the context.

## Where else it runs

`/new-idea` (Phase 6.6 - graph review against the plan), `/review-pr` (blast radius of the whole
branch) and `/pre-ship-audit` (Phase 1.5) load these sub-skills when needed. Then this file does
not have to be called by hand.
