#!/usr/bin/env node
'use strict';
// scripts/agent-banner.js
// Prints an agent spawn banner with the model that really runs the agent.
// The banner files under .claude/skills/<skill>/banners/ carry placeholders
// instead of hardcoded model ids:
//
//   {{MODEL}}                       single-agent banner
//   {{MODEL_LEFT}} / {{MODEL_RIGHT}} side-by-side banner for two agents
//
// The model is resolved exactly the way Claude Code resolves it at spawn:
//   1. the `model` passed to Agent({...})            -> --model <alias|id>
//   2. the `model:` frontmatter of .claude/agents/<agent>.md
//      (this is the line Settings > Modele edits locally)
//   3. the session model, inherited                   -> --session-model <id>
//
// Which agent a banner belongs to comes from `agents.json` next to the banner
// (banner name -> agent name, or [left, right] for a parallel banner). Pass
// --agent to override or when the map has no entry (e.g. a gap-fix banner
// that can precede either implementer).
//
//   node scripts/agent-banner.js new-idea/planner
//   node scripts/agent-banner.js new-idea/verifier --model sonnet
//   node scripts/agent-banner.js new-idea/parallel-guardian-verifier --model ,sonnet
//   node scripts/agent-banner.js new-idea/gapfix --agent frontend-implementer
//   node scripts/agent-banner.js mini/planner --session-model claude-fable-5-1
//
// Deliberately standalone (no ./_report dependency): the same file lives in
// mission-deck and in product-cockpit and must stay byte-identical.
//
// Exit: 0 printed, 1 printed but a model could not be resolved (agent has no
// `model:` and no --session-model was given), 2 usage or internal error.

const fs = require('fs');
const path = require('path');

const HELP = `
agent-banner.js - print an agent spawn banner with the model that really runs

Usage:
  node scripts/agent-banner.js <skill>/<banner> [--agent a[,b]] [--model m[,n]]
                               [--session-model <id>] [--root <dir>] [--json]

  <skill>/<banner>  e.g. new-idea/planner  -> .claude/skills/new-idea/banners/planner.txt
                    (a path to a .txt file is accepted too)
  --agent           agent name(s) from .claude/agents/; default from agents.json
                    next to the banner. Two names for a LEFT/RIGHT banner.
  --model           the value passed to Agent({model}); comma list aligned with
                    --agent, empty slot = no override (e.g. ",sonnet")
  --session-model   the model of the current session; used only when the agent
                    has no \`model:\` line or has \`model: inherit\`
  --json            {banner, agents:[{name, model, source}], unresolved}

Resolution order: --model > agent frontmatter > --session-model.
Exit codes: 0 ok, 1 a model stayed unresolved, 2 usage or internal error.
`;

const SOURCE = { OVERRIDE: 'override', FRONTMATTER: 'frontmatter', SESSION: 'session', UNKNOWN: 'unresolved' };
const PLACEHOLDER_RE = /\{\{MODEL(_LEFT|_RIGHT)?\}\}/g;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const booleans = new Set(['json', 'help']);
  const flags = Object.create(null);
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (eq !== -1) { flags[key] = a.slice(eq + 1); continue; }
    if (booleans.has(key)) { flags[key] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { flags[key] = ''; continue; }
    flags[key] = next;
    i++;
  }
  return { flags, positionals };
}

class UsageError extends Error {}

function splitList(value) {
  if (value === undefined || value === true) return [];
  return String(value).split(',').map((s) => s.trim());
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function resolveBannerPath(root, spec) {
  if (!spec) throw new UsageError('missing <skill>/<banner> argument');
  if (spec.endsWith('.txt')) {
    const p = path.isAbsolute(spec) ? spec : path.join(root, spec);
    if (!fs.existsSync(p)) throw new UsageError(`banner file not found: ${spec}`);
    return p;
  }
  const parts = spec.split('/').filter(Boolean);
  if (parts.length !== 2) throw new UsageError(`expected <skill>/<banner>, got: ${spec}`);
  const p = path.join(root, '.claude', 'skills', parts[0], 'banners', parts[1] + '.txt');
  if (!fs.existsSync(p)) throw new UsageError(`banner file not found: ${path.relative(root, p)}`);
  return p;
}

function loadAgentMap(bannerPath) {
  const mapPath = path.join(path.dirname(bannerPath), 'agents.json');
  if (!fs.existsSync(mapPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (e) {
    throw new UsageError(`cannot parse ${mapPath}: ${e.message}`);
  }
}

/** `model:` from the YAML frontmatter of an agent file; null when absent or `inherit`. */
function readFrontmatterModel(root, agent) {
  if (!/^[A-Za-z0-9_-]+$/.test(agent)) throw new UsageError(`invalid agent name: ${agent}`);
  const file = path.join(root, '.claude', 'agents', agent + '.md');
  if (!fs.existsSync(file)) throw new UsageError(`agent not found: .claude/agents/${agent}.md`);
  const text = fs.readFileSync(file, 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const line = fm[1].match(/^model:[ \t]*([^\r\n#]+)/m);
  if (!line) return null;
  const value = line[1].trim().replace(/^['"]|['"]$/g, '');
  if (!value || value === 'inherit') return null;
  return value;
}

function resolveModel(root, agent, override, sessionModel) {
  if (override) return { name: agent, model: override, source: SOURCE.OVERRIDE };
  const fromFile = readFrontmatterModel(root, agent);
  if (fromFile) return { name: agent, model: fromFile, source: SOURCE.FRONTMATTER };
  if (sessionModel) return { name: agent, model: sessionModel, source: SOURCE.SESSION };
  return { name: agent, model: 'inherit', source: SOURCE.UNKNOWN };
}

function label(entry) {
  return entry.source === SOURCE.UNKNOWN
    ? 'inherit (session model unknown - pass --session-model)'
    : `${entry.model} (${entry.source})`;
}

/**
 * Core. Returns {banner, agents, unresolved}. Throws UsageError on bad input.
 * @param {{spec: string, agents?: string[], models?: string[], sessionModel?: string, root?: string}} opts
 */
function render(opts) {
  const root = path.resolve(opts.root || path.join(__dirname, '..'));
  const bannerPath = resolveBannerPath(root, opts.spec);
  const raw = fs.readFileSync(bannerPath, 'utf8');
  const bannerName = path.basename(bannerPath, '.txt');

  const wantsRight = /\{\{MODEL_RIGHT\}\}/.test(raw);
  const wantsAny = PLACEHOLDER_RE.test(raw);
  PLACEHOLDER_RE.lastIndex = 0;

  let agents = (opts.agents || []).filter(Boolean);
  if (agents.length === 0 && wantsAny) {
    const map = loadAgentMap(bannerPath);
    const entry = map[bannerName];
    if (Array.isArray(entry)) agents = entry.slice();
    else if (typeof entry === 'string') agents = [entry];
    else {
      throw new UsageError(
        `no default agent for banner "${bannerName}" - pass --agent <name>` +
        (entry && entry.hint ? ` (${entry.hint})` : '')
      );
    }
  }
  if (wantsRight && agents.length < 2) {
    throw new UsageError(`banner "${bannerName}" has {{MODEL_RIGHT}} - it needs two agents (--agent a,b)`);
  }

  const models = opts.models || [];
  const resolved = agents.map((a, i) => resolveModel(root, a, models[i] || '', opts.sessionModel || ''));

  const banner = raw.replace(PLACEHOLDER_RE, (_m, side) => {
    const idx = side === '_RIGHT' ? 1 : 0;
    return resolved[idx] ? label(resolved[idx]) : '{{MODEL' + (side || '') + '}}';
  });

  return {
    banner,
    agents: resolved,
    unresolved: resolved.some((r) => r.source === SOURCE.UNKNOWN),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  if (flags.help) { process.stdout.write(HELP); return 0; }
  let result;
  try {
    result = render({
      spec: positionals[0],
      agents: splitList(flags.agent),
      models: splitList(flags.model),
      sessionModel: flags['session-model'] || '',
      root: flags.root,
    });
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`agent-banner: ${e.message}\n${HELP}`);
      return 2;
    }
    process.stderr.write(`agent-banner: ${e.message}\n`);
    return 2;
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(result.banner.endsWith('\n') ? result.banner : result.banner + '\n');
  }
  return result.unresolved ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { render, readFrontmatterModel, resolveModel, parseArgs, SOURCE, UsageError };
