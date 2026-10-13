// Convert Markdown to Jira wiki markup (Jira Server REST API v2 expects wiki
// markup in the description field; raw markdown would render as plain text).
// Handles the constructs that appear in our user-story / task templates:
// headers, bold, italic, inline code, fenced code blocks, blockquotes, links,
// lists, tables, horizontal rules, checkboxes. Anything weirder passes through.
//
// Inline-code stashing uses NUL (\x00) as the placeholder sentinel — see the
// regression test in tests/test_md_to_jira_wiki.mjs that pins this against
// inputs like "version 2 of the spec" that previously corrupted to
// "version{{undefined}}of the spec" when the sentinel was a digit-with-spaces.

function mdToJiraWiki(md) {
  if (typeof md !== 'string' || !md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inFence = false;
  let fenceLang = '';
  let inTable = false;

  const transformInline = (s) => {
    let r = s;
    // Stash inline code first (highest priority). NUL (\x00) is never present
    // in user-supplied text and cannot collide with normal digits surrounded
    // by spaces — pinned by the regression test in test_md_to_jira_wiki.mjs.
    const codeStash = [];
    r = r.replace(/`([^`]+)`/g, (_, c) => {
      codeStash.push(c);
      return `\x00${codeStash.length - 1}\x00`;
    });
    // Stash bold spans BEFORE the italic pass — otherwise the bold output
    // `*x*` would be re-matched by the italic regex and collapse to `_x_`.
    const boldStash = [];
    r = r.replace(/\*\*([^*]+)\*\*/g, (_, c) => {
      boldStash.push(c);
      return `\x01${boldStash.length - 1}\x01`;
    });
    r = r.replace(/__([^_]+)__/g, (_, c) => {
      boldStash.push(c);
      return `\x01${boldStash.length - 1}\x01`;
    });
    // Italic (*x* or _x_) → _x_  (avoid eating list bullets — they were handled at line level).
    r = r.replace(/(^|[^\*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1_$2_');
    r = r.replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, '$1_$2_');
    // Links: [text](url) → [text|url]
    r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');
    // Restore bold as *x*.
    r = r.replace(/\x01(\d+)\x01/g, (_, i) => `*${boldStash[Number(i)]}*`);
    // Restore inline code as {{x}}.
    r = r.replace(/\x00(\d+)\x00/g, (_, i) => `{{${codeStash[Number(i)]}}}`);
    return r;
  };

  for (const raw of lines) {
    // Code fence start/end.
    const fenceMatch = raw.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceLang = fenceMatch[1] || '';
        out.push(fenceLang ? `{code:${fenceLang}}` : '{code}');
      } else {
        inFence = false;
        fenceLang = '';
        out.push('{code}');
      }
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }

    // Tables — detect a header row + separator row pair, convert subsequent rows.
    if (raw.match(/^\s*\|.+\|\s*$/)) {
      // Separator row: |---|---|
      if (raw.match(/^\s*\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|\s*$/)) {
        continue;
      }
      const cells = raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => transformInline(c.trim()));
      if (!inTable) {
        out.push('||' + cells.join('||') + '||');
        inTable = true;
      } else {
        out.push('|' + cells.join('|') + '|');
      }
      continue;
    } else if (inTable && raw.trim() === '') {
      inTable = false;
      out.push(raw);
      continue;
    } else {
      inTable = false;
    }

    // Headers
    let m = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      out.push(`h${m[1].length}. ${transformInline(m[2])}`);
      continue;
    }
    // Horizontal rule
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(raw)) {
      out.push('----');
      continue;
    }
    // Blockquote
    m = raw.match(/^\s*>\s?(.*)$/);
    if (m) {
      out.push(`bq. ${transformInline(m[1])}`);
      continue;
    }
    // Unordered list with possible nesting (2-space indent per level)
    m = raw.match(/^(\s*)[-*+]\s+(\[[ xX]\]\s+)?(.*)$/);
    if (m) {
      const depth = Math.floor(m[1].length / 2) + 1;
      const checkbox = m[2] ? (m[2].toLowerCase().includes('x') ? '(/) ' : '(x) ') : '';
      out.push('*'.repeat(depth) + ' ' + checkbox + transformInline(m[3]));
      continue;
    }
    // Ordered list
    m = raw.match(/^(\s*)\d+\.\s+(.*)$/);
    if (m) {
      const depth = Math.floor(m[1].length / 2) + 1;
      out.push('#'.repeat(depth) + ' ' + transformInline(m[2]));
      continue;
    }
    // Plain line
    out.push(transformInline(raw));
  }
  return out.join('\n');
}

module.exports = { mdToJiraWiki };
