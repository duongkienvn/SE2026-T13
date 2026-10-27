import { isThemePreference, type ThemePreference } from './types';

export type ResolvedTheme = 'light' | 'dark';

/**
 * Last theme a signed-in user saved, so the next load paints in it before the
 * preferences request returns. Read by the boot script in index.html, which
 * only trusts it for the same user id as the stored session token.
 */
export const THEME_CACHE_KEY = 'kanvexa.theme';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

interface CachedTheme {
  userId: string;
  theme: ThemePreference;
}

export function readCachedTheme(userId: string): ThemePreference | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(THEME_CACHE_KEY) ?? 'null',
    ) as Partial<CachedTheme> | null;
    return parsed?.userId === userId && isThemePreference(parsed.theme)
      ? parsed.theme
      : null;
  } catch {
    return null;
  }
}

export function writeCachedTheme(userId: string, theme: ThemePreference) {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ userId, theme }));
  } catch {
    // Storage may be unavailable; the server preference still applies.
  }
}

export function clearCachedTheme() {
  try {
    localStorage.removeItem(THEME_CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

export function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
}
