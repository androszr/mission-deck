# On-call

Mission Deck module `on-call`. A monthly on-call calendar read from a
Confluence wiki page and shown in the Support hub: who is on call today, who
covers which area, on-call hours, coordinators and contacts.

## Views

| View id | Label |
|---|---|
| `on-call-main` | On-call |

A dashboard widget, `on-call-today`, shows who is on call today and on the
next few days.

## Configuration

| Env key | Meaning |
|---|---|
| `CONFLUENCE_TOKEN` | Confluence personal access token (from the vault). Needed only for the Sync button. |
| `CONFLUENCE_BASE_URL` | Base URL of your Confluence, e.g. `https://confluence.example.com` (the default). |
| `ONCALL_PAGE_ID` | Numeric id of the page that holds the schedule. Without it Sync answers `not-configured`. |

## Page layout the parser expects

Four tables on one page, found by their header text (order does not matter):

1. **Roster** - header row `(blank) | Inventory | Orders | Platform | Email |
   Phone | Company | (role)`. A scope cell is a check-mark or cross-mark
   emoji (or any text for "yes"). Several e-mails in one cell are split by `/`.
2. **Coordination** - `Person | Email | Phone`. Text after the number such as
   "or Teams (on-call chat)" becomes a note.
3. **Hours** - a header containing `Days of week`: `System | Days | Hours |
   Scope`. The system name is written once and fills down.
4. **Schedule** - first header cell `Date`: `Date | Day | Backend Inventory |
   Backend Orders | Backend Platform | DevOps`. Dates are `D.M` (no year),
   weekdays in English (`Mon`, `Monday`, `Mon.`). A cell may hold several
   people separated by ` / ` or line breaks, and `Name - Orders` routes that
   person to another column.

The four column keys (`inventory`, `orders`, `platform`, `devops`) are fixed in
`server/build.js` and `client/oncall-lib.js` - rename them in both places
(a parity test pins them) to match your own teams.

## Data

The schedule is read from Confluence only - nothing is ever written back to
the page. Data goes into the shared team data (`dataRepos: [{ name:
"data-tier-0", paths: ["on-call/"] }]`), so after a sync send it from the Sync
window in the top bar so the whole team sees the same schedule.

Layout on disk (`ctx.dataTier0Dir/on-call/`):

- `index.json` - roster contacts, coordination, on-call hours, metadata of
  the last fetch (`generated_at`, `source_url`, `source_version`,
  `source_updated`) and the month list (`months`), read back from the
  directory AFTER the write so it always matches the real files.
- `months/YYYY-MM.json` - one file per month, entries `{ date, weekday,
  column, person, person_slug, matched, note }` sorted by date, column and
  person.

A sync rewrites ONLY the months present on the page in that run - older
shards stay as history. If the roster, coordination or hours table comes back
empty while the previous `index.json` had rows, the previous rows are kept
with a warning (never a silent wipe). An empty schedule ends with 422
`parse-failed` and writes nothing.

## The year of a schedule date

Rows carry no year ("1.08", "01.09"). The first row's year is derived from its
weekday: the candidates are the page version's year, year-1 and year+1, in
that order - the first one whose weekday matches wins. Every later row
continues from the previous one (the year rolls over when the month goes
down), because a hand-typed weekday drifts. A missing or wrong weekday never
drops a row - it adds a warning.

## Matching people

A name from the schedule is matched against the roster by its set of words,
in any order ("Rivera Sam" and "Sam Rivera" hit the same entry). A typo or a
person outside the roster is shown with the raw name and `matched: false` -
nobody guesses who was meant.

## Tests

`tests/test_oncall.mjs` (module contract), `tests/test_oncall_parse.mjs`
(HTML parser over the synthetic fixture), `tests/test_oncall_routes.mjs`
(routes with an injected `http`), `tests/test_oncall_lib.mjs` (pure client
helpers) and `tests/test_oncall_widget.mjs` (dashboard widget).
