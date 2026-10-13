'use strict';
// modules/meeting-transcripts/server/report.js
// The HTML meeting report on the shared report template
// templates/meeting-report.template.html (logo embedded as base64, own CSS).
//
// PURE: renderReport(templateHtml, doc) -> html string. The template is
// filled the way the HTML report skill fills it: every component lives
// between <!-- BEGIN component:X --> and <!-- END component:X -->, a component
// with no content is removed whole, a repeatable item (one line, or a <div>
// up to its closing line at the same indent) is copied once per entry and
// its {{TOKENS}} filled. <head>, the CSS and the logo are never touched; no
// <script>, no custom CSS. Every text from the model or the recording is
// HTML-escaped - the only markup is the template's own.

const REPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tldr_strong: { type: 'STRING' },
    tldr_body: { type: 'STRING' },
    participant_roles: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, role: { type: 'STRING' } }, required: ['name', 'role'] },
    },
    topics: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, tag: { type: 'STRING' }, body_md: { type: 'STRING' } },
        required: ['title', 'tag', 'body_md'],
      },
    },
    decisions: { type: 'ARRAY', items: { type: 'STRING' } },
    action_items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          who: { type: 'STRING' }, task: { type: 'STRING' }, when: { type: 'STRING' },
          status: { type: 'STRING', enum: ['open', 'consider', 'done', 'risk'] },
        },
        required: ['who', 'task', 'when', 'status'],
      },
    },
    risks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { level: { type: 'STRING', enum: ['warn', 'risk'] }, strong: { type: 'STRING' }, body: { type: 'STRING' } },
        required: ['level', 'strong', 'body'],
      },
    },
    qa: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { question: { type: 'STRING' }, answer: { type: 'STRING' }, asker: { type: 'STRING' } },
        required: ['question', 'answer', 'asker'],
      },
    },
    open_questions: { type: 'ARRAY', items: { type: 'STRING' } },
    next_steps: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { strong: { type: 'STRING' }, span: { type: 'STRING' } }, required: ['strong', 'span'] },
    },
  },
  required: ['tldr_strong', 'tldr_body', 'participant_roles', 'topics', 'decisions', 'action_items', 'risks', 'qa', 'open_questions', 'next_steps'],
};

const TEMPLATE_LABELS = {
  'meeting-notes-as-is-to-be': 'Process mapping AS IS / TO BE',
  'meeting-notes-contextual-inquiry': 'Contextual inquiry',
  'meeting-notes-decision': 'Decision meeting',
  'meeting-notes-discovery-interview': 'Discovery interview',
  'meeting-notes-kickoff': 'Initiative kickoff',
  'meeting-notes-product-feedback-interview': 'Product feedback',
  'meeting-notes-retrospective': 'Retrospective',
  'meeting-notes-status-update': 'Status update',
};

const STATUS_LABELS = { open: 'to do', consider: 'in progress', done: 'done', risk: 'at risk' };

function buildReportPrompt({ transcriptTxt, summaryMd, speakers, sourceFile }) {
  return 'Prepare the content of an HTML meeting report (' + sourceFile + ') from the transcript and the finished summary. '
    + 'Return JSON matching the schema. Rules:\n'
    + '- Facts from the transcript only; do not invent dates, people or numbers. No content for a section = an empty list.\n'
    + '- tldr_strong: one short concluding sentence; tldr_body: 2-3 sentences expanding on it.\n'
    + '- participant_roles: the role of each person in the meeting (e.g. "facilitator", "PO", "team"), empty when unknown.\n'
    + '- topics: every topic discussed, separately, in the order of the recording; tag = a short status or area (may be empty); '
    + 'body_md = Markdown: paragraphs, "- " lists, optional "#### Title" subsections (e.g. Context / Discussion / Agreements), bold **text**. '
    + 'No tables, links or images.\n'
    + '- action_items: who, what, due date (empty when none was said), status: open | consider | done | risk.\n'
    + '- risks: level "risk" = a blocker, "warn" = a warning.\n'
    + '- qa: question / answer pairs only when the meeting was an interview or a Q&A session.\n'
    + '- next_steps: the next steps; strong = the step, span = a detail.\n'
    + (speakers.length ? '- Participants (use ONLY these names): ' + speakers.join(', ') + '.\n' : '')
    + 'Write in the language spoken in the recording.\n\n'
    + 'SUMMARY:\n' + (summaryMd || '(none)') + '\n\nTRANSCRIPT:\n' + transcriptTxt;
}

// -- escaping and the tiny Markdown subset -----------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]); }

function inlineMd(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Paragraphs, "- " / "* " and "1." lists, "#..#### " headings -> h4. Everything escaped first. */
function mdToHtml(md) {
  const out = [];
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inlineMd(para.join(' ')) + '</p>'); para = []; } };
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flushPara(); closeList(); continue; }
    let m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) { flushPara(); closeList(); out.push('<h4>' + inlineMd(m[1]) + '</h4>'); continue; }
    m = /^[-*]\s+(.*)$/.exec(line);
    const o = /^\d+[.)]\s+(.*)$/.exec(line);
    if (m || o) {
      flushPara();
      const kind = m ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push('<' + kind + '>'); list = kind; }
      out.push('<li>' + inlineMd((m || o)[1]) + '</li>');
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

// -- template filling -------------------------------------------------------

const stripComments = (s) => s.replace(/[ \t]*<!--(?! BEGIN| END)[\s\S]*?-->\n?/g, '');
const removeLine = (s, marker) => s.split('\n').filter((l) => !l.includes(marker)).join('\n');

function _componentRe(name) {
  return new RegExp('[ \\t]*<!-- BEGIN component:' + name + '\\b[^>]*-->\\n([\\s\\S]*?)[ \\t]*<!-- END component:' + name + ' -->\\n?');
}

/** Inner text of one component, its instruction comments removed, or null. */
function componentBlock(tpl, name) {
  const m = _componentRe(name).exec(tpl);
  return m ? stripComments(m[1]) : null;
}

function _setComponent(tpl, name, html) {
  return tpl.replace(_componentRe(name), html ? html.replace(/\$/g, '$$$$') : '');
}

/**
 * The repeatable item inside a block: the line carrying `marker` and, when
 * that line opens a <div> it does not close, every line up to the `</div>`
 * at the same indent. Returns [before, item, after].
 */
function splitItem(block, marker) {
  const lines = block.split('\n');
  const i = lines.findIndex((l) => l.includes(marker));
  if (i < 0) throw new Error('template: no item ' + marker);
  let j = i;
  const opens = (lines[i].match(/<div\b/g) || []).length;
  const closes = (lines[i].match(/<\/div>/g) || []).length;
  if (opens > closes) {
    const indent = /^\s*/.exec(lines[i])[0];
    j = lines.findIndex((l, k) => k > i && l === indent + '</div>');
    if (j < 0) throw new Error('template: unclosed item ' + marker);
  }
  return [lines.slice(0, i).join('\n'), lines.slice(i, j + 1).join('\n'), lines.slice(j + 1).join('\n')];
}

/** {{TOKEN}} -> value; values are already HTML (escaped by the caller). */
function fill(snippet, values) {
  return snippet.replace(/\{\{([A-Z_0-9]+)\}\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : all));
}

function repeat(block, marker, items, toValues, post) {
  const [before, item, after] = splitItem(block, marker);
  const body = items.map((it, i) => {
    let s = fill(item, toValues(it, i));
    if (post) s = post(s, it, i);
    return s;
  }).join('\n');
  return before + '\n' + body + '\n' + after;
}


function initials(name) {
  const anon = /^(?:Speaker|Person)[_ ]?(\d+)$/i.exec(String(name || '').trim());
  if (anon) return 'S' + anon[1];
  const parts = String(name || '').replace(/[_\d]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const ini = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return ini.toUpperCase();
}

function fmtDuration(sec) {
  const t = Math.round(Number(sec) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h ? h + ' h ' + m + ' min' : (m ? m + ' min ' : '') + (t % 60) + ' s';
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTs(sec) {
  const t = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, '0');
  return p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60);
}

/**
 * @param {string} tpl  templates/meeting-report.template.html
 * @param {object} doc  the transcript document (lib.buildOutputDoc) with doc.report
 * @param {{ jsonName?: string }} opts
 */
function renderReport(tpl, doc, opts = {}) {
  const r = doc.report || {};
  const summary = doc.summary || {};
  const speakers = (doc.participants || []).map((p) => p.name);
  const roles = new Map((r.participant_roles || []).map((p) => [p.name, p.role]));
  const tplLabel = TEMPLATE_LABELS[summary.chosen_template] || '';
  const title = doc.title || doc.source_file || 'Meeting';
  let topics = Array.isArray(r.topics) ? r.topics.filter((t) => t && t.title) : [];
  if (!topics.length && summary.summary_md) topics = [{ title: 'Summary', tag: '', body_md: summary.summary_md }];

  let html = tpl.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + esc(title) + '</title>');

  // header (required)
  let header = componentBlock(html, 'header');
  const meta = [
    ['Recorded', fmtDate(doc.recorded_at)],
    ['Processed', fmtDate(doc.processed_at)],
    ['Duration', fmtDuration(doc.duration_sec)],
    ['Meeting type', tplLabel],
    ['Participants', speakers.length ? String(speakers.length) : ''],
  ].filter(([, v]) => v);
  header = fill(header, {
    EYEBROW: esc('Meeting report' + (tplLabel ? ' · ' + tplLabel : '')),
    H1: esc(title),
    SUBTITLE: esc(doc.brief || ''),
  });
  if (!doc.brief) header = removeLine(header, 'class="subtitle"');
  header = repeat(header, 'class="meta-item"', meta, ([k, v]) => ({ META_LABEL: esc(k), META_VALUE: esc(v) }));
  html = _setComponent(html, 'header', stripComments(header));

  // participants
  if (speakers.length) {
    const blk = repeat(componentBlock(html, 'participants'), 'class="person"', speakers, (n) => ({
      INITIALS: esc(initials(n)), NAME: esc(n), ROLE: esc(roles.get(n) || ''),
    }), (s, n) => (roles.get(n) ? s : s.replace(/<span class="role">[^<]*<\/span>/, '')));
    html = _setComponent(html, 'participants', stripComments(blk));
  } else html = _setComponent(html, 'participants', '');

  // tldr (required)
  html = _setComponent(html, 'tldr', stripComments(fill(componentBlock(html, 'tldr'), {
    STRONG: esc(r.tldr_strong || title), BODY: esc(r.tldr_body || doc.brief || ''),
  })));

  // quick facts
  const decisions = (r.decisions || []).filter(Boolean);
  const actions = (r.action_items || []).filter((a) => a && a.task);
  const openQ = (r.open_questions || []).filter(Boolean);
  const facts = [
    [topics.length, 'Topics'], [decisions.length, 'Decisions'], [actions.length, 'Action items'],
    [openQ.length, 'Open questions'], [speakers.length, 'Participants'],
  ];
  html = _setComponent(html, 'quick-facts', stripComments(repeat(componentBlock(html, 'quick-facts'), 'class="kpi"', facts,
    ([n, d]) => ({ NUM: esc(n), UNIT: '', DESC: esc(d) }), (s) => s.replace('<span class="unit"></span>', ''))));

  // topics (required)
  html = _setComponent(html, 'topics', stripComments(repeat(componentBlock(html, 'topics'), 'class="topic"', topics, (t, i) => ({
    IDX: esc(i + 1), TOPIC_TITLE: esc(t.title), TOPIC_TAG: esc(t.tag || ''), TOPIC_BODY: '\u0000BODY' + i + '\u0000',
  }), (s, t, i) => {
    let out = t.tag ? s : s.replace(/<span class="topic-tag">[^<]*<\/span>/, '');
    out = out.replace(/<p>\u0000BODY\d+\u0000<\/p>/, () => mdToHtml(t.body_md) || '<p></p>');
    return out.replace('\u0000BODY' + i + '\u0000', '');
  })));

  // decisions
  html = _setComponent(html, 'decisions', decisions.length
    ? stripComments(repeat(componentBlock(html, 'decisions'), '{{DECISION}}', decisions, (d) => ({ DECISION: inlineMd(d) }))) : '');

  // action items
  html = _setComponent(html, 'action-items', actions.length
    ? stripComments(repeat(componentBlock(html, 'action-items'), '{{NR}}', actions, (a, i) => ({
      NR: esc(i + 1), WHO: esc(a.who || '-'), TASK: esc(a.task), WHEN: esc(a.when || '-'),
      STATUS: esc(STATUS_LABELS[a.status] || STATUS_LABELS.open),
    }), (s, a) => s.replace('class="badge open"', 'class="badge ' + (STATUS_LABELS[a.status] ? a.status : 'open') + '"'))) : '');

  // risks
  const risks = (r.risks || []).filter((x) => x && (x.strong || x.body));
  html = _setComponent(html, 'risks', risks.length
    ? stripComments(repeat(componentBlock(html, 'risks'), 'class="callout warn"', risks, (x) => ({ STRONG: esc(x.strong), BODY: esc(x.body) }),
      (s, x) => (x.level === 'risk' ? s.replace('class="callout warn"', 'class="callout risk"') : s))) : '');

  // qa
  const qa = (r.qa || []).filter((x) => x && x.question);
  html = _setComponent(html, 'qa', qa.length
    ? stripComments(repeat(componentBlock(html, 'qa'), 'class="qa"', qa, (x) => ({ QUESTION: esc(x.question), ANSWER: esc(x.answer), ASKER: esc(x.asker || '') }),
      (s, x) => (x.asker ? s : removeLine(s, 'class="asker"')))) : '');

  // open questions
  html = _setComponent(html, 'open-questions', openQ.length
    ? stripComments(repeat(componentBlock(html, 'open-questions'), '{{OPEN_QUESTION}}', openQ, (q) => ({ OPEN_QUESTION: inlineMd(q) }))) : '');

  // next steps
  const steps = (r.next_steps || []).filter((x) => x && x.strong);
  html = _setComponent(html, 'next-steps', steps.length
    ? stripComments(repeat(componentBlock(html, 'next-steps'), 'class="reco"', steps, (x, i) => ({ ICO: esc(i + 1), STRONG: esc(x.strong), SPAN: esc(x.span || '') }))) : '');

  // footer (required) + the full transcript as one more template card before it
  let footer = fill(componentBlock(html, 'footer'), {
    FOOTER_LINE: esc('Generated in Mission Deck from the recording "' + (doc.source_file || '') + '" · ' + (doc.model || '') + ' · ' + fmtDate(doc.processed_at)),
    SOURCE_URL: esc(opts.jsonName || ''), SOURCE_LABEL: esc('transcript (JSON)'),
  });
  if (!opts.jsonName) footer = removeLine(footer, 'href=');
  const segs = Array.isArray(doc.segments) ? doc.segments : [];
  const transcript = segs.length
    ? '  <section class="card">\n    <h2>Transcript</h2>\n'
      + segs.map((s) => '    <p><strong>' + esc(fmtTs(s.start)) + ' · ' + esc(s.speaker_id || 'Speaker ?') + '</strong><br>' + esc(s.text) + '</p>').join('\n')
      + '\n  </section>\n\n'
    : '';
  html = _setComponent(html, 'footer', transcript + stripComments(footer));
  return html;
}

module.exports = { REPORT_SCHEMA, TEMPLATE_LABELS, buildReportPrompt, renderReport, mdToHtml, esc, splitItem, componentBlock };
