/** Convert a calendar day to its first instant in an IANA time zone. */
export function startOfDay(date: string, timeZone: string): string {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(midnight) ||
    new Date(midnight).toISOString().slice(0, 10) !== date
  )
    throw new RangeError('Invalid calendar date');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const localDate = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    const part = (type: string) =>
      parts.find((item) => item.type === type)?.value;
    return `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}`;
  };
  // Search chronologically, including repeated or skipped local midnight.
  // IANA UTC offsets and date-line transitions fit within this window.
  const step = 15 * 60 * 1000;
  let previous = midnight - 3 * 86400000;
  for (
    let current = previous + step;
    current <= midnight + 3 * 86400000;
    current += step
  ) {
    if (localDate(current) >= date) {
      let low = previous;
      let high = current;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (localDate(middle) >= date) high = middle;
        else low = middle;
      }
      return new Date(high).toISOString();
    }
    previous = current;
  }
  throw new RangeError(
    'Calendar date is outside the supported time zone range',
  );
}

export function nextCalendarDay(date: string): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
}
