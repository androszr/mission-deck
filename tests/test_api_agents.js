'use strict';
// tests/test_api_agents.js
// The agent roster endpoints behind Settings > Agents: the list the grid is
// built from and the brief the modal renders. GET /api/agents/read takes the
// agent name from the query string, so the interesting case is a name that is
// not on the list - it must never reach the filesystem.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson } = require('./_api_helper');

const PORT = 3507;
let child;

test.before(async () => {
  child = startServer(PORT);
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

test('GET /api/agents/list returns the roster with a model per agent', async () => {
  const { status, body } = await getJson(PORT, '/api/agents/list');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.agents));
  assert.ok(body.agents.length > 0, 'expected at least one agent in .claude/agents/');
  for (const a of body.agents) {
    assert.strictEqual(typeof a.name, 'string');
    assert.strictEqual(typeof a.description, 'string');
  }
  const names = body.agents.map(a => a.name);
  assert.ok(names.includes('idea-planner'), 'idea-planner is part of the shipped roster');
});

test('GET /api/agents/read returns the brief of a known agent', async () => {
  const { status, body } = await getJson(PORT, '/api/agents/read?name=idea-planner');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.name, 'idea-planner');
  assert.strictEqual(body.path, '.claude/agents/idea-planner.md');
  assert.ok(body.content.startsWith('---'), 'the brief keeps its frontmatter');
  assert.ok(body.content.length > 200);
});

test('GET /api/agents/read rejects an unknown name instead of reading a path', async () => {
  for (const name of ['nope', '../../../etc/passwd', '', 'README']) {
    const { status, body } = await getJson(PORT, '/api/agents/read?name=' + encodeURIComponent(name));
    assert.strictEqual(status, 404, 'unknown agent name: ' + name);
    assert.ok(body.error, 'a 404 carries an error message');
    assert.ok(!body.content, 'no content leaks for an unknown name');
  }
});

test('GET /api/skills/list derives the roster from the skill files', async () => {
  const { status, body } = await getJson(PORT, '/api/skills/list');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.skills) && body.skills.length > 0);

  const newIdea = body.skills.find(s => s.name === 'new-idea');
  assert.ok(newIdea, '/new-idea is part of the shipped method');
  assert.ok(newIdea.description.length > 40, 'the folded frontmatter description is joined');
  assert.ok(newIdea.phases.includes('6f'), 'phase ids come from the headings and the flow map');
  assert.ok(newIdea.agents.includes('idea-planner'));
  assert.ok(newIdea.commands.includes('plan-preflight.js'));
  assert.ok(newIdea.docs.some(d => d.file === 'SKILL.md'));
  assert.ok(newIdea.docs.some(d => d.file === 'PHASES.md'), 'sibling documents feed the modal switcher');

  const gitnexus = body.skills.find(s => s.name === 'gitnexus');
  assert.ok(gitnexus, 'the graph knowledge is one card');
  assert.ok(gitnexus.children.length > 1, 'its sub-skills ride along instead of getting their own cards');
  assert.ok(gitnexus.description.length > 40, 'a skill without a description would render an empty card');

});

test('GET /api/skills/read serves one document of a skill or of a sub-skill', async () => {
  const doc = await getJson(PORT, '/api/skills/read?skill=new-idea&file=PHASES.md');
  assert.strictEqual(doc.status, 200);
  assert.strictEqual(doc.body.path, '.claude/skills/new-idea/PHASES.md');
  assert.ok(doc.body.content.includes('Phase'));

  const sub = await getJson(PORT, '/api/skills/read?skill=gitnexus-cli&file=SKILL.md');
  assert.strictEqual(sub.status, 200);
  assert.strictEqual(sub.body.path, '.claude/skills/gitnexus/gitnexus-cli/SKILL.md');
});

test('GET /api/skills/read matches names against the lists, never a path', async () => {
  const cases = [
    'skill=../../../etc&file=passwd',
    'skill=new-idea&file=../../../CLAUDE.md',
    'skill=new-idea&file=templates/../../../server.js',
    'command=gates.js',
    'skill=nope',
  ];
  for (const q of cases) {
    const { status, body } = await getJson(PORT, '/api/skills/read?' + q);
    assert.strictEqual(status, 404, q);
    assert.ok(body.error, q);
    assert.ok(!body.content, 'nothing leaks for ' + q);
  }
});
