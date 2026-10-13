# Meeting Transcripts

The module turns a meeting recording - audio only or video, e.g. from Teams - into a transcript with speaker labels and timestamps, plus a summary written with the best-matching template from `templates/meeting-notes/`. All the work is done by Gemini Flash - always the newest Flash version available to your key (the module checks Google's model list once an hour; when that fails it uses `gemini-3.8-flash`). There is no model picker on purpose: Flash only (Pro is slower and more expensive, and it did not produce noticeably better meeting notes).

Page: **Knowledge > Meeting Transcripts**.

## Requirements

- An open vault (Bitwarden) - key `GEMINI_PERSONAL_TOKEN` (item `GEMINI`). The page notices on its own when the vault opens.
- `ffmpeg` and `ffprobe` on the system: macOS `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg` (then restart Mission Deck).

## Output

Two files per recording, side by side in `user-data/transcripts/`:

- `<YYYY-MM-DD-HHmmss>-<name>.html` - **a meeting report on the shared report template** (`templates/meeting-report.template.html`, logo embedded, no scripts, one self-contained file): participants with roles, TL;DR, key numbers, topics, decisions, action items with status, risks, questions and answers, open issues, next steps and the full transcript. On the page: "HTML report" in the row and in the details window; for older files "Build report" (`POST /report-build`).
- JSON: `user-data/transcripts/<YYYY-MM-DD-HHmmss>-<name>.json` (a private folder, outside the team data repositories):

```json
{
  "schemaVersion": 1,
  "source_file": "Meeting.mp4", "source_bytes": 123, "processed_at": "ISO",
  "duration_sec": 3600, "model": "gemini-3.8-flash",
  "status": "ok | partial", "warnings": [],
  "title": "", "brief": "",
  "participants": [{ "name": "", "speaker_id": "" }],
  "segments": [{ "speaker_id": "", "start": 0, "end": 0, "text": "" }],
  "transcript_txt": "[00:00:01] Alex: ...",
  "summary": { "chosen_template": "", "template_reason": "", "summary_md": "" }
}
```

`segments` keeps its historical name, so `node scripts/extract-transcript.js <file>.json` and `/summarize-meeting` read this file unchanged.

`warnings`: `chunk-failed:<from>-<to>` (that fragment has no transcript, status `partial`), `speakers-not-unified` (speakers labelled with a fragment prefix `s1_`, `s2_`), `summary-failed` (only the transcript was saved).

## How it works

1. The browser uploads the file in 6 MB chunks (`/upload-start`, `/upload-chunk`, `/upload-finish`, then `/enqueue`) - the module host accepts JSON only, and a whole recording in one request would not fit in memory. Limit 2 GB.
2. Queue (`server/index.js`, `pipeline.runJob`): ffmpeg extracts the audio (mono, 16 kHz, MP3) and cuts it into 5-minute fragments, Gemini transcribes 4 fragments at a time, gaps longer than 30 s are sent again, fragments are joined with a time offset and clipped to the recording length.
3. Speakers from different fragments are unified with one text request; when that fails they get a fragment prefix instead of a silent merge.
4. Summary: one request carrying the text of every notes template.
5. HTML report: one text request for the report content (the `report` field in the JSON), then `server/report.js` fills the template blocks - an empty block disappears, every text is escaped. When that request fails the report is built from the summary alone (`report-content-failed`).
6. Files are written atomically (tmp + rename); temporary files in `data/modules/meeting-transcripts/` are removed after each job, leftovers older than 24 h at startup.

Leaving the page or restarting does not interrupt the work: everything goes through a persistent queue. One job runs at a time.

## Speakers from the Teams picture (since 0.2.0)

For a video recording ffmpeg extracts one frame every 10 s into the job's working directory (`server/frames.js`):

1. From 5 frames (0:30, 2:00, 4:00, 1/3 and 2/3 of the recording) Gemini reads the labels under tiles and avatars; truncated names ("EXT Morgan A...") are merged and matched against the team directory (`ds-data/team/team-members.json`, read-only). Those names go into the transcription prompt.
2. After transcription Gemini points at the person with the active-speaker frame on frames from the middle of an utterance (8 s and longer) and from fragment boundaries; a majority of frames within an utterance corrects the speaker.
3. Each speaker gets a full name from the directory and a `member_id` (photo in the Meeting Archive).

Frames are deleted together with the working directory after every job. Warnings: `frames-failed`, `tile-names-failed`, `visual-speakers-failed` - the transcript is then built from the audio alone. Each job's log stays in the queue (the "Log" button).

## Queue, schedule and OneDrive (since 0.2.0)

- **Pause**: "Pause" at the top of the page stops the queue and the daily cycle (the current recording finishes). "Process again" on a finished OneDrive recording removes the result and downloads the recording again on the next check.
- **Queue** (`data/modules/meeting-transcripts/queue.json`): recordings uploaded by hand (`POST /enqueue`) and fetched from OneDrive. Statuses: queued, processing, done, error. Failed ones go back to the queue on the next cycle (up to 3 attempts); "Retry" always works. When the vault is closed the queue waits and starts by itself once it opens.
- **Schedule**: once a day at the configured hour (default 01:00). When the computer is asleep at that time, the cycle runs after wake-up the same day. Cycle: fetch new recordings from the OneDrive folders -> transcribe the queue -> (optionally) send to the Meeting Archive.
- **OneDrive**: no folders by default - add the recording folders you want to watch in the settings (the address of a personal OneDrive folder, `/personal/<user>/Documents/<folder>`, copied from the browser). Folder and file lists come from the SharePoint REST API, downloads go through `download.aspx` straight to disk (Playwright, `server/sso-worker.js`). Filters: video/audio extension, minimum size (50 MB), "since date", a per-cycle recording limit, skipping files changed in the last 15 minutes and recordings already in the Meeting Archive. Downloaded files are recorded in `onedrive-ledger.json`.
- **Microsoft session**: "Sign in to Microsoft" opens a browser. Every personal OneDrive is a separate site with its own cookie, so after sign-in the module visits every folder. **Keep-alive** (every 4 h by default) visits them in the background, refreshes the cookies and records each site's state (active / sign-in required). It cannot bypass your organisation's sign-in policy (MFA, sign-in frequency). The session lives in `data/modules/meeting-transcripts/sso/` (never in a data repository), and the shared seed `data/sso-shared/microsoft-session.json` is refreshed after every successful sign-in.
- **Send to the Meeting Archive**: a button on the transcript row, or automatically after the cycle (a setting). The module calls `POST /api/m/meeting-archive/publish`, which saves the meeting and sends it to the team right away.

## Exceptions to the conventions

- **Child processes:** the module runs `ffmpeg`/`ffprobe` through `execFile` (no shell, no `detached`) and the browser process `server/sso-worker.js` (Playwright via `npm exec`). No Python, no `curl`.
- **Key:** only in the `x-goog-api-key` header of a `fetch` call; never in a URL, process arguments, the log or the output file.

## Tests

`node --test modules/meeting-transcripts/tests/*.mjs` - pure functions from `server/lib.js` and the module contract; nothing calls Gemini or ffmpeg.

## Dashboard widget

The "Transcription queue" tile (`widgets[]` in `module.json`, `client/widget.js`) reads `GET /queue` and shows numbers only: items queued, in progress, failed and done, the progress of the current recording and the next run. After a server restart `current` is empty, so the progress ring disappears, and an empty queue gives a green "Queue empty" pill - unless the last cycle reported an expired Microsoft session or OneDrive errors (`lastRun.scan`): then the pill is a warning, because new recordings are not being fetched. Test: `test_meeting_transcripts_widget.mjs`.

## Out of scope

Only the Meeting Archive module writes to the team repository.
