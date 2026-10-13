// demo/mocks/ch-publishing.mjs
// Painters for chapter `publishing`: the "Publish module to the catalog" window
// of Settings > Modules (js/settings-moduly.js _openPublishModal and the
// result slot _runPublish fills). Footer order is the real one. The installed
// table behind it comes from demo/mocks/ch-new-module.mjs. The "MR:" chip
// opens the merge request page of the GitLab server in a new tab; the mock
// named `publikacja-mr-screen` paints that page as a neutral full-screen
// window (no vendor logo, invented address). Ids start with `dm-publikacja-`.

import { esc, modalShell } from './common.mjs';
import { dsSelect } from './ch-new-module.mjs';

const P = 'dm-publikacja-';

export const PUBLIKACJA_BRANCH = 'module/demo-reports-2026-10-04';

const STATUS_OPTIONS = [
  ['beta', 'beta - works, but still changing'],
  ['stable', 'stable - ready to use'],
  ['deprecated', 'deprecated - being retired'],
];

function statusSelect({ status = 'beta', open = false } = {}) {
  const idx = Math.max(0, STATUS_OPTIONS.findIndex(([v]) => v === status));
  return dsSelect({
    id: P + 'status',
    text: STATUS_OPTIONS[idx][1],
    label: 'Status',
    open,
    options: STATUS_OPTIONS.map(([, label], i) => ({ label, sel: i === idx })),
  });
}

/** The result slot: empty, the "sending" sentence, or the success callout. */
function result({ phase = 'form' } = {}) {
  if (phase === 'sending') return `<div id="${P}result">Creating the branch, sending the files and opening a merge request...</div>`;
  if (phase === 'done') {
    return `<div id="${P}result"><div class="ds-callout ds-callout--success"><div>Sent 6 file(s) to the branch <code>${esc(PUBLIKACJA_BRANCH)}</code>. `
      + `<a href="#" id="${P}mr-link" tabindex="-1">Open the merge request</a></div></div></div>`;
  }
  return `<div id="${P}result" hidden></div>`;
}

function goButton({ busy = false } = {}) {
  return `<button type="button" class="ds-btn ds-btn--primary" id="${P}go"${busy ? ' disabled' : ''}>${busy ? 'Publishing...' : 'Publish'}</button>`;
}

const MR_FILES = [
  ['+', 'modules/demo-reports/module.json'],
  ['+', 'modules/demo-reports/client/index.js'],
  ['+', 'modules/demo-reports/client/style.css'],
  ['+', 'modules/demo-reports/server/index.js'],
  ['+', 'modules/demo-reports/tests/test_demo_reports.mjs'],
  ['+', 'modules/demo-reports/README.md'],
  ['~', 'catalog.json'],
];

/** The merge request page the chip opens: title, state, branch, description, files. */
function mrScreen() {
  const rows = MR_FILES.map(([op, f]) => `<tr><td><span class="ds-badge ds-badge--sm ${op === '+' ? 'ds-badge--green' : 'ds-badge--blue'}">${op === '+' ? 'new' : 'changed'}</span></td><td><code>${esc(f)}</code></td></tr>`).join('');
  return `<div class="onb-screen ${P}mr" id="${P}mr-screen">
      <div class="onb-window ${P}mr-window">
        <div class="onb-window-bar"><span class="onb-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="onb-window-title">gitlab.example.test/team/mission-deck-modules/-/merge_requests/42</span></div>
        <div class="${P}mr-body">
          <div class="${P}mr-head">
            <h2 class="${P}mr-title">Demo reports 0.1.0</h2>
            <span class="ds-badge ds-badge--blue">Open</span>
            <span class="ds-badge ds-badge--yellow" id="${P}mr-state">Waiting for review</span>
          </div>
          <p class="${P}mr-meta">Merge request !42 · <code>${esc(PUBLIKACJA_BRANCH)}</code> → <code>main</code> · author: Alex Morgan</p>
          <div class="ds-card ${P}mr-card">
            <div class="ds-card-body">
              <p class="${P}mr-desc">The team’s reports in one place, with a filter by area.</p>
              <div class="${P}mr-tags"><span class="ds-badge ds-badge--green">stable</span><span class="ds-badge ds-badge--blue">Product</span><span class="ds-badge ds-badge--gray">Knowledge (1)</span></div>
            </div>
          </div>
          <div class="ds-table-wrap"><table class="ds-table ${P}mr-files">
            <thead><tr><th>Change</th><th>File (6 module files and a catalog entry)</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
}

export const MOCKS = {
  'publikacja-mr-screen': () => mrScreen(),
  'publikacja-modal': () => modalShell({
    id: P + 'modal',
    title: 'Publish module to the catalog',
    size: 'md',
    body: `<div class="moduly-publish-form">
        <div class="ds-callout ds-callout--info">
          <div>The <strong>demo-reports</strong> module goes onto a new branch in the shared catalog
          repository, and then a merge request is opened. The <code>main</code> branch is protected,
          so the change goes in only after someone on the team reviews it.</div>
        </div>
        <div class="ds-input-wrap">
          <label class="ds-label" for="${P}area">Area (required)</label>
          <input class="ds-input" id="${P}area" type="text" required value="Product" placeholder="Enter the business area">
        </div>
        <div class="ds-input-wrap">
          <label class="ds-label" for="${P}summary">Short description for the catalog</label>
          <input class="ds-input" id="${P}summary" type="text" maxlength="300" placeholder="One sentence: what this module does">
        </div>
        <div class="ds-input-wrap">
          <label class="ds-label">Status</label>
          ${statusSelect()}
        </div>
        ${result()}
      </div>`,
    footer: `<button type="button" class="ds-btn ds-btn--tertiary" id="${P}cancel">Cancel</button>${goButton()}`,
  }),
  'publikacja-status': (props) => statusSelect(props),
  'publikacja-result': (props) => result(props),
  'publikacja-go': (props) => goButton(props),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Publish module to the catalog', 'Area (required)', 'Short description for the catalog', 'One sentence: what this module does',
  'Status', ...STATUS_OPTIONS.map(([, l]) => l), 'Cancel', 'Publish', 'Publishing...',
  'Creating the branch, sending the files and opening a merge request...', 'Open the merge request',
  'Open', 'Waiting for review', 'Change', 'new', 'changed', 'stable',
];
