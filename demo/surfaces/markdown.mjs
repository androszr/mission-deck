// demo/surfaces/markdown.mjs
// The small subset of Markdown the demo's documents use (plans, meeting
// notes, guides, drafts, skill files), rendered the way VS Code's Markdown
// preview ("Open Preview") shows it: headings, paragraphs, ordered, bullet
// and task lists, tables, rules, block quotes and fenced code. Pure and
// DOM-free: node tests import it. Every text is escaped.

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline markdown: `code`, **bold**, *italic*, [text](url) - on escaped text. */
function _inline(text) {
  return _esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a>$1</a>');
}

const _cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** `- [ ] task` / `- [x] task` as a disabled checkbox, like the preview. */
function _item(text) {
  const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
  if (!task) return `<li>${_inline(text)}</li>`;
  const on = task[1] !== ' ';
  return `<li class="vsc-md-task"><input type="checkbox" disabled${on ? ' checked' : ''}> ${_inline(task[2])}</li>`;
}

/**
 * @param {string} md
 * @returns {string} HTML
 */
export function markdownToHtml(md) {
  const lines = String(md).split('\n');
  const out = [];
  let para = [];
  let list = null;
  let quote = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${_inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(_item).join('')}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${_inline(quote.join(' '))}</p></blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  // A YAML frontmatter is not part of the preview body (VS Code hides it).
  let i = 0;
  if (lines[0] && lines[0].trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      flushAll();
      const code = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) { code.push(lines[i]); i += 1; }
      out.push(`<pre><code>${_esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const bq = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) { flushAll(); continue; }
    if (h) { flushAll(); out.push(`<h${h[1].length}>${_inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushAll(); out.push('<hr>'); continue; }
    if (bq) { flushPara(); flushList(); quote.push(bq[1]); continue; }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      flushAll();
      const head = _cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(_cells(lines[i])); i += 1; }
      i -= 1;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${_inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${_inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (ol || ul) {
      flushPara();
      flushQuote();
      const tag = ol ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((ol || ul)[1]);
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return out.join('');
}

/** The tab label VS Code gives a Markdown preview: "Preview <file name>". */
export function previewLabel(file) {
  return 'Preview ' + String(file).slice(String(file).lastIndexOf('/') + 1);
}
