---
name: refresh-repo-map
description: Refreshes the repo map the planner reads instead of searching the tree -
  `.claude/skills/new-idea/templates/repo-map/overview.md`. Use when the user says
  "refresh the repo map", "refresh repo map", the map is stale, or after a structural
  change (new view, new endpoint, new module, new script). Runs
  `node scripts/gen-repo-map.js`, which rewrites only the region between the `generated`
  markers, and shows what changed. No agent, no model - one command.
---

# Refresh repo map

> **TL;DR:** `node scripts/gen-repo-map.js`. Regenerates only the block between the `generated`
> markers in `.claude/skills/new-idea/templates/repo-map/overview.md`; the hand-written prose above
> and below it survives. `--check` answers "is it stale?" without writing anything.

## When

- After adding or removing a view, an endpoint, a module in `js/`, a script in `scripts/` or a test.
- When `/new-idea` Phase 0 or `--check` reports `REPO MAP: STALE`.
- Before a longer planning session - the planner reads the map instead of exploring the tree, so a
  stale map sends it to files that do not exist.

## Steps

1. Check whether it is needed at all:

   ```
   node scripts/gen-repo-map.js --check
   ```

   Exit `0` - the map is current, done. Exit `1` - stale, carry on. Exit `2` - usage error.

2. Rewrite the generated region:

   ```
   node scripts/gen-repo-map.js
   ```

3. Show the user the difference with one command and summarise it in two sentences:

   ```
   git diff --stat -- .claude/skills/new-idea/templates/repo-map/overview.md
   ```

   Name what really appeared or disappeared: views, routes, modules, scripts, tests. Do not paste
   the whole diff.

## Hard rules

- **Do not hand-edit the map inside the `generated` region.** The script overwrites it on the
  next run anyway. Hand-written prose belongs outside the markers.
- **Do not commit.** A human looks at the change and approves it.
- The map describes the repo, not plans - nothing outside `overview.md` changes here.
