---
name: confluence
description: >-
  Reads and writes Confluence pages through the local Mission Deck server
  (`/api/knowledge-base/confluence-*` and `/api/confluence/page`), without direct
  access to the token. Use when the user says "fetch a page from confluence",
  "save this to confluence", "update page <id>", "check the confluence
  connection", or calls /confluence. No Python, curl only.

---

# /confluence — Confluence through the local server

> **TL;DR:** The cockpit server owns the Confluence token (from Bitwarden). This skill never touches it — it talks to `http://localhost:$PORT` with `curl`. Read a page, or draft locally and publish after an explicit confirm.

## Preflight

1. **Resolve the port:**
   ```
   PORT=$(grep -h '^PORT=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '\r ')
   PORT=${PORT:-3001}
   ```
2. **Is Confluence configured?**
   ```
   curl -s http://localhost:$PORT/api/knowledge-base/confluence-configured
   ```
   A negative answer means the token is missing -> tell the user to unlock Bitwarden in the app
   (Settings -> Keys -> unlock the Bitwarden vault) and stop. Never hunt for a token yourself.
3. **Connection test** (before anything that writes):
   ```
   curl -s -X POST http://localhost:$PORT/api/knowledge-base/confluence-check \
     -H 'Content-Type: application/json' -H "Origin: http://localhost:$PORT" -d '{}'
   ```
4. If the server does not answer at all, restart it with
   `curl -s -X POST http://localhost:$PORT/api/settings/restart` and poll
   `curl -s http://localhost:$PORT/api/app/version`. Never `npm start`.

`CONFLUENCE_BASE_URL` lives in `.env` (`grep -h '^CONFLUENCE_' .env`) and is used only to build
human-readable links.

## Endpoints this skill uses

| Action | Call |
|---|---|
| Is the integration configured? | `GET /api/knowledge-base/confluence-configured` |
| Connection / credentials test | `POST /api/knowledge-base/confluence-check` |
| Fetch a page | `POST /api/knowledge-base/confluence-fetch` |
| Create a page | `POST /api/confluence/page` |
| Update a page body | `PUT /api/confluence/page/:id` |

Those are the only Confluence routes that exist. There is no search route, no attachment route and
no delete route — say so rather than improvising.

**Before the first write of a session, confirm the request shape:**
`grep -n "confluence-fetch\|/api/confluence/page" -A 30 server.js`. The server is the contract.

## Read flow

1. Ask for (or take from the args) the page URL or page id.
2. ```
   curl -s -X POST http://localhost:$PORT/api/knowledge-base/confluence-fetch \
     -H 'Content-Type: application/json' -H "Origin: http://localhost:$PORT" \
     -d '{"pages":["<id>"]}'
   ```
3. Render the result for the user. When the user wants to keep it, save it under
   `user-data/confluence/<page-id>-<slug>.md` (`mkdir -p` first) — never into the repo tree.

## Write flow

1. **Draft locally first.** Write the content to `user-data/confluence/<YYYY-MM-DD>-<slug>.md` and
   show it. Nothing goes to Confluence before the user has seen the draft.
2. **Confirm explicitly.** Publishing is outward-facing: get a clear go-ahead naming the space and
   the parent page (for a create) or the page id (for an update).
3. **Convert to storage format.** Confluence stores XHTML "storage" markup: `<h2>`, `<p>`,
   `<ul><li>`, `<strong>`, `<ac:structured-macro>` for macros. Plain markdown is not accepted.
   Write the copy in plain English - a Confluence page is a user-visible document.
   Keep page ids, labels and macro names ASCII.
4. **Build the body as a file, then send it:**
   ```
   mkdir -p user-data/tmp
   cat > user-data/tmp/confluence-page.json <<'JSON'
   { "spaceKey": "...", "title": "...", "parentId": "...", "body": "<h2>...</h2>" }
   JSON
   curl -s -X POST http://localhost:$PORT/api/confluence/page \
     -H 'Content-Type: application/json' -H "Origin: http://localhost:$PORT" \
     --data @user-data/tmp/confluence-page.json
   ```
   For an update, `PUT http://localhost:$PORT/api/confluence/page/<id>` with the new storage body.
   (Match the field names to what the handler reads — see the grep above.)
5. **Report** the page id, the title and the link built from `CONFLUENCE_BASE_URL`, plus the local
   draft path.

## Footguns

- **The token is the server's business.** Never call `confluence.example.com` directly, never read a token
  from `.env`.
- **POST and PUT need an Origin header** — the server rejects state-changing requests from a
  foreign origin. Always send `-H "Origin: http://localhost:$PORT"`.
- **Storage format, not markdown.** Sending markdown produces a page full of literal `#` and `*`.
- **An update replaces the body.** Fetch the current page first when the user asked for an edit
  rather than a rewrite, and show what will change.
- **Build bodies as JSON files.** Inline `-d` with HTML and quoted text breaks shell quoting.
- **VPN.** These endpoints only work on the corporate network; a connection timeout usually means
  the VPN is down, not that the token is wrong.

## Git scope

Drafts and fetched pages live under `user-data/` (gitignored). Commit nothing as part of this skill.
