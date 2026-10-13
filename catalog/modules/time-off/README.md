# Time off

The team's time-off calendar: who is off and when, in one view instead of a
spreadsheet on OneDrive. The data comes from a SharePoint/Excel workbook you
configure (typically the results sheet of a "time-off request" form) - the
module only shows it, it never edits it.

## Views

The module has no rail item of its own: it adds a **page** to the core
**Support** hub (`sidebar.kind: "page"`, `sidebar.hub: "support"`).

| View id | Label |
|---|---|
| `time-off-main` | Time off |

A dashboard widget, `away-this-week`, shows who is away in the current
working week.

## How it works

- **Data** lives in `time-off/` in the team data repo (`data-tier-0`) - one
  JSON file per person (`people/<slug>.json`) plus a combined `index.json`.
  `GET /api/m/time-off/data` merges and serves them; when the team data is
  not cloned on this computer it answers 200 with `storage: "unavailable"`
  (a normal state, not an error).
- **Downloading** is one action: the "Download" button opens
  `GET /api/m/time-off/fetch-stream` (SSE), which spawns
  `scripts/sharepoint_time_off.py`. The script signs in through Microsoft SSO
  (first in the background from the shared session, then in a visible
  Chrome/Edge window only when the session expired or is missing), downloads
  the workbook, converts it and writes the shards with tmp+rename. Progress
  lines go to stdout and the module's server forwards them over SSE.
- **The SSO session** (`data/modules/time-off/sso-session.json`) is gitignored
  and NEVER goes into team data - these are Microsoft cookies, not team data.
  It is considered fresh for a week (`SESSION_FRESH_HOURS = 168`); after that,
  or when the session is dead, the script opens a sign-in window itself.
- **Filters** sit in one row above the calendar: the person search takes
  three quarters of the width, the team select the last quarter. The search
  folds case and diacritics, word by word (`filterEntriesByPerson` in
  `client/time-off-lib.js`), and matches both the name from the sheet and the
  name from the team directory. Typing repaints only the calendar, so the
  field keeps its caret.
- **Writes are local only.** The module never pushes anything; downloaded data
  reaches the team with the next sync from the panel on the top bar.
- **Safety guard:** if a download would remove more than half of the known
  people (a broken or partial sheet), nothing is deleted and the run fails
  with an explanation.

## Configuration

| Env key | Meaning |
|---|---|
| `TIMEOFF_SHAREPOINT_URL` | View URL of the workbook (required) |
| `TIMEOFF_SHAREPOINT_DOWNLOAD_URL` | Direct download URL of the same workbook (`.../_layouts/15/download.aspx?UniqueId=...`, required) |
| `TIMEOFF_SHAREPOINT_META_URL` | Optional REST URL answering `TimeLastModified` for the file |
| `TIMEOFF_SHAREPOINT_SITE_URL` | Optional lightweight page on the same site for the keepalive probe (defaults to the origin of the view URL) |
| `TIMEOFF_SHEET` | Sheet name (default `Sheet1`; falls back to the first sheet) |
| `TIMEOFF_COL_NAME` | Column with the name of the person who is off (default `Full name`) |
| `TIMEOFF_COL_EMAIL` | Column with the e-mail of whoever submitted the form (default `Email`) |
| `TIMEOFF_COL_DATE_FROM` / `TIMEOFF_COL_DATE_TO` | First / last day off (defaults `First day off` / `Last day off`) |
| `TIMEOFF_COL_SUBMITTED` | Submission time (default `Completion time`) |

Without both required URLs, "Download" explains what to set and the server
answers `409 not-configured`. Only the hosts of the configured URLs count as
"the SharePoint site" for the sign-in and keepalive checks.

The calendar marks public holidays from `client/holidays.js` (Poland's
calendar is built in; replace the table for another country).

## Keeping the SSO session alive

`POST /api/m/time-off/session-keepalive` is a light probe a scheduler can call.
A headless browser opens one page with the saved session, downloads nothing
and writes nothing to team data. Result:

- `active` - the site answered 2xx with no redirect to the Microsoft sign-in;
  the session file is saved again with refreshed cookies.
- `expired` - a redirect to the sign-in page or a non-2xx answer (401/403, an
  error page); the session file is NOT deleted or re-saved - sign in again.
- `session-missing` - no session file; no browser starts.
- error `unreachable` - no network or VPN (or a page off the site host); the
  session is not saved and its state does not change.

The probe takes the same job slot as the download and the sign-in (409
`job-running` while the slot is busy), refuses in test mode before starting
a child process, never opens a visible window and never returns or logs
cookie values. Exit codes of `--keepalive`: 0 alive, 4 expired, 2 no
connection; anything else (e.g. 1 from an uncaught exception, Playwright
missing) is the error `keepalive-failed`, never "expired".

### Shared Microsoft session

Every SSO module on this computer shares one extra file:
`data/sso-shared/microsoft-session.json` in the app directory (gitignored with
the rest of `data/`, mode 600, never in team data). It is the union of the
cookies of every successful sign-in and keepalive. A module's sign-in first
tries WITHOUT a window, in a background browser with this file; the window
opens only when that is not enough. A failed write to this file never breaks
a sign-in.

## Requirements

Python 3 with two dependencies. `GET /api/m/time-off/status` checks them and
the view shows the exact command when something is missing:

```bash
python3 -m pip install -r modules/time-off/scripts/requirements.txt
python3 -m playwright install chromium
```

On Windows use `py -3` instead of `python3` (detected from `platform` in
`/status`).

## Offline mode (`--from-xlsx`)

Useful for a manual test without signing in - converts the given workbook
instead of signing in and downloading:

```bash
python3 modules/time-off/scripts/sharepoint_time_off.py \
  --from-xlsx "path/to/sheet.xlsx" \
  --dest data-sub-repositories/ds-data/time-off
```

A second run with the same data reports `"changed": 0` - a person's file is
written only when its content really changed.

## Tests

- `tests/test_time_off.mjs`, `tests/test_time_off_widget.mjs`,
  `tests/test_session_keepalive.mjs` (`node --test`, part of `npm test`):
  manifest contract, routes, `GET /data` and `GET /fetch-stream` without the
  repo or the configuration, the keepalive exit-code contract against a fake
  Playwright, the widget painter and the client's pure functions.
- `tests/test_sharepoint_time_off.py` (pytest, run by hand):

  ```bash
  PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider catalog/modules/time-off/tests/ -q
  ```

  Covers `xlsx_to_records`, `records_to_shards` (the slug comes from the name
  column, never from the submitter's e-mail), `write_shards` (an unchanged
  second run, removing a person, the destructive-ratio guard) and `slugify`
  parity with the JS side through the shared `tests/fixtures/slug-cases.json`.
