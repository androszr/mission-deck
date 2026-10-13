'use strict';
// scripts/restore-agent-models-for-commit.js
//
// Pre-commit guard: keeps personal agent `model:` preferences out of commits.
//
// At server startup, _applyAgentModelPreferences() (server.js) patches the
// `model:` frontmatter line in .claude/agents/*.md and
// with the current user's personal model choice
// choice. Those patched lines then show up in `git status`/`git diff` and
// leak into commits whenever an agent file is staged for a legitimate edit.
//
// This script rewrites the STAGED blob (index only) for every staged
// agent file so its `model:` line matches the canonical default from
// `.claude/default-models.json`, leaving every other staged change
// (descriptions, prompts, tool lists) intact. The working tree is never
// touched, so the user's personal model preference survives the commit.
//
// Invoked from `.husky/pre-commit` (normal CLI commits). The server stages
// nothing on the user's behalf, so there is no second caller.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MODEL_LINE_RE = /^model:.*$/m;

function restoreModelLine(stagedText, headText) {
  if (typeof stagedText !== 'string' || typeof headText !== 'string') return null;

  const stagedMatch = FRONTMATTER_RE.exec(stagedText);
  if (!stagedMatch) return null;

  const headMatch = FRONTMATTER_RE.exec(headText);
  if (!headMatch) return null;

  const stagedBlock = stagedMatch[1];
  const headBlock = headMatch[1];

  const headModelMatch = MODEL_LINE_RE.exec(headBlock);
  if (!headModelMatch) return null;
  const headModelLine = headModelMatch[0];

  if (!MODEL_LINE_RE.test(stagedBlock)) return null;

  const newBlock = stagedBlock.replace(MODEL_LINE_RE, () => headModelLine);
  if (newBlock === stagedBlock) return null;

  const blockStart = stagedMatch.index + stagedMatch[0].indexOf(stagedBlock);
  const blockEnd = blockStart + stagedBlock.length;
  return stagedText.slice(0, blockStart) + newBlock + stagedText.slice(blockEnd);
}

function restoreModelLineToTarget(stagedText, targetModelLine) {
  if (typeof stagedText !== 'string') return null;
  const fm = FRONTMATTER_RE.exec(stagedText);
  if (!fm) return null;
  const block = fm[1];
  if (!MODEL_LINE_RE.test(block)) return null;
  const currentMatch = MODEL_LINE_RE.exec(block);
  if (currentMatch[0] === targetModelLine) return null;
  const newBlock = block.replace(MODEL_LINE_RE, () => targetModelLine);
  const blockStart = fm.index + fm[0].indexOf(block);
  const blockEnd = blockStart + block.length;
  return stagedText.slice(0, blockStart) + newBlock + stagedText.slice(blockEnd);
}

// --- git plumbing (only runs when invoked directly) ---------------------

const AGENT_FILE_RE = /^\.claude\/agents\/[^/]+\.md$/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function getStagedTargetFiles(useDefaults) {
  if (useDefaults) {
    const out = git(['ls-files', '--', '.claude/agents/']);
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((file) => AGENT_FILE_RE.test(file));
  }
  const out = git(['diff', '--cached', '--name-only', '--diff-filter=AM']);
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((file) => AGENT_FILE_RE.test(file));
}

function readStagedBlob(filePath) {
  return git(['show', `:0:${filePath}`]);
}

function readHeadBlob(filePath) {
  return git(['show', `HEAD:${filePath}`]);
}

function getIndexMode(filePath) {
  const out = git(['ls-files', '-s', '--', filePath]).trim();
  const mode = out.split(/\s+/)[0];
  return mode || '100644';
}

function extractAgentName(filePath) {
  const agentMatch = filePath.match(/^\.claude\/agents\/([^/]+)\.md$/);
  if (agentMatch) return agentMatch[1];
  return null;
}

function readDefaults() {
  try {
    const defaultsPath = path.join(__dirname, '..', '.claude', 'default-models.json');
    return JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeRestoredBlob(filePath, restored) {
  const mode = getIndexMode(filePath);
  const sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    input: restored,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  git(['update-index', '--cacheinfo', `${mode},${sha},${filePath}`]);
  process.stderr.write(`[agent-model-guard] restored model: line in ${filePath}\n`);
}

function restoreFile(filePath, defaults) {
  const stagedText = readStagedBlob(filePath);
  let restored = null;

  const agentName = extractAgentName(filePath);
  const defaultModel = agentName && defaults ? defaults[agentName] : null;

  if (defaultModel) {
    restored = restoreModelLineToTarget(stagedText, `model: ${defaultModel}`);
  } else {
    let headText;
    try { headText = readHeadBlob(filePath); } catch { return; }
    restored = restoreModelLine(stagedText, headText);
  }

  if (restored === null) return;
  writeRestoredBlob(filePath, restored);
}

function main() {
  const defaults = readDefaults();
  const files = getStagedTargetFiles(!!defaults);
  for (const filePath of files) {
    try {
      restoreFile(filePath, defaults);
    } catch (err) {
      process.stderr.write(`[agent-model-guard] skipped ${filePath}: ${err.message}\n`);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`[agent-model-guard] guard failed, continuing commit: ${err.message}\n`);
  }
  process.exit(0);
}

module.exports = { restoreModelLine, restoreModelLineToTarget, AGENT_FILE_RE };
