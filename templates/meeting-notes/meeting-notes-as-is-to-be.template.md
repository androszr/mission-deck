---
title: "AS IS → TO BE workshop: {Topic}"
type: meeting
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — what the meeting was about and its main takeaway}"
---

# Template: Meeting / workshop summary (Meeting Notes)

> **How to use:**
> - Use this template to summarise **discovery workshops / process mapping AS IS → TO BE** sessions with the business (e.g. customers, the operations team, head office).
> - The AS IS / TO BE / Constraints sections are optional — remove them if the meeting was of a different kind (e.g. status, decision, Q&A only).
> - Fill it in from the audio transcript (`*.mp3.json`) or your own notes; keep quotes verbatim — they are strong evidence of the participants' intent.
> - **Always add a key quote + its author next to pains and requirements** — it protects against reinterpretation during analysis.
> - **Convert relative dates to absolute ones** (e.g. "in January" → "January 2026"), so the document still reads well later.
> - Timestamps from the recording in the "Attachments / sources" section help you get back to the context without listening again.
> - Name the file following the convention: `workshop-{topic-kebab}-summary.md` or `meeting-{topic-kebab}-{YYYY-MM-DD}.md`.

> **When to use:**
> - after workshops with the business (gathering needs, mapping the AS IS process, defining TO BE)
> - after discovery / Q&A sessions with end users
> - after decision meetings whose outcomes must feed further analysis / refinement
> - as input to later user stories, Jira tasks and UX briefs
>
> **When NOT to use:**
> - if it was a 1-on-1 / 1-on-2 interview with one interviewee (no process mapping with several participants) → use `meeting-notes-discovery-interview.template.md`
> - if it was observation at the workplace / shadowing → use `meeting-notes-contextual-inquiry.template.md`
> - if it was an evaluation interview about an existing product → use `meeting-notes-product-feedback-interview.template.md`
> - if the only goal was to make a decision → use `meeting-notes-decision.template.md`
> - if it was a status / sync → use `meeting-notes-status-update.template.md`
> - if it was the start of a new initiative → use `meeting-notes-kickoff.template.md`
> - if it was a wrap-up of a finished stage → use `meeting-notes-retrospective.template.md`

---

# {Meeting type}: {Topic} — summary

**Source file:** [{transcript file name}]({link-to-file})
**Meeting date:** {YYYY-MM-DD}
**Duration:** ~{NN} min
**Initiative / epic:** {initiative name, where it was raised — e.g. a customer council, ticket PROJ-XXX}
**Meeting goal:** {one sentence: what exactly we wanted to get out of the meeting — e.g. gather business needs for the AS IS and TO BE of process X}

## Participants (roles)

- **{Group 1, e.g. Customers / Operations}:** {Name (role, short context — tenure, expertise, role in the meeting)}, {Name (role)}
- **{Group 2, e.g. The organisation / product}:** {Name (PO/analysis/UX/Technology)}, {Name (role)}
- **Mentioned (absent but referred to):** {Name — context, agreement, open thread}

---

## TL;DR (one paragraph)

_{Max. 5–8 sentences. What is the core? What problem? What key agreement? Which TO BE direction? What was explicitly postponed to a separate thread? Write it so that someone who was not at the meeting understands the direction without reading the rest of the document.}_

---

## AS IS — the canonical model of {documents / the process / the domain}

_{Optional — when the meeting mapped a process. If it fits, use an ASCII diagram (flow of documents, states, roles). Goal: one glance and you know how it works today.}_

```
{Step 1} → {Step 2} → {Step 3}
              │
              ├──> {Variant A — e.g. a side document}
              │
              └──> {Variant B}
                    ├─ {Sub-variant}
                    └─ {Sub-variant}
```

**Key invariant / business rule:** `{formal notation, e.g. invoice == sum(delivery notes) ± adjustment record}`

---

## AS IS — the "{operation name as the business calls it}" process (step by step)

_{Fill this in if someone ran a live demo or described the flow. A numbered list of actions + what the user sees + where they reach "outside the system" (a printed invoice, a calculator, a spreadsheet, a document portal, other apps).}_

1. {Step 1 — where they go in, what they click}
2. {Step 2 — what they enter, which field}
3. {Step 3 — what the system shows, what is missing from the view}
4. {Step N — finalisation, document status}

**Cycle / volume:**

- {Persona A}: {frequency — daily / weekly / monthly}
- {Persona B}: {frequency}
- Volume: {e.g. ~NNN cases a month / an invoice with NN line items}

## AS IS — {a second stage / variant / related process — optional}

_{Optional — if an important parallel thread came up that is not the main topic. Summarise it in 3–6 points and clearly mark its status: closed / postponed to a separate thread / needs a decision.}_

- {What it is / what it is for}
- {How it works today}
- {Real incidents caught thanks to it — with evidence, e.g. "Name in January 2026 — a duplicated invoice for 18k"}

**Status in the workshop:** {e.g. "raised as another equally important stage — the participants agreed to come back to it separately"}

---

## AS IS — problems / "pains" (the clearly articulated ones)

_{Each pain = one sentence + a verbatim quote or evidence from the workshop. No interpretation. Number them — it is easier to refer to them in tasks later ("solves pain #3, #7").}_

| # | Pain | Quote / evidence from the workshop |
|---|-----|---------------------------|
| 1 | {Short description of the pain} | {Name: "verbatim quote"} |
| 2 | {Short description of the pain} | {Name: "verbatim quote" / description of the situation} |
| 3 | {Short description of the pain} | {Name: "verbatim quote"} |

---

## TO BE — expectations captured during the workshop

> **Key quote ({Name}):** "{the verbatim quote that best captures the target direction — often a participant's spontaneous summary}".

### Functional requirements (ordered by priority from the workshop)

1. **{Requirement 1 — short name}** — {description of what exactly should happen; edge conditions; a participant's quote if helpful}.
2. **{Requirement 2}** — {description}:
   - {sub-condition},
   - {sub-condition},
   - {sub-condition}.
3. **{Requirement 3}** — {description}.
4. **{Requirement N}** — {description + any clarifications in a quote}.

### Non-functional requirements

- {Scale / volume — e.g. invoices with hundreds of line items}
- {Performance / response time — e.g. data available immediately}
- {Accessibility / UX for new users}
- {Security / compliance / regulations}

---

## Constraints / "things that will not change"

_{Very important — the participants said plainly what IS a business rule and is NOT negotiable in TO BE. Skip it and you risk a design proposal that gets rejected in five minutes.}_

- **{Rule 1}** — {why we do not change it}:
  1. {reason 1},
  2. {reason 2}.
- **{Rule 2}** — {rationale}.
- {The process has two / several variants — the TO BE solution must handle **all** of them}.

---

## Open questions (to address in process mapping / with the analyst)

_{Everything the meeting could not settle. Each question should have an owner for the answer — or a clear "for analysis" / "for technology" / "for the business".}_

1. {Question 1 — specific, worded so it can be answered yes/no or with a number}
2. {Question 2}
3. {Question N}

---

## Action items (next steps agreed in the workshop)

| # | What | Who | Due |
|---|----|-----|--------|
| 1 | {A concrete action — e.g. map the process with the analyst} | {Name / roles} | {YYYY-MM-DD or "before the next meeting"} |
| 2 | {Action} | {Name} | {due} |
| 3 | {Action} | {Name} | {due} |

---

## Pointers for the AS IS analysis

_{What exactly the analyst should close after this meeting — so they do not start from zero. Bullet points, short.}_

- Map a **BPMN diagram / sequence** of the "{name}" process with its artefacts: {list of documents / entities mentioned in the workshop}.
- Inventory **the places where the user reaches "outside the system"** — {examples from the workshop: a printed invoice, a calculator, a spreadsheet, email}.
- Measure **volumes** (if the data allows): {what exactly — e.g. documents per persona per month, the average number of line items, the distribution of discrepancy types}.
- Catalogue **the classes of {cases / discrepancies / variants}** with examples from the workshop as test cases.
- Record **external dependencies** — {e.g. agreements with specific people, integrations with external systems}.

## Pointers for the TO BE design

_{Short hints for the UX / product designer. Not a design — directions.}_

- The user's default screen: {an idea for the "happy path" — e.g. a list with a match flag, most items auto-matched}.
- For {exceptions / discrepancies}: {a detail with a type label + a link to the source document + a "one-click" action}.
- A mechanism for {detecting duplicates / X} based on: {attributes, confidence levels}.
- Onboarding a new user: {a guided mode / tutorial — explicitly raised by the participants as valuable}.
- {Source of truth} for {entity}: design the integration so that the need for {today's workaround} disappears.

---

## Attachments / sources

- Audio transcript (segments with timestamps and speakers): [{file name}]({link})
- Key moments in the recording:
  - {MM:SS} — {who and about what — e.g. "introduction, meeting goal"}
  - {MM:SS} — {who and about what}
  - {MM:SS} — {who and about what}
  - {MM:SS} — {agreeing the next steps}
- Related documents:
  - {link to the user story / Jira task / previous summary, if this continues it}
  - {link to the ux-brief / task template, if they came directly out of the workshop}
