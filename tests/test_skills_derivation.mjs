// tests/test_skills_derivation.mjs
// The parsers behind Settings > Skills. Everything the tab shows is derived from
// the skill files, so these are the functions that decide whether a card tells
// the truth: the folded frontmatter, the phase ids, the agent list, the commands.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = require(path.join(ROOT, 'server.js'));

test('a folded frontmatter description is joined into one line', () => {
  const fm = srv._parseSkillFrontmatter([
    '---',
    'name: demo',
    'description: Plans a change in the repo.',
    '  Use when the user says "add X".',
    '  Never commits.',
    '---',
    '',
    '# Demo',
  ].join('\n'));
  assert.strictEqual(fm.name, 'demo');
  assert.strictEqual(fm.description, 'Plans a change in the repo. Use when the user says "add X". Never commits.');
});

test('a block scalar marker is not mistaken for the description', () => {
  const fm = srv._parseSkillFrontmatter('---\nname: x\ndescription: >-\n  Pierwsza linia.\n  Druga.\n---\n');
  assert.strictEqual(fm.description, 'Pierwsza linia. Druga.');
});

test('a file without frontmatter yields empty fields, never a throw', () => {
  const fm = srv._parseSkillFrontmatter('# Just a heading\n');
  assert.strictEqual(fm.name, null);
  assert.strictEqual(fm.description, null);
});

test('phase ids come from headings and from a flow-map table', () => {
  const skill = [
    '| Phase | What | Runs when |',
    '|---|---|---|',
    '| 0 | bootstrap | always |',
    '| 6a | backend | split path |',
    '',
    '### Phase 4: planner',
    '### Phase 6.7: bug scan',
  ].join('\n');
  const phases = srv._skillPhases([skill]);
  assert.deepStrictEqual(phases, ['0', '4', '6a', '6.7']);
});

test('phase ids are unique across the documents of one skill', () => {
  const a = '## Phase 4 - planner\n## Phase 5 - review\n';
  const b = '### Phase 4: planner detail\n### Phase 7: handoff\n';
  assert.deepStrictEqual(srv._skillPhases([a, b]), ['4', '5', '7']);
});

test('a table that is not a flow map does not become phases', () => {
  const text = '| Agent | Phase | Banner |\n|---|---|---|\n| Overwatch | 4 | planner |\n';
  assert.deepStrictEqual(srv._skillPhases([text]), []);
});

test('commands are the scripts a skill actually names', () => {
  const text = 'Run `node scripts/gates.js --lint` then `node scripts/plan-status.js <plan>`; scripts/gates.js again.';
  assert.deepStrictEqual(srv._skillCommands(text), ['gates.js', 'plan-status.js']);
});

test('a script inside an installed module keeps its full path, core scripts stay bare names', () => {
  const text = 'python3 modules/reports-hub/scripts/feedback_report.py hub; node scripts/gates.js; '
    + 'py -3 modules/experiments/scripts/experiment_report.py; ./scripts/gates.js';
  assert.deepStrictEqual(srv._skillCommands(text), [
    'gates.js',
    'modules/experiments/scripts/experiment_report.py',
    'modules/reports-hub/scripts/feedback_report.py',
  ]);
  // a module script name must not also surface as a bare core script
  assert.deepStrictEqual(srv._skillCommands('modules/x/scripts/build.js'), ['modules/x/scripts/build.js']);
});

test('the shipped skills all parse into a card the UI can render', () => {
  const skills = srv._listSkills();
  assert.ok(skills.length >= 10, 'the starter ships a method, not one skill');
  for (const s of skills) {
    assert.strictEqual(typeof s.name, 'string');
    assert.ok(Array.isArray(s.phases) && Array.isArray(s.agents) && Array.isArray(s.commands));
    if (s.group) {
      assert.ok(s.children.length > 0, 'a group card without children would be empty');
      continue;
    }
    assert.ok(s.description.length > 0, s.name + ' has no frontmatter description');
    assert.ok(s.docs.some(d => d.file === 'SKILL.md'), s.name + ' must offer its own SKILL.md');
  }
  const names = skills.map(s => s.name);
  assert.ok(names.includes('new-idea') && names.includes('gitnexus'));
  const gitnexus = skills.find(s => s.name === 'gitnexus');
  assert.ok(gitnexus.children.length >= 6, 'the sub-skills ride with the parent card');
  assert.ok(gitnexus.docs.some(d => d.file === 'SKILL.md'), 'the index skill has its own document');
});
