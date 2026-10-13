#!/usr/bin/env node
'use strict';
// scripts/gates.js
// Runs the repo gates and collapses the output: one line per gate, plus only
// the lines that explain a failure. A green suite contributes three lines to
// the model's context instead of several hundred.
//
//   node scripts/gates.js --lint
//   node scripts/gates.js --lint --unit
//   node scripts/gates.js --all --json
//
// Exit: 0 all requested gates passed, 1 at least one failed, 2 usage error.

const { spawnSync } = require('child_process');
const R = require('./_report');

const HELP = `
gates.js - run the repo gates and print only what failed

Usage:
  node scripts/gates.js [--lint] [--unit] [--api] [--all] [--json]

Gates:
  --lint  npm run lint       (eslint over js/, server.js, scripts/, tests/*.js)
  --unit  npm run test:core  (tests/test_*.mjs via node --test)
  --api   npm run test:api   (tests/test_api_*.js, spawns a server, sequential)
  --all   all three, in that order

Every gate is scoped to THIS repository and never to modules/ - see GATES.

With no gate flag, --lint --unit is assumed.
Exit codes: 0 all passed, 1 a gate failed, 2 usage or internal error.
`;

// Not one of these may reach modules/. An installed module is somebody else's
// code, downloaded from the shared catalog, gitignored and never part of a
// commit or a push of this repository - so it cannot be allowed to decide
// whether this repository's gates are green. It did once: a catalog module
// whose manifest contradicted its own bundled test turned `npm test` red for
// everybody who had installed it, and the same exposure sat in `npm run lint`,
// where a foreign module's lint error would have done it again.
// The module-facing equivalents exist and gate nothing here:
// `npm run lint:modules`, `npm test` (core + modules) and
// `node scripts/check-conventions.js --modules`.
// tests/test_gates_scope.mjs holds this rule for whatever gets added next.
const GATES = {
  lint: { label: 'lint', args: ['run', 'lint'], timeout: 180000 },
  unit: { label: 'unit', args: ['run', 'test:core'], timeout: 300000 },
  api: { label: 'api', args: ['run', 'test:api'], timeout: 420000 },
};

const MAX_FAIL_LINES = 40;

const NOISE_RE = /^(npm (notice|warn|WARN)|> |$|\s*$|# Subtests|# duration_ms|# pass |# cancelled|# skipped|# todo)/;
const SIGNAL_RE = /(error|Error|not ok|failing|failures|FAIL|✖|AssertionError|Expected|Received|problems?\b|\d+:\d+\s+error)/;

/** Keep only the lines that explain the failure, capped. */
function collapse(stdout, stderr) {
  const all = (stdout + '\n' + stderr).split('\n');
  const kept = [];
  for (const line of all) {
    if (NOISE_RE.test(line)) continue;
    if (!SIGNAL_RE.test(line)) continue;
    kept.push(line.replace(/\s+$/, ''));
    if (kept.length >= MAX_FAIL_LINES) { kept.push('... (truncated)'); break; }
  }
  if (kept.length === 0) {
    // Nothing matched: fall back to the tail so a failure is never silent.
    const tail = all.filter((l) => l.trim() !== '').slice(-10);
    kept.push(...tail);
  }
  return kept;
}

function runGate(key) {
  const g = GATES[key];
  const t0 = Date.now();
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, g.args, {
    cwd: R.ROOT,
    // npm.cmd is a shell script; Node refuses to spawn it without a shell
    // (CVE-2024-27980) and every gate answers EINVAL on Windows.
    shell: process.platform === 'win32',
    encoding: 'utf8',
    timeout: g.timeout,
    maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { FORCE_COLOR: '0', NO_COLOR: '1' }),
  });
  const ms = Date.now() - t0;
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return { gate: g.label, status: 'FAIL', ms, lines: ['gate timed out after ' + g.timeout + ' ms'] };
  }
  if (res.error) {
    return { gate: g.label, status: 'FAIL', ms, lines: ['could not run npm ' + g.args.join(' ') + ': ' + res.error.message] };
  }
  const ok = res.status === 0;
  return {
    gate: g.label,
    status: ok ? 'PASS' : 'FAIL',
    ms,
    exit: res.status,
    lines: ok ? [] : collapse(res.stdout || '', res.stderr || ''),
  };
}

function run(flags) {
  let keys = [];
  if (flags.all) keys = ['lint', 'unit', 'api'];
  else {
    if (flags.lint) keys.push('lint');
    if (flags.unit) keys.push('unit');
    if (flags.api) keys.push('api');
  }
  if (keys.length === 0) keys = ['lint', 'unit'];

  const results = [];
  for (const k of keys) {
    const r = runGate(k);
    results.push(r);
    // A failing lint makes the later gates noise; keep running anyway so one
    // invocation reports the whole picture, but do not run api after unit fails
    // (the api suite spawns servers and is expensive).
    if (r.status === 'FAIL' && k === 'unit' && keys.includes('api')) {
      results.push({ gate: 'api', status: 'SKIP', ms: 0, lines: ['skipped: the unit gate failed first'] });
      break;
    }
  }
  return {
    script: 'gates',
    verdict: results.some((r) => r.status === 'FAIL') ? 'FAIL' : 'PASS',
    gates: results,
  };
}

function renderText(out) {
  const lines = ['GATES VERDICT: ' + out.verdict];
  for (const r of out.gates) {
    lines.push('  ' + r.gate.padEnd(5) + ' ' + r.status + '  ' + (r.ms / 1000).toFixed(1) + 's');
  }
  for (const r of out.gates) {
    if (r.status === 'PASS' || r.lines.length === 0) continue;
    lines.push('');
    lines.push(r.gate + ' failure output:');
    for (const l of r.lines) lines.push('  ' + l);
  }
  return lines.join('\n') + '\n';
}

function main() {
  const { flags } = R.parseArgs(process.argv.slice(2), { booleans: ['lint', 'unit', 'api', 'all'] });
  if (flags.help) R.showHelp(HELP);
  const out = run(flags);
  if (flags.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else process.stdout.write(renderText(out));
  process.exit(out.verdict === 'FAIL' ? 1 : 0);
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('gates internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { run, renderText, collapse, GATES };
}
