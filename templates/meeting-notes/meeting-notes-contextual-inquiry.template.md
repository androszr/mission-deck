---
title: "Research visit: {Topic}"
type: meeting
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — what the meeting was about and its main takeaway}"
---

# Template: Research visit / workplace observation (Meeting Notes)

> **Purpose of this template (read carefully before you pick it):**
> - A **contextual inquiry / shadowing / research visit** session — the researcher goes to the user and observes how they really carry out a process in their own work environment (a site, an office, a warehouse, in the field).
> - A hybrid of **observation + interview** — first we watch "what they really do", then we ask follow-up questions. Goal: see the **real workarounds, personal rules, moments of frustration** you will never hear about in a remote conversation.
> - Output: raw observational material + quotes + the researcher's hypotheses. Input to user stories, UX briefs, product decisions.
>
> **When NOT to use:**
> - if it was an interview without process observation (a remote conversation, "how is your work going?") → use `meeting-notes-discovery-interview.template.md`
> - if it was an evaluation interview about an existing product ("how do you use app X") → use `meeting-notes-product-feedback-interview.template.md`
> - if it was a process-mapping workshop with several participants → use `meeting-notes-as-is-to-be.template.md`
> - if it was a status / sync → use `meeting-notes-status-update.template.md`
> - if the goal was to settle a decision → use `meeting-notes-decision.template.md`
>
> **How to use:**
> - **Separate observation from interpretation** — in the "Process observation" section record facts (what they clicked, what they said, in what order). Hypotheses and conclusions go to a separate section at the end.
> - **Verbatim quotes** — record every stronger verbal moment as a quote with the interviewee's name.
> - **Note personal rules and workarounds** — the most valuable material from a visit (a sticky note next to the screen, their own clicking order, using another system "because it can't be done here").
> - **Note emotions and attitude** — tone of voice, frustrations, routine, confidence. This is the context a remote interview lacks.
> - **Convert relative dates to absolute ones** (e.g. "in January" → "January 2026").
> - YAML frontmatter following the folder's convention (`type: site-visit` / `field-visit`, location, segment, role, duration_min, tags, summary).
> - Name the file: `{YYYY-MM-DD}-{visit-type-kebab}-{site-id}.md` (e.g. `2026-04-07-site-visit-loc-0778.md`).

---

```yaml
---
type: site-visit
initiative: {initiative-name-kebab}
date: {YYYY-MM-DD}
{site-id}: {e.g. loc-0778}
{location}: {e.g. site_city: Springfield}
{segment / type}: {e.g. site_segment: SMALL URBAN}
role: {owner / manager / bo / other}
interviewee: {First Last}
researcher: {Researcher's first and last name}
duration_min: {NN}
tags: [{tag1}, {tag2}, {tag3}]
summary: "{2–4 sentences — who, the site context, the strongest insight, the main pain points}"
---
```

# Research visit — {Topic / Area}
## {Site id} | {YYYY-MM-DD}

**Researcher:** {First Last}
**Duration:** approx. {NN} min

---

## Site card

_{Optional — fill it in if the visit concerned a specific site / branch / office from a reference database. Paste the key fields from the database so the report stands on its own (the reader does not need to look up the context in another system).}_

### Identity and status

| Field | Value |
|------|---------|
| No. / ID | `{id}` |
| Status | `{OPEN / other}` |
| {Owner / interviewee} | `{First Last}` |
| Contact | `{phone / email}` |

### Location and profile

| Field | Value |
|------|---------|
| City | `{…}` |
| Address | `{…}` |
| Region | `{…}` |
| Floor area / size | `{…}` |
| Segment / site type | `{…}` |

### Support structure / indirect contacts

| Field | Value |
|------|---------|
| {Manager / account owner} | `{First Last}` |
| {Partner / supervisor} | `{First Last}` |
| {Director / region} | `{First Last}` |

---

## 1. Interviewee profile

| Question | Answer |
|---------|-----------|
| Time in the role / in the organisation | {…} |
| Number of sites / branches looked after | {…} |
| {Operational context — e.g. stockroom size, team structure} | {…} |
| {Work rhythm — e.g. ordering hours, delivery hours} | {…} |
| Where the observed process is carried out (remotely / office / on site / in the field) | {…} |
| How they prepare for the process (notebook / spreadsheet / mobile device / messenger / other systems) | {…} |

---

## 2. Context before opening {the tool / app}

> _What does the interviewee do before going into the tool? A notebook, a spreadsheet, photos, a chat with the team, a mobile device, other systems?_

{3–6 sentences describing the real setup. What they had open, what was prepared on paper, what they relied on before entering the tool. This shows **what the tool misses** — if the user does it elsewhere, they either do not trust the tool or do not know how to do it there.}

---

## 3. Observation of the {process name} process

### Order of actions

{Describe step by step what the researcher **saw** — not what the interviewee said they do. Concretely: which menu they clicked, in what order they scrolled, where they paused longer. A numbered list or a paragraph, whichever reads better.}

### {Main interaction — e.g. quantity changes / data entry}

| Type of {change / action} | {Category / area} | The interviewee's reason / comment |
|----------------------|----------------------|----------------------------|
| {e.g. zeroing} | {…} | "{verbatim quote}" |
| {e.g. decrease} | {…} | {…} |
| {e.g. increase} | {…} | {…} |

> _{A helper question, if it fits — e.g. "Are the changes bulk (a whole category) or individual (specific items)?"}_

### Drilling into details / other screens

{How many times during the process did the interviewee open the details? What did they look at? Was there a pattern (routine) or checking of problematic cases?}

### Searching / adding outside the default view

{Did they use search? How — by name, code, category? Which items did they add outside the system's recommendations?}

### Using other sources during the process

{Did they open other systems / documents / apps along the way? Which ones and why? This is a key signal: every step "outside the system" is a potential functional gap.}

### The interviewee's spoken comments

{Short quotes said spontaneously during the observation. No interpretation.}

- "{verbatim quote}"
- "{verbatim quote}"
- "{verbatim quote}"

### Emotions and attitude

{1–3 sentences — how they behaved. Calm and routine? Frustrated? Enthusiastic? Were there visible moments of hesitation, checking, stopping?}

### Personal rules and workarounds

_{A very valuable section — what the interviewee worked out on their own because the system does not support it. Every such rule = a signal of a missing feature or of a default flow that does not fit.}_

- {Rule / workaround 1 — e.g. "Always approves write-off records right before placing the order"}
- {Rule / workaround 2 — e.g. "Reads the form from the bottom up"}
- {Rule / workaround 3}

---

## 4. Follow-up questions after the observation

_{After the observation the researcher asks about specific topics — following the interview script. Each sub-topic as a sub-heading with a question → answer table or a short paragraph.}_

### {Sub-topic 1 — e.g. System recommendations and forecasting}

| Question | Answer |
|---------|-----------|
| {question} | {answer — short, with a quote if helpful} |
| {question} | {…} |
| {question} | {…} |

### {Sub-topic 2 — e.g. Form / attributes}

| Question | Answer |
|---------|-----------|
| {question} | {…} |
| {question} | {…} |

### {Sub-topic N — e.g. Other categories / threads not covered by the observation}

{…}

---

## 5. Hypothesis {a specific one — e.g. under-stocking / over-production / etc.}

_{Optional — fill it in if the visit script included checking a specific research hypothesis.}_

> _{A helper question — e.g. "Does X happen? What could help?"}_

{The interviewee's answer + the researcher's observations that confirm or refute the hypothesis.}

---

## 6. Closing question

> _Is there anything else we should pay attention to?_

{Anything the interviewee wanted to add outside the script. Sometimes the strongest insight shows up here.}

---

## 7. Key observations and conclusions

_{The most important insights from the visit — to be used in design. This is **the researcher's interpretation**, so conclusions are allowed here (separately from the raw observation above). Each point: a title + a paragraph with evidence (a quote / a specific observation).}_

1. **{Insight 1 — short title, e.g. "The owner trusts the system's recommendations as a starting point, but has a clear logic of their own for corrections"}**
   {3–5 sentences of explanation. What exactly was observed, which quote confirms it, what it means for design.}

2. **{Insight 2}**
   {…}

3. **{Insight 3}**
   {…}

4. **{Insight N}**
   {…}

---

## 8. Loose thoughts

_{Uncategorised observations, intuitions, the researcher's hypotheses. Material to verify in later visits or through analytics. Not formal conclusions — the researcher's raw stream of thought after the visit.}_

- {Thought 1}
- {Thought 2}
- {Thought 3}

---

## Attachments / sources

- {Recording / photos from the visit — if any}: [{file name}]({link})
- Transcript (if there was one): [{file name}]({link})
- Related visits / interviews:
  - [{another visit from the same initiative / segment}]({link})
  - [{a remote interview with the same persona}]({link})
- Related documents:
  - [{user story / brief / epic}]({link})
  - [{index of visits — the folder's README}]({link})

---

*Report generated by {skill / author} | {YYYY-MM-DD generated}*
