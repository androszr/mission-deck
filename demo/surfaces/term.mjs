// demo/surfaces/term.mjs
// One terminal-line renderer for both terminals the demo shows: the VS Code
// integrated terminal and the cockpit's bottom-docked Claude Code panel.
// The Claude roles are drawn the way the Claude Code v2 CLI draws them:
//   claude    - the welcome box (rounded accent border, version in the top
//               border, greeting, model, cwd; tips and recent activity right)
//   user      - while typed: the input box (rules above and below, "> ",
//               caret, footer "? for shortcuts" / permission mode); once submitted:
//               the muted "> text" block
//   tool      - "⏺ Bash(npm test)" then "  ⎿  summary", body lines and a fold
//               "… +N lines (ctrl+r to expand)"; Update bodies as a diff
//   assistant - "⏺ text" with a hanging indent, streamed
// Before the first tool/assistant line of a run a "✻ Thinking…" spinner shows
// briefly (animated only; replay and reduced motion skip it).
// Shell roles: cmd (shell prompt + typed command), out / ok / warn / err / dim.
// Line shape: { role, text, verb?, summary?, body?: [string], cwd? } - verb
// from TOOL_VERBS in demo/scenario-schema.mjs (default 'Ran'), cwd only on cmd.
// No colour lives here: every tone is a --vsc-* property in demo/vscode.css.

export const SHELL_PROMPT = 'alex@demo mission-deck % ';

/** The prompt for a `cmd` line: its own `cwd` (e.g. '~' before the clone) or the repository. */
export function shellPrompt(cwd) {
  return cwd ? 'alex@demo ' + cwd + ' % ' : SHELL_PROMPT;
}

/** Scenario verbs -> the tool names the real CLI prints. */
const TOOL_NAMES = { Ran: 'Bash', Edit: 'Update', Update: 'Update', Read: 'Read', Write: 'Write', Search: 'Search', Fetch: 'Fetch', Agent: 'Agent' };
const DIFF_TOOLS = new Set(['Update']);
const SPINNER_FRAMES = ['✻', '✶', '✳', '✢', '·', '✢', '✳', '✶'];

/** "1 line", "2 lines". */
export function linePlural(n) {
  return n === 1 ? 'line' : 'lines';
}

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function _welcome(el, cwd) {
  const box = _el('div', 'demo-term-welcome');
  const title = _el('div', 'demo-term-welcome-title');
  title.append(_el('span', 'demo-term-welcome-name', 'Claude Code'), _el('span', 'demo-term-welcome-ver', ' v2.1.4'));
  const cols = _el('div', 'demo-term-welcome-cols');
  const main = _el('div', 'demo-term-welcome-main');
  const star = _el('div', 'demo-term-welcome-star', '✻');
  star.setAttribute('aria-hidden', 'true');
  main.append(
    _el('div', 'demo-term-welcome-hello', 'Welcome back, Alex!'),
    star,
    _el('div', 'demo-term-welcome-dim', 'claude-opus-5-5 · Claude Max'),
    _el('div', 'demo-term-welcome-dim', 'cwd: ' + (cwd || '~/Projects/mission-deck')),
  );
  const side = _el('div', 'demo-term-welcome-side');
  side.append(
    _el('div', 'demo-term-welcome-head', 'Tips for getting started'),
    _el('div', null, 'Run /init to create a CLAUDE.md file with instructions for Claude'),
    _el('div', 'demo-term-welcome-rule'),
    _el('div', 'demo-term-welcome-head', 'Recent activity'),
    _el('div', 'demo-term-welcome-dim', 'No recent activity'),
  );
  cols.append(main, side);
  box.append(title, cols);
  el.appendChild(box);
}

/** "  ⎿  text" - the result row hanging under a tool call. */
function _result(text, cls) {
  const row = _el('div', 'demo-term-result' + (cls ? ' ' + cls : ''));
  const elbow = _el('span', 'demo-term-elbow', '⎿');
  elbow.setAttribute('aria-hidden', 'true');
  row.append(elbow, _el('span', 'demo-term-result-text', text));
  return row;
}

function _tool(el, line) {
  const name = TOOL_NAMES[line.verb || 'Ran'] || line.verb;
  const head = _el('div', 'demo-term-head');
  const dot = _el('span', 'demo-term-dot', '⏺');
  dot.setAttribute('aria-hidden', 'true');
  const call = _el('span', 'demo-term-call');
  call.append(_el('span', 'demo-term-tool', name), '(', _el('span', 'demo-term-cmd', line.text), ')');
  head.append(dot, call);
  el.appendChild(head);

  const body = (line.body || []).slice();
  const diff = DIFF_TOOLS.has(name) && body.some((b) => /^[+-]/.test(b));
  // No summary: the first body line takes the elbow, as in the CLI.
  if (line.summary) el.appendChild(_result(line.summary, 'demo-term-summary'));
  else if (body.length && !diff) el.appendChild(_result(body.shift()));
  if (diff) {
    const shown = body.slice(0, 6);
    shown.forEach((b) => {
      const kind = b.startsWith('+') ? ' demo-term-diff--add' : b.startsWith('-') ? ' demo-term-diff--del' : '';
      el.appendChild(_el('div', 'demo-term-body demo-term-diff' + kind, b));
    });
    if (body.length > shown.length) {
      const n = body.length - shown.length;
      el.appendChild(_el('div', 'demo-term-body demo-term-fold', '… +' + n + ' ' + linePlural(n) + ' (ctrl+r to expand)'));
    }
    return;
  }
  body.slice(0, 2).forEach((b) => el.appendChild(_el('div', 'demo-term-body', b)));
  if (body.length > 2) {
    const n = body.length - 2;
    el.appendChild(_el('div', 'demo-term-body demo-term-fold', '… +' + n + ' ' + linePlural(n) + ' (ctrl+r to expand)'));
  }
}

/**
 * Build one line element. For the typed roles (and the streamed assistant answer) the text node to type into
 * is returned as `typeEl`, empty, so the caller can type into it.
 * @param {{ role: string, text: string, body?: string[] }} line
 * @param {boolean} typed
 * @returns {{ el: HTMLElement, typeEl: HTMLElement|null }}
 */
export function buildLine(line, typed) {
  const el = _el('div', 'demo-term-line demo-term-line--' + line.role);
  let typeEl = null;
  if (line.role === 'cmd' || line.role === 'user') {
    const prompt = _el('span', 'demo-term-prompt', line.role === 'cmd' ? shellPrompt(line.cwd) : '>');
    typeEl = _el('span', 'demo-term-typed');
    if (!typed) typeEl.textContent = line.text;
    el.append(prompt, typeEl);
  } else if (line.role === 'claude') {
    _welcome(el, line.text);
  } else if (line.role === 'tool') {
    _tool(el, line);
  } else if (line.role === 'assistant') {
    const head = _el('div', 'demo-term-head');
    const dot = _el('span', 'demo-term-dot', '⏺');
    dot.setAttribute('aria-hidden', 'true');
    typeEl = _el('span', 'demo-term-text');
    if (!typed) typeEl.textContent = line.text;
    head.append(dot, typeEl);
    el.appendChild(head);
  } else {
    el.textContent = line.text === '' ? ' ' : line.text;
  }
  return { el, typeEl };
}

/** The live input box a prompt is typed into; replaced by the submitted line. */
function _inputBox() {
  const box = _el('div', 'demo-term-input');
  const field = _el('div', 'demo-term-input-field');
  const typed = _el('span', 'demo-term-typed');
  const caret = _el('span', 'demo-term-caret', ' ');
  caret.setAttribute('aria-hidden', 'true');
  const wrap = _el('span', 'demo-term-input-text');
  wrap.append(typed, caret);
  field.append(_el('span', 'demo-term-prompt', '>'), wrap);
  const foot = _el('div', 'demo-term-input-foot');
  foot.append(_el('span', null, '? for shortcuts'), _el('span', 'demo-term-mode', '⏵⏵ auto mode (shift+tab)'));
  box.append(field, foot);
  return { box, typed };
}

/** "✻ Thinking… (esc to interrupt)" for `ms`, its glyph cycling. Removed on every exit. */
async function _think(container, ctx, ms) {
  const row = _el('div', 'demo-term-spinner');
  const glyph = _el('span', 'demo-term-spinner-glyph', SPINNER_FRAMES[0]);
  glyph.setAttribute('aria-hidden', 'true');
  row.append(glyph, _el('span', null, 'Thinking…'), _el('span', 'demo-term-spinner-hint', '(esc to interrupt)'));
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  const step = 90;
  try {
    for (let t = 0, i = 0; t < ms; t += step, i += 1) {
      glyph.textContent = SPINNER_FRAMES[i % SPINNER_FRAMES.length];
      await ctx.sleep(Math.min(step, ms - t));
    }
  } finally {
    row.remove();
  }
}

function _isClaudeTurn(node) {
  return !!node && node.classList && (node.classList.contains('demo-term-line--tool') || node.classList.contains('demo-term-line--assistant'));
}

/**
 * Append lines to a terminal container, typing the typed roles and pacing the
 * rest. `ctx.type(el, text)` and `ctx.sleep(ms)` come from the engine and are
 * instant during a replay. Animated and replayed runs end with the same markup:
 * the input box and the spinner are transient.
 * @param {HTMLElement} container
 * @param {Array<object>} lines
 * @param {object} ctx
 */
export async function appendLines(container, lines, ctx) {
  for (const line of lines) {
    const typed = line.role === 'cmd' || line.role === 'user';
    const streamed = line.role === 'assistant';
    const claudeTurn = line.role === 'tool' || streamed;
    // The spinner opens a run of Claude's work, not every line in it; it
    // spends the pause the line already had, so no step gets longer.
    const think = ctx.animate && claudeTurn && !_isClaudeTurn(container.lastElementChild);
    if (line.role === 'user' && ctx.animate) {
      const { el } = buildLine(line, false);
      const { box, typed: field } = _inputBox();
      container.appendChild(box);
      container.scrollTop = container.scrollHeight;
      try {
        await ctx.type(field, line.text, { speed: 34, paste: line.paste || [] });
        await ctx.sleep(260);
      } finally {
        box.replaceWith(el);
      }
      container.scrollTop = container.scrollHeight;
      continue;
    }
    if (think) await _think(container, ctx, streamed ? 300 : 360);
    const { el, typeEl } = buildLine(line, (typed || streamed) && ctx.animate);
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    if (typed && ctx.animate) {
      await ctx.type(typeEl, line.text, { speed: 34, paste: line.paste || [] });
      await ctx.sleep(260);
    } else if (streamed && ctx.animate) {
      // Claude's answer streams in, fast - it is generated, not typed.
      if (!think) await ctx.sleep(300);
      await ctx.type(typeEl, line.text, { speed: 9 });
      await ctx.sleep(200);
    } else {
      await ctx.sleep(line.role === 'tool' ? (think ? 60 : 420) : line.role === 'assistant' ? 420 : 110);
    }
    container.scrollTop = container.scrollHeight;
  }
}
