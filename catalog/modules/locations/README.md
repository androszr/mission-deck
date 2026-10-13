# Locations

Mission Deck module `locations`. A searchable directory of locations - sites,
branches, stores, offices - with a full card per location and a one-file
import from Excel or CSV. The "Locations" page sits in the core "Knowledge"
hub (`sidebar.kind: "page"`, `sidebar.hub: "knowledge"`).

## Views

| View id | Label |
|---|---|
| `locations-main` | Locations |

## Data: `locations/` in the team data repo

This module owns `locations/` in `data-tier-0` and is the only writer:

- `locations.json` - the full directory: `{ metadata, rows: [location...] }`.
  It carries contact details (phone, e-mail) and reaches the browser only
  through `GET /location?code=`, one location per request.
- `locations.index.json` - a light index of the same rows (no phone, no
  e-mail) plus a precomputed `search_text`. `GET /directory` reads only this
  file.

A location row uses English keys: `code`, `name`, `status`, `city`,
`postal_code`, `street`, `region`, `area`, `district`, `operator`, `manager`,
`partner`, `groups[]`, and in the full file also `phone`, `email`,
`opened_at`, `sales_area_m2`, `latitude`, `longitude`.

Other modules may READ the index (for example `rollout-waves` plans rollout
waves over it); they never write it.

## Import = full replace

"Import data" uploads one `.xlsx` (first sheet) or `.csv` file and REPLACES
both files. Validation runs before any write:

- The header row is found within the first 10 rows (exports often carry a
  title line above it); no row with a `Code` column -> 400 `header-not-found`.
- Required columns: `Code`, `Name`, `City` -> 400 `missing-columns` with the
  list. Headers are matched case- and accent-insensitively and accept a few
  aliases (`Location code`, `Postcode`, `ZIP`, `Owner`, `Tags`, ...); see
  `COLUMN_ALIASES` in `server/locations-import.js`.
- No data rows -> 400 `no-rows`. Rows without a code are skipped; a repeated
  code keeps its first row and is reported as a warning.
- `Groups` is split on `,`, `;` or `|`.

A re-import of identical content writes nothing (`server/json-store.js`
compares with the volatile timestamps stripped). There are no `.bak` files -
the history of the encrypted mirror is the rollback.

A small synthetic example lives in `examples/locations-sample.csv`.

## Blank manager = `Vacant <area>`

An export usually leaves the manager cell blank for an unfilled position.
`GET /directory` and `GET /location` answer such a row with
`manager: "Vacant <area>"` (read time only, on a copy; the file keeps
the blank cell), and a search for "vacant" finds them. `rollout-waves` keys
its wave configuration the same way.

## Routes (`/api/m/locations/`)

| Route | Purpose |
|---|---|
| `GET /directory?q=&status=&region=&group=&offset=&limit=` | Filtered, paged index rows plus facets and summary counts |
| `GET /location?code=` | One full record |
| `GET /files` | Metadata of the stored directory |
| `POST /import` | `{ name, file_base64, modified_at? }` - JSON body, because the host answers 415 to a non-JSON body on every non-GET route |

## Split: the module writes plaintext, a person sends it

The module writes only plaintext into the team data working tree, under one
lock (`ctx.makeLock()`). Sending a change to the team (encrypt, commit, push)
is a deliberate step in the sync panel on the top bar.

## Tests

`node --test catalog/modules/locations/tests/test_*.mjs`:

- `test_locations.mjs` - manifest, route table, `register()` without disk
  access, and every route against a temporary data tree (CSV and XLSX import,
  search, group filter, vacant manager, validation errors).
- `test_locations_import.mjs` - header aliases, header detection, CSV parser,
  row building, light index.
- `test_locations_lib.mjs` - pure client helpers.
- `test_xlsx_lite.mjs` - the XLSX reader on in-memory fixtures.
- `test_json_store.mjs` - the tmp+rename writer.
