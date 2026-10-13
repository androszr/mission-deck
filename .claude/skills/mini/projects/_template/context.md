# {{Project name}} project context

<!-- Copy to projects/<project-key>/context.md and fill every section from the real code.
     The planner and the implementer read this file first; it is their ground truth. -->

## Identity

| Field | Value |
|---|---|
| `project` | `{{project-key}}` |
| `keywords` | `{{comma-separated words the idea text may use to name this project}}` |
| `src_dir` | `data-sub-repositories/{{repo-dir}}/src/` |
| `src_repo` | `data-sub-repositories/{{repo-dir}}/` ({{remote url}}) |
| `build_clone` | {{path of a deploy clone, or `none` - never edited by hand}} |
| `build_gate` | `cd data-sub-repositories/{{repo-dir}} && npm run build` |
| `lint_gate` | `cd data-sub-repositories/{{repo-dir}} && npm run lint` |
| `slug_prefix` | `{{xx-}}` |
| `entry` | `src/main.tsx -> src/App.tsx -> {{RootComponent}}.tsx` |
| `deploy` | {{how and where it deploys; whether the deployed site has a live API}} |

## Data layer

{{baked JSON under `public/data/`, localStorage helpers in `src/lib/*Storage.ts`, live API or none.
State explicitly whether `fetch('/api/...')` works after deploy.}}

## Design-system library

{{`src/ds/` component list and the barrel `src/ds/index.ts`; the token file (`src/ds/tokens.css`)
and any app-level CSS with shared class prefixes.}}

## Navigation and routing

{{the nav model file, the fixed tab list, `BottomNav` items, the shell switch in the root
component, the hash-route helper and its grammar; how a tab is added.}}

## Shells and breakpoints

{{`useBreakpoint()` location; `MobileShell` / tablet shell / desktop shell names; the tablet
condition `(min-width: 768px) and (min-height: 500px)`; desktop `(min-width: 1024px)`.}}

## Theme

{{`data-theme` handling, the theme hook, where dark-mode overrides live and any duplicated blocks
that must be kept in sync.}}

## Auth and analytics

{{ACL layer or `none`; tracking or `none`.}}

## Spacing and vertical rhythm

Section title to content `space-16`; between groups 20-24px; list row padding `space-12`; card
internal padding `space-8 space-12`; stacked items `space-8` gap; `border-bottom` between rows.

## Project-specific rules (planner + implementer)

- {{e.g. "every visible ticket key navigates to TicketDetailScreen"}}
- {{e.g. "new baked data files are registered in <snapshot function>"}}

## Preflight extras

<!-- Optional. Each line: `- [project] <rule text> -> BLOCK|WARN`. Phase 4.5 applies them only to
     plans whose **Project:** is this project. -->
