import { wallClockOf } from '../cards/card-dates';
import type { Card } from '../cards/types';

/** Calendar arithmetic uses UTC dates as date-only values, not instants. */
export function calendarDays(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(Date.UTC(year, month, 1 - first.getUTCDay()));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const count = Math.max(
    35,
    Math.ceil((first.getUTCDay() + last.getUTCDate()) / 7) * 7,
  );
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

export function cardsByDueDay(
  cards: Card[],
  timeZone: string,
): Map<string, Card[]> {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    if (
      !card.dueDate ||
      card.isArchived ||
      Number.isNaN(Date.parse(card.dueDate))
    )
      continue;
    const day = wallClockOf(card.dueDate, timeZone).date;
    const group = groups.get(day) ?? [];
    if (!group.some((item) => item.id === card.id)) group.push(card);
    groups.set(day, group);
  }
  for (const group of groups.values())
    group.sort(
      (a, b) =>
        a.dueDate!.localeCompare(b.dueDate!) || a.id.localeCompare(b.id),
    );
  return groups;
}
