# Plug & play module contract

A module is a folder `modules/<id>/` with a `module.json` file. The server discovers modules at
startup, and the client builds rail items and `VIEW_REGISTRY` entries from the manifest.

## Language rule (mandatory)

**ASCII code, English copy.**

- Everything a person reads - labels in `module.json` (`name`, `description`, `sidebar.label`,
  `views[].label`, `views[].title`, `views[].subtitle`), text in `client/index.js`, error
  messages from `server/index.js`, toasts, placeholders, `aria-label`, `title`, empty states - is
  plain, correct English.
- Everything that is an identifier stays ASCII: the module `id`, `views[].id`, file names, route
  paths `/api/m/<id>/...`, JSON keys, CSS class names, variable names, comments and log lines.
  So does a quoted literal that is a key or a compared value (`status === 'done'`) rather than
  displayed text.

The same rule applies to the whole of Mission Deck - see `CLAUDE.md` and
`.claude/agents/references/cockpit-conventions.md`.

## Quick start

```
node scripts/new-module.js <id> "<Label>" --area "<Area>" [--views list:List,report:Report] [--data "<repo>[:<paths>][:read];..."] [--dry-run]
```

`--data` writes the `dataRepos[]` declaration right away (one value, entries separated by `;`),
e.g. `--data "data-tier-0;data-tier-0:team/:read"` - see "Which module owns a file".

The generator writes the whole folder described below - manifest, client, server, contract test
and README - and refuses rather than overwrite an existing module. `--hub <id>` gives the
`"page"` shape (a page in a core hub - the normal choice); without it, two or more views in
`--views` give `"hub"` and a single view gives `"item"`. The rest of this document describes the
contract the generator fills in.

The contract test lands in `modules/<id>/tests/` and runs with `npm test` - no entry in the core
is needed.

You name the area explicitly: e.g. `--area "Product"`, `--area "Engineering"` or
`--area "Operations"`. It is an open list of names, not a list of hubs. In the example
`module.json`, replace `Product` with your own area; the generator never picks one for you.

## Folder layout

```
modules/<id>/
  module.json          - manifest (required)
  client/
    index.js           - ES module exporting a `views` object
    style.css          - stylesheet (optional)
    icon.svg           - sidebar icon (optional; use "module:icon.svg" in the icon field)
  server/
    index.js           - CommonJS: module.exports = function register(ctx) { ... }
  tests/               - the module's own tests
```

## Three module shapes: `page`, `item` and `hub`

`sidebar.kind` decides how the module appears in the side menu. All three shapes work without
any change to the core - the flyout, the view sections (`<div class="view-section">`) and the
`VIEW_REGISTRY` routes are built in the browser from the manifest at startup
(`js/module-host.js`, fed by `GET /api/modules/manifest`). **Nothing is added by hand: no entry
in `index.html`, `js/view-registry.js` or `js/sidebar-flyout-config.js`.**

One thing does NOT belong to a module: **a rail hub belongs to the core.** Eight hubs are
declared in `js/core-hubs.mjs` - Team, Activity, Finance, Initiatives, Support, Knowledge,
Design and Apps - and a module cannot add a ninth. Need a new hub? Propose it to the core. Until
then, either target one of the eight (`"page"`) or build a multi-view module with its own flyout
(`"hub"`).

- **`"page"` - one page (or several) in a core hub. This is the normal choice.** `sidebar.hub`
  names a hub from `js/core-hubs.mjs`. The module gets NO rail item of its own; every `views[]`
  entry becomes a row in that hub's flyout, labelled with the VIEW label (`views[].label`), not
  the module label. Two modules can target the same hub and their pages then sit side by side
  in one flyout:

  ```json
  {
    "sidebar": { "label": "Time off", "kind": "page", "hub": "team" },
    "views": [
      { "id": "time-off-main", "label": "Time off", "title": "Time off", "subtitle": "Team calendar" }
    ]
  }
  ```

  An unknown `sidebar.hub` is a manifest error: the server refuses the install, and a module
  dropped onto the disk by hand gets no menu entry (`js/module-host.js` says so in a console
  warning, and its card in Settings > Modules carries an "Unknown hub" badge).
- **`"item"` - a single view with its own rail item.** No flyout; a click opens the view
  directly. For a tool that belongs to no hub.
- **`"hub"` - a multi-view module with its own flyout.** One rail item under the module label
  (`sidebar.label`), with one row per `views[]` entry:

  ```json
  {
    "sidebar": { "label": "My module", "kind": "hub" },
    "views": [
      { "id": "my-mod-list", "label": "List", "title": "List", "subtitle": "Overview" },
      { "id": "my-mod-report", "label": "Report", "title": "Report", "subtitle": "Summary" }
    ]
  }
  ```

  Only `sidebar.kind` decides the shape, never the number of views: a `"hub"` module with a
  single `views[]` entry still gets a flyout (with one row), because that shape is deliberate -
  further views have somewhere to land. If no flyout of its own is needed, the right shape is
  `"page"` in a core hub.

  Every `views[].id` must start with `<id>-` in all three shapes. A module id may not equal a
  hub id (`support`, `team` and the rest are reserved) - a folder with that name would shadow
  the rail item.

## Area and older modules

Creating, installing, importing and publishing all require a valid `area`. When an older package
has no area, install or import asks for one before the module is added. An update from an older
package keeps the area of the module already installed. Export carries the field with the
manifest.

A temporary exception covers reading an older catalog and loading modules already on disk: a
missing area shows "Area not set" instead of disabling the module. A one-off migration fills in
the local modules present today; it does not publish them to the catalog and sets no default for
later modules.

In Settings both tables show the area and can be filtered by it, together with search. "Menu
location" is separate information: e.g. `Apps (5)` means five pages of this module in the Apps
hub, not a business area.

## module.json - fields

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | number | yes | Must be `1`. |
| `id` | string | yes | Must match the folder name. Format: `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`. ASCII. |
| `name` | string | yes | Display name of the module. |
| `version` | string | yes | Semver version (e.g. `"0.1.0"`). |
| `area` | string | yes | One business area, e.g. `"Product"`, `"Engineering"` or `"Operations"`. Independent of the menu location (`sidebar.hub`). After trimming and collapsing spaces: 2-40 characters, letters, digits, spaces and `- . & + /`; no control characters. |
| `description` | string | no | Short description. |
| `icon` | string | no | A Design System icon name (e.g. `"24-ic-folder"`) or `"module:icon.svg"` for a file in `client/`. |
| `author` | string | no | Who maintains the module. Shown on the card in Settings > Modules. |
| `tags` | string[] | no | Topic labels (e.g. `["data", "reports"]`). Shown on the card. |
| `status` | string | no | Module maturity: `"stable"`, `"beta"` or `"deprecated"`. A badge on the card. The "Publish" dialog opens on this value and SAVES the chosen one back into `module.json`, so a publish as `stable` does not come back as `beta` a moment later. `catalog.json` may override it in the catalog. |
| `sidebar.label` | string | yes | Module label in the side menu (`item`, `hub`). With `"page"` the menu shows VIEW labels, so this field stays the module's name. |
| `sidebar.kind` | string | yes | `"page"` - pages in a core hub (needs `sidebar.hub`); `"item"` - one page with its own rail item; `"hub"` - the module's own flyout. |
| `sidebar.hub` | string | only with `"page"` | A hub id from `js/core-hubs.mjs`: `team`, `activity`, `finance`, `initiatives`, `support`, `knowledge`, `assets` (label "Design"), `apps`. A manifest error with any other `kind`. |
| `views[]` | array | yes | At least one view. |
| `views[].id` | string | yes | Must start with `<id>-` (e.g. `"my-mod-main"`). ASCII. |
| `views[].label` | string | yes | Flyout label (hub) or page title. |
| `views[].title` | string | no | The page's h1 (falls back to `label`). |
| `views[].subtitle` | string | no | Subtitle under the h1. |
| `client.entry` | string | no | Path to the ES module file (`"client/index.js"`). |
| `client.style` | string | no | Path to the stylesheet (`"client/style.css"`). |
| `server.entry` | string | no | Path to the CommonJS file (`"server/index.js"`). |
| `dataRepos` | array | no | Declarative - read and shown, not enforced. An entry is a string (repository id) or an object `{ name, description?, paths? }`. The core ships one team data repository, `data-tier-0`. |
| `dataRepos[].access` | `"write"` \| `"read"` | no | `write` (default) - the module writes these paths and owns them (sends them from its own row). `read` - the module only reads: it gets a row in the "Sync" dialog and a status bar, but no send button; needs a non-empty `paths`. The card marks it "(read)". |
| `dataRepos[].paths` | string[] | no | Paths in the data repository that belong to the module, in three forms: `"file.json"` (an exact file), `"folder/"` (a folder prefix) and `"prefix*"` (a literal prefix, `*` ONLY as the last character, e.g. `"savings-*"`); defaults to the folder `<id>/`. ASCII, no leading `/`, no `..` segment, no `\`. A glob never reaches git - the server matches it against the path list. |
| `envKeys` | array | no | Environment keys the module expects. An entry is a string (`"JIRA_TOKEN"`) or an object `{ name, description? }` - the same shape as `dataRepos`, so one function draws the card. Name: upper-case ASCII (`/^[A-Z][A-Z0-9_]*$/`). Declarative - the card shows them, the core neither sets nor checks any. |
| `widgets` | array | no | The module's dashboard tiles (at most 6). Leaving the field out is valid: the core builds a shortcut tile from the manifest. See "Dashboard widget". |
| `widgets[].id` | string | yes | Tile slug, unique within the module. |
| `widgets[].label` | string | yes | Tile name. |
| `widgets[].description` | string | no | Description in the "Customize dashboard" dialog. |
| `widgets[].client` | string | yes | Relative ASCII path `client/....js`, no `..` (e.g. `"client/widget.js"`). |
| `widgets[].export` | string | no | Export name (a JS identifier), default `renderWidget`. |
| `widgets[].variants[]` | array | yes | 1-6 sizes (presets `s`, `s2`, `m`, `m2`, `l`, `xl`): `id` (slug), `label`, `cols` (`2`, `3` or `6` of the 6-column grid), `rows` (`1` or `2`). |
| `widgets[].defaultVariant` | string | yes | The `id` of one of the `variants`. |

## Module card = manifest

The card in Settings > Modules has no section whose content does not come from `module.json`.
The same holds for the card in the Catalog - and when the module is in the catalog, the curation
file `catalog.json` may override `author` and `tags` and add `summary`, `status`, `featured` and
`order`. The curator has the last word; the manifest is the default.

| Card section | Manifest field |
|---|---|
| Icon | `icon` |
| Name and identifier | `name`, `id` |
| Description | `description` (in the catalog: `summary` from `catalog.json`, falling back to `description`) |
| Version | `version` |
| Author | `author` |
| Side-menu label | `sidebar.label` - only when it differs from `name`, otherwise it would repeat the title |
| Shape badge | `sidebar.kind` + `sidebar.hub` + the number of `views[]` |
| Capability badges | `client.entry` -> "Frontend", `client.style` -> "Styles", `server.entry` -> "Backend" (with the route prefix `/api/m/<id>/` in the tooltip) |
| Labels | `tags` |
| View list | `views[].label`, with `views[].title` and `views[].subtitle` below |
| Declarations | `dataRepos[]` and `envKeys[]` |

An empty field means an empty section. No section is filled by anything other than the manifest
or the curator, so the card cannot drift from the module. One deliberate exception: the
**Enabled / Disabled** badge does not come from the manifest and has no field there - it is the
state of THIS installation, from `data/modules-registry.json`. A manifest field would mean "the
module declares it is enabled" while the registry said otherwise: two answers to one question.

Declarations use a **short form**: the badge is a NAME (of a repository or a key), and the
description and `paths` sit in the tooltip. A reviewer looks for "which repository, which keys",
not for sentences. A folder always means a data repository, a lock always a key.

One implementation draws both cards - `js/module-card.mjs`, which never touches the page document, so the unit tests
(`tests/test_module_card.mjs`) read it directly and check both the shape and the escaping of
every field: `module.json` is written by the module AUTHOR, and a module arrives as a zip or from
the catalog, so every string in it is untrusted input.

## Which module owns a file in the data repository

The "Data sync" dialog shows one row per module under each source that has installed extensions
(`GET /api/sync-modules`), and works out file ownership ON THE SERVER - no client manifest groups
files by itself. Matching works like this:

1. **Default convention:** a file belongs to module `<id>` when it lies under `<id>/` in the data
   repository (e.g. module `demo-hub` - folder `demo-hub/`). No manifest entry is needed to use
   this.
2. **Override with `dataRepos[].paths`:** a module whose files live elsewhere (or in several
   places) declares them explicitly: `"dataRepos": [{ "name": "data-tier-0", "paths":
   ["reports/", "shared/reports.json", "savings-*"] }]`. When a file matches entries of two
   different modules, the FIRST of them in alphabetical `id` order wins - never the longest
   prefix. Keep module scopes disjoint in the manifests.
2a. **A reader declares `access: "read"`:** a module that only READS someone else's data (e.g.
   `team-directory` reads the team roster: `{ "name": "data-tier-0", "access": "read", "paths":
   ["team/"] }`) declares it as a read. Its row shows the counters and dates of those files (a
   "read only" badge, "Send" disabled), but OWNERSHIP - who sends them - stays with the writer
   (a module, a core row or "Core"). The same path can therefore be declared as a read by many
   modules and as a write by one. One module may have two entries for the same repository (write
   and read). The core keeps no per-module list - everything a module writes or reads, it names
   itself in `module.json`. Example with the generator:
   `node scripts/new-module.js reports "Reports" --area "Product" --data "data-tier-0;data-tier-0:team/:read"`.
3. **Repository matching:** the canonical `dataRepos[].name` is the ROUTE ID (e.g.
   `"data-tier-0"`, the same string as in `/api/data/<repoId>/...`); the remote name is accepted
   as an alias and resolved on the server.
4. **The rest goes to "Core":** every file that matches no installed and enabled module lands in
   the "Core" row - just like a file belonging to a module that is disabled in Settings >
   Modules (computed on a fresh disk scan, not on the snapshot taken when the server started).
5. **Sending is per module:** the "Send" button in a module's row sends ONLY that module's paths
   (`GET /api/data/<repoId>/push-stream?module=<id>`) - the rest stays on the computer until the
   next send.
6. **A precise `dataRepos` buys the module a status bar:** every view of a module with a
   non-empty `dataRepos` gets a one-line bar under the page title from the core ("Data up to
   date" / "newer data on the server" / "you have local changes"), built from the same
   file-to-module matching as the "Sync" dialog - the module writes no code for it. An
   `access: "read"` declaration buys the bar too. A module without `dataRepos` (or with an empty
   array) gets no bar.

## The `ctx` object (server)

Passed to `register(ctx)`:

- `ctx.moduleId` - the module id (string)
- `ctx.jsonResponse(res, status, body)` - sends gzipped JSON with an ETag
- `ctx.readBody(req, maxBytes)` - reads and parses a JSON body
- `ctx.checkOrigin(req, res)` - CSRF check; returns `false` and sends 403 when it fails
- `ctx.makeLock()` - a factory for a `withLock(fn)` that serialises writes
- `ctx.dataDir` - path to `data/modules/<id>/` (created automatically)
- `ctx.rootDir` - path to the Mission Deck root
- `ctx.dataTier0Dir` - the plaintext folder of the team data repository (`data-tier-0`)
- `ctx.dataRepoDir(name)` - the plaintext folder of a data repository the module declares in `dataRepos[]` (e.g. `'data-tier-0'`), or `null` for an undeclared one. The core never creates that folder: when it is missing, the source has not been fetched and a write must be refused.
- `ctx.log(...args)` - console.log prefixed with `[module:<id>]`

Routes are mounted under `/api/m/<id>/`. The path `/ping` in a module is `GET /api/m/<id>/ping`.

### Prefix routes (`/*`)

A route path ending in `/*` matches any sub-path starting with that prefix. The rest (the part
after the prefix, without a leading `/`) is put into `req.moduleRest`. An exact match always wins
over a prefix match - `/kb/doc` is served by the `/kb/doc` route even when a `/kb/*` route exists.
Among prefix routes the longest prefix wins, not the registration order - `/kb/pages/*` serves
`/kb/pages/intro` even if `/*` or `/kb/*` was registered earlier.

```js
// Example: GET /api/m/knowledge-base/kb/pages/intro -> req.moduleRest === "pages/intro"
{ method: 'GET', path: '/kb/*',
  handler: (req, res) => ctx.jsonResponse(res, 200, { rest: req.moduleRest }) }
```

Limits:
- `req.moduleRest` is always URL-decoded and has no leading `/`.
- A `..` sequence in the decoded path answers 400 - the module host blocks path traversal.
- A `/*` route has exactly one wildcard; nested wildcards (`/**`) are not supported.

### Child processes (`child_process`) on Windows

Module server code runs inside the Mission Deck process, and after a restart from the app
(Settings > System, an update, a module install) that process has no console on Windows. Every
`git`, `npm` or `python` started without `windowsHide: true` then opens its own visible console
window. Mission Deck handles this for you: `scripts/_cp.js` patches the `child_process` exports
in place, so a plain `const { execFile } = require('child_process')` in a module gets a hidden
console without knowing about the rule. The one thing the patch cannot cover is
`detached: true` - on Windows that flag cancels the hidden console and every child of such a
process opens a window again. A process group is needed only on POSIX, so write
`detached: process.platform !== 'win32'`, and on Windows kill the tree with `taskkill /T`
(`check-conventions` reports a literal `detached: true` as the WARN `detached-on-win32`).

The second such place is `stdio: 'inherit'`. libuv sets `CREATE_NO_WINDOW` only when NO stream
is inherited, so `'inherit'` (or a bare descriptor number, or `process.stdout`) silently cancels
`windowsHide` - even though it looks harmless in the call. Use
`stdio: ['ignore', 'pipe', 'pipe']` instead and forward the streams through
`process.stdout.write` / `process.stderr.write`. Draining the pipe is mandatory, not cosmetic:
an unread pipe blocks the child after 64 KB and the `'close'` event never comes. Pattern:
`_spawnNpmInstall` in `server.js`; `check-conventions` reports it as the WARN
`stdio-inherit-in-process`.

## The `deps` object (client)

Passed to `views[id].init(deps)` and inside `opts.deps` in `views[id].render(subPath, opts)`:

- `deps.navigate(viewId)` - navigate to another view
- `deps.registerViewCleanup(fn)` - registers a callback that clears timers and listeners when the view is left
- `deps.showToast(msg, opts)` - shows a DS toast
- `deps.apiBase` - base URL of the module's endpoints (`"/api/m/<id>"`)

## Buttons and actions

One hierarchy across Mission Deck: `ds-btn--primary` (green) - exactly ONE per view, the action
the view exists for; `ds-btn--secondary` (white) - alternatives of the same weight;
`ds-btn--tertiary` (no border) - navigation, links, "more", Cancel; `ds-btn--danger` (red) - only
irreversible deletion, always behind a confirmation, never as the only primary on a view.
"Refresh" of local data is not a primary. Order in a row and in a modal footer: primary first.

Two sizes: **big** (48px) in the view header and in a modal footer, **small** (`ds-btn--sm`,
32px) everywhere in the content - in a table, on a card, in a filter bar.

**Header slot.** For every module view the core builds an empty `<div id="<view-id>-actions">`
as a sibling of `.view-data` (the same pattern as the `msb-bar` sync bar) - out of reach of
`root.innerHTML =`, so repainting the view content never wipes it. Paint it in EVERY `render()`,
never only in `init()`: after a data sync the core re-enters the view (see below), and the slot
comes back as a fresh element with no content and no listeners.

```js
async render(_subPath, _opts) {
  const actions = document.getElementById(this._viewId + '-actions');
  if (actions) {
    actions.innerHTML =
      '<button type="button" class="ds-btn ds-btn--primary" data-mod-main>Save</button>'
      + '<button type="button" class="ds-btn ds-btn--secondary" data-mod-refresh>Refresh</button>';
  }
  // ... view content ...
}
```

Wire clicks in the slot SEPARATELY from the listener on the view root - the slot lies outside
`#<view-id>-root`, so a delegated listener on the root never sees it. Wire idempotently (a flag on
the view object) and remove it in `registerViewCleanup(cb)`.

**`.ds-actions` / `.ds-actions--end`** (`css/ds.css`) is a ready row of content buttons
(`display: flex`, 16px gap) - use it instead of your own CSS for the gap between buttons in a card
or form.

**Modal and confirmation.** Open a modal with `openDsModal(el, { trigger })` (`js/ds-modal.js`,
a dynamic `import('/js/ds-modal.js')`, because this file must stay importable in plain Node with
no page document) - `trigger` is the clicked element that gets focus back on close. Never
`window.confirm(...)`: use `confirmDsModal({ title, body, okLabel, cancelLabel, danger, trigger })`
instead, which returns `Promise<boolean>` (`true` = OK, `false` = Cancel, Escape or a click on the
backdrop):

```js
const ok = await confirmDsModal({
  title: 'Delete this entry?', body: 'This cannot be undone.',
  okLabel: 'Delete', danger: true, trigger: e.target,
});
if (!ok) return;
```

**Background work.** Wrap an async handler that runs a longer operation in `try/finally` and set
`aria-busy="true"` on the clicked button while it works - the DS paints a spinner in place of the
text (`css/ds.css`) and a screen-reader user hears that work is in progress. Do not swap the
button text while loading.

**A link that looks like a button.** `<a class="ds-btn ...">` to an external address gets
`target="_blank" rel="noopener noreferrer"` and the external icon. A link that currently leads
nowhere is a `<button disabled>`, never an `<a>` without `href`.

**Inline form in a card.** When a save button belongs to ONE field (not to the whole view), it
stays a SMALL primary in `.ds-actions` right under the field, and the view's header slot stays
empty - the content wins, because the button belongs to the field.

**A message in the content (`ds-callout`).** `.ds-callout` is a flex ROW (`display: flex;
align-items: center` in `css/ds.css`) - icon, one line of text and a button side by side. Every
direct child is its own flex item, so a summary written as `<strong>Done.</strong><div>numbers</div>
<ul>list</ul>` paints in THREE COLUMNS, with the heading hanging halfway down next to the list.
Put the whole content (heading, numbers, lists) into ONE wrapping `<div>` and stack it vertically
there - `<div class="ds-callout ds-callout--success"><div>...all the content...</div></div>`; only
an action button may stand next to that wrapper.

The mechanical half of this rule is six WARNs in `node scripts/check-conventions.js --modules`:
`btn-primary-per-view` (more than one big primary per view), `btn-header-size` (`ds-btn--sm` in
the header slot), `modal-a11y` (`ds-modal-overlay` without importing `js/ds-modal.js` and without
`role="dialog"`), `window-confirm-in-module` (a raw `confirm()` instead of `confirmDsModal`),
`icon-btn-aria` (an icon-only button without `aria-label`), `ds-callout-stack` (several direct
children in a `ds-callout`). All of them are WARN, not BLOCK - they need human judgement, like the
existing `ds-tabs-variant`.

## Layout and keyboard

Three things a module gets from the DS for free and should not invent itself
(`.claude/agents/references/cockpit-conventions.md`, section 2c):

- **A row of number tiles** (per team, location, period): `ds-stat-row` with a
  `ds-card ds-stat-subject` cell and N tiles `ds-card ds-stat` (`ds-stat-value`,
  `ds-stat-label`, tone `--success` / `--warning` / `--danger`). It is a full-width grid -
  `display: flex; flex-wrap: wrap` on the tiles breaks them 2+2 and nothing lines up.
- **A block heading inside a view** (chart, table): `ds-section-head` with
  `h2.ds-section-head-title` and `ds-section-head-actions` on the right; the 32px gap above the
  block is in the class, not in the module.
- **An expandable table row**: a real `button.ds-row-toggle` with `aria-expanded` and
  `aria-controls` in the first cell, never `cursor: pointer` on a `<tr>` - a row takes no focus,
  so the keyboard and a screen reader cannot open it. Every DS control draws its own focus ring
  (`:focus-visible` in `css/ds.css`); a module neither adds its own nor resets `outline`.

`node scripts/check-conventions.js --modules` warns on `clickable-non-control`,
`flex-wrap-tiles` and `tabs-aria-half` (tabs with `role="tab"` but no `tabpanel`).

## Refreshing after a data sync

When a person pulls or sends data in the Sync dialog, the files in
`data-sub-repositories/ds-data/` change **under** a view that is already drawn. The core handles
this itself and **the module writes not a single line for it**: the module view is re-entered -
cleanup, the section restored, a fresh import of `client/index.js` and `init` + `render` again.
The effect is the same as F5, without reloading the page.

Three things follow that you need to know when writing a module:

- **Keep caches in the entry file.** Only `client/index.js` is reloaded. A relative import
  (`./<id>-lib.js`) resolves without a parameter, so files next to it stay **one shared
  instance** for the life of the page - data from the data repository remembered in such a
  helper file **will not be refreshed**. Keep helper files stateless (pure functions).
- **View state is lost.** Scroll position, filters, an open modal - everything returns to its
  initial state, because this is a full re-entry.
- **Don't want that?** Expose an `onDataChanged()` method on the view object. If it exists, the
  core calls it instead of reloading - then you decide what to refresh, and the view keeps its
  state:

```js
export const views = {
  'my-view': {
    init(deps) { /* ... */ },
    async render(subPath, opts) { /* ... */ },
    // Optional. The data on disk changed - drop your cache and repaint.
    async onDataChanged() {
      _data = null;
      await this.render('', {});
    },
  },
};
```

## Dashboard widget

The Mission Deck dashboard can show tiles of selected tools. Every tile is a frame (`ds-card`)
drawn by the core: the module icon and name, the tile name and an "Open" link to the module's
first view. The module only supplies the frame's content.

**Contract.** In `module.json` you declare `widgets[]` (table above), and the file named in
`client` exports:

```js
export async function renderWidget(el, ctx) {
  // ctx = { moduleId, widgetId, variant: { id, cols, rows }, apiBase, navigate, signal, kit }
  const res = await fetch(ctx.apiBase + '/overview', { signal: ctx.signal });
  // ...paint into el, escape every string that comes from data...
  return () => { /* cleanup: timers, listeners */ };
}
```

- `ctx.kit` is a set of ready blocks from `js/dashboard-widget-kit.js`: `tiles`, `donut`, `big`, `segments`, `progress`, `bars`, `spark`, `heatmap`, `people`, `avatars`, `timeline`, `pill`, plus `blocks(list, { cols, rows })` (lays blocks out in the frame by size) and `hydrateAvatars`. People's photos come from the team directory (team photo, then GitLab avatar, then initials), so a module carries no photos of its own. Example: `el.innerHTML = ctx.kit.blocks([{ type: 'tiles', tiles: [{ label: 'Open', value: '12', tone: 'neutral' }] }], { cols: ctx.variant.cols, rows: ctx.variant.rows })`. Escape module data when using the kit too.
- `el` is the inside of the frame; do not reach outside it.
- Return a function (or `{ cleanup }`) if you set up timers or listeners. The core calls it when the dashboard is left.
- An error, a rejected promise or no answer within 10 s stays in its own frame: the rest of the dashboard keeps working, and the frame shows "This tile is not responding". Modules still run without isolation (see "Trust model"): a tile that paints outside `el` or loops forever is not stopped.
- Import the widget file without static imports from `/js/` (dynamic imports only inside functions), so the contract test can load it in plain Node.
- A module without `widgets[]` automatically gets a shortcut tile ("Shortcut", 2x1) with its name, description and a link to its page.
- The dashboard layout is each person's choice, saved on this machine (`data/dashboard-layout.json`). Tiles appear after a Mission Deck restart following the install or enabling of a module, just like the menu entry.

**Scaffold:**

```
node scripts/new-module.js <id> "<Label>" --area "<Area>" --hub <hub> --widgets "overview:Overview:s,m"
```

Size presets: `s` Small 2x1, `s2` Small, tall 2x2, `m` Medium 3x1, `m2` Medium, tall 3x2, `l` Wide
6x1, `xl` Wide, tall 6x2. Without the third segment: `s,m,l`. The script prints its proposal in
`--dry-run` mode.

A module reaches the team only through "Publish"; editing a widget locally sends it nowhere.

## Trust model

**No isolation.** Modules have full privileges in the browser and in the Node.js process. Install
only modules you trust. The server loads `server/index.js` with `require()` - it can run any
Node.js code.

## Manual installation

1. Copy this folder to `modules/<id>/`.
2. Change `id` in `module.json` (and `views[].id`) to the target identifier.
3. Restart the server: Settings > System > Check for updates (the restart button).

The `modules/` folder is gitignored - installed modules are not part of the Mission Deck
repository. The bundled catalog in `catalog/modules/<id>/` is.

## The module's local repository

Every module has its own version history - a separate, private git repository in
`modules/<id>/`, with no remote. It is created automatically: when the module is created with
`scripts/new-module.js`, installed from the Catalog or imported from a zip file, and an older
module without history gets an "Initialize repository" button on its card in Settings > Modules.
You save the current state with the "Save version" button in Settings > Modules (or with
`git -C modules/<id> commit` if you prefer the terminal) - nothing happens in the background. This
history stays on your computer only; the way to the team is, as always, the "Publish" button.

## Installing through the UI

Settings > Modules lists every folder in `modules/`, including broken manifests together with the
reason. From there a module can be enabled, disabled, exported to a zip file or removed - and a
ready zip file (your own or one somebody gave you) can be loaded with "Load from file" without
copying anything onto the disk by hand. Every change needs a restart, like the manual install
above.

## Publishing a module to the catalog

A module first lives locally, in `modules/<id>/`. The `modules/` folder is ignored by git, so
until you publish it, nobody but you sees it.

Where "Publish" sends it depends on the catalog source (Settings > Modules > Catalog says which
one is active):

1. **The local catalog (default).** The catalog is the folder `catalog/` in this repository
   (`catalog.json` plus `catalog/modules/<id>/`; `MODULES_CATALOG_DIR` moves it). Settings >
   Modules > the module's card > **Publish** copies the module's files into
   `catalog/modules/<id>/` and adds or updates its entry in `catalog.json`. No token is needed and
   no branch is created - you then commit the change, or open a pull request, with your usual git
   tooling.
2. **A shared GitLab catalog (opt-in).** With `MODULES_CATALOG_REPO_URL` set, the catalog is a
   separate GitLab repository whose `main` branch is protected. **Publish** creates a branch
   `module/<id>-<date>`, sends the module's files with the `catalog.json` entry onto it and opens a
   merge request. This needs the `COCKPIT_MODULES_TOKEN` token with the `api` scope and the
   Developer role - create it in Settings > Keys. You can also do the same by hand: clone the
   catalog repository, copy `modules/<id>/`, add the `catalog.json` entry, create a branch and
   open a merge request.

Once the change is in the catalog, the module appears in Settings > Modules > Catalog for
everyone using that catalog and can be installed with one click.

### Deletions, the publish base and taking over a module

A publish compares the files you send with what the catalog already has under `modules/<id>/`. A
file you no longer have locally is really deleted from the catalog by the publish - it is not an
append-only update. When a publish would delete more than half of the module's files in the
catalog, the app stops and shows the list of what would disappear before sending anything; the
"Publish anyway" button is a deliberate confirmation. When the catalog tree that was read does not
match the module you are sending at all (not even `module.json` is on the list), the publish is
refused with no confirmation - that is a sign the read went wrong, not that you really want to
delete the whole module.

Install, zip import and publish remember which catalog version your copy came from (the
gitignored `data/modules-origin.json`, not `module.json` - that record never reaches the
catalog). The module card in Settings shows that version and date ("From the catalog: 0.1.0,
2026-09-05"), and when you publish on a base older than what the catalog has now, the publish
dialog warns you - you might be overwriting someone's newer work. The warning does not block the
publish.

The catalog also remembers who first published a given `id` (`owner` in `catalog.json`, set once
and never overwritten by the app afterwards). A publish by someone else is not blocked - taking a
module over after its author has left the team is legitimate - but the publish dialog shows a
warning, and on GitLab the merge request title is marked as a takeover so the reviewer sees it at
once.
