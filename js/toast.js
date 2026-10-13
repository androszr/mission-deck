// ── Mission Deck — js/toast.js ─────────────────────────────────────────
// Shared DS toast utility. Uses #ds-toast-region + ds.css styles.
// showToast(variant, title, desc?) — variant: 'success' | 'danger' | 'info' | 'warning' | 'neutral'

import { trackEvent } from './analytics.js';

const ICONS = {
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  danger:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  neutral: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

const AUTO_DISMISS_MS = 4000;

// Persistent toast — does not auto-dismiss. Returns { update(variant, title, desc), dismiss() }.
// Pass { spinner: true } to show a rotating spinner instead of the icon.
export function showPersistentToast(variant, title, desc = '', { spinner = false, action = null } = {}) {
  const region = document.getElementById('ds-toast-region');
  if (!region) return { update() {}, dismiss() {} };

  const toast = document.createElement('div');
  toast.className = `ds-toast ds-toast--${variant}`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'ds-toast-icon';
  iconSpan.innerHTML = spinner
    ? '<span class="ds-toast-spinner" aria-hidden="true"></span>'
    : (ICONS[variant] ?? ICONS.neutral);

  const body = document.createElement('div');
  body.className = 'ds-toast-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'ds-toast-title';
  titleEl.textContent = title;
  body.appendChild(titleEl);

  const descEl = document.createElement('div');
  descEl.className = 'ds-toast-desc';
  descEl.textContent = desc;
  descEl.hidden = !desc;
  body.appendChild(descEl);

  if (action) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'ds-toast-action';
    actionBtn.textContent = action.label;
    actionBtn.addEventListener('click', action.onClick);
    body.appendChild(actionBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ds-toast-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';

  toast.appendChild(iconSpan);
  toast.appendChild(body);
  toast.appendChild(closeBtn);

  let autoDismissTimer = null;

  const dismiss = () => {
    if (autoDismissTimer) clearTimeout(autoDismissTimer);
    toast.classList.remove('ds-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  };

  closeBtn.addEventListener('click', dismiss);
  region.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('ds-toast--visible')));

  return {
    update(newVariant, newTitle, newDesc = '', { autoDismiss = true, spinner: keepSpinner = false } = {}) {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      toast.className = `ds-toast ds-toast--${newVariant} ds-toast--visible`;
      // keepSpinner: progress updates keep the rotating spinner instead of swapping in
      // the static variant icon (e.g. live clone/download progress).
      iconSpan.innerHTML = keepSpinner
        ? '<span class="ds-toast-spinner" aria-hidden="true"></span>'
        : (ICONS[newVariant] ?? ICONS.neutral);
      titleEl.textContent = newTitle;
      descEl.textContent = newDesc;
      descEl.hidden = !newDesc;
      if (autoDismiss) autoDismissTimer = setTimeout(dismiss, AUTO_DISMISS_MS);
    },
    dismiss,
  };
}

export function showToast(variant, title, desc = '') {
  trackEvent('Toast Shown', { variant, title });
  const region = document.getElementById('ds-toast-region');
  if (!region) return;

  const toast = document.createElement('div');
  toast.className = `ds-toast ds-toast--${variant}`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'ds-toast-icon';
  iconSpan.innerHTML = ICONS[variant] ?? ICONS.neutral;

  const body = document.createElement('div');
  body.className = 'ds-toast-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'ds-toast-title';
  titleEl.textContent = title;
  body.appendChild(titleEl);

  if (desc) {
    const descEl = document.createElement('div');
    descEl.className = 'ds-toast-desc';
    descEl.textContent = desc;
    body.appendChild(descEl);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ds-toast-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';

  toast.appendChild(iconSpan);
  toast.appendChild(body);
  toast.appendChild(closeBtn);

  const dismiss = () => {
    toast.classList.remove('ds-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  };
  closeBtn.addEventListener('click', dismiss);

  region.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('ds-toast--visible')));
  setTimeout(dismiss, AUTO_DISMISS_MS);
}
