const MINUTE = 60_000;
export const PUSH_LOCAL_TIME = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;
export const DEFAULT_PUSH_SCHEDULE = {
  enabled: false,
  startLocal: '22:00',
  endLocal: '07:00',
} as const;

function quietProjection(
  timeZone: string,
  startLocal: string,
  endLocal: string,
) {
  if (
    !PUSH_LOCAL_TIME.test(startLocal) ||
    !PUSH_LOCAL_TIME.test(endLocal) ||
    startLocal === endLocal
  )
    throw new RangeError('Invalid quiet interval');
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const local = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
    return startLocal < endLocal
      ? local >= startLocal && local < endLocal
      : local >= startLocal || local < endLocal;
  };
}

/** UTC instant in, IANA wall-clock projection only; start inclusive, end exclusive. */
export function isQuietAt(
  instant: Date,
  timeZone: string,
  startLocal: string,
  endLocal: string,
): boolean {
  return quietProjection(timeZone, startLocal, endLocal)(instant);
}

/** Scan real UTC minutes, not assumed 24-hour local days. Both fold occurrences
 * are evaluated; gaps naturally resolve to the first existing non-quiet minute.
 * The bounded three-day horizon also covers IANA date-line skips/repeated days.
 * No English date parsing, server-local clock, timer, or global scheduling state.
 */
export function nextAllowedInstant(
  instant: Date,
  timeZone: string,
  startLocal: string,
  endLocal: string,
): Date {
  const quiet = quietProjection(timeZone, startLocal, endLocal);
  if (!quiet(instant)) return new Date(instant);
  const start = Math.floor(instant.getTime() / MINUTE) * MINUTE;
  for (let offset = 1; offset <= 3 * 24 * 60; offset++) {
    const candidate = new Date(start + offset * MINUTE);
    if (!quiet(candidate)) return candidate;
  }
  // Fail closed if an unsupported timezone transition cannot be resolved.
  throw new RangeError('Cannot resolve quiet-hours end');
}
