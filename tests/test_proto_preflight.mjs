import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { run, loadImportAllowlist, importSpecs } = createRequire(import.meta.url)('../scripts/proto-preflight.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-preflight-'));
// P7 reads <protoRoot>/<id>/index.tsx; tests never read the real data repo.
const protoRoot = path.join(temp, 'prototypes');
fs.mkdirSync(protoRoot);
let count = 0;
const base = `# Prototype
**Prototype id:** example
**Prototype format:** react
**Prototype mode:** spec-driven
## Files to change
- \`data-sub-repositories/ds-data/prototypes/example/index.tsx\`
## New files
- \`data-sub-repositories/ds-data/prototypes/example/spec.json\`
## Steps
1. Implement index.tsx and spec.json using ../../ds, demoStates, useDemoState, breakpoints and @container proto.
## Test plan
- [ ] node scripts/check-proto-ds.js data-sub-repositories/ds-data/prototypes/example
## Visual verification (Playwright)
Measure canvas widths and verify each implemented scenario.
`;
function findings(text, flags = {}) {
  const file = path.join(temp, `${count++}.md`);
  fs.writeFileSync(file, text);
  return run(file, { protoRoot, ...flags }).findings.filter((f) => /^P\d+$/.test(f.rule));
}
// Append one line to `## Steps` of the canonical plan.
const withStep = (line) => base.replace('## Test plan', line + '\n## Test plan');
const has = (list, rule, severity) => list.some((f) => f.rule === rule && f.severity === severity);
const none = (list, rule) => !list.some((f) => f.rule === rule);

test('canonical React plan satisfies prototype-specific rules', () => {
  assert.deepEqual(findings(base), []);
});
test('file boundary checks all paths and rejects normalized escapes and alternate registry suffixes', () => {
  for (const p of [
    'data-sub-repositories/ds-data/other/example/index.tsx',
    'data-sub-repositories/ds-data/prototypes/example/../../ds/button.tsx',
    'data-sub-repositories/ds-data/prototypes/prototypes.json.bak',
    'server.js',
  ]) {
    assert.ok(findings(base.replace('## New files', `- \`${p}\`\n## New files`)).some((f) => f.rule === 'P1'), p);
  }
});
test('React plan requires states, DS adapters, named containers and linter gate', () => {
  for (const marker of ['demoStates', 'useDemoState', 'breakpoints', '../../ds', '@container proto']) {
    assert.ok(findings(base.replace(marker, 'omitted')).some((f) => f.rule === 'P7'), marker);
  }
  assert.ok(findings(base.replace('node scripts/check-proto-ds.js', 'manual only')).some((f) => f.rule === 'P6' && f.severity === 'BLOCK'));
  assert.ok(findings(base + '\nUse @media (min-width: 960px).\n').some((f) => f.rule === 'P5' && f.severity === 'BLOCK'));
});
test('existing vanilla plan is an explicit compatibility exception', () => {
  const legacy = base.replace('format:** react', 'format:** vanilla')
    .replaceAll('ds-data', 'ds-data').replaceAll('index.tsx', 'render.js')
    .replace('demoStates, useDemoState, breakpoints and @container proto', 'legacy mobile-first layout');
  assert.deepEqual(findings(legacy), []);
});

// -- R-12: P7 demo states, new vs existing prototype -------------------------
test('P7 demoStates: BLOCK for a new prototype, WARN for an existing one without demoStates', () => {
  const noStates = base.replace('demoStates, useDemoState, ', '');
  // No index.tsx on disk -> new prototype.
  assert.ok(has(findings(noStates), 'P7', 'BLOCK'));
  // The staged starter already exports demoStates -> still BLOCK.
  fs.mkdirSync(path.join(protoRoot, 'example'), { recursive: true });
  fs.writeFileSync(path.join(protoRoot, 'example', 'index.tsx'), 'export const demoStates = [];\nexport default function X() { return null; }\n');
  assert.ok(has(findings(noStates), 'P7', 'BLOCK'));
  // Existing index.tsx with no demoStates -> migrate on next touch.
  fs.writeFileSync(path.join(protoRoot, 'example', 'index.tsx'), 'export default function X() { return null; }\n');
  const legacy = findings(noStates).filter((f) => f.rule === 'P7');
  assert.equal(legacy.length, 2);
  assert.ok(legacy.every((f) => f.severity === 'WARN' && /migrate on next touch/.test(f.fix)));
  // The other P7 markers stay BLOCK even there.
  assert.ok(has(findings(noStates.replace('breakpoints', 'widths')), 'P7', 'BLOCK'));
  assert.deepEqual(findings(base), []);
  fs.rmSync(path.join(protoRoot, 'example'), { recursive: true, force: true });
});

// -- R-03: P4 the import allowlist ---------------------------------------------
test('P4 blocks a non-allowlisted React import, a design-system package included', () => {
  assert.ok(has(findings(withStep("2. Add `import { Button } from '@acme/ui'` to index.tsx.")), 'P4', 'BLOCK'));
  assert.ok(has(findings(withStep("2. Add `import { Tokens } from '@acme/ui/tokens'`.")), 'P4', 'BLOCK'));
  assert.ok(has(findings(withStep("2. Add `import dayjs from 'dayjs'` for dates.")), 'P4', 'BLOCK'));
  assert.ok(has(findings(withStep("2. Add `import { Foo } from './Foo'` to index.tsx.")), 'P4', 'BLOCK'));
  assert.ok(has(findings(withStep('```tsx\nimport { chunk } from "lodash";\n```')), 'P4', 'BLOCK'));
  const clean = withStep([
    "2. `import { DSButton } from '../../ds'`, `import { MobileShell } from '../../components'`,",
    "   `import { useDemoState } from '../_shared/demo-state'`, `import './styles.css'`,",
    "   `import data from './data.json'`, `import { useState } from 'react'`.",
    '3. The adapters wrap `@acme/ui` - never import from `@acme/ui` in index.tsx.',
  ].join('\n'));
  assert.ok(none(findings(clean), 'P4'), JSON.stringify(findings(clean)));
});
test('P4: a line describing the shell own imports (main.tsx / shell) is not a prototype import', () => {
  assert.ok(none(findings(withStep("2. The shell's `src/main.tsx` does `import '@acme/ui/light.css'` first; nothing to change.")), 'P4'));
  assert.ok(none(findings(withStep("2. Context: the build shell imports `import { createRoot } from 'react-dom/client'`.")), 'P4'));
  // The same import named for index.tsx is still a proposal.
  assert.ok(has(findings(withStep("2. Mirror main.tsx: add `import '@acme/ui/light.css'` to index.tsx.")), 'P4', 'BLOCK'));
  assert.ok(has(findings(withStep("2. Add `import { Button } from '@acme/ui'` to the list screen.")), 'P4', 'BLOCK'));
});
test('P4 allowlist comes from scripts/_proto-imports.js alone and accepts the pipeline set', () => {
  const allow = loadImportAllowlist();
  assert.equal(typeof allow.isAllowed, 'function');
  assert.equal(allow.source, '_proto-imports', 'no built-in fallback list may exist next to the shared module');
  // The shared module is stricter than the removed fallback: only ./styles.css.
  assert.ok(!allow.isAllowed('./other.css'));
  for (const spec of ['react', 'react/jsx-runtime', './styles.css', './assets/a.png', '../_shared/x.css', '../../ds', '../../components/MobileShell', '@bryntum/scheduler']) {
    assert.ok(allow.isAllowed(spec), spec);
  }
  for (const spec of ['@acme/ui', 'lodash', './Foo', '../../ds/../../server', '@bryntum/gantt']) {
    assert.ok(!allow.isAllowed(spec), spec);
  }
  // A backticked citation after `import (` is prose, not a dynamic import.
  assert.ok(none(findings(withStep('2. Extend the existing `../../ds` barrel import (`index.tsx:8-21`).')), 'P4'));
  assert.deepEqual(importSpecs("x `import a from 'b'` and import('c') and import \"d\""), ['b', 'c', 'd']);
});

// -- R-21: P8-P17 ------------------------------------------------------------
test('P8 (5a): transform on an overlay ancestor warns, a plan without overlays is clean', () => {
  const overlay = withStep('2. Open DSBottomSheet from the list.\n3. `.example-panel { transform: translateY(8px); }`');
  // WARN, never BLOCK: a transform on a card INSIDE the modal is a known false
  // alarm the regex cannot tell apart, and the message says it may be ignored.
  const p8 = findings(overlay).filter((f) => f.rule === 'P8');
  assert.ok(p8.length === 1 && p8[0].severity === 'WARN', JSON.stringify(p8));
  assert.match(p8[0].message, /ignore this when the element sits INSIDE the overlay/);
  assert.ok(has(findings(withStep('2. Open DSModal.\n3. `.example-root { will-change: transform; }`')), 'P8', 'WARN'));
  assert.ok(none(findings(withStep('2. Open DSModal.\n3. `.example-modal-card { transform: scale(1.02); }` on hover.')).filter((f) => f.severity === 'BLOCK'), 'P8'));
  assert.ok(none(findings(withStep('2. `.example-card { transform: scale(1.02); }` on hover.')), 'P8'));
  assert.ok(none(findings(withStep('2. Open DSModal.\n3. `.example-panel { transform: none; }`')), 'P8'));
  assert.ok(none(findings(withStep('2. Open DSModal.\n3. `.example-label { text-transform: uppercase; }`')), 'P8'));
});
test('P9 (6b): catalog-absence claim warns without ls/grep, clean with evidence', () => {
  const claim = withStep('2. Brak ikony pucharu w katalogu, rysujemy własną.');
  assert.ok(has(findings(claim), 'P9', 'WARN'));
  assert.ok(has(findings(withStep('2. The trophy icon is missing from the DS catalog.')), 'P9', 'WARN'));
  const proven = claim + '\n`grep -c trophy assets/icons/ds/manifest.json` returns 0.\n';
  assert.ok(none(findings(proven), 'P9'));
  assert.ok(none(findings(base), 'P9'));
});
test('P10 (8): invented min/max dimension warns, cited value and container query are clean', () => {
  assert.ok(has(findings(withStep('2. `.example-empty { min-height: 500px; }`')), 'P10', 'WARN'));
  assert.ok(none(findings(withStep('2. `.example-empty { max-width: 432px; }` from layout tree `V 432x328`.')), 'P10'));
  assert.ok(none(findings(withStep('2. Two columns at `@container proto (min-width: 960px)`.')), 'P10'));
  // A negation silences only its own clause: the rule, not the whole line.
  assert.ok(none(findings(withStep('2. Nie dodawaj `min-height: 500px` do pustego stanu.')), 'P10'));
  assert.ok(none(findings(withStep('2. Never add `max-width: 600px` to the card.')), 'P10'));
  for (const line of [
    '2. Nie dodawaj sztywnej wysokości; `.example-empty { min-height: 500px }`.',
    '2. Nie dodawaj cienia, `.example-card { max-width: 600px }`.',
    '2. Żadnego cienia i `.example-card { min-width: 320px }` na karcie.',
    '2. Never guess a width; use `max-height: 480px` on the list.',
  ]) {
    assert.ok(has(findings(withStep(line)), 'P10', 'WARN'), line);
  }
});
test('P11 (9): new desktop screen without scroll reset warns, with scrollTop is clean', () => {
  const desk = withStep('2. Add `DeskStoreDetailScreen` and route to it from the list.');
  assert.ok(has(findings(desk), 'P11', 'WARN'));
  assert.ok(has(findings(withStep("2. Add `case 'store':` to the screen switch in DeskNarzedziownik.")), 'P11', 'WARN'));
  assert.ok(none(findings(desk.replace('from the list.', 'from the list; reset `scrollTop = 0` on the scroll container.')), 'P11'));
  assert.ok(none(findings(withStep("2. Add `case 'empty':` in the reset effect of useDemoState for the new screen.")), 'P11'));
});
test('P12 (10): svg selector tint and hand-rolled mask block, wrapper color is clean', () => {
  assert.ok(has(findings(withStep('2. `.example-badge svg { fill: var(--body-primary-fg); }`')), 'P12', 'BLOCK'));
  assert.ok(has(findings(withStep('```css\n.example-badge svg {\n  color: var(--body-primary-fg);\n}\n```')), 'P12', 'BLOCK'));
  assert.ok(has(findings(withStep('2. `.example-ico { mask-image: url(./assets/i.svg); }`')), 'P12', 'BLOCK'));
  assert.ok(has(findings(withStep('2. `.example-ico { filter: invert(1); }`')), 'P12', 'BLOCK'));
  const maskUrl = findings(withStep("2. `.example-ico { background-color: currentColor; mask: url('/ds-icons/16-ic-clock.svg'); }`")).filter((f) => f.rule === 'P12');
  assert.ok(maskUrl.length === 1 && /mask/.test(maskUrl[0].message), JSON.stringify(maskUrl));
  assert.ok(none(findings(withStep('2. `.example-badge { color: var(--body-primary-fg); }` on the wrapper, not on the svg.')), 'P12'));
  assert.ok(none(findings(withStep('2. Tint przez `color:` na wrapperze; żadnego selektora `svg`, żadnego `mask`.')), 'P12'));
});
test('P13 (12): form control without :focus/:hover warns, with states is clean', () => {
  const ctl = withStep('2. Restyle the search `DSInput` in the header.');
  assert.ok(has(findings(ctl), 'P13', 'WARN'));
  assert.ok(has(findings(withStep('2. Add a comment textarea under the card.')), 'P13', 'WARN'));
  assert.ok(none(findings(ctl.replace('header.', 'header with `:focus` and `:hover` styles.')), 'P13'));
  assert.ok(none(findings(withStep('3. Handlers keep state; no remount that would drop focus mid-input.')), 'P13'));
});
test('P14 (13): --state-*-border warns, --form-primary-* is clean', () => {
  assert.ok(has(findings(withStep('2. Error border `border: 1px solid var(--state-danger-border)`.')), 'P14', 'WARN'));
  assert.ok(none(findings(withStep('2. Error border `var(--form-primary-danger-border)`.')), 'P14'));
});
test('P15 (14): custom element without DS* props citation warns, with path:line is clean', () => {
  const custom = withStep('2. Register `example-heatmap` in `spec.json` `customElements[]`.');
  assert.ok(has(findings(custom), 'P15', 'WARN'));
  const cited = custom + '\n   DSTable cannot colour cells: `data-sub-repositories/ds-data/ds/DSTable.tsx:42`.\n';
  assert.ok(none(findings(cited), 'P15'));
  const boiler = withStep('4. **DS.** Build from `../../ds` adapters; custom markup only where no catalog component covers it, registered in `spec.json` `customElements[]` with a `/* CUSTOM: <reason> */` marker in `styles.css`.');
  assert.ok(none(findings(boiler), 'P15'));
});
test('P16 (15b): helper source next to index.tsx blocks, index.tsx and _shared are clean', () => {
  const helper = base.replace('## Steps', '- `data-sub-repositories/ds-data/prototypes/example/ScreenX.tsx`\n## Steps');
  assert.ok(has(findings(helper), 'P16', 'BLOCK'));
  assert.ok(has(findings(withStep('2. Move the state helper to `./demo-state.ts`.')), 'P16', 'BLOCK'));
  assert.ok(none(findings(withStep('2. Read `useDemoState` from `../_shared/demo-state.ts`.')), 'P16'));
  assert.ok(none(findings(base), 'P16'));
  // A citation of the build shell satisfies P15 and must not trip P16.
  const shell = findings(withStep('2. Register `example-heatmap` in `customElements[]`; DSTable has no cell colour: `data-sub-repositories/data-prototypes/src/ds/DSTable.tsx:42`.'));
  assert.ok(none(shell, 'P16') && none(shell, 'P15'), JSON.stringify(shell));
  assert.ok(none(findings(withStep('2. Other prototype: `data-sub-repositories/ds-data/prototypes/other/Foo.tsx` is read only.')), 'P16'));
  const vanilla = helper.replace('format:** react', 'format:** vanilla');
  assert.ok(none(findings(vanilla), 'P16'));
});
test('P17 (15c): own switcher or replaceState warns, reading useDemoState is clean', () => {
  assert.ok(has(findings(withStep('2. Sync the state to the URL with `history.replaceState`.')), 'P17', 'WARN'));
  assert.ok(has(findings(withStep('2. Add a floating demo-state switcher in the corner.')), 'P17', 'WARN'));
  assert.ok(has(findings(withStep('2. Dodaj własny przełącznik stanów nad makietą.')), 'P17', 'WARN'));
  assert.ok(none(findings(withStep('2. The viewer owns the popover; the prototype reads through useDemoState.')), 'P17'));
  assert.ok(none(findings(withStep('2. Zero `history.replaceState`, zero własnego przełącznika.')), 'P17'));
});

// The plan template, filled with realistic values, trips none of the rules
// added for R-21/R-03: its boilerplate names customElements[], a `case`, an
// `@container (min-width)` and a DS package, and none of those is a proposal.
test('filled plan-prototype.md template trips no P4 or P8-P17 rule', () => {
  const tpl = fs.readFileSync(new URL('../.claude/skills/prototype/templates/plan-prototype.md', import.meta.url), 'utf8');
  const filled = tpl
    .replace(/\{\{#if [^}]+\}\}[\s\S]*?\{\{\/if\}\}/g, '')
    .replaceAll('{{proto-id}}', 'example')
    .replace('{{react | vanilla}}', 'react')
    .replace('{{requirements-driven | spec-driven}}', 'spec-driven')
    .replace('(min-width: ...)', '(min-width: 960px)')
    .replace("`case '<id>':`", "`case 'empty':`")
    .replace(/\{\{add the screen's JSX[^}]*\}\}/, 'add the list screen in index.tsx; the detail opens in a DSModal')
    .replace(/\{\{[^}]*\}\}/g, 'filled');
  const got = findings(filled).filter((f) => f.rule === 'P4' || Number(f.rule.slice(1)) >= 8);
  assert.deepEqual(got, []);
});
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
