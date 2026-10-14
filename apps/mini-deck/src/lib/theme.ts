export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_PREFS: readonly ThemePref[] = ['light', 'dark', 'system'];
export const THEME_KEY = 'mini-deck.theme';

export function normalizePref(value: unknown): ThemePref {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/** The next preference when the person taps the theme button. */
export function nextPref(pref: ThemePref): ThemePref {
  return THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length];
}

/** Read the saved preference and set `data-theme` on <html>. Called before the first paint. */
export function applyStoredTheme(
  storage: Pick<Storage, 'getItem'>,
  systemDark: boolean,
  root: { dataset: Record<string, string | undefined> },
): Theme {
  let raw: unknown = null;
  try {
    raw = storage.getItem(THEME_KEY);
  } catch {
    raw = null;
  }
  const theme = resolveTheme(normalizePref(raw), systemDark);
  root.dataset.theme = theme;
  return theme;
}
