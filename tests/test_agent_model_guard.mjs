// The Modele tab writes a personal model choice into .claude/agents/*.md.
// Those files are committed, so without a guard every `git add -A` would push
// one person's preference onto the whole team. The pre-commit hook rewrites
// the STAGED blob back to the canonical model while leaving the working tree
// (and every other staged edit in the same file) alone.
//
// Run: node --test tests/test_agent_model_guard.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'restore-agent-models-for-commit.js');

let repo;
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

const AGENT = `---
name: idea-planner
description: Test agent.
model: claude-opus-4-6
---

Body line.
`;

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'model-guard-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'restore-agent-models-for-commit.js'));
  fs.writeFileSync(path.join(repo, '.claude', 'default-models.json'),
    JSON.stringify({ _comment: 'test', 'idea-planner': 'claude-opus-4-6' }, null, 2));
  fs.writeFileSync(path.join(repo, '.claude', 'agents', 'idea-planner.md'), AGENT);
  git(['add', '-A']);
  git(['commit', '-qm', 'base']);
});

after(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best effort */ } });

describe('agent model guard (pre-commit hook)', () => {
  it('restores the staged model line, keeps other staged edits and the working tree', () => {
    const file = path.join(repo, '.claude', 'agents', 'idea-planner.md');
    fs.writeFileSync(file, AGENT
      .replace('model: claude-opus-4-6', 'model: claude-sonnet-4-6')
      .replace('Body line.', 'Body edited on purpose.'));
    git(['add', '-A']);

    execFileSync(process.execPath, ['scripts/restore-agent-models-for-commit.js'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const staged = git(['show', ':.claude/agents/idea-planner.md']);
    assert.match(staged, /^model: claude-opus-4-6$/m, 'staged model line must be the canonical one');
    assert.match(staged, /Body edited on purpose\./, 'unrelated staged edits must survive');

    const worktree = fs.readFileSync(file, 'utf8');
    assert.match(worktree, /^model: claude-sonnet-4-6$/m, 'the personal choice must stay on disk');
  });

  it('is a no-op when nothing is staged', () => {
    const out = execFileSync(process.execPath, ['scripts/restore-agent-models-for-commit.js'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(out.trim(), '');
  });
});
