---
name: jira
description: >-
  Creates and updates Jira issues through the local Mission Deck server
  (`/api/jira/*`), without direct access to the token. Use when the user says
  "create a jira issue", "create a ticket", "add a comment to <KEY>", "log time",
  "show issue <KEY>", or calls /jira. Saves a .md version to user-data first,
  then calls the API. Asks only for required or ambiguous fields - the rest has
  sensible defaults from `.env`. No Python, curl only.

---

# /jira — Jira through the local server

> **TL;DR:** The cockpit server owns the Jira token (loaded from Bitwarden at unlock time). This skill never touches the token — it talks to `http://localhost:$PORT/api/jira/*` with `curl`. Draft a `.md` under `user-data/` first, confirm, then call the API.

## Preflight

1. **Resolve the port** (never hardcode it):
   ```
   PORT=$(grep -h '^PORT=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '\r ')
   PORT=${PORT:-3001}
   ```
2. **Check the server and the token:**
   ```
   curl -s http://localhost:$PORT/api/jira/whoami
   ```
   Expected: `{ "ok": true, "displayName": "...", "url": "..." }`.
   - No answer at all -> the server is down. Restart with
     `curl -s -X POST http://localhost:$PORT/api/settings/restart` and poll
     `curl -s http://localhost:$PORT/api/app/version`. Never `npm start`.
   - `ok: false` or an auth error -> the Jira token is missing. Tell the user to unlock Bitwarden
     in the app (Settings -> Keys -> unlock the Bitwarden vault) and stop. Do not look for a token yourself.
3. **Defaults from `.env`:** `JIRA_URL` (base, default `https://jira.example.com`) and
   `JIRA_PROJECT_KEY` (the default project for new issues). Read them with
   `grep -h '^JIRA_' .env`. If `JIRA_PROJECT_KEY` is empty, ask the user for the project key once.

## Endpoints this skill uses

| Action | Call |
|---|---|
| Connection test / who am I | `GET /api/jira/whoami` |
| Read an issue | `GET /api/jira/issue-detail?key=<KEY>` |
| Read just the title | `GET /api/jira/issue-title?key=<KEY>` |
| Create an issue | `POST /api/jira/create-issue-poc` |
| Add a comment | `POST /api/jira/comment` |
| Log work | `POST /api/jira/worklog` |
| Update fields on an existing issue | `POST /api/jira/update-fields` |

These are the only Jira routes that exist. There is no attachment route and no search route —
if the user asks for either, say so and offer the browse URL instead.

**Before the first POST of a session, confirm the request shape** by grepping the handler:
`grep -n "create-issue-poc" -A 30 server.js` (same for `comment`, `worklog`, `update-fields`).
The server is the contract; do not guess field names.

## Routing by intent

| The user wants | Do this |
|---|---|
| "show PROJ-123" / "what is in this ticket" | `issue-detail`, render a short summary |
| "create a ticket ..." | Full create flow below |
| "add a comment to X" | Confirm the text, then `comment` |
| "log 2h on X" | Confirm issue + time + date, then `worklog` |
| "change the description / label of X" | Confirm the field values, then `update-fields` |

## Create flow

1. **Gather inputs.** From the args and the context, fill in what you can. Ask via
   `AskUserQuestion` (max 4 options per call) only for what is genuinely unknown — typically the
   summary wording, the issue type, and whether there is a parent/epic. State every default you
   applied instead of asking about it: project = `JIRA_PROJECT_KEY`, reporter = the account behind
   `whoami`, no assignee.

2. **Write the `.md` first, from a repo template.** Pick by issue type and copy the file, do not
   invent a structure:

   | Issue type | Template |
   |---|---|
   | Story / user-facing change | `templates/user-story.template.md` |
   | Task / smaller piece of work | `templates/task.template.md` |
   | Larger initiative needing a brief first | `templates/business-requirements.template.md` |

   ```
   mkdir -p user-data/initiatives/tasks
   cp templates/user-story.template.md user-data/initiatives/tasks/<YYYY-MM-DD>-<kebab-slug>.md
   ```

   Then fill it in: the YAML frontmatter (`title`, `type`, `date`, `author` = `displayName` from
   `whoami`, `summary`) and every `{placeholder}`. Leave a section out only when it genuinely does
   not apply, and say so in the report. `templates/README.md` is the index of what exists.

   This file is the human-readable record and the source of the Jira description — the
   `Acceptance criteria` section maps straight onto the description's acceptance criteria.

3. **Confirm.** Show a short summary (project, type, summary, the `.md` path) and get an explicit
   go-ahead. Creating an issue is outward-facing — never POST without one, unless the user already
   said "create it" in this turn.

4. **Create.** Build the JSON body in a temp file and post it — never hand-escape a long `-d`
   string:
   ```
   mkdir -p user-data/tmp
   cat > user-data/tmp/jira-create.json <<'JSON'
   { "summary": "...", "description": "...", "issueType": "...", "projectKey": "..." }
   JSON
   curl -s -X POST http://localhost:$PORT/api/jira/create-issue-poc \
     -H 'Content-Type: application/json' \
     -H "Origin: http://localhost:$PORT" \
     --data @user-data/tmp/jira-create.json
   ```
   (Match the field names to what the handler actually reads — see the grep in the previous section.)
   Capture the returned key.

5. **Report.** Print the browse URL (`<JIRA_URL>/browse/<KEY>`), the classification table and the
   `.md` path. Flag anything noteworthy (ASCII-only description, reporter identity, no assignee).

## Description format

Jira wiki markup, **ASCII-only** (no accented letters or typographic punctuation - they survive
worse over the Jira API):
`h2.` / `h3.` headings, `*` bullets, `#` numbered lists, `*bold*`. Sections: `Goal`, `Scope of work`,
`Acceptance criteria`, `Dependencies and risks`.

## Footguns

- **The token is the server's business.** Never read `.env` for a token, never call
  `jira.example.com` directly. If `whoami` fails, the answer is always "unlock Bitwarden".
- **POST needs an Origin header** — the server rejects state-changing requests from a foreign
  origin. Always send `-H "Origin: http://localhost:$PORT"`.
- **Build bodies as JSON files**, not inline `-d` strings — nested objects and quoted text break
  shell quoting.
- **No attachments.** There is no upload route; mention the file paths in the description instead.
- **`create-issue-poc` is the only create route.** Do not invent `/api/jira/create`.

## Git scope

The `.md` lands under `user-data/` (gitignored). Commit nothing as part of this skill.
