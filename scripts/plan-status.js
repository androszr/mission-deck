#!/usr/bin/env node
'use strict';
// scripts/plan-status.js
// The whole /new-idea Phase 7 handoff in one command: set **Status:**, tick the
// acceptance-criteria checkboxes, prepend the [IMPLEMENTED] banner (idempotent),
// append the iteration-log line, re-render the HTML sibling.
//
//   node scripts/plan-status.js plans/2026-09-04-foo.md \
//        --status done --ac "AC1=pass,AC2=fail:no route added,AC_VIS1=manual" \
//        --iteration-note "Bug scan SHIP after 1 iteration."
//
// Exit: 0 written, 1 nothing to write (unknown AC ids), 2 usage error.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./_report');

const HELP = `
plan-status.js - the /new-idea Phase 7 handoff, in one command

Usage:
  node scripts/plan-status.js <plan-path> --status done|partial|blocked
                              [--ac "AC1=pass,AC2=fail:evidence,AC3=manual"]
                              [--iteration-note "..."] [--date YYYY-MM-DD]
                              [--no-html] [--json]

--ac spec:
  <id>=pass              -> [x]
  <id>=fail[:evidence]   -> [ ] plus an inline <!-- FAIL: evidence --> marker
  <id>=manual            -> [~]
  <id>=deferred          -> [ ] plus <!-- DEFERRED -->
  ids match the AC label in the plan (AC1, AC2, AC_VIS1, ...), case-insensitive.

Everything is idempotent: re-running replaces the banner and the markers instead
of stacking them. Exit codes: 0 ok, 1 an AC id was not found, 2 usage error.
`;

const STATUSES = new Set(['done', 'partial', 'blocked', 'draft', 'in-progress']);

/** Parse `AC1=pass,AC2=fail:why,AC3=manual` into a Map(id -> {result, evidence}). */
function parseAcSpec(spec) {
  const map = new Map();
  if (!spec) return map;
  for (const raw of String(spec).split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const eq = item.indexOf('=');
    if (eq === -1) throw new Error('bad --ac item "' + item + '" (expected <id>=<result>)');
    const id = item.slice(0, eq).trim();
    const rest = item.slice(eq + 1).trim();
    const colon = rest.indexOf(':');
    const result = (colon === -1 ? rest : rest.slice(0, colon)).trim().toLowerCase();
    const evidence = colon === -1 ? '' : rest.slice(colon + 1).trim();
    if (!['pass', 'fail', 'manual', 'deferred'].includes(result)) {
      throw new Error('bad --ac result "' + result + '" for ' + id + ' (pass|fail|manual|deferred)');
    }
    map.set(id.toUpperCase(), { result, evidence });
  }
  return map;
}

const MARKER_RE = /\s*<!--\s*(FAIL|DEFERRED)(?::[^>]*?)?\s*-->/g;

/**
 * Apply the whole handoff to `text`.
 * @returns {{text: string, applied: object[], missing: string[], counts: object}}
 */
function applyStatus(text, opts) {
  const status = opts.status;
  const acMap = opts.ac || new Map();
  const date = opts.date;
  const lines = text.split('\n');
  const applied = [];
  const seen = new Set();

  // -- 1. **Status:** --------------------------------------------------------
  let statusFound = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\*\*Status:\*\*/.test(lines[i])) {
      lines[i] = lines[i].replace(/^(\s*\*\*Status:\*\*).*$/, '$1 ' + status);
      statusFound = true;
      break;
    }
  }

  // -- 2. acceptance-criteria checkboxes ------------------------------------
  let inAc = false;
  for (let i = 0; i < lines.length; i++) {
    const h2 = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (h2) { inAc = /acceptance criteria/i.test(h2[1]); continue; }
    if (!inAc) continue;
    const box = /^(\s*[-*]\s*)\[([ xX~])\](\s*)(.*)$/.exec(lines[i]);
    if (!box) continue;
    const idm = /\b(AC_VIS\d+|AC\d+)\b/i.exec(box[4]);
    if (!idm) continue;
    const id = idm[1].toUpperCase();
    const spec = acMap.get(id);
    if (!spec) continue;
    seen.add(id);
    let rest = box[4].replace(MARKER_RE, '');
    let mark = ' ';
    if (spec.result === 'pass') mark = 'x';
    else if (spec.result === 'manual') mark = '~';
    else if (spec.result === 'fail') rest += ' <!-- FAIL: ' + (spec.evidence || 'no evidence given') + ' -->';
    else if (spec.result === 'deferred') rest += ' <!-- DEFERRED -->';
    lines[i] = box[1] + '[' + mark + ']' + box[3] + rest;
    applied.push({ id, result: spec.result });
  }
  const missing = Array.from(acMap.keys()).filter((k) => !seen.has(k));

  // -- 3. [IMPLEMENTED] banner above the H1 (idempotent) --------------------
  // The banner keeps its documented em dash; \u2014 written as an escape so
  // this source file stays ASCII-only.
  const banner = '> **[IMPLEMENTED ' + date + ']** \u2014 status: ' + status + '. See ## Iteration log.';
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1 !== -1) {
    // Drop any previous banner (and the blank line it owns) before re-inserting.
    for (let i = 0; i < lines.length; i++) {
      if (/^>\s*\*\*\[IMPLEMENTED\b/.test(lines[i])) {
        lines.splice(i, (lines[i + 1] !== undefined && lines[i + 1].trim() === '') ? 2 : 1);
        i--;
      }
    }
    const h1b = lines.findIndex((l) => /^#\s+\S/.test(l));
    lines.splice(h1b, 0, banner, '');
  }

  // -- 4. iteration log ------------------------------------------------------
  const counts = { pass: 0, fail: 0, manual: 0, deferred: 0 };
  for (const a of applied) counts[a.result]++;
  const logLine = '- ' + date + ' implemented (' + status + '). AC: '
    + counts.pass + ' pass / ' + counts.fail + ' fail / ' + counts.manual + ' manual'
    + (counts.deferred ? ' / ' + counts.deferred + ' deferred' : '') + '.'
    + (opts.note ? ' ' + opts.note : '');
  let logIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Iteration log\s*$/i.test(lines[i])) { logIdx = i; break; }
  }
  if (logIdx === -1) {
    lines.push('', '## Iteration log', '', logLine);
  } else {
    let end = lines.length;
    for (let i = logIdx + 1; i < lines.length; i++) {
      if (/^##\s+\S/.test(lines[i])) { end = i; break; }
    }
    while (end > logIdx + 1 && lines[end - 1].trim() === '') end--;
    if (!lines.slice(logIdx + 1, end).includes(logLine)) lines.splice(end, 0, logLine);
  }

  return { text: lines.join('\n'), applied, missing, counts, statusFound };
}

function renderHtml(planPath) {
  const script = path.join(R.ROOT, 'scripts', 'plan-to-html.js');
  if (!fs.existsSync(script)) return { ok: false, message: 'scripts/plan-to-html.js not found' };
  const res = spawnSync(process.execPath, [script, planPath], {
    cwd: R.ROOT, encoding: 'utf8', timeout: 60000,
  });
  if (res.status === 0) return { ok: true, message: planPath.replace(/\.md$/, '.html') };
  return { ok: false, message: ((res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' ') || 'exit ' + res.status) };
}

function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2), { booleans: ['no-html'] });
  if (flags.help || positionals.length === 0) R.showHelp(HELP);

  const planPath = path.resolve(positionals[0]);
  const raw = R.readFileSafe(planPath);
  if (raw === null) R.usageError('cannot read plan file: ' + positionals[0]);

  const status = String(flags.status || '').trim();
  if (!status) R.usageError('--status is required (done|partial|blocked)');
  if (!STATUSES.has(status)) R.usageError('unknown --status "' + status + '" (done|partial|blocked)');

  let ac;
  try { ac = parseAcSpec(flags.ac); } catch (e) { R.usageError(e.message); }

  const date = flags.date ? String(flags.date) : new Date().toISOString().slice(0, 10);
  const out = applyStatus(raw, { status, ac, date, note: flags['iteration-note'] });

  fs.writeFileSync(planPath, out.text, 'utf8');

  let html = { ok: false, message: 'skipped (--no-html)' };
  if (!flags['no-html']) html = renderHtml(planPath);

  const rel = path.relative(R.ROOT, planPath) || planPath;
  const result = {
    script: 'plan-status',
    plan: rel,
    status,
    ac_applied: out.applied,
    ac_missing: out.missing,
    counts: out.counts,
    status_field_found: out.statusFound,
    html: html.ok ? path.relative(R.ROOT, path.resolve(html.message)) : null,
    html_error: html.ok ? null : html.message,
  };

  if (flags.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    const t = ['PLAN STATUS: ' + status + '  ' + rel];
    t.push('  AC: ' + out.counts.pass + ' pass / ' + out.counts.fail + ' fail / '
      + out.counts.manual + ' manual / ' + out.counts.deferred + ' deferred');
    if (!out.statusFound) t.push('  WARN: no **Status:** line in the plan - status not recorded in the field');
    if (out.missing.length) t.push('  WARN: AC ids not found in the plan: ' + out.missing.join(', '));
    t.push('  HTML: ' + (html.ok ? result.html : 'not rendered (' + html.message + ')'));
    process.stdout.write(t.join('\n') + '\n');
  }
  process.exit(out.missing.length > 0 || !out.statusFound ? 1 : 0);
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('plan-status internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { applyStatus, parseAcSpec };
}
