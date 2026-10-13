// demo/chapter-cards.mjs
// Title-card data of every chapter (title, subtitle, signature Pip pose).
// Its own module so a chapter file (e.g. summary) can read it without
// importing demo/scenario.mjs, which imports the chapter files.

/**
 * Title card of every chapter: title, one-sentence subtitle and Pip's
 * signature pose (the casting in the plan). `pose` is the pose of a chapter
 * that is still a one-step placeholder.
 */
export const CHAPTERS = {
  guides: { title: 'Before you start', subtitle: 'Instructions from docs: step-by-step installation, a first-day checklist and five pitfalls.', mascot: 'thinking', pose: 'thinking' },
  start: { title: 'Startup', subtitle: 'From the starter package in the team library to Mission Deck running in the browser.', mascot: 'wave' },
  onboarding: { title: 'First steps', subtitle: 'The “Start here” wizard walks you through the vault, the keys and the team data.', mascot: 'wave' },
  settings: { title: 'Setup', subtitle: 'Settings: version, tools, keys and modules in one place.', mascot: 'working', pose: 'error' },
  'team-keys': { title: 'Keys for the team', subtitle: 'A new person gets their own token and encryption key — no passwords sent by email.', mascot: 'idle', pose: 'working' },
  academy: { title: 'Academy', subtitle: 'Academy: stages, steps and the participants’ mural.', mascot: 'working', pose: 'working' },
  'new-module': { title: 'Your own module via /new-idea', subtitle: 'I describe a module in plain words, and a relay of agents builds it.', mascot: 'working', pose: 'thinking' },
  publishing: { title: 'Publishing a module', subtitle: 'A module reaches the team through a merge request, never directly.', mascot: 'working', pose: 'idle' },
  catalog: { title: 'Installing from the catalog', subtitle: 'Other people’s modules install with one click.', mascot: 'working', pose: 'thinking' },
  'using-a-module': { title: 'Everyday work with a module', subtitle: 'The module page, its data and the sync bar.', mascot: 'idle', pose: 'thinking' },
  design: { title: 'Design: tokens, icons and Pip', subtitle: 'Where prototypes and modules get their look.', mascot: 'working', pose: 'thinking' },
  sync: { title: 'Encryption and data exchange', subtitle: 'Every file leaves encrypted, and teammates download it and decrypt it on their side.', mascot: 'working', pose: 'working' },
  meetings: { title: 'Meeting summary', subtitle: 'From a recording to a note on a template with one command.', mascot: 'thinking', pose: 'working' },
  'time-tracking': { title: 'Time logging', subtitle: 'Who logged time in the last two weeks.', mascot: 'working', pose: 'working' },
  'on-call-and-time-off': { title: 'On-call and time off', subtitle: 'Who is on call today, who is on leave — scripts fetch the data, not AI.', mascot: 'wave', pose: 'working' },
  roadmap: { title: 'Roadmap review', subtitle: 'A table, a timeline and a kanban of initiatives for the quarter.', mascot: 'thinking', pose: 'working' },
  team: { title: 'Team and users', subtitle: 'Team line-ups and the people directory with their photos.', mascot: 'celebrating', pose: 'thinking' },
  sprints: { title: 'Sprints', subtitle: 'Team commitments and delivery, sprint by sprint.', mascot: 'working', pose: 'thinking' },
  'jira-confluence': { title: 'Jira and Confluence day to day', subtitle: 'Issues and pages pulled by a script into user-data, work in VS Code and writing back.', mascot: 'working', pose: 'working' },
  'skills-and-agents': { title: 'Skills and agents', subtitle: 'Ready-made procedures for Claude: Jira, Confluence, Azure DevOps, reports — and agent models.', mascot: 'working', pose: 'working' },
  updates: { title: 'Updates and upkeep', subtitle: 'A new version, set-aside changes and the network status strip.', mascot: 'working', pose: 'wave' },
  feedback: { title: 'Send feedback', subtitle: 'A bug, an idea or a question straight from the top bar — with a screenshot.', mascot: 'error', pose: 'error' },
  'day-cycle': { title: 'End of day and good morning', subtitle: 'In the evening I send and clean up, in the morning everything comes back with one click.', mascot: 'sleeping', pose: 'working' },
  summary: { title: 'Summary', subtitle: 'Everything we showed, on one board.', mascot: 'celebrating', pose: 'celebrating' },
};
