# Prototype starter: desktop

`POST /api/prototypes` with `kind: desktop` (the default when no kind is named)
copies `index.tsx` and `styles.css` to
`data-sub-repositories/ds-data/prototypes/<id>/`. The server substitutes
`{{PROTO_NAME_JSON}}` and `{{PROTO_ID}}` and generates `spec.json` (with
`frame: "app"`).

## What it contains

- the neutral application frame (`AppFrame`: top bar, side menu) from
  `../../components`, with the menu passed as props,
- two screens reached through the address hash (`#/overview`, `#/work`),
- building blocks from `../../ds` (button, card, empty state, callout, loader),
- demo states `overview`, `overview-empty`, `overview-loading`,
  `overview-error` and `work`,
- every screen carries `data-track-screen` and one action calls `track()`.

## Rules

- Imports only from `react`, `./styles.css`, `../_shared/*`, `../../ds`,
  `../../components` and the libraries listed in `scripts/_proto-imports.js`.
- Colours only through tokens; layout through `@container proto`, never `@media`.
- `CUSTOMIZE` in `index.tsx` marks the places to fit to the plan.
- Update `spec.json` whenever the scope changes.
