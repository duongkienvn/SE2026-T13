export const PreferenceTheme = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const;

export const PreferenceDateFormat = {
  DAY_FIRST: 'DD/MM/YYYY',
  MONTH_FIRST: 'MM/DD/YYYY',
  ISO: 'YYYY-MM-DD',
} as const;

export const PreferenceWeekStart = {
  MONDAY: 'monday',
  SUNDAY: 'sunday',
} as const;

export const DEFAULT_USER_PREFERENCES = {
  theme: PreferenceTheme.SYSTEM,
  timeZone: 'UTC',
  dateFormat: PreferenceDateFormat.ISO,
  weekStartsOn: PreferenceWeekStart.MONDAY,
} as const;
