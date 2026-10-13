// ── Mission Deck — js/academy-mural.mjs ────────────────────────
// Pure functions (no document) that turn ONE mural entry's markdown into the
// ANSWERS its tile shows in #view-academy (js/academy.js).
//
// The first version flattened the whole entry into a single 150-character
// excerpt: it stripped `#` but kept the heading TEXT, and blasted `[*_`>-]`
// into spaces globally. The template ships three questions, so the questions
// ate the whole budget and what the person actually wrote never reached the
// card. Here a heading is a LABEL and the lines under it are the ANSWER, so a
// tile can put the answer first and the question in small print.
//
// Kept DOM-free on purpose so tests/test_academy.mjs can exercise it
// under plain `node --test`, no browser, no jsdom.

/** Answer blocks one tile renders. Capped so every tile has a bounded height. */
export const MURAL_TILE_ANSWERS = 2;

/** Per-ANSWER budget (not per tile), so the last block is never guillotined.
 * Sized to the two lines the tile clamps to, so the text and the clamp agree
 * instead of one silently overriding the other. */
export const MURAL_ANSWER_MAX_CHARS = 95;

/** A line that carries no answer: empty, or a bullet marker with nothing after it. */
const BLANK_RE = /^[-–—*_.·\s]*$/;

/**
 * Inline markdown out, plain text in. Targeted patterns, never a character
 * class: `[*_`>-]` globally is exactly what mashed the bullets before.
 * @param {string} text
 * @returns {string}
 */
function _plain(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One line of an answer: list marker, quote marker and checkbox off the front. */
function _plainLine(line) {
  const stripped = String(line || '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s*/, '');
  return _plain(stripped);
}

/**
 * Split an entry into `{label, lines}` sections on its markdown headings.
 * Text before the first heading is one section with an empty label; a
 * server-written YAML header is dropped, so this also works on a raw file.
 *
 * @param {string} content
 * @returns {{label: string, lines: string[]}[]}
 */
export function muralSections(content) {
  let text = String(content || '').replace(/\r\n?/g, '\n');
  const header = /^---\n[\s\S]*?\n---\n?/.exec(text);
  if (header) text = text.slice(header[0].length);

  const sections = [];
  let current = { label: '', lines: [] };
  // A run of blank lines is not a section: without this the newline a YAML
  // header leaves behind would count as one, and so would the gap between two
  // headings.
  const push = () => {
    if (current.label || current.lines.some((l) => !BLANK_RE.test(l))) sections.push(current);
  };

  for (const line of text.split('\n')) {
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      push();
      current = { label: _plain(heading[2]), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  push();
  return sections;
}

/**
 * Shorten to `max` characters on a word boundary when there is one close
 * enough, otherwise mid-word. Adds an ellipsis only when it actually cut.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function muralShorten(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  // A cut landing right after a separator would read as "alfa ·…".
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s·]+$/, '') + '…';
}

/**
 * The answers a tile shows: one block per section that HAS an answer, the
 * question kept as `label` for the small print. Multiple lines of one section
 * join with a middle dot; a section holding only the untouched `- ` of the
 * template is a blank form field, not an answer, so it is skipped.
 *
 * @param {string} content the entry body (markdown)
 * @param {number} [limit] how many blocks at most
 * @returns {{label: string, text: string}[]}
 */
export function muralAnswers(content, limit = MURAL_TILE_ANSWERS) {
  const answers = [];
  for (const section of muralSections(content)) {
    const parts = [];
    for (const line of section.lines) {
      const cleaned = _plainLine(line);
      if (cleaned && !BLANK_RE.test(cleaned)) parts.push(cleaned);
    }
    if (!parts.length) continue;
    answers.push({
      label: section.label,
      text: muralShorten(parts.join(' · '), MURAL_ANSWER_MAX_CHARS),
    });
    if (answers.length >= limit) break;
  }
  return answers;
}
