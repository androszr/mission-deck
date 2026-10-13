# Knowledge base (`knowledge-base`)

A read-only browser of discovery documents kept in the team data repository (`data-tier-0`):
interviews, research, requirements, UX briefs, notes, estimates. The list is grouped by area,
sub-area and document type, with accent-insensitive search, sorting, a document view with
"Content" and "Confluence" tabs, `.md` download and opening the `.html` report in a new tab.

## Data

`data-sub-repositories/ds-data/knowledge-base/` (relocatable with `DATA_SUB_REPOS_DIR`).

```
knowledge-base/
  knowledge-base-areas.json         { "areas": [{ "slug", "label", "subareas": [{ "slug", "label" }] }] }
  <area>/<category>/<doc>.md        an article (YAML frontmatter: title, date, summary, author, status, type)
  <area>/<category>/<doc>.html      optional HTML report next to it
  <area>/<sub-area>/<category>/...  when the area declares sub-areas
```

Categories are directory names: `research`, `interviews`, `meetings`, `workshop`, `ux-brief`,
`notes`, `as-is`, `estimates`, `data-analysis`, `business-requirements`, `general`; anything else
is shown as "Other". A new area directory appears in the list by itself.

The module never writes. To add a document, put the file into the directory above and send it
with the sync panel in the top bar. `meetings/` and `sql/` at the root are skipped and refused by
the path guard.

## Routes (`/api/m/knowledge-base/`, all GET)

- `/list` - areas and every article
- `/article?path=` - one article (body without the frontmatter)
- `/file?path=[&download=1]` - the raw `.md` or `.html` file
- `/widget` - the dashboard tile data

The `.html` report opens in a new tab (the core sends `X-Frame-Options: DENY`, so no frame).
The core's default CSP applies there: inline scripts in a report will not run.

"Check for updates" uses the core route `POST /api/knowledge-base/confluence-check` (needs an
unlocked vault with a Confluence token and the Confluence base URL configured). When the route or
the token is missing, the button is disabled and the rest of the view works.

## Dashboard widget

The "New in the knowledge base" tile (`widgets[]` in `module.json`, `client/widget.js`): number of
documents, split by type, the five newest articles and new documents in the last four months.
Sizes: `s`, `s2`, `m` (default), `m2`, `l`. It reads the light route
`GET /api/m/knowledge-base/widget` (no article bodies; the scan is cached for up to 60 s or until
an area directory changes). After installing, restart the server; until then (404) the tile
suggests a restart and does NOT read `/list`.
