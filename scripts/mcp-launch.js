#!/usr/bin/env node
'use strict';
// scripts/mcp-launch.js <command> [args...]
//
// Starts ONE MCP server for Claude Code and forwards stdio, the exit code and
// termination. It exists for a single reason: on Windows `npx` and `gitnexus`
// are `.cmd` shims, which Node - and Claude Code, which spawns MCP servers
// through it - refuses to start without a shell (CVE-2024-27980). The
// documented workaround is `cmd /c npx ...`, but .mcp.json is one file shared
// with macOS, where `cmd` does not exist. `node` is a real binary on both
// systems, so it is the command in .mcp.json and the shell decision lives here.
//
// Not a general "run a command" tool: .mcp.json is the only caller and it
// names the command in a committed file, under review.
const { spawn } = require('child_process');

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node scripts/mcp-launch.js <command> [args...]');
  process.exit(2);
}

const child = spawn(cmd, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
});
child.on('error', (e) => {
  console.error('[mcp-launch] ' + cmd + ': ' + e.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(code === null ? (signal ? 1 : 0) : code);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { child.kill(sig); } catch (_e) { /* already gone */ } });
}
