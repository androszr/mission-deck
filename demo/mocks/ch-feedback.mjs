// demo/mocks/ch-feedback.mjs
// Painters for chapter `feedback`: the "Send feedback" window behind the
// top-bar question-mark button, in the markup js/feedback-modal.js builds
// (_ensureOverlay, _bodyHtml, _paintThumbs, _setBusyUi, _paintSuccess,
// _paintError) with the real labels, placeholders and footer order (Send
// first, then Cancel). The pasted screenshot is a miniature drawn in CSS, the
// merge request page a neutral window with an invented address, and the
// "MR:" slot gets the "FB" chip the server counts for feedback merge requests
// (FEEDBACK_MR_LABEL). Ids this file creates start with `zgloszenia-`.

import { esc } from './common.mjs';

const P = 'zgloszenia-';

/** Report types, as the segmented control of _bodyHtml names them. */
const TYPES = [['bug', 'Bug'], ['idea', 'Idea'], ['question', 'Question']];

/** The demo's three reports: title, branch stamp and slug the helpers would derive. */
export const ZGLOSZENIA_REPORTS = {
  bug: {
    title: 'The area filter resets after returning to Settings',
    slug: 'the-area-filter-resets-after-returning-to-settings',
    stamp: '20261004-091512',
    desc: 'In the module list I pick the Product area, go to Training and come back — the list shows every area again.',
    steps: '1. Settings > Modules, Product filter. 2. Training. 3. Back to Settings.',
    expected: 'The Product filter stays selected.',
  },
  idea: {
    title: 'Export the module list to CSV',
    slug: 'export-the-module-list-to-csv',
    stamp: '20261004-092240',
    desc: 'An “Export CSV” button above the module list would help with the quarterly review.',
  },
  question: {
    title: 'Where do I find yesterday’s sync log?',
    slug: 'where-do-i-find-yesterdays-sync-log',
  },
};

/** The segmented type picker. props: { type } */
function typePicker({ type = 'bug' } = {}) {
  return `<div class="ds-segmented feedback-modal__type" data-fb-type-group id="${P}type">${TYPES.map(([id, label]) => `
      <button type="button" class="ds-segment${id === type ? ' active' : ''}" data-fb-type="${id}" id="${P}type-${id}">${esc(label)}</button>`).join('')}
    </div>`;
}

/** The screenshot area: drop zone, thumbnails, counter, hint. props: { shots } */
function thumbs({ shots = 0 } = {}) {
  const list = Array.from({ length: shots }, (_, i) => `<div class="feedback-modal__thumb ${P}thumb" id="${P}thumb-${i}">
        <div class="${P}shot" aria-hidden="true"><span class="${P}shot-bar"></span><span class="${P}shot-rail"></span><span class="${P}shot-card"></span><span class="${P}shot-card ${P}shot-card--2"></span></div>
        <button type="button" class="ds-icon-btn ds-icon-btn--sm feedback-modal__thumb-remove" aria-label="Remove screenshot ${i + 1}"><img class="nav-icon" src="/assets/icons/ds/24-ic-trashcan.svg" alt="" aria-hidden="true"></button>
      </div>`).join('');
  return `<div class="feedback-modal__thumbs" data-fb-thumbs id="${P}thumbs">${list}</div>
    <p class="feedback-modal__counter" data-fb-counter id="${P}counter">${shots} / 5</p>`;
}

/** _bodyHtml: type, title, description, bug-only fields, screenshots, status slot. */
function form({ type = 'bug' } = {}) {
  const bugOnly = type === 'bug';
  return `${typePicker({ type })}
    <div class="feedback-modal__field-wrap">
      <div class="ds-input-wrap">
        <label class="ds-label" for="${P}title">Title</label>
        <input type="text" class="ds-input" id="${P}title" maxlength="120" placeholder="Briefly, what is it about" data-fb-title tabindex="-1">
      </div>
      <div class="ds-input-wrap">
        <label class="ds-label" for="${P}desc">Description</label>
        <textarea class="ds-textarea" id="${P}desc" placeholder="Describe what is happening" data-fb-desc tabindex="-1"></textarea>
      </div>
      <div class="ds-input-wrap" data-fb-bug-only id="${P}steps-wrap"${bugOnly ? '' : ' hidden'}>
        <label class="ds-label" for="${P}steps">Steps to reproduce</label>
        <textarea class="ds-textarea" id="${P}steps" placeholder="1. ..." data-fb-steps tabindex="-1"></textarea>
      </div>
      <div class="ds-input-wrap" data-fb-bug-only id="${P}expected-wrap"${bugOnly ? '' : ' hidden'}>
        <label class="ds-label" for="${P}expected">Expected behaviour</label>
        <textarea class="ds-textarea" id="${P}expected" placeholder="What should have happened" data-fb-expected tabindex="-1"></textarea>
      </div>
      <div class="feedback-modal__shots" id="${P}shots">
        <div class="feedback-modal__shots-zone" data-fb-dropzone role="group" aria-label="Screenshots" id="${P}dropzone">
          <p class="feedback-modal__shots-text">Paste a screenshot (Ctrl+V, Cmd+V on a Mac) or pick a file from disk.</p>
          <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-fb-file-btn>Choose file</button>
        </div>
        <div id="${P}thumbs-slot">${thumbs({ shots: 0 })}</div>
        <p class="feedback-modal__hint">Screenshots go to the app repository, which the whole team can see.</p>
      </div>
    </div>
    <div data-fb-status id="${P}status"></div>`;
}

/** _footerHtml, or the busy footer _setBusyUi leaves. props: { busy } */
function footer({ busy = false } = {}) {
  const dis = busy ? ' disabled aria-disabled="true"' : '';
  return `<div class="ds-modal-footer" data-fb-footer id="${P}footer">
      ${busy ? '<p class="feedback-modal__busy-hint" data-fb-busy-hint="1">Sending - please wait a moment.</p>' : ''}
      <button type="button" class="ds-btn ds-btn--primary" data-fb-submit id="${P}submit"${busy ? ' disabled aria-busy="true"' : ''}>Send</button>
      <button type="button" class="ds-btn ds-btn--tertiary" data-fb-cancel id="${P}cancel"${dis}>Cancel</button>
    </div>`;
}

/** The header's X; _setBusyUi disables it while a submit is in flight. */
function closeBtn({ disabled = false } = {}) {
  return `<button type="button" class="ds-modal-close" data-fb-close aria-label="Close" id="${P}close"${disabled ? ' disabled aria-disabled="true"' : ''}>&times;</button>`;
}

/** The whole overlay (_ensureOverlay + a fresh form). */
function modal() {
  return `<div class="ds-modal-overlay" id="${P}modal" hidden>
      <div class="ds-modal ds-modal--lg feedback-modal" role="dialog" aria-modal="true" aria-labelledby="${P}modal-title">
        <div class="ds-modal-header">
          <span class="ds-modal-title" id="${P}modal-title">Send feedback</span>
          ${closeBtn()}
        </div>
        <div class="ds-modal-body" data-fb-body id="${P}body">${form()}</div>
        ${footer()}
      </div>
    </div>`;
}

/** _paintSuccess: callout in the body. */
function success() {
  return `<div class="ds-callout ds-callout--success" id="${P}success">
      <div>
        <p>Report sent. The merge request is waiting for review.</p>
        <p><a href="#" id="${P}mr-link" tabindex="-1">Open the merge request</a></p>
      </div>
    </div>`;
}

/** _paintSuccess: the footer with a single "Close". */
function successFooter() {
  return `<div class="ds-modal-footer" data-fb-footer id="${P}footer">
      <button type="button" class="ds-btn ds-btn--primary" data-fb-success-close id="${P}success-close">Close</button>
    </div>`;
}

/** _paintError with the "Copy report" fallback. props: { message } */
function error({ message = '' } = {}) {
  return `<div class="ds-callout ds-callout--danger" id="${P}error">
      <div>
        <p>${esc(message)}</p>
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-fb-copy id="${P}copy">Copy report</button>
      </div>
    </div>`;
}

/** The "MR:" slot: Module catalog plus "Feedback from the app" (mrChipState). props: { zg } */
function topbarMr({ zg = 0 } = {}) {
  const chip = (short, label, count, id) => {
    const title = count > 0 ? `Open merge requests - ${label}: ${count} to review` : `No open merge requests - ${label}`;
    return `<span class="app-top-bar__mr-chip ds-badge ds-badge--sm ${count > 0 ? 'ds-badge--red' : 'ds-badge--gray'}" id="${id}" title="${esc(title)}" aria-label="${esc(title)}">${esc(short)} ${esc(count)}</span>`;
  };
  return '<span class="app-top-bar__mr-label">MR:</span>'
    + chip('MC', 'Module catalog', 0, P + 'chip-km')
    + chip('FB', 'Feedback from the app', zg, P + 'chip-zg');
}

/** The merge request the server opened, in a neutral window. */
function mrScreen() {
  const r = ZGLOSZENIA_REPORTS.bug;
  const dir = `feedback/2026-10-04-091512-bug-${r.slug}/`;
  const files = [['report.md', 'text and metadata (YAML)'], ['attachments/01-screenshot.png', 'screenshot']];
  const rows = files.map(([f, d]) => `<tr><td><span class="ds-badge ds-badge--sm ds-badge--green">new</span></td><td><code>${esc(dir + f)}</code></td><td>${esc(d)}</td></tr>`).join('');
  const desc = [
    'Type: bug',
    'Reported by: Alex Morgan',
    'View: <code>#settings/modules</code>',
    'Screenshots: 1',
    `Directory: <code>${esc(dir)}</code>`,
  ].map((l) => `<li>${l}</li>`).join('');
  return `<div class="onb-screen ${P}mr" id="${P}mr-screen">
      <div class="onb-window ${P}mr-window">
        <div class="onb-window-bar"><span class="onb-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="onb-window-title">gitlab.example.test/team/mission-deck/-/merge_requests/57</span></div>
        <div class="${P}mr-body">
          <div class="${P}mr-head" id="${P}mr-head">
            <h2 class="${P}mr-title">Feedback (bug): ${esc(r.title)}</h2>
            <span class="ds-badge ds-badge--blue">Open</span>
            <span class="ds-badge ds-badge--yellow">report</span>
          </div>
          <p class="${P}mr-meta">Merge request !57 · <code>report/bug-${esc(r.stamp)}-${esc(r.slug)}</code> → <code>main</code> · branch deleted after merge</p>
          <div class="ds-card" id="${P}mr-desc"><div class="ds-card-body"><p class="${P}mr-lead">Feedback from the Mission Deck app.</p><ul class="${P}mr-desc">${desc}</ul></div></div>
          <div class="ds-table-wrap" id="${P}mr-files"><table class="ds-table">
            <thead><tr><th>Change</th><th>File</th><th>What it is</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          <p class="${P}mr-meta">Commit: <code>feedback(bug): ${esc(r.slug)}</code></p>
        </div>
      </div>
    </div>`;
}

export const MOCKS = {
  /** The "Send feedback" overlay, a fresh form with Bug active. */
  'zgloszenia-modal': () => modal(),
  /** The header's X, disabled while a submit is in flight. props: { disabled } */
  'zgloszenia-close': (p = {}) => closeBtn(p),
  /** The type picker repainted with another type active. props: { type } */
  'zgloszenia-type': (p = {}) => typePicker(p),
  /** Thumbnails and the "N / 5" counter. props: { shots } */
  'zgloszenia-thumbs': (p = {}) => thumbs(p),
  /** Footer: idle or busy. props: { busy } */
  'zgloszenia-footer': (p = {}) => footer(p),
  /** Success callout (body) and its single-button footer. */
  'zgloszenia-success': () => success(),
  'zgloszenia-success-footer': () => successFooter(),
  /** Error callout with "Copy report". props: { message } */
  'zgloszenia-error': (p = {}) => error(p),
  /** "MR:" slot with the "FB" chip. props: { zg } */
  'zgloszenia-topbar-mr': (p = {}) => topbarMr(p),
  /** The merge request page (surface 'screen'). */
  'zgloszenia-mr-screen': () => mrScreen(),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Send feedback', 'Bug', 'Idea', 'Question', 'Title', 'Description', 'Steps to reproduce', 'Expected behaviour',
  'Briefly, what is it about', 'Describe what is happening', 'What should have happened',
  'Paste a screenshot (Ctrl+V, Cmd+V on a Mac) or pick a file from disk.', 'Choose file',
  'Screenshots go to the app repository, which the whole team can see.',
  'Send', 'Cancel', 'Close', 'Sending - please wait a moment.',
  'Report sent. The merge request is waiting for review.', 'Open the merge request', 'Copy report',
  'Feedback from the app', 'Module catalog', 'text and metadata (YAML)', 'screenshot', 'branch deleted after merge',
  ...Object.values(ZGLOSZENIA_REPORTS).flatMap((r) => [r.title, r.desc || '', r.steps || '', r.expected || '']),
];
