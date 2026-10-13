// demo/hover-mirror.mjs
// The scene is inert and the autopilot cursor is painted, not real, so the
// browser never puts :hover on anything. The cursor stands in with the
// `demo-hover` class (demo/cursor.mjs); this module makes the REAL shell's
// hover styles answer to it: every `:hover` rule of styles.css and
// css/ds*.css (and of the demo's own sheets, whose chapter CSS copies module
// :hover rules) is re-inserted with `:hover` replaced by
// `:is(.demo-hover, :has(.demo-hover))` (a real :hover also matches every
// ancestor of the hovered element), inside the same @media / @supports
// wrapper. A selector the browser refuses (nested :has) falls back to plain
// `.demo-hover`. Rules that would move layout under the camera (sizes,
// margins, position) are skipped - a hover must never shift the scene.
//
// The shell mirror is inserted right after the last shell sheet, so the
// cascade order matches the real app and demo/*.css still wins; the demo
// mirror goes after the last demo sheet.

const SHELL_SHEET_RE = /(?:^|[/_])(?:styles\.css|css(?:\/|__)ds[\w-]*\.css)(?:[?#]|$)/;
/** The demo's own sheets (chapter CSS copies module :hover rules that never fire either). */
const DEMO_SHEET_RE = /(?:^|[/_])(?:demo|vscode|chapters)\.css(?:[?#]|$)/;
const HOVER_RE = /:hover\b/g;
const FULL = ':is(.demo-hover, :has(.demo-hover))';
const PLAIN = '.demo-hover';
/** Properties a hover must not change in the demo: they move the layout. */
const LAYOUT_PROPS = /^(?:width|height|min-|max-|margin|padding|display|position|top|left|right|bottom|inset|grid|flex|font-size|line-height|border-width)/;

function _shiftsLayout(style) {
  for (let i = 0; i < style.length; i += 1) {
    if (LAYOUT_PROPS.test(style[i])) return true;
  }
  return false;
}

function _rulesOf(sheetOrRule) {
  try { return sheetOrRule.cssRules || null; } catch (_e) { return null; }
}

/**
 * Mirrored rule texts for one rule list. Grouping rules (@media, @supports)
 * are kept as wrappers around their mirrored children.
 * @param {CSSRuleList} rules
 * @returns {Array<{ full: string, plain: string }|{ wrap: string, inner: Array }>}
 */
function _collect(rules) {
  const out = [];
  for (const rule of rules) {
    if (rule.type === 1) { // CSSStyleRule
      const sel = rule.selectorText || '';
      if (!sel.includes(':hover') || _shiftsLayout(rule.style)) continue;
      const body = rule.style.cssText;
      if (!body) continue;
      out.push({ full: `${sel.replace(HOVER_RE, FULL)} { ${body} }`, plain: `${sel.replace(HOVER_RE, PLAIN)} { ${body} }` });
    } else if (rule.type === 3) { // @import (demo/chapters.css pulls in every chapter sheet)
      const inner = rule.styleSheet && _rulesOf(rule.styleSheet);
      if (inner) out.push(..._collect(inner));
    } else if (rule.type === 4 || rule.type === 12) { // @media, @supports
      const inner = _rulesOf(rule);
      if (!inner) continue;
      const kids = _collect(inner);
      if (!kids.length) continue;
      const head = rule.type === 4 ? `@media ${rule.conditionText || rule.media.mediaText}` : `@supports ${rule.conditionText}`;
      out.push({ wrap: head, inner: kids });
    }
  }
  return out;
}

function _insert(target, items) {
  let n = 0;
  for (const it of items) {
    if (it.wrap) {
      let idx;
      try { idx = target.insertRule(`${it.wrap} {}`, target.cssRules.length); } catch (_e) { continue; }
      n += _insert(target.cssRules[idx], it.inner);
      continue;
    }
    try { target.insertRule(it.full, target.cssRules.length); n += 1; continue; } catch (_e) { /* nested :has - plain fallback */ }
    try { target.insertRule(it.plain, target.cssRules.length); n += 1; } catch (_e) { /* not mirrorable */ }
  }
  return n;
}

function _whenLoaded(links) {
  return Promise.all(links.map((l) => (l.sheet ? null : new Promise((res) => {
    l.addEventListener('load', res, { once: true });
    l.addEventListener('error', res, { once: true });
  }))));
}

/** One mirror sheet right after `links`' last element. */
function _mirror(doc, links, id) {
  const style = doc.createElement('style');
  style.id = id;
  links[links.length - 1].after(style);
  let n = 0;
  for (const l of links) {
    const rules = l.sheet && _rulesOf(l.sheet);
    if (rules) n += _insert(style.sheet, _collect(rules));
  }
  return n;
}

/**
 * Build the mirrors once the stylesheets have loaded: the shell's right
 * after the shell sheets (the real cascade order, demo/*.css still wins),
 * the demo's own after the last demo sheet.
 * @param {Document} [doc]
 * @returns {Promise<number>} the number of mirrored rules
 */
export async function installHoverMirror(doc = document) {
  if (doc.getElementById('demo-hover-mirror')) return 0;
  const sheets = [...doc.querySelectorAll('link[rel="stylesheet"]')];
  const shell = sheets.filter((l) => SHELL_SHEET_RE.test(l.getAttribute('href') || ''));
  const own = sheets.filter((l) => DEMO_SHEET_RE.test(l.getAttribute('href') || ''));
  await _whenLoaded(shell.concat(own));
  let n = 0;
  if (shell.length) n += _mirror(doc, shell, 'demo-hover-mirror');
  if (own.length) n += _mirror(doc, own, 'demo-hover-mirror-own');
  return n;
}
