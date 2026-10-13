# Plan preflight rules (mission-deck)

> **This file is documentation, not a to-do list.** The executable form is
> **`node scripts/plan-preflight.js <plan-path> [--json]`** — `/new-idea` Phase 4.5 runs that one
> command instead of walking seventeen greps. Read this file when you need to understand *why* a
> finding fired, when you are changing a rule, or when a finding looks wrong. Never re-derive the
> checks by hand: if the script and this file disagree, that is a bug in one of them, not licence
> to check manually.
>
> Exit codes: `0` clean or warnings only, `1` at least one `BLOCK`, `2` the plan could not be read.
> Every finding carries `rule`, `line`, `message` and a one-line `fix`.
> Unit tests: `tests/test_plan_preflight.mjs`.

Each rule below is followed by a **Calibration** note wherever the implementation is deliberately
narrower or wider than the literal wording — those notes are the contract, and removing one
re-introduces a false positive the calibration was added to kill.

---

1. **Required H2 sections** — the plan must contain all of: `## Idea`, `## Context`,
   `## Files to change`, `## Steps`, `## Risks & footguns`, `## Test plan`,
   `## Acceptance criteria`, `## Out of scope`, `## Iteration log`. Any missing -> `BLOCK`.
   *Calibration:* headings are matched case- and punctuation-insensitively (`Risks & footguns` and
   `Risks and footguns` are the same section). `## New files` is optional.

2. **Status field** — the plan must contain a `**Status:**` line. Missing -> `BLOCK`
   (`scripts/plan-status.js` cannot mark the plan without it).

3. **Non-ASCII** — a non-ASCII character inside a fenced code block or inline backticks -> `BLOCK`
   (that is a proposed identifier, path or command). Anywhere else -> `WARN`.
   *Calibration:* typographic punctuation is **legal everywhere and never reported** — em/en
   dashes, curly quotes, ellipsis, arrows, box-drawing. The whole repo writes that way; flagging it
   produced a WARN on nearly every line of every plan. Accented
   letters in prose are reported only as a `WARN` — a plan may quote a label verbatim. Inside a
   code fence, characters within `'...'` or `"..."` are legal (that is UI copy); a backtick is a
   code delimiter in markdown, not a string quote, so it grants no exemption — an accented letter
   inside backticks is a proposed identifier and stays a `BLOCK`.

4. **Hardcoded hex colors** — `#rgb` or `#rrggbb` anywhere in the plan -> `BLOCK`. Colors come from
   `css/ds-tokens.css` / `css/ds-tokens-dark.css`, never literals.
   *Calibration:* a three-character all-digit token (`#123`) is treated as an issue reference, not
   a color. View ids and anchors (`#view-area-a-1`, `#dashboard`) never match, because the regex
   requires the token to end at a non-word character.

5. **Acceptance criteria must be command-verifiable** — every `- [ ]` line under
   `## Acceptance criteria` must contain at least one of: a backtick-wrapped command, `grep`,
   `npm run`, `npm test`, `exits 0`, `MANUAL`, `AC_VIS`, or `file ... exists`. A line with none of
   these -> `WARN`. Fewer than 3 criteria -> `WARN`; zero criteria -> `BLOCK`.

6. **View triple / module completeness** — one rule with two branches, because a new page can
   land in two places and the two shapes are opposites.

   **Module branch (checked first).** A plug & play module under `modules/<id>/` is the DEFAULT
   home for a new page. `## Steps` must name `module.json` and `client/index.js` (or the
   scaffolder `new-module.js`, which writes both). Missing either -> `BLOCK`. A module plan whose
   steps also edit `VIEW_REGISTRY` or `HUB_FLYOUT` -> `BLOCK`: the core gets no entry of any kind,
   because `js/module-host.js` builds the rail item, the flyout, the view sections and the routes
   from `module.json` at boot.
   *Calibration:* the trigger is narrow on purpose — `## New files` names a path starting at
   `modules/<id>/`, or `## Steps` calls `new-module.js`. `modules/` must not be preceded by a
   slash, or `tests/fixtures/modules/fixture-mod/` in a KERNEL plan reads as "this plan adds a
   module" and the branch blocks correct kernel work. It did exactly that on the module-system
   plans before the trigger was narrowed; `tests/test_plan_preflight.mjs` carries the regression.

   **Core-view branch.** When the plan proposes a core view instead, `## Steps` must mention ALL
   THREE of `index.html`, `view-registry` and `core-hubs` (the hub `pages` array;
   `sidebar-flyout-config` is a generated loop over it). Any missing -> `BLOCK` — a
   view registered in fewer than three places exists but is unreachable. The fix hint names
   `new-module.js`, because most plans that trip this rule wanted a module.
   *Calibration:* the trigger is "the plan contains the string `view-section`" OR "`## New files`
   lists a `js/<id>.js` module" — deliberately **not** "the plan mentions any `#view-` id", which
   fired on every plan that merely linked `#view-settings`. A plan whose `## Steps` says
   `node scripts/new-view.js ...` satisfies the rule only if it also names the three files; the
   scaffolder's own help text does, so quoting the command with its effect passes.

7. **View cleanup** — a plan that introduces a view using `setInterval`, `setTimeout`,
   `addEventListener` on `window`/`document`, or an `EventSource`, whose `## Steps` never mentions
   `runActiveViewCleanup` or `view-lifecycle` -> `WARN`.

8. **DS component usage** — a step mentioning `button`, `input`, `modal`, `card`, `badge`,
   `select`, `tabs` or `toast` with no `ds-*` class, `ds-modal`, `ds-select`, `toast.js` or
   "Design System" token in the same step -> `WARN`.
   *Calibration:* a "step" is one top-level list item plus its continuation lines, so a class named
   two lines below the element still counts.

9. **No perspectives** — `data-perspective`, `applyPerspective`, `_VALID_PERSPECTIVES` or
   `perspektyw` anywhere -> `BLOCK`. This repo has no perspective model.

10. **New write endpoint needs a lock** — `## Steps` adds a `POST`, `PUT`, `PATCH` or `DELETE`
    route to `server.js` and no step mentions a lock -> `BLOCK`. Shared writes are lock-protected
    and tmp+rename.
    *Calibration:* any identifier containing `Lock` satisfies it (`withLock`, `withDataTierLock`,
    `_makeChainLock`, the `with<Name>Lock` const `scripts/new-endpoint.js` generates).

11. **New endpoint needs a test** — `## Steps` adds any `/api/` route to `server.js` and
    `## Test plan` mentions neither `test_api_` nor `npm run test:api` -> `BLOCK`.

12. **jsonResponse** — the plan quotes a response written with `res.end(JSON.stringify` or
    `res.write(JSON.stringify` instead of `jsonResponse` -> `BLOCK`.

13. **Gates present** — `## Test plan` must contain both `npm run lint` and `npm test`. Either
    missing -> `WARN`. (`node scripts/gates.js --lint --unit` runs both; naming the npm scripts in
    the plan keeps the criterion greppable.)

14. **Forbidden operations** — `git reset --hard`, `--no-verify`, `kill -9`, `npm start` as an
    agent action, or `POST /api/app/update` -> `BLOCK`.
    *Calibration:* a line carrying a negation marker (`never`, `do not`, `don't`,
    `forbidden`, `avoid`, `instead of`) is skipped. A plan that says "never run
    `npm start` from an agent" is documenting the rule, not planning to break it.

15. **Sub-repo git scope** — a step planning `git add`, `git commit` or `git push` inside
    `data-sub-repositories/` -> `BLOCK`. That is a separate repo, synced through the app UI.

16. **Port literal drift** — a `localhost:<n>` / `127.0.0.1:<n>` / `PORT=<n>` literal other than
    `3001` -> `WARN`. The port comes from `.env` `PORT=`, fallback 3001.
    *Calibration:* the canonical port is a single constant (`CANONICAL_PORT` in
    `scripts/_report.js`), shared with `check-conventions.js`.

17. **Plan writes only under `plans/`** — a step instructing the **planner** (not the implementer)
    to write a file outside `plans/` -> `BLOCK`.
    *Calibration:* fires only on a step that names the planner AND a write verb AND a backticked
    path outside `plans/`. The implementer writing code is the normal case and is never flagged.

18. **Business description present and filled** — the plan has no `## Business description` H2, or the
    section still contains a `{{...}}` placeholder -> `BLOCK`. This is the only part of the plan
    written for a reader who never opens the repo, and Phase 5 prints it before anything else.
    *Calibration:* `<!-- ... -->` comments are stripped before scanning, so the template's own
    guidance comment never fires. A file whose H1 is literally `# {{title}}` is the unfilled
    template: rule 18 checks only that the section exists there, and rules 19-20 are skipped.

19. **Technical language in the business description** — any line of `## Business description` (comments
    stripped) that contains inline code (backticks), a repo path (`js/...`, `server.js`, `/api/...`),
    a file name with a code extension, a `path:line` reference, a `ds-*` class, an HTTP verb
    followed by a path, a `#hash`, or a code concept from the planner's banned list (hub, flyout,
    sidebar, endpoint, route, hash, JSON, module, handler, stub, cache, sync, render, fetch,
    config, registry, scaffolder, dispatch, lock, token, markup, diff, commit, branch) -> `BLOCK`.
    *Calibration:* deliberately a BLOCK, not a WARN — a WARN was the earlier setting and
    the jargon shipped anyway. The list lives in `JARGON` in `scripts/plan-preflight.js`; word
    matches are case-insensitive and cover inflections through `\w*`. Legitimate UI words
    ("section", "menu", "card", "search box") are not on the list on purpose: the section should
    name what the user sees on screen.

20. **Business description shape** — the section is missing one of the four bold labels
    (`Why we are doing this`, `What changes for the user`, `What the user will see after release`,
    `What this does NOT change`), or the numbered list has fewer than 3 or more than 5 items -> `WARN`.
    *Calibration:* the list is NOT mirrored 1:1 on `## Steps` (that was the earlier design
    and it forced technical steps into pseudo-business sentences). 3-5 items grouped by what the
    user gains is the target; the count check is a WARN because a two-item change can be real.

21. **A module's pages land in a core hub** — the plan proposes a module (rule 6's test) but
    `## Steps` carries no `--hub <id>` on the `new-module.js` call, the plan body never mentions
    `sidebar.hub` / `"kind": "page"`, and an own-shape manifest (`"kind": "item"` or `"hub"`) is
    not explained by a sentence mentioning the hub, the rail or the flyout in `## Context` ->
    `WARN`.
    *Calibration:* a WARN, not a BLOCK — an own rail entry is a legitimate shape, it just has to
    be a decision. The hub list in the fix hint is read from `js/core-hubs.mjs` at run time, never
    copied. The interview owns the question (Q1b in `templates/questions.md`); this rule only
    catches the plan that skipped it.

22. **A new module declares its business area** — a scaffold invocation in `## Steps`
    omits `--area` -> `WARN`. The fix is to resolve Q1c and pass the explicit area.
    *Calibration:* applies to creating a module, not to merely editing an existing module
    or describing the generator. An area is independent of the Q1b menu hub and has no
    default. The argument must belong to the scaffold command, not an unrelated step.
