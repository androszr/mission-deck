---
title: "Discovery interview: {Name / Role}"
type: meeting
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — what the meeting was about and its main takeaway}"
---

# Template: User interview / discovery (Meeting Notes)

> **Purpose of this template (read carefully before you pick it):**
> - A **qualitative interview / user interview / discovery session** with 1–3 people (most often from the business: a customer, an app user, a domain expert, a stakeholder).
> - Goal: **understand the interviewee's perspective** — their work, pains, context, vocabulary. **We do not formally map an AS IS → TO BE process** (if the interview grew into a mapping workshop, use the as-is-to-be template).
> - **A classic qualitative interview with no process observation and no specific product in the background** — e.g. "tell me what a typical day looks like", "what frustrated you at work recently". If the conversation was "how do you use app X" or you observed the person at their workplace, see "When NOT to use".
> - Output: insights + quotes + pains + the interviewee's ideas — raw research material for further analysis.
>
> **When NOT to use:**
> - if it was **observation at the workplace** (contextual inquiry / shadowing / a research visit to a site or office) → use `meeting-notes-contextual-inquiry.template.md`
> - if it was an **evaluation interview about an existing product** ("how do you use app X, what works, what hurts") → use `meeting-notes-product-feedback-interview.template.md`
> - if it was a process-mapping workshop (several participants, a live demo, a document flow) → use `meeting-notes-as-is-to-be.template.md`
> - if it was a team status / sync → use `meeting-notes-status-update.template.md`
> - if the goal was to make a decision → use `meeting-notes-decision.template.md`
> - if it was the start of a new initiative → use `meeting-notes-kickoff.template.md`
> - if it was a wrap-up of a finished phase → use `meeting-notes-retrospective.template.md`
>
> **How to use:**
> - **Verbatim quotes** — the foundation of a qualitative interview. No paraphrasing, no interpretation inside a quote.
> - Every pain / insight → a short description + a verbatim quote with the interviewee's name. Number them — easier to refer to later.
> - Keep **what the interviewee said** apart from **what we conclude from it** (a separate "interpretation / hypotheses" section).
> - **Convert relative dates to absolute ones**.
> - Name the file: `interview-{interviewee-role-kebab}-{YYYY-MM-DD}.md` or `discovery-{topic-kebab}-{YYYY-MM-DD}.md`.

---

# Interview: {Interviewee role / name} — {Topic / area}

**Source file:** [{transcript file name}]({link})
**Date of the conversation:** {YYYY-MM-DD}
**Duration:** ~{NN} min
**Format:** {1-on-1 / 1-on-2 / group session of N people / phone / online meeting / on-site}
**Initiative / context:** {name of the initiative the discovery is part of}
**Goal of the conversation:** {one sentence — e.g. understand how the customer handles the returns process}

## Interviewees

- **{Name (role)}** — {time in the role, short context: kind of site, region, experience}
- **{Name (role)}** — {context, if there were more people}

## Interviewers

- {Name (PO / UX / Researcher / Analyst)}, {Name (role)}

---

## TL;DR (one paragraph)

_{Max. 4–6 sentences. Who, about what, the most important takeaways, which key quote captures the essence, what the next action is. Write it so a teammate does not need to listen to the recording.}_

---

## Key quote (the strongest moment of the conversation)

> **{Name}:** "{verbatim quote — the one that best captures the interviewee's tone, pain or aspiration}"
>
> _Context:_ {what was happening in the conversation when this was said}

---

## Conversation topics (interview structure)

_{One sub-heading per major topic that came up. Under each: a 3–6 sentence summary + 1–2 verbatim quotes. Follow the order of the conversation or regroup by theme — whichever reads better.}_

### {Topic 1 — e.g. "What a typical working day looks like"}

{A short summary of what the interviewee said — 3–6 sentences.}

> **{Name}:** "{verbatim quote}"

### {Topic 2 — e.g. "What annoys you most in the current tool"}

{Summary.}

> **{Name}:** "{quote}"
> **{Name}:** "{quote}"

### {Topic 3 — …}

{…}

---

## Pains / problems (the clearly articulated ones)

_{Each pain = one sentence + a quote. No interpretation. Number them.}_

| # | Pain | Quote / evidence |
|---|-----|---------------|
| 1 | {short description of the pain} | {Name}: "{verbatim quote}" |
| 2 | {short description of the pain} | {Name}: "{quote or description of the incident}" |
| 3 | {…} | {…} |

---

## The interviewee's ideas / suggestions

_{What they proposed themselves — even if infeasible. Do not dismiss it straight away — a naive idea sometimes hides a real need.}_

1. **{Idea 1}** — {description + quote}
2. **{Idea 2}** — {description + quote}
3. **{Idea 3}** — {description}

---

## What the interviewee would **NOT** do / will not agree to

_{A very valuable section — explicitly stated constraints, "red lines". Skip it and you risk a proposal that will be rejected.}_

- **{Constraint 1}** — {why, a quote if helpful}
- **{Constraint 2}** — {…}

---

## The interviewee's vocabulary (glossary)

_{Terms the interviewee used differently from us, or specific to their domain. Important — using them in the UI / communication lowers the barrier to adoption.}_

| Interviewee's term | What they mean by it | What we call it |
|-----------------|---------------------|--------------------|
| {"{term}"} | {definition as they understand it} | {our equivalent / none} |
| {"{term}"} | {…} | {…} |

---

## Team interpretation / hypotheses (separate from the quotes)

_{Here you may interpret. Clearly marked as our interpretation, not the interviewee's words. This is the input for further analysis.}_

- **Hypothesis 1:** {…} — _supported by_: pain #2, #5; quote from topic "X"
- **Hypothesis 2:** {…}
- **Worth verifying in the next interviews:** {…}

---

## Open questions

1. {Question 1 — what we did not get to ask / what needs clarifying}
2. {Question 2}
3. {Question N}

---

## Action items

| # | What | Who | Due |
|---|----|-----|--------|
| 1 | {e.g. send the findings to the PO} | {Name} | {YYYY-MM-DD} |
| 2 | {e.g. invite another interviewee from a different persona} | {Name} | {YYYY-MM-DD} |
| 3 | {e.g. go back to the interviewee with a prototype} | {Name} | {YYYY-MM-DD} |

---

## Attachments / sources

- Audio transcript: [{file name}]({link})
- Key moments:
  - {MM:SS} — {topic / key quote}
  - {MM:SS} — {"aha" moment}
  - {MM:SS} — {pain #N}
- Related interviews / documents:
  - [{another interview with the same persona / initiative}]({link})
  - [{user story / brief}]({link})
