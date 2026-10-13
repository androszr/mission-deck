---
title: "{Short user story title}"
type: user-story
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — as whom, what, why}"
---

# Template: User Story

> **How to use:**
> - Fill in the header and the sections before Discovery starts, then expand them in each phase
> - Check it against the Definition of Ready before moving it to Delivery as Ready for Planning
> - Acceptance criteria = scenarios to verify (not functional requirements — those go to the Requirements section)
> - ⚠️ The rules below are an example of a team convention. Queue names and conventions differ between projects - adapt them to yours.
> - A story in the Jira **Discovery** project (e.g. `DISC`) = a story created and developed during Discovery
> - A story in the Jira **Delivery** project (e.g. `PROJ`) = a story handed over to the team for delivery
> - Only a story from the Delivery queue can enter a sprint — after PO acceptance and once it meets the Definition of Ready
> - Every story should be linked to a specific epic
> - Link the story in Jira to its related tickets — dependencies, blockers, delivery tasks
> - A story cannot go into refinement with open questions — every question must be closed or explicitly moved to Out of scope

---

## 📋 Header

| Field | Value |
|------|---------|
| **Epic** | {link to the epic} _(naming conventions → `epic-architecture.knowledge.md`)_ |
| **UX brief** | {link to the UX brief in the wiki} |
| **Figma** | {link to the mockup — a specific node} |
| **Related stories** | {links to related user stories, if any} |
| **Dependencies** | {links to blocking or blocked tickets} |
| **Label** | {e.g. orders / deliveries / inventory / catalog / labels / design} |
| **Kind of change** | {e.g. Project work} |
| **Applies to** | {e.g. Area A / Area B / Product} |
| **Work type** | {e.g. Development (CAPEX) / Business analysis — TO-BE state (CAPEX)} |

---

## User Story

> As a **{user role}** I want **{action / capability}** so that **{goal / value for the user}**.

---

## Context and goal

_{A short description — why this story exists, which problem it solves, what happens without this feature. 2–4 sentences. May refer to a business process or a user journey.}_

---

## Functional requirements

_{The detailed logic of the system. These are not acceptance criteria — they describe what the system must do. May include field mappings, screen states, error handling, edge conditions.}_

### 1. {Requirement area name}

1.1. {Requirement}

1.2. {Requirement}

### 2. {Requirement area name}

2.1. {Requirement}

_(Numbered sections — every requirement has a unique id such as 1.1 or 2.3, which makes them easy to refer to in QA and in comments)_

---

## Acceptance criteria

_{Testable scenarios that verify the story is done from the user's point of view. Every criterion should give an unambiguous YES/NO answer. They do not describe how the system works inside — they describe what the user sees and can do.}_

> **Tips:**
> - Add 1–2 sentences describing the scope of this section — what the ACs cover (e.g. "The ACs cover the main path of receiving a delivery and handling quantity discrepancies")
> - If a criterion refers to a specific view, add a link to the Figma node next to that AC
> - Put explicitly excluded items in the Out of scope section, with a reason

- [ ] **AC1:** {The user can / The system shows / When X, then Y}
- [ ] **AC2:** {Error scenario — when X, the system shows Y}
- [ ] **AC3:** {Edge scenario — when X is empty/null/invalid, then...}

_(Tip: every AC should answer the question "can a tester verify this without looking at the code?")_

---

## High-level estimate

- AN/AR: —
- BE: —
- Web: —
- Android: —
- iOS: —
- Design: —
- Tests: —
- PM / DevOps: —
- **TOTAL: —**

**Roles:**
- [ ] Owner
- [ ] Manager
- [ ] Operator
- [ ] Viewer
- [ ] Admin

Notes: —

---

## Out of scope

_{What is explicitly excluded from this story. Especially important when part of a feature is "visible but inactive" or "handled in a separate requirement".}_

- {Item X — handled in {link to the ticket}}
- {Item Y — outside the scope of this iteration, decision: {reason}}

---

## Open questions

| # | Question | Owner | Status |
|---|---------|------------|--------|
| 1 | {question} | {name / role} | ⏳ Open |
| 2 | {question} | {name / role} | ✅ Closed: {answer} |

---

## Notes / design decisions

_{Optional — agreements from refinement, decisions that matter in hindsight, context that does not fit the other sections.}_

---

## Technical criteria (optional)

_{Additional technical requirements — API error handling, performance limits, security. Filled in by the SA or BA after consulting the development team.}_

- {e.g. The endpoint must answer in < 500 ms at p95}
- {e.g. On an HTTP 5xx error the system shows message X and logs the event}
- {e.g. Sensitive data is not logged on the client}
