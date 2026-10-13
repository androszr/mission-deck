---
title: "{{title}}"
type: data-analysis
initiative: ""
area: ""
research_method: ""
audience: ""
status: ""
date: {{date}}
updated: {{updated}}
author: "{{author}}"
collaborators: []
participants: ""
participants_count: null
epic: ""
ticket: ""
source: {{source}}
confluence_page_id: "{{confluence_page_id}}"
confluence_version: {{confluence_version}}
tags: [{{tags_csv}}]
summary: ""
sql_source: ""
---

# {{title}}

## 1. Meta

| Field | Value |
|------|---------|
| Project / initiative | _(TODO)_ |
| Area / sub-area | _(TODO)_ |
| Author of the analysis | {{author}} |
| Prepared on | {{updated}} |
| Data source | _(TODO - dashboard / repo / ticket)_ |
| Scope | _(TODO - 1-2 sentences about the scope of the analysis)_ |

---

## 2. Context / analytical question

_(TODO - which business question / hypothesis does this analysis settle? Why was it done?)_

---

## 3. Data and method

**Data sources:** _(TODO - which tables / systems / exports the data comes from)_

**Method:** _(TODO - aggregation / period comparison / cohort / significance test / mix)_

**Time range and sample:** _(TODO)_

---

## 4. SQL query (reproducing the analysis)

_(TODO - the query that reproduces the results of this analysis. Paste it below or point to a file in sql_source.)_

```sql
-- TODO: query that reproduces the analysis
SELECT 1;
```

_(TODO - link to the source of the query: dashboard / repo / ticket.)_

> Reusable queries live in a shared SQL library in the team data repo (for example `data-sub-repositories/ds-data/sql/`). The `sql_source` field in the frontmatter can point to one of them.

---

## 5. Key findings

_(TODO - list 3-6 main findings. Each one as a ### Subheading + a descriptive paragraph.)_

---

## 6. Recommendations

_(TODO - 3-5 points. Each one: what to do, for whom, by when.)_

---

## 7. Status

- _(TODO - status entries as the document is curated)_
