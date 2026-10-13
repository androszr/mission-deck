---
name: gitnexus-impact-analysis
description: "Use when the user wants to know what will break if they change something, or needs safety analysis before editing code. Examples: \"Is it safe to change X?\", \"What depends on this?\", \"What will break?\""
---

# Impact Analysis with GitNexus

## When to Use

- "Is it safe to change this function?"
- "What will break if I modify X?"
- "Show me the blast radius"
- "Who uses this code?"
- Before making non-trivial code changes
- Before committing — to understand what your changes affect

## Workflow

```
1. impact({target: "X", direction: "upstream", repo: "mission-deck"})  → What depends on this
2. READ gitnexus://repo/mission-deck/processes                          → Check affected execution flows
3. detect_changes({repo: "mission-deck"})                               → Map current git changes to affected flows
4. Assess risk and report to user
```

> If "Index is stale" → run `node scripts/bootstrap-gitnexus.js` in terminal.

> **Repo binding.** This MCP server has several repositories indexed - `mission-deck`, other projects, and every `modules/<id>/` that was indexed on its own (each module is its own git repository). Pass `repo: "mission-deck"` on every call; an unbound call may answer from a module or from another cockpit, and the wrong answer looks exactly like a right one.
>
> `detect_changes` is the one where this bites hardest: run against a checkout that is not the one being edited (a module repo, another cockpit, a linked worktree the server was not started from) it reports **zero changed symbols** - a clean check that means "I did not look", with none of the degradation flags a stale or missing index carries. A pre-commit gate that is green because it read the wrong tree is worse than no gate. `list_repos` shows what is registered; `worktree: <abs path>` binds a linked worktree.

## Checklist

```
- [ ] impact({target, direction: "upstream", repo: "mission-deck"}) to find dependents
- [ ] Review d=1 items first (these WILL BREAK)
- [ ] Check high-confidence (>0.8) dependencies
- [ ] READ processes to check affected execution flows
- [ ] detect_changes({repo: "mission-deck"}) for pre-commit check
- [ ] Assess risk level and report to user
```

## Understanding Output

| Depth | Risk Level       | Meaning                  |
| ----- | ---------------- | ------------------------ |
| d=1   | **WILL BREAK**   | Direct callers/importers |
| d=2   | LIKELY AFFECTED  | Indirect dependencies    |
| d=3   | MAY NEED TESTING | Transitive effects       |

## Risk Assessment

| Affected                       | Risk     |
| ------------------------------ | -------- |
| <5 symbols, few processes      | LOW      |
| 5-15 symbols, 2-5 processes    | MEDIUM   |
| >15 symbols or many processes  | HIGH     |
| Critical path (auth, payments) | CRITICAL |
| `risk: "UNKNOWN"`, or 0 callers on a symbol that is plainly in use | UNKNOWN - not LOW |

### UNKNOWN is a fourth answer, not a small number

An empty caller set is equally consistent with "genuinely unused" and "the callers are not resolvable by the index" - plain-object property access, dynamic dispatch, a string-keyed table, cross-language calls. So **few callers => LOW does not apply** until you know which of the two it is. The tool says so itself: a PDG-mode or degraded result carries `risk: "UNKNOWN"` and empty depth buckets by contract ("never a false-safe zero"); a callgraph result cannot, and answers 0 with a straight face.

In this repo the second case is the NORMAL one for a whole class of symbols, because almost everything is reached by name and not by call. Two measured on 2026-09-16, both answering `impactedCount: 0, risk: "LOW", epistemic: "exact"`:

- `renderAssetsBobView` - the render entry of a live view. `VIEW_REGISTRY` imports the module lazily and names `render`/`runInit` as STRINGS (`js/view-registry.js:136`), so the graph holds no edge into it. A view that also re-renders itself internally (`renderAcademyView`, 3 callers) shows THOSE and still not the registry.
- `handleSettingsShutdown` - a route handler. The ladder in `server.js` passes it as an ARGUMENT (`dispatch(handleSettingsShutdown, req, res)`), which is not a call edge.

The same holds for a module route behind `register(ctx)`, a click handler chosen by `data-act="..."` through one delegated listener, a hub page that is a `{ label, view }` row in `js/core-hubs.mjs`, an env key in `ENV_SCHEMA`, a data source op in `DATA_REPO_OPERATIONS`.

Before calling any of these LOW, do the second lookup the graph cannot: `query({search_query: "<name>"})` or a plain grep for the string (`'foo-view'`, `renderFooView`, `data-act="foo"`). If the string appears in a table, a registry or markup, treat it as a d=1 caller and report the risk from THAT, saying which lookup produced it. "0 callers, safe to delete" is never a conclusion `impact` alone can support here.

## Tools

**impact** — the primary tool for symbol blast radius:

```
impact({
  target: "validateUser",
  direction: "upstream",
  minConfidence: 0.8,
  maxDepth: 3
})

→ d=1 (WILL BREAK):
  - loginHandler (src/auth/login.ts:42) [CALLS, 100%]
  - apiMiddleware (src/api/middleware.ts:15) [CALLS, 100%]

→ d=2 (LIKELY AFFECTED):
  - authRouter (src/routes/auth.ts:22) [CALLS, 95%]
```

**detect_changes** — git-diff based impact analysis:

```
detect_changes({scope: "staged"})

→ Changed: 5 symbols in 3 files
→ Affected: LoginFlow, TokenRefresh, APIMiddlewarePipeline
→ Risk: MEDIUM
```

## Example: "What breaks if I change validateUser?"

```
1. impact({target: "validateUser", direction: "upstream"})
   → d=1: loginHandler, apiMiddleware (WILL BREAK)
   → d=2: authRouter, sessionManager (LIKELY AFFECTED)

2. READ gitnexus://repo/my-app/processes
   → LoginFlow and TokenRefresh touch validateUser

3. Risk: 2 direct callers, 2 processes = MEDIUM
```
