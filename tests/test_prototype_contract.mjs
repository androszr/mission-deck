// tests/test_prototype_contract.mjs
// Contract checks for the process/agent/docs slice of
// docs/architecture/prototypes.md: the SKILL, the plan
// template, the five owned agents and the design-system docs must agree on
// one canonical path, one registry schema and one set of section names the
// skill cites by name in each agent file. This does not re-test
// scripts/check-proto-ds.js or scripts/proto-preflight.js (parent-owned,
// covered by tests/test_check_proto_ds.mjs) - it only proves the docs
// describe them accurately and consistently with each other.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const SKILL = 'skills/prototype/SKILL.md'.replace('skills', '.claude/skills');
const PLAN_TEMPLATE = '.claude/skills/prototype/templates/plan-prototype.md';
const AGENTS = {
  ideaPlanner: '.claude/agents/idea-planner.md',
  frontendImplementer: '.claude/agents/frontend-implementer.md',
  acVerifier: '.claude/agents/ac-verifier.md',
  playwrightSpecialist: '.claude/agents/playwright-specialist.md',
  protoDsGuardian: '.claude/agents/proto-ds-guardian.md',
};
const DOCS = {
  instructions: 'docs/guides/prototypes.md',
};

// Prototypes live in the team data repo (data-tier-0, plaintext ds-data/).
const CANONICAL_PATH = 'data-sub-repositories/ds-data/prototypes/';
// The path of the first release, which no file may cite any more.
const STALE_PATH = 'data-sub-repositories/ds-data-' + 'product/';

test('canonical prototype path is used everywhere it is cited; the old data-reports path appears nowhere', () => {
  const files = [SKILL, PLAN_TEMPLATE, ...Object.values(AGENTS), ...Object.values(DOCS)];
  for (const rel of files) {
    assert.ok(!read(rel).includes(STALE_PATH), rel + ' still cites ' + STALE_PATH);
  }
  // The skill and every owning agent must at least mention the real path once.
  for (const rel of [SKILL, AGENTS.protoDsGuardian, AGENTS.acVerifier, AGENTS.playwrightSpecialist]) {
    assert.ok(read(rel).includes(CANONICAL_PATH), rel + ' does not mention ' + CANONICAL_PATH);
  }
});

test('registry schema is described as {items: [...]}, not a bare array', () => {
  const skill = read(SKILL);
  assert.ok(/\{\s*items\s*:/.test(skill) || skill.includes('{ items:') || skill.includes('items:'),
    'SKILL.md does not describe the {items:[...]} registry shape');
  assert.ok(!/prototypes\.json.{0,40}^\s*\[/m.test(skill),
    'SKILL.md must not describe prototypes.json as a bare top-level array');
});

test('starter token {{PROTO_NAME_JSON}} exists in the parent-owned starter template', () => {
  // templates/prototype/starter/ is backend-implementer's, read here only as evidence that the
  // token this skill's Phase 1 relies on (POST /api/prototypes substitutes it server-side) is
  // actually present - a stale placeholder name here would silently break every new prototype.
  const starterIndex = read('templates/prototype/starter/index.tsx');
  assert.ok(
    starterIndex.includes('{{PROTO_NAME_JSON}}'),
    'templates/prototype/starter/index.tsx no longer contains the {{PROTO_NAME_JSON}} token'
  );
  const skill = read(SKILL);
  assert.ok(
    /React starter/.test(skill) && /POST \/api\/prototypes/.test(skill),
    'SKILL.md does not describe POST /api/prototypes producing the React starter'
  );
});

test('P1-P7 preflight rules are described consistently with scripts/proto-preflight.js', () => {
  // scripts/proto-preflight.js itself is parent-owned and covered by the parent's own
  // tests/test_proto_preflight.mjs - this only proves our prose describes its real behaviour:
  // default format is react, the legacy ds-data root is a vanilla-only exception, and P7's
  // markers match the actual stepsText.includes(...) checks in the script.
  const skill = read(SKILL);
  assert.ok(
    /default.{0,20}react|react.{0,20}default/i.test(skill),
    'SKILL.md does not state that prototype format defaults to react'
  );
  assert.ok(
    /vanilla/i.test(skill) && STALE_PATH.split('/')[0] && skill.includes('ds-data/prototypes/'),
    'SKILL.md does not describe the legacy ds-data root as the vanilla-only exception'
  );
  for (const marker of ['index.tsx', 'demoStates', 'useDemoState', 'breakpoints', '../../ds', '@container proto']) {
    assert.ok(skill.includes(marker), 'SKILL.md P7 description is missing "' + marker + '"');
  }
});

test('React contract needs no index.html/render.js; only legacy vanilla does', () => {
  const skill = read(SKILL);
  assert.ok(
    /never expects.{0,80}render\.js.{0,10}index\.html/is.test(skill),
    'SKILL.md does not state that a React prototype needs no index.html/render.js'
  );
  const guardian = read(AGENTS.protoDsGuardian);
  const reactSection = guardian.split('**Legacy vanilla')[0];
  assert.ok(
    /\*\*React \(`prototype_format: react`\)/.test(guardian),
    'proto-ds-guardian.md has no distinct React contract paragraph'
  );
  assert.ok(
    !/index\.html/.test(reactSection.slice(reactSection.indexOf('## Prototype contract'))),
    'proto-ds-guardian.md mentions index.html before the legacy-vanilla paragraph starts'
  );
});

test('SKILL.md cites a real, matching section name in each agent it delegates to', () => {
  const skill = read(SKILL);
  const sectionRefs = [...skill.matchAll(/["'`]([A-Z][A-Za-z ,/-]{2,60})["'`] section/g)].map(
    (m) => m[1]
  );
  assert.ok(sectionRefs.length > 0, 'SKILL.md does not name any agent section by quoted title');
  const combinedAgentText = Object.values(AGENTS).map(read).join('\n');
  for (const name of sectionRefs) {
    const heading = new RegExp('^#{1,3}\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm');
    assert.ok(
      heading.test(combinedAgentText),
      'SKILL.md cites section "' + name + '" but no agent file has that heading'
    );
  }
});

test('each owned agent has its prototype-specific section', () => {
  const expectations = [
    [AGENTS.ideaPlanner, /^#{1,3}\s+Prototype plans\s*$/m],
    [AGENTS.frontendImplementer, /^#{1,3}\s+Prototypes\s*$/m],
    [AGENTS.acVerifier, /^#{1,3}\s+Prototype criteria/m],
    [AGENTS.playwrightSpecialist, /^#{1,3}\s+Prototype target\s*$/m],
    [AGENTS.protoDsGuardian, /prototype_format/],
  ];
  for (const [rel, re] of expectations) {
    assert.ok(re.test(read(rel)), rel + ' is missing its expected prototype section/marker');
  }
});

test('React contract vocabulary (demoStates, breakpoints, ../../ds) is present where expected', () => {
  const skill = read(SKILL);
  for (const token of ['demoStates', 'useDemoState', 'breakpoints', '../../ds', '@container proto']) {
    assert.ok(skill.includes(token), 'SKILL.md does not mention "' + token + '"');
  }
  const guardian = read(AGENTS.protoDsGuardian);
  for (const token of ['demoStates', '../../ds', '@container proto']) {
    assert.ok(guardian.includes(token), 'proto-ds-guardian.md does not mention "' + token + '"');
  }
});

test('no core-slicing contradiction: the frontend-implementer prototype section allows a prototype_dir exception', () => {
  const text = read(AGENTS.frontendImplementer);
  assert.ok(
    /prototype_dir/.test(text) && /exception|instead of/i.test(text),
    'frontend-implementer.md does not document the prototype_dir slice exception'
  );
});

test('no restored compliance/lab-chat tab: docs do not claim a Compliance tab exists', () => {
  for (const rel of [SKILL, DOCS.instructions]) {
    const text = read(rel);
    assert.ok(
      !/restor\w*.{0,20}tab.{0,20}compliance/i.test(text),
      rel + ' appears to restore a removed compliance tab, which is out of scope'
    );
  }
});

test('screenshot rule is stated once, without contradicting the never-write-outside-user-data rule', () => {
  const skill = read(SKILL);
  assert.ok(skill.includes('user-data/screenshots'), 'SKILL.md does not mention user-data/screenshots');
  assert.ok(
    /copy/i.test(skill) && /assets/.test(skill),
    'SKILL.md does not describe copying a screenshot into the prototype assets dir'
  );
});

// The human-facing guide is the one file here that PEOPLE read on day one,
// and it rotted once: it kept a "Not there yet" table denying local
// preview and in-app publication for a whole stage after both had shipped
// (js/prototypy.js renders the buttons, server.js serves the routes). The
// guide's capability claims are therefore pinned to the code that backs
// them, in both directions - a button the guide never names is as bad as a
// feature the guide denies.
test('the guide names every detail-page action js/prototypy.js renders, and denies none of them', () => {
  const guide = read(DOCS.instructions);
  const view = read('js/prototypy.js');
  const server = read('server.js');

  const rendered = [
    ['data-proto-preview', 'Local preview', '/api/prototypes/local-preview/'],
    ['data-proto-deploy', 'Publish', '/api/prototypes/deploy-stream'],
    ['data-proto-copy-cmd', 'Starter prompt', 'handlePrototypeCreate'],
  ];
  for (const [hook, label, backend] of rendered) {
    assert.ok(view.includes(hook), 'js/prototypy.js no longer renders ' + hook + ' - update this table');
    assert.ok(server.includes(backend), 'server.js no longer carries ' + backend + ' - update this table');
    assert.ok(guide.includes(label), DOCS.instructions + ' does not name the "' + label + '" action the page renders');
  }

  // The denial shape the stale table used: a "What is not there" row for a
  // feature that exists. Match the row-start form only, so prose explaining
  // WHEN preview is unavailable (no token, no vendored DS) stays allowed.
  assert.ok(
    !/^\|\s*\*\*Prototype preview/mi.test(guide),
    DOCS.instructions + ' still lists local preview under features that do not exist'
  );
  assert.ok(
    !/^\|\s*\*\*Prototype publication/mi.test(guide),
    DOCS.instructions + ' still lists in-app publication under features that do not exist'
  );

  // What the guide says stays absent must really be absent: the compliance
  // tab (no route, no renderer) and hosting cleanup on DELETE (the handler
  // removes the registry entry and the source dir, never PROTO_BUILD_DIR).
  assert.ok(!/api\/prototypes\/compliance/.test(server), 'a compliance route came back - the guide promises there is none');
  const del = server.slice(server.indexOf('async function handlePrototypeDelete'));
  const delBody = del.slice(0, del.indexOf('\n}\n'));
  assert.ok(delBody.length > 0, 'handlePrototypeDelete not found');
  assert.ok(!delBody.includes('PROTO_BUILD_DIR'), 'DELETE now touches the build tree - the guide says the published version stays');
});


// The starter is the ONE baseline every new prototype starts from. This pins:
// the contract exports, no frame or design-system package, both substitution
// placeholders, one screen with its four data states, no literal colours and
// no @media in the CSS, no raw controls - and a clean run of the very gate a
// new prototype faces (`check-proto-ds`) on the substituted template.
test('the starter is one generic screen with demo states and passes check-proto-ds as substituted', () => {
  const tsx = read('templates/prototype/starter/index.tsx');
  const css = read('templates/prototype/starter/styles.css');
  assert.ok(/export default function \w+/.test(tsx), 'starter has no default export');
  assert.ok(/export const breakpoints\s*=\s*\[/.test(tsx), 'starter does not export breakpoints');
  assert.ok(/export const demoStates\b/.test(tsx) && /useDemoState\(/.test(tsx), 'starter does not export demoStates / use useDemoState');
  for (const banned of ['Frame', '../../ds', '../../components', 'amplitude', 'MobileShell', 'DesktopShell']) {
    assert.ok(!tsx.includes(banned), 'starter must not depend on ' + banned);
  }
  for (const token of ['{{PROTO_NAME_JSON}}', '{{PROTO_ID}}']) {
    assert.ok(tsx.includes(token), 'starter lost the placeholder ' + token);
  }
  for (const st of ['screen', 'screen-empty', 'screen-loading', 'screen-error']) {
    assert.ok(tsx.includes("id: '" + st + "'"), 'demoStates lacks ' + st);
  }
  assert.ok(!/<(button|input|select|textarea)\b/.test(tsx.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), 'starter uses a raw form control');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css) && !/rgba?\(/.test(css), 'starter CSS carries literal colours');
  assert.ok(!/@media\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'starter CSS uses @media instead of @container proto');
  assert.ok(/@container proto \(min-width: 960px\)/.test(css), 'starter CSS does not switch layouts with @container proto');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-contract-'));
  try {
    const dir = path.join(tmp, 'prototypes', 'proto-starter');
    fs.mkdirSync(dir, { recursive: true });
    const substituted = tsx.split('{{PROTO_NAME_JSON}}').join(JSON.stringify('New prototype "test"')).split('{{PROTO_ID}}').join('proto-starter');
    fs.writeFileSync(path.join(dir, 'index.tsx'), substituted);
    fs.writeFileSync(path.join(dir, 'styles.css'), css);
    fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify({ customElements: [] }));
    const linter = createRequire(import.meta.url)(path.join(ROOT, 'scripts', 'check-proto-ds.js'));
    const found = linter.run(dir, {}).findings.filter((f) => f.severity === 'BLOCK');
    assert.deepStrictEqual(found.map((f) => f.rule + ': ' + f.message), [], 'the substituted starter does not pass check-proto-ds');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
