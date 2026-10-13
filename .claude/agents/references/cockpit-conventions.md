# Mission Deck conventions (canonical reference)

Read by `cockpit-guardian`, `idea-implementer` and `idea-planner`. Two pages, no more.
Everything here is a rule a linter cannot see. Violations are BLOCK unless marked WARN.

## 1. ASCII code, English copy

Two halves of one rule.

**Code is ASCII.** Identifiers, comments, log lines, file names, view ids, API paths, CSS class
names, slugs and commit messages: ASCII only. Any non-ASCII byte outside a UI string literal,
an HTML text node or an HTML attribute value is a BLOCK. Check:
`LC_ALL=C grep -n '[^[:print:][:space:]]' <file>`.

**Copy is plain English.** Every string that renders to a person - HTML text, `<title>`,
`placeholder`, `aria-label`, `title`, toast text, error and status messages, empty states,
button labels, prose in `docs/`, `templates/` and `README.md` - is written in clear, consistent
English: `Settings`, `Save changes`, `Connection error`, `More`, `Send request`. Sentence case for
labels and buttons; one term per concept across the app. The same rule applies to every module
under `modules/` - see `modules-template/README.md`.

**The exception inside a string literal:** a literal that is an id, a path, a key, a CSS class, a
branch name or a value that is COMPARED rather than displayed stays ASCII, even though it sits
inside quotes. `'feat/*'`, `'#view-settings'`, `'/api/settings/env'`, `status === 'ready'`
are never reworded as copy. Rule of thumb: if it is one token with no space, it is probably not copy.

## 2. Design System classes are mandatory

Every interactive or structural element uses the DS classes from `css/ds.css`:

| Element | Class |
|---|---|
| Button | `ds-btn ds-btn--primary` / `--secondary` / `--tertiary` / `--danger` - one `ds-btn--primary` per view, big in the `page-header-actions` slot and in a `ds-modal-footer`, `ds-btn--sm` everywhere in content (section 2a) |
| Card / panel | `ds-card` |
| Badge / chip | `ds-badge` |
| Inline message | `ds-callout` - a flex ROW; prose with more than one block goes inside ONE wrapping `<div>` (section 2, `ds-callout-stack`) |
| Text field | `ds-input` |
| Tabs | `ds-tabs-list` (+ `ds-framed-tabs` when inline) + `ds-tab` |
| Segmented control | `ds-segmented` wrapper + `ds-segment` buttons |
| Select | `js/ds-select.js` (not a bare `<select>`) |
| Toast | `js/toast.js` into `#ds-toast-region` |
| Modal | `js/ds-modal.js` |
| Metric tiles (a row of numbers per team / location / period) | `ds-stat-row` > `ds-card ds-stat-subject` + N x `ds-card ds-stat` (`ds-stat-value[--success/--warning/--danger]`, `ds-stat-label`) |
| Section head inside a view (chart block, table block) | `ds-section-head` > `h2.ds-section-head-title` + `ds-section-head-actions` |
| Expandable table row | a `button.ds-row-toggle[aria-expanded][aria-controls]` in the first cell, `span.ds-row-toggle-chevron` aria-hidden |

**Some DS classes are half a component, and the missing half renders as broken chrome rather than
as nothing** - which is why prose alone never catches it. `scripts/check-conventions.js` WARNs on
all three (`ds-tabs-variant`, `ds-segment-wrap`, `ds-callout-stack`); it warns rather than blocks
because the right answer depends on the composition, which is yours to decide:

- **Tabs have two shapes and picking the wrong one shows.** Bare `ds-tabs-list` is the FULL-WIDTH
  page strip: its `border-bottom` is the rule that runs under the content it switches, so it takes
  **a row of its own** - never a slot in a filter row. With `ds-framed-tabs` it is a self-contained
  bordered box (`border`, `radius`, `width: fit-content`), for tabs that sit INSIDE something: a
  toolbar, a card, a modal header. Ask which one this is. A 50px framed box wedged between a 36px
  segmented pill and a stats line is the failure mode both variants exist to avoid.
- **`ds-segment` is a CHILD of `ds-segmented`**; the wrapper owns the pill track, the segment owns
  nothing but its own label. A `ds-segment` outside a `ds-segmented` is an unstyled button.
- **`ds-callout` is a flex ROW, not a text box.** `css/ds.css` gives it `display: flex; align-items:
  center` for an icon, one line of text and a button side by side - so every direct child is a flex
  item. A build summary written as `<strong>Done.</strong><div>counts</div><ul>...</ul>` straight
  into the callout paints as three COLUMNS, the heading floating mid-height next to a tall list
  (a module build summary, 2026-09-13). Put the whole prose - heading, counts, lists - inside ONE wrapping
  `<div>` and stack it there: `<div class="ds-callout ds-callout--success"><div>...</div></div>`,
  the shape every other callout in `js/` already has. The only thing that belongs NEXT to that
  wrapper is an action button. The checker reads the literal markup on one line and tracks nesting,
  so a summary assembled from several `${...}` parts on separate lines is yours to catch by eye.

When in doubt, open the view next to Settings and compare: if two controls in one row differ
noticeably in height, the composition is wrong even when every class is right.

An ad-hoc `<button class="my-btn">`, a hand-rolled modal, or a `<div>` styled to look like a card
is a BLOCK. No hardcoded hex colors in `styles.css` or inline styles — use the tokens from
`css/ds-tokens.css` (light) and `css/ds-tokens-dark.css` (dark). Icons come from
`/assets/icons/ds/<name>.svg`, rendered as `<img class="nav-icon">`.

`css/ds.css` + the token files are the implementation and the reference; the icon set's catalog is
`assets/icons/ds/manifest.json` (slug, name, size, file). An icon slug not in that manifest does
not exist.

## 2a. Action row and button hierarchy

One hierarchy everywhere, primary-first, 16px gap between buttons in a group:

- `ds-btn--primary` — exactly ONE per view: the action the view exists for. Never the local
  "Refresh". Never the only button when the action is destructive (that is `--danger`).
- `ds-btn--secondary` — alternatives of the same weight.
- `ds-btn--tertiary` — navigation, links, "more", "Cancel".
- `ds-btn--danger` — irreversible deletion only, always behind a confirmation, never the sole
  primary on a view.
- Size: **big** (48px) in the view header and in a modal footer; **small** (`ds-btn--sm`, 32px)
  everywhere in content — a table row, a card, a filter bar.
- Order: primary first, everywhere, including a modal footer (`[Save][Cancel]`, never the
  reverse).

**The header slot.** `js/module-host.js` builds `<div class="page-header-actions" id="<viewId>-actions">`
as a sibling of `.view-data` for every module view (the same pattern as the `msb-bar` sync strip) -
outside `root.innerHTML =`, so repainting the view's content never wipes it. A module paints it in
EVERY `render()`, never only from `init()`: a data reload re-enters the view from a pristine copy
(see `modules-template/README.md`), so the slot comes back as a fresh element with no content and no
listeners. Because the slot sits outside `#<viewId>-root`, a module's delegated click listener on the
root does not see clicks inside it - wire the slot separately, idempotently, and drop both listeners
in `registerViewCleanup`. `.ds-actions` / `.ds-actions--end` (`css/ds.css`) is the ready-made content
row (flex, 16px gap) for buttons that are NOT in the header slot.

**Link as a button.** `<a class="ds-btn ...">` to an external address carries
`target="_blank" rel="noopener noreferrer"` and an external-link icon. A link that currently leads
nowhere is `<button disabled>`, never a bare `<a>`.

**Async work.** An async handler that a button starts wraps its body in `try/finally` and sets
`aria-busy="true"` on the clicked button for the duration - DS paints a loading ring in place of the
text (`css/ds.css`) and a screen reader hears that work is in progress. The button's text never
changes for this.

**Inline form in a card.** When the save button belongs to ONE field rather than to the whole view
(e.g. a single text box), it stays primary SMALL inside `.ds-actions` directly under the field, and
the view header slot stays empty - the button belongs to the field, not to the view.

**The gate.** `node scripts/check-conventions.js --modules` carries five WARN rules for this
(never BLOCK - the right read needs a human, same as `ds-tabs-variant`):
`btn-primary-per-view` (more than one big primary on one file - a modal footer's own primary,
within 6 lines after `ds-modal-footer`, and a `data-skel` skeleton duplicate do not count),
`btn-header-size` (`ds-btn--sm` on or near a `page-header-actions` line - fires on the class literal,
which only `js/module-host.js` and `js/prototypy.js` write; a module paints the slot by id via
`getElementById`, so this WARN guards the one creation site, not every module diff),
`modal-a11y` (a `ds-modal-overlay` with no `js/ds-modal.js` import and no `role="dialog"` anywhere in
the file), `window-confirm-in-module` (module client code only - a raw `confirm(...)` instead of
`confirmDsModal`), `icon-btn-aria` (a single-line icon-only `<button>` with no `aria-label`),
`ds-callout-stack` (a `ds-callout` opening tag followed on the same line by two block children, or
one block next to loose text or a `${...}` - the flex row would paint them as columns; section 2). Four more from section 2c: `clickable-non-control` (CSS `cursor: pointer` under a selector
naming no control), `flex-wrap-tiles` (`flex-wrap: wrap` on a tile/stat/metric/panel row),
`flex-on-table-cell` (`display: flex`/`grid` on a `<td>`/`<th>`) and
`tabs-aria-half` (`role="tab"` with no `tabpanel` / `aria-controls` in the change).

## 2c. Layout rhythm, metric tiles and keyboard access

Three things a view gets wrong when nobody says otherwise, written down after the Sprint Stats
port (2026-09-13) shipped all three at once and two reviewers plus the checker let them through.

- **A row of metric tiles is a GRID that fills the page, one row per subject.** `ds-stat-row` is
  `label cell + N equal tiles` on `grid-template-columns`, so tile 3 of Atlas sits exactly over
  tile 3 of Borealis and the row is as wide as the content column whatever N is. `display: flex;
  flex-wrap: wrap` on a tile row is the failure mode: it packs two subjects per line at whatever
  width the numbers take and nothing lines up (`flex-wrap-tiles` WARN). Chart panels follow the
  same rule - `grid-template-columns: repeat(4, minmax(0, 1fr))` with a narrower fallback, never
  `auto-fit` at the app's 1100px content width, which yields three columns and an orphan. And
  `minmax(0, 1fr)`, not `minmax(320px, 1fr)`: an SVG child otherwise refuses to shrink.
- **Never put `display: flex` or `grid` on a `<td>`/`<th>` - the layout goes on an inner
  `<div>`.** A styled cell stops being a `table-cell`, so it no longer stretches to the row height:
  its own height (e.g. one line of icon buttons) stays fixed while the content cells grow to two
  or three lines, and the cell's `border-bottom` from `.ds-table td` draws at that fixed height,
  not at the row bottom - so the action column's dividers drift away from the content column's,
  more with every taller row. This is the actions-column bug, hit twice (Sprint Review topics
  table and a module access table, 2026-09-13). Keep the cell plain
  (`white-space: nowrap` if the buttons must not wrap) and wrap the buttons in
  `<td><div class="...-actions-row" style="display:flex">...</div></td>`. `flex-on-table-cell`
  (WARN) catches a class used on a `<td>`/`<th>` whose CSS sets flex/grid, and a bare `td`/`th`
  element selector doing the same.
- **Sections inside a view have one rhythm.** Every block after the first opens with
  `ds-section-head` (title left, that block's own controls right, `--space-32` above, `--space-12`
  below). A bare `<div class="x-section-title">` with an 8px margin and the chart's arrows glued
  to the word is how a page reads as one undifferentiated run of content.
- **Two-column text (label + value, team + goal) is a grid, never `min-width` on the label.** A
  linked label (`a.ds-btn--sm`) and a plain one have different widths, so `min-width: 110px`
  aligns nothing; `grid-template-columns: max-content 1fr` (or a fixed 140px) aligns both.
- **Everything a mouse can click, a keyboard can reach.** A clickable `<tr>`, `<td>`, `<div>` or
  avatar is not focusable and a screen reader cannot open it: put a real `<button>` inside the
  cell (`ds-row-toggle` for an expandable row, `ds-icon-btn` for an icon, `ds-btn--tertiary` for
  a link-like action) and bind the click there. `cursor: pointer` on a selector that names no
  control is the tell (`clickable-non-control` WARN). Every DS control draws a `:focus-visible`
  ring from `css/ds.css`; a module never needs its own and must not `outline: none`.
- **ARIA is all or nothing.** `role="tab"` needs `aria-selected`, an `aria-controls` naming the
  panel and a `role="tabpanel"` with that id; an expand button needs `aria-expanded` and
  `aria-controls`; a `role="dialog"` needs `aria-modal` and `aria-labelledby` (`js/ds-modal.js`
  does that for you). Half the pattern announces a control that leads nowhere (`tabs-aria-half`
  WARN). If the roles cost more than they give, plain buttons with clear labels are the honest
  choice.
- **`title` alone is not a tooltip.** It never shows on touch and assistive tech reads it
  inconsistently. Text truncated with `...` keeps its full text in `aria-label` (or in the rendered
  markup, clamped by CSS); a glyph-only control keeps `aria-label` (`icon-btn-aria`).
- **Async work on a button sets `aria-busy="true"` for its whole duration** - the DS paints the
  in-flight state from that attribute and a screen reader hears it. `disabled` alone hides the
  control from the tab order with no explanation.

**Porting a view from another app is a layout contract, not only a data one.** The
plan names the source URL (the source app's own address and hash, on its port) and lists the layout parity the copy
must keep - tiles per row, panels per row, section order, what sits in the header slot - and its
`AC_VIS` says "side by side with the source at 1440px". The frontend implementer screenshots
both before reporting; the Playwright verifier compares both. A "faithful copy" that stacks the
tiles 2+2 and the charts 3+1 is not a copy, however right every number is.

## 2b. Modal and confirmation

`js/ds-modal.js` exports `openDsModal(el, opts)`, `closeDsModal(el)` and
`confirmDsModal({ title, body, bodyHtml, okLabel, cancelLabel, danger, dismissValue, trigger })` ->
`Promise<boolean>`. Three layers, and the closing behaviour is opt-in on purpose - several core
callers (`js/sub-repo-sync-stream.js`, progress modals) open a window that must NOT vanish under a
running operation:

- **Always** (with or without `opts`): `hidden`/`.open` toggling, `role="dialog"`, `aria-modal`,
  `aria-labelledby` (derived from `.ds-modal-title` when present), first focus into the dialog.
- **Only when `opts` is passed**: Escape closes it, a click on the overlay closes it, focus returns
  to `opts.trigger` on close.
- **`opts.dismissible === false`** turns the closing behaviour back off for a progress window that
  must not be dismissed mid-operation (`openDsModal(overlay, { dismissible: false })`).

A modal footer (`.ds-modal-footer`, gap 8px, unchanged) always reads primary-first:
`[Save/Delete][Cancel]`, never the reverse. `confirmDsModal` builds exactly that shape; X, Escape
and an overlay click all resolve to `opts.dismissValue` (default `false`), so a caller that needs a
real third answer (e.g. a "skip this step" choice) passes `dismissValue: null` instead of writing
its own modal. The three values then mean exactly: `true` = do it, `false` = the Cancel button =
continue WITHOUT the step (the caller keeps going), `null` = X / Escape / overlay / navigation =
abort the whole chain (a "build without Jira" button is `false`, closing the window is `null`). A route change while a confirm
is open, and the `navigate()` sweep in `js/app.js`, both resolve the promise with `dismissValue` -
a confirm can never leave its caller pending.

**Documented debt.** The core's own modals (`js/*-modal.js`, `js/settings-moduly.js`,
`js/prototypy.js`, `js/module-area-modal.js`, `js/settings-moduly-katalog.js`, `js/settings.js`) keep
their `[Cancel][OK]` footer order and are not rewritten by this plan - a separate plan owns that.
`window.confirm` behind `stashConfirmText` (`js/settings.js`, `js/onboarding-wizard.js`,
`js/update-modal.js`, `js/update-banner.js`, `js/stash-modal.js`) is a documented exception: the
`window-confirm-in-module` gate rule above applies to module client code only, never to these core
call sites.

## 3. Modules first, then the view triple

**A new page belongs in a module unless there is a reason it cannot.** A module is a directory
`modules/<id>/` carrying its own manifest, client, optional server and tests. The core is not
edited at all: `js/module-host.js` reads `GET /api/modules/manifest` at boot and builds the rail
item, the flyout, the `#view-<id>` sections and the `VIEW_REGISTRY` entries from `module.json`.

```
modules/<id>/
  module.json        schemaVersion 1, id, name, version, area, sidebar { label, kind }, views[]
  client/index.js    export const views = { '<id>-<view>': { init(deps), render(subPath, opts) } }
  client/style.css   optional, DS tokens only
  server/index.js    optional, module.exports = (ctx) => ({ routes: [...] }), mounted at /api/m/<id>/
  tests/test_*.mjs   picked up by `npm test` on its own
```

Scaffold with `node scripts/new-module.js <id> "<Label>" --area "<Area>"` — never by hand, and never by copying
`modules-template/`. Two or more `--views` makes it a `hub` with a flyout; one view makes it a
plain rail item. View ids MUST start with `<module-id>-`; the loader rejects the manifest otherwise.

Every module declares one business `area`, independent of `sidebar.hub`. Creation, install,
import and publication require it; only reads of legacy modules/catalog entries tolerate
its absence. The scaffold has no default area: use the explicit interview answer.

Three consequences worth holding on to:

- **A module plan that edits `VIEW_REGISTRY` or `HUB_FLYOUT` has misunderstood the contract.**
  That is a BLOCK in `plan-preflight.js` rule 6.
- **`modules/` is gitignored**, so a module never shows up in a diff. Diff-scoped tooling is blind
  to it: use `node scripts/check-conventions.js --modules` to hold module code to the same rules.
- **Modules run without isolation**, in the browser and in the Node process. That is a deliberate
  decision, written down in `modules-template/README.md`; do not silently "fix" it with a sandbox.
- **A module reaches the team through a merge request, never a direct push.** `POST
  /api/modules/publish` (the "Publish" button on the module card) opens a branch
  `module/<id>-<date>` in the shared catalog repo, commits the module plus its `catalog.json`
  entry, and opens the MR. The catalog's `main` is protected, so nothing - not a person, not the
  app - writes to it directly. The token that does this needs the `api` scope and the Developer
  role; both are set in `GITLAB_TOKEN_TARGETS` and locked by `tests/test_identity_tokens.mjs`.

The view triple below still governs the CORE's own pages — dashboard, settings and the like. Reach
for it only when the change genuinely belongs to the shell rather than to a module.

## 3a. The view triple (core pages only)

A core view is only "registered" when all three of these exist. Missing any one is a BLOCK:

1. `index.html` — `<div class="view-section" id="view-<id>">` inside the shell.
2. `js/view-registry.js` — a `VIEW_REGISTRY` entry keyed `<id>` with `importFn` (lazy `import()`),
   `render` and `runInit`.
3. `js/sidebar-flyout-config.js` — a `HUB_FLYOUT` entry under the right hub, so the item actually
   appears. Adding an `<a class="sidebar-item">` to `index.html` alone does NOT make a view
   reachable. Note that `HUB_FLYOUT` ships EMPTY: the placeholder hubs were removed and every hub
   in a running app is contributed by a module at boot. A core page therefore needs its own
   deliberate hub, which is another reason most new pages belong in a module.

Navigation is hash-based: the URL hash is the bare view id, `#<id>` (sub-paths `#<id>/<tab>`);
`view-<id>` is only the section's element id - a hash `#view-<id>` is unknown to the router and lands
on the dashboard. The view module exports `render<Name>View()` and
`init<Name>()`; anything that registers timers, intervals or listeners must unregister them via
`runActiveViewCleanup` (`js/view-lifecycle.js`).

## 4. No perspectives

This repo has no perspective model. `data-perspective` attributes, `_VALID_PERSPECTIVES`,
`applyPerspective()` and per-perspective sidebar duplicates do NOT exist here and must not be
introduced. Any `data-perspective` in a diff is a BLOCK.

## 5. Sidebar

Default state is collapsed (rail 72px, expanded 300px). The state is carried by BOTH
`#sidebar.collapsed` and `body.sidebar-collapsed`, persisted under `localStorage` key
`cockpit.sidebarCollapsed`. Toggling only one of the two classes is a BLOCK.
Theme boot is `js/theme-boot.js`, loaded blocking before the stylesheets, key `cockpit-theme`.

## 6. server.js

Single file, no framework. Sections are delimited by `// -- Name --` style headers
(`// ──` box-drawing in the file); a new endpoint group gets its own header and goes into the
matching section, never appended at the bottom.

- Every JSON response goes through `jsonResponse(...)` (gzip + ETag). Never `res.end(JSON.stringify(...))`.
- Static files go through `serveStatic` (path-traversal guard + `cachePolicy`).
- Every write path that more than one client can hit is wrapped in `withLock(key, fn)` and writes
  tmp + rename. A bare `fs.writeFileSync` on a shared JSON file is a BLOCK.
- POST handlers keep the Origin check and the rate limiter — do not bypass them for a new route.
- `PORT` is resolved once: `parseInt(process.env.PORT,10) || parseInt(process.argv[2],10) || 3001`.
  Do not re-read `process.env.PORT` inline. Same for `JIRA_BASE_URL` — one constant, not a repeated literal.
- `if (require.main === module) { ...listen } else { module.exports = { ...pure functions } }` so
  tests can import without starting a server.

## 7. Tests

Every new endpoint gets a test. `tests/test_*.mjs` are unit tests (`node --test`, no server);
`tests/test_api_*.js` spawn the server and run sequentially. A new route in `server.js` with no
`tests/test_api_*.js` case is a BLOCK. New pure helpers in `js/` get a `tests/test_*.mjs` case (WARN
if missing, BLOCK if the helper carries branching logic).

Gates: `npm run lint` (`--max-warnings 0`) and `npm test`; `npm run test:api` when `server.js` or
`tests/` changed. Never `--no-verify`, never an `eslint-disable` added purely to pass the gate.

## 8. Git and process

- `git reset --hard` is forbidden (deny rule + PreToolUse hook). Use `git stash`, `git restore`, or
  `git reset --soft`.
- Git scope is the main repo only. Never `git add/commit/push` inside `data-sub-repositories/` —
  those are separate repos synced through the app UI.
- Agents never commit. The human reviews the diff and commits.
- Restart the server with `curl -s -X POST http://localhost:3001/api/settings/restart`, then poll
  `GET /api/app/version` until it answers. Never `npm start` from an agent, never `kill -9`.
- Every spawned git goes through `_gitNoPromptEnv()` (server.js, mirrored in
  `scripts/version-autobump.js`) and every remote op carries `-c credential.helper=`. The app
  authenticates with its own token in the URL and must never reach the machine's credential store:
  `GIT_TERMINAL_PROMPT=0` covers only the tty, so a git spawned from an editor terminal inherits
  `GIT_ASKPASS` and pops a "GitLab token" input box in the editor instead of failing. New git call
  site? Use the helper, never a bare `{ ...process.env }`.
- Every child process in the server process gets `windowsHide: true` from `scripts/_cp.js`, which
  patches the `child_process` exports in place before anything else loads - `server.js`,
  `scripts/_module-git.js` and every `modules/<id>/server/*.js` alike. It exists because the
  server restarted through the API runs with NO console on Windows (`detached: true` is
  DETACHED_PROCESS), and without the default every git/npm child opened its own console window.
  What the patch cannot cover is a literal `detached: true`: Win32 ignores CREATE_NO_WINDOW next to
  DETACHED_PROCESS, so the child has no console and ITS children open visible ones. Write
  `detached: process.platform !== 'win32'` (the process group is a posix concept anyway) and kill
  the tree with `taskkill /T` (`_toolKill`) on Windows; the restart child is the one deliberate
  exception. `check-conventions` rule `detached-on-win32` (WARN) reads for it.
  The second thing it cannot cover is an INHERITED stdio fd, and that one looks harmless at the
  call site: libuv adds CREATE_NO_WINDOW only when no stdio slot is `UV_INHERIT_FD` ("Avoid
  creating console window if stdio is not inherited", `src/win/process.c`), so `stdio: 'inherit'`
  - or a bare numeric fd, or `process.stdout` - drops the flag however `_cp.js` set it. Three
  `npm install` spawns opened a console window on every update path until `_spawnNpmInstall`
  replaced them with `['ignore', 'pipe', 'pipe']` plus forwarding. Draining is mandatory, not
  tidiness: an undrained pipe blocks the child past the 64 KB buffer, `'close'` never fires and
  the respawn hanging off it never runs. `check-conventions` rule `stdio-inherit-in-process`
  (WARN) reads for it, scoped to `server.js`, `scripts/_*.js` and module server code - a CLI
  entry point under `scripts/` is run from a terminal and `'inherit'` is right there.
- Never call `POST /api/app/update` from an agent — it resets the working tree to `FETCH_HEAD`.
- Screenshots: `filename` passed to `browser_take_screenshot` must start with
  `user-data/screenshots/` (or be omitted). The MCP resolves a filename against the repo root
  and ignores `--output-dir`, so a bare name lands in the root. Never an image in the repo root:
  hook, `.gitignore` and `check-conventions` (R13 `root-image`) all guard it.

## 9. Data

One data repo: `data-sub-repositories/ds-data/` (gitignored, env `DATA_TIER_0_DIR`,
`DATA_TIER_0_REPO_URL`, token `COCKPIT_DATA_TOKEN`). Files under it are served read-only at
`/data-sub-repositories/ds-data/...` with `no-cache`. App cache (`data/`) holds
`server-<port>.pid`, `app-update.json`, `sync-log.json` and is gitignored.
Per-person preferences live in `user-data/` (e.g. `user-data/agent-model-preferences.json`),
never in the data repo.
