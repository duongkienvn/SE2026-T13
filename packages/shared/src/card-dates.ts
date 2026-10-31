/** JSON date fields are instants, never civil dates. Request omission preserves. */
export interface CardDateFields {
  readonly startDate: string | null;
  readonly dueDate: string | null;
}
export interface CardDateInput {
  readonly startDate?: string | null;
  readonly dueDate?: string | null;
}

/** Extended calendar ISO date-time with explicit Z/offset, normalized to JS milliseconds.
 * Fractions beyond milliseconds are truncated, preserving existing dueDate behavior.
 * Bare civil dates, local wall clocks, leap seconds and component overflow are rejected.
 */
export function parseCardDateInstant(value: unknown): Date {
  if (typeof value !== 'string')
    throw new RangeError('Expected an ISO date-time with timezone');
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) throw new RangeError('Expected an ISO date-time with timezone');
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const hour = Number(match[4]),
    minute = Number(match[5]),
    second = Number(match[6] ?? 0);
  const offsetHour = Number(match[10] ?? 0),
    offsetMinute = Number(match[11] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  )
    throw new RangeError('Invalid date-time components');
  // After component validation, the platform parses the explicit ISO offset.
  const instant = new Date(value);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.getUTCFullYear() < 1 ||
    instant.getUTCFullYear() > 9999
  )
    throw new RangeError('Date-time exceeds supported UTC years');
  return instant;
}

export function isCardDateInstant(value: unknown): value is string {
  try {
    parseCardDateInstant(value);
    return true;
  } catch {
    return false;
  }
}

export const CardDueStatus = {
  NO_DUE_DATE: 'NO_DUE_DATE',
  OVERDUE: 'OVERDUE',
  DUE_TODAY: 'DUE_TODAY',
  UPCOMING: 'UPCOMING',
} as const;
export type CardDueStatus = (typeof CardDueStatus)[keyof typeof CardDueStatus];

/** Named IANA zones only, matching User Preferences; fixed numeric offsets are not zones. */
function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  if (
    typeof timeZone !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timeZone)
  )
    throw new RangeError('Expected a named IANA time zone');
  return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    era: 'short',
    month: '2-digit',
    day: '2-digit',
  });
}
function civilDay(instant: Date, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(instant);
  const part = (name: string) =>
    parts.find((part) => part.type === name)!.value;
  const year =
    part('era') === 'BC' ? 1 - Number(part('year')) : Number(part('year'));
  const isoYear =
    year >= 0 && year <= 9999
      ? String(year).padStart(4, '0')
      : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
  return `${isoYear}-${part('month')}-${part('day')}`;
}
/** Display projection only; never converts a civil date into an instant. */
export function cardDateInZone(instant: string, timeZone: string): string {
  return civilDay(parseCardDateInstant(instant), dayFormatter(timeZone));
}

/** Explicit clock, no implicit Date.now. Overdue has priority over today's civil day.
 * due < now => OVERDUE; otherwise same zone-local calendar date => DUE_TODAY.
 * IANA calendar projection uses Intl and never assumes a day is 24 elapsed hours.
 */
export function deriveCardDueStatus(
  dueDate: string | null,
  now: string,
  timeZone = 'UTC',
): CardDueStatus {
  const clock = parseCardDateInstant(now),
    formatter = dayFormatter(timeZone);
  if (dueDate === null) return CardDueStatus.NO_DUE_DATE;
  const due = parseCardDateInstant(dueDate);
  if (due.getTime() < clock.getTime()) return CardDueStatus.OVERDUE;
  return civilDay(due, formatter) === civilDay(clock, formatter)
    ? CardDueStatus.DUE_TODAY
    : CardDueStatus.UPCOMING;
}
