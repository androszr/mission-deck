---
title: "Retrospective: {Sprint / stage name}"
type: meeting
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — what the meeting was about and its main takeaway}"
---

# Template: Retrospective / stage wrap-up (Meeting Notes)

> **Purpose of this template (read carefully before you pick it):**
> - A **retrospective** — we look back at a finished period (sprint, quarter, project stage, rollout, incident) and draw conclusions.
> - Formats that fit this template: "start / stop / continue", "what went well / what went wrong / what to change", "4 L's (liked, learned, lacked, longed for)", an incident post-mortem.
> - Goal: **lessons learned** + concrete process improvements for the next stage. It is NOT a status ("what we did") but a reflection ("why it turned out this way and what we take from it").
>
> **When NOT to use:**
> - if it was a sync reporting progress → use `meeting-notes-status-update.template.md`
> - if the goal was to settle a specific decision → use `meeting-notes-decision.template.md`
> - if it was a discovery workshop with the business → use `meeting-notes-as-is-to-be.template.md`
> - if it was a qualitative interview with a user → use `meeting-notes-discovery-interview.template.md`
> - if it was observation at the workplace / shadowing → use `meeting-notes-contextual-inquiry.template.md`
> - if it was an evaluation interview about an existing product → use `meeting-notes-product-feedback-interview.template.md`
> - if it was the start of a new stage → use `meeting-notes-kickoff.template.md`
>
> **How to use:**
> - **Separate observations from interpretations** — first what happened, then why (a hypothesis), then what we take from it.
> - Every action item needs an owner and a due date — otherwise the retrospective turns into venting with no effect.
> - If the retrospective was an incident post-mortem, also fill in the "Incident timeline" section.
> - **Blame-free**: describe events, not faults. Names are fine with facts ("X deployed"), not with judgements ("X made a mistake").
> - **Convert relative dates to absolute ones**.
> - Name the file: `retro-{stage-kebab}-{YYYY-MM-DD}.md` or `post-mortem-{incident-kebab}-{YYYY-MM-DD}.md`.

---

# Retrospective: {Stage / Sprint / Initiative / Incident} — {YYYY-MM-DD}

**Source file:** [{transcript / notes file name}]({link})
**Meeting date:** {YYYY-MM-DD}
**Duration:** ~{NN} min
**Retrospective format:** {start-stop-continue / went-well-wrong-change / 4L / post-mortem / other}
**Period under review:** {from YYYY-MM-DD to YYYY-MM-DD — e.g. sprint 23, Q1 2026, rollout X}
**Initiative / epic / incident:** {name, context, link to the epic/ticket if it fits}

## Participants

- **{Group 1, e.g. Delivery team}:** {Name (role)}, {Name (role)}
- **{Group 2, e.g. Stakeholders}:** {Name (role)}
- **Facilitator:** {Name}
- **Absent (their perspective collected asynchronously):** {Name — through which channel}

---

## TL;DR (one paragraph)

_{Max. 4–6 sentences. What the stage was → overall assessment → 1–2 biggest successes → 1–2 biggest lessons → the most important process change we are making.}_

---

## What went well (continue)

_{Things we want to repeat. Not generalities ("good atmosphere") — specifics that can be repeated in the next stage.}_

1. **{Success 1}** — {description + a quote or example: "thanks to this we managed X"}
2. **{Success 2}** — {description}
3. **{Success N}** — {description}

---

## What did not work (problem)

_{Specific situations, decisions, mechanisms that got in the way. No personal blame — describe facts, not faults.}_

| # | What | When / context | Effect |
|---|----|-------------------|--------|
| 1 | {what happened / what was missing} | {when, in which stage} | {what suffered because of it} |
| 2 | {…} | {…} | {…} |
| 3 | {…} | {…} | {…} |

---

## Improvement ideas (start / change)

_{What we start doing / what we change. Every idea should link to a specific problem above — otherwise we drift into abstraction.}_

1. **{Idea 1}** — addresses problem #{number} → {description of the process change}
2. **{Idea 2}** — addresses problem #{number} → {…}
3. **{Idea N}** — {…}

---

## Lessons learned (cross-cutting)

_{What we take beyond this single stage — conclusions about the way of working in general. Short, as keywords.}_

- {Lesson 1 — e.g. "we do not start implementation without approved UX mockups, because it leads to rework"}
- {Lesson 2}
- {Lesson N}

---

## Incident timeline (ONLY for a post-mortem)

_{Fill this in only if the retrospective was a post-mortem of a production incident. Otherwise remove this section.}_

| Time | What happened | Who detected / reacted | Decision / action |
|------|--------------|--------------------------|------------------|
| {YYYY-MM-DD HH:MM} | {trigger — what set off the incident} | {monitoring / user / Name} | {…} |
| {YYYY-MM-DD HH:MM} | {detection} | {Name} | {…} |
| {YYYY-MM-DD HH:MM} | {mitigation} | {Name} | {…} |
| {YYYY-MM-DD HH:MM} | {resolution} | {Name} | {…} |

**Detection time (from trigger to detection):** {NN minutes}
**Mitigation time (from detection to mitigation):** {NN minutes}
**Resolution time (from trigger to full resolution):** {NN minutes/hours}
**User impact:** {how many users, which features, for how long}
**Root cause:** {one sentence — what the actual cause was}
**Contributing factors:** {what else made the problem possible / worse}

---

## Stage metrics (if measured)

_{Optional. Actual vs planned values.}_

| Metric | Plan | Result | Comment |
|---------|------|-------|-----------|
| {e.g. velocity} | {NN} | {NN} | {…} |
| {e.g. % of tickets delivered} | {NN%} | {NN%} | {…} |
| {e.g. number of bugs after release} | {<NN} | {NN} | {…} |

---

## Action items (who, what, when)

| # | What | Who | Due | Related problem |
|---|----|-----|--------|--------------------|
| 1 | {a concrete process action} | {Name} | {YYYY-MM-DD} | #{problem number} |
| 2 | {…} | {Name} | {YYYY-MM-DD} | #{…} |
| 3 | {…} | {Name} | {YYYY-MM-DD} | #{…} |

---

## Team sentiment (optional)

_{Briefly — how the team felt during this stage. Helps to track burnout / motivation trends over time.}_

- **Energy:** {low / medium / high}
- **Confidence in the direction:** {low / medium / high}
- **Main sources of frustration:** {1–3 keywords}
- **Main sources of satisfaction:** {1–3 keywords}

---

## Attachments / sources

- Transcript: [{file name}]({link})
- Related:
  - [{retrospective of the previous stage}]({link}) — trend comparison
  - [{board / dashboard with metrics}]({link})
  - [{post-mortem / RCA}]({link}) — if it concerns an incident
