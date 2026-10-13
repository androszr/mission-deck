// tests/test_agent_banner_hook.mjs
// The PreToolUse hook that prints the agent spawn banner from the harness
// (scripts/hook-agent-banner.js), driven against a fixture tree in a temp dir
// plus one live check against the banners shipped in the repo.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'scripts', 'hook-agent-banner.js');
const { decide, bannerFor, transcriptFacts, bannerSkills } = require(HOOK);
const { render } = require(path.join(ROOT, 'scripts', 'agent-banner.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-banner-hook-'));
const AGENTS = path.join(TMP, '.claude', 'agents');
fs.mkdirSync(AGENTS, { recursive: true });

function agent(name, frontmatter) {
  fs.writeFileSync(path.join(AGENTS, name + '.md'), `---\nname: ${name}\n${frontmatter}\n---\n\nBody.\n`, 'utf8');
}
function skill(name, map, banners) {
  const dir = path.join(TMP, '.claude', 'skills', name, 'banners');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify(map), 'utf8');
  for (const [b, text] of Object.entries(banners)) fs.writeFileSync(path.join(dir, b + '.txt'), text, 'utf8');
}
function transcript(lines) {
  const file = path.join(TMP, `${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return file;
}
function input(overrides) {
  return JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'planner', prompt: 'plan it' }, ...overrides });
}
const OPTS = { root: TMP, render };

agent('planner', 'model: claude-opus-4-6');
agent('fixer', 'model: claude-sonnet-4-5');
agent('inheritor', 'model: inherit');
skill('new-idea', { planner: 'planner', fixer: 'fixer', pair: ['planner', 'fixer'], gapfix: { hint: 'pass --agent' } }, {
  planner: 'NEW-IDEA PLANNER | {{MODEL}}\n  art\n',
  fixer: 'NEW-IDEA FIXER | {{MODEL}}\n',
  pair: 'PAIR | {{MODEL_LEFT}} + {{MODEL_RIGHT}}\n',
  gapfix: 'NEW-IDEA GAPFIX | {{MODEL}}\n\n\n',
});
skill('prototype', { planner: 'planner', inheritor: 'inheritor' }, {
  planner: 'PROTOTYPE PLANNER | {{MODEL}}\n',
  inheritor: 'PROTOTYPE INHERITOR | {{MODEL}}\n',
});
skill('mini', { planner: 'mini-planner' }, { planner: 'MINI PLANNER | {{MODEL}}\n' });
skill('_shared', { planner: 'planner' }, { planner: 'SHARED PLANNER | {{MODEL}}\n' });
fs.mkdirSync(path.join(TMP, '.claude', 'skills', 'no-banners'), { recursive: true });

test('bannerSkills lists every skill dir with a banners/agents.json, alphabetical, _shared last', () => {
  assert.deepStrictEqual(bannerSkills(TMP), ['mini', 'new-idea', 'prototype', '_shared']);
  assert.deepStrictEqual(bannerSkills(path.join(TMP, 'nowhere')), []);
});

test('silent on anything that is not a main-thread Agent spawn with a subagent_type', () => {
  assert.strictEqual(decide('garbage', OPTS), null);
  assert.strictEqual(decide('null', OPTS), null);
  assert.strictEqual(decide(input({ tool_name: 'Bash' }), OPTS), null);
  assert.strictEqual(decide(input({ agent_id: 'agent-1' }), OPTS), null);
  assert.strictEqual(decide(JSON.stringify({ tool_name: 'Agent', tool_input: {} }), OPTS), null);
  assert.strictEqual(decide(JSON.stringify({ tool_name: 'Agent' }), OPTS), null);
});

test('an agent no banner maps prints nothing', () => {
  assert.strictEqual(decide(input({ tool_input: { subagent_type: 'general-purpose' } }), OPTS), null);
});

test('no transcript: first skill in bannerSkills order, model from the frontmatter, leading newline', () => {
  const out = decide(input({}), OPTS);
  assert.ok(out && typeof out.systemMessage === 'string');
  assert.ok(out.systemMessage.startsWith('\nNEW-IDEA PLANNER | claude-opus-4-6 (frontmatter)'), out.systemMessage);
  assert.ok(!out.systemMessage.endsWith('\n'), 'trailing newlines trimmed');
});

test('the transcript attributionSkill picks the skill for an agent two skills share', () => {
  const t = transcript([
    { type: 'assistant', attributionSkill: 'new-idea', message: { model: 'claude-opus-5' } },
    { type: 'user' },
    { type: 'assistant', attributionSkill: 'prototype', message: { model: 'claude-opus-5' } },
    { type: 'assistant', message: { model: 'claude-opus-5' } },
  ]);
  const out = decide(input({ transcript_path: t }), OPTS);
  assert.ok(out.systemMessage.startsWith('\nPROTOTYPE PLANNER |'), out.systemMessage);
});

test('a skill stamp with no banner for this agent falls through to the others', () => {
  const t = transcript([{ type: 'assistant', attributionSkill: 'prototype', message: { model: 'x' } }]);
  const out = decide(input({ transcript_path: t, tool_input: { subagent_type: 'fixer' } }), OPTS);
  assert.ok(out.systemMessage.startsWith('\nNEW-IDEA FIXER |'), out.systemMessage);
});

test('a foreign attributionSkill and a missing transcript are both "no stamp"', () => {
  const skills = bannerSkills(TMP);
  const t = transcript([{ type: 'assistant', attributionSkill: 'review-pr', message: { model: 'x' } }]);
  assert.deepStrictEqual(transcriptFacts(t, skills), { skill: null, sessionModel: 'x' });
  assert.deepStrictEqual(transcriptFacts(path.join(TMP, 'missing.jsonl'), skills), { skill: null, sessionModel: '' });
  assert.deepStrictEqual(transcriptFacts('', skills), { skill: null, sessionModel: '' });
});

test('gap_report / bug_report in the prompt selects gapfix, Agent({model}) wins over the frontmatter', () => {
  const gap = decide(input({ tool_input: { subagent_type: 'fixer', model: 'sonnet', prompt: 'do it\ngap_report:\n- AC1: missing' } }), OPTS);
  assert.ok(gap.systemMessage.startsWith('\nNEW-IDEA GAPFIX | sonnet (override)'), gap.systemMessage);
  const bug = decide(input({ tool_input: { subagent_type: 'fixer', prompt: 'bug_report:\nFUNC ...' } }), OPTS);
  assert.ok(bug.systemMessage.startsWith('\nNEW-IDEA GAPFIX | claude-sonnet-4-5 (frontmatter)'), bug.systemMessage);
  // Mid-line mention is not a retry block.
  const plain = decide(input({ tool_input: { subagent_type: 'fixer', prompt: 'the gap_report: field is described here' } }), OPTS);
  assert.ok(plain.systemMessage.startsWith('\nNEW-IDEA FIXER |'), plain.systemMessage);
});

test('a retry in a skill with no gapfix banner keeps the agent banner', () => {
  assert.strictEqual(bannerFor(TMP, 'prototype', 'inheritor', 'gap_report:\n- x'), 'inheritor');
  assert.strictEqual(bannerFor(TMP, 'nope', 'planner', ''), null);
});

test('parallel banners are never picked - each spawn gets its own single banner', () => {
  assert.strictEqual(bannerFor(TMP, 'new-idea', 'planner', ''), 'planner');
  assert.strictEqual(bannerFor(TMP, 'new-idea', 'fixer', ''), 'fixer');
});

test('model: inherit takes the session model read off the transcript', () => {
  const t = transcript([
    { type: 'assistant', attributionSkill: 'prototype', message: { model: 'claude-fable-5-1' } },
    { type: 'progress' },
  ]);
  const out = decide(input({ transcript_path: t, tool_input: { subagent_type: 'inheritor' } }), OPTS);
  assert.ok(out.systemMessage.startsWith('\nPROTOTYPE INHERITOR | claude-fable-5-1 (session)'), out.systemMessage);
  const none = decide(input({ tool_input: { subagent_type: 'inheritor' } }), OPTS);
  assert.ok(none.systemMessage.includes('session model unknown'), 'unresolved stays visible rather than silent');
});

test('CLI: garbage and a silent case exit 0 with empty stdout, a hit prints one JSON object', () => {
  const run = (stdin) => execFileSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: TMP } });
  assert.strictEqual(run('garbage'), '');
  assert.strictEqual(run(input({ tool_input: { subagent_type: 'general-purpose' } })), '');
  const out = JSON.parse(run(input({})));
  assert.deepStrictEqual(Object.keys(out), ['systemMessage']);
  assert.ok(out.systemMessage.startsWith('\nNEW-IDEA PLANNER |'));
});

test('live: every single-agent banner shipped in the repo is reachable from its agent name', () => {
  const skills = bannerSkills(ROOT);
  assert.ok(skills.includes('new-idea') && skills.includes('_shared') && skills.at(-1) === '_shared', skills.join(','));
  for (const s of skills) {
    const map = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'skills', s, 'banners', 'agents.json'), 'utf8'));
    for (const [name, a] of Object.entries(map)) {
      if (name.startsWith('_') || typeof a !== 'string') continue;
      const out = decide(input({ tool_input: { subagent_type: a } }), { root: ROOT, render });
      assert.ok(out, `${s}/${name} -> ${a} rendered nothing`);
      assert.ok(!out.systemMessage.includes('{{MODEL'), `${s}/${name} left a placeholder`);
    }
  }
});

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
