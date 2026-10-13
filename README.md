<p align="center">
  <img src="assets/logo.svg" width="128" height="128" alt="Mission Deck logo">
</p>

<h1 align="center">Mission Deck</h1>

<p align="center">
  <img src="https://img.shields.io/badge/node-24-339933" alt="Node 24">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
  <img src="https://img.shields.io/badge/agents-Claude%20Code-orange" alt="Claude Code">
</p>

**A local cockpit your product team grows itself.** Mission Deck runs on your
own machine at `localhost:3001`: one shared core for the team's roster,
activity, finance, initiatives, knowledge and design system, plus a catalog of
modules anybody on the team can build with Claude Code and publish for the
rest, without touching the core.

## Why Mission Deck

**Every team ends up with the same pile of spreadsheets, scripts and
dashboards.** Mission Deck puts them behind one menu, on your laptop, with no
server to run and no database to look after.

- **Where does the team's stuff live?** In one app with eight fixed drawers -
  Team, Activity, Finance, Initiatives, Support, Knowledge, Design and Apps.
  Modules put their pages into those drawers, so the menu does not sprawl.
- **Who can add a screen?** Anyone. A module is a folder with a manifest, a
  client and an optional server part. One command scaffolds it, `/new-idea` in
  Claude Code grows it, and **Publish** puts it in the catalog.
- **Can I break the shared app?** No. Modules live outside the core's git, and
  the core updates with one button.
- **Is the team's data safe in git?** Team data sits in a separate repository
  and only ever reaches git encrypted, one file per file, names included. The
  key never leaves your machine.
- **Do I have to learn the method?** The **Academy** walks you from an empty
  editor to your first published module, one verified step at a time.

## Quick start

1. **Get the code.** You need Node.js 24, Git and Python 3.10+. Put it outside
   OneDrive or iCloud.

   ```bash
   git clone https://github.com/androszr/mission-deck.git && cd mission-deck
   ```

   **You'll see:** a `mission-deck` folder with `server.js`, `index.html`,
   `js/`, `catalog/` and `docs/`.

2. **Install.** The default install is the small starter profile; add
   `--include=dev` when you want to lint, test and commit.

   ```bash
   npm install
   npm run setup        # optional, once: Chromium for visual checks + the code graph
   ```

   **You'll see:** a few packages installed and no errors. `npm run setup`
   ends with a ready Playwright browser and a GitNexus index.

3. **Start it.**

   ```bash
   npm start
   ```

   No `.env` is needed: the port defaults to 3001, the module catalog is the
   local `catalog/` folder, and every outside system is off until you
   configure it. **You'll see:** the server log line with the port, and your
   browser opening by itself.

4. **Open it.** If no tab opened, go to
   [http://localhost:3001](http://localhost:3001). **You'll see:** the
   dashboard, with the rail of eight drawers on the left.

5. **Walk the onboarding wizard.** On the first start Mission Deck opens
   **Start here**: environment checks, an optional Bitwarden vault, app
   repository access, encryption keys, team data, update and the Academy.
   Every step can be skipped and revisited from **Start here** in the rail.
   **You'll see:** each card turn green or tell you, in one line, what is
   missing and how to fix it.

On Windows, read [docs/guides/WINDOWS.md](docs/guides/WINDOWS.md) first. A
longer, step-by-step version lives in
[docs/guides/INSTALL.html](docs/guides/INSTALL.html).

## A day with Mission Deck

**The core stays put; the team's work moves through modules and data.**

1. **Morning.** The day-cycle pill in the top bar says *Good morning*: one
   press pulls the team data and decrypts it.
2. **Work.** Open the drawers you need. A module with team data shows a small
   sync bar telling you whether you are behind or have something to send.
3. **Build.** Something is missing? `node scripts/new-module.js` scaffolds a
   module, and `/new-idea` in Claude Code turns a sentence into a plan you
   accept, an implementation and a blind check of the acceptance criteria.
4. **Share.** **Sync** sends your data changes; **Publish** puts a module in
   the catalog.
5. **Evening.** *End of day* sends what is pending and clears the plaintext
   copy from disk - only when everything is safely in the encrypted mirror.

## Modules and the catalog

The catalog ships under one roof with the core, in `catalog/`:
`catalog.json` plus `catalog/modules/<id>/`. Settings > **Modules** lists what
is installed and what the catalog offers.

- **Install** copies a module from `catalog/` into `modules/<id>/`, where it
  becomes its own small git repository with no remote. Restart the server from
  the same tab and it appears in the menu.
- **Save version** commits the module locally; **Export** gives you a zip for
  one colleague.
- **Publish** copies the module back into `catalog/modules/<id>/` and updates
  `catalog.json`. Commit that, or open a pull request, like any other change.
- A team that prefers a hosted catalog can point `MODULES_CATALOG_REPO_URL` at
  a GitLab repository; publishing then opens a merge request instead.

The catalog starts with 23 modules, among them a knowledge base, a meeting
archive and transcripts, responsibilities, a team directory, sprint planning,
review and stats, two roadmaps, time-off, on-call, costs, QA tests, rollout
waves and usage analytics. The module contract is in
[modules-template/README.md](modules-template/README.md); the plain-words
version is [docs/guides/module-anatomy.md](docs/guides/module-anatomy.md).

A module runs with full rights in your browser and in the Node process.
Install modules you trust.

## Team data and encryption

Team data is one source, `data-tier-0` ("Team data"). Point
`DATA_TIER_0_REPO_URL` at a git repository you own and Mission Deck clones it
as an **encrypted mirror**:

- the plaintext lives in `data-sub-repositories/ds-data/` and is never a git
  repository;
- the clone holds one `.enc` file per file, with encrypted names
  (AES-256-GCM, a per-file key derived with HKDF);
- the key is one line in the gitignored `.encryption-key`. Without it, sync
  refuses instead of pushing plaintext.

The first person generates the key in the wizard and hands it to teammates
through a channel you trust. Sync is manual: the **Sync** button in the top
bar, never a silent background push. Guards refuse any operation that would
wipe the mirror, and a conflicted pull stops and asks whose version to keep.
More sources can be declared in `DATA_REPO_DEFS`; see
[docs/architecture/data-repos-and-sync.md](docs/architecture/data-repos-and-sync.md).

## Prototypes

**Design > Prototypes** keeps clickable React screens in team data, one folder
per prototype. **Add prototype** creates a working starter, `/prototype` in
Claude Code builds the screen against the design system, **Local preview**
runs it with Vite on your machine, and **Publish** pushes a build to any git
remote whose hosting you choose (`PROTO_BUILD_REPO_URL`,
`PROTO_PAGES_BASE_URL`). A guard stops a publish that would overwrite work
nobody synced. People-facing guide:
[docs/guides/prototypes.md](docs/guides/prototypes.md).

## Claude Code skills and agents

Mission Deck is built to be changed with [Claude Code](https://claude.com/claude-code).
`.claude/skills/` carries the method and **Settings > Skills** shows each one
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
mechanical half (conventions, gates, diff digests, scaffolds) so the model
spends its tokens on judgement. Agents never commit: you review the diff and
commit. Roster: [.claude/agents/README.md](.claude/agents/README.md).

## Safety in brief

- Everything runs on your machine; the server listens on `localhost` only.
- `.env` holds configuration, never a secret. Tokens come from a Bitwarden
  vault when you unlock it, live only in the server process's memory, and
  never reach a child process's environment or the disk.
- Team data reaches git encrypted, and sync refuses to push without a key.
- Team data is never pulled or pushed in the background; sync is a press.
- Hooks block `git reset --hard` for agents, and the app's own update never
  pops a stash or discards uncommitted work silently.
- Usage telemetry is off unless you configure it.

How to report a vulnerability: [SECURITY.md](SECURITY.md).

## Troubleshooting

**Port 3001 is taken.** `npm stop`, then `npm start`. Never `kill -9`: the
server may be serving somebody.

**The server does not come back after a restart.** Look in
`data/server-restart.log`, or run `node server.js` in the foreground to see
the error.

**`eslint: command not found`.** The default install has no dev tools:
`npm install --include=dev`.

**The Claude terminal does not open.** `npm rebuild node-pty && node scripts/postinstall.js`,
then restart from Settings > System.

**Settings > Tools shows a yellow or red card.** It names what is missing and,
for most cards, installs it with one press.

The full list: [docs/troubleshooting.md](docs/troubleshooting.md).

## Uninstall

Stop the server, then delete the folder:

```bash
npm stop
cd .. && rm -rf mission-deck
```

Everything Mission Deck stores lives inside that folder (`data/`, `modules/`,
`user-data/`, `data-sub-repositories/`, `.encryption-key`). If you installed
them for it and no longer need them, also remove the global CLIs:
`npm uninstall -g @bitwarden/cli gitnexus`, and the Playwright browser cache.
Keep a copy of `.encryption-key` first if your team still needs it.

## Everything else

- [docs/guides/ONBOARDING.md](docs/guides/ONBOARDING.md) - getting started, tokens and vault item names
- [docs/guides/repo-guide.md](docs/guides/repo-guide.md) - the repository explained for people
- [docs/architecture/](docs/architecture/) - one file per topic, the reasoning behind the rules
- [CLAUDE.md](CLAUDE.md) - the rules, written for agents
- [templates/README.md](templates/README.md) - document templates

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New features usually belong in a
module in `catalog/`, not in the core.

## Credits

Built with [Claude Code](https://claude.com/claude-code). Bundled third-party
components are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Copyright (c) 2026 androszr, as [LICENSE](LICENSE) states.

## License

MIT; see [LICENSE](LICENSE).
