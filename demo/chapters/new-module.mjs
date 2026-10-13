// demo/chapters/new-module.mjs
// Chapter `new-module` ("Your own module via /new-idea"): the person describes
// a module in plain English to Claude in the VS Code terminal and never types
// a technical command - every script (new-module.js, plan-preflight.js,
// gates, plan-status.js) is only a tool line Claude runs. A relay strip over
// the editor shows the agents passing the baton (planner -> preflight ->
// backend -> frontend -> lead -> guardian -> blind verifier with one gap-fix
// -> bug scan -> handoff), each spawn banner printed in full. Then the
// app: "Demo reports" in the Knowledge hub,
// two corrections asked for in words (split view, the page repaints), and
// the team data repo hooked up through module.json dataRepos - the page gets
// the module sync bar. Mocks in demo/mocks/ch-new-module.mjs; nothing runs.

import { narrate, VAULT_OPEN } from './_helpers.mjs';
import {
  BANNERS, REQUEST, ASK_TEAM, ASK_OWNER, ASK_DATA, INTERVIEW, PLANNER_RUN, PREFLIGHT, BACKEND_RUN, BACKEND_WORK,
  BACKEND_DONE, FRONTEND_WORK, LEAD_RUN, DIGEST_RUN, GUARDIAN_RUN, VERIFY_RUN, GAPFIX_RUN, BUG_RUN, HANDOFF,
  FIX_TEAM_RUN, FIX_OWNER_RUN, DATA_RUN, NOWY_MODUL_FILES, NOWY_MODUL_FILES_CLIENT, NOWY_MODUL_PLAN_PATH, NOWY_MODUL_PLAN_TEXT,
  NOWY_MODUL_MANIFEST, SERVER_CODE, CLIENT_CODE, CLIENT_TEAM, CLIENT_OWNER,
} from '../mocks/ch-new-module.mjs';

const P = '#dm-nowy-modul-';
/** The plan rendered in the terminal group's Markdown preview tab (demo/surfaces/vscode.mjs). */
const MD_BODY = '#demo-vsc-md-term-body';
const VIEW = 'nowy-modul-demo-reports';
const CLIENT = 'modules/demo-reports/client/index.js';

const chip = (id, state, model) => ({ type: 'show', mock: 'nowy-modul-chip', target: `${P}chip-${id}`, mode: 'outer', props: { id, state, model } });
const baton = (from, to, text) => ({ type: 'show', mock: 'nowy-modul-baton', target: P + 'baton', mode: 'outer', props: { from, to, text } });
const term = (lines) => ({ type: 'terminal', lines });
const onTerm = { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.3 };
const onEditor = { type: 'camera', target: '#demo-vsc-editor', zoom: 1.25 };
const full = { type: 'camera', full: true };
const pause = (ms = 500) => ({ type: 'wait', ms });
const pageStage = (stage, changed) => ({ type: 'show', mock: 'nowy-modul-page', target: '#view-' + VIEW, props: { stage, changed } });
const installed = (props) => ({ type: 'show', mock: 'nowy-modul-installed', target: '#settings-moduly-installed', props });

const GAPFIX_CODE = `
// empty state when the selected week has no reports
if (!list.length) return emptyState('No reports this week.');
`;

/** Settings > Modules: the restart button, the way every module change is loaded. */
const restart = [
  { type: 'navigate', view: 'settings', tab: 'modules' },
  { type: 'camera', target: P + 'restart-callout', zoom: 1.25 },
  { type: 'click', target: P + 'restart-btn' },
  installed({ restart: true, restarting: true }),
  { type: 'wait', ms: 1400 },
  installed({}),
];

export default {
  pages: [
    { hub: 'knowledge', view: VIEW, label: 'Demo reports', mock: 'nowy-modul-page', props: { stage: 'v1' }, initial: false },
  ],
  setup: [
    { type: 'show', mock: 'ustawienia-version', target: '#settings-app-version' },
    { type: 'show', mock: 'ustawienia-sync', target: '#settings-sync-section' },
    { type: 'show', mock: 'ustawienia-theme', target: '#settings-theme-section' },
    installed({ restart: true }),
    { type: 'show', mock: 'katalog-catalog', target: '#settings-moduly-catalog' },
    VAULT_OPEN,
    { type: 'surface', show: 'vscode' },
    { type: 'show', mock: 'nowy-modul-relay', target: '#demo-vscode .vsc-main', mode: 'prepend' },
  ],
  steps: [
    {
      id: 'nowy-modul-prosba',
      caption: 'I describe the module to Claude **in plain words** — without a single technical command.',
      mascot: 'thinking',
      actions: [
        narrate('An idea instead of code', 'Claude runs in the VS Code terminal. I type /new-idea and say in one sentence what the team needs. Above the editor a relay of agents is waiting — each has its role and hands the work on to the next like a baton.', REQUEST),
        onTerm,
        term([{ role: 'claude', text: '~/mission-deck' }, { role: 'user', text: REQUEST }]),
        full,
        baton('You', 'Claude', 'weekly reports: list, week filter, preview'),
      ],
    },
    {
      id: 'nowy-modul-wywiad',
      caption: 'I answer the **interview**: the Knowledge hub, the Product area, sample data to start.',
      mascot: 'working',
      actions: [
        narrate('A few questions with suggestions', 'Claude asks one question at a time, five at most. I pick a ready answer or write my own. The hub is the place in the menu; the business area is a separate decision. I will hook up the team data repository later — also in words.'),
        onTerm,
        term(INTERVIEW),
        full,
        baton('You', 'Overwatch', 'module · hub Knowledge · area Product · sample data'),
      ],
    },
    {
      id: 'nowy-modul-plan',
      caption: 'I read the **plan** from Overwatch, a script checks it, and I answer with one word.',
      mascot: 'working',
      actions: [
        narrate('A plan before any code', 'The planner on Opus reads the repository and writes the plan. At the top is the “Business description” — for a person who will never look at the code. A script checks the plan without a model, and I read it and type “accept”.'),
        chip('planner', 'work'),
        full,
        term(BANNERS.planner),
        pause(800),
        term(PLANNER_RUN),
        { type: 'explorer', add: [NOWY_MODUL_PLAN_PATH] },
        // "Open Preview": the right group switches from the terminal to the
        // rendered plan for the read, then back to the terminal.
        { type: 'editor', group: 'term', file: NOWY_MODUL_PLAN_PATH, text: NOWY_MODUL_PLAN_TEXT },
        pause(1000),
        { type: 'camera', target: MD_BODY, zoom: 1.3 },
        pause(1600),
        { type: 'scroll', target: MD_BODY + ' table' },
        pause(1400),
        full,
        { type: 'editor', group: 'term', file: NOWY_MODUL_PLAN_PATH, close: true },
        chip('planner', 'done'),
        term(PREFLIGHT),
        baton('preflight', 'Vex', 'plan accepted · 6 AC criteria'),
      ],
    },
    {
      id: 'nowy-modul-budowa',
      caption: 'I watch the **relay** build the module: Vex the server, Mira the view — I type nothing.',
      mascot: 'working',
      actions: [
        narrate('Skeleton and code without me', 'The module has seven files, so two specialists split the work. Vex runs the skeleton generator herself — her tool line, not my command — and writes the server with sample data. Mira reads her contract and builds the page from Design System classes.'),
        chip('backend', 'work'),
        full,
        term(BACKEND_RUN),
        term(BANNERS.backend),
        pause(800),
        term(BACKEND_WORK),
        { type: 'explorer', add: NOWY_MODUL_FILES },
        { type: 'editor', file: 'modules/demo-reports/server/index.js', text: SERVER_CODE },
        term(BACKEND_DONE),
        chip('backend', 'done'),
        baton('Vex', 'Mira', 'Backend contract: GET /reports?week'),
        chip('frontend', 'work'),
        term(BANNERS.frontend),
        pause(800),
        term(FRONTEND_WORK),
        { type: 'explorer', add: NOWY_MODUL_FILES_CLIENT },
        { type: 'editor', file: CLIENT, text: CLIENT_CODE },
        chip('frontend', 'done'),
        baton('Mira', 'Nyx', 'Frontend contract: routes match · ds-card, ds-table'),
      ],
    },
    {
      id: 'nowy-modul-przeglad',
      caption: 'I wait for the lead and the guardian to **check** the change — scripts call the agents.',
      mascot: 'idle',
      actions: [
        narrate('Review and conventions', 'The lead compares both contracts. Then scripts summarise the change and check the conventions. One note needs a judgement, so the guardian Quiet steps in. The change is large, so the verifier and the scanner get a stronger model.'),
        chip('lead', 'work'),
        full,
        term(BANNERS.lead),
        pause(800),
        term(LEAD_RUN),
        chip('lead', 'done'),
        term(DIGEST_RUN),
        chip('verifier', 'wait', 'sonnet'),
        chip('bugauditor', 'wait', 'sonnet'),
        chip('guardian', 'work'),
        term(BANNERS.guardian),
        pause(800),
        term(GUARDIAN_RUN),
        chip('guardian', 'done'),
        baton('Quiet', 'Ledger', 'conventions: PASS · agent_model: sonnet'),
      ],
    },
    {
      id: 'nowy-modul-weryfikacja',
      caption: 'I see the **blind verification**: one criterion fails, so Mira fixes it.',
      mascot: 'thinking',
      actions: [
        narrate('Blind verification and a fix', 'The verifier does not see the conversation — it gets only the criteria and the code. AC5 fails: an empty week has no message. The gap report goes to Mira alone; under the “Relay” banner she fixes one file and every criterion passes.'),
        chip('verifier', 'work', 'sonnet'),
        full,
        term(BANNERS.verifier),
        pause(800),
        term(VERIFY_RUN),
        chip('verifier', 'fix', 'sonnet'),
        baton('Ledger', 'Mira', 'gap_report: AC5 · client/index.js'),
        chip('frontend', 'work'),
        term(BANNERS.gapfix),
        pause(800),
        { type: 'editor', file: CLIENT, text: GAPFIX_CODE },
        term(GAPFIX_RUN),
        chip('frontend', 'done'),
        chip('verifier', 'done', 'sonnet'),
        baton('Ledger', 'Hex', 'AC: 6 / 6 PASS'),
      ],
    },
    {
      id: 'nowy-modul-skan',
      caption: 'I get **SHIP** after the bug scan — the plan marks itself as done.',
      mascot: 'working',
      actions: [
        narrate('Bug scan and handoff', 'The scanner scores logic, missed steps and usability; two points is under the threshold, so SHIP. The last line closes the plan. Nobody committed anything — the module has its own local repository, and I commit the changes myself.'),
        chip('bugauditor', 'work', 'sonnet'),
        full,
        term(BANNERS.bugauditor),
        pause(800),
        term(BUG_RUN),
        chip('bugauditor', 'done', 'sonnet'),
        term(HANDOFF),
        baton('plan-status', 'You', NOWY_MODUL_PLAN_PATH + ' · status: done'),
        { type: 'camera', target: P + 'relay', zoom: 1.5 },
        pause(900),
        full,
      ],
    },
    {
      id: 'nowy-modul-strona',
      caption: 'I open the **Knowledge** hub — there is “Demo reports”!',
      mascot: 'wave',
      actions: [
        narrate('A new page in the Knowledge hub', 'The Knowledge hub has a new item “Demo reports”: a list of reports, a week filter and a preview, exactly as in the plan.'),
        { type: 'show', mock: 'empty', target: P + 'relay', mode: 'outer' },
        { type: 'surface', show: 'cockpit' },
        { type: 'flyout', view: VIEW },
        { type: 'navigate', view: VIEW },
        full,
        { type: 'hover', target: P + 'row-r1', ms: 700 },
        { type: 'camera', target: P + 'preview', zoom: 1.3 },
        pause(800),
        full,
      ],
    },
    {
      id: 'nowy-modul-poprawka-zespol',
      caption: 'I ask for a **change** in words: a team filter and the update date in the header.',
      mascot: 'working',
      actions: [
        narrate('Changes in a plain sentence', 'Mission Deck on the left, VS Code on the right. I write to Claude what I want changed — it reads the file, fixes it and runs the tests itself. I refresh the page and see the change at once.', ASK_TEAM),
        { type: 'surface', show: 'split' },
        term([{ role: 'user', text: ASK_TEAM }]),
        term(FIX_TEAM_RUN),
        { type: 'editor', file: CLIENT, text: CLIENT_TEAM },
        pageStage('v2', true),
        { type: 'camera', target: '#view-' + VIEW + ' .page-header', zoom: 1.4 },
        pause(900),
        { type: 'camera', target: P + 'team-filter', zoom: 1.5 },
        pause(700),
        full,
      ],
    },
    {
      id: 'nowy-modul-poprawka-wlasciciel',
      caption: 'I also ask for **Owner** instead of Author and the newest reports at the top.',
      mascot: 'working',
      actions: [
        narrate('Another small change', 'I look for neither a file nor a function. I say what should change on the screen, and Claude swaps the column and sorts newest first. The table repaints after a refresh.', ASK_OWNER),
        term([{ role: 'user', text: ASK_OWNER }]),
        term(FIX_OWNER_RUN),
        { type: 'editor', file: CLIENT, text: CLIENT_OWNER },
        pageStage('v3', true),
        { type: 'camera', target: P + 'table', zoom: 1.3 },
        pause(1000),
        full,
      ],
    },
    {
      id: 'nowy-modul-dane',
      caption: 'I hook up the **team data** in one sentence — the page gets a sync bar.',
      mascot: 'working',
      actions: [
        narrate('The team data repository', 'Claude adds a dataRepos declaration to module.json: the data-tier-0 repository and the demo-reports/ folder. After a restart the module reads the team’s real reports, and a sync bar appears above the list — it says whether what I see is up to date.', ASK_DATA),
        term([{ role: 'user', text: ASK_DATA }]),
        term(DATA_RUN),
        { type: 'editor', file: 'modules/demo-reports/module.json', text: NOWY_MODUL_MANIFEST, mode: 'replace' },
        onEditor,
        pause(1000),
        full,
        { type: 'surface', show: 'cockpit' },
        installed({ restart: true }),
        ...restart,
        { type: 'navigate', view: VIEW },
        pageStage('dane', false),
        { type: 'camera', target: P + 'msb', zoom: 1.5 },
        pause(900),
        full,
      ],
    },
    {
      id: 'nowy-modul-gotowe',
      caption: 'I have **my own module** with the team data — and not a single typed command!',
      mascot: 'success',
      actions: [
        narrate('From a sentence to a module', 'One sentence, a few answers, “accept” and two requests for changes — the relay of agents and the gate scripts did the rest. The people and reports in the demo are invented. In the next chapter I publish the module so the team can install it from the catalog.'),
        { type: 'hover', target: P + 'msb-open', ms: 900 },
        { type: 'camera', target: P + 'root', zoom: 1.15 },
        pause(900),
        full,
      ],
    },
  ],
};
