---
title: "{Short task title}"
type: task
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — what needs doing and why}"
---

# Template: Task

> **How to use:**
> - A task is a smaller piece of work the team takes on for Discovery or Delivery.
> - ⚠️ The rules below are an example of a team convention. Queue names and conventions differ between projects - adapt them to yours.
> - A task in the Jira **Discovery** project (e.g. `DISC`) = work taken on for Discovery
> - A task in the Jira **Delivery** project (e.g. `PROJ`) = team work for delivery
> - Only a task from the Delivery queue can enter a sprint
> - Both kinds of task should be estimated in story points during refinement
> - A task for the DevOps team should carry: `label: DEVOPS`, `Sprint: DEVOPS BACKLOG`
> - Every task should be linked to a specific epic
> - Fill in the header and the sections before you start, then expand them in later phases
> - Check it against the Definition of Ready before moving it to Delivery as Ready for Planning

> **When to use:**
> - when the work does not need the User Story form — it does not have to deliver value to the end user on its own
> - a smaller piece of functionality or work that supports a user story or an epic
> - a concrete activity: technical (BE/FE/DB), analytical, QA, DevOps, design

---

## 📋 Header

| Field | Value |
|------|---------|
| **Epic** | {link to the epic} _(naming conventions → `epic-architecture.knowledge.md`)_ |
| **Task type** | {Implementation / Analysis / DevOps / Design / QA} |
| **Related user story** | {link to the user story this task comes from} |
| **Component / layer** | {e.g. BE / FE / DB / Infrastructure} |
| **Label** | {e.g. orders / deliveries / inventory / catalog / labels / design / DEVOPS} |
| **Kind of change** | {e.g. Project work} |
| **Applies to** | {e.g. Area A / Area B / Product} |
| **Work type** | {e.g. Development (CAPEX) / Business analysis — TO-BE state (CAPEX)} |

---

## Task goal

_{One sentence: what and why. Where this task comes from — a reference to the feature or problem in the user story.}_

> {e.g. "Align the data model of the Labels microservice with the current event contract, so that user story PROJ-XXXX works correctly."}

---

## Scope of work

_{A numbered list of concrete activities. Detailed enough to estimate and to track progress.}_

### 1. {Work area}

- {Concrete change / action}
- {Concrete change / action}

### 2. {Work area}

- {Concrete change / action}

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

## Dependencies and risks

_{Optional — what could block the work, what has to be ready before it starts.}_

- {Dependency / risk}
