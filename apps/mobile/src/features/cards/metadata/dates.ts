import { deriveCardDueStatus } from '@kanban/shared';

export type DateField = 'startDate' | 'dueDate';
export type DatePreferences = {
  timeZone: string;
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  weekStartsOn?: 'monday' | 'sunday';
  theme?: 'light' | 'dark' | 'system';
};
export const utcPreferences: DatePreferences = {
  timeZone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The UTC carrier keeps the picker's wall fields independent of the device and of DST. */
export function wallTime(instant: string | number, zone: string): Date {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, Number(value)]),
  );
  const wall = new Date(0);
  wall.setUTCFullYear(parts.year!, parts.month! - 1, parts.day!);
  wall.setUTCHours(parts.hour!, parts.minute!, parts.second!, 0);
  return wall;
}

export function dateOffset(instant: string | number, zone: string) {
  const ms = new Date(instant).getTime();
  return wallTime(ms, zone).getTime() - Math.floor(ms / 1000) * 1000;
}

/** Match Web: round-trip both sides of a transition, then let the user choose an overlap. */
export function resolveWallTime(wall: Date, zone: string): string[] {
  const ms = wall.getTime();
  const day = 86_400_000;
  const offsets = new Set(
    [ms - day, ms, ms + day].map((at) => dateOffset(at, zone)),
  );
  return [...offsets]
    .map((offset) => ms - offset)
    .filter((instant) => wallTime(instant, zone).getTime() === ms)
    .sort((a, b) => a - b)
    .map((instant) => new Date(instant).toISOString());
}

export function applyPickerValue(
  wall: Date,
  picked: Date,
  mode: 'date' | 'time',
) {
  const next = new Date(wall);
  if (mode === 'date')
    next.setUTCFullYear(
      picked.getUTCFullYear(),
      picked.getUTCMonth(),
      picked.getUTCDate(),
    );
  else next.setUTCHours(picked.getUTCHours(), picked.getUTCMinutes());
  next.setUTCSeconds(0, 0);
  return next;
}

export function formatOffset(instant: string, zone: string) {
  const minutes = Math.round(dateOffset(instant, zone) / 60_000);
  const digits = (n: number) => String(n).padStart(2, '0');
  return `UTC${minutes < 0 ? '−' : '+'}${digits(Math.floor(Math.abs(minutes) / 60))}:${digits(Math.abs(minutes) % 60)}`;
}

export function formatWallTime(
  wall: Date,
  format: DatePreferences['dateFormat'],
) {
  const [date, time] = wall.toISOString().split('T');
  const [year, month, day] = date!.split('-');
  const shown =
    format === 'DD/MM/YYYY'
      ? `${day}/${month}/${year}`
      : format === 'MM/DD/YYYY'
        ? `${month}/${day}/${year}`
        : date!;
  return { date: shown, time: time!.slice(0, 5) };
}

export function describeCardDate(value: string, preferences: DatePreferences) {
  const { date, time } = formatWallTime(
    wallTime(value, preferences.timeZone),
    preferences.dateFormat,
  );
  return {
    short: `${date} · ${time}`,
    absolute:
      new Intl.DateTimeFormat(undefined, {
        timeZone: preferences.timeZone,
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date(value)) +
      `, ${formatOffset(value, preferences.timeZone)}`,
  };
}

export function dateRangeError(
  field: DateField,
  value: string | null,
  counterpart: string | null,
) {
  if (!value || !counterpart) return undefined;
  const difference = Date.parse(value) - Date.parse(counterpart);
  if (field === 'startDate' ? difference > 0 : difference < 0)
    return 'Start date must be before or equal to due date.';
}

export function dueStatus(
  value: string | null,
  timeZone: string,
  now = Date.now(),
) {
  return deriveCardDueStatus(value, new Date(now).toISOString(), timeZone);
}

/** Wake for the deadline or the next minute, which can be local midnight. */
export function dueClockDelay(value: string, now: number) {
  const deadline = Date.parse(value);
  if (deadline < now) return undefined;
  return Math.min(deadline - now + 1, 60_000 - (now % 60_000));
}
