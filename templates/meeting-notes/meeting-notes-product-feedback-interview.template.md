---
title: "Evaluation interview: {Name / Role}"
type: meeting
date: {YYYY-MM-DD}
author: {First Last}
summary: "{1 sentence — what the meeting was about and its main takeaway}"
---

# Template: Evaluation interview about an existing product (Meeting Notes)

> **Purpose of this template (read carefully before you pick it):**
> - A conversation with a user of an **existing product / app that is in use** — we ask "how do you use X, what works, what hurts, what would you improve".
> - Output: **a map of real usage** + a list of praise + a list of pains + improvement suggestions (grouped by theme and by priority).
> - Goal: input to the product roadmap, prioritising pains, spotting under-used modules.
>
> **When NOT to use:**
> - if it was a **discovery interview about a problem** (there is no product yet, we are exploring the need) → use `meeting-notes-discovery-interview.template.md`
> - if it was **observation at the workplace** (contextual inquiry / shadowing) → use `meeting-notes-contextual-inquiry.template.md`
> - if it was an AS IS → TO BE process-mapping workshop with several participants → use `meeting-notes-as-is-to-be.template.md`
> - if the goal was to settle a decision → use `meeting-notes-decision.template.md`
> - if it was a status / sync → use `meeting-notes-status-update.template.md`
>
> **How to use:**
> - **The structure follows the product, not the timeline** — the top features used, what works, what does not, suggestions grouped by theme (per module). The interviewee naturally thinks "in the context of feature X", not "in the order I said things".
> - **Always keep verbatim quotes** at the stronger moments (praise, pains, suggestions). No paraphrasing inside a quote.
> - **Group the suggestions per module / product area** — it makes turning them into a backlog easier later. Within a module, order by priority.
> - **Explicit priorities** — 🔴 critical, 🟠 medium, 🟢 nice-to-have. Without them the whole document reads as "all P1".
> - Keep **praise** ("what works well") apart from suggestions — it matters to the product team, so they do not break what already works.
> - **Convert relative dates to absolute ones** (e.g. "in January" → "January 2026").
> - YAML frontmatter following the folder's convention (`type: interview`, app, platform, role, tags, summary).
> - Name the file: `{YYYY-MM-DD}-{role}-{first-last-kebab}-interview.md`.

---

```yaml
---
type: interview
initiative: {initiative-name-kebab}
date: {YYYY-MM-DD}
role: {owner / manager / bo / po / expert / other}
interviewee: {First Last}
app: {product-name-kebab}
platform: {ios / android / web / desktop / mobile+desktop / n/a}
source: {transcript / notes / recording}
tags: [{module1}, {module2}, {topic1}, {ux}]
summary: "{2–4 sentences — who, the usage context, the strongest points (what works), the biggest pains, the main suggestions}"
---
```

# Interview — {Role} {First Last} ({YYYY-MM-DD})

## Interviewee context

_{3–6 sentences. What is their context for using the product? For how long? Which device / platform dominates? What is specific about their work / site / organisation that shapes how they use the product? This is the foundation — without it the suggestions hang in a vacuum.}_

- {Context point 1 — e.g. "Owns one location and also manages a second one"}
- {Context point 2 — e.g. "Mostly uses the app on a phone — rarely on a tablet"}
- {Context point 3 — e.g. traffic patterns, working hours, team structure, tools outside the product}

---

## TOP — what they use most often

_{The most important section. What does the interviewee **actually** tap every day / several times a day? Give the 3–5 main ones + a list of other frequent ones. A key quote next to the strongest feature, if there was one.}_

### Top 3 every day

1. **{Feature 1}** — {usage context, frequency, why this one is #1}. "{quote if helpful}"
2. **{Feature 2}** — {context, frequency}
3. **{Feature 3}** — {context}

### Also used very often (daily / several times a day)

- **{Feature 4}** — {context}
- **{Feature 5}** — {context}
- **{Feature N}** — {context}

---

## What they use rarely / not at all

_{The second most important section — features that exist but the interviewee does not use. Always ask **why**. No adoption = either poor exposure, a feature with no value, or a poor implementation.}_

- **{Feature A}** — {why they do not use it, a quote if there was one: "{quote}"}
- **{Feature B}** — {why}
- **{Feature C}** — {why}
- **{Feature N}** — {why}

---

## What works well (praise)

_{Collect praise deliberately — it is easy to focus only on pains and miss what already works. This is key information for the team ("don't touch this, it works"). Each item: short + a quote.}_

- **{Element / feature 1}** — "{verbatim quote of praise}"
- **{Element / feature 2}** — "{quote}" / {description of a successful change, who is behind it}
- **{Element / feature 3}** — {what exactly is good}
- **Overall:** "{quote of an overall positive assessment, if there was one}"

---

## Improvement suggestions (grouped by theme)

_{The largest section — suggestions grouped **per module / product area**, because that is how the interviewee thinks about them. Within a module, most important first. Each item: a short description + the reason + an estimate of the impact (if it came up in the conversation).}_

### {Module 1 — e.g. Dashboard / home page}

- **{Suggestion 1}** — {description, what exactly is missing, what effect it would have. A quote if helpful.}
- **{Suggestion 2}** — {description}
- **{Suggestion 3}** — {description}

### {Module 2 — e.g. Orders}

- **{Suggestion 1}** — {description}
- **{Suggestion 2}** — {description}

### {Module 3 — e.g. Notifications}

- **{Suggestion 1}** — {description}
- **{Suggestion 2}** — {description}

### {Module N}

- **{Suggestion}** — {description}

### Other / general gaps

_{Cross-cutting suggestions that do not fit a single module. E.g. navigation, overall design, general notification hygiene, missing system features.}_

- **{Suggestion 1}** — {description}
- **{Suggestion 2}** — {description}

---

## Priorities (the interviewee's or the researcher's view)

_{A helpful summary section — which suggestion would "change my life today" and which is "nice, but I'll survive". It is not always obvious from the previous section; here it is said plainly.}_

### 🔴 Critical / high

1. **{Suggestion}** — {1 sentence of rationale, why it is critical}
2. **{Suggestion}** — {…}
3. **{Suggestion}** — {…}

### 🟠 Medium

4. **{Suggestion}** — {…}
5. **{Suggestion}** — {…}

### 🟢 Nice-to-have

6. **{Suggestion}** — {…}
7. **{Suggestion}** — {…}

---

## Quotes worth remembering

_{A best-of — the 4–8 strongest quotes that capture the tone of the conversation. They help you come back to the document later and recall the context without reading all of it. Each quote gets a short label (what it is about).}_

- On the whole: *"{quote of the overall assessment}"*
- On {module / feature A}: *"{quote}"*
- On {module / feature B}: *"{quote}"*
- On {pain}: *"{quote}"*
- On {suggestion}: *"{quote}"*

---

## Usage pattern (compressed into one paragraph)

_{Optional — a very valuable one-paragraph summary (4–6 sentences). How does this kind of user think about the product? What is the core for them and what is the periphery? This section is the one most often quoted in briefs and initiative summaries.}_

{4–6 sentences of compression. Write it so that someone who did not read the rest of the document understands the interviewee's perspective and has a direction worth developing the product in for this segment of users.}

---

## Attachments / sources

- Audio transcript: [{file name}]({link})
- Key moments in the recording (if listened to):
  - {MM:SS} — {topic / key quote}
  - {MM:SS} — {"aha" moment}
  - {MM:SS} — {praise / pain #N}
- Related interviews / documents:
  - [{another interview with the same persona / initiative}]({link})
  - [{user story / brief / epic}]({link})
  - [{index of interviews — the folder's README}]({link})
