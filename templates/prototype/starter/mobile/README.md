# Prototype starter: mobile

`POST /api/prototypes` with `kind: mobile` copies `index.tsx` and `styles.css`
to `data-sub-repositories/ds-data/prototypes/<id>/`. The server substitutes
`{{PROTO_NAME_JSON}}` and `{{PROTO_ID}}` and generates `spec.json` (with
`frame: "phone"`).

## What it contains

- the phone frame (`PhoneFrame`: compact top bar, bottom tab bar) from
  `../../components`, with the tabs passed as props,
- two tabs reached through the address hash (`#/home`, `#/list`),
- a bottom sheet (`DSBottomSheet`) named for analytics with `trackScreen`,
- demo states `home`, `home-empty`, `home-loading`, `home-error`,
  `home-sheet` and `list`.

## Rules

- Imports only from `react`, `./styles.css`, `../_shared/*`, `../../ds`,
  `../../components` and the libraries listed in `scripts/_proto-imports.js`.
- Colours only through tokens; layout through `@container proto`, never `@media`.
- `CUSTOMIZE` in `index.tsx` marks the places to fit to the plan.
- Update `spec.json` whenever the scope changes.
