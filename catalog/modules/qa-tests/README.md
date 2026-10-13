# QA Tests

Module `qa-tests` - test automation coverage read from Jira.

Shows automation coverage of test cases per product area (Orders, Checkout, Warehouse and
its sub-areas), test case statuses, regression runs from the last 7 days, the time saved by
automation, and the list of bugs found by automated tests.

Data: sharded in `jira/qa-automation/` (`index.json` plus one `module-*.json` per area)
in the team data repository (`data-tier-0`). Keep the shard layout stable - other readers
may depend on it.

## Jira setup

The ETL script (`scripts/qa_automation.py`) expects:

- saved Jira filters named as in `FILTERS` (for example `QA All test cases`,
  `QA Test cases - Orders`); rename them in the script to match your instance;
- test runs in the project from `QA_JIRA_PROJECT` (default `QA`) whose summary reads
  `[AUTO] - Daily regression - <area> - DD.MM.YYYY`;
- three numeric custom fields (manual effort, automated run time, time saved, in minutes)
  whose ids are set in `FIELD_MANUAL_EFFORT`, `FIELD_AUTO_EXEC`, `FIELD_SAVINGS`.

## Views

| View id         | Label     | Hub      |
|-----------------|-----------|----------|
| `qa-tests-main` | QA Tests  | activity |

## Refreshing the data

1. Click "Refresh" in the page header - a modal with a progress bar opens.
2. The button calls `GET /api/m/qa-tests/refresh-stream` (SSE).
3. `scripts/qa_automation.py` fetches the data from Jira and writes the shards.
4. The Jira token reaches the script through stdin (never argv, never env).

## Environment keys

| Key               | Description                                        |
|-------------------|----------------------------------------------------|
| `JIRA_TOKEN`      | Personal Jira token (preferred)                    |
| `JIRA_TECH_TOKEN` | Technical Jira token (fallback)                    |
| `JIRA_URL`        | Jira base URL (default `https://jira.example.com`) |
| `QA_JIRA_PROJECT` | Project key of test cases and runs (default `QA`)  |

## Tests

```
node --test catalog/modules/qa-tests/tests/
```

Or together with the whole suite: `npm test`.

## Language rule

ASCII code (identifiers, paths, keys, comments), and plain English for everything a
person reads. Full module contract: `modules-template/README.md`.
