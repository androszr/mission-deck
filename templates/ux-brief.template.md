---
# File name convention (same as for interviews):
#   {YYYY-MM-DD}-ux-brief-{initiative-slug}.md
#
# - The date in the name = `updated:` from the frontmatter (the last substantive update)
# - On every significant update: change `updated:` and rename the file so the dates match
# - The creation date lives in `date:` and in the Metadata table
title: "UX Brief: {Initiative name}"
type: ux-brief
initiative: {initiative-slug}
area: {area-a | area-b}
status: draft
date: {YYYY-MM-DD}
updated: {YYYY-MM-DD}
author: {first and last name of the PO/PD}
epic: {link to the Jira epic or an empty string}
ticket: {link to the story / task or an empty string}
tags: [{tag1}, {tag2}]
summary: "{1 sentence — what the initiative is about and for whom}"
---


# UX Brief: {Initiative name}

## Metadata

| Field | Value |
|------|---------|
| Project | {project name} |
| Product / module | {product name} |
| Epic (Jira) | {link to the epic — the "Epic Link" field in Jira} |
| Ticket (Jira) | {link to the story / task} |
| Status | `draft` |
| Author (PO/PD) | {first and last name} |
| Created | {YYYY-MM-DD} |
| Last updated | {YYYY-MM-DD} |
| Wiki | _(add the page link once published)_ |
| Whiteboard | _(link to the whiteboard / frame, if any)_ |

## Introduction

> {2–3 sentences: what the initiative is about, the key problem, for whom. An orientation for someone who lands on this brief for the first time — without reading all of it.}

---

> **How to use this document:**
> - 🟢 **Gate 1 (PO + BO)** - the PO fills it in before the kickoff meeting; discussed at Gate 1
> - 🔵 **Problem Space (BA, PD)** - the BA and PD deepen and complete the Gate 1 sections and add new ones
> - 🟣 **Solution Space (BA, PD, SA)** - the differentiators are verified and finalised based on the solutions worked out
> - Sections 1–6 live for the whole of discovery - **Gate 1 is a starting point, not the final word**

---

# 🟢 GATE 1 - Discovery start (PO + BO)

_The PO fills this in from what was agreed with the BO **before the kickoff meeting**. Discussed at Gate 1 with the BA, PD and SA. These sections are deepened and completed in the Problem Space by the BA and PD._

## 1. Users

**Who are we doing this for?**
_(Who uses this screen/flow/product? Link to the persona)_

> {description of the users}

### User Story

> As **{who}** I want **{what}** so that **{why / value}**.

---

## 2. Goal and context

**What is the goal of the task/project?**
_(PM/PO/Business: where the change comes from, what we want to achieve)_

> {goal}

**Are there factors outside the product that affect this project?**

> {dependencies, external context, links}

**How does the task/project relate to the product strategy?**
_(Wider context, business strategy)_

> {relation to the product strategy}

**How does the task/project relate to the organisation's strategy?**
_(Which value stream it supports and how)_

> {relation to the organisation's strategy}

**What do we lose if we do not make the change?**
_(e.g. users will not complete their tasks, we will repeat competitors' mistakes, we will not meet user expectations)_

> {consequences of doing nothing}

**How will the project/task improve the user experience or save the user time?**

> {expected UX improvement}

**Have you tried to make such changes before?**

> {history of attempts, lessons learned}

---

## 3. User problem and needs - initial

_The PO describes the problem at a general level, from the BO's perspective and from reports. The BA adds the details in the Problem Space._

**What is the user's main problem?**
_(Have users reported anything before? Support data, insights)_

> {problem description - initial, from the PO/BO perspective}

**How does the user deal with this problem today?**
_(Do they have workarounds, their own ways of making the work easier?)_

> {description of the workaround}

---

## 4. Stakeholders (RACI)

**Who is responsible for the initiative?**
_(Who should take part in the kickoff and the consultations? Who makes product, design and legal decisions?)_

| Person | Role in the project | RACI |
|-------|-----------------|------|
| {name} | {role} | Accountable |
| {name} | {role} | Responsible |
| {name} | {role} | Consulted |
| {name} | {role} | Informed |

---

## 5. Differentiators - initial

_Differentiators are the parts of the new system that make the work of customers and their staff easier and save time. We measure efficiency in minutes saved per month per location. The PO fills this in at Gate 1, the BA and PD deepen it in the Problem Space, and it is finalised in the Solution Space._

**Estimated savings per item:**

| Differentiator (improvement) | Saving min/month/location | Source of the analytics | Estimate stage |
|---------------------------------|-----------------------------|----------------------------|-------------|
| {item name} | {X min} | {e.g. analytics, research, observation} | 🟢 Gate 1 |
| {item name} | {X min} | {source} | 🟢 Gate 1 |

**Total saving for the initiative:** {sum min/month/location}

> ⚠️ The table is updated iteratively:
> - 🟢 Gate 1 - the PO gives initial estimates based on what was agreed with the BO
> - 🔵 Problem Space - the BA/PD verify and refine them based on the as-is analysis and research
> - 🟣 Solution Space - finalised once the solutions are worked out, verified with the BO

---

## 6. Plan of action - initial

_The PO, BA, PD and SA agree an initial schedule at the kickoff meeting._

**Is there an agreed plan / stages of work?**

> {plan / schedule - initial}

**How much time do I have?**

> {deadline, time frame}

**What are the constraints/risks for the plan?**
_(e.g. no time for usability tests, business or technology constraints)_

> {list of constraints}

---
---

# 🔵 PROBLEM SPACE - deepen and complete (BA, PD)

_After Gate 1 the analytical work starts. The BA and PD **go back to sections 1–6 above** and deepen them with findings from the as-is analysis and research (e.g. refine the user story, complete the context, verify the goal, refine the differentiators). Below - additional sections that only appear at this stage._

## 7. User problem and needs - in depth

_The BA fills this in from the as-is analysis. The PD adds to it after the research. It deepens the initial problem description from section 3._

**At which stage of the user journey does the problem occur?**

> {stage / touchpoint}

**What does the current system/view look like?**

> {description of the current state, links to screenshots}

**What are the user's needs?**

> {list of needs - based on analysis and/or research}

**Do users suggest improvements? Which ones?**

> {list of suggested improvements - based on analysis and/or research}

### Current view

_(Screenshots / links to the current state of the UI)_

| Screen | Link / description |
|--------|-------------|
| {name} | {link} |

### Needs (notes)

- {need 1}
- {need 2}
- {need 3}

---

## 8. Data and metrics

_The BA fills this in with data from the as-is analysis. The PD adds research results._

**Is the problem backed by data?**
_(Analytics, quantitative data, business events, support/sales reports, comments, desk research and competitors, user recordings, research reports)_

> {available data and sources}

**If we have no data, what are the options for quantitative/qualitative analysis?**

> {proposals for getting the data}

**What data do we still need? Who will provide it and how long will it take?**

| Data to obtain | Provided by | Due |
|--------------------|---------------|--------|
| {data} | {person/team} | {when} |

**How will we check that our solution works?** _(KPIs + metrics)_

| KPI / metric | Current value | Target |
|---------------|----------------|-----|
| {metric} | {baseline} | {target} |

---

## 9. Plan of action - updated

_Updated once the scope is agreed and the research is finished. Replaces the initial Gate 1 plan._

**At which point will we test?**

> {planned validation point}

---
---

# 🟣 SOLUTION SPACE - verify and finalise (BA, PD, SA)

_In the Solution Space, once the requirements and mockups are worked out, we go back to the differentiators (section 5) and finalise them._

## 10. Differentiators - final

_After the PO and BO accept the requirements and mockups - the final table of differentiators with verified data._

| Differentiator (improvement) | Saving min/month/location | Data source | Verification status |
|---------------------------------|-----------------------------|---------------|--------------------|
| {item name} | {X min} | {source} | ✅ Verified / ⏳ To verify |

**Total saving for the initiative:** {sum min/month/location}

**Changes vs Gate 1 / Problem Space:**

> {what changed in the estimates and why}
