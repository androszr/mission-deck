# Contributing to Mission Deck

Thanks for taking a look. Mission Deck is a side project, built mostly with
Claude Code; contributions of any size are welcome.

## Where a change belongs

- **A new feature for a team** almost always belongs in a **module**, not in
  the core. Scaffold one with
  `node scripts/new-module.js <id> "<Label>" --hub <hub> --area "<Area>"`,
  grow it, then press **Publish** in Settings > Modules: that copies it into
  `catalog/modules/<id>/` and updates `catalog.json`. Open a pull request with
  that diff.
- **A core change** (the shell, `server.js`, sync, the design system) is
  welcome too - open an issue first for anything large, so we can agree on the
  shape before you spend time on it. On your machine, create the gitignored
  `.core-dev` marker so the pre-commit core-scope check lets core commits
  through.

## Setting up

```bash
git clone https://github.com/androszr/mission-deck.git && cd mission-deck
npm install --include=dev      # the dev profile: eslint, lint-staged, git hooks
npm run setup                  # optional: Playwright Chromium + the GitNexus index
npm start
```

## Before you open a pull request

```bash
npm run lint
npm test
npm run test:api
```

All three must pass. `node scripts/check-conventions.js --base main` runs the
mechanical convention checks the reviewers will run anyway.

## Conventions

- **ASCII source, English copy.** Identifiers, comments, file names, log lines
  and slugs are ASCII; everything a person reads is plain English.
- **Design System classes only** (`ds-btn`, `ds-card`, `ds-badge`, ...) and
  tokens from `css/ds-tokens.css` - no hard-coded colours.
- **Works on macOS and Windows.** No `lsof`, `pkill`, `/bin/sh` or hard-coded
  `/tmp`; spawn `.cmd` shims with a shell and real binaries without one. See
  [docs/guides/WINDOWS.md](docs/guides/WINDOWS.md).
- **Never** commit team data, `.env` contents, `.encryption-key` or tokens.
  Test fixtures use made-up people and `example.com` addresses.
- Do not bypass hooks (`--no-verify`) or silence a lint rule just to pass a gate.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:` ...).

The full rules, written for agents but readable by people, are in
[CLAUDE.md](CLAUDE.md); the reasoning behind them is in
[docs/architecture/](docs/architecture/).

## Working with Claude Code

`/new-idea` plans, implements and verifies a change on a work branch;
`/pre-ship-audit` checks a diff before you push. Agents never commit - you
review the diff and commit yourself.

## Licence

By contributing you agree that your contribution is licensed under the
project's [MIT licence](LICENSE).
