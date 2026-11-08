---
name: briefing
description: >-
  Builds or updates a self-playing briefing (a demo presentation for operational staff) from the
  team's clickable prototypes: content.json chapters and steps, pictures recorded from the real
  prototypes by scripts/proto-record.mjs (camera, cursor and click tracks written by
  scripts/proto-build-content.mjs), captions that double as the narration script. Use when the
  user says "briefing", "demo for operations", "presentation of the prototype", "record the frames
  again" or calls /briefing.
---

# Briefing

> **TL;DR:** A briefing is a prototype of kind `briefing` in team data
> (`data-sub-repositories/ds-data/prototypes/<id>/`). It explains a change to people who will never
> open the clickable prototypes - shift leads, managers, trainers. The story lives in
> `content.json`, the pictures are RECORDED from the real prototypes (never drawn, never edited by
> hand) from `recording.json`, and the player in `index.tsx` plays them with a camera, a cursor and
> optional browser narration. The example is `proto-e15c0a7d3b96` in the sample data
> (`examples/prototypes/proto-e15c0a7d3b96/`); the starter is `templates/prototype/starter/briefing/`.

## Args

`/briefing <idea or prototype id>` - optional. Names the briefing to build or re-record. Empty ->
ask once which change the briefing explains and for whom.

## Phase 1: the briefing exists

A new briefing is created through `POST http://localhost:3001/api/prototypes` with
`{ "name": "<short name>", "kind": "briefing" }` (or with Design > Prototypes > Add prototype >
Briefing). The response's `item.id` is the prototype id; the server staged `index.tsx`,
`styles.css`, `content.json`, `recording.json` and `spec.json`. Never invent an id. Planning and
the shared gates are the `/prototype` flow (`.claude/skills/prototype/SKILL.md`); this skill adds
the story and the recording.

## Phase 2: story first

Agree the chapters with the user before anything is recorded: opening, why (with sources), how it
looks (one recorded step per screen idea), questions, summary. One idea per step; the caption is
ONE or two sentences and is exactly what the narrator says.

## Phase 3: content

Edit `content.json`. Step types the starter player plays: `card`, `agenda`, `summary`. The example
adds `why`, `compare`, `screen`, `phone` and `faq`; copy the renderers it needs (and the
`ScreenShot` / `PhoneBezel` custom elements for recorded steps, registered in `spec.json`
`customElements[]` and marked `/* CUSTOM: Name */` in `styles.css`). Every factual claim in a `why`
carries a `source` key from `sources` - no source, no claim.

## Phase 4: the recording script

For each `screen` / `phone` step add an entry with the SAME id to `recording.json`:
`{ "steps": [ { "id", "proto", "device": "desktop" | "phone", "frames": [ ... ] } ] }`. A frame is
`{ state?, cur?, act?, cam?, key?, ms }`: the demo state to open (first frame; a new value reopens
the page), `cur` where the cursor is when the action happens, `act` the action BEFORE the
screenshot, `cam` what the camera frames after it, `key` a label for a keyboard action, `ms` the
time on screen. Locators use visible text and aria-labels, never generated class names:
`a=<aria-label>`, `b=<button name>`, `t=<visible text>`, `tab=`, `cb=`, `ph=<placeholder>`,
`css=<selector>`. Actions: `click:<loc>`, `hover:<loc>`, `key:<Key>`, `type:<text>`,
`wheel:<dy>`, `wait:<ms>`. `node scripts/proto-record.mjs --help` lists everything.

## Phase 5: record and build

1. Start a local preview of the prototypes the briefing shows: Design > Prototypes > the
   prototype > Local preview (the answer carries `http://localhost:<port>/<slug>`), for each
   source prototype, or build a throwaway shell with
   `node scripts/proto-shell-check.js --prototypes <dirs> --out <tmp>` and serve its `dist` with
   `vite preview`.
2. Record: `node scripts/proto-record.mjs --briefing <briefing dir> --base <preview address> --out <recordings dir>`
   (add `--only id,id` to redo some steps). The tool needs the build shell's `playwright`
   (`npm install` in the shell once) and a Chromium (`node scripts/bootstrap-playwright.js`, or
   `PW_CHROMIUM_PATH`).
3. Write the pictures and tracks into the briefing:
   `node scripts/proto-build-content.mjs --briefing <briefing dir> --out <recordings dir>`.
   Never edit `frames` or `motion` in `content.json` by hand; re-run the tool instead.
4. Read every new frame back - a frame is evidence, not decoration.

## Phase 6: key frames

A step that stands still (browsing, paused, reduced motion) shows its key frame (default: the last
frame). When the last frame is the state AFTER the point (window closed, back on the list), set
`keyframe` on the step to the index that shows the point.

## Phase 7: check

1. `node scripts/check-proto-ds.js <briefing dir>` exits 0.
2. `node scripts/proto-record.mjs --check-frames <briefing dir> --base <preview address>` exits 0:
   the built briefing shows every picture, with no page error. A kept-old viewer (a shell whose
   `BreakpointViewer.tsx` was edited by a team) has no `?chrome=0`; the tool then says so.
3. Walk every step in the viewer at 1536 and 768, play once with narration, then publish through the
   normal prototype flow.

## Hard rules

- Re-record the affected steps whenever a source prototype changes - stale frames are the most
  common briefing defect. The recording tool makes that a two-command job; never patch frames by hand.
- Change the narration voice only together with re-generating ALL clips (when pre-generated audio
  exists), so a briefing never mixes voices. This pipeline uses browser speech only.
- No real people's faces or names in a briefing that leaves the team; initials avatars only.
- Captions are on by default; the choice is remembered per viewer.
- Prototype files are written on the filesystem only - never `git` inside `data-sub-repositories/`.
