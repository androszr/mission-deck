# Question bank (mini apps)

`/mini` loads both groups and asks **at most 3** questions, one `AskUserQuestion` at a time. Skip a
question the idea text or the source tree already answers.

## Group: component scope

**Q1:** What kind of change is this?
- `new-screen` - a new tab or screen reachable from the navigation
- `extend-component` - a change to an existing screen or component
- `shared-util` - a hook or helper shared across screens, no new UI
- `ds-component` - a change to the project's `src/ds/` library

Skip when the idea names one ("new tab for...", "add a hook that...").

## Group: data source

**Q2:** Where does the data come from?
- `mock` - hardcoded English mock data, like the existing screens
- `fetch-json` - a static JSON file fetched at runtime
- `storage` - localStorage-backed CRUD, like the project's existing storage helpers
- `none` - pure UI

Read the context file's data layer first - a project without a live API only supports `mock`,
`fetch-json` and `storage`; a live `fetch('/api/...')` is a WARN in the plan.

**Q3** (only for `new-screen` or `extend-component`): styling?
- `own-module` - a new `Component.module.css`
- `extend-existing` - rules added to an existing module or the app-level CSS
- `tokens-only` - no new CSS file

## How the skill picks

Q1 and Q2 always unless answered by the idea; Q3 only when a screen or component changes. Never
more than 3 - the planner notes remaining open points in `## Context`.
