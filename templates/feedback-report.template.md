---
id: "{YYYY-MM-DD-HHMMSS-type-slug}"
type: bug
title: "{Short title of the report}"
status: new
reported_by:
  slug: "{person-slug}"
  name: "{First Last}"
  email: "{name@example.com}"
reported_at: "{2026-09-16T14:35:12.482Z}"
app_info:
  version: "{0.1.0}"
  commit: "{sha or null}"
  platform: "{darwin | win32 | linux}"
context:
  view: "{#view-settings}"
  url: "{http://localhost:3001/#view-settings}"
  viewport: "{1512x945}"
  screen: "{1512x982}"
  user_agent: "{Mozilla/5.0 ...}"
  language: "{en-US}"
attachments:
  - attachments/01-screenshot.png
console_errors: 0
---

# {Short title of the report}

## Description

{What is happening - describe the problem, idea or question in a few sentences.}

## Steps to reproduce

{Only for type "bug". Numbered steps that lead to the problem.}

## Expected behaviour

{Only for type "bug". How the app should have behaved.}

## Attachments

{This section appears only when the report carries screenshots. Relative
links to `attachments/<NN>-screenshot.<ext>`.}

![Screenshot 1](attachments/01-screenshot.png)

## Console errors

{This section appears only when the browser recorded something in the error
log before the report was sent. Entries in a text block, one line per entry.}

````text
2026-09-16T14:34:58.101Z error TypeError: Cannot read properties of null (reading 'dataset')
````
