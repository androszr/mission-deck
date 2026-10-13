---
title: "Decision meeting: {Topic}"
type: meeting
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — what the meeting was about and its main takeaway}"
---

# Template: Decision meeting (Meeting Notes)

> **Purpose of this template (read carefully before you pick it):**
> - A meeting whose goal was **to make a specific decision** — choosing an option, approving a direction, settling a dilemma, accepting a proposed solution.
> - Typical signals: someone said things like "we need to decide…", "do we go with A or B", "we need sign-off", "let's agree on the approach".
> - The main output: **an unambiguous record of the decision** + its rationale + what happens next. The document also serves as an ADR (architectural decision record) or PDR (product decision record) for posterity.
>
> **When NOT to use:**
> - if the meeting only reported progress → use `meeting-notes-status-update.template.md`
> - if it was a discovery workshop / process mapping → use `meeting-notes-as-is-to-be.template.md`
> - if the conversation was with one interviewee / a qualitative interview → use `meeting-notes-discovery-interview.template.md`
> - if it was observation at the workplace / shadowing → use `meeting-notes-contextual-inquiry.template.md`
> - if it was an evaluation interview about an existing product → use `meeting-notes-product-feedback-interview.template.md`
> - if it was a review of a finished stage → use `meeting-notes-retrospective.template.md`
> - if it was the start of a new initiative → use `meeting-notes-kickoff.template.md`
>
> **How to use:**
> - **The decision must be worded UNAMBIGUOUSLY** — no "probably", "rather", "I guess so".
> - Record every option considered, even the rejected ones — it protects against second-guessing later ("why didn't you consider X?").
> - For each option: arguments for/against + who made them (a key quote, if there was a discussion).
> - Mark **who the decision-maker was** (RACI: A — Accountable) — it is not always a consensus.
> - **Convert relative dates to absolute ones**.
> - Name the file: `decision-{topic-kebab}-{YYYY-MM-DD}.md` or `adr-{NN}-{topic-kebab}.md`.

---

# Decision: {Decision title — one unambiguous sentence}

**Source file:** [{transcript / notes file name}]({link})
**Meeting date:** {YYYY-MM-DD}
**Duration:** ~{NN} min
**Initiative / epic:** {name, context}
**Decision status:** {made / conditional — requires X / postponed / proposal awaiting approval}

## Participants (and their role in the decision, per RACI)

- **Decision-maker (A — Accountable):** {Name (role)} — the person who formally approved it
- **Consulted (C — Consulted):** {Name (role)}, {Name (role)}
- **Carrying out the decision (R — Responsible):** {Name (role)}, {Name (role)}
- **Informed (I — Informed):** {Name / team — who needs to be told}

---

## TL;DR (one paragraph)

_{Max. 4–6 sentences. What had to be decided → which options → what was chosen → why → what changes now. Someone who was not at the meeting should understand the decision without reading the rest.}_

---

## Decision

> **{The full wording of the decision — ideally in the present tense, as a statement of fact, not a recommendation. E.g. "We migrate reporting from system X to Y by the end of Q3 2026."}**

**Effective from:** {YYYY-MM-DD or "immediately"}
**Valid until:** {when the decision is reviewed — e.g. "after the first rollout" / "in 6 months" / "indefinitely"}

---

## Context — why we had to make this decision at all

_{2–5 sentences. What changed around us so that a decision was needed? Which problem are we solving? What happens if we do not decide?}_

- **Problem / motivation:** {…}
- **Trigger (what created the need for a decision):** {…}
- **Cost of doing nothing:** {what exactly suffers if we stay with the status quo}

---

## Options considered

### Option A: {name} — **{CHOSEN / rejected / postponed}**

- **Description:** {what exactly this option means}
- **For:** {arguments + possibly a quote: "{verbatim quote}" — {Name}}
- **Against:** {arguments + quote}
- **Cost / effort:** {rough}
- **Risks:** {main ones}

### Option B: {name} — **{CHOSEN / rejected / postponed}**

- **Description:** {…}
- **For:** {…}
- **Against:** {…}
- **Cost / effort:** {…}
- **Risks:** {…}

### Option C: {name} — **{CHOSEN / rejected / postponed}**

_{Add more options as needed. If there was only one realistic option, keep one and say so plainly: "the other options were ruled out early because of X".}_

---

## Rationale for the chosen option

_{Why this one won and not another. Concretely — which argument tipped the balance. If it was controversial, note who objected and why (this matters to whoever comes back to the document a year later).}_

- **Main argument:** {…}
- **What we knowingly give up by choosing this option:** {the trade-off we accepted}
- **Dissenting voices (if any):** {Name — "{quote}"} → {how they were addressed / why they were set aside}

---

## Assumptions the decision rests on

_{If any of these assumptions stops being true, the decision needs a re-review. This is the key section for future analysis.}_

1. {Assumption 1 — e.g. "the quarterly budget stays at X"}
2. {Assumption 2}
3. {Assumption N}

---

## Consequences — what changes

- **What we start doing:** {…}
- **What we stop doing:** {…}
- **Who needs to be told:** {specifically — a message to team X, an email to Y}
- **What needs updating in the documentation:** {links / document names}
- **Impact on other initiatives / teams:** {…}

---

## Open questions (things we did not settle)

_{What we did not close — with the owner of the answer and a due date. Do not put rhetorical questions here — only real issues to address.}_

1. {Question 1} — answer: {Name}, due: {YYYY-MM-DD}
2. {Question 2} — answer: {Name}, due: {YYYY-MM-DD}

---

## Action items

| # | What | Who | Due |
|---|----|-----|--------|
| 1 | Communicate the decision {to whom, through which channel} | {Name} | {YYYY-MM-DD} |
| 2 | {rollout step 1} | {Name} | {YYYY-MM-DD} |
| 3 | {rollout step 2} | {Name} | {YYYY-MM-DD} |

---

## Attachments / sources

- Transcript: [{file name}]({link})
- Key moments in the recording:
  - {MM:SS} — {problem introduced}
  - {MM:SS} — {the moment the decision was made}
  - {MM:SS} — {dissenting voice / counter-argument}
- Related documents:
  - [{earlier decisions this one overrides / complements}]({link})
  - [{analysis, brief, RFC}]({link})
