---
title: "Kickoff: {Initiative name}"
type: meeting
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — what the meeting was about and its main takeaway}"
---

# Template: Initiative / project kickoff (Meeting Notes)

> **Purpose of this template (read carefully before you pick it):**
> - A **kickoff** meeting — the formal start of a new initiative / project / epic / large stream of work.
> - Typical signals: "we are starting topic X", "first meeting about the initiative", "presenting the scope and roles", "agreeing the goal and what success means".
> - Goal of the document: **capture a shared understanding** of the goal, scope, roles, risks and schedule right at the start — to avoid diverging interpretations three months later ("I thought we were doing X, not Y").
> - Often paired with a brief / project charter — this template is its shorter, "notes" version.
>
> **When NOT to use:**
> - if the initiative is already running and this was another status → use `meeting-notes-status-update.template.md`
> - if the goal was to settle a single decision → use `meeting-notes-decision.template.md`
> - if we mapped an AS IS / TO BE process → use `meeting-notes-as-is-to-be.template.md`
> - if it was a qualitative / discovery interview with 1–3 people → use `meeting-notes-discovery-interview.template.md`
> - if it was observation at the workplace / shadowing → use `meeting-notes-contextual-inquiry.template.md`
> - if it was an evaluation interview about an existing product → use `meeting-notes-product-feedback-interview.template.md`
> - if it was a wrap-up of a finished stage → use `meeting-notes-retrospective.template.md`
>
> **How to use:**
> - **Define success measurably** — if you cannot say how we will know it worked, do not start the initiative.
> - **Scope: in / out** — say plainly what we are NOT doing. Without this section scope creep is guaranteed.
> - **Record assumptions and risks even when they are "obvious"** — in six months they will not be.
> - **Convert relative dates to absolute ones**.
> - Name the file: `kickoff-{initiative-kebab}-{YYYY-MM-DD}.md`.

---

# Kickoff: {Initiative name} — {YYYY-MM-DD}

**Source file:** [{transcript / notes file name}]({link})
**Meeting date:** {YYYY-MM-DD}
**Duration:** ~{NN} min
**Initiative / epic:** {name + link to the epic in Jira / the wiki}
**Initiative sponsor:** {Name (role) — the budget / decision owner}
**Product owner:** {Name}
**Tech lead:** {Name}

## Participants

- **Sponsor / decision-makers:** {Name (role)}, {Name (role)}
- **Delivery team:** {Name (role)}, {Name (role)}, {Name (role)}
- **Business stakeholders:** {Name (role)}, {Name (role)}
- **Mentioned (important but absent):** {Name — context, when they will be brought in}

---

## TL;DR (one paragraph)

_{Max. 5–8 sentences. Why we are starting → which problem we solve → for whom → how we will recognise success → when we want to finish → who is steering. Write it so that someone joining the initiative a month from now understands everything from it.}_

---

## Initiative goal

### Problem / opportunity

_{2–4 sentences. What exactly is happening (or not happening) that we need to start this initiative? Why now?}_

### Business goal

_{One sentence — what we want to deliver for the business. "So that [persona] can [do X] faster / better / at all".}_

### Value hypothesis

_{What we expect to happen once we deliver the solution. "We believe that [change] will lead to [effect]; we will measure it with [metric]."}_

---

## Definition of success (how we will know it worked)

_{Measurable. No "better", "faster", "more efficient" without numbers. If we have no baseline yet, write "to be measured during discovery".}_

| # | Success metric | Baseline (today) | Target | Measured on |
|---|------------------|-----------------|--------|----------------|
| 1 | {e.g. time to handle process X} | {NN min} | {NN min} | {YYYY-MM-DD, e.g. 3 months after release} |
| 2 | {…} | {…} | {…} | {…} |
| 3 | {…} | {…} | {…} | {…} |

**Anti-metrics (what we watch so that it does NOT drop):** {e.g. customer NPS, adoption of another feature, the time of another process}

---

## Scope

### In scope (we do it)

1. {Scope item 1}
2. {Scope item 2}
3. {Scope item 3}

### Out of scope (we knowingly do NOT do it in this initiative)

_{A critical section — it protects against scope creep. Name the things someone might want to add along the way.}_

1. {What we postpone + why — e.g. "integration with system Z — postponed to the next iteration because of a dependency on team Q"}
2. {…}

### May come into scope conditionally

_{Things we will let in if time / budget allows. A clear "nice-to-have", not a commitment.}_

- {…}
- {…}

---

## Personas / who we are doing this for

_{The primary and secondary personas affected. Without this section the project ends with a generic solution for nobody.}_

- **Primary:** {persona — who they are, their key job-to-be-done}
- **Secondary:** {persona}
- **Impact on other groups:** {e.g. operations, support — how the change will affect them}

---

## Assumptions (the plan is built on)

_{If any of these assumptions stops being true, the plan needs a re-review.}_

1. {Assumption 1 — e.g. "the integration with X will be available from Q2 2026"}
2. {Assumption 2 — e.g. "we have a budget for external vendor Y"}
3. {Assumption N}

---

## Constraints / "things that will not change"

_{Named in the meeting as hard constraints — regulations, board decisions, integrations we do not touch.}_

- **{Constraint 1}** — {why}
- **{Constraint 2}** — {why}

---

## Risks and mitigation

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|--------|--------------------|-------|-----------|------------|
| 1 | {risk description} | {L/M/H} | {L/M/H} | {what we do so it does not materialise} | {Name} |
| 2 | {…} | {…} | {…} | {…} | {…} |
| 3 | {…} | {…} | {…} | {…} | {…} |

---

## Schedule (milestones)

_{High level — not a detailed plan, but a contract on the main checkpoints.}_

| Milestone | What we deliver | Planned date |
|-----------|----------------|----------------|
| M1 — {name} | {e.g. discovery closed, go/no-go decision} | {YYYY-MM-DD} |
| M2 — {name} | {e.g. MVP rolled out to a pilot} | {YYYY-MM-DD} |
| M3 — {name} | {e.g. full rollout} | {YYYY-MM-DD} |
| M4 — {name} | {e.g. first measurement of the success metrics} | {YYYY-MM-DD} |

**Next checkpoint:** {YYYY-MM-DD} — {what exactly should be ready by then}

---

## Roles and responsibilities (RACI)

_{List the key roles — who is responsible for what. It does not have to be a full RACI matrix, but every role on the team should know what is expected of it.}_

| Role | Person | Main responsibility |
|------|-------|--------------------------|
| Sponsor | {Name} | Budget, escalation, final decision |
| Product owner | {Name} | Priorities, scope, contact with the business |
| Tech lead | {Name} | Architecture, quality, technical decisions |
| UX / designer | {Name} | Design, qualitative research |
| Analyst | {Name} | Requirements, process mapping, data |
| QA | {Name} | Test strategy, quality |
| {other role} | {Name} | {…} |

---

## External dependencies

_{What we need from people / teams / systems outside our team for the initiative to succeed.}_

- **{Team / system 1}** — {what we need, by when, who on their side is our contact}
- **{Team / system 2}** — {…}

---

## Open questions

1. {Question 1 — who answers, by when}
2. {Question 2}
3. {Question N}

---

## Action items (after the kickoff)

| # | What | Who | Due |
|---|----|-----|--------|
| 1 | {e.g. prepare the brief / user story for refinement} | {Name} | {YYYY-MM-DD} |
| 2 | {e.g. register the initiative in Jira / the wiki} | {Name} | {YYYY-MM-DD} |
| 3 | {e.g. schedule the first workshop with the business} | {Name} | {YYYY-MM-DD} |
| 4 | {e.g. agree how the metric baselines are measured} | {Name} | {YYYY-MM-DD} |

---

## Attachments / sources

- Transcript: [{file name}]({link})
- Related documents:
  - [{brief / project charter}]({link})
  - [{epic in Jira}]({link})
  - [{the initiative's wiki folder}]({link})
  - [{earlier analyses / discovery we build on}]({link})
