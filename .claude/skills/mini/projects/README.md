# Mini project registry

`/mini` plans and implements changes in **mini-format apps**: small Vite + React 18 + TypeScript
applications with their own repository, their own `src/ds/` component library and their own
build and lint gates. The cockpit repo never contains their source - only the plan in `plans/`
and the context file here.

The registry ships empty. To register an app:

1. Clone its repository next to the team data repo, e.g.
   `data-sub-repositories/<name>/` (it is gitignored there; the app's own git stays untouched by
   the agents - they only write files).
2. Copy `_template/context.md` to `projects/<project-key>/context.md`.
3. Fill the identity table (`src_dir`, `src_repo`, `build_gate`, `lint_gate`, `slug_prefix`,
   `entry`, `keywords`) and every architecture section from the real code - the planner and the
   implementer read this file as ground truth, so a wrong path here sends them to the wrong file.
4. Optionally add `## Preflight extras` - project-specific plan checks the Phase 4.5 checklist
   applies only to this project.

Directories starting with `_` are ignored by the skill.
