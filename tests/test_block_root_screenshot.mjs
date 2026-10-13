// tests/test_block_root_screenshot.mjs
// Decision logic of the PreToolUse hook .claude/hooks/block-root-screenshot.js.
// The hook is required as a module (it reads stdin only when run as a script).

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { decide } = require(path.join(ROOT, '.claude', 'hooks', 'block-root-screenshot.js'));

const SHOT = 'mcp__playwright__browser_take_screenshot';
function run(tool_name, tool_input) { return decide(JSON.stringify({ tool_name, tool_input })); }
function denied(out) { return out !== '' && JSON.parse(out).hookSpecificOutput.permissionDecision === 'deny'; }

test('screenshot: omitted filename is allowed (MCP auto-names into --output-dir)', () => {
  assert.strictEqual(run(SHOT, {}), '');
  assert.strictEqual(run(SHOT, { filename: '' }), '');
  assert.strictEqual(run(SHOT, { fullPage: true }), '');
});

test('screenshot: a bare filename is denied - the MCP resolves it against the repo root', () => {
  assert.ok(denied(run(SHOT, { filename: 'pip-s2-before.png' })));
  assert.ok(denied(run(SHOT, { filename: './bob.png' })));
});

test('screenshot: user-data/screenshots/ prefix is allowed, other directories are not', () => {
  assert.strictEqual(run(SHOT, { filename: 'user-data/screenshots/visual-verify-x-ac1.png' }), '');
  assert.strictEqual(run(SHOT, { filename: './user-data/screenshots/x.png' }), '');
  assert.strictEqual(run(SHOT, { filename: 'user-data\\screenshots\\x.png' }), '');
  assert.ok(denied(run(SHOT, { filename: 'user-data/screenshots/../../x.png' })));
  assert.ok(denied(run(SHOT, { filename: 'user-data/screenshots/' })));
  assert.ok(denied(run(SHOT, { filename: 'docs/x.png' })));
  assert.ok(denied(run(SHOT, { filename: '/tmp/x.png' })));
});

test('Write/Edit: image in the repo root is denied, elsewhere allowed', () => {
  process.env.CLAUDE_PROJECT_DIR = '/repo';
  assert.ok(denied(run('Write', { file_path: '/repo/shot.png' })));
  assert.ok(denied(run('Write', { file_path: 'shot.jpg' })));
  assert.ok(denied(run('Edit', { file_path: '/repo/x.webp' })));
  assert.strictEqual(run('Write', { file_path: '/repo/user-data/screenshots/shot.png' }), '');
  assert.strictEqual(run('Write', { file_path: '/repo/assets/agents/a.png' }), '');
  assert.strictEqual(run('Write', { file_path: '/repo/README.md' }), '');
  assert.strictEqual(run('Write', {}), '');
});

test('Bash: writing verbs targeting a root image are denied', () => {
  assert.ok(denied(run('Bash', { command: 'cp /tmp/a.png bob.png' })));
  assert.ok(denied(run('Bash', { command: 'mv user-data/screenshots/a.png ./a.png' })));
  assert.ok(denied(run('Bash', { command: 'screencapture -x shot.png' })));
  assert.ok(denied(run('Bash', { command: 'curl -s http://x/y -o out.png' })));
  assert.ok(denied(run('Bash', { command: 'base64 -d blob.txt > shot.png' })));
  assert.ok(denied(run('Bash', { command: 'ls && cp a.png b.png' })));
});

test('Bash: read-only use and writes into proper folders are allowed', () => {
  assert.strictEqual(run('Bash', { command: 'ls -la *.png' }), '');
  assert.strictEqual(run('Bash', { command: 'cat bob.png | head -c 8' }), '');
  assert.strictEqual(run('Bash', { command: 'open bob.png' }), '');
  assert.strictEqual(run('Bash', { command: 'git rm bob.png' }), '');
  assert.strictEqual(run('Bash', { command: 'cp /tmp/a.png user-data/screenshots/a.png' }), '');
  assert.strictEqual(run('Bash', { command: 'mv bob.png user-data/screenshots/' }), '');
  assert.strictEqual(run('Bash', { command: 'screencapture -x user-data/screenshots/s.png' }), '');
  assert.strictEqual(run('Bash', { command: 'curl -o assets/agents/a.png http://x' }), '');
  assert.strictEqual(run('Bash', { command: 'npm test' }), '');
});

test('Bash: a heredoc body quoting an image write is content, not a command', () => {
  const cmd = "cat > tests/x.mjs <<'EOF'\nconst c = 'cp /tmp/a.png bob.png';\nEOF\nnode -c tests/x.mjs";
  assert.strictEqual(run('Bash', { command: cmd }), '');
  const still = "cat > x.md <<EOF\nhello\nEOF\ncp a.png b.png";
  assert.ok(denied(run('Bash', { command: still })));
});

test('malformed payload never throws into the caller path', () => {
  assert.strictEqual(decide('{}'), '');
  assert.strictEqual(decide(''), '');
});
