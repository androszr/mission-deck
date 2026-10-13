# Prototype template "Demo – how we work with Mission Deck"

This directory is not a starter for `POST /api/prototypes`. It is read only by
`scripts/demo-export.js`, which turns the static demo from `demo/` into a prototype
in the team data (`data-sub-repositories/ds-data/prototypes/<id>/`).

- `index.tsx` – a thin wrapper: one frame (`<iframe>`) from the same origin
  pointing at `assets/demo__index.html`. The script substitutes `{{PROTO_SLUG}}`.
  The demo states are the versions of the demo: `full` (Full) and `short` (Short).
- `styles.css` – two layout rules, no colours and no tokens.

Both files in the prototype directory are **generated**: do not edit them there by hand.
Change `demo/` (or this template) and run again:

```
node scripts/demo-export.js --out <absolute path of the prototype directory>
```

The prototype directory must already exist and have a `spec.json` – it is created by
Design > Prototypes > "Add prototype". Publishing is a separate decision
(the "Publish" button); before it, send the product data in the sync window.
