# Usage Analytics

Module `usage-analytics`: Mission Deck traffic from Amplitude - active people, sessions, page views and time,
per module and per user. A page in the Activity hub (`usage-analytics-main`).

## Where the data comes from and where it goes

1. "Refresh" (`GET /api/m/usage-analytics/refresh-stream`) pulls the Amplitude (EU) export day by day with the keys
   `AMPLITUDE_COCKPIT_API_KEY` / `AMPLITUDE_COCKPIT_SECRET_KEY` from the team vault. Only events stamped
   `event_properties.cockpit` with the Mission Deck value are kept; events of other apps sharing the same
   Amplitude project are dropped.
2. The filtered days sit in a local cache `data/modules/usage-analytics/amplitude/<day>.json` (outside any repository).
   Today and yesterday are fetched every time (the export lags a few hours).
3. The cache produces one team file, `usage-analytics/aggregated.json`, in the `data-tier-0` data repository.
   The module never pushes anything - the team gets the file after the usual "Send" in the top bar.

## Counting rules (also written into `aggregated.json` > `meta.rules`)

- Page view = one `View Viewed` event. Technical `Api Request *`, `View Module Loaded`, `Hub Flyout *` are not counted.
- Active day = a day (Central European Time) with at least one page view by that person.
- Session = a distinct `session_id` (not `-1`) of a person with at least one page view.
- Time on screen = `View Exited.duration_ms`, empty and negative values dropped, each capped at 30 minutes
  (`VIEW_DURATION_CAP_MS`), reported as the median.
- The 7 / 30 / 90 day windows end on the last full day; trend = the window of equal length right before it.
- Events without a `user_id` are dropped and counted in `meta.dropped_anonymous`.
- Screen module: exact match on `views[].id` of the installed modules, then the longest `<module id>-` prefix,
  the rest is "Mission Deck Core". The module dictionary is written into the aggregate and merged with the previous one.

## Person identity (`server/identity.js`)

The core derives `person_slug` from the GitLab display name, from `git user.name` or from the OS login, so one person
reaches Amplitude under several ids (`alex-morgan`, `morgan.alex@example.com`, `morgana`...). The aggregate merges them
into one person from the team directory (`team/team-members.json` in `data-tier-0`), in this order:

1. **Aliases** from `usage-analytics/aliases.json` - exact match, always first.
2. **Rule A**: the set of normalized tokens (no diacritics, no mail domain, no `bs`/`fr`/`dt`/`ext` prefixes,
   no digits) equals the person's first and last name, the tokens of the local part of their email, or the pair
   initial + last name; also first and last name joined into one token.
3. **Rule B** (a single login): the start of the last name (at least 4 characters) + a non-empty start of the first name.

No match, or more than one, means a person outside the directory: the raw id stays its own person.
A person row in the aggregate has `user_id` (the directory email or the raw id), `aliases` (every raw id that was
merged into it) and `matched`. Unmatched ids are listed in `meta.unmatched_ids` and shown in the view as
"Not in directory". "Skip me" compares the `person_slug` from `/api/whoami` with `user_id` and with `aliases`.

### `aliases.json`

The file lives in the `data-tier-0` data repository next to the aggregate: `usage-analytics/aliases.json`. Format:

```json
{
  "<raw id>": "<email of a directory member>",
  "jlee": "lee.jordan@example.com"
}
```

- Key = the raw Amplitude id (case-insensitive), value = the `email` of a person in `team/team-members.json`.
  A value outside the directory still merges the ids, but the person has no directory name.
- The module **never writes** this file - a person edits it and sends it with "Send" in the top bar.
- How to use it: after "Refresh" check `meta.unmatched_ids` (or the "Ids outside the team directory" list under the
  Users table), add every id that belongs to someone on the team and click "Refresh" again - merging happens when
  the aggregate is computed, not when it is displayed.

## App version

- A person's version = `event_properties.app_hash` from their newest event in the window (`app_hash_last`, an
  8-character short form in `app_hash_short`).
- The team's newest version = the hash that appeared in the data last (`latest_app_hash`,
  `latest_app_hash_short`, `latest_app_hash_first_seen`).
- `app_outdated` is `true` when the person's hash differs from the newest one, and only once the newest hash has been
  in the data for at least a day - a freshly released build does not immediately mark everyone as "Older version".
- `app_version_last` / `app_version_outdated` (semver from `app_version`) stay in the aggregate for compatibility;
  the view does not use them.

## Routes

| Route | Description |
|---|---|
| `GET /status` | `storage`, `keysPresent`, `testMode`, `busy`, `aggregate`, `cache` |
| `GET /data` | `{ ok: true, aggregate }` or `{ ok: false, error: 'no-data' \| 'storage-unavailable', message }` |
| `GET /widget` | read-only, for the dashboard tile: `{ ok: true, generated_at, last_full_day, kpi, daily[14], topModules[5], modulesTotal, modulesInUse }` or the same refusals as `/data`; no per-person data |
| `GET /refresh-stream` | SSE: `start`, `progress`, `log`, `done`, `error` |

## Dashboard widget

The "Mission Deck traffic" tile (`usage-traffic`, variants `s`, `m`, `s2`, `m2`, `l`, `xl`, default `m2`) is drawn by
`client/widget.js` from `GET /widget`: KPIs of the 7-day window (active people, sessions, page views with the change
against the previous window), page views and active people over 14 days, the five most used modules and a
modules-in-use gauge. The route never names anyone - only `/data` does. Against an older server (404) the tile asks
for a restart and does not fall back to `/data`.

## Tests

`tests/test_usage_analytics.mjs` (contract), `test_aggregate.mjs` (aggregation over `fixtures/events-sample.json`),
`test_amplitude.mjs` (filter, `planDays`), `test_identity.mjs` (identity merging), `test_routes.mjs` (refusals,
empty-repository states and `/widget` without personal data), `test_usage_analytics_widget.mjs` (manifest, blocks,
empty states). No test talks to Amplitude.

Full module contract: `modules-template/README.md`.
