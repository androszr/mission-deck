# Onboarding

Helpful links and individual onboarding plans for new team members - copies of a template, sessions on
Teams, export of a plan to a self-contained HTML file.

## Views

The module has no rail item of its own: it adds a **page** to the core **Knowledge** hub
(`sidebar.kind: "page"`, `sidebar.hub: "knowledge"`).

| View id | Flyout label |
|---|---|
| `onboarding-main` | Onboarding |

## Data layout on disk

The data lives in the plaintext tree `data-sub-repositories/ds-data/onboarding/` (`ctx.dataTier0Dir`),
sharded per file - every write touches exactly one file, so two people editing two different plans never
overwrite each other's work at sync time:

- `links.json` - `{ links: [{id,title,url,description}], generated_at }`, one link list for the whole team.
- `template.json` - `{ id:'default', name:'Template', rows:[...], generated_at }`, the template plan every new
  person's plan is copied from. It cannot be deleted or renamed (the server answers `403`).
- `people/<slug>.json` - `{ id, name, slug, rows:[...], created_at, generated_at }`, one file per person's
  plan. The client addresses a plan by `id` (a stable key), not by the slug in the file name - renaming a plan
  does NOT move the file, so `id` and slug may differ after a rename.
- A plan row: `{ topic, description, who, when, done? }` - `who` is a comma-separated list of "First Last" or
  "First Last (email)" entries (the e-mail in brackets only for someone outside the team directory), `when` is
  `YYYY-MM-DD|YYYY-MM-DD` (or `YYYY-MM-DD|` for a start date only, or any free text, shown as is).

## Routes (`/api/m/onboarding/`)

The identifier travels in the query (`?id=`), never in the path - the host matches module routes EXACTLY,
so `PUT /links/:id` would never match.

| Route | Body / query | Note |
|---|---|---|
| `GET /links` | - | `storage:'unavailable'` only when `ds-data` is not cloned |
| `POST /links` | `{ title, url, description? }` | limit of 100 links |
| `PUT /links?id=` | partial `{ title?, url?, description? }` | 404 when missing |
| `DELETE /links?id=` | - | 404 when missing |
| `GET /plans` | - | `plans[0]` is `default` when it exists |
| `POST /plans` | `{ name }` | copies the template rows into a new shard |
| `PUT /plans?id=` | `{ name?, rows? }` | `default` + `name` -> `403` |
| `DELETE /plans?id=` | - | `default` -> `403` |

A handler never calls `ctx.checkOrigin` itself - the host already does that for every module route other
than GET/HEAD BEFORE it reaches the handler; a second call after a refusal would write to an already-closed
response.

After adding links or plans, **send the `onboarding/` directory with the Sync window in the top bar** - only
then does the whole team see the data.

## Internal links (`view://`)

A `view://<view-id>` link renders as a navigation button (not a link) with an "app" badge when a view with
that id exists in the app (`document.getElementById('view-' + id)`); when it does not, the button is
`disabled` with the hint "This view is not installed" and a "not installed" badge - a link that leads
nowhere is never a bare `<a>` without `href`.

## Plan export to HTML - Design System exception

`client/onboarding-export.js` builds a self-contained HTML document that a person opens from disk OUTSIDE
the app (no internet, no access to Mission Deck). The tokens from `css/ds-tokens.css` do not work there, so
this ONE file may use colour literals in `rgb()`/`rgba()` notation (never hex), a small original logo mark
and inline SVG - the file header describes the exception. Everywhere else the module follows the DS:
`ds-card`, `ds-table`, `ds-btn`, `ds-modal-*`, icons as `<img>` from `assets/icons/ds/`.

## Tests

`npm test` picks up `modules/onboarding/tests/test_*.mjs` automatically:

- `test_onboarding.mjs` - the manifest contract and the exact set of 8 routes.
- `test_onboarding_store.mjs` - pure server functions (`slugify`, `sanitizeRows`, `sortPlans`, ...).
- `test_onboarding_routes.mjs` - routes through `createRoutes` on a temporary directory (empty state,
  per-file writes, `default` protection).
- `test_onboarding_lib.mjs` - pure client functions (`onboarding-lib.js`) and the export builder
  (`onboarding-export.js`).
