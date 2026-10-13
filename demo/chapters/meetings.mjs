// demo/chapters/meetings.mjs
// Chapter `meetings`: "summarize the last meeting" in the Claude panel,
// then one road to a meeting summary that starts from a transcript FILE:
// the Teams transcript export (.docx) lies in user-data/transcripts/,
// scripts/extract-transcript.js (Node) lists and extracts it, a visible
// anonymization step replaces names before Claude reads a word, then
// Claude, asked in plain English, runs /summarize-meeting, which picks one of the eight templates/meeting-notes/ types
// and the summary lands in user-data/meetings/ and opens in the editor.
// No recording is sent anywhere. Nothing runs: every line is painted.

import { narrate, VAULT_OPEN, anonymize } from './_helpers.mjs';

const TRANSCRIPT = 'user-data/transcripts/2026-10-02-sprint-retro.docx';
const SUMMARY = 'user-data/meetings/2026-10-02-143000-sprint-retro.md';

const say = (text) => ({ type: 'terminal', on: 'cockpit', lines: [{ role: 'assistant', text }] });
const closePanel = { type: 'terminal', on: 'cockpit', close: true };
const TEMPLATES = [
  'meeting-notes-as-is-to-be', 'meeting-notes-contextual-inquiry', 'meeting-notes-decision', 'meeting-notes-discovery-interview',
  'meeting-notes-kickoff', 'meeting-notes-product-feedback-interview', 'meeting-notes-retrospective', 'meeting-notes-status-update',
];

const SUMMARY_MD = [
  '---',
  'title: "Retrospective: Sprint 41 of the Atlas team"',
  'type: meeting',
  'date: 2026-10-02',
  'author: Person A',
  'summary: "The work schedule went to the pilot; to improve: earlier tests with site managers."',
  '---',
  '',
  '# Retrospective: Sprint 41 — 2026-10-02',
  '',
  '**Source file:** 2026-10-02-sprint-retro.docx',
  '**Duration:** ~55 min',
  '**Retrospective format:** start-stop-continue',
  '**Period under review:** from 2026-09-08 to 2026-09-21 — sprint 41',
  '',
  '## Participants',
  '',
  '- **Delivery team:** Person A (PO), Person B (analyst), Person C (UX)',
  '- **Facilitator:** Person D',
  '',
  '## What went well',
  '',
  '- The weekly schedule view was ready two days before the end of the sprint.',
  '- Short daily mockup reviews with the analyst.',
  '',
  '## What did not work',
  '',
  '- Tests with site managers were planned too late — the feedback came back after the tasks were closed.',
  '',
  '## Action items',
  '',
  '| What | Who | Due |',
  '|----|-----|----------|',
  '| Tests with managers already in mid-sprint | Person C | 2026-10-14 |',
  '| A list of pilot questions in Confluence | Person B | 2026-10-09 |',
  '',
].join('\n');

export default {
  setup: [VAULT_OPEN],
  steps: [
    {
      id: 'spotkania-polecenie',
      caption: 'I ask Claude: **summarize the last meeting** — from a transcript file, not a recording.',
      mascot: 'working',
      actions: [
        narrate('From a transcript to a note', 'I write in the Claude terminal what I need. The basis is a ready meeting transcript from Teams — a file, not a recording. A script reads it, and Claude sees only the anonymized version.'),
        {
          type: 'ask',
          text: 'summarize the last meeting',
          then: [
            { type: 'camera', target: '#claude-terminal-panel', zoom: 1.3 },
            say('Drop the Teams transcript export (.docx or .vtt) into user-data/transcripts/ and ask me the same in VS Code — that is where I have access to files. A Node script reads the file, and I read only the anonymized version.'),
            { type: 'wait', ms: 600 },
          ],
        },
      ],
    },
    {
      id: 'spotkania-plik',
      caption: 'I drop the Teams **transcript export** into user-data/transcripts/.',
      mascot: 'working',
      actions: [
        narrate('The transcript file', 'After the meeting Teams offers the transcript for download. The file goes into the user-data/transcripts/ folder — local and outside git. Nothing is sent to any service.'),
        { type: 'camera', full: true },
        closePanel,
        { type: 'surface', show: 'vscode' },
        { type: 'camera', target: '.vsc-explorer', zoom: 1.6 },
        { type: 'explorer', add: [TRANSCRIPT] },
        { type: 'click', target: '[data-vsc-path="' + TRANSCRIPT + '"]' },
        { type: 'wait', ms: 600 },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'spotkania-cli',
      caption: 'I simply write: **summarize the sprint retro** — Claude picks the skill itself, and a script reads the file.',
      mascot: 'working',
      actions: [
        narrate('A request in a plain sentence', 'In Claude Code I write in plain words what I need — I do not have to know the name of a skill or a script. Claude recognises the task and reaches for the /summarize-meeting skill, which runs scripts/extract-transcript.js: it lists the files and pulls plain text out of the .docx. It is a plain Node script, not an AI model.', 'Summarize the last meeting — the sprint retro, the transcript is already in user-data'),
        { type: 'terminal', lines: [{ role: 'claude', text: '~/Projects/mission-deck' }] },
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.35 },
        {
          type: 'ask',
          on: 'vscode',
          text: 'Summarize the last meeting — the sprint retro, the transcript is already in user-data',
          then: [
            { type: 'terminal', lines: [
              { role: 'tool', verb: 'Read', text: '.claude/skills/summarize-meeting/SKILL.md', summary: 'the meeting notes skill' },
              { role: 'assistant', text: 'I will use the /summarize-meeting skill. First I check which transcripts are on disk.' },
              { role: 'tool', text: 'node scripts/extract-transcript.js --list', summary: '1 file', body: [TRANSCRIPT] },
              { role: 'assistant', text: 'There is one file in user-data/transcripts/ — 2026-10-02-sprint-retro.docx. I extract the text with the script.' },
              { role: 'tool', text: 'node scripts/extract-transcript.js ' + TRANSCRIPT + ' --out /tmp/transcript.txt', summary: '18,412 characters', body: ['Extracted ~18,400 characters.', 'The text goes to a temporary file - Claude has not read it yet.'] },
            ] },
          ],
        },
      ],
    },
    {
      id: 'spotkania-anonimizacja',
      caption: 'A script read the text — before Claude reads it, it goes through the **anonymization step**.',
      mascot: 'idle',
      actions: [
        narrate('Anonymization before AI', 'A Node script read the Teams file, not an AI model. Before Claude reads a single sentence, the anonymization step — a plain script on this computer — gives the participants pseudonyms “Person A…D” and removes emails, phone numbers and site numbers. The counter shows how many fields were replaced; the real names stay on this computer.'),
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.35 },
        { type: 'terminal', lines: [
          ...anonymize('the transcript goes through anonymization before Claude reads it.', '214 fields replaced - participants → Person A…Person D, emails, phone numbers and site numbers removed.'),
          { role: 'assistant', text: 'I read only the anonymized version: 4 participants (Person A–D), about 55 minutes of conversation.' },
        ] },
      ],
    },
    {
      id: 'spotkania-szablon',
      caption: 'Claude reviews the **eight templates** and picks the retrospective.',
      mascot: 'thinking',
      actions: [
        narrate('Picking a template', 'templates/meeting-notes/ holds eight meeting types. The first pass reads their “Purpose” and picks the best one, the second fills it with content.'),
        { type: 'terminal', lines: [
          { role: 'tool', text: 'node scripts/extract-transcript.js --templates', summary: '8 templates', body: TEMPLATES.map((t) => 'templates/meeting-notes/' + t + '.template.md') },
          { role: 'assistant', text: 'Types: as-is-to-be, contextual-inquiry, decision, discovery-interview, kickoff, product-feedback-interview, retrospective, status-update. The meeting looks back at the sprint — I pick retrospective.' },
          { role: 'tool', text: 'node scripts/extract-transcript.js --slug "sprint retro"', summary: 'sprint-retro' },
          { role: 'assistant', text: 'Saved ' + SUMMARY + '.' },
        ] },
      ],
    },
    {
      id: 'spotkania-notatka',
      caption: 'I open the **note**: frontmatter, participants, conclusions and actions.',
      mascot: 'celebrating',
      actions: [
        narrate('The finished note', 'The file has a YAML frontmatter with a title, date, author and a one-sentence summary, and below it the sections of the retrospective template. Every action has an owner and a due date — the note keeps the pseudonyms, because Claude never saw the real names.'),
        { type: 'camera', full: true },
        { type: 'explorer', add: [SUMMARY] },
        { type: 'editor', file: SUMMARY, text: SUMMARY_MD },
        { type: 'camera', target: '#demo-vsc-editor', zoom: 1.3 },
        { type: 'wait', ms: 1200 },
      ],
    },
    {
      id: 'spotkania-akceptacja',
      caption: 'I accept — the **summary** stays in user-data, outside git.',
      mascot: 'success',
      actions: [
        narrate('Acceptance', 'At the end Claude shows a five-sentence digest and asks whether to approve, revise with comments, or stop. I answer in a plain sentence — the file stays local, because the user-data/ folder never goes into the repository.', 'I accept, leave the note as it is'),
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.35 },
        { type: 'terminal', lines: [
          { role: 'out', text: 'Digest: sprint 41 delivered the weekly schedule view to the pilot.' },
          { role: 'out', text: 'Good: daily mockup reviews. To improve: late tests at the sites.' },
          { role: 'out', text: 'Actions: 2, each with an owner and a due date.' },
          { role: 'assistant', text: 'Do you approve? I can also revise the note with your comments or stop.' },
        ] },
        {
          type: 'ask',
          on: 'vscode',
          text: 'I accept, leave the note as it is',
          then: [
            { type: 'terminal', lines: [{ role: 'ok', text: '✓ ' + SUMMARY + ' — the file stays local (user-data/ is outside git).' }] },
          ],
        },
        { type: 'camera', full: true },
      ],
    },
  ],
};
