<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Mission Deck logo">
  <img src="assets/mascot/pip-wave.svg" width="96" height="96" alt="Pip, the Mission Deck mascot, waving">
</p>

<h1 align="center">Mission Deck</h1>

<p align="center">
  <img src="https://img.shields.io/badge/node-24-339933" alt="Node 24">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
  <img src="https://img.shields.io/badge/agents-Claude%20Code-orange" alt="Claude Code">
</p>

<img src="docs/images/showcase/hero-mission-deck.png" width="880" alt="Mission Deck at a glance: the headline 'A cockpit your product team grows itself', the dashboard with sprint stats, production bugs, the roadmap and the team, and Mini Deck's sprint screen on a phone beside it, all on a made-up team.">

**A cockpit your product team grows itself.** Mission Deck runs on your own
computer: one place for the team's sprints, bugs, roadmap, time, people and
documents. Anybody on the team can add a screen of their own with Claude Code
and share it with the rest.

**[Try the demo](https://androszr.github.io/mission-deck/)** - a click-through
tour in your browser, no install and no account. Jump straight to a chapter:
[the guides](https://androszr.github.io/mission-deck/#guides/0),
[getting started](https://androszr.github.io/mission-deck/#start/0),
[sprints](https://androszr.github.io/mission-deck/#sprints/0),
[the roadmap](https://androszr.github.io/mission-deck/#roadmap/0) and
[the team](https://androszr.github.io/mission-deck/#team/0).

Every picture below is a real screen, taken on a made-up team called
"Northwind Product" that you can try yourself in one click.

## Why Mission Deck

<img src="docs/images/showcase/six-tabs-one-deck.png" width="880" alt="Six tabs, one deck: on the left a pile of windows - a spreadsheet, a bug tracker, a chat asking who is on call, a slide deck and a missing wiki page; on the right the Mission Deck dashboard and three numbered points.">

- **Where does the team's stuff live?** In one app with eight fixed drawers: Team, Activity, Finance, Initiatives, Support, Knowledge, Design and Apps. New screens go into those drawers, so the menu never sprawls.
- **Who can add a screen?** Anyone. A module is a small folder; Claude Code builds it from a sentence and one button shares it with the team.
- **Can I break the shared app?** No. Your modules live beside the core, and the core updates with one button.
- **Do I need a database or a server?** No. It runs on your laptop and keeps plain files.
- **Do I have to learn a method first?** No. The built-in Academy walks you from an empty editor to your first shared module, one checked step at a time.

## Get going in five minutes

1. **Get the code.** You need Node.js 24, Git and Python 3.10+.

   ```bash
   git clone https://github.com/androszr/mission-deck.git && cd mission-deck
   npm install
   ```

2. **Start it.**

   ```bash
   npm start
   ```

   Your browser opens on [http://localhost:3001](http://localhost:3001). No
   settings file is needed.

3. **Walk the welcome page.** The first time, Mission Deck opens **Start here**:
   a short list of checks, each one turning green or telling you in one line
   what is missing.

   ![The Start here page with its first card](docs/images/wizard.png)

4. **Try it with sample data.** No team data yet? Press **Try it with sample
   data** in the first card. Mission Deck fills itself with a fictional team,
   installs every module and restarts. A yellow badge reminds you that nothing
   you see belongs to a real team, and **Leave sample mode** takes it all away
   again.

   ![The first card with the sample data button](docs/images/wizard-sample.png)

On Windows, read [docs/guides/WINDOWS.md](docs/guides/WINDOWS.md) first. The
longer version of these steps is [docs/guides/INSTALL.html](docs/guides/INSTALL.html).

## A day with Mission Deck

1. **Morning: the dashboard.** Pick the tiles you want and see the state of the
   team the moment you arrive.

   ![The dashboard](docs/images/dashboard.png)

2. **Check the sprint.** Commitment against delivery for every squad, with a
   burndown and a spillover view. Here one squad had a rough sprint and then
   recovered.

   ![Sprint stats](docs/images/sprint-stats.png)

3. **Look at the roadmap.** Fifteen initiatives, who owns them, which ones are
   slipping, and a timeline and kanban view of the same list.

   ![The roadmap](docs/images/roadmap.png)

4. **Log your time.** A heat map of who logged what over the last two weeks, so
   gaps are easy to spot before they become a month-end problem.

   ![The time log](docs/images/time-log.png)

5. **Evening: wrap up.** One button in the top bar sends what is pending and
   clears the working copy; in the morning one press brings it back. See it
   in the [demo chapter on the end of the day](https://androszr.github.io/mission-deck/#day-cycle/0).

## Modules: the catalog is the product

<img src="docs/images/showcase/every-screen-a-module.png" width="880" alt="Every screen is a module: four real module screens - sprint stats, production bugs, the Gantt roadmap and the team directory - framed as windows, with 23 modules in the catalog.">

The core is small on purpose. Everything useful comes as a **module**, and the
catalog that ships with Mission Deck has 23 of them. Open **Settings >
Modules**, press **Install**, restart, and the new pages appear in the menu.

![The module catalog](docs/images/catalog.png)

| | | |
|---|---|---|
| [![Production bugs](docs/images/prod-bugs.png)](docs/images/prod-bugs.png) **Production bugs.** Open, new and fixed per sprint, with the spike after a release. | [![Costs](docs/images/costs.png)](docs/images/costs.png) **Costs.** Logged hours times daily rates, by epic, person and month. | [![On-call](docs/images/on-call.png)](docs/images/on-call.png) **On-call.** Who is on duty today, this week and this month. |
| [![Team directory](docs/images/team-directory.png)](docs/images/team-directory.png) **Team directory.** Everyone, by squad, with role and contact. | [![Knowledge base](docs/images/knowledge-base.png)](docs/images/knowledge-base.png) **Knowledge base.** Research, notes and decisions, searchable. | [![Meeting archive](docs/images/meeting-archive.png)](docs/images/meeting-archive.png) **Meeting archive.** Summaries and transcripts, grouped in folders. |
| [![Gantt roadmap](docs/images/gantt-roadmap.png)](docs/images/gantt-roadmap.png) **Gantt roadmap.** A quarter on one page, by area and owner. | [![Vendor settlements](docs/images/vendor-settlements.png)](docs/images/vendor-settlements.png) **Vendor settlements.** Monthly settlements, protocols and what is overdue. | [![Time log](docs/images/time-log.png)](docs/images/time-log.png) **Time log.** Two weeks of logged time at a glance. |

**Build your own in an afternoon.** The **Academy** takes you from an empty
editor to a published module, and checks each step for you.

![The Academy](docs/images/academy.png)

## Mini Deck

<img src="apps/mini-deck/public/icons/icon-192.png" width="64" height="64" alt="The Mini Deck app icon" align="left">

**Mini Deck** is the phone half of Mission Deck: the sprint, the bugs and who is
on call, as a small app you can put on your home screen. It lives in
[apps/mini-deck/](apps/mini-deck/) and is built from the same sample data.

<br clear="left">

<img src="docs/images/showcase/in-your-pocket.png" width="880" alt="On your laptop, in your pocket: Mini Deck's Sprints and Prod bugs screens on two phones, with its four screens, its data-age warning and its light and dark themes listed beside them.">

## Your data stays yours

Mission Deck never needs a cloud of its own. Your team's files live as plain
files on your laptop. When you send them to the team, they are scrambled first,
file names included, and only the scrambled copies go to your shared git
repository. The key that unscrambles them stays on your machine and is handed
to colleagues by you, not by the app.

![Readable files stay on your laptop, only scrambled copies reach the shared repository](docs/images/data-stays-yours.svg)

Nothing is sent in the background: sending is always a button you press, and
the app refuses to send anything at all when the key is missing. The details,
including the safety rules, are in
[docs/guides/under-the-hood.md](docs/guides/under-the-hood.md).

## Claude Code inside

Mission Deck is built to be changed with [Claude Code](https://claude.com/claude-code).
The method lives in skills (`/new-idea` plans, builds and checks a change) and
**Settings > Skills** shows each one as a card.

<img src="docs/images/showcase/say-it-once.png" width="880" alt="Say it once, ship a screen: a Claude Code terminal turning one sentence into a module, beside the Academy and the module catalog, with three numbered steps from sentence to published module.">

![The skills page](docs/images/skills.png)

Agents never commit: you review the change and commit it yourself.

## Safety in brief

Everything runs on your machine and listens on `localhost` only. Nothing is
sent anywhere without a button press. To report a vulnerability see
[SECURITY.md](SECURITY.md); the full list is in
[docs/guides/under-the-hood.md](docs/guides/under-the-hood.md).

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

The full list: [docs/troubleshooting.md](docs/troubleshooting.md).

## Uninstall

Stop the server (`npm stop`) and delete the folder; everything Mission Deck
stores is inside it. See
[docs/guides/under-the-hood.md](docs/guides/under-the-hood.md#uninstall).

## Everything else

- [docs/guides/under-the-hood.md](docs/guides/under-the-hood.md) - install details, data protection, modules, prototypes, safety
- [docs/guides/ONBOARDING.md](docs/guides/ONBOARDING.md) - getting started and access
- [docs/guides/repo-guide.md](docs/guides/repo-guide.md) - the repository explained for people
- [docs/architecture/](docs/architecture/) - one file per topic, the reasoning behind the rules
- [CLAUDE.md](CLAUDE.md) - the rules, written for agents
- [templates/README.md](templates/README.md) - document templates
- [docs/images/SHOTS.md](docs/images/SHOTS.md) - how the pictures above are made

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New features usually belong in a
module in `catalog/`, not in the core.

## Credits

Built with [Claude Code](https://claude.com/claude-code). Bundled third-party
components are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Copyright (c) 2026 androszr, as [LICENSE](LICENSE) states.

## License

MIT; see [LICENSE](LICENSE).
