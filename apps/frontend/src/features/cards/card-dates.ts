import { CardDueStatus, deriveCardDueStatus } from '@kanban/shared';
import { formatInstantDate, formatTimeIn } from '../settings/format';
import type { DateFormat } from '../settings/types';

/*
 * P3-03 stores start/due dates as instants. The UI edits them as a wall-clock
 * date + time in the user's saved IANA zone, never the browser's zone.
 */

/** `YYYY-MM-DD` and `HH:mm`, as `<input type="date|time">` use them. */
export interface WallClock {
  date: string;
  time: string;
}

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let result = formatters.get(timeZone);
  if (!result) {
    result = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, result);
  }
  return result;
}

function fieldsAt(ms: number, timeZone: string): Fields & { second: number } {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value ?? NaN);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

/** Wall-clock fields read as if they were UTC (safe for years below 100). */
function utcMs({ year, month, day, hour, minute }: Fields, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** The zone's UTC offset in minutes at an instant. */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const seconds = Math.floor(ms / 1000) * 1000;
  const fields = fieldsAt(seconds, timeZone);
  return Math.round((utcMs(fields, fields.second) - seconds) / 60_000);
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** An instant as the date and minute shown on a clock in `timeZone`. */
export function wallClockOf(instant: string, timeZone: string): WallClock {
  const fields = fieldsAt(new Date(instant).getTime(), timeZone);
  return {
    date: `${pad(fields.year, 4)}-${pad(fields.month)}-${pad(fields.day)}`,
    time: `${pad(fields.hour)}:${pad(fields.minute)}`,
  };
}

function parseWallClock({ date, time }: WallClock): Fields | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const fields = {
    year: Number(day[1]),
    month: Number(day[2]),
    day: Number(day[3]),
    hour: Number(clock[1]),
    minute: Number(clock[2]),
  };
  if (fields.year < 1 || fields.hour > 23 || fields.minute > 59) return null;
  // Rejects 2026-02-30 and similar overflowing days.
  const check = new Date(utcMs(fields));
  if (
    check.getUTCFullYear() !== fields.year ||
    check.getUTCMonth() !== fields.month - 1 ||
    check.getUTCDate() !== fields.day
  )
    return null;
  return fields;
}

export type ZonedInstant =
  | { kind: 'invalid' }
  /** The clock skipped this time (spring forward). */
  | { kind: 'nonexistent' }
  | { kind: 'exact'; instant: string }
  /** The clock showed this time twice (fall back); earliest first. */
  | { kind: 'ambiguous'; instants: [string, string] };

/**
 * Resolves a wall clock in `timeZone` to the instant(s) it names. Offsets are
 * sampled a day either side, which covers every real transition.
 */
export function resolveWallClock(
  value: WallClock,
  timeZone: string,
): ZonedInstant {
  const fields = parseWallClock(value);
  if (!fields) return { kind: 'invalid' };
  const naive = utcMs(fields);
  const offsets = new Set(
    [naive - 86_400_000, naive, naive + 86_400_000].map((ms) =>
      zoneOffsetMinutes(ms, timeZone),
    ),
  );
  const matches = [...offsets]
    .map((offset) => naive - offset * 60_000)
    .filter((ms) => {
      const shown = wallClockOf(new Date(ms).toISOString(), timeZone);
      return shown.date === value.date && shown.time === value.time;
    })
    .sort((a, b) => a - b);
  const unique = [...new Set(matches)].map((ms) => new Date(ms).toISOString());
  if (unique.length === 0) return { kind: 'nonexistent' };
  if (unique.length === 1) return { kind: 'exact', instant: unique[0] };
  return { kind: 'ambiguous', instants: [unique[0], unique[1]] };
}

/** `UTC+07:00`, `UTC−05:00` style label of the offset at an instant. */
export function offsetLabel(instant: string, timeZone: string): string {
  const minutes = zoneOffsetMinutes(new Date(instant).getTime(), timeZone);
  const sign = minutes < 0 ? '−' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** "2026-11-01 14:05" in the user's date format and zone. */
export function formatCardInstant(
  instant: string,
  dateFormat: DateFormat,
  timeZone: string,
): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return `${formatInstantDate(date, dateFormat, timeZone)} ${formatTimeIn(date, timeZone)}`;
}

export const DUE_STATUS_LABELS: Record<CardDueStatus, string> = {
  NO_DUE_DATE: 'No due date',
  OVERDUE: 'Overdue',
  DUE_TODAY: 'Due today',
  UPCOMING: 'Upcoming',
};

/** Shared P3-03 rule; a stored value the helper rejects has no status. */
export function cardDueStatus(
  dueDate: string | null,
  now: number,
  timeZone: string,
): CardDueStatus | null {
  try {
    return deriveCardDueStatus(dueDate, new Date(now).toISOString(), timeZone);
  } catch {
    return null;
  }
}

/** Compact preview; exact preferred date/time remains available in its tooltip. */
export function formatCardPreviewDate(
  instant: string,
  dateFormat: DateFormat,
  timeZone: string,
  now = Date.now(),
): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? '';
  const year = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
  }).format(new Date(now));
  const compact =
    dateFormat === 'DD/MM/YYYY'
      ? `${part('day')} ${part('month')}`
      : `${part('month')} ${part('day')}`;
  return part('year') === year ? compact : `${compact}, ${part('year')}`;
}
