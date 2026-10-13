// CLAUDE.md is loaded by Claude Code on every turn and warns past 150k
// characters. It reached 152k on 2026-09-30 because every feature appended its
// full reasoning there. The rules stay in CLAUDE.md; the reasoning lives in
// docs/architecture/*.md. This test is the gate that keeps it that way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_MD = path.join(ROOT, 'CLAUDE.md');
// Well under the 150k hard warning, so the file has room but not a runway.
const BUDGET = 70000;

test('CLAUDE.md stays within its character budget', () => {
  const size = [...fs.readFileSync(CLAUDE_MD, 'utf8')].length;
  assert.ok(
    size <= BUDGET,
    `CLAUDE.md has ${size} characters, budget is ${BUDGET}. Move the detail into the matching docs/architecture/*.md and leave one line here.`,
  );
});

test('every docs/architecture link in CLAUDE.md resolves to a file', () => {
  const text = fs.readFileSync(CLAUDE_MD, 'utf8');
  const links = [...text.matchAll(/\]\((docs\/architecture\/[^)#]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length > 0, 'CLAUDE.md links its topic docs');
  for (const rel of new Set(links)) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is linked from CLAUDE.md but missing`);
  }
});

test('every docs/architecture file is linked from CLAUDE.md', () => {
  const text = fs.readFileSync(CLAUDE_MD, 'utf8');
  for (const f of fs.readdirSync(path.join(ROOT, 'docs/architecture'))) {
    if (!f.endsWith('.md')) continue;
    assert.ok(text.includes(`docs/architecture/${f}`), `docs/architecture/${f} is not linked from CLAUDE.md, so nobody will find it`);
  }
});
