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
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(
    hour,
    minute,
    second,
    Number((match[7] ?? '').padEnd(3, '0').slice(0, 3)),
  );
  const offset =
    (offsetHour * 60 + offsetMinute) * 60000 * (match[9] === '-' ? -1 : 1);
  const instant = new Date(local.getTime() - offset);
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
