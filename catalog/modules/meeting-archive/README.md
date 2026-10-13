# Meeting archive

Module `meeting-archive`: the archive of the team's processed meetings. A page in the Knowledge menu.
New recordings are processed by the `meeting-transcripts` module, and a finished meeting lands here with one
"Send to archive" button.

## View

One view, `meeting-archive-main`, carries both screens: without a sub-path it is the list (folder tree from
`_folder-tree.json`, search and categories from `_categories.json`, a flat table while a filter is active),
with the sub-path `#meeting-archive-main/<folder>` it is the meeting detail ("Summary" and "Transcript" tabs).
A second view would add a second entry to the Knowledge menu, which is why the detail is a sub-path.

## Data

Source: `data-sub-repositories/ds-data/meeting-archive/` - the team data repository (`data-tier-0`).

| File | Contents |
|---|---|
| `<folder>/metadata.json` | status, `processed_at`, duration, `is_manual`, `errorReason` |
| `<folder>/meeting-info.json` | title, description (sometimes a fenced JSON block), participants |
| `<folder>/meeting-user-meta.json` | categories, virtual folder, custom title and date |
| `<folder>/summary.md` | summary, often wrapped in JSON (including invalid JSON) |
| `<folder>/transcript.json` / `transcript.txt` | conversation segments |
| `<folder>/summary.html`, `report.html` | graphic report |
| `_categories.json`, `_folder-tree.json` | shared dictionaries |

The module never reads or lists an `audio.mp3` file.

## Saving and sending to the team (since 0.2.0)

The module **owns** `meeting-archive/` in `data-tier-0` (`dataRepos` without `access: read`). Every save
immediately pushes only this module's files - the same mechanism as the module button in the Sync window
(`GET /api/data/data-tier-0/push-stream?module=meeting-archive`, over loopback). No merge request, like the
other data sources. When the push fails, the change stays local and waits in the Sync window.

| Route | What it does |
|---|---|
| `POST /publish {name}` | transcript `user-data/transcripts/<name>` of the Meeting transcripts module -> folder `YYYY-MM-DD_HH-MM_<slug>` (meeting date). A republish overwrites the content and keeps categories, folder and custom title |
| `POST /meta` | title, date, categories, folder (`meeting-user-meta.json`) |
| `POST /delete` | removes a meeting from the archive |
| `POST /categories`, `POST /folders` | add / rename / delete (a deleted folder hands its meetings one level up) |
| `POST /push` | retries the push alone |
| `GET /sources` | for Meeting transcripts: what was already sent and which recordings are in the archive (the nightly download skips them) |

**Folder of a new meeting** (`server/folder-assign.js`): first the series - the recording name without the date
and ticket numbers is looked up in the archive, and the meeting goes to the folder that series lives in (at
least 2 meetings and 60% of the series). Otherwise `claude -p` (no tools, one turn, model sonnet, prompt on
stdin, an environment without vault tokens) picks one of the existing folders or none. The choice is saved in
`meeting-user-meta.json` as `auto_folder` (the "Auto folder" badge in the archive); changing the folder by hand
with "Edit" removes it. A republish never moves the folder.

A write is refused (`storage-unavailable`) when the archive is not on disk (not pulled, or cleared by
"End of day") - writing into an empty tree and pushing it would look like deleting the team's archive.

## HTML report: srcdoc

Every answer outside `/modules-data/` carries `X-Frame-Options: DENY`, so an `iframe src` pointing at a static
path is refused. The `/html` route returns the HTML as JSON text and the client sets `iframe.srcdoc` with
`sandbox=""` (no scripts, opaque origin). The report's scripts are blocked by the sandbox, which is expected;
the content reads fine. "Download .html" sits next to the "Report" segment.

## Dashboard widget

The "Recent meetings" tile (`widgets[]` in `module.json`, `client/widget.js`): the five most recent meetings,
the number of meetings in 30 days, participants of the newest meeting (avatars), the ready / error split and
this month's calendar. Sizes: `s`, `s2`, `m`, `m2` (default), `l`, `xl`. Reads
`GET /api/m/meeting-archive/widget?limit=5` (limit 1-10; no briefs, categories or folder tree; participant
names of the newest meeting only; cached for up to 60 s). After installing, restart the server; until then
(404) the tile suggests a restart and does NOT read `/list`.

## Tests

`npm test` runs `tests/test_*.mjs`: the module contract, the wrapper parsers, the list helpers and the server
routes on a temporary tree (`DATA_SUB_REPOS_DIR`).

Full module contract: `modules-template/README.md`.
