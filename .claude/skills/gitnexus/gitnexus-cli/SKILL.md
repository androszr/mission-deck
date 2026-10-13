---
name: gitnexus-cli
description: "Use when the user needs to run GitNexus CLI commands like analyze/index a repo, check status, clean the index, generate a wiki, or list indexed repos. Examples: \"Index this repo\", \"Reanalyze the codebase\", \"Generate a wiki\""
---

# GitNexus CLI Commands

**`analyze` in this repo is `node scripts/bootstrap-gitnexus.js`, never the bare runner.** Two reasons, and the second one is the quiet one:

1. `.gitnexus/` is gitignored, so a machine that has never indexed this repo has no `run.cjs` at all and `node .gitnexus/run.cjs analyze` fails with `MODULE_NOT_FOUND`. That is a first index to build, not a stale one to refresh — and there is no third command to reach for, because the bootstrapper covers both. It also installs the pinned CLI (`CLI_VERSION` in `scripts/_gitnexus-analyze.js`) when it is missing.
2. It runs the analyzer with `ANALYZE_ENV` from `scripts/_gitnexus-analyze.js` — the same `GITNEXUS_MAX_FILE_SIZE` / `GITNEXUS_WORKER_SUB_BATCH_TIMEOUT_MS` that `.mcp.json` gives the MCP server. Without them `server.js` (~2.9 MB, past the analyzer's 512 KB default cap) is dropped from the graph: `analyze` still reports success, and every `impact` or `context` call on a server symbol answers "not found". A bare `npx gitnexus analyze` or `node .gitnexus/run.cjs analyze` produces exactly that — a green result over a half-empty graph — which is why neither is the answer here even once `run.cjs` exists.

The **other** commands below (`status`, `clean`, `wiki`, `list`) read or delete an index that already exists, take no analyze env, and are correctly invoked through the project-local runner `analyze` drops next to the index. It auto-selects an available runner at call time (global `gitnexus`, else `pnpm dlx`, else `npx`), so no package-manager assumption and no global install is required. Absent `run.cjs` means the repo was never indexed — run the bootstrapper first.

> **npm 11.x note.** If any path here falls back to `npx` and it crashes during install (`node.target is null`), install once with `npm i -g gitnexus`. See [#1939](https://github.com/abhigyanpatwari/GitNexus/issues/1939). The bootstrapper already does this for you.

## Commands

### analyze — Build or refresh the index

```bash
node scripts/bootstrap-gitnexus.js
```

Run from the project root. Works whether or not this machine has indexed the repo before; see the two reasons above for why the bare runner is not used here. The flags below are the analyzer's own — reach for them with `node .gitnexus/run.cjs analyze <flag>` only when you need one, and accept that such a run carries no analyze env. This parses all source files, builds the knowledge graph, writes it to `.gitnexus/`, and generates CLAUDE.md / AGENTS.md context files.

| Flag           | Effect                                                           |
| -------------- | ---------------------------------------------------------------- |
| `--force`      | Force full re-index even if up to date                           |
| `--embeddings` | Enable embedding generation for semantic search (off by default) |
| `--drop-embeddings` | Drop existing embeddings on rebuild. By default, an `analyze` without `--embeddings` preserves them. |
| `--pdg` | Build the program-dependence layers used by `explain` and `pdg_query` (taint, CDG, and REACHING_DEF). |

**When to run:** First time in a project, after major code changes, or when `gitnexus://repo/{name}/context` reports the index is stale. In Claude Code, a PostToolUse hook detects staleness after `git commit` and `git merge` and notifies the agent to run `analyze` — the hook does not run analyze itself, to avoid blocking the agent for up to 120s and risking KuzuDB corruption on timeout.

### status — Check index freshness

```bash
node .gitnexus/run.cjs status
```

Shows whether the current repo has a GitNexus index, when it was last updated, and symbol/relationship counts. Use this to check if re-indexing is needed.

### clean — Delete the index

```bash
node .gitnexus/run.cjs clean
```

Deletes the `.gitnexus/` directory and unregisters the repo from the global registry. Use before re-indexing if the index is corrupt or after removing GitNexus from a project.

| Flag      | Effect                                            |
| --------- | ------------------------------------------------- |
| `--force` | Skip confirmation prompt                          |
| `--all`   | Clean all indexed repos, not just the current one |

### wiki — Generate documentation from the graph

```bash
node .gitnexus/run.cjs wiki
```

Generates repository documentation from the knowledge graph using an LLM. Requires an API key (saved to `~/.gitnexus/config.json` on first use).

| Flag                | Effect                                    |
| ------------------- | ----------------------------------------- |
| `--force`           | Force full regeneration                   |
| `--model <model>`   | LLM model (default: minimax/minimax-m2.5) |
| `--base-url <url>`  | LLM API base URL                          |
| `--api-key <key>`   | LLM API key                               |
| `--concurrency <n>` | Parallel LLM calls (default: 3)           |
| `--gist`            | Publish wiki as a public GitHub Gist      |

### list — Show all indexed repos

```bash
node .gitnexus/run.cjs list
```

Lists all repositories registered in `~/.gitnexus/registry.json`. The MCP `list_repos` tool provides the same information.

## After Indexing

1. **Read `gitnexus://repo/mission-deck/context`** to verify the index loaded - by NAME, because this server holds several repositories (`list_repos`): this repo, other projects and every `modules/<id>/` indexed on its own. Every MCP call afterwards takes `repo: "mission-deck"` for the same reason.
2. Use the other GitNexus skills (`exploring`, `debugging`, `impact-analysis`, `refactoring`) for your task

## Troubleshooting

- **"Not inside a git repository"**: Run from a directory inside a git repo
- **Index is stale after re-analyzing**: Restart Claude Code to reload the MCP server
- **Embeddings slow**: Omit `--embeddings` (it's off by default) or set `OPENAI_API_KEY` for faster API-based embedding
