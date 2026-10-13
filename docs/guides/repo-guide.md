# A guide to the repository - for people

This document is the one place that explains what this repository is, how it is built and how
work happens in it. It retells in plain language what the files written for agents
(`CLAUDE.md`, `modules-template/README.md`, the agent and skill briefs) say for the machine. You
do not need to read those files to start - you come back to `CLAUDE.md` and `README.md` in stage 3
of the Academy, before bigger changes to a module, and then it is worth reading both in full. This
guide is worth reading at least once, and returning to whenever you lose the thread.

> **How to read this file in VS Code.** Raw Markdown is tiring. Turn on the preview:
> Cmd+Shift+V (Mac) / Ctrl+Shift+V (Windows and Linux) opens it in the same tab, and Cmd+K, V /
> Ctrl+K, V (first Cmd+K, then just V) opens it beside the text. The "Open Preview to the Side"
> icon in the editor's top-right corner does the same.

---

## 1. What it is

**Mission Deck** is a light, local cockpit for a product team. It runs on your computer at
`http://localhost:3001`, not in the cloud. It shows the team's data (roster, activity, finance,
initiatives, knowledge, design system) and, above all, it is **a base everybody adds their own
modules to**.

Three sentences that put everything in order:

1. **The core is shared and stable.** What sits in this repository updates with one button in
   Settings. The core is not where day-to-day work happens.
2. **Team work goes into modules.** A module is your piece of the app in `modules/<id>/`,
   invisible to the core's git. It cannot break the shared application.
3. **Team data lives separately and is encrypted.** The app has no database; JSON files live in a
   separate data repository that is plaintext on disk and only ever encrypted in git.

## 2. What it is made of

No framework, no bundler, no database. Open the repository and you see the whole app with the
naked eye.

| What | Where | In plain words |
|---|---|---|
| Interface | `index.html`, `js/`, `styles.css`, `css/` | One page (SPA) in plain JavaScript. Every screen is a `#view-<id>` section and a `js/<id>.js` file. Navigation by `#hash`. |
| Server | `server.js` | One Node.js file split into `// -- Name --` sections. Each section is one group of `/api/...` addresses. |
| Design System | `css/ds-tokens.css`, `css/ds.css`, `assets/icons/` | Colours, spacing, components (`ds-btn`, `ds-card`, `ds-badge`, ...) and the icon set. No hard-coded colour - always a token. |
| Modules | `modules/` (gitignored) | Your and other people's extensions. Template and contract: `modules-template/`. |
| Module catalog | `catalog/` | The shared catalog: `catalog.json` plus `modules/<id>/`. Install copies from it, publish writes into it. |
| Team data | `data-sub-repositories/ds-data/` (plaintext) and `ds-data-encrypted/` (the git clone) | Roster, photos, Academy progress, prototypes, module data. |
| Documentation | `docs/guides/`, `docs/architecture/`, `README.md` | Getting started, this guide, "Anatomy of a module", Windows notes, architecture notes. |
| Document templates | `templates/` | Requirements, user story, UX brief, meeting notes, HTML report. Finished documents go to `user-data/`, never back into `templates/`. |
| AI working method | `.claude/skills/`, `.claude/agents/`, `scripts/` | Skills (`/something` commands), agents (roles) and scripts that do the mechanical part of the work. More below. |
| Tests | `tests/` | `npm test` (unit) and `npm run test:api` (the server really starts). |
| Plans | `plans/` (local) | Every bigger change starts with a Markdown plan you accept before implementation. |

The left menu has **eight fixed drawers** (hubs): Team, Activity, Finance, Initiatives, Support,
Knowledge, Design and Apps. They belong to the core. A module does not add a ninth - it puts its
pages into one of the eight. That keeps the menu from swelling.

Below the menu are two fixed items: **Start here** (the first-run wizard: environment, Bitwarden,
tokens, keys, data, update) and **Settings** (System, Keys, Agents, Skills, Modules, Users,
Tools, Demo). The dashboard also leads to the **Academy** - the path in which you are reading this.

Sometimes a **Stash** pill appears in the top bar. It means your uncommitted changes are parked to
the side rather than in the files - usually because an update could not run over a dirty tree and
offered "Stash changes and update". That button is everywhere you see an update: the blue banner
at the top, the "Update available" window and Settings > System. It also takes new, not yet added
files. It always asks for confirmation and shows the list. There is no Stash pill when nothing is
parked.

Click it and you see every entry: when it was made, which files it holds ("Show files"), and four
things you can do with it.

- **Apply changes** - the app runs `git stash apply`, never `pop`. The entry stays, so even a
  failed merge deletes nothing.
- **Copy a prompt for Claude** - the easiest way when the entry predates an update. Its base is a
  commit that no longer exists, so conflicts are normal there; paste the copied prompt into Claude
  in the terminal and it carries the changes over.
- **Copy name** - just the entry's name, if you prefer the terminal.
- **Delete entry** - only once you have your changes back. This cannot be undone.

If `<<<<<<<` markers appear in files after "Apply changes", it is not an error: your changes ARE in
the files, they just need reconciling with the new code. While the markers are there, the next
update will not run either.

## 3. Team data and security - in three sentences

- **Data lives in a separate repository**, not in the code. On disk, in
  `data-sub-repositories/ds-data/`, it is plaintext and the app reads it normally. Only an
  encrypted mirror goes to git - one unreadable `.enc` file per file, name included. A person's
  photo does not leak the roster even by its file name.
- **The encryption key** lives in a local, gitignored `.encryption-key` file. Without the key sync
  refuses rather than send plaintext. You get the key from your team and paste it in the
  **Start here** wizard.
- **Tokens for GitLab, Jira, Confluence and integrations do not live in files.** The padlock in the
  top bar fetches them from a Bitwarden vault. You unlock the vault, the app reads the tokens into
  the server process's memory and nothing reaches the disk or the environment.

**Team data.** The core has one data source: `data-tier-0` ("Team data", locally
`data-sub-repositories/ds-data/`) - roster, Academy progress, mural, prototypes and module data,
each module under its own path. More sources are declared in `DATA_REPO_DEFS` in `server.js`
(described in `docs/architecture/data-repos-and-sync.md`).

You sync data from the app - by hand, with the "Sync" button in the top bar or in Settings > System.
Nothing is pulled or pushed silently in the background. **Never** use git by hand in the data
folder - it is a separate repository, and its plaintext copy is not a git repository at all.

## 4. Modules - your place in this app

A module is a `modules/<id>/` folder with four things inside:

| Part | What it does | When you look at it |
|---|---|---|
| `module.json` | The manifest: name, icon, which menu drawer it goes into, which screens it has. | When you change the name or drawer, or add a screen. |
| `client/index.js` | What you see. Code that draws your screen in the browser. | Almost always. |
| `server/index.js` | What you do not see. When the module has to compute, save or ask an outside system. Routes get the `/api/m/<id>/` prefix. | When the screen alone is not enough. Optional. |
| `tests/` | Quality control. Runs with `npm test`. | `/new-idea` writes the tests - you do not have to. |

**A module's life cycle**, as you walk it in the Academy:

1. **Scaffold** with one command - `node scripts/new-module.js <id> "<Label>" --hub <drawer> --area "<Area>"`.
   You choose the business area explicitly, such as Product, Engineering or Operations. It is not
   the menu drawer: every module has one area, and the lists in Settings can be filtered by it.
   The generator writes the manifest, client, server, a test and a README. It refuses rather than
   overwrite an existing module.
2. **Enable** it in Settings > Modules and restart the server (the button is right there).
3. **Grow** it with `/new-idea` in Claude Code - you describe what it should do, get a plan,
   accept it, and the agent implements and tests.
4. **Versions** - every module has its own private git repository with no remote. "Save version"
   in Settings > Modules is its commit. Nothing syncs by itself.
5. **Export** to a zip file (hand it to a colleague) or **publish** to the catalog: the "Publish"
   button copies the module into `catalog/modules/<id>/` and updates `catalog.json`, which you
   then commit or open a pull request for like any other change. Once merged, everybody sees the
   module in Settings > Modules > Catalog and installs it with one click.

A module declares in `module.json` which team data it writes and which it only reads (`dataRepos`,
`access: "read"`) - that is how the "Data sync" window shows its row while the core keeps no list
of modules.

The three things people ask most:

- **Three shapes in the menu.** `"page"` is a page in one of the eight drawers - the normal choice.
  `"item"` is one screen with its own rail item. `"hub"` is a drawer of its own with several
  screens - an escape hatch for someone who really needs a hub the core does not have.
- **No isolation.** A module has full rights in the browser and in the Node process. Install
  modules you trust.
- **Module data** can live in the team data repository (you declare the paths in the manifest),
  so you share it through the same encryption as everything else.

The longer, calmer version of this chapter: [Anatomy of a module](module-anatomy.md).

## 5. How we work here - the method

You work with **Claude Code** in the VS Code terminal. You do not write code by hand - you
describe a change, and the method carries it through plan, implementation and verification. Three
rules hold it together:

1. **Plan first, code second.** Every bigger change starts with a plan in `plans/`, with acceptance
   criteria. You read it (it also renders to HTML), accept or correct it. Implementation starts
   only after acceptance.
2. **An agent never commits.** Changes land in the working tree, you review the diff and you
   commit. No `--no-verify`, no skipping hooks.
3. **Scripts do the mechanical work, not the model.** Convention checks, test gates, change
   digests, view/endpoint/module scaffolds - all of them are scripts in `scripts/`. The model
   spends tokens on judgement, not on `grep`.

### Skills - the `/something` commands

A skill is a packaged recipe for one kind of task. You type it in Claude Code like a command. The
same cards are in Settings > Skills.

| I want to... | Command | What happens |
|---|---|---|
| Build a feature, view, endpoint or fix a bug | `/new-idea` | A short interview, a plan for approval, implementation, blind verification of the criteria. The most important skill here. |
| Make a screen mockup | `/prototype` | A React prototype in the team data repository, on the Design System, with screenshots. |
| Change a mini app (Vite + React) | `/mini` | Same as `/new-idea`, for a registered mini app. |
| Summarise a meeting | `/summarize-meeting` | Picks a template from `templates/meeting-notes/` and fills it from a transcript. |
| Check changes before a commit | `/pre-ship-audit` | Gates, conventions and three auditors (quality, security, tests) over a change digest. |
| Review a branch or MR | `/review-pr` | A graph-aware review: who calls what, what could break. |
| Review all tests | `/qa-audit` | Coverage gaps and test quality across the repo. |
| Write a commit message | `/commit-message` | A Conventional Commits proposal; commits only after your "yes". |
| Clean up after a merge | `/sync-after-merge` | `main`, pull, delete merged branches - always asks. |
| Create or update a Jira issue | `/jira` | A `.md` draft in `user-data/` first, then the API through the local server. |
| Read or write a Confluence page | `/confluence` | Same, the draft always local. |
| Congratulate someone | `/kudos` | A static HTML page summarising the work on a branch. |
| Refresh the planner's repo map | `/refresh-repo-map` | One command, no model. |

### Agents - the roles

An agent is Claude with a specific role, brief and model. Skills call agents; you rarely call them
directly. The same list is in Settings > Agents.

The default `/new-idea` path is **three roles**: a planner writes the plan, an implementer
carries it out, a blind verifier checks the acceptance criteria - it reads only the plan and the
diff, never the implementer's report. The rest join conditionally:

| Role | Who | When |
|---|---|---|
| Planner | `idea-planner` (Opus) | Always at the start of `/new-idea`. Writes the plan, not code. |
| Implementer | `idea-implementer` (Sonnet) - small change; `backend-implementer` + `frontend-implementer` + `engineering-lead-reviewer` - big or two-layer | After the plan is accepted. The lead checks that the layers fit. |
| Blind verifier | `ac-verifier` (Haiku, Sonnet for bigger changes) | Always after implementation. |
| Conventions guardian | `cockpit-guardian` (Sonnet) | Only when the conventions script leaves something to judge or the change touches the Design System. |
| Visual verification | `playwright-specialist` (Sonnet) | Only when the plan has visual criteria. Clicks through a live browser. |
| Bug scan | `bug-auditor` (Haiku/Sonnet) | Only for bigger changes. Verdict SHIP or ITERATE. |
| Auditors | `code-quality-auditor`, `security-auditor`, `qa-automation-auditor` (Opus) | `/pre-ship-audit`, in parallel. |
| Prototypes and mini | `proto-ds-guardian`, `mini-planner`, `mini-implementer`, `mini-verifier`, `mini-bug-auditor` | The equivalents for `/prototype` and `/mini`. |
| Documents and research | `meeting-summarizer`, `researcher`, `reviewer` (Opus) | Meeting summaries, collecting product evidence and reviewing it adversarially. |
| Commit | `commit-message-writer` (Haiku) | `/commit-message`. |

**Rule of thumb for models**: Sonnet for most work, Haiku for mechanical things, Opus for planning
and the hardest judgement calls. You change an agent's model in Settings > Agents - for yourself
only. The defaults for everyone live in `.claude/default-models.json` and come back on every commit.

## 6. Rules that apply to everyone

Briefly. Each has a reason and each is guarded by a script or hook, but it is better to know them
than to bump into a gate.

- **Code in ASCII, copy in plain English.** Identifiers, file names, JSON keys, CSS classes,
  comments and logs are ASCII. Everything a person sees on screen - labels, messages, toasts,
  `placeholder`, `aria-label`, documentation - is clear English. The same goes for modules.
- **No hard-coded colours.** Always a token from `css/ds-tokens.css`.
- **Never `git reset --hard`.** It destroys uncommitted work for good. A hook blocks it for agents;
  people should not use it either.
- **Git only in the core repository and in a module's repository.** Never in
  `data-sub-repositories/` - the app syncs the data.
- **Restart the server from the app** (Settings > System or the button next to a module), not with
  `npm start` from a second window. Two servers on one port is the most common cause of "nothing works".
- **No skipping hooks.** `--no-verify` and an `eslint-disable` added just to pass a gate do not
  pass review.
- **Team work goes into modules, not into the core.** A core change is an exception we discuss,
  not the default path.
- **Parallel core work goes into a separate working copy (git worktree).** When someone already
  works in the main folder, `/new-idea` asks after plan approval "Where should this change be
  made?" and creates a copy in `.claude/worktrees/<slug>` with its own preview port. You review and
  accept the changes in that copy, merge them into your branch, and clean up with one command:
  `node scripts/worktree.js remove <slug>`. Team data and the encryption key never go into the copy.
- **One primary button per screen, in the header on the right.** Deleting and other irreversible
  actions always ask for confirmation, and Escape closes a window.

## 7. Where things are, when you are looking

| I am looking for... | Look in |
|---|---|
| How to install and run from scratch | [`docs/guides/ONBOARDING.md`](ONBOARDING.md), on Windows also [`WINDOWS.md`](WINDOWS.md) |
| What a module is, in plain words | [`docs/guides/module-anatomy.md`](module-anatomy.md) |
| Screen prototypes - where they are, how to add, preview and publish them | [`docs/guides/prototypes.md`](prototypes.md) |
| The full module contract (manifest fields, `deps`, routes) | `modules-template/README.md` |
| A document template (requirements, user story, notes) | `templates/README.md` |
| Helper scripts and what they do | `node scripts/<name>.js --help` - each has help and `--json` |
| Whether my environment is fine | Settings > Tools (Node, git, Python, Bitwarden, Claude, Playwright, GitNexus) |
| Why something does not work | [`docs/troubleshooting.md`](../troubleshooting.md), then `/gitnexus` in Claude Code ("why does X fail?") |
| The technical version of all this, written for agents | `CLAUDE.md` - read it in full before bigger module changes (Academy stage 3) |

## 8. What next

Go back to the Academy and take the next steps. After stage 1 you have a working environment,
after stage 2 you move comfortably around the terminal and Claude Code, and stage 3 ends with your
own module published to the catalog. This guide stays - when you lose context along the way, here
is the map.
