# DEVOPS Stats

Flow metrics of the DevOps team from Jira (the `DEVOPS` project): work in progress, throughput,
lead and cycle time (median, 85th percentile), epic cycle time, ageing issues and blocked work -
weekly or monthly. The page sits in the Activity hub next to Sprint Stats (view `devops-stats-main`).

## What the page shows

- A row of tiles: In progress now, Delivered per week (or month), Lead time - median,
  Cycle time - median, Blocked now, Closed without work.
- A "Weeks / Months" switch (the last 12 weeks or 6 months; ISO week from Monday, in the
  browser's local time). Switching sends no request.
- Charts: Work in progress, Delivered, Lead time, Cycle time (median and 85th percentile).
  The current, incomplete period is drawn with a dashed line or a hollow bar.
- Tables: Epics, Longest in progress (the 15 oldest), Closed without work, Cancelled after work
  started, Blocked. The issue key links to Jira.
- "Refresh" in the top right opens a window with the fetch progress. "Refresh changes" fetches
  only issues changed since the last time, "Fetch everything again" reads every open issue and
  every issue changed (closed ones included) in the last 365 days - also ones created earlier,
  so long-running issues do not drop out of the lead time.

## Metric definitions

Only issues that are neither epics nor sub-tasks count. Status categories
(`new` / `indeterminate` / `done`) come from Jira, never from status names.

- **Done** - the last entry into a `done` category status, only while the issue is still in it
  (a reopened issue is not done). **Start** - the first entry into an `indeterminate` category status.
- **In progress (WIP)** - issues whose status at a given moment has the `indeterminate` category;
  on the chart: the state at the end of the period (for the current one - now).
- **Cancelled** - issues finished in a done status marked as a cancellation ("Set statuses";
  until the team saves anything, a proposal from the status names applies, e.g. "Cancelled").
  It is a normal end of an issue, neither a delivery nor housekeeping - cancelled issues enter no
  flow metric (throughput, lead and cycle time, blocked share, closed without work).
- **Cancelled after work started** - cancelled issues that entered an "in progress" status or have
  logged time. A separate table (no tile in the top row) with a summary above it: the total time
  logged in Jira (`aggregatetimespent`, i.e. with sub-tasks; `timespent` as a fallback) - how much work
  issues that were planned and then cancelled cost. Exact seconds are summed and shown as in Jira
  ("45 min", "3 h 30 min"). Data stored before this field existed has no time: the summary shows
  "-" until a full refresh.
- **Closed without work** - issues finished (not cancelled) without any start (they never entered an
  "in progress" status): backlog housekeeping, outdated plans, duplicates. They have their own tile
  and table and do NOT enter throughput or lead and cycle time - otherwise one bulk closure of old
  tickets looks like a jump in lead time.
- **Throughput** - the number of issues finished in the period after work in progress.
- **Lead time** = done - created. **Cycle time** = done - start.
  Both only for issues that had a start. Values in calendar days.
- **Median** is the classic one; **85th percentile** uses the nearest-rank method
  (`sorted[ceil(0.85 * n) - 1]`). No data = "-".
- **Epic** - time from the earliest start (of the epic or one of its issues) to done, and when
  nothing started - from creation; the second column counts from creation. An open epic is counted
  to now; progress = done issues / all issues of the epic.
- **Blocked** - only the time in the statuses selected in "Set statuses". Jira's "Flagged" field is
  NOT counted (a team decision): flags outlive the problem - an issue flagged long ago and moved back
  to the backlog would stay blocked for hundreds of days. Records on disk still carry `flagged`; the
  view ignores it. Until statuses are saved, the page shows a notice and no issue counts as blocked;
  the proposal from status names is only pre-checked in the window, never applied silently.

## The "People" tab

Only the team named by `TEAM` in `client/index.js` (the example is **Falcon**) from the team directory
(`team/team-members.json` in the team data, read through the core `/js/team-directory.js`). The picker
offers the whole team or one person. Jira display names (for example "AC Lee Jordan") are matched with
`memberByName` from the directory; the "[X]" suffix of a deactivated Jira account is stripped first.

- **Tiles - current week:** in progress now, delivered this week, median lead and cycle time,
  time logged this week.
- **Comparison:** a table with the same numbers for each of 12 weeks or 6 months
  ("Weeks / Months" switch), newest period on top.

Issues count for the CURRENT assignee in Jira. Logged time is the worklog entries (`worklog`)
authored by that person, attributed to the period of the day the work started - on any issue of the
project, epics and sub-tasks included. Cancelled issues and issues closed without work are not shown
on this tab (and are not delivered either). Jira search returns at most 20 worklog entries per issue;
for a longer list the fetch reads the whole list separately.

## Data (`jira/devops/` in the team data source, `data-tier-0`)

| File | Content |
|---|---|
| `index.json` | refresh metadata, Jira fields, the status table (`id`, `name`, `category`), the shard list |
| `issues-YYYY-MM.json` | issues created in that month (records with status and flag intervals) |
| `config.json` | `blocked_status_ids` and `cancelled_status_ids` - written only by "Set statuses"; no `cancelled_status_ids` = the proposal from done status names applies |

Changing the blocked statuses needs no new fetch from Jira - the metrics are computed in the browser.

## Routes (`/api/m/devops-stats/`)

| Route | Description |
|---|---|
| `GET /overview` | `{ storage, index, config, jira_url }`, always 200 |
| `GET /issues` | `{ issues }`, always 200 |
| `POST /config` | saves the blocked statuses (409 `storage-unavailable`, 400 `bad-status`, 400 `bad-body`) |
| `GET /refresh-stream[?full=1]` | SSE: `start`, `progress`, `log`, `done`, `error` |

Refresh refusals (a single `error` event before anything runs), in order:
`test-mode`, `busy`, `no-token`, `data-missing`. Errors during the run: `etl-failed`, `etl-invalid`,
`etl-empty`.

## Token

`JIRA_TOKEN` (or, second, `JIRA_TECH_TOKEN`) and the optional `JIRA_URL` (default
`https://jira.example.com`) come from the vault. The token reaches the fetching process as one line
on stdin - never in arguments or environment variables.

## Publishing

Settings > Modules > Publish (branch `module/devops-stats-<date>` and a merge request). The data in
`jira/devops/` reaches the team through the Sync window.

## Tests

`node --test modules/devops-stats/tests/test_*.mjs`
