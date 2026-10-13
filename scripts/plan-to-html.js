#!/usr/bin/env node
/*
 * plan-to-html.js -- deterministic plan markdown -> self-contained visual HTML.
 *
 * Dual-output model: the `.md` plan stays the machine-read source of truth
 * (preflight grep, blind verifier, AC checkbox mutation all run on the .md).
 * This script renders a human-friendly, fully self-contained `.html` companion
 * next to it -- no external app, no CDN, no JS framework (mirrors /raport-html).
 *
 * Usage:  node scripts/plan-to-html.js <plan.md> [out.html]
 * Default out = same path with the extension swapped to .html.
 *
 * Re-run safe: the skill calls this after the plan is written, after every
 * `iterate`, and at handoff (so the AC status chips reflect final pass/fail).
 *
 * ASCII-only source (repo convention). No third-party deps.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./_report.js');

/* ---------- tiny HTML escaping ---------- */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- inline markdown: code, bold, italic, links ---------- */
function inline(s) {
  // Protect inline code spans first, then escape, then re-inject.
  const codes = [];
  let t = String(s).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  t = esc(t);
  // links [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
    const safe = /^(https?:|\/|#|mailto:)/.test(url) ? url : '#';
    return '<a href="' + esc(safe) + '">' + esc(txt) + '</a>';
  });
  // bold then italic (escaped text, so markers are literal)
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // re-inject code spans
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
  return t;
}

/* ---------- generic block renderer for "unknown"/prose sections ---------- */
function renderBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push('<pre class="code"><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    if (/^###\s+/.test(line)) { out.push('<h3>' + inline(line.replace(/^###\s+/, '')) + '</h3>'); i++; continue; }
    if (/^####\s+/.test(line)) { out.push('<h4>' + inline(line.replace(/^####\s+/, '')) + '</h4>'); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }
    // list (ordered or unordered, incl. checkboxes)
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '');
        item = item.replace(/^\[[ xX~]\]\s*/, '');
        items.push('<li>' + inline(item) + '</li>');
        i++;
      }
      out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    // paragraph (gather until blank)
    // The block markers must be followed by whitespace/EOL -- otherwise a body line
    // starting with bold (`**Po co to robimy:** ...`) matches `[-*]`, the loop consumes
    // nothing, `i` never advances and the renderer spins until OOM.
    const isBlockStart = (l) => /^\s*(?:[-*](?:\s|$)|\d+\.(?:\s|$)|>|#{3,4}(?:\s|$)|```)/.test(l);
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      buf.push(lines[i]); i++;
    }
    if (!buf.length) { buf.push(lines[i]); i++; } // hard guard: always advance
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return out.join('\n');
}

/* ---------- specialized: file list (path -- desc) ---------- */
function renderFileList(lines) {
  const rows = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*[-*]\s+(.*)$/);
    if (!m) continue;
    const body = m[1];
    const pm = body.match(/^`([^`]+)`\s*(?:[-\u2014:]\s*)?(.*)$/);
    if (pm) {
      rows.push('<div class="file-row"><code class="file-path">' + esc(pm[1]) + '</code>' +
        (pm[2] ? '<span class="file-desc">' + inline(pm[2]) + '</span>' : '') + '</div>');
    } else {
      rows.push('<div class="file-row"><span class="file-desc">' + inline(body) + '</span></div>');
    }
  }
  return rows.length ? '<div class="file-tree">' + rows.join('') + '</div>'
    : '<p class="muted">(none)</p>';
}

/* ---------- specialized: numbered step rail ---------- */
function renderSteps(lines) {
  const steps = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*[-*]\s+(?:\[([ xX~])\]\s*)?(?:(\d+)\.\s*)?(.*)$/);
    if (!m) continue;
    if (!m[3] || !m[3].trim()) continue;
    const checked = m[1] && (m[1] === 'x' || m[1] === 'X');
    steps.push({ done: !!checked, text: m[3] });
  }
  if (!steps.length) return '<p class="muted">(no steps)</p>';
  let n = 0;
  const items = steps.map((s) => {
    n++;
    return '<li class="step' + (s.done ? ' step-done' : '') + '">' +
      '<span class="step-num">' + (s.done ? '&#10003;' : n) + '</span>' +
      '<span class="step-text">' + inline(s.text) + '</span></li>';
  });
  return '<ol class="step-rail">' + items.join('') + '</ol>';
}

/* ---------- specialized: acceptance criteria status chips ---------- */
function renderAC(lines) {
  const items = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*[-*]\s+\[([ xX~])\]\s*(.*)$/);
    if (!m) continue;
    let text = m[2];
    let status, label;
    const failMatch = text.match(/<!--\s*FAIL:?\s*(.*?)-->/i);
    if (m[1] === 'x' || m[1] === 'X') { status = 'done'; label = 'PASS'; }
    else if (failMatch) { status = 'fail'; label = 'FAIL'; }
    else if (m[1] === '~') { status = 'manual'; label = 'MANUAL'; }
    else if (/\bAC_VIS\d/.test(text) || /PLAYWRIGHT/.test(text)) { status = 'deferred'; label = 'PLAYWRIGHT'; }
    else { status = 'pending'; label = 'TODO'; }
    text = text.replace(/<!--[\s\S]*?-->/g, '').trim();
    items.push('<li class="ac ac-' + status + '"><span class="ac-chip">' + label + '</span>' +
      '<span class="ac-text">' + inline(text) + '</span></li>');
  }
  return items.length ? '<ul class="ac-list">' + items.join('') + '</ul>'
    : '<p class="muted">(no acceptance criteria)</p>';
}

/* ---------- specialized: callout list (risks / out-of-scope) ---------- */
function renderCallouts(lines, kind) {
  const items = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*[-*]\s+(.*)$/);
    if (m && m[1].trim()) items.push('<li>' + inline(m[1]) + '</li>');
  }
  if (!items.length) return renderBlocks(lines);
  return '<ul class="callout callout-' + kind + '">' + items.join('') + '</ul>';
}

/* ---------- specialized: business description (non-technical half) ---------- */
function stripComments(lines) {
  const out = [];
  let inC = false;
  for (const raw of lines) {
    let line = raw;
    if (inC) {
      const end = line.indexOf('-->');
      if (end === -1) continue;
      line = line.slice(end + 3);
      inC = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    const open = line.indexOf('<!--');
    if (open !== -1) { line = line.slice(0, open); inC = true; }
    out.push(line);
  }
  return out;
}

function renderBusiness(lines) {
  const clean = stripComments(lines);
  const body = renderBlocks(clean);
  return '<div class="biz">' + (body || '<p class="muted">(no business description)</p>') + '</div>';
}

/* ---------- specialized: markdown pipe table (agent roster) ---------- */
function renderTable(lines) {
  const clean = stripComments(lines);
  const out = [];
  let i = 0;
  while (i < clean.length) {
    const line = clean[i];
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (!isRow) {
      const buf = [];
      while (i < clean.length && !/^\s*\|.*\|\s*$/.test(clean[i])) { buf.push(clean[i]); i++; }
      const blocks = renderBlocks(buf);
      if (blocks) out.push(blocks);
      continue;
    }
    const rows = [];
    while (i < clean.length && /^\s*\|.*\|\s*$/.test(clean[i])) {
      rows.push(clean[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
      i++;
    }
    const isSep = (r) => r.every((c) => /^:?-{2,}:?$/.test(c));
    const head = rows.length > 1 && isSep(rows[1]) ? rows[0] : null;
    const bodyRows = rows.filter((r, idx) => !isSep(r) && !(head && idx === 0));
    const th = head ? '<thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>' : '';
    const tb = '<tbody>' + bodyRows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
    out.push('<div class="table-wrap"><table class="mdtable">' + th + tb + '</table></div>');
  }
  return out.join('\n') || '<p class="muted">(no team roster)</p>';
}

/* ---------- parse the plan file ---------- */
function parsePlan(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  // strip a leading HTML comment block if present
  let i = 0;
  if (/^\s*<!--/.test(lines[0] || '')) {
    while (i < lines.length && !/-->/.test(lines[i])) i++;
    i++;
  }
  // implemented banner (blockquote above H1)
  let banner = '';
  while (i < lines.length && lines[i].trim() === '') i++;
  if (/^\s*>\s*\*\*\[IMPLEMENTED/.test(lines[i] || '')) {
    banner = lines[i].replace(/^\s*>\s?/, '');
    i++;
  }
  while (i < lines.length && lines[i].trim() === '') i++;
  // title
  let title = 'Plan';
  if (/^#\s+/.test(lines[i] || '')) { title = lines[i].replace(/^#\s+/, '').trim(); i++; }
  // meta lines (**Key:** value) until first H2
  const meta = {};
  while (i < lines.length && !/^##\s+/.test(lines[i])) {
    const m = lines[i].match(/^\s*\*\*([^:*]+):\*\*\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim();
    i++;
  }
  // sections
  const sections = [];
  let cur = null;
  for (; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.*)$/);
    if (h) { cur = { title: h[1].trim(), lines: [] }; sections.push(cur); }
    else if (cur) cur.lines.push(lines[i]);
  }
  return { title, meta, banner, sections };
}

/* ---------- section -> HTML (dispatch by title) ---------- */
function renderSection(sec) {
  // Fold diacritics: older plans carry Polish headings; the patterns are ASCII.
  const t = R.foldPolish(sec.title).toLowerCase();
  let body, icon = '';
  if (/^idea/.test(t)) { body = '<p class="muted sec-note">Technical description for the implementer. For the non-technical reader: see the Business description section.</p><div class="lead">' + renderBlocks(stripComments(sec.lines)) + '</div>'; }
  else if (/files to change/.test(t)) { body = renderFileList(sec.lines); icon = 'edit'; }
  else if (/new files/.test(t)) { body = renderFileList(sec.lines); icon = 'plus'; }
  else if (/^steps/.test(t)) { body = renderSteps(sec.lines); icon = 'steps'; }
  else if (/opis biznesowy|business description/.test(t)) { body = renderBusiness(sec.lines); icon = 'biz'; }
  else if (/zespol agentow|agent roster/.test(t)) { body = renderTable(sec.lines); icon = 'team'; }
  else if (/acceptance criteria/.test(t)) { body = renderAC(sec.lines); icon = 'check'; }
  else if (/risks/.test(t)) { body = renderCallouts(sec.lines, 'risk'); icon = 'warn'; }
  else if (/out of scope/.test(t)) { body = renderCallouts(sec.lines, 'scope'); icon = 'minus'; }
  else { body = renderBlocks(sec.lines); }
  const id = 'sec-' + t.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return '<section class="card" id="' + esc(id) + '" data-icon="' + icon + '">' +
    '<h2>' + esc(sec.title) + '</h2>' + body + '</section>';
}

/* ---------- AC progress summary ---------- */
function acSummary(sections) {
  const ac = sections.find((s) => /acceptance criteria/i.test(s.title));
  if (!ac) return null;
  let pass = 0, fail = 0, total = 0;
  for (const raw of ac.lines) {
    const m = raw.match(/^\s*[-*]\s+\[([ xX~])\]\s*(.*)$/);
    if (!m) continue;
    total++;
    if (m[1] === 'x' || m[1] === 'X') pass++;
    else if (/<!--\s*FAIL/i.test(m[2])) fail++;
  }
  return { pass, fail, total };
}

/* ---------- CSS (inlined, self-contained) ---------- */
const CSS = `
:root{
  --green:#00A651;--green-light:#E6F7EE;--green-dark:#008C44;
  --bg:#FFFFFF;--bg2:#F7F8FA;--ink:#1A1A2E;--ink2:#6B7280;--ink3:#9CA3AF;
  --bd:#E5E7EB;--bd2:#F0F1F3;--red:#EF4444;--red-light:#FEF2F2;
  --yellow:#F59E0B;--yellow-light:#FFFBEB;--blue:#3B82F6;--blue-light:#EFF6FF;
  --radius:12px;--shadow-sm:0 1px 2px rgba(0,0,0,.05);--shadow-md:0 4px 6px -1px rgba(0,0,0,.07);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg2);line-height:1.6;-webkit-font-smoothing:antialiased}
.page{max-width:960px;margin:0 auto;padding:32px 24px 64px}
a{color:var(--green-dark);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;background:var(--bg2);border:1px solid var(--bd2);border-radius:5px;padding:1px 5px}
pre.code{background:#0F172A;color:#E2E8F0;border-radius:10px;padding:16px 18px;overflow:auto;margin:12px 0;font-size:13px;line-height:1.55}
pre.code code{background:none;border:0;color:inherit;padding:0;font-size:inherit}
/* header */
.hd{background:var(--bg);border-radius:var(--radius);box-shadow:var(--shadow-md);padding:30px 34px;margin-bottom:22px;border-top:4px solid var(--green)}
.hd .eyebrow{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--green);background:var(--green-light);padding:4px 12px;border-radius:999px;margin-bottom:14px}
.hd h1{font-size:28px;font-weight:800;line-height:1.2;letter-spacing:-.01em}
.banner{background:var(--green-light);border:1px solid var(--green);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;font-weight:600;color:var(--green-dark)}
.meta-row{display:flex;flex-wrap:wrap;gap:16px 32px;margin-top:20px;padding-top:18px;border-top:1px solid var(--bd2)}
.meta .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);font-weight:700}
.meta .v{font-size:14px;font-weight:600}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.pill-draft{background:var(--bg2);color:var(--ink2);border:1px solid var(--bd)}
.pill-done{background:var(--green-light);color:var(--green-dark)}
.pill-partial{background:var(--yellow-light);color:#B45309}
.pill-blocked{background:var(--red-light);color:#B91C1C}
/* progress */
.prog{display:flex;align-items:center;gap:14px;margin-top:16px}
.prog-bar{flex:1;height:8px;background:var(--bg2);border-radius:999px;overflow:hidden}
.prog-fill{height:100%;background:var(--green)}
.prog-txt{font-size:12px;font-weight:700;color:var(--ink2);white-space:nowrap}
/* sections */
section.card{background:var(--bg);border-radius:var(--radius);box-shadow:var(--shadow-sm);padding:24px 30px;margin-bottom:18px;border:1px solid var(--bd2)}
section.card>h2{font-size:18px;font-weight:800;margin-bottom:16px;display:flex;align-items:center;gap:10px}
section.card>h2::before{content:"";width:4px;height:18px;background:var(--green);border-radius:2px}
h3{font-size:15px;font-weight:700;margin:18px 0 8px}h4{font-size:14px;font-weight:700;margin:14px 0 6px}
p{margin-bottom:10px;color:#2d2d40}ul,ol{margin:0 0 12px 22px}li{margin-bottom:5px}
blockquote{border-left:3px solid var(--bd);padding:4px 14px;color:var(--ink2);margin:10px 0}
.muted{color:var(--ink3);font-style:italic}
.lead p{font-size:16px;color:var(--ink2)}
.sec-note{font-size:12px;margin:-4px 0 10px}
/* file tree */
.file-tree{display:flex;flex-direction:column;gap:8px}
.file-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding:9px 12px;background:var(--bg2);border:1px solid var(--bd2);border-radius:8px}
.file-path{background:var(--bg);border:1px solid var(--bd);color:var(--green-dark);font-weight:600}
.file-desc{color:var(--ink2);font-size:14px}
/* step rail */
ol.step-rail{list-style:none;margin:0;padding:0;position:relative}
ol.step-rail::before{content:"";position:absolute;left:13px;top:6px;bottom:6px;width:2px;background:var(--bd)}
li.step{position:relative;display:flex;gap:14px;padding:6px 0 14px 0;align-items:flex-start}
.step-num{flex:none;width:28px;height:28px;border-radius:50%;background:var(--bg);border:2px solid var(--bd);color:var(--ink2);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;z-index:1}
li.step-done .step-num{background:var(--green);border-color:var(--green);color:#fff}
.step-text{padding-top:3px}
/* acceptance criteria */
ul.ac-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
li.ac{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:8px;border:1px solid var(--bd2);background:var(--bg2)}
.ac-chip{flex:none;font-size:10px;font-weight:800;letter-spacing:.04em;padding:3px 8px;border-radius:5px;margin-top:1px}
.ac-text{font-size:14px}
.ac-done{border-color:var(--green)}.ac-done .ac-chip{background:var(--green-light);color:var(--green-dark)}
.ac-fail{border-color:var(--red)}.ac-fail .ac-chip{background:var(--red-light);color:#B91C1C}
.ac-manual .ac-chip{background:var(--yellow-light);color:#B45309}
.ac-deferred .ac-chip{background:var(--blue-light);color:#1D4ED8}
.ac-pending .ac-chip{background:var(--bg);color:var(--ink2);border:1px solid var(--bd)}
/* callouts */
ul.callout{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
ul.callout li{padding:10px 12px 10px 36px;border-radius:8px;position:relative;font-size:14px}
ul.callout-risk li{background:var(--yellow-light);border:1px solid #FDE68A}
ul.callout-risk li::before{content:"!";position:absolute;left:13px;top:9px;width:16px;height:16px;background:var(--yellow);color:#fff;border-radius:50%;font-size:11px;font-weight:800;text-align:center;line-height:16px}
ul.callout-scope li{background:var(--bg2);border:1px dashed var(--bd);color:var(--ink2)}
ul.callout-scope li::before{content:"\\2212";position:absolute;left:14px;top:8px;color:var(--ink3);font-weight:800}
.biz{background:var(--green-light);border:1px solid #BBEBD2;border-left:4px solid var(--green);border-radius:10px;padding:14px 18px}
.biz p{margin:0 0 8px}
.biz p:last-child{margin-bottom:0}
.biz ol{margin:8px 0 12px;padding-left:22px;counter-reset:biz}
.biz ol li{margin:0 0 6px;padding-left:4px}
.biz ul{margin:8px 0 12px;padding-left:22px}
.biz code{background:#fff;border-color:#BBEBD2}
.table-wrap{overflow-x:auto;margin:4px 0}
table.mdtable{border-collapse:collapse;width:100%;font-size:13.5px}
table.mdtable th{text-align:left;background:var(--bg2);border-bottom:2px solid var(--bd);padding:8px 10px;font-weight:700;color:var(--ink2);white-space:nowrap}
table.mdtable td{border-bottom:1px solid var(--bd2);padding:8px 10px;vertical-align:top}
table.mdtable tr:last-child td{border-bottom:0}
footer{text-align:center;color:var(--ink3);font-size:12px;margin-top:24px}
@media print{body{background:#fff}section.card,.hd{box-shadow:none;border:1px solid var(--bd)}}
`;

/* ---------- build the HTML document ---------- */
function build(plan, srcName) {
  const status = (plan.meta.Status || 'draft').toLowerCase().replace(/[^a-z]/g, '') || 'draft';
  const statusClass = ['done', 'partial', 'blocked'].includes(status) ? status : 'draft';
  const metaOrder = ['Surface', 'Perspective(s)', 'Perspectives', 'Date', 'Slug'];
  const metaItems = [];
  metaItems.push('<div class="meta"><div class="l">Status</div><div class="v"><span class="pill pill-' +
    statusClass + '">' + esc(plan.meta.Status || 'draft') + '</span></div></div>');
  const seen = new Set();
  for (const k of metaOrder) {
    if (plan.meta[k] && !seen.has(k.replace(/\(s\)/, ''))) {
      seen.add(k.replace(/\(s\)/, ''));
      metaItems.push('<div class="meta"><div class="l">' + esc(k) + '</div><div class="v">' + inline(plan.meta[k]) + '</div></div>');
    }
  }

  const sum = acSummary(plan.sections);
  let progHtml = '';
  if (sum && sum.total) {
    const pct = Math.round((sum.pass / sum.total) * 100);
    progHtml = '<div class="prog"><div class="prog-bar"><div class="prog-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="prog-txt">' + sum.pass + '/' + sum.total + ' AC' +
      (sum.fail ? ' &middot; ' + sum.fail + ' fail' : '') + '</div></div>';
  }

  const banner = plan.banner ? '<div class="banner">' + inline(plan.banner.replace(/\*\*/g, '')) + '</div>' : '';
  const sectionsHtml = plan.sections.map(renderSection).join('\n');

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(plan.title) + '</title>\n<style>' + CSS + '</style>\n</head>\n<body>\n' +
    '<div class="page">\n' +
    '<header class="hd">' + banner +
    '<span class="eyebrow">Implementation plan</span>' +
    '<h1>' + esc(plan.title) + '</h1>' +
    '<div class="meta-row">' + metaItems.join('') + '</div>' + progHtml +
    '</header>\n' + sectionsHtml + '\n' +
    '<footer>Generated from <code>' + esc(srcName) + '</code> by scripts/plan-to-html.js &middot; a view for people; the .md file is the source of truth</footer>\n' +
    '</div>\n</body>\n</html>\n';
}

/* ---------- main ---------- */
function main() {
  const src = process.argv[2];
  if (!src) {
    console.error('Usage: node scripts/plan-to-html.js <plan.md> [out.html]');
    process.exit(2);
  }
  const out = process.argv[3] || src.replace(/\.md$/i, '') + '.html';
  let md;
  try { md = fs.readFileSync(src, 'utf8'); }
  catch (e) { console.error('Cannot read ' + src + ': ' + e.message); process.exit(1); }
  const plan = parsePlan(md);
  const html = build(plan, path.basename(src));
  fs.writeFileSync(out, html, 'utf8');
  console.log(out);
}

main();
