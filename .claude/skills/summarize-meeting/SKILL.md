---
name: summarize-meeting
description: >-
  Generates a meeting summary from a transcript or notes, using the templates in
  `templates/meeting-notes/`. Use when the user says "summarize the meeting",
  "meeting summary", "summarize meeting", points at a transcript file or calls
  /summarize-meeting. Two passes: pick the best template, then fill it with the
  content. Reads files from `user-data/transcripts/` (.txt, .md, .json, .docx), writes
  the result to `user-data/meetings/`. Works without a running server and without
  Python - Node only.
---

# Summarize Meeting

> **Files I write:** `user-data/meetings/<YYYY-MM-DD-HHmmss-topic>.md`
>
> **TL;DR:** Drop a transcript into `user-data/transcripts/` and run `/summarize-meeting`. Pass 1
> picks the best template from `templates/meeting-notes/`, pass 2 fills it in English. After
> generation you can `accept`, `regen <notes>` or `cancel`. No server, no Python.

## Args

`/summarize-meeting [path]` - an optional path to a specific `.txt`, `.md`, `.json` or `.docx`
file. Empty -> the skill lists what is in `user-data/transcripts/` and lets you pick.

## Automation

One command does the mechanical half. Always pass `--dir user-data/transcripts` with `--list`, so
the skill and the script agree on the folder whatever the script's default is:

```
node scripts/extract-transcript.js --list --dir user-data/transcripts   # candidate files, one per line
node scripts/extract-transcript.js <file> --out <tmp>     # extract plain text (txt/md/json/docx)
node scripts/extract-transcript.js --templates            # JSON [{name, path, topSection}]
node scripts/extract-transcript.js --slug "<topic>"       # ASCII kebab slug, max 60 chars
```

Exit codes: `0` ok, `1` nothing found or unreadable input, `2` usage error.

## Steps

### Step 1: pick the transcript

```
node scripts/extract-transcript.js --list --dir user-data/transcripts
```

Exit 1 with an empty list -> tell the user:

> The `user-data/transcripts/` folder is empty. Drop a file (.txt, .md, .json or .docx) into it
> and run again.

and stop. An argument was passed -> use it (verify it exists). One file -> take it and say which.
Several -> `AskUserQuestion` (max 4 options per call; more than 4 -> a numbered list and a free
text reply).

### Step 2: extract the text

```
node scripts/extract-transcript.js "<file>" --out "<scratchpad>/transcript.txt"
```

`.docx` is unzipped and stripped in-process; a `.json` transcript is flattened to
`speaker: text` lines; `.txt` and `.md` pass through. A failure exits 1 with the reason - show it
and stop. Otherwise report: `Extracted ~N characters. Preview: <first 200 chars>...`

### Step 3: gather the templates

```
node scripts/extract-transcript.js --templates
```

Returns a JSON array of `{ name, path, topSection }` for every
`templates/meeting-notes/*.template.md` - `topSection` is the purpose block under the
`# Template:` heading that the selector reads. Empty -> pass `TEMPLATES: none` (the agent falls
back to a 5-section summary).

### Step 4: spawn the summarizer

Banner `summarize-meeting/summarizer`: shown by the `PreToolUse` hook on `Agent` (`scripts/hook-agent-banner.js`, wired in `.claude/settings.json`) as the call fires - do not run the script and do not paste it yourself.

```
Agent({
  subagent_type: "meeting-summarizer",
  description: "Summarize: <filename>",
  prompt: "TRANSCRIPT_FILE: <absolute path to the extracted text>
OUTPUT_DIR: <absolute path to user-data/meetings>
TEMPLATES: <the JSON array, or none>
<on a regeneration also: REGEN_NOTES: <the user's words>>"
})
```

It returns `OUTPUT: <path>` plus a 5-line abstract.

### Step 5: preview and confirm

Show the abstract, then `AskUserQuestion`:

- `accept` - keep it (already written)
- `regen <notes>` - re-spawn with `REGEN_NOTES`
- `cancel` - delete the generated file (`rm <path>`) and say `File deleted.`

### Step 6: hand off

Print the absolute path. On macOS reveal it (`open -R "<path>"`, best effort, ignore failures).
Remind the user that `user-data/` is gitignored, so the summary stays local.

## Notes

- Filename pattern `YYYY-MM-DD-HHmmss-<topic>.md`; the slug is ASCII, the prose is English.
- Templates live in `templates/meeting-notes/` - eight meeting types. Add one by dropping a
  `*.template.md` there with the same purpose / "when not to use" block at the top.
- Works offline: no `/api/*` call, no running server, Node only.
- The finished document belongs in `user-data/`, never back in `templates/`.
