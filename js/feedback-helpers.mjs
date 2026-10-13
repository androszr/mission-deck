// ── Mission Deck — js/feedback-helpers.mjs ──────────────────────────
// DOM-free logic shared by server.js (lazy `await import(pathToFileURL(...))`,
// mirroring js/academy-stages.mjs) and js/feedback-modal.js (static
// import in the browser, for "Copy report" and for the error copy when
// a submit fails). ZERO imports, ZERO access to `document` or any Node
// builtin - this file must load unchanged under `node --test`, under the
// server's dynamic import AND in the browser.
//
// Code (function names, error codes, YAML keys, slugs, branch/commit shapes)
// is ASCII. The YAML keys and type ids are a stored wire format shared with
// templates/feedback-report.template.md; text that reaches a person (error
// messages, the markdown body a report becomes) is English.

// -- The YAML frontmatter key set -------------------------------------------
// One source of truth for two sides that would otherwise drift apart:
// buildFeedbackMarkdown (below) and templates/feedback-report.template.md. Nested
// keys as "parent.child", in the exact order the frontmatter is written.
export const FEEDBACK_FRONTMATTER_KEYS = [
  'id',
  'type',
  'title',
  'status',
  'reported_by.slug',
  'reported_by.name',
  'reported_by.email',
  'reported_at',
  'app_info.version',
  'app_info.commit',
  'app_info.platform',
  'context.view',
  'context.url',
  'context.viewport',
  'context.screen',
  'context.user_agent',
  'context.language',
  'attachments',
  'console_errors',
];

const FEEDBACK_TYPES = ['bug', 'idea', 'question'];
// Exported so js/feedback-modal.js can render "120/120" counters and disable
// a 6th attachment slot from the SAME numbers validateFeedbackInput enforces,
// rather than hardcoding a second copy that could drift - the exact failure
// mode the plan calls out for templates/feedback-report.template.md vs
// FEEDBACK_FRONTMATTER_KEYS. The byte-sized attachment limits
// (FEEDBACK_MAX_ATTACHMENT_BYTES, FEEDBACK_MAX_TOTAL_BYTES) stay server.js-only:
// they gate a Buffer this module never sees.
export const FEEDBACK_TITLE_MAX_CHARS = 120;
// This is not one of the attachment byte limits (those live in server.js) -
// it is a CHARACTER limit of the text field, owned by this document-free
// module, because validating the report's structure is its only job.
export const FEEDBACK_DESCRIPTION_MAX_CHARS = 8000;
export const FEEDBACK_MAX_ATTACHMENTS = 5;
export const FEEDBACK_MAX_CONSOLE_ENTRIES = 20;
export const FEEDBACK_CONSOLE_TEXT_MAX_CHARS = 300;

// Accented letters folded to ASCII: the same character-class table as
// _gitlabSlug in server.js, narrowed to the letters that actually show up in
// report titles.
const FEEDBACK_SLUG_TRANSLITERATE = [
  [/[aAà-åąÀ-ÅĄ]/g, 'a'],
  [/[cCçćÇĆ]/g, 'c'],
  [/[eEè-ëęÈ-ËĘ]/g, 'e'],
  [/[lLłŁ]/g, 'l'],
  [/[nNñńÑŃ]/g, 'n'],
  [/[oOò-öøóÒ-ÖØÓ]/g, 'o'],
  [/[sSśŚ]/g, 's'],
  [/[zZżźžŻŹŽ]/g, 'z'],
];

/**
 * ASCII slug from a report title: diacritics folded, every run of
 * anything outside [a-z0-9] collapsed to one hyphen, trimmed at both edges,
 * capped at 48 chars. An empty result (a title with no ASCII-foldable
 * letters at all) falls back to 'report' - validateFeedbackInput already
 * refuses an empty title, so this is a defensive floor, not the normal path.
 * @param {string} title
 * @returns {string}
 */
export function feedbackSlug(title) {
  let s = String(title || '').toLowerCase();
  for (const [re, ch] of FEEDBACK_SLUG_TRANSLITERATE) s = s.replace(re, ch);
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  s = s.slice(0, 48).replace(/^-+|-+$/g, '');
  return s || 'report';
}

/**
 * UTC `YYYYMMDD-HHMMSS`, the same discipline as server.js's own
 * _modulesCatalogBranchStamp - the single canonical timestamp string both
 * feedbackDirName and feedbackBranchName derive from, so a directory and its
 * branch can never disagree about when the report was filed.
 * @param {number} nowMs
 * @returns {string}
 */
export function feedbackStamp(nowMs) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
    + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}

/**
 * `feedback/<dirName>/` directory name: `YYYY-MM-DD-HHMMSS-<type>-<slug>`.
 * Reformats feedbackStamp's `YYYYMMDD-HHMMSS` by inserting dashes into the
 * date portion, rather than computing a second stamp, so the directory and
 * the branch always name the same instant.
 * @param {number} nowMs @param {string} type @param {string} slug
 * @returns {string}
 */
export function feedbackDirName(nowMs, type, slug) {
  const stamp = feedbackStamp(nowMs);
  const dashed = stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + stamp.slice(8);
  return dashed + '-' + type + '-' + slug;
}

/**
 * `feedback/<type>-<YYYYMMDD-HHMMSS>-<slug>` - the `feedback/` prefix
 * (not `module/`) lets the repo maintainer filter merge requests by one
 * branch pattern, mirroring how _repoBranches filters `module/<id>-`.
 * @param {number} nowMs @param {string} type @param {string} slug
 * @returns {string}
 */
export function feedbackBranchName(nowMs, type, slug) {
  return 'feedback/' + type + '-' + feedbackStamp(nowMs) + '-' + slug;
}

/** ASCII commit message: `feedback(<type>): <slug>`. @returns {string} */
export function feedbackCommitMessage(type, slug) {
  return 'feedback(' + type + '): ' + slug;
}

const FEEDBACK_MR_TITLE_PREFIX = {
  bug: 'Feedback (bug): ',
  idea: 'Feedback (idea): ',
  question: 'Feedback (question): ',
};

/**
 * Merge request title: a label naming the report type, plus the
 * human-written title verbatim.
 * @param {string} type @param {string} title @returns {string}
 */
export function feedbackMrTitle(type, title) {
  const prefix = FEEDBACK_MR_TITLE_PREFIX[type] || 'Feedback: ';
  return prefix + String(title || '');
}

/**
 * Structural validation of a submitted report, before any byte or network
 * work. Attachment CONTENT (magic bytes, decoded size) is checked separately
 * server-side - this only checks the shape a person or a client bug could
 * get wrong.
 * @param {object} input raw request body
 * @returns {{ok: true, value: {type: string, title: string, description: string, attachments: object[]}} | {ok: false, error: string}}
 */
export function validateFeedbackInput(input) {
  const type = input && input.type;
  if (!FEEDBACK_TYPES.includes(type)) return { ok: false, error: 'invalid-type' };

  const title = typeof (input && input.title) === 'string' ? input.title.trim() : '';
  if (!title) return { ok: false, error: 'title-required' };
  if (title.length > FEEDBACK_TITLE_MAX_CHARS) return { ok: false, error: 'title-too-long' };

  const description = typeof (input && input.description) === 'string' ? input.description : '';
  if (description.length > FEEDBACK_DESCRIPTION_MAX_CHARS) return { ok: false, error: 'description-too-long' };

  const attachments = Array.isArray(input && input.attachments) ? input.attachments : [];
  if (attachments.length > FEEDBACK_MAX_ATTACHMENTS) return { ok: false, error: 'too-many-attachments' };

  return { ok: true, value: { type, title, description, attachments } };
}

/**
 * Neutralises every run of 3 or more backtick characters by
 * backslash-escaping each backtick in the run - CommonMark treats
 * `` \` `` as a literal backtick, never as a fence delimiter, so a person
 * pasting an unbalanced ``` fence into a free-text field (description, steps,
 * expected, a console error's text) can no longer swallow the rest of
 * buildFeedbackMarkdown's output into an unterminated code block, and a run
 * that happens to match the console block's own fence width can no longer
 * close it early. Runs shorter than 3 (a lone backtick or a pair, both
 * inert in markdown) are left untouched. Tilde runs (`~~~`) get the same
 * treatment - see the body.
 * @param {*} value
 * @returns {string}
 */
function escapeBacktickFences(value) {
  const s = String(value === undefined || value === null ? '' : value);
  // Tildes too: CommonMark opens a fenced block on a run of 3+ `~` exactly as
  // it does on backticks, and a `~~~~~~~~` divider is at least as common in a
  // pasted log or traceback as a stray ``` fence. Same treatment - a
  // backslash between every character keeps the run from ever being
  // contiguous at block level.
  return s.replace(/`{3,}|~{3,}/g, (run) => ('\\' + run[0]).repeat(run.length));
}

/**
 * Caps and sanitizes the client-reported console error ring buffer before it
 * ever reaches the markdown builder or a frontmatter count: at most
 * FEEDBACK_MAX_CONSOLE_ENTRIES entries, each `text` clipped to
 * FEEDBACK_CONSOLE_TEXT_MAX_CHARS - the client's own cap
 * (window.__cockpitErrorLog in js/theme-boot.js) is never trusted as the
 * only enforcement. Backtick runs of 3+ are escaped (escapeBacktickFences)
 * BEFORE the length cap is applied, never after - escaping inflates length,
 * so escaping first and then slicing is what keeps the final `text` at or
 * under FEEDBACK_CONSOLE_TEXT_MAX_CHARS; escaping AFTER a cap that already
 * cut the raw text at the fence width would grow the result past the cap
 * instead of shrinking a fence to safety.
 * @param {Array<{at?: string, kind?: string, text?: string}>} entries
 * @returns {Array<{at: string, kind: string, text: string}>}
 */
export function formatConsoleErrors(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.slice(0, FEEDBACK_MAX_CONSOLE_ENTRIES).map((e) => ({
    // `at` and `kind` land in the same fenced block as `text`, so they get the
    // same escaping - a crafted request is the only way a fence reaches them,
    // but the block's integrity should not depend on the client being honest.
    at: escapeBacktickFences(typeof (e && e.at) === 'string' ? e.at : '').slice(0, 40),
    kind: escapeBacktickFences(typeof (e && e.kind) === 'string' ? e.kind : 'error').slice(0, 40),
    text: escapeBacktickFences((e && e.text) === undefined || (e && e.text) === null ? '' : e.text).slice(0, FEEDBACK_CONSOLE_TEXT_MAX_CHARS),
  }));
}

const FEEDBACK_ERROR_MESSAGES = {
  'invalid-type': 'Unknown report type.',
  'title-required': 'Enter a title for the report.',
  'title-too-long': 'The title is too long (limit 120 characters).',
  'description-too-long': 'The description is too long.',
  'too-many-attachments': 'You can attach at most 5 screenshots.',
  'unsupported-format': 'Unsupported attachment format. PNG, JPG, GIF and WebP are allowed.',
  'too-large': 'The attachments are too large. Reduce the number or size of the screenshots.',
  'invalid-json': 'Invalid report data.',
  'internal': 'An unexpected error occurred. Please try again.',
  'test-mode': 'Feedback reports are disabled in test mode.',
  'no-token': 'No token for sending feedback. Set it up in Settings > Keys.',
  'no-repo-url': 'The app repository address is missing.',
  forbidden: 'The token is not allowed to create branches. Create it again in Settings > Keys - it needs the api scope and the Developer role.',
  unreachable: 'Could not connect to GitLab. Check your network connection (VPN, if your GitLab needs one) and try again.',
  'gitlab-error': 'GitLab refused to save the report.',
  'mr-failed': 'The report reached a branch in the repository, but the merge request could not be opened automatically. Try again in a moment or open it by hand in GitLab.',
};

/**
 * A readable message for any error code this feature can
 * answer with (client validation, server transport). An unknown code still
 * gets a sensible sentence, never a blank string and never the raw code.
 * @param {string} code @returns {string}
 */
export function feedbackErrorMessage(code) {
  return FEEDBACK_ERROR_MESSAGES[code] || 'Could not send the report. Please try again.';
}

/** Escapes a value for a YAML double-quoted scalar. @param {*} value @returns {string} */
function yamlQuote(value) {
  const s = String(value === undefined || value === null ? '' : value);
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** `null` unquoted for a missing value, otherwise a quoted string. */
function yamlValueOrNull(value) {
  return (value === undefined || value === null || value === '') ? 'null' : yamlQuote(value);
}

/**
 * Builds the whole `report.md` file: YAML frontmatter (keys and order
 * from FEEDBACK_FRONTMATTER_KEYS) plus the markdown body. Called from
 * server.js with server-resolved fields (identity, app version, commit,
 * platform) and from js/feedback-modal.js with whatever it knows locally,
 * for the "Copy report" fallback when the submit failed - a caller
 * missing a server-only field passes it as null/undefined and gets `null`
 * in the frontmatter rather than a thrown error.
 *
 * "Steps to reproduce" and "Expected behaviour" render ONLY for
 * type === 'bug'. "Attachments" and "Console errors" are omitted in full when
 * there is nothing to show under them - an empty heading is worse than its
 * absence for whatever parses this file later.
 *
 * @param {object} data
 * @param {string} data.id @param {string} data.type @param {string} data.title
 * @param {string} [data.status]
 * @param {{slug?: string|null, name?: string|null, email?: string|null}} [data.reportedBy]
 * @param {string} data.reportedAt ISO 8601 UTC
 * @param {{version?: string|null, commit?: string|null, platform?: string|null}} [data.app_info]
 * @param {{view?: string, url?: string, viewport?: string, screen?: string, userAgent?: string, language?: string}} [data.context]
 * @param {string} [data.description] @param {string} [data.steps] @param {string} [data.expected]
 * @param {string[]} [data.attachments] relative paths, already named by the server
 * @param {Array<{at: string, kind: string, text: string}>} [data.consoleErrors] already sanitized (formatConsoleErrors)
 * @returns {string}
 */
export function buildFeedbackMarkdown(data) {
  const d = data || {};
  const type = d.type;
  const title = d.title || '';
  const status = d.status || 'new';
  const zp = d.reportedBy || {};
  const app = d.app_info || {};
  const ctx = d.context || {};
  const attachments = Array.isArray(d.attachments) ? d.attachments : [];
  const consoleErrors = Array.isArray(d.consoleErrors) ? d.consoleErrors : [];

  const lines = [];
  lines.push('---');
  lines.push('id: ' + String(d.id || ''));
  lines.push('type: ' + String(type || ''));
  lines.push('title: ' + yamlQuote(title));
  lines.push('status: ' + status);
  lines.push('reported_by:');
  lines.push('  slug: ' + String(zp.slug || 'unknown'));
  lines.push('  name: ' + yamlValueOrNull(zp.name));
  lines.push('  email: ' + yamlValueOrNull(zp.email));
  lines.push('reported_at: ' + String(d.reportedAt || ''));
  lines.push('app_info:');
  lines.push('  version: ' + yamlValueOrNull(app.version));
  lines.push('  commit: ' + yamlValueOrNull(app.commit));
  lines.push('  platform: ' + String(app.platform || 'unknown'));
  lines.push('context:');
  lines.push('  view: ' + yamlQuote(ctx.view || ''));
  lines.push('  url: ' + yamlQuote(ctx.url || ''));
  lines.push('  viewport: ' + yamlQuote(ctx.viewport || ''));
  lines.push('  screen: ' + yamlQuote(ctx.screen || ''));
  lines.push('  user_agent: ' + yamlQuote(ctx.userAgent || ''));
  lines.push('  language: ' + yamlQuote(ctx.language || ''));
  if (attachments.length > 0) {
    lines.push('attachments:');
    for (const p of attachments) lines.push('  - ' + p);
  } else {
    lines.push('attachments: []');
  }
  lines.push('console_errors: ' + consoleErrors.length);
  lines.push('---');
  lines.push('');
  lines.push('# ' + escapeBacktickFences(title));
  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(escapeBacktickFences(d.description || ''));

  if (type === 'bug') {
    lines.push('');
    lines.push('## Steps to reproduce');
    lines.push('');
    lines.push(escapeBacktickFences(d.steps || ''));
    lines.push('');
    lines.push('## Expected behaviour');
    lines.push('');
    lines.push(escapeBacktickFences(d.expected || ''));
  }

  if (attachments.length > 0) {
    lines.push('');
    lines.push('## Attachments');
    lines.push('');
    attachments.forEach((p, i) => {
      lines.push('![Screenshot ' + (i + 1) + '](' + p + ')');
    });
  }

  if (consoleErrors.length > 0) {
    lines.push('');
    lines.push('## Console errors');
    lines.push('');
    // Four backticks, not three: formatConsoleErrors already escapes any
    // run of 3+ backticks inside an entry's own text, but the fence itself
    // must sit one width above the widest run CommonMark still treats as
    // inert (2) plus the widest run this file can still produce unescaped
    // elsewhere, so a four-backtick fence can never be closed early by
    // content it wraps.
    lines.push('````text');
    for (const e of consoleErrors) lines.push(e.at + ' ' + e.kind + ' ' + e.text);
    lines.push('````');
  }

  lines.push('');
  return lines.join('\n');
}
