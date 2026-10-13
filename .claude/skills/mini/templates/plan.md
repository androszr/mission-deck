<!--
Mini-app plan template - the only template /mini uses. Shared by every registered project.
NEVER REMOVE H2 SECTIONS. The implementer uses ## Steps as the source of truth and ## Test plan
as the gate; the verifier reads ## Acceptance criteria.
-->

# {{title}}

**Date:** {{date}}
**Slug:** {{slug}}
**Project:** {{project key from the registry}}
**Status:** draft
**Surface:** {{new-screen | extend-component | shared-util | ds-component}}
**Working dir:** `{{src_repo}}` (source of truth); {{build clone, if the context names one - never edited by hand}}

## Idea

{{one paragraph in the planner's words; name the project}}

## Context

- {{existing components touched, the screen this mirrors, constraints from the context file}}
- {{decisions from the interview}}

## Files to change

- `{{src_dir}}{{path}}` - {{what and why, one line}}

## New files

- `{{src_dir}}{{path}}` - {{purpose, one line}}

## Steps

- [ ] 1. {{actionable step naming the DS components and CSS module it touches}}
- [ ] 2. {{...}}

## Breakpoint behavior

- **Mobile (<=767px):** {{unchanged | the explicit change}}
- **Tablet (768px+, min-height 500px):** {{layout}}
- **Desktop (1024px+):** {{layout}}

## Risks & footguns

- Mobile regression: {{why this plan cannot change mobile, or the step that does}}
- {{barrel export, CSS module class name, nav entry, hash segment}}

## Test plan

Test budget: 0 new test cases - mini apps have no test runner; the gates plus a manual check.

- [ ] `{{build_gate}}` exits 0
- [ ] `{{lint_gate}}` exits 0
- [ ] Manual: {{golden path - what to tap and what should render, at each breakpoint}}

## Acceptance criteria

3-8 criteria, each observable from file state or verifiable by one command; at least one guards
mobile.

- [ ] AC1: {{`grep -c 'DSButton' {{src_dir}}components/Foo.tsx` returns >= 1}}
- [ ] AC2: `{{build_gate}}` exits 0
- [ ] AC3: `{{lint_gate}}` exits 0
- [ ] AC4: {{`grep -c '@media (max-width' {{src_dir}}<file>.module.css` returns 0}}

## Out of scope

- {{what a reader might assume is included but is not}}

## Iteration log

- {{date}} initial draft
