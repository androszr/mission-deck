# Costs

Team labour costs: hours from Tempo times daily rates, person x month, split into four areas (Atlas, Borealis, Comet, Delta).
The "Costs" page sits in the menu under "Finance".

## What lives where

Everything is in the module's own directory `costs/` of the "Team data" source (`data-tier-0`):

- `costs/config.json` - who is included in costs and which areas they belong to; an optional `projects` array overrides the Jira projects whose worklogs are fetched,
- `costs/team-rates.json` (shape `{ team_rates: [{ name, daily_rate }] }`) - daily rates matched to a person by name; the module changes only `daily_rate` of an existing entry or appends a new one (no entry = no rate, there is no default rate),
- `costs/hours/<YYYY-MM>.json` - aggregated hours author x month, one file per month,
- `costs/hours/index.json` - the list of months, ALWAYS written last.

`last-run.json` (the result of the last fetch) lives in the app cache (`data/modules/costs/`), not in the team data.
The list of people comes from `team/team-members.json` (read only).

Cost is computed at read time: `hours / 8 * daily rate`. Changing a rate recalculates everything without a new fetch.
Amounts are shown in the currency set by `CURRENCY` in `client/costs-lib.js`.

## Fetching from Tempo

"Fetch from Tempo" proposes the previous and the current month; the dialog lets you pick other months. Rules:

- only the months of the selected range are overwritten, the other files stay untouched,
- the range must start on the first day of a month (a month file is written as a whole), at most 12 months,
- the current month is marked as partial ("fetched up to ..."),
- authors that cannot be matched to the team directory end up in "Unassigned" - nothing disappears silently.

The Tempo base URL is `JIRA_URL` (default `https://jira.example.com`); the default Jira projects are `DEFAULT_PROJECTS` in `server/tempo.js`.

## First use

1. fetch the "Team data" source in the Sync window on the top bar,
2. decrypt it (the `data-tier-0` line in `.encryption-key` is needed),
3. only then save rates and fetch hours,
4. send the changes with the normal push of the source.

The module never creates the plaintext directory of the data source - without a populated clone it answers 409 `data-missing` and shows a message.

## Routes (`/api/m/costs/`)

| Route | Description |
|---|---|
| `GET /status` | token, storage, fetched months, running job, last run; no network |
| `GET /data?from=&to=` (or `?year=`) | costs of a day range |
| `GET /epics?from=&to=&area=` | epic > issue > person tree of one area |
| `GET /config`, `POST /config` | roster joined with the configuration; who is in costs, areas, company, end date, external people |
| `POST /rate` | daily rate of one person (`null` clears) |
| `POST /refresh` | starts the Tempo fetch (202), rewrites only the months of the range |

## Boundaries

The only writing file is `server/store.js`, with a path check: only the `costs/` subdirectory is allowed.

## Tests

`node --test modules/costs/tests/*.mjs` (`npm test` finds them on its own). Server code loads at startup - after changing `server/*.js`, restart the server through the API.
