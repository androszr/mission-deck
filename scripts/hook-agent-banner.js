#!/usr/bin/env node
'use strict';
// scripts/hook-agent-banner.js
//
// Claude Code PreToolUse hook on the Agent tool: prints the spawn banner the
// skills used to ask the model to paste, and prints it from the HARNESS so it
// can never be skipped. Wired in .claude/settings.json (matcher "Agent").
//
// Why a hook and not an instruction. /new-idea, /prototype and /mini told the
// orchestrating model to run scripts/agent-banner.js and paste its output as a
// fenced block in its text response right before Agent({...}). Measured over
// every transcript of this project: the paste was skipped in 83 of 176 spawns
// (88% on claude-fable-5-1), and what the terminal showed in its place was a
// narration-tagged thinking block ("... plan initialized. - summarized"),
// which Ctrl+O does not expand. Running the script handed the model a tool
// result to narrate instead of a thing to paste. A hook has no such choice:
// Claude Code runs it on every Agent tool call and shows its `systemMessage`
// to the person as a message row of its own.
//
// What it does. Reads the PreToolUse JSON on stdin, finds the banner whose
// agents.json maps `tool_input.subagent_type`, renders it through the same
// scripts/agent-banner.js the CLI uses (Agent({model}) override > agent
// `model:` frontmatter > session model read off the transcript) and answers
// `{ systemMessage }`. A retry prompt (`gap_report:` / `bug_report:` block)
// gets the `gapfix` banner of that skill, exactly as the skills specified.
//
// Which skill. Every `.claude/skills/<skill>/banners/agents.json` is a
// candidate (`bannerSkills`, read from disk so a new skill needs no edit
// here), and several agents appear in more than one (idea-planner in new-idea
// and prototype, cockpit-guardian in new-idea and pre-ship-audit, ...), so the
// skill is read off the transcript: Claude Code stamps `attributionSkill` on
// every assistant line written while a skill is active, and the last one
// wins. No stamp -> alphabetical, `_shared` (the manual shelf) last.
//
// An Agent call no banner maps (general-purpose, Explore, a hook agent) prints
// nothing. Never exits non-zero - a crashing hook blocks the spawn.

const fs = require('fs');
const path = require('path');

const RETRY_RE = /^(gap_report|bug_report):/m;
const TAIL_BYTES = 2 * 1024 * 1024;

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..');
}

// The last TAIL_BYTES of a file, split into whole lines (the first partial
// line dropped). A transcript can be tens of MB; the answer is always at the end.
function tailLines(file) {
  let fd = null;
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift();
    return lines;
  } catch (_) {
    return [];
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  }
}

// Every skill directory that ships banners, alphabetical with `_shared` last.
function bannerSkills(root) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, '.claude', 'skills')); } catch (_) { return []; }
  return names
    .filter((n) => fs.existsSync(path.join(root, '.claude', 'skills', n, 'banners', 'agents.json')))
    .sort((a, b) => (a.startsWith('_') - b.startsWith('_')) || a.localeCompare(b));
}

// Walks the transcript backwards through the assistant lines and answers the
// first `attributionSkill` among `skills` and the first `message.model` it meets.
function transcriptFacts(transcriptPath, skills) {
  const facts = { skill: null, sessionModel: '' };
  if (!transcriptPath) return facts;
  const lines = tailLines(transcriptPath);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (facts.skill && facts.sessionModel) break;
    let j;
    try { j = JSON.parse(lines[i]); } catch (_) { continue; }
    if (!j || j.type !== 'assistant') continue;
    if (!facts.skill && skills.includes(j.attributionSkill)) facts.skill = j.attributionSkill;
    if (!facts.sessionModel && j.message && typeof j.message.model === 'string') facts.sessionModel = j.message.model;
  }
  return facts;
}

function loadAgentMap(root, skill) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.claude', 'skills', skill, 'banners', 'agents.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

// The single-agent banner of `skill` that maps `agent`, or `gapfix` for a
// retry when the skill ships one. Parallel banners ([left, right]) are never
// picked: two Agent calls in one message fire this hook twice, one banner each.
function bannerFor(root, skill, agent, prompt) {
  const map = loadAgentMap(root, skill);
  if (!map) return null;
  const single = Object.entries(map).find(([k, a]) => !k.startsWith('_') && a === agent);
  if (!single) return null;
  if (RETRY_RE.test(prompt || '') && map.gapfix !== undefined
      && fs.existsSync(path.join(root, '.claude', 'skills', skill, 'banners', 'gapfix.txt'))) {
    return 'gapfix';
  }
  return single[0];
}

// The hook decision: `{ systemMessage }` to print, or null to stay silent.
// `render` is injected so the unit test can drive it against a fixture tree.
function decide(raw, opts = {}) {
  let input;
  try { input = JSON.parse(raw); } catch (_) { return null; }
  if (!input || input.tool_name !== 'Agent' || input.agent_id) return null;
  const t = input.tool_input || {};
  const agent = typeof t.subagent_type === 'string' ? t.subagent_type : '';
  if (!agent) return null;

  const root = opts.root || projectRoot();
  const skills = bannerSkills(root);
  const facts = transcriptFacts(input.transcript_path, skills);
  const order = facts.skill ? [facts.skill, ...skills.filter((s) => s !== facts.skill)] : skills;
  for (const skill of order) {
    const name = bannerFor(root, skill, agent, t.prompt);
    if (!name) continue;
    // The renderer is this file's sibling, never a copy under `root`: the
    // root only says where the banners and the agent briefs live.
    const render = opts.render || require('./agent-banner.js').render;
    let result;
    try {
      result = render({
        spec: `${skill}/${name}`,
        agents: [agent],
        models: [typeof t.model === 'string' ? t.model : ''],
        sessionModel: facts.sessionModel,
        root,
      });
    } catch (_) {
      return null;
    }
    // The row reads "<hook> says: <content>"; the newline keeps the art aligned.
    return { systemMessage: '\n' + result.banner.replace(/\n+$/, '') };
  }
  return null;
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try {
      const out = decide(raw);
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (_) {
      // Silent by design - see the header.
    }
    // No process.exit(): a pipe write is asynchronous and exit() would drop it.
    process.exitCode = 0;
  });
}

module.exports = { decide, bannerFor, transcriptFacts, bannerSkills };
