---
name: kudos
description: Generates a static .html page that summarises a contribution and congratulates the work on a branch or in a merge request, always on the template
  `.claude/skills/kudos/templates/kudos.template.html`, and saves it to
  `user-data/kudos/`. Use when the user says "make a kudos page", "congratulations html",
  "contribution summary", "summarise branch X", "celebrate this MR" or calls /kudos
  <branch|MR|current>. Analyses the diff, the commits and the matching plan in `plans/` to write
  specific praise, an optional "what we added" section and ideas for the future.
---

# Kudos - contribution summary -> HTML

> **TL;DR:** Point it at a branch, an MR number or `current`; the skill analyses the contribution
> (diff against `main`, commits, the matching plan in `plans/`) and builds a **static `.html`**
> (zero JS), **always** on `templates/kudos.template.html`, saved to
> `user-data/kudos/<date>-<slug>.html`. The styling is fixed - the skill picks and fills the
> components. The celebrating part must be **generous**; the extras never bury it.

## Args

`/kudos <target> [author]` - `<target>` is optional:

- **`current`** or nothing -> the current branch (`git rev-parse --abbrev-ref HEAD`) against `main`.
- **A branch name** -> e.g. `feat/am-050926-assets`.
- **An MR number** -> e.g. `12` or `!12` -> resolve the source branch through the GitLab API.

`[author]` is optional - when missing, take it from the MR or from `git log` (the author of the
commits on the branch); when ambiguous, ask one question.

## Prerequisites

- **Branch / current:** local git only, zero dependencies.
- **MR number:** GitLab API. The project from `git remote get-url origin`, the token through
  `curl -s http://localhost:3001/api/bitwarden/env` (key `COCKPIT_APP_TOKEN`) - **never from
  `.env`, tokens do not live there**. No token or a locked Bitwarden vault -> tell the user and
  suggest passing the branch name instead of the number. The token never reaches a log or the
  output file.

## Steps

1. **Settle the target and the base.** The base is `main`. For an MR number fetch `source_branch`,
   `title`, `author`, `description` from `GET /api/v4/projects/<id>/merge_requests/<n>` (project
   path URL-encoded). Fetch a branch missing locally with `git fetch origin <branch>` - never
   `--force`.
2. **Gather the material (git is the source of truth, not guesses):**
   - `git diff --stat main...<branch>` - the scale (files, lines).
   - `git log main..<branch> --oneline` - the commits and the intent.
   - The plan in `plans/` when the slug or date matches - sections `## Business description`,
     `## Idea`, `## Steps`, `## Acceptance criteria`.
   - Read the key changed files so you can name **specific, real decisions** worth praising.
     Detect: new views (`VIEW_REGISTRY`), new endpoints (`server.js`), new tests, Design System
     use, new scripts in `scripts/`.
3. **(Optional) "What we added":** commits added on top by someone else - describe **what + why it
   matters + that it is already done**. None -> remove the whole `added_section` block from the
   template.
4. **Fill the template.** Read `templates/kudos.template.html`, replace the `{{...}}` slots, repeat
   the `<!-- BEGIN:x -->...<!-- END:x -->` blocks once per item, remove unused blocks together with
   their markers. The slots are listed in the comment at the top of the template.
5. **Save** to `user-data/kudos/<YYYY-MM-DD>-<slug>.html` (ASCII kebab-case slug, from the name or
   the module). `mkdir -p` the directory.
6. **Report:** the file path plus one sentence; remind the user that `user-data/` is gitignored -
   the file opens locally in a browser.

## Quality bar (hard)

- **The celebrating part comes first and is generous:** "What was built" (4-6 cards) plus "What I
  am most proud of" (4-6 numbered, specific points) plus a quote. Extras and future ideas **must not
  bury** the achievements.
- **Praise is specific and true** - drawn from real analysis of the decisions in the code, never
  generic.
- **Ideas for the future** are directions, not complaints.
- **Static HTML, zero `<script>`**, self-contained (CSS from the template, no external
  resources). The copy is in English; the file is UTF-8 with `<meta charset="utf-8">`. The slug
  and the file name stay ASCII.
- **Colours come from the template.** The template uses the Design System tokens through a `<link>`
  to `/css/ds-tokens.css` with a fallback, so the page looks like the app and also opens without a
  server. Do not restyle - only fill the slots.
- **Signature** `{{SIGNATURE}}` defaults to `The team`; `{{SIGN_OFF}}` is a short closing line.

## Slot map (short)

- Hero: `{{CONFETTI}}` (emoji), `{{KICKER}}`, `{{TITLE}}` ("Congratulations, <Name>!"),
  `{{HERO_INTRO}}`, `badge` x N.
- "What was built": `{{BUILT_LEAD}}` + `built_card` x N (`{{CARD_ICON}}`, `{{CARD_TITLE}}`,
  `{{CARD_DESC}}`); `<span class="pill">file.js</span>` is allowed.
- "What I am most proud of": `{{PRIDE_LEAD}}` + `pride_row` x N (`{{N}}`, `{{PRIDE_TITLE}}`,
  `{{PRIDE_DESC}}`) + `{{QUOTE}}`.
- "What we added" (optional `added_section`): `{{ADDED_LEAD}}` + `added_item` x N.
- "Ideas for the future": `{{FUTURE_LEAD}}` + `future_item` x N.
- Footer: `{{SIGN_OFF}}`, `{{SIGNATURE}}`, `{{LANG}}`=`en`, `{{PAGE_TITLE}}`.

## Hard rules

- **Never commit** and never push - the file is local.
- **Never invent credit** - every piece of praise is backed by the diff, a commit or the plan.
- **The token never reaches a file, a log or a prompt.**
- **Do not edit the template** - only fill it.
