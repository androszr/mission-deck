// tests/test_core_scope.mjs
// The ownership gate: who may change the core on this machine.
// Everything under test is pure or takes an injected root, so no test here
// touches the real checkout, the real marker file or git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CS = require('../scripts/_core-scope.js');
const HOOK = require('../scripts/hook-core-scope.js');
const conventions = require('../scripts/check-conventions.js');

const line = (text) => ({ line: 1, text });

// --- isCorePath ------------------------------------------------------------

test('isCorePath: modules/ is the only place that is not core', () => {
  assert.equal(CS.isCorePath('modules/demo-hub/client/index.js'), false);
  assert.equal(CS.isCorePath('modules/x/module.json'), false);
  assert.equal(CS.isCorePath('server.js'), true);
  assert.equal(CS.isCorePath('js/app.js'), true);
  assert.equal(CS.isCorePath('.gitignore'), true);
  // A path that merely CONTAINS "modules" is core - the anchor matters, the
  // same trap the .gitignore entry for /modules/ documents.
  assert.equal(CS.isCorePath('tests/fixtures/modules/demo/module.json'), true);
  assert.equal(CS.isCorePath('modules-template/README.md'), true);
});

// --- coreEditAllowed -------------------------------------------------------

test('coreEditAllowed: marker or the env flag, nothing else', () => {
  assert.equal(CS.coreEditAllowed({ markerPresent: false }), false);
  assert.equal(CS.coreEditAllowed({ markerPresent: true }), true);
  assert.equal(CS.coreEditAllowed({ markerPresent: false, envValue: '1' }), true);
  assert.equal(CS.coreEditAllowed({ markerPresent: false, envValue: '0' }), false);
  assert.equal(CS.coreEditAllowed({ markerPresent: false, envValue: 'true' }), false);
  assert.equal(CS.coreEditAllowed({}), false);
  assert.equal(CS.coreEditAllowed(null), false);
});

test('coreEditAllowedIn: reads the marker off a real directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corescope-'));
  try {
    assert.equal(CS.coreEditAllowedIn(dir, {}), false);
    fs.writeFileSync(path.join(dir, CS.CORE_DEV_MARKER), '');
    assert.equal(CS.coreEditAllowedIn(dir, {}), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('coreEditAllowedIn: env flag works with no marker on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corescope-'));
  try {
    assert.equal(CS.coreEditAllowedIn(dir, { [CS.CORE_DEV_ENV]: '1' }), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- coreScopeApplies ------------------------------------------------------

test('coreScopeApplies: only scopes that describe real work', () => {
  for (const m of ['staged', 'worktree', 'base:main', 'base:origin/main']) {
    assert.equal(CS.coreScopeApplies(m), true, m);
  }
  // --files / --diff-file / --modules are an explicit manual selection, and
  // the existing conventions corpus drives the checker through --diff-file.
  for (const m of ['files', 'diff-file', 'modules', 'no-baseline', '', null]) {
    assert.equal(CS.coreScopeApplies(m), false, String(m));
  }
});

// --- generatedOnlyChange ---------------------------------------------------

test('generatedOnlyChange: an agent brief whose only diff is model:', () => {
  const hit = CS.generatedOnlyChange({
    path: '.claude/agents/idea-planner.md',
    added: [line('model: claude-opus-5')],
    removed: [line('model: claude-sonnet-5')],
  });
  assert.ok(hit);
  assert.equal(hit.id, 'agent-model');
});

test('generatedOnlyChange: an edited brief still counts as a real edit', () => {
  assert.equal(CS.generatedOnlyChange({
    path: '.claude/agents/idea-planner.md',
    added: [line('model: claude-opus-5'), line('A new rule in the brief.')],
    removed: [line('model: claude-sonnet-5')],
  }), null);
});

test('generatedOnlyChange: the GitNexus banner counts line', () => {
  const banner = (n) => line(`This project is indexed by GitNexus as **mission-deck** (${n} symbols, 11796 relationships, 300 execution flows). Use the tools.`);
  const hit = CS.generatedOnlyChange({
    path: 'CLAUDE.md', added: [banner(4200)], removed: [banner(4091)],
  });
  assert.ok(hit);
  assert.equal(hit.id, 'gitnexus-banner');
  // The `gitnexus:keep` short phrasing is the same generated line.
  assert.ok(CS.generatedOnlyChange({
    path: 'AGENTS.md',
    added: [line('Indexed as **mission-deck** (10 symbols, 2 relationships, 1 execution flows).')],
    removed: [line('Indexed as **mission-deck** (9 symbols, 2 relationships, 1 execution flows).')],
  }));
});

test('generatedOnlyChange: prose without the counts is a person writing', () => {
  assert.equal(CS.generatedOnlyChange({
    path: 'CLAUDE.md',
    added: [line('Indexed as **mission-deck**.')],
    removed: [],
  }), null);
});

test('generatedOnlyChange: an empty diff is never generated output', () => {
  // A rename or a mode change touches no line. Reading that as "a machine did
  // it" would wave a file move through the gate unreviewed.
  assert.equal(CS.generatedOnlyChange({ path: 'CLAUDE.md', added: [], removed: [] }), null);
  assert.equal(CS.generatedOnlyChange({ path: '.claude/agents/reviewer.md' }), null);
});

test('generatedOnlyChange: only a MODIFIED file can be a generator output', () => {
  const gen = {
    path: '.claude/agents/reviewer.md',
    added: [line('model: claude-opus-5')],
    removed: [line('model: claude-sonnet-5')],
  };
  assert.ok(CS.generatedOnlyChange({ ...gen, status: 'M' }));
  // Deleting or adding one of these files is a person's decision, and an
  // exemption here would carry it straight past the ownership gate.
  for (const status of ['D', 'A', 'R']) {
    assert.equal(CS.generatedOnlyChange({ ...gen, status }), null, status);
  }
});

test('partitionCoreChanges: a DELETED core file is blocked', () => {
  const { blocked } = CS.partitionCoreChanges([
    { path: 'server.js', status: 'D', added: [], removed: [line('const a = 1;')] },
  ]);
  assert.deepEqual(blocked.map((b) => b.path), ['server.js']);
});

test('generatedOnlyChange: a file with no rule is never exempt', () => {
  assert.equal(CS.generatedOnlyChange({ path: 'server.js', added: [line('model: x')] }), null);
});

// --- partitionCoreChanges --------------------------------------------------

test('partitionCoreChanges: splits core, module and generated', () => {
  const { blocked, generated } = CS.partitionCoreChanges([
    { path: 'server.js', added: [line('const a = 1;')] },
    { path: 'modules/demo/client/demo.js', added: [line('const b = 2;')] },
    { path: '.claude/agents/reviewer.md', added: [line('model: claude-opus-5')], removed: [] },
  ]);
  assert.deepEqual(blocked.map((b) => b.path), ['server.js']);
  assert.deepEqual(generated.map((g) => g.path), ['.claude/agents/reviewer.md']);
});

test('partitionCoreChanges: tolerates junk entries', () => {
  const { blocked } = CS.partitionCoreChanges([null, {}, { path: 'js/app.js', added: [line('x')] }]);
  assert.deepEqual(blocked.map((b) => b.path), ['js/app.js']);
});

// --- the pre-commit hook ---------------------------------------------------

test('hook blockedPaths: refuses core paths, allows modules', () => {
  const staged = ['server.js', 'modules/demo/module.json', 'js/app.js'];
  assert.deepEqual(HOOK.blockedPaths(staged, false), ['server.js', 'js/app.js']);
});

test('hook blockedPaths: an opted-in machine is never blocked', () => {
  assert.deepEqual(HOOK.blockedPaths(['server.js'], true), []);
});

test('hook blockedPaths: the generated-line exemption is NOT applied here', () => {
  // restore-agent-models-for-commit.js runs first in .husky/pre-commit and has
  // already put the model: lines back, so a staged agent file that still
  // differs at this point is a real edit of the brief.
  assert.deepEqual(HOOK.blockedPaths(['.claude/agents/reviewer.md'], false),
    ['.claude/agents/reviewer.md']);
});

test('hook getStagedFiles: the diff-filter includes deletions', () => {
  // The bug this pins: with --diff-filter=ACMR a staged deletion never reached
  // blockedPaths, so `git rm server.js && git commit` walked through the gate.
  // Asserted on the source because the filter string IS the decision - a test
  // driving a real index would not tell us which letters were asked for.
  const src = fs.readFileSync(
    new URL('../scripts/hook-core-scope.js', import.meta.url), 'utf8');
  const m = /--diff-filter=([A-Z]+)/.exec(src);
  assert.ok(m, 'hook must pass an explicit --diff-filter');
  assert.ok(m[1].includes('D'), `deletions must be listed, got ${m[1]}`);
});

test('hook blockedPaths: a deleted core path blocks like any other', () => {
  assert.deepEqual(HOOK.blockedPaths(['server.js'], false), ['server.js']);
});

test('hook blockedPaths: nothing staged blocks nothing', () => {
  assert.deepEqual(HOOK.blockedPaths([], false), []);
  assert.deepEqual(HOOK.blockedPaths(undefined, false), []);
});

// --- the check-conventions rule -------------------------------------------

function runRule(files, { mode, allowed }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corescope-rule-'));
  try {
    if (allowed) fs.writeFileSync(path.join(dir, CS.CORE_DEV_MARKER), '');
    const rep = new (require('../scripts/_report.js').Report)('t', {});
    conventions.ruleCoreScope(rep, files, dir, mode);
    return rep;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('ruleCoreScope: blocks a core file in a worktree scope', () => {
  const rep = runRule([{ path: 'server.js', added: [line('const a = 1;')] }],
    { mode: 'worktree', allowed: false });
  assert.equal(rep.counts().BLOCK, 1);
  assert.equal(rep.findings[0].rule, 'core-scope');
});

test('ruleCoreScope: the marker turns the block off', () => {
  const rep = runRule([{ path: 'server.js', added: [line('const a = 1;')] }],
    { mode: 'worktree', allowed: true });
  assert.equal(rep.counts().BLOCK, 0);
});

test('ruleCoreScope: a deleted core file blocks', () => {
  const rep = runRule([{ path: 'server.js', status: 'D', added: [], removed: [line('x')] }],
    { mode: 'staged', allowed: false });
  assert.equal(rep.counts().BLOCK, 1);
  assert.equal(rep.findings[0].rule, 'core-scope');
});

test('ruleCoreScope: a --diff-file scope never blocks', () => {
  const rep = runRule([{ path: 'server.js', added: [line('const a = 1;')] }],
    { mode: 'diff-file', allowed: false });
  assert.equal(rep.counts().BLOCK, 0);
});

test('ruleCoreScope: module code never blocks', () => {
  const rep = runRule([{ path: 'modules/demo/client/demo.js', added: [line('const a = 1;')] }],
    { mode: 'staged', allowed: false });
  assert.equal(rep.counts().BLOCK, 0);
});

test('ruleCoreScope: a generated line is a NOTE, not a BLOCK', () => {
  const rep = runRule([{
    path: '.claude/agents/reviewer.md',
    added: [line('model: claude-opus-5')], removed: [line('model: claude-sonnet-5')],
  }], { mode: 'worktree', allowed: false });
  assert.equal(rep.counts().BLOCK, 0);
  assert.equal(rep.counts().NOTE, 1);
  assert.equal(rep.findings[0].rule, 'generated-line');
});

test('ruleCoreScope: the generated NOTE is reported in every scope', () => {
  // It is advice about `git add -A`, not about ownership, so it does not
  // depend on the scope or on the marker.
  const rep = runRule([{
    path: '.claude/agents/reviewer.md',
    added: [line('model: claude-opus-5')], removed: [line('model: claude-sonnet-5')],
  }], { mode: 'diff-file', allowed: true });
  assert.equal(rep.counts().NOTE, 1);
});
