// ── Mission Deck — js/empty-state.js ───────────────────────────────────
// Shared "no data yet — please refresh" placeholder for every module.
// Variants: 'hero' (main views), 'compact' (dashboard cards), 'cell' (table rows).

const HERO_SVG = `
<svg class="empty-hero-svg" viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="80" cy="108" rx="52" ry="6" fill="currentColor" opacity="0.08"/>
  <rect x="34" y="30" width="92" height="70" rx="10" fill="currentColor" fill-opacity="0.09" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5"/>
  <rect x="46" y="44" width="40" height="5" rx="2.5" fill="currentColor" opacity="0.4"/>
  <rect x="46" y="56" width="68" height="5" rx="2.5" fill="currentColor" opacity="0.25"/>
  <rect x="46" y="68" width="54" height="5" rx="2.5" fill="currentColor" opacity="0.25"/>
  <rect x="46" y="80" width="30" height="5" rx="2.5" fill="currentColor" opacity="0.25"/>
  <circle class="empty-hero-pulse" cx="122" cy="34" r="10" fill="currentColor" opacity="0.95"/>
  <path d="M118 34 l3 3 l5 -6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const COMPACT_SVG = `
<svg class="empty-compact-svg" viewBox="0 0 64 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="10" y="10" width="44" height="32" rx="5" fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.2"/>
  <rect x="16" y="18" width="22" height="3" rx="1.5" fill="currentColor" opacity="0.4"/>
  <rect x="16" y="25" width="32" height="3" rx="1.5" fill="currentColor" opacity="0.25"/>
  <rect x="16" y="32" width="18" height="3" rx="1.5" fill="currentColor" opacity="0.25"/>
  <circle class="empty-hero-pulse" cx="50" cy="12" r="5" fill="currentColor"/>
  <path d="M47.8 12 l1.8 1.8 l3 -3.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const REFRESH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`;

const UPLOAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

// ── Pip mascot illustrations ──────────────────────────────────────────────
// Optional `mascot` param on the three builders below swaps the generic inline
// SVG for a pose of Pip, the Mission Deck mascot (assets/mascot/pip-<pose>.svg).
// Each SVG carries its own prefers-reduced-motion rule, so no static swap here.

const MASCOT_SVG_BASE = '/assets/mascot/';

export const MASCOT_POSES = Object.freeze(['idle', 'wave', 'thinking', 'working', 'success', 'error', 'sleeping', 'celebrating']);
const _POSE_SET = new Set(MASCOT_POSES);

/** URL of one mascot pose, or null for an unknown pose. */
export function mascotSrc(pose) {
  return _POSE_SET.has(pose) ? `${MASCOT_SVG_BASE}pip-${pose}.svg` : null;
}

export function mascotImgHtml(pose, size = 'hero') {
  const src = mascotSrc(pose);
  if (!src) return null;
  return `<img src="${src}" alt="" aria-hidden="true" loading="lazy" class="empty-mascot-img empty-mascot-img--${size}" data-mascot-pose="${pose}">`;
}

function buildCta({ refreshKey, importKind, forwardToId, ctaIcon, ctaLabel }) {
  const iconHtml = ctaIcon === 'upload' ? UPLOAD_ICON : ctaIcon === 'refresh' ? REFRESH_ICON : null;
  if (forwardToId) {
    const label = ctaLabel || 'Import file';
    const icon = iconHtml || UPLOAD_ICON;
    return `<button class="empty-hero-cta" data-empty-forward-id="${forwardToId}">${icon}<span>${label}</span></button>`;
  }
  if (refreshKey) {
    const label = ctaLabel || 'Refresh now';
    const icon = iconHtml || REFRESH_ICON;
    return `<button class="empty-hero-cta" data-empty-refresh="${refreshKey}">${icon}<span>${label}</span></button>`;
  }
  if (importKind) {
    const label = ctaLabel || 'Import file';
    const icon = iconHtml || UPLOAD_ICON;
    return `<button class="empty-hero-cta" data-import="${importKind}">${icon}<span>${label}</span></button>`;
  }
  return '';
}

export function emptyHeroHtml({ title, message, refreshKey, importKind, forwardToId, ctaIcon, ctaLabel, mascot } = {}) {
  const t = title || 'No data to show';
  const m = message || 'Refresh the data to see this view. It takes a moment.';
  return `
    <div class="empty-hero">
      ${mascotImgHtml(mascot, 'hero') || HERO_SVG}
      <div class="empty-hero-text">
        <div class="empty-hero-title">${t}</div>
        <div class="empty-hero-msg">${m}</div>
      </div>
      ${buildCta({ refreshKey, importKind, forwardToId, ctaIcon, ctaLabel })}
    </div>`;
}

export function emptyCompactHtml({ title, message, refreshKey, importKind, forwardToId, ctaIcon, ctaLabel, mascot } = {}) {
  const t = title || 'No data';
  const m = message || 'Refresh to see the data.';
  return `
    <div class="empty-compact">
      ${mascotImgHtml(mascot, 'compact') || COMPACT_SVG}
      <div class="empty-compact-title">${t}</div>
      <div class="empty-compact-msg">${m}</div>
      ${buildCta({ refreshKey, importKind, forwardToId, ctaIcon, ctaLabel })}
    </div>`;
}

export function emptyCellHtml({ colspan, title, message, refreshKey, importKind, forwardToId, ctaIcon, ctaLabel, mascot } = {}) {
  const inner = emptyHeroHtml({ title, message, refreshKey, importKind, forwardToId, ctaIcon, ctaLabel, mascot });
  return `<tr class="empty-cell-row"><td colspan="${colspan || 1}">${inner}</td></tr>`;
}

// ── Global click delegation ───────────────────────────────────────────────
// The per-module refresh handlers were attached via querySelectorAll at init,
// so they only see the original static buttons. When the user clicks our CTA,
// forward the click to the existing refresh button for that module.

let delegatorInstalled = false;

export function installEmptyStateDelegator() {
  if (delegatorInstalled) return;
  delegatorInstalled = true;
  document.addEventListener('click', function (e) {
    const refreshCta = e.target.closest('[data-empty-refresh]');
    if (refreshCta) {
      const key = refreshCta.dataset.emptyRefresh;
      const target = document.querySelector(
        `.page-refresh[data-refresh="${key}"], .card-refresh[data-refresh="${key}"]`
      );
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        target.click();
      }
      return;
    }
    const forwardCta = e.target.closest('[data-empty-forward-id]');
    if (forwardCta) {
      const id = forwardCta.dataset.emptyForwardId;
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        target.click();
      }
    }
  });
}
