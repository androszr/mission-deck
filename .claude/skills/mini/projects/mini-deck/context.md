# Mini Deck project context

<!-- Ground truth for the planner and the implementer. Filled from the real code in apps/mini-deck/. -->

## Identity

| Field | Value |
|---|---|
| `project` | `mini-deck` |
| `keywords` | `mini deck, mini, mobile, pwa, companion, phone` |
| `src_dir` | `apps/mini-deck/` |
| `src_repo` | `.` (this repository; the app lives in `apps/mini-deck/`, no separate remote) |
| `build_clone` | none |
| `build_gate` | `npm run build:apps` |
| `lint_gate` | `npm run lint:apps` |
| `slug_prefix` | `md-` |
| `entry` | `src/main.tsx -> src/App.tsx -> shell/Shell.tsx` |
| `deploy` | Static hosting of `apps/mini-deck/dist/` (no live API). Auth: none; a Cloudflare Access recipe is future work. |

Test gate: `npm run test:apps` (Vitest, `src/**/*.test.ts(x)`). Dependencies are installed with `npm --prefix apps/mini-deck install`; public npm only.

## Data layer

Baked JSON under `public/data/<screen>.json` (`sprints`, `bugs`, `on-call`, `team`), each with a `generatedAt` ISO stamp. Loaded by `src/lib/useData.ts` with `fetch` of a static file; there is no live API after deploy. The data is synthetic (squads Atlas..Falcon, invented names). No localStorage except the theme preference (`mini-deck.theme`).

## Design-system library

`src/ds/` holds `Pip` (the mascot as loading, empty and error state; artwork in `public/mascot/`) and `Icon` (inline Lucide-style SVG), exported by the barrel `src/ds/index.ts`. Tokens are copies of Mission Deck's `css/ds-tokens.css` and `css/ds-tokens-dark.css` in `src/styles/`; app CSS in `src/styles/app.css` uses `md-` class names and `var(--...)` tokens only. No hex colour outside the two tokens files (`src/policy.test.ts` enforces it, plus ASCII). Font: Inter, in `public/fonts/`.

## Navigation and routing

`src/shell/navItems.ts` lists the four screens (Sprints, Prod bugs, On-call, Team). Routing is hash based, `src/lib/hashRoute.ts`: `#/sprints`, `#/bugs`, `#/on-call`, `#/team`; unknown hashes fall back to sprints. To add a screen: add its id to `ROUTES`, an entry to `NAV`, an icon, a screen component with `Screen` and a baked JSON, and a branch in `App.tsx`.

## Shells and breakpoints

`src/lib/breakpoints.ts`: phone < 768, tablet 768-1023, desktop >= 1024 (by width). `Shell` mounts `Nav` as a side rail on desktop and as the bottom bar otherwise - one tree, chosen in code, never two trees hidden by CSS.

## Theme

`src/lib/theme.ts`: preference light / dark / system, stored in localStorage, applied as `data-theme` on `<html>`; dark overrides live in `src/styles/ds-tokens-dark.css`.

## Auth and analytics

Auth: none. Analytics: none (no analytics code).

## Spacing and vertical rhythm

Section title to content `space-16`; between groups 20-24px; list row padding `space-12`; card internal padding `space-12`; stacked items `space-8` gap.

## Project-specific rules (planner + implementer)

- Every screen is a pure `XView({data})` plus a thin `XScreen` that loads its JSON; the Vitest render test targets the View.
- The staleness banner is driven by `generatedAt` of the active screen's data.
- Source is ASCII and English; no company names, hosts or real people anywhere under `apps/`.
- No service worker (installable, not offline).

## Preflight extras

- [mini-deck] a plan that adds a dependency not on public npm -> BLOCK
