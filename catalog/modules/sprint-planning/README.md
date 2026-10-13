# Sprint planning

One sprint planning page per team and sprint number - instead of separate loose pages.
The module lives in the Activity hub, next to Sprint Review and Sprint Stats. It never writes to Jira or Teams.

## Seven steps

1. On-call - the on-call schedule for the sprint days, team members highlighted, "Dev on-call" and "DevOps on-call" fields.
2. Capacity and events - sprint dates, working days, public holidays, head count, events and dependencies.
3. Absences - time off from the time-off calendar plus absences reported on Teams (entered by hand).
4. Velocity - the team's last three closed sprints and a proposal for this sprint.
5. Refinements - team refinements and cross-refinements with other teams, the fixed slot time.
6. Sprint goal - the goal text, optionally inserted from Jira.
7. Go to Jira - a link to the team board and copying the goal to the clipboard.

## Teams

The teams are listed once in `server/teams.js` (the examples are Atlas, Borealis, Comet and Delta).
Replace them with your own; the plan id format is derived from that list.

## Data

All data lives in the team data repository (`data-tier-0`).

- Write: `sprint-planning/plans/<team>-<sprint>.json`, one file per plan.
  Creating the same plan again answers 409 `exists`.
- Write: `sprint-planning/settings.json` - sprint settings of the teams (length in weeks, number and start
  date of the first sprint planned in the app), shared by everybody.
- Read only: `on-call/` (on-call module), `time-off/` (time-off module), `team/` (Settings > Users) and
  `sprint-stats/index.json` (Sprint Stats). A missing source is shown as "unavailable", never as an error.
- Optional `JIRA_URL` (default `https://jira.example.com`) - the same key as in Sprint Stats.

## Sprint dates

The "Sprint settings" button sets, per team, the sprint length (1-6 weeks) and the number and start date of the
first sprint planned in the app. A new planning takes its dates from those settings: it starts where the last saved
sprint of the team ended (or at the first sprint when there is none yet) and lasts as many weeks as the settings say.
The dates of a single sprint can be changed on its page (at most 42 days) - the team settings stay unchanged and the
next newly created sprint starts after the changed one ends (for a range of partial weeks: on the weekday the first
sprint in the settings starts). An existing later planning keeps its own dates. "Restore dates from settings" undoes
such an exception. A team without settings gets its dates from the Jira sprint history, as before.

## Velocity

Proposal = the average `done` of the team's last three closed sprints numbered below the planned one, times the
availability against a regular sprint, rounded to an integer. Availability = available person-days (people x working
days of the sprint, minus team days off and absences) / person-days of a regular sprint (people x working days
without holidays, i.e. the weeks from the team settings x 5, or 2 weeks x 5 without settings). Holidays, team days off
and a sprint of unusual length therefore change the proposal (a sprint longer than usual can give a ratio above
100%). A sprint in progress does not count towards the average. The proposal can be overridden by hand.

Public holidays are computed for Poland (`polishHolidays` in `client/sprint-planning-lib.mjs`); swap that function
for your own calendar if needed.

## Filling in refinement slots

Open `server/teams.js` and replace `refinementSlot: null` for a team with, for example,
`{ weekday: 2, from: '10:00', to: '11:00' }` (`weekday` 1-5 = Monday-Friday), then restart the app.

## API (`/api/m/sprint-planning/`)

`GET /status` (with a `settings` field), `GET /plan?id=`, `POST /plan`, `PUT /plan?id=` (also `{ resetDates: true }`),
`DELETE /plan?id=`, `GET /context?team=&from=&to=`, `PUT /settings` (`{ baseUpdatedAt, teams: { <team>: {...} | null } }`).
