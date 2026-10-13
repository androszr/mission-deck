// Mission Deck - js/settings-skille-groups.mjs
// Pure display constants of the Settings > Skills tab (no document access, no imports), split out of
// js/settings-skille.js so a unit test can read them: that file imports ./doc-modal.js and
// cannot be loaded in Node. SKILL_OUTPUT and SKILL_KIND are the editorial layer on a card,
// GROUPS is the grouping; everything else on a card is derived server-side.

// ── Display copy ──────────────────────────────────────────────────────────────
// Two display-only maps: what a skill leaves behind (the reason to run it) and
// its kind (the chip). The description itself comes from the SKILL.md frontmatter,
// so it can never drift; these two are the editorial layer on top.
export const SKILL_OUTPUT = {
  'new-idea': 'plans/<date>-<slug>.md + .html + code on a branch',
  'prototype': 'a mockup in the data repo + screenshots in assets/',
  'mini': 'a plan in plans/ + code in the mini project repo',
  'pre-ship-audit': 'user-data/audits/pre-ship-audit-<date>.md',
  'qa-audit': 'user-data/audits/qa-audit-<date>.md',
  'review-pr': 'a report with a verdict in the terminal',
  'commit-message': 'a proposed commit message',
  'sync-after-merge': 'a clean local main',
  'jira': 'user-data/initiatives/tasks/*.md + a Jira issue',
  'confluence': 'user-data/confluence/*.md + a Confluence page',
  'summarize-meeting': 'user-data/meetings/<date>-<topic>.md',
  'kudos': 'user-data/kudos/<date>-<slug>.html',
  'refresh-repo-map': 'a refreshed repo map for the planner',
  'gitnexus': 'code graph knowledge loaded by other skills',
};

export const SKILL_KIND = {
  'new-idea': 'pipeline',
  'prototype': 'pipeline',
  'mini': 'pipeline',
  'pre-ship-audit': 'audit',
  'qa-audit': 'audit',
  'review-pr': 'audit',
  'jira': 'document',
  'confluence': 'document',
  'summarize-meeting': 'document',
  'kudos': 'document',
  'commit-message': 'tool',
  'sync-after-merge': 'tool',
  'refresh-repo-map': 'tool',
  'gitnexus': 'knowledge',
};

// ── Grouping ──────────────────────────────────────────────────────────────────
// A skill missing from every group still renders, under "Other".
export const GROUPS = [
  {
    label: 'Daily',
    hint: 'the path from idea to commit',
    skills: ['new-idea', 'pre-ship-audit', 'review-pr', 'commit-message', 'sync-after-merge'],
  },
  {
    label: 'Building',
    hint: 'outside the main Mission Deck repo',
    skills: ['prototype', 'mini'],
  },
  {
    label: 'Documents',
    hint: 'what stays after the work',
    skills: ['jira', 'confluence', 'summarize-meeting', 'kudos'],
  },
  {
    label: 'Audits and upkeep',
    hint: 'test quality and a current repo map',
    skills: ['qa-audit', 'refresh-repo-map'],
  },
  {
    label: 'GitNexus',
    hint: 'the code graph, loaded when needed',
    skills: ['gitnexus'],
  },
];
