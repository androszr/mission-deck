# Rollout waves

Mission Deck module `rollout-waves`. A rollout (a new process, a new device,
a new system) planned in weekly **waves** across the locations directory:
each location is assigned to a wave through its manager, and the page tracks
training and webinar progress per wave. The "Rollout waves" page sits in the
core "Initiatives" hub (`sidebar.kind: "page"`, `sidebar.hub: "initiatives"`).

## Views

| View id | Label |
|---|---|
| `rollout-waves-main` | Rollout waves |

## Where the data comes from

- **Locations** - read only, from the `locations` module's light index
  `locations/locations.index.json` (code, status, city, region, area,
  district, operator, manager, partner - no phone, no e-mail). This module
  never opens the full `locations.json` and never writes `locations/`; the
  manifest declares it as an `access: "read"` view. Without the index the
  page explains that the directory is missing.
- **Wave configuration** - `rollout-waves/waves-config.json`, edited by the
  rollout owner by hand and sent with the sync panel:

  ```json
  { "first_wave_start": "2026-10-13", "waves_count": 12,
    "managers": { "Alex Morgan": 1, "Sam Rivera": 2, "Vacant 3": 2 } }
  ```

  A flat `{ "manager": wave }` map is accepted too (first wave and wave count
  then take their defaults). A missing or unparsable file means defaults and
  an empty manager map.
- **Confirmations** - `rollout-waves/training-done/` and
  `rollout-waves/webinar-done/`, one shard format (`server/shard-store.js`):
  `index.json` next to `<PREFIX>.json`, where `PREFIX` is the first three
  characters of the location code (uppercase) or `other` for shorter codes.
  A shard is `{ stores: { "<code>": { imported_at, source } } }`. Imports are
  MERGE-ONLY: they never remove an earlier entry, and only the shards whose
  codes the import touched are rewritten.

## Who is in the plan

- Status `Open` (case-insensitive) is always in.
- `Contract signed`, `Handover` and `Temporarily closed` count only when the
  row names an operator.
- Everything else is out.

A location's wave comes from its manager in `waves-config.json`. A blank
manager cell reads as `Vacant <area>` (every manager owns one area); a
vacancy the config does not name still counts in the totals with no wave
(`no_wave` in the KPI, "of which no wave" on the tile), and the diagnostics
callout lists the keys to add. Managers outside the configuration are
counted and listed, never silently dropped.

Wave dates are derived from the first wave start: wave `n` starts
`first + (n-1) * 7` days; location training runs from start-20 to start-11
days, the webinar is at start-14, staff training at start-22..21.

## Filters

The filter bar combines the wave segments, district/manager/partner selects
and ONE search field covering code, city, operator, manager, partner and
district (`buildHaystack` in `client/rollout-lib.js`, computed once per
payload, folded for case and diacritics; every word must match).

## Import - request body

`POST /import-training` and `POST /import-webinar` take an `.xlsx` with
location codes in column A (header in row 1) as a JSON body, because the host
answers 415 to a non-JSON body on every non-GET route:

```json
{ "name": "<file name>.xlsx", "file_base64": "<base64 file content>" }
```

The visible limit is 10 MB of file; the body cap is higher (15 MB) to allow
for base64. Error codes the client recognises: `repo-missing` (409), `busy`
(409), `directory-missing` (409), `bad-file-name` (400), `bad-xlsx` (400),
`empty-file` (400), `zip-unavailable` (500), `import-failed` (500),
`too-large` (413).

## Dashboard widgets

Two tiles (`client/widget.js`), both on
`GET /api/m/rollout-waves/dashboard?lean=1` through one shared request:

- **Rollout progress** (`rollout-progress`) - a 10x10 waffle (live / in
  waves / no wave), the live / to go live / no wave tiles, training and
  webinar bars and the next wave start.
- **Next waves** (`rollout-next-waves`) - up to five upcoming waves (start
  and webinar, chronological, past webinars dropped) with training and
  webinar progress per wave.

Without data the tiles say so; they never show a bare zero.

## Tests

`node --test catalog/modules/rollout-waves/tests/test_*.mjs`:
`test_rollout_waves.mjs` (manifest, routes, no disk access at register, the
locations index reader, imports), `test_rollout_core.mjs` (wave dates,
statuses, config, plan membership, dashboard, merge), `test_shard_store.mjs`,
`test_xlsx_lite.mjs`, `test_rollout_lib.mjs` (client helpers) and
`test_rollout_waves_widget.mjs`.
