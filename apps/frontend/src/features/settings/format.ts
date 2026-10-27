import type { DateFormat, UserPreferences, WeekStart } from './types';

/** P1-01 server defaults, used until a signed-in user's preferences load. */
export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  timeZone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
};

interface DateParts {
  year: string;
  month: string;
  day: string;
}

function arrange({ year, month, day }: DateParts, format: DateFormat) {
  if (format === 'DD/MM/YYYY') return `${day}/${month}/${year}`;
  if (format === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}

/**
 * A calendar date (`YYYY-MM-DD`, e.g. a due date) in the chosen format. It is
 * rearranged as text, never parsed as an instant, so no time zone can shift it.
 */
export function formatCalendarDate(value: string, format: DateFormat): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return arrange({ year, month, day }, format);
}

/** The calendar date of an instant as seen in `timeZone`, in the chosen format. */
export function formatInstantDate(
  instant: Date,
  format: DateFormat,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return arrange(
    { year: part('year'), month: part('month'), day: part('day') },
    format,
  );
}

/** 24-hour "14:05" wall-clock time of an instant in `timeZone`. */
export function formatTimeIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

export const WEEK_START_LABELS: Record<WeekStart, string> = {
  monday: 'Monday',
  sunday: 'Sunday',
};

/** Names Intl still lists under their old spelling; the server accepts both. */
const RENAMED_ZONES: Record<string, string> = {
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Enderbury': 'Pacific/Kanton',
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every IANA zone this browser knows, with UTC and modern names, plus any
 * already-saved zone so a stored value is never silently dropped.
 */
export function listTimeZones(include: string[] = []): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Older browsers: the extra and saved zones still appear.
  }
  const renamed = zones.map((zone) => {
    const modern = RENAMED_ZONES[zone];
    return modern && isValidTimeZone(modern) ? modern : zone;
  });
  return [...new Set(['UTC', ...renamed, ...include])].filter(isValidTimeZone);
}

/** The device's zone, or `null` if the browser does not report a usable one. */
export function deviceTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isValidTimeZone(zone) ? (RENAMED_ZONES[zone] ?? zone) : null;
}
