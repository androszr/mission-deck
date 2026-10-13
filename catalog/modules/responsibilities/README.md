# Responsibilities

Module `responsibilities` - a responsibility matrix per project. Menu: Support > Responsibilities, hash
`#responsibilities-main/<project>` (`main`, `web`, `mobile`, `platform`).

## What it does

- Groups, areas, owners and an R / A / G rating for the chosen month; an 8-month trend next to each area.
- Status R requires writing down the actions to take (saved after an 800 ms debounce).
- Groups and areas: add, rename, move an area between groups, delete (with confirmation).

## Where it reads from

One file per project in the `responsibilities/` directory of the team data plaintext tree
(`data-tier-0`, `data-sub-repositories/ds-data/responsibilities/<project>.json`). Routes under
`/api/m/responsibilities/`: `GET /data?project=`, `POST /prepare`, `POST /rating`,
`POST /groups/{add,rename,delete}`, `POST /areas/{add,rename,delete}`. Writes are atomic
(tmp + rename) under one lock per project. The module never overwrites a corrupt file with an empty shell
(answer 409 `corrupt-file`).

## Read-only mode

When this machine cannot push `data-tier-0`, an edit could never reach the team, and the next "Pull" or
"End of day" would overwrite or delete it. The client therefore reads `canPush` for `data-tier-0` from
`GET /api/sync-overview` and on `false` (or when the read fails) disables every editing control and never
calls `POST /prepare`.

## Adding a project

Add an entry to the `PROJECTS` array in `client/responsibilities-lib.js` and to `PROJECTS` in
`server/store.js`. The file `responsibilities/<id>.json` is created on the first visit.

## Dashboard widget

The "R / A / G rating" tile (`client/widget.js`, variants `s`, `s2`, `m`, `m2`; default `m2`) reads
`GET /api/m/responsibilities/data?project=main` and counts through `responsibilities-lib.js`
(`defaultMonth`, `countsForMonth`, `groupCounts`), so the numbers match the view (the previous closed
month). A R / A / G ring, a pill with the number of unrated areas and a "red and amber by group" bar.
No avatars: the tile shows counts, not people. A missing team data tree gives a Sync hint, a missing
matrix a hint to open the module's view.
