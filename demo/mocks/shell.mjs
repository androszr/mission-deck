// demo/mocks/shell.mjs
// The dynamic half of the shell: the top-bar slots js/topbar.js paints from
// its endpoints and the dashboard cards js/dashboard.js paints. Same classes,
// same SVGs, same labels - only the data is invented.

import { esc } from './common.mjs';
import { fruitFaceFor } from '../../assets/avatars/fruit-avatars.mjs';

const BW_KEY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16" aria-hidden="true"><circle cx="8" cy="15" r="3"/><path d="M11 15h9M14 12v6"/><path d="M17 15V9.5a5.5 5.5 0 0 0-11 0"/></svg>';
const TERM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="6 9 9 12 6 15"/><line x1="12" y1="15" x2="17" y2="15"/></svg>';

const DASHBOARD_CARDS = [
  { title: 'Start here', desc: 'First run: tokens, the data repository, Bitwarden.', icon: '<circle cx="12" cy="12" r="9"/><polyline points="10 8 15 12 10 16"/>' },
  { title: 'Academy', desc: 'Training - how to grow your own Mission Deck with Claude Code.', icon: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>' },
  { title: 'Settings', desc: 'Tokens, modules, data sync and agent models.', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
];

export const MOCKS = {
  /** "MR:" label plus one chip, js/topbar.js _renderMrBadges. */
  'topbar-mr': ({ count = 0 } = {}) => `<span class="app-top-bar__mr-label">MR:</span>`
    + `<span class="app-top-bar__mr-chip ds-badge ds-badge--sm ${count > 0 ? 'ds-badge--red' : 'ds-badge--gray'}" title="Open merge requests - Module catalog" aria-label="Open merge requests - Module catalog">MC ${esc(count)}</span>`,

  /** "Active:" dot, label and count, js/topbar.js _renderActiveBadge. */
  'topbar-active': ({ count = 3 } = {}) => `<span class="app-top-bar__active-dot app-top-bar__active-dot--on"></span>`
    + `<span class="app-top-bar__active-label">Active:</span>`
    + `<button type="button" class="app-top-bar__active-badge-btn ds-badge ds-badge--sm ds-badge--gray" title="Active in the last hour - Mission Deck repositories">${esc(count)}</button>`,

  'topbar-terminal': () => `<button type="button" class="sidebar-ai-toggle-btn topbar-term-btn" id="demo-topbar-term-btn" title="Terminal Claude Code (Ctrl+\`)">${TERM_SVG}<span>Terminal</span></button>`,

  'topbar-daycycle': ({ mode = 'wrapup' } = {}) => {
    const morning = mode === 'morning';
    const title = morning ? 'Decrypt the data for a new day' : 'Send changes and clear the data from disk';
    return `<button type="button" class="sidebar-ai-toggle-btn topbar-daycycle-btn${morning ? ' topbar-daycycle-btn--morning' : ''}" title="${title}" aria-label="${title}"><span>${morning ? 'Good morning' : 'End of day'}</span>${morning ? '<span class="topbar-sync-dot"></span>' : ''}</button>`;
  },

  'topbar-sync': ({ pending = false } = {}) => `<button type="button" class="sidebar-ai-toggle-btn topbar-sync-btn${pending ? ' topbar-sync-btn--pending' : ''}" title="Data sync (data-tier-0)">`
    + `<span class="topbar-sync-btn-icon" aria-hidden="true"></span><span>Sync</span><span class="topbar-sync-dot"${pending ? '' : ' hidden'}></span></button>`,

  /** Bitwarden pill: red while locked, green once secrets are loaded. */
  'topbar-bw': ({ unlocked = false } = {}) => {
    const color = unlocked ? 'var(--state-success-text)' : 'var(--state-danger-text)';
    const title = unlocked ? 'Bitwarden - secrets loaded' : 'Bitwarden - locked';
    return `<button type="button" class="sidebar-ai-toggle-btn topbar-bw-btn" id="demo-topbar-bw-btn" style="border-color:${color}" title="${title}"><span style="display:inline-flex;color:${color}">${BW_KEY_SVG}</span><span>Bitwarden</span></button>`;
  },

  'topbar-user': () => '<button type="button" class="app-top-bar__user-btn" title="Alex Morgan" aria-label="Alex Morgan"><span class="app-top-bar__user-initials demo-fruit">' + fruitFaceFor('Alex Morgan') + '</span></button>',

  /** The three entry cards of js/dashboard.js renderDashboardView. */
  'dashboard-cards': () => `<div class="placeholder-hub-grid">${DASHBOARD_CARDS.map((c) => `<div class="placeholder-hub-card" role="button" tabindex="0">`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="32" height="32" style="opacity:.55" aria-hidden="true">${c.icon}</svg>`
    + `<div class="placeholder-hub-card__title">${c.title}</div><div class="placeholder-hub-card__desc">${c.desc}</div></div>`).join('')}</div>`,
};

export const LABELS = [
  'Terminal', 'End of day', 'Good morning', 'Sync', 'Bitwarden', 'Active:',
  ...DASHBOARD_CARDS.map((c) => c.title), ...DASHBOARD_CARDS.map((c) => c.desc),
];
