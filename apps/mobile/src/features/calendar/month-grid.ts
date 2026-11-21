export type WeekStart = 'monday' | 'sunday';

/** UTC is only a carrier for civil fields; these values are never Card instants. */
export function civilDate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new RangeError('Invalid civil date');
  const date = new Date(`${day}T12:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new RangeError('Invalid civil date');
  return date;
}

export function monthDays(
  month: string,
  weekStartsOn: WeekStart = 'monday',
): string[] {
  const first = civilDate(`${month}-01`);
  const offset = (first.getUTCDay() + (weekStartsOn === 'monday' ? 6 : 0)) % 7;
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const count = Math.max(35, Math.ceil((offset + last.getUTCDate()) / 7) * 7);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(1 - offset + index);
    return date.toISOString().slice(0, 10);
  });
}

/** Preserve day-of-month, clamping to the final valid day of the destination month. */
export function shiftSelectedMonth(selected: string, delta: -1 | 1): string {
  const date = civilDate(selected);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

export function monthCaption(month: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(civilDate(`${month}-01`));
}

export function dayCaption(day: string) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(civilDate(day));
}
