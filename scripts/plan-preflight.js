#!/usr/bin/env node
'use strict';
// scripts/plan-preflight.js
// Executable form of .claude/skills/new-idea/PREFLIGHT-CHECKLIST.md - all 17
// rules run over a plan file in one pass. Replaces /new-idea Phase 4.5, which
// used to be ~17 separate grep calls made by the model on every plan iteration.
//
//   node scripts/plan-preflight.js plans/2026-09-04-foo.md
//   node scripts/plan-preflight.js plans/2026-09-04-foo.md --json
//
// Exit: 0 clean or warnings only, 1 at least one BLOCK, 2 usage error.

const path = require('path');
const R = require('./_report');

const HELP = `
plan-preflight.js - deterministic Phase 4.5 preflight for a /new-idea plan

Usage:
  node scripts/plan-preflight.js <plan-path> [--json]

Options:
  --json    machine-readable envelope (verdict, counts, findings)
  --help    this text

Rules: the 20 documented in .claude/skills/new-idea/PREFLIGHT-CHECKLIST.md.
Exit codes: 0 clean/warn, 1 blocking findings, 2 usage or internal error.
`;

const REQUIRED_SECTIONS = [
  '## Idea',
  '## Context',
  '## Files to change',
  '## Steps',
  '## Risks & footguns',
  '## Test plan',
  '## Acceptance criteria',
  '## Out of scope',
  '## Iteration log',
];

function normHeading(h) {
  return h.replace(/^#+\s*/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Split the plan into H2 sections: { key -> {title, start, end, lines} }. */
function parseSections(lines) {
  const sections = {};
  let cur = null;
  lines.forEach((text, idx) => {
    const m = /^##\s+(.+?)\s*$/.exec(text);
    if (m && !/^###/.test(text)) {
      if (cur) cur.end = idx;
      cur = { title: m[1], start: idx + 1, end: lines.length, lines: [] };
      sections[normHeading(m[1])] = cur;
      return;
    }
    if (cur) cur.lines.push({ line: idx + 1, text });
  });
  return sections;
}

/** Line numbers (1-based) that sit inside a fenced code block. */
function fenceMap(lines) {
  const inFence = new Array(lines.length).fill(false);
  let open = false;
  lines.forEach((text, i) => {
    if (/^\s*(```|~~~)/.test(text)) { open = !open; inFence[i] = true; return; }
    inFence[i] = open;
  });
  return inFence;
}

/** Group `## Steps` content into steps: a top-level list item + continuations. */
function groupSteps(section) {
  if (!section) return [];
  const steps = [];
  let cur = null;
  for (const l of section.lines) {
    if (/^\s{0,3}(-|\*|\d+\.)\s/.test(l.text)) {
      if (cur) steps.push(cur);
      cur = { line: l.line, text: l.text };
    } else if (cur && l.text.trim() !== '') {
      cur.text += '\n' + l.text;
    }
  }
  if (cur) steps.push(cur);
  return steps;
}

function sectionText(section) {
  return section ? section.lines.map((l) => l.text).join('\n') : '';
}

function run(planPath, _flags) {
  const raw = R.readFileSafe(planPath);
  if (raw === null) R.usageError('cannot read plan file: ' + planPath);

  const lines = raw.split('\n');
  const sections = parseSections(lines);
  const inFence = fenceMap(lines);
  const body = raw;
  const rel = path.relative(R.ROOT, path.resolve(planPath)) || planPath;

  const rep = new R.Report('plan-preflight', { plan: rel, lines: lines.length });
  const steps = groupSteps(sections.steps);
  const stepsText = sectionText(sections.steps);
  const testPlanText = sectionText(sections.testplan);

  // -- Rule 1: required H2 sections -----------------------------------------
  for (const want of REQUIRED_SECTIONS) {
    if (!sections[normHeading(want)]) {
      rep.block({ rule: 1, message: 'missing required section `' + want + '`', fix: 'add the section (empty is better than absent - the template defines the contract)' });
    }
  }

  // -- Rule 2: status field --------------------------------------------------
  const statusLine = lines.findIndex((t) => /\*\*Status:\*\*/.test(t));
  if (statusLine === -1) {
    rep.block({ rule: 2, message: 'no `**Status:**` line', fix: 'add `**Status:** draft` under the H1 - Phase 7 rewrites this field' });
  }

  // -- Rule 3: non-ASCII -----------------------------------------------------
  // Calibration: typographic punctuation in prose is legal (the repo uses em
  // dashes everywhere) and so are Polish diacritic letters - legacy plans and
  // quoted names may carry them, so a plan can quote such copy verbatim.
  // Non-ASCII inside a code fence or an inline code span is still a BLOCK: that
  // is a proposed identifier or path, and those stay ASCII.
  lines.forEach((text, i) => {
    const hits = R.nonAsciiFindings(text, planPath.endsWith('.md') ? 'x.md' : planPath);
    if (hits.length === 0) return;
    const fenced = inFence[i];
    const spans = fenced ? [] : R.codeSpanRanges(text);
    const inCode = (col) => fenced || spans.some(([a, b]) => col >= a && col <= b);
    // A Polish diacritic letter in prose (legacy plans, quoted names) is not a finding.
    const offenders = hits.filter((h) => inCode(h.col - 1) || !R.isPolishLetter(h.char));
    if (offenders.length === 0) return;
    const hit = offenders[0];
    if (inCode(hit.col - 1)) {
      rep.block({ rule: 3, line: i + 1, message: 'non-ASCII ' + hit.code + ' (`' + hit.char + '`) inside code - identifiers, paths and code must be ASCII', fix: 'rewrite the identifier/path without diacritics' });
    } else {
      rep.warn({ rule: 3, line: i + 1, message: 'non-ASCII ' + hit.code + ' (`' + hit.char + '`) in prose', fix: 'typographic punctuation and Polish diacritic letters are tolerated here; other non-ASCII is not' });
    }
  });

  // -- Rule 4: hardcoded hex colors -----------------------------------------
  const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
  lines.forEach((text, i) => {
    let m;
    HEX_RE.lastIndex = 0;
    while ((m = HEX_RE.exec(text)) !== null) {
      const val = m[0].slice(1);
      // Pure-digit 3-char tokens are almost always an issue reference, not a color.
      if (val.length === 3 && /^[0-9]+$/.test(val)) continue;
      rep.block({ rule: 4, line: i + 1, message: 'hardcoded hex color `' + m[0] + '`', fix: 'use a token from css/ds-tokens.css / css/ds-tokens-dark.css' });
    }
  });

  // -- Rule 5: acceptance criteria are command-verifiable --------------------
  const acSection = sections.acceptancecriteria;
  const acLines = acSection ? acSection.lines.filter((l) => /^\s*[-*]\s*\[[ x~X]\]/.test(l.text)) : [];
  if (acSection && acLines.length === 0) {
    rep.block({ rule: 5, line: acSection.start, message: 'no acceptance criteria checkboxes', fix: 'add 3-8 `- [ ] AC<n>: ...` lines, each verifiable by one command' });
  } else if (acLines.length > 0 && acLines.length < 3) {
    rep.warn({ rule: 5, line: acLines[0].line, message: 'only ' + acLines.length + ' acceptance criteria (3-8 expected)', fix: 'add criteria until the plan is genuinely falsifiable' });
  }
  const VERIFIABLE_RE = /(`[^`]+`|\bgrep\b|npm run|npm test|exits 0|MANUAL|AC_VIS|file .* exists)/;
  for (const l of acLines) {
    if (!VERIFIABLE_RE.test(l.text)) {
      rep.warn({ rule: 5, line: l.line, message: 'acceptance criterion is not command-verifiable', fix: 'add a backticked command, `grep ...`, `npm run ...`, `exits 0`, MANUAL or AC_VIS' });
    }
  }

  // -- Rule 6: view triple / module completeness -----------------------------
  // A plug & play module under modules/<id>/ is the DEFAULT place for a new
  // page, and it is the exact opposite of the view triple: the core gets no
  // index.html section, no VIEW_REGISTRY entry and no HUB_FLYOUT entry, because
  // js/module-host.js builds all three at boot from module.json. Checking the
  // triple against a module plan would therefore block the correct design and
  // push the author back into the core - so the module branch is tested FIRST
  // and the triple branch never runs for a module.
  // Deliberately narrow: only a plan whose ## New files names a path starting
  // at `modules/<id>/`, or whose steps call the scaffolder. `modules/` must not
  // be preceded by a slash, or `tests/fixtures/modules/fixture-mod/` in a
  // KERNEL plan would read as "this plan adds a module" and the branch below
  // would block correct kernel work (it did, on plans A and B1).
  const NEW_MODULE_PATH_RE = /(?:^|[\s`'"([])modules\/[a-z][a-z0-9-]*\//im;
  const proposesModule = NEW_MODULE_PATH_RE.test(sectionText(sections.newfiles))
    || /new-module\.js/i.test(stepsText);
  const proposesView = /view-section/i.test(body) || /^\s*[-*]\s*`?js\/[a-z0-9-]+\.js`?/mi.test(sectionText(sections.newfiles));

  if (proposesModule) {
    // A module is complete when the manifest and the client entry are both
    // named. Everything else (server/, tests/, style.css) is optional by
    // design - a read-only module with no endpoint is a legitimate shape.
    const missing = [];
    if (!/module\.json/i.test(stepsText)) missing.push('module.json (manifest)');
    if (!/client\/index\.js|new-module\.js/i.test(stepsText)) missing.push('client/index.js');
    if (missing.length > 0) {
      rep.block({ rule: 6, line: sections.steps ? sections.steps.start : 1, message: 'plan adds a module but `## Steps` never mentions ' + missing.join(', '), fix: 'a module needs at least module.json plus client/index.js; `node scripts/new-module.js <id> "<Label>" --area "<Obszar>"` writes both' });
    }
    // The core must stay clean: a module that also edits the core's registry
    // or flyout has misunderstood the contract.
    if (/VIEW_REGISTRY|HUB_FLYOUT/.test(stepsText)) {
      rep.block({ rule: 6, line: sections.steps ? sections.steps.start : 1, message: 'module plan edits VIEW_REGISTRY or HUB_FLYOUT in the core', fix: 'a module never touches the core registries - js/module-host.js fills both from module.json at boot' });
    }

    // -- Rule 21: a module's pages land in a CORE hub ------------------------
    // The rail's hubs belong to the core (js/core-hubs.mjs); a module declares
    // WHICH one with `--hub <id>` / `sidebar.hub`. A plan that names none would
    // scaffold an `item` - a rail entry of the module's own - by accident, which
    // is how the first module built through this skill shipped. An own entry
    // (`item`) or own flyout (`hub`) stays legitimate, but only with a reason
    // written where the reviewer reads it.
    const namesHub = /--hub\s+[a-z][a-z0-9-]*/i.test(stepsText)
      || /sidebar\.hub|["']hub["']\s*:\s*["'][a-z][a-z0-9-]*["']|["']kind["']\s*:\s*["']page["']/i.test(body);
    const ownShape = /["']?kind["']?\s*:\s*["'](?:item|hub)["']/i.test(body);
    const contextText = sectionText(sections.context);
    const ownShapeJustified = ownShape && /\bhub|szyn|rail|flyout/i.test(contextText);
    if (!namesHub && !ownShapeJustified) {
      rep.warn({ rule: 21, line: sections.steps ? sections.steps.start : 1, message: 'module plan names no core hub for its pages (`--hub <id>` / `sidebar.hub`) and gives no reason for a rail entry of its own', fix: 'ask interview question Q1b and put `--hub <id>` on the new-module.js step (core hubs: ' + coreHubIds().join(', ') + '); an `item`/`hub` shape needs one sentence of reason in `## Context`' });
    }

    // -- Rule 22: a new module names its business area -----------------------
    // Plan 2026-09-12-obszary-modulow.md made `area` a required manifest field,
    // independent of --hub: --hub is where a module lives in the menu, --area
    // is what it is about. new-module.js exits 2 without it, so a plan that
    // forgets --area on the scaffold step would fail at implementation time
    // rather than at review time - this rule moves that failure earlier.
    // Deliberately narrow to an ACTUAL scaffold invocation (an id followed by
    // a quoted label) rather than any mention of "area" anywhere in `##
    // Steps` - a plan can legitimately talk about the area JSON field, or
    // link `new-module.js --help`, on an unrelated line and still forget
    // --area on the real command; scanning the whole section as one blob
    // would let that line hide behind the unrelated mention.
    const SCAFFOLD_INVOCATION_RE = /new-module\.js\s+[a-z][a-z0-9-]*\s+["']/i;
    const scaffoldLines = (sections.steps ? sections.steps.lines : [])
      .filter((l) => SCAFFOLD_INVOCATION_RE.test(l.text));
    const missingAreaLine = scaffoldLines.find((l) => !/--area\b/i.test(l.text));
    if (missingAreaLine) {
      rep.warn({ rule: 22, line: missingAreaLine.line, message: 'module plan scaffolds with `new-module.js` but this invocation never names `--area "<Obszar>"`', fix: 'add `--area "<Obszar>"` to the scaffold command, e.g. `node scripts/new-module.js <id> "<Label>" --area "Product"` - new-module.js now requires it (exit 2 without it)' });
    }
  } else if (proposesView) {
    const missing = [];
    if (!/index\.html/i.test(stepsText)) missing.push('index.html');
    if (!/view-registry|VIEW_REGISTRY/i.test(stepsText)) missing.push('js/view-registry.js');
    // The hub PAGES live in js/core-hubs.mjs; js/sidebar-flyout-config.js is a
    // loop over it and is not edited by hand any more, so either name counts.
    if (!/core-hubs|sidebar-flyout-config|HUB_FLYOUT/i.test(stepsText)) missing.push('js/core-hubs.mjs');
    if (missing.length > 0) {
      rep.block({ rule: 6, line: sections.steps ? sections.steps.start : 1, message: 'plan adds a core view but `## Steps` never mentions ' + missing.join(', '), fix: 'the view triple is all-or-nothing: section + VIEW_REGISTRY entry + a hub `pages` entry in js/core-hubs.mjs. A new page usually belongs in a module instead - see `node scripts/new-module.js --help`' });
    }
  }

  // -- Rule 7: view cleanup --------------------------------------------------
  const usesTimers = /setInterval|setTimeout|EventSource|addEventListener\s*\(\s*['"]?\s*(window|document)|window\.addEventListener|document\.addEventListener/i.test(body);
  if (proposesView && usesTimers && !/runActiveViewCleanup|view-lifecycle/i.test(stepsText)) {
    rep.warn({ rule: 7, line: sections.steps ? sections.steps.start : 1, message: 'view registers timers or listeners but no step mentions `runActiveViewCleanup`', fix: 'register cleanup with js/view-lifecycle.js runActiveViewCleanup' });
  }

  // -- Rule 8: DS component usage -------------------------------------------
  const DS_ELEMENTS = /\b(button|input|modal|card|badge|select|tabs|toast)\b/i;
  const DS_TOKEN = /(ds-btn|ds-card|ds-badge|ds-callout|ds-input|ds-tabs|ds-segmented|ds-modal|ds-select|ds-icon-btn|toast\.js|ds\.css|Design System)/i;
  for (const s of steps) {
    if (DS_ELEMENTS.test(s.text) && !DS_TOKEN.test(s.text)) {
      const el = DS_ELEMENTS.exec(s.text)[1];
      rep.warn({ rule: 8, line: s.line, message: 'step mentions `' + el + '` with no DS class or module in the same step', fix: 'name the DS class (ds-btn / ds-card / ds-input ...) or the module (js/ds-modal.js, js/toast.js)' });
    }
  }

  // -- Rule 9: no perspectives ----------------------------------------------
  lines.forEach((text, i) => {
    const m = /(data-perspective|applyPerspective|_VALID_PERSPECTIVES|perspektyw)/i.exec(text);
    if (m) rep.block({ rule: 9, line: i + 1, message: 'perspective model reference `' + m[1] + '`', fix: 'this repo has no perspectives - remove the concept from the plan' });
  });

  // -- Rule 10: new write endpoint needs a lock ------------------------------
  const WRITE_ROUTE_RE = /\b(POST|PUT|PATCH|DELETE)\b[^\n]{0,40}\/api\//i;
  const ANY_ROUTE_RE = /\b(GET|POST|PUT|PATCH|DELETE)\b[^\n]{0,40}\/api\//i;
  const writeStep = steps.find((s) => WRITE_ROUTE_RE.test(s.text));
  const addsRoute = steps.some((s) => ANY_ROUTE_RE.test(s.text)) && /server\.js/i.test(stepsText);
  if (writeStep && /server\.js/i.test(stepsText) && !/Lock\b|withLock/i.test(stepsText)) {
    rep.block({ rule: 10, line: writeStep.line, message: 'plan adds a write route without mentioning a lock', fix: 'wrap the shared write in `withLock(...)` and use tmp+rename' });
  }

  // -- Rule 11: new endpoint needs a test -----------------------------------
  if (addsRoute && !/test_api_|npm run test:api/i.test(testPlanText)) {
    rep.block({ rule: 11, line: sections.testplan ? sections.testplan.start : 1, message: 'plan adds a route but `## Test plan` names no `tests/test_api_*.js` case', fix: 'add a `tests/test_api_<group>.js` case and `npm run test:api` to the test plan' });
  }

  // -- Rule 12: jsonResponse -------------------------------------------------
  lines.forEach((text, i) => {
    if (/res\.(end|write)\(\s*JSON\.stringify/.test(text)) {
      rep.block({ rule: 12, line: i + 1, message: 'response written with `res.end(JSON.stringify(...))`', fix: 'every JSON response goes through `jsonResponse(res, status, body)` (gzip + ETag)' });
    }
  });

  // -- Rule 13: gates present ------------------------------------------------
  if (sections.testplan) {
    if (!/npm run lint/i.test(testPlanText)) rep.warn({ rule: 13, line: sections.testplan.start, message: '`## Test plan` does not name `npm run lint`', fix: 'add `- [ ] `npm run lint` exits 0`' });
    if (!/npm test/i.test(testPlanText)) rep.warn({ rule: 13, line: sections.testplan.start, message: '`## Test plan` does not name `npm test`', fix: 'add `- [ ] `npm test` exits 0`' });
  }

  // -- Rule 14: forbidden operations ----------------------------------------
  const FORBIDDEN = [
    [/git reset --hard/i, 'git reset --hard'],
    [/--no-verify/i, '--no-verify'],
    [/kill -9/i, 'kill -9'],
    [/\bnpm start\b/i, 'npm start'],
    [/POST\s+\/api\/app\/update|\/api\/app\/update/i, 'POST /api/app/update'],
  ];
  lines.forEach((text, i) => {
    if (R.NEGATION_RE.test(text)) return; // "never `npm start`" is documentation, not an instruction
    for (const [re, label] of FORBIDDEN) {
      if (re.test(text)) {
        rep.block({ rule: 14, line: i + 1, message: 'forbidden operation `' + label + '` planned as a step', fix: 'restart via `POST /api/settings/restart`; discard with git stash/restore; never bypass hooks' });
        break;
      }
    }
  });

  // -- Rule 15: sub-repo git scope ------------------------------------------
  lines.forEach((text, i) => {
    if (/data-sub-repositories/.test(text) && /git\s+(add|commit|push)/.test(text)) {
      rep.block({ rule: 15, line: i + 1, message: 'git operation inside `data-sub-repositories/`', fix: 'that is a separate repo - sync it through the app UI / /api/data-tier-0/*' });
    }
  });

  // -- Rule 16: port literal drift ------------------------------------------
  lines.forEach((text, i) => {
    let m;
    const re = /(?:localhost|127\.0\.0\.1):(\d{2,5})|PORT\s*=\s*(\d{2,5})/g;
    while ((m = re.exec(text)) !== null) {
      const p = m[1] || m[2];
      if (p !== String(R.CANONICAL_PORT)) {
        rep.warn({ rule: 16, line: i + 1, message: 'port literal ' + p + ' (canonical port is ' + R.CANONICAL_PORT + ')', fix: 'the port comes from .env PORT=, fallback ' + R.CANONICAL_PORT });
      }
    }
  });

  // -- Rule 17: plan writes only under plans/ -------------------------------
  for (const s of steps) {
    if (!/\b(planner|idea-planner)\b/i.test(s.text)) continue;
    if (!/\b(write|writes|zapis|create|creates)\b/i.test(s.text)) continue;
    const paths = s.text.match(/`([a-zA-Z0-9_./-]+\.[a-z]{2,4})`/g) || [];
    const outside = paths.map((p) => p.replace(/`/g, '')).filter((p) => !p.startsWith('plans/'));
    if (outside.length > 0) {
      rep.block({ rule: 17, line: s.line, message: 'planner is instructed to write outside plans/: ' + outside.join(', '), fix: 'the planner writes only the plan; code edits belong to the implementer' });
    }
  }

  // -- Rules 18-20: business description (`## Business description`) --------
  // The one section written for a reader who never opens the repo. 18 = present and filled,
  // 19 = no technical language, 20 = the four blocks and 3-5 user-facing items.
  // Plans written before the English translation keep parsing: the legacy
  // heading and labels are accepted as aliases (BIZ_HEADINGS / BIZ_LABELS).
  const biz = BIZ_HEADINGS.map((h) => sections[normHeading(h)]).find(Boolean);
  const isTemplate = lines.some((t) => /^#\s+\{\{title\}\}\s*$/.test(t));
  if (!biz) {
    rep.block({ rule: 18, message: 'missing `## Business description` - the plan has no section for the non-technical reader', fix: 'add `## Business description` above `## Idea` with the four blocks from the template (Why / What changes / What the user will see / What this does NOT change)' });
  } else if (!isTemplate) {
    const bizLines = stripHtmlComments(biz.lines);
    for (const l of bizLines) {
      if (/\{\{/.test(l.text)) {
        rep.block({ rule: 18, line: l.line, message: 'unfilled `{{...}}` placeholder in `## Business description`', fix: 'write the section - it is printed to the reviewer before anything else' });
        break;
      }
    }
    for (const l of bizLines) {
      const hit = jargonHit(l.text);
      if (hit) rep.block({ rule: 19, line: l.line, message: 'technical language in `## Business description`: `' + hit + '`', fix: 'describe the effect for the user in plain words; paths, names and code concepts belong in `## Idea`, `## Steps` or `## Files to change`' });
    }
    const bizText = R.foldPolish(bizLines.map((l) => l.text).join('\n'));
    for (const variants of BIZ_LABELS) {
      const found = variants.some((label) => new RegExp('\\*\\*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\*\\*', 'i').test(bizText));
      if (!found) {
        rep.warn({ rule: 20, line: biz.start, message: '`## Business description` has no `**' + variants[0] + ':**` block', fix: 'keep the four blocks of the template so every plan reads the same way' });
      }
    }
    const items = bizLines.filter((l) => /^\s{0,3}\d+\.\s+\S/.test(l.text)).length;
    if (items < 3 || items > 5) {
      rep.warn({ rule: 20, line: biz.start, message: '`What changes for the user` has ' + items + ' numbered item(s), expected 3-5', fix: 'group by what the user gains, not by technical step - 3-5 items' });
    }
  }

  return rep;
}

// English first (what findings quote); the second entry is the legacy label of plans
// written before the translation, matched after diacritic folding.
const BIZ_HEADINGS = ['## Business description', '## Opis biznesowy'];
const BIZ_LABELS = [
  ['Why we are doing this', 'Po co to robimy'],
  ['What changes for the user', 'Co sie zmieni dla uzytkownika'],
  ['What the user will see after release', 'Co uzytkownik zobaczy po wdrozeniu'],
  ['What this does NOT change', 'Czego to NIE zmienia'],
];

/**
 * The core hub ids, read from js/core-hubs.mjs so the fix hint can never name
 * a hub that no longer exists. Read-only, regex over the source (the file is
 * ESM and this script is CJS); an unreadable file yields an empty list and the
 * hint simply omits the enumeration.
 * @returns {string[]}
 */
function coreHubIds() {
  try {
    const src = require('fs').readFileSync(path.join(R.ROOT, 'js', 'core-hubs.mjs'), 'utf8');
    const ids = [];
    const re = /^\s*(?:\{\s*)?id:\s*'([a-z][a-z0-9-]*)'/gm;
    let m;
    while ((m = re.exec(src)) !== null) ids.push(m[1]);
    return ids;
  } catch (_e) {
    return [];
  }
}

// Technical language that has no place in a section for a non-technical reader. Each entry is
// [regex, label]; the label is what the finding quotes when the match itself is not readable.
const JARGON = [
  [/`[^`]+`/, null],
  [/\b(?:js|css|scripts|tests|docs|assets|templates|plans|data|user-data)\/[\w./-]*/i, null],
  [/\b[\w-]+\.(?:js|mjs|cjs|json|css|html|md|py|env|yml|yaml)\b/i, null],
  [/\.(?:js|mjs|md|html|css):\d+/, null],
  [/\bds-[a-z]/, null],
  [/\b(?:GET|POST|PUT|PATCH|DELETE)\s+\//, null],
  [/(?:^|\s)#[a-z][\w-]*/i, null],
  [/\/api\//, null],
  [/\b(?:hub|hubs|hubu|hubie|huby|hubow)\b/i, 'hub'],
  [/\bflyout\w*/i, 'flyout'],
  [/\bsidebar\w*/i, 'sidebar'],
  [/\bendpoint\w*/i, 'endpoint'],
  [/\broute\w*/i, 'route'],
  [/\bhash\w*/i, 'hash'],
  [/\bjson\b/i, 'JSON'],
  [/\bmodul\w*/i, 'module'],
  [/\bhandler\w*/i, 'handler'],
  [/\b(?:zaslepk|stub)\w*/i, 'stub'],
  [/\bcache\w*/i, 'cache'],
  [/\bsync\b/i, 'sync'],
  [/\brender\w*/i, 'render'],
  [/\bfetch\w*/i, 'fetch'],
  [/\bconfig\w*/i, 'config'],
  [/\bregistry\b/i, 'registry'],
  [/\bscaffold\w*/i, 'scaffolder'],
  [/\bdispatch\w*/i, 'dispatch'],
  [/\block\w*/i, 'lock'],
  [/\btoken\w*/i, 'token'],
  [/\bmarkup\w*/i, 'markup'],
  [/\bdiff\w*/i, 'diff'],
  [/\bcommit\w*/i, 'commit'],
  [/\bbranch\w*/i, 'branch'],
];

/** First technical token found in a line of `## Business description`, or null. */
function jargonHit(rawText) {
  // Fold diacritics first: legacy plans were written in Polish, and the list
  // below is ASCII on purpose (`modul` finds both `module` and the folded `modul`).
  const text = R.foldPolish(rawText);
  for (const [re, label] of JARGON) {
    const m = re.exec(text);
    if (m) return label || m[0].trim();
  }
  return null;
}

/** Drop `<!-- ... -->` comments (single- and multi-line) from a section's lines. */
function stripHtmlComments(sectionLines) {
  const out = [];
  let inComment = false;
  for (const l of sectionLines) {
    let text = l.text;
    if (inComment) {
      const end = text.indexOf('-->');
      if (end === -1) continue;
      text = text.slice(end + 3);
      inComment = false;
    }
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    const open = text.indexOf('<!--');
    if (open !== -1) { text = text.slice(0, open); inComment = true; }
    out.push({ line: l.line, text });
  }
  return out;
}

function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2));
  if (flags.help || positionals.length === 0) R.showHelp(HELP);
  const rep = run(positionals[0], flags);
  rep.emit(flags, 'PREFLIGHT');
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('plan-preflight internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { run, parseSections, groupSteps, normHeading, REQUIRED_SECTIONS, fenceMap, jargonHit, stripHtmlComments };
}
