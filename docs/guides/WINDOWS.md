# Mission Deck on Windows

Mission Deck runs on Windows the same way it runs on macOS. There are a few differences and all
of them are here - the rest of the install guide is shared by both systems.

> **Before you start:** this page assumes you already have Visual Studio Code and a browser
> (Chrome or Edge). If not, install VS Code from
> [code.visualstudio.com](https://code.visualstudio.com) first.

---

## 1. Install Node.js, Git and Python

Open **PowerShell** and paste one command:

```powershell
winget install OpenJS.NodeJS.LTS Git.Git Python.Python.3.12
```

Mission Deck runs on **Node 24** - today exactly the version the LTS package gives you. If `node -v`
prints another major version, install Node 24 from nodejs.org (*Previous releases*). The bundled
npm 11 is enough; do not upgrade it with `npm install -g npm` - on Windows that install lands
behind `Program Files` in PATH and the old npm keeps answering.

Keep the **default options** when installing Git - Git Bash comes with it, and Mission Deck needs
it for the git hooks (see *Git for Windows is required* below).

After installing, **close and reopen the terminal**, preferably the whole of VS Code - otherwise the
system does not see the new commands. Check that they work:

```powershell
node -v
git --version
python --version
```

All three should print a version (Python also answers `py -3 --version`; on macOS the same command
is `python3`). If `python` opens a Microsoft Store prompt, the winget install did not finish -
run it again. If any of them says it is "not recognized as a command", close the terminal once more.

---

## 2. Put the project in the right place

Clone (or unpack) the project **directly on a local drive**, for example `C:\mission-deck`.

| Do this | Not this |
|---|---|
| `C:\mission-deck` | `C:\Users\...\OneDrive\...` |
| `C:\work\mission-deck` | A Desktop synced to OneDrive |
| `D:\mission-deck` | A cloud folder or a network drive |

**Why it matters.** OneDrive syncs every file to the cloud. The app creates a lot of them
(`node_modules` alone is tens of thousands of files), so inside OneDrive it slows the machine down,
and a sync can corrupt data mid-write.

**Keep the path short.** Windows has a default limit of 260 characters per path, and nested
dependencies can exceed it. `C:\mission-deck` leaves room; a deep folder under your user profile
may not.

---

## 3. Open the project and start it

In Visual Studio Code: **File > Open Folder...**, pick the project folder, and when asked
*"Do you trust the authors of the files in this folder?"* press **Yes, I trust the authors**.

> **Open it in a new, clean window.** Do not add the folder to an already open workspace
> (*Add Folder to Workspace*). Several folders at once make terminal commands run in the wrong
> directory.

Then **Terminal > New Terminal** and, in order:

```powershell
npm install
npm run setup
npm start
```

`npm run setup` downloads Chromium once for visual verification and builds the code graph for
Claude Code; without it two cards in Settings > Tools stay yellow. You do not need a `.env` file
to start; everything has a default.

The browser opens by itself on `http://localhost:3001`. If it does not, open it by hand and type
that address. **Keep the terminal running `npm start` open** while you work; the server lives in it.

---

## 4. Install Claude Code (and, optionally, Bitwarden CLI)

On Windows both install through `npm`:

```powershell
npm install -g @anthropic-ai/claude-code
npm install -g @bitwarden/cli        # optional: only if you keep tokens in Bitwarden
```

If you use Bitwarden, point it at your server and log in once:

```powershell
bw config server https://vault.bitwarden.com
bw login
```

You log in **once**; the vault itself is then unlocked from inside Mission Deck.

---

## Things to watch on Windows

### Git for Windows is required

The git hooks in this repository are shell scripts (`#!/usr/bin/env sh`). Git runs them directly,
so **Git Bash** is needed - it comes with "Git for Windows". If hooks do not fire on commit,
reinstall Git with the default options.

Do not work around a hook with `--no-verify`.

### The diff shows the whole file as changed

That is line endings (CRLF vs LF). The repository enforces LF through `.gitattributes`, but if the
clone was made earlier, refresh it once:

```powershell
git add --renormalize .
```

### Stopping the server

Do not kill the process from Task Manager. Use:

```powershell
npm stop
```

### `curl` in PowerShell

In Windows PowerShell 5.1 `curl` is an alias of `Invoke-WebRequest`, so the commands in the docs
(`curl -s -X POST ...`) fail. Type `curl.exe`, or use the button in Settings > System. An
environment variable is set with `$env:PORT = 3001`, not `PORT=3001`, and a hard browser reload is
Ctrl+Shift+R.

### Corporate proxy

If `npm install`, `bw` or the Chromium download fails with a certificate error
(`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `self signed certificate in certificate chain`), a proxy is
signing traffic with its own certificate. The fix is in `docs/troubleshooting.md`, section
*Corporate proxy*.

---

## For people developing Mission Deck

If you write code in `scripts/` or `server.js`, it must run on both systems. Three traps everybody
falls into:

**1. `npm`, `npx` and `bw` are `.cmd` shims on Windows.** `spawn` will not run them without a
shell - each call needs the flag:

```js
spawn(cmd, args, { shell: process.platform === 'win32' });
```

Real binaries (`git`, `node`, `python`, `process.execPath`) do **not** need it - and **must not**
get it: with a shell Node joins the command and its arguments without quotes, so
`C:\Program Files\nodejs\node.exe` breaks on the space. In `server.js` `_toolShell(cmd)` decides:
a shell only when the name ends in `.cmd`.

**2. Unix commands simply are not there.** `lsof`, `pkill`, `xargs`, `chmod`, `/bin/sh` - none of
them exists on a default Windows. The portable pattern (`netstat` + `taskkill`) is in
`scripts/kill-port.js` and `scripts/stop-server.js`; the parser `listeningPidsFromNetstat` in
`scripts/_port.js` keeps only `LISTENING` rows with the port in the local address, because a plain
`findstr :3001` also catches the browser connected to the server. Signals differ too:
`process.kill(pid, 'SIGTERM')` is an immediate kill on Windows, and a child started with
`shell: true` is killed as a whole tree with `taskkill /T` (pattern: `scripts/run-with-timeout.js`).

**3. Build paths with `path.join`,** and take the home directory from `os.homedir()`. No hard-coded
`/tmp` or `~/`.

Specific problems and their fixes: `docs/troubleshooting.md`, section *Windows*.

---

## Something does not work?

1. Open **Settings > Tools** - Mission Deck checks what is missing and can install most of it with
   one click.
2. Read `docs/troubleshooting.md`.
3. Open an issue on the project's GitHub page.
