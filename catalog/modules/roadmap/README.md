# Roadmap

The `roadmap` module: a table of Discovery initiatives with Jira sync, a timeline and a Kanban board.
Stage 1 is read-only; stage 2 adds the Jira sync; stage 3 adds in-place editing (RAG, stages, dates,
people), manual row order and a sync progress window.

## Views

| View id | Label |
|---|---|
| `roadmap-main` | Roadmap |

The view has `ds-tabs` at the top (**Table**, **Timeline**, **Kanban**); the active tab lives in the address:
`#roadmap-main` (Table), `#roadmap-main/timeline`, `#roadmap-main/kanban`. An unknown tail is the Table.
Tabs render lazily (on first entry); the pure tab helpers are in `client/helpers.js` (`tabFromSubPath`,
`tabHash`). The "Sync with Jira" button in the header is visible on every tab (the synced data feeds all of
them); after a sync the active tab repaints.

The **Table** tab shows a filter bar (search by name and epic key, a person filter, a counter) and an
11-column table. There is no details panel: the title is plain text.

## Timeline tab

`client/roadmap.js`, with the pure timeline functions in `client/roadmap-helpers.js`. Read-only, from the same
data as the table (`GET /initiatives`; no extra routes). A year picker, a Quarters / Months switch, four cards
(total / in discovery / in delivery / finished - classified by today's date), a legend and the timeline:
one row per initiative (name, PO / analyst / designer / architect avatars), a discovery bar (from the earliest
logged day, without logs from `discoveryEnd`, to `discoveryEnd`) and a delivery bar (to `deliveryEnd`), a
vertical "Today" line, a bar tooltip (dates, stages, number of people with logged time); initiatives without
dates or outside the year say "no dates or outside the year". Clicking a row shows that initiative on the Table tab.

Collapsible quarters (click a quarter header; a collapsed quarter has weight 0.12 and every position comes from
one function, `dayToPct`), a month row under the quarters, a sticky first column, a Go-Live milestone (a diamond
on `goLiveDate`), a RAG dot by the name, a "Today" pill in the header with a line through the full height, and a
legend for every mark.

## Data source

- The team data repository (`data-tier-0`), path `discovery-tasks/` (files `dt-<hash>.json`, one per initiative).
  This module owns these files.
- The module server (`GET /api/m/roadmap/initiatives`, `GET /api/m/roadmap/status`) reads them, fills missing fields
  with defaults and sorts by `rank`. Writes: the Jira sync (stage 2) and the table edits and order (stage 3), all
  through one function, `writeInitiativeFile`, under one lock.
- No team data downloaded: 409 `storage-unavailable`, and the view shows a hint.
- Corrupt files go to the `skipped` field of the answer and do not break the rest of the list.
- `discovery-tasks-tempo.json` is optional and read-only (a pre-fetched Tempo export). Time logged on the current
  days comes from `GET /worklogs` (the time-log module).

## Stage 2: Jira sync

- `POST /jira-sync` `{ id }` syncs one initiative, `POST /jira-sync-all` syncs every initiative with an epic key in
  turn (one run at a time, otherwise 409 `busy`), `GET /jira/epic-children?key=PROD-123` only reads (issues under an
  epic: `Parent Link`, `Epic Link`, `parent` and `linkedIssues`).
- The sync reads Jira (`server/jira.js`): the DISC tasks under the epic, worklogs, the epic fields (change type,
  work type, applies to) and delivery epics from "is triggering" links. The sync only reads; Jira writes happen only
  on the Kanban tab (new task, card status change) and through `POST /jira/transition`.
- A sync writes only four fields of `discovery-tasks/dt-<id>.json` (`jiraTasks`, `jiraUnmatched`, `epicFields`,
  `deliveryEpics`); every other field and the key order stay, in a stable byte format
  (`JSON.stringify(obj, null, 2) + '\n'`, written through a temp file and `rename`), so files nobody edited do not
  change by a byte. Manually added delivery epics stay and are refreshed from Jira. When Jira does not answer for
  the epic fields or links, the stored values stay (they are not zeroed).
- Token: see "Jira token policy" below; read on every call. No token is 503 `no-token`, a Jira refusal is
  503 `token-unauthorized`, no network is 502 `jira-unreachable`. In test mode the routes answer 409 `test-mode`.

## Activity strip (who worked on what)

Above the table: a role filter (`ds-segmented`: All / PO / Analyst / Designer / Architect) and a strip of 12 day
cards - the 10 previous working days, "Today" and "Tomorrow" (the next working day; public holidays are skipped).
A card shows the people's avatars (team directory, initials without a photo); clicking an avatar opens a popover
with that person's tasks on that day.

- Past days: who LOGGED time on anything on the roadmap - every `timeByPersonByDay` of the initiative files (epic,
  `jiraTasks`, `jiraUnmatched`, delivery epics and their sub-tasks) plus the Tempo worklogs for roadmap keys (no
  double counting), but only people assigned as PO / Designer / Analyst / Architect on at least one initiative. The
  role filter narrows to people with that role. The popover shows the initiative, the task and the hours.
- Today and tomorrow: people with tasks in progress (`indeterminate`) in the filtered role.
- `GET /api/m/roadmap/tempo` reads `discovery-tasks-tempo.json` (read-only); a missing or corrupt file is 200 with an
  empty structure, no team data is 409 `storage-unavailable`.
- For a past day, the person popover has a separate "Other tasks (outside the roadmap)" section: Jira issues the
  person logged time on that day that are not on the roadmap. The header shows the total with a split, e.g.
  "5h (3h roadmap)". The source is `GET /api/m/roadmap/worklogs` - READ ONLY data of the time-log module in the
  team data (`time-log/people/<slug>.json`). Without that data the answer is `available: false` and the section is
  absent, never an error.

## Stage 3: table editing, order, sync window

- Row edit mode: clicking any editable cell (RAG, PO / Designer and Analyst / Architect, three dates, stages) puts
  THAT row into edit mode. Changes are a draft in the browser; "Save" sends ONE `POST /update` with a combined
  patch (only fields that really changed), "Cancel" drops the draft; Enter in a date field saves, Esc cancels.
  One row is edited at a time; entering another row with unsaved changes asks for confirmation.
- Delete: in edit mode, a trash icon next to "Save" and "Cancel" asks for confirmation and then sends
  `POST /delete` `{ id }`; only that one `dt-<id>.json` is removed, the other ranks stay, Jira is not touched.
- Order: a drag handle in the "#" column (plus move up / down buttons for the keyboard) writes `rank`
  (position = index + 1, only files whose number changes are rewritten). With an active search or person filter,
  reordering is disabled and a hint says so.
- Priority by typing: the number in the "#" column is a button; click or F2 turns it into a number field. Enter or
  leaving the field saves, Escape cancels. The initiative lands exactly on the typed position (`moveToPosition` in
  `client/helpers.js`).
- `POST /update` `{ id, patch }`: a strict field list - `ragStatus` (`red`/`amber`/`green`/`null`), `stageStatus`
  (known stage ids), `discoveryEnd`, `deliveryEnd`, `goLiveDate` (`YYYY-MM-DD` or empty), `po`, `designer`,
  `analyst`, `architect` (up to 120 characters). Any other field is 400. `POST /reorder` `{ order: [id, ...] }` must
  be a permutation of the existing initiatives (otherwise 400).
- Jira sync window: progress bar, "Now: ...", done / remaining counter, the result of every initiative and a
  "Stop after the current one" button.

## Kanban tab

`client/kanban.js`, pure functions in `client/kanban-helpers.js`, routes in `server/kanban.js`. Five status columns
(Preparation, To do, In progress, Blocked, Done - bucketed by Jira status id, not name; other statuses such as
Cancelled are not shown) and swim lanes: one per initiative, collapsible, with a counter and an "In table" button;
issues no initiative claims go to the "Other (not assigned to an initiative)" lane. Finished issues (Done,
Cancelled) are fetched for the last 7 days only.

- Toolbar: search by key and title (diacritics-insensitive), "Unassigned", a person filter, "Refresh from Jira".
- Moving: drag a card to another column, or arrow keys on a selected card. The card moves at once and returns
  with a message when Jira refuses.
- "+ Add task" (in a lane header when the initiative has an epic key): a `ds-modal` with Title (required),
  Description, Assignee, Applies to, Change type, Work type and Epic (read only).

### Kanban routes (`/api/m/roadmap/kanban/...`)

| Route | Notes |
|---|---|
| `GET /kanban/status` | `{ token: 'personal' \| 'technical' \| null, canWrite, testMode }`, never the token itself |
| `GET /kanban/board` | two paginated JQL queries (active, and Done/Cancelled from 7 days), lanes from `discovery-tasks/` (read only) |
| `POST /kanban/transition` `{ key, targetColId }` | key `DISC-123`; the transition is chosen by target status id; none available is 409 `no-transition` |
| `POST /kanban/create-task` | epic `PROD-123` or `PLAT-123`, title up to 255 characters, list values from the whitelist |

## Jira instance configuration

The project keys (`DISC` for tasks, `PROD` / `PLAT` for epics), the status ids of the Kanban columns, the custom
field ids (`customfield_17308` change type, `customfield_29000` work type, `customfield_29001` applies to,
`customfield_10001` epic link) and the option ids of the "Add task" lists are EXAMPLE values. Replace them with your
own Jira instance's in `client/kanban-helpers.js`, `server/kanban.js` and `server/jira.js`. `JIRA_URL` defaults to
`https://jira.example.com`.

## Jira token policy

Every Jira call uses the **personal** token (`JIRA_TOKEN` from the vault); the **technical** token
(`JIRA_TECH_TOKEN`) is only a fallback when there is no personal one. One function picks it, `jiraConfig()` in
`server/jira.js` - the only place in the module that reads the token variables, and a test guards that.

- Reads (Kanban board, sync, epic children) may use the technical token; the Kanban toolbar then warns.
- Jira writes (create task, move card, `POST /jira/transition`) with only the technical token are refused with
  409 `personal-token-required`: a technical account must not author changes.
- No token at all is 503 `no-token`.

## Out of scope

Adding initiatives, editing the other fields (title, epic, description, links), an initiative details panel,
comments, a Gantt chart and team load, writing the Tempo file.

## Dashboard widget

`top-initiatives` ("Top initiatives", variants m, m2, l, xl): the first five initiatives by `rank` with Jira task
progress, owners (PO) and Go-Live dates. It reads only the slim `GET /widget` route. After a module update it needs a
server restart.

## Tests

`tests/test_roadmap.mjs` covers the module contract, the server handler on a temporary directory (Jira replaced by a
stub, including the token order, the refusal to write on the technical token and the Kanban route validation), the
pure view and Kanban helpers and the client contract; it runs with `npm test`.

## Publishing

The module reaches the team only through Settings > Modules > "Publish" (branch `module/roadmap-<date>` plus a merge
request in the module catalog).
