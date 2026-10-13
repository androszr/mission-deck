#!/usr/bin/env node
// PreToolUse hook: keep screenshots out of the repo root.
//
// Node instead of bash+jq on purpose: the previous shell version needed `jq`,
// which is standard on macOS via brew but absent from a default Windows box,
// where the hook then failed open and silently stopped guarding anything.
// Node is already a hard requirement of this repo, so this version runs
// identically on macOS, Windows and Linux.
//
// How the playwright MCP resolves `filename` (playwright-core >= 1.63, the
// version pinned in .mcp.json):
//   - NO `filename`   -> outputFile()    -> `--output-dir` (user-data/screenshots/)
//   - WITH `filename` -> workspaceFile() -> path.resolve(cwd, filename)
// so a bare `filename` such as `shot.png` lands in the repo root and
// `--output-dir` is ignored. Older MCP versions (< 0.0.4x) did the opposite,
// which is why an earlier revision of this hook demanded a bare name. Keep the
// hook and the pin in .mcp.json in step when bumping the MCP.
//
// Three cases are blocked:
//   1. mcp__playwright__browser_take_screenshot with a `filename` that does
//      not start with `user-data/screenshots/` (or contains `..`). Omitting
//      `filename` is always allowed - the MCP auto-names into --output-dir.
//   2. Write/Edit/MultiEdit creating an image directly in the repo root.
//   3. Bash commands that hand an image path in the repo root to a writing
//      command (cp / mv / screencapture / curl -o / tee / > redirect).
//
// On a violation: print a PreToolUse "deny" decision and exit 0.
// Otherwise: print nothing and exit 0 (allow). Never exit non-zero - a crashing
// hook blocks unrelated tool calls.

'use strict';

const SCREENSHOT_DIR = 'user-data/screenshots/';
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try {
      const out = decide(raw);
      if (out) process.stdout.write(out);
    } catch (_) {
      // Malformed payload or unexpected shape - allow rather than block.
    }
    process.exit(0);
  });
}

function deny(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

/** Strip the project root from an absolute path; return a forward-slash relative path. */
function relToRoot(fp) {
  const root = process.env.CLAUDE_PROJECT_DIR || '';
  let rel = String(fp || '');
  if (root && rel.startsWith(root)) rel = rel.slice(root.length);
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
}

/** True when `rel` names an image file directly in the repo root. */
function isRootImage(rel) {
  return /^[^/]+$/.test(rel) && IMAGE_EXT_RE.test(rel);
}

/** Returns the JSON deny decision as a string, or '' to allow. Exported for tests. */
function decide(text) {
  const payload = JSON.parse(text || '{}');
  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};

  if (tool === 'mcp__playwright__browser_take_screenshot') {
    if (input.filename === undefined || input.filename === null || input.filename === '') return '';
    const fn = String(input.filename).replace(/\\/g, '/').replace(/^\.\//, '');
    const ok = fn.startsWith(SCREENSHOT_DIR)
      && !fn.split('/').includes('..')
      && fn.length > SCREENSHOT_DIR.length;
    if (!ok) {
      return deny('BLOCKED: browser_take_screenshot `filename` must start with `' + SCREENSHOT_DIR
        + '` (e.g. ' + SCREENSHOT_DIR + 'visual-verify-x-ac1.png), or be omitted so the MCP auto-names '
        + 'into --output-dir. The playwright MCP resolves a given filename against the repo root and '
        + 'ignores --output-dir, so a bare name litters the root with stray screenshots.');
    }
    return '';
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    const rel = relToRoot(input.file_path);
    if (rel && isRootImage(rel)) {
      return deny('BLOCKED: do not write image files to the repo root. Screenshots and image assets belong in '
        + SCREENSHOT_DIR + ' (gitignored) or assets/. Re-issue the write with a ' + SCREENSHOT_DIR + ' path.');
    }
    return '';
  }

  if (tool === 'Bash') {
    const hit = bashRootImageTarget(String(input.command || ''));
    if (hit) {
      return deny('BLOCKED: this command writes `' + hit + '` into the repo root. Images belong in '
        + SCREENSHOT_DIR + ' (gitignored) or assets/. Re-issue the command with that path.');
    }
    return '';
  }

  return '';
}

/**
 * Find the first root-level image path a Bash command WRITES to, or ''.
 * Heredoc bodies are file content, not commands, and are dropped first (a test
 * or a doc quoting `cp a.png b.png` must not trip the guard). Each simple
 * command is tokenised; only the tokens a verb actually writes are checked:
 * cp/mv -> last argument, curl -> the -o operand, redirects -> the target,
 * screencapture/tee/touch/install -> every operand. `ls *.png`, `cat x.png`,
 * `open x.png` and `mv x.png user-data/screenshots/` therefore stay allowed.
 */
function bashRootImageTarget(command) {
  const noHeredoc = command.replace(
    /<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?[^\n]*\n[\s\S]*?\n\1\s*(?=\n|$)/g, ' ');
  const isRootImg = (tok) => {
    const t = tok.replace(/^["']|["']$/g, '').replace(/^\.\//, '');
    return t !== '' && !t.includes('/') && IMAGE_EXT_RE.test(t) ? t : '';
  };
  for (const segment of noHeredoc.split(/&&|\|\||;|\||\n/)) {
    // Redirect targets: `> x.png`, `>> x.png`, `>x.png`.
    const redir = /(?:^|\s)>{1,2}\s*(\S+)/.exec(segment);
    if (redir && isRootImg(redir[1])) return isRootImg(redir[1]);

    const toks = segment.trim().split(/\s+/).filter(Boolean);
    const vi = toks.findIndex((t) => /^(cp|mv|screencapture|tee|touch|install|curl)$/.test(t));
    if (vi < 0) continue;
    const verb = toks[vi];
    const operands = toks.slice(vi + 1).filter((t) => !t.startsWith('-') || verb === 'curl');
    if (verb === 'curl') {
      const oi = toks.indexOf('-o', vi);
      if (oi > 0 && toks[oi + 1] && isRootImg(toks[oi + 1])) return isRootImg(toks[oi + 1]);
      continue;
    }
    if (verb === 'cp' || verb === 'mv') {
      const last = operands[operands.length - 1];
      if (last && isRootImg(last)) return isRootImg(last);
      continue;
    }
    for (const t of operands) if (isRootImg(t)) return isRootImg(t);
  }
  return '';
}

module.exports = { decide, bashRootImageTarget };
