# README screenshots

Every picture in the README is a real screen of Mission Deck running on the
fictional sample team (`examples/sample-team/`), light theme, 1280 pixels wide.
`shots.json` lists what to capture (view, size, steps before the capture, an
optional crop); `scripts/readme-shots.mjs` captures it.

## Re-capture

```bash
node scripts/readme-shots.mjs              # every shot
node scripts/readme-shots.mjs --only sprint-stats,roadmap
node scripts/readme-shots.mjs --list
```

`shots.json` also fixes the browser clock (`clock`, the last day of the
sample quarter, so the roadmap's day strip and every "overdue" read the way the
data intends) and who the app greets (`identity`, a sample person, never the
git name of whoever runs the script).

The script starts Mission Deck on a spare port (3777, `--port` to change) in
sample mode, with every folder it writes to inside one temporary directory, so
your own `data/`, `modules/` and team data are never read or changed. It stops
the server and deletes the directory when it is done.

Playwright is not a dependency of the repository. The script finds it through
`$PLAYWRIGHT_MODULE` (a path to a `playwright` package folder) or, failing
that, an installed `playwright`. Its browser comes from `npm run setup`.

## Rules

- Add a shot to `shots.json`, run the script, commit the PNG. Names are lowercase with dashes.
- Keep the total under 4 MB (screens and posters together; about 3.2 MB today).
- A step is one of `click`, `clickIfPresent`, `fill`, `press`, `waitFor`, `waitMs`, `hide` (a CSS selector to hide) and `scrollIntoView`.
- `data-stays-yours.svg` is a drawing, not a capture; edit it by hand.
- `mini-deck-*.png` are Mini Deck phone screens, taken by `scripts/readme-showcase.mjs phone` (below), not by this list.

## Showcase posters

The big 1200 x 1200 pictures that open the README and its main sections live
in `showcase/`, the way Dark Army's front page does it: a headline, a line of
copy and the real screenshots above framed as windows and phones. Each poster
is an HTML layout in `showcase/src/<name>.html` (shared look in
`showcase/src/poster.css`, the DS brand ramp on a dark background, Inter from
`fonts/`), rendered by:

```bash
npm run build:apps                           # Mini Deck must be built for its phone shots
node scripts/readme-showcase.mjs             # phone shots, then every poster
node scripts/readme-showcase.mjs compose     # posters only, after a re-capture above
```

`phone` serves `apps/mini-deck/dist` on a loopback port (3778) with a fixed
clock, so the data-age banner never appears. `compose` renders each layout at
1200 x 1200 and refuses when a layout names a picture that does not exist.
The fix for a wrong poster is a change to its layout and a re-run, never an
edit of the PNG. Each poster stays under 800 KB.
