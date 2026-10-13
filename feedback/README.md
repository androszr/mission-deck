# Feedback from the app

This directory is the processing contract for whoever maintains the
`mission-deck` repository. Every report sent with the question mark in the app's top bar
(`POST /api/feedback/submit`) lands here as its own directory, on its own branch
and in its own merge request — nothing lands on `main` directly, because `main` is
protected and a human review always has the last word.

## Directory layout

```
feedback/
  README.md                                   <- this file
  <YYYY-MM-DD-HHMMSS>-<type>-<slug>/
    report.md
    attachments/
      01-screenshot.png
      02-screenshot.jpg
```

- **One directory = one report = one merge request.** Never two reports in one
  directory, never one report split across two merge requests.
- Directory name: a UTC timestamp (`YYYY-MM-DD-HHMMSS`), the report type and a slug
  built from the title. A UTC timestamp sorts the directories chronologically whatever
  the reporter's time zone.
- The report file is always called `report.md` and always sits directly in the
  report directory — a fixed name in a fixed place is the only thing that lets reports
  be processed automatically or in bulk.
- Attachments (screenshots only: PNG, JPG, GIF, WebP) live in the `attachments/`
  sub-directory, named by the server as `<NN>-screenshot.<ext>` — the name from the request
  is never read, the format comes from the file's magic bytes.

## YAML frontmatter fields in `report.md`

The full description of every field — who fills it in and where the value comes from — is in
the template `templates/feedback-report.template.md`. In short:

| Key | Meaning |
|---|---|
| `id` | the name of the report directory |
| `type` | `bug`, `idea` or `question` |
| `title` | the title entered by the reporter |
| `status` | see "Allowed `status` values" below |
| `reported_by` | the reporter's identity (slug, name, email — the email may be `null`) |
| `reported_at` | the send timestamp, ISO 8601 UTC |
| `app_info` | the version, HEAD commit and platform the report came from |
| `context` | the view, address, window and screen size, browser and language at the time of the report |
| `attachments` | a list of relative paths to the screenshots in `attachments/` |
| `console_errors` | the number of console errors attached to the report (the content is in the file's "Console errors" section) |

## Allowed `status` values

Every new report arrives with the status `new`. Whoever processes reports
changes it by hand, editing `report.md` on a branch already merged into `main`
(or in another commit on the same branch, before merging):

| Status | Meaning |
|---|---|
| `new` | new - not reviewed yet |
| `in-progress` | in progress - someone is working on it |
| `done` | done - the report was handled or the idea shipped |
| `rejected` | rejected - we deliberately will not do it; leave one sentence of rationale in the description |

## How it gets into this directory

`POST /api/feedback/submit` (`server.js`, the feedback section) builds this directory in the
process memory and sends it to GitLab through the REST API — `POST /repository/branches` on
the branch `feedback/<type>-<stamp>-<slug>`, then `POST /repository/commits` with the whole
directory as `create` actions, then `POST /merge_requests` into `main` with
`remove_source_branch: true`. The working tree of this repository on the server's disk is not
touched at any step — the commit and the merge request exist only on the GitLab side.
