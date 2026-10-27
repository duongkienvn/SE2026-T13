/** Mirrors `GET/PATCH /api/users/me/preferences` (P1-01). */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const WEEK_STARTS = ['monday', 'sunday'] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

export interface UserPreferences {
  theme: ThemePreference;
  /** IANA time zone name, for example `Asia/Ho_Chi_Minh`. */
  timeZone: string;
  dateFormat: DateFormat;
  weekStartsOn: WeekStart;
}

/** The server rejects an empty body, `null` values and unknown keys. */
export type UpdatePreferencesRequest = Partial<UserPreferences>;

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((theme) => theme === value);
}
