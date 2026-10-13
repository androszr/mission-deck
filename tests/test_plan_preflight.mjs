// tests/test_plan_preflight.mjs
// Parsing and rule logic of scripts/plan-preflight.js, exercised against
// fixture plans written to a temp dir - never against the live repo files.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preflight = require(path.join(ROOT, 'scripts', 'plan-preflight.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-fix-'));

function writePlan(name, body) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

const CLEAN_PLAN = `# Add the reports view

**Date:** 2026-09-04
**Status:** draft
**Surface:** view

## Business description

**Why we are doing this:** The team cannot see its reports in one place today and hunts for them across several files.

**What changes for the user:**

1. A Reports entry appears in the Area A menu.
2. Reports live in one place, no hunting through files.
3. Every report opens with one click.

**What the user will see after release:** After clicking Reports in the left menu they see the list of reports.

**What this does NOT change:** The content of the reports stays the same.

## Idea

Add a reports view under area-a.

## Context

- The repo already has the area-a hub.

## Files to change

- \`index.html\` - add the view-section
- \`js/view-registry.js\` - add the entry
- \`js/core-hubs.mjs\` - add the page to the hub's \`pages\`

## New files

- \`js/reports.js\` - the view module

## Steps

- [ ] 1. Add the \`view-section\` to \`index.html\`.
- [ ] 2. Create \`js/reports.js\` with the render and init functions.
- [ ] 3. Add the \`VIEW_REGISTRY\` entry in \`js/view-registry.js\`.
- [ ] 4. Add the page entry to the hub row in \`js/core-hubs.mjs\`.
- [ ] 5. Use \`ds-card\` and \`ds-btn\` classes for every element.

## Risks & footguns

- Forgetting the flyout entry leaves the view unreachable.

## Test plan

- [ ] \`npm run lint\` exits 0
- [ ] \`npm test\` exits 0

## Acceptance criteria

- [ ] AC1: \`grep -c "view-reports" index.html\` returns >= 1
- [ ] AC2: \`npm run lint\` exits 0
- [ ] AC3: \`grep -n "reports" js/view-registry.js js/core-hubs.mjs\` matches both

## Out of scope

- Any server endpoint.

## Iteration log

- 2026-09-04 initial draft
`;

test('a clean plan produces no BLOCK findings', () => {
  const p = writePlan('clean.md', CLEAN_PLAN);
  const rep = preflight.run(p, {});
  assert.strictEqual(rep.counts().BLOCK, 0, JSON.stringify(rep.sorted(), null, 2));
  assert.strictEqual(rep.exitCode(), 0);
});

test('rule 1 blocks on every missing H2 section', () => {
  const p = writePlan('nosections.md', '# T\n\n**Status:** draft\n\n## Idea\n\nx\n');
  const rep = preflight.run(p, {});
  const r1 = rep.findings.filter((f) => f.rule === '1');
  assert.strictEqual(r1.length, preflight.REQUIRED_SECTIONS.length - 1);
  assert.ok(r1.every((f) => f.severity === 'BLOCK'));
});

test('rule 2 blocks when the Status line is missing', () => {
  const p = writePlan('nostatus.md', CLEAN_PLAN.replace('**Status:** draft\n', ''));
  const rep = preflight.run(p, {});
  assert.ok(rep.findings.some((f) => f.rule === '2' && f.severity === 'BLOCK'));
});

test('rule 3 blocks non-ASCII inside code but only warns in prose', () => {
  const p = writePlan('ascii.md', CLEAN_PLAN
    .replace('- [ ] 5. Use `ds-card`', '- [ ] 5. Create `js/reportsé.js`. Use `ds-card`'));
  const rep = preflight.run(p, {});
  assert.ok(rep.findings.some((f) => f.rule === '3' && f.severity === 'BLOCK'));

  // An em dash in prose is how the whole repo writes; it must not be a finding.
  const p2 = writePlan('emdash.md', CLEAN_PLAN.replace('Add a reports view under area-a.', 'Add a reports view — under area-a.'));
  const rep2 = preflight.run(p2, {});
  assert.strictEqual(rep2.findings.filter((f) => f.rule === '3').length, 0);
});

test('rule 3 lets diacritics through in prose, even next to inline code', () => {
  // Plans may quote copy with accented letters (names, places), so prose allows them.
  const p = writePlan('polish-prose.md', CLEAN_PLAN
    .replace('Add a reports view under area-a.', 'Add a reports view under area-a. The button reads "Café crème, déjà vu".'));
  assert.strictEqual(preflight.run(p, {}).findings.filter((f) => f.rule === '3').length, 0);

  // Inline code on the same line must not drag the prose into a BLOCK.
  const p2 = writePlan('polish-mixed.md', CLEAN_PLAN
    .replace('- [ ] 5. Use `ds-card`', '- [ ] 5. The `ds-card` label reads "Détails à venir". Use `ds-card`'));
  assert.strictEqual(preflight.run(p2, {}).findings.filter((f) => f.rule === '3').length, 0);

  // An accented letter INSIDE the backticks is a proposed identifier - still a BLOCK.
  const p3 = writePlan('polish-ident.md', CLEAN_PLAN
    .replace('- [ ] 5. Use `ds-card`', '- [ ] 5. Use `ds-carté`'));
  assert.ok(preflight.run(p3, {}).findings.some((f) => f.rule === '3' && f.severity === 'BLOCK'));
});

test('legacy Polish plans: jargon and the business labels survive diacritics', () => {
  // Plans written before the English release use Polish labels with
  // diacritics; the ASCII keyword list must still hit after folding.
  assert.ok(preflight.jargonHit('Dodajemy nowy moduł do panelu'));
  assert.ok(preflight.jargonHit('Zaślepka na czas wdrozenia'));
  assert.strictEqual(preflight.jargonHit('Handlowiec zobaczy raport sprzedaży w jednym miejscu'), null);

  // Rule 20 finds the four blocks whether or not they carry diacritics.
  const withDiacritics = CLEAN_PLAN
    .replace('## Business description', '## Opis biznesowy')
    .replace('Why we are doing this', 'Po co to robimy')
    .replace('What changes for the user', 'Co się zmieni dla użytkownika')
    .replace('What the user will see after release', 'Co użytkownik zobaczy po wdrożeniu')
    .replace('What this does NOT change', 'Czego to NIE zmienia');
  const p = writePlan('biz-polish.md', withDiacritics);
  assert.strictEqual(preflight.run(p, {}).findings.filter((f) => f.rule === '20').length, 0);
});

test('rule 4 blocks a hex color but not an issue reference', () => {
  const p = writePlan('hex.md', CLEAN_PLAN.replace('## Out of scope', 'Use #ff8800 for the badge.\n\n## Out of scope'));
  const rep = preflight.run(p, {});
  assert.ok(rep.findings.some((f) => f.rule === '4' && f.severity === 'BLOCK'));

  const p2 = writePlan('issue.md', CLEAN_PLAN.replace('## Out of scope', 'Follows up on #123.\n\n## Out of scope'));
  assert.strictEqual(preflight.run(p2, {}).findings.filter((f) => f.rule === '4').length, 0);
});

test('rule 5 blocks a plan with zero acceptance criteria', () => {
  const p = writePlan('noac.md', CLEAN_PLAN.replace(/- \[ \] AC\d:[^\n]*\n/g, ''));
  const rep = preflight.run(p, {});
  assert.ok(rep.findings.some((f) => f.rule === '5' && f.severity === 'BLOCK'));
});

test('rule 6 blocks a view plan that forgets one leg of the triple', () => {
  const p = writePlan('triple.md', CLEAN_PLAN.replace(
    '- [ ] 4. Add the page entry to the hub row in `js/core-hubs.mjs`.\n', ''));
  const rep = preflight.run(p, {});
  const f = rep.findings.find((x) => x.rule === '6');
  assert.ok(f && f.severity === 'BLOCK');
  // Hubs are core property now, so the leg the plan forgot is the `pages`
  // entry in the declaration - not an item in the built flyout map.
  assert.match(f.message, /core-hubs/);
});

// A module plan is the opposite shape of a view plan: the core gets NO
// index.html section, NO VIEW_REGISTRY entry and NO HUB_FLYOUT entry, because
// js/module-host.js builds all three from module.json at boot.
const MODULE_PLAN = CLEAN_PLAN
  .replace('- \`js/reports.js\` - the view module',
    '- \`modules/reports/module.json\` - manifest\n- \`modules/reports/client/index.js\` - client entry')
  .replace('- [ ] 1. Add the \`view-section\` to \`index.html\`.',
    '- [ ] 1. Scaffold with \`node scripts/new-module.js reports "Reports" --area "Product"\`.')
  .replace('- [ ] 2. Create \`js/reports.js\` with the render and init functions.',
    '- [ ] 2. Fill in \`modules/reports/client/index.js\` with the render and init functions.')
  .replace('- [ ] 3. Add the \`VIEW_REGISTRY\` entry in \`js/view-registry.js\`.',
    '- [ ] 3. Fill in \`modules/reports/module.json\` with the views entry.')
  .replace('- [ ] 4. Add the page entry to the hub row in \`js/core-hubs.mjs\`.',
    '- [ ] 4. Add a contract test under \`modules/reports/tests/\`.');

test('rule 6 accepts a module plan that never touches the core registries', () => {
  const p = writePlan('module-ok.md', MODULE_PLAN);
  const rep = preflight.run(p, {});
  assert.deepStrictEqual(rep.findings.filter((f) => f.rule === '6'), [],
    'a correct module plan must not be asked for the view triple');
});

test('rule 6 blocks a module plan that edits VIEW_REGISTRY in the core', () => {
  const p = writePlan('module-core.md', MODULE_PLAN.replace(
    '- [ ] 4. Add a contract test under \`modules/reports/tests/\`.',
    '- [ ] 4. Add the \`VIEW_REGISTRY\` entry in \`js/view-registry.js\`.'));
  const rep = preflight.run(p, {});
  const f = rep.findings.find((x) => x.rule === '6');
  assert.ok(f && f.severity === 'BLOCK');
  assert.match(f.message, /VIEW_REGISTRY|HUB_FLYOUT/);
});

test('rule 6 blocks a module plan with no manifest step', () => {
  const p = writePlan('module-nomanifest.md', MODULE_PLAN
    .replace('- [ ] 1. Scaffold with \`node scripts/new-module.js reports "Reports" --area "Product"\`.',
      '- [ ] 1. Create the module directory by hand.')
    .replace('- [ ] 3. Fill in \`modules/reports/module.json\` with the views entry.',
      '- [ ] 3. Write the client code.'));
  const rep = preflight.run(p, {});
  const f = rep.findings.find((x) => x.rule === '6');
  assert.ok(f && f.severity === 'BLOCK');
  assert.match(f.message, /module\.json/);
});

// Regression: `tests/fixtures/modules/fixture-mod/` inside a KERNEL plan once
// read as "this plan adds a module", which blocked correct kernel work.
test('rule 6 does not read a nested fixtures path as a module plan', () => {
  const p = writePlan('kernel.md', CLEAN_PLAN.replace(
    '- \`js/reports.js\` - the view module',
    '- \`js/reports.js\` - the view module\n- \`tests/fixtures/modules/fixture-mod/module.json\` - test fixture'));
  const rep = preflight.run(p, {});
  assert.deepStrictEqual(rep.findings.filter((f) => f.rule === '6'), [],
    'a kernel plan carrying a module fixture is still a view plan, and this one is complete');
});

test('rule 21 warns on a module plan that names no core hub and no reason', () => {
  const p = writePlan('module-nohub.md', MODULE_PLAN);
  const rep = preflight.run(p, {});
  const f = rep.findings.find((x) => x.rule === '21');
  assert.ok(f && f.severity === 'WARN', 'a module with no --hub is a rail item by accident');
  assert.match(f.fix, /--hub/);
});

test('rule 21 is silent when the scaffold step carries --hub', () => {
  const p = writePlan('module-hub.md', MODULE_PLAN.replace(
    'node scripts/new-module.js reports "Reports" --area "Product"',
    'node scripts/new-module.js reports "Reports" --area "Product" --hub knowledge'));
  const rep = preflight.run(p, {});
  assert.deepStrictEqual(rep.findings.filter((f) => f.rule === '21'), []);
});

test('rule 22 warns on a module plan that never names --area', () => {
  const p = writePlan('module-noarea.md', MODULE_PLAN.replace(
    'node scripts/new-module.js reports "Reports" --area "Product"',
    'node scripts/new-module.js reports "Reports"'));
  const rep = preflight.run(p, {});
  const f = rep.findings.find((x) => x.rule === '22');
  assert.ok(f && f.severity === 'WARN', 'a scaffold step with no --area should warn');
  assert.match(f.fix, /--area/);
});

test('rule 22 is silent when the scaffold step carries --area', () => {
  const p = writePlan('module-area.md', MODULE_PLAN);
  const rep = preflight.run(p, {});
  assert.deepStrictEqual(rep.findings.filter((f) => f.rule === '22'), []);
});

test('rule 22 checks EACH scaffold invocation, not just any mention of area anywhere', () => {
  // Two real scaffold commands, only the second missing --area, plus an
  // unrelated prose mention of "area" (the JSON field, not the flag) on a
  // third line - that mention must not mask the missing --area on step 2.
  const p = writePlan('module-twocalls.md', MODULE_PLAN
    .replace(
      '- [ ] 2. Fill in \`modules/reports/client/index.js\` with the render and init functions.',
      '- [ ] 2. Also scaffold a companion module with \`node scripts/new-module.js reports-second "Reports Second"\`.')
    .replace(
      '- [ ] 3. Fill in \`modules/reports/module.json\` with the views entry.',
      '- [ ] 3. Set the `area` field in `modules/reports/module.json` to match the business area discussed above.'));
  const rep = preflight.run(p, {});
  const findings = rep.findings.filter((f) => f.rule === '22');
  assert.strictEqual(findings.length, 1, 'exactly the second, --area-less invocation should warn');
  assert.match(findings[0].fix, /--area/);
  // The line reported is the actual offending step, not the section start.
  const offendingLine = p ? fs.readFileSync(p, 'utf8').split('\n')[findings[0].line - 1] : '';
  assert.match(offendingLine, /reports-second/);
});

test('rule 21 accepts an own rail entry when ## Context says why', () => {
  const p = writePlan('module-item.md', MODULE_PLAN
    .replace('- The repo already has the area-a hub.',
      '- The repo already has the area-a hub.\n- The module gets `"kind": "item"`: a rail entry of its own, because no hub covers reports and the team asked for one click from the rail.'));
  const rep = preflight.run(p, {});
  assert.deepStrictEqual(rep.findings.filter((f) => f.rule === '21'), []);
});

test('rule 9 blocks any perspective reference', () => {
  const p = writePlan('persp.md', CLEAN_PLAN.replace('## Out of scope', 'Add a data-perspective attribute.\n\n## Out of scope'));
  assert.ok(preflight.run(p, {}).findings.some((x) => x.rule === '9' && x.severity === 'BLOCK'));
});

test('rules 10 and 11 fire together on an unlocked, untested write route', () => {
  const p = writePlan('route.md', CLEAN_PLAN
    .replace('- [ ] 5. Use `ds-card` and `ds-btn` classes for every element.',
      '- [ ] 5. Add `POST /api/reports/save` to `server.js`.'));
  const rep = preflight.run(p, {});
  assert.ok(rep.findings.some((x) => x.rule === '10' && x.severity === 'BLOCK'), 'expected the lock rule');
  assert.ok(rep.findings.some((x) => x.rule === '11' && x.severity === 'BLOCK'), 'expected the test rule');
});

test('rule 12 blocks res.end(JSON.stringify(...))', () => {
  const p = writePlan('json.md', CLEAN_PLAN.replace('## Out of scope',
    'Return with res.end(JSON.stringify({ ok: true })).\n\n## Out of scope'));
  assert.ok(preflight.run(p, {}).findings.some((x) => x.rule === '12' && x.severity === 'BLOCK'));
});

test('rule 14 blocks a forbidden operation but not a "never do X" note', () => {
  const p = writePlan('forbidden.md', CLEAN_PLAN.replace('## Out of scope',
    'Run git reset --hard before starting.\n\n## Out of scope'));
  assert.ok(preflight.run(p, {}).findings.some((x) => x.rule === '14' && x.severity === 'BLOCK'));

  const p2 = writePlan('negated.md', CLEAN_PLAN.replace('## Out of scope',
    'Never run `npm start` from an agent.\n\n## Out of scope'));
  assert.strictEqual(preflight.run(p2, {}).findings.filter((x) => x.rule === '14').length, 0);
});

test('rule 16 warns on a port literal other than 3001', () => {
  const p = writePlan('port.md', CLEAN_PLAN.replace('## Out of scope', 'Open http://localhost:8080/api.\n\n## Out of scope'));
  const rep = preflight.run(p, {});
  assert.ok(rep.findings.some((x) => x.rule === '16' && x.severity === 'WARN'));

  const p2 = writePlan('port-ok.md', CLEAN_PLAN.replace('## Out of scope', 'Open http://localhost:3001/api.\n\n## Out of scope'));
  assert.strictEqual(preflight.run(p2, {}).findings.filter((x) => x.rule === '16').length, 0);
});

test('rule 18 blocks a plan without ## Business description and one with placeholders', () => {
  const noBiz = CLEAN_PLAN.replace(/## Business description[\s\S]*?(?=## Idea)/, '');
  const p = writePlan('nobiz.md', noBiz);
  assert.ok(preflight.run(p, {}).findings.some((x) => x.rule === '18' && x.severity === 'BLOCK'));

  const p2 = writePlan('bizph.md', CLEAN_PLAN.replace('The content of the reports stays the same.', '{{one line}}'));
  assert.ok(preflight.run(p2, {}).findings.some((x) => x.rule === '18' && x.severity === 'BLOCK'));

  assert.strictEqual(preflight.run(writePlan('bizok.md', CLEAN_PLAN), {}).findings.filter((x) => x.rule === '18' || x.rule === '19' || x.rule === '20').length, 0);
});

test('rule 19 blocks technical language in ## Business description but not elsewhere', () => {
  const cases = [
    'We add the assets hub to the sidebar.',
    'Icons are read from JSON files.',
    'A new endpoint returns the data.',
    'An entry in `js/view-registry.js` adds the view.',
    'The view lives at #view-reports.',
    'The card uses the ds-card class.',
    'A change in server.js:120.',
  ];
  for (const c of cases) {
    const p = writePlan('jargon.md', CLEAN_PLAN.replace('The content of the reports stays the same.', c));
    const hits = preflight.run(p, {}).findings.filter((x) => x.rule === '19');
    assert.ok(hits.length > 0 && hits[0].severity === 'BLOCK', 'expected rule 19 BLOCK for: ' + c);
  }
  // the same jargon in ## Idea is fine - that section is technical by design
  const p = writePlan('jargon-idea.md', CLEAN_PLAN.replace('Add a reports view under area-a.', 'Add a hub with a flyout and a JSON endpoint in server.js.'));
  assert.strictEqual(preflight.run(p, {}).findings.filter((x) => x.rule === '19').length, 0);
  // an HTML comment inside the section is guidance, not content
  const p2 = writePlan('jargon-comment.md', CLEAN_PLAN.replace('## Business description', '## Business description\n\n<!-- zero js/ paths, zero JSON, zero endpoints -->'));
  assert.strictEqual(preflight.run(p2, {}).findings.filter((x) => x.rule === '19').length, 0);
});

test('rule 20 warns on a missing label and on an item count outside 3-5', () => {
  const p = writePlan('biz-label.md', CLEAN_PLAN.replace('**What this does NOT change:**', '**Notes:**'));
  assert.ok(preflight.run(p, {}).findings.some((x) => x.rule === '20' && x.severity === 'WARN'));

  const p2 = writePlan('biz-count.md', CLEAN_PLAN.replace('2. Reports live in one place, no hunting through files.\n3. Every report opens with one click.\n', ''));
  assert.ok(preflight.run(p2, {}).findings.some((x) => x.rule === '20' && /numbered item/.test(x.message)));
});

test('jargonHit reads plain business English as clean', () => {
  assert.strictEqual(preflight.jargonHit('An Assets entry with an icon search appears in the left menu.'), null);
  assert.strictEqual(preflight.jargonHit('The Settings section stays unchanged.'), null);
  assert.strictEqual(preflight.jargonHit('Data stays up to date on its own.'), null);
  assert.strictEqual(preflight.jargonHit('Assets hub in the sidebar.'), 'hub');
});

test('parseSections and groupSteps read the plan structure', () => {
  const lines = CLEAN_PLAN.split('\n');
  const sections = preflight.parseSections(lines);
  assert.ok(sections.steps, 'Steps section parsed');
  assert.ok(sections.acceptancecriteria, 'Acceptance criteria section parsed');
  assert.strictEqual(preflight.groupSteps(sections.steps).length, 5);
});

test('the shipped plan template passes its own preflight', () => {
  const tpl = path.join(ROOT, '.claude', 'skills', 'new-idea', 'templates', 'plan.md');
  if (!fs.existsSync(tpl)) return;
  const rep = preflight.run(tpl, {});
  assert.strictEqual(rep.counts().BLOCK, 0, 'the template must never block: ' + JSON.stringify(rep.sorted()));
});
