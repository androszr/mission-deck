# Sample team: Northwind Product

A fictional product team used for screenshots, tests and "Try it with sample
data" in the onboarding wizard. Six squads (Atlas, Borealis, Comet, Delta, Echo,
Falcon), 24 invented people, one quarter of history (2026-07-01 to 2026-09-30).
Everything is made up; the vendors are Acme Ltd, Globex and Initech.

`ds-data/` has the layout of the team data repository, one folder per module
path. Do not edit it by hand: it is written by

```bash
node scripts/sample-team.js
```

which is deterministic (a seeded generator and a fixed clock), so running it
again changes nothing. `tests/test_sample_team.mjs` fails when this folder is
out of date. How the app uses it: `docs/architecture/sample-mode.md`.
