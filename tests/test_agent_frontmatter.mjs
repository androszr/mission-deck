// A subagent or a skill is identified by its YAML frontmatter. When that block
// fails to parse the loader does not warn - the agent silently disappears from
// the roster and the skill keeps only its directory name. The failure that bit
// us was a plain (unquoted) scalar containing ": ", which YAML reads as a
// nested mapping: `description: Single mode - Phase 6g of /new-idea: drives...`
// dropped engineering-lead-reviewer, meeting-summarizer and
// playwright-specialist, and blanked four skill descriptions.
//
// The fix is always the same - make the value a block scalar (`>-`). This test
// is the guard, written without a YAML dependency because the repo has none.
//
// Run: node --test tests/test_agent_frontmatter.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectTargets() {
  const out = [];
  const agentsDir = path.join(ROOT, '.claude', 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const name of fs.readdirSync(agentsDir)) {
      if (name.endsWith('.md') && name !== 'README.md') out.push(path.join(agentsDir, name));
    }
  }
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'SKILL.md') out.push(p);
    }
  };
  walk(path.join(ROOT, '.claude', 'skills'));
  return out;
}

// Returns every top-level plain (unquoted, non-block) scalar in the frontmatter
// as { key, value }, with the continuation lines folded in.
function plainScalars(frontmatter) {
  const lines = frontmatter.split('\n');
  const found = [];
  let current = null;
  for (const line of lines) {
    const head = line.match(/^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/);
    if (head) {
      current = null;
      const value = head[2].trim();
      if (!value) continue;                       // block scalar body or nested map
      if (/^[>|]/.test(value)) continue;          // folded or literal block
      if (/^["']/.test(value)) continue;          // quoted, colons are legal
      current = { key: head[1], value };
      found.push(current);
      continue;
    }
    if (current && /^\s+\S/.test(line)) current.value += ' ' + line.trim();
    else current = null;
  }
  return found;
}

describe('agent and skill frontmatter', () => {
  const targets = collectTargets();

  it('finds the agents and the skills', () => {
    assert.ok(targets.length > 10, `expected a roster, got ${targets.length} files`);
  });

  for (const file of targets) {
    const rel = path.relative(ROOT, file);
    const raw = fs.readFileSync(file, 'utf8');

    it(`${rel} parses`, () => {
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      assert.ok(m, 'missing frontmatter block');
      const fm = m[1];

      assert.match(fm, /^name:[ \t]*\S/m, 'missing name');

      for (const { key, value } of plainScalars(fm)) {
        assert.ok(
          !/:[ \t]/.test(value),
          `"${key}" is a plain scalar containing ": ", which YAML reads as a nested `
          + 'mapping and the loader drops the whole file. Use a block scalar:\n'
          + `    ${key}: >-\n      ${value.slice(0, 60)}...`,
        );
      }
    });
  }
});
