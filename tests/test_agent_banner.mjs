// tests/test_agent_banner.mjs
// Model resolution of scripts/agent-banner.js against a fixture tree in a temp
// dir (never the live .claude/), plus one live check that every banner shipped
// in the repo resolves with the agents.json next to it.

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
const SCRIPT = path.join(ROOT, 'scripts', 'agent-banner.js');
const { render, readFrontmatterModel, SOURCE, UsageError } = require(SCRIPT);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-banner-'));
const AGENTS = path.join(TMP, '.claude', 'agents');
const BANNERS = path.join(TMP, '.claude', 'skills', 'demo', 'banners');
fs.mkdirSync(AGENTS, { recursive: true });
fs.mkdirSync(BANNERS, { recursive: true });

function agent(name, frontmatter) {
  fs.writeFileSync(path.join(AGENTS, name + '.md'), `---\nname: ${name}\n${frontmatter}\n---\n\nBody.\n`, 'utf8');
}
function banner(name, text) {
  fs.writeFileSync(path.join(BANNERS, name + '.txt'), text, 'utf8');
}

agent('planner', 'model: claude-opus-4-6\ntools: Read');
agent('verifier', 'model: claude-haiku-4-5');
agent('inheritor', 'model: inherit');
agent('bare', 'tools: Read');
banner('planner', 'PLANNER | {{MODEL}}\n  art\n  {{MODEL}}\n');
banner('pair', 'PAIR | {{MODEL_LEFT}} + {{MODEL_RIGHT}}\n  {{MODEL_LEFT}}    {{MODEL_RIGHT}}\n');
banner('intro', 'INTRO | no agent here\n');
banner('orphan', 'ORPHAN | {{MODEL}}\n');
fs.writeFileSync(path.join(BANNERS, 'agents.json'), JSON.stringify({
  planner: 'planner',
  pair: ['planner', 'verifier'],
  orphan: { hint: 'pass the implementer you spawn' },
}), 'utf8');

test('readFrontmatterModel reads model:, treats inherit and missing as null', () => {
  assert.strictEqual(readFrontmatterModel(TMP, 'planner'), 'claude-opus-4-6');
  assert.strictEqual(readFrontmatterModel(TMP, 'inheritor'), null);
  assert.strictEqual(readFrontmatterModel(TMP, 'bare'), null);
  assert.throws(() => readFrontmatterModel(TMP, 'missing'), UsageError);
  assert.throws(() => readFrontmatterModel(TMP, '../etc'), UsageError);
});

test('frontmatter fills {{MODEL}} everywhere; agent comes from agents.json', () => {
  const r = render({ spec: 'demo/planner', root: TMP });
  assert.strictEqual(r.unresolved, false);
  assert.deepStrictEqual(r.agents, [{ name: 'planner', model: 'claude-opus-4-6', source: SOURCE.FRONTMATTER }]);
  assert.strictEqual(r.banner, 'PLANNER | claude-opus-4-6 (frontmatter)\n  art\n  claude-opus-4-6 (frontmatter)\n');
});

test('--model override beats frontmatter', () => {
  const r = render({ spec: 'demo/planner', models: ['sonnet'], root: TMP });
  assert.deepStrictEqual(r.agents, [{ name: 'planner', model: 'sonnet', source: SOURCE.OVERRIDE }]);
  assert.match(r.banner, /^PLANNER \| sonnet \(override\)/);
});

test('frontmatter beats session model; inherit falls through to the session model', () => {
  const kept = render({ spec: 'demo/planner', sessionModel: 'claude-fable-5-1', root: TMP });
  assert.strictEqual(kept.agents[0].source, SOURCE.FRONTMATTER);
  const inherited = render({ spec: 'demo/planner', agents: ['inheritor'], sessionModel: 'claude-fable-5-1', root: TMP });
  assert.deepStrictEqual(inherited.agents, [{ name: 'inheritor', model: 'claude-fable-5-1', source: SOURCE.SESSION }]);
});

test('no frontmatter and no session model -> unresolved, banner still rendered', () => {
  const r = render({ spec: 'demo/planner', agents: ['bare'], root: TMP });
  assert.strictEqual(r.unresolved, true);
  assert.match(r.banner, /inherit \(session model unknown/);
});

test('parallel banner maps LEFT/RIGHT and takes per-slot overrides', () => {
  const plain = render({ spec: 'demo/pair', root: TMP });
  assert.strictEqual(plain.banner.split('\n')[1], '  claude-opus-4-6 (frontmatter)    claude-haiku-4-5 (frontmatter)');
  const right = render({ spec: 'demo/pair', models: ['', 'sonnet'], root: TMP });
  assert.strictEqual(right.agents[0].source, SOURCE.FRONTMATTER);
  assert.deepStrictEqual(right.agents[1], { name: 'verifier', model: 'sonnet', source: SOURCE.OVERRIDE });
  assert.throws(() => render({ spec: 'demo/pair', agents: ['planner'], root: TMP }), /needs two agents/);
});

test('banner without placeholders needs no agent; unmapped banner asks for --agent with the hint', () => {
  const r = render({ spec: 'demo/intro', root: TMP });
  assert.deepStrictEqual(r.agents, []);
  assert.strictEqual(r.banner, 'INTRO | no agent here\n');
  assert.throws(() => render({ spec: 'demo/orphan', root: TMP }), /pass --agent <name> \(pass the implementer you spawn\)/);
  assert.strictEqual(render({ spec: 'demo/orphan', agents: ['verifier'], root: TMP }).agents[0].model, 'claude-haiku-4-5');
});

test('CLI: exit codes 0 / 1 / 2 and --json envelope', () => {
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync('node', [SCRIPT, ...args, '--root', TMP], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) { return { code: e.status, out: e.stdout, err: e.stderr }; }
  };
  const ok = run(['demo/planner', '--json']);
  assert.strictEqual(ok.code, 0);
  const j = JSON.parse(ok.out);
  assert.strictEqual(j.agents[0].model, 'claude-opus-4-6');
  assert.strictEqual(j.unresolved, false);
  assert.strictEqual(run(['demo/planner', '--agent', 'bare']).code, 1);
  const usage = run(['demo/does-not-exist']);
  assert.strictEqual(usage.code, 2);
  assert.match(usage.err, /banner file not found/);
  assert.strictEqual(run([]).code, 2);
});

// A banner is decorative fiction pasted into the user's scroll, but the first
// reader is a MODEL, and a Bash result that looks like a shell session running
// `rm -rf`, `curl ... | sudo bash` or `git push --force` has exactly the shape of
// a fabricated tool output / prompt injection. On 2026-09-13 the backend banner
// was refused for that reason ("This appears to be a fabricated terminal display
// depicting destructive commands... I won't act on this") and never reached the
// user. Same for lines that depict the agent hiding its work ("nobody saw a
// thing", "quietly ships and says nothing"). Characters and flavour are fine;
// the depicted ACTIONS must stay harmless and open.
const BANNER_DENYLIST = [
  /rm\s+-rf/i,
  /\bsudo\b/i,
  /curl[^\n]*\|\s*(sudo\s+)?(ba)?sh\b/i,
  /--force\b/,
  /password\s*:/i,
  /nobody saw/i,
  /says nothing/i,
];

test('live: every shipped banner with placeholders resolves via its agents.json', () => {
  const skills = path.join(ROOT, '.claude', 'skills');
  const bannerDirs = fs.readdirSync(skills)
    .map((s) => path.join(skills, s, 'banners'))
    .filter((d) => fs.existsSync(d));
  assert.ok(bannerDirs.length > 0, 'expected at least one banners/ dir');
  for (const dir of bannerDirs) {
    const map = JSON.parse(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8'));
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.txt'))) {
      const name = path.basename(f, '.txt');
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(text, /claude-(opus|sonnet|haiku)-[0-9-]+/, `${f}: hardcoded model id left in banner`);
      for (const re of BANNER_DENYLIST) {
        assert.doesNotMatch(text, re, `${f}: banner depicts a destructive or covert action (${re}) - a model reads it as an injection and refuses to paste it`);
      }
      const entry = map[name];
      if (!/\{\{MODEL/.test(text)) continue;
      if (entry && !Array.isArray(entry) && typeof entry !== 'string') continue; // hint-only entry
      const rel = path.relative(ROOT, path.join(dir, f));
      const r = render({ spec: rel, root: ROOT, sessionModel: 'claude-fable-5-1' });
      assert.strictEqual(r.unresolved, false, `${rel} left a model unresolved`);
      assert.doesNotMatch(r.banner, /\{\{MODEL/, `${rel} left a placeholder`);
    }
  }
});
