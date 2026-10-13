// tests/test_academy.mjs
// Unit invariants for js/academy-stages.mjs — the single source of
// truth for the "Academy" training path, read by both the client view
// and server.js (lazy import). No document, no server: this file carries neither.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGES_URL = pathToFileURL(path.join(ROOT, 'js', 'academy-stages.mjs')).href;

const { STAGES, TC_TABS, GATED_STAGES } = await import(STAGES_URL);

const MURAL_URL = pathToFileURL(path.join(ROOT, 'js', 'academy-mural.mjs')).href;
const { muralAnswers, muralSections, muralShorten, MURAL_TILE_ANSWERS, MURAL_ANSWER_MAX_CHARS } =
  await import(MURAL_URL);

const ASCII_RE = /^[\x00-\x7F]*$/;
const CHECK_TYPES = new Set(['server', 'self-attest']);

test('STAGES is a non-empty array with unique ASCII ids', () => {
  assert.ok(Array.isArray(STAGES) && STAGES.length > 0);
  const ids = STAGES.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'stage ids must be unique');
  for (const id of ids) {
    assert.ok(ASCII_RE.test(id), `stage id "${id}" must be ASCII`);
  }
});

test('every step has a unique ASCII id within its stage', () => {
  for (const stage of STAGES) {
    const steps = stage.steps || [];
    const ids = steps.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, `duplicate step id in ${stage.id}`);
    for (const id of ids) {
      assert.ok(ASCII_RE.test(id), `step id "${id}" in ${stage.id} must be ASCII`);
    }
  }
});

test('every step has check.type from the allowed set and check.step === id', () => {
  for (const stage of STAGES) {
    for (const step of stage.steps || []) {
      assert.ok(step.check, `${stage.id}/${step.id} is missing check`);
      assert.ok(
        CHECK_TYPES.has(step.check.type),
        `${stage.id}/${step.id} has invalid check.type "${step.check.type}"`,
      );
      assert.strictEqual(
        step.check.step,
        step.id,
        `${stage.id}/${step.id} check.step must equal the step id`,
      );
      assert.ok(ASCII_RE.test(step.check.step), `${stage.id}/${step.id} check.step must be ASCII`);
    }
  }
});

test('every self-attest step has a btnLabel', () => {
  for (const stage of STAGES) {
    for (const step of stage.steps || []) {
      if (step.check.type === 'self-attest') {
        assert.ok(
          typeof step.btnLabel === 'string' && step.btnLabel.length > 0,
          `${stage.id}/${step.id} is self-attest but has no btnLabel`,
        );
      }
    }
  }
});

test('etap-3 has server checks on exactly step-2, step-3, step-7', () => {
  const etap3 = STAGES.find((s) => s.id === 'etap-3');
  assert.ok(etap3, 'etap-3 must exist');
  const serverSteps = etap3.steps.filter((s) => s.check.type === 'server').map((s) => s.id).sort();
  // step-5 (the contract test) was removed - /new-idea writes tests itself. The
  // remaining step ids are deliberately NOT renumbered: progress is keyed on
  // the step id in each person's file.
  assert.deepStrictEqual(serverSteps, ['step-2', 'step-3', 'step-7']);
});

test('etap-1 has server checks on exactly step-1, step-2, step-5, step-6', () => {
  const etap1 = STAGES.find((s) => s.id === 'etap-1');
  assert.ok(etap1, 'etap-1 must exist');
  const serverSteps = etap1.steps.filter((s) => s.check.type === 'server').map((s) => s.id).sort();
  assert.deepStrictEqual(serverSteps, ['step-1', 'step-2', 'step-5', 'step-6']);
});

// step-2b USED to be a server check running `claude auth status`. That command
// answers "are there credentials on this machine", not "is this CLI logged
// in", so it passed the step for a person the CLI still asked to log in. There
// is no cheap call that answers the second question, so the step asks the
// person - and its instruction has to name the command that actually logs you
// in, which the old failure message never did.
test('etap-1/step-2b (Claude Code login) is self-attest and names the login command', () => {
  const etap1 = STAGES.find((s) => s.id === 'etap-1');
  const step = etap1.steps.find((s) => s.id === 'step-2b');
  assert.ok(step, 'etap-1/step-2b must exist');
  assert.strictEqual(step.check.type, 'self-attest', 'a server probe cannot tell a logged-in CLI from stored credentials');
  assert.match(step.instruction, /claude auth login|\/login/, 'the step must name how to log in');
});

test('etap-1/step-3 opens the human-facing repo guide in VS Code, not CLAUDE.md, and carries a preview tip', () => {
  // On day one a person reads ONE guide written for humans, not the
  // agent-facing files - CLAUDE.md and README.md come back deliberately in
  // etap-3/step-3b, once there is a working module to change. The guide must
  // exist on disk, since the server resolves the key from a closed map to a
  // real path.
  const etap1 = STAGES.find((s) => s.id === 'etap-1');
  const step3 = etap1.steps.find((s) => s.id === 'step-3');
  assert.ok(step3, 'etap-1/step-3 must exist');
  assert.deepStrictEqual(step3.openVscode.map((o) => o.key), ['przewodnik-po-repo']);
  for (const o of step3.openVscode) assert.ok(ASCII_RE.test(o.key), `openVscode key "${o.key}" must be ASCII`);
  assert.ok(!/CLAUDE\.md/.test(step3.title), 'the title must not send a person to CLAUDE.md');
  assert.match(step3.tip || '', /Cmd\+Shift\+V/, 'the tip names the Markdown preview shortcut');
  assert.match(step3.tip || '', /Ctrl\+Shift\+V/, 'the tip names the Windows/Linux shortcut too');
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'guides', 'repo-guide.md')), 'the guide the step opens must exist');
});

// The "przed wiekszym developmentem przeczytaj calosc" step. Both keys must
// exist in server.js's COCREATE_OPEN_FILE_MAP and both files must exist on
// disk, because open-file resolves a KEY from a closed map to a real path and
// 404s otherwise.
test('etap-3/step-3b opens the whole CLAUDE.md and README.md before bigger module work', () => {
  const etap3 = STAGES.find((s) => s.id === 'etap-3');
  const step = etap3.steps.find((s) => s.id === 'step-3b');
  assert.ok(step, 'etap-3/step-3b must exist');
  assert.strictEqual(step.check.type, 'self-attest');
  const keys = step.openVscode.map((o) => o.key);
  assert.deepStrictEqual(keys, ['claude-md', 'readme']);
  for (const k of keys) assert.ok(ASCII_RE.test(k), `openVscode key "${k}" must be ASCII`);
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const k of keys) {
    assert.ok(serverSrc.includes(`'${k}':`), `COCREATE_OPEN_FILE_MAP is missing the key "${k}"`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'README.md')));
  // The step sits BEFORE step-4 ("Grow your module") - that is the whole
  // point of the note it came from: read the rules before the bigger work.
  const ids = etap3.steps.map((s) => s.id);
  assert.ok(ids.indexOf('step-3b') < ids.indexOf('step-4'), 'step-3b must come before step-4');
});

// `defaultLocation` applies to the commands that CREATE a terminal, and
// Cmd+` is not one of them: toggleTerminal shows/hides the bottom panel and
// ignores the setting outright, while terminal.new (Cmd+Shift+`) respects it.
// Two people walking the course read "the setting did not work" from that, so
// the step has to name both commands - the age of the terminal is NOT the
// cause, and saying it was sent the reader looking in the wrong place.
test('etap-1/step-1 explains that the toggle shortcut ignores the setting', () => {
  const etap1 = STAGES.find((s) => s.id === 'etap-1');
  const step = etap1.steps.find((s) => s.id === 'step-1');
  assert.match(step.tip || '', /toggleTerminal/, 'the tip must name the command that ignores defaultLocation');
  assert.match(step.tip || '', /terminal\.new/, 'the tip must name the command that respects it');
  assert.match(step.tip || '', /Cmd\+Shift\+`/, 'the tip must name the shortcut that opens a new terminal');
  // "Cmd+," reads as "press +", so the settings shortcut spells the key out.
  assert.ok(!/Cmd\+,/.test(step.instruction), 'the settings shortcut must not be written as "Cmd+,"');
  assert.match(step.instruction, /Cmd \+ comma/, 'the settings shortcut spells the key out');
});

test('etap-2 and etap-4 are entirely self-attest', () => {
  for (const id of ['etap-2', 'etap-4']) {
    const stage = STAGES.find((s) => s.id === id);
    assert.ok(stage, `${id} must exist`);
    for (const step of stage.steps) {
      assert.strictEqual(step.check.type, 'self-attest', `${id}/${step.id} must be self-attest`);
    }
  }
});

test('TC_TABS is a non-empty array where every tab owns an existing stage, the mural or the gallery', () => {
  assert.ok(Array.isArray(TC_TABS) && TC_TABS.length > 0);
  const stageIds = new Set(STAGES.map((s) => s.id));
  for (const tab of TC_TABS) {
    assert.ok(ASCII_RE.test(tab.id), `tab id "${tab.id}" must be ASCII`);
    if (tab.gallery || tab.mural) continue;
    assert.ok(Array.isArray(tab.stageIds) && tab.stageIds.length > 0, `tab ${tab.id} has no stageIds`);
    for (const sid of tab.stageIds) {
      assert.ok(stageIds.has(sid), `tab ${tab.id} references unknown stage "${sid}"`);
    }
  }
});

test('exactly one tab is the gallery tab', () => {
  const galleryTabs = TC_TABS.filter((t) => t.gallery);
  assert.strictEqual(galleryTabs.length, 1);
});

// The mural is the only tab that WRITES team data from outside the step flow,
// so it must be exactly one tab and it must never claim a stage as well.
test('exactly one tab is the mural tab and it owns no stage', () => {
  const muralTabs = TC_TABS.filter((t) => t.mural);
  assert.strictEqual(muralTabs.length, 1);
  assert.ok(!muralTabs[0].stageIds, 'the mural tab must not own a stage');
  assert.ok(!muralTabs[0].gallery, 'the mural tab is not the gallery tab');
});

test('GATED_STAGES is a prefix of the STAGES id list', () => {
  assert.ok(Array.isArray(GATED_STAGES) && GATED_STAGES.length > 0);
  const stageIds = STAGES.map((s) => s.id);
  const prefix = stageIds.slice(0, GATED_STAGES.length);
  assert.deepStrictEqual(GATED_STAGES, prefix, 'GATED_STAGES must be a prefix of STAGES ids, in order');
});

test('four stages, six tabs (module contract shape used by AC2)', () => {
  assert.strictEqual(STAGES.length, 4);
  assert.strictEqual(new Set(STAGES.map((s) => s.id)).size, 4);
  assert.strictEqual(TC_TABS.length, 6);
});


// ── Mural: the question is the label, the answer is the content ────────────
// The tile used to flatten the whole entry into one 150-character excerpt, so
// the template's three QUESTIONS ate the budget and no answer ever showed.
// js/academy-mural.mjs is the parser that split the two apart.

const MURAL_FILLED = [
  '## What I have learned',
  '',
  '- How to work fast',
  '',
  '## What I want to build in Mission Deck',
  '',
  '- A module for reviewing initiatives',
  '',
  '## Questions and observations',
  '',
  '- None',
].join('\n');

test('muralAnswers keeps the heading as a label and the lines under it as the answer', () => {
  const answers = muralAnswers(MURAL_FILLED);
  assert.strictEqual(answers.length, MURAL_TILE_ANSWERS, 'capped at the tile budget');
  assert.strictEqual(answers[0].label, 'What I have learned');
  assert.strictEqual(answers[0].text, 'How to work fast');
  assert.strictEqual(answers[1].label, 'What I want to build in Mission Deck');
  assert.strictEqual(answers[1].text, 'A module for reviewing initiatives');
});

test('muralAnswers skips a section whose only content is the untouched template bullet', () => {
  const template = ['## First question', '', '- ', '', '## Second question', '', '- Answer'].join('\n');
  const answers = muralAnswers(template);
  assert.strictEqual(answers.length, 1, 'a blank form field is not an answer');
  assert.strictEqual(answers[0].label, 'Second question');
  assert.strictEqual(answers[0].text, 'Answer');
});

test('an entry that is only the empty template yields no answers at all', () => {
  const empty = ['## A', '', '- ', '', '## B', '', '-', '', '## C', ''].join('\n');
  assert.deepStrictEqual(muralAnswers(empty), []);
});

test('"None" is an answer the person wrote, so it is never dropped', () => {
  const answers = muralAnswers(['## Questions and observations', '', '- None'].join('\n'));
  assert.deepStrictEqual(answers, [{ label: 'Questions and observations', text: 'None' }]);
});

test('several bullets in one section join into one answer, markers stripped per line', () => {
  const entry = ['## What next', '', '- First', '- Second', '', '3. Third'].join('\n');
  const answers = muralAnswers(entry);
  assert.strictEqual(answers[0].text, 'First · Second · Third');
});

test('inline emphasis, code and links become plain text, never mashed characters', () => {
  const entry = ['## Heading', '', '- **Module** with `server.js` and [docs](https://x/y)'].join('\n');
  assert.strictEqual(muralAnswers(entry)[0].text, 'Module with server.js and docs');
});

test('an entry with no headings is one unlabeled answer', () => {
  const answers = muralAnswers('Hi, I am new here.\nBuilding a module.');
  assert.strictEqual(answers.length, 1);
  assert.strictEqual(answers[0].label, '');
  assert.strictEqual(answers[0].text, 'Hi, I am new here. · Building a module.');
});

test('muralSections drops a server-written YAML header instead of reading it as an answer', () => {
  const raw = ['---', 'author: Alex Morgan', 'person_slug: alex-morgan', '---', '', '## Question', '', '- Yes'].join('\n');
  const sections = muralSections(raw);
  assert.strictEqual(sections.length, 1, 'the header is not a section');
  assert.strictEqual(sections[0].label, 'Question');
  assert.deepStrictEqual(muralAnswers(raw), [{ label: 'Question', text: 'Yes' }]);
});

test('each answer is shortened on its own budget, so the last block is never cut short', () => {
  const long = 'a'.repeat(400);
  const entry = ['## Jedno', '', '- ' + long, '', '## Drugie', '', '- ' + long].join('\n');
  const answers = muralAnswers(entry);
  assert.strictEqual(answers.length, 2);
  for (const a of answers) {
    assert.ok(a.text.length <= MURAL_ANSWER_MAX_CHARS + 1, 'budget plus the ellipsis');
    assert.ok(a.text.endsWith('\u2026'), 'a cut answer ends with an ellipsis');
  }
});

test('muralShorten cuts on a word boundary when one is close enough and adds nothing otherwise', () => {
  assert.strictEqual(muralShorten('krotki tekst', 40), 'krotki tekst');
  assert.strictEqual(muralShorten('alfa beta gamma delta', 14), 'alfa beta\u2026');
  // No word boundary close enough - a mid-word cut beats a stub.
  assert.strictEqual(muralShorten('alfabetagammadelta', 10), 'alfabetaga\u2026');
});

test('empty, null and whitespace content yield no answers instead of throwing', () => {
  for (const value of ['', '   \n\n', null, undefined]) {
    assert.deepStrictEqual(muralAnswers(value), []);
  }
});

// ── Rail entry ───────────────────────────────────────────────────────────────
// The training is reachable from the dashboard card, but it is also PINNED to
// the rail right under "Start here": in the first days it is the view a new
// person opens most, and the card cost a detour through the dashboard every
// time. Like the wizard it is a CORE VIEW, not a hub, so the row is STATIC
// markup - a HUB_FLYOUT key would make js/app.js redirect #academy to
// the dashboard and the item would land on the wrong view.

test('index.html pins "Academy" between the wizard and Settings', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const spacer = html.indexOf('sidebar-spacer');
  const start = html.indexOf('data-view="onboarding-wizard"');
  const training = html.indexOf('data-view="academy"');
  const settings = html.indexOf('data-view="settings"');
  assert.ok(training > -1, 'rail item for the training is missing');
  assert.ok(spacer < start && start < training && training < settings,
    'the training row must sit between the wizard and Settings');
  assert.match(html.slice(training, settings), /Academy/);
  assert.match(html.slice(training, settings), /href="#academy"/);
});

test('the training is not a hub - no HUB_FLYOUT key, or app.js would redirect it', () => {
  const flyout = fs.readFileSync(path.join(ROOT, 'js', 'sidebar-flyout-config.js'), 'utf8');
  const hubs = fs.readFileSync(path.join(ROOT, 'js', 'core-hubs.mjs'), 'utf8');
  assert.ok(!flyout.includes('academy'));
  assert.ok(!hubs.includes('academy'));
});

// etap-3/step-7: a publish creates the branch module/<id>-<stamp> and opens
// a merge request with remove_source_branch, so the branch is the evidence
// only UNTIL a human merges the MR - after that GitLab deletes it and the
// evidence is the catalog entry on main. The first check looked at the
// branch alone and failed for good for exactly the people whose module had
// been merged (a module in the catalog read "branch not found").
const { cocreatePublishedState } = createRequire(import.meta.url)('../server.js');

test('cocreatePublishedState passes on a catalog entry even when the branch is gone', () => {
  const r = cocreatePublishedState({ moduleIds: ['experiments'], branches: [], catalogIds: ['demo-hub', 'experiments'] });
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.state, 'merged');
  assert.strictEqual(r.moduleId, 'experiments');
  assert.match(r.detail, /catalog/);
});

test('cocreatePublishedState passes on an unmerged publish branch', () => {
  const r = cocreatePublishedState({
    moduleIds: ['my-module'], branches: ['module/my-module-20260912-100000'], catalogIds: ['demo-hub'],
  });
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.state, 'branch');
});

test('cocreatePublishedState matches the branch by the module/<id>- prefix, never a substring', () => {
  const r = cocreatePublishedState({ moduleIds: ['site'], branches: ['module/sites-20260912-100000'], catalogIds: [] });
  assert.strictEqual(r.pass, false);
});

test('cocreatePublishedState looks at every own module, not only the first', () => {
  const r = cocreatePublishedState({ moduleIds: ['aaa', 'zzz'], branches: [], catalogIds: ['zzz'] });
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.moduleId, 'zzz');
});

test('cocreatePublishedState fails with a hint when nothing was published', () => {
  const withCatalog = cocreatePublishedState({ moduleIds: ['x'], branches: [], catalogIds: [] });
  assert.strictEqual(withCatalog.pass, false);
  assert.match(withCatalog.detail, /Publish/);
  const noCatalog = cocreatePublishedState({ moduleIds: ['x'], branches: [], catalogIds: null });
  assert.strictEqual(noCatalog.pass, false);
  assert.match(noCatalog.detail, /the catalog could not be read/);
});
