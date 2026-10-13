# Time Log

A person x day heatmap: who on the team logged working time in Tempo over
the last 14 days, with the Jira issues under each cell and a ready Teams
message draft for people with gaps. It replaces checking by hand in Jira -
without costs, rates or employer details next to a person, which this view
does not need.

## Views

The module has no rail item of its own: it adds a **page** to the core
**Team** hub (`sidebar.kind: "page"`, `sidebar.hub: "team"`).

| View id | Flyout label |
|---|---|
| `time-log-main` | Time Log |

## Where the data comes from

`GET /api/m/time-log/refresh-stream` (SSE, started with the "Fetch from
Jira" button) calls Tempo v3
(`GET <JIRA_URL>/rest/tempo-timesheets/3/worklogs`) for each configured
project, one at a time, and matches the author of every worklog to the
team directory (`team/team-members.json`) - by e-mail first, then by the
tokens of the first and last name. Worklogs of authors outside the
directory are NOT an error - they land in the `unmatched_authors` counter.
The heatmap shows people from the six teams (the `TEAMS` constant: Atlas,
Borealis, Comet, Delta, Echo, Falcon) plus anyone whose mailbox is listed
under `trackedEmails` in the local config (see below), whatever their team.
The window is 14 calendar days ending YESTERDAY - today would show false
gaps for everybody, so it is left out. Public holidays follow the Polish
calendar (`server/calendar.js`).

`JIRA_URL` comes from `.env`; without it the module uses the placeholder
`https://jira.example.com`.

## Dependency on the Time Off module

The time-off layer of the heatmap is OPTIONAL and comes from another
module: the view calls `GET /api/m/time-off/data` and reads the `entries`
list from the answer. When the `time-off` module is not installed or is
disabled, the route answers 404 - the view then works as usual, only a day
off looks like a missing log, and the legend says so in one sentence.
Nothing on the server side of this module depends on `time-off`.

## Where the data lives

`ctx.dataTier0Dir/time-log/` (that is `data-sub-repositories/ds-data/time-log/`
on this computer):

- `index.json` - metadata (date window, per-person summary).
- `people/<slug>.json` - one file per person, with the full day-by-day breakdown.

The module runs no `git` - this is the plain team data tree, synchronised
only through the "Sync" window on the top bar, like the data of every
other module in `dataRepos`. After a fetch from Jira the sync bar under
the view title shows "you have local changes" - the signal to send the
data to the team by hand.

## Local configuration

Default Jira projects: `APP, WEB, OPS` (examples). Override them - and add
people tracked regardless of team - in
`data/modules/time-log/config.json` (outside `ds-data`, so the setting is
local to this computer, not to the team):

```json
{
  "projects": ["APP", "WEB"],
  "trackedEmails": ["casey.novak@example.com"]
}
```

No file or a bad shape (e.g. a project key not matching
`/^[A-Z][A-Z0-9]{1,9}$/`, an invalid e-mail) - the module falls back to the
defaults and never stops working.

## Without a Jira token

`JIRA_TOKEN` comes from the Bitwarden vault (a key declared in the
manifest's `envKeys`). Without an open vault `GET /api/m/time-log/status`
answers `token: false`, and a fetch attempt ends with the SSE event
`error { error: "no-token" }` with a hint to unlock the vault on the top
bar - never a silent skip.

## Tests

- `tests/test_time_log.mjs` - the manifest contract (hub `team`,
  `dataRepos`, `envKeys` with `JIRA_TOKEN`), the three routes of
  `register(ctx)`, the `TEAMS` constant matching between
  `client/time-log-lib.js` and `server/build.js`, `ROLE_CODES` matching
  `ROLE_CODE_RE` in `js/team-directory.js`.
- `tests/test_time_log_calendar.mjs` - Easter, public holidays, the 14-day window.
- `tests/test_time_log_match.mjs` - matching by e-mail and by name tokens,
  slug collisions.
- `tests/test_time_log_build.mjs` - worklog aggregation, the six-team
  filter, tracked e-mails, shard order, `unmatched_authors`.
- `tests/test_time_log_lib.mjs` - pure view functions (cell colours,
  filtering, the percentage badge, the Teams draft).
- `tests/test_time_log_routes.mjs` - `createRoutes(ctx, { http, now })`
  with an injected `http` and a temporary `dataTier0Dir` - no test ever
  touches the network or the real `ds-data`.

## Dashboard widget

`module.json` > `widgets[]` declares the "Days without a time entry" tile
(`days-without-entry`, `client/widget.js`, variants s, m, l, s2, m2, xl;
default m2). It reads `GET /data`. `miss_days_count` skips weekends and
holidays but NOT time off, so the tile never ranks people and never says
"gaps": it shows the number of people with days without an entry (noting
"time off is not subtracted"), avatars in no count order and without
numbers, a bar of days with and without an entry for the whole team, and a
heatmap per team (share of people with an entry, oldest day first), never
per person. No data directory (e.g. after "End of day") points to the Sync
window, no export yet - to the Time Log page. Test:
`tests/test_time_log_widget.mjs`.

## Publishing

To reach the team: the module card in Settings > Modules > Publish
(`POST /api/modules/publish`) - it creates a branch and a merge request in
the module catalog repository; its `main` is protected, so nothing lands
there without a human review.
