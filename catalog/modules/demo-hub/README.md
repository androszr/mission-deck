# Sync Test Hub (`demo-hub`)

A module for **testing how sync works**. Nothing in it is production: it keeps one file in the
team data repository and shows what happens to it next.

The directory name and `id` stay `demo-hub`: the `id` is at the same time the API path
(`/api/m/demo-hub/`), the view id prefix, the CSS class prefix and the name of the
`ds-data/demo-hub/` directory, whose history the module shows. Changing the `id` would cut that
history off.

## Two views

| View | What it does |
|---|---|
| **Note** (`demo-hub-note`) | A text field. Saving creates `data-sub-repositories/ds-data/demo-hub/note.md`. Shows the author of the previous **sync**, the date it was sent, the commit, and whether the content on this computer is already ahead of what the team sees. |
| **Sync Test Hub history** (`demo-hub-history`) | A table of every version of that file that went through a sync, with a **Who** column. When needed, a "To send" row on top for a change that has not travelled yet. |

## Where the "Who" column comes from

Git cannot tell: **every** commit in the encrypted mirror is signed as
`Mission Deck <cockpit@local>`, and the whole tree travels under one `sync <date>` subject. So the
note carries a YAML header written by the module server - the same shape the training path mural
uses:

```yaml
---
author: Alex Morgan
person_slug: alex-morgan
source: gitlab
date: 2026-09-06T14:16:00.000Z
---
```

The name comes from `GET /api/whoami`, i.e. from the **name of the GitLab project token** this
app runs on - not from whoever owns the token in GitLab. The module has no access to the token
itself (it lives in the process memory, never on `ctx`), so it fetches the identity over loopback
from the same process. The client never supplies the author - otherwise it could name somebody
else.

The view reads the history from the mirror: for every commit that touched the file,
`git show <sha>:<hmac>.enc` goes through `scripts/crypto-sync.js` (`decryptBuffer`) and the header
is read from the decrypted version. A version saved before the header existed shows `unknown` in
the **Who** column - and stays that way, because that information exists nowhere.

## Routes

| Route | Answer |
|---|---|
| `GET /api/m/demo-hub/ds-data` | `{ available, dir, file, text, updatedAt, lastSave, lastSync, files[] }` |
| `POST /api/m/demo-hub/ds-data` | Body `{ text }`. Adds the header and saves through tmp+rename under a lock. |
| `GET /api/m/demo-hub/history` | `{ available, file, dir, rows[], pending, error, files[] }` |

No cloned `ds-data`, no mirror, no encryption key and no commits are **normal states**, not
errors: each comes back as HTTP 200 with a message the view shows as a `ds-callout`.

## How to test sync

1. Save a note in the **Note** tab - the file is created at once, without git.
2. Send the changes with the sync panel in the top bar. Mission Deck encrypts the data directory
   (file names included) and pushes it to the team repository.
3. Go back to **History** - a new row appears with your name and the short commit hash.
4. On another computer, fetch the changes with the same panel and check the content is the same.

---

## Plug & play module contract

A module is a `modules/<id>/` directory with a `module.json` file. The server discovers modules
at startup, and the client builds rail items and `VIEW_REGISTRY` entries from the manifest.
The full field reference lives in `modules-template/README.md`.

### Directory layout

```
modules/<id>/
  module.json          - manifest (required)
  client/
    index.js           - ES module exporting a `views` object
    style.css          - stylesheet (optional)
  server/
    index.js           - CommonJS: module.exports = function register(ctx) { ... }
  tests/               - module tests
```

### The `ctx` object (server)

Passed to `register(ctx)`: `moduleId`, `jsonResponse(res, status, body)`, `readBody(req, maxBytes)`,
`checkOrigin(req, res)`, `makeLock()`, `dataDir`, `rootDir`, `log(...args)`. Routes are mounted
under `/api/m/<id>/`.

### The `deps` object (client)

Passed to `views[id].init(deps)`: `navigate(viewId)`, `registerViewCleanup(fn)`,
`showToast(variant, title, desc)`, `apiBase` (`"/api/m/<id>"`).

### Trust model

**No isolation.** Modules have full rights in the browser and in the Node.js process. Install only
modules you trust.
