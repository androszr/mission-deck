#!/usr/bin/env node
'use strict';
// scripts/proto-preflight.js
// Phase 4.5 of /prototype: the generic plan rules from plan-preflight.js plus
// the prototype-specific ones (P1-P17). One pass over the plan file.
// P8-P17 port the sf-test Phase 4.5 rules 5a, 6b, 8, 9, 10, 12, 13, 14, 15b
// and 15c (see RULES below); they read the plan text, never the prototype.
//
//   node scripts/proto-preflight.js plans/2026-09-05-proto-foo.md
//   node scripts/proto-preflight.js plans/2026-09-05-proto-foo.md --json
//
//
// Exit: 0 clean or warnings only, 1 at least one BLOCK, 2 usage error.

const R = require('./_report');
const generic = require('./plan-preflight');
const path = require('node:path');

const HELP = `
proto-preflight.js - deterministic Phase 4.5 preflight for a /prototype plan

Usage:
  node scripts/proto-preflight.js <plan-path> [--json] [--proto-root <dir>]

Options:
  --json          machine-readable envelope (verdict, counts, findings)
  --proto-root    directory holding <id>/index.tsx (default: the canonical
                  team data prototypes dir); P7 reads it to tell a NEW
                  prototype (BLOCK) from an existing one without demoStates (WARN)
  --help          this text

Runs every rule of plan-preflight.js plus P1-P17 documented in
.claude/skills/prototype/SKILL.md (Phase 4.5).
Exit codes: 0 clean/warn, 1 blocking findings, 2 usage or internal error.
`;

const PROTO_ROOT = 'data-sub-repositories/ds-data/prototypes/';
const LEGACY_ROOT = 'data-sub-repositories/ds-data/prototypes/';
// -- Import allowlist (R-03) -------------------------------------------------
// The one allowlist shared by server.js (_protoValidateTsx), the DS linter and
// this preflight lives in scripts/_proto-imports.js. The interface consumed
// here is `isAllowedProtoImport(spec) -> boolean`. There is no fallback copy:
// a second list is exactly the drift the shared module exists to prevent.
function loadImportAllowlist() {
  const { isAllowedProtoImport } = require('./_proto-imports');
  return { isAllowed: (spec) => Boolean(isAllowedProtoImport(spec)), source: '_proto-imports' };
}

// Import specifiers a plan line proposes: `import ... from '<spec>'`,
// `import('<spec>')` and bare `import '<spec>'`. Backticks count as quotes
// only after `from` - `import (\`index.tsx:8\`)` in prose is a citation.
const IMPORT_SPEC_RE = /\b(?:import|export)\b[^'"`\n]*?\bfrom\s*['"`]([^'"`\s]+)['"`]|\bimport\s*\(\s*['"]([^'"\s]+)['"]\s*\)|\bimport\s+['"]([^'"\s]+)['"]/g;

function importSpecs(text) {
  const out = [];
  for (const m of text.matchAll(IMPORT_SPEC_RE)) out.push(m[1] || m[2] || m[3]);
  return out;
}

// -- R-21 patterns (sf-test Phase 4.5 rules 5a, 6b, 8, 9, 10, 12-15c) --------
// Polish prose negations R.NEGATION_RE does not carry ("zadnego selektora
// svg", "zero history.replaceState", "nie buduj wlasnego przelacznika");
// matched against R.foldPolish(line).
const PL_NEGATION_RE = /\b(?:zadn\w*|zero|nie\s+(?:pisz|buduj|dodawaj|uzywaj|wysylaj|rob|tworz|stosuj)|martw\w*)\b/i;
const OVERLAY_RE = /\bDS(?:BottomSheet|Modal)\b/;
const TRANSFORM_RE = /(?<![\w-])transform\s*:\s*(?!none\b)\S|\btranslateZ\s*\(|\btranslate3d\s*\(|\bwill-change\s*:[^;\n]*\btransform/i;
// Matched against R.foldPolish(line), so the Polish phrases stay ASCII here.
const ABSENCE_CLAIM_RE = new RegExp([
  '\\bbrak(?:uje)?\\s+(?:takiej\\s+|tej\\s+|odpowiedniej\\s+)?(?:ikon[ya]?|komponent(?:u|ow)?)\\b',
  '\\bbrak\\s+w\\s+katalogu\\b',
  '\\bnie\\s+ma\\s+(?:takiej\\s+|tej\\s+|odpowiedniej\\s+)?(?:ikon[ya]?|komponent(?:u|ow)?|w\\s+katalogu)\\b',
  '\\b(?:absent|missing)\\s+from\\s+the\\s+(?:ds\\s+)?catalog\\b',
  '\\bnot\\s+(?:in|found\\s+in|available\\s+in)\\s+the\\s+(?:ds\\s+)?catalog\\b',
  '\\bno\\s+(?:matching\\s+|such\\s+)?(?:ds\\s+)?(?:icon|component)\\s+(?:exists\\s+)?in\\s+the\\s+(?:ds\\s+)?catalog\\b',
].join('|'), 'i');
const ABSENCE_EVIDENCE_RE = /\b(?:ls|grep|rg)\b[^\n]*(?:ds-icons|icons\/ds|manifest\.json|assets\/mascot|css\/ds|\/ds\/)/;
// A declaration, not a query: `(min-width: 960px)` inside @container is exempt.
const DIMENSION_RE = /(?<![(\w-])(?:min|max)-(?:width|height)\s*:\s*\d/i;
const LAYOUT_CITATION_RE = /\b[VH]\s+\d+\s*x\s*\d+\b|section-[\w-]+\.md|figma-reference\/|layout tree|\[inst\]/i;
const DESK_SCREEN_RE = /\bDesk[A-Z]\w*Screen\b|\bswitch\s*\(\s*\w*screen\w*\s*\)/i;
const CASE_RE = /\bcase\s+['"`][^'"`]+['"`]\s*:/;
const SCREEN_WORD_RE = /\bscreen\b|\bekran/i;
const DEMO_STATE_RE = /demoStates|useDemoState|demo[- ]state/i;
const SCROLL_RESET_RE = /scrollTop|\bscrollTo\b|scroll-to-top|scroll to top|scroll reset|reset(?:s|uje)?\s+(?:the\s+)?scroll|scrollIntoView|przewin/i;
const SVG_TINT_NEGATED_RE = /\bnot\s+(?:on\s+)?(?:the\s+|an?\s+)?`?svg|\bnie\s+na\s+`?svg/i;
// `svg` as a selector or element, never the `.svg` extension of a mask URL.
const SVG_SELECTOR_RE = /(?<![.\w-])svg\b/i;
const TINT_PROP_RE = /\b(?:color|fill|stroke)\s*:/i;
const HAND_MASK_RE = /(?:-webkit-)?\bmask(?:-image)?\s*:|\bfilter\s*:[^;\n]*\binvert\s*\(/i;
const FORM_CONTROL_RE = /<(?:input|textarea|select)\b|\bDS(?:Input|TextField|Textarea|TextArea|Select|Checkbox|Radio\w*|Search\w*|Switch|Toggle)\b|(?<![\w-])(?:textarea|checkbox|radio\s+button|input\s+field|text\s+field|pole\s+(?:tekstowe|formularza)|formularz\w*)\b/i;
const INTERACTIVE_STATE_RE = /:focus|:hover|focus-visible|focus-within|\bfocus\s+(?:state|ring|style)|\bhover\s+(?:state|style)|\bstan\w*\s+(?:focus|hover)|\bna\s+hover/i;
const STATE_BORDER_RE = /--state-[\w-]*-border\b/;
// The template's own step 4 names customElements[] as a rule, not a proposal.
const CUSTOM_BOILERPLATE_RE = /custom markup only where no catalog component covers it[^\n]*?marker in `styles\.css`\.?/i;
const CUSTOM_ELEMENT_RE = /\bcustomElements\b|\bcustom\s+element|\bCUSTOM:\s*(?!<)\S|\belement\w*\s+custom|\bwlasn\w+\s+(?:komponent|element)/i;
const DS_PROPS_CITATION_RE = /(?:^|[\s`(/])ds\/[\w./-]+\.(?:tsx?|jsx?):\d+/m;
const SOURCE_FILE_SRC = '([\\w./-]*?[\\w-]+\\.(?:tsx?|jsx?|mjs|cjs))\\b';
// A source file inside THIS prototype's directory, or a `./x.ts` relative to
// index.tsx. Anchored on the plan's own dir, so a citation of the build shell
// (`data-prototypes/src/ds/DSTable.tsx:42`, which P15 asks for) never matches.
function siblingSourceRe(protoId) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const dirs = protoId ? [PROTO_ROOT, LEGACY_ROOT].map((r) => esc(r + protoId + '/')) : [];
  return new RegExp('(?:' + dirs.concat(['(?<![\\w./])\\./']).join('|') + ')' + SOURCE_FILE_SRC, 'g');
}
const OWN_SWITCHER_RE = /\breplaceState\b|\bPopStateEvent\b|\b(?:floating|own|custom|in-prototype|separate)\b[^.\n]{0,40}\bswitcher\b|\bprzelacznik\w*\s+stan|\bwlasn\w+\s+przelacznik/i;

// P4: a prose line about the build shell's OWN imports (`src/main.tsx` pulls
// a stylesheet first) describes the host, not a prototype import.
// Heuristic: the line names main.tsx or the shell and not index.tsx.
function describesShellImports(text) {
  return /main\.tsx|\bshell\b/i.test(text) && !/index\.tsx/i.test(text);
}

// P10: a negation silences only the CLAUSE it stands in, so
// "nie dodawaj sztywnej wysokosci; `.x { min-height: 500px }`" still warns.
// Clauses split on `;`, `,` and the Polish ` i `. Fenced code always counts.
function dimensionProposed(l, fenced) {
  if (fenced) return DIMENSION_RE.test(l.text);
  return l.text.split(/;|,|\si\s/).some((clause) => DIMENSION_RE.test(clause)
    && !R.NEGATION_RE.test(clause) && !PL_NEGATION_RE.test(R.foldPolish(clause)));
}

/** true when `<protoRoot>/<id>/index.tsx` exists and exports no demoStates. */
function isExistingWithoutDemoStates(protoRoot, protoId) {
  if (!protoId) return false;
  const src = R.readFileSafe(path.join(protoRoot, protoId, 'index.tsx'));
  return src !== null && !/\bexport\s+const\s+demoStates\b/.test(src);
}

function run(planPath, flags) {
  // The generic rules first - same file, same Report shape.
  const rep = generic.run(planPath, flags);

  const raw = R.readFileSafe(planPath);
  if (raw === null) R.usageError('cannot read plan file: ' + planPath);
  const lines = raw.split('\n');
  const sections = generic.parseSections(lines);
  const inFence = generic.fenceMap(lines);
  const steps = generic.groupSteps(sections.steps);
  const sectionText = (s) => (s ? s.lines.map((l) => l.text).join('\n') : '');
  const stepsText = sectionText(sections.steps);
  const testPlanText = sectionText(sections.testplan);
  const formatMatch = /^\*\*Prototype format:\*\*\s*`?([a-z]+)`?\s*$/m.exec(raw);
  const format = formatMatch ? formatMatch[1] : 'react';
  if (!['react', 'vanilla'].includes(format)) {
    rep.block({ rule: 'P7', message: 'unsupported prototype format', fix: 'new prototypes are react; vanilla is existing legacy only' });
  }
  const allowedRoots = format === 'vanilla' ? [PROTO_ROOT, LEGACY_ROOT] : [PROTO_ROOT];

  // -- P1: prototype id and every planned path inside the prototype dir -----
  const idMatch = /^\*\*Prototype id:\*\*\s*(\S+)\s*$/m.exec(raw);
  if (!idMatch) {
    rep.block({ rule: 'P1', message: 'missing `**Prototype id:**` in the plan header', fix: 'a prototype plan names the id it builds' });
  }
  const protoId = idMatch ? idMatch[1].replace(/`/g, '') : null;
  if (protoId && !/^[a-z0-9-]+$/.test(protoId)) {
    rep.block({ rule: 'P1', message: 'invalid prototype id', fix: 'use the registered ASCII id returned by POST /api/prototypes' });
  }
  const fileSections = [sections.filestochange, sections.newfiles].filter(Boolean);
  for (const sec of fileSections) {
    for (const l of sec.lines) {
      for (const m of l.text.matchAll(/`([^`]+\.[a-z0-9]{2,5})`/gi)) {
        const p = m[1];
        const normalized = path.posix.normalize(p);
        const allowed = p === normalized && allowedRoots.some((root) => protoId
          && (p.startsWith(root + protoId + '/') || p === root + 'prototypes.json'));
        if (!allowed) {
          rep.block({ rule: 'P1', line: l.line, message: 'path outside the prototype directory: `' + p + '`', fix: 'prototype files stay under ' + PROTO_ROOT + protoId + '/; shared/host changes need a separate plan' });
        }
      }
    }
  }

  // -- P2: the Playwright recipe is present and filled ----------------------
  const vis = sections[generic.normHeading('## Visual verification (Playwright)')];
  if (!vis) {
    rep.block({ rule: 'P2', message: 'missing `## Visual verification (Playwright)`', fix: 'a prototype is always UI-touching - Phase 6g needs the recipe' });
  } else {
    const unfilled = vis.lines.find((l) => /\{\{/.test(l.text));
    if (unfilled) {
      rep.block({ rule: 'P2', line: unfilled.line, message: 'unfilled `{{...}}` placeholder in `## Visual verification (Playwright)`', fix: 'fill the reference screen, the golden path, the DS audit targets and the landmarks' });
    }
  }

  // -- P3: companion artifacts ----------------------------------------------
  const modeMatch = /^\*\*Prototype mode:\*\*\s*(\S+)/m.exec(raw);
  const mode = modeMatch ? modeMatch[1].replace(/`/g, '') : 'spec-driven';
  if (!/spec\.json/i.test(stepsText)) {
    rep.block({ rule: 'P3', line: sections.steps ? sections.steps.start : 1, message: '`## Steps` never mentions `spec.json`', fix: 'spec.json is the scope source of truth and is updated in every prototype plan' });
  }
  if (/requirements-driven/i.test(mode) && !/compliance\.json/i.test(stepsText)) {
    rep.block({ rule: 'P3', line: sections.steps ? sections.steps.start : 1, message: 'requirements-driven plan whose `## Steps` never mentions `compliance.json`', fix: 'map the addressed requirements, or set `**Prototype mode:** spec-driven`' });
  }

  // -- P4: no host imports --------------------------------------------------
  lines.forEach((text, i) => {
    if (inFence[i]) return;
    if (/\bfrom\s*['"]\/js\/|\bimport\s*['"]\/js\//.test(text) && !R.NEGATION_RE.test(text)) {
      rep.block({ rule: 'P4', line: i + 1, message: 'step imports from the host bundle `/js/`', fix: 'React uses product DS adapters; legacy render.js stays self-contained' });
    }
  });
  // P4 also: for React, any
  // specifier outside the shared allowlist. Fenced code is a proposal too;
  // the gate sections carry grep checks, not proposals, so they are skipped.
  const allowlist = loadImportAllowlist();
  const gateLines = new Set([sections.testplan, sections.acceptancecriteria]
    .filter(Boolean).flatMap((sec) => sec.lines.map((l) => l.line)));
  lines.forEach((text, i) => {
    if (gateLines.has(i + 1) || /\bgrep\b/.test(text)) return;
    if (!inFence[i] && R.NEGATION_RE.test(text)) return;
    if (!inFence[i] && describesShellImports(text)) return;
    for (const spec of importSpecs(text)) {
      if (format === 'react' && !spec.startsWith('/js/') && !allowlist.isAllowed(spec)) {
        rep.block({ rule: 'P4', line: i + 1, message: 'import outside the prototype allowlist: `' + spec + '`', fix: 'allowed: react, ./styles.css, ./*.json, ./assets/*, ../_shared/*, ../../ds, ../../components (plus the listed library exceptions)' });
      }
    }
  });

  // -- P5: mobile-first media queries ---------------------------------------
  lines.forEach((text, i) => {
    if (inFence[i]) return;
    if (/@media[^\n]*(?:min|max)-width/i.test(text) && !R.NEGATION_RE.test(text)) {
      const finding = { rule: 'P5', line: i + 1, message: 'viewport-width query planned', fix: format === 'react' ? 'use @container proto; browser width is not canvas width' : 'keep legacy CSS mobile-first' };
      if (format === 'react') rep.block(finding); else rep.warn(finding);
    }
  });

  // -- P6: the DS linter is a gate ------------------------------------------
  if (!/check-proto-ds/i.test(testPlanText)) {
    rep.block({ rule: 'P6', line: sections.testplan ? sections.testplan.start : 1, message: '`## Test plan` does not name `node scripts/check-proto-ds.js`', fix: 'add the DS linter as a mandatory gate' });
  }
  // P7 demo states are BLOCK for a new prototype and WARN for an existing one
  // whose index.tsx has no demoStates yet (R-12, sf-test rule 15). The plan
  // text cannot tell the two apart - POST /api/prototypes registers the id and
  // stages the starter BEFORE the plan is written, so even a new plan lists
  // index.tsx under Files to change - so the disk decides: the staged starter
  // already exports demoStates, an unmigrated existing prototype does not.
  const protoRoot = path.resolve(flags && (flags.protoRoot || flags['proto-root'])
    ? String(flags.protoRoot || flags['proto-root'])
    : path.join(__dirname, '..', PROTO_ROOT));
  const existingNoStates = format === 'react' && isExistingWithoutDemoStates(protoRoot, protoId);
  if (format === 'react') {
    for (const marker of ['index.tsx', 'demoStates', 'useDemoState', 'breakpoints']) {
      if (stepsText.includes(marker)) continue;
      if (existingNoStates && (marker === 'demoStates' || marker === 'useDemoState')) {
        rep.warn({ rule: 'P7', message: 'React steps omit ' + marker + ' in an existing prototype without demoStates', fix: 'migrate on next touch: add demoStates + useDemoState for the screens this plan changes' });
      } else {
        rep.block({ rule: 'P7', message: 'React steps omit ' + marker, fix: 'plan source, implemented widths and deterministic demo states together' });
      }
    }
    if (!stepsText.includes('../../ds') || !stepsText.includes('@container proto')) {
      rep.block({ rule: 'P7', message: 'React steps omit the product DS or container contract', fix: 'use ../../ds adapters and @container proto, not cockpit DS' });
    }
  }


  runR21Rules(rep, { raw, lines, sections, inFence, steps, format, protoId });

  // Not a rule, just a useful line in the report.
  if (protoId) rep.info('prototype: ' + protoId + ' (' + mode + ', ' + format + ')');
  if (existingNoStates) rep.info('existing prototype without demoStates: P7 demo-state markers are WARN');
  return rep;
}

// P8-P17: the sf-test Phase 4.5 rules the mission-deck preflight did not have
// (R-21). All read `## Steps` unless stated; a prose line carrying a negation
// ("never ...") is a rule, not a proposal, while fenced code always counts.
function runR21Rules(rep, ctx) {
  const { raw, lines, sections, inFence, steps, format, protoId } = ctx;
  const stepLines = sections.steps ? sections.steps.lines : [];
  const proposes = (l) => inFence[l.line - 1]
    || (!R.NEGATION_RE.test(l.text) && !PL_NEGATION_RE.test(R.foldPolish(l.text)));
  const secText = (...secs) => secs.filter(Boolean).map((sec) => sec.lines.map((l) => l.text).join('\n')).join('\n');
  const stepsAndAc = secText(sections.steps, sections.acceptancecriteria, sections[generic.normHeading('## Visual verification (Playwright)')]);
  const stepOf = (lineNo) => {
    let found = null;
    for (const st of steps) if (st.line <= lineNo) found = st;
    return found;
  };

  // -- P8 (5a): transform on an ancestor of DSBottomSheet / DSModal ---------
  if (OVERLAY_RE.test(raw)) {
    for (const l of stepLines) {
      if (!proposes(l) || OVERLAY_RE.test(l.text) || !TRANSFORM_RE.test(l.text)) continue;
      // WARN, not BLOCK: the regex cannot tell an ancestor of the overlay from
      // a card rendered INSIDE it, and the second is harmless (known false alarm).
      rep.warn({ rule: 'P8', line: l.line, message: '`transform` planned in a prototype that uses DSBottomSheet/DSModal - ignore this when the element sits INSIDE the overlay (a card in the modal), not on its ancestor', fix: 'a transform creates a containing block that traps position:fixed overlays behind BottomNav; animate without transform on any ancestor of the overlay' });
    }
  }

  // -- P9 (6b): "absent from the catalog" without ls/grep evidence ----------
  if (!ABSENCE_EVIDENCE_RE.test(raw)) {
    lines.forEach((text, i) => {
      if (inFence[i] || R.NEGATION_RE.test(text)) return;
      if (!ABSENCE_CLAIM_RE.test(R.foldPolish(text))) return;
      rep.warn({ rule: 'P9', line: i + 1, message: 'catalog-absence claim without ls/grep evidence', fix: 'quote the ls/grep of assets/icons/ds/manifest.json, css/ds.css or ../../ds that proves the icon/component is missing' });
    });
  }

  // -- P10 (8): min/max-* not quoted from the Figma layout tree -------------
  for (const l of stepLines) {
    if (!dimensionProposed(l, inFence[l.line - 1])) continue;
    const st = stepOf(l.line);
    if (LAYOUT_CITATION_RE.test(l.text) || (st && LAYOUT_CITATION_RE.test(st.text))) continue;
    rep.warn({ rule: 'P10', line: l.line, message: 'dimensional constraint (min/max-width/height) without a layout-tree citation', fix: 'quote the section-*.md / layout tree node the value comes from (e.g. `V 432x328` -> max-width: 432px), or drop it' });
  }

  // -- P11 (9): new desktop screen without a scroll reset -------------------
  if (!SCROLL_RESET_RE.test(stepsAndAc)) {
    const trigger = steps.find((st) => DESK_SCREEN_RE.test(st.text)
      || (CASE_RE.test(st.text) && SCREEN_WORD_RE.test(st.text) && !DEMO_STATE_RE.test(st.text)));
    if (trigger) {
      rep.warn({ rule: 'P11', line: trigger.line, message: 'desktop screen added or changed without a scroll-to-top', fix: 'reset the scroll container on navigation (scrollTop = 0 / scrollTo) and say so in the step' });
    }
  }

  // -- P12 (10): icon tinted through an svg selector, hand-rolled mask -----
  let svgRule = false;
  for (const l of stepLines) {
    const fenced = inFence[l.line - 1];
    if (fenced && SVG_SELECTOR_RE.test(l.text) && /\{/.test(l.text)) svgRule = true;
    const inSvgRule = fenced && svgRule;
    if (fenced && /\}/.test(l.text)) svgRule = false;
    if (!proposes(l) || SVG_TINT_NEGATED_RE.test(l.text)) continue;
    if ((inSvgRule || SVG_SELECTOR_RE.test(l.text)) && TINT_PROP_RE.test(l.text)) {
      rep.block({ rule: 'P12', line: l.line, message: 'icon recoloured through an `svg` selector', fix: 'DSIcon is a CSS-mask span painted with currentColor; set `color:` on the icon wrapper - an svg selector matches nothing' });
    } else if (HAND_MASK_RE.test(l.text)) {
      rep.block({ rule: 'P12', line: l.line, message: 'hand-rolled icon mask / filter: invert planned', fix: 'the mask lives inside DSIcon; tint it with `color:` on the wrapper' });
    }
  }

  // -- P13 (12): form control without :focus / :hover -----------------------
  if (!INTERACTIVE_STATE_RE.test(stepsAndAc)) {
    const ctl = stepLines.find((l) => proposes(l) && FORM_CONTROL_RE.test(R.foldPolish(l.text)));
    if (ctl) {
      rep.warn({ rule: 'P13', line: ctl.line, message: 'form control built or restyled without :focus / :hover', fix: 'name the focus and hover styles in the step or an AC; otherwise the browser paints its own ring' });
    }
  }

  // -- P14 (13): --state-*-border on a visible border -----------------------
  for (const l of stepLines) {
    if (!proposes(l) || !STATE_BORDER_RE.test(l.text)) continue;
    rep.warn({ rule: 'P14', line: l.line, message: '`--state-*-border` token planned for a visible border', fix: 'resolve the token first (--state-danger-border is transparent); form controls use the --form-primary-* family' });
  }

  // -- P15 (14): custom element without a DS* props citation ---------------
  if (!DS_PROPS_CITATION_RE.test(raw)) {
    const custom = stepLines.find((l) => proposes(l)
      && CUSTOM_ELEMENT_RE.test(R.foldPolish(l.text.replace(CUSTOM_BOILERPLATE_RE, ''))));
    if (custom) {
      rep.warn({ rule: 'P15', line: custom.line, message: 'custom element planned without a `path:line` citation of the matching DS* props', fix: 'quote data-sub-repositories/ds-data/prototypes/_shared/<file>:<line> showing why the ready DS component cannot do the job' });
    }
  }

  if (format !== 'react') return;

  // -- P16 (15b): helper source file next to index.tsx ----------------------
  const fileSecs = [sections.filestochange, sections.newfiles, sections.steps].filter(Boolean);
  const siblingRe = siblingSourceRe(protoId);
  for (const sec of fileSecs) {
    for (const l of sec.lines) {
      if (!inFence[l.line - 1] && R.NEGATION_RE.test(l.text)) continue;
      for (const m of l.text.matchAll(siblingRe)) {
        if (m[1] === 'index.tsx') continue;
        rep.block({ rule: 'P16', line: l.line, message: 'helper source file next to index.tsx: `' + m[1] + '`', fix: 'deploy and local-preview copy ONLY index.tsx + styles.css; keep components in index.tsx, shared code goes to prototypes/_shared/ via /new-idea' });
      }
    }
  }

  // -- P17 (15c): own demo-state switcher / history.replaceState -----------
  for (const l of stepLines) {
    if (!proposes(l) || !OWN_SWITCHER_RE.test(R.foldPolish(l.text))) continue;
    rep.warn({ rule: 'P17', line: l.line, message: 'prototype-side demo-state switcher or URL writer planned', fix: 'the viewer owns the switcher UI and the URL; the prototype only reads through useDemoState' });
  }
}

function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2));
  if (flags.help || positionals.length === 0) R.showHelp(HELP);
  const rep = run(positionals[0], flags);
  rep.emit(flags, 'PROTO-PREFLIGHT');
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('proto-preflight internal error: ' + ((e && e.stack) || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { run, loadImportAllowlist, importSpecs };
}
