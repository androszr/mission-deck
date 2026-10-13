// tests/test_feedback_helpers.mjs
// Pure logic behind the feedback report feature (js/feedback-helpers.mjs).
// Real ESM import, no server, no document - node --test picks this up as
// tests/test_*.mjs. Eight cases, per feedback/README.md
// ## Test plan.

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FEEDBACK_FRONTMATTER_KEYS,
  feedbackSlug,
  feedbackDirName,
  feedbackBranchName,
  feedbackCommitMessage,
  feedbackMrTitle,
  buildFeedbackMarkdown,
  validateFeedbackInput,
  feedbackErrorMessage,
  formatConsoleErrors,
} from '../js/feedback-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A fixed instant, UTC: 2026-09-16T14:35:12Z -> stamp 20260916-143512.
const FIXED_NOW_MS = Date.UTC(2026, 8, 16, 14, 35, 12);

// ── 1. feedbackSlug ──────────────────────────────────────────────────────────

test('feedbackSlug: accented letters to ASCII, the rest to a hyphen, trimmed, no hyphen at the edges', () => {
  assert.strictEqual(feedbackSlug('Publish button does not respond'), 'publish-button-does-not-respond');
  assert.strictEqual(feedbackSlug('Łódź connection failed!!! ##'), 'lodz-connection-failed');
  const long = 'a'.repeat(80);
  const slug = feedbackSlug(long);
  assert.ok(slug.length <= 48, `expected <=48 chars, got ${slug.length}`);
  assert.ok(!slug.startsWith('-') && !slug.endsWith('-'), `edges must not be a hyphen: "${slug}"`);
  assert.strictEqual(feedbackSlug(''), 'report');
});

// ── 2. feedbackDirName / feedbackBranchName ──────────────────────────────────

test('feedbackDirName and feedbackBranchName: shape for a fixed stamp, for three types', () => {
  for (const type of ['bug', 'idea', 'question']) {
    const dir = feedbackDirName(FIXED_NOW_MS, type, 'publish-button-does-not-respond');
    assert.strictEqual(dir, '2026-09-16-143512-' + type + '-publish-button-does-not-respond');
    const branch = feedbackBranchName(FIXED_NOW_MS, type, 'publish-button-does-not-respond');
    assert.strictEqual(branch, 'feedback/' + type + '-20260916-143512-publish-button-does-not-respond');
  }
});

// ── 3. feedbackMrTitle / feedbackCommitMessage ───────────────────────────────

test('feedbackMrTitle: three type labels; feedbackCommitMessage: ASCII', () => {
  assert.strictEqual(feedbackMrTitle('bug', 'Publish button does not respond'), 'Feedback (bug): Publish button does not respond');
  assert.strictEqual(feedbackMrTitle('idea', 'Dark theme'), 'Feedback (idea): Dark theme');
  assert.strictEqual(feedbackMrTitle('question', 'How do I reset my password?'), 'Feedback (question): How do I reset my password?');

  const commit = feedbackCommitMessage('bug', 'publish-button-does-not-respond');
  assert.strictEqual(commit, 'feedback(bug): publish-button-does-not-respond');
  assert.ok(/^[\x00-\x7f]*$/.test(commit), `commit message must be pure ASCII: "${commit}"`);
});

// ── 4. Drift gate: template keys == FEEDBACK_FRONTMATTER_KEYS ────────

/**
 * Reads the frontmatter block of a template file and returns its keys as a
 * flat list ("parent.child" for one level of nesting), in file order. Good
 * enough for this file's own simple, hand-written shape - not a YAML parser.
 */
function frontmatterKeys(text) {
  const body = text.replace(/^---\r?\n/, '');
  const end = body.indexOf('\n---');
  const fm = body.slice(0, end === -1 ? body.length : end);
  const lines = fm.split(/\r?\n/).filter((l) => l.trim() !== '');
  const keys = [];
  let parent = null;
  for (let i = 0; i < lines.length; i++) {
    const nested = /^  ([a-z0-9_]+):(.*)$/.exec(lines[i]);
    const top = /^([a-z0-9_]+):(.*)$/.exec(lines[i]);
    if (nested) {
      keys.push((parent || '') + '.' + nested[1]);
      continue;
    }
    if (top) {
      parent = top[1];
      const hasInlineValue = top[2].trim() !== '';
      // A top-level line with nothing after the colon either opens a nested
      // MAPPING (reported_by:, app_info:, context: - next line is
      // "  key: ..."), in which case the key itself is not one of
      // FEEDBACK_FRONTMATTER_KEYS's entries and only its children are, or it
      // opens a block LIST (attachments: - next line is "  - item"), in which
      // case the key IS the leaf. A line with an inline scalar is always a
      // leaf on its own.
      const next = lines[i + 1];
      const opensNestedMap = !hasInlineValue && next && /^  [a-z0-9_]+:/.test(next);
      if (!opensNestedMap) keys.push(top[1]);
    }
  }
  return keys;
}

test('templates/feedback-report.template.md has exactly the key set of FEEDBACK_FRONTMATTER_KEYS', () => {
  const text = fs.readFileSync(path.join(ROOT, 'templates', 'feedback-report.template.md'), 'utf8');
  const keys = frontmatterKeys(text);
  assert.deepStrictEqual(keys, FEEDBACK_FRONTMATTER_KEYS);
});

// ── 5. buildFeedbackMarkdown: headings specific to "bug" ────────────────

test('buildFeedbackMarkdown: bug headings only for the bug type', () => {
  const base = {
    id: '2026-09-16-143512-bug-x', type: 'bug', title: 'Title',
    reportedAt: '2026-09-16T14:35:12.000Z', description: 'Description', steps: 'Step 1', expected: 'Result',
  };
  const bugMd = buildFeedbackMarkdown(base);
  assert.ok(bugMd.includes('## Steps to reproduce'));
  assert.ok(bugMd.includes('## Expected behaviour'));

  for (const type of ['idea', 'question']) {
    const md = buildFeedbackMarkdown({ ...base, type });
    assert.ok(!md.includes('## Steps to reproduce'), `type ${type} must not carry the bug-only heading`);
    assert.ok(!md.includes('## Expected behaviour'), `type ${type} must not carry the bug-only heading`);
  }

  // An unbalanced ``` fence pasted into description (a code snippet, the expected
  // input for a bug report) must never swallow the bug-only headings that
  // follow it into an unterminated code block - buildFeedbackMarkdown
  // escapes every run of 3+ backticks in prose sections before they reach
  // the body.
  const fenced = buildFeedbackMarkdown({
    ...base,
    description: 'Here is the error:\n```js\nfoo()\n',
  });
  const headingLines = fenced.split('\n').filter((l) => l.startsWith('## '));
  assert.ok(headingLines.includes('## Steps to reproduce'), 'heading survives an unbalanced fence in description');
  assert.ok(headingLines.includes('## Expected behaviour'), 'heading survives an unbalanced fence in description');
  assert.ok(fenced.includes('\\`\\`\\`js'), 'the escaped run must appear literally in the body');
  // The other CommonMark fence character: a `~~~~~~~~` divider pasted from a
  // log opens exactly the same unterminated block, so it is escaped the same way.
  const tilded = buildFeedbackMarkdown({ ...base, description: 'Log:\n~~~~~~~~\nstack trace\n' });
  const tildeHeadings = tilded.split('\n').filter((l) => l.startsWith('## '));
  assert.ok(tildeHeadings.includes('## Steps to reproduce'), 'heading survives a tilde fence in description');
  assert.ok(!/^~{3,}/m.test(tilded), 'no line of the output may start with a contiguous tilde run');
  assert.ok(tilded.includes('\\~\\~\\~'), 'the escaped tilde run must appear literally in the body');
});

// ── 6. buildFeedbackMarkdown: attachments and empty sections ─────────────────────

test('buildFeedbackMarkdown: attachments as relative links; no attachments and no errors drop both headings', () => {
  const withAttachments = buildFeedbackMarkdown({
    id: 'x', type: 'idea', title: 'T', reportedAt: '2026-09-16T14:35:12.000Z', description: 'O',
    attachments: ['attachments/01-screenshot.png', 'attachments/02-screenshot.jpg'],
    // consoleErrors is documented as "already sanitized (formatConsoleErrors)"
    // - server.js always runs the raw client entries through it before they
    // reach buildFeedbackMarkdown, so the test does the same rather than
    // constructing the sanitized shape by hand.
    consoleErrors: formatConsoleErrors([
      { at: '2026-09-16T14:34:58.101Z', kind: 'error', text: 'TypeError: x' },
      // A ``` inside a console message must not close the surrounding fence
      // early - formatConsoleErrors escapes the run, and the console block
      // additionally uses a four-backtick fence so a 3-backtick run can
      // never terminate it even if an un-escaped one slipped through.
      { at: '2026-09-16T14:34:59.000Z', kind: 'error', text: 'oops ``` more' },
    ]),
  });
  assert.ok(withAttachments.includes('## Attachments'));
  assert.ok(withAttachments.includes('![Screenshot 1](attachments/01-screenshot.png)'));
  assert.ok(withAttachments.includes('![Screenshot 2](attachments/02-screenshot.jpg)'));
  assert.ok(withAttachments.includes('## Console errors'));
  assert.ok(withAttachments.includes('````text'));
  assert.ok(withAttachments.includes('oops \\`\\`\\` more'), 'the escaped run must appear literally in the console block');
  const consoleLines = withAttachments.split('\n');
  const bareTripleFenceLines = consoleLines.filter((l) => l === '```');
  assert.strictEqual(bareTripleFenceLines.length, 0, 'no bare triple-backtick line - only the four-backtick fence pair may appear');
  assert.strictEqual(consoleLines.filter((l) => l === '````text').length, 1);
  assert.strictEqual(consoleLines.filter((l) => l === '````').length, 1);

  const empty = buildFeedbackMarkdown({
    id: 'x', type: 'idea', title: 'T', reportedAt: '2026-09-16T14:35:12.000Z', description: 'O',
    attachments: [], consoleErrors: [],
  });
  assert.ok(!empty.includes('## Attachments'));
  assert.ok(!empty.includes('## Console errors'));

  // formatConsoleErrors is what feeds consoleErrors above - the client's own
  // ring-buffer cap (js/theme-boot.js) is never trusted as the only
  // enforcement, so this caps independently: 25 raw entries -> 20 kept, and a
  // long text is clipped rather than carried whole.
  const raw = Array.from({ length: 25 }, (_v, i) => ({ at: String(i), kind: 'error', text: 'x'.repeat(400) }));
  const capped = formatConsoleErrors(raw);
  assert.strictEqual(capped.length, 20);
  assert.strictEqual(capped[0].text.length, 300);

  // A ``` run straddling the 300-char cap must be escaped BEFORE the text is
  // sliced, never after: escaping inflates length (3 backticks -> 6 chars),
  // so escaping-then-slicing keeps the result at exactly the cap while
  // carrying the full, intact escaped run; slicing-then-escaping would let
  // the inflation push the final text past FEEDBACK_CONSOLE_TEXT_MAX_CHARS.
  const boundary = formatConsoleErrors([
    { at: 'b', kind: 'error', text: 'x'.repeat(290) + '```' + 'y'.repeat(20) },
  ]);
  assert.strictEqual(boundary[0].text.length, 300, 'the cap must hold even once escaping has inflated the run');
  assert.ok(boundary[0].text.includes('\\`\\`\\`'), 'the escaped run must survive the cap intact, not cut in half');
});

// ── 7. validateFeedbackInput ─────────────────────────────────────────────────

test('validateFeedbackInput: every error has its own code', () => {
  const ok = { type: 'bug', title: 'T', description: 'o', attachments: [] };

  assert.strictEqual(validateFeedbackInput({ ...ok, title: '' }).error, 'title-required');
  assert.strictEqual(validateFeedbackInput({ ...ok, title: 'a'.repeat(121) }).error, 'title-too-long');
  assert.strictEqual(validateFeedbackInput({ ...ok, type: 'complaint' }).error, 'invalid-type');
  assert.strictEqual(
    validateFeedbackInput({ ...ok, attachments: [1, 2, 3, 4, 5, 6] }).error,
    'too-many-attachments',
  );
  assert.strictEqual(validateFeedbackInput({ ...ok, description: 'x'.repeat(8001) }).error, 'description-too-long');

  const good = validateFeedbackInput(ok);
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.value.type, 'bug');
});

// ── 8. feedbackErrorMessage ──────────────────────────────────────────────────

test('feedbackErrorMessage: every known code has a message; an unknown code has a sensible default', () => {
  const knownCodes = [
    'invalid-type', 'title-required', 'title-too-long', 'description-too-long',
    'too-many-attachments', 'unsupported-format', 'too-large', 'invalid-json',
    'internal', 'test-mode', 'no-token', 'no-repo-url', 'forbidden', 'unreachable',
    'gitlab-error', 'mr-failed',
  ];
  for (const code of knownCodes) {
    const message = feedbackErrorMessage(code);
    assert.strictEqual(typeof message, 'string');
    assert.ok(message.length > 0, `code ${code} must not have an empty message`);
    assert.notStrictEqual(message, code, `code ${code} leaked as its own message`);
  }
  const fallback = feedbackErrorMessage('something-entirely-unknown');
  assert.strictEqual(typeof fallback, 'string');
  assert.ok(fallback.length > 0);
});
