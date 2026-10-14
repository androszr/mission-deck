# Under the hood

The README is the short, friendly version. This page keeps the technical
detail that used to sit in it: how the team data is stored and protected, how
modules and the catalog work, what the build tools do and what is safe by
design.

## Install details

- You need Node.js 24, Git and Python 3.10+. Put the folder outside OneDrive or iCloud.
- `npm install` gives the small starter profile; add `--include=dev` to lint, test and commit.
- `npm run setup` (optional, once) installs a Chromium for visual checks and builds the code graph index.
- No `.env` is needed: the port defaults to 3001, the module catalog is the local `catalog/` folder and every outside system is off until you configure it.
- On Windows read [WINDOWS.md](WINDOWS.md) first. A longer step-by-step version is [INSTALL.html](INSTALL.html).

## The onboarding wizard

On the first start Mission Deck opens **Start here**: environment checks, an
optional Bitwarden vault, app repository access, encryption keys, team data,
update and the Academy. Every step can be skipped and revisited from **Start
here** in the rail. The first card also carries **Try it with sample data**
([sample mode](../architecture/sample-mode.md)).

## Team data and encryption

Team data is one source, `data-tier-0` ("Team data"). Point
`DATA_TIER_0_REPO_URL` at a git repository you own and Mission Deck clones it
as an **encrypted mirror**:

- the plaintext lives in `data-sub-repositories/ds-data/` and is never a git repository;
- the clone holds one `.enc` file per file, with encrypted names (AES-256-GCM, a per-file key derived with HKDF);
- the key is one line in the gitignored `.encryption-key`. Without it, sync refuses instead of pushing plaintext.

The first person generates the key in the wizard and hands it to teammates
through a channel you trust. Sync is manual: the **Sync** button in the top
bar, never a silent background push. Guards refuse any operation that would
wipe the mirror, and a conflicted pull stops and asks whose version to keep.
More sources can be declared in `DATA_REPO_DEFS`; see
[data-repos-and-sync.md](../architecture/data-repos-and-sync.md).

## A day with the sync buttons

1. **Morning.** The day-cycle pill in the top bar says *Good morning*: one press pulls the team data and decrypts it.
2. **Work.** A module with team data shows a small sync bar telling you whether you are behind or have something to send.
3. **Share.** **Sync** sends your data changes; **Publish** puts a module in the catalog.
4. **Evening.** *End of day* sends what is pending and clears the plaintext copy from disk, only when everything is safely in the encrypted mirror.

## Modules and the catalog

The catalog ships under one roof with the core, in `catalog/`: `catalog.json`
plus `catalog/modules/<id>/`. Settings > **Modules** lists what is installed
and what the catalog offers.

- **Install** copies a module from `catalog/` into `modules/<id>/`, where it becomes its own small git repository with no remote. Restart the server from the same tab and it appears in the menu.
- **Save version** commits the module locally; **Export** gives you a zip for one colleague.
- **Publish** copies the module back into `catalog/modules/<id>/` and updates `catalog.json`. Commit that, or open a pull request, like any other change.
- A team that prefers a hosted catalog can point `MODULES_CATALOG_REPO_URL` at a GitLab repository; publishing then opens a merge request instead.

The catalog starts with 23 modules. The module contract is in
[modules-template/README.md](../../modules-template/README.md); the plain-words
version is [module-anatomy.md](module-anatomy.md). A module runs with full
rights in your browser and in the Node process: install modules you trust.

## Prototypes

**Design > Prototypes** keeps clickable React screens in team data, one folder
per prototype. **Add prototype** creates a working starter, `/prototype` in
Claude Code builds the screen against the design system, **Local preview**
runs it with Vite on your machine, and **Publish** pushes a build to any git
remote whose hosting you choose (`PROTO_BUILD_REPO_URL`,
`PROTO_PAGES_BASE_URL`). A guard stops a publish that would overwrite work
nobody synced. See [prototypes.md](prototypes.md).

## Claude Code skills and agents

`.claude/skills/` carries the method and **Settings > Skills** shows each skill
as a card derived from its own files.

| I want to... | Use |
|---|---|
| Build a feature, view, endpoint or fix | `/new-idea` |
| Build a screen prototype | `/prototype` |
| Audit my diff before a commit | `/pre-ship-audit` |
| Review a branch with its blast radius | `/review-pr` |
| Summarise a meeting | `/summarize-meeting` |
| Draft a commit message | `/commit-message` |

`/new-idea` runs a planner, an implementer and a blind verifier, adding a
conventions guardian, visual checks in a real browser and a bug scan only when
the change calls for them. Deterministic scripts in `scripts/` do the
mechanical half so the model spends its tokens on judgement. Agents never
commit: you review the diff and commit. Roster:
[.claude/agents/README.md](../../.claude/agents/README.md).

## Safety in brief

- Everything runs on your machine; the server listens on `localhost` only.
- `.env` holds configuration, never a secret. Tokens come from a Bitwarden vault when you unlock it, live only in the server process's memory, and never reach a child process's environment or the disk.
- Team data reaches git encrypted, and sync refuses to push without a key.
- Team data is never pulled or pushed in the background; sync is a press.
- Hooks block destructive hard resets for agents, and the app's own update never pops a stash or discards uncommitted work silently.
- Usage telemetry is off unless you configure it.

How to report a vulnerability: [SECURITY.md](../../SECURITY.md).

## Uninstall

Stop the server, then delete the folder (`npm stop`, then `rm -rf mission-deck`).
Everything Mission Deck stores lives inside that folder (`data/`, `modules/`,
`user-data/`, `data-sub-repositories/`, `.encryption-key`). Keep a copy of
`.encryption-key` first if your team still needs it. If you installed them for
it, also remove the global tools: `npm uninstall -g @bitwarden/cli gitnexus`
and the Playwright browser cache.
