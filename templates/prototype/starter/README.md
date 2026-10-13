# Prototype starter

`POST /api/prototypes` copies `index.tsx` and `styles.css` to
`data-sub-repositories/ds-data/prototypes/<id>/` (the server substitutes
`{{PROTO_NAME_JSON}}` and `{{PROTO_ID}}` and generates `spec.json`). This is the
**only** starter.

## What it contains

- one empty screen for the prototype's content, with the states ready, empty,
  loading and error,
- `demoStates` read through `useDemoState` from `../_shared/demo-state`
  (the build shell ships a default copy; a team may override it in
  `ds-data/prototypes/_shared/`).

Demo states: `screen`, `screen-empty`, `screen-loading`, `screen-error`.

## Rules

- Imports only from `react`, `./styles.css`, `../_shared/*` and the libraries
  listed in `scripts/_proto-imports.js`.
- Colours only through tokens; layout through `@container proto`, never `@media`.
- `CUSTOMIZE` in `index.tsx` marks the places to fit to the plan.
- Update `spec.json` whenever the scope changes.
