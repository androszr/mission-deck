// tests/test_settings_skille_groups.mjs
// The display layer of Settings > Skills: which group a skill sits in, its kind chip and its
// output line. Card text is derived from the skill files, but this editorial layer is hand-kept,
// so it must not name a skill that does not exist or put one skill in two groups.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, SKILL_KIND, SKILL_OUTPUT } from '../js/settings-skille-groups.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');

test('the groups keep their order: daily work first, GitNexus last', () => {
  assert.deepStrictEqual(GROUPS.map((g) => g.label), ['Daily', 'Building', 'Documents', 'Audits and upkeep', 'GitNexus']);
});

test('every skill named in a group has a directory in .claude/skills', () => {
  for (const g of GROUPS) {
    for (const name of g.skills) {
      assert.ok(fs.existsSync(path.join(SKILLS_DIR, name)), g.label + ' names a missing skill: ' + name);
    }
  }
});

test('no skill sits in two groups', () => {
  const seen = new Map();
  for (const g of GROUPS) {
    for (const name of g.skills) {
      assert.ok(!seen.has(name), name + ' is in both "' + seen.get(name) + '" and "' + g.label + '"');
      seen.set(name, g.label);
    }
  }
});

test('every grouped skill carries a kind chip and an output line', () => {
  for (const g of GROUPS) {
    for (const name of g.skills) {
      assert.ok(SKILL_KIND[name], name + ' needs a kind chip');
      assert.ok(SKILL_OUTPUT[name] && SKILL_OUTPUT[name].length > 5, name + ' needs an output line');
    }
  }
});
