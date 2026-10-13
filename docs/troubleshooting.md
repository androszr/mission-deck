# Troubleshooting

## Server

**Port 3001 still taken after closing the terminal.**
The server can come back as a detached process (a restart from Settings, an app update), so Ctrl+C
does not reach it.

```bash
npm run stop     # SIGTERM to the PID in data/server-3001.pid, then frees the port
npm start
```

The scripts read the port from `.env`, so they never touch another app on another port.

**The server does not come up after a change in `server.js`.**
Run `npm run lint` first, then restart through the API:

```bash
curl -s -X POST http://localhost:3001/api/settings/restart -H 'Content-Type: application/json' -d '{}'
```

Never `pkill` or `kill -9` - you would kill an instance somebody may be using.

**Restart loop / the server starts and dies.**
Check `data/server-restart.log` and run it in the foreground: `PORT=3001 node server.js`. The
error prints to the console instead of vanishing inside a detached process.

**"The restart is taking longer than usual" and the server does not come back.**
A restart used to hand the child the parent's `stdout`/`stderr` (`stdio: 'inherit'`). When the
editor terminal that ran `npm start` was gone, the child got dead descriptors and died before its
first line of JavaScript. The child's output now always goes to `data/server-restart.log` - look
there if it happens again.

## Tokens and Bitwarden

**Tokens disappear after a restart.** A vault session does not survive a process restart unless
the app handed it over. Unlock again: the Bitwarden pill in the top bar or Settings > Keys.

**The Bitwarden pill is red although tokens work.** The pill answers "does the app hold secrets",
not "is the vault open"; the `sessionOpen` field of `/api/bitwarden/status` carries the second
fact into the tooltip. Refreshing secrets (`/api/bitwarden/refresh-secrets`) still needs an unlock.

**`bw: command not found`.** Install Bitwarden CLI and check `bw --version`. The app calls the
CLI, not the API.

**VS Code (or another editor) asks for a GitLab token.** It should not. Every git call the app
makes goes through `_gitNoPromptEnv()` (no askpass channel) and every network operation carries
`-c credential.helper=`; agents get the same variables from `.claude/settings.json`. Instead of a
prompt you see `fatal: could not read Username for 'https://...': terminal prompts disabled` in
the `stderr` of the API answer, classified as `auth-expired`. It means "no token of your own":
unlock Bitwarden or set `COCKPIT_APP_TOKEN`. A manual `git push` in a terminal is unaffected.

**The token is in the vault but the app does not see it.** Check the item name - matching is by
name prefix (`COCKPIT-APP`, `COCKPIT-DATA`). The Jira token is matched by the `-jira` suffix
(e.g. `first-last-jira`), the service account by the exact item `JIRA_TECH_COCKPIT`, and Confluence
by a `CONFLUENCE_TOKEN=` key in a note. Check `BW_COLLECTION_NAME` in `.env` as well.

## Team data repository

**`data-tier-0` does not clone.** It needs `DATA_TIER_0_REPO_URL` (your own data repository) and
the `COCKPIT-DATA` token. Without the token the clone fails with `no-token`; without the URL with
`no-repo-url`. Create the token in Settings > Keys, card **Team data repository**. Status:
`curl -s localhost:3001/api/data-tier-0/status`.

**Pushing to the data repository is refused.** The `COCKPIT-DATA` token needs the Maintainer role
(40): sync writes straight to the default branch, and a protected branch refuses a Developer only
at push time. Create the token again with the form's default level.

**Sync fails with "locked".** Another operation runs on the same repository (background autosync
or a second app instance). Wait and retry.

**A conflict on pull.** Pull always runs `--rebase --autostash`. When a conflict remains, the sync
error window offers "Keep my versions" / "Take the team's versions". It is a separate git
repository - never commit it from the main repository.

## Work branches

**The app update refuses on a branch other than `main`.** As intended: an update resets the tree,
so on a work branch it would lose local commits. Switch to `main` (`git checkout main`) and retry.

**A push or merge request is refused.** The `COCKPIT-APP` token is missing in Bitwarden or has no
write rights. Check its state in Settings > Keys.

## Claude Code

**GitNexus tools unavailable.**

```bash
node scripts/bootstrap-gitnexus.js
```

Then restart Claude Code in this folder. When the index is corrupt (`FTS index ... is inconsistent`),
first `node .gitnexus/run.cjs clean --force`, then the bootstrap.

**`node .gitnexus/run.cjs analyze` fails with `MODULE_NOT_FOUND`.**
Not a failure - the graph was never built on this machine. `.gitnexus/` is gitignored, so a fresh
clone has no `run.cjs`: it appears with the first analysis. Build and refresh the graph with one
command, `node scripts/bootstrap-gitnexus.js` (or the button in Settings > Tools, which does the
same). It works in both states, installs the CLI if missing, and runs the analysis with
`ANALYZE_ENV` from `scripts/_gitnexus-analyze.js`. Without those variables `server.js` (larger than
the analyzer's default 512 KB cap) drops out of the graph: the analysis succeeds and every
`impact` or `context` on a server symbol answers "not found". A bare `npx gitnexus analyze` is
therefore not the answer here either, even when it runs.

**The in-app Claude terminal does not start (macOS).**

```bash
npm rebuild node-pty && node scripts/postinstall.js
```

A missing execute bit on `spawn-helper` is the most common cause.

**The terminal window shows "Claude Code terminal is unavailable" instead of the usual
"[session ended]".** `node-pty` is an `optionalDependencies` entry - the install does not fail when
the native binding does not build, but then the terminal really does not work. Check Settings >
Tools (the `claude-terminal` probe, the `pty`/`ws` pair), then fix it with the same command as
above, `npm rebuild node-pty && node scripts/postinstall.js`, and restart the server.

**`npm rebuild node-pty` brings back other platforms' prebuilds.** `postinstall.js` deletes
`node-pty` prebuilds of foreign platforms, but `npm rebuild` restores the whole package. Not a
regression - always add the second half: `npm rebuild node-pty && node scripts/postinstall.js`
removes them again and fixes `spawn-helper` permissions in one pass.

**A skill stops with a message about the branch.** `/new-idea` does not implement on `main`.
Create a work branch: `git checkout -b feat/<name>`.

**A hook blocks `git reset --hard`.** As intended. Use `git stash`, `git restore <path>` or
`git reset --soft`.

## Tests and lint

**`sh: eslint: command not found` after a plain `npm install`.** As intended - `npm install`
installs the starter profile (`.npmrc` sets `omit=dev`), without `eslint` and `lint-staged`. Add
the toolset with `npm install --include=dev` (or `npm run setup:dev`), then rerun `npm run lint`.
The same applies to committing a `.js`/`.mjs`/`.cjs` file - the `pre-commit` hook stops with the
same message until the developer tools are there.

**`npm test` passes, `npm run test:api` hangs.** A process from an earlier run holds the test
port. Run `node scripts/kill-stale-tests.js`, then retry.

**Lint reports `no-undef` in `js/`.** The module uses a browser global missing from the list in
`eslint.config.mjs`. Add it to `browserGlobals`; do not silence the rule.

## Visual verification

**Visual verification does not start / no browser.** Neither install profile downloads Chromium
(about 150 MB) - on purpose. Install it once:

```bash
node scripts/bootstrap-playwright.js     # or: npm run setup (together with GitNexus)
```

The script is idempotent, works on macOS and Windows, downloads a pinned Chromium, warms the
Playwright MCP server package and creates `user-data/screenshots/`. When the browser is missing,
`scripts/postinstall.js` says so in one line after `npm install`. Restart Claude Code afterwards so
it sees the MCP server.

**Screenshots landed in the root folder.** The hook `.claude/hooks/block-root-screenshot.js` (Node,
no `jq` - works the same on Windows) blocks that. Save to `user-data/screenshots/`.

## Windows

**`spawn npm ENOENT`, or `npx` does not start.** On Windows `npm`, `npx` and `bw` are `.cmd` shims
that `spawn` will not run without a shell. Every call needs `shell: process.platform === 'win32'`.
Real binaries (`git`, `node`, `process.execPath`) do not.

**A script uses `lsof`, `pkill`, `xargs` or `chmod`.** These commands do not exist on a default
Windows. The portable pattern is in `scripts/kill-port.js` and `scripts/stop-server.js`
(`netstat` + `taskkill`).

**`curl` does not work in PowerShell.** In Windows PowerShell 5.1 `curl` is an alias of
`Invoke-WebRequest`, so `curl -s -X POST ...` from these docs reports a parameter error. Type
`curl.exe` (present on every Windows 10+), or use the button in Settings > System. An environment
variable is `$env:PORT = 3001`; a hard reload is Ctrl+Shift+R.

**Settings > Tools: the npm card is yellow after a fresh install.** Node 24 ships npm 11, which
`engines` in `package.json` accepts (`>=11 <13`). If the card is still yellow, npm is older than 11
- on Windows do NOT fix it with `npm install -g npm` (it lands in `%APPDATA%\npm`, behind
`Program Files` in PATH, so the old npm keeps answering); use `winget upgrade OpenJS.NodeJS.LTS`.

**The Claude terminal says the claude CLI was not found, although `claude` works in a terminal.**
The server looks for the CLI with `where claude` and prefers `claude.exe` (the native installer)
over `claude.cmd` (an npm install). If `where claude` in PowerShell returns nothing, the CLI folder
is not on the user PATH - restart VS Code after installing; if that does not help, install with
`npm install -g @anthropic-ai/claude-code`.

**MCP servers (gitnexus, playwright) do not start in Claude Code.** On Windows `npx` and `gitnexus`
are `.cmd` shims Claude Code will not start without `cmd /c`. That is why `.mcp.json` starts both
through `node scripts/mcp-launch.js` - the same file works on macOS. If someone restored a bare
`npx` in `.mcp.json`, run `git restore .mcp.json`.

**Git hooks do not fire.** Hooks are shell scripts (`#!/usr/bin/env sh`) run directly by git
(`scripts/prepare.js` sets `core.hooksPath`), so Git for Windows (Git Bash) is needed. Installing
"Git for Windows" settles it; do not bypass the hook with `--no-verify`.

**The diff shows the whole file as changed.** Line endings. The repository enforces LF through
`.gitattributes`; if the clone is older, refresh it: `git add --renormalize .`.

## Corporate proxy

**`npm install`, `bw` or the Chromium download fail with a certificate error**
(`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `self signed certificate in certificate chain`,
`SELF_SIGNED_CERT_IN_CHAIN`). A TLS-inspecting proxy signs HTTPS traffic with its own certificate,
which Node and npm do not trust. Point them at the proxy's CA certificate (ask your IT team for it,
PEM format):

```bash
# macOS / Linux (add to ~/.zshrc)
export NODE_EXTRA_CA_CERTS=/path/to/proxy-ca.pem
npm config set cafile /path/to/proxy-ca.pem
```

```powershell
# Windows (permanently, for the user)
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', 'C:\certs\proxy-ca.pem', 'User')
npm config set cafile C:\certs\proxy-ca.pem
```

The Mission Deck server reads `NODE_EXTRA_CA_CERTS` the same way. `VERIFY_SSL=false` in `.env`
switches verification off as an emergency measure - it works, but only until you have the certificate.

## Python

**The Python card in Tools is red.** The probe tries in order: on Windows `py -3 --version`, then
`python --version`; on macOS and Linux `python3 --version`, then `python --version`. The first
command that prints a version wins and the card names it. Python 3.10+ is required. Install:
`brew install python` (macOS) or `winget install Python.Python.3.12` (Windows). On Windows a bare
`python` without an installed Python is a Microsoft Store stub that fails - the probe counts that
as missing, not as a crash.

## Interface

**A CSS change does not show.** Stylesheets are served with a revalidation header, but a browser
can hold an old copy. Hard reload: Cmd+Shift+R (Windows: Ctrl+Shift+R).

**A new view does not open from the menu.** Check all three: the `#view-<id>` section in
`index.html`, the `VIEW_REGISTRY` entry, and the page on its hub in `js/core-hubs.mjs`. Missing
any of them gives an empty screen.

**A modal does not show despite `hidden = false`.** The overlay needs both `hidden = false` and the
`.open` class. Use `openDsModal` and `closeDsModal` from `js/ds-modal.js`.
