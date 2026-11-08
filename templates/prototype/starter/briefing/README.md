# Prototype starter: briefing

`POST /api/prototypes` with `kind: briefing` copies `index.tsx`, `styles.css`,
`content.json` and `recording.json` to
`data-sub-repositories/ds-data/prototypes/<id>/`. The server substitutes
`{{PROTO_NAME_JSON}}` and `{{PROTO_ID}}` in `index.tsx` and generates
`spec.json` (with `frame: "none"`).

## What it contains

- a self-playing player: start screen, captions, optional browser narration,
  previous/next/play, a progress bar and the keys arrows, Space, C and M,
- three step types - `card`, `agenda`, `summary` - and one chapter of each in
  `content.json` (the caption of a step is the narration script),
- `recording.json` with no steps yet: the list of pictures to record from the
  real prototypes (see the `/briefing` skill and `scripts/proto-record.mjs`).

## Rules

- The address holds the step: `#/<chapter id>/<step number>`.
- Imports only from `react`, `./styles.css`, `./*.json`, `../_shared/*`,
  `../../ds` and the libraries listed in `scripts/_proto-imports.js`.
- Colours only through tokens; layout through `@container proto`, never `@media`.
- Steps that show recorded pictures need the `ScreenShot` custom element of
  the example briefing; register it in `spec.json` and mark it in `styles.css`.
