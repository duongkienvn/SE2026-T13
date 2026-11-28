import type { KanbanFilters } from '../boards/kanban-api.ts';
import { localDayStart, nextDay } from '../tasks/filters.ts';
import { monthDays } from './month-grid.ts';

/** Backend Card list contract: `dueFrom` inclusive, `dueTo` exclusive, UTC instants. */
export type DueInterval = { dueFrom: string; dueTo: string };

/**
 * Exact instants covering every visible civil day, including adjacent-month
 * grid days: first instant of the first day to first instant after the last
 * day, in the saved zone (skipped/repeated midnights handled by localDayStart).
 */
export function visibleDueInterval(
  days: readonly string[],
  timeZone: string,
): DueInterval {
  if (!days.length) throw new RangeError('No visible days');
  return {
    dueFrom: localDayStart(days[0]!, timeZone),
    dueTo: localDayStart(nextDay(days.at(-1)!), timeZone),
  };
}

function pick(
  user: string | undefined,
  visible: string,
  keepUser: (user: number, visible: number) => boolean,
) {
  const trimmed = user?.trim();
  if (!trimmed) return visible;
  const value = Date.parse(trimmed);
  // Leave an invalid user value for normalizeKanbanFilters to reject as before.
  if (!Number.isFinite(value)) return trimmed;
  return keepUser(value, Date.parse(visible)) ? trimmed : visible;
}

/**
 * Narrows the user's own due range to the visible interval. Returns null when
 * they cannot overlap, so no request is needed to know the result is empty.
 */
export function intersectDueRange(
  filters: KanbanFilters,
  interval: DueInterval,
): KanbanFilters | null {
  const dueFrom = pick(filters.dueFrom, interval.dueFrom, (u, v) => u > v);
  const dueTo = pick(filters.dueTo, interval.dueTo, (u, v) => u < v);
  const from = Date.parse(dueFrom);
  const to = Date.parse(dueTo);
  if (Number.isFinite(from) && Number.isFinite(to) && from >= to) return null;
  return { ...filters, dueFrom, dueTo };
}

/**
 * First and last grid day the month can show for either week start. Week
 * view is always inside it, so one window serves Month and Week.
 */
export function monthWindow(month: string): [string, string] {
  const monday = monthDays(month, 'monday');
  const sunday = monthDays(month, 'sunday');
  return [
    monday[0]! < sunday[0]! ? monday[0]! : sunday[0]!,
    monday.at(-1)! > sunday.at(-1)! ? monday.at(-1)! : sunday.at(-1)!,
  ];
}
