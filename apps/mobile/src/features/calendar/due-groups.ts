import { cardDateInZone, parseCardDateInstant } from '@kanban/shared';
import type { KanbanCard } from '../boards/kanban-api.ts';

export function calendarToday(timeZone: string, now = Date.now()) {
  return cardDateInZone(new Date(now).toISOString(), timeZone);
}

/** Latest duplicate wins before projection, so a moved due date cannot leave a ghost. */
export function cardsByDueDay(cards: readonly KanbanCard[], timeZone: string) {
  const groups = new Map<string, KanbanCard[]>();
  for (const card of new Map(cards.map((card) => [card.id, card])).values()) {
    if (card.isArchived || !card.dueDate) continue;
    const day = cardDateInZone(card.dueDate, timeZone);
    const group = groups.get(day) ?? [];
    group.push(card);
    groups.set(day, group);
  }
  for (const group of groups.values())
    group.sort(
      (a, b) =>
        parseCardDateInstant(a.dueDate).getTime() -
          parseCardDateInstant(b.dueDate).getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return groups;
}
