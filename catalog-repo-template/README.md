# Module catalog template

A module catalog is a folder with one curation file and one folder per module. Mission Deck
reads it from one of two sources:

- **The local catalog (default).** The folder `catalog/` in the Mission Deck repository
  (`MODULES_CATALOG_DIR` moves it). Settings > Modules > Catalog lists it, **Install** copies a
  module from `catalog/modules/<id>/` into `modules/<id>/`, and **Publish** copies a module back
  into `catalog/modules/<id>/` and upserts its entry in `catalog.json`. No token, no network -
  the change is then committed, or proposed as a pull request, like any other change to the
  repository.
- **A shared GitLab catalog (opt-in).** A separate GitLab repository with exactly the layout of
  this template, used when `MODULES_CATALOG_REPO_URL` is set. Mission Deck reads it through the
  GitLab REST API only (`GET /api/modules/catalog`, `POST /api/modules/install`) and never clones
  it. **Publish** opens a branch and a merge request there; `main` stays protected.

This folder is the starting point for the second case: copy it into a new repository to host a
catalog your whole team shares.

## Editorial rule (mandatory)

**A catalog is NOT encrypted.** Unlike the team data repository (`data-tier-0`), which keeps an
encrypted mirror, module code is stored as plain text. So it holds **technical code only**:

- no personal data,
- no secrets, tokens or passwords,
- no customer data,
- no screenshots or exports from production systems.

The module author keeps this rule at publish time - the catalog does not enforce it.

## Layout

```
catalog.json          - curation: the list of featured / described modules
modules/
  <id>/               - exactly the layout of modules-template/ in the app repository
    module.json
    client/
      index.js
      style.css
    server/
      index.js
    tests/
    README.md
```

A module in `modules/<id>/` that is NOT in `catalog.json` is still visible in the app - it is
listed at the end of the catalog as "uncurated". An entry in `catalog.json` with no
`modules/<id>/` folder is a curation error and shows up in the catalog's error section in the
app - never silently.

## Shape of a catalog.json entry

```json
{
  "schemaVersion": 1,
  "modules": [
    {
      "id": "example-module",
      "featured": true,
      "order": 10,
      "status": "stable",
      "area": "Product",
      "author": "Alex Morgan",
      "tags": ["reports", "integrations"],
      "summary": "A short, one-sentence description of what the module does.",
      "owner": { "slug": "sam-rivera", "name": "Sam Rivera" }
    }
  ]
}
```

Fields:

- `id` - must equal the folder name `modules/<id>/` and the `id` field in that module's
  `module.json`.
- `featured` (optional, default `false`) - featured modules come first in the list.
- `order` (optional, default `0`) - the order within featured and non-featured modules.
- `status` - one of `stable`, `beta`, `deprecated`.
- `author`, `tags`, `summary` - optional, descriptive only.
- `area` - an optional business area in the curation, e.g. `Product`, `Engineering` or
  `Operations`. A valid value takes precedence over `module.json`; a missing field falls back to
  the manifest. An older entry with neither value stays visible as "Area not set", but installing
  it asks for an area. Publishing writes the area into the manifest and into the catalog entry.
  Entries that predate the field are filled in once by `POST /api/modules/catalog/migrate-areas`
  (curl only, `dryRun` first): on a local catalog it patches `catalog.json` and each
  `modules/<id>/module.json` in place; on GitLab it opens one branch `catalog/areas-<date>` with
  one commit and one merge request for review. The area comes from the installed module with the
  same `id` or from `areas` in the request, never from a default.
- `owner` (optional, `{ slug, name }`) - who first published the module. The app sets this field
  ITSELF on the first publish of an `id` and NEVER overwrites it afterwards - every later publish
  of the same `id`, by anyone, keeps the existing `owner`. A publish by someone other than the
  recorded owner is not blocked (that is a "takeover" of the module), but the publish dialog says
  so, and on GitLab so does the merge request title. Editing the field by hand is the only way to
  change it.

## Adding your own module by hand

1. Copy `modules-template/` from the app repository to `modules/<id>/` here and fill in
   `module.json` as for a local module.
2. Add your entry to `catalog.json` following the shape above.
3. Local catalog: commit the change (or open a pull request). GitLab catalog: create a branch,
   commit and open a **merge request in the catalog repository** - `main` is protected and every
   new module and every curation change goes through review.

Usually you do not need any of this: Settings > Modules > the module's card > **Publish** does it
for you, against whichever source is active.

## Token permissions (GitLab catalog only)

The `COCKPIT_MODULES_TOKEN` token, created in the app under Settings > Keys, gets the
**Developer** role and the scopes `api`, `read_api`, `read_repository`, `write_repository`. The
set is deliberate:

- `read_api` and `read_repository` are enough for the app to read the catalog and download a
  module's files on install.
- `api` is what lets the app create a branch and open a merge request through the REST API.
  `read_api` is read-only, and `write_repository` covers git over HTTPS only and does not reach
  the REST API - without `api` the token reads the catalog and silently fails to open a merge
  request.
- The Developer role, not Maintainer, is an advantage here: with `main` protected, a Developer can
  open a merge request but cannot push to `main`. Review is then enforced by the platform, not by
  a team agreement.

A local catalog needs no token at all.

Once a module is in the catalog, everyone using that catalog sees it in Settings > Modules >
Catalog and can install it with one click.
