// demo/mocks/ch-day-cycle.mjs
// Painters for chapter `day-cycle`: the evening "Done for
// today?" modal, its summary and the farewell screen after "Shut down Mission Deck",
// and the morning "Good morning! Let's decrypt the data" modal - the same overlay,
// classes (day-cycle-*), labels and Pip illustrations js/day-cycle-modal.js
// builds. The rows are invented; nothing is sent, wiped or decrypted.
// Ids this file creates start with `koniec-i-start-dnia-`.

import { esc } from './common.mjs';

const P = 'koniec-i-start-dnia-';
const MASCOT = (name) => `<img class="day-cycle-mascot" src="/assets/mascot/pip-${esc(name)}.svg" alt="">`;

/** Sources of the evening, with what wrapUpPlanForRow decides for each. */
export const EVENING = [
  { repo: 'data-tier-0', label: 'Team data', plan: 'push-and-clear' },
  { repo: 'data-reports', label: 'Team reports', plan: 'clear' },
  { repo: 'data-leads', label: 'Lead data', plan: 'clear' },
  { repo: 'data-design', label: 'Design data', plan: 'skip', reason: 'no key' },
  { repo: 'data-rollouts', label: 'Rollout data', plan: 'skip', reason: 'not cloned' },
];

/** Sources the morning decrypts (wrappedUpAt set by the evening). */
export const MORNING = EVENING.filter((r) => r.plan !== 'skip');

function planBadge(r) {
  if (r.plan === 'push-and-clear') return ['yellow', 'will send and clear'];
  if (r.plan === 'clear') return ['green', 'will clear'];
  return ['gray', 'will skip: ' + r.reason];
}

function row(r, tone, text, sub = '') {
  return `<div class="ds-card day-cycle-row" data-repo-id="${esc(r.repo)}" id="${P}row-${esc(r.repo)}">
      <span class="${P}row-text"><span class="day-cycle-row__label">${esc(r.label)}</span>
      <span class="${P}row-sub" id="${P}sub-${esc(r.repo)}">${esc(sub)}</span></span>
      <span class="ds-badge day-cycle-row__badge ds-badge--${esc(tone)}" id="${P}badge-${esc(r.repo)}">${esc(text)}</span>
    </div>`;
}

function overlay(id, title, body, footer, closeX = false) {
  return `<div class="ds-modal-overlay day-cycle-overlay" id="${P}${id}" hidden>
    <div class="ds-modal ds-modal--lg day-cycle-modal" role="dialog" aria-modal="true">
      <div class="ds-modal-header"><span class="ds-modal-title">${esc(title)}</span>${closeX ? '<button type="button" class="ds-modal-close" aria-label="Close">&times;</button>' : ''}</div>
      <div class="ds-modal-body" id="${P}${id}-body">${body}</div>
      <div class="ds-modal-footer" id="${P}${id}-footer">${footer}</div>
    </div>
  </div>`;
}

function wrapupBody() {
  return `${MASCOT('sleeping')}<div class="day-cycle-row-list">${EVENING.map((r) => { const [t, x] = planBadge(r); return row(r, t, x); }).join('')}</div>
    <div class="ds-callout ds-callout--warning">Until the morning the app will look empty - team photos, prototypes, the mural and training progress come back once you decrypt in the morning.</div>`;
}

function wrapupFooter(busy) {
  return `<button type="button" class="ds-btn ds-btn--secondary"${busy ? ' disabled' : ''}>Cancel</button>
    <button type="button" class="ds-btn ds-btn--primary" id="${P}go"${busy ? ' disabled' : ''}>${busy ? 'Working...' : 'Send and clear'}</button>`;
}

const OUTCOMES = {
  'data-tier-0': ['green', 'sent and cleared'],
  'data-reports': ['green', 'cleared'],
  'data-leads': ['green', 'cleared'],
  'data-design': ['gray', 'skipped: no key'],
  'data-rollouts': ['gray', 'skipped: not cloned'],
};

function summaryBody() {
  const rows = EVENING.map((r) => `<div class="ds-card day-cycle-row">
      <span class="day-cycle-row__label">${esc(r.label)}</span>
      <span class="ds-badge ds-badge--${OUTCOMES[r.repo][0]}">${esc(OUTCOMES[r.repo][1])}</span>
    </div>`).join('');
  return `${MASCOT('sleeping')}<div class="day-cycle-row-list">${rows}</div>
    <p class="day-cycle-summary-text">Cleared 3 of 5, sent 1, skipped 2.</p>`;
}

function morningBody(state) {
  const done = state === 'done';
  const rows = MORNING.map((r) => row(r, done ? 'green' : 'yellow', done ? 'decrypted' : 'day already wrapped up')).join('');
  return `<img class="day-cycle-mascot" id="${P}morning-mascot" src="/assets/mascot/pip-${done ? 'success' : 'wave'}.svg" alt="">
    <p class="day-cycle-greeting-name">Hi, Alex!</p>
    <div class="day-cycle-morning-content">
      <div class="day-cycle-row-list">${rows}</div>
      <button type="button" class="ds-btn ds-btn--primary" id="${P}decrypt">Decrypt</button>
    </div>`;
}

export const MOCKS = {
  'koniec-i-start-dnia-wrapup': () => overlay('wrapup', 'Done for today?', wrapupBody(), wrapupFooter(false)),
  'koniec-i-start-dnia-wrapup-footer': ({ busy = true } = {}) => wrapupFooter(busy),
  /** One row repainted in place: badge tone + text, and the live stream line under the label. */
  'koniec-i-start-dnia-row': ({ repo = 'data-tier-0', tone = 'yellow', text = 'sending...', sub = '' } = {}) => row(EVENING.find((r) => r.repo === repo) || EVENING[0], tone, text, sub),
  'koniec-i-start-dnia-summary': () => summaryBody(),
  'koniec-i-start-dnia-summary-footer': () => `<button type="button" class="ds-btn ds-btn--secondary" id="${P}close-window">Close window</button>
    <button type="button" class="ds-btn ds-btn--danger" id="${P}shutdown">Shut down Mission Deck</button>`,
  // wave, not the module's wave: that one ends on an empty
  // frame (js/day-cycle-modal.js), which on a paused demo frame reads as a
  // blank modal. Walking away says the same and keeps looping.
  'koniec-i-start-dnia-farewell': () => `${MASCOT('wave')}
    <h3 class="day-cycle-farewell-title">Mission Deck has shut down</h3>
    <p class="day-cycle-farewell-text">The vault is locked. In the morning start Mission Deck as usual and click "Good morning".</p>`,
  'koniec-i-start-dnia-morning': () => overlay('morning', "Good morning! Let's decrypt the data", morningBody('wrapped'),
    `<button type="button" class="ds-btn ds-btn--secondary" id="${P}morning-close">Close</button>`, true),
  /** props: { busy, done } - `done`: every source decrypted, nothing left to run, so the button stays disabled. */
  'koniec-i-start-dnia-decrypt-btn': ({ busy = true, done = false } = {}) => `<button type="button" class="ds-btn ds-btn--primary" id="${P}decrypt"${busy || done ? ' disabled' : ''}>${busy ? 'Decrypting...' : 'Decrypt'}</button>`,
  'koniec-i-start-dnia-mascot': ({ pose = 'success' } = {}) => `<img class="day-cycle-mascot" id="${P}morning-mascot" src="/assets/mascot/pip-${esc(pose)}.svg" alt="">`,
  /** The empty, encrypted-only Mission Deck overnight: what a stolen laptop shows. */
  'koniec-i-start-dnia-night': () => `<div class="${P}night">
      <img class="${P}night-mascot" src="/assets/mascot/pip-sleeping.svg" alt="">
      <div class="${P}night-title">Night</div>
      <div class="${P}night-lines">
        <div class="ds-card ${P}night-card"><span>data-sub-repositories/ds-data/</span><span class="ds-badge ds-badge--gray">empty</span></div>
        <div class="ds-card ${P}night-card"><span>data-sub-repositories/ds-data-encrypted/</span><span class="ds-badge ds-badge--green">only .enc files</span></div>
        <div class="ds-card ${P}night-card"><span>Mission Deck server</span><span class="ds-badge ds-badge--gray">stopped</span></div>
      </div>
    </div>`,
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Done for today?', 'Cancel', 'Send and clear', 'Working...', 'will send and clear', 'will clear', 'sending...', 'clearing...',
  'sent and cleared', 'cleared', 'skipped: no key', 'skipped: not cloned', 'Close window', 'Shut down Mission Deck',
  'Mission Deck has shut down', "Good morning! Let's decrypt the data", 'Hi, Alex!', 'day already wrapped up', 'Decrypt',
  'Decrypting...', 'decrypted', 'Night', 'empty', 'only .enc files', 'stopped',
  ...EVENING.map((r) => r.label),
];
