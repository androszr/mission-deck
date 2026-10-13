# Sprint Review

The `sprint-review` module of Mission Deck: coordination of one Sprint Review meeting shared by
several teams (meeting key `team-review`, label "Sprint Review"). Sessions, teams and topics come
from the meeting's review pages in Confluence; each team card shows the sprint goal, its
realization status and the submitted topics, with a countdown to the submission deadline and a
text and visual agenda.

Teams are NOT a constant: they are read off the Confluence page sections (see Confluence below),
in page order, so a change in the lineup shows up on its own.

## Views

| View id | Label |
|---|---|
| `sprint-review-main` | Sprint Review |

## Data layer

Sessions live in the team data source `data-tier-0`, under `sprint-review/`:

- `index.json` - `{ schema_version: 1, meeting: 'team-review', sessions: [] }`, where each entry is
  a TRIMMED session (`id`, `reviewDate`, `sprintN`, `sprintName`, `meeting`, `confluencePageId`,
  `confluenceVersion`, `updatedAt`) - full sessions live only in the shards.
- `sessions/<id>.json` - the full session object, one file per session. `<id>` matches
  `/^sr-[0-9a-f]{16}$/`.

`server/store.js` is the only file of this module that touches `fs` for this repository. Paths
are built EXCLUSIVELY from `ctx.dataTier0Dir`, so a unit test can never write into the real team
repository. The shard is written BEFORE the index (`writeSession`), so the index never points at
a missing file; a missing or corrupt `index.json` heals itself - `listSessions()` rebuilds the
index from the shards (`rebuildIndex`) and writes it back. Every write runs under
`ctx.makeLock()` (one lock for the whole module) and tmp+rename. `storageState()` answers `'ok'`
when `ctx.dataTier0Dir` exists and holds anything besides junk files (`.gitignore`,
`.DS_Store`), else `'unavailable'`.

When a new session is created, the sprint goal is filled in (read only) from the Sprint Stats
module's `sprint-stats/index.json` in the same source (`server/session.js` `teamStatsDir()` +
`readSprintGoals()`), per team, where the sprint statistics know it (`boards.main` /
`boards.platform`); otherwise it stays empty. A missing file, bad JSON or no data - the session
is created anyway.

## Routes (`/api/m/sprint-review/...`)

All matched by EXACT path (`handleModuleRoute` knows no `:id`) - identifiers always travel in the
query string. The core adds `checkOrigin` for methods other than GET/HEAD.

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Repository state, meeting configuration, Confluence and sprint-goal availability. |
| GET | `/sessions` | Session list (index entries). `storage: 'unavailable'` -> 200 with an empty list. |
| GET | `/session?id=` | A full session. 400 `bad-id` / 404 `not-found`. |
| POST | `/sessions` | New session. Body `{ reviewDate, facilitatorPo? }`. 409 `storage-unavailable`, 400 `reviewDate-required`, 201. |
| PUT | `/session?id=` | Patch of allowlisted fields (`MUTABLE_FIELDS`, never `submissions`). 400 `bad-id`/`reviewDate-invalid`, 404, 200. |
| DELETE | `/session?id=` | Delete a session. 400 `bad-id`, 404, 200 `{ deleted: true }`. |
| PUT | `/session/team?id=&team=` | Read-modify-write of ONE team on the session, under the lock. A normal team's body: `realizationStatus?`, `submitted?`, `topics?`. A dual-section team (`Echo`): `topicsProblemSpace?` / `topicsSolutionSpace?` instead of `topics?`. 400 `bad-id`/`bad-team`/`bad-topics-key`/`bad-format`/`bad-realization-status`, 404, 200. |
| GET | `/confluence-discover` | Pages under the meeting page in Confluence, with a `new`/`synced`/`outdated` badge. 503 `confluence-disabled`, 400 `no-token`, 502 `confluence-unreachable`/`confluence-http`, 200. |
| POST | `/confluence-import?pageId=` | Import or re-import of one page. 400 `pageId-required`, 409 `storage-unavailable`, 503/400/502 as above, 201 (new) / 200 (re-import, merged `submissions`). |
| POST | `/confluence-sync-all` | One unattended pass (for a scheduler): discovers the meeting's pages and imports every `new` or `outdated` one with the same code as `/confluence-import`; `synced` pages are not fetched. 409/503/400/502 as above, 200 `{ ok, totals: { total, imported, refreshed, unchanged, failed }, results }`. |

`PUT /session` does NOT accept `submissions` - that field changes only through
`PUT /session/team`, one team at a time, under the lock, so two open windows never overwrite each
other.

Values: `realizationStatus` is one of `''`, `achieved`, `partial`, `not-achieved`; a topic
`format` is `''`, `presentation` or `discussion`.

## Confluence

Configuration (`envKeys`): `CONFLUENCE_TOKEN`, `CONFLUENCE_BASE_URL` (default
`https://confluence.example.com`) and `SPRINT_REVIEW_CONFLUENCE_PARENT_ID` (the page the review
pages live under). All are read from `process.env` on EVERY request, because the token may appear
mid-session after the vault is unlocked. Review pages are recognised by a `dd.mm.yyyy` date and
the word "Sprint" in the title (e.g. `07.09.2026 Sprint 17 Review`).

`server/confluence.js` parses the page body (storage format). The expected template:

- one `<h2>` per team, in page order - every `<h2>` section IS a team, there is no team allowlist;
  a small alias map only normalises spelling, an unknown heading keeps its cleaned text,
- `Sprint Goal: "..."` (curly or straight quotes) and an optional status macro (green = achieved,
  yellow = partial, red = not achieved),
- a list of `Topic: ...` items with user mentions as presenters and a format marker
  (U+1F5BC or U+1F4BB = presentation, U+1F5E3 = discussion),
- a panel titled "Facilitator" holding the facilitator's mention.

The team `Echo` (constant `DUAL_SECTION_TEAMS` in `server/session.js`) splits into Problem Space /
Solution Space (`<h3>`, with a fallback split on the text "Solution Space") -> fields
`topicsProblemSpace` / `topicsSolutionSpace`; other teams have `topics`. The code is 100% ASCII -
every typographic quote and format marker in the regexes is a `\u....`/`\u{.....}` escape.

`createConfluenceClient({ http, baseUrl, token })` has the same "HTML instead of JSON = no VPN"
gate as the core: a fetch that threw, a non-2xx answer or `content-type: text/html` (a typical
SSO login page) all end in one of two errors (`confluence-unreachable`, `confluence-http`), never
in parsing a login page as session data. The token goes to the client in the constructor and
never lands in a log (`ctx.log`) or a response - `tests/test_routes.mjs` checks that with a spy on
`ctx.log`.

Re-importing the same page (a known `confluencePageId`) keeps the old session's
`id`/`createdAt` and merges `submissions` through `mergeReimportedSubmissions`: the manual
`realizationStatus`/`submitted` stay as they are, and topics merge additively by title AND by the
NUMBER of occurrences (`mergeTopicsList`) - a topic added by hand (`id` prefixed `t-`) is never
overwritten by a re-import, only a topic that came from Confluence (`cf-`) gets its format and
presenters refreshed.

## Dashboard widget

`next-sprint-review` ("Next Sprint Review", `client/widget.js`) reads `GET /sessions`: it takes
the session with the earliest `reviewDate` not before today, or - when there is none - the latest
past one ("the last one took place on ...", neutral tone). The submission deadline is the Friday
before `reviewDate`, 10:00 UTC (the `deadlineFromReviewDate` rule of `server/session.js`, repeated
in the widget as the pure function `deadlineFor` and pinned by a test to the same values); the
widget shows it in local time and turns to a warning tone when less than 2 days are left. Sizes:
`s` (days), `m` (days + timeline), `m2` (plus one `GET /session?id=`: facilitator, presenters and
a "Teams with topics" bullet bar). Without a data directory (`storage: 'unavailable'`) it points
to the Sync window, not to creating a session. The widget only reads (GET).

## Team badges

`client/assets/<team>_light.svg` are simple badges used by the downloadable visual agenda (one per
example team: Atlas, Borealis, Comet, Delta, Echo, Falcon). A team without a badge falls back to
its name.

## Tests

`node --test modules/sprint-review/tests/*.mjs` (also run by `npm test`): the module contract
(`test_sprint_review.mjs`), the Confluence parser with teams in page order and the Echo split
(`test_confluence_parse.mjs`), session and deadline logic (`test_session.mjs`), the data layer
(`test_store.mjs`), server routes with a fake HTTP client (`test_routes.mjs`), the client library
(`test_client_lib.mjs`) and the dashboard widget (`test_sprint_review_widget.mjs`).
