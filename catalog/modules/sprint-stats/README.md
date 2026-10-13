# Sprint Stats

The `sprint-stats` module of Mission Deck: the `#sprint-stats-main` page (side menu, "Activity" hub)
with sprint tabs ("Active", "Active - 1", "A-2"...), a dates-and-goals card, five tiles per team
(committed, done, in progress, spillover, completion), a team table with an expandable issue list,
the sprint trend and burndown charts, and a "Per person" window (story points for the main board
teams, man-days for the platform team).

Two Jira boards feed it:

- **main** - a scrum board shared by several teams (Atlas, Borealis, Comet), unit SP; sprints named
  `<Team> Sprint <N>`,
- **platform** - a single-team board (Delta), unit MD (man-days); sprints named `PL_<N>` or
  `Delta Sprint <N>`.

Board ids, project keys, team names and custom fields are constants at the top of
`scripts/sprint_stats_main.py` and `scripts/sprint_stats_platform.py` - adjust them to your Jira.

## Views

| View id | Label |
|---|---|
| `sprint-stats-main` | Sprint Stats |

## Data layer

The data lives in the "Team data" source (`data-tier-0`), in the module's own `sprint-stats/`
directory: one `index.json` (board metadata and the sprint list without `persons`/`issues`/
`burndown` - the first screen paints from the index alone) plus one shard
`sprint-<src>-<n>.json` per (board, sprint number) with the full `persons`/`issues`/`burndown`.
Both boards are normalized to ONE team-sprint shape (`{ src, team, unit, sprint_n, sprint_id,
sprint_name, state, phase, start, end, goal, summary, persons, issues, burndown, extra }`), so the
view has one rendering path. Spillover after the sprint ends (`wip + todo` added to `dropped` for
the SP unit in the END phase) is computed at RENDER time (`effectiveDropped` in
`client/sprint-model.mjs`), because the phase changes over time.

Writes (`server/store.js`) are tmp+rename per file, shards before the index (the index never
points at a missing shard), under one `ctx.makeLock()` chain lock - no `.lock` file on disk.

## Refreshing from Jira

`GET /refresh-stream` (SSE) runs two Python scripts in sequence - `scripts/sprint_stats_main.py`,
then `scripts/sprint_stats_platform.py` - both standard library only (`urllib.request`, no
`dotenv`, no writes to the data repository, no `.lock` file). Without `?force=1` only the active
sprints of each board are fetched (the list comes from `GET /discover`, cached 60 s); `force=1` is
a full fetch of both boards. When the default scope cannot tell which sprints are active (a
`GET /discover` failure inside the run), the stream answers `error` `discover-failed` and spawns
NEITHER ETL script - an empty active-sprint list would otherwise read as "no selection" and
silently turn "Refresh active sprints" into a full, twenty-minute run.

The Jira token (`JIRA_TOKEN`, personal, falling back to `JIRA_TECH_TOKEN`, technical) never
reaches the process arguments or its environment. One JSON line
(`{"token","jira_url","verify_ssl"}`) goes to the child's `stdin` and is read once at start
(`scripts/_common.py: load_handoff()`); the child environment (`childEnv`) is an allowlist.

Refusal order (before anything is spawned): `test-mode` -> `busy` -> `no-token` ->
`data-missing` (no team data clone) -> `no-python`. `discover-failed` is a separate early return
inside the run itself, and only applies to the default scope (without `force=1`).

## Routes (`/api/m/sprint-stats/`)

| Route | Description |
|---|---|
| `GET /overview` | `index.json` (trimmed) + `storage` (`ok`/`unavailable`), `python.available`, `jira_url`. Always 200, even without a clone. |
| `GET /sprint?main=N&platform=M` | At least one parameter; returns `{ main, platform }` - full shards or `null` (a missing shard is a normal state, not a 404). A bad number -> 400 `bad-n`. |
| `GET /discover` | Active sprints on both Jira boards, cached 60 s. Without a token / in test mode / after a failure -> `{ available: false, reason }`, always 200. |
| `GET /refresh-stream[?force=1]` | SSE: runs the main ETL, then the platform ETL. Events `start`, `progress`, `log`, `done`, `error`. |
| `GET /spillover` | `{ storage, aggregate, file: { present, current } }` - aggregate computed on request from `index.json`; `current` says whether `spillover.json` on disk equals it. Always 200. |
| `POST /spillover/recompute` | Recomputes and writes `spillover.json` only when its content changed. 409 `storage-unavailable` / `no-index`, 200 `{ written, present }`. |

## Spillover

The "Spillover" tab (`#sprint-stats-main/spillover`, the "Sprints | Spillover" switch above the
tabs) shows how much work planned for a sprint was not delivered in it. It is computed by the pure
function `server/spillover.js` (`buildSpilloverAggregate`) from `index.json` alone. Rules:

- A sprint is closed when no team has state `active`. Main board only.
- Spillover = `dropped + wip + todo`; spillover % = spillover / committed, completion = done /
  committed, both to one decimal (0 when nothing was committed).
- Teams are discovered from the data (order from `boards.main.teams`), only those with at least one
  closed sprint. The average spillover % is the mean of the rounded sprint percentages; the worst
  sprint is the highest % (the first one on a tie).

The result is also exported to `sprint-stats/spillover.json` so other tools can read it.
`generated_at` comes from `boards.main.generated_at`, so the file is byte-stable and is written
(tmp + rename) only when its content changes - after every successful main ETL run.

## Environment variables (`envKeys` in `module.json`)

| Key | Description |
|---|---|
| `JIRA_TOKEN` | Personal Jira token - preferred over the technical one. |
| `JIRA_TECH_TOKEN` | Technical Jira token - the fallback when the personal one is empty. |
| `JIRA_URL` | Jira base URL (default `https://jira.example.com`). |

## Tests

`tests/test_sprint_stats.mjs` checks the module contract and the manifest shape,
`tests/test_normalize.mjs` the team-sprint helpers, `tests/test_spillover.mjs` the pure spillover
aggregation, `tests/test_sprint_model.mjs` and `tests/test_sprint_charts.mjs` the pure client
layer, `tests/test_refresh_job.mjs` the closed ETL argument list, token selection and handoff and
the refusal order, `tests/test_server_routes.mjs` every route on a temp directory
(`DATA_SUB_REPOS_DIR` substituted) - never on a developer's real clone. All of them run with
`npm test`.
