# Prod Bugs

The `prod-bugs` module of Mission Deck: open production bugs and mean fix time per sprint for three product areas (Orders, Other modules, Platform). A page in the "Support" hub.

## Views

| View id | Label |
|---|---|
| `prod-bugs-main` | Prod Bugs |

## Where the data comes from

Files `prod-bugs/prod-bugs-sprint-<n>.json` in the `data-tier-0` source (Team data). `GET /api/m/prod-bugs/overview` returns every shard in one answer; the sprint list comes from a SCAN of the directory, not from the manifest (`manifestSprints` is diagnostics only).

Sprint bounds are read from `prod-bugs/sprint-<n>.json` (`meta.startDate` / `meta.endDate`) when present, otherwise from the Jira board.

## Routes (`/api/m/prod-bugs/`)

| Route | Description |
|---|---|
| `GET /overview` | `{ storage, sprints[], availableSprints[], manifestSprints[], skipped[], python{available}, jira_url, fetchedAt }`; without a clone 200 with `storage: "unavailable"` and empty lists |
| `GET /sprint?sprint=N` | one shard; 400 `bad-n`, 404 `not-found` |
| `GET /widget` | counters of the newest shard plus a short series of totals (dashboard widget), no bug lists |
| `GET /refresh-stream[?force=1]` | SSE: `start`, `log`, `progress`, `done`, `error`; without `force` only the current sprint is recalculated |

Refresh refusals (an `error` event on the same stream, nothing is started), in this order: `test-mode`, `busy`, `no-token`, `data-missing`, `no-python`. A script failure is `etl-failed` with `tail`.

## Configuration

The Jira projects, the label that marks the Orders area, the platform epic and the board used for sprint dates are constants at the top of `scripts/sync_prod_bugs_sprint.py` (`APP_PROJECT`, `ORDERS_LABEL`, `BUG_ISSUE_TYPE`, `PLATFORM_PROJECT`, `PLATFORM_EPIC`, `DEFAULT_BOARD_ID`, `DEFAULT_TEAMS`). They are values compared with Jira: a label or issue type spelled differently silently returns a different set of issues.

## Why Python writes the shards

The encrypted mirror is deterministic in content, so a different serialization of the same shard is a "changed file". `JSON.stringify` cannot produce `0.0` or the `indent=2` layout, so `scripts/sync_prod_bugs_sprint.py` writes `prod-bugs-sprint-<n>.json` itself (tmp + `os.replace`, `ensure_ascii=False`, `indent=2`, trailing `\n`). Node only passes the directories.

## Manifest: one key only

`prod-bugs/manifest.json` may be shared with another pipeline. The script reads it, replaces ONLY `availableProdBugsSprints` (the list from the directory scan, shards written first), keeps the other keys and their order, writes only on a change and without a trailing `\n`. No manifest: one is created holding that key alone.

## ETL cache

`data/modules/prod-bugs/cache/sprint-<n>-<year>.json` (outside the data repository). The first refresh recalculates the history from Jira, later ones take closed sprints from the cache.

## Token

The Jira token reaches the script as ONE JSON line on stdin (`{token, jira_url, verify_ssl}`), never in argv or in the child's environment (`childEnv` is an allowlist).

## Running the script by hand

```
echo '{"token":"...","jira_url":"https://jira.example.com","verify_ssl":true}' | \
  python3 modules/prod-bugs/scripts/sync_prod_bugs_sprint.py 12 \
  --data-dir data-sub-repositories/ds-data/prod-bugs --cache-dir /tmp/prod-bugs-cache
```

## Tests

`tests/test_prod_bugs.mjs` checks the module contract; `test_store.mjs`, `test_refresh_job.mjs`, `test_server_routes.mjs` and `test_etl_python.mjs` cover the server and the ETL (offline, on temp directories and fixtures). Everything runs with `npm test`.
