# Phase 4.5: plan preflight checklist (mini apps)

Run these checks over the plan file with Bash/grep - no agent. Classify each finding `BLOCK` or
`WARN`. Rules tagged `[project]` apply only when the project's `context.md` lists them under
`## Preflight extras`; skip them otherwise. Read `**Project:**` from the plan to know which
context applies.

1. **Required H2 sections** - `## Idea`, `## Context`, `## Files to change`, `## Steps`,
   `## Risks & footguns`, `## Test plan`, `## Acceptance criteria`, `## Out of scope`,
   `## Iteration log`. Any missing -> `BLOCK`.
2. **Project field** - `**Project:**` names a registered project and every path in
   `## Files to change` / `## New files` starts with that project's `src_dir`. Otherwise -> `BLOCK`.
3. **Hardcoded hex** - `#[0-9a-fA-F]{3,6}` in the plan body outside code fences that quote existing
   code -> `WARN`; use the project's token file.
4. **Command-verifiable ACs** - each `## Acceptance criteria` line contains a backticked command,
   `grep`, `npm run`, `exits 0`, `MANUAL` or `file ... exists`. Otherwise -> `WARN`.
5. **DS import** - a step mentioning `button`, `input`, `modal`, `card`, `badge`, `select`,
   `checkbox` without `DS` or `ds/` in the same step -> `WARN`.
6. **Breakpoint coverage** - when the plan touches any `.tsx` or `.css` under `src_dir`, the body
   must state the tablet and desktop behaviour: grep for `768` AND (`1024` OR `desktop`). Neither
   -> `BLOCK` (mobile-only plan).
7. **No max-width media queries** - any `@media` line with `max-width` outside a quote of existing
   code -> `BLOCK`.
8. **Canonical tablet condition** - a new `@media (min-width: 768px)` without `min-height: 500px`
   in the same query -> `WARN`.
9. **Bottom sheet gating** - `DSBottomSheet` mentioned and `## Steps` names neither `isMobile` nor
   `useBreakpoint` -> `BLOCK`.
10. **Mobile-preservation statement** - `mobile` appears nowhere in `## Risks & footguns`,
    `## Out of scope` or `## Acceptance criteria` -> `WARN`.
11. **Spacing** - new UI whose steps use `space-4` or `space-6` for section gaps, row padding or
    card padding -> `WARN` (minimums: `space-16`, `space-12`, `space-8 space-12`).
12. **Gates from the registry** - `## Test plan` names the project's `build_gate` and `lint_gate`
    verbatim. Otherwise -> `BLOCK`.
13. **Hash routing** - a new tab, sub-view or detail view whose steps do not mention `useHashRoute`
    or the project's hash helper -> `WARN`.
14. **`[project]` extras** - every rule the context declares under `## Preflight extras`, with the
    severity it states.
