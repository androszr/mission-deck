# Gantt roadmap

A team's quarterly roadmap as a Mission Deck view: a weekly Gantt chart with areas (streams), tasks,
phases and people, plus a backlog of items to consider. Every change is saved in the team data and
reaches the others through the sync of the Team data source (`data-tier-0`).

Menu: **Initiatives > Gantt roadmap**.

## What it does

- A chart for the whole quarter: a month band cut at the real dates, ISO weeks (e.g. W39-W52),
  sprints from the quarter calendar, a "today" line, a highlighted holiday week.
- Grouping by area, by owner or none; a person filter.
- Editing is always on: drag bars and their edges (a whole task or one phase), a side panel with the
  title, weeks (the ISO week number, e.g. W40-W42), phases, people and owner, area change, order, move
  to backlog and delete.
- Areas: add, name, note, a colour from the Design System palette, order, delete an empty one.
- Backlog: a list of items, add, edit, delete and "Add to the roadmap" (the item becomes a task in the
  chosen area).
- Export of the whole roadmap to one HTML file that works without the app.
- People photos from the team directory (`js/team-directory.js`), initials without a photo.

## Data

The `data-tier-0` source, directory `gantt-roadmap/`:

```
gantt-roadmap/
  index.json                      active quarter and the list of quarters
  <quarter>/quarter.json          calendar, sprints (start + number of days), teams, roster
  <quarter>/areas/<id>.json       one file per area
  <quarter>/tasks/t-<hex>.json    one file per task
  <quarter>/tasks/_n<N>           marker of a deleted task's number (numbers never come back)
  <quarter>/backlog/bl-<hex>.json one file per backlog item
```

Every element has its own file with a random name and there is no shared counter, so two people adding
tasks on different computers before a sync do not overwrite each other. The display number (T01, T02, ...)
is stored in the task; when two tasks have the same number after a sync, the server gives one of them the
next free number.

A new quarter is a new directory with `quarter.json` - the calendar is data, not code. Create one with:

```
node modules/gantt-roadmap/scripts/create-quarter.js --id q1-2027 --monday 2026-12-28 --weeks 13 [--example]
```

`--example` adds a small synthetic roster, areas, tasks and backlog items to try the view. The script
refuses to touch a quarter that already has tasks, and refuses to run before the Team data source is pulled.

## Files

| File | Role |
|---|---|
| `client/index.js` | the view: toolbar, chart, side panel, area dialogs, backlog |
| `client/gantt.js` | pure functions (calendar, phase levels, grouping, numbering, colours) - shared by client and server |
| `client/export-html.js` | export to a standalone HTML file |
| `client/style.css` | styles, DS tokens only |
| `server/index.js` | routes `/api/m/gantt-roadmap/*`, every write under one lock |
| `server/widget.js` | read only: the current-week aggregate for `GET /widget` (no lock, no write, no duplicate repair) |
| `client/widget.js` | the "Roadmap: this week" dashboard tile |
| `server/store.js` | file writes (tmp + rename), quarter reads |
| `scripts/create-quarter.js` | creates a new (optionally example) quarter |
| `tests/test_gantt_roadmap.mjs` | module contract, `gantt.js` functions, the store on a temporary directory |

## Dashboard widget

The "Roadmap: this week" tile (`this-week`, sizes `s2`, `m`, `m2`, `l`, `xl`, default `m2`) reads
`GET /api/m/gantt-roadmap/widget`: the active quarter, the current week number, the week's tasks and
milestones, people (names from `roster[].n`, photos picked by the dashboard) and an area heat map for
weeks ±2. The route is read only - it takes no lock and writes nothing, unlike `GET /quarter`, which
writes a fix when it finds duplicate numbers. Outside the quarter the tile says "Outside the range of
quarter ...". The route works after a server restart; before that the tile asks for one.

## Out of scope

Jira, team capacity planning, undo.
