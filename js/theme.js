// Mission Deck -- js/theme.js
// Dark mode theme switcher: Light / Dark / System.
// Persists user choice in localStorage; resolves 'system' via matchMedia and
// writes the RESOLVED value (light|dark) to document.documentElement's
// data-theme attribute. Dependency-free -- must stay boot-safe.
// Module shape mirrors js/demo-mode.js (isDemoMode/setDemoMode).

const LS_KEY = 'cockpit-theme';
const VALID_MODES = ['light', 'dark', 'system'];

// Returns the stored preference ('light'|'dark'|'system'), defaulting to
// 'system' when unset or invalid (privacy modes can throw on access).
export function getTheme() {
  try {
    const stored = localStorage.getItem(LS_KEY);
    return VALID_MODES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

// Persists the preference and immediately applies it.
export function setTheme(value) {
  const mode = VALID_MODES.includes(value) ? value : 'system';
  try {
    localStorage.setItem(LS_KEY, mode);
  } catch { /* ignore SSR / private-mode errors */ }
  applyTheme();
}

// Resolves the current preference ('system' via matchMedia) and writes the
// resolved value (light|dark) to document.documentElement's data-theme attr.
export function applyTheme() {
  const mode = getTheme();
  let resolved = mode;
  if (mode === 'system') {
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light';
  }
  document.documentElement.setAttribute('data-theme', resolved);
}

// Attaches a live OS-theme-change listener. Must be called exactly once at
// boot. Only re-applies when the stored preference is 'system' -- an OS
// theme change must never override an explicit user choice.
export function initThemeListener() {
  if (!window.matchMedia) return;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme();
  });
}
