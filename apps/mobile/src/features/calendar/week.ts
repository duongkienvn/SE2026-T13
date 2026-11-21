import { civilDate, type WeekStart } from './month-grid.ts';

/** Shift civil fields, never an elapsed duration on a localized Card instant. */
export function shiftSelectedWeek(selected: string, delta: -1 | 1): string {
  const date = civilDate(selected);
  date.setUTCDate(date.getUTCDate() + delta * 7);
  return date.toISOString().slice(0, 10);
}

export function weekDays(selected: string, weekStartsOn: WeekStart = 'monday') {
  const first = civilDate(selected);
  const offset = (first.getUTCDay() + (weekStartsOn === 'monday' ? 6 : 0)) % 7;
  first.setUTCDate(first.getUTCDate() - offset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function weekCaption(days: readonly string[]) {
  const first = civilDate(days[0]!);
  const last = civilDate(days[6]!);
  const sameYear = first.getUTCFullYear() === last.getUTCFullYear();
  const label = (date: Date, year: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(year ? { year: 'numeric' as const } : {}),
      timeZone: 'UTC',
    }).format(date);
  return `${label(first, !sameYear)} – ${label(last, true)}`;
}
